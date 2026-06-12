/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — 파이프라인 통합 진입점
 * @module emotion-engine
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 전체 파이프라인 흐름
 * ─────────────────────────────────────────────────────────────────
 *
 *   rawText (방문객 소감)
 *       │
 *       ▼ STAGE 1  preprocessor.js
 *   SlimPreprocessed  ─ 언어감지·정규화·품질검사·이모지추출
 *       │
 *       ▼ STAGE 2  claude-extractor.js  (AI API)
 *   ExtractionResult  ─ 맥락·감성8차원·경승지매칭·답글생성
 *       │
 *       ▼ STAGE 2.5  panel-weights.js  (EMOTION_RESPONSE_MATRIX)
 *   Adjusted Scores   ─ 경승지 개성에 맞게 감성 점수 재조정
 *       │
 *       ▼ STAGE 3  param-synthesizer.js
 *   GlobalColorParams ─ 감성 수식 → 6개 글로벌 색채 파라미터
 *       │
 *       ▼ STAGE 4  panel-individualizer.js
 *   PanelColorParams[]─ 12경 패널별 개별 색채값 적용
 *       │
 *       ▼ STAGE 4.5  panel-weights.js  (SEASONAL/TIME/COMPANION)
 *   Adjusted Panels   ─ 계절·시간·동행자 패널별 추가 보정
 *       │
 *       ▼ STAGE 5  diversity-guard.js
 *   GuardedResult     ─ 유일성·가독성·인접패널 분리 보증
 *       │
 *       ▼ FORMAT
 *   ECardResult       ─ Three.js·타이포그래피·팔레트 완전 패키지
 *
 * ─────────────────────────────────────────────────────────────────
 * 사용 예시
 * ─────────────────────────────────────────────────────────────────
 *
 *   import { analyzeImpression } from './emotion-engine/index.js';
 *
 *   const result = await analyzeImpression(
 *     "태화강 대나무숲을 가족과 함께 걸었어요. 너무 힐링 됐습니다 🎋😊"
 *   );
 *
 *   // Three.js 렌더러에 직접 전달
 *   stainedGlass.applyUniforms(result.shaderUniforms);
 *
 *   // 타이포그래피 카드 표시
 *   card.render(result.typography);
 *
 *   // 색상 칩 표시
 *   colorChips.set(result.palette);
 */
 
'use strict';
 
// =============================================================================
// ① 모듈 임포트
// =============================================================================
 
import { preprocessInput }                       from './preprocessor.js';
import { extractEmotions }                       from './claude-extractor.js';
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
 
/**
 * 패널에 계절·시간·동행자 추가 보정값을 적용한다.
 * panel-weights.js의 SEASONAL/TIME/COMPANION 보정을 패널별로 반영.
 *
 * @param {Object} panel   PanelColorParams
 * @param {Object} sMod    seasonalMod
 * @param {Object} tMod    timeMod
 * @param {Object} cMod    companionMod
 * @returns {Object}       보정된 PanelColorParams
 */
