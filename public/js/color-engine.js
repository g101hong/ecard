/**
 * @fileoverview 울산 E-Card — 감성 벡터 → SVG 색채 계산 엔진 (클라이언트)
 * @module public/js/color-engine
 * @version 2.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * v2 변경 사항 (svg-engine/color-calculator.js v2 와 동일 수식)
 * ─────────────────────────────────────────────────────────────────
 *
 *   v1: SPOT_BASE_PALETTES 상수(main/sub/acc hex)에서 매번 동일하게 시작
 *       → grad-spot-XX-{main,sub,acc} 3개 고정 역할만 변경
 *
 *   v2: SVG(이미 #svg-container에 인라인 삽입된 원본)에 기록된
 *       "현재 색상"을 출발점(HSL)으로 사용
 *       → id가 'spot-{idx}-{n}' (idx:00~11, n:1,2,3...) 형식인
 *         모든 요소(<stop> 또는 도형)를 대상으로,
 *         main/sub/acc 역할 구분 없이 동일한 감성 delta를 적용
 *       → 패널당 색상 요소 개수는 가변(SVG에서 자동 탐색)
 *
 *   서버(svg-engine/color-calculator.js)와 완전히 동일한 수식을 사용하므로
 *   서버 patchSVG() 결과(PNG)와 클라이언트 미리보기가 100% 일치한다.
 *
 *   "SVG 현재 색상"은 #svg-container에 처음 삽입된(=원본) SVG에서 읽는다.
 *   svg-renderer.applyDeltaColorsToSVG()가 매번 *원본 삽입 시점의 색*을
 *   기준으로 계산하도록 보장해야 결정론·비누적 특성이 유지된다
 *   (자세한 내용은 svg-renderer.js 참조).
 *
 * ─────────────────────────────────────────────────────────────────
 * [사용 시점 — app.js]
 *
 *   1. 정상 경로: /api/impression 응답에 emotionScores + diversitySeed가
 *      포함되면, svg-renderer.applyDeltaColorsToSVG(emotionScores, seed)가
 *      이 모듈의 computeGlobalParams/applyDeltaToHex를 호출해
 *      SVG의 'spot-XX-N' 요소를 직접 패치한다.
 *
 *   2. 폴백 경로도 동일한 모듈을 사용 — 서버·클라이언트 분기 없음
 *      (v1처럼 별도 폴백 계산 경로가 필요 없다. 서버가 panelColors를
 *      미리 계산해 보낼 필요도 없어졌다 — emotionScores + diversitySeed만
 *      전달하면 클라이언트가 SVG의 현재 색에서 직접 계산한다)
 *
 * ─────────────────────────────────────────────────────────────────
 * [핵심 흐름]
 *
 *   emotionScores (8차원, 0~100)
 *         │
 *         ▼ computeGlobalParams()
 *   GlobalColorParams (6종: ΔHue·ΔSat·ΔLight·ΔContrast·ColorTemp·LightDir)
 *         │
 *         ▼ applyDeltaToHex(currentHex, panelIndex, gp, seed)  (요소별)
 *   새 hex
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
export function hexToHsl(hex) {
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
export function hslToHex(h, s, l) {
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
 * hex에 RGB 배수 틴트를 곱한 뒤 hex로 반환한다.
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

/**
 * 0~100 점수를 0~1로 정규화한다.
 * @param {number} score
 * @returns {number}
 */
const norm = (score) => clamp(score ?? 0, 0, 100) / 100;

// =============================================================================
// ② 패널별 반응 가중치 행렬 (svg-engine/color-calculator.js PANEL_WEIGHTS와 동일)
//    1.0 = 표준 / >1.0 = 민감 / <1.0 = 둔감
// =============================================================================

