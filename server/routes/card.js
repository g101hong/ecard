/**
 * @fileoverview server/routes/card.js
 * @description  POST /api/card — E-Card PNG 생성 및 다운로드 URL 반환
 *
 * ─────────────────────────────────────────────────────────────────
 * 처리 흐름
 * ─────────────────────────────────────────────────────────────────
 *
 *   1. emotionScores, spotIndex, reply, size, dominantEmotion 수신
 *   2. emotionScores 원본 보존 (정수화 전 — dominant 결정에 사용)
 *   3. dominantEmotion 확정
 *      ① 클라이언트 전달값이 유효하면 그대로 사용
 *      ② null이거나 유효하지 않으면 원본 emotionScores로 자체 계산
 *         → 정수화 후 재계산 시 발생하던 순위 역전·폰트 불일치 방지
 *   4. generateCardPNG() 호출 → /output/{uuid}.png 저장
 *   5. downloadUrl 반환
 */

'use strict';

import { Router }        from 'express';
import { v4 as uuidv4 } from 'uuid';
import path              from 'path';
import { generateCardPNG } from '../../svg-engine/index.js';

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';
const router     = Router();

// =============================================================================
// ① 상수
// =============================================================================

const EMOTION_KEYS = [
  'amazement','peace','vitality','nostalgia',
  'freshness','grandeur','warmth','mystery',
];

const VALID_DOMINANT_EMOTIONS = new Set(EMOTION_KEYS);

// emotion-fonts.js의 EMOTION_PRIORITY와 동일 순서 (동점 처리 일치)
const EMOTION_PRIORITY = [
  'amazement', 'mystery', 'grandeur', 'nostalgia',
  'warmth',    'vitality', 'freshness', 'peace',
];

// =============================================================================
// ② 검증 헬퍼
// =============================================================================

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

/**
 * emotionScores(정수화 전 원본)에서 dominant 감성을 결정한다.
 * impression.js의 pickDominantEmotion()과 동일 로직.
 * dominantEmotion이 클라이언트로부터 전달되지 않을 때의 폴백용.
 *
 * @param {Object} rawScores  정수화 전 원본 emotionScores
 * @returns {string}
 */
function computeDominantEmotion(rawScores) {
  if (!rawScores || typeof rawScores !== 'object') return 'amazement';
  let maxVal = -1;
  for (const k of EMOTION_PRIORITY) {
    const v = Number(rawScores[k]) || 0;
    if (v > maxVal) maxVal = v;
  }
  return EMOTION_PRIORITY.find((k) => (Number(rawScores[k]) || 0) === maxVal) ?? 'amazement';
}

// =============================================================================
// ③ POST /api/card
// =============================================================================

router.post('/', async (req, res) => {
  const { emotionScores, spotIndex, reply, size, dominantEmotion } = req.body;

  // 1. emotionScores 원본 보존 (정수화 전)
  // dominant 결정은 원본 점수로 해야 순위 역전이 없음
  const rawScores = emotionScores;

  // 2. 검증
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

  // 3. dominantEmotion 확정
  //    우선순위: ① 클라이언트 전달값(유효한 경우) → ② 원본 emotionScores로 자체 계산
  //    png-exporter에는 항상 확정된 값을 전달 (null 전달 금지)
  const finalDominant =
    (typeof dominantEmotion === 'string' && VALID_DOMINANT_EMOTIONS.has(dominantEmotion))
      ? dominantEmotion
      : computeDominantEmotion(rawScores);

  // 4. PNG 합성
  const fileName   = `${uuidv4()}.png`;
  const outputPath = path.join(OUTPUT_DIR, fileName);

  // 저장 시각 — 한국 시간(KST, UTC+9) 기준 "YYYY.MM.DD HH:mm"
  const _now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const createdAt = _now.toISOString().slice(0, 16).replace('T', ' ').replace('-', '.').replace('-', '.');

  let savedPath;
  try {
    savedPath = await generateCardPNG({
      emotionScores:   scoreResult.cleaned,
      spotIndex:       spotResult.cleaned,
      outputPath,
      size:            outputSize,
      reply:           cleanReply,
      dominantEmotion: finalDominant,
      createdAt,                         // ← KST 날짜·시분
    });
  } catch (err) {
    console.error('[card] PNG 생성 실패:', err.message);
    return res.status(500).json({ error: `PNG 생성 실패: ${err.message}` });
  }

  // 5. 응답
  console.log(
    `[card] 생성 완료: ${fileName}` +
    ` (${outputSize}px, spot:${spotResult.cleaned}, font:${finalDominant}` +
    ` [${dominantEmotion ? '클라이언트' : '자체계산'}])`
  );
  return res.json({
    downloadUrl: `/output/${path.basename(savedPath)}`,
    fileName,
    size:        outputSize,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
