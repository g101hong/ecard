/**
 * @fileoverview 울산 E-Card — SVG 인라인 렌더링 · 색채 패치 · 블러 제어
 * @module public/js/svg-renderer
 * @version 2.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * v2 변경 사항
 * ─────────────────────────────────────────────────────────────────
 *
 *   v1: 서버가 계산한 panelColors[12] (각 main/sub/acc hex)를
 *       grad-spot-XX-{main,sub,acc} 3개 고정 stop에 그대로 적용
 *
 *   v2:
 *     ① id 형식: 'spot-{XX}-{N}' (XX:00~11, N:1,2,3... 가변)
 *        - main/sub/acc 역할 구분 없음
 *        - 패널(XX)당 색상 요소 개수는 SVG에서 자동 탐색
 *          (querySelectorAll(`[id^="spot-XX-"]`))
 *     ② 대상 요소가 <stop>이면 stop-color, 그 외(path/circle 등)면
 *        fill 속성을 읽고 쓴다
 *     ③ "SVG 현재 색상 기준" (케이스 B):
 *        - loadSVG() 시점에 삽입된 *원본* SVG 텍스트를 _originalSvgText에
 *          별도 보관
 *        - applyDeltaColorsToSVG() 호출 시 항상 원본 텍스트를 기준으로
 *          현재 색을 읽고 delta를 적용 → 결정론적, 누적 변경 없음
 *        - resetSVG()는 이 원본 텍스트로 컨테이너를 다시 채워 완전히
 *          복원한다
 *
 *   서버 svg-engine/svg-patcher.js 와 동일한 ID 체계·동일 수식
 *   (color-engine.js)을 사용하므로 브라우저에서 보이는 색상과
 *   PNG 저장 결과가 동일하게 재현된다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [SVG ID 체계 — 경승지별_ID_및_채색방법.txt 기준]
 *
 *   각 경승지는 "spot-00" ~ "spot-11" 접두어를 가지며,
 *   색상 조정 대상 요소는 'spot-{XX}-{N}' (N=1,2,3... 가변) 형식의
 *   id를 가진다. 요소가 <stop>이면 stop-color, 그 외 도형이면
 *   fill 속성이 변경 대상이다.
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
 *   패널 그룹 ID 패턴 (강조 효과용, 색상 변경과 무관):
 *     panel-spot-XX  (또는 id에 "spot-XX"가 포함된 <g> 요소)
 *
 * ─────────────────────────────────────────────────────────────────
 * [emotion-engine 인덱스 ↔ SVG spot-XX 매핑]
 *
 *   /api/impression 이 반환하는 emotionScores, diversitySeed를 받아
 *   이 모듈이 직접 SVG의 spot-XX-N 요소에 색채를 계산·적용한다.
 *   color-engine.js의 SVG_ID_MAP이 emotion-engine 인덱스(0~11)를
 *   SVG spot-XX 문자열로 변환한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [공개 API]
 *
 *   loadSVG()                              SVG fetch + 인라인 삽입 (블러 상태로 시작)
 *   applyDeltaColorsToSVG(scores, seed)    원본 SVG 현재 색 기준 delta 적용
 *   revealSVG()                            블러 해제 (CSS transition)
 *   resetSVG()                             원본 SVG로 완전 복원 + 블러 재적용
 *   highlightPanel(spotIndex)              매칭 경승지 패널에 강조 효과 적용
 */

'use strict';

import {
  computeGlobalParams,
  applyDeltaToHex,
  SVG_ID_MAP,
  SPOT_NAMES,
} from './color-engine.js';

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

/** hex 색상 형식 검증 ('#RRGGBB' 또는 '#RGB') */
const HEX_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/**
 * 색상 속성을 읽고 쓸 때 사용하는 태그별 속성명.
 * <stop> 요소는 stop-color, 그 외(path/circle/rect/ellipse/polygon 등)는 fill.
 */
const COLOR_ATTR_BY_TAG = {
  stop: 'stop-color',
};
const DEFAULT_COLOR_ATTR = 'fill';

// =============================================================================
// ② 내부 상태
// =============================================================================

/** 마지막으로 강조된 SVG spot-XX 번호 (resetSVG에서 해제용) */
let _lastHighlightedSvgSpot = null;

/** SVG 원본 fetch 캐시 (네트워크 재요청 방지) */
let _svgFetchCache = null;

