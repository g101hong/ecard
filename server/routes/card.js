/**
 * @fileoverview server/routes/card.js
 * @description  POST /api/card — E-Card PNG 생성 및 다운로드 URL 반환
 * @version 2.2.0  [v3.2] dominantEmotion 결정 로직 강화
 *
 * ─────────────────────────────────────────────────────────────────
 * [v3.2 변경사항] dominantEmotion null 폴백 문제 수정
 * ─────────────────────────────────────────────────────────────────
 *
 *   문제:
 *     - dominantEmotion이 클라이언트로부터 전달되지 않거나 null인 경우
 *       png-exporter가 Math.round() 정수화된 emotionScores로 재계산
 *       → 원점수와 순위 역전 발생 → 폰트 불일치
 *
 *   해결:
 *     - dominantEmotion이 유효한 값이면 그대로 사용
 *     - null이거나 유효하지 않으면 card.js가 원본 emotionScores(정수화 전)로
 *       직접 결정 → png-exporter에 확정된 값 전달
 *     - png-exporter는 dominantEmotion을 항상 직접 사용 (폴백 없음)
 *
 * ─────────────────────────────────────────────────────────────────
 * [v3.1 변경사항] dominantEmotion 수신 및 generateCardPNG 전달
 * [방안D] 정적 경승지 이미지(ulsan_scene_XX.jpg) 기반
 * ─────────────────────────────────────────────────────────────────
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
 * [v3.2] emotionScores(정수화 전 원본)에서 dominant 감성을 결정한다.
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

  // 3. [v3.2] dominantEmotion 확정
  //    우선순위: ① 클라이언트 전달값(유효한 경우) → ② 원본 emotionScores로 자체 계산
  //    png-exporter에는 항상 확정된 값을 전달 (null 전달 금지)
  const finalDominant =
    (typeof dominantEmotion === 'string' && VALID_DOMINANT_EMOTIONS.has(dominantEmotion))
      ? dominantEmotion
      : computeDominantEmotion(rawScores);   // ← [v3.2] 원본 점수로 자체 계산

  // 4. PNG 합성
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
      dominantEmotion: finalDominant,   // ← 항상 확정된 값 (null 없음)
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
