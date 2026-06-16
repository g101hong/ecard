/**
 * @fileoverview 울산 E-Card 답글 엔진 — 파이프라인 통합 진입점
 * @module reply-engine
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 전체 파이프라인 흐름
 * ─────────────────────────────────────────────────────────────────
 *
 *   rawText (방문객 소감)
 *       │
 *       ├──────────────────────────────────────────────────────────
 *       │  [emotion-engine — 기존 파이프라인]
 *       ├──────────────────────────────────────────────────────────
 *       │
 *       ▼ STAGE E-1  preprocessor.js (emotion-engine)
 *   SlimPreprocessed  ─ 정규화·언어감지·품질검사·다양성시드
 *       │
 *       ▼ STAGE E-2  claude-extractor.js (emotion-engine)
 *   ExtractionResult  ─ 감성8차원·경승지매칭·contextAnalysis
 *       │
 *       ├──────────────────────────────────────────────────────────
 *       │  [reply-engine — 이 파이프라인]
 *       ├──────────────────────────────────────────────────────────
 *       │
 *       ▼ STAGE R-1  visit-context.js
 *   VisitContext      ─ 계절·절기·시간대 시스템 자동 수집
 *       │
 *       ▼ STAGE R-2  context-classifier.js
 *   ClassifiedContext ─ 장소명/자연키워드/감성+계절/계절단독 분류
 *       │
 *       ▼ STAGE R-3  reply-generator.js  (Claude API)
 *   ReplyResult       ─ E-Card 3단 답글 생성
 *       │
 *       ▼ FORMAT
 *   ReplyEngineResult ─ 답글 + 컨텍스트 완전 패키지
 *
 * ─────────────────────────────────────────────────────────────────
 * 사용 예시
 * ─────────────────────────────────────────────────────────────────
 *
 *   import { generateReplyFromImpression } from './reply-engine/index.js';
 *
 *   // emotion-engine ExtractionResult가 이미 있을 때
 *   const result = await generateReplyFromImpression(
 *     extraction,           // emotion-engine 출력
 *     "파도 소리가 귓가에 맴돌아요",   // 원문 소감
 *     pre.cleanText,        // 정규화된 텍스트
 *     pre.diversitySeed     // 다양성 시드
 *   );
 *
 *   // E-Card 렌더링에 전달
 *   card.setReply(result.reply);       // main / place / tagline
 *   card.setContext(result.context);   // 계절 / 절기 / 시간대
 *
 *   // emotion-engine 없이 단독 실행 (전체 파이프라인 포함)
 *   const full = await generateReplyFull("태화강 대나무숲 힐링됐어요");
 *
 */

'use strict';

// =============================================================================
// ① 모듈 임포트
// =============================================================================

import { collectVisitContext }                    from './visit-context.js';
import { classify, CONTEXT_TYPE }                 from './context-classifier.js';
import { generateReply,
         validateReplyResult,
         REPLY_TIER }                             from './reply-generator.js';
import { handleReplyFallback,
         fallbackFromContext,
         withReplyFallback,
         validateFallbackResult,
         REPLY_ERROR_TYPES }                      from './reply-fallback.js';
import { NATURAL_CATEGORIES,
         detectNaturalKeyword }                   from './constants/natural-keywords.js';
import { SEASONS, SOLAR_TERMS }                   from './constants/solar-terms.js';
import { selectTemplate }                         from './constants/reply-templates.js';

// =============================================================================
// ② 결과 포매터
// =============================================================================

