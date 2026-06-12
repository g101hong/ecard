/**
 * @fileoverview 울산 E-Card 답글 엔진 — 24절기 상수 및 유틸리티
 * @module reply-engine/constants/solar-terms
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   방문 날짜를 받아 아래 세 가지를 반환한다:
 *
 *   ① 계절 (season)
 *      'spring' | 'summer' | 'autumn' | 'winter'
 *      → emotion-engine의 param-synthesizer·panel-weights와
 *        동일한 키값을 사용하여 파이프라인 연결성 확보
 *
 *   ② 24절기 (solarTerm)
 *      입춘·우수·경칩 ... 소한·대한
 *      → 답글 문장 재료로 활용
 *        "동지의 울산이 당신을 맞이한 날"
 *
 *   ③ 시간대 (timeSlot)
 *      'morning' | 'afternoon' | 'evening' | 'night'
 *      → emotion-engine의 param-synthesizer와
 *        동일한 키값 사용
 *
 * ─────────────────────────────────────────────────────────────────
 * [절기 날짜 정밀도]
 *
 *   절기는 태양 황경(黃經) 기준이라 해마다 하루 정도 차이가 난다.
 *   이 파일은 2024~2026년 기준 평균 날짜를 사용하며
 *   ±1일 오차는 답글 생성 목적에서 무시 가능한 수준이다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [emotion-engine 연동]
 *
 *   이 파일이 반환하는 season / timeSlot 키값은
 *   emotion-engine/param-synthesizer.js의
 *   getSeasonModifier() / getTimeModifier() 와 동일하게 설계되어
 *   reply-engine에서 색채 파라미터 재계산이 필요할 때
 *   그대로 전달할 수 있다.
 */
 
'use strict';
 
// =============================================================================
// ① 24절기 정의
// =============================================================================
 
/**
 * 24절기 데이터
 *
 * month : 1~12 (양력)
 * day   : 해당 절기의 대표 날짜 (평균값, ±1일 오차 허용)
 * name  : 절기 한글명
 * season: 속하는 계절 (emotion-engine 키값과 통일)
 * desc  : 절기 의미 (답글 문장 생성 참조용)
 * langTone : 이 절기의 대표 언어 분위기 (답글 작성 힌트)
 */
