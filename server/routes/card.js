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
 *       └─ svg-engine.generateCardPNG({ emotionScores, diversitySeed, outputPath, size, reply })
 *            ├─ patchSVG(emotionScores, diversitySeed)
 *            │    → jsdom으로 'spot-XX-N' 요소의 현재 색에 delta 적용 (케이스 B)
 *            ├─ svgToPng(patchedSvg, outputPath, size, reply)
 *            │    → sharp로 PNG 변환 + (reply 있으면) 답글 텍스트 합성 + output/ 저장
 *            └─ { downloadUrl: '/output/{uuid}.png' } 반환
 *
 * ─────────────────────────────────────────────────────────────────
 * 처리시간: 약 0.3 ~ 0.8초
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

import { Router }   from 'express';
import { v4 as uuidv4 } from 'uuid';
import path         from 'path';
import { generateCardPNG } from '../../svg-engine/index.js';

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

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
  const { emotionScores, reply, size } = req.body;

  // ── 1. 입력값 검증 ─────────────────────────────────────────────
  const scoreResult = validateEmotionScores(emotionScores);
  if (!scoreResult.valid) {
    return res.status(400).json({ error: scoreResult.error });
  }

  const cleanReply  = sanitizeReply(reply);
  const outputSize  = Math.min(Math.max(parseInt(size, 10) || 1200, 400), 2400);

  // ── 2. 원본 SVG → PNG 변환/저장 ──────────────────────────────────
  const fileName   = `${uuidv4()}.png`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  let savedPath;
  try {
    savedPath = await generateCardPNG({
      emotionScores: scoreResult.cleaned,
      outputPath,
      size: outputSize,
      reply: cleanReply,
    });
  } catch (err) {
    console.error('[card] PNG 생성 실패:', err.message);
    return res.status(500).json({ error: `PNG 생성 실패: ${err.message}` });
  }

  // ── 3. 응답 ────────────────────────────────────────────────────
  console.log(`[card] 생성 완료: ${fileName} (${outputSize}px)`);

  return res.json({
    downloadUrl: `/output/${path.basename(savedPath)}`,
    fileName,
    size:        outputSize,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
