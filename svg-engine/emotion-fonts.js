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
export const EMOTION_FONT_MAP = Object.freeze({
  amazement: {
    family:        'Black Han Sans',
    ttfPath:       'BlackHanSans-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap',
  },
  peace: {
    family:        'Gowun Batang',
    ttfPath:       'GowunBatang-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&display=swap',
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
    family:        'Gowun Dodum',
    ttfPath:       'GowunDodum-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap',
  },
  grandeur: {
    family:        'Gugi',
    ttfPath:       'Gugi-Regular.ttf',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Gugi&display=swap',
  },
  warmth: {
    family:        'NanumWaIrDeu',
    ttfPath:       'NanumWaIrDeu.ttf',
    googleFontUrl: null,   // 자체 호스팅 폰트 (assets/NanumWaIrDeu.ttf)
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
 *   → { emotion: 'amazement', font: { family: 'Black Han Sans', ... } }
 */
export function pickFontByEmotion(emotionScores) {
  if (!emotionScores || typeof emotionScores !== 'object') {
    return { emotion: 'warmth', font: FALLBACK_FONT };
  }

  let maxKey   = 'warmth';
  let maxValue = -1;

  for (const key of Object.keys(EMOTION_FONT_MAP)) {
    const v = Number(emotionScores[key]) || 0;
    if (v > maxValue) {
      maxValue = v;
      maxKey   = key;
    }
  }

  return {
    emotion: maxKey,
    font:    EMOTION_FONT_MAP[maxKey] ?? FALLBACK_FONT,
  };
}

export default { EMOTION_FONT_MAP, FALLBACK_FONT, pickFontByEmotion };
