/**
 * @fileoverview 울산 E-Card SVG 색채 조정 엔진 — 진입점
 * @module svg-engine
 * @version 2.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * v2 변경 사항
 * ─────────────────────────────────────────────────────────────────
 *
 *   v1: color-calculator.calculateAllPanelColors()가 12패널의
 *       main/sub/acc 3색을 미리 계산해 PanelColorMap으로 반환 →
 *       클라이언트가 grad-spot-XX-{main,sub,acc} 3개 stop에 그대로 적용
 *
 *   v2: 색상 계산은 "SVG에 기록된 현재 색상"을 출발점으로 하므로
 *       서버가 미리 패널 색상을 계산해 보낼 필요가 없다.
 *       서버 응답에는 emotionScores + diversitySeed만 포함하면 되고,
 *       클라이언트(svg-renderer.applyDeltaColorsToSVG)가 직접
 *       SVG의 'spot-XX-N' 요소에서 현재 색을 읽어 동일한 수식
 *       (color-engine.js)으로 계산·적용한다.
 *
 *       따라서 이 모듈의 퍼블릭 API는 PNG 생성(생성형 카드 다운로드)
 *       경로(generateCardPNG)만 남는다. applySvgColors /
 *       buildPanelColorMap / gradientStopId / validatePanelColors 등
 *       main/sub/acc 기반 API는 v2에서 제거되었다.
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  emotionScores + diversitySeed                      │
 *   │         │                                           │
 *   │         ├─── [클라이언트] 그대로 응답에 포함         │
 *   │         │     public/js/svg-renderer.js 가          │
 *   │         │     color-engine.js로 SVG 현재 색에서      │
 *   │         │     직접 계산·적용                         │
 *   │         │                                           │
 *   │         └─── [서버] generateCardPNG()                │
 *   │               → svg-patcher.js (jsdom, 'spot-XX-N') │
 *   │               → png-exporter.js로 PNG 변환           │
 *   └─────────────────────────────────────────────────────┘
 *
 * ─────────────────────────────────────────────────────────────────
 * 경승지 SVG ID 체계 (경승지별_ID_및_채색방법.txt 기준)
 * ─────────────────────────────────────────────────────────────────
 *
 *   순번  경승지명                  SVG ID 접두어   emotion-engine 인덱스
 *   ────────────────────────────────────────────────────────────────
 *    1    태화강 국가정원·십리대숲   spot-00         idx 9
 *    2    대왕암공원                spot-01         idx 1
 *    3    가지산 사계               spot-02         idx 11
 *    4    신불산 억새평원           spot-03         idx 10
 *    5    간절곶 일출               spot-04         idx 0
 *    6    반구대 암각화             spot-05         idx 5
 *    7    강동 몽돌해변             spot-06         idx 2
 *    8    울산대공원                spot-07         idx 8
 *    9    울산대교                  spot-08         idx 7
 *   10    장생포 고래문화마을       spot-09         idx 3
 *   11    외고산 옹기마을           spot-10         idx 4
 *   12    대운산 내원암 계곡        spot-11         idx 6
 *
 *   색상 조정 대상 ID 형식: 'spot-{XX}-{N}' (N: 1,2,3... 가변, 역할 구분 없음)
 *     - <stop> 요소이면 stop-color, 그 외 도형(path/circle 등)이면 fill
 *
 * ─────────────────────────────────────────────────────────────────
 * 서버 배포 파일구조(v3) 내 위치
 * ─────────────────────────────────────────────────────────────────
 *
 *   svg-engine/
 *     index.js             ← 이 파일 (진입점 · 퍼블릭 API)
 *     color-calculator.js  ← 감성파라미터 → delta 계산 (computeGlobalParams, applyDeltaToHex)
 *     svg-patcher.js       ← 서버사이드 SVG DOM 조작 (PNG 저장용, spot-XX-N 자동 탐색)
 *     png-exporter.js      ← SVG → PNG 변환 (sharp)
 *
 * ─────────────────────────────────────────────────────────────────
 * 사용 예시
 * ─────────────────────────────────────────────────────────────────
 *
 *   // ① /api/impression 응답 — emotionScores + diversitySeed만 포함
 *   res.json({
 *     spotIndex, emotionScores, primaryEmotion, keywords,
 *     diversitySeed,
 *     colorTempFilter: colorTempToFilter(
 *       computeGlobalParams(emotionScores).colorTemp,
 *     ),
 *     reply: { main, place, tagline },
 *   });
 *   // → public/js/svg-renderer.applyDeltaColorsToSVG(emotionScores, diversitySeed)
 *
 *   // ② 서버사이드 PNG 생성 (card 라우트)
 *   import { generateCardPNG } from './svg-engine/index.js';
 *   import { v4 as uuidv4 }   from 'uuid';
 *   import path               from 'path';
 *
 *   const pngPath = await generateCardPNG({
 *     emotionScores,
 *     diversitySeed,
 *     outputPath: path.join('./output', `${uuidv4()}.png`),
 *     size: 1200,
 *     reply: { main, place, tagline },
 *   });
 *   res.json({ downloadUrl: `/output/${path.basename(pngPath)}` });
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
import { svgToPng } from './png-exporter.js';

// =============================================================================
// ① SVG ID ↔ emotion-engine 인덱스 매핑 상수 (재노출)
// =============================================================================

/**
 * emotion-engine SPOTS 인덱스(0~11) → SVG ID 접두어 매핑.
 * color-calculator.js의 SVG_ID_MAP을 그대로 재노출한다.
 *
 * @type {readonly string[]}
 */
