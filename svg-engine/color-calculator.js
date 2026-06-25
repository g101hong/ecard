/**
 * @fileoverview 울산 E-Card SVG 색채 조정 엔진 — 색상 계산 모듈
 * @module svg-engine/color-calculator
 * @version 2.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   emotionScores(8차원, 0~100)를 받아 6개의 색채 파라미터(GlobalColorParams)를
 *   계산하고, 각 hex 색상에 감성 delta를 적용한다.
 *
 *   현재 사용처: svg-engine/index.js → color-calculator 상수 재노출
 *   (SVG_ID_MAP, SPOT_NAMES 등)
 *
 * ─────────────────────────────────────────────────────────────────
 * 계산 파이프라인
 * ─────────────────────────────────────────────────────────────────
 *
 *   emotionScores (8차원 0~100)
 *         │
 *         ▼  STEP 1. computeGlobalParams()
 *   GlobalColorParams (6개 색채 파라미터)
 *     ΔHue / ΔSat / ΔLight / ΔContrast / colorTemp / lightDir
 *         │
 *         ▼  STEP 2. applyDeltaToHex() — hex에 delta 적용
 *   최종 hex (색온도 틴트 포함)
 *
 * ─────────────────────────────────────────────────────────────────
 * 설계 원칙
 * ─────────────────────────────────────────────────────────────────
 *
 *   ① 색상 상수(BASE_PALETTES)를 갖지 않는다 — hex는 호출부에서 전달
 *   ② PANEL_WEIGHTS로 패널별 개성 부여 + diversitySeed로 입력별 유일성 보장
 *   ③ main/sub/acc 역할 구분 없음 — 동일 delta를 모든 색상 요소에 적용
 *
 * ─────────────────────────────────────────────────────────────────
 * 사용 방식
 * ─────────────────────────────────────────────────────────────────
 *
 *   const gp = computeGlobalParams(emotionScores);
 *
 *   // 색상 요소별로:
 *   for (const el of elements) {
 *     const currentHex = readColor(el);   // fill 또는 stop-color
 *     const newHex = applyDeltaToHex(currentHex, idx, gp, diversitySeed);
 *     writeColor(el, newHex);
 *   }
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
 * color-temperature tinting: 따뜻하면 R↑B↓, 차가우면 R↓B↑
 *
 * @param {string} hex    원본 hex
 * @param {{ r:number, g:number, b:number }} tint  각 채널 배수 (1.0 기준)
 * @returns {string}  보정된 hex
 */