export const SOLAR_TERMS = [
  // ── 봄 (spring) ───────────────────────────────────────────────
  {
    id:       'ipchun',
    name:     '입춘',
    month:    2,
    day:      4,
    season:   'spring',
    desc:     '봄의 시작. 새 기운이 땅에서 올라오는 날.',
    langTone: '설렘·기대·새로운 시작',
  },
  {
    id:       'usu',
    name:     '우수',
    month:    2,
    day:      19,
    season:   'spring',
    desc:     '눈이 녹아 비가 되는 절기.',
    langTone: '부드러운 전환·녹아드는 따뜻함',
  },
  {
    id:       'gyeongchip',
    name:     '경칩',
    month:    3,
    day:      6,
    season:   'spring',
    desc:     '겨울잠 자던 생물이 깨어나는 날.',
    langTone: '생동감·깨어남·소란스러운 봄',
  },
  {
    id:       'chunbun',
    name:     '춘분',
    month:    3,
    day:      21,
    season:   'spring',
    desc:     '낮과 밤의 길이가 같아지는 날.',
    langTone: '균형·화창·넉넉한 봄빛',
  },
  {
    id:       'cheongmyeong',
    name:     '청명',
    month:    4,
    day:      5,
    season:   'spring',
    desc:     '하늘이 맑고 밝아지는 절기.',
    langTone: '청명함·선명함·투명한 빛',
  },
  {
    id:       'gogu',
    name:     '곡우',
    month:    4,
    day:      20,
    season:   'spring',
    desc:     '봄비가 내려 곡식이 자라는 절기.',
    langTone: '촉촉함·풍요·봄비 내음',
  },
 
  // ── 여름 (summer) ─────────────────────────────────────────────
  {
    id:       'ipha',
    name:     '입하',
    month:    5,
    day:      6,
    season:   'summer',
    desc:     '여름의 시작.',
    langTone: '싱그러움·초록의 기세·여름 예감',
  },
  {
    id:       'soman',
    name:     '소만',
    month:    5,
    day:      21,
    season:   'summer',
    desc:     '보리가 익고 만물이 점점 차오르는 절기.',
    langTone: '충만함·익어가는 계절',
  },
  {
    id:       'mangjong',
    name:     '망종',
    month:    6,
    day:      6,
    season:   'summer',
    desc:     '씨앗을 심는 절기. 바쁜 농번기.',
    langTone: '생명력·부지런한 여름',
  },
  {
    id:       'hajji',
    name:     '하지',
    month:    6,
    day:      21,
    season:   'summer',
    desc:     '일 년 중 낮이 가장 긴 날.',
    langTone: '풍성한 빛·뜨거운 한낮·정점',
  },
  {
    id:       'soser',
    name:     '소서',
    month:    7,
    day:      7,
    season:   'summer',
    desc:     '본격적인 더위가 시작되는 절기.',
    langTone: '열기·강렬한 여름·시원한 것이 그리운',
  },
  {
    id:       'daeser',
    name:     '대서',
    month:    7,
    day:      23,
    season:   'summer',
    desc:     '일 년 중 가장 더운 시기.',
    langTone: '극열·바다·물의 청량감',
  },
 
  // ── 가을 (autumn) ─────────────────────────────────────────────
  {
    id:       'ipchu',
    name:     '입추',
    month:    8,
    day:      7,
    season:   'autumn',
    desc:     '가을의 시작. 아침저녁으로 서늘해지는 절기.',
    langTone: '선선함·가을 예감·여름의 끝자락',
  },
  {
    id:       'cheoseo',
    name:     '처서',
    month:    8,
    day:      23,
    season:   'autumn',
    desc:     '더위가 물러가는 절기.',
    langTone: '서늘한 바람·안도·계절의 전환',
  },
  {
    id:       'baengno',
    name:     '백로',
    month:    9,
    day:      8,
    season:   'autumn',
    desc:     '이슬이 맺히고 하늘이 높아지는 절기.',
    langTone: '높은 하늘·투명한 가을·이슬빛',
  },
  {
    id:       'chubun',
    name:     '추분',
    month:    9,
    day:      23,
    season:   'autumn',
    desc:     '낮과 밤의 길이가 같아지는 가을 절기.',
    langTone: '황금빛 균형·깊어가는 가을',
  },
  {
    id:       'hallo',
    name:     '한로',
    month:    10,
    day:      8,
    season:   'autumn',
    desc:     '찬 이슬이 맺히는 절기. 단풍 시작.',
    langTone: '단풍·서리 예감·아련한 가을',
  },
  {
    id:       'sanggang',
    name:     '상강',
    month:    10,
    day:      23,
    season:   'autumn',
    desc:     '서리가 내리기 시작하는 절기.',
    langTone: '쓸쓸함·붉은 노을·깊은 가을',
  },
 
  // ── 겨울 (winter) ─────────────────────────────────────────────
  {
    id:       'ipdong',
    name:     '입동',
    month:    11,
    day:      7,
    season:   'winter',
    desc:     '겨울의 시작.',
    langTone: '차가운 시작·고요함·준비하는 계절',
  },
  {
    id:       'soseol',
    name:     '소설',
    month:    11,
    day:      22,
    season:   'winter',
    desc:     '첫눈이 내리기 시작하는 절기.',
    langTone: '첫눈·설렘과 쓸쓸함의 공존',
  },
  {
    id:       'daeseol',
    name:     '대설',
    month:    12,
    day:      7,
    season:   'winter',
    desc:     '눈이 많이 내리는 절기.',
    langTone: '고요한 설경·적막·흰빛',
  },
  {
    id:       'dongji',
    name:     '동지',
    month:    12,
    day:      22,
    season:   'winter',
    desc:     '일 년 중 밤이 가장 긴 날.',
    langTone: '깊은 밤·기다림·다시 밝아오는 빛',
  },
  {
    id:       'sohan',
    name:     '소한',
    month:    1,
    day:      6,
    season:   'winter',
    desc:     '일 년 중 가장 추운 시기 초입.',
    langTone: '매서운 한기·투명한 하늘·인내',
  },
  {
    id:       'daehan',
    name:     '대한',
    month:    1,
    day:      20,
    season:   'winter',
    desc:     '일 년 중 가장 추운 절기.',
    langTone: '극한의 고요·단단함·겨울의 정점',
  },
];
 
