/**
 * @fileoverview 울산 E-Card SVG 색채 조정 엔진 — 진입점
 * @module svg-engine
 * @version 3.0.0
 *
 * [v3.0 변경] dominantEmotion 전달 — 폰트 불일치 최종 수정
 * ─────────────────────────────────────────────────────────────────
 *
 *   generateCardPNG()가 dominantEmotion 파라미터를 받아
 *   composeCardPNG()에 전달한다.
 *
 *   이전까지 svg-engine/index.js가 dominantEmotion을 누락하고
 *   composeCardPNG(imageBuffer, outputPath, size, reply, emotionScores)
 *   5개 인자만 전달하여 폰트가 항상 FALLBACK_FONT(warmth)로 떨어지던
 *   문제를 수정한다.
 */

'use strict';

import {
  computeGlobalParams,
  applyDeltaToHex,
  colorTempToFilter,
  SVG_ID_MAP,
  SPOT_NAMES,
} from './color-calculator.js';
import { patchSVG, validateSvgAssets, debugPrintPatch, clearSvgCache } from './svg-patcher.js';
import { composeCardPNG } from './png-exporter.js';

// =============================================================================
// ① SVG ID ↔ emotion-engine 인덱스 매핑 상수 (재노출)
// =============================================================================

export { SVG_ID_MAP, SPOT_NAMES };

export const SVG_ID_TO_EMOTION_IDX = Object.freeze(
  Object.fromEntries(SVG_ID_MAP.map((svgId, idx) => [svgId, idx])),
);

export const SVG_PANEL_IDS = Object.freeze(
  Array.from({ length: 12 }, (_, i) => `spot-${String(i).padStart(2, '0')}`),
);

// =============================================================================
// ② 퍼블릭 API 재노출
// =============================================================================

export { computeGlobalParams, applyDeltaToHex, colorTempToFilter };
export { patchSVG, validateSvgAssets, debugPrintPatch, clearSvgCache };
export { composeCardPNG };

// =============================================================================
// ③ generateCardPNG — 통합 진입점
// =============================================================================

/**
 * 정적 경승지 이미지 읽기 → PNG 변환 → 답글 카드 합성 → 파일 저장.
 *
 * [v3.0] dominantEmotion 파라미터 추가 및 composeCardPNG에 전달.
 *        이전 버전에서 이 함수가 dominantEmotion을 누락하여
 *        항상 FALLBACK_FONT(warmth)로 렌더되던 문제 수정.
 *
 * @param {Object}      options
 * @param {Object}      options.emotionScores
 * @param {number}      options.spotIndex         0~11
 * @param {string}      options.outputPath
 * @param {number}      [options.size=1200]
 * @param {Object|null} [options.reply]
 * @param {string}      options.dominantEmotion   확정된 dominant 감성 키 (필수)
 * @returns {Promise<string>}
 */
export async function generateCardPNG({
  emotionScores,
  spotIndex,
  outputPath,
  size            = 1200,
  reply           = null,
  dominantEmotion = null,          // [v3.0] 필수 — card.js가 항상 확정값 전달
}) {
  const t0 = Date.now();

  if (typeof spotIndex !== 'number' || spotIndex < 0 || spotIndex > 11) {
    throw new Error(`spotIndex가 유효하지 않습니다 (0~11 필요): ${spotIndex}`);
  }

  const { readFile } = await import('fs/promises');
  const idx          = String(spotIndex).padStart(2, '0');
  const imagePath    = new URL(`../assets/scenes/ulsan_scene_${idx}.jpg`, import.meta.url);

  let sceneImageBuf;
  try {
    sceneImageBuf = await readFile(imagePath);
  } catch (err) {
    throw new Error(`경승지 이미지 로드 실패 (ulsan_scene_${idx}.jpg): ${err.message}`);
  }

  // [v3.0] dominantEmotion 전달 — 6번째 인자 추가
  const savedPath = await composeCardPNG(
    sceneImageBuf,
    outputPath,
    size,
    reply,
    emotionScores,
    dominantEmotion,   // ← 이전 버전에서 이 인자가 빠져 있었음
  );

  console.info(
    `[svg-engine] PNG 생성 완료 | ` +
    `path=${savedPath} | spotIndex=${spotIndex} | size=${size}px | ` +
    `font:${dominantEmotion} | ${Date.now() - t0}ms`,
  );

  return savedPath;
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  computeGlobalParams,
  applyDeltaToHex,
  colorTempToFilter,
  patchSVG,
  composeCardPNG,
  generateCardPNG,
  validateSvgAssets,
  debugPrintPatch,
  clearSvgCache,
  SVG_ID_MAP,
  SVG_ID_TO_EMOTION_IDX,
  SVG_PANEL_IDS,
  SPOT_NAMES,
};
