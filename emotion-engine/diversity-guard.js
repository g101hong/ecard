/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — 다양성 보증 & 품질 검증 모듈
 * @module emotion-engine/diversity-guard
 *
 * ─────────────────────────────────────────────────────────────────
 * PIPELINE STAGE 5 : PanelColorParams[] → Validated PanelColorParams[]
 * ─────────────────────────────────────────────────────────────────
 *
 * 역할 (3가지 보증):
 *
 *   ① 유일성 보증 (Uniqueness)
 *      - 감성이 비슷한 소감이라도 시각적으로 다른 카드 생성
 *      - 다양성 점수가 낮으면 시드 기반 증폭 적용
 *      - "항상 같은 카드"가 나오지 않도록 미세 노이즈 주입
 *
 *   ② 인접 패널 분리 보증 (Panel Separation)
 *      - 원형 배열에서 이웃한 패널끼리 너무 유사한 색상 방지
 *      - 인접 패널 색조 차이 < 임계값이면 자동 조정
 *      - 스테인드글라스의 "패널마다 다른 색" 원칙 유지
 *
 *   ③ 시각적 가독성 보증 (Visual Readability)
 *      - 너무 어둡거나 밝아서 유리 질감이 안 보이는 경우 보정
 *      - 무채색(채도 0) 방지 → 스테인드글라스는 색감이 있어야 함
 *      - 납선(어두운 경계)과의 대비 확보
 *
 * 입력:  PanelColorParams[] + diversitySeed + GlobalColorParams
 * 출력:  GuardedResult (보정된 패널 + 보증 리포트)
 */
 
'use strict';
 
// =============================================================================
// ① 임계값 및 설정 상수
// =============================================================================
 
export const GUARD_CONFIG = {
  // ── 다양성 점수 임계값 ──────────────────────────────────────────
  DIVERSITY_SCORE_MIN:      0.18,   // 이 값 미만이면 증폭 적용
  DIVERSITY_AMPLIFY_FACTOR: 1.35,   // 증폭 배수
 
  // ── 인접 패널 최소 색상 거리 ────────────────────────────────────
  MIN_HUE_DISTANCE:         15,     // 색조 최소 거리 (°)
  MIN_LIGHTNESS_DISTANCE:   0.07,   // 명도 최소 거리
  MAX_ADJUSTMENT_ATTEMPTS:  4,      // 자동 조정 최대 시도 횟수
 
  // ── 가독성 한계값 ───────────────────────────────────────────────
  LIGHTNESS_FLOOR:          0.18,   // 명도 최저 (너무 어두우면 안보임)
  LIGHTNESS_CEILING:        0.88,   // 명도 최고 (너무 밝으면 유리 같지 않음)
  SATURATION_FLOOR:         0.06,   // 채도 최저 (무채색 방지)
  SATURATION_CEILING:       0.98,   // 채도 최고
 
  // ── 미세 노이즈 크기 ────────────────────────────────────────────
  HUE_NOISE_RANGE:          2.5,    // 색조 노이즈 ±°
  SAT_NOISE_RANGE:          0.025,  // 채도 노이즈
  LIGHT_NOISE_RANGE:        0.018,  // 명도 노이즈
};
 
// =============================================================================
// ② 유틸리티 함수
// =============================================================================
 
const clamp = (v, mn, mx) => Math.min(Math.max(v, mn), mx);
 
/**
 * 두 색조 값(0~360°) 사이의 최단 거리를 계산한다.
 * 원형(circular) 거리이므로 0°와 350°는 10° 차이.
 *
 * @param {number} h1  색조 A (°)
 * @param {number} h2  색조 B (°)
 * @returns {number}   0~180 범위의 최단 거리
 */
function hueDistance(h1, h2) {
  const diff = Math.abs(((h1 - h2) % 360 + 360) % 360);
  return diff > 180 ? 360 - diff : diff;
}
 
/**
 * 두 패널 사이의 종합 색상 거리 점수를 계산한다.
 * 색조 거리와 명도 거리를 가중 합산한다.
 *
 * @param {Object} panelA
 * @param {Object} panelB
 * @returns {{ hue: number, lightness: number, total: number }}
 */
function panelColorDistance(panelA, panelB) {
  const hue       = hueDistance(panelA.hue, panelB.hue);
  const lightness = Math.abs(panelA.lightness - panelB.lightness);
  const total     = hue * 0.70 + lightness * 180 * 0.30; // 동일 스케일로 합산
  return { hue, lightness, total };
}
 
