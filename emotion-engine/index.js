/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — 파이프라인 통합 진입점
 * @module emotion-engine
 *
 * ─────────────────────────────────────────────────────────────────
 * 처리 파이프라인
 * ─────────────────────────────────────────────────────────────────
 *
 *   STAGE 1  preprocessor       입력 전처리·품질 평가·언어 감지
 *   STAGE 2  ai-extractor       Gemini 단일 호출 (감성 8차원 + 3단 답글)
 *   STAGE 2.5 panel-weights     감성 반응 행렬 적용 (경승지별 가중치)
 *   STAGE 3  param-synthesizer  색채 파라미터 합성
 *   STAGE 4  panel-individualizer 패널별 개별화
 *   STAGE 4.5 panel-weights     절기·시간·동행자 맥락 보정
 *   STAGE 5  diversity-guard    다양성 보장
 *
 * ─────────────────────────────────────────────────────────────────
 * 단락회로 (Short-Circuit)
 * ─────────────────────────────────────────────────────────────────
 *
 *   짧고 정보가 부족한 소감(charCount ≤ 10 AND quality.score < 70)은
 *   Gemini 호출 없이 diversitySeed 기반 결과를 즉시 반환한다.
 *   meta.shortCircuit = true 로 식별 가능.
 */

'use strict';

// =============================================================================
// ① 모듈 임포트
// =============================================================================

import { preprocessInput }                       from './preprocessor.js';
import { extractEmotions }                       from './ai-extractor.js';
import { synthesizeColorParams,
         colorTempToRGBTint }                    from './param-synthesizer.js';
import { individualizePanels    as individualizeAllPanels,
         SPOT_BASE_PALETTES     as PANEL_CONFIGS }       from './panel-individualizer.js';
import { guardDiversity }                 from './diversity-guard.js';
import { handleFallback,
         withFallback,
         FALLBACK_TIER }                   from './fallback-handler.js';
import { SPOTS,
         buildExtendedPalette,
         getSpotByIndex }                        from './constants/spot-palettes.js';
import { applyEmotionMatrix,
         getSeasonalMod,
         getTimeMod,
         getCompanionMod }                       from './constants/panel-weights.js';

// =============================================================================
// ② 유틸리티
// =============================================================================

const clamp = (v, mn, mx) => Math.min(Math.max(v, mn), mx);

function applyPanelContextMods(panel, sMod, tMod, cMod) {
  const dHue      = (sMod.deltaHue      || 0) + (tMod.deltaHue      || 0) + (cMod.deltaHue      || 0);
  const dSat      = (sMod.deltaSat      || 0) + (tMod.deltaSat      || 0) + (cMod.deltaSat      || 0);
  const dLight    = (sMod.deltaLight    || 0) + (tMod.deltaLight    || 0);
  const dContrast = (sMod.deltaContrast || 0) + (tMod.deltaContrast || 0);
  const dTemp     = (sMod.deltaTemp     || 0) + (tMod.deltaTemp     || 0) + (cMod.deltaTemp     || 0);

  const newHue      = ((panel.hue + dHue) % 360 + 360) % 360;
  const newSat      = clamp(panel.saturation + dSat,      0.06, 0.98);
  const newLight    = clamp(panel.lightness  + dLight,    0.18, 0.88);
  const newContrast = clamp(panel.contrast   + dContrast, 0.65, 1.45);
  const newTemp     = clamp(panel.colorTemp  + dTemp,     -1500, 1500);

  return {
    ...panel,
    hue:        newHue,
    saturation: newSat,
    lightness:  newLight,
    contrast:   newContrast,
    colorTemp:  newTemp,
    cssHSL: `hsl(${newHue.toFixed(1)}, ${(newSat*100).toFixed(1)}%, ${(newLight*100).toFixed(1)}%)`,
    rgbTint: colorTempToRGBTint(newTemp),
  };
}

