/**
 * @fileoverview 울산 E-Card SVG 색채 조정 엔진 — 서버사이드 SVG 패치 모듈
 * @module svg-engine/svg-patcher
 * @version 2.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * v2 변경 사항
 * ─────────────────────────────────────────────────────────────────
 *
 *   v1: grad-spot-XX-{main,sub,acc} 고정 3개 id를 찾아 stop-color만 변경
 *       + color-calculator.BASE_PALETTES 상수 기준으로 색상 계산
 *
 *   v2:
 *     ① id 형식: 'spot-{XX}-{N}'  (XX: 00~11, N: 1,2,3... 가변)
 *        - main/sub/acc 같은 역할 구분 없음
 *        - 패널(XX)당 색상 요소 개수는 SVG에서 자동 탐색
 *          (querySelectorAll('[id^="spot-XX-"]'))
 *     ② 대상 요소가 <stop>이면 stop-color, 그 외(path/circle/rect 등)면
 *        fill 속성을 읽고 쓴다
 *     ③ "SVG 현재 색상 기준" (케이스 B):
 *        - 매 요청마다 assets/stained-glass.svg *원본*을 새로 읽음
 *        - 그 안에 기록된 현재 fill/stop-color 값을 출발점(HSL)으로 사용
 *        - 원본 파일은 절대 덮어쓰지 않음 → 결과 결정론적, 누적 변경 없음
 *
 * ─────────────────────────────────────────────────────────────────
 * 파이프라인 내 위치
 * ─────────────────────────────────────────────────────────────────
 *
 *   POST /api/card { emotionScores, diversitySeed, reply? }
 *         │
 *         ▼
 *   patchSVG(emotionScores, diversitySeed)   ← 이 모듈
 *     ├─ assets/stained-glass.svg 읽기 (원본, 항상 캐시/디스크에서)
 *     ├─ jsdom으로 DOM 파싱 (요청마다 새 인스턴스)
 *     ├─ color-calculator.computeGlobalParams() 호출
 *     ├─ 패널(spot-00~11)별 'spot-{XX}-{N}' 요소를 모두 탐색
 *     ├─ 각 요소의 현재 fill/stop-color → applyDeltaToHex() → 재적용
 *     └─ dom.serialize() → 패치된 SVG 문자열 반환
 *         │
 *         ▼
 *   svgToPng(patchedSvg, outputPath, size, reply)   ← png-exporter.js
 *         │
 *         ▼
 *   /output/{uuid}.png
 *
 * ─────────────────────────────────────────────────────────────────
 * SVG ID 체계 (spot-XX-N, 경승지별_ID_및_채색방법.txt 기준 XX)
 * ─────────────────────────────────────────────────────────────────
 *
 *   - XX: '00' ~ '11' (경승지별_ID_및_채색방법.txt 매핑 기준 SVG spot 번호)
 *   - N : 1, 2, 3 ... (패널당 색상 요소 개수, 가변, 0개 이상)
 *   - 예) spot-04-1, spot-04-2, spot-04-3 (간절곶 일출, 요소 3개)
 *
 *   color-calculator.SVG_ID_MAP[emotionIdx] 가 emotion-engine 인덱스(0~11)를
 *   SVG spot-XX 문자열('spot-04' 등)로 변환한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * jsdom 사용 이유
 * ─────────────────────────────────────────────────────────────────
 *
 *   sharp는 SVG 문자열을 입력받아 PNG로 래스터라이즈할 수 있지만
 *   SVG 내부 요소(stop-color/fill 속성)를 직접 조작하는 기능은 없다.
 *   jsdom으로 DOM을 파싱 → querySelectorAll + getAttribute/setAttribute →
 *   dom.serialize()로 다시 문자열화하는 흐름이 필요하다.
 *
 *   클라이언트(svg-renderer.js)는 이미 브라우저 DOM이므로
 *   동일한 querySelectorAll + getAttribute/setAttribute 패턴을 사용하며
 *   결과적으로 서버·클라이언트의 색상 패치 로직이 대칭을 이룬다.
 */

'use strict';

import { readFile }              from 'fs/promises';
import { JSDOM }                 from 'jsdom';
import {
  computeGlobalParams,
  applyDeltaToHex,
  SVG_ID_MAP,
  SPOT_NAMES,
} from './color-calculator.js';

// =============================================================================
// ① 설정 상수
// =============================================================================

/**
 * 원본 스테인드글라스 SVG 파일 경로.
 * 프로젝트 루트 기준 상대 경로 (server/index.js 실행 위치 기준).
 */
