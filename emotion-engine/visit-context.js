/**
 * @fileoverview 울산 E-Card 감성 엔진 — 방문 시점 컨텍스트 수집 모듈
 * @module emotion-engine/visit-context
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   방문객이 소감을 입력하기 전, 시스템이 자동으로 수집하는
 *   "방문 시점 컨텍스트(VisitContext)"를 생성한다.
 *
 *   solar-terms.js의 원시 시간 데이터를
 *   emotion-engine 파이프라인이 바로 사용할 수 있는
 *   완성된 컨텍스트 객체로 조립한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * 파이프라인 내 위치
 * ─────────────────────────────────────────────────────────────────
 *
 *   impression.js
 *       │
 *       ├── collectVisitContext()   ← 이 모듈
 *       │
 *       └── analyzeImpression(text, { visitCtx })
 *               └── emotion-engine/index.js
 *                       └── ai-extractor.js (Gemini 프롬프트에 포함)
 *                       └── panel-weights.js (절기·시간 맥락 보정)
 *
 * ─────────────────────────────────────────────────────────────────
 * 출력 구조 — VisitContext
 * ─────────────────────────────────────────────────────────────────
 *
 *   {
 *     visitedAt       : ISO 8601 문자열
 *     month           : 1~12
 *     hour            : 0~23
 *     isWeekend       : boolean
 *     season          : 'spring'|'summer'|'autumn'|'winter'
 *     seasonLabel     : '봄'|'여름'|'가을'|'겨울'
 *     seasonLangTone  : 계절 언어 분위기 힌트
 *     seasonColorHint : 계절 색채 힌트
 *     solarTerm       : SOLAR_TERMS 항목 전체
 *     isNearSolarTerm : 절기 3일 이내 여부
 *     timeSlot        : TIME_SLOTS 항목 전체
 *     timeExpression  : "동지의 오전" | "가을 오후" 등
 *     langToneHint    : 절기 + 시간대 언어 분위기 결합 문자열
 *     paramSeasonKey  : param-synthesizer / panel-weights 계절 키값
 *     paramTimeKey    : param-synthesizer / panel-weights 시간대 키값
 *   }
 */

'use strict';

import {
  getVisitTimeContext,
  buildTimeExpression,
  buildLangToneHint,
} from './constants/solar-terms.js';

// =============================================================================
// 핵심 수집 함수
// =============================================================================

/**
 * @typedef {Object} VisitContext
 * @property {string}  visitedAt        방문 시각 ISO 8601
 * @property {number}  month            방문 월 (1~12)
 * @property {number}  hour             방문 시각 (0~23)
 * @property {boolean} isWeekend        주말 여부
 * @property {string}  season           'spring'|'summer'|'autumn'|'winter'
 * @property {string}  seasonLabel      '봄'|'여름'|'가을'|'겨울'
 * @property {string}  seasonLangTone   계절 언어 분위기
 * @property {string}  seasonColorHint  계절 색채 힌트
 * @property {Object}  solarTerm        SOLAR_TERMS 항목
 * @property {boolean} isNearSolarTerm  절기 3일 이내 여부
 * @property {Object}  timeSlot         TIME_SLOTS 항목
 * @property {string}  timeExpression   "동지의 오전" | "가을 오후" 등
 * @property {string}  langToneHint     절기 + 시간대 언어 분위기 결합
 * @property {string}  paramSeasonKey   param-synthesizer / panel-weights 계절 키값
 * @property {string}  paramTimeKey     param-synthesizer / panel-weights 시간대 키값
 * @property {number}  collectedAt      수집 시각 타임스탬프 (ms)
 */

/**
 * 현재 시각 기준 방문 컨텍스트를 수집하여 반환한다.
 *
 * impression.js에서 단 한 번 호출되며 결과가 analyzeImpression()에 전달된다.
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
 * // ctx.paramSeasonKey  → 'autumn'     ← panel-weights 직결
 * // ctx.paramTimeKey    → 'afternoon'  ← panel-weights 직결
 * // ctx.isNearSolarTerm → true
 */
export function collectVisitContext(date = new Date()) {
  const t0 = Date.now();

  const timeCtx = getVisitTimeContext(date);

  const isNearSolarTerm = _isNearTerm(
    date,
    timeCtx.solarTerm.month,
    timeCtx.solarTerm.day,
  );

  const timeExpression = buildTimeExpression(timeCtx, date);
  const langToneHint   = buildLangToneHint(timeCtx);

  return {
    visitedAt:       timeCtx.visitedAt,
    month:           timeCtx.month,
    hour:            timeCtx.hour,
    isWeekend:       timeCtx.isWeekend,
    season:          timeCtx.season,
    seasonLabel:     timeCtx.seasonLabel,
    seasonLangTone:  timeCtx.seasonLangTone,
    seasonColorHint: timeCtx.seasonColorHint,
    solarTerm:       timeCtx.solarTerm,
    isNearSolarTerm,
    timeSlot:        timeCtx.timeSlot,
    timeExpression,
    langToneHint,
    paramSeasonKey:  timeCtx.paramSeasonKey,
    paramTimeKey:    timeCtx.paramTimeKey,
    collectedAt:     t0,
  };
}

// =============================================================================
// 내부 유틸리티
// =============================================================================

/**
 * 주어진 날짜가 절기 당일 또는 ±3일 이내인지 확인한다.
 * @param {Date}   date       현재 날짜
 * @param {number} termMonth  절기 월 (1~12)
 * @param {number} termDay    절기 일
 * @returns {boolean}
 */
function _isNearTerm(date, termMonth, termDay) {
  const curMonth = date.getMonth() + 1;
  const curDay   = date.getDate();
  if (curMonth !== termMonth) return false;
  return Math.abs(curDay - termDay) <= 3;
}

// =============================================================================
// Default Export
// =============================================================================

export default { collectVisitContext };