function applyAllPanelContextMods(panels, context) {
  const { season = null, timeContext = null, companion = null } = context;

  return panels.map((panel) => {
    const sMod = getSeasonalMod(panel.index, season);
    const tMod = getTimeMod(panel.index, timeContext);
    const cMod = getCompanionMod(panel.index, companion);

    const hasAny = Object.values({...sMod,...tMod,...cMod})
      .some((v) => typeof v === 'number' && v !== 0);

    return hasAny ? applyPanelContextMods(panel, sMod, tMod, cMod) : panel;
  });
}

// =============================================================================
// [v3.0 신규] 단락회로 상수
// =============================================================================

/**
 * 짧은 소감 단락회로 진입 조건.
 *
 * 두 조건을 모두 충족해야 단락회로가 작동한다:
 *   1. 공백 제외 글자 수가 MAX_CHAR_COUNT 이하
 *   2. 품질 점수(quality.score)가 MAX_QUALITY 미만
 *
 * 어느 한 조건만 충족하면 일반 AI 호출 경로로 진행한다.
 * 예) "좋아요~~~^^" (9자, score 60) → 단락회로 ✅
 *     "울산 좋았어요!" (8자, score 85) → 일반 경로 (단일 감성 신호 있음)
 */
const SHORT_CIRCUIT = Object.freeze({
  MAX_CHAR_COUNT: 10,   // 공백 제외 글자 수 상한
  MAX_QUALITY:    70,   // 품질 점수 상한 (미만일 때 단락회로)
});

// =============================================================================
// ③ 최종 결과 포매터 (ECardResult 생성)
// =============================================================================

/**
 * 파이프라인 처리 결과를 ECardResult 형식으로 포맷한다.
 */
function formatECardResult(data) {
  const {
    pre, extraction, globalParams,
    panels, guardReport, spotIndex, t0,
    tier = FALLBACK_TIER.NORMAL,
    userMessage = null,
    shortCircuit = false,
  } = data;

  const spot         = getSpotByIndex(spotIndex);
  const matchedPanel = panels.find((p) => p.index === spotIndex) ?? panels[0];
  const uniforms     = panels.map((p) => ({
    color:     p.hexColor,
    spotIndex: p.spotIndex,
    spotName:  p.spotName,
  }));

  // ── 타이포그래피 ────────────────────────────────────────────────
  const typography = {
    type:            extraction.responseType      ?? 'C',
    primaryEmotion:  extraction.primaryEmotion    ?? '울산의 감동',
    keywords:        extraction.keywords          ?? ['자연','아름다움','감동','힐링','울산'],
    responseText:    extraction.responseText      ?? '',
    spotIndex,
    spotName:        spot?.name                   ?? SPOTS[spotIndex]?.name ?? '',
    spotEmoji:       spot?.emoji                  ?? '🏞️',
    dominantEmotion: extraction.dominantEmotion   ?? 'amazement',
    spotMatchReason: extraction.spotMatchReason   ?? '',

    // ── E-Card 3단 답글 ──────────────────────────────────────────
    reply: extraction.reply ?? {
      main:    '울산이 당신에게 건넨 소중한 순간',
      place:   '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 남기를 바랍니다.',
      tagline: 'ULSAN — 당신의 울산',
    },
  };

  // ── 팔레트 ──────────────────────────────────────────────────────
  const spotData = spot ?? SPOTS[0];
  const extended = buildExtendedPalette(spotIndex);
  const palette  = {
    main:    spotData.hex.main,
    sub:     spotData.hex.sub,
    acc:     spotData.hex.acc,
    base:    spotData.hex.base,
    mainCss: spotData.css.main,
    subCss:  spotData.css.sub,
    accCss:  spotData.css.acc,
    baseCss: spotData.css.base,
    extended,
  };

  // ── 맥락 ────────────────────────────────────────────────────────
  const ctx = extraction.contextAnalysis ?? {};
  const context = {
    timeContext:         ctx.timeContext?.detected         ?? null,
    timeConfidence:      ctx.timeContext?.confidence       ?? 0,
    seasonContext:       ctx.seasonContext?.detected       ?? null,
    companionContext:    ctx.companionContext?.detected    ?? null,
    emojiInterpretation: ctx.emojiInterpretation           ?? null,
    keyEmotionalPhrases: ctx.keyEmotionalPhrases           ?? [],
  };

  // ── 메타 ────────────────────────────────────────────────────────
  const meta = {
    language:           pre.language,
    inputLength:        pre.lengthInfo.class,
    diversitySeed:      pre.diversitySeed,
    processingTimeMs:   Date.now() - t0,
    diversityScore:     guardReport?.finalDiversityScore ?? 0,
    diversityAmplified: guardReport?.diversityAmplified  ?? false,
    guardReport,
    tier,
    isFallback:    tier > FALLBACK_TIER.NORMAL,
    shortCircuit,
    userMessage:   tier > FALLBACK_TIER.NORMAL ? (userMessage ?? null) : null,
  };

  return {
    success:    tier === FALLBACK_TIER.NORMAL,
    tier,
    isFallback: tier > FALLBACK_TIER.NORMAL,

    typography,
    palette,
    shaderUniforms: uniforms,
    matchedPanel,
    allPanels:      panels,

    context,
    emotionScores:  extraction.emotionScores ?? {},
    globalParams:   globalParams ?? {},

    meta,
  };
}

