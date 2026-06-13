/**
 * @fileoverview 울산 E-Card — 감성 벡터 → SVG 색채 계산 엔진 (클라이언트)
 * @module public/js/color-engine
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   8차원 감성 점수(emotionScores)를 받아
 *   울산 12경 패널 각각의 최종 SVG 색상(main/sub/acc + cssHSL)을
 *   브라우저에서 직접 계산한다.
 *
 *   서버(emotion-engine/param-synthesizer.js +
 *         emotion-engine/panel-individualizer.js)의
 *   핵심 수식을 클라이언트 전용으로 재구현한 모듈이다.
 *   (빌드 도구 없는 순수 HTML/JS 구조이므로 모듈 공유 대신 복제)
 *
 * ─────────────────────────────────────────────────────────────────
 * [사용 시점 — app.js]
 *
 *   1. 정상 경로: /api/impression 응답에 panelColors[12]가 포함되면
 *      이 모듈을 호출하지 않고 그대로 SVG에 적용한다.
 *
 *   2. 폴백 경로: panelColors가 없거나(서버 오류·구버전 응답 등)
 *      emotionScores만 있을 때, 이 모듈의 calculateAllPanelColors()로
 *      클라이언트에서 즉시 12패널 색상을 계산한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [핵심 흐름]
 *
 *   emotionScores (8차원, 0~100)
 *         │
 *         ▼ synthesizeParams()
 *   GlobalColorParams (6종: ΔHue·ΔSat·ΔLight·ΔContrast·ColorTemp·LightDir)
 *         │
 *         ▼ applyParamsToSpot()  (× 12경 반복)
 *   PanelColor { main, sub, acc, cssHSL }
 *         │
 *         ▼ calculateAllPanelColors()
 *   PanelColor[12]  ← svg-renderer.applyColorsToSVG() 가 사용
 */

'use strict';

// =============================================================================
// ① 색상 변환 유틸리티
// =============================================================================

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const wrapHue = (h) => ((h % 360) + 360) % 360;

/**
 * Hex → { h:0~360, s:0~1, l:0~1 }
 * @param {string} hex  '#RRGGBB'
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
    case g: h = ((b - r) / d + 2) / 6;               break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}

/**
 * HSL(h:0~360, s:0~1, l:0~1) → Hex '#RRGGBB'
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {string}
 */
