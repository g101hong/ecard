/**
 * @fileoverview 울산 E-Card — 프론트엔드 앱 진입점
 * @version 5.0.0  [방안C] SSE 2단계 렌더
 *
 * ─────────────────────────────────────────────────────────────────
 * [방안C 변경사항] onSubmit() 내부만 수정
 * ─────────────────────────────────────────────────────────────────
 *
 *   기존 (단일 await):
 *     const data = await analyzeImpression(text, options);
 *     applyDeltaColorsToSVG(data.emotionScores, data.diversitySeed);
 *     revealSVG();
 *     renderResult(data);
 *     setPhase('done');
 *
 *   방안C (2단계 콜백):
 *     analyzeImpression(text, {
 *       ...options,
 *       onColors: (d) => {
 *         // Phase 1 — Gemini 완료 즉시 실행
 *         applyDeltaColorsToSVG(d.emotionScores, d.diversitySeed);
 *         revealSVG();                  ← 사용자가 색채 전환 먼저 봄
 *         renderPaletteStrip(...);
 *       },
 *       onReply: (d) => {
 *         // Phase 2 — colors 직후 수십ms 뒤 실행
 *         renderResultFromReply(d);     ← 답글 카드 뒤따라 등장
 *         setPhase('done');
 *       },
 *     });
 *     // await 없이 바로 진행 — lastResult는 done 이벤트에서 설정
 *
 *   나머지 함수(init, bindEvents, onReset, onSave, onShare,
 *   renderResult, renderKeywordChips, renderSpectrumBars 등)는
 *   변경 없음.
 *
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

// =============================================================================
// ① 모듈 임포트
// =============================================================================

import { SPOTS }           from './spots.js';
import { loadSVG,
         revealSVG,
         resetSVG }        from './svg-renderer.js';
import { analyzeImpression,
         requestCard }     from './api.js';

// emotion-colors는 svg-engine 경로이므로 클라이언트에서는 인라인 구현
// (빌드 도구 없으므로 서버 모듈을 직접 import 불가 — 동일 로직을 인라인 선언)
const EMOTION_BASE_COLOR = {
  amazement: { h: 42,  s: 0.90, l: 0.58 },
  peace:     { h: 200, s: 0.45, l: 0.62 },
  vitality:  { h: 22,  s: 0.85, l: 0.55 },
  nostalgia: { h: 32,  s: 0.55, l: 0.48 },
  freshness: { h: 192, s: 0.70, l: 0.52 },
  grandeur:  { h: 225, s: 0.50, l: 0.38 },
  warmth:    { h: 30,  s: 0.80, l: 0.60 },
  mystery:   { h: 270, s: 0.55, l: 0.42 },
};

function _hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function extractDominantColors(emotionScores) {
  if (!emotionScores) return null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const keys = Object.keys(EMOTION_BASE_COLOR);
  const sorted = keys
    .map((k) => ({ emotion: k, score: Number(emotionScores[k]) || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (sorted[0].score === 0) return null;
  const colors = sorted.map(({ emotion, score }) => {
    const base = EMOTION_BASE_COLOR[emotion];
    const intensity = clamp(score / 100, 0, 1);
    const s = clamp(base.s * (0.75 + intensity * 0.25), 0.25, 1.0);
    return {
      emotion, score,
      dark:  _hsl(base.h, s * 0.70, clamp(base.l * 0.35, 0.10, 0.28)),
      mid:   _hsl(base.h, s,        clamp(base.l * 0.80, 0.30, 0.65)),
      light: _hsl(base.h, s * 0.60, clamp(base.l * 1.30, 0.65, 0.88)),
    };
  });
  return {
    colors,
    primary:   colors[0].mid,
    secondary: colors[1]?.mid ?? colors[0].mid,
    tertiary:  colors[2]?.mid ?? colors[0].mid,
  };
}

// =============================================================================
// ② DOM 참조
// =============================================================================

const $ = (id) => document.getElementById(id);

const elScreenInput    = $('screen-input');
const elScreenResult   = $('screen-result');
const elForm           = $('impression-form');
const elDurationGroup  = $('duration-group');
const elCompanionGroup = $('companion-group');
const elTextarea       = $('impression-text');
const elCharCount      = $('char-count');
const elSubmitBtn      = $('submit-btn');
const elErrorMsg       = $('error-msg');
const elLoading        = $('loading-overlay');
const elKeywordChips   = $('keyword-chips');
const elPrimaryEmotion = $('primary-emotion');
const elReplyMain      = $('reply-main');
const elReplyPlace     = $('reply-place');
const elReplyTagline   = $('reply-tagline');
const elSpectrumBars   = $('spectrum-bars');
const elSaveBtn        = $('save-btn');
const elShareBtn       = $('share-btn');
const elResetBtn       = $('reset-btn');

// =============================================================================
// ③ 앱 상태
// =============================================================================

/** @type {'idle'|'loading'|'colors'|'done'} */
let phase = 'idle';

