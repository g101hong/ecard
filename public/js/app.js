/**
 * @fileoverview 울산 E-Card — 프론트엔드 앱 진입점
 * @version 3.0.0  (HTML/Vanilla JS — 빌드 도구 없음)
 *
 * 담당 역할:
 *   - SVG 로드 및 인라인 삽입
 *   - 소감 입력 이벤트 처리
 *   - /api/impression 호출 → 색채 적용 → 결과 렌더링
 *   - /api/card 호출 → PNG 다운로드
 *   - SNS 공유
 *   - 상태 관리: 'idle' | 'loading' | 'done'
 */

'use strict';

// =============================================================================
// ① 모듈 임포트
// =============================================================================

import { SPOTS }                          from './spots.js';
import { calculateAllPanelColors,
         colorTempToFilter }              from './color-engine.js';
import { loadSVG,
         applyColorsToSVG,
         revealSVG,
         resetSVG,
         highlightPanel }                 from './svg-renderer.js';
import { analyzeImpression,
         requestCard }                    from './api.js';

// =============================================================================
// ② DOM 참조
// =============================================================================

const $ = (id) => document.getElementById(id);

const elTextarea     = $('impression-text');
const elCharCount    = $('char-count');
const elSubmitBtn    = $('submit-btn');
const elResetBtn     = $('reset-btn');
const elErrorMsg     = $('error-msg');
const elResultSection = $('result-section');
const elLoading      = $('loading-overlay');
const elBlurHint     = $('blur-hint');
const elSpotLabel    = $('active-spot-label');
const elPaletteStrip = $('palette-strip');
const elKeywordChips = $('keyword-chips');
const elPrimaryEmotion = $('primary-emotion');
const elReplyMain    = $('reply-main');
const elReplyPlace   = $('reply-place');
const elReplyTagline = $('reply-tagline');
const elSpectrumBars = $('spectrum-bars');
const elSaveBtn      = $('save-btn');
const elShareBtn     = $('share-btn');

// =============================================================================
// ③ 앱 상태
// =============================================================================

/** @type {'idle'|'loading'|'done'} */
let phase = 'idle';

/** 마지막 API 응답 데이터 */
let lastResult = null;

// 감성 키값 한글 레이블 맵
const EMOTION_LABELS = {
  amazement: '경이',
  peace:     '평화',
  vitality:  '활기',
  nostalgia: '향수',
  freshness: '청량',
  grandeur:  '웅장',
  warmth:    '따뜻함',
  mystery:   '신비',
};

// =============================================================================
// ④ 상태 전환
// =============================================================================

/**
 * 앱 단계(phase)를 전환하고 UI를 업데이트한다.
 * @param {'idle'|'loading'|'done'} next
 */
function setPhase(next) {
  phase = next;

  // 로딩 오버레이
  elLoading.classList.toggle('hidden', next !== 'loading');

  // 버튼 상태
  elSubmitBtn.disabled = (next === 'loading' || elTextarea.value.trim().length < 8);
  elResetBtn.classList.toggle('hidden', next === 'idle');

  // 블러 힌트 (idle 상태에서만 표시)
  elBlurHint.classList.toggle('hidden', next !== 'idle');

  // 결과 섹션
  elResultSection.classList.toggle('hidden', next !== 'done');
}

// =============================================================================
// ⑤ 초기화
// =============================================================================

/**
 * 앱 초기화 — DOMContentLoaded 이후 실행
 */
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
  // 텍스트 입력
  elTextarea.addEventListener('input', onTextInput);

  // Ctrl+Enter 단축키
  elTextarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!elSubmitBtn.disabled) onSubmit();
    }
  });

  // 버튼
  elSubmitBtn.addEventListener('click', onSubmit);
  elResetBtn.addEventListener('click',  onReset);
  elSaveBtn.addEventListener('click',   onSave);
  elShareBtn.addEventListener('click',  onShare);
}

// =============================================================================
// ⑦ 텍스트 입력 핸들러
// =============================================================================

function onTextInput() {
  const text  = elTextarea.value;
  const len   = text.length;
  const bare  = text.replace(/\s+/g, '').length;

  // 글자 수 표시
  const hint = bare < 8
    ? `${bare} · 8자 이상 입력 후 전송`
    : `${bare} · Ctrl+Enter로 전송`;
  elCharCount.textContent = hint;

  // 제출 버튼 활성화
  elSubmitBtn.disabled = (bare < 8 || phase === 'loading');

  // 오류 메시지 초기화
  hideError();
}

