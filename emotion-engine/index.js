/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — 파이프라인 통합 진입점
 * @module emotion-engine
 * @version 2.0.0
 *
 * [v2.0 변경] 방안B 단일 호출 통합
 * ─────────────────────────────────────────────────────────────────
 *
 *   analyzeImpression()에 visitCtx 옵션 추가.
 *   impression.js가 collectVisitContext()를 먼저 실행한 뒤
 *   결과를 여기에 전달하면, extractEmotions()가 단일 Gemini 호출로
 *   감성 분석 + E-Card 3단 답글을 동시에 반환한다.
 *
 *   변경 사항:
 *     1. analyzeImpression(rawText, options)
 *        - options.visitCtx 파라미터 추가
 *        - extractEmotions(pre, visitCtx) 로 전달
 *
 *     2. formatECardResult()
 *        - typography에 reply 필드 추가
 *          (extraction.reply → typography.reply)
 *
 *   하위 호환:
 *     - visitCtx 미전달 시 기존 동작과 동일
 *     - typography.reply는 신규 필드이므로 기존 코드에 영향 없음
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
         toShaderUniforms       as toThreeJSUniforms,
         SPOT_BASE_PALETTES     as PANEL_CONFIGS }       from './panel-individualizer.js';
import { guardDiversity,
         computeDiversityScore }                 from './diversity-guard.js';