/** 마지막 API 응답 데이터 */
let lastResult = null;

let selectedDuration  = null;
let selectedCompanion = null;

const EMOTION_LABELS = {
  amazement: '경이', peace: '평화', vitality: '활기', nostalgia: '향수',
  freshness: '청량', grandeur: '웅장', warmth: '따뜻함', mystery: '신비',
};

// =============================================================================
// ④ 화면 전환
// =============================================================================

function showScreen(screen) {
  const showResult = screen === 'result';
  elScreenInput.classList.toggle('is-hidden', showResult);
  elScreenResult.classList.toggle('is-hidden', !showResult);
  const appFrame = document.querySelector('.app-frame');
  if (appFrame) appFrame.classList.toggle('is-result', showResult);
  if (!showResult) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setPhase(next) {
  phase = next;
  elLoading.classList.toggle('hidden', next !== 'loading');
  elSubmitBtn.disabled = (next === 'loading' || next === 'colors' || elTextarea.value.trim().replace(/\s+/g, '').length < 8);
  if (next === 'done') showScreen('result');
}

// =============================================================================
// ⑤ 초기화
// =============================================================================

async function init() {
  try {
    await loadSVG();
  } catch (err) {
    console.error('[app] SVG 로드 실패:', err);
    showError('스테인드글라스 이미지를 불러오지 못했습니다. 새로고침 해주세요.');
  }
  bindEvents();
  setPhase('idle');
}

// =============================================================================
// ⑥ 이벤트 바인딩
// =============================================================================

function bindEvents() {
  bindChipGroup(elDurationGroup,  (v) => { selectedDuration  = v; });
  bindChipGroup(elCompanionGroup, (v) => { selectedCompanion = v; });
  elTextarea.addEventListener('input', onTextInput);
  elTextarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!elSubmitBtn.disabled) onSubmit();
    }
  });
  elForm.addEventListener('submit', (e) => { e.preventDefault(); onSubmit(); });
  elResetBtn.addEventListener('click', onReset);
  elSaveBtn.addEventListener('click',  onSave);
  elShareBtn.addEventListener('click', onShare);
}

function bindChipGroup(groupEl, onSelect) {
  if (!groupEl) return;
  const chips = Array.from(groupEl.querySelectorAll('.chip'));
  chips.forEach((chip) => {
    const input = chip.querySelector('input[type="radio"]');
    if (!input) return;
    input.addEventListener('change', (e) => {
      e.stopPropagation();
      if (!input.checked) return;
      chips.forEach((c) => c.classList.remove('is-selected'));
      chip.classList.add('is-selected');
      onSelect(input.value);
    });
  });
}

// =============================================================================
// ⑦ 텍스트 입력 핸들러
// =============================================================================

