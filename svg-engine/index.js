/**
 * @fileoverview 울산 E-Card SVG 색채 조정 엔진 — 진입점
 * @module svg-engine
 * @version 3.0.0
 *
 * 현재 동작 방식 (정적 이미지 기반)
 * ─────────────────────────────────────────────────────────────────
 *
 *   generateCardPNG()가 spotIndex에 해당하는 정적 경승지 이미지
 *   (assets/scenes/ulsan_scene_XX.jpg)를 읽어 PNG 카드를 합성한다.
 *
 *   파이프라인:
 *     ulsan_scene_XX.jpg
 *           ↓
 *     composeCardPNG()   이미지 + 답글 카드 합성 (sharp + @napi-rs/canvas)
 *           ↓
 *     /output/{uuid}.png
 */

'use strict';

import {
  computeGlobalParams,
  applyDeltaToHex,
  colorTempToFilter,
  SVG_ID_MAP,
  SPOT_NAMES,
} from './color-calculator.js';
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
export { composeCardPNG };

// =============================================================================
// ③ generateCardPNG — 통합 진입점
// =============================================================================

/**
 * 정적 경승지 이미지 읽기 → PNG 카드 합성 → 파일 저장.
 *
 * @param {Object}      options
 * @param {Object}      options.emotionScores     8차원 감성 점수 (0~100)
 * @param {number}      options.spotIndex         경승지 인덱스 (0~11)
 * @param {string}      options.outputPath        저장 경로
 * @param {number}      [options.size=1200]       출력 이미지 너비(px)
 * @param {Object|null} [options.reply]           { main, place, tagline }
 * @param {string}      [options.dominantEmotion] 확정된 dominant 감성 키
 * @param {string|null} [options.createdAt]       KST 날짜·시분 "YYYY.MM.DD HH:mm"
 * @returns {Promise<string>}  저장된 PNG 파일 경로
 */
export async function generateCardPNG({
  emotionScores,
  spotIndex,
  outputPath,
  size            = 1200,
  reply           = null,
  dominantEmotion = null,
  createdAt       = null,
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

  const savedPath = await composeCardPNG(
    sceneImageBuf,
    outputPath,
    size,
    reply,
    emotionScores,
    dominantEmotion,
    createdAt,
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
  composeCardPNG,
  generateCardPNG,
  SVG_ID_MAP,
  SVG_ID_TO_EMOTION_IDX,
  SVG_PANEL_IDS,
  SPOT_NAMES,
};