/**
 * @typedef {Object} ReplyEngineResult
 *
 * [핵심 출력 — E-Card 렌더링 직접 사용]
 * @property {boolean} success            파이프라인 성공 여부
 * @property {number}  tier               REPLY_TIER 값 (0=정상, 1~3=폴백)
 * @property {boolean} isFallback         폴백 사용 여부
 *
 * @property {{ main:string, place:string, tagline:string }} reply  E-Card 3단 답글
 *
 * [컨텍스트 — 추가 렌더링 활용]
 * @property {Object}  visitContext       방문 시점 컨텍스트 (계절·절기·시간대)
 * @property {Object}  classified         분류 결과 (contextType·placeExpression 등)
 *
 * [메타]
 * @property {Object}  meta
 * @property {number}  meta.processingTimeMs   전체 처리 시간
 * @property {string}  meta.contextType        분류 유형
 * @property {string}  meta.dominantEmotion    지배 감성
 * @property {string}  meta.season             계절
 * @property {string}  meta.placeExpression    장소 표현
 * @property {boolean} meta.isFallback         폴백 여부
 * @property {string}  [meta.errorType]        오류 유형 (폴백 시)
 * @property {string}  [meta.failedStage]      실패 단계 (폴백 시)
 */

/**
 * 내부 파이프라인 데이터를 ReplyEngineResult 형식으로 포맷한다.
 *
 * @param {Object} data
 * @returns {ReplyEngineResult}
 */
function _formatResult(data) {
  const { replyResult, classified, visitCtx, t0 } = data;

  return {
    success:    replyResult.success,
    tier:       replyResult.tier,
    isFallback: replyResult.isFallback,

    reply: {
      main:    replyResult.reply.main,
      place:   replyResult.reply.place,
      tagline: replyResult.reply.tagline,
    },

    visitContext: {
      season:          visitCtx.season,
      seasonLabel:     visitCtx.seasonLabel,
      seasonColorHint: visitCtx.seasonColorHint,
      solarTerm:       visitCtx.solarTerm,
      isNearSolarTerm: visitCtx.isNearSolarTerm,
      timeSlot:        visitCtx.timeSlot,
      timeExpression:  visitCtx.timeExpression,
      isWeekend:       visitCtx.isWeekend,
      visitedAt:       visitCtx.visitedAt,
    },

    classified: {
      contextType:       classified.contextType,
      spotIndex:         classified.spotIndex,
      spotName:          classified.spotName,
      naturalKeyword:    classified.naturalKeyword,
      naturalCategory:   classified.naturalCategory,
      dominantEmotion:   classified.dominantEmotion,
      primaryEmotion:    classified.primaryEmotion,
      keywords:          classified.keywords,
      placeExpression:   classified.placeExpression,
      colorTone:         classified.colorTone,
      langToneHint:      classified.langToneHint,
      contextSource:     classified.contextSource,
    },

    meta: {
      processingTimeMs: Date.now() - t0,
      contextType:      classified.contextType,
      dominantEmotion:  classified.dominantEmotion,
      season:           classified.season,
      placeExpression:  classified.placeExpression,
      isFallback:       replyResult.isFallback,
      ...(replyResult.meta?.errorType && {
        errorType:   replyResult.meta.errorType,
        failedStage: replyResult.meta.contextType,
      }),
    },
  };
}

// =============================================================================
// ③ 메인 파이프라인 함수 — emotion-engine 연동 버전
// =============================================================================

/**
 * emotion-engine의 ExtractionResult를 받아 답글을 생성한다.
 *
 * emotion-engine의 analyzeImpression()과 함께 사용하는 기본 진입점.
 * 감성 분석은 emotion-engine에서 이미 완료된 상태로 받는다.
 *
 * @param {Object} extraction       emotion-engine ExtractionResult
 * @param {string} originalText     방문객 소감 원문
 * @param {string} cleanText        전처리된 소감 텍스트 (preprocessor 출력)
 * @param {number} diversitySeed    다양성 시드 (preprocessor 출력)
 * @param {Object} [options]
 * @param {Date}   [options.date]   테스트용 날짜 주입 (기본: 현재 시각)
 * @param {boolean}[options.debugMode] 콘솔 디버그 출력 여부
 * @returns {Promise<ReplyEngineResult>}
 *
 * @example
 * // emotion-engine과 연동
 * const emotionResult = await analyzeImpression(rawText);
 * const replyResult   = await generateReplyFromImpression(
 *   emotionResult.extraction,
 *   rawText,
 *   emotionResult.pre.cleanText,
 *   emotionResult.pre.diversitySeed,
 * );
 * card.setReply(replyResult.reply);
 */