export { SVG_ID_MAP, SPOT_NAMES };

/**
 * SVG ID 접두어('spot-XX') → emotion-engine 인덱스 역방향 매핑.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const SVG_ID_TO_EMOTION_IDX = Object.freeze(
  Object.fromEntries(SVG_ID_MAP.map((svgId, idx) => [svgId, idx])),
);

/**
 * 12개 SVG 패널 ID 목록 (spot-00 ~ spot-11, 번호순 — emotion 인덱스 순서가 아님).
 *
 * @type {readonly string[]}
 */
export const SVG_PANEL_IDS = Object.freeze(
  Array.from({ length: 12 }, (_, i) => `spot-${String(i).padStart(2, '0')}`),
);

// =============================================================================
// ② 글로벌 색채 파라미터 / delta 계산 (재노출)
// =============================================================================

/**
 * 감성 점수로부터 6개 글로벌 색채 파라미터(ΔHue·ΔSat·ΔLight·ΔContrast·
 * colorTemp·lightDir·rgbTint)를 계산한다.
 *
 * /api/impression 라우트가 colorTempToFilter()에 전달할 colorTemp를
 * 얻기 위해 호출한다. 패널별 색상 자체는 클라이언트가
 * applyDeltaToHex()로 직접 계산하므로 서버가 미리 계산할 필요는 없다.
 */
export { computeGlobalParams, applyDeltaToHex };

/**
 * 색온도 오프셋을 CSS filter 문자열로 변환한다.
 * public/js/svg-renderer.js 가 #svg-container 전체에 적용한다.
 *
 * @param {number} colorTemp  색온도 오프셋 (-1500 ~ +1500K)
 * @returns {string}  CSS filter 값 (예: 'sepia(0.27) saturate(1.16)')
 *                    중립(0K)이면 빈 문자열 반환
 */
export { colorTempToFilter };

// =============================================================================
// ③ 퍼블릭 API — 서버사이드 SVG 패치 (PNG 저장용)
// =============================================================================

/**
 * 감성 점수를 기반으로 SVG를 패치하여 문자열로 반환한다.
 *
 * jsdom으로 'spot-{XX}-{N}' id를 가진 모든 요소를 자동 탐색하고,
 * 각 요소의 현재 stop-color/fill을 읽어 applyDeltaToHex()로 계산한
 * 새 색상으로 재적용한다. 매번 원본 SVG를 기준으로 읽으므로
 * (케이스 B) 결과는 결정론적이며 누적 변경이 없다.
 *
 * 클라이언트(svg-renderer.applyDeltaColorsToSVG)와 동일한 id 체계·
 * 동일 수식(color-calculator.js / color-engine.js)을 사용하므로
 * 결과가 100% 일치한다.
 *
 * @param {Object} emotionScores
 * @param {number} diversitySeed
 * @returns {Promise<string>}  패치된 SVG 문자열
 *
 * @example
 * const svg = await patchSVG(emotionScores, diversitySeed);
 */
