/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — 패널 개별화 모듈
 * @module emotion-engine/panel-individualizer
 *
 * ─────────────────────────────────────────────────────────────────
 * PIPELINE STAGE 4 : GlobalColorParams → 12 PanelColorParams
 * ─────────────────────────────────────────────────────────────────
 *
 * 역할:
 *   GlobalColorParams (전체 공통 파라미터)를 받아
 *   울산 12경 각 패널의 기본 색상 팔레트와 고유 반응 가중치를
 *   결합하여 패널별 최종 색채 파라미터를 생성한다.
 *
 *   ★ "같은 소감 → 하나하나가 다른 이미지"의 핵심 구현 ★
 *
 *   유일성 보장 메커니즘:
 *   ① 패널별 반응 가중치  — 같은 파라미터도 패널마다 다르게 반응
 *   ② 경승지 기본 팔레트  — 각 경승지의 고유 기본 색상에서 출발
 *   ③ 다양성 시드 노이즈  — 결정론적 미세 노이즈로 최종 유일성 보장
 *
 * 입력:  GlobalColorParams  (param-synthesizer.js 출력)
 *        diversitySeed      (preprocessor.js 생성 해시값)
 * 출력:  PanelColorSet      (12개 패널 각각의 최종 색채 파라미터)
 */
 
'use strict';
 
// =============================================================================
// ① 유틸리티 함수
// =============================================================================
 
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
 
const wrapHue = (h) => ((h % 360) + 360) % 360;
 
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l   = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6;               break;
    default:h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}
 
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h <  60 ? [c, x, 0] : h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] : h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
 
// =============================================================================
// ② 결정론적 미세 노이즈 생성기
// =============================================================================
 
/**
 * 다양성 시드 + 패널/파라미터 인덱스로 -1~+1 노이즈를 생성한다.
 * 같은 입력 → 항상 같은 출력 (결정론적)
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
// =============================================================================
 
const SPOT_BASE_PALETTES = [
  { index: 0,  name: '간절곶 일출',           main: '#FF6635', sub: '#FFB347', acc: '#FFCF9E' },
  { index: 1,  name: '대왕암공원',             main: '#2A6640', sub: '#607B8B', acc: '#A8D5B5' },
  { index: 2,  name: '강동 몽돌해변',          main: '#4A6880', sub: '#38A89D', acc: '#CAF0F8' },
  { index: 3,  name: '장생포 고래문화마을',    main: '#0B5EA8', sub: '#48A9C5', acc: '#C8E8F5' },
  { index: 4,  name: '외고산 옹기마을',        main: '#B5693A', sub: '#7A3D2B', acc: '#E8C99A' },
  { index: 5,  name: '반구대 암각화',          main: '#C4956A', sub: '#6B3D1E', acc: '#E8D5B5' },
  { index: 6,  name: '대운산 내원암 계곡',     main: '#2D7D5E', sub: '#8B7214', acc: '#D4E8D0' },
  { index: 7,  name: '울산대교',               main: '#4A6FA5', sub: '#C8A84B', acc: '#E8F0F8' },
  { index: 8,  name: '울산대공원',             main: '#5A9E6F', sub: '#E8607A', acc: '#F5DEB3' },
  { index: 9,  name: '태화강 국가정원·십리대숲', main: '#3D8B5E', sub: '#6BBFD4', acc: '#DFFFEF' },
  { index: 10, name: '신불산 억새평원',        main: '#D4A853', sub: '#8FA8C8', acc: '#F5E8C8' },
  { index: 11, name: '가지산 사계',            main: '#6B8F6E', sub: '#D4703A', acc: '#F5E6C8' },
].map((s) => ({ ...s, mainHsl: hexToHsl(s.main) }));
 
// =============================================================================
// ④ 패널별 반응 가중치 행렬
//    1.0 = 표준 / >1.0 = 민감 / <1.0 = 둔감
// =============================================================================
 
const PANEL_WEIGHT_MATRIX = [
  // index  경승지            hue   sat   light  contrast  temp   lightDir
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
 
/** 파라미터별 최대 노이즈 크기 */
const NOISE_AMP = {
  hue: 4.0, sat: 0.04, light: 0.03, contrast: 0.04, temp: 80, lightDir: 3.0,
};
 