export async function generateReplyFromImpression(
  extraction,
  originalText = '',
  cleanText    = '',
  diversitySeed = 0,
  options = {},
) {
  const t0 = Date.now();
  const { date = new Date(), debugMode = false } = options;

  // ── STAGE R-1: 방문 시점 컨텍스트 수집 ──────────────────────────
  let visitCtx;
  try {
    visitCtx = collectVisitContext(date);
    if (debugMode) {
      const { debugPrintVisitContext } = await import('./visit-context.js');
      debugPrintVisitContext(visitCtx);
    }
  } catch (err) {
    console.warn('[reply-engine] visit-context 수집 실패, 폴백 사용:', err.message);
    return handleReplyFallback(err, {
      diversitySeed,
      stage: 'visit-context',
      dominantEmotion: extraction?.dominantEmotion ?? null,
      season:          null,
    });
  }

  // ── STAGE R-2: 컨텍스트 분류 ─────────────────────────────────────
  let classified;
  try {
    classified = classify(extraction, visitCtx, cleanText, diversitySeed);
    if (debugMode) {
      const { debugPrintClassified } = await import('./context-classifier.js');
      debugPrintClassified(classified);
    }
  } catch (err) {
    console.warn('[reply-engine] context-classifier 실패, 폴백 사용:', err.message);
    return handleReplyFallback(err, {
      diversitySeed,
      stage:           'context-classifier',
      dominantEmotion: extraction?.dominantEmotion ?? null,
      season:          visitCtx.season,
    });
  }

  // ── STAGE R-3: 답글 생성 (Claude API) ───────────────────────────
  const replyResult = await withReplyFallback(
    () => generateReply(classified, originalText),
    {
      diversitySeed,
      stage:           'reply-generator',
      dominantEmotion: classified.dominantEmotion,
      season:          classified.season,
      spotIndex:       classified.spotIndex,
      placeExpression: classified.placeExpression,
      contextType:     classified.contextType,
    },
  );

  if (debugMode) {
    const { debugPrintReplyResult } = await import('./reply-generator.js');
    debugPrintReplyResult(replyResult);
  }

  return _formatResult({ replyResult, classified, visitCtx, t0 });
}

// =============================================================================
// ④ 단독 실행 함수 — emotion-engine 없이 전체 파이프라인 실행
// =============================================================================

/**
 * 소감 원문만 받아 전처리 + 감성 분석 + 답글 생성을 모두 실행한다.
 *
 * emotion-engine 없이 reply-engine을 단독으로 사용할 때의 진입점.
 * 내부적으로 emotion-engine의 preprocessor와 claude-extractor를 직접 호출한다.
 *
 * @param {string}  rawText           방문객 소감 원문
 * @param {Object}  [options]
 * @param {Date}    [options.date]    테스트용 날짜 주입
 * @param {boolean} [options.debugMode] 콘솔 디버그 출력 여부
 * @returns {Promise<ReplyEngineResult>}
 *
 * @example
 * const result = await generateReplyFull("간절곶 일출 정말 감동이었어요 🌅");
 * console.log(result.reply.main);    // → "그 빛은 오래도록 당신 곁에 머물 것입니다"
 * console.log(result.reply.tagline); // → "ULSAN — 빛이 시작되는 곳"
 */
