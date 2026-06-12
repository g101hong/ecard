/**
 * @fileoverview 울산 E-Card 답글 엔진 — 방문 시점 컨텍스트 수집 모듈
 * @module reply-engine/visit-context
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   방문객이 아무것도 입력하지 않아도 시스템에서 자동으로 수집되는
 *   "방문 시점 컨텍스트(VisitContext)"를 생성한다.
 *
 *   solar-terms.js의 원시 시간 데이터를
 *   reply-engine 전체 파이프라인이 바로 사용할 수 있는
 *   완성된 컨텍스트 객체로 조립하는 것이 이 모듈의 핵심 역할이다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [emotion-engine 연동]
 *
 *   VisitContext의 두 키값은 emotion-engine과 직결된다:
 *
 *   paramSeasonKey  → param-synthesizer.getSeasonModifier() 키값
 *   paramTimeKey    → param-synthesizer.getTimeModifier()   키값
 *
 *   reply-engine/index.js가 색채 파라미터를 보정할 때
 *   이 값들을 emotion-engine에 그대로 전달한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [파이프라인 내 위치]
 *
 *   소감 텍스트 입력
 *         │
 *         ├── emotion-engine (감성 분석)
 *         │
 *         └── visit-context.js ← 이 모듈 (시스템 자동 수집)
 *                   │
 *                   ▼
 *             context-classifier.js (두 결과 통합)
 *
 * ─────────────────────────────────────────────────────────────────
 * [출력 구조 — VisitContext]
 *
 *   {
 *     // ── 시간 정보 ──────────────────────────────────────────
 *     visitedAt      : ISO 8601 문자열
 *     month          : 1~12
 *     hour           : 0~23
 *     isWeekend      : boolean
 *
 *     // ── 계절 ───────────────────────────────────────────────
 *     season         : 'spring'|'summer'|'autumn'|'winter'
 *     seasonLabel    : '봄'|'여름'|'가을'|'겨울'
 *     seasonLangTone : 계절 언어 분위기 힌트
 *     seasonColorHint: 계절 색채 힌트
 *
 *     // ── 24절기 ─────────────────────────────────────────────
 *     solarTerm      : SOLAR_TERMS 항목 전체
 *     isNearSolarTerm: 절기 3일 이내 여부
 *
 *     // ── 시간대 ─────────────────────────────────────────────
 *     timeSlot       : TIME_SLOTS 항목 전체
 *
 *     // ── 답글 문장 재료 ──────────────────────────────────────
 *     timeExpression : "동지의 오전" | "가을 오후" 등
 *     langToneHint   : 절기 + 시간대 언어 분위기 결합 문자열
 *
 *     // ── emotion-engine 직결 키값 ───────────────────────────
 *     paramSeasonKey : 'spring'|'summer'|'autumn'|'winter'
 *     paramTimeKey   : 'morning'|'afternoon'|'evening'|'night'
 *   }
 */
 
'use strict';
 
import {
  getVisitTimeContext,
  buildTimeExpression,
  buildLangToneHint,
} from './constants/solar-terms.js';
 
// =============================================================================
// ① 핵심 수집 함수
// =============================================================================
 
/**
 * @typedef {Object} VisitContext
 *
 * [시간 정보]
 * @property {string}  visitedAt        방문 시각 ISO 8601
 * @property {number}  month            방문 월 (1~12)
 * @property {number}  hour             방문 시각 (0~23)
 * @property {boolean} isWeekend        주말 여부
 *
 * [계절]
 * @property {string}  season           'spring'|'summer'|'autumn'|'winter'
 * @property {string}  seasonLabel      '봄'|'여름'|'가을'|'겨울'
 * @property {string}  seasonLangTone   계절 언어 분위기
 * @property {string}  seasonColorHint  계절 색채 힌트
 *
 * [24절기]
 * @property {Object}  solarTerm        SOLAR_TERMS 항목
 * @property {boolean} isNearSolarTerm  절기 3일 이내 여부
 *
 * [시간대]
 * @property {Object}  timeSlot         TIME_SLOTS 항목
 *
 * [답글 문장 재료]
 * @property {string}  timeExpression   "동지의 오전" | "가을 오후" 등
 * @property {string}  langToneHint     절기 + 시간대 언어 분위기 결합
 *
 * [emotion-engine 직결]
 * @property {string}  paramSeasonKey   param-synthesizer 계절 키값
 * @property {string}  paramTimeKey     param-synthesizer 시간대 키값
 *
 * [메타]
 * @property {number}  collectedAt      수집 시각 타임스탬프 (ms)
 */
 