function onTextInput() {
  const bare = elTextarea.value.replace(/\s+/g, '').length;
  elCharCount.textContent = bare < 8 ? `${bare} · 8자 이상 입력 후 전송` : `${bare} · Ctrl+Enter로 전송`;
  elSubmitBtn.disabled = (bare < 8 || phase === 'loading' || phase === 'colors');
  hideError();
}

// =============================================================================
// ⑧ 제출 핸들러 — [방안C 핵심 변경부]
// =============================================================================

async function onSubmit() {
  const text = elTextarea.value.trim();
  if (text.replace(/\s+/g, '').length < 8 || phase === 'loading' || phase === 'colors') return;

  hideError();
  setPhase('loading');
  lastResult = null;

  try {
    // [방안C] analyzeImpression에 onColors / onReply 콜백 전달
    // Promise는 done 이벤트 수신 시 resolve된다.
    const data = await analyzeImpression(text, {
      tripDuration: selectedDuration,
      companion:    selectedCompanion,

      // Phase 1: colors 이벤트 — emotionScores 저장 + SVG 블러 해제
      onColors: (colorsData) => {
        // emotionScores 임시 저장 — onReply에서 스펙트럼/폰트에 사용
        window._ecardColorData = colorsData;

        // SVG 원본 그대로 블러만 해제
        revealSVG();

        setPhase('colors');
      },

      // Phase 2: reply 이벤트 — 답글 카드 렌더링 + 화면 전환
      onReply: (replyData) => {
        renderResultFromReply(replyData);
        setPhase('done');  // ← showScreen('result') 실행 → DOM 가시화
        // 글로우는 DOM이 실제로 렌더된 뒤(rAF 2틱) 재계산해야
        // glassFrame.offsetHeight가 올바른 값을 반환한다.
        const scores = window._ecardColorData?.emotionScores;
        if (scores) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              applyGlowColors(scores);
            });
          });
        }
      },
    });

    // done 이벤트 후 합친 객체로 lastResult 설정
    lastResult = data;

  } catch (err) {
    console.error('[app] 분석 실패:', err);
    showError(
      err.message?.includes('429')
        ? '요청이 많아 잠시 후 다시 시도해주세요.'
        : '색채 분석에 실패했습니다. 잠시 후 다시 시도해주세요.',
    );
    setPhase('idle');
  }
}

// =============================================================================
// ⑨ 리셋 핸들러
// =============================================================================

function onReset() {
  elTextarea.value        = '';
  elCharCount.textContent = '0 · 8자 이상 입력 후 전송';
  lastResult              = null;

  resetChipGroup(elDurationGroup);
  resetChipGroup(elCompanionGroup);
  selectedDuration  = null;
  selectedCompanion = null;

  resetSVG();

  // 글로우 레이어 제거
  document.querySelectorAll('.glow-layer').forEach(el => el.remove());

  hideError();
  showScreen('input');
  setPhase('idle');
  elTextarea.focus();
}

function resetChipGroup(groupEl) {
  if (!groupEl) return;
  groupEl.querySelectorAll('.chip').forEach((chip) => {
    chip.classList.remove('is-selected');
    const input = chip.querySelector('input[type="radio"]');
    if (input) input.checked = false;
  });
}

// =============================================================================
// ⑩ 저장 핸들러
// =============================================================================