export async function generateReplyFull(rawText, options = {}) {
  const t0 = Date.now();
  const { date = new Date(), debugMode = false } = options;

  // emotion-engine 모듈 동적 임포트 (단독 실행 시에만 필요)
  let preprocessInput, extractEmotions;
  try {
    ({ preprocessInput } = await import('../emotion-engine/preprocessor.js'));
    ({ extractEmotions } = await import('../emotion-engine/ai-extractor.js'));
  } catch (importErr) {
    // emotion-engine을 찾을 수 없는 경우 시드 기반 폴백
    console.warn('[reply-engine] emotion-engine 임포트 실패, 시드 폴백 사용');
    const seed = Array.from(rawText).reduce((a, c) => a ^ c.charCodeAt(0), 0);
    return handleReplyFallback(importErr, {
      diversitySeed: seed,
      stage:         'emotion-engine-import',
    });
  }

  // STAGE E-1: 전처리
  const pre = preprocessInput(rawText);

  // 품질 미달 처리
  if (!pre.quality.isAcceptable) {
    return handleReplyFallback(new Error('INPUT_QUALITY_POOR'), {
      diversitySeed: pre.diversitySeed,
      stage:         'preprocessor',
    });
  }

  // STAGE E-2: 감성 분석
  let extraction;
  try {
    extraction = await extractEmotions(pre);
  } catch (err) {
    console.warn('[reply-engine] extractEmotions 실패, 폴백 사용:', err.message);
    extraction = {
      emotionScores:   { amazement:40, peace:40, vitality:35, nostalgia:35,
                         freshness:35, grandeur:35, warmth:40, mystery:30 },
      dominantEmotion: 'peace',
      primaryEmotion:  '울산의 감동',
      keywords:        ['자연','아름다움','감동','힐링','울산'],
      spotIndex:       pre.diversitySeed % 12,
      contextAnalysis: { timeContext:    { detected:null, confidence:0 },
                         seasonContext:  { detected:null, confidence:0 },
                         companionContext:{ detected:null, confidence:0 } },
    };
  }

  // STAGE R-1 ~ R-3: 답글 생성
  return generateReplyFromImpression(
    extraction,
    rawText,
    pre.cleanText,
    pre.diversitySeed,
    { date, debugMode },
  );
}

// =============================================================================
// ⑤ 유효성 검사
// =============================================================================

/**
 * ReplyEngineResult가 유효한지 검사한다.
 *
 * @param {ReplyEngineResult} result
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateReplyEngineResult(result) {
  const issues = [];

  if (!result)                             issues.push('result null');
  if (!result?.reply)                      issues.push('reply 없음');
  if (!result?.reply?.main?.trim())        issues.push('reply.main 없음');
  if (!result?.reply?.place?.trim())       issues.push('reply.place 없음');
  if (!result?.reply?.tagline?.startsWith('ULSAN'))
                                           issues.push('tagline ULSAN 형식 오류');
  if (!result?.visitContext)               issues.push('visitContext 없음');
  if (!result?.visitContext?.season)       issues.push('visitContext.season 없음');
  if (!result?.classified)                 issues.push('classified 없음');
  if (!result?.classified?.contextType)   issues.push('classified.contextType 없음');
  if (typeof result?.tier !== 'number')    issues.push('tier 없음');

  return { valid: issues.length === 0, issues };
}

// =============================================================================
// ⑥ 단계별 단독 실행 함수 (테스트·디버그용)
// =============================================================================

/**
 * Stage R-1만 실행한다. (방문 컨텍스트 수집)
 * @param {Date} [date]
 * @returns {import('./visit-context.js').VisitContext}
 */
export function runStageR1(date = new Date()) {
  return collectVisitContext(date);
}

/**
 * Stage R-1 ~ R-2를 실행한다. (컨텍스트 수집 + 분류)
 * @param {Object} extraction   emotion-engine ExtractionResult
 * @param {string} cleanText    정규화된 소감 텍스트
 * @param {number} diversitySeed
 * @param {Date}   [date]
 * @returns {{ visitCtx, classified }}
 */
export function runStageR1toR2(extraction, cleanText, diversitySeed, date = new Date()) {
  const visitCtx  = collectVisitContext(date);
  const classified = classify(extraction, visitCtx, cleanText, diversitySeed);
  return { visitCtx, classified };
}