// =============================================================================
// ⑧ 제출 핸들러 (핵심 흐름)
// =============================================================================

async function onSubmit() {
  const text = elTextarea.value.trim();
  if (text.length < 8 || phase === 'loading') return;

  hideError();
  setPhase('loading');

  try {
    // POST /api/impression
    const data = await analyzeImpression(text);
    lastResult = data;

    // ── SVG 색채 적용 ──────────────────────────────────────────────
    if (data.panelColors && data.panelColors.length === 12) {
      applyColorsToSVG(data.panelColors);
    } else if (data.emotionScores) {
      // 클라이언트 사이드 폴백 계산
      const fallbackColors = calculateAllPanelColors(
        data.emotionScores,
        data.diversitySeed ?? 0,
      );
      applyColorsToSVG(fallbackColors);
    }

    // ── SVG 블러 해제 애니메이션 ──────────────────────────────────
    revealSVG();

    // ── 색온도 CSS 필터 적용 (선택) ───────────────────────────────
    if (data.colorTempFilter) {
      const svgContainer = document.getElementById('svg-container');
      if (svgContainer) {
        svgContainer.style.filter =
          svgContainer.style.filter
            ? `${svgContainer.style.filter} ${data.colorTempFilter}`
            : data.colorTempFilter;
      }
    }

    // ── 패널 강조 ─────────────────────────────────────────────────
    if (typeof data.spotIndex === 'number') {
      highlightPanel(data.spotIndex);
      showSpotLabel(data.spotIndex);
    }

    // ── 팔레트 스트립 ─────────────────────────────────────────────
    renderPaletteStrip(data.panelColors ?? []);

    // ── 결과 렌더링 ───────────────────────────────────────────────
    renderResult(data);

    setPhase('done');

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
  elTextarea.value  = '';
  elCharCount.textContent = '0 · Ctrl+Enter로 전송';
  lastResult = null;

  resetSVG();
  elSpotLabel.classList.add('hidden');
  elPaletteStrip.classList.add('hidden');

  hideError();
  setPhase('idle');

  elTextarea.focus();
}

// =============================================================================
// ⑩ 저장 핸들러
// =============================================================================

async function onSave() {
  if (!lastResult) return;

  elSaveBtn.disabled = true;
  elSaveBtn.textContent = '저장 중...';

  try {
    const data = await requestCard(
      lastResult.emotionScores,
      lastResult.diversitySeed ?? 0,
      lastResult.reply ?? null,
    );

    if (data.downloadUrl) {
      // 프로그래매틱 다운로드
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
    elSaveBtn.disabled = false;
    elSaveBtn.textContent = '이미지로 저장';
  }
}

// =============================================================================
// ⑪ 공유 핸들러
// =============================================================================

async function onShare() {
  const reply = lastResult?.reply;
  const shareText = reply
    ? `${reply.main}\n${reply.place}\n${reply.tagline}\n\n울산 E-Card`
    : '울산 E-Card — 나만의 색채로 물드는 울산 12경';

  if (navigator.share) {
    try {
      await navigator.share({
        title: '울산 E-Card',
        text:  shareText,
        url:   window.location.href,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        fallbackCopyShare(shareText);
      }
    }
  } else {
    fallbackCopyShare(shareText);
  }
}

/**
 * Web Share API 미지원 환경 — 클립보드 복사로 폴백
 * @param {string} text
 */
function fallbackCopyShare(text) {
  navigator.clipboard?.writeText(text).then(() => {
    elShareBtn.textContent = '✓ 복사됨';
    setTimeout(() => { elShareBtn.textContent = '공유하기'; }, 2000);
  }).catch(() => {
    showError('공유 텍스트를 클립보드에 복사하지 못했습니다.');
  });
}

// =============================================================================
// ⑫ 결과 렌더링
// =============================================================================

/**
 * API 응답 데이터로 결과 섹션을 렌더링한다.
 * @param {Object} data  /api/impression 응답
 */
function renderResult(data) {
  // ── 감성 키워드 칩 ────────────────────────────────────────────
  renderKeywordChips(data.keywords ?? []);

  // ── 핵심 감성 ────────────────────────────────────────────────
  elPrimaryEmotion.textContent = data.primaryEmotion ?? '울산의 감동';

  // ── E-Card 3단 답글 ──────────────────────────────────────────
  const reply = data.reply ?? {};
  elReplyMain.textContent    = reply.main    ?? '';
  elReplyPlace.textContent   = reply.place   ?? '';
  elReplyTagline.textContent = reply.tagline ?? 'ULSAN — 당신의 울산';

  // ── 감성 스펙트럼 바 ──────────────────────────────────────────
  renderSpectrumBars(data.emotionScores ?? {});

  // ── fade-up 애니메이션 재시작 ─────────────────────────────────
  elResultSection.querySelectorAll('.fade-up').forEach((el) => {
    el.style.animation = 'none';
    // 브라우저가 리플로우를 발생시키도록 잠시 비움
    void el.offsetHeight;
    el.style.animation = '';
  });
}

// =============================================================================
// ⑬ 팔레트 스트립 렌더링
// =============================================================================

/**
 * 12개 패널 색상을 가로 스트립으로 표시한다.
 * @param {Array<{main:string}>} panelColors
 */
function renderPaletteStrip(panelColors) {
  if (!panelColors || panelColors.length === 0) return;

  elPaletteStrip.innerHTML = '';

  panelColors.forEach((panel, i) => {
    const chip = document.createElement('div');
    chip.className   = 'palette-chip';
    chip.title       = SPOTS[i]?.name ?? `패널 ${i}`;
    chip.style.background = panel.main ?? panel.cssHSL ?? '#888';

    chip.addEventListener('click', () => {
      highlightPanel(i);
      showSpotLabel(i);
    });

    elPaletteStrip.appendChild(chip);
  });

  elPaletteStrip.classList.remove('hidden');
}

// =============================================================================
// ⑭ 키워드 칩 렌더링
// =============================================================================

/**
 * 감성 키워드를 칩 형태로 렌더링한다.
 * @param {string[]} keywords
 */
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
// ⑮ 감성 스펙트럼 바 렌더링
// =============================================================================

/**
 * 8차원 감성 점수를 수평 막대 그래프로 렌더링한다.
 * @param {Object} scores  { amazement:0~100, ... }
 */
function renderSpectrumBars(scores) {
  elSpectrumBars.innerHTML = '';

  const EMOTION_KEYS = [
    'amazement', 'peace', 'vitality', 'nostalgia',
    'freshness', 'grandeur', 'warmth', 'mystery',
  ];

  // 최고 점수 찾기 (강조 표시)
  const maxScore = Math.max(...EMOTION_KEYS.map((k) => scores[k] ?? 0));

  EMOTION_KEYS.forEach((key) => {
    const score     = Math.round(scores[key] ?? 0);
    const label     = EMOTION_LABELS[key] ?? key;
    const pct       = `${score}%`;
    const isDominant = score === maxScore;

    const row = document.createElement('div');
    row.className = `spectrum-row${isDominant ? ' dominant' : ''}`;

    row.innerHTML = `
      <span class="spectrum-label">${label}</span>
      <div class="spectrum-bar-track">
        <div class="spectrum-bar-fill" style="width:${pct}"></div>
      </div>
      <span class="spectrum-score">${score}</span>
    `;

    elSpectrumBars.appendChild(row);
  });
}

// =============================================================================
// ⑯ 경승지 레이블 표시
// =============================================================================

/**
 * SVG 아래에 현재 강조된 경승지 이름을 표시한다.
 * @param {number} spotIndex
 */
function showSpotLabel(spotIndex) {
  const spot = SPOTS[spotIndex];
  if (!spot) return;

  elSpotLabel.textContent = `${spot.emoji} ${spot.name}`;
  elSpotLabel.classList.remove('hidden');
}

// =============================================================================
// ⑰ 오류 메시지 표시/숨김
// =============================================================================

function showError(msg) {
  elErrorMsg.textContent = msg;
  elErrorMsg.classList.remove('hidden');
}

function hideError() {
  elErrorMsg.textContent = '';
  elErrorMsg.classList.add('hidden');
}

// =============================================================================
// ⑱ 앱 시작
// =============================================================================

document.addEventListener('DOMContentLoaded', init);