/**
 * 현재 시각 기준 방문 컨텍스트를 수집하여 반환한다.
 *
 * reply-engine 파이프라인의 시작점에서 단 한 번 호출되며
 * 이후 모든 단계에 이 객체가 전달된다.
 *
 * @param {Date} [date=new Date()]  테스트용 날짜 주입 가능
 * @returns {VisitContext}
 *
 * @example
 * const ctx = collectVisitContext();
 * // ctx.season          → 'autumn'
 * // ctx.solarTerm.name  → '한로'
 * // ctx.timeSlot.label  → '오후'
 * // ctx.timeExpression  → '한로의 오후'
 * // ctx.paramSeasonKey  → 'autumn'   ← emotion-engine 직결
 * // ctx.paramTimeKey    → 'afternoon' ← emotion-engine 직결
 * // ctx.isNearSolarTerm → true       (절기 3일 이내)
 */
export function collectVisitContext(date = new Date()) {
  const t0  = Date.now();
 
  // solar-terms.js 에서 원시 시간 컨텍스트 수집
  const timeCtx = getVisitTimeContext(date);
 
  // 절기 근접 여부 계산
  const isNearSolarTerm = _isNearTerm(
    date,
    timeCtx.solarTerm.month,
    timeCtx.solarTerm.day,
  );
 
  // 답글 문장 재료 생성
  const timeExpression = buildTimeExpression(timeCtx, date);
  const langToneHint   = buildLangToneHint(timeCtx);
 
  return {
    // ── 시간 정보 ──────────────────────────────────────────────
    visitedAt:       timeCtx.visitedAt,
    month:           timeCtx.month,
    hour:            timeCtx.hour,
    isWeekend:       timeCtx.isWeekend,
 
    // ── 계절 ───────────────────────────────────────────────────
    season:          timeCtx.season,
    seasonLabel:     timeCtx.seasonLabel,
    seasonLangTone:  timeCtx.seasonLangTone,
    seasonColorHint: timeCtx.seasonColorHint,
 
    // ── 24절기 ─────────────────────────────────────────────────
    solarTerm:       timeCtx.solarTerm,
    isNearSolarTerm,
 
    // ── 시간대 ─────────────────────────────────────────────────
    timeSlot:        timeCtx.timeSlot,
 
    // ── 답글 문장 재료 ──────────────────────────────────────────
    timeExpression,
    langToneHint,
 
    // ── emotion-engine 직결 키값 ───────────────────────────────
    paramSeasonKey:  timeCtx.paramSeasonKey,
    paramTimeKey:    timeCtx.paramTimeKey,
 
    // ── 메타 ───────────────────────────────────────────────────
    collectedAt:     t0,
  };
}
 
// =============================================================================
// ② 내부 유틸리티
// =============================================================================
 
/**
 * 주어진 날짜가 절기 당일 또는 ±3일 이내인지 확인한다.
 *
 * @param {Date}   date         현재 날짜
 * @param {number} termMonth    절기 월 (1~12)
 * @param {number} termDay      절기 일
 * @returns {boolean}
 */
function _isNearTerm(date, termMonth, termDay) {
  const curMonth = date.getMonth() + 1;
  const curDay   = date.getDate();
 
  if (curMonth !== termMonth) return false;
  return Math.abs(curDay - termDay) <= 3;
}
 
// =============================================================================
// ③ emotion-engine ExtractionResult 와의 컨텍스트 병합
// =============================================================================
 
