/**
 * @fileoverview 울산 E-Card SVG 색채 조정 엔진 — 진입점
 * @module svg-engine
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   emotion-engine의 감성 점수(emotionScores)와 다양성 시드를 받아
 *   울산 12경 SVG의 각 패널에 개별화된 색채값을 적용한다.
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  emotionScores + diversitySeed                      │
 *   │         │                                           │
 *   │         ▼                                           │
 *   │  color-calculator.js                                │
 *   │   → 12패널 각각의 hex 색상 계산                      │
 *   │         │                                           │
 *   │         ├─── [클라이언트] panelColors JSON 반환      │
 *   │         │     public/js/svg-renderer.js 가 적용      │
 *   │         │                                           │
 *   │         └─── [서버] svg-patcher.js                  │
 *   │               → jsdom으로 SVG stop-color 변경        │
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
 *   SVG 그라디언트 stop 요소 ID 형식:
 *     grad-spot-04-main  (간절곶 일출 주색)
 *     grad-spot-04-sub   (간절곶 일출 보조색)
 *     grad-spot-04-acc   (간절곶 일출 강조색)
 *
 *   fill 변경 대상: id가 "spot-XX"로 시작하는 모든 <path> 요소
 *
 * ─────────────────────────────────────────────────────────────────
 * 서버 배포 파일구조(v3) 내 위치
 * ─────────────────────────────────────────────────────────────────
 *
 *   svg-engine/
 *     index.js             ← 이 파일 (진입점 · 퍼블릭 API)
 *     color-calculator.js  ← 감성파라미터 → 12패널 hex 색상 계산
 *     svg-patcher.js       ← 서버사이드 SVG DOM 조작 (PNG 저장용)
 *     png-exporter.js      ← SVG → PNG 변환 (sharp)
 *
 * ─────────────────────────────────────────────────────────────────
 * 사용 예시
 * ─────────────────────────────────────────────────────────────────
 *
 *   // ① 클라이언트 전달용 색상 계산 (impression 라우트)
 *   import { applySvgColors } from './svg-engine/index.js';
 *
 *   const panelColors = applySvgColors(emotionScores, diversitySeed);
 *   // → {
 *   //     'spot-00': { main:'#3D8B5E', sub:'#6BBFD4', acc:'#DFFFEF', svgId:'spot-00' },
 *   //     'spot-04': { main:'#FF6635', sub:'#FFB347', acc:'#FFCF9E', svgId:'spot-04' },
 *   //     ...
 *   //   }
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

import { calculateAllPanelColors, colorTempToFilter } from './color-calculator.js';
import { patchSVG }  from './svg-patcher.js';
import { svgToPng }  from './png-exporter.js';

// =============================================================================
// ① SVG ID ↔ emotion-engine 인덱스 매핑 상수
// =============================================================================

/**
 * emotion-engine SPOTS 인덱스(0~11) → SVG ID 접두어 매핑.
 *
 * emotion-engine/constants/spot-palettes.js 의 SPOTS 배열 순서와
 * SVG ID 체계(경승지별_ID_및_채색방법.txt)는 서로 다르다.
 * color-calculator.js 가 반환하는 배열은 emotion-engine 인덱스 기준이며
 * 이 매핑을 통해 SVG ID 키 맵으로 변환된다.
 *
 * @type {Readonly<Record<number, string>>}
 */
export const EMOTION_IDX_TO_SVG_ID = Object.freeze({
  0:  'spot-04',  // 간절곶 일출
  1:  'spot-01',  // 대왕암공원
  2:  'spot-06',  // 강동 몽돌해변
  3:  'spot-09',  // 장생포 고래문화마을
  4:  'spot-10',  // 외고산 옹기마을
  5:  'spot-05',  // 반구대 암각화
  6:  'spot-11',  // 대운산 내원암 계곡
  7:  'spot-08',  // 울산대교
  8:  'spot-07',  // 울산대공원
  9:  'spot-00',  // 태화강 국가정원·십리대숲
  10: 'spot-03',  // 신불산 억새평원
  11: 'spot-02',  // 가지산 사계
});

/**
 * SVG ID 접두어('spot-XX') → emotion-engine 인덱스 역방향 매핑.
 * svg-patcher.js 에서 12개 패널을 순회할 때 사용한다.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const SVG_ID_TO_EMOTION_IDX = Object.freeze(
  Object.fromEntries(
    Object.entries(EMOTION_IDX_TO_SVG_ID).map(([eIdx, svgId]) => [
      svgId,
      Number(eIdx),
    ]),
  ),
);

/**
 * 12개 SVG 패널 ID 목록 (spot-00 ~ spot-11, 순서 고정).
 * svg-patcher.js / svg-renderer.js 가 순회 기준으로 사용.
 *
 * @type {readonly string[]}
 */
