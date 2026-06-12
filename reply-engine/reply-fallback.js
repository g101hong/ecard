/**
 * @fileoverview 울산 E-Card 답글 엔진 — 폴백 처리 모듈
 * @module reply-engine/reply-fallback
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   reply-engine 파이프라인의 안전망.
 *   어떤 단계에서 오류가 발생해도 방문객에게는
 *   반드시 유효한 답글을 전달한다.
 *
 *   emotion-engine/fallback-handler.js의 설계 철학을
 *   reply-engine 전용으로 구현한다:
 *
 *   "어떤 오류가 발생해도 방문객에게는 반드시 답글을 전달한다."
 *
 * ─────────────────────────────────────────────────────────────────
 * [폴백 품질 계층]
 *
 *   TIER 0  NORMAL        API 정상 성공          (이 파일 해당 없음)
 *   TIER 1  PARTIAL       응답 일부 보정 후 사용
 *   TIER 2  TEMPLATE      감성+계절 템플릿 선택
 *   TIER 3  SEED          시드 기반 순수 계산
 *
 * ─────────────────────────────────────────────────────────────────
 * [사용 시나리오]
 *
 *   시나리오 A — API 호출 전 컨텍스트 구성 실패
 *     classify()나 collectVisitContext()에서 오류 발생
 *     → handleReplyFallback(err, { diversitySeed, stage:'classifier' })
 *
 *   시나리오 B — API 호출 실패 (reply-generator 내부)
 *     reply-generator가 이미 내부에서 selectTemplate으로 처리
 *     → 이 모듈은 generator 바깥 래퍼로 사용
 *
 *   시나리오 C — index.js 최상위 안전망
 *     파이프라인 전체가 실패했을 때 최후 보루
 *     → withReplyFallback(asyncFn, context)
 *
 * ─────────────────────────────────────────────────────────────────
 * [emotion-engine 연동]
 *
 *   REPLY_TIER 값은 emotion-engine/fallback-handler.js의
 *   FALLBACK_TIER와 동일한 0~3 정수를 사용한다.
 *   index.js가 두 엔진의 결과를 통합할 때 일관성을 유지한다.
 */
 
'use strict';
 
import { selectTemplate }  from './constants/reply-templates.js';
import { REPLY_TIER }      from './reply-generator.js';
 
// =============================================================================
// ① 오류 유형 분류
// =============================================================================
 
/**
 * reply-engine 전용 오류 유형 상수.
 * emotion-engine/fallback-handler.js의 ERROR_TYPES와 키값을 통일한다.
 */
export const REPLY_ERROR_TYPES = Object.freeze({
  NETWORK_TIMEOUT:   'NETWORK_TIMEOUT',
  NETWORK_OFFLINE:   'NETWORK_OFFLINE',
  API_RATE_LIMIT:    'API_RATE_LIMIT',
  API_SERVER_ERROR:  'API_SERVER_ERROR',
  API_AUTH_ERROR:    'API_AUTH_ERROR',
  JSON_PARSE_ERROR:  'JSON_PARSE_ERROR',
  CLASSIFIER_ERROR:  'CLASSIFIER_ERROR',   // context-classifier 실패
  CONTEXT_ERROR:     'CONTEXT_ERROR',      // visit-context 수집 실패
  INVALID_INPUT:     'INVALID_INPUT',      // 유효하지 않은 입력
  UNKNOWN:           'UNKNOWN',
});
 
/**
 * Error 객체를 분석하여 REPLY_ERROR_TYPES 중 하나를 반환한다.
 *
 * @param {Error|unknown} err
 * @returns {string}
 */
export function classifyReplyError(err) {
  if (!err) return REPLY_ERROR_TYPES.UNKNOWN;
 
  const msg    = (err.message ?? String(err)).toLowerCase();
  const status = err.status ?? err.statusCode ?? 0;
 
  if (status === 429)                              return REPLY_ERROR_TYPES.API_RATE_LIMIT;
  if (status === 401 || status === 403)            return REPLY_ERROR_TYPES.API_AUTH_ERROR;
  if (status >= 500)                               return REPLY_ERROR_TYPES.API_SERVER_ERROR;
  if (msg.includes('abort') || msg.includes('timeout')) return REPLY_ERROR_TYPES.NETWORK_TIMEOUT;
  if (msg.includes('fetch') || msg.includes('offline'))  return REPLY_ERROR_TYPES.NETWORK_OFFLINE;
  if (msg.includes('json')  || msg.includes('parse'))    return REPLY_ERROR_TYPES.JSON_PARSE_ERROR;
  if (msg.includes('classify') || msg.includes('context-classifier'))
    return REPLY_ERROR_TYPES.CLASSIFIER_ERROR;
  if (msg.includes('visit') || msg.includes('solar'))
    return REPLY_ERROR_TYPES.CONTEXT_ERROR;
 
  return REPLY_ERROR_TYPES.UNKNOWN;
}
 
// =============================================================================
// ② 시드 기반 감성·계절 추출
// =============================================================================
 