/**
 * 감성 점수 객체만으로 빠르게 폴백 답글을 생성한다. (프로토타이핑용)
 *
 * @param {Object} emotionScores  { amazement:0~100, ... }
 * @param {string} season         'spring'|'summer'|'autumn'|'winter'
 * @param {number} [seed=0]
 * @returns {{ main:string, place:string, tagline:string, tier:string }}
 */
export function quickReply(emotionScores, season, seed = 0) {
  const EMOTIONS = ['amazement','peace','vitality','nostalgia',
                    'freshness','grandeur','warmth','mystery'];
  const dominant  = EMOTIONS.reduce(
    (best, k) => (emotionScores[k] ?? 0) > (emotionScores[best] ?? 0) ? k : best,
    EMOTIONS[0],
  );
  return selectTemplate({ dominantEmotion: dominant, season, diversitySeed: seed });
}

// =============================================================================
// ⑦ 디버그 유틸리티
// =============================================================================

/**
 * ReplyEngineResult를 콘솔에 출력한다. (개발 전용)
 * @param {ReplyEngineResult} result
 */
export function debugReplyPipeline(result) {
  /* eslint-disable no-console */
  const TIER_LABELS = ['✅ NORMAL', '⚠️  PARTIAL', '🟡 TEMPLATE', '🔴 SEED'];

  console.group('💬 ReplyEngineResult — 파이프라인 최종 출력');
  console.log('상태       :', TIER_LABELS[result.tier] ?? result.tier);
  console.log('처리 시간  :', result.meta.processingTimeMs + 'ms');

  console.group('📝 E-Card 3단 답글');
  console.log('main    :', result.reply?.main);
  console.log('place   :', result.reply?.place);
  console.log('tagline :', result.reply?.tagline);
  console.groupEnd();

  console.group('🗂️ 분류 결과');
  console.log('contextType    :', result.classified?.contextType);
  console.log('placeExpression:', result.classified?.placeExpression);
  console.log('dominantEmotion:', result.classified?.dominantEmotion);
  console.log('contextSource  :', result.classified?.contextSource);
  console.groupEnd();

  console.group('📍 방문 컨텍스트');
  console.log('계절   :', result.visitContext?.seasonLabel,
    `(${result.visitContext?.season})`);
  console.log('절기   :', result.visitContext?.solarTerm?.name,
    result.visitContext?.isNearSolarTerm ? '(근접 ✅)' : '');
  console.log('시간대 :', result.visitContext?.timeSlot?.label);
  console.log('시간표현:', result.visitContext?.timeExpression);
  console.groupEnd();

  if (result.isFallback) {
    console.group('🆘 폴백 정보');
    console.log('errorType  :', result.meta.errorType);
    console.log('failedStage:', result.meta.failedStage);
    console.groupEnd();
  }

  const { valid, issues } = validateReplyEngineResult(result);
  console.log('유효성 :', valid ? '✅ 통과' : '❌ ' + issues.join(', '));

  console.groupEnd();
  /* eslint-enable no-console */
}

// =============================================================================
// ⑧ 재수출 (Re-exports)
// =============================================================================

export { collectVisitContext }                   from './visit-context.js';
export { classify, detectSpotName, CONTEXT_TYPE } from './context-classifier.js';
export { generateReply, REPLY_TIER }             from './reply-generator.js';
export { handleReplyFallback,
         fallbackFromContext,
         withReplyFallback,
         REPLY_ERROR_TYPES }                     from './reply-fallback.js';
export { selectTemplate }                        from './constants/reply-templates.js';
export { detectNaturalKeyword,
         NATURAL_CATEGORIES }                    from './constants/natural-keywords.js';
export { getVisitTimeContext,
         getSeason, getSolarTerm, getTimeSlot }  from './constants/solar-terms.js';

// =============================================================================
// Default Export
// =============================================================================

export default {
  generateReplyFromImpression,
  generateReplyFull,
  validateReplyEngineResult,
  runStageR1,
  runStageR1toR2,
  quickReply,
  debugReplyPipeline,
  REPLY_TIER,
  CONTEXT_TYPE,
  REPLY_ERROR_TYPES,
};
