/**
 * @fileoverview 울산 E-Card — 서버 API fetch 래퍼
 * @module public/js/api
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   서버의 두 API 엔드포인트에 대한 fetch 래퍼를 제공한다.
 *
 *   analyzeImpression(text)
 *     POST /api/impression
 *     소감 텍스트 → 감성 분석 + 답글 + 12패널 색상 반환
 *
 *   requestCard(emotionScores, diversitySeed, reply?)
 *     POST /api/card
 *     감성 점수 → PNG 생성 → 다운로드 URL 반환
 *
 * ─────────────────────────────────────────────────────────────────
 * [응답 구조]
 *
 *   analyzeImpression 응답:
 *   {
 *     spotIndex       : number          매칭 경승지 인덱스 (0~11)
 *     emotionScores   : Object          8차원 감성 점수
 *     primaryEmotion  : string          핵심 감성 한글
 *     keywords        : string[]        감성 키워드 5개
 *     panelColors     : Object[]        12패널 색상 (main/sub/acc/cssHSL)
 *     reply           : {               E-Card 3단 답글
 *       main    : string
 *       place   : string
 *       tagline : string
 *     }
 *     colorTempFilter : string          CSS filter 문자열 (선택)
 *     diversitySeed   : number          다양성 시드
 *   }
 *
 *   requestCard 응답:
 *   {
 *     downloadUrl : string   '/output/{uuid}.png'
 *   }
 *
 * ─────────────────────────────────────────────────────────────────
 * [오류 처리]
 *
 *   HTTP 4xx/5xx → ApiError (message, status, retryable) throw
 *   네트워크 단절  → ApiError (NETWORK_OFFLINE)
 *   타임아웃      → ApiError (NETWORK_TIMEOUT)
 *   JSON 파싱 실패 → ApiError (JSON_PARSE_ERROR)
 *
 *   호출자(app.js)는 catch 블록에서 err.status 와 err.retryable 을
 *   확인하여 적절한 UI 메시지를 표시한다.
 */

'use strict';

// =============================================================================
// ① 설정 상수
// =============================================================================

const API_CONFIG = Object.freeze({
  /** /api/impression 타임아웃 (ms) — Gemini API 2회 호출 고려 */
  IMPRESSION_TIMEOUT_MS: 30_000,

  /** /api/card 타임아웃 (ms) — SVG→PNG 변환 고려 */
  CARD_TIMEOUT_MS: 20_000,

  /** Content-Type 헤더 */
  CONTENT_TYPE: 'application/json',
});

// =============================================================================
// ② 커스텀 오류 클래스
// =============================================================================

/**
 * API 호출에서 발생하는 오류를 표현한다.
 * app.js의 catch 블록에서 err.status, err.retryable 을 참조한다.
 */
export class ApiError extends Error {
  /**
   * @param {string}  message    사용자에게 표시할 메시지
   * @param {number}  [status]   HTTP 상태 코드 (네트워크 오류면 0)
   * @param {boolean} [retryable] 재시도 가능 여부
   */
  constructor(message, status = 0, retryable = false) {
    super(message);
    this.name      = 'ApiError';
    this.status    = status;
    this.retryable = retryable;
  }
}

// =============================================================================
// ③ 내부 fetch 유틸리티
// =============================================================================

/**
 * AbortController 기반 타임아웃 fetch.
 * 오류를 ApiError로 변환하여 throw한다.
 *
 * @param {string} url
 * @param {Object} body          JSON으로 직렬화될 요청 본문
 * @param {number} timeoutMs     타임아웃 시간 (ms)
 * @returns {Promise<Object>}    파싱된 JSON 응답
 * @throws  {ApiError}
 */