/**
 * cyrb53 결정론적 해시 기반 미세 노이즈 생성.
 * 동일 시드 + 인덱스 → 항상 동일한 노이즈 (재현 가능).
 *
 * @param {number} seed
 * @param {number} slot  슬롯 번호 (패널 인덱스 × 오프셋)
 * @param {number} range 노이즈 범위 ±range
 * @returns {number}
 */
function deterministicNoise(seed, slot, range) {
  const h = ((seed ^ (slot * 2654435761)) >>> 0) % 100000;
  return ((h / 100000) - 0.5) * 2 * range;
}
 
// =============================================================================
// ③ 다양성 점수 계산
// =============================================================================
 
/**
 * 글로벌 색채 파라미터의 다양성 점수를 계산한다.
 *
 * [점수 기준]
 *   0.0 = 모든 파라미터가 중립값 (평범한 카드)
 *   1.0 = 모든 파라미터가 최대 편차 (극적인 카드)
 *
 * 낮은 점수(< DIVERSITY_SCORE_MIN)는 소감이 너무 짧거나
 * 감성이 고르게 분포되어 개성 없는 결과가 나올 위험이 있다.
 *
 * @param {import('./param-synthesizer.js').GlobalColorParams} globalParams
 * @returns {number} 0.0 ~ 1.0
 */
export function computeDiversityScore(globalParams) {
  const scores = [
    Math.abs(globalParams.deltaHue)          / 25    * 0.22,  // 색조 편차
    Math.abs(globalParams.deltaSat - 1.0)    / 0.50  * 0.20,  // 채도 편차
    Math.abs(globalParams.deltaLight)        / 0.20  * 0.15,  // 명도 편차
    Math.abs(globalParams.deltaContrast-1.0) / 0.45  * 0.13,  // 대비 편차
    Math.abs(globalParams.colorTemp)         / 1500  * 0.22,  // 색온도 편차
    Math.abs(globalParams.lightDir)          / 35    * 0.08,  // 광원 편차
  ];
 
  return clamp(scores.reduce((a, b) => a + b, 0), 0, 1);
}
 
// =============================================================================
// ④ 다양성 증폭 (Diversity Amplification)
// =============================================================================
 
/**
 * 다양성 시드를 이용해 사전 정의된 "컬러 무드" 방향으로 파라미터를 증폭한다.
 *
 * [컬러 무드 설계]
 *   모든 방문객이 비슷한 무난한 소감("좋았어요")을 남겨도
 *   시드에 따라 12가지 서로 다른 색감 방향 중 하나로 안내된다.
 *   → 단조로운 카드 방지
 *
 * @param {import('./param-synthesizer.js').GlobalColorParams} globalParams
 * @param {number} diversitySeed
 * @returns {import('./param-synthesizer.js').GlobalColorParams} 증폭된 파라미터
 */
function amplifyDiversity(globalParams, diversitySeed) {
  // 12가지 컬러 무드 방향 벡터 (각 경승지에 대응)
  const COLOR_MOODS = [
    { dHue:+12, dSat:+0.15, dLight:+0.05, dTemp:+600 }, // 붉은 일출 빛
    { dHue: -5, dSat:+0.18, dLight:-0.03, dTemp:-100 }, // 짙은 숲
    { dHue: -8, dSat:-0.05, dLight:+0.08, dTemp:-250 }, // 맑은 해변
    { dHue:+2,  dSat:+0.20, dLight:-0.05, dTemp:-200 }, // 깊은 바다
    { dHue:+15, dSat:-0.08, dLight:-0.04, dTemp:+800 }, // 따뜻한 황토
    { dHue:+10, dSat:-0.12, dLight:-0.08, dTemp:+400 }, // 고요한 암반
    { dHue: -6, dSat:+0.16, dLight:+0.10, dTemp:-300 }, // 청록 계곡
    { dHue: +5, dSat:+0.08, dLight:-0.06, dTemp:+200 }, // 야경 강청
    { dHue: -2, dSat:+0.12, dLight:+0.12, dTemp:+100 }, // 밝은 공원
    { dHue: -4, dSat:+0.14, dLight:+0.06, dTemp:-150 }, // 서늘한 대숲
    { dHue:+18, dSat:+0.10, dLight:+0.08, dTemp:+700 }, // 황금 억새
    { dHue: -3, dSat:+0.06, dLight:+0.02, dTemp: +50 }, // 중립적 산
  ];
 
  const moodIdx = diversitySeed % COLOR_MOODS.length;
  const mood    = COLOR_MOODS[moodIdx];
  const factor  = GUARD_CONFIG.DIVERSITY_AMPLIFY_FACTOR;
 
  return {
    ...globalParams,
    deltaHue:      clamp(globalParams.deltaHue      + mood.dHue   * factor, -25, +25),
    deltaSat:      clamp(globalParams.deltaSat       + mood.dSat   * factor, 0.50, 1.45),
    deltaLight:    clamp(globalParams.deltaLight     + mood.dLight * factor, -0.20, +0.20),
    colorTemp:     clamp(globalParams.colorTemp      + mood.dTemp  * factor, -1500, +1500),
    _amplified:    true,
    _moodIndex:    moodIdx,
  };
}
 