import { handleFallback,
         withFallback,
         withFallbackSync,
         isFallback,
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
// ③ 최종 결과 포매터 (ECardResult 생성)
// =============================================================================

/**
 * 파이프라인 처리 결과를 ECardResult 형식으로 포맷한다.
 *
 * [v2.0] typography에 reply 필드 추가
 *   extraction.reply (Gemini가 생성한 3단 답글)를 typography.reply로 전달한다.
 *   impression.js는 typography.reply를 직접 꺼내 응답에 포함한다.
 */
function formatECardResult(data) {
  const {
    pre, extraction, globalParams,
    panels, guardReport, spotIndex, t0,
    tier = FALLBACK_TIER.NORMAL,
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

    // ── [v2.0] E-Card 3단 답글 ──────────────────────────────────
    // Gemini가 단일 호출에서 생성한 reply를 그대로 전달한다.
    // impression.js가 reply-engine 호출 없이 이 값을 직접 사용한다.
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
    isFallback:   tier > FALLBACK_TIER.NORMAL,
    userMessage:  tier > FALLBACK_TIER.NORMAL ? (data.userMessage ?? null) : null,
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
 * [v2.0] options.visitCtx 파라미터 추가
 *
 * @param {string}  rawText               방문객 소감 원문
 * @param {Object}  [options]             옵션
 * @param {number}  [options.spotIndex]   경승지 강제 지정 (0~11)
 * @param {string}  [options.language]    언어 코드 강제 지정 ('ko'|'en'|'ja'|'zh')
 * @param {boolean} [options.debugMode]   콘솔 디버그 출력 여부
 * @param {Object}  [options.visitCtx]    collectVisitContext() 반환값
 *                                        (방안B: impression.js가 전달)
 * @returns {Promise<ECardResult>}
 *
 * @example
 * // impression.js에서의 호출 방식 (방안B)
 * const visitCtx    = collectVisitContext();   // 동기, 즉시
 * const emotionResult = await analyzeImpression(cleanText, { language, visitCtx });
 * const reply = emotionResult.typography.reply; // 두 번째 Gemini 호출 불필요
 */
export async function analyzeImpression(rawText, options = {}) {
  const t0 = Date.now();
  const {
    spotIndex: forceSpot = null,
    language:  forceLang = null,
    debugMode  = false,
    visitCtx   = null,   // [v2.0] 방문 시점 컨텍스트
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

  // 품질 미달 — 폴백
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
    });
  }

  // ────────────────────────────────────────────────────────────────
  // STAGE 2: AI 종합 감성 분석 + reply 생성 (단일 Gemini 호출)
  // [v2.0] visitCtx를 extractEmotions에 전달 → reply까지 한 번에 반환
  // ────────────────────────────────────────────────────────────────
  let extraction;
  try {
    extraction = await extractEmotions(pre, visitCtx);   // [v2.0] visitCtx 추가
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
  const ctx = adjustedExtraction.contextAnalysis ?? {};
  const contextForMods = {
    season:      ctx.seasonContext?.detected    ?? null,
    timeContext: ctx.timeContext?.detected      ?? null,
    companion:   ctx.companionContext?.detected ?? null,
  };
  const contextModdedPanels = applyAllPanelContextMods(rawPanels, contextForMods);

  // ────────────────────────────────────────────────────────────────
  // STAGE 5: 다양성 보증
  // ────────────────────────────────────────────────────────────────
  let finalPanels, guardReport;
  try {
    const guardResult = guardDiversity(
      contextModdedPanels,
      globalParams,
      pre.diversitySeed,
      (amplifiedParams, seed) => {
        const rePanelSet = individualizeAllPanels(amplifiedParams, seed);
        const rePanels = rePanelSet.panels.map((p) => ({
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
        return applyAllPanelContextMods(rePanels, contextForMods);
      }
    );
    finalPanels = guardResult.panels;
    guardReport = guardResult.report;

    if (debugMode) {
      const { debugPrintGuardReport } = await import('./diversity-guard.js');
      debugPrintGuardReport(guardResult);
    }
  } catch (err) {
    console.warn('[emotion-engine] diversity-guard 실패, 보정 없이 진행:', err.message);
    finalPanels = contextModdedPanels;
    guardReport = { diversityAmplified: false, finalDiversityScore: 0 };
  }

  // ────────────────────────────────────────────────────────────────
  // FORMAT: ECardResult 생성 및 반환
  // ────────────────────────────────────────────────────────────────
  const result = formatECardResult({
    pre,
    extraction:  adjustedExtraction,
    globalParams,
    panels:      finalPanels,
    guardReport,
    spotIndex,
    t0,
    tier: FALLBACK_TIER.NORMAL,
  });

  if (debugMode) {
    console.group('✅ [emotion-engine] 파이프라인 완료');
    console.log('처리 시간:', result.meta.processingTimeMs + 'ms');
    console.log('경승지:', result.typography.spotName);
    console.log('핵심 감성:', result.typography.primaryEmotion);
    console.log('reply.main:', result.typography.reply?.main);
    console.log('다양성 점수:', (result.meta.diversityScore * 100).toFixed(1) + '%');
    console.groupEnd();
  }

  return result;
}

// =============================================================================
// ⑤ 단계별 단독 실행 함수 (테스트·디버그용)
// =============================================================================

export function runStage1(rawText) {
  return preprocessInput(rawText);
}

export async function runStage1to2(rawText, opts = {}) {
  const pre        = preprocessInput(rawText);
  const extraction = await withFallback(
    () => extractEmotions(pre, opts.visitCtx ?? null),
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
  // [v2.0] reply 유효성 추가
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
  console.log('처리 시간:', result.meta.processingTimeMs + 'ms');
  console.log('언어:', result.meta.language, '| 입력길이:', result.meta.inputLength);

  console.group('📝 타이포그래피');
  console.log('유형:', result.typography.type);
  console.log('핵심 감성:', result.typography.primaryEmotion);
  console.log('키워드:', result.typography.keywords?.join(' · '));
  console.log('경승지:', result.typography.spotEmoji, result.typography.spotName);
  console.log('답글:', result.typography.responseText?.slice(0, 60) + '...');
  console.groupEnd();

  // [v2.0] reply 출력
  if (result.typography.reply) {
    console.group('💬 E-Card 3단 답글');
    console.log('main   :', result.typography.reply.main);
    console.log('place  :', result.typography.reply.place);
    console.log('tagline:', result.typography.reply.tagline);
    console.groupEnd();
  }

  console.group('💛 감성 점수');
  const scores = result.emotionScores;
  Object.entries(scores).forEach(([k, v]) => {
    const bar = '▓'.repeat(Math.round(v/10)).padEnd(10,'░');
    console.log(`  ${k.padEnd(12)} ${bar} ${v}`);
  });
  console.groupEnd();

  console.group('🎨 팔레트 (매칭 경승지)');
  console.log('main:', result.palette.mainCss);
  console.log('sub: ', result.palette.subCss);
  console.log('acc: ', result.palette.accCss);
  console.log('base:', result.palette.baseCss);
  console.groupEnd();

  console.group('🏞️ 12경 패널 색채');
  result.allPanels?.forEach((p) => {
    const mark = p.index === result.typography.spotIndex ? '★' : ' ';
    console.log(`${mark}[${p.index}] ${p.name?.padEnd(16)} ${p.cssHSL}`);
  });
  console.groupEnd();

  const gp = result.globalParams;
  if (gp) {
    console.group('⚙️ 글로벌 색채 파라미터');
    console.log(`ΔHue:${gp.deltaHue?.toFixed(1)}° Sat:×${gp.deltaSat?.toFixed(2)} Light:${gp.deltaLight?.toFixed(3)}`);
    console.log(`Contrast:×${gp.deltaContrast?.toFixed(2)} Temp:${gp.colorTemp?.toFixed(0)}K LightDir:${gp.lightDir?.toFixed(1)}°`);
    console.groupEnd();
  }

  console.log('🔮 다양성 점수:',
    (result.meta.diversityScore * 100).toFixed(1) + '%',
    result.meta.diversityAmplified ? '(증폭됨)' : ''
  );

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
};