export const PANEL_WEIGHTS = [
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

/** 파라미터별 최대 노이즈 크기 (svg-engine/color-calculator.js NOISE_AMP와 동일) */
const NOISE_AMP = {
  hue: 4.0, sat: 0.04, light: 0.03, temp: 80,
};

// =============================================================================
// ③ emotion-engine 인덱스(0~11) ↔ SVG spot-XX 매핑
//    (svg-engine/color-calculator.js SVG_ID_MAP과 동일)
// =============================================================================

export const SVG_ID_MAP = [
  'spot-04', // 0  간절곶 일출
  'spot-01', // 1  대왕암공원
  'spot-06', // 2  강동 몽돌해변
  'spot-09', // 3  장생포 고래문화마을
  'spot-10', // 4  외고산 옹기마을
  'spot-05', // 5  반구대 암각화
  'spot-11', // 6  대운산 내원암 계곡
  'spot-08', // 7  울산대교
  'spot-07', // 8  울산대공원
  'spot-00', // 9  태화강 국가정원·십리대숲
  'spot-03', // 10 신불산 억새평원
  'spot-02', // 11 가지산 사계
];

/** 경승지 이름 (emotion-engine 인덱스 순서) */
export const SPOT_NAMES = [
  '간절곶 일출', '대왕암공원', '강동 몽돌해변', '장생포 고래문화마을',
  '외고산 옹기마을', '반구대 암각화', '대운산 내원암 계곡', '울산대교',
  '울산대공원', '태화강 국가정원·십리대숲', '신불산 억새평원', '가지산 사계',
];

// =============================================================================
// ④ 결정론적 미세 노이즈 생성기
//    (svg-engine/color-calculator.js noiseValue와 동일 — 동일 입력 → 동일 출력)
// =============================================================================

/**
 * 다양성 시드 + 패널/파라미터 인덱스로 -1~+1 노이즈를 생성한다.
 * @param {number} seed
 * @param {number} panelIndex
 * @param {number} paramIndex
 * @returns {number} -1 ~ +1
 */
export function noiseValue(seed, panelIndex, paramIndex) {
  let h = (seed ^ (panelIndex * 2654435761) ^ (paramIndex * 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0xFFFFFFFF) * 2 - 1;
}

// =============================================================================
// ⑤ 핵심 수식 — 감성 점수 → 6개 글로벌 색채 파라미터
//    (svg-engine/color-calculator.js computeGlobalParams와 동일)
// =============================================================================

/**
 * @typedef {Object} GlobalColorParams
 * @property {number} deltaHue      색조 이동량 (°, -25~+25)
 * @property {number} deltaSat      채도 배수 (×, 0.50~1.45)
 * @property {number} deltaLight    명도 조정량 (-0.20~+0.20)
 * @property {number} deltaContrast 명암대비 배수 (×, 0.65~1.45)
 * @property {number} colorTemp     색온도 오프셋 (K, -1500~+1500)
 * @property {number} lightDir      광원 방향 (°, -35~+35)
 * @property {{ r:number, g:number, b:number }} rgbTint  색온도 RGB 배수
 */

/**
 * 8차원 감성 점수에서 6개 글로벌 색채 파라미터를 계산한다.
 *
 * @param {Object} emotionScores  8차원 감성 점수 (각 0~100)
 * @returns {GlobalColorParams}
 *
 * @example
 * const gp = computeGlobalParams({
 *   amazement: 80, peace: 30, vitality: 60, nostalgia: 20,
 *   freshness: 40, grandeur: 50, warmth: 70, mystery: 25,
 * });
 * // gp.deltaHue  → +6.2  (따뜻한 방향 색조 이동)
 * // gp.deltaSat  → 1.21  (비비드한 채도)
 */
export function computeGlobalParams(emotionScores) {
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
  const deltaHue = clamp(
    (E.warmth    - E.freshness) * 18
  + (E.nostalgia - E.amazement) *  8
  +  E.mystery                  * 12
  -  6,
    -25, 25,
  );

  // ΔSat: 경이·활기 → 비비드 / 평화·향수 → 뮤트
  const deltaSat = clamp(
    0.70
  + (E.amazement + E.vitality)  * 0.30
  - (E.peace     + E.nostalgia) * 0.18
  +  E.grandeur                 * 0.08,
    0.50, 1.45,
  );

  // ΔLight: 활기·신선 → 밝게 / 웅장·신비 → 어둡게
  const deltaLight = clamp(
    (E.vitality + E.freshness) *  0.14
  - (E.grandeur + E.mystery)   *  0.12
  +  E.warmth                  *  0.05
  -  0.03,
    -0.20, +0.20,
  );

  // ΔContrast: 경이·웅장 → 하이콘트라스트 / 평화·향수 → 소프트
  const deltaContrast = clamp(
    0.80
  + (E.amazement + E.grandeur)  * 0.28
  - (E.peace     + E.nostalgia) * 0.15
  +  E.mystery                  * 0.10,
    0.65, 1.45,
  );

  // ColorTemp: 따뜻함↑ → 골든/앰버, 향수↑ → 세피아, 신비↑ → 약간 차갑게
  const colorTemp = clamp(
    (E.warmth    - E.freshness) * 1400
  +  E.nostalgia                *  700
  -  E.mystery                  *  350,
    -1500, 1500,
  );

  // LightDir: 따뜻↔청량 + 활기↔평화
  const lightDir = clamp(
    (E.warmth   - E.freshness) * 25
  + (E.vitality - E.peace)     * 10,
    -35, 35,
  );

  // RGB 틴트 파생 (colorTemp → R/G/B 배수)
  const n = clamp(colorTemp / 1500, -1, 1);
  const rgbTint = {
    r: clamp(1.0 + n *  0.14, 0.80, 1.20),
    g: clamp(1.0 + n *  0.05, 0.90, 1.10),
    b: clamp(1.0 - n *  0.18, 0.70, 1.25),
  };

  return { deltaHue, deltaSat, deltaLight, deltaContrast, colorTemp, lightDir, rgbTint };
}

// =============================================================================
// ⑥ 단일 색상 요소에 delta 적용 (SVG 현재 색상 기준)
//    (svg-engine/color-calculator.js applyDeltaToHex와 동일 수식)
// =============================================================================

/**
 * SVG에서 읽은 현재 hex 색상에 감성 delta(글로벌 파라미터 × 패널 가중치
 * + 패널 단위 노이즈 + 색온도 틴트)를 적용한 새 hex를 반환한다.
 *
 * main/sub/acc 역할 구분이 없으므로, 'spot-{idx}-{n}'의 모든 n에
 * 대해 이 함수를 동일하게 호출한다. 노이즈는 패널 단위(panelIndex)로
 * 공유되어, 패널 내 모든 요소가 같은 비율로 이동한다.
 *
 * @param {string} currentHex   SVG에서 읽은 현재 색상 ('#RRGGBB')
 * @param {number} panelIndex   emotion-engine 인덱스 (0~11)
 * @param {GlobalColorParams} gp  computeGlobalParams() 결과
 * @param {number} [diversitySeed=0]  다양성 시드
 * @returns {string}  delta 적용 후 hex ('#RRGGBB')
 *
 * @example
 * const gp = computeGlobalParams(emotionScores);
 * const newHex = applyDeltaToHex('#FF6635', 0, gp, diversitySeed);
 */
export function applyDeltaToHex(currentHex, panelIndex, gp, diversitySeed = 0) {
  const i   = clamp(Math.round(panelIndex), 0, 11);
  const w   = PANEL_WEIGHTS[i];
  const cur = hexToHsl(currentHex);

  // ── 방안B: 원본 색 특성 기반 보호 스케일링 ──────────────────────
  //
  // ① Hue 보호 — 원본 채도가 낮을수록 색조 이동을 줄인다.
  //    무채색(s≈0)에서 Hue를 크게 이동하면 완전히 다른 색이 나오므로
  //    채도에 비례해 Hue 이동량을 감쇠한다.
  //    s=0.0 → hueScale=0.0 (Hue 고정)
  //    s=0.4 → hueScale=0.7
  //    s=0.8 → hueScale=1.0 (원래대로)
  const hueScale = clamp(cur.s / 0.8, 0.0, 1.0);

  // ② 채도 보호 — 원본이 이미 고채도(s > 0.65)이면 채도 증가를 억제한다.
  //    원색 계열에서 deltaSat > 1이면 과포화되므로 동적으로 캡핑한다.
  //    고채도일수록 deltaSat를 1.0에 가깝게 압축한다.
  const satProtect  = clamp((cur.s - 0.65) / 0.35, 0.0, 1.0); // 0.65~1.0 구간에서 0→1
  const satEffective = gp.deltaSat > 1.0
    ? 1.0 + (gp.deltaSat - 1.0) * (1.0 - satProtect * 0.80)   // 증가 억제
    : gp.deltaSat;

  // ③ 명도 극단 보호 — 매우 밝거나(l>0.85) 어두운(l<0.15) 색은
  //    명도 변화가 크면 디테일이 소실되므로 변화량을 30% 수준으로 감쇠한다.
  const lightScale = (cur.l < 0.15 || cur.l > 0.85) ? 0.30 : 1.0;

  // ④ 패널 가중치 상한 캡 — 과도한 패널 반응(원래 최대 1.60) 억제
  const wHue   = Math.min(w.hue,   1.25);
  const wSat   = Math.min(w.sat,   1.25);
  const wLight = Math.min(w.light, 1.20);

  // ── 최종 HSL 계산 ────────────────────────────────────────────────

  // 색조: Hue 보호 스케일 적용
  const finalH = wrapHue(
    cur.h
    + gp.deltaHue * wHue * hueScale
    + noiseValue(diversitySeed, i, 0) * NOISE_AMP.hue * hueScale,
  );

  // 채도: 채도 보호 스케일 적용
  const finalS = clamp(
    cur.s * Math.pow(satEffective, wSat)
    + noiseValue(diversitySeed, i, 1) * NOISE_AMP.sat,
    0.05, 1.0,
  );

  // 명도: 명도 극단 보호 스케일 적용
  const finalL = clamp(
    cur.l
    + gp.deltaLight * wLight * lightScale
    + noiseValue(diversitySeed, i, 2) * NOISE_AMP.light * lightScale,
    0.08, 0.92,
  );

  // 색온도 틴트 적용
  const raw = hslToHex(finalH, finalS, finalL);
  return applyTintToHex(raw, gp.rgbTint);
}

// =============================================================================
// ⑦ 색온도 → CSS filter 변환
//    (svg-engine/color-calculator.js colorTempToFilter와 동일)
// =============================================================================

/**
 * 색온도 오프셋(K)을 CSS filter 문자열로 변환한다.
 * #svg-container에 적용하여 전체 이미지에 색온도 틴트를 더한다.
 *
 * @param {number} colorTemp  색온도 오프셋 (-1500 ~ +1500K)
 * @returns {string}  CSS filter 값 (필터 불필요 시 '')
 *
 * @example
 * colorTempToFilter(800);   // → 'sepia(0.27) saturate(1.16)'
 * colorTempToFilter(-600);  // → 'hue-rotate(-8deg) saturate(0.94)'
 * colorTempToFilter(50);    // → ''
 */
export function colorTempToFilter(colorTemp) {
  const THRESHOLD = 80;

  if (Math.abs(colorTemp ?? 0) < THRESHOLD) return '';

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
// Default Export
// =============================================================================

export default {
  computeGlobalParams,
  applyDeltaToHex,
  colorTempToFilter,
  hexToHsl,
  hslToHex,
  noiseValue,
  PANEL_WEIGHTS,
  SVG_ID_MAP,
  SPOT_NAMES,
};