// =============================================================================
// ⑤ 미세 노이즈 주입 (Micro-Noise Injection)
// =============================================================================
 
/**
 * 각 패널에 결정론적 미세 노이즈를 주입한다.
 *
 * 효과:
 *   - 동일 소감이라도 미래에 생성 시 약간 다른 색상
 *   - 단, 동일 시드 → 항상 동일한 결과 (재현 가능)
 *   - 노이즈 크기는 시각적으로 인지하기 어려운 수준
 *
 * @param {Object[]} panels       PanelColorParams[]
 * @param {number}   diversitySeed
 * @returns {Object[]} 노이즈 적용된 패널 배열
 */
function injectMicroNoise(panels, diversitySeed) {
  return panels.map((panel, i) => {
    const baseSlot = i * 10;
    const dHue   = deterministicNoise(diversitySeed, baseSlot + 1, GUARD_CONFIG.HUE_NOISE_RANGE);
    const dSat   = deterministicNoise(diversitySeed, baseSlot + 2, GUARD_CONFIG.SAT_NOISE_RANGE);
    const dLight = deterministicNoise(diversitySeed, baseSlot + 3, GUARD_CONFIG.LIGHT_NOISE_RANGE);
 
    const newHue  = ((panel.hue + dHue) % 360 + 360) % 360;
    const newSat  = clamp(panel.saturation + dSat,  GUARD_CONFIG.SATURATION_FLOOR,  GUARD_CONFIG.SATURATION_CEILING);
    const newLight= clamp(panel.lightness  + dLight, GUARD_CONFIG.LIGHTNESS_FLOOR,   GUARD_CONFIG.LIGHTNESS_CEILING);
 
    return {
      ...panel,
      hue:        newHue,
      saturation: newSat,
      lightness:  newLight,
      cssHSL:     `hsl(${newHue.toFixed(1)}, ${(newSat*100).toFixed(1)}%, ${(newLight*100).toFixed(1)}%)`,
      _noiseApplied: { dHue, dSat, dLight },
    };
  });
}
 
// =============================================================================
// ⑥ 가독성 보정 (Visual Readability Correction)
// =============================================================================
 
/**
 * 각 패널의 명도·채도가 가독성 범위를 벗어나면 보정한다.
 *
 * 보정 기준:
 *   - 명도 < LIGHTNESS_FLOOR  → floor 값으로 올림 (너무 어두움)
 *   - 명도 > LIGHTNESS_CEILING → ceiling 값으로 내림 (너무 밝음)
 *   - 채도 < SATURATION_FLOOR  → floor 값으로 올림 (무채색 방지)
 *
 * @param {Object[]} panels
 * @returns {{ panels: Object[], corrections: Object[] }} 보정된 패널 + 보정 내역
 */