export const SVG_PANEL_IDS = Object.freeze(
  Array.from({ length: 12 }, (_, i) => `spot-${String(i).padStart(2, '0')}`),
);

/**
 * SVG 그라디언트 stop 요소의 ID를 반환한다.
 *
 * @param {string}              svgId  'spot-XX' 형식
 * @param {'main'|'sub'|'acc'}  role   색상 역할
 * @returns {string}  예) 'grad-spot-04-main'
 *
 * @example
 * gradientStopId('spot-04', 'main')  // → 'grad-spot-04-main'
 * gradientStopId('spot-00', 'acc')   // → 'grad-spot-00-acc'
 */
export function gradientStopId(svgId, role) {
  return `grad-${svgId}-${role}`;
}

// =============================================================================
// ② PanelColorMap 빌더 — emotion-engine 배열 → SVG ID 키 맵
// =============================================================================

/**
 * @typedef {Object} PanelColorEntry
 * @property {string} main   주색 hex     (예: '#FF6635')
 * @property {string} sub    보조색 hex   (예: '#FFB347')
 * @property {string} acc    강조색 hex   (예: '#FFCF9E')
 * @property {string} svgId  SVG ID 접두어 (예: 'spot-04')
 */

/**
 * @typedef {Record<string, PanelColorEntry>} PanelColorMap
 *   키: SVG ID 접두어 ('spot-00' ~ 'spot-11')
 *   값: 해당 패널의 3색 + svgId
 */

/**
 * color-calculator.js 가 반환하는 emotion-engine 인덱스 기반 배열을
 * SVG ID 키 맵(PanelColorMap)으로 변환한다.
 *
 * color-calculator 반환 형식 (배열):
 *   [
 *     { index:0, main:'#FF6635', sub:'#FFB347', acc:'#FFCF9E' },  // 간절곶
 *     { index:1, main:'#2A6640', ... },                           // 대왕암
 *     ...
 *   ]
 *
 * 변환 후 PanelColorMap:
 *   {
 *     'spot-04': { main:'#FF6635', sub:'#FFB347', acc:'#FFCF9E', svgId:'spot-04' },
 *     'spot-01': { main:'#2A6640', ... },
 *     ...
 *   }
 *
 * @param {Array<{index:number, main:string, sub:string, acc:string}>} panelArray
 * @returns {PanelColorMap}
 */
export function buildPanelColorMap(panelArray) {
  const map = {};
  for (const entry of panelArray) {
    const svgId = EMOTION_IDX_TO_SVG_ID[entry.index];
    if (!svgId) continue;
    map[svgId] = {
      main:  entry.main,
      sub:   entry.sub,
      acc:   entry.acc,
      svgId,
    };
  }
  return map;
}

// =============================================================================
// ③ 퍼블릭 API — 클라이언트 전달용 색상 계산
// =============================================================================

/**
 * 감성 점수와 다양성 시드를 받아 12패널의 색상(PanelColorMap)을 계산한다.
 *
 * 내부적으로 color-calculator.js 를 호출하고
 * buildPanelColorMap 으로 SVG ID 키 맵으로 변환하여 반환한다.
 *
 * server/routes/impression.js 응답 흐름:
 *   applySvgColors(emotionScores, diversitySeed)
 *   → res.json({ panelColors, reply, ... })
 *   → public/js/app.js → svg-renderer.applyColorsToSVG(panelColors)
 *   → SVG <stop> stop-color 직접 변경 → CSS transition으로 색채 전환
 *
 * @param {Object} emotionScores
 *   { amazement:0~100, peace:0~100, vitality:0~100, nostalgia:0~100,
 *     freshness:0~100, grandeur:0~100, warmth:0~100, mystery:0~100 }
 * @param {number} diversitySeed  preprocessor.js 의 다양성 시드
 * @returns {PanelColorMap}
 *
 * @example
 * const panelColors = applySvgColors(
 *   { amazement:80, peace:30, vitality:70, nostalgia:20,
 *     freshness:60, grandeur:75, warmth:85, mystery:25 },
 *   142857,
 * );
 * panelColors['spot-04']
 * // → { main:'#FF7A4F', sub:'#FFBE6A', acc:'#FFD9B0', svgId:'spot-04' }
 */
export function applySvgColors(emotionScores, diversitySeed) {
  const panelArray = calculateAllPanelColors(emotionScores, diversitySeed);
  return buildPanelColorMap(panelArray);
}

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
// ④ 퍼블릭 API — 서버사이드 SVG 패치 (PNG 저장용)
// =============================================================================

/**
 * 감성 점수를 기반으로 SVG를 패치하여 문자열로 반환한다.
 * jsdom 으로 <stop> 요소의 stop-color 속성을 직접 변경하므로
 * 클라이언트와 동일한 id 체계를 사용하여 결과가 100% 일치한다.
 *
 * @param {Object} emotionScores
 * @param {number} diversitySeed
 * @returns {Promise<string>}  패치된 SVG 문자열
 *
 * @example
 * const svg = await patchSVG(emotionScores, diversitySeed);
 * // → '<?xml version="1.0"?><svg ...>...<stop id="grad-spot-04-main"
 * //      stop-color="#FF7A4F"/>...</svg>'
 */