const SVG_SOURCE_PATH = './assets/stained-glass.svg';

/**
 * 색상 속성을 읽고 쓸 때 사용하는 태그별 속성명.
 * <stop> 요소는 stop-color, 그 외(path/circle/rect/ellipse/polygon 등)는 fill.
 */
const COLOR_ATTR_BY_TAG = {
  stop: 'stop-color',
};
const DEFAULT_COLOR_ATTR = 'fill';

/** hex 색상 형식 검증 ('#RRGGBB' 또는 '#RGB') */
const HEX_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

// =============================================================================
// ② SVG 원본 캐시
// =============================================================================

/**
 * 원본 SVG 파일 텍스트 캐시.
 * 동일 파일을 매 요청마다 디스크에서 읽지 않도록 메모리에 보관한다.
 * 패치는 항상 이 원본 텍스트의 복사본(JSDOM 새 인스턴스)에 적용되므로
 * 캐시를 공유해도 요청 간 색상이 섞이지 않는다.
 *
 * 케이스 B(SVG 현재 색상 기준)의 핵심: 이 캐시는 *원본* 텍스트이며
 * 패치 결과로 갱신되지 않는다. 따라서 "현재 색상"은 항상 원본의
 * 고정값을 가리키고, 결과는 결정론적이며 누적 변경이 없다.
 *
 * @type {string|null}
 */
let _svgSourceCache = null;

/**
 * 원본 SVG 텍스트를 읽어 반환한다. 최초 호출 시에만 디스크 I/O 발생.
 *
 * @returns {Promise<string>}
 * @throws {Error} 파일 읽기 실패 시
 */
async function _loadSvgSource() {
  if (_svgSourceCache) return _svgSourceCache;

  try {
    _svgSourceCache = await readFile(SVG_SOURCE_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `[svg-patcher] SVG 원본 로드 실패 (${SVG_SOURCE_PATH}): ${err.message}`,
    );
  }

  return _svgSourceCache;
}

/**
 * SVG 원본 캐시를 초기화한다.
 * 원본 SVG 파일이 배포 중 교체된 경우(예: 디자인 업데이트) 사용.
 */
export function clearSvgCache() {
  _svgSourceCache = null;
}

// =============================================================================
// ③ 색상 속성 읽기/쓰기 헬퍼
// =============================================================================

/**
 * 요소의 태그 종류에 따라 색상이 저장된 속성명을 반환한다.
 * <stop> → 'stop-color', 그 외 → 'fill'
 *
 * @param {Element} el
 * @returns {string}
 */
function _colorAttrName(el) {
  const tag = el.tagName.toLowerCase();
  return COLOR_ATTR_BY_TAG[tag] ?? DEFAULT_COLOR_ATTR;
}

/**
 * 요소의 현재 색상값을 읽는다.
 *
 * 1) fill/stop-color가 직접 hex('#RRGGBB') → 즉시 반환
 * 2) style 인라인에서 fill/stop-color hex 추출
 * 3) fill="url(#gradientId)" → gradient의 첫 번째 <stop> stop-color를 읽음
 *    (Inkscape가 생성하는 그라디언트 참조 패턴 지원)
 *
 * @param {Element}  el       색상을 읽을 요소
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

  // ── 케이스 2: style 인라인에서 fill/stop-color hex 추출 ────────
  const styleVal = el.getAttribute('style') ?? '';
  const styleHex = styleVal.match(/(?:fill|stop-color)\s*:\s*(#[0-9a-fA-F]{3,6})/)?.[1];
  if (styleHex && HEX_RE.test(styleHex)) {
    let hex = styleHex;
    if (hex.length === 4) {
      hex = '#' + [...hex.slice(1)].map((c) => c + c).join('');
    }
    return { attr: 'style', hex, isGradient: false, gradientId: null };
  }

  // ── 케이스 3: url(#gradientId) → gradient <stop> 추적 ─────────
  const urlMatch = val.match(/^url\(#([^)]+)\)$/)
    ?? styleVal.match(/(?:fill|stop-color)\s*:\s*url\(#([^)]+)\)/);

  if (urlMatch && ownerDoc) {
    const gradientId = urlMatch[1];
    const gradEl = ownerDoc.getElementById(gradientId);
    if (gradEl) {
      const firstStop = gradEl.querySelector('stop');
      if (firstStop) {
        const scVal = (firstStop.getAttribute('stop-color') ?? '').trim();
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
 * - isGradient=true : gradient의 모든 <stop>에 stop-color 일괄 적용
 *   (첫 stop은 newHex, 이후 stop은 명도를 약간 낮춰 자연스러운 그라디언트 유지)
 * - isGradient=false: fill 또는 stop-color 속성에 직접 적용
 */