function applyPanelContextMods(panel, sMod, tMod, cMod) {
  const dHue     = (sMod.deltaHue     || 0) + (tMod.deltaHue     || 0) + (cMod.deltaHue     || 0);
  const dSat     = (sMod.deltaSat     || 0) + (tMod.deltaSat     || 0) + (cMod.deltaSat     || 0);
  const dLight   = (sMod.deltaLight   || 0) + (tMod.deltaLight   || 0);
  const dContrast= (sMod.deltaContrast|| 0) + (tMod.deltaContrast|| 0);
  const dTemp    = (sMod.deltaTemp    || 0) + (tMod.deltaTemp    || 0) + (cMod.deltaTemp    || 0);
 
  const newHue      = ((panel.hue + dHue) % 360 + 360) % 360;
  const newSat      = clamp(panel.saturation + dSat,  0.06, 0.98);
  const newLight    = clamp(panel.lightness  + dLight, 0.18, 0.88);
  const newContrast = clamp(panel.contrast   + dContrast, 0.65, 1.45);
  const newTemp     = clamp(panel.colorTemp  + dTemp, -1500, 1500);
 
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
 
/**
 * 12개 패널 전체에 패널별 맥락 보정을 적용한다.
 *
 * @param {Object[]} panels      PanelColorParams[]
 * @param {Object}   context     { season, timeContext, companion }
 * @returns {Object[]}           보정된 패널 배열
 */
function applyAllPanelContextMods(panels, context) {
  const { season = null, timeContext = null, companion = null } = context;
 
  return panels.map((panel) => {
    const sMod = getSeasonalMod(panel.index, season);
    const tMod = getTimeMod(panel.index, timeContext);
    const cMod = getCompanionMod(panel.index, companion);
 
    // 세 가지 보정 중 하나라도 값이 있을 때만 적용
    const hasAny = Object.values({...sMod,...tMod,...cMod})
      .some((v) => typeof v === 'number' && v !== 0);
 
    return hasAny ? applyPanelContextMods(panel, sMod, tMod, cMod) : panel;
  });
}
 
// =============================================================================
// ③ 최종 결과 포매터 (ECardResult 생성)
// =============================================================================
 
/**
 * @typedef {Object} ECardTypography
 * @property {'A'|'B'|'C'} type          레이아웃 유형
 * @property {string}       primaryEmotion 핵심 감성 한글 (대형 표시용)
 * @property {string[]}     keywords       감성 키워드 5개
 * @property {string}       responseText   울산 관광과 명의 맞춤 답글
 * @property {number}       spotIndex      매칭 경승지 인덱스 0~11
 * @property {string}       spotName       경승지 이름
 * @property {string}       spotEmoji      경승지 이모지
 * @property {string}       dominantEmotion 최고 점수 감성 키
 */
 
/**
 * @typedef {Object} ECardPalette
 * @property {string}     main        주색 hex
 * @property {string}     sub         보조색 hex
 * @property {string}     acc         강조색 hex
 * @property {string}     base        배경색 hex
 * @property {string}     mainCss     주색 CSS hsl()
 * @property {string}     subCss      보조색 CSS hsl()
 * @property {string}     accCss      강조색 CSS hsl()
 * @property {string}     baseCss     배경색 CSS hsl()
 * @property {number[][]} extended    11색 확장 팔레트 [[R,G,B], ...]
 */
 
/**
 * @typedef {Object} ECardResult
 * @property {boolean}        success        처리 성공 여부 (폴백=false)
 * @property {number}         tier           FALLBACK_TIER (0=정상, 1~3=폴백)
 * @property {boolean}        isFallback     폴백 사용 여부
 *
 * @property {ECardTypography} typography    타이포그래피 카드 데이터
 * @property {ECardPalette}    palette       색상 팔레트 (매칭 경승지)
 * @property {Object[]}        shaderUniforms Three.js 셰이더 유니폼 12개
 * @property {Object}          matchedPanel   매칭 경승지 패널 색채값
 * @property {Object[]}        allPanels      12경 전체 패널 색채값
 *
 * @property {Object}          context        AI가 감지한 맥락 정보
 * @property {Object}          emotionScores  8차원 감성 점수
 * @property {Object}          globalParams   글로벌 색채 파라미터 6종
 *
 * @property {Object}          meta           처리 메타데이터
 */
 
/**
 * 파이프라인 처리 결과를 ECardResult 형식으로 포맷한다.
 *
 * @param {Object} data  내부 파이프라인 데이터
 * @returns {ECardResult}
 */
function formatECardResult(data) {
  const {
    pre, extraction, globalParams,
    panels, guardReport, spotIndex, t0,
    tier = FALLBACK_TIER.NORMAL,
  } = data;
 
  const spot          = getSpotByIndex(spotIndex);
  const matchedPanel  = panels.find((p) => p.index === spotIndex) ?? panels[0];
  const uniforms = panels.map((p) => ({
  color:     p.hexColor,
  spotIndex: p.spotIndex,
  spotName:  p.spotName,
  // ... 필요한 필드
  }));
 
  // ── 타이포그래피 ────────────────────────────────────────────────
  const typography = {
    type:           extraction.responseType      ?? 'C',
    primaryEmotion: extraction.primaryEmotion    ?? '울산의 감동',
    keywords:       extraction.keywords          ?? ['자연','아름다움','감동','힐링','울산'],
    responseText:   extraction.responseText      ?? '',
    spotIndex,
    spotName:       spot?.name                   ?? SPOTS[spotIndex]?.name ?? '',
    spotEmoji:      spot?.emoji                  ?? '🏞️',
    dominantEmotion: extraction.dominantEmotion  ?? 'amazement',
    spotMatchReason: extraction.spotMatchReason  ?? '',
  };
 
  // ── 팔레트 ──────────────────────────────────────────────────────
  const spotData  = spot ?? SPOTS[0];
  const extended  = buildExtendedPalette(spotIndex);
  const palette   = {
    main:     spotData.hex.main,
    sub:      spotData.hex.sub,
    acc:      spotData.hex.acc,
    base:     spotData.hex.base,
    mainCss:  spotData.css.main,
    subCss:   spotData.css.sub,
    accCss:   spotData.css.acc,
    baseCss:  spotData.css.base,
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
    language:         pre.language,
    inputLength:      pre.lengthInfo.class,
    diversitySeed:    pre.diversitySeed,
    processingTimeMs: Date.now() - t0,
    diversityScore:   guardReport?.finalDiversityScore ?? 0,
    diversityAmplified: guardReport?.diversityAmplified ?? false,
    guardReport,
    tier,
    isFallback:       tier > FALLBACK_TIER.NORMAL,
    userMessage:      tier > FALLBACK_TIER.NORMAL
                      ? (data.userMessage ?? null) : null,
  };
 
  return {
    success:       tier === FALLBACK_TIER.NORMAL,
    tier,
    isFallback:    tier > FALLBACK_TIER.NORMAL,
 
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
 * @returns {Promise<ECardResult>}
 *
 * @example
 * const result = await analyzeImpression("신불산 억새밭이 정말 장관이었어요 🌾");
 *
 * // Three.js에 전달
 * stainedGlass.applyUniforms(result.shaderUniforms);
 *
 * // 타이포그래피 렌더
 * console.log(result.typography.primaryEmotion); // '경이로움'
 * console.log(result.typography.responseText);   // '울산 관광과 명의 답글...'
 *
 * // 색상 칩
 * console.log(result.palette.mainCss);           // 'hsl(40.0, 63.0%, 58.0%)'
 */
export async function analyzeImpression(rawText, options = {}) {
  const t0 = Date.now();
  const { spotIndex: forceSpot = null, language: forceLang = null, debugMode = false } = options;
 
  // ────────────────────────────────────────────────────────────────
  // STAGE 1: 입력 전처리
  // ────────────────────────────────────────────────────────────────
  const pre = preprocessInput(rawText);
  if (forceLang) pre.language = forceLang;
 
  if (debugMode) {
    const { debugPrint } = await import('./preprocessor.js');
    debugPrint(pre);
  }
 
  // 품질 미달 — 입력 요청 폴백
  if (!pre.quality.isAcceptable &&
      pre.quality.fallbackStrategy === 'request_more') {
    const fb = handleFallback(
      new Error('INPUT_QUALITY_POOR'),
      { diversitySeed: pre.diversitySeed, language: pre.language,
        stage: 'preprocessor' }
    );
    return formatECardResult({
      pre, extraction: fb.extraction, globalParams: null,
      panels: fb.panels, guardReport: null,
      spotIndex: fb.extraction.spotIndex, t0,
      tier: fb.tier, userMessage: pre.quality.uiMessage,
    });
  }
 
  // ────────────────────────────────────────────────────────────────
  // STAGE 2: AI 종합 감성 분석 (AI API)
  // ────────────────────────────────────────────────────────────────
  let extraction;
  try {
    extraction = await extractEmotions(pre);
    if (debugMode) {
      const { debugPrintExtraction } = await import('./claude-extractor.js');
      debugPrintExtraction(extraction);
    }
  } catch (err) {
    const fb = handleFallback(err, {
      diversitySeed: pre.diversitySeed,
      language:      pre.language,
      stage:         'claude-extractor',
    });
    extraction = fb.extraction;
  }
 
  // 경승지 인덱스 확정 (강제 지정 > AI 추출 > 시드 기반)
  const spotIndex = forceSpot !== null
    ? clamp(Math.round(forceSpot), 0, 11)
    : clamp(Math.round(extraction.spotIndex ?? 0), 0, 11);
 
  extraction.spotIndex = spotIndex;
 
  // ────────────────────────────────────────────────────────────────
  // STAGE 2.5: 감성 반응 행렬 적용 (panel-weights.js)
  // 경승지 고유 감성 반응 배수로 감성 점수 재조정
  // ────────────────────────────────────────────────────────────────
  const adjustedScores = applyEmotionMatrix(spotIndex, extraction.emotionScores);
  const adjustedExtraction = { ...extraction, emotionScores: adjustedScores };
 
  // ────────────────────────────────────────────────────────────────
  // STAGE 3: 색채 파라미터 합성 (param-synthesizer.js)
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
  // STAGE 4: 패널별 개별화 (panel-individualizer.js)
  // ────────────────────────────────────────────────────────────────
 let rawPanels;
  try {
    const panelSet = individualizeAllPanels(globalParams, pre.diversitySeed);

    // ★ 핵심 수정: panel-individualizer 출력을 diversity-guard 입력 형식으로 변환
    // finalHue → hue, finalSat → saturation, finalLight → lightness
    // spotIndex → index, spotName → name
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
  // STAGE 4.5: 패널별 맥락 추가 보정 (panel-weights.js)
  // 계절·시간·동행자 맥락을 패널마다 다른 강도로 적용
  // ────────────────────────────────────────────────────────────────
  const ctx = adjustedExtraction.contextAnalysis ?? {};
  const contextForMods = {
    season:      ctx.seasonContext?.detected    ?? null,
    timeContext: ctx.timeContext?.detected      ?? null,
    companion:   ctx.companionContext?.detected ?? null,
  };
  const contextModdedPanels = applyAllPanelContextMods(rawPanels, contextForMods);
 
  // ────────────────────────────────────────────────────────────────
  // STAGE 5: 다양성 보증 (diversity-guard.js)
  // ────────────────────────────────────────────────────────────────
  let finalPanels, guardReport;
  try {
    const guardResult = guardDiversity(
      contextModdedPanels,
      globalParams,
      pre.diversitySeed,
      // 다양성 증폭이 필요할 때 패널 재생성 콜백
      (amplifiedParams, seed) => {
        const rePanelSet = individualizeAllPanels(amplifiedParams, seed);
        // ★ 동일한 어댑터 적용
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
    console.log('다양성 점수:', (result.meta.diversityScore * 100).toFixed(1) + '%');
    console.groupEnd();
  }
 
  return result;
}
 
// =============================================================================
// ⑤ 단계별 단독 실행 함수 (테스트·디버그용)
// =============================================================================
 
/**
 * Stage 1만 실행한다. (전처리)
 * @param {string} rawText
 * @returns {Object} SlimPreprocessed
 */
export function runStage1(rawText) {
  return preprocessInput(rawText);
}
 
/**
 * Stage 1~2를 실행한다. (전처리 + AI 분석)
 * @param {string} rawText
 * @param {Object} [opts]
 * @returns {Promise<{ pre:Object, extraction:Object }>}
 */
export async function runStage1to2(rawText, opts = {}) {
  const pre        = preprocessInput(rawText);
  const extraction = await withFallback(
    () => extractEmotions(pre),
    { diversitySeed: pre.diversitySeed, language: pre.language, stage: 'stage2' }
  );
  return { pre, extraction };
}
 
/**
 * Stage 3만 실행한다. (색채 파라미터 합성)
 * ExtractionResult가 이미 있을 때 사용.
 * @param {Object} extraction
 * @param {number} [spotIndex]
 * @returns {Object} GlobalColorParams
 */
export function runStage3(extraction, spotIndex) {
  const idx     = spotIndex ?? extraction.spotIndex ?? 0;
  const adjusted = { ...extraction, emotionScores: applyEmotionMatrix(idx, extraction.emotionScores) };
  return synthesizeColorParams(adjusted);
}
 
/**
 * 감성 점수 객체만 직접 제공하여 색채 파라미터를 빠르게 계산한다.
 * 프로토타이핑·테스트 목적.
 * @param {Object} emotionScores  { amazement:0~100, ... }
 * @param {number} [spotIndex=0]
 * @returns {Object} GlobalColorParams
 */
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
 
/**
 * ECardResult가 유효한지 기본 검사한다.
 * @param {Object} result
 * @returns {{ valid:boolean, issues:string[] }}
 */
export function validateResult(result) {
  const issues = [];
  if (!result)                            issues.push('result가 null');
  if (!result?.typography?.responseText)  issues.push('responseText 없음');
  if (!Array.isArray(result?.allPanels))  issues.push('allPanels 없음');
  if (result?.allPanels?.length !== 12)   issues.push(`패널 수 오류: ${result?.allPanels?.length}`);
  if (!result?.palette?.main)             issues.push('palette.main 없음');
  if (!Array.isArray(result?.shaderUniforms)) issues.push('shaderUniforms 없음');
  return { valid: issues.length === 0, issues };
}
 
// =============================================================================
// ⑦ 디버그 출력
// =============================================================================
 
/**
 * ECardResult를 콘솔에 시각적으로 출력한다. (개발 전용)
 * @param {ECardResult} result
 */
export function debugPipeline(result) {
  /* eslint-disable no-console */
  console.group('🎨 ECardResult — 파이프라인 최종 출력');
 
  // 상태
  const tierLabels = ['✅ NORMAL','⚠️  PARTIAL','🟡 TEMPLATE','🔴 SEED_ONLY'];
  console.log('상태:', tierLabels[result.tier]);
  console.log('처리 시간:', result.meta.processingTimeMs + 'ms');
  console.log('언어:', result.meta.language, '| 입력길이:', result.meta.inputLength);
 
  // 타이포그래피
  console.group('📝 타이포그래피');
  console.log('유형:', result.typography.type);
  console.log('핵심 감성:', result.typography.primaryEmotion);
  console.log('키워드:', result.typography.keywords?.join(' · '));
  console.log('경승지:', result.typography.spotEmoji, result.typography.spotName);
  console.log('답글:', result.typography.responseText?.slice(0, 60) + '...');
  console.groupEnd();
 
  // 감성 점수
  console.group('💛 감성 점수');
  const scores = result.emotionScores;
  Object.entries(scores).forEach(([k, v]) => {
    const bar = '▓'.repeat(Math.round(v/10)).padEnd(10,'░');
    console.log(`  ${k.padEnd(12)} ${bar} ${v}`);
  });
  console.groupEnd();
 
  // 팔레트
  console.group('🎨 팔레트 (매칭 경승지)');
  console.log('main:', result.palette.mainCss);
  console.log('sub: ', result.palette.subCss);
  console.log('acc: ', result.palette.accCss);
  console.log('base:', result.palette.baseCss);
  console.groupEnd();
 
  // 패널
  console.group('🏞️ 12경 패널 색채');
  result.allPanels?.forEach((p) => {
    const mark = p.index === result.typography.spotIndex ? '★' : ' ';
    console.log(`${mark}[${p.index}] ${p.name?.padEnd(16)} ${p.cssHSL}`);
  });
  console.groupEnd();
 
  // 글로벌 파라미터
  const gp = result.globalParams;
  if (gp) {
    console.group('⚙️ 글로벌 색채 파라미터');
    console.log(`ΔHue:${gp.deltaHue?.toFixed(1)}° Sat:×${gp.deltaSat?.toFixed(2)} Light:${gp.deltaLight?.toFixed(3)}`);
    console.log(`Contrast:×${gp.deltaContrast?.toFixed(2)} Temp:${gp.colorTemp?.toFixed(0)}K LightDir:${gp.lightDir?.toFixed(1)}°`);
    console.groupEnd();
  }
 
  // 다양성
  console.log('🔮 다양성 점수:',
    (result.meta.diversityScore * 100).toFixed(1) + '%',
    result.meta.diversityAmplified ? '(증폭됨)' : ''
  );
 
  // 유효성
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
export { extractEmotions }           from './claude-extractor.js';
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