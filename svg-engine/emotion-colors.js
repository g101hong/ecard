/**
 * @fileoverview svg-engine/emotion-colors.js
 * @description 감성 점수에서 답글 카드 꾸밈용 주색 3개를 추출한다.
 *
 * 각 감성은 고유한 색상 영역(Hue)과 밝기/채도를 가진다.
 * 상위 3개 감성의 HSL을 블렌딩하여 자연스럽게 어울리는 3가지 주색을 반환한다.
 *
 * 사용처:
 *   - 클라이언트(app.js): 답글 카드 CSS 변수 적용
 *   - 서버(png-exporter.js): 답글 카드 canvas 그라데이션 적용
 */

'use strict';

// ── 감성별 기본 HSL 팔레트 ──────────────────────────────────────
// 각 감성이 가장 자연스럽게 연상되는 색의 Hue/Sat/Light 중심값
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

// ── HSL → HEX 변환 ──────────────────────────────────────────────
function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ── HEX → HSL 변환 ──────────────────────────────────────────────
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── 두 HSL 보간 ──────────────────────────────────────────────────
function blendHsl(a, b, t) {
  // Hue는 짧은 경로로 보간
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return {
    h: (a.h + dh * t + 360) % 360,
    s: a.s + (b.s - a.s) * t,
    l: a.l + (b.l - a.l) * t,
  };
}

/**
 * 감성 점수에서 답글 카드 꾸밈용 주색 3개를 추출한다.
 *
 * 알고리즘:
 *   1. 상위 3개 감성을 score 내림차순 정렬
 *   2. 각 감성의 기본 HSL에서 score에 따라 명도/채도를 소폭 조정
 *   3. 카드 배경에 쓸 어두운 버전(dark), 글로우에 쓸 중간 버전(mid),
 *      포인트에 쓸 밝은 버전(light)을 각각 반환
 *
 * @param {Object} emotionScores  { amazement, peace, ... } (0~100)
 * @returns {{
 *   colors: Array<{emotion:string, score:number, dark:string, mid:string, light:string}>,
 *   primary: string,    주색1 mid hex — 상단 글로우 핵심색
 *   secondary: string,  주색2 mid hex
 *   tertiary: string,   주색3 mid hex
 * }}
 */
export function extractDominantColors(emotionScores) {
  if (!emotionScores || typeof emotionScores !== 'object') {
    return _fallback();
  }

  const KEYS = Object.keys(EMOTION_BASE_COLOR);

  // 상위 3개 감성 정렬
  const sorted = KEYS
    .map((k) => ({ emotion: k, score: Number(emotionScores[k]) || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // 모두 0점이면 폴백
  if (sorted[0].score === 0) return _fallback();

  const colors = sorted.map(({ emotion, score }) => {
    const base = EMOTION_BASE_COLOR[emotion];
    const intensity = clamp(score / 100, 0, 1);

    // 감성 강도에 따라 채도를 약간 높임
    const s = clamp(base.s * (0.75 + intensity * 0.25), 0.25, 1.0);

    // 어두운 버전 (카드 배경용, 명도 낮춤)
    const dark  = hslToHex(base.h, s * 0.70, clamp(base.l * 0.35, 0.10, 0.28));
    // 중간 버전 (글로우/포인트용)
    const mid   = hslToHex(base.h, s,        clamp(base.l * 0.80, 0.30, 0.65));
    // 밝은 버전 (키워드칩/하이라이트용)
    const light = hslToHex(base.h, s * 0.60, clamp(base.l * 1.30, 0.65, 0.88));

    return { emotion, score, dark, mid, light };
  });

  return {
    colors,
    primary:   colors[0].mid,
    secondary: colors[1]?.mid ?? colors[0].mid,
    tertiary:  colors[2]?.mid ?? colors[0].mid,
  };
}

// 폴백 — 기본 호박색 (warmth 기본값)
function _fallback() {
  const base = EMOTION_BASE_COLOR.warmth;
  const mid   = hslToHex(base.h, base.s, base.l);
  const dark  = hslToHex(base.h, base.s * 0.7, base.l * 0.35);
  const light = hslToHex(base.h, base.s * 0.6, base.l * 1.3);
  const entry = { emotion: 'warmth', score: 50, dark, mid, light };
  return { colors: [entry, entry, entry], primary: mid, secondary: mid, tertiary: mid };
}

export default { extractDominantColors };
