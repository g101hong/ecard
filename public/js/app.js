/**
 * @fileoverview 울산 E-Card — 프론트엔드 앱 진입점
 * @version 6.1.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 현재 동작 방식 (정적 이미지 + SSE 스트리밍)
 * ─────────────────────────────────────────────────────────────────
 *
 *   POST /api/impression → SSE 2단계 스트리밍
 *
 *   Phase 1 (colors 이벤트):
 *     서버가 spotIndex·emotionScores·dominantEmotion을 전송.
 *     클라이언트는 spotIndex에 해당하는 정적 이미지(ulsan_scene_XX.jpg)를
 *     scene-image.js를 통해 표시한다.
 *
 *   Phase 2 (reply 이벤트):
 *     서버가 reply(main/place/tagline)·keywords 등을 전송.
 *     클라이언트는 답글 카드를 렌더링하고 글로우 색상을 적용한다.
 *
 *   저장(onSave):
 *     POST /api/card → 서버에서 PNG 합성 → downloadUrl 반환 → 자동 다운로드.
 *     dominantEmotion을 함께 전달하여 PNG 폰트가 웹화면과 일치하도록 보장.
 */

'use strict';

// =============================================================================
// ① 모듈 임포트
// =============================================================================

import { showSceneImage,
         revealSceneImage,
         resetSceneImage } from './scene-image.js';
import { analyzeImpression,
         requestCard }     from './api.js';