/**
 * loadSVG() 시점에 #svg-container에 삽입된 *원본* SVG 텍스트.
 *
 * 케이스 B(SVG 현재 색상 기준)의 핵심: applyDeltaColorsToSVG()는
 * 매번 이 원본 텍스트를 기준으로 "현재 색"을 읽어 delta를 계산한다.
 * 컨테이너에 실제로 표시 중인 SVG(이미 패치되어 있을 수 있음)를
 * 기준으로 삼지 않는다 — 그렇게 하면 누적 변경이 발생한다.
 *
 * @type {string|null}
 */
let _originalSvgText = null;

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
 * 요소 자체 또는 내부에서 실제 색상을 보유한 요소 목록을 반환한다.
 *
 * Inkscape에서 하이퍼링크(<a>) 또는 그룹(<g>)에 spot ID를 부여하면
 * 색상은 내부 <path>/<rect> 등이 가지므로, 그 경우 내부 요소를 탐색한다.
 *
 * @param {Element} el  spot-XX-N ID를 가진 요소
 * @returns {Element[]}  색상 속성을 가질 가능성 있는 요소 배열
 */
const COLOR_ELEMENTS = new Set(['path','rect','circle','ellipse','polygon','polyline','stop','use']);

function _resolveColorElements(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a' || tag === 'g') {
    const children = Array.from(el.querySelectorAll(
      'path, rect, circle, ellipse, polygon, polyline, stop'
    ));
    return children.length > 0 ? children : [];
  }
  if (COLOR_ELEMENTS.has(tag)) return [el];
  return [];
}

function _colorAttrName(el) {
  const tag = el.tagName.toLowerCase();
  return COLOR_ATTR_BY_TAG[tag] ?? DEFAULT_COLOR_ATTR;
}

/**
 * 요소의 현재 색상값을 읽는다.
 *
 * 1) fill/stop-color가 직접 hex('#RRGGBB') → 즉시 반환
 * 2) fill="url(#gradientId)" → SVG DOM에서 해당 gradient의
 *    첫 번째 <stop>의 stop-color를 읽어 반환
 *    (Inkscape가 생성하는 그라디언트 참조 패턴 지원)
 *
 * @param {Element} el        색상을 읽을 요소
 * @param {Document} ownerDoc 요소가 속한 SVG Document (gradient 탐색용)
 * @returns {{ attr:string, hex:string, isGradient:boolean,
 *             gradientId:string|null }|null}
 */
