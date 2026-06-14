/**
 * @fileoverview 울산 E-Card — SVG 인라인 렌더링 · 색채 패치 · 블러 제어
 * @module public/js/svg-renderer
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   assets/stained-glass.svg 를 fetch로 불러와 #svg-container 에
 *   인라인 삽입하고, 이후 색채 패치·블러 해제·패널 강조를
 *   DOM 조작으로 직접 수행한다.
 *
 *   서버 svg-engine/svg-patcher.js 와 동일한 ID 체계를 사용하므로
 *   브라우저에서 보이는 색상과 PNG 저장 결과가 동일하게 재현된다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [SVG ID 체계 — 경승지별_ID_및_채색방법.txt 기준]
 *
 *   각 경승지는 "spot-00" ~ "spot-11" 시작 문자를 포함하는
 *   ID를 가진 오브젝트(그라디언트·패널 그룹)로 구성된다.
 *
 *   spot-00 : 태화강 국가정원과 십리대숲
 *   spot-01 : 대왕암공원
 *   spot-02 : 가지산 사계
 *   spot-03 : 신불산 억새평원
 *   spot-04 : 간절곶 일출
 *   spot-05 : 반구대 암각화
 *   spot-06 : 강동 몽돌해변
 *   spot-07 : 울산대공원
 *   spot-08 : 울산대교
 *   spot-09 : 장생포 고래문화마을
 *   spot-10 : 외고산 옹기마을
 *   spot-11 : 대운산 내원암 계곡
 *
 *   그라디언트 stop ID 패턴:
 *     grad-spot-XX-main / grad-spot-XX-sub / grad-spot-XX-acc
 *
 *   패널 그룹 ID 패턴:
 *     panel-spot-XX  (또는 id에 "spot-XX"가 포함된 요소)
 *
 * ─────────────────────────────────────────────────────────────────
 * [emotion-engine 인덱스 ↔ SVG spot-XX 매핑]
 *
 *   /api/impression 이 반환하는 panelColors[i] (i = 0~11)는
 *   emotion-engine/constants/spot-palettes.js 순서(SPOTS 인덱스)이며
 *   SVG의 spot-XX 번호 체계와는 다르다. 이 모듈의 EMOTION_TO_SVG_SPOT
 *   배열이 그 변환을 담당한다.
 *
 *     emotion index 0 (간절곶 일출)            → spot-04
 *     emotion index 1 (대왕암공원)              → spot-01
 *     emotion index 2 (강동 몽돌해변)           → spot-06
 *     emotion index 3 (장생포 고래문화마을)     → spot-09
 *     emotion index 4 (외고산 옹기마을)         → spot-10
 *     emotion index 5 (반구대 암각화)           → spot-05
 *     emotion index 6 (대운산 내원암 계곡)      → spot-11
 *     emotion index 7 (울산대교)                → spot-08
 *     emotion index 8 (울산대공원)              → spot-07
 *     emotion index 9 (태화강 국가정원·십리대숲) → spot-00
 *     emotion index 10 (신불산 억새평원)        → spot-03
 *     emotion index 11 (가지산 사계)            → spot-02
 *
 * ─────────────────────────────────────────────────────────────────
 * [공개 API]
 *
 *   loadSVG()                  SVG fetch + 인라인 삽입 (블러 상태로 시작)
 *   applyColorsToSVG(colors)   panelColors[12] → <stop> stop-color 반영
 *   revealSVG()                블러 해제 (CSS transition)
 *   resetSVG()                 기본 팔레트로 복원 + 블러 재적용
 *   highlightPanel(spotIndex)  매칭 경승지 패널에 강조 효과 적용
 */

'use strict';

import { SPOTS } from './spots.js';

// =============================================================================
// ① 설정 상수
// =============================================================================

const SVG_CONFIG = Object.freeze({
  /** SVG 원본 파일 경로 */
  SVG_URL: '/assets/stained-glass.svg',

  /** SVG를 삽입할 컨테이너 ID */
  CONTAINER_ID: 'svg-container',

  /** 블러 상태를 나타내는 CSS 클래스 */
  BLURRED_CLASS: 'blurred',

  /** 강조 효과 CSS 클래스 */
  HIGHLIGHT_CLASS: 'panel-highlight',

  /** 패널 그룹 ID 접두어 */
  PANEL_PREFIX: 'panel-',
});

/**
 * emotion-engine 인덱스(0~11, spot-palettes.js 순서) → SVG spot-XX 번호
 * 경승지별_ID_및_채색방법.txt 매핑 기준
 *
 * @type {number[]}
 */