// svg-engine/emotion-colors.js 와 동일한 수치를 인라인으로 구현.
// (빌드 도구 없는 환경에서 서버 모듈을 직접 import할 수 없기 때문.)
// 웹화면 글로우 색상과 저장 PNG 글로우 색상을 일치시키기 위해 수치를 통일.
const EMOTION_BASE_COLOR = {
  warmth:    { h: 12,  s: 0.88, l: 0.58 }, // 코랄오렌지  — 온기·노을·포근
  amazement: { h: 48,  s: 0.95, l: 0.55 }, // 황금앰버    — 경이·일출·장엄
  vitality:  { h: 92,  s: 0.72, l: 0.45 }, // 초록라임    — 활기·에너지·약동
  freshness: { h: 178, s: 0.75, l: 0.48 }, // 청록시안    — 청량·맑은 바다
  peace:     { h: 212, s: 0.55, l: 0.58 }, // 하늘청      — 평온·고요·하늘
  grandeur:  { h: 252, s: 0.60, l: 0.40 }, // 딥인디고    — 웅장·심원·압도
  mystery:   { h: 298, s: 0.58, l: 0.42 }, // 마젠타보라  — 신비·몽환·깊이
  nostalgia: { h: 342, s: 0.50, l: 0.50 }, // 더스티로즈  — 그리움·옛 추억
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
    .slice(0, 4);
  if (sorted[0].score === 0) return null;
  const colors = sorted.map(({ emotion, score }) => {
    const base      = EMOTION_BASE_COLOR[emotion];
    const intensity = clamp(score / 100, 0, 1);
    const s = clamp(base.s * (0.75 + intensity * 0.25), 0.25, 1.0);
    return {
      emotion, score,
      dark:  _hsl(base.h, s * 0.65, clamp(base.l * 0.35, 0.08, 0.28)),
      mid:   _hsl(base.h, s,        clamp(base.l * 0.85, 0.30, 0.68)),
      light: _hsl(base.h, s * 0.55, clamp(base.l * 1.35, 0.65, 0.90)),
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

// =============================================================================
// 유효 감성 키 목록 (dominantEmotion 검증용)
// =============================================================================

const VALID_EMOTIONS = new Set([
  'amazement', 'mystery', 'grandeur', 'nostalgia',
  'warmth',    'vitality', 'freshness', 'peace',
]);

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
// ⑧ 제출 핸들러
// =============================================================================

async function onSubmit() {
  const text = elTextarea.value.trim();
  if (text.replace(/\s+/g, '').length < 8 || phase === 'loading' || phase === 'colors') return;

  hideError();
  setPhase('loading');
  lastResult = null;

  try {
    const data = await analyzeImpression(text, {
      tripDuration: selectedDuration,
      companion:    selectedCompanion,

      // Phase 1: colors 이벤트 — spotIndex·emotionScores·dominantEmotion 수신
      onColors: (colorsData) => {
        window._ecardColorData = colorsData;
        showSceneImage(colorsData.spotIndex).then(() => {
          revealSceneImage();
        });
        setPhase('colors');
      },

      // Phase 2: reply 이벤트 — 답글 카드 렌더링
      onReply: (replyData) => {
        renderResultFromReply(replyData);
        setPhase('done');
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

    lastResult = data;

    // _ecardColorData.dominantEmotion은 서버가 결정한 확정값.
    // analyzeImpression() 반환 data에는 포함되지 않으므로 여기서 병합.
    if (window._ecardColorData?.dominantEmotion) {
      lastResult.dominantEmotion = window._ecardColorData.dominantEmotion;
    }

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

  resetSceneImage();
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
    const data = await requestCard(
      lastResult.emotionScores,
      lastResult.reply ?? null,
      lastResult.spotIndex,
      1200,
      lastResult.dominantEmotion,   // PNG 폰트가 웹화면과 일치하도록 전달
    );
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
 * Phase2 reply 이벤트 데이터로 결과 섹션을 렌더링한다.
 * @param {Object} replyData  { reply, primaryEmotion, keywords }
 */
function renderResultFromReply(replyData) {
  const { reply = {}, primaryEmotion = '울산의 감동', keywords = [] } = replyData;

  renderKeywordChips(keywords);

  elPrimaryEmotion.textContent = primaryEmotion;
  elReplyMain.textContent      = reply.main    ?? '';
  elReplyPlace.textContent     = reply.place   ?? '';
  elReplyTagline.textContent   = reply.tagline ?? 'ULSAN — 당신의 울산';

  const colorData = window._ecardColorData;

  // 감성 스펙트럼
  if (colorData?.emotionScores) {
    renderSpectrumBars(colorData.emotionScores);
  }

  // dominant 폰트: 서버 결정값을 그대로 사용 (클라이언트 재계산 없음)
  if (colorData?.dominantEmotion) {
    applyDominantFont(colorData.dominantEmotion);
  }

  // fade-up 애니메이션 재시작
  elScreenResult.querySelectorAll('.fade-up').forEach((el) => {
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
  });
}

/**
 * dominant 감성에 맞는 폰트 클래스를 .reply-body에 적용한다.
 *
 * 서버가 결정한 dominantEmotion 문자열을 직접 받아 사용한다.
 * emotionScores 재계산 없이 서버 확정값을 그대로 쓰므로
 * 동점·소수점 처리 차이로 인한 폰트 불일치가 발생하지 않는다.
 *
 * @param {string} dominantEmotion  서버에서 결정된 dominant 감성 키
 */
function applyDominantFont(dominantEmotion) {
  const replyBody = document.querySelector('.reply-body');
  if (!replyBody) return;

  // 기존 font-* 클래스 모두 제거
  Array.from(replyBody.classList)
    .filter((c) => c.startsWith('font-'))
    .forEach((c) => replyBody.classList.remove(c));

  // 서버 결정값 직접 사용
  const safeKey = VALID_EMOTIONS.has(dominantEmotion) ? dominantEmotion : 'amazement';
  replyBody.classList.add(`font-${safeKey}`);
  console.log(`[app] dominant 폰트 적용: font-${safeKey}`);
}

/**
 * 하위 호환용 renderResult (onReply 콜백 대체 시 사용).
 */
function renderResult(data) {
  renderKeywordChips(data.keywords ?? []);
  elPrimaryEmotion.textContent = data.primaryEmotion ?? '울산의 감동';
  const reply = data.reply ?? {};
  elReplyMain.textContent    = reply.main    ?? '';
  elReplyPlace.textContent   = reply.place   ?? '';
  elReplyTagline.textContent = reply.tagline ?? 'ULSAN — 당신의 울산';
  renderSpectrumBars(data.emotionScores ?? {});
  if (data.dominantEmotion) applyDominantFont(data.dominantEmotion);
  elScreenResult.querySelectorAll('.fade-up').forEach((el) => {
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
  });
}

// =============================================================================
// ⑬ 글로우 컬러 적용
// =============================================================================

function applyGlowColors(scores) {
  const result = extractDominantColors(scores);
  if (!result) return;

  const { primary, secondary, tertiary, quaternary } = result;

  const replyCard = document.querySelector('.reply-card');
  if (!replyCard) return;

  replyCard.style.setProperty('--glow-primary',   primary);
  replyCard.style.setProperty('--glow-secondary', secondary);
  replyCard.style.setProperty('--reply-main', _hexToRgba(tertiary,   0.32));
  replyCard.style.setProperty('--reply-sub',  _hexToRgba(quaternary, 0.22));

  replyCard.classList.remove('glow-active');
  void replyCard.offsetWidth;
  replyCard.classList.add('glow-active');

  document.querySelectorAll('.glow-layer').forEach(el => el.remove());
}

function _hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// =============================================================================
// ⑭ 키워드 칩
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
// ⑯ 오류 메시지
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
// ⑰ 앱 시작
// =============================================================================

document.addEventListener('DOMContentLoaded', init);