async function _post(url, body, timeoutMs) {
  const controller = new AbortController();
  const timerId    = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'Content-Type': API_CONFIG.CONTENT_TYPE },
      body:    JSON.stringify(body),
    });
  } catch (err) {
    clearTimeout(timerId);

    // AbortError → 타임아웃
    if (err.name === 'AbortError') {
      throw new ApiError(
        '서버 응답이 너무 늦어지고 있습니다. 잠시 후 다시 시도해주세요.',
        0,
        true,
      );
    }

    // TypeError (fetch 자체 실패) → 네트워크 오프라인
    throw new ApiError(
      '네트워크 연결을 확인해주세요.',
      0,
      true,
    );
  }

  clearTimeout(timerId);

  // ── HTTP 오류 처리 ────────────────────────────────────────────
  if (!res.ok) {
    let serverMessage = '';
    try {
      const errJson = await res.json();
      serverMessage = errJson.error ?? errJson.message ?? '';
    } catch {
      // JSON 파싱 실패 시 무시
    }

    const retryable = res.status === 429 || res.status >= 500;

    const fallbackMessages = {
      400: '요청 형식이 올바르지 않습니다.',
      429: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
      500: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      503: '서버가 일시적으로 사용 불가합니다. 잠시 후 다시 시도해주세요.',
    };

    throw new ApiError(
      serverMessage || fallbackMessages[res.status] || `오류가 발생했습니다. (${res.status})`,
      res.status,
      retryable,
    );
  }

  // ── JSON 파싱 ────────────────────────────────────────────────
  try {
    return await res.json();
  } catch {
    throw new ApiError(
      '서버 응답을 처리하지 못했습니다. 새로고침 후 다시 시도해주세요.',
      res.status,
      false,
    );
  }
}

// =============================================================================
// ④ 응답 유효성 검사
// =============================================================================

/**
 * /api/impression 응답의 필수 필드를 확인하고 기본값을 보정한다.
 * 서버 폴백 응답처럼 일부 필드가 없어도 UI가 깨지지 않도록 한다.
 *
 * @param {Object} data  서버 응답 JSON
 * @returns {Object}     보정된 응답 객체
 */
function _sanitizeImpressionResponse(data) {
  // 필수 최상위 필드 기본값 보정
  const EMOTION_KEYS = [
    'amazement', 'peace', 'vitality', 'nostalgia',
    'freshness', 'grandeur', 'warmth', 'mystery',
  ];

  const emotionScores = {};
  EMOTION_KEYS.forEach((k) => {
    const v = data.emotionScores?.[k];
    emotionScores[k] = typeof v === 'number' ? Math.min(100, Math.max(0, v)) : 25;
  });

  // panelColors: 12개 배열 보장
  const panelColors = Array.isArray(data.panelColors) && data.panelColors.length === 12
    ? data.panelColors
    : null;  // null이면 app.js가 클라이언트 사이드 계산으로 폴백

  // reply 3단 구조 기본값
  const reply = {
    main:    data.reply?.main    || '울산이 당신에게 건넨 소중한 순간',
    place:   data.reply?.place   || '울산의 아름다운 풍경이 오래도록 기억에 남기를 바랍니다.',
    tagline: data.reply?.tagline || 'ULSAN — 당신의 울산',
  };

  // tagline ULSAN 형식 보장
  if (!reply.tagline.startsWith('ULSAN')) {
    reply.tagline = `ULSAN — ${reply.tagline}`;
  }

  return {
    spotIndex:       typeof data.spotIndex === 'number'
                       ? Math.min(11, Math.max(0, Math.round(data.spotIndex)))
                       : 0,
    emotionScores,
    primaryEmotion:  data.primaryEmotion  || '울산의 감동',
    keywords:        Array.isArray(data.keywords) && data.keywords.length > 0
                       ? data.keywords.slice(0, 5)
                       : ['자연', '아름다움', '감동', '힐링', '울산'],
    panelColors,
    reply,
    colorTempFilter: data.colorTempFilter || null,
    diversitySeed:   typeof data.diversitySeed === 'number' ? data.diversitySeed : 0,
  };
}