const EMOTION_TO_SVG_SPOT = [
  4,  // 0  간절곶 일출            → spot-04
  1,  // 1  대왕암공원              → spot-01
  6,  // 2  강동 몽돌해변           → spot-06
  9,  // 3  장생포 고래문화마을     → spot-09
  10, // 4  외고산 옹기마을         → spot-10
  5,  // 5  반구대 암각화           → spot-05
  11, // 6  대운산 내원암 계곡      → spot-11
  8,  // 7  울산대교                → spot-08
  7,  // 8  울산대공원              → spot-07
  0,  // 9  태화강 국가정원·십리대숲 → spot-00
  3,  // 10 신불산 억새평원         → spot-03
  2,  // 11 가지산 사계             → spot-02
];

// =============================================================================
// ② 내부 상태
// =============================================================================

/** 마지막으로 강조된 SVG spot-XX 번호 (resetSVG에서 해제용) */
let _lastHighlightedSvgSpot = null;

/** SVG 원본 fetch 캐시 (재요청 방지) */
let _svgCache = null;

// =============================================================================
// ③ DOM 헬퍼
// =============================================================================

/**
 * #svg-container 요소를 반환한다.
 * @returns {HTMLElement|null}
 */
function _container() {
  return document.getElementById(SVG_CONFIG.CONTAINER_ID);
}

/**
 * 두 자리 패딩 spot 번호 문자열을 생성한다.
 * @param {number} n  0~11
 * @returns {string}  '00' ~ '11'
 */
function _pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * emotion-engine 인덱스를 SVG spot-XX 번호로 변환한다.
 * @param {number} emotionIndex  0~11
 * @returns {number}  대응하는 SVG spot 번호 (0~11)
 */
function _toSvgSpot(emotionIndex) {
  return EMOTION_TO_SVG_SPOT[emotionIndex] ?? emotionIndex;
}

// =============================================================================
// ④ SVG 로드 & 인라인 삽입
// =============================================================================

/**
 * stained-glass.svg 를 fetch로 불러와 #svg-container 에 인라인 삽입한다.
 *
 * 인라인 삽입을 사용하는 이유:
 *   <img src="..."> 로는 내부 <stop> 요소의 stop-color 속성을
 *   JS에서 직접 변경할 수 없다. SVG를 DOM에 직접 삽입해야
 *   getElementById로 그라디언트 stop을 조작할 수 있다.
 *
 * 삽입 직후 컨테이너에 BLURRED_CLASS를 추가하여
 * 색채 입히기 전까지 블러 상태를 유지한다.
 *
 * @returns {Promise<void>}
 * @throws {Error} fetch 실패 또는 SVG 파싱 실패 시
 *
 * @example
 * await loadSVG();
 * // #svg-container 안에 <svg>...</svg> 가 삽입됨 (blurred 클래스 포함)
 */
export async function loadSVG() {
  const container = _container();
  if (!container) {
    throw new Error('[svg-renderer] #svg-container 요소를 찾을 수 없습니다.');
  }

  // 캐시된 SVG 텍스트가 있으면 재사용 (재호출 시 네트워크 절약)
  let svgText = _svgCache;

  if (!svgText) {
    const res = await fetch(SVG_CONFIG.SVG_URL);
    if (!res.ok) {
      throw new Error(`[svg-renderer] SVG 로드 실패: HTTP ${res.status}`);
    }
    svgText = await res.text();
    _svgCache = svgText;
  }

  container.innerHTML = svgText;

  const svgEl = container.querySelector('svg');
  if (!svgEl) {
    throw new Error('[svg-renderer] 삽입된 콘텐츠에서 <svg> 요소를 찾을 수 없습니다.');
  }

  // 반응형 — 컨테이너 너비에 맞춤
  svgEl.setAttribute('width', '100%');
  svgEl.setAttribute('height', '100%');
  svgEl.removeAttribute('style');

  // 색채 입히기 전 블러 상태로 시작
  container.classList.add(SVG_CONFIG.BLURRED_CLASS);
}

// =============================================================================
// ⑤ 색채 패치
// =============================================================================