// =============================================================================
// ② 시간대 정의
// =============================================================================
 
/**
 * 시간대 정의
 * emotion-engine/param-synthesizer.js getTimeModifier()와 키값 통일
 */
export const TIME_SLOTS = [
  {
    id:       'dawn',
    label:    '새벽',
    range:    [0, 5],    // 0시~4시 59분
    paramKey: 'morning', // param-synthesizer 키값 (새벽은 morning으로 통합)
    langTone: '고요·어둠과 빛의 경계·홀로 있음',
  },
  {
    id:       'earlyMorning',
    label:    '이른 아침',
    range:    [5, 8],    // 5시~7시 59분
    paramKey: 'morning',
    langTone: '상쾌함·첫 빛·하루의 시작',
  },
  {
    id:       'morning',
    label:    '오전',
    range:    [8, 12],   // 8시~11시 59분
    paramKey: 'morning',
    langTone: '활기·청명함·가능성',
  },
  {
    id:       'noon',
    label:    '한낮',
    range:    [12, 14],  // 12시~13시 59분
    paramKey: 'afternoon',
    langTone: '강렬한 빛·선명함·한가운데',
  },
  {
    id:       'afternoon',
    label:    '오후',
    range:    [14, 17],  // 14시~16시 59분
    paramKey: 'afternoon',
    langTone: '여유·따뜻한 햇살·나른함',
  },
  {
    id:       'sunset',
    label:    '저녁 노을',
    range:    [17, 19],  // 17시~18시 59분
    paramKey: 'evening',
    langTone: '황금빛·아쉬움·하루의 마무리',
  },
  {
    id:       'earlyNight',
    label:    '초저녁',
    range:    [19, 21],  // 19시~20시 59분
    paramKey: 'evening',
    langTone: '도시의 불빛·낭만·하루의 여운',
  },
  {
    id:       'night',
    label:    '밤',
    range:    [21, 24],  // 21시~23시 59분
    paramKey: 'night',
    langTone: '고요·별빛·신비로운 어둠',
  },
];
 
// =============================================================================
// ③ 계절 정의
// =============================================================================
 
/**
 * 계절별 메타데이터
 * emotion-engine 키값과 통일
 */
export const SEASONS = {
  spring: {
    label:    '봄',
    months:   [3, 4, 5],
    langTone: '파스텔·설렘·새 생명',
    colorHint: '핑크·연초록·라벤더',
  },
  summer: {
    label:    '여름',
    months:   [6, 7, 8],
    langTone: '청량함·강렬함·생동감',
    colorHint: '청록·비비드블루·선명한 초록',
  },
  autumn: {
    label:    '가을',
    months:   [9, 10, 11],
    langTone: '황금빛·그리움·깊이',
    colorHint: '황금·오렌지·단풍 붉음',
  },
  winter: {
    label:    '겨울',
    months:   [12, 1, 2],
    langTone: '고요함·차가운 선명함·인내',
    colorHint: '청백·은회·차가운 청색',
  },
};
 
// =============================================================================
// ④ 핵심 유틸리티 함수
// =============================================================================
 
/**
 * 날짜에서 계절을 반환한다.
 * emotion-engine의 param-synthesizer와 동일한 키값 반환.
 *
 * @param {Date} [date=new Date()]
 * @returns {'spring'|'summer'|'autumn'|'winter'}
 *
 * @example
 * getSeason(new Date('2025-10-15')); // → 'autumn'
 */
export function getSeason(date = new Date()) {
  const month = date.getMonth() + 1; // 1~12
  if (month >= 3 && month <= 5)  return 'spring';
  if (month >= 6 && month <= 8)  return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}
 
/**
 * 날짜에서 가장 가까운 절기를 반환한다.
 *
 * 판정 기준:
 *   - 절기 당일 ~ 다음 절기 전날까지 해당 절기로 판정
 *   - 1월 초 (소한 이전)는 전년도 동지를 사용
 *
 * @param {Date} [date=new Date()]
 * @returns {Object} SOLAR_TERMS 항목
 *
 * @example
 * getSolarTerm(new Date('2025-12-22')); // → { id:'dongji', name:'동지', ... }
 */
