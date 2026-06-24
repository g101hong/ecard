/**
 * @fileoverview 울산 E-Card — 서버 API fetch 래퍼
 * @module public/js/api
 * @version 2.1.0  [v3.1] dominantEmotion 전달 추가
 *
 * ─────────────────────────────────────────────────────────────────
 * [v3.1 변경사항] 폰트 불일치 수정
 * ─────────────────────────────────────────────────────────────────
 *
 *   1. SSE colors 이벤트 수신 시 dominantEmotion을 accumulated에 저장
 *   2. requestCard() 파라미터에 dominantEmotion 추가
 *   3. /api/card POST body에 dominantEmotion 포함
 *
 * ─────────────────────────────────────────────────────────────────
 * [방안C 변경사항] SSE 스트리밍 수신
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

// =============================================================================
// ① 설정 상수
// =============================================================================

const API_CONFIG = Object.freeze({
  IMPRESSION_TIMEOUT_MS: 35_000,
  CARD_TIMEOUT_MS:       20_000,
  CONTENT_TYPE:          'application/json',
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

async function _readSSEStream(body, controller, onEvent) {
  const reader  = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer    = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split('\n\n');
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
    controller.abort();
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
 * @param {string} text
 * @param {Object} [options]
 * @param {string}   [options.language='ko']
 * @param {string}   [options.tripDuration]
 * @param {string}   [options.companion]
 * @param {function} [options.onColors]
 * @param {function} [options.onReply]
 * @returns {Promise<Object>}
 */
export async function analyzeImpression(text, options = {}) {
  if (typeof text !== 'string' || text.trim().length < 8) {
    throw new ApiError('소감을 8자 이상 입력해주세요.', 400, false);
  }

  const {
    language     = 'ko',
    tripDuration = null,
    companion    = null,
    onColors     = null,
    onReply      = null,
  } = options;

  const controller = new AbortController();
  const timerId    = setTimeout(() => controller.abort(), API_CONFIG.IMPRESSION_TIMEOUT_MS);

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

  const accumulated = {};

  return new Promise((resolve, reject) => {
    _readSSEStream(res.body, controller, ({ event, data }) => {

      if (event === 'colors') {
        Object.assign(accumulated, {
          spotIndex:        data.spotIndex,
          spotName:         data.spotName,
          emotionScores:    _sanitizeEmotionScores(data.emotionScores),
          colorTempFilter:  data.colorTempFilter  ?? null,
          diversitySeed:    data.diversitySeed    ?? 0,
          dominantEmotion:  data.dominantEmotion  ?? 'amazement',  // [v3.1] 추가
        });

        if (typeof onColors === 'function') {
          try { onColors(accumulated); } catch (e) {
            console.warn('[api] onColors 콜백 오류 (무시):', e.message);
          }
        }
      }

      else if (event === 'reply') {
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
        clearTimeout(timerId);
        resolve(accumulated);
      }

      else if (event === 'error') {
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
// ⑤ /api/card — PNG 저장 요청
// =============================================================================

/**
 * E-Card PNG 생성을 요청한다.
 *
 * [v3.1] dominantEmotion 파라미터 추가.
 *        서버가 이 값으로 폰트를 직접 결정하여 화면 폰트와 일치시킨다.
 *
 * @param {Object}      emotionScores
 * @param {Object|null} [reply]
 * @param {number}      spotIndex         0~11
 * @param {number}      [size=1200]
 * @param {string|null} [dominantEmotion] 서버 결정 dominant 감성 키 [v3.1]
 */
export async function requestCard(
  emotionScores,
  reply          = null,
  spotIndex,
  size           = 1200,
  dominantEmotion = null,   // [v3.1] 추가
) {
  if (!emotionScores || typeof emotionScores !== 'object') {
    throw new ApiError('감성 데이터가 없습니다. 소감을 먼저 입력해주세요.', 400, false);
  }
  if (typeof spotIndex !== 'number' || spotIndex < 0 || spotIndex > 11) {
    throw new ApiError('경승지 정보가 없습니다. 소감을 먼저 입력해주세요.', 400, false);
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
        reply:           reply ?? null,
        spotIndex,
        size:            Math.min(Math.max(size, 400), 2400),
        dominantEmotion: dominantEmotion ?? null,   // [v3.1] 추가
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