/**
 * panelColors[12] 를 SVG <stop> 요소의 stop-color 속성에 직접 반영한다.
 *
 * panelColors 는 emotion-engine 인덱스(0~11, spot-palettes.js 순서)이며
 * 내부적으로 EMOTION_TO_SVG_SPOT 매핑을 통해 SVG의 spot-XX 그라디언트로
 * 변환된다.
 *
 * 각 패널의 그라디언트는 3개 stop으로 구성된다:
 *   grad-spot-XX-acc   (offset 0%)   — 강조색
 *   grad-spot-XX-main  (offset 60%)  — 주색
 *   grad-spot-XX-sub   (offset 100%) — 보조색
 *
 * CSS의 `stop { transition: stop-color 0.8s ease; }` 규칙에 의해
 * 색상이 부드럽게 전환된다 (animations.css 참조).
 *
 * @param {Array<{ index:number, main:string, sub:string, acc:string }>} panelColors
 *   길이 12, index 순서는 emotion-engine 인덱스(0~11)
 * @returns {{ applied: number, missing: string[] }}
 *   applied: 정상 반영된 패널 수, missing: 찾지 못한 stop ID 목록
 *
 * @example
 * const result = applyColorsToSVG(data.panelColors);
 * // result.applied → 12 (모두 반영됨)
 * // result.missing → [] (누락 없음)
 */
export function applyColorsToSVG(panelColors) {
  const container = _container();
  const missing    = [];
  let   applied    = 0;

  if (!container || !Array.isArray(panelColors)) {
    return { applied, missing };
  }

  panelColors.forEach((panel) => {
    const emotionIdx = panel.index;
    if (typeof emotionIdx !== 'number') return;

    const svgSpot = _pad(_toSvgSpot(emotionIdx));

    const stopMap = {
      main: panel.main,
      sub:  panel.sub,
      acc:  panel.acc,
    };

    let panelOk = true;

    Object.entries(stopMap).forEach(([key, color]) => {
      if (!color) return;

      const stopId = `grad-spot-${svgSpot}-${key}`;
      const stopEl = container.querySelector(`#${stopId}`);

      if (stopEl) {
        stopEl.setAttribute('stop-color', color);
      } else {
        panelOk = false;
        missing.push(stopId);
      }
    });

    if (panelOk) applied++;
  });

  return { applied, missing };
}

// =============================================================================
// ⑥ 블러 제어
// =============================================================================

/**
 * 블러 상태를 해제하여 색채가 입혀진 SVG를 드러낸다.
 *
 * #svg-container.blurred 클래스를 제거하면
 * animations.css의 transition(1.2s)에 의해
 * 블러·밝기·채도가 자연스럽게 원상태로 전환된다.
 *
 * #blur-hint("소감을 입력하면...") 가 존재하면 함께 숨긴다.
 *
 * @example
 * applyColorsToSVG(data.panelColors);
 * revealSVG();
 */
export function revealSVG() {
  const container = _container();
  if (!container) return;

  container.classList.remove(SVG_CONFIG.BLURRED_CLASS);

  const hint = document.getElementById('blur-hint');
  if (hint) hint.classList.add('hidden');
}

// =============================================================================
// ⑦ 초기화 / 리셋
// =============================================================================

/**
 * SVG를 기본 팔레트(spots.js)로 복원하고 블러 상태로 되돌린다.
 *
 * "다시 쓰기" 버튼 클릭 시 호출되어
 * 이전 소감으로 생성된 색채를 지우고 초기 화면으로 복귀한다.
 *
 * 처리 내용:
 *   1. SPOTS 기본 팔레트(main/sub/acc)로 모든 <stop> 복원
 *   2. 강조(highlight) 효과 해제
 *   3. #svg-container 에 blurred 클래스 재적용
 *   4. #blur-hint 다시 표시
 *
 * @example
 * resetSVG();
 * // → 모든 패널이 SPOTS 기본 색상으로 돌아가고 블러 처리됨
 */
export function resetSVG() {
  const container = _container();
  if (!container) return;

  // ── 기본 팔레트로 복원 ────────────────────────────────────────
  const basePanelColors = SPOTS.map((spot) => ({
    index: spot.index,
    main:  spot.hex.main,
    sub:   spot.hex.sub,
    acc:   spot.hex.acc,
  }));
  applyColorsToSVG(basePanelColors);

  // ── 강조 효과 해제 ────────────────────────────────────────────
  _clearHighlight(container);

  // ── 블러 재적용 ───────────────────────────────────────────────
  container.classList.add(SVG_CONFIG.BLURRED_CLASS);
  container.style.filter = ''; // colorTempFilter로 추가된 필터 제거

  const hint = document.getElementById('blur-hint');
  if (hint) hint.classList.remove('hidden');
}

// =============================================================================
// ⑧ 패널 강조
// =============================================================================