function enforceReadability(panels) {
  const corrections = [];
 
  const corrected = panels.map((panel) => {
    const issues   = [];
    let { hue, saturation, lightness } = panel;
 
    if (lightness < GUARD_CONFIG.LIGHTNESS_FLOOR) {
      issues.push(`명도 하한 보정: ${lightness.toFixed(3)} → ${GUARD_CONFIG.LIGHTNESS_FLOOR}`);
      lightness = GUARD_CONFIG.LIGHTNESS_FLOOR;
    }
    if (lightness > GUARD_CONFIG.LIGHTNESS_CEILING) {
      issues.push(`명도 상한 보정: ${lightness.toFixed(3)} → ${GUARD_CONFIG.LIGHTNESS_CEILING}`);
      lightness = GUARD_CONFIG.LIGHTNESS_CEILING;
    }
    if (saturation < GUARD_CONFIG.SATURATION_FLOOR) {
      issues.push(`채도 하한 보정: ${saturation.toFixed(3)} → ${GUARD_CONFIG.SATURATION_FLOOR}`);
      saturation = GUARD_CONFIG.SATURATION_FLOOR;
    }
    if (saturation > GUARD_CONFIG.SATURATION_CEILING) {
      issues.push(`채도 상한 보정: ${saturation.toFixed(3)} → ${GUARD_CONFIG.SATURATION_CEILING}`);
      saturation = GUARD_CONFIG.SATURATION_CEILING;
    }
 
    if (issues.length > 0) {
      corrections.push({ panelIndex: panel.index, panelName: panel.name, issues });
    }
 
    return {
      ...panel,
      hue,
      saturation,
      lightness,
      cssHSL: `hsl(${hue.toFixed(1)}, ${(saturation*100).toFixed(1)}%, ${(lightness*100).toFixed(1)}%)`,
    };
  });
 
  return { panels: corrected, corrections };
}
 
// =============================================================================
// ⑦ 인접 패널 색상 분리 보증 (Panel Separation)
// =============================================================================
 
/**
 * 원형 배열에서 이웃한 12쌍 패널의 색상이 너무 유사하면 조정한다.
 *
 * [인접 패널 쌍 — 로즈 윈도우 구조]
 *   (0,1), (1,2), (2,3) ... (11,0) — 12쌍
 *
 * [조정 방식]
 *   - 두 패널의 색조 거리 < MIN_HUE_DISTANCE 이면
 *   - 더 "중요도" 가 낮은 패널(인덱스가 큰 쪽)의 색조를 살짝 이동
 *   - 이동 방향: 두 색조 거리를 벌리는 방향으로
 *   - 최대 MAX_ADJUSTMENT_ATTEMPTS 회 반복
 *
 * @param {Object[]} panels   PanelColorParams[]
 * @param {number}   diversitySeed
 * @returns {{ panels: Object[], adjustments: Object[] }}
 */
function enforcePanelSeparation(panels, diversitySeed) {
  const adjustments = [];
  const result      = panels.map((p) => ({ ...p })); // 얕은 복사
 
  // 인접 패널 쌍 정의 (원형)
  const ADJACENT_PAIRS = Array.from({ length: 12 }, (_, i) => [i, (i + 1) % 12]);
 
  for (const [idxA, idxB] of ADJACENT_PAIRS) {
    let attempts = 0;
 
    while (attempts < GUARD_CONFIG.MAX_ADJUSTMENT_ATTEMPTS) {
      const dist = panelColorDistance(result[idxA], result[idxB]);
 
      // 색조 거리가 충분하면 OK
      if (dist.hue >= GUARD_CONFIG.MIN_HUE_DISTANCE) break;
 
      // 색조가 너무 가까움 → 인덱스가 큰 쪽을 이동
      const targetPanel = result[idxB];
      const refHue      = result[idxA].hue;
      const currentHue  = targetPanel.hue;
 
      // 두 색조의 상대 위치에 따라 이동 방향 결정
      const diff = ((currentHue - refHue) % 360 + 360) % 360;
      const nudgeDir = diff < 180 ? +1 : -1; // 멀어지는 방향
      const nudgeDeg = (GUARD_CONFIG.MIN_HUE_DISTANCE - dist.hue + 2)
                     * nudgeDir
                     + deterministicNoise(diversitySeed, idxB * 50 + attempts, 1.5);
 
      const prevHue  = targetPanel.hue;
      targetPanel.hue = ((targetPanel.hue + nudgeDeg) % 360 + 360) % 360;
      targetPanel.cssHSL = `hsl(${targetPanel.hue.toFixed(1)}, ${(targetPanel.saturation*100).toFixed(1)}%, ${(targetPanel.lightness*100).toFixed(1)}%)`;
 
      adjustments.push({
        pair:      [idxA, idxB],
        pairNames: [result[idxA].name, targetPanel.name],
        attempt:   attempts + 1,
        prevHue:   +prevHue.toFixed(1),
        newHue:    +targetPanel.hue.toFixed(1),
        nudgeDeg:  +nudgeDeg.toFixed(2),
        hueDist:   +dist.hue.toFixed(1),
      });
 
      attempts++;
    }
  }
 
  return { panels: result, adjustments };
}
 
// =============================================================================
// ⑧ RGB 틴트 재계산
// =============================================================================
 