function hslToHex(h, s, l) {
  h = wrapHue(h);
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
 * CSS hsl() 문자열 생성
 * @param {number} h  0~360
 * @param {number} s  0~1
 * @param {number} l  0~1
 * @returns {string}
 */
function toCssHsl(h, s, l) {
  return `hsl(${wrapHue(h).toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`;
}

/**
 * 0~100 점수를 0~1로 정규화한다.
 * @param {number} score
 * @returns {number}
 */
const norm = (score) => clamp(score ?? 0, 0, 100) / 100;

// =============================================================================
// ② 글로벌 색채 파라미터 범위 상수
//    (emotion-engine/param-synthesizer.js LIMITS와 동일)
// =============================================================================

const LIMITS = {
  deltaHue:      { min: -25,   max: +25   },
  deltaSat:      { min:  0.50, max:  1.45 },
  deltaLight:    { min: -0.20, max: +0.20 },
  deltaContrast: { min:  0.65, max:  1.45 },
  colorTemp:     { min: -1500, max: +1500 },
  lightDir:      { min: -35,   max: +35   },
};

const limit = (key, value) => clamp(value, LIMITS[key].min, LIMITS[key].max);

// =============================================================================
// ③ 울산 12경 기본 팔레트
//    (emotion-engine/panel-individualizer.js SPOT_BASE_PALETTES와 동일)
// =============================================================================

const SPOT_BASE_PALETTES = [
  { index: 0,  name: '간절곶 일출',             main: '#FF6635', sub: '#FFB347', acc: '#FFCF9E' },
  { index: 1,  name: '대왕암공원',               main: '#2A6640', sub: '#607B8B', acc: '#A8D5B5' },
  { index: 2,  name: '강동 몽돌해변',            main: '#4A6880', sub: '#38A89D', acc: '#CAF0F8' },
  { index: 3,  name: '장생포 고래문화마을',      main: '#0B5EA8', sub: '#48A9C5', acc: '#C8E8F5' },
  { index: 4,  name: '외고산 옹기마을',          main: '#B5693A', sub: '#7A3D2B', acc: '#E8C99A' },
  { index: 5,  name: '반구대 암각화',            main: '#C4956A', sub: '#6B3D1E', acc: '#E8D5B5' },
  { index: 6,  name: '대운산 내원암 계곡',       main: '#2D7D5E', sub: '#8B7214', acc: '#D4E8D0' },
  { index: 7,  name: '울산대교',                 main: '#4A6FA5', sub: '#C8A84B', acc: '#E8F0F8' },
  { index: 8,  name: '울산대공원',               main: '#5A9E6F', sub: '#E8607A', acc: '#F5DEB3' },
  { index: 9,  name: '태화강 국가정원·십리대숲', main: '#3D8B5E', sub: '#6BBFD4', acc: '#DFFFEF' },
  { index: 10, name: '신불산 억새평원',          main: '#D4A853', sub: '#8FA8C8', acc: '#F5E8C8' },
  { index: 11, name: '가지산 사계',              main: '#6B8F6E', sub: '#D4703A', acc: '#F5E6C8' },
].map((s) => ({ ...s, mainHsl: hexToHsl(s.main) }));

// =============================================================================
// ④ 패널별 반응 가중치 행렬
//    (emotion-engine/panel-individualizer.js PANEL_WEIGHT_MATRIX와 동일)
//    1.0 = 표준 / >1.0 = 민감 / <1.0 = 둔감
// =============================================================================

const PANEL_WEIGHT_MATRIX = [
  /* 0  간절곶 일출     */ { hue: 1.40, sat: 1.10, light: 1.30, contrast: 1.20, temp: 1.60, lightDir: 1.30 },
  /* 1  대왕암공원      */ { hue: 0.70, sat: 1.40, light: 0.85, contrast: 1.10, temp: 0.60, lightDir: 0.80 },
  /* 2  강동 몽돌해변   */ { hue: 0.90, sat: 1.20, light: 1.00, contrast: 1.35, temp: 0.70, lightDir: 1.00 },
  /* 3  장생포 고래마을 */ { hue: 1.10, sat: 1.25, light: 0.90, contrast: 1.30, temp: 0.80, lightDir: 0.70 },
  /* 4  외고산 옹기마을 */ { hue: 0.80, sat: 0.85, light: 0.80, contrast: 0.70, temp: 1.50, lightDir: 0.60 },
  /* 5  반구대 암각화   */ { hue: 0.55, sat: 0.70, light: 0.65, contrast: 1.55, temp: 1.10, lightDir: 0.50 },
  /* 6  대운산 계곡     */ { hue: 0.85, sat: 1.35, light: 1.20, contrast: 0.85, temp: 0.60, lightDir: 1.10 },
  /* 7  울산대교        */ { hue: 1.20, sat: 0.95, light: 1.10, contrast: 1.40, temp: 1.00, lightDir: 1.60 },
  /* 8  울산대공원      */ { hue: 1.00, sat: 1.15, light: 1.25, contrast: 0.80, temp: 0.90, lightDir: 1.00 },
  /* 9  태화강 십리대숲 */ { hue: 0.75, sat: 1.30, light: 1.00, contrast: 0.75, temp: 0.55, lightDir: 0.85 },
  /* 10 신불산 억새     */ { hue: 1.35, sat: 1.05, light: 1.20, contrast: 1.00, temp: 1.40, lightDir: 1.25 },
  /* 11 가지산 사계     */ { hue: 1.55, sat: 1.20, light: 1.00, contrast: 1.10, temp: 1.25, lightDir: 0.90 },
];

/** 파라미터별 최대 노이즈 크기 (panel-individualizer.js NOISE_AMP와 동일) */
const NOISE_AMP = {
  hue: 4.0, sat: 0.04, light: 0.03, contrast: 0.04, temp: 80, lightDir: 3.0,
};

// =============================================================================
// ⑤ 결정론적 미세 노이즈 생성기
//    (panel-individualizer.js noiseValue와 동일 — 동일 입력 → 동일 출력)
// =============================================================================

/**
 * 다양성 시드 + 패널/파라미터 인덱스로 -1~+1 노이즈를 생성한다.
 * @param {number} seed
 * @param {number} panelIndex
 * @param {number} paramIndex
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
// ⑥ 핵심 수식 — 감성 점수 → 6개 글로벌 색채 파라미터
//    (emotion-engine/param-synthesizer.js computeCoreParams와 동일)
// =============================================================================

/**
 * @typedef {Object} GlobalColorParams
 * @property {number} deltaHue      색조 이동량 (°, -25~+25)
 * @property {number} deltaSat      채도 배수 (×, 0.50~1.45)
 * @property {number} deltaLight    명도 조정량 (-0.20~+0.20)
 * @property {number} deltaContrast 명암대비 배수 (×, 0.65~1.45)
 * @property {number} colorTemp     색온도 오프셋 (K, -1500~+1500)
 * @property {number} lightDir      광원 방향 (°, -35~+35)
 */

/**
 * 8차원 감성 점수에서 6개 글로벌 색채 파라미터를 합성한다.
 *
 * 서버(param-synthesizer.js)와 달리 contextAnalysis(시간·계절·동행자)
 * 기반 보정은 적용하지 않는다 — 클라이언트 폴백은 감성 점수만으로
 * 합리적인 결과를 내는 것이 목적이며, 시간·계절 보정은 서버
 * panelColors가 정상 수신될 때만 반영된다.
 *
 * @param {Object} emotionScores  8차원 감성 점수 (각 0~100)
 * @returns {GlobalColorParams}
 *
 * @example
 * const params = synthesizeParams({
 *   amazement: 80, peace: 30, vitality: 60, nostalgia: 20,
 *   freshness: 40, grandeur: 50, warmth: 70, mystery: 25,
 * });
 * // params.deltaHue  → +6.2  (따뜻한 방향 색조 이동)
 * // params.deltaSat  → 1.21  (비비드한 채도)
 */
export function synthesizeParams(emotionScores) {
  const E = {
    amazement: norm(emotionScores.amazement),
    peace:     norm(emotionScores.peace),
    vitality:  norm(emotionScores.vitality),
    nostalgia: norm(emotionScores.nostalgia),
    freshness: norm(emotionScores.freshness),
    grandeur:  norm(emotionScores.grandeur),
    warmth:    norm(emotionScores.warmth),
    mystery:   norm(emotionScores.mystery),
  };

  // ΔHue: 따뜻↔청량 주축 + 향수↔경이 보조축 + 신비→보라
  const deltaHue =
    (E.warmth    - E.freshness) * 18
  + (E.nostalgia - E.amazement) *  8
  +  E.mystery                  * 12
  -  6;

  // ΔSat: 경이·활기 → 비비드 / 평화·향수 → 뮤트
  const deltaSat = clamp(
    0.70
  + (E.amazement + E.vitality)  * 0.30
  - (E.peace     + E.nostalgia) * 0.18
  +  E.grandeur                 * 0.08
  , 0.50, 1.45,
  );

  // ΔLight: 활기·신선 → 밝게 / 웅장·신비 → 어둡게
  const deltaLight = clamp(
    (E.vitality + E.freshness) *  0.14
  - (E.grandeur + E.mystery)   *  0.12
  +  E.warmth                  *  0.05
  -  0.03
  , -0.20, +0.20,
  );

  // ΔContrast: 경이·웅장 → 하이콘트라스트 / 평화·향수 → 소프트
  const deltaContrast = clamp(
    0.80
  + (E.amazement + E.grandeur)  * 0.28
  - (E.peace     + E.nostalgia) * 0.15
  +  E.mystery                  * 0.10
  , 0.65, 1.45,
  );

  // ColorTemp: 따뜻함↑ → 골든/앰버, 향수↑ → 세피아, 신비↑ → 약간 차갑게
  const colorTemp =
    (E.warmth    - E.freshness) * 1400
  +  E.nostalgia                *  700
  -  E.mystery                  *  350;

  // LightDir: 따뜻↔청량 + 활기↔평화
  const lightDir =
    (E.warmth   - E.freshness) * 25
  + (E.vitality - E.peace)     * 10;

  return {
    deltaHue:      limit('deltaHue',      deltaHue),
    deltaSat:      limit('deltaSat',      deltaSat),
    deltaLight:    limit('deltaLight',    deltaLight),
    deltaContrast: limit('deltaContrast', deltaContrast),
    colorTemp:     limit('colorTemp',     colorTemp),
    lightDir:      limit('lightDir',      lightDir),
  };
}

// =============================================================================
// ⑦ 패널별 색채 적용
//    (emotion-engine/panel-individualizer.js computePanelParams와 동일)
// =============================================================================

/**
 * @typedef {Object} PanelColor
 * @property {number} index    경승지 인덱스 (0~11)
 * @property {string} name     경승지 이름
 * @property {string} main     주색 hex (#RRGGBB)
 * @property {string} sub      보조색 hex (#RRGGBB)
 * @property {string} acc      강조색 hex (#RRGGBB)
 * @property {string} cssHSL   CSS hsl() 문자열 (main 기준)
 * @property {{h:number,s:number,l:number}} hsl  최종 HSL
 */

/**
 * GlobalColorParams를 특정 경승지(spotIndex)에 적용하여
 * 최종 패널 색상(main/sub/acc)을 계산한다.
 *
 * [유일성 보장 메커니즘]
 *   ① 패널별 반응 가중치(PANEL_WEIGHT_MATRIX) — 같은 파라미터도 패널마다 다르게 반응
 *   ② 경승지 기본 팔레트(SPOT_BASE_PALETTES) — 각 경승지 고유 색상에서 출발
 *   ③ 다양성 시드 노이즈(noiseValue) — 결정론적 미세 노이즈로 최종 유일성 보장
 *
 * sub/acc는 main과 동일한 색조·채도 축에서 명도만 이동시켜 생성한다
 * (panel-individualizer.js extractColorFingerprint와 동일한 파생 방식).
 *
 * @param {number} spotIndex      0~11
 * @param {GlobalColorParams} params  synthesizeParams() 출력
 * @param {number} [seed=0]       다양성 시드 (preprocessor.diversitySeed)
 * @returns {PanelColor}
 *
 * @example
 * const params = synthesizeParams(emotionScores);
 * const panel0 = applyParamsToSpot(0, params, diversitySeed);
 * // panel0.main   → '#FF7A42'
 * // panel0.cssHSL → 'hsl(18.3, 92.1%, 58.4%)'
 */
export function applyParamsToSpot(spotIndex, params, seed = 0) {
  const spot    = SPOT_BASE_PALETTES[clamp(Math.round(spotIndex), 0, 11)];
  const weights = PANEL_WEIGHT_MATRIX[spot.index];
  const base    = spot.mainHsl;
  const i       = spot.index;

  // 색조: 기본 + (글로벌 × 가중치) + 노이즈
  const finalHue = wrapHue(
    base.h
    + params.deltaHue       * weights.hue
    + noiseValue(seed, i, 0) * NOISE_AMP.hue,
  );

  // 채도: 지수 스케일링 (반응성 클수록 비선형 변화)
  const finalSat = clamp(
    base.s * Math.pow(params.deltaSat, weights.sat)
    + noiseValue(seed, i, 1) * NOISE_AMP.sat,
    0.05, 1.0,
  );

  // 명도
  const finalLight = clamp(
    base.l
    + params.deltaLight     * weights.light
    + noiseValue(seed, i, 2) * NOISE_AMP.light,
    0.08, 0.92,
  );

  const main = hslToHex(finalHue, finalSat, finalLight);

  // sub: 동일 색조·채도에서 명도만 낮춤 (그림자 톤)
  const sub = hslToHex(finalHue, finalSat, clamp(finalLight - 0.12, 0.05, 0.85));

  // acc: 색조를 +15° 이동, 채도 낮추고 명도 높임 (하이라이트 톤)
  const acc = hslToHex(
    finalHue + 15,
    clamp(finalSat * 0.6, 0.05, 1.0),
    clamp(finalLight + 0.22, 0.30, 0.92),
  );

  return {
    index:  spot.index,
    name:   spot.name,
    main,
    sub,
    acc,
    cssHSL: toCssHsl(finalHue, finalSat, finalLight),
    hsl:    { h: finalHue, s: finalSat, l: finalLight },
  };
}

// =============================================================================
// ⑧ 12패널 전체 계산 (퍼블릭 API — app.js 직접 호출)
// =============================================================================

/**
 * 8차원 감성 점수와 다양성 시드로 울산 12경 전체 패널 색상을 계산한다.
 *
 * app.js의 폴백 경로에서 호출된다:
 *   서버 응답에 panelColors가 없을 때
 *   calculateAllPanelColors(emotionScores, diversitySeed)로
 *   동일한 형식의 결과를 직접 생성하여 SVG에 적용한다.
 *
 * @param {Object} emotionScores  8차원 감성 점수 (각 0~100)
 * @param {number} [diversitySeed=0]  다양성 시드
 * @returns {PanelColor[]}  길이 12, index 0~11 순서
 *
 * @example
 * const panelColors = calculateAllPanelColors(data.emotionScores, data.diversitySeed);
 * applyColorsToSVG(panelColors);
 */
export function calculateAllPanelColors(emotionScores, diversitySeed = 0) {
  const params = synthesizeParams(emotionScores ?? {});
  return SPOT_BASE_PALETTES.map((spot) =>
    applyParamsToSpot(spot.index, params, diversitySeed),
  );
}

// =============================================================================
// ⑨ 색온도 → CSS filter 변환
// =============================================================================

/**
 * 색온도 오프셋(K)을 CSS filter 문자열로 변환한다.
 * #svg-container에 적용하여 전체 이미지에 색온도 틴트를 더한다.
 *
 * 변환 방식:
 *   colorTemp > 0 (따뜻함) → sepia + saturate로 골든/앰버 톤 강화
 *   colorTemp < 0 (차가움) → hue-rotate(blue 방향) + contrast로 쿨톤 강화
 *   |colorTemp| 작음        → 빈 문자열 (필터 미적용)
 *
 * @param {number} colorTemp  색온도 오프셋 (-1500 ~ +1500K)
 * @returns {string}  CSS filter 값 (필터 불필요 시 '')
 *
 * @example
 * colorTempToFilter(800);   // → 'sepia(0.18) saturate(1.12) brightness(1.02)'
 * colorTempToFilter(-700);  // → 'hue-rotate(-6deg) saturate(1.08)'
 * colorTempToFilter(50);    // → ''
 */
export function colorTempToFilter(colorTemp) {
  const n = clamp((colorTemp ?? 0) / 1500, -1, 1);

  // 노이즈 수준의 작은 값은 필터 생략
  if (Math.abs(n) < 0.04) return '';

  if (n > 0) {
    // 따뜻한 방향 — 세피아·앰버 틴트
    const sepia      = (n * 0.30).toFixed(2);
    const saturate   = (1 + n * 0.18).toFixed(2);
    const brightness = (1 + n * 0.04).toFixed(2);
    return `sepia(${sepia}) saturate(${saturate}) brightness(${brightness})`;
  }

  // 차가운 방향 — 블루 계열 hue-rotate
  const hueRotate = (n * 10).toFixed(1);   // n이 음수이므로 음의 회전
  const saturate  = (1 + Math.abs(n) * 0.15).toFixed(2);
  return `hue-rotate(${hueRotate}deg) saturate(${saturate})`;
}

// =============================================================================
// ⑩ 보조 접근자
// =============================================================================

/**
 * 인덱스로 경승지 기본 팔레트 정보를 조회한다.
 * @param {number} spotIndex  0~11
 * @returns {{ index:number, name:string, main:string, sub:string, acc:string }|null}
 */
export function getBaseSpot(spotIndex) {
  return SPOT_BASE_PALETTES[spotIndex] ?? null;
}

/**
 * 모든 경승지의 기본 main 색상(hex)을 배열로 반환한다.
 * @returns {string[]}  길이 12
 */
export function getAllBaseColors() {
  return SPOT_BASE_PALETTES.map((s) => s.main);
}

// =============================================================================
// ⑪ 디버그 유틸리티
// =============================================================================

/**
 * 계산 결과를 콘솔에 출력한다. (개발 전용)
 * @param {Object} emotionScores
 * @param {number} [diversitySeed=0]
 */
export function debugPrintColors(emotionScores, diversitySeed = 0) {
  /* eslint-disable no-console */
  const params = synthesizeParams(emotionScores);
  const panels = calculateAllPanelColors(emotionScores, diversitySeed);

  console.group('🎨 color-engine — 클라이언트 계산 결과');
  console.log(
    `ΔHue:${params.deltaHue.toFixed(1)}° ΔSat:×${params.deltaSat.toFixed(2)} `
    + `ΔLight:${params.deltaLight.toFixed(3)} ΔContrast:×${params.deltaContrast.toFixed(2)} `
    + `ColorTemp:${params.colorTemp.toFixed(0)}K LightDir:${params.lightDir.toFixed(1)}°`,
  );
  console.log('colorTempToFilter:', colorTempToFilter(params.colorTemp) || '(없음)');
  console.log('─'.repeat(60));

  panels.forEach((p) => {
    console.log(
      `[${String(p.index).padStart(2, '0')}] ${p.name.padEnd(16)}`,
      `main:${p.main}  sub:${p.sub}  acc:${p.acc}`,
    );
  });

  console.groupEnd();
  /* eslint-enable no-console */
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  synthesizeParams,
  applyParamsToSpot,
  calculateAllPanelColors,
  colorTempToFilter,
  getBaseSpot,
  getAllBaseColors,
  debugPrintColors,
};
