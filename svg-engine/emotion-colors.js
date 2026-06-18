/**
 * @fileoverview svg-engine/emotion-colors.js
 * @description 감성 점수에서 답글 카드 꾸밈용 주색 4개를 추출한다.
 *
 * 각 감성은 고유한 색상 영역(Hue)과 밝기/채도를 가진다.
 * 상위 4개 감성의 HSL을 블렌딩하여 자연스럽게 어울리는 4가지 주색을 반환한다.
 *
 * 사용처:
 *   - 클라이언트(app.js): 답글 카드 CSS 변수 적용
 *   - 서버(png-exporter.js): 답글 카드 SVG 그라데이션 합성
 *
 * 역할 분담 (클라이언트 app.js applyGlowColors() 와 1:1 대응):
 *   primary    → --glow-primary   상단 글로우 핵심 (rg3, opacity 0.42)
 *   secondary  → --glow-secondary 상단 글로우 보조 (rg4, opacity 0.30)
 *   tertiary   → --reply-main     방사형 빛 우상단  (rg1, opacity 0.18)
 *   quaternary → --reply-sub      방사형 빛 좌하단  (rg2, opacity 0.12)
 */

'use strict';

// ── 감성별 기본 HSL 팔레트 ──────────────────────────────────────
const EMOTION_BASE_COLOR = Object.freeze({
  amazement: { h: 42,  s: 0.90, l: 0.58 },  // 황금 주황 — 일출, 경이
  peace:     { h: 200, s: 0.45, l: 0.62 },  // 연한 청회 — 고요한 하늘
  vitality:  { h: 22,  s: 0.85, l: 0.55 },  // 선명 주황 — 활기, 에너지
  nostalgia: { h: 32,  s: 0.55, l: 0.48 },  // 황토 갈색 — 오래된 기억
  freshness: { h: 192, s: 0.70, l: 0.52 },  // 청록 — 맑은 바다, 청량
  grandeur:  { h: 225, s: 0.50, l: 0.38 },  // 짙은 남청 — 웅장, 심원
  warmth:    { h: 30,  s: 0.80, l: 0.60 },  // 따뜻한 호박색 — 온기
  mystery:   { h: 270, s: 0.55, l: 0.42 },  // 보라 — 신비, 깊이
});

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * 감성 점수에서 답글 카드 꾸밈용 주색 4개를 추출한다.
 *
 * @param {Object} emotionScores  { amazement, peace, ... } (0~100)
 * @returns {{
 *   colors:     Array<{emotion:string, score:number, dark:string, mid:string, light:string}>,
 *   primary:    string,
 *   secondary:  string,
 *   tertiary:   string,
 *   quaternary: string,
 * }}
 */
export function extractDominantColors(emotionScores) {
  if (!emotionScores || typeof emotionScores !== 'object') {
    return _fallback();
  }

  const KEYS = Object.keys(EMOTION_BASE_COLOR);

  // 상위 4개 감성 정렬
  const sorted = KEYS
    .map((k) => ({ emotion: k, score: Number(emotionScores[k]) || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (sorted[0].score === 0) return _fallback();

  const colors = sorted.map(({ emotion, score }) => {
    const base = EMOTION_BASE_COLOR[emotion];
    const intensity = clamp(score / 100, 0, 1);
    const s = clamp(base.s * (0.75 + intensity * 0.25), 0.25, 1.0);

    return {
      emotion, score,
      dark:  hslToHex(base.h, s * 0.70, clamp(base.l * 0.35, 0.10, 0.28)),
      mid:   hslToHex(base.h, s,        clamp(base.l * 0.80, 0.30, 0.65)),
      light: hslToHex(base.h, s * 0.60, clamp(base.l * 1.30, 0.65, 0.88)),
    };
  });

  return {
    colors,
    primary:    colors[0].mid,
    secondary:  colors[1]?.mid ?? colors[0].mid,
    tertiary:   colors[2]?.mid ?? colors[0].mid,
    quaternary: colors[3]?.mid ?? colors[0].mid,
  };
}

function _fallback() {
  const base  = EMOTION_BASE_COLOR.warmth;
  const mid   = hslToHex(base.h, base.s,        base.l);
  const dark  = hslToHex(base.h, base.s * 0.7,  base.l * 0.35);
  const light = hslToHex(base.h, base.s * 0.6,  base.l * 1.3);
  const entry = { emotion: 'warmth', score: 50, dark, mid, light };
  return {
    colors:     [entry, entry, entry, entry],
    primary:    mid,
    secondary:  mid,
    tertiary:   mid,
    quaternary: mid,
  };
}

export default { extractDominantColors };