/**
 * 매칭된 경승지(spotIndex)의 패널에 강조 효과를 적용한다.
 *
 * emotion-engine 인덱스(0~11)를 받아 SVG spot-XX로 변환한 뒤
 * 해당 패널 그룹에 HIGHLIGHT_CLASS를 추가한다.
 * animations.css의 pulse-ring 애니메이션이 적용되어
 * 테두리가 깜빡이며 강조된다.
 *
 * 이전에 강조된 패널이 있으면 먼저 해제한다 (단일 강조 유지).
 *
 * 패널 그룹 요소를 찾는 순서:
 *   1. #panel-spot-XX
 *   2. id에 "spot-XX"를 포함하는 <g> 요소
 *
 * @param {number} spotIndex  emotion-engine 인덱스 (0~11)
 *
 * @example
 * highlightPanel(0); // 간절곶 일출(spot-04) 패널에 강조 효과 적용
 */
export function highlightPanel(spotIndex) {
  const container = _container();
  if (!container || typeof spotIndex !== 'number') return;

  _clearHighlight(container);

  const svgSpot = _pad(_toSvgSpot(spotIndex));
  const panelEl = _findPanelElement(container, svgSpot);

  if (panelEl) {
    panelEl.classList.add(SVG_CONFIG.HIGHLIGHT_CLASS);
    _lastHighlightedSvgSpot = svgSpot;
  }
}

/**
 * 현재 강조된 패널의 효과를 제거한다.
 * @param {HTMLElement} container
 */
function _clearHighlight(container) {
  if (_lastHighlightedSvgSpot === null) {
    // 혹시 클래스가 남아있는 모든 요소를 일괄 정리 (안전망)
    container.querySelectorAll(`.${SVG_CONFIG.HIGHLIGHT_CLASS}`)
      .forEach((el) => el.classList.remove(SVG_CONFIG.HIGHLIGHT_CLASS));
    return;
  }

  const prevEl = _findPanelElement(container, _lastHighlightedSvgSpot);
  if (prevEl) prevEl.classList.remove(SVG_CONFIG.HIGHLIGHT_CLASS);

  _lastHighlightedSvgSpot = null;
}

/**
 * spot-XX 번호로 패널 그룹 요소를 찾는다.
 *
 * @param {HTMLElement} container
 * @param {string} svgSpot  '00' ~ '11'
 * @returns {Element|null}
 */
function _findPanelElement(container, svgSpot) {
  // 1순위: id="panel-spot-XX"
  const byId = container.querySelector(`#${SVG_CONFIG.PANEL_PREFIX}spot-${svgSpot}`);
  if (byId) return byId;

  // 2순위: id에 "spot-XX"를 포함하는 그룹(<g>) 요소
  const candidates = container.querySelectorAll(`g[id*="spot-${svgSpot}"]`);
  if (candidates.length > 0) return candidates[0];

  return null;
}

// =============================================================================
// ⑨ 디버그 유틸리티
// =============================================================================

/**
 * SVG 내 그라디언트 stop 적용 현황을 콘솔에 출력한다. (개발 전용)
 * 12경 전체에 대해 grad-spot-XX-{main,sub,acc} 존재 여부를 점검한다.
 *
 * @example
 * debugCheckSvgIds();
 */
export function debugCheckSvgIds() {
  /* eslint-disable no-console */
  const container = _container();
  if (!container) {
    console.warn('[svg-renderer] #svg-container 없음');
    return;
  }

  console.group('🔍 svg-renderer — SVG ID 점검');

  for (let emotionIdx = 0; emotionIdx <= 11; emotionIdx++) {
    const svgSpot = _pad(_toSvgSpot(emotionIdx));
    const spotName = SPOTS[emotionIdx]?.name ?? `emotion#${emotionIdx}`;

    const stops = ['main', 'sub', 'acc'].map((key) => {
      const id = `grad-spot-${svgSpot}-${key}`;
      const found = !!container.querySelector(`#${id}`);
      return `${key}:${found ? '✅' : '❌'}`;
    });

    const panelEl = _findPanelElement(container, svgSpot);

    console.log(
      `emotion[${emotionIdx}] ${spotName.padEnd(16)} → spot-${svgSpot}`,
      stops.join(' '),
      `panel:${panelEl ? '✅' : '❌'}`,
    );
  }

  console.groupEnd();
  /* eslint-enable no-console */
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  loadSVG,
  applyColorsToSVG,
  revealSVG,
  resetSVG,
  highlightPanel,
  debugCheckSvgIds,
  EMOTION_TO_SVG_SPOT,
};