/**
 * diversitySeed만으로 결정론적 감성 키와 계절을 생성한다.
 * ClassifiedContext가 없을 때의 최후 수단.
 *
 * @param {number} seed
 * @returns {{ dominantEmotion: string, season: string }}
 */
function _seedToEmotionSeason(seed) {
  const EMOTIONS = [
    'amazement','peace','vitality','nostalgia',
    'freshness','grandeur','warmth','mystery',
  ];
  const SEASONS = ['spring','summer','autumn','winter'];
 
  const dominantEmotion = EMOTIONS[seed % EMOTIONS.length];
  const season          = SEASONS[Math.floor(seed / EMOTIONS.length) % SEASONS.length];
 
  return { dominantEmotion, season };
}
 
// =============================================================================
// ③ 폴백 ReplyResult 생성
// =============================================================================
 
/**
 * @typedef {Object} ReplyFallbackContext
 * @property {number}  diversitySeed   preprocessor의 다양성 시드
 * @property {string}  [stage]         실패한 파이프라인 단계명
 * @property {string}  [dominantEmotion] 알고 있는 지배 감성 (있으면 활용)
 * @property {string}  [season]          알고 있는 계절 (있으면 활용)
 * @property {number}  [spotIndex]       알고 있는 경승지 인덱스
 * @property {string}  [placeExpression] 알고 있는 장소 표현
 * @property {string}  [contextType]     알고 있는 contextType
 */
 
/**
 * @typedef {Object} ReplyFallbackResult
 * @property {boolean} success       false
 * @property {number}  tier          REPLY_TIER.TEMPLATE 또는 REPLY_TIER.SEED
 * @property {boolean} isFallback    true
 * @property {{ main:string, place:string, tagline:string }} reply
 * @property {Object}  meta
 * @property {string}  meta.errorType
 * @property {string}  meta.stage
 * @property {string}  meta.templateTier  'emotion_season'|'season_only'|'common_fallback'
 * @property {number}  meta.processingTimeMs
 * @property {string}  meta.dominantEmotion
 * @property {string}  meta.season
 */
 
/**
 * 오류 정보와 컨텍스트를 받아 폴백 ReplyResult를 생성한다.
 *
 * 전략 결정:
 *   1. ClassifiedContext의 감성·계절 정보가 있으면 → TEMPLATE (고품질)
 *   2. 없으면 diversitySeed로 감성·계절 추출 → SEED
 *
 * @param {Error|null}          err      발생한 오류 (null 허용)
 * @param {ReplyFallbackContext} context 폴백 생성 컨텍스트
 * @returns {ReplyFallbackResult}
 *
 * @example
 * // 분류 단계 실패 시
 * const fallback = handleReplyFallback(err, {
 *   diversitySeed: 42,
 *   stage: 'context-classifier',
 * });
 * fallback.reply.main    // → "가을 울산의 고요가 잠시 당신 것이었습니다"
 * fallback.isFallback    // → true
 * fallback.tier          // → 2 (TEMPLATE)
 */
export function handleReplyFallback(err, context) {
  const t0 = Date.now();
 
  const {
    diversitySeed   = 0,
    stage           = 'unknown',
    dominantEmotion: ctxEmotion = null,
    season:          ctxSeason  = null,
    spotIndex        = 0,
    placeExpression  = '울산',
    contextType      = null,
  } = context;
 
  const errorType = classifyReplyError(err);
 
  // ── 감성·계절 결정 ────────────────────────────────────────────
  // 컨텍스트에 정보가 있으면 활용, 없으면 시드 기반 생성
  const hasSufficientContext = ctxEmotion && ctxSeason;
 
  const { dominantEmotion, season } = hasSufficientContext
    ? { dominantEmotion: ctxEmotion, season: ctxSeason }
    : _seedToEmotionSeason(diversitySeed);
 
  const tier = hasSufficientContext ? REPLY_TIER.TEMPLATE : REPLY_TIER.SEED;
 
  // ── 템플릿 선택 ───────────────────────────────────────────────
  const selected = selectTemplate({ dominantEmotion, season, diversitySeed });
 
  return {
    success:    false,
    tier,
    isFallback: true,
    reply: {
      main:    selected.main,
      place:   selected.place,
      tagline: selected.tagline,
    },
    meta: {
      errorType,
      stage,
      templateTier:     selected.tier,
      processingTimeMs: Date.now() - t0,
      dominantEmotion,
      season,
      spotIndex,
      placeExpression,
      contextType,
      isSeedBased: !hasSufficientContext,
    },
  };
}
 
// =============================================================================
// ④ ClassifiedContext 기반 즉시 폴백
// =============================================================================
 
/**
 * ClassifiedContext를 직접 받아 폴백 ReplyResult를 생성한다.
 * reply-generator가 API 없이 즉시 결과를 반환해야 할 때 사용.
 *
 * @param {import('./context-classifier.js').ClassifiedContext} ctx
 * @returns {ReplyFallbackResult}
 *
 * @example
 * // API 호출 없이 즉시 템플릿 답글 필요 시
 * const fallback = fallbackFromContext(classified);
 */
