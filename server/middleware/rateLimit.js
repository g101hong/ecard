/**
 * @fileoverview server/middleware/rateLimit.js
 * @description  요청 속도 제한 미들웨어
 *
 * ─────────────────────────────────────────────────────────────────
 * 설계 목적
 * ─────────────────────────────────────────────────────────────────
 *
 * Gemini API는 호출당 비용이 발생하므로
 * 단시간 과다 요청(DoS, 스크립트 남용)을 차단한다.
 *
 * 라우트별 제한 차등 적용:
 *
 *   /api/impression  ← Gemini API 1회 호출 → 가장 엄격
 *   /api/card        ← 이미지 생성 (CPU 사용) → 중간
 *   /api/*           ← 나머지 일반 API → 여유
 *
 * ─────────────────────────────────────────────────────────────────
 * 환경변수
 * ─────────────────────────────────────────────────────────────────
 *
 *   RATE_LIMIT_WINDOW_MS   윈도우 크기 (기본: 60000 = 1분)
 *   RATE_LIMIT_MAX         일반 API 최대 요청 수 (기본: 60)
 */

'use strict';

import rateLimit from 'express-rate-limit';

// 환경변수 (기본값 포함)
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const MAX_GENERAL   = parseInt(process.env.RATE_LIMIT_MAX  || '60',    10);
const MAX_IMPRESSION = Math.floor(MAX_GENERAL * 0.2);  // 일반의 20% (분당 12회)
const MAX_CARD       = Math.floor(MAX_GENERAL * 0.3);  // 일반의 30% (분당 18회)

// ── 공통 옵션 ─────────────────────────────────────────────────────
const commonOptions = {
  windowMs:          WINDOW_MS,
  standardHeaders:   true,   // RateLimit-* 헤더 반환
  legacyHeaders:     false,  // X-RateLimit-* 헤더 비활성화
  handler: (req, res) => {
    res.status(429).json({
      error:      '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
      retryAfter: Math.ceil(WINDOW_MS / 1000),
    });
  },
};

// ── /api/impression 전용 제한 ─────────────────────────────────────
// Gemini API 1회 호출 → 가장 엄격하게 제한
export const impressionLimiter = rateLimit({
  ...commonOptions,
  max:     MAX_IMPRESSION,
  message: `소감 분석은 1분에 ${MAX_IMPRESSION}회까지 가능합니다.`,
});

// ── /api/card 전용 제한 ───────────────────────────────────────────
// 이미지 생성 (CPU + 디스크 I/O) → 중간 수준
export const cardLimiter = rateLimit({
  ...commonOptions,
  max:     MAX_CARD,
  message: `이미지 저장은 1분에 ${MAX_CARD}회까지 가능합니다.`,
});

// ── 일반 API 제한 ─────────────────────────────────────────────────
export const generalLimiter = rateLimit({
  ...commonOptions,
  max: MAX_GENERAL,
});

export default { impressionLimiter, cardLimiter, generalLimiter };