async function onSave() {
  if (!lastResult) return;
  elSaveBtn.disabled    = true;
  elSaveBtn.textContent = '저장 중...';
  try {
    const data = await requestCard(lastResult.emotionScores, lastResult.reply ?? null);
    if (data.downloadUrl) {
      const a = document.createElement('a');
      a.href     = data.downloadUrl;
      a.download = `ulsan-ecard-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      throw new Error('다운로드 URL을 받지 못했습니다.');
    }
  } catch (err) {
    console.error('[app] 저장 실패:', err);
    showError('이미지 저장에 실패했습니다. 다시 시도해주세요.');
  } finally {
    elSaveBtn.disabled    = false;
    elSaveBtn.textContent = '이미지로 저장';
  }
}

// =============================================================================
// ⑪ 공유 핸들러
// =============================================================================

async function onShare() {
  const reply     = lastResult?.reply;
  const shareText = reply
    ? `${reply.main}\n${reply.place}\n${reply.tagline}\n\n울산 E-Card`
    : '울산 E-Card — 나만의 색채로 물드는 울산 12경';

  if (navigator.share) {
    try {
      await navigator.share({ title: '울산 E-Card', text: shareText, url: window.location.href });
    } catch (err) {
      if (err.name !== 'AbortError') fallbackCopyShare(shareText);
    }
  } else {
    fallbackCopyShare(shareText);
  }
}

function fallbackCopyShare(text) {
  navigator.clipboard?.writeText(text).then(() => {
    elShareBtn.textContent = '✓ 복사됨';
    setTimeout(() => { elShareBtn.textContent = '공유하기'; }, 2000);
  }).catch(() => { showError('공유 텍스트를 클립보드에 복사하지 못했습니다.'); });
}

// =============================================================================
// ⑫ 결과 렌더링
// =============================================================================

/**
 * [방안C 신규] Phase2 reply 이벤트 데이터만으로 결과 섹션을 렌더링한다.
 * onReply 콜백에서 호출된다.
 *
 * @param {Object} replyData  { reply, primaryEmotion, keywords }
 */
function renderResultFromReply(replyData) {
  const { reply = {}, primaryEmotion = '울산의 감동', keywords = [] } = replyData;

  renderKeywordChips(keywords);

  elPrimaryEmotion.textContent = primaryEmotion;
  elReplyMain.textContent      = reply.main    ?? '';
  elReplyPlace.textContent     = reply.place   ?? '';
  elReplyTagline.textContent   = reply.tagline ?? 'ULSAN — 당신의 울산';

  // 감성 스펙트럼 + dominant 폰트 적용
  const scores = window._ecardColorData?.emotionScores;
  if (scores) {
    renderSpectrumBars(scores);
    applyDominantFont(scores);
    // applyGlowColors는 onReply 콜백에서 showScreen 이후 rAF으로 실행
    // (화면이 hidden 상태일 때 offsetHeight=0 문제 방지)
  }

  // fade-up 애니메이션 재시작
  elScreenResult.querySelectorAll('.fade-up').forEach((el) => {
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
  });
}

/**
 * 8차원 감성 점수에서 dominant 감성을 찾아 답글 본문 폰트를 변경한다.
 * .reply-body에 font-{emotion} 클래스를 토글한다.
 * @param {Object} scores  { amazement, peace, ... } (0~100)
 */
function applyDominantFont(scores) {
  const replyBody = document.querySelector('.reply-body');
  if (!replyBody) return;

  // 기존 font-* 클래스 모두 제거
  Array.from(replyBody.classList)
    .filter((c) => c.startsWith('font-'))
    .forEach((c) => replyBody.classList.remove(c));

  // dominant 감성 찾기
  const EMOTION_KEYS = ['amazement','peace','vitality','nostalgia',
                        'freshness','grandeur','warmth','mystery'];
  let maxKey = 'warmth';
  let maxVal = -1;
  for (const k of EMOTION_KEYS) {
    const v = Number(scores[k]) || 0;
    if (v > maxVal) { maxVal = v; maxKey = k; }
  }

  replyBody.classList.add(`font-${maxKey}`);
  console.log(`[app] dominant 감성: ${maxKey} (${maxVal}점) → font-${maxKey} 클래스 적용`);
}

/**
 * 기존 renderResult — done 이벤트 후 lastResult로 전체 재렌더가 필요한 경우 사용.
 * (현재 방안C에서는 onReply 콜백으로 대체되었으나 하위 호환용으로 유지)
 * @param {Object} data
 */
function renderResult(data) {
  renderKeywordChips(data.keywords ?? []);
  elPrimaryEmotion.textContent = data.primaryEmotion ?? '울산의 감동';
  const reply = data.reply ?? {};
  elReplyMain.textContent    = reply.main    ?? '';
  elReplyPlace.textContent   = reply.place   ?? '';
  elReplyTagline.textContent = reply.tagline ?? 'ULSAN — 당신의 울산';
  renderSpectrumBars(data.emotionScores ?? {});
  elScreenResult.querySelectorAll('.fade-up').forEach((el) => {
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
  });
}

// =============================================================================
// applyGlowColors — 이미지-카드 경계에 글로우 레이어 삽입 (방안 2)
// =============================================================================

/**
 * 감성 점수에서 주색을 추출하고, 이미지-카드 경계에 .glow-layer div를 삽입한다.
 * PNG 저장과 동일한 구조: 경계선 기준 위(이미지 안) + 아래(카드 안) 양방향 발광.
 * @param {Object} scores
 */
function applyGlowColors(scores) {
  const result = extractDominantColors(scores);
  if (!result) return;

  const { primary, secondary } = result;

  const replyCard = document.querySelector('.reply-card');
  if (!replyCard) return;

  // ── reply-card에 모든 색상 변수 주입 ─────────────────────────
  // ::before 상단 글로우 (방안2)
  replyCard.style.setProperty('--glow-primary',   primary);
  replyCard.style.setProperty('--glow-secondary', secondary);
  // 방사형 빛 (방안4)
  replyCard.style.setProperty('--reply-main', _hexToRgba(primary,   0.18));
  replyCard.style.setProperty('--reply-sub',  _hexToRgba(secondary, 0.12));

  // 글로우 애니메이션 재시작
  replyCard.classList.remove('glow-active');
  void replyCard.offsetWidth;
  replyCard.classList.add('glow-active');

  // 기존 .glow-layer 제거 (잔재 정리)
  document.querySelectorAll('.glow-layer').forEach(el => el.remove());
}

/**
 * hex 색상을 rgba() 문자열로 변환한다.
 * @param {string} hex  '#RRGGBB'
 * @param {number} alpha  0~1
 * @returns {string}  'rgba(r,g,b,a)'
 */
function _hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// =============================================================================
// ⑬ 키워드 칩
// =============================================================================

function renderKeywordChips(keywords) {
  elKeywordChips.innerHTML = '';
  keywords.slice(0, 5).forEach((kw) => {
    const chip = document.createElement('span');
    chip.className   = 'keyword-chip';
    chip.textContent = kw;
    elKeywordChips.appendChild(chip);
  });
}

// =============================================================================
// ⑮ 감성 스펙트럼 바
// =============================================================================

function renderSpectrumBars(scores) {
  elSpectrumBars.innerHTML = '';
  const KEYS     = ['amazement','peace','vitality','nostalgia','freshness','grandeur','warmth','mystery'];
  const maxScore = Math.max(...KEYS.map((k) => scores[k] ?? 0));

  KEYS.forEach((key) => {
    const score      = Math.round(scores[key] ?? 0);
    const isDominant = score === maxScore;
    const row        = document.createElement('div');
    row.className    = `spectrum-row${isDominant ? ' dominant' : ''}`;
    row.innerHTML    = `
      <span class="spectrum-label">${EMOTION_LABELS[key] ?? key}</span>
      <div class="spectrum-bar-track">
        <div class="spectrum-bar-fill" style="width:${score}%"></div>
      </div>
      <span class="spectrum-score">${score}</span>
    `;
    elSpectrumBars.appendChild(row);
  });
}

// =============================================================================
// ⑰ 오류 메시지
// =============================================================================

function showError(msg) {
  elErrorMsg.textContent = msg;
  elErrorMsg.classList.remove('is-hidden');
}

function hideError() {
  elErrorMsg.textContent = '';
  elErrorMsg.classList.add('is-hidden');
}

// =============================================================================
// ⑱ 앱 시작
// =============================================================================

document.addEventListener('DOMContentLoaded', init);
