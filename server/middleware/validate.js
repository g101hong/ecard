/**
 * @fileoverview server/middleware/validate.js
 * @description  입력값 검증 미들웨어
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 * impression.js, card.js 라우트 핸들러 앞에서
 * 요청 본문(body)을 검증하고 정규화한다.
 *
 * 검증 통과 시: req.validated 에 정규화된 값을 담고 next() 호출
 * 검증 실패 시: 400 응답 즉시 반환
 *
 * ─────────────────────────────────────────────────────────────────
 * 미들웨어 목록
 * ─────────────────────────────────────────────────────────────────
 *
 *   validateImpression  POST /api/impression 전용
 *   validateCard        POST /api/card 전용
 *
 * ─────────────────────────────────────────────────────────────────
 * 참고
 * ─────────────────────────────────────────────────────────────────
 *
 *   현재 impression.js, card.js 는 각 라우트 내부에서 직접 검증하므로
 *   이 미들웨어는 등록되어 있지 않다.
 *   라우트 앞단으로 검증을 분리하고 싶을 때 api.js에 연결하면 된다:
 *
 *     router.use('/impression', validateImpression, impressionRouter);
 *     router.use('/card',       validateCard,       cardRouter);
 */

'use strict';

// ─────────────────────────────────────────────────────────────────
// 공통 헬퍼
// ─────────────────────────────────────────────────────────────────

/** HTML 태그 제거 및 공백 정리 */
function sanitizeString(str) {
  return str
    .replace(/<[^>]*>/g, '')   // HTML 태그 제거
    .replace(/\s+/g, ' ')      // 연속 공백 → 단일 공백
    .trim();
}

const VALID_LANGUAGES = ['ko', 'en', 'ja', 'zh'];
const VALID_TRIP_DURATIONS = ['day', '1n2d', '2n3d', '3n4d', '4n+'];
const VALID_COMPANIONS     = ['solo', 'family', 'friends', 'couple', 'other'];
const EMOTION_KEYS    = [
  'amazement','peace','vitality','nostalgia',
  'freshness','grandeur','warmth','mystery',
];

// ─────────────────────────────────────────────────────────────────
// POST /api/impression 검증
// ─────────────────────────────────────────────────────────────────

/**
 * 소감 텍스트 검증 미들웨어
 *
 * 검증 항목:
 *   - text 필드 존재 여부
 *   - 최소 8자 / 최대 500자
 *   - XSS 기본 처리 (HTML 태그 제거)
 *   - language 필드 유효성 (ko/en/ja/zh, 선택)
 *
 * 통과 시 req.validated = { text, language } 설정
 */
export function validateImpression(req, res, next) {
  const { text, language, tripDuration, companion } = req.body;

  // text 타입 확인
  if (typeof text !== 'string') {
    return res.status(400).json({ error: '소감 텍스트(text)가 필요합니다.' });
  }

  // 정규화
  const cleaned = sanitizeString(text);

  // 길이 검증
  if (cleaned.length < 8) {
    return res.status(400).json({
      error: '소감을 조금 더 자세히 적어주세요 (8자 이상).',
    });
  }
  if (cleaned.length > 500) {
    return res.status(400).json({
      error: '소감이 너무 깁니다 (500자 이하).',
    });
  }

  // language 검증 (없으면 'ko' 기본값)
  const lang = typeof language === 'string' && VALID_LANGUAGES.includes(language)
    ? language : 'ko';

  // tripDuration / companion 검증 (없거나 잘못된 값이면 null)
  const trip = typeof tripDuration === 'string' && VALID_TRIP_DURATIONS.includes(tripDuration)
    ? tripDuration : null;
  const comp = typeof companion === 'string' && VALID_COMPANIONS.includes(companion)
    ? companion : null;

  // 검증된 값을 req.validated 에 저장
  req.validated = { text: cleaned, language: lang, tripDuration: trip, companion: comp };
  next();
}

// ─────────────────────────────────────────────────────────────────
// POST /api/card 검증
// ─────────────────────────────────────────────────────────────────

/**
 * PNG 생성 요청 검증 미들웨어
 *
 * 검증 항목:
 *   - emotionScores 필드 존재 및 8개 감성 키 확인
 *   - 각 점수 0~100 범위로 정규화
 *   - diversitySeed 숫자 검증
 *   - reply 객체 선택적 검증
 *   - size 숫자 범위 검증 (400~2400)
 *
 * 통과 시 req.validated = { emotionScores, diversitySeed, reply, size } 설정
 */
export function validateCard(req, res, next) {
  const { emotionScores, diversitySeed, reply, size } = req.body;

  // emotionScores 검증 및 정규화
  if (!emotionScores || typeof emotionScores !== 'object') {
    return res.status(400).json({ error: 'emotionScores 객체가 필요합니다.' });
  }

  const cleanedScores = {};
  for (const key of EMOTION_KEYS) {
    const v = Number(emotionScores[key]);
    cleanedScores[key] = isNaN(v) ? 25 : Math.min(100, Math.max(0, Math.round(v)));
  }

  // diversitySeed 검증
  const seed = typeof diversitySeed === 'number'
    ? diversitySeed
    : parseInt(diversitySeed, 10) || 0;

  // reply 선택적 검증
  let cleanReply = null;
  if (reply && typeof reply === 'object') {
    cleanReply = {
      main:    typeof reply.main    === 'string' ? reply.main.slice(0, 60)    : null,
      place:   typeof reply.place   === 'string' ? reply.place.slice(0, 120)  : null,
      tagline: typeof reply.tagline === 'string' ? reply.tagline.slice(0, 40) : null,
    };
    // 모든 필드가 null이면 reply 자체를 null로
    const hasAny = Object.values(cleanReply).some(v => v !== null);
    if (!hasAny) cleanReply = null;
  }

  // size 범위 제한 (400~2400, 기본 1200)
  const outputSize = Math.min(
    Math.max(parseInt(size, 10) || 1200, 400),
    2400,
  );

  req.validated = {
    emotionScores: cleanedScores,
    diversitySeed: seed,
    reply:         cleanReply,
    size:          outputSize,
  };
  next();
}

export default { validateImpression, validateCard };
