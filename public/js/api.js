/**
 * @fileoverview 울산 E-Card — 서버 API fetch 래퍼
 * @module public/js/api
 * @version 2.0.0  [방안C] SSE 스트리밍 수신
 *
 * ─────────────────────────────────────────────────────────────────
 * [방안C 변경사항]
 * ─────────────────────────────────────────────────────────────────
 *
 *   analyzeImpression(text, options)의 인터페이스는 그대로 유지한다.
 *   내부적으로 fetch + ReadableStream으로 SSE를 수신하며,
 *   options.onColors / options.onReply 콜백으로 단계별 데이터를
 *   app.js에 전달한다.
 *
 *   app.js 변경 최소화:
 *     기존: const data = await analyzeImpression(text, options)
 *     변경: const data = await analyzeImpression(text, {
 *              ...options,
 *              onColors: (colorsData) => { /* SVG 즉시 적용 *\/ },
 *              onReply:  (replyData)  => { /* 답글 렌더 *\/ },
 *           })
 *     resolve 값은 colors + reply를 합친 완전한 객체 (기존과 동일)
 *
 * ─────────────────────────────────────────────────────────────────
 * SSE 수신 방식 — fetch + ReadableStream
 * ─────────────────────────────────────────────────────────────────
 *
 *   EventSource는 GET만 지원하므로 POST body를 보낼 수 없다.
 *   fetch의 response.body(ReadableStream)를 직접 읽어 SSE를 파싱한다.
 *
 *   수신 이벤트:
 *     event: colors  → onColors(data) 콜백 즉시 호출
 *     event: reply   → onReply(data)  콜백 즉시 호출
 *     event: done    → Promise resolve
 *     event: error   → Promise reject
 *
 * ─────────────────────────────────────────────────────────────────
 * 오류 처리
 * ─────────────────────────────────────────────────────────────────
 *
 *   SSE 연결 전 HTTP 오류 (400 등)     → ApiError throw (즉시)
 *   SSE 스트림 중 error 이벤트         → ApiError throw
 *   SSE 스트림 중 네트워크 단절        → ApiError throw
 *   타임아웃 (IMPRESSION_TIMEOUT_MS)   → ApiError throw
 *   onColors / onReply 콜백 내부 예외  → 콘솔 경고 후 무시 (UI 깨짐 방지)
 */

'use strict';

// =============================================================================
// ① 설정 상수
// =============================================================================

const API_CONFIG = Object.freeze({
  /**
   * /api/impression SSE 타임아웃 (ms)
   * Gemini 1회 호출 기준 최대 20초 + 여유
   */
  IMPRESSION_TIMEOUT_MS: 35_000,

  /** /api/card 타임아웃 (ms) */
  CARD_TIMEOUT_MS: 20_000,

  CONTENT_TYPE: 'application/json',
});

// =============================================================================
// ② 커스텀 오류 클래스
// =============================================================================

export class ApiError extends Error {
  constructor(message, status = 0, retryable = false) {
    super(message);
    this.name      = 'ApiError';
    this.status    = status;
    this.retryable = retryable;
  }
}

// =============================================================================
// ③ SSE 파서 — ReadableStream → 이벤트 객체
// =============================================================================

/**
 * fetch response.body(ReadableStream)를 읽어 SSE 이벤트를 파싱한다.
 *
 * SSE 규격: "event: name\ndata: json\n\n" 형식의 텍스트 스트림.
 * TextDecoder + 줄 단위 파싱으로 구현한다.
 *
 * @param {ReadableStream} body          fetch response.body
 * @param {AbortController} controller   타임아웃 제어
 * @param {function} onEvent             ({ event, data }) 콜백
 * @returns {Promise<void>}
 */
async function _readSSEStream(body, controller, onEvent) {
  const reader  = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer    = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE는 "\n\n"으로 이벤트 경계를 구분한다
      const blocks = buffer.split('\n\n');
      // 마지막 불완전한 블록은 버퍼에 남긴다
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        if (!block.trim()) continue;

        let eventName = 'message';
        let dataStr   = '';

        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataStr = line.slice(5).trim();
          }
        }

        if (!dataStr) continue;

        try {
          const parsed = JSON.parse(dataStr);
          onEvent({ event: eventName, data: parsed });
        } catch {
          console.warn('[api] SSE 데이터 파싱 실패:', dataStr.slice(0, 100));
        }
      }
    }
  } finally {
    reader.releaseLock();
    controller.abort(); // 타임아웃 타이머 해제
  }
}