// =============================================================================
// ⑤ 단일 패널 계산
// =============================================================================
 
function computePanelParams(spot, weights, globalParams, seed) {
  const base = spot.mainHsl;
  const i    = spot.index;
 
  // 색조: 기본 + (글로벌 × 가중치) + 노이즈
  const finalHue = wrapHue(
    base.h
    + globalParams.deltaHue  * weights.hue
    + noiseValue(seed, i, 0) * NOISE_AMP.hue
  );
 
  // 채도: 지수 스케일링 (반응성 클수록 비선형 변화)
  const finalSat = clamp(
    base.s * Math.pow(globalParams.deltaSat, weights.sat)
    + noiseValue(seed, i, 1) * NOISE_AMP.sat
    , 0.05, 1.0
  );
 
  // 명도
  const finalLight = clamp(
    base.l
    + globalParams.deltaLight * weights.light
    + noiseValue(seed, i, 2) * NOISE_AMP.light
    , 0.08, 0.92
  );
 
  // 명암대비
  const finalContrast = clamp(
    1.0 + (globalParams.deltaContrast - 1.0) * weights.contrast
    + noiseValue(seed, i, 3) * NOISE_AMP.contrast
    , 0.60, 1.55
  );
 
  // 색온도
  const finalColorTemp = clamp(
    globalParams.colorTemp * weights.temp
    + noiseValue(seed, i, 4) * NOISE_AMP.temp
    , -1500, 1500
  );
 
  // 광원 방향
  const finalLightDir = clamp(
    globalParams.lightDir * weights.lightDir
    + noiseValue(seed, i, 5) * NOISE_AMP.lightDir
    , -35, 35
  );
 
  // 파생값
  const hexColor = hslToHex(finalHue, finalSat, finalLight);
  const n = clamp(finalColorTemp / 1500, -1, 1);
  const rgbTint = {
    r: clamp(1.0 + n *  0.14, 0.80, 1.20),
    g: clamp(1.0 + n *  0.05, 0.90, 1.10),
    b: clamp(1.0 - n *  0.18, 0.70, 1.25),
  };
 
  return {
    finalHue, finalSat, finalLight,
    finalContrast, finalColorTemp, finalLightDir,
    hexColor,
    hsl: { h: finalHue, s: finalSat, l: finalLight },
    rgbTint,
    spotName:  spot.name,
    spotIndex: spot.index,
  };
}
 
// =============================================================================
// ⑥ 메인 개별화 함수
// =============================================================================
 
/**
 * GlobalColorParams를 12개 패널에 개별 적용하여 최종 색채 세트를 생성한다.
 *
 * @param {Object} globalParams    - param-synthesizer.js 출력
 * @param {number} diversitySeed  - preprocessor.js 다양성 시드
 * @param {number} matchedSpotIdx - ai-extractor.js 매칭 경승지 인덱스
 * @returns {Object} PanelColorSet
 *
 * @example
 * const set = individualizePanels(globalParams, 142857, 10);
 * set.panels[0].hexColor          // 간절곶 최종 색상
 * set.byName['울산대교'].finalHue  // 울산대교 최종 색조
 * set.matchedPanel.hexColor        // 매칭 패널 색상
 */

export function individualizePanels(globalParams, diversitySeed, matchedSpotIdx = 0) {
  const t0 = Date.now();
 
  const panels = SPOT_BASE_PALETTES.map((spot) =>
    computePanelParams(spot, PANEL_WEIGHT_MATRIX[spot.index], globalParams, diversitySeed)
  );
 
  const byName = {};
  panels.forEach((p) => { byName[p.spotName] = p; });
 
  const matchedPanel = panels[clamp(Math.round(matchedSpotIdx), 0, 11)];
 
  return {
    panels, byName,
    matchedIdx: matchedSpotIdx,
    matchedPanel,
    meta: { processingTimeMs: Date.now() - t0, diversitySeed, totalPanels: panels.length },
  };
}
 
// =============================================================================
// ⑦ Three.js / WebGL 셰이더 uniform 변환
// =============================================================================
 