function applyTintToHex(hex, tint) {
  const r = clamp(Math.round(parseInt(hex.slice(1, 3), 16) * tint.r), 0, 255);
  const g = clamp(Math.round(parseInt(hex.slice(3, 5), 16) * tint.g), 0, 255);
  const b = clamp(Math.round(parseInt(hex.slice(5, 7), 16) * tint.b), 0, 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// =============================================================================
// ② 결정론적 노이즈 생성기
// =============================================================================

/**
 * diversitySeed + panelIndex + paramIndex 로 -1~+1 노이즈를 생성한다.
 * 동일 입력 → 항상 동일 출력 (결정론적, 재현 가능).
 *
 * @param {number} seed        diversitySeed (preprocessor.js cyrb53 해시)
 * @param {number} panelIndex  패널 인덱스 (0~11)
 * @param {number} paramIndex  파라미터 슬롯
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
// ③ 패널별 반응 가중치 행렬 (패널 인덱스 0~11 기준 — 유지)
// =============================================================================

/**
 * 각 패널이 글로벌 색채 파라미터에 얼마나 민감하게 반응하는지 정의.
 * 1.0 = 표준 반응 / >1.0 = 민감 / <1.0 = 둔감
 *
 * 인덱스 순서는 emotion-engine SPOTS 인덱스(0~11)이며,
 * SVG의 spot-XX 번호와는 svgId 매핑(SVG_ID_MAP)을 통해 연결한다.
 *
 * @type {Array<{hue:number, sat:number, light:number, contrast:number, temp:number, lightDir:number}>}
 */
export const PANEL_WEIGHTS = [
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

/** 파라미터별 노이즈 최대 진폭 */
const NOISE_AMP = {
  hue: 4.0, sat: 0.04, light: 0.03, temp: 80,
};

// =============================================================================
// ④ emotion-engine 인덱스(0~11) ↔ SVG spot-XX 매핑
//    경승지별_ID_및_채색방법.txt 기준
// =============================================================================

/**
 * emotion-engine SPOTS 인덱스(0~11) → SVG spot-XX 번호
 * @type {string[]}
 */
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
// ⑤ STEP 1 — 감성 점수 → 글로벌 색채 파라미터
//    emotion-engine/param-synthesizer.js 의 computeCoreParams() 와 동일 수식
// =============================================================================

/**
 * @typedef {Object} GlobalColorParams
 * @property {number} deltaHue      색조 이동량 (°, -25~+25)
 * @property {number} deltaSat      채도 배수   (×, 0.50~1.45)
 * @property {number} deltaLight    명도 조정량 (-0.20~+0.20)
 * @property {number} deltaContrast 명암대비 배수 (×, 0.65~1.45)
 * @property {number} colorTemp     색온도 오프셋 (K, -1500~+1500)
 * @property {number} lightDir      광원 방향   (°, -35~+35)
 * @property {{ r:number, g:number, b:number }} rgbTint  색온도 RGB 배수
 */

/**
 * 8차원 감성 점수에서 6개 글로벌 색채 파라미터를 계산한다.
 *
 * @param {Object} scores  { amazement, peace, vitality, nostalgia,
 *                           freshness, grandeur, warmth, mystery } (각 0~100)
 * @returns {GlobalColorParams}
 */
export function computeGlobalParams(scores) {
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

  // ── ΔHue: 따뜻함↑→+°, 청량↑→-°, 신비→보라 ──────────────────
  const deltaHue = clamp(
    (E.warmth    - E.freshness) * 18
  + (E.nostalgia - E.amazement) *  8
  +  E.mystery                  * 12
  -  6,
    -25, 25,
  );

  // ── ΔSat: 경이·활기↑→비비드, 평화·향수↑→뮤트 ────────────────
  const deltaSat = clamp(
    0.70
  + (E.amazement + E.vitality)  * 0.30
  - (E.peace     + E.nostalgia) * 0.18
  +  E.grandeur                 * 0.08,
    0.50, 1.45,
  );

  // ── ΔLight: 활기·청량↑→밝게, 웅장·신비↑→어둡게 ──────────────
  const deltaLight = clamp(
    (E.vitality  + E.freshness) * 0.14
  - (E.grandeur  + E.mystery)   * 0.12
  +  E.warmth                   * 0.05
  -  0.03,
    -0.20, 0.20,
  );

  // ── ΔContrast: 경이·웅장↑→하이콘트라스트, 평화·향수↑→소프트 ──
  const deltaContrast = clamp(
    0.80
  + (E.amazement + E.grandeur)  * 0.28
  - (E.peace     + E.nostalgia) * 0.15
  +  E.mystery                  * 0.10,
    0.65, 1.45,
  );

  // ── colorTemp: 따뜻↑→황금빛(+K), 청량↑→청백(-K) ─────────────
  const colorTemp = clamp(
    (E.warmth - E.freshness) * 1400
  +  E.nostalgia             *  700
  -  E.mystery               *  350,
    -1500, 1500,
  );

  // ── lightDir: 따뜻↑→석양 방향, 청량↑→새벽 방향 ──────────────
  const lightDir = clamp(
    (E.warmth   - E.freshness) * 25
  + (E.vitality - E.peace)     * 10,
    -35, 35,
  );

  // ── RGB 틴트 파생 (colorTemp → R/G/B 배수) ────────────────────
  const n = clamp(colorTemp / 1500, -1, 1);
  const rgbTint = {
    r: clamp(1.0 + n *  0.14, 0.80, 1.20),
    g: clamp(1.0 + n *  0.05, 0.90, 1.10),
    b: clamp(1.0 - n *  0.18, 0.70, 1.25),
  };

  return { deltaHue, deltaSat, deltaLight, deltaContrast, colorTemp, lightDir, rgbTint };
}

// =============================================================================
// ⑥ STEP 2 — 단일 색상 요소에 delta 적용 (SVG 현재 색상 기준)
// =============================================================================

/**
 * SVG에서 읽은 현재 hex 색상에 감성 delta(글로벌 파라미터 × 패널 가중치
 * + 패널 단위 노이즈 + 색온도 틴트)를 적용한 새 hex를 반환한다.
 *
 * main/sub/acc 같은 색상 역할 구분이 없으므로, 'spot-{idx}-{n}'의
 * 모든 n에 대해 이 함수를 동일하게 호출한다 — 각 요소는 자신의
 * 현재 색(currentHex)에서 출발하여 동일한 비율(가중치·노이즈)만큼
 * 이동한다.
 *
 * 노이즈는 패널 단위로 공유한다 (panelIndex 기준 1세트).
 * 패널 내 여러 요소(n=1,2,3...)가 모두 "같은 감성, 같은 패널이므로
 * 같은 만큼 이동"하는 것이 자연스럽기 때문이다.
 *
 * @param {string} currentHex   SVG에서 읽은 현재 색상 ('#RRGGBB')
 * @param {number} panelIndex   emotion-engine 인덱스 (0~11) — 가중치/노이즈 기준
 * @param {GlobalColorParams} gp  computeGlobalParams() 결과
 * @param {number} [diversitySeed=0]  다양성 시드
 * @returns {string}  delta 적용 후 hex ('#RRGGBB')
 *
 * @example
 * const gp = computeGlobalParams(emotionScores);
 * const newHex = applyDeltaToHex('#FF6635', 0, gp, diversitySeed);
 * // → '#FF7A4F' (현재 색상 기준으로 이동된 결과)
 */
export function applyDeltaToHex(currentHex, panelIndex, gp, diversitySeed = 0) {
  const i   = clamp(Math.round(panelIndex), 0, 11);
  const w   = PANEL_WEIGHTS[i];
  const cur = hexToHsl(currentHex);

  // ── 원본 색 특성 기반 보호 스케일링 ──────────────────────
  //
  // ① Hue 보호 — 원본 채도가 낮을수록 색조 이동을 줄인다.
  //    무채색(s≈0)에서 Hue를 크게 이동하면 완전히 다른 색이 나오므로
  //    채도에 비례해 Hue 이동량을 감쇠한다.
  const hueScale = clamp(cur.s / 0.8, 0.0, 1.0);

  // ② 채도 보호 — 원본이 이미 고채도(s > 0.65)이면 채도 증가를 억제한다.
  //    고채도일수록 deltaSat를 1.0에 가깝게 압축한다.
  const satProtect   = clamp((cur.s - 0.65) / 0.35, 0.0, 1.0);
  const satEffective = gp.deltaSat > 1.0
    ? 1.0 + (gp.deltaSat - 1.0) * (1.0 - satProtect * 0.80)
    : gp.deltaSat;

  // ③ 명도 극단 보호 — 매우 밝거나(l>0.85) 어두운(l<0.15) 색은
  //    명도 변화를 30% 수준으로 감쇠한다.
  const lightScale = (cur.l < 0.15 || cur.l > 0.85) ? 0.30 : 1.0;

  // ④ 패널 가중치 상한 캡 — 과도한 패널 반응 억제
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
// ⑦ colorTempToFilter — SVG 컨테이너용 CSS filter 문자열
// =============================================================================

/**
 * 색온도 오프셋(K)을 SVG 컨테이너 전체에 적용할 CSS filter 문자열로 변환한다.
 *
 * @param {number} colorTemp  색온도 오프셋 (-1500 ~ +1500K)
 * @returns {string}  CSS filter 값 (빈 문자열 가능)
 *
 * @example
 * colorTempToFilter(+800)   // → 'sepia(0.27) saturate(1.16)'
 * colorTempToFilter(-600)   // → 'hue-rotate(-8deg) saturate(0.94)'
 * colorTempToFilter(0)      // → ''
 */
export function colorTempToFilter(colorTemp) {
  const THRESHOLD = 80;  // 이 이하는 중립으로 처리 (필터 불필요)

  if (Math.abs(colorTemp) < THRESHOLD) return '';

  // -1 ~ +1 정규화 (임계값 이후 구간만 사용)
  const n = clamp(colorTemp / 1500, -1, 1);

  if (n > 0) {
    // 따뜻함: sepia(따뜻한 앰버) + saturate(채도 살짝 부스트)
    const sepia    = +(n * 0.50).toFixed(2);       // 0 ~ 0.50
    const saturate = +(1.0 + n * 0.30).toFixed(2); // 1.00 ~ 1.30
    return `sepia(${sepia}) saturate(${saturate})`;
  } else {
    // 차가움: hue-rotate(청색 방향) + saturate(채도 살짝 감소)
    const rotate   = +(n * 20).toFixed(1);          // 0 ~ -20deg
    const saturate = +(1.0 + n * 0.15).toFixed(2);  // 1.00 ~ 0.85
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
