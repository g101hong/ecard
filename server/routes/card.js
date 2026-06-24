/**
 * @fileoverview server/routes/card.js
 * @description  POST /api/card — E-Card PNG 생성 및 다운로드 URL 반환
 * @version 2.1.0  [v3.1] dominantEmotion 수신 및 generateCardPNG 전달
 *
 * ─────────────────────────────────────────────────────────────────
 * [v3.1 변경사항] 폰트 불일치 수정
 * ─────────────────────────────────────────────────────────────────
 *
 *   Body에 dominantEmotion 필드 추가 수신.
 *   유효성 검증 후 generateCardPNG에 전달.
 *   png-exporter.js가 이 값으로 폰트를 직접 결정 → 화면 폰트와 일치.
 *
 * ─────────────────────────────────────────────────────────────────
 * [방안D] 정적 경승지 이미지(ulsan_scene_XX.jpg) 기반
 * ─────────────────────────────────────────────────────────────────
 *
 *   Body: { emotionScores, spotIndex, reply?, size?, dominantEmotion? }
 *   → generateCardPNG({ spotIndex, emotionScores, dominantEmotion, ... })
 *   → assets/scenes/ulsan_scene_XX.jpg 읽기 → PNG 합성 → 저장
 */

'use strict';

import { Router }        from 'express';
import { v4 as uuidv4 } from 'uuid';
import path              from 'path';
import { generateCardPNG } from '../../svg-engine/index.js';

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const router     = Router();

// =============================================================================
// ① 검증 헬퍼
// =============================================================================

const EMOTION_KEYS = [
  'amazement','peace','vitality','nostalgia',
  'freshness','grandeur','warmth','mystery',
];

// [v3.1] 유효한 dominant 감성 키 목록
const VALID_DOMINANT_EMOTIONS = new Set(EMOTION_KEYS);

function validateEmotionScores(scores) {
  if (!scores || typeof scores !== 'object') {
    return { valid: false, error: 'emotionScores가 없습니다' };
  }
  const cleaned = {};
  for (const key of EMOTION_KEYS) {
    const v = Number(scores[key]);
    cleaned[key] = isNaN(v) ? 25 : Math.min(100, Math.max(0, Math.round(v)));
  }
  return { valid: true, cleaned };
}

function validateSpotIndex(spotIndex) {
  const v = Number(spotIndex);
  if (!Number.isInteger(v) || v < 0 || v > 11) {
    return { valid: false, error: `spotIndex가 유효하지 않습니다 (0~11 정수 필요): ${spotIndex}` };
  }
  return { valid: true, cleaned: v };
}

function sanitizeReply(reply) {
  if (!reply || typeof reply !== 'object') return null;
  return {
    main:    typeof reply.main    === 'string' ? reply.main.slice(0, 60)    : null,
    place:   typeof reply.place   === 'string' ? reply.place.slice(0, 120)  : null,
    tagline: typeof reply.tagline === 'string' ? reply.tagline.slice(0, 40) : null,
  };
}

// =============================================================================
// ② POST /api/card
// =============================================================================

router.post('/', async (req, res) => {
  // [v3.1] dominantEmotion 추가 수신
  const { emotionScores, spotIndex, reply, size, dominantEmotion } = req.body;

  // 1. 검증
  const scoreResult = validateEmotionScores(emotionScores);
  if (!scoreResult.valid) {
    return res.status(400).json({ error: scoreResult.error });
  }

  const spotResult = validateSpotIndex(spotIndex);
  if (!spotResult.valid) {
    return res.status(400).json({ error: spotResult.error });
  }

  const cleanReply = sanitizeReply(reply);
  const outputSize = Math.min(Math.max(parseInt(size, 10) || 1200, 400), 2400);

  // [v3.1] dominantEmotion 검증
  // 유효한 감성 키이면 사용, 아니면 null → png-exporter가 emotionScores로 폴백
  const safeDominant = typeof dominantEmotion === 'string' && VALID_DOMINANT_EMOTIONS.has(dominantEmotion)
    ? dominantEmotion
    : null;

  // 2. PNG 합성
  const fileName   = `${uuidv4()}.png`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  let savedPath;
  try {
    savedPath = await generateCardPNG({
      emotionScores:   scoreResult.cleaned,
      spotIndex:       spotResult.cleaned,
      outputPath,
      size:            outputSize,
      reply:           cleanReply,
      dominantEmotion: safeDominant,    // [v3.1] 추가 전달
    });
  } catch (err) {
    console.error('[card] PNG 생성 실패:', err.message);
    return res.status(500).json({ error: `PNG 생성 실패: ${err.message}` });
  }

  // 3. 응답
  console.log(
    `[card] 생성 완료: ${fileName}` +
    ` (${outputSize}px, spot:${spotResult.cleaned}, font:${safeDominant ?? 'auto'})`
  );
  return res.json({
    downloadUrl: `/output/${path.basename(savedPath)}`,
    fileName,
    size:        outputSize,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