/**
 * /api/card 응답의 downloadUrl 필드를 확인한다.
 *
 * @param {Object} data
 * @returns {Object}
 * @throws {ApiError}
 */
function _sanitizeCardResponse(data) {
  if (typeof data.downloadUrl !== 'string' || !data.downloadUrl.startsWith('/')) {
    throw new ApiError(
      '이미지 저장에 실패했습니다. 다시 시도해주세요.',
      500,
      true,
    );
  }
  return { downloadUrl: data.downloadUrl };
}

// =============================================================================
// ⑤ 공개 API 함수
// =============================================================================

/**
 * 방문객 소감을 분석하여 E-Card 데이터를 반환한다.
 *
 * POST /api/impression
 *   Body  : { text: string, language?: string }
 *   응답  : { spotIndex, emotionScores, primaryEmotion, keywords,
 *             panelColors, reply, colorTempFilter, diversitySeed }
 *
 * @param {string} text      방문객 소감 원문 (8자 이상)
 * @param {string} [language='ko']  언어 코드 ('ko'|'en'|'ja'|'zh')
 * @returns {Promise<Object>}  보정된 impression 응답 데이터
 * @throws  {ApiError}
 *
 * @example
 * try {
 *   const data = await analyzeImpression('간절곶에서 일출을 봤어요. 정말 감동이었어요 🌅');
 *   // data.reply.main    → "그 빛은 오래도록 당신 곁에 머물 것입니다"
 *   // data.panelColors   → Array(12)
 *   // data.spotIndex     → 0
 * } catch (err) {
 *   if (err instanceof ApiError) {
 *     console.error(err.message, 'retryable:', err.retryable);
 *   }
 * }
 */
export async function analyzeImpression(text, language = 'ko') {
  if (typeof text !== 'string' || text.trim().length < 8) {
    throw new ApiError('소감을 8자 이상 입력해주세요.', 400, false);
  }

  const rawData = await _post(
    '/api/impression',
    { text: text.trim(), language },
    API_CONFIG.IMPRESSION_TIMEOUT_MS,
  );

  return _sanitizeImpressionResponse(rawData);
}

/**
 * 감성 점수 기반으로 PNG E-Card를 생성하고 다운로드 URL을 반환한다.
 *
 * POST /api/card
 *   Body  : { emotionScores, diversitySeed, reply?, size? }
 *   응답  : { downloadUrl: '/output/{uuid}.png' }
 *
 * @param {Object} emotionScores   8차원 감성 점수 객체
 * @param {number} diversitySeed   다양성 시드 (analyzeImpression 응답에서 전달)
 * @param {{ main:string, place:string, tagline:string }|null} [reply]
 *   타이포그래피 합성용 답글. null이면 이미지만 저장.
 * @param {number} [size=1200]     출력 이미지 너비 (400~2400)
 * @returns {Promise<{ downloadUrl: string }>}
 * @throws  {ApiError}
 *
 * @example
 * const { downloadUrl } = await requestCard(
 *   data.emotionScores,
 *   data.diversitySeed,
 *   data.reply,
 * );
 * // downloadUrl → '/output/f47ac10b-58cc-4e62-a3f3-ab18cc1f6c7e.png'
 */
export async function requestCard(emotionScores, diversitySeed, reply = null, size = 1200) {
  if (!emotionScores || typeof emotionScores !== 'object') {
    throw new ApiError('감성 데이터가 없습니다. 소감을 먼저 입력해주세요.', 400, false);
  }

  const rawData = await _post(
    '/api/card',
    {
      emotionScores,
      diversitySeed: diversitySeed ?? 0,
      reply:         reply ?? null,
      size:          Math.min(Math.max(size, 400), 2400),
    },
    API_CONFIG.CARD_TIMEOUT_MS,
  );

  return _sanitizeCardResponse(rawData);
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  analyzeImpression,
  requestCard,
  ApiError,
};
