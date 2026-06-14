/**
 * @fileoverview 울산 E-Card SVG 색채 조정 엔진 — 서버사이드 SVG 패치 모듈
 * @module svg-engine/svg-patcher
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   assets/stained-glass.svg 원본 파일을 jsdom으로 읽어
 *   color-calculator.js가 계산한 12패널 색상(main/sub/acc)을
 *   각 그라디언트 <stop> 요소의 stop-color 속성에 직접 패치한다.
 *
 *   이 모듈은 PNG 저장(POST /api/card) 경로에서만 사용된다.
 *   브라우저 미리보기는 public/js/svg-renderer.js가
 *   동일한 색상 데이터로 동일한 ID에 직접 DOM 조작하므로
 *   서버 출력(PNG)과 클라이언트 화면이 100% 일치한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * 파이프라인 내 위치
 * ─────────────────────────────────────────────────────────────────
 *
 *   POST /api/card { emotionScores, diversitySeed, reply? }
 *         │
 *         ▼
 *   patchSVG(emotionScores, diversitySeed)   ← 이 모듈
 *     ├─ assets/stained-glass.svg 읽기 (fs/promises)
 *     ├─ jsdom으로 DOM 파싱
 *     ├─ color-calculator.calculateAllPanelColors() 호출
 *     ├─ 12개 패널 × 3개 stop(main/sub/acc) → stop-color 패치
 *     └─ dom.serialize() → 패치된 SVG 문자열 반환
 *         │
 *         ▼
 *   svgToPng(patchedSvg, outputPath, size, reply)   ← png-exporter.js
 *         │
 *         ▼
 *   /output/{uuid}.png
 *
 * ─────────────────────────────────────────────────────────────────
 * SVG ID 체계 (경승지별_ID_및_채색방법.txt 기준)
 * ─────────────────────────────────────────────────────────────────
 *
 *   color-calculator.calculateAllPanelColors() 반환 배열은
 *   emotion-engine 인덱스(0~11) 순서이며, 각 항목에 svgId가 포함된다:
 *
 *     colors[0]  → { index:0, svgId:'spot-04', name:'간절곶 일출', main, sub, acc }
 *     colors[9]  → { index:9, svgId:'spot-00', name:'태화강 ...',  main, sub, acc }
 *
 *   emotion-engine 인덱스와 SVG spot 번호의 순서가 다르므로
 *   반드시 colors[i].svgId 를 사용해 그라디언트 ID를 조회해야 한다.
 *   (colors[i] 의 i 를 그대로 spot-XX 번호로 쓰면 매핑이 틀어진다)
 *
 *   그라디언트 stop ID 패턴:
 *     grad-{svgId}-main  예) grad-spot-04-main
 *     grad-{svgId}-sub   예) grad-spot-04-sub
 *     grad-{svgId}-acc   예) grad-spot-04-acc
 *
 * ─────────────────────────────────────────────────────────────────
 * jsdom 사용 이유
 * ─────────────────────────────────────────────────────────────────
 *
 *   sharp는 SVG 문자열을 입력받아 PNG로 래스터라이즈할 수 있지만
 *   SVG 내부 요소(<stop> 속성)를 직접 조작하는 기능은 없다.
 *   jsdom으로 DOM을 파싱 → getElementById로 속성 변경 →
 *   dom.serialize()로 다시 문자열화하는 흐름이 필요하다.
 *
 *   클라이언트(svg-renderer.js)는 이미 브라우저 DOM이므로
 *   동일한 getElementById + setAttribute 패턴을 그대로 사용하며
 *   결과적으로 서버·클라이언트의 색상 패치 로직이 대칭을 이룬다.
 */

'use strict';

import { readFile }                from 'fs/promises';
import { JSDOM }                   from 'jsdom';
import { calculateAllPanelColors } from './color-calculator.js';

// =============================================================================
// ① 설정 상수
// =============================================================================

/**
 * 원본 스테인드글라스 SVG 파일 경로.
 * 프로젝트 루트 기준 상대 경로 (server/index.js 실행 위치 기준).
 */
const SVG_SOURCE_PATH = './assets/stained-glass.svg';

/** stop-color를 패치할 색상 역할 3종 */
const COLOR_ROLES = ['main', 'sub', 'acc'];

// =============================================================================
// ② SVG 원본 캐시
// =============================================================================