function _applyColor(el, newHex, colorInfo, doc) {
  if (colorInfo.isGradient && colorInfo.gradientId && doc) {
    const gradEl = doc.getElementById(colorInfo.gradientId);
    if (gradEl) {
      const stops = gradEl.querySelectorAll('stop');
      stops.forEach((stop, i) => {
        if (i === 0) {
          stop.setAttribute('stop-color', newHex);
        } else {
          stop.setAttribute('stop-color', _darken(newHex, i * 0.12));
        }
      });
      return;
    }
  }
  el.setAttribute(colorInfo.attr, newHex);
}

/**
 * hex 색상을 ratio만큼 어둡게 한다.
 * @param {string} hex
 * @param {number} ratio  0~1
 * @returns {string}
 */
function _darken(hex, ratio) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const d = (v) => Math.max(0, Math.round(v * (1 - ratio)));
  return '#' + [d(r), d(g), d(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// =============================================================================
// ④ 메인 패치 함수 (퍼블릭 API)
// =============================================================================

/**
 * 감성 점수와 다양성 시드를 받아 SVG의 'spot-{XX}-{N}' 요소들을 패치하고
 * 직렬화된 SVG 문자열을 반환한다.
 *
 * [처리 흐름]
 *   1. assets/stained-glass.svg 원본 텍스트 로드 (캐시됨, 항상 원본)
 *   2. jsdom으로 새 DOM 인스턴스 생성 (요청마다 독립)
 *   3. color-calculator.computeGlobalParams() 로 글로벌 파라미터 계산
 *   4. emotion-engine 인덱스(0~11) 순회:
 *        svgSpot = SVG_ID_MAP[i]  (예: 'spot-04')
 *        [id^="spot-04-"] 패턴으로 해당 패널의 모든 색상 요소를 탐색
 *        각 요소의 현재 fill/stop-color → applyDeltaToHex() → 재적용
 *   5. dom.serialize() 로 패치된 SVG 문자열 반환
 *
 * 패널에 해당 id 요소가 하나도 없으면 조용히 건너뛴다 — SVG 자산이
 * 아직 'spot-XX-N' id로 보완되지 않은 상태에서도 파이프라인이
 * 중단되지 않는다. 누락 발생 시 console.warn으로 로그를 남긴다.
 *
 * @param {Object} emotionScores
 *   { amazement:0~100, peace:0~100, vitality:0~100, nostalgia:0~100,
 *     freshness:0~100, grandeur:0~100, warmth:0~100, mystery:0~100 }
 * @param {number} diversitySeed  preprocessor.js 의 다양성 시드
 * @returns {Promise<string>}  패치된 SVG 문자열 (XML 선언 포함)
 *
 * @throws {Error}  SVG 원본 로드 실패 / jsdom 파싱 실패
 *
 * @example
 * const svg = await patchSVG(
 *   { amazement:80, peace:30, vitality:70, nostalgia:20,
 *     freshness:60, grandeur:75, warmth:85, mystery:25 },
 *   142857,
 * );
 *
 * // png-exporter.js 에 전달
 * await svgToPng(svg, './output/card.png', 1200, reply);
 */
export async function patchSVG(emotionScores, diversitySeed) {
  const t0 = Date.now();

  // ── STEP 1: 원본 SVG 로드 (항상 원본 — 케이스 B) ────────────────
  const rawSvg = await _loadSvgSource();

  // ── STEP 2: jsdom DOM 파싱 (요청마다 독립 인스턴스) ─────────────
  const dom = new JSDOM(rawSvg, { contentType: 'image/svg+xml' });
  const doc = dom.window.document;

  // ── STEP 3: 글로벌 색채 파라미터 계산 ─────────────────────────────
  const gp = computeGlobalParams(emotionScores ?? {});

  // ── STEP 4: 패널별 'spot-{XX}-{N}' 요소 탐색 및 패치 ────────────────
  const emptyPanels = [];
  let totalElements = 0;
  let totalSkipped  = 0;

  for (let emotionIdx = 0; emotionIdx <= 11; emotionIdx++) {
    const svgSpot = SVG_ID_MAP[emotionIdx]; // 예: 'spot-04'

    // [id^="spot-04-"] 패턴으로 패널 내 모든 색상 요소를 자동 탐색 (가변 개수)
    const elements = doc.querySelectorAll(`[id^="${svgSpot}-"]`);

    if (elements.length === 0) {
      emptyPanels.push(svgSpot);
      continue;
    }

    elements.forEach((el) => {
      // doc 전달 → url(#gradientId) 참조 자동 추적
      const current = _readColor(el, doc);
      if (!current) {
        totalSkipped++;
        return;
      }

      const newHex = applyDeltaToHex(current.hex, emotionIdx, gp, diversitySeed);
      // _applyColor 사용 → 그라디언트이면 모든 <stop> stop-color 일괄 변경
      _applyColor(el, newHex, current, doc);
      totalElements++;
    });
  }

  if (emptyPanels.length > 0) {
    console.warn(
      `[svg-patcher] 색상 요소가 없는 패널 ${emptyPanels.length}개:`,
      emptyPanels.join(', '),
    );
  }

  // ── STEP 5: 직렬화 ─────────────────────────────────────────────────
  const patched = dom.serialize();

  console.info(
    `[svg-patcher] SVG 패치 완료 | ` +
    `패치 요소 ${totalElements}개 | ` +
    `건너뜀 ${totalSkipped}개 | ` +
    `빈 패널 ${emptyPanels.length}개 | ` +
    `${Date.now() - t0}ms`,
  );

  return patched;
}

// =============================================================================
// ⑤ 디버그 유틸리티
// =============================================================================

/**
 * 원본 SVG에 12경 각 패널(spot-00 ~ spot-11)의 'spot-XX-N' 색상 요소가
 * 몇 개씩 존재하는지 점검한다. 배포 전 SVG 자산 검증용.
 *
 * @returns {Promise<{
 *   valid: boolean,
 *   total: number,
 *   panels: Array<{ svgId:string, name:string, count:number, ids:string[] }>,
 *   emptyPanels: string[],
 * }>}
 *
 * @example
 * const { valid, panels, emptyPanels } = await validateSvgAssets();
 * if (!valid) console.warn('색상 요소가 없는 패널:', emptyPanels);
 */
export async function validateSvgAssets() {
  const rawSvg = await _loadSvgSource();
  const dom    = new JSDOM(rawSvg, { contentType: 'image/svg+xml' });
  const doc    = dom.window.document;

  const panels = [];
  const emptyPanels = [];
  let total = 0;

  for (let emotionIdx = 0; emotionIdx <= 11; emotionIdx++) {
    const svgSpot = SVG_ID_MAP[emotionIdx];
    const elements = doc.querySelectorAll(`[id^="${svgSpot}-"]`);
    const ids = Array.from(elements).map((el) => el.id);

    if (ids.length === 0) emptyPanels.push(svgSpot);
    total += ids.length;

    panels.push({
      svgId: svgSpot,
      name:  SPOT_NAMES[emotionIdx],
      count: ids.length,
      ids,
    });
  }

  return { valid: emptyPanels.length === 0, total, panels, emptyPanels };
}

/**
 * patchSVG() 결과를 콘솔에 출력한다. (개발 전용)
 *
 * @param {Object} emotionScores
 * @param {number} diversitySeed
 *
 * @example
 * await debugPrintPatch(emotionScores, 142857);
 */
export async function debugPrintPatch(emotionScores, diversitySeed) {
  /* eslint-disable no-console */
  const { valid, total, panels, emptyPanels } = await validateSvgAssets();

  console.group('🩹 svg-patcher — spot-XX-N 자산 현황');
  console.log(
    ' E-idx │ SVG ID  │ 경승지                   │ 요소 개수 │ ids',
  );
  console.log(
    '───────┼─────────┼──────────────────────────┼──────────┼──────────',
  );

  panels.forEach((p, i) => {
    const name = p.name.padEnd(24);
    console.log(
      `  ${String(i).padStart(2)}   │ ${p.svgId} │ ${name} │ ` +
      `${String(p.count).padStart(8)} │ ${p.ids.join(', ') || '(없음)'}`,
    );
  });

  console.log('');
  console.log(`총 색상 요소: ${total}개`,
    valid ? '✅ 모든 패널에 1개 이상 존재' : `⚠️  빈 패널: ${emptyPanels.join(', ')}`);
  console.groupEnd();
  /* eslint-enable no-console */
}

// =============================================================================
// Default Export
// =============================================================================

export default {
  patchSVG,
  clearSvgCache,
  validateSvgAssets,
  debugPrintPatch,
};
