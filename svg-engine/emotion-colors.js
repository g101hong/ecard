/**
 * @fileoverview svg-engine/emotion-colors.js
 * @description 감성 점수에서 답글 카드 꾸밈용 주색 4개를 추출한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * 설계 원칙
 * ─────────────────────────────────────────────────────────────────
 *
 *   감성 8종에 각각 독립된 기준색(Hue)을 배정한다.
 *   색상환(0~360°) 전체에 고르게 분산 — 최소 간격 30° 이상 확보.
 *   울산 12경 팔레트와는 독립적으로 설계되어, 감성 자체의 직관적
 *   색채 연상에만 근거한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * 감성 8종 색상 배정 (Hue 오름차순)
 * ─────────────────────────────────────────────────────────────────
 *
 *    12°  warmth     코랄오렌지   온기·노을·포근한 빛
 *    48°  amazement  황금앰버     일출·경이·장엄한 빛
 *    92°  vitality   초록라임     생동감·에너지·자연약동
 *   178°  freshness  청록시안     맑은 바다·청량·신선
 *   212°  peace      하늘청       고요·평온·맑은 하늘
 *   252°  grandeur   딥인디고     웅장·심원·압도적 깊이
 *   298°  mystery    마젠타보라   신비·몽환·깊이
 *   342°  nostalgia  더스티로즈   그리움·낡은 엽서·추억
 *
 *   인접 간격: 36 / 44 / 86 / 34 / 40 / 46 / 44 / 30° (최소 30°)
 *
 * ─────────────────────────────────────────────────────────────────
 * 주색 4종 역할 (클라이언트 applyGlowColors() 와 1:1 대응)
 * ─────────────────────────────────────────────────────────────────
 *
 *   primary    → --glow-primary   상단 글로우 핵심 (opacity 0.42)
 *   secondary  → --glow-secondary 상단 글로우 보조 (opacity 0.30)
 *   tertiary   → --reply-main     방사형 빛 우상단  (opacity 0.18)
 *   quaternary → --reply-sub      방사형 빛 좌하단  (opacity 0.12)
 */

'use strict';

// ── 감성별 기준색 HSL ───────────────────────────────────────────
//   h: 색상각(Hue 0~360)  s: 채도(0~1)  l: 명도(0~1)
//   각 감성의 직관적 색채 연상에만 근거 — 울산 12경 팔레트와 독립
const EMOTION_BASE_COLOR = Object.freeze({
  warmth:    { h: 12,  s: 0.88, l: 0.58 }, // 코랄오렌지  — 온기·노을·포근
  amazement: { h: 48,  s: 0.95, l: 0.55 }, // 황금앰버    — 경이·일출·장엄
  vitality:  { h: 92,  s: 0.72, l: 0.45 }, // 초록라임    — 활기·에너지·약동
  freshness: { h: 178, s: 0.75, l: 0.48 }, // 청록시안    — 청량·맑은 바다
  peace:     { h: 212, s: 0.55, l: 0.58 }, // 하늘청      — 평온·고요·하늘
  grandeur:  { h: 252, s: 0.60, l: 0.40 }, // 딥인디고    — 웅장·심원·압도
  mystery:   { h: 298, s: 0.58, l: 0.42 }, // 마젠타보라  — 신비·몽환·깊이
  nostalgia: { h: 342, s: 0.50, l: 0.50 }, // 더스티로즈  — 그리움·옛 추억
});

// ── 색상 변환 유틸 ──────────────────────────────────────────────
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
 * 알고리즘:
 *   1. 8개 감성을 score 내림차순 정렬 → 상위 4개 선택
 *   2. 각 감성의 기준 HSL에서 score 강도에 따라 채도를 소폭 조정
 *   3. mid(글로우/포인트용) hex를 primary~quaternary 순서로 반환
 *
 * @param {Object} emotionScores  { amazement, peace, ... } (0~100)
 * @returns {{
 *   colors:     Array<{emotion:string, score:number, hex:string, dark:string, mid:string, light:string}>,
 *   primary:    string,   1위 감성 mid hex
 *   secondary:  string,   2위 감성 mid hex
 *   tertiary:   string,   3위 감성 mid hex
 *   quaternary: string,   4위 감성 mid hex
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
    const base      = EMOTION_BASE_COLOR[emotion];
    const intensity = clamp(score / 100, 0, 1);

    // 감성 강도에 비례해 채도를 소폭 강화 (0.75 ~ 1.00 배율)
    const s = clamp(base.s * (0.75 + intensity * 0.25), 0.25, 1.0);

    const dark  = hslToHex(base.h, s * 0.65, clamp(base.l * 0.35, 0.08, 0.28));
    const mid   = hslToHex(base.h, s,        clamp(base.l * 0.85, 0.30, 0.68));
    const light = hslToHex(base.h, s * 0.55, clamp(base.l * 1.35, 0.65, 0.90));

    return { emotion, score, hex: mid, dark, mid, light };
  });

  return {
    colors,
    primary:    colors[0].mid,
    secondary:  colors[1]?.mid ?? colors[0].mid,
    tertiary:   colors[2]?.mid ?? colors[0].mid,
    quaternary: colors[3]?.mid ?? colors[0].mid,
  };
}

// ── 폴백 — warmth 기준색으로 4종 채움 ──────────────────────────
function _fallback() {
  const base  = EMOTION_BASE_COLOR.warmth;
  const mid   = hslToHex(base.h, base.s,       base.l);
  const dark  = hslToHex(base.h, base.s * 0.65, base.l * 0.35);
  const light = hslToHex(base.h, base.s * 0.55, base.l * 1.35);
  const entry = { emotion: 'warmth', score: 50, hex: mid, dark, mid, light };
  return {
    colors:     [entry, entry, entry, entry],
    primary:    mid,
    secondary:  mid,
    tertiary:   mid,
    quaternary: mid,
  };
}

export default { extractDominantColors };