/**
 * emotion-engine의 ExtractionResult.contextAnalysis와
 * VisitContext를 병합하여 최종 통합 컨텍스트를 반환한다.
 *
 * 병합 우선순위:
 *   - 시간대: AI 감지(confidence ≥ 0.6) > 시스템 실측값
 *   - 계절:   AI 감지(confidence ≥ 0.6) > 시스템 실측값
 *   - 절기·isWeekend·isNearSolarTerm: 시스템 실측값 고정
 *
 * AI가 소감 텍스트에서 감지한 맥락이 더 정확할 때 우선 적용하되
 * 감지 신뢰도가 낮으면 시스템 시각을 신뢰한다.
 *
 * @param {VisitContext} visitCtx          collectVisitContext() 반환값
 * @param {Object|null}  contextAnalysis   ExtractionResult.contextAnalysis
 * @returns {MergedContext}
 *
 * @typedef {Object} MergedContext
 * @property {string}  season           최종 계절 키값
 * @property {string}  seasonLabel      최종 계절 한글
 * @property {string}  timeSlotLabel    최종 시간대 한글
 * @property {string}  paramSeasonKey   emotion-engine 계절 키
 * @property {string}  paramTimeKey     emotion-engine 시간 키
 * @property {string}  timeExpression   답글 문장 재료
 * @property {string}  langToneHint     언어 분위기 힌트
 * @property {boolean} isNearSolarTerm  절기 근접 여부
 * @property {boolean} isWeekend        주말 여부
 * @property {Object}  solarTerm        절기 정보
 * @property {string}  source           컨텍스트 출처 요약
 *
 * @example
 * const merged = mergeWithExtractionContext(visitCtx, extraction.contextAnalysis);
 * // merged.season        → 'summer'  (AI가 "여름 바다"를 감지해 덮어씀)
 * // merged.paramTimeKey  → 'evening' (AI가 "저녁"을 감지, confidence 0.9)
 * // merged.source        → 'season:ai / time:ai'
 */
export function mergeWithExtractionContext(visitCtx, contextAnalysis) {
  const AI_CONFIDENCE_THRESHOLD = 0.6;
 
  // ── 계절 결정 ───────────────────────────────────────────────────
  const aiSeason     = contextAnalysis?.seasonContext?.detected ?? null;
  const aiSeasonConf = contextAnalysis?.seasonContext?.confidence ?? 0;
  const useAiSeason  = aiSeason && aiSeasonConf >= AI_CONFIDENCE_THRESHOLD;
 
  const finalSeason      = useAiSeason ? aiSeason     : visitCtx.season;
  const finalSeasonLabel = useAiSeason
    ? _seasonLabel(aiSeason)
    : visitCtx.seasonLabel;
 
  // ── 시간대 결정 ─────────────────────────────────────────────────
  const aiTime     = contextAnalysis?.timeContext?.detected ?? null;
  const aiTimeConf = contextAnalysis?.timeContext?.confidence ?? 0;
  const useAiTime  = aiTime && aiTimeConf >= AI_CONFIDENCE_THRESHOLD;
 
  const finalParamTimeKey   = useAiTime ? aiTime : visitCtx.paramTimeKey;
  const finalTimeSlotLabel  = useAiTime
    ? _timeLabel(aiTime)
    : visitCtx.timeSlot.label;
 
  // ── 컨텍스트 출처 기록 ──────────────────────────────────────────
  const source = [
    `season:${useAiSeason ? 'ai' : 'system'}`,
    `time:${useAiTime   ? 'ai' : 'system'}`,
  ].join(' / ');
 
  // ── timeExpression 재생성 ───────────────────────────────────────
  const timeExpression = visitCtx.isNearSolarTerm
    ? `${visitCtx.solarTerm.name}의 ${finalTimeSlotLabel}`
    : `${finalSeasonLabel} ${finalTimeSlotLabel}`;
 
  return {
    season:          finalSeason,
    seasonLabel:     finalSeasonLabel,
    timeSlotLabel:   finalTimeSlotLabel,
    paramSeasonKey:  finalSeason,
    paramTimeKey:    finalParamTimeKey,
    timeExpression,
    langToneHint:    visitCtx.langToneHint,
    isNearSolarTerm: visitCtx.isNearSolarTerm,
    isWeekend:       visitCtx.isWeekend,
    solarTerm:       visitCtx.solarTerm,
    source,
  };
}
 
