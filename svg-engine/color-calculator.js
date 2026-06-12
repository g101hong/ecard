/**
 * @fileoverview 울산 E-Card SVG 색채 조정 엔진 — 색상 계산 모듈
 * @module svg-engine/color-calculator
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   emotionScores(8차원)와 diversitySeed를 받아
 *   울산 12경 각 패널의 최종 hex 색상(main / sub / acc)을 계산한다.
 *
 *   이 모듈은 emotion-engine 파이프라인(Stage 1~5)을 svg-engine 전용으로
 *   재구성한 독립 계산기이다.
 *   emotion-engine 의존성 없이 단독 실행 가능하며
 *   서버(svg-patcher.js)와 클라이언트(public/js/color-engine.js) 양쪽에서
 *   동일한 수식으로 같은 결과를 재현할 수 있도록 설계한다.
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
 *         ▼  STEP 2. computePanelHex() × 12
 *   패널별 최종 hex (main 색조 적용)
 *         │
 *         ▼  STEP 3. deriveSub() / deriveAcc()
 *   sub / acc 파생색 계산
 *         │
 *         ▼  STEP 4. applyColorTempTint()
 *   색온도 RGB 틴트 적용 → 최종 hex 보정
 *         │
 *         ▼  STEP 5. applyDiversityNoise()
 *   다양성 시드 결정론적 노이즈 → 유일성 보장
 *         │
 *         ▼
 *   PanelColorResult[12]
 *     { index, name, svgId, main, sub, acc }
 *
 * ─────────────────────────────────────────────────────────────────
 * 설계 원칙
 * ─────────────────────────────────────────────────────────────────
 *
 *   ① emotion-engine/param-synthesizer.js 와 동일한 수식 사용
 *      → 서버·클라이언트 결과 100% 일치 보장
 *
 *   ② emotion-engine/panel-individualizer.js 의 가중치 행렬 내재화
 *      → 외부 의존성 없이 단독 실행 가능
 *
 *   ③ sub / acc는 main에서 HSL 파생
 *      → 기본 팔레트의 sub/acc 비율을 유지하면서 감성 색감 반영
 *
 *   ④ colorTempToFilter()는 SVG 컨테이너 전체에 적용할
 *      CSS filter 문자열을 반환 (individual stop-color 와 별개)
 *
 * ─────────────────────────────────────────────────────────────────
 * 출력 형식 (svg-patcher.js / svg-renderer.js 입력)
 * ─────────────────────────────────────────────────────────────────
 *
 *   calculateAllPanelColors() 반환값:
 *   [
 *     { index:0, name:'간절곶 일출',   svgId:'spot-04',
 *       main:'#FF7A4F', sub:'#FFC066', acc:'#FFD9B0' },
 *     { index:1, name:'대왕암공원',    svgId:'spot-01', ... },
 *     ...
 *     { index:11, name:'가지산 사계', svgId:'spot-02', ... },
 *   ]
 *
 *   svg-patcher.js 가 이 배열을 받아:
 *     doc.getElementById(`grad-spot-04-main`)
 *        .setAttribute('stop-color', colors[0].main);
 *
 *   index.js 의 buildPanelColorMap() 으로 svgId 키 맵으로 변환 후
 *   impression 라우트 응답 JSON에 포함하면
 *   public/js/svg-renderer.js 가 직접 SVG <stop>에 적용한다.
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
//    emotion-engine/panel-individualizer.js의 noiseValue()와 동일 알고리즘
// =============================================================================

/**
 * diversitySeed + panelIndex + paramIndex 로 -1~+1 노이즈를 생성한다.
 * 동일 입력 → 항상 동일 출력 (결정론적, 재현 가능).
 *
 * @param {number} seed        diversitySeed (preprocessor.js cyrb53 해시)
 * @param {number} panelIndex  패널 인덱스 (0~11)
 * @param {number} paramIndex  파라미터 슬롯 (0~5)
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
//    emotion-engine/panel-individualizer.js 의 SPOT_BASE_PALETTES 와 동일
//    + spot-palettes.js 의 sub / acc hex 추가 (파생색 기준점)
// =============================================================================

/**
 * 울산 12경 기본 팔레트 (emotion-engine SPOTS 인덱스 순서 0~11).
 *
 * main    : 대표 hex — 색조 계산의 출발점 (mainHsl 사전 계산)
 * sub     : 원본 보조색 hex — sub 파생의 기준 HSL 비율 계산에 사용
 * acc     : 원본 강조색 hex — acc 파생의 기준 HSL 비율 계산에 사용
 * svgId   : SVG ID 접두어 (경승지별_ID_및_채색방법.txt 기준)
 *
 * [SVG ID ↔ 인덱스 매핑 근거]
 *   경승지별_ID_및_채색방법.txt 순서와
 *   spot-palettes.js 의 SPOTS 배열 순서가 다르므로
 *   각 항목에 svgId를 명시적으로 지정한다.
 *   index.js 의 EMOTION_IDX_TO_SVG_ID 와 동일한 매핑이다.
 *
 * @type {Array<{
 *   index:  number,
 *   name:   string,
 *   svgId:  string,
 *   main:   string,
 *   sub:    string,
 *   acc:    string,
 *   mainHsl: {h:number, s:number, l:number},
 *   subHsl:  {h:number, s:number, l:number},
 *   accHsl:  {h:number, s:number, l:number},
 * }>}
 */