export function fallbackFromContext(ctx) {
  return handleReplyFallback(null, {
    diversitySeed:   ctx.diversitySeed   ?? 0,
    stage:           'fallback-from-context',
    dominantEmotion: ctx.dominantEmotion ?? null,
    season:          ctx.season          ?? null,
    spotIndex:       ctx.spotIndex       ?? 0,
    placeExpression: ctx.placeExpression ?? '울산',
    contextType:     ctx.contextType     ?? null,
  });
}
 
// =============================================================================
// ⑤ 비동기 파이프라인 래퍼
// =============================================================================
 
/**
 * 비동기 함수를 폴백 안전망으로 감싼다.
 * reply-engine/index.js에서 각 단계를 보호하는 데 사용.
 *
 * 성공 시: 원래 함수의 결과에 { success:true, tier:0 } 추가
 * 실패 시: handleReplyFallback 결과 반환
 *
 * @template T
 * @param {() => Promise<T>}    asyncFn  보호할 비동기 함수
 * @param {ReplyFallbackContext} context 폴백 컨텍스트
 * @returns {Promise<T | ReplyFallbackResult>}
 *
 * @example
 * const result = await withReplyFallback(
 *   () => generateReply(classified, text),
 *   { diversitySeed: seed, stage: 'reply-generator',
 *     dominantEmotion: ctx.dominantEmotion, season: ctx.season }
 * );
 * if (result.isFallback) {
 *   console.log('폴백 사용:', result.meta.errorType);
 * }
 */
export async function withReplyFallback(asyncFn, context) {
  try {
    const result = await asyncFn();
    // 성공 결과에 success 플래그 보장
    if (result && typeof result === 'object' && !('success' in result)) {
      return { ...result, success: true, tier: REPLY_TIER.NORMAL };
    }
    return result;
  } catch (err) {
    console.warn(
      `[reply-fallback] ${context.stage ?? 'unknown'} 실패:`,
      err?.message,
    );
    return handleReplyFallback(err, context);
  }
}
 
// =============================================================================
// ⑥ 유효성 검사
// =============================================================================
 
/**
 * ReplyFallbackResult가 유효한지 검사한다.
 *
 * @param {ReplyFallbackResult} result
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateFallbackResult(result) {
  const issues = [];
 
  if (!result)                               issues.push('result null');
  if (!result?.reply)                        issues.push('reply 없음');
  if (!result?.reply?.main?.trim())          issues.push('reply.main 없음');
  if (!result?.reply?.place?.trim())         issues.push('reply.place 없음');
  if (!result?.reply?.tagline?.startsWith('ULSAN'))
                                             issues.push('tagline ULSAN 형식 오류');
  if (result?.isFallback !== true)           issues.push('isFallback이 true가 아님');
  if (![REPLY_TIER.PARTIAL, REPLY_TIER.TEMPLATE, REPLY_TIER.SEED].includes(result?.tier))
                                             issues.push(`tier 값 오류: ${result?.tier}`);
 
  return { valid: issues.length === 0, issues };
}
 
// =============================================================================
// ⑦ 디버그 유틸리티
// =============================================================================
 
/**
 * 폴백 결과를 콘솔에 출력한다. (개발 전용)
 * @param {ReplyFallbackResult} result
 */
export function debugPrintFallbackResult(result) {
  /* eslint-disable no-console */
  const TIER_LABELS = ['✅ NORMAL','⚠️ PARTIAL','🟡 TEMPLATE','🔴 SEED'];
 
  console.group('🆘 ReplyFallbackResult (reply-fallback)');
  console.log('tier         :', TIER_LABELS[result.tier] ?? result.tier);
  console.log('errorType    :', result.meta?.errorType);
  console.log('stage        :', result.meta?.stage);
  console.log('templateTier :', result.meta?.templateTier);
  console.log('isSeedBased  :', result.meta?.isSeedBased ? '⚠️ 시드 기반' : '✅ 컨텍스트 기반');
  console.log('');
 
  console.group('📝 폴백 답글');
  console.log('main    :', result.reply?.main);
  console.log('place   :', result.reply?.place);
  console.log('tagline :', result.reply?.tagline);
  console.groupEnd();
 
  console.group('📊 메타');
  console.log('dominantEmotion:', result.meta?.dominantEmotion);
  console.log('season         :', result.meta?.season);
  console.log('spotIndex      :', result.meta?.spotIndex);
  console.log('placeExpression:', result.meta?.placeExpression);
  console.log('processingTimeMs:', result.meta?.processingTimeMs + 'ms');
  console.groupEnd();
 
  const { valid, issues } = validateFallbackResult(result);
  console.log('유효성 :', valid ? '✅' : '❌ ' + issues.join(' | '));
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  handleReplyFallback,
  fallbackFromContext,
  withReplyFallback,
  classifyReplyError,
  validateFallbackResult,
  debugPrintFallbackResult,
  REPLY_ERROR_TYPES,
};