// =============================================================================
// ④ 내부 레이블 변환 헬퍼
// =============================================================================
 
/**
 * 계절 키값 → 한글 레이블
 * @param {string} season
 * @returns {string}
 */
function _seasonLabel(season) {
  return { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' }[season] ?? '이 계절';
}
 
/**
 * 시간대 paramKey → 대표 한글 레이블
 * @param {string} paramKey  'morning'|'afternoon'|'evening'|'night'
 * @returns {string}
 */
function _timeLabel(paramKey) {
  return {
    morning:   '아침',
    afternoon: '오후',
    evening:   '저녁',
    night:     '밤',
  }[paramKey] ?? '그 시간';
}
 
// =============================================================================
// ⑤ 유효성 검사
// =============================================================================
 
/**
 * VisitContext 객체의 필수 필드를 검사한다.
 *
 * @param {VisitContext} ctx
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateVisitContext(ctx) {
  const issues = [];
  const required = [
    'visitedAt', 'season', 'seasonLabel', 'solarTerm',
    'timeSlot', 'timeExpression', 'paramSeasonKey', 'paramTimeKey',
  ];
 
  required.forEach((key) => {
    if (ctx[key] === undefined || ctx[key] === null) {
      issues.push(`필수 필드 누락: ${key}`);
    }
  });
 
  const validSeasons = ['spring', 'summer', 'autumn', 'winter'];
  if (!validSeasons.includes(ctx.season)) {
    issues.push(`season 값 오류: ${ctx.season}`);
  }
 
  const validTimeKeys = ['morning', 'afternoon', 'evening', 'night'];
  if (!validTimeKeys.includes(ctx.paramTimeKey)) {
    issues.push(`paramTimeKey 값 오류: ${ctx.paramTimeKey}`);
  }
 
  return { valid: issues.length === 0, issues };
}
 
// =============================================================================
// ⑥ 디버그 유틸리티
// =============================================================================
 
/**
 * VisitContext를 콘솔에 출력한다. (개발 전용)
 * @param {VisitContext} ctx
 */
export function debugPrintVisitContext(ctx) {
  /* eslint-disable no-console */
  console.group('📍 VisitContext (visit-context.js)');
 
  console.log('방문 시각 :', ctx.visitedAt);
  console.log('주말 여부 :', ctx.isWeekend ? '주말' : '평일');
  console.log('');
 
  console.group('🌸 계절 정보');
  console.log('계절      :', ctx.seasonLabel, `(${ctx.season})`);
  console.log('색채 힌트  :', ctx.seasonColorHint);
  console.log('언어 분위기:', ctx.seasonLangTone);
  console.groupEnd();
 
  console.group('🗓️ 절기 정보');
  console.log('절기      :', ctx.solarTerm.name, `(${ctx.solarTerm.month}/${ctx.solarTerm.day})`);
  console.log('설명      :', ctx.solarTerm.desc);
  console.log('절기 근접  :', ctx.isNearSolarTerm ? '✅ 3일 이내' : '❌ 아님');
  console.groupEnd();
 
  console.group('⏰ 시간대 정보');
  console.log('시간대    :', ctx.timeSlot.label, `(${ctx.timeSlot.range[0]}~${ctx.timeSlot.range[1]}시)`);
  console.log('언어 분위기:', ctx.timeSlot.langTone);
  console.groupEnd();
 
  console.group('✍️ 답글 문장 재료');
  console.log('시간 표현  :', ctx.timeExpression);
  console.log('언어 톤    :', ctx.langToneHint);
  console.groupEnd();
 
  console.group('🔗 emotion-engine 연동 키값');
  console.log('paramSeasonKey :', ctx.paramSeasonKey,
    '← param-synthesizer.getSeasonModifier()');
  console.log('paramTimeKey   :', ctx.paramTimeKey,
    '← param-synthesizer.getTimeModifier()');
  console.groupEnd();
 
  const { valid, issues } = validateVisitContext(ctx);
  console.log('유효성    :', valid ? '✅ 통과' : '❌ ' + issues.join(', '));
 
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  collectVisitContext,
  mergeWithExtractionContext,
  validateVisitContext,
  debugPrintVisitContext,
};
 