function _readColor(el, ownerDoc) {
  const attr = _colorAttrName(el);
  const val  = (el.getAttribute(attr) ?? '').trim();

  // ── 케이스 1: 직접 hex ────────────────────────────────────────
  if (HEX_RE.test(val)) {
    let hex = val;
    if (hex.length === 4) {
      hex = '#' + [...hex.slice(1)].map((c) => c + c).join('');
    }
    return { attr, hex, isGradient: false, gradientId: null };
  }

  // ── 케이스 2: style 인라인에서 fill 추출 ──────────────────────
  const styleVal = el.getAttribute('style') ?? '';
  const styleHex = styleVal.match(/(?:fill|stop-color)\s*:\s*(#[0-9a-fA-F]{3,6})/)?.[1];
  if (styleHex && HEX_RE.test(styleHex)) {
    let hex = styleHex;
    if (hex.length === 4) {
      hex = '#' + [...hex.slice(1)].map((c) => c + c).join('');
    }
    return { attr: 'style', hex, isGradient: false, gradientId: null };
  }

  // ── 케이스 3: url(#gradientId) → gradient <stop> 추적 ────────
  const urlMatch = val.match(/^url\(#([^)]+)\)$/)
    ?? styleVal.match(/(?:fill|stop-color)\s*:\s*url\(#([^)]+)\)/);

  if (urlMatch && ownerDoc) {
    const gradientId = urlMatch[1];
    const gradEl = ownerDoc.getElementById(gradientId);
    if (gradEl) {
      const firstStop = gradEl.querySelector('stop');
      if (firstStop) {
        const scVal = (firstStop.getAttribute('stop-color')
          ?? firstStop.style?.stopColor
          ?? '').trim();
        if (HEX_RE.test(scVal)) {
          let hex = scVal;
          if (hex.length === 4) {
            hex = '#' + [...hex.slice(1)].map((c) => c + c).join('');
          }
          return { attr, hex, isGradient: true, gradientId };
        }
      }
    }
  }

  return null;
}

/**
 * 요소에 새 색상을 적용한다.
 *
 * - isGradient=true  : 해당 gradient의 모든 <stop>에 stop-color를 일괄 적용
 *   (첫 stop은 newHex 그대로, 나머지 stop은 명도를 약간 낮춰 자연스러운 그라디언트 유지)
 * - isGradient=false : fill 또는 stop-color 속성에 직접 적용
 *
 * @param {Element}  liveEl   실제 화면의 요소
 * @param {string}   newHex   적용할 새 hex 색상
 * @param {Object}   colorInfo  _readColor() 반환값
 * @param {Document} liveDoc  화면 DOM Document (gradient 탐색용)
 */
function _applyColor(liveEl, newHex, colorInfo, liveDoc) {
  if (colorInfo.isGradient && colorInfo.gradientId && liveDoc) {
    const gradEl = liveDoc.getElementById(colorInfo.gradientId);
    if (gradEl) {
      const stops = gradEl.querySelectorAll('stop');
      stops.forEach((stop, i) => {
        if (i === 0) {
          stop.setAttribute('stop-color', newHex);
        } else {
          // 2번째 이후 stop: 첫 stop보다 명도를 약간 낮춰 그라디언트 느낌 유지
          stop.setAttribute('stop-color', _darken(newHex, i * 0.12));
        }
      });
      return;
    }
  }
  // 직접 hex인 경우
  liveEl.setAttribute(colorInfo.attr, newHex);
}

/**
 * hex 색상을 ratio만큼 어둡게 한다.
 * @param {string} hex
 * @param {number} ratio  0~1 (0.1 = 10% 어둡게)
 * @returns {string}
 */
function _darken(hex, ratio) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const d = (v) => Math.max(0, Math.round(v * (1 - ratio)));
  return `#${d(r).toString(16).padStart(2, '0')}${d(g).toString(16).padStart(2, '0')}${d(b).toString(16).padStart(2, '0')}`;
}

// =============================================================================
// ④ SVG 로드 & 인라인 삽입
// =============================================================================

/**
 * stained-glass.svg 를 fetch로 불러와 #svg-container 에 인라인 삽입한다.
 *
 * 인라인 삽입을 사용하는 이유:
 *   <img src="..."> 로는 내부 색상 속성(stop-color/fill)을
 *   JS에서 직접 변경할 수 없다. SVG를 DOM에 직접 삽입해야
 *   querySelectorAll로 'spot-XX-N' 요소를 조작할 수 있다.
 *
 * 삽입된 SVG 텍스트는 _originalSvgText에 보관되어, 이후
 * applyDeltaColorsToSVG()가 항상 이 "원본 색상"을 기준으로
 * delta를 계산할 수 있게 한다 (케이스 B).
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
  let svgText = _svgFetchCache;

  if (!svgText) {
    const res = await fetch(SVG_CONFIG.SVG_URL);
    if (!res.ok) {
      throw new Error(`[svg-renderer] SVG 로드 실패: HTTP ${res.status}`);
    }
    svgText = await res.text();
    _svgFetchCache = svgText;
  }

  // 케이스 B: 원본 텍스트를 별도 보관 (이후 모든 delta 계산의 기준)
  _originalSvgText = svgText;

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
// ⑤ 색채 패치 (케이스 B — 원본 SVG 현재 색상 기준)
// =============================================================================

/**
 * emotionScores와 diversitySeed를 받아, 원본 SVG(_originalSvgText)에
 * 기록된 "현재 색상"을 기준으로 12경 각 패널의 'spot-XX-N' 요소에
 * 감성 delta를 적용한다.
 *
 * 처리 흐름:
 *   1. _originalSvgText를 파싱하여 임시 DOM(DOMParser) 생성
 *      → 화면에 표시 중인(이미 패치되었을 수 있는) DOM이 아니라
 *        항상 원본에서 "현재 색"을 읽는다 (누적 변경 방지)
 *   2. computeGlobalParams(emotionScores)로 글로벌 파라미터 계산
 *   3. emotion-engine 인덱스(0~11) 순회:
 *      svgSpot = SVG_ID_MAP[i] (예: 'spot-04')
 *      임시 DOM에서 [id^="spot-04-"] 요소들의 현재 색을 읽어
 *      applyDeltaToHex()로 새 hex 계산
 *   4. 계산된 새 hex를 *실제 화면(#svg-container)*의 동일 id 요소에 적용
 *
 * CSS의 `stop, [fill] { transition: ... }` 류 규칙에 의해
 * 색상이 부드럽게 전환되도록 구성할 수 있다 (animations.css 참조).
 *
 * @param {Object} emotionScores  8차원 감성 점수 (0~100)
 * @param {number} [diversitySeed=0]  다양성 시드
 * @returns {{
 *   applied:number, skipped:number, emptyPanels:string[],
 *   panelColors: Array<{ index:number, svgId:string, name:string, color:string|null }>,
 * }}
 *   applied: 색상이 변경된 요소 수
 *   skipped: hex 형식이 아니라 건너뛴 요소 수
 *   emptyPanels: 'spot-XX-N' 요소가 하나도 없는 패널의 svgId 목록
 *   panelColors: 패널별 대표색(해당 패널의 첫 번째 색상 요소의 새 hex) —
 *                팔레트 스트립 등 UI 표시용. 요소가 없으면 color:null
 *
 * @example
 * const result = applyDeltaColorsToSVG(data.emotionScores, data.diversitySeed);
 * // result.applied → 변경된 요소 개수
 * // result.panelColors[0] → { index:0, svgId:'spot-04', name:'간절곶 일출', color:'#FF7A4F' }
 */
export function applyDeltaColorsToSVG(emotionScores, diversitySeed = 0) {
  const container = _container();
  const result = { applied: 0, skipped: 0, emptyPanels: [], panelColors: [] };

  if (!container || !_originalSvgText) return result;

  // ── 원본 SVG를 별도 DOM으로 파싱 (현재 화면 상태와 분리) ─────────
  const parser = new DOMParser();
  const originalDoc = parser.parseFromString(_originalSvgText, 'image/svg+xml');

  const gp = computeGlobalParams(emotionScores ?? {});

  for (let emotionIdx = 0; emotionIdx <= 11; emotionIdx++) {
    const svgSpot = SVG_ID_MAP[emotionIdx]; // 예: 'spot-04'

    // 원본 DOM에서 패널의 모든 색상 요소를 자동 탐색 (가변 개수)
    const originalElements = originalDoc.querySelectorAll(`[id^="${svgSpot}-"]`);

    if (originalElements.length === 0) {
      result.emptyPanels.push(svgSpot);
      result.panelColors.push({
        index: emotionIdx, svgId: svgSpot, name: SPOT_NAMES[emotionIdx], color: null,
      });
      continue;
    }

    let representativeColor = null;

    originalElements.forEach((origEl) => {
      // <a>/<g> 이면 내부 색상 요소를 탐색, 직접 요소이면 자신을 사용
      const colorEls = _resolveColorElements(origEl);
      if (colorEls.length === 0) { result.skipped++; return; }

      colorEls.forEach((colorEl) => {
        // ownerDoc 전달 → url(#gradientId) 참조 자동 추적
        const current = _readColor(colorEl, originalDoc);
        if (!current) { result.skipped++; return; }

        const newHex = applyDeltaToHex(current.hex, emotionIdx, gp, diversitySeed);

        // 화면에 실제 표시 중인 동일 요소 탐색
        // <a>/<g> 자식이므로 id가 없을 수 있어 origEl 기준으로 찾음
        const liveAnchor = container.querySelector(`#${CSS.escape(origEl.id)}`);
        if (!liveAnchor) return;

        // 원본에서의 위치 인덱스로 live DOM의 대응 요소를 찾음
        const siblings = Array.from(origEl.querySelectorAll
          ? origEl.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, stop')
          : [origEl]);
        const idx = siblings.indexOf(colorEl);
        const liveEl = idx >= 0
          ? Array.from(liveAnchor.querySelectorAll(
              'path, rect, circle, ellipse, polygon, polyline, stop'
            ))[idx]
          : liveAnchor;

        if (liveEl) {
          _applyColor(liveEl, newHex, current, container.ownerDocument);
          result.applied++;
        }

        if (representativeColor === null) representativeColor = newHex;
      });
    });

    result.panelColors.push({
      index: emotionIdx, svgId: svgSpot, name: SPOT_NAMES[emotionIdx], color: representativeColor,
    });
  }

  return result;
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
 * applyDeltaColorsToSVG(data.emotionScores, data.diversitySeed);
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
 * SVG를 원본 상태(_originalSvgText)로 완전히 복원하고 블러 상태로 되돌린다.
 *
 * "다시 쓰기" 버튼 클릭 시 호출되어
 * 이전 소감으로 적용된 색채를 지우고 초기 화면으로 복귀한다.
 *
 * v1과 달리 별도의 "기본 팔레트 상수"가 없으므로, 원본 SVG 텍스트를
 * 그대로 다시 삽입하는 방식으로 복원한다 — 이는 _originalSvgText가
 * 곧 "기본 팔레트"의 단일 진실 소스이기 때문이다.
 *
 * 처리 내용:
 *   1. _originalSvgText로 #svg-container.innerHTML 재설정
 *   2. 반응형 속성 재적용 (width/height 100%)
 *   3. 강조(highlight) 효과 해제
 *   4. #svg-container 에 blurred 클래스 재적용
 *   5. #blur-hint 다시 표시
 *
 * @example
 * resetSVG();
 * // → SVG가 원본 색상으로 돌아가고 블러 처리됨
 */
export function resetSVG() {
  const container = _container();
  if (!container || !_originalSvgText) return;

  // ── 원본 텍스트로 완전 복원 ───────────────────────────────────
  container.innerHTML = _originalSvgText;

  const svgEl = container.querySelector('svg');
  if (svgEl) {
    svgEl.setAttribute('width', '100%');
    svgEl.setAttribute('height', '100%');
    svgEl.removeAttribute('style');
  }

  // ── 강조 효과 해제 ────────────────────────────────────────────
  _lastHighlightedSvgSpot = null;
  container.querySelectorAll(`.${SVG_CONFIG.HIGHLIGHT_CLASS}`)
    .forEach((el) => el.classList.remove(SVG_CONFIG.HIGHLIGHT_CLASS));

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

  const svgSpot = SVG_ID_MAP[spotIndex];
  if (!svgSpot) return;

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
    container.querySelectorAll(`.${SVG_CONFIG.HIGHLIGHT_CLASS}`)
      .forEach((el) => el.classList.remove(SVG_CONFIG.HIGHLIGHT_CLASS));
    return;
  }

  const prevEl = _findPanelElement(container, _lastHighlightedSvgSpot);
  if (prevEl) prevEl.classList.remove(SVG_CONFIG.HIGHLIGHT_CLASS);

  _lastHighlightedSvgSpot = null;
}

/**
 * svgSpot('spot-XX')으로 패널 그룹 요소를 찾는다.
 *
 * @param {HTMLElement} container
 * @param {string} svgSpot  'spot-00' ~ 'spot-11'
 * @returns {Element|null}
 */
function _findPanelElement(container, svgSpot) {
  // 1순위: id="panel-spot-XX"
  const byId = container.querySelector(`#${SVG_CONFIG.PANEL_PREFIX}${svgSpot}`);
  if (byId) return byId;

  // 2순위: id에 "spot-XX"를 포함하는 그룹(<g>) 요소
  const candidates = container.querySelectorAll(`g[id*="${svgSpot}"]`);
  if (candidates.length > 0) return candidates[0];

  return null;
}

// =============================================================================
// ⑨ 디버그 유틸리티
// =============================================================================

/**
 * SVG 내 'spot-XX-N' 색상 요소 적용 현황을 콘솔에 출력한다. (개발 전용)
 * 12경 전체에 대해 spot-XX 접두어 요소 존재 여부 및 개수를 점검한다.
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
    const svgSpot = SVG_ID_MAP[emotionIdx];
    const spotName = SPOT_NAMES[emotionIdx] ?? `emotion#${emotionIdx}`;

    const elements = container.querySelectorAll(`[id^="${svgSpot}-"]`);
    const panelEl  = _findPanelElement(container, svgSpot);

    console.log(
      `emotion[${emotionIdx}] ${spotName.padEnd(16)} → ${svgSpot}-N`,
      `요소:${elements.length}개`,
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
  applyDeltaColorsToSVG,
  revealSVG,
  resetSVG,
  highlightPanel,
  debugCheckSvgIds,
  SVG_ID_MAP,
};