export function getSolarTerm(date = new Date()) {
  const month = date.getMonth() + 1;
  const day   = date.getDate();
 
  // 같은 달의 절기 목록 (최대 2개)
  const candidates = SOLAR_TERMS.filter((t) => t.month === month);
 
  if (candidates.length === 0) {
    // 해당 월에 절기가 없는 경우 이전 달 마지막 절기 반환
    return _findPreviousTerm(month, day);
  }
 
  // 이번 달 절기 중 오늘 이전에 시작된 가장 최근 절기
  const passed = candidates.filter((t) => t.day <= day);
  if (passed.length > 0) {
    return passed[passed.length - 1];
  }
 
  // 이번 달 모든 절기가 아직 오지 않은 경우 → 이전 달 마지막 절기
  return _findPreviousTerm(month, day);
}
 
/**
 * 지정된 달 이전의 마지막 절기를 반환한다. (내부 함수)
 * @param {number} month  현재 월 (1~12)
 * @param {number} day    현재 일
 * @returns {Object} SOLAR_TERMS 항목
 */
function _findPreviousTerm(month, day) {
  // 이전 달 탐색 (12월 → 1월 순환 포함)
  for (let offset = 1; offset <= 12; offset++) {
    const prevMonth = ((month - 1 - offset + 12) % 12) + 1;
    const terms = SOLAR_TERMS.filter((t) => t.month === prevMonth);
    if (terms.length > 0) {
      return terms[terms.length - 1]; // 해당 달 마지막 절기
    }
  }
  // 안전 폴백 (도달 불가)
  return SOLAR_TERMS[0];
}
 
/**
 * 시각(hour)에서 시간대 정보를 반환한다.
 *
 * @param {Date|number} [dateOrHour=new Date()]
 *   Date 객체 또는 0~23 시각 숫자
 * @returns {Object} TIME_SLOTS 항목
 *
 * @example
 * getTimeSlot(new Date());        // → { id:'afternoon', label:'오후', ... }
 * getTimeSlot(18);                // → { id:'sunset', label:'저녁 노을', ... }
 */
export function getTimeSlot(dateOrHour = new Date()) {
  const hour = typeof dateOrHour === 'number'
    ? dateOrHour
    : dateOrHour.getHours();
 
  return TIME_SLOTS.find(
    (slot) => hour >= slot.range[0] && hour < slot.range[1]
  ) ?? TIME_SLOTS[TIME_SLOTS.length - 1]; // 24시 안전 폴백
}
 
/**
 * 날짜에서 방문 컨텍스트 전체를 한 번에 반환한다.
 * reply-engine의 주요 입력값으로 사용.
 *
 * @param {Date} [date=new Date()]
 * @returns {VisitTimeContext}
 *
 * @typedef {Object} VisitTimeContext
 * @property {string} season       'spring'|'summer'|'autumn'|'winter'
 * @property {string} seasonLabel  '봄'|'여름'|'가을'|'겨울'
 * @property {string} seasonLangTone  계절 언어 분위기
 * @property {string} seasonColorHint 계절 색채 힌트
 * @property {Object} solarTerm    SOLAR_TERMS 항목
 * @property {Object} timeSlot     TIME_SLOTS 항목
 * @property {string} paramSeasonKey  emotion-engine 계절 키값
 * @property {string} paramTimeKey    emotion-engine 시간 키값
 * @property {number} month        1~12
 * @property {number} hour         0~23
 * @property {boolean} isWeekend   주말 여부
 * @property {string} visitedAt    ISO 8601 문자열
 *
 * @example
 * const ctx = getVisitTimeContext();
 * // ctx.season         → 'autumn'
 * // ctx.solarTerm.name → '한로'
 * // ctx.timeSlot.label → '오후'
 * // ctx.paramSeasonKey → 'autumn'   ← param-synthesizer에 바로 전달 가능
 * // ctx.paramTimeKey   → 'afternoon' ← param-synthesizer에 바로 전달 가능
 */
export function getVisitTimeContext(date = new Date()) {
  const season    = getSeason(date);
  const solarTerm = getSolarTerm(date);
  const timeSlot  = getTimeSlot(date);
  const seasonMeta = SEASONS[season];
 
  return {
    season,
    seasonLabel:     seasonMeta.label,
    seasonLangTone:  seasonMeta.langTone,
    seasonColorHint: seasonMeta.colorHint,
    solarTerm,
    timeSlot,
    paramSeasonKey:  season,                // emotion-engine 직결
    paramTimeKey:    timeSlot.paramKey,     // emotion-engine 직결
    month:           date.getMonth() + 1,
    hour:            date.getHours(),
    isWeekend:       [0, 6].includes(date.getDay()),
    visitedAt:       date.toISOString(),
  };
}
 
