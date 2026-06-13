/**
 * @fileoverview 울산 E-Card 클라이언트 색채 계산 엔진
 * @module public/js/color-engine
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   브라우저에서 실행되는 순수 색채 계산 모듈.
 *   서버의 svg-engine/color-calculator.js 와 완전히 동일한 수식으로
 *   12패널 색상을 계산하여 svg-renderer.js 에 전달한다.
 *
 *   [이 모듈이 필요한 이유]
 *   서버 응답(panelColors)이 도착하기 전에 클라이언트가
 *   로컬에서 즉시 프리뷰 색상을 계산해야 하는 상황에 대비한다.
 *   또한 app.js 가 서버 응답을 받은 후 colorTempFilter를
 *   SVG 컨테이너에 적용하는 데 사용한다.
 *
 *   [서버 color-calculator.js 와의 관계]
 *   ─ 동일 수식, 동일 상수 → 동일 결과 보장
 *   ─ 서버: Node.js ES 모듈, color-calculator.js
 *   ─ 클라이언트: 브라우저 ES 모듈, color-engine.js (이 파일)
 *   ─ Node.js 전용 API(fs, path 등) 미사용 → 브라우저 직접 실행 가능
 *
 * ─────────────────────────────────────────────────────────────────
 * app.js 에서의 사용 방식
 * ─────────────────────────────────────────────────────────────────
 *
 *   import { calculateAllPanelColors,
 *            colorTempToFilter }  from './color-engine.js';
 *
 *   // 서버 응답 도착 후 — panelColors는 서버가 계산한 값을 그대로 사용
 *   applyColorsToSVG(data.panelColors);
 *
 *   // colorTempFilter는 서버 응답값을 우선 사용,
 *   // 없으면 로컬 계산값으로 폴백
 *   const filter = data.colorTempFilter
 *     ?? colorTempToFilter(data.emotionScores);
 *   document.getElementById('svg-container').style.filter = filter;
 *
 *   // 로컬 프리뷰(오프라인·테스트 등)
 *   const localColors = calculateAllPanelColors(emotionScores, diversitySeed);
 *   applyColorsToSVG(localColors);
 *
 * ─────────────────────────────────────────────────────────────────
 * 계산 파이프라인 (color-calculator.js 와 동일)
 * ─────────────────────────────────────────────────────────────────
 *
 *   emotionScores (8차원 0~100)
 *         │
 *         ▼  computeGlobalParams()
 *   GlobalColorParams (ΔHue / ΔSat / ΔLight / ΔContrast / colorTemp / lightDir)
 *         │
 *         ▼  computePanelHex() × 12
 *   main hex (색조·채도·명도 적용)
 *         │
 *         ▼  deriveSub() / deriveAcc()
 *   sub / acc 파생 (원본 팔레트 관계 유지)
 *         │
 *         ▼  applyTintToHex()
 *   색온도 RGB 틴트 적용 → 최종 hex 3종
 *         │
 *         ▼  applyDiversityNoise()
 *   다양성 시드 결정론적 노이즈 → 유일성 보장
 *         │
 *         ▼
 *   PanelColorMap { 'spot-00': {main,sub,acc}, ... }
 *
 * ─────────────────────────────────────────────────────────────────
 * SVG ID 체계 (경승지별_ID_및_채색방법.txt 기준)
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
 */

'use strict';

// =============================================================================
// ① 공통 유틸리티
// =============================================================================

/** @param {number} v @param {number} mn @param {number} mx */
const clamp = (v, mn, mx) => Math.min(Math.max(v, mn), mx);

/** 색조 0~360° 범위 유지 */
const wrapHue = (h) => ((h % 360) + 360) % 360;

/** 0~100 점수 → 0~1 정규화 */
const norm = (s) => clamp(s, 0, 100) / 100;

/**
 * hex '#RRGGBB' → { h:0~360, s:0~1, l:0~1 }
 * @param {string} hex
 * @returns {{ h:number, s:number, l:number }}
 */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l  = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  switch (mx) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default:h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

/**
 * HSL → hex '#RRGGBB'
 * @param {number} h 0~360
 * @param {number} s 0~1
 * @param {number} l 0~1
 * @returns {string}
 */
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h <  60 ? [c, x, 0] : h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] : h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * hex에 RGB 배수 틴트를 적용한다.
 * @param {string} hex
 * @param {{ r:number, g:number, b:number }} tint
 * @returns {string}
 */
