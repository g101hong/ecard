/**
 * @fileoverview svg-engine/emotion-fonts.js
 * @description 감성별 폰트 매핑 — dominant emotion에 따라 답글 폰트 선택
 *
 * 사용 위치:
 *   - 클라이언트(app.js)     : 화면 답글 폰트 변경 (font-family CSS 적용)
 *   - 서버(png-exporter.js) : PNG 답글 카드 폰트 변경 (canvas registerFromPath)
 *
 * 폰트 파일은 assets/ 폴더에 있어야 하며, 없는 경우 NanumWaIrDeu로 폴백된다.
 */

'use strict';

/**
 * 감성 키별 폰트 정보
 *   - family   : CSS font-family 값 (화면 + canvas 공통)
 *   - ttfPath  : assets/ 기준 TTF 파일명 (서버 PNG 렌더링용)
 *   - googleFontUrl : 화면용 Google Fonts CDN URL
 */
/**
 * 동점(tie) 발생 시 우선순위 순서.
 * 브라우저(app.js)와 서버(png-exporter.js) 양쪽에서 이 배열을 import하여
 * dominant 감성 선택 결과를 항상 일치시킨다.
 *
 * 우선순위 기준:
 *   - 울산 12경의 대표 감성(amazement·peace)을 앞에 배치
 *   - 시각적으로 차별화가 뚜렷한 폰트일수록 우선 표현
 */
export const EMOTION_PRIORITY = [
  'amazement',  // 1순위 — 경이 (Hahmlet, 가장 강렬한 감성)
  'mystery',    // 2순위 — 신비 (Single Day, 독특한 개성)
  'grandeur',   // 3순위 — 웅장 (Gugi, 묵직한 위엄)
  'nostalgia',  // 4순위 — 향수 (Gaegu, 손글씨 개성)
  'warmth',     // 5순위 — 따뜻함 (Nanum Pen Script)
  'vitality',   // 6순위 — 활기 (Jua)
  'freshness',  // 7순위 — 청량 (IBM Plex Sans KR)
  'peace',      // 8순위 — 평화 (Stylish, 가장 중성적)
];

export const EMOTION_FONT_MAP = Object.freeze({
  amazement: {
    family:        'Hahmlet',
    ttfPath:       'Hahmlet-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Hahmlet:wght@400;700;900&display=swap',
  },
  peace: {
    family:        'Stylish',
    ttfPath:       'Stylish-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Stylish&display=swap',
  },
  vitality: {
    family:        'Jua',
    ttfPath:       'Jua-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Jua&display=swap',
  },
  nostalgia: {
    family:        'Gaegu',
    ttfPath:       'Gaegu-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&display=swap',
  },
  freshness: {
    family:        'IBM Plex Sans KR',
    ttfPath:       'IBMPlexSansKR-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400&display=swap',
  },
  grandeur: {
    family:        'Gugi',
    ttfPath:       'Gugi-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Gugi&display=swap',
  },
  warmth: {
    family:        'Nanum Pen Script',
    ttfPath:       'NanumPenScript-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap',
  },
  mystery: {
    family:        'Single Day',
    ttfPath:       'SingleDay-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Single+Day&display=swap',
  },
});

/**
 * 폴백 폰트 — 매칭 실패 시 또는 TTF 파일이 없을 때 사용
 */
export const FALLBACK_FONT = EMOTION_FONT_MAP.warmth;

/**
 * 감성 점수 객체에서 dominant 감성을 찾아 폰트 정보를 반환한다.
 *
 * @param {Object} emotionScores  { amazement:number, peace:number, ... } (0~100)
 * @returns {{ emotion:string, font:{family:string, ttfPath:string, googleFontUrl:string|null} }}
 *
 * @example
 *   pickFontByEmotion({ amazement:80, peace:20, ... })
 *   → { emotion: 'amazement', font: { family: 'Hahmlet', ... } }
 */
export function pickFontByEmotion(emotionScores) {
  if (!emotionScores || typeof emotionScores !== 'object') {
    return { emotion: 'amazement', font: EMOTION_FONT_MAP.amazement };
  }

  // 1단계: 최고 점수 탐색
  let maxValue = -1;
  for (const key of EMOTION_PRIORITY) {
    const v = Number(emotionScores[key]) || 0;
    if (v > maxValue) maxValue = v;
  }

  // 2단계: 동점 시 EMOTION_PRIORITY 우선순위로 첫 번째 선택
  const maxKey = EMOTION_PRIORITY.find(
    (key) => (Number(emotionScores[key]) || 0) === maxValue
  ) ?? 'amazement';

  return {
    emotion: maxKey,
    font:    EMOTION_FONT_MAP[maxKey] ?? FALLBACK_FONT,
  };
}

export default { EMOTION_FONT_MAP, FALLBACK_FONT, pickFontByEmotion };