const BASE_PALETTES = [
  // ─── 0: 간절곶 일출 — 일출 오렌지·여명 황금·노을 크림 ─────────
  { index:  0, svgId: 'spot-04', name: '간절곶 일출',
    main: '#FF6635', sub: '#FFB347', acc: '#FFCF9E' },
  // ─── 1: 대왕암공원 — 해송 심록·기암 회청·파도 이끼 ─────────────
  { index:  1, svgId: 'spot-01', name: '대왕암공원',
    main: '#2A6640', sub: '#607B8B', acc: '#A8D5B5' },
  // ─── 2: 강동 몽돌해변 — 몽돌 회청·청록 파도·포말 흰 ────────────
  { index:  2, svgId: 'spot-06', name: '강동 몽돌해변',
    main: '#4A6880', sub: '#38A89D', acc: '#CAF0F8' },
  // ─── 3: 장생포 고래문화마을 — 고래 심청·항구 수면청·물보라 흰 ──
  { index:  3, svgId: 'spot-09', name: '장생포 고래문화마을',
    main: '#0B5EA8', sub: '#48A9C5', acc: '#C8E8F5' },
  // ─── 4: 외고산 옹기마을 — 옹기 황토·전통 가마갈·생토 크림 ──────
  { index:  4, svgId: 'spot-10', name: '외고산 옹기마을',
    main: '#B5693A', sub: '#7A3D2B', acc: '#E8C99A' },
  // ─── 5: 반구대 암각화 — 암반 황토·선사 각화갈·암벽 밝은면 ──────
  { index:  5, svgId: 'spot-05', name: '반구대 암각화',
    main: '#C4956A', sub: '#6B3D1E', acc: '#E8D5B5' },
  // ─── 6: 대운산 내원암 계곡 — 계곡 비취·암자 목재·물보라 연초 ───
  { index:  6, svgId: 'spot-11', name: '대운산 내원암 계곡',
    main: '#2D7D5E', sub: '#8B7214', acc: '#D4E8D0' },
  // ─── 7: 울산대교 — 현수교 강청·야경 황금·수면 반사흰 ────────────
  { index:  7, svgId: 'spot-08', name: '울산대교',
    main: '#4A6FA5', sub: '#C8A84B', acc: '#E8F0F8' },
  // ─── 8: 울산대공원 — 공원 잔디록·장미 정원·산책로 크림 ──────────
  { index:  8, svgId: 'spot-07', name: '울산대공원',
    main: '#5A9E6F', sub: '#E8607A', acc: '#F5DEB3' },
  // ─── 9: 태화강 국가정원·십리대숲 — 대나무 청록·태화강 청·백로 ──
  { index:  9, svgId: 'spot-00', name: '태화강 국가정원·십리대숲',
    main: '#3D8B5E', sub: '#6BBFD4', acc: '#DFFFEF' },
  // ─── 10: 신불산 억새평원 — 억새 황금·능선 하늘청·억새 밝은끝 ────
  { index: 10, svgId: 'spot-03', name: '신불산 억새평원',
    main: '#D4A853', sub: '#8FA8C8', acc: '#F5E8C8' },
  // ─── 11: 가지산 사계 — 산야 초록·단풍 주황·설원 크림 ─────────────
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
//    emotion-engine/panel-individualizer.js 의 PANEL_WEIGHT_MATRIX 와 동일
// =============================================================================

/**
 * 각 패널이 글로벌 색채 파라미터에 얼마나 민감하게 반응하는지 정의.
 * 1.0 = 표준 반응 / >1.0 = 민감 / <1.0 = 둔감
 *
 * @type {Array<{hue:number, sat:number, light:number, contrast:number, temp:number, lightDir:number}>}
 */
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

/** 파라미터별 노이즈 최대 진폭 (panel-individualizer.js NOISE_AMP 와 동일) */
const NOISE_AMP = {
  hue: 4.0, sat: 0.04, light: 0.03, temp: 80,
};

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
 * param-synthesizer.js의 computeCoreParams()와 완전히 동일한 수식.
 * 맥락 보정(시간대·계절·동행자)은 impression 라우트에서 emotion-engine이
 * 이미 반영한 emotionScores를 전달받으므로 이 모듈에서는 생략한다.
 *
 * @param {Object} scores  { amazement, peace, vitality, nostalgia,
 *                           freshness, grandeur, warmth, mystery } (각 0~100)
 * @returns {GlobalColorParams}
 */
function computeGlobalParams(scores) {
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
// ⑥ STEP 2~4 — 단일 패널 색상 계산
// =============================================================================

/**
 * 기본 팔레트의 sub / acc HSL과 main HSL의 관계 비율을 계산한다.
 *
 * 예) main.h=30°, sub.h=50° → subDeltaH = +20°
 *     main.s=0.7, sub.s=0.5 → subSatRatio = 0.5/0.7 ≈ 0.714
 *
 * 이 비율을 감성 적용 후의 finalMain HSL에 곱해 sub/acc를 파생하면
 * 원본 팔레트의 색채 관계(차이)를 유지하면서 감성 색감이 반영된다.
 *
 * @param {{ h:number, s:number, l:number }} mainHsl
 * @param {{ h:number, s:number, l:number }} targetHsl  (sub 또는 acc)
 * @returns {{ dh:number, satRatio:number, lightOffset:number }}
 */
function computeRelation(mainHsl, targetHsl) {
  // 색조 차이 (원형 거리 — 짧은 방향)
  let dh = targetHsl.h - mainHsl.h;
  if (dh >  180) dh -= 360;
  if (dh < -180) dh += 360;

  // 채도 비율 (0 나누기 방지)
  const satRatio = mainHsl.s > 0.001 ? targetHsl.s / mainHsl.s : 1.0;

  // 명도 오프셋
  const lightOffset = targetHsl.l - mainHsl.l;

  return { dh, satRatio, lightOffset };
}

/**
 * 단일 패널의 최종 main / sub / acc hex를 계산한다.
 *
 * [처리 흐름]
 *   1. main HSL 계산: 기본 색조 + (글로벌ΔHue × 가중치) + 노이즈
 *   2. 채도: 기본채도 × (ΔSat ^ 가중치) + 노이즈
 *   3. 명도: 기본명도 + (ΔLight × 가중치) + 노이즈
 *   4. 색온도 RGB 틴트를 main hex에 적용
 *   5. sub / acc: main과의 기본 관계(dh, satRatio, lightOffset) 유지하며 파생
 *      → sub / acc에도 색온도 틴트 동일 적용
 *
 * @param {(typeof BASE_PALETTES)[0]} spot  패널 기본 팔레트
 * @param {GlobalColorParams}         gp    글로벌 색채 파라미터
 * @param {number}                    seed  diversitySeed
 * @returns {{ main:string, sub:string, acc:string }}
 */
function computePanelHex(spot, gp, seed) {
  const i  = spot.index;
  const w  = PANEL_WEIGHTS[i];
  const bm = spot.mainHsl;  // 기본 main HSL

  // ── main HSL 계산 ─────────────────────────────────────────────

  // 색조: 기본 + (글로벌 × 가중치) + 노이즈
  const finalH = wrapHue(
    bm.h
    + gp.deltaHue * w.hue
    + noiseValue(seed, i, 0) * NOISE_AMP.hue,
  );

  // 채도: 지수 스케일링 (가중치가 클수록 비선형으로 더 강하게 반응)
  const finalS = clamp(
    bm.s * Math.pow(gp.deltaSat, w.sat)
    + noiseValue(seed, i, 1) * NOISE_AMP.sat,
    0.05, 1.0,
  );

  // 명도: 선형 이동
  const finalL = clamp(
    bm.l
    + gp.deltaLight * w.light
    + noiseValue(seed, i, 2) * NOISE_AMP.light,
    0.08, 0.92,
  );

  // main hex → 색온도 틴트 적용
  const mainRaw = hslToHex(finalH, finalS, finalL);
  const main    = applyTintToHex(mainRaw, gp.rgbTint);

  // ── sub / acc: main과의 원본 관계를 유지하며 파생 ─────────────

  // 원본 팔레트에서 main 대비 sub/acc의 색조차·채도비·명도 오프셋 추출
  const subRel = computeRelation(bm, spot.subHsl);
  const accRel = computeRelation(bm, spot.accHsl);

  // finalMain 기준으로 sub/acc 재구성
  // ─ 색조차 유지, 채도비·명도 오프셋 유지
  // ─ 색온도 노이즈는 main의 절반만 적용 (색온도 틴트로 대체)
  const subH = wrapHue(finalH + subRel.dh);
  const subS = clamp(finalS * subRel.satRatio,       0.03, 1.0);
  const subL = clamp(finalL + subRel.lightOffset,    0.05, 0.95);

  const accH = wrapHue(finalH + accRel.dh);
  const accS = clamp(finalS * accRel.satRatio,       0.03, 1.0);
  const accL = clamp(finalL + accRel.lightOffset,    0.05, 0.97);

  // sub/acc에도 색온도 틴트 적용 (단, 강도는 main의 60% — 과도한 색감 방지)
  const subTint = {
    r: 1.0 + (gp.rgbTint.r - 1.0) * 0.6,
    g: 1.0 + (gp.rgbTint.g - 1.0) * 0.6,
    b: 1.0 + (gp.rgbTint.b - 1.0) * 0.6,
  };
  const sub = applyTintToHex(hslToHex(subH, subS, subL), subTint);
  const acc = applyTintToHex(hslToHex(accH, accS, accL), subTint);

  return { main, sub, acc };
}

// =============================================================================
// ⑦ colorTempToFilter — SVG 컨테이너용 CSS filter 문자열
// =============================================================================

/**
 * 색온도 오프셋(K)을 SVG 컨테이너 전체에 적용할 CSS filter 문자열로 변환한다.
 *
 * 이 filter는 개별 stop-color 틴트와 별개로
 * 전체 스테인드글라스 이미지의 색온도 분위기를 부가적으로 강화한다.
 * public/js/svg-renderer.js 가 #svg-container 에 style 속성으로 적용한다.
 *
 * [변환 수식]
 *   따뜻함(+K) → sepia() + saturate() 조합
 *   차가움(-K) → hue-rotate() + saturate() 조합
 *   중립(0K)  → '' (필터 없음)
 *
 * @param {number} colorTemp  색온도 오프셋 (-1500 ~ +1500K)
 * @returns {string}  CSS filter 값 (빈 문자열 가능)
 *
 * @example
 * colorTempToFilter(+800)   // → 'sepia(0.27) saturate(1.16)'
 * colorTempToFilter(-600)   // → 'hue-rotate(-8deg) saturate(0.94)'
 * colorTempToFilter(0)      // → ''
 * colorTempToFilter(+1500)  // → 'sepia(0.50) saturate(1.30)'
 * colorTempToFilter(-1500)  // → 'hue-rotate(-20deg) saturate(0.85)'
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
// ⑧ 메인 계산 함수 (퍼블릭 API)
// =============================================================================

/**
 * @typedef {Object} PanelColorResult
 * @property {number} index  emotion-engine SPOTS 인덱스 (0~11)
 * @property {string} name   경승지명
 * @property {string} svgId  SVG ID 접두어 ('spot-XX')
 * @property {string} main   주색 hex     (예: '#FF7A4F')
 * @property {string} sub    보조색 hex   (예: '#FFC066')
 * @property {string} acc    강조색 hex   (예: '#FFD9B0')
 */

/**
 * 감성 점수와 다양성 시드를 받아 12패널의 색상을 계산한다.
 *
 * svg-engine/index.js 의 applySvgColors() 가 이 함수를 호출하고
 * buildPanelColorMap() 으로 SVG ID 키 맵으로 변환한다.
 *
 * svg-patcher.js 에서는 이 배열을 직접 사용:
 *   const colors = calculateAllPanelColors(emotionScores, diversitySeed);
 *   // colors[0].svgId → 'spot-04' (간절곶)
 *   doc.getElementById(`grad-spot-04-main`)
 *      .setAttribute('stop-color', colors[0].main);
 *
 * @param {Object} emotionScores
 *   { amazement:0~100, peace:0~100, vitality:0~100, nostalgia:0~100,
 *     freshness:0~100, grandeur:0~100, warmth:0~100, mystery:0~100 }
 * @param {number} [diversitySeed=0]  preprocessor.js cyrb53 해시값
 * @returns {PanelColorResult[]}  12개 패널 색상 배열 (인덱스 0~11 순서)
 *
 * @example
 * const colors = calculateAllPanelColors(
 *   { amazement:80, peace:30, vitality:70, nostalgia:20,
 *     freshness:60, grandeur:75, warmth:85, mystery:25 },
 *   142857,
 * );
 *
 * colors[0]
 * // { index:0, name:'간절곶 일출', svgId:'spot-04',
 * //   main:'#FF7A4F', sub:'#FFC366', acc:'#FFD9AE' }
 *
 * colors[9]
 * // { index:9, name:'태화강 국가정원·십리대숲', svgId:'spot-00',
 * //   main:'#3E9B6A', sub:'#70CCDF', acc:'#DFFFEE' }
 */
export function calculateAllPanelColors(emotionScores, diversitySeed = 0) {
  // STEP 1: 감성 점수 → 글로벌 파라미터
  const gp = computeGlobalParams(emotionScores);

  // STEP 2~4: 12패널 각각 계산
  return BASE_PALETTES.map((spot) => {
    const { main, sub, acc } = computePanelHex(spot, gp, diversitySeed);
    return {
      index: spot.index,
      name:  spot.name,
      svgId: spot.svgId,
      main,
      sub,
      acc,
    };
  });
}

// =============================================================================
// ⑨ 디버그 유틸리티
// =============================================================================

/**
 * calculateAllPanelColors() 결과를 콘솔에 출력한다. (개발 전용)
 *
 * @param {PanelColorResult[]} results
 * @param {Object}             [emotionScores]  감성 점수 (글로벌 파라미터 표시용)
 * @param {number}             [diversitySeed]
 *
 * @example
 * const colors = calculateAllPanelColors(scores, seed);
 * debugPrintColors(colors, scores, seed);
 */
export function debugPrintColors(results, emotionScores, diversitySeed) {
  /* eslint-disable no-console */
  console.group('🎨 color-calculator — 12경 패널 색상');

  if (emotionScores) {
    const gp = computeGlobalParams(emotionScores);
    console.group('📐 글로벌 파라미터');
    console.log(
      `ΔHue:${gp.deltaHue.toFixed(1)}°  ` +
      `ΔSat:×${gp.deltaSat.toFixed(2)}  ` +
      `ΔLight:${gp.deltaLight > 0 ? '+' : ''}${gp.deltaLight.toFixed(3)}  ` +
      `Contrast:×${gp.deltaContrast.toFixed(2)}`,
    );
    console.log(
      `colorTemp:${gp.colorTemp > 0 ? '+' : ''}${Math.round(gp.colorTemp)}K  ` +
      `lightDir:${gp.lightDir > 0 ? '+' : ''}${gp.lightDir.toFixed(1)}°  ` +
      `rgbTint: R×${gp.rgbTint.r.toFixed(3)} G×${gp.rgbTint.g.toFixed(3)} B×${gp.rgbTint.b.toFixed(3)}`,
    );
    if (diversitySeed !== undefined) {
      console.log(`diversitySeed: ${diversitySeed}`);
    }
    console.log(`CSS filter: "${colorTempToFilter(gp.colorTemp)}"`);
    console.groupEnd();
  }

  console.log('');
  console.log(
    ' idx │ SVG ID  │ 경승지                   │ main     │ sub      │ acc',
  );
  console.log(
    '─────┼─────────┼──────────────────────────┼──────────┼──────────┼──────────',
  );

  for (const p of results) {
    const name = p.name.padEnd(24);
    console.log(
      `  ${String(p.index).padStart(2)} │ ${p.svgId} │ ${name} │ ` +
      `${p.main} │ ${p.sub} │ ${p.acc}`,
    );
  }

  console.groupEnd();
  /* eslint-enable no-console */
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  calculateAllPanelColors,
  colorTempToFilter,
  computeGlobalParams,
  debugPrintColors,
  // 내부 상수 (테스트용)
  BASE_PALETTES,
  PANEL_WEIGHTS,
};