function applyTintToHex(hex, tint) {
  const r = clamp(Math.round(parseInt(hex.slice(1, 3), 16) * tint.r), 0, 255);
  const g = clamp(Math.round(parseInt(hex.slice(3, 5), 16) * tint.g), 0, 255);
  const b = clamp(Math.round(parseInt(hex.slice(5, 7), 16) * tint.b), 0, 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// =============================================================================
// ② 결정론적 노이즈 생성기
//    svg-engine/color-calculator.js 의 noiseValue() 와 완전히 동일
// =============================================================================

/**
 * diversitySeed + panelIndex + paramIndex 로 -1~+1 노이즈를 생성한다.
 * 동일 입력 → 항상 동일 출력 (재현 가능).
 *
 * @param {number} seed
 * @param {number} panelIndex  0~11
 * @param {number} paramIndex  0~5
 * @returns {number} -1 ~ +1
 */
function noiseValue(seed, panelIndex, paramIndex) {
  let h = (seed ^ (panelIndex * 2654435761) ^ (paramIndex * 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0xFFFFFFFF) * 2 - 1;
}

// =============================================================================
// ③ 울산 12경 기본 팔레트
//    svg-engine/color-calculator.js 의 BASE_PALETTES 와 완전히 동일
// =============================================================================

const BASE_PALETTES = [
  { index:  0, svgId: 'spot-04', name: '간절곶 일출',
    main: '#FF6635', sub: '#FFB347', acc: '#FFCF9E' },
  { index:  1, svgId: 'spot-01', name: '대왕암공원',
    main: '#2A6640', sub: '#607B8B', acc: '#A8D5B5' },
  { index:  2, svgId: 'spot-06', name: '강동 몽돌해변',
    main: '#4A6880', sub: '#38A89D', acc: '#CAF0F8' },
  { index:  3, svgId: 'spot-09', name: '장생포 고래문화마을',
    main: '#0B5EA8', sub: '#48A9C5', acc: '#C8E8F5' },
  { index:  4, svgId: 'spot-10', name: '외고산 옹기마을',
    main: '#B5693A', sub: '#7A3D2B', acc: '#E8C99A' },
  { index:  5, svgId: 'spot-05', name: '반구대 암각화',
    main: '#C4956A', sub: '#6B3D1E', acc: '#E8D5B5' },
  { index:  6, svgId: 'spot-11', name: '대운산 내원암 계곡',
    main: '#2D7D5E', sub: '#8B7214', acc: '#D4E8D0' },
  { index:  7, svgId: 'spot-08', name: '울산대교',
    main: '#4A6FA5', sub: '#C8A84B', acc: '#E8F0F8' },
  { index:  8, svgId: 'spot-07', name: '울산대공원',
    main: '#5A9E6F', sub: '#E8607A', acc: '#F5DEB3' },
  { index:  9, svgId: 'spot-00', name: '태화강 국가정원·십리대숲',
    main: '#3D8B5E', sub: '#6BBFD4', acc: '#DFFFEF' },
  { index: 10, svgId: 'spot-03', name: '신불산 억새평원',
    main: '#D4A853', sub: '#8FA8C8', acc: '#F5E8C8' },
  { index: 11, svgId: 'spot-02', name: '가지산 사계',
    main: '#6B8F6E', sub: '#D4703A', acc: '#F5E6C8' },
].map((s) => ({
  ...s,
  mainHsl: hexToHsl(s.main),
  subHsl:  hexToHsl(s.sub),
  accHsl:  hexToHsl(s.acc),
}));

// =============================================================================
// ④ 패널별 반응 가중치 행렬
//    svg-engine/color-calculator.js 의 PANEL_WEIGHTS 와 완전히 동일
// =============================================================================

const PANEL_WEIGHTS = [
  /* 0  간절곶 일출     */ { hue:1.40, sat:1.10, light:1.30, contrast:1.20, temp:1.60, lightDir:1.30 },
  /* 1  대왕암공원      */ { hue:0.70, sat:1.40, light:0.85, contrast:1.10, temp:0.60, lightDir:0.80 },
  /* 2  강동 몽돌해변   */ { hue:0.90, sat:1.20, light:1.00, contrast:1.35, temp:0.70, lightDir:1.00 },
  /* 3  장생포 고래마을 */ { hue:1.10, sat:1.25, light:0.90, contrast:1.30, temp:0.80, lightDir:0.70 },
  /* 4  외고산 옹기마을 */ { hue:0.80, sat:0.85, light:0.80, contrast:0.70, temp:1.50, lightDir:0.60 },
  /* 5  반구대 암각화   */ { hue:0.55, sat:0.70, light:0.65, contrast:1.55, temp:1.10, lightDir:0.50 },
  /* 6  대운산 계곡     */ { hue:0.85, sat:1.35, light:1.20, contrast:0.85, temp:0.60, lightDir:1.10 },
  /* 7  울산대교        */ { hue:1.20, sat:0.95, light:1.10, contrast:1.40, temp:1.00, lightDir:1.60 },
  /* 8  울산대공원      */ { hue:1.00, sat:1.15, light:1.25, contrast:0.80, temp:0.90, lightDir:1.00 },
  /* 9  태화강 십리대숲 */ { hue:0.75, sat:1.30, light:1.00, contrast:0.75, temp:0.55, lightDir:0.85 },
  /* 10 신불산 억새     */ { hue:1.35, sat:1.05, light:1.20, contrast:1.00, temp:1.40, lightDir:1.25 },
  /* 11 가지산 사계     */ { hue:1.55, sat:1.20, light:1.00, contrast:1.10, temp:1.25, lightDir:0.90 },
];

const NOISE_AMP = { hue: 4.0, sat: 0.04, light: 0.03, temp: 80 };

// =============================================================================
// ⑤ STEP 1 — 감성 점수 → 글로벌 색채 파라미터
//    param-synthesizer.js / color-calculator.js 와 동일 수식
// =============================================================================

/**
 * 8차원 감성 점수에서 6개 글로벌 색채 파라미터를 계산한다.
 *
 * app.js 에서 직접 호출하여 colorTempFilter 계산에 활용하거나
 * 로컬 프리뷰 색상 계산 시 calculateAllPanelColors() 내부에서 사용된다.
 *
 * @param {Object} scores
 *   { amazement, peace, vitality, nostalgia,
 *     freshness, grandeur, warmth, mystery } (각 0~100)
 * @returns {{
 *   deltaHue:      number,
 *   deltaSat:      number,
 *   deltaLight:    number,
 *   deltaContrast: number,
 *   colorTemp:     number,
 *   lightDir:      number,
 *   rgbTint:       { r:number, g:number, b:number },
 * }}
 *
 * @example
 * const params = synthesizeParams({ amazement:80, warmth:85, ... });
 * params.colorTemp   // → +980 (따뜻한 감성)
 * params.deltaHue    // → +12.4°
 */
export function synthesizeParams(scores) {
  const E = {
    amazement: norm(scores.amazement ?? 25),
    peace:     norm(scores.peace     ?? 25),
    vitality:  norm(scores.vitality  ?? 25),
    nostalgia: norm(scores.nostalgia ?? 25),
    freshness: norm(scores.freshness ?? 25),
    grandeur:  norm(scores.grandeur  ?? 25),
    warmth:    norm(scores.warmth    ?? 25),
    mystery:   norm(scores.mystery   ?? 25),
  };

  const deltaHue = clamp(
    (E.warmth    - E.freshness) * 18
  + (E.nostalgia - E.amazement) *  8
  +  E.mystery                  * 12
  -  6,
    -25, 25,
  );

  const deltaSat = clamp(
    0.70
  + (E.amazement + E.vitality)  * 0.30
  - (E.peace     + E.nostalgia) * 0.18
  +  E.grandeur                 * 0.08,
    0.50, 1.45,
  );

  const deltaLight = clamp(
    (E.vitality  + E.freshness) * 0.14
  - (E.grandeur  + E.mystery)   * 0.12
  +  E.warmth                   * 0.05
  -  0.03,
    -0.20, 0.20,
  );

  const deltaContrast = clamp(
    0.80
  + (E.amazement + E.grandeur)  * 0.28
  - (E.peace     + E.nostalgia) * 0.15
  +  E.mystery                  * 0.10,
    0.65, 1.45,
  );

  const colorTemp = clamp(
    (E.warmth - E.freshness) * 1400
  +  E.nostalgia             *  700
  -  E.mystery               *  350,
    -1500, 1500,
  );

  const lightDir = clamp(
    (E.warmth   - E.freshness) * 25
  + (E.vitality - E.peace)     * 10,
    -35, 35,
  );

  const n = clamp(colorTemp / 1500, -1, 1);
  const rgbTint = {
    r: clamp(1.0 + n *  0.14, 0.80, 1.20),
    g: clamp(1.0 + n *  0.05, 0.90, 1.10),
    b: clamp(1.0 - n *  0.18, 0.70, 1.25),
  };

  return { deltaHue, deltaSat, deltaLight, deltaContrast, colorTemp, lightDir, rgbTint };
}

// =============================================================================
// ⑥ STEP 2~4 — 단일 패널 색상 계산 (내부 함수)
// =============================================================================

/**
 * 기본 팔레트의 main 대비 target(sub 또는 acc)의 색채 관계를 추출한다.
 * @param {{ h:number, s:number, l:number }} mainHsl
 * @param {{ h:number, s:number, l:number }} targetHsl
 * @returns {{ dh:number, satRatio:number, lightOffset:number }}
 */
function computeRelation(mainHsl, targetHsl) {
  let dh = targetHsl.h - mainHsl.h;
  if (dh >  180) dh -= 360;
  if (dh < -180) dh += 360;
  const satRatio    = mainHsl.s > 0.001 ? targetHsl.s / mainHsl.s : 1.0;
  const lightOffset = targetHsl.l - mainHsl.l;
  return { dh, satRatio, lightOffset };
}

/**
 * 단일 패널의 최종 main / sub / acc hex를 계산한다.
 *
 * @param {(typeof BASE_PALETTES)[0]} spot
 * @param {ReturnType<synthesizeParams>} gp   글로벌 색채 파라미터
 * @param {number} seed  diversitySeed
 * @returns {{ main:string, sub:string, acc:string }}
 */
function computePanelHex(spot, gp, seed) {
  const i  = spot.index;
  const w  = PANEL_WEIGHTS[i];
  const bm = spot.mainHsl;

  // main HSL
  const finalH = wrapHue(
    bm.h
    + gp.deltaHue * w.hue
    + noiseValue(seed, i, 0) * NOISE_AMP.hue,
  );
  const finalS = clamp(
    bm.s * Math.pow(gp.deltaSat, w.sat)
    + noiseValue(seed, i, 1) * NOISE_AMP.sat,
    0.05, 1.0,
  );
  const finalL = clamp(
    bm.l
    + gp.deltaLight * w.light
    + noiseValue(seed, i, 2) * NOISE_AMP.light,
    0.08, 0.92,
  );

  const main = applyTintToHex(hslToHex(finalH, finalS, finalL), gp.rgbTint);

  // sub / acc — 원본 팔레트의 main 대비 관계를 finalMain 기준으로 재현
  const subRel = computeRelation(bm, spot.subHsl);
  const accRel = computeRelation(bm, spot.accHsl);

  const subTint = {
    r: 1.0 + (gp.rgbTint.r - 1.0) * 0.6,
    g: 1.0 + (gp.rgbTint.g - 1.0) * 0.6,
    b: 1.0 + (gp.rgbTint.b - 1.0) * 0.6,
  };

  const sub = applyTintToHex(
    hslToHex(
      wrapHue(finalH + subRel.dh),
      clamp(finalS * subRel.satRatio, 0.03, 1.0),
      clamp(finalL + subRel.lightOffset, 0.05, 0.95),
    ),
    subTint,
  );

  const acc = applyTintToHex(
    hslToHex(
      wrapHue(finalH + accRel.dh),
      clamp(finalS * accRel.satRatio, 0.03, 1.0),
      clamp(finalL + accRel.lightOffset, 0.05, 0.97),
    ),
    subTint,
  );

  return { main, sub, acc };
}

// =============================================================================
// ⑦ 퍼블릭 API
// =============================================================================

/**
 * @typedef {Object} PanelColorEntry
 * @property {string} main   주색 hex   (예: '#FF7A4F')
 * @property {string} sub    보조색 hex
 * @property {string} acc    강조색 hex
 * @property {string} svgId  SVG ID 접두어 (예: 'spot-04')
 *
 * @typedef {Record<string, PanelColorEntry>} PanelColorMap
 *   키: SVG ID 접두어 ('spot-00' ~ 'spot-11')
 */

/**
 * 감성 점수와 다양성 시드를 받아 12패널의 PanelColorMap을 반환한다.
 *
 * svg-renderer.js 의 applyColorsToSVG(panelColors) 에 그대로 전달한다.
 * 서버 응답(data.panelColors)과 동일한 구조 / 동일한 결과를 보장한다.
 *
 * [주요 사용 시나리오]
 *   ① 서버 응답의 panelColors를 그대로 사용하는 경우 — 이 함수 불필요
 *   ② 오프라인 / 서버 응답 지연 / 로컬 프리뷰 — 이 함수로 즉시 계산
 *   ③ 테스트·개발 환경 — 서버 없이 색채 확인
 *
 * @param {Object} emotionScores
 *   { amazement:0~100, peace:0~100, vitality:0~100, nostalgia:0~100,
 *     freshness:0~100, grandeur:0~100, warmth:0~100, mystery:0~100 }
 * @param {number} [seed=0]  diversitySeed (preprocessor.js cyrb53 해시)
 * @returns {PanelColorMap}
 *
 * @example
 * import { calculateAllPanelColors } from './color-engine.js';
 *
 * const panelColors = calculateAllPanelColors(
 *   { amazement:80, peace:30, vitality:70, nostalgia:20,
 *     freshness:60, grandeur:75, warmth:85, mystery:25 },
 *   142857,
 * );
 *
 * // svg-renderer.js 에 전달
 * applyColorsToSVG(panelColors);
 *
 * panelColors['spot-04']
 * // → { main:'#FF7A4F', sub:'#FFC366', acc:'#FFD9AE', svgId:'spot-04' }
 */
export function calculateAllPanelColors(emotionScores, seed = 0) {
  const gp  = synthesizeParams(emotionScores);
  const map = {};

  for (const spot of BASE_PALETTES) {
    const { main, sub, acc } = computePanelHex(spot, gp, seed);
    map[spot.svgId] = { main, sub, acc, svgId: spot.svgId };
  }

  return map;
}

/**
 * 경승지 인덱스(0~11)와 글로벌 파라미터를 받아
 * 단일 패널의 색상(main / sub / acc)을 반환한다.
 *
 * app.js 가 매칭된 경승지 하나의 색상만 빠르게 가져올 때 사용한다.
 * 예) 팔레트 스트립 강조 색상, 결과 카드 배경색 설정 등.
 *
 * @param {number} spotIndex   0~11 (emotion-engine SPOTS 인덱스)
 * @param {Object} emotionScores
 * @param {number} [seed=0]
 * @returns {{ main:string, sub:string, acc:string, svgId:string } | null}
 *
 * @example
 * const spot = applyParamsToSpot(0, emotionScores, diversitySeed);
 * // → { main:'#FF7A4F', sub:'#FFC366', acc:'#FFD9AE', svgId:'spot-04' }
 */
export function applyParamsToSpot(spotIndex, emotionScores, seed = 0) {
  const spot = BASE_PALETTES.find((s) => s.index === spotIndex);
  if (!spot) return null;

  const gp  = synthesizeParams(emotionScores);
  const { main, sub, acc } = computePanelHex(spot, gp, seed);
  return { main, sub, acc, svgId: spot.svgId };
}

/**
 * 색온도 오프셋(K)을 SVG 컨테이너 전체에 적용할 CSS filter 문자열로 변환한다.
 *
 * app.js 에서 서버 응답의 colorTempFilter 를 우선 사용하고,
 * 없을 경우 이 함수로 로컬 계산한다:
 *
 *   const filter = data.colorTempFilter
 *     ?? colorTempToFilter(synthesizeParams(data.emotionScores).colorTemp);
 *   svgContainer.style.filter = filter;
 *
 * svg-engine/color-calculator.js 의 colorTempToFilter() 와 동일 수식.
 *
 * @param {number} colorTemp  색온도 오프셋 (-1500 ~ +1500K)
 * @returns {string}  CSS filter 값 (중립이면 '')
 *
 * @example
 * colorTempToFilter(+800)   // → 'sepia(0.27) saturate(1.16)'
 * colorTempToFilter(-600)   // → 'hue-rotate(-8deg) saturate(0.94)'
 * colorTempToFilter(0)      // → ''
 */
export function colorTempToFilter(colorTemp) {
  const THRESHOLD = 80;
  if (Math.abs(colorTemp) < THRESHOLD) return '';

  const n = clamp(colorTemp / 1500, -1, 1);

  if (n > 0) {
    const sepia    = +(n * 0.50).toFixed(2);
    const saturate = +(1.0 + n * 0.30).toFixed(2);
    return `sepia(${sepia}) saturate(${saturate})`;
  } else {
    const rotate   = +(n * 20).toFixed(1);
    const saturate = +(1.0 + n * 0.15).toFixed(2);
    return `hue-rotate(${rotate}deg) saturate(${saturate})`;
  }
}

// =============================================================================
// ⑧ 팔레트 스트립 헬퍼
// =============================================================================

/**
 * PanelColorMap에서 팔레트 스트립용 색상 배열을 추출한다.
 *
 * app.js 의 #palette-strip 렌더링에 사용:
 *   const strip = extractPaletteStrip(panelColors, spotIndex);
 *   strip.forEach(({ hex, svgId, isActive }) => { ... });
 *
 * SVG ID 순서(spot-00 ~ spot-11)로 반환하며
 * 매칭된 경승지(spotIndex)에 isActive:true 를 표시한다.
 *
 * @param {PanelColorMap} panelColors
 * @param {number}        [activeEmotionIdx=-1]  강조할 emotion 인덱스
 * @returns {Array<{ hex:string, svgId:string, name:string, isActive:boolean }>}
 *
 * @example
 * const strip = extractPaletteStrip(panelColors, 0); // 간절곶 강조
 * strip[4]
 * // → { hex:'#FF7A4F', svgId:'spot-04', name:'간절곶 일출', isActive:true }
 */
export function extractPaletteStrip(panelColors, activeEmotionIdx = -1) {
  // emotion 인덱스 → SVG ID 매핑
  const EMOTION_TO_SVG = Object.fromEntries(
    BASE_PALETTES.map((s) => [s.index, s.svgId]),
  );
  const activeSvgId = EMOTION_TO_SVG[activeEmotionIdx] ?? null;

  // SVG ID 순서(spot-00 ~ spot-11)로 반환
  return Array.from({ length: 12 }, (_, i) => {
    const svgId = `spot-${String(i).padStart(2, '0')}`;
    const entry = panelColors?.[svgId];
    const spot  = BASE_PALETTES.find((s) => s.svgId === svgId);
    return {
      hex:      entry?.main ?? spot?.main ?? '#888888',
      svgId,
      name:     spot?.name ?? svgId,
      isActive: svgId === activeSvgId,
    };
  });
}

// =============================================================================
// ⑨ 감성 스펙트럼 바 헬퍼
// =============================================================================

/**
 * 감성 점수를 정규화된 스펙트럼 바 데이터로 변환한다.
 *
 * app.js 의 #spectrum-bars 렌더링에 사용:
 *   const bars = buildEmotionSpectrum(emotionScores);
 *   bars.forEach(({ key, label, score, pct, color }) => { ... });
 *
 * @param {Object} emotionScores
 * @returns {Array<{
 *   key:   string,
 *   label: string,
 *   score: number,
 *   pct:   number,
 *   color: string,
 * }>}
 *
 * @example
 * const bars = buildEmotionSpectrum({ amazement:80, peace:60, ... });
 * bars[0]
 * // → { key:'amazement', label:'경이·감탄', score:80, pct:80, color:'#FFB347' }
 */
export function buildEmotionSpectrum(emotionScores) {
  const EMOTION_META = [
    { key: 'amazement', label: '경이·감탄', color: '#FFB347' },
    { key: 'peace',     label: '고요·평화', color: '#6BBFD4' },
    { key: 'vitality',  label: '활기·생동', color: '#E8607A' },
    { key: 'nostalgia', label: '그리움·향수', color: '#C4956A' },
    { key: 'freshness', label: '청량·신선', color: '#38A89D' },
    { key: 'grandeur',  label: '웅장·장엄', color: '#607B8B' },
    { key: 'warmth',    label: '따뜻·포근', color: '#FF6635' },
    { key: 'mystery',   label: '신비·몽환', color: '#8B7214' },
  ];

  const maxScore = Math.max(
    ...EMOTION_META.map((m) => emotionScores[m.key] ?? 0),
    1,
  );

  return EMOTION_META.map((m) => {
    const score = clamp(emotionScores[m.key] ?? 0, 0, 100);
    return {
      key:   m.key,
      label: m.label,
      score,
      pct:   Math.round((score / maxScore) * 100),  // 최고점 기준 상대 %
      color: m.color,
    };
  });
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  synthesizeParams,
  calculateAllPanelColors,
  applyParamsToSpot,
  colorTempToFilter,
  extractPaletteStrip,
  buildEmotionSpectrum,
};