/**
 * 색온도가 수정된 패널의 RGB 틴트를 재계산한다.
 * @param {Object[]} panels
 * @returns {Object[]}
 */
function recalcRGBTints(panels) {
  return panels.map((p) => {
    const n = clamp(p.colorTemp / 1500, -1, 1);
    return {
      ...p,
      rgbTint: {
        r: clamp(1.0 + n * 0.14, 0.80, 1.20),
        g: clamp(1.0 + n * 0.05, 0.90, 1.10),
        b: clamp(1.0 - n * 0.18, 0.70, 1.25),
      },
    };
  });
}
 
// =============================================================================
// ⑨ 메인 가드 함수
// =============================================================================
 
/**
 * @typedef {Object} GuardedResult
 * @property {Object[]} panels        최종 보정된 PanelColorParams[]
 * @property {Object}   report        처리 리포트
 * @property {boolean}  report.diversityAmplified   다양성 증폭 여부
 * @property {number}   report.diversityScore        최종 다양성 점수 (0~1)
 * @property {number}   report.moodIndex             적용된 컬러 무드 인덱스
 * @property {Object[]} report.readabilityCorrections 가독성 보정 내역
 * @property {Object[]} report.separationAdjustments  패널 분리 조정 내역
 * @property {number}   report.processingTimeMs       처리 시간
 */
 
/**
 * 다양성 보증·가독성 검증·패널 분리를 수행하고 최종 패널 색채값을 반환한다.
 *
 * 처리 순서:
 *   1. 다양성 점수 계산
 *   2. 점수 부족 시 컬러 무드 증폭 → 패널 재생성
 *   3. 미세 노이즈 주입
 *   4. 가독성 범위 보정
 *   5. 인접 패널 색상 분리 조정
 *   6. RGB 틴트 최종 재계산
 *
 * @param {Object[]} panels           PanelColorParams[] (panel-individualizer 출력)
 * @param {import('./param-synthesizer.js').GlobalColorParams} globalParams
 * @param {number}   diversitySeed    preprocessInput().diversitySeed
 * @param {Function} [regen]          다양성 증폭 시 패널 재생성 콜백
 *   signature: (amplifiedGlobalParams, diversitySeed) => PanelColorParams[]
 * @returns {GuardedResult}
 *
 * @example
 * import { individualizeAllPanels } from './panel-individualizer.js';
 * import { guardDiversity }         from './diversity-guard.js';
 *
 * const panels  = individualizeAllPanels(globalParams, seed);
 * const guarded = guardDiversity(panels, globalParams, seed,
 *   (amp, s) => individualizeAllPanels(amp, s)
 * );
 *
 * // guarded.panels[0].cssHSL  → 최종 보정된 간절곶 색상
 * // guarded.report.diversityAmplified → true/false
 */
export function guardDiversity(panels, globalParams, diversitySeed, regen = null) {
  const t0 = Date.now();
  let workingPanels = panels.map((p) => ({ ...p }));
  let workingGlobal = { ...globalParams };
  let amplified     = false;
  let moodIndex     = -1;
 
  // ── STEP 1: 다양성 점수 측정 ────────────────────────────────────
  const rawScore = computeDiversityScore(globalParams);
 
  // ── STEP 2: 다양성 부족 시 증폭 ─────────────────────────────────
  if (rawScore < GUARD_CONFIG.DIVERSITY_SCORE_MIN) {
    workingGlobal = amplifyDiversity(globalParams, diversitySeed);
    amplified     = true;
    moodIndex     = workingGlobal._moodIndex ?? -1;
 
    // 증폭된 글로벌 파라미터로 패널 재생성 (콜백 제공 시)
    if (typeof regen === 'function') {
      workingPanels = regen(workingGlobal, diversitySeed);
    }
  }
 
  // ── STEP 3: 미세 노이즈 주입 ────────────────────────────────────
  workingPanels = injectMicroNoise(workingPanels, diversitySeed);
 
  // ── STEP 4: 가독성 보정 ──────────────────────────────────────────
  const { panels: readablePanels, corrections } = enforceReadability(workingPanels);
  workingPanels = readablePanels;
 
  // ── STEP 5: 인접 패널 색상 분리 보증 ────────────────────────────
  const { panels: separatedPanels, adjustments } = enforcePanelSeparation(
    workingPanels, diversitySeed
  );
  workingPanels = separatedPanels;
 
  // ── STEP 6: RGB 틴트 최종 재계산 ────────────────────────────────
  workingPanels = recalcRGBTints(workingPanels);
 
  // ── STEP 7: 최종 다양성 점수 재측정 ─────────────────────────────
  const finalScore = computeDiversityScore(workingGlobal);
 
  return {
    panels: workingPanels,
    report: {
      diversityAmplified:      amplified,
      rawDiversityScore:       +rawScore.toFixed(4),
      finalDiversityScore:     +finalScore.toFixed(4),
      moodIndex,
      readabilityCorrections:  corrections,
      separationAdjustments:   adjustments,
      microNoiseInjected:      true,
      processingTimeMs:        Date.now() - t0,
    },
  };
}
 
