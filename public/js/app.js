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

import { SPOTS }                          from './spots.js';
import { loadSVG,
         applyDeltaColorsToSVG,
         revealSVG,
         resetSVG,
         highlightPanel }                 from './svg-renderer.js';
import { analyzeImpression,
         requestCard }                    from './api.js';

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
const elPaletteStrip   = $('palette-strip');
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

      // ── Phase 1: colors 이벤트 수신 즉시 ──────────────────────
      // Gemini 응답 완료 후 색상 데이터가 가장 먼저 온다.
      // 이 시점에 SVG 색채 전환 + 블러 해제를 실행한다.
      // 사용자는 답글을 기다리는 동안 색채 애니메이션을 본다.
      onColors: (colorsData) => {
        // emotionScores를 임시 저장 — onReply에서 renderResultFromReply가 사용
        window._ecardColorData = colorsData;

        // SVG 색채 delta 적용 (현재 SVG 색상 기준)
        const colorResult = applyDeltaColorsToSVG(
          colorsData.emotionScores,
          colorsData.diversitySeed ?? 0,
        );

        // 블러 해제 애니메이션
        revealSVG();

        // 색온도 CSS 필터 적용
        if (colorsData.colorTempFilter) {
          const svgContainer = document.getElementById('svg-container');
          if (svgContainer) {
            svgContainer.style.filter = colorsData.colorTempFilter;
          }
        }

        // 팔레트 스트립
        renderPaletteStrip(colorResult.panelColors);

        // 로딩 스피너는 유지 (답글 카드는 아직 미수신)
        // phase를 'colors'로 바꿔 중복 제출 방지
        setPhase('colors');
      },

      // ── Phase 2: reply 이벤트 수신 즉시 ───────────────────────
      // colors 이벤트 직후 수십ms 이내에 도달한다.
      // 답글 카드 + 키워드 + 스펙트럼을 렌더하고 화면 2로 전환한다.
      onReply: (replyData) => {
        renderResultFromReply(replyData);
        setPhase('done');
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
  elPaletteStrip.classList.add('hidden');

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
    const data = await requestCard(lastResult.emotionScores, lastResult.diversitySeed ?? 0, lastResult.reply ?? null);
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

  // 스펙트럼 바는 lastResult.emotionScores가 아직 없을 수 있으므로
  // accumulated 객체에서 꺼낸다 (api.js가 onReply 전에 onColors에서 이미 설정)
  // → app.js에서는 lastResult 대신 클로저로 접근하지 않고,
  //   Phase 2 시점에 window._ecardColorData를 임시로 사용한다.
  if (window._ecardColorData?.emotionScores) {
    renderSpectrumBars(window._ecardColorData.emotionScores);
  }

  // fade-up 애니메이션 재시작
  elScreenResult.querySelectorAll('.fade-up').forEach((el) => {
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
  });
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
// ⑬ 팔레트 스트립
// =============================================================================

function renderPaletteStrip(panelColors) {
  if (!panelColors || panelColors.length === 0) return;
  const hasColors = panelColors.some((p) => p.color !== null);
  if (!hasColors) { elPaletteStrip.classList.add('hidden'); return; }

  elPaletteStrip.innerHTML = '';
  panelColors.forEach((panel) => {
    if (!panel.color) return;
    const chip = document.createElement('div');
    chip.className        = 'palette-chip';
    chip.title            = panel.name ?? SPOTS[panel.index]?.name ?? `패널 ${panel.index}`;
    chip.style.background = panel.color;
    chip.addEventListener('click', () => highlightPanel(panel.index));
    elPaletteStrip.appendChild(chip);
  });
  elPaletteStrip.classList.remove('hidden');
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