/**
 * PanelColorSet을 Three.js 패널 메시 uniform에 직접 적용 가능한 형태로 변환한다.
 *
 * @param {Object} panelSet
 * @param {number} glassTransmission
 * @param {number} glassRoughness
 * @returns {Array<Object>}
 */
export function toShaderUniforms(panelSet, glassTransmission = 0.82, glassRoughness = 0.04) {
  return panelSet.panels.map((p) => ({
    color:        p.hexColor,
    transmission: clamp(glassTransmission * (0.9 + p.finalSat * 0.1), 0.65, 0.92),
    roughness:    clamp(glassRoughness    * (2.0 - p.finalSat),        0.02, 0.12),
    metalness:    0,
    ior:          1.52,
    opacity:      0.88,
    uColorTemp:   p.finalColorTemp,
    uRGBTint:     [p.rgbTint.r, p.rgbTint.g, p.rgbTint.b],
    uContrast:    p.finalContrast,
    uLightDir:    p.finalLightDir * (Math.PI / 180),
    spotIndex:    p.spotIndex,
    spotName:     p.spotName,
  }));
}
 
// =============================================================================
// ⑧ 컬러 지문 추출 (E-Card 하단 팔레트 스트립용)
// =============================================================================
 
/**
 * 매칭 패널에서 4색 컬러 지문을 추출한다.
 * @param {Object} panelSet
 * @returns {{ main:string, sub:string, acc:string, base:string }}
 */
export function extractColorFingerprint(panelSet) {
  const p = panelSet.matchedPanel;
 
  const main = p.hexColor;
  const sub  = hslToHex(p.hsl.h, p.hsl.s, clamp(p.hsl.l - 0.12, 0.05, 0.85));
  const acc  = hslToHex(
    wrapHue(p.hsl.h + 15),
    clamp(p.hsl.s * 0.6, 0.05, 1.0),
    clamp(p.hsl.l + 0.22, 0.3, 0.92)
  );
  const base = hslToHex(p.hsl.h, clamp(p.hsl.s * 0.8, 0, 1), clamp(p.hsl.l * 0.35, 0, 0.35));
 
  return { main, sub, acc, base };
}
 
// =============================================================================
// ⑨ 디버그 유틸리티
// =============================================================================
 
export function debugPrintPanels(panelSet) {
  /* eslint-disable no-console */
  console.group('🖼️ PanelColorSet (panel-individualizer)');
  console.log(`${panelSet.panels.length}개 패널 | 처리 ${panelSet.meta.processingTimeMs}ms | 시드 ${panelSet.meta.diversitySeed}`);
  console.log(`매칭: [${panelSet.matchedIdx}] ${panelSet.matchedPanel.spotName}`);
  console.log('──────────────────────────────────────────────────────────────');
 
  panelSet.panels.forEach((p, i) => {
    const star   = i === panelSet.matchedIdx ? '★' : ' ';
    const hBar   = '█'.repeat(Math.round(p.finalHue / 36)).padEnd(10, '░');
    const sBar   = '█'.repeat(Math.round(p.finalSat * 10)).padEnd(10, '░');
    console.log(
      `${star} [${String(i).padStart(2)}] ${p.spotName.padEnd(18)}`,
      `H${hBar}${String(Math.round(p.finalHue)).padStart(3)}°`,
      `S${sBar}${Math.round(p.finalSat * 100)}%`,
      `L${Math.round(p.finalLight * 100)}%`,
      p.hexColor,
    );
  });
 
  const fp = extractColorFingerprint(panelSet);
  console.log('──────────────────────────────────────────────────────────────');
  console.log('컬러 지문:', fp.main, fp.sub, fp.acc, fp.base);
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// 보조 익스포트 & Default Export
// =============================================================================
 
export { SPOT_BASE_PALETTES, PANEL_WEIGHT_MATRIX, hexToHsl, hslToHex };
 
export default {
  individualizePanels,
  toShaderUniforms,
  extractColorFingerprint,
  debugPrintPanels,
  SPOT_BASE_PALETTES,
  PANEL_WEIGHT_MATRIX,
};