export { patchSVG };

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
// ⑤ 통합 함수 — PNG E-Card 한 번에 생성
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

  // STEP 1: 감성 점수 → SVG DOM 패치 (jsdom)
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
// ⑥ 유효성 검사 유틸리티
// =============================================================================

/**
 * PanelColorMap의 완전성과 형식을 검사한다.
 * server/routes/impression.js 에서 응답 직전에 호출하여
 * 누락·잘못된 색상값을 로그로 남길 수 있다.
 *
 * @param {PanelColorMap} panelColors
 * @returns {{ valid: boolean, issues: string[] }}
 *
 * @example
 * const { valid, issues } = validatePanelColors(panelColors);
 * if (!valid) console.warn('[svg-engine] 색상 검증 실패:', issues);
 */
export function validatePanelColors(panelColors) {
  const issues = [];

  if (!panelColors || typeof panelColors !== 'object') {
    return { valid: false, issues: ['panelColors 가 null 또는 비객체'] };
  }

  for (const svgId of SVG_PANEL_IDS) {
    const entry = panelColors[svgId];

    if (!entry) {
      issues.push(`누락된 패널: ${svgId}`);
      continue;
    }

    for (const role of ['main', 'sub', 'acc']) {
      const val = entry[role];
      if (typeof val !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(val)) {
        issues.push(
          `${svgId}.${role} 가 유효한 6자리 hex 색상이 아님: "${val}"`,
        );
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

// =============================================================================
// ⑦ 디버그 유틸리티
// =============================================================================

/**
 * PanelColorMap을 콘솔에 테이블 형식으로 출력한다. (개발 전용)
 *
 * @param {PanelColorMap} panelColors
 * @param {number} [highlightEmotionIdx=-1]  ★ 표시할 emotion-engine 인덱스
 *
 * @example
 * debugPrintPanelColors(panelColors, 0);  // 간절곶(spot-04) 행에 ★
 */
export function debugPrintPanelColors(panelColors, highlightEmotionIdx = -1) {
  /* eslint-disable no-console */
  const highlightSvgId = EMOTION_IDX_TO_SVG_ID[highlightEmotionIdx] ?? null;

  const SPOT_NAMES = {
    'spot-00': '태화강·십리대숲',
    'spot-01': '대왕암공원',
    'spot-02': '가지산 사계',
    'spot-03': '신불산 억새',
    'spot-04': '간절곶 일출',
    'spot-05': '반구대 암각화',
    'spot-06': '강동 몽돌해변',
    'spot-07': '울산대공원',
    'spot-08': '울산대교',
    'spot-09': '장생포 고래',
    'spot-10': '외고산 옹기',
    'spot-11': '대운산 계곡',
  };

  console.group('🎨 svg-engine — PanelColorMap (12경 패널 색상)');
  console.log('');
  console.log(
    ' SVG ID  │E-idx│ 경승지            │ main     │ sub      │ acc',
  );
  console.log(
    '─────────┼─────┼───────────────────┼──────────┼──────────┼──────────',
  );

  for (const svgId of SVG_PANEL_IDS) {
    const eIdx  = SVG_ID_TO_EMOTION_IDX[svgId];
    const entry = panelColors?.[svgId] ?? {};
    const name  = (SPOT_NAMES[svgId] ?? '').padEnd(17);
    const mark  = svgId === highlightSvgId ? '★' : ' ';

    console.log(
      `${mark}${svgId} │ ${String(eIdx).padStart(2)}  │ ${name} │ ` +
      `${(entry.main ?? '???????').padEnd(8)} │ ` +
      `${(entry.sub  ?? '???????').padEnd(8)} │ ` +
      `${entry.acc   ?? '???????'}`,
    );
  }

  console.log('');
  const { valid, issues } = validatePanelColors(panelColors);
  console.log('유효성:', valid ? '✅ 통과' : `❌ ${issues.join(' | ')}`);
  console.groupEnd();
  /* eslint-enable no-console */
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  // 색상 계산 (클라이언트 전달용)
  applySvgColors,
  calculateAllPanelColors,
  colorTempToFilter,
  buildPanelColorMap,

  // 서버사이드 PNG 생성
  patchSVG,
  svgToPng,
  generateCardPNG,

  // ID 매핑 상수 & 헬퍼
  EMOTION_IDX_TO_SVG_ID,
  SVG_ID_TO_EMOTION_IDX,
  SVG_PANEL_IDS,
  gradientStopId,

  // 유틸리티
  validatePanelColors,
  debugPrintPanelColors,
};