// =============================================================================
// ⑤ 답글 문장 재료 생성 헬퍼
// =============================================================================
 
/**
 * 계절 + 절기 + 시간대 조합으로 답글에 쓸 시간 표현 문자열을 생성한다.
 *
 * 우선순위:
 *   1. 절기가 당일이거나 3일 이내 → 절기명 우선 사용
 *   2. 그 외 → 계절 + 시간대 조합 사용
 *
 * @param {VisitTimeContext} ctx  getVisitTimeContext() 반환값
 * @param {Date}             [date=new Date()]
 * @returns {string}  예) "동지의 이른 아침" | "가을 오후" | "봄 한낮"
 *
 * @example
 * buildTimeExpression(ctx);
 * // → "한로의 오후"     (절기 근처일 때)
 * // → "가을 저녁 노을"  (절기에서 먼 날)
 */
export function buildTimeExpression(ctx, date = new Date()) {
  const termDay  = ctx.solarTerm.day;
  const termMonth= ctx.solarTerm.month;
  const curDay   = date.getDate();
  const curMonth = date.getMonth() + 1;
 
  // 절기 당일 또는 3일 이내 → 절기명 사용
  const isSameMonth = termMonth === curMonth;
  const isNearTerm  = isSameMonth && Math.abs(curDay - termDay) <= 3;
 
  const timeLabel = ctx.timeSlot.label;
 
  if (isNearTerm) {
    return `${ctx.solarTerm.name}의 ${timeLabel}`;
  }
 
  return `${ctx.seasonLabel} ${timeLabel}`;
}
 
/**
 * 절기 언어 분위기와 시간대 언어 분위기를 결합하여
 * 답글 생성 프롬프트에 전달할 langTone 힌트를 반환한다.
 *
 * @param {VisitTimeContext} ctx
 * @returns {string}
 *
 * @example
 * buildLangToneHint(ctx);
 * // → "황금빛 균형·깊어가는 가을 / 여유·따뜻한 햇살·나른함"
 */
export function buildLangToneHint(ctx) {
  return `${ctx.solarTerm.langTone} / ${ctx.timeSlot.langTone}`;
}
 
// =============================================================================
// ⑥ 디버그 유틸리티
// =============================================================================
 
/**
 * 현재 시각 기준 방문 컨텍스트를 콘솔에 출력한다. (개발 전용)
 * @param {Date} [date=new Date()]
 */
export function debugPrintContext(date = new Date()) {
  /* eslint-disable no-console */
  const ctx = getVisitTimeContext(date);
 
  console.group('🗓️ VisitTimeContext (solar-terms.js)');
  console.log('방문 일시 :', ctx.visitedAt);
  console.log('계절      :', ctx.seasonLabel, `(${ctx.season})`);
  console.log('절기      :', ctx.solarTerm.name,
    `— ${ctx.solarTerm.desc}`);
  console.log('시간대    :', ctx.timeSlot.label,
    `(${ctx.timeSlot.range[0]}~${ctx.timeSlot.range[1]}시)`);
  console.log('');
  console.log('언어 분위기:', buildLangToneHint(ctx));
  console.log('시간 표현  :', buildTimeExpression(ctx, date));
  console.log('색채 힌트  :', ctx.seasonColorHint);
  console.log('');
  console.log('[emotion-engine 연동값]');
  console.log('paramSeasonKey :', ctx.paramSeasonKey,
    '← param-synthesizer.getSeasonModifier() 키값');
  console.log('paramTimeKey   :', ctx.paramTimeKey,
    '← param-synthesizer.getTimeModifier() 키값');
  console.log('주말 여부  :', ctx.isWeekend ? '주말' : '평일');
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  SOLAR_TERMS,
  TIME_SLOTS,
  SEASONS,
  getSeason,
  getSolarTerm,
  getTimeSlot,
  getVisitTimeContext,
  buildTimeExpression,
  buildLangToneHint,
  debugPrintContext,
};