/**
 * 원본 SVG 파일 텍스트 캐시.
 * 동일 파일을 매 요청마다 디스크에서 읽지 않도록 메모리에 보관한다.
 * 패치는 항상 이 원본 텍스트의 복사본(JSDOM 새 인스턴스)에 적용되므로
 * 캐시를 공유해도 요청 간 색상이 섞이지 않는다.
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
// ③ 메인 패치 함수 (퍼블릭 API)
// =============================================================================

/**
 * 감성 점수와 다양성 시드를 받아 SVG의 12패널 색상을 패치하고
 * 직렬화된 SVG 문자열을 반환한다.
 *
 * [처리 흐름]
 *   1. assets/stained-glass.svg 원본 텍스트 로드 (캐시됨)
 *   2. jsdom으로 새 DOM 인스턴스 생성 (요청마다 독립)
 *   3. color-calculator.calculateAllPanelColors() 로 12패널 색상 계산
 *   4. 각 패널의 svgId를 이용해 grad-{svgId}-{main,sub,acc} 요소를
 *      getElementById로 찾아 stop-color 속성 변경
 *   5. dom.serialize() 로 패치된 SVG 문자열 반환
 *
 * 누락된 그라디언트 stop은 조용히 건너뛴다(?.setAttribute) —
 * SVG 자체에 결함이 있어도 PNG 생성 파이프라인이 중단되지 않는다.
 * 단, 누락 발생 시 console.warn으로 로그를 남긴다.
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
 * // → '<?xml version="1.0"?><svg ...>...
 * //      <stop id="grad-spot-04-main" stop-color="#FF7A4F"/>...</svg>'
 *
 * // png-exporter.js 에 전달
 * await svgToPng(svg, './output/card.png', 1200, reply);
 */
export async function patchSVG(emotionScores, diversitySeed) {
  const t0 = Date.now();

  // ── STEP 1: 원본 SVG 로드 ─────────────────────────────────────
  const rawSvg = await _loadSvgSource();

  // ── STEP 2: jsdom DOM 파싱 (요청마다 독립 인스턴스) ─────────────
  const dom = new JSDOM(rawSvg, { contentType: 'image/svg+xml' });
  const doc = dom.window.document;

  // ── STEP 3: 12패널 색상 계산 ─────────────────────────────────────
  const colors = calculateAllPanelColors(emotionScores, diversitySeed);

  // ── STEP 4: stop-color 패치 ───────────────────────────────────────
  const missing = [];

  for (const panel of colors) {
    const svgId = panel.svgId; // 예: 'spot-04' (간절곶, emotion idx 0)

    for (const role of COLOR_ROLES) {
      const stopId = `grad-${svgId}-${role}`;
      const stopEl = doc.getElementById(stopId);

      if (stopEl) {
        stopEl.setAttribute('stop-color', panel[role]);
      } else {
        missing.push(stopId);
      }
    }
  }

  if (missing.length > 0) {
    console.warn(
      `[svg-patcher] 누락된 그라디언트 stop ${missing.length}개:`,
      missing.join(', '),
    );
  }

  // ── STEP 5: 직렬화 ─────────────────────────────────────────────────
  const patched = dom.serialize();

  console.info(
    `[svg-patcher] SVG 패치 완료 | ` +
    `패널 ${colors.length}개 | ` +
    `누락 ${missing.length}개 | ` +
    `${Date.now() - t0}ms`,
  );

  return patched;
}

// =============================================================================
// ④ 디버그 유틸리티
// =============================================================================

/**
 * 원본 SVG에 12패널 × 3색 그라디언트 stop이 모두 존재하는지 점검한다.
 * 배포 전 SVG 자산 검증용.
 *
 * @returns {Promise<{ valid:boolean, missing:string[], total:number }>}
 *
 * @example
 * const { valid, missing } = await validateSvgAssets();
 * if (!valid) console.warn('SVG 자산에 누락된 ID:', missing);
 */
export async function validateSvgAssets() {
  const rawSvg = await _loadSvgSource();
  const dom    = new JSDOM(rawSvg, { contentType: 'image/svg+xml' });
  const doc    = dom.window.document;

  const missing = [];
  let   total   = 0;

  for (let i = 0; i <= 11; i++) {
    const svgId = `spot-${String(i).padStart(2, '0')}`;
    for (const role of COLOR_ROLES) {
      total++;
      const stopId = `grad-${svgId}-${role}`;
      if (!doc.getElementById(stopId)) {
        missing.push(stopId);
      }
    }
  }

  return { valid: missing.length === 0, missing, total };
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
  const colors = calculateAllPanelColors(emotionScores, diversitySeed);

  console.group('🩹 svg-patcher — 패치 대상 매핑');
  console.log(
    ' E-idx │ SVG ID  │ 경승지                   │ main     │ sub      │ acc',
  );
  console.log(
    '───────┼─────────┼──────────────────────────┼──────────┼──────────┼──────────',
  );

  for (const p of colors) {
    const name = p.name.padEnd(24);
    console.log(
      `  ${String(p.index).padStart(2)}   │ ${p.svgId} │ ${name} │ ` +
      `${p.main} │ ${p.sub} │ ${p.acc}`,
    );
  }

  const { valid, missing, total } = await validateSvgAssets();
  console.log('');
  console.log(`SVG 자산 검증: ${total - missing.length}/${total}`,
    valid ? '✅ 모두 존재' : `❌ 누락: ${missing.join(', ')}`);

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