// =============================================================================
// ⑩ 단일 패널 접근자 유틸리티
// =============================================================================
 
/**
 * 매칭된 경승지(spotIndex)의 패널을 보정 결과에서 추출한다.
 *
 * @param {GuardedResult} guardedResult
 * @param {number}        spotIndex
 * @returns {Object | null} PanelColorParams
 */
export function getMatchedPanel(guardedResult, spotIndex) {
  return guardedResult.panels.find((p) => p.index === spotIndex) ?? null;
}
 
/**
 * 보정된 패널 배열에서 CSS 색상 팔레트(12색)를 추출한다.
 *
 * @param {GuardedResult} guardedResult
 * @returns {string[]} 12개 CSS hsl() 문자열
 */
export function extractFinalPalette(guardedResult) {
  return guardedResult.panels.map((p) => p.cssHSL);
}
 
// =============================================================================
// ⑪ 디버그 유틸리티
// =============================================================================
 
/**
 * 가드 처리 결과를 콘솔에 상세 출력한다. (개발 전용)
 * @param {GuardedResult} result
 */
export function debugPrintGuardReport(result) {
  /* eslint-disable no-console */
  console.group('🛡️ DiversityGuard — 보증 리포트');
 
  const r = result.report;
 
  // 다양성 점수
  const scoreLine = (score) => {
    const bar = '▓'.repeat(Math.round(score * 20)).padEnd(20, '░');
    return `${bar} ${(score * 100).toFixed(1)}%`;
  };
  console.log('다양성 점수 (원본):', scoreLine(r.rawDiversityScore));
  console.log('다양성 점수 (최종):', scoreLine(r.finalDiversityScore));
 
  if (r.diversityAmplified) {
    console.warn(`⚡ 다양성 증폭 적용됨 → 컬러 무드 #${r.moodIndex}`);
  } else {
    console.log('✅ 다양성 충분 — 증폭 없음');
  }
 
  // 가독성 보정
  if (r.readabilityCorrections.length > 0) {
    console.group(`🔧 가독성 보정 (${r.readabilityCorrections.length}개 패널)`);
    r.readabilityCorrections.forEach(({ panelName, issues }) => {
      console.log(panelName + ':');
      issues.forEach((issue) => console.log('  •', issue));
    });
    console.groupEnd();
  } else {
    console.log('✅ 가독성 — 모든 패널 범위 내');
  }
 
  // 패널 분리 조정
  if (r.separationAdjustments.length > 0) {
    console.group(`↔️ 인접 패널 분리 조정 (${r.separationAdjustments.length}회)`);
    r.separationAdjustments.forEach(({ pairNames, prevHue, newHue, hueDist }) => {
      console.log(
        `  ${pairNames[0]} ↔ ${pairNames[1]}`,
        `| 거리 ${hueDist}° → 조정`,
        `| ${pairNames[1]}: ${prevHue}° → ${newHue}°`
      );
    });
    console.groupEnd();
  } else {
    console.log('✅ 패널 분리 — 모든 인접 패널 간격 충분');
  }
 
  // 최종 패널 색상
  console.group('🎨 최종 패널 색상');
  result.panels.forEach((p) => {
    const hBar = '█'.repeat(Math.round(p.hue / 36)).padEnd(10, '░');
    console.log(
      `[${p.index.toString().padStart(2)}]`,
      p.name.padEnd(16),
      `H:${p.hue.toFixed(0).padStart(3)}°`,
      hBar,
      p.cssHSL
    );
  });
  console.groupEnd();
 
  console.log(`⏱️ 처리 시간: ${r.processingTimeMs}ms`);
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  guardDiversity,
  computeDiversityScore,
  getMatchedPanel,
  extractFinalPalette,
  debugPrintGuardReport,
  GUARD_CONFIG,
};