// =============================================================================
// ④ /api/impression — SSE 수신
// =============================================================================

/**
 * 방문객 소감을 분석하여 E-Card 데이터를 반환한다.
 *
 * [방안C] SSE 스트리밍 수신.
 *   colors 이벤트 수신 즉시 options.onColors(colorsData) 호출.
 *   reply  이벤트 수신 즉시 options.onReply(replyData)  호출.
 *   done   이벤트 수신 시  Promise resolve (합친 객체 반환).
 *
 * @param {string} text       방문객 소감 원문 (8자 이상)
 * @param {Object} [options]
 * @param {string}   [options.language='ko']
 * @param {string}   [options.tripDuration]
 * @param {string}   [options.companion]
 * @param {function} [options.onColors]   Phase1 콜백 — SVG 색채 즉시 적용용
 *   @param {Object} colorsData
 *   @param {number} colorsData.spotIndex
 *   @param {string} colorsData.spotName
 *   @param {Object} colorsData.emotionScores
 *   @param {string} colorsData.colorTempFilter
 *   @param {number} colorsData.diversitySeed
 * @param {function} [options.onReply]    Phase2 콜백 — 답글 카드 렌더용
 *   @param {Object} replyData
 *   @param {Object} replyData.reply  { main, place, tagline }
 *   @param {string} replyData.primaryEmotion
 *   @param {string[]} replyData.keywords
 * @returns {Promise<Object>}  colors + reply 합친 완전한 응답 객체
 * @throws  {ApiError}
 *
 * @example
 * const data = await analyzeImpression(text, {
 *   tripDuration: '2n3d',
 *   companion: 'couple',
 *   onColors: (d) => {
 *     applyDeltaColorsToSVG(d.emotionScores, d.diversitySeed);
 *     revealSVG();
 *   },
 *   onReply: (d) => {
 *     renderResult(d);
 *   },
 * });
 * // data.emotionScores, data.reply, data.spotIndex 등 사용 가능
 */
export async function analyzeImpression(text, options = {}) {
  if (typeof text !== 'string' || text.trim().length < 8) {
    throw new ApiError('소감을 8자 이상 입력해주세요.', 400, false);
  }

  const {
    language     = 'ko',
    tripDuration = null,
    companion    = null,
    onColors     = null,   // [방안C] Phase1 콜백
    onReply      = null,   // [방안C] Phase2 콜백
  } = options;

  const controller = new AbortController();
  const timerId    = setTimeout(
    () => controller.abort(),
    API_CONFIG.IMPRESSION_TIMEOUT_MS,
  );

  // ── fetch — SSE 스트림 연결 ──────────────────────────────────────
  let res;
  try {
    res = await fetch('/api/impression', {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'Content-Type': API_CONFIG.CONTENT_TYPE },
      body:    JSON.stringify({ text: text.trim(), language, tripDuration, companion }),
    });
  } catch (err) {
    clearTimeout(timerId);
    if (err.name === 'AbortError') {
      throw new ApiError('서버 응답이 너무 늦어지고 있습니다. 잠시 후 다시 시도해주세요.', 0, true);
    }
    throw new ApiError('네트워크 연결을 확인해주세요.', 0, true);
  }

  // SSE 연결 전 HTTP 오류 처리 (400 Bad Request 등)
  if (!res.ok) {
    clearTimeout(timerId);
    let serverMessage = '';
    try { serverMessage = (await res.json()).error ?? ''; } catch { /* noop */ }
    const retryable = res.status === 429 || res.status >= 500;
    throw new ApiError(
      serverMessage || `오류가 발생했습니다. (${res.status})`,
      res.status,
      retryable,
    );
  }

  // ── SSE 스트림 수신 및 이벤트 처리 ─────────────────────────────
  const accumulated = {};   // colors + reply 데이터를 누적

  return new Promise((resolve, reject) => {
    _readSSEStream(res.body, controller, ({ event, data }) => {

      if (event === 'colors') {
        // Phase 1: 색상 데이터 수신
        // → onColors 콜백 즉시 호출 (SVG 색채 전환 트리거)
        Object.assign(accumulated, {
          spotIndex:       data.spotIndex,
          spotName:        data.spotName,
          emotionScores:   _sanitizeEmotionScores(data.emotionScores),
          colorTempFilter: data.colorTempFilter ?? null,
          diversitySeed:   data.diversitySeed   ?? 0,
        });

        if (typeof onColors === 'function') {
          try { onColors(accumulated); } catch (e) {
            console.warn('[api] onColors 콜백 오류 (무시):', e.message);
          }
        }
      }

      else if (event === 'reply') {
        // Phase 2: 답글 데이터 수신
        // → onReply 콜백 즉시 호출 (답글 카드 렌더 트리거)
        const replyPayload = {
          reply:          _sanitizeReply(data.reply),
          primaryEmotion: data.primaryEmotion || '울산의 감동',
          keywords:       Array.isArray(data.keywords) ? data.keywords.slice(0, 5)
                                                       : ['자연','아름다움','감동','힐링','울산'],
        };
        Object.assign(accumulated, replyPayload);

        if (typeof onReply === 'function') {
          try { onReply(replyPayload); } catch (e) {
            console.warn('[api] onReply 콜백 오류 (무시):', e.message);
          }
        }
      }

      else if (event === 'done') {
        // 스트림 종료 — 합친 객체로 resolve
        clearTimeout(timerId);
        resolve(accumulated);
      }

      else if (event === 'error') {
        // 서버 측 오류 이벤트
        clearTimeout(timerId);
        reject(new ApiError(
          data.message || '감성 분석 중 오류가 발생했습니다.',
          500,
          true,
        ));
      }

    }).catch((err) => {
      clearTimeout(timerId);
      if (err.name === 'AbortError') {
        reject(new ApiError('서버 응답 시간이 초과되었습니다.', 0, true));
      } else {
        reject(new ApiError('스트림 수신 중 오류가 발생했습니다.', 0, true));
      }
    });
  });
}

