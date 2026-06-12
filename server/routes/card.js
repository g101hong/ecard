/**
 * @fileoverview server/routes/card.js
 * @description  POST /api/card — E-Card PNG 생성 및 다운로드 URL 반환
 *
 * ─────────────────────────────────────────────────────────────────
 * 요청 흐름
 * ─────────────────────────────────────────────────────────────────
 *
 *   클라이언트 (public/js/api.js)
 *       │
 *       │  POST /api/card
 *       │  Body: {
 *       │    emotionScores,   ← /api/impression 응답에서 받은 값
 *       │    diversitySeed,   ← /api/impression 응답에서 받은 값
 *       │    reply            ← { main, place, tagline } (선택)
 *       │  }
 *       ▼
 *   [card.js]
 *       ├─ 입력값 검증
 *       ├─ svg-engine.patchSVG(emotionScores, diversitySeed, reply)
 *       │    → jsdom으로 SVG 색상 교체 + 답글 텍스트 합성
 *       ├─ svg-engine.svgToPng(svgString)
 *       │    → sharp로 1200×1200 PNG 변환 + output/ 저장
 *       └─ { downloadUrl: '/output/{uuid}.png' } 반환
 *
 * ─────────────────────────────────────────────────────────────────
 * 처리시간: 약 0.3 ~ 0.8초
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

import { Router } from 'express';
//import { patchSVG }          from '../../svg-engine/svg-patcher.js';
//import { svgToPng }          from '../../svg-engine/png-exporter.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────
// 입력값 검증 헬퍼
// ─────────────────────────────────────────────────────────────────

const EMOTION_KEYS = [
  'amazement','peace','vitality','nostalgia',
  'freshness','grandeur','warmth','mystery',
];

/**
 * emotionScores 객체의 유효성을 검사하고 정규화한다.
 *
 * @param {any} scores
 * @returns {{ valid:boolean, cleaned:Object, error?:string }}
 */
function validateEmotionScores(scores) {
  if (!scores || typeof scores !== 'object') {
    return { valid:false, error:'emotionScores가 없습니다' };
  }

  const cleaned = {};
  for (const key of EMOTION_KEYS) {
    const v = Number(scores[key]);
    if (isNaN(v)) {
      cleaned[key] = 25; // 기본값
    } else {
      cleaned[key] = Math.min(100, Math.max(0, Math.round(v)));
    }
  }

  return { valid:true, cleaned };
}

/**
 * reply 객체의 유효성을 확인하고 정규화한다.
 *
 * @param {any} reply
 * @returns {Object|null}  유효하면 정규화된 객체, 아니면 null
 */
function sanitizeReply(reply) {
  if (!reply || typeof reply !== 'object') return null;

  return {
    main:    typeof reply.main    === 'string' ? reply.main.slice(0, 60)    : null,
    place:   typeof reply.place   === 'string' ? reply.place.slice(0, 120)  : null,
    tagline: typeof reply.tagline === 'string' ? reply.tagline.slice(0, 40) : null,
  };
}

// ─────────────────────────────────────────────────────────────────
// POST /api/card
// ─────────────────────────────────────────────────────────────────

/**
 * E-Card PNG를 생성하고 다운로드 URL을 반환한다.
 *
 * @route  POST /api/card
 * @body   {
 *           emotionScores: Object,   필수 — 8차원 감성 점수
 *           diversitySeed: number,   필수 — 다양성 시드
 *           reply?:        Object,   선택 — { main, place, tagline }
 *           size?:         number    선택 — PNG 크기 (기본 1200)
 *         }
 * @returns {
 *   downloadUrl: string,   '/output/{uuid}.png'
 *   fileName:    string,   '{uuid}.png'
 *   size:        number,   출력 PNG 크기
 *   generatedAt: string,   ISO 8601 타임스탬프
 * }
 */
router.post('/', async (req, res) => {
  const { emotionScores, diversitySeed, reply, size } = req.body;

  // ── 1. 입력값 검증 ─────────────────────────────────────────────
  const scoreResult = validateEmotionScores(emotionScores);
  if (!scoreResult.valid) {
    return res.status(400).json({ error: scoreResult.error });
  }

  const seed = typeof diversitySeed === 'number' ? diversitySeed
             : parseInt(diversitySeed, 10) || 0;

  const cleanReply  = sanitizeReply(reply);
  const outputSize  = Math.min(Math.max(parseInt(size, 10) || 1200, 400), 2400);

  // ── 2. SVG 색채 패치 ───────────────────────────────────────────
  let svgString;
  try {
    svgString = await patchSVG(scoreResult.cleaned, seed, cleanReply);
  } catch (err) {
    console.error('[card] SVG 패치 실패:', err.message);
    return res.status(500).json({ error: `SVG 처리 실패: ${err.message}` });
  }

  // ── 3. PNG 변환 및 저장 ────────────────────────────────────────
  let exportResult;
  try {
    exportResult = await svgToPng(svgString, outputSize);
  } catch (err) {
    console.error('[card] PNG 변환 실패:', err.message);
    return res.status(500).json({ error: `PNG 변환 실패: ${err.message}` });
  }

  // ── 4. 응답 ────────────────────────────────────────────────────
  console.log(`[card] 생성 완료: ${exportResult.fileName} (${outputSize}px)`);

  return res.json({
    downloadUrl: exportResult.downloadUrl,
    fileName:    exportResult.fileName,
    size:        outputSize,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