// =============================================================================
// ④ 메인 파이프라인 함수
// =============================================================================

/**
 * 방문객 소감을 받아 E-Card 생성에 필요한 모든 데이터를 반환한다.
 *
 * @param {string}  rawText               방문객 소감 원문
 * @param {Object}  [options]             옵션
 * @param {number}  [options.spotIndex]   경승지 강제 지정 (0~11)
 * @param {string}  [options.language]    언어 코드 강제 지정 ('ko'|'en'|'ja'|'zh')
 * @param {boolean} [options.debugMode]   콘솔 디버그 출력 여부
 * @param {Object}  [options.visitCtx]    collectVisitContext() 반환값 (emotion-engine/visit-context.js)
 * @returns {Promise<ECardResult>}
 */
export async function analyzeImpression(rawText, options = {}) {
  const t0 = Date.now();
  const {
    spotIndex: forceSpot = null,
    language:  forceLang = null,
    debugMode  = false,
    visitCtx   = null,
  } = options;

  // ────────────────────────────────────────────────────────────────
  // STAGE 1: 입력 전처리
  // ────────────────────────────────────────────────────────────────
  const pre = preprocessInput(rawText);
  if (forceLang) pre.language = forceLang;

  if (debugMode) {
    const { debugPrint } = await import('./preprocessor.js');
    debugPrint(pre);
  }

  // ────────────────────────────────────────────────────────────────
  // 품질 미달 폴백 (기존 유지)
  // isAcceptable = false → request_more 전략 → AI 호출 없이 폴백
  // ────────────────────────────────────────────────────────────────
  if (!pre.quality.isAcceptable &&
      pre.quality.fallbackStrategy === 'request_more') {
    const fb = handleFallback(
      new Error('INPUT_QUALITY_POOR'),
      { diversitySeed: pre.diversitySeed, language: pre.language, stage: 'preprocessor' }
    );
    return formatECardResult({
      pre, extraction: fb.extraction, globalParams: null,
      panels: fb.panels, guardReport: null,
      spotIndex: fb.extraction.spotIndex, t0,
      tier: fb.tier, userMessage: pre.quality.uiMessage,
      shortCircuit: false,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // 단락회로 판단
  //
  // 조건: charCount ≤ SHORT_CIRCUIT.MAX_CHAR_COUNT (10)
  //   AND quality.score < SHORT_CIRCUIT.MAX_QUALITY (70)
  //
  // 위 조건을 충족하면 Gemini API 호출 없이
  // diversitySeed 기반 TIER 3(SEED_ONLY) 결과를 즉시 반환한다.
  //
  // 단락회로가 작동하지 않는 경우 (일반 AI 경로):
  //   - charCount > 10 (정보가 충분한 소감)
  //   - quality.score ≥ 70 (짧아도 명확한 감성 신호 포함)
  //   - forceSpot 지정 시 (테스트·관리자 도구에서 경승지 고정)
  // ────────────────────────────────────────────────────────────────
  const isShortCircuit =
    pre.lengthInfo.charCount <= SHORT_CIRCUIT.MAX_CHAR_COUNT &&
    pre.quality.score        <  SHORT_CIRCUIT.MAX_QUALITY;

  if (isShortCircuit) {
    console.log(
      `[emotion-engine] ⚡ 단락회로 — charCount:${pre.lengthInfo.charCount}` +
      ` score:${pre.quality.score} seed:${pre.diversitySeed}`
    );

    // INPUT_TOO_SHORT 에러 코드 → handleFallback이 TIER 3(SEED_ONLY) 선택
    const shortErr = Object.assign(
      new Error('SHORT_CIRCUIT_INPUT_TOO_SHORT'),
      { code: 'INPUT_TOO_SHORT' }
    );

    const fb = handleFallback(shortErr, {
      diversitySeed: pre.diversitySeed,
      language:      pre.language,
      stage:         'short-circuit',
    });

    // 경승지: forceSpot > 시드 결정 순
    const scSpotIndex = forceSpot !== null
      ? clamp(Math.round(forceSpot), 0, 11)
      : fb.extraction.spotIndex;   // diversitySeed % 12

    fb.extraction.spotIndex = scSpotIndex;

    // 단락회로는 STAGE 2.5(감성 반응 행렬)~4.5까지 동일하게 거칩니다.
    // 시드 기반 감성 점수도 경승지 특성에 맞게 보정되어야 하기 때문입니다.
    const scAdjustedScores     = applyEmotionMatrix(scSpotIndex, fb.extraction.emotionScores);
    const scAdjustedExtraction = { ...fb.extraction, emotionScores: scAdjustedScores };

    // STAGE 3: 색채 파라미터 합성
    let scGlobalParams;
    try {
      scGlobalParams = synthesizeColorParams(scAdjustedExtraction);
    } catch {
      scGlobalParams = null;
    }

    // STAGE 4: 패널 개별화 (시드 기반 패널이 이미 fb.panels에 있으므로 그대로 사용)
    const scPanels = fb.panels;

    // STAGE 4.5: 맥락 보정 (visitCtx가 있으면 계절·시간 반영)
    let finalPanels = scPanels;
    if (visitCtx) {
      finalPanels = applyAllPanelContextMods(scPanels, {
        season:      visitCtx.season      ?? null,
        timeContext: visitCtx.timeSlot?.key ?? null,
        companion:   null,
      });
    }

    return formatECardResult({
      pre,
      extraction:   scAdjustedExtraction,
      globalParams: scGlobalParams,
      panels:       finalPanels,
      guardReport:  null,
      spotIndex:    scSpotIndex,
      t0,
      tier:         FALLBACK_TIER.SEED_ONLY,
      shortCircuit: true,
    });
  }

  // ────────────────────────────────────────────────────────────────
  // STAGE 2: AI 종합 감성 분석 + reply 생성 (단일 Gemini 호출)
  // ────────────────────────────────────────────────────────────────
  let extraction;
  try {
    extraction = await extractEmotions(pre, visitCtx);
    if (debugMode) {
      const { debugPrintExtraction } = await import('./ai-extractor.js');
      debugPrintExtraction(extraction);
    }
  } catch (err) {
    const fb = handleFallback(err, {
      diversitySeed: pre.diversitySeed,
      language:      pre.language,
      stage:         'ai-extractor',
    });
    extraction = fb.extraction;
  }

  // 경승지 인덱스 확정
  const spotIndex = forceSpot !== null
    ? clamp(Math.round(forceSpot), 0, 11)
    : clamp(Math.round(extraction.spotIndex ?? 0), 0, 11);

  extraction.spotIndex = spotIndex;

  // ────────────────────────────────────────────────────────────────
  // STAGE 2.5: 감성 반응 행렬 적용
  // ────────────────────────────────────────────────────────────────
  const adjustedScores     = applyEmotionMatrix(spotIndex, extraction.emotionScores);
  const adjustedExtraction = { ...extraction, emotionScores: adjustedScores };

  // ────────────────────────────────────────────────────────────────
  // STAGE 3: 색채 파라미터 합성
  // ────────────────────────────────────────────────────────────────
  let globalParams;
  try {
    globalParams = synthesizeColorParams(adjustedExtraction);
    if (debugMode) {
      const { debugPrintParams } = await import('./param-synthesizer.js');
      debugPrintParams(globalParams);
    }
  } catch (err) {
    console.warn('[emotion-engine] param-synthesizer 실패, 기본값 사용:', err.message);
    globalParams = {
      deltaHue: 0, deltaSat: 1.0, deltaLight: 0,
      deltaContrast: 1.0, colorTemp: 0, lightDir: 0,
      glassTransmission: 0.82, glassRoughness: 0.04,
      leadMetalness: 0.90,
      rgbTint: { r: 1, g: 1, b: 1 },
      lightDirRad: 0,
      dominantEmotion: extraction.dominantEmotion ?? 'peace',
      appliedModifiers: {},
    };
  }

  // ────────────────────────────────────────────────────────────────
  // STAGE 4: 패널별 개별화
  // ────────────────────────────────────────────────────────────────
  let rawPanels;
  try {
    const panelSet = individualizeAllPanels(globalParams, pre.diversitySeed);
    rawPanels = panelSet.panels.map((p) => ({
      ...p,
      hue:        p.finalHue,
      saturation: p.finalSat,
      lightness:  p.finalLight,
      contrast:   p.finalContrast,
      colorTemp:  p.finalColorTemp,
      index:      p.spotIndex,
      name:       p.spotName,
      cssHSL: `hsl(${p.finalHue.toFixed(1)}, ${(p.finalSat*100).toFixed(1)}%, ${(p.finalLight*100).toFixed(1)}%)`,
    }));
  } catch (err) {
    console.warn('[emotion-engine] panel-individualizer 실패:', err.message);
    const fb = handleFallback(err, {
      diversitySeed: pre.diversitySeed, language: pre.language,
      spotIndex, stage: 'panel-individualizer',
    });
    rawPanels = fb.panels;
  }

  // ────────────────────────────────────────────────────────────────
  // STAGE 4.5: 패널별 맥락 추가 보정
  // ────────────────────────────────────────────────────────────────
  const ctxData = adjustedExtraction.contextAnalysis ?? {};
  const contextForMods = {
    season:      ctxData.seasonContext?.detected    ?? null,
    timeContext: ctxData.timeContext?.detected      ?? null,
    companion:   ctxData.companionContext?.detected ?? null,
  };

  const panels = applyAllPanelContextMods(rawPanels, contextForMods);

  // ────────────────────────────────────────────────────────────────
  // STAGE 5: 다양성 가드
  // ────────────────────────────────────────────────────────────────
  let guardReport = null;
  try {
    guardReport = guardDiversity(panels, pre.diversitySeed);
  } catch (err) {
    console.warn('[emotion-engine] diversity-guard 실패 (무시):', err.message);
  }

  return formatECardResult({
    pre,
    extraction:   adjustedExtraction,
    globalParams,
    panels,
    guardReport,
    spotIndex,
    t0,
    tier:         FALLBACK_TIER.NORMAL,
    shortCircuit: false,
  });
}

// =============================================================================
// ⑤ 단계별 실행 함수 (디버그·테스트용)
// =============================================================================

export function runStage1(rawText) {
  return preprocessInput(rawText);
}

export async function runStage1to2(rawText, visitCtx = null) {
  const pre = preprocessInput(rawText);
  const extraction = await withFallback(
    () => extractEmotions(pre, visitCtx),
    null,
    { diversitySeed: pre.diversitySeed, language: pre.language, stage: 'stage2' }
  );
  return { pre, extraction };
}

export function runStage3(extraction, spotIndex) {
  const idx      = spotIndex ?? extraction.spotIndex ?? 0;
  const adjusted = { ...extraction, emotionScores: applyEmotionMatrix(idx, extraction.emotionScores) };
  return synthesizeColorParams(adjusted);
}

export function quickSynthesize(emotionScores, spotIndex = 0) {
  const fakeExtraction = {
    emotionScores,
    contextAnalysis: {
      timeContext:      { detected: null },
      seasonContext:    { detected: null },
      companionContext: { detected: null },
    },
  };
  const adjusted = {
    ...fakeExtraction,
    emotionScores: applyEmotionMatrix(spotIndex, emotionScores),
  };
  return synthesizeColorParams(adjusted);
}

// =============================================================================
// ⑥ 유효성 검사 유틸리티
// =============================================================================

export function validateResult(result) {
  const issues = [];
  if (!result)                            issues.push('result가 null');
  if (!result?.typography?.responseText)  issues.push('responseText 없음');
  if (!Array.isArray(result?.allPanels))  issues.push('allPanels 없음');
  if (result?.allPanels?.length !== 12)   issues.push(`패널 수 오류: ${result?.allPanels?.length}`);
  if (!result?.palette?.main)             issues.push('palette.main 없음');
  if (!Array.isArray(result?.shaderUniforms)) issues.push('shaderUniforms 없음');
  if (!result?.typography?.reply?.main)   issues.push('reply.main 없음');
  return { valid: issues.length === 0, issues };
}

// =============================================================================
// ⑦ 디버그 출력
// =============================================================================

export function debugPipeline(result) {
  /* eslint-disable no-console */
  console.group('🎨 ECardResult — 파이프라인 최종 출력');

  const tierLabels = ['✅ NORMAL','⚠️  PARTIAL','🟡 TEMPLATE','🔴 SEED_ONLY'];
  console.log('상태:', tierLabels[result.tier]);
  // 단락회로 여부 출력
  if (result.meta.shortCircuit) console.log('⚡ 단락회로 적용 (AI 호출 없음)');
  console.log('처리 시간:', result.meta.processingTimeMs + 'ms');
  console.log('언어:', result.meta.language, '| 입력길이:', result.meta.inputLength);

  console.group('📝 타이포그래피');
  console.log('유형:', result.typography.type);
  console.log('핵심 감성:', result.typography.primaryEmotion);
  console.log('키워드:', result.typography.keywords?.join(' · '));
  console.groupEnd();

  const { valid, issues } = validateResult(result);
  console.log('✅ 유효성:', valid ? '통과' : '❌ ' + issues.join(', '));

  console.groupEnd();
  /* eslint-enable no-console */
}

// =============================================================================
// ⑧ 자주 쓰는 항목 재수출 (Re-exports)
// =============================================================================

export { SPOTS }                     from './constants/spot-palettes.js';
export { SPOT_BASE_PALETTES as PANEL_CONFIGS } from './panel-individualizer.js';
export { FALLBACK_TIER }             from './fallback-handler.js';
export { preprocessInput }           from './preprocessor.js';
export { extractEmotions }           from './ai-extractor.js';
export { synthesizeColorParams }     from './param-synthesizer.js';
export { individualizePanels as individualizeAllPanels } from './panel-individualizer.js';
export { guardDiversity }            from './diversity-guard.js';
export { buildExtendedPalette,
         getSpotByIndex }            from './constants/spot-palettes.js';
export { applyEmotionMatrix,
         getFullPanelConfig }        from './constants/panel-weights.js';

// =============================================================================
// Default Export
// =============================================================================

export default {
  analyzeImpression,
  runStage1,
  runStage1to2,
  runStage3,
  quickSynthesize,
  validateResult,
  debugPipeline,
  SHORT_CIRCUIT,   // 테스트·모니터링에서 참조 가능하도록 노출
};