export { patchSVG };

/**
 * 원본 SVG에 'spot-XX-N' 색상 요소가 패널별로 몇 개씩 있는지 점검한다.
 * 배포 전 SVG 자산 검증용 (디자이너의 id 보완 작업 진행 상황 확인).
 *
 * @returns {Promise<{
 *   valid: boolean, total: number,
 *   panels: Array<{svgId:string, name:string, count:number, ids:string[]}>,
 *   emptyPanels: string[],
 * }>}
 */
export { validateSvgAssets, debugPrintPatch, clearSvgCache };

/**
 * 패치된 SVG 문자열을 PNG 파일로 변환하여 저장한다.
 *
 * @param {string} svgString    패치된 SVG 문자열
 * @param {string} outputPath   저장할 PNG 파일 경로
 * @param {number} [size=1200]  출력 이미지 너비(px) — 높이는 원본 비율 유지
 * @param {{ main?:string, place?:string, tagline?:string }|null} [reply]
 *   Phase 2 타이포그래피 합성용 (현재는 전달만 하고 png-exporter가 처리)
 * @returns {Promise<string>}  저장된 파일 경로
 */
export { svgToPng };

// =============================================================================
// ④ 통합 함수 — PNG E-Card 한 번에 생성
// =============================================================================

/**
 * @typedef {Object} GenerateCardOptions
 * @property {Object} emotionScores
 *   8차원 감성 점수 (각 0~100)
 * @property {number} diversitySeed
 *   preprocessor.js 의 다양성 시드
 * @property {string} outputPath
 *   저장할 PNG 경로 (예: './output/f47ac10b.png')
 * @property {number} [size=1200]
 *   출력 이미지 너비(px)
 * @property {{ main:string, place:string, tagline:string }|null} [reply]
 *   타이포그래피 합성용 답글 데이터
 */

/**
 * SVG 패치 → PNG 변환 → 파일 저장 파이프라인을 단일 호출로 실행한다.
 *
 * server/routes/card.js 에서 사용하는 메인 함수:
 *
 *   const pngPath = await generateCardPNG({
 *     emotionScores:  req.validated.emotionScores,
 *     diversitySeed:  req.validated.diversitySeed,
 *     outputPath:     path.join(OUTPUT_DIR, `${uuidv4()}.png`),
 *     size:           req.validated.size,
 *     reply:          req.validated.reply,
 *   });
 *   res.json({ downloadUrl: `/output/${path.basename(pngPath)}` });
 *
 * @param {GenerateCardOptions} options
 * @returns {Promise<string>}  저장된 PNG 파일 경로
 *
 * @throws {Error}  assets/stained-glass.svg 읽기 실패, PNG 변환 실패
 */
export async function generateCardPNG({
  emotionScores,
  diversitySeed,
  outputPath,
  size = 1200,
  reply = null,
}) {
  const t0 = Date.now();

  // STEP 1: 감성 점수 → SVG DOM 패치 (jsdom, spot-XX-N 자동 탐색)
  const patchedSvg = await patchSVG(emotionScores, diversitySeed);

  // STEP 2: 패치된 SVG → PNG 파일 저장 (sharp)
  const savedPath = await svgToPng(patchedSvg, outputPath, size, reply);

  console.info(
    `[svg-engine] PNG 생성 완료 | ` +
    `path=${savedPath} | size=${size}px | ${Date.now() - t0}ms`,
  );

  return savedPath;
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  // 색채 계산
  computeGlobalParams,
  applyDeltaToHex,
  colorTempToFilter,

  // 서버사이드 PNG 생성
  patchSVG,
  svgToPng,
  generateCardPNG,

  // 자산 검증
  validateSvgAssets,
  debugPrintPatch,
  clearSvgCache,

  // ID 매핑 상수
  SVG_ID_MAP,
  SVG_ID_TO_EMOTION_IDX,
  SVG_PANEL_IDS,
  SPOT_NAMES,
};