// =============================================================================
// ⑤ /api/card — 기존 JSON POST 유지
// =============================================================================

export async function requestCard(emotionScores, reply = null, size = 1200) {
  if (!emotionScores || typeof emotionScores !== 'object') {
    throw new ApiError('감성 데이터가 없습니다. 소감을 먼저 입력해주세요.', 400, false);
  }

  const controller = new AbortController();
  const timerId    = setTimeout(() => controller.abort(), API_CONFIG.CARD_TIMEOUT_MS);

  let res;
  try {
    res = await fetch('/api/card', {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'Content-Type': API_CONFIG.CONTENT_TYPE },
      body:    JSON.stringify({
        emotionScores,
        reply: reply ?? null,
        size:  Math.min(Math.max(size, 400), 2400),
      }),
    });
  } catch (err) {
    clearTimeout(timerId);
    if (err.name === 'AbortError') throw new ApiError('이미지 저장 시간이 초과되었습니다.', 0, true);
    throw new ApiError('네트워크 연결을 확인해주세요.', 0, true);
  }

  clearTimeout(timerId);

  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error ?? ''; } catch { /* noop */ }
    throw new ApiError(msg || `이미지 저장 실패 (${res.status})`, res.status, res.status >= 500);
  }

  const data = await res.json();
  if (typeof data.downloadUrl !== 'string' || !data.downloadUrl.startsWith('/')) {
    throw new ApiError('이미지 저장에 실패했습니다. 다시 시도해주세요.', 500, true);
  }
  return { downloadUrl: data.downloadUrl };
}

// =============================================================================
// ⑥ 내부 sanitize 헬퍼
// =============================================================================

function _sanitizeEmotionScores(scores) {
  const KEYS = ['amazement','peace','vitality','nostalgia','freshness','grandeur','warmth','mystery'];
  const out  = {};
  KEYS.forEach((k) => {
    const v = scores?.[k];
    out[k] = typeof v === 'number' ? Math.min(100, Math.max(0, v)) : 25;
  });
  return out;
}

function _sanitizeReply(r) {
  const main    = (typeof r?.main    === 'string' && r.main.trim())    ? r.main.trim()    : '울산이 당신에게 건넨 소중한 순간';
  const place   = (typeof r?.place   === 'string' && r.place.trim())   ? r.place.trim()   : '울산의 아름다운 풍경이 오래도록 기억에 남기를 바랍니다.';
  const rawTag  = typeof r?.tagline === 'string' ? r.tagline.trim() : '';
  const tagline = rawTag ? (rawTag.startsWith('ULSAN') ? rawTag : `ULSAN — ${rawTag}`) : 'ULSAN — 당신의 울산';
  return { main, place, tagline };
}

// =============================================================================
// Default Export
// =============================================================================

export default { analyzeImpression, requestCard, ApiError };
