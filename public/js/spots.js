/**
 * @fileoverview 울산 E-Card — 울산 12경 팔레트 상수 (클라이언트)
 * @module public/js/spots
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   emotion-engine/constants/spot-palettes.js 의 SPOTS 데이터를
 *   클라이언트용으로 그대로 옮긴 파일이다 (Single Source of Truth 복제).
 *
 *   서버와 동일한 인덱스 순서(0~11)·동일한 hex 색상값을 유지하여
 *   클라이언트가 표시하는 정보(경승지명·이모지·기본 팔레트)가
 *   서버 계산 결과와 항상 일치하도록 한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [사용처]
 *
 *   public/js/svg-renderer.js
 *     resetSVG()        → SPOTS[i].hex.{main,sub,acc} 로 기본 팔레트 복원
 *     debugCheckSvgIds() → SPOTS[i].name 으로 디버그 라벨 출력
 *
 *   public/js/app.js
 *     renderPaletteStrip() → SPOTS[i].name 을 칩 title(툴팁)으로 사용
 *     showSpotLabel()      → SPOTS[i].emoji + SPOTS[i].name 표시
 *
 * ─────────────────────────────────────────────────────────────────
 * [인덱스 순서 — emotion-engine SPOTS 인덱스]
 *
 *   index  경승지명                    angle(로즈윈도우 위치)
 *   ────────────────────────────────────────────────────────
 *     0    간절곶 일출                  0°   (12시)
 *     1    대왕암공원                   30°  (1시)
 *     2    강동 몽돌해변                60°  (2시)
 *     3    장생포 고래문화마을          90°  (3시)
 *     4    외고산 옹기마을              120° (4시)
 *     5    반구대 암각화                150° (5시)
 *     6    대운산 내원암 계곡           180° (6시)
 *     7    울산대교                     210° (7시)
 *     8    울산대공원                   240° (8시)
 *     9    태화강 국가정원·십리대숲     270° (9시)
 *    10    신불산 억새평원              300° (10시)
 *    11    가지산 사계                  330° (11시)
 *
 *   ⚠️ 이 인덱스 순서는 SVG 파일의 grad-spot-XX 번호 체계와 다르다.
 *   SVG 변환은 public/js/svg-renderer.js 의 EMOTION_TO_SVG_SPOT 이 담당한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [팔레트 구조 — 경승지별 4색 시스템]
 *
 *   main  주색    경승지를 대표하는 핵심 색상
 *   sub   보조색  주색을 보완하는 조화색
 *   acc   강조색  포인트·하이라이트·타이포그래피용
 *   base  배경색  어둡고 깊은 그늘·심층색
 */

'use strict';

// =============================================================================
// ① 색상 변환 유틸리티 (hex → HSL → CSS 문자열)
//    emotion-engine/constants/spot-palettes.js 와 동일 알고리즘
// =============================================================================

/**
 * Hex → { h:0~360, s:0~1, l:0~1 }
 * @param {string} hex '#RRGGBB'
 * @returns {{ h:number, s:number, l:number }}
 */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l  = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l: +l.toFixed(4) };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
        : mx === g ? ((b - r) / d + 2) / 6
        :             ((r - g) / d + 4) / 6;
  return { h: +(h * 360).toFixed(1), s: +s.toFixed(4), l: +l.toFixed(4) };
}

/**
 * CSS hsl() 문자열 생성
 * @param {number} h 0~360
 * @param {number} s 0~1
 * @param {number} l 0~1
 * @returns {string}
 */
const toCss = (h, s, l) =>
  `hsl(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`;

// =============================================================================
// ② 울산 12경 팔레트 원본 데이터
//    emotion-engine/constants/spot-palettes.js _RAW 와 동일
//    순서: 로즈 윈도우 시계 방향 (12시 = 0°부터)
// =============================================================================

const _RAW = [
  // ── 0. 간절곶 일출 — 한반도 최동단, 가장 먼저 맞는 빛 ───────────
  {
    index: 0,
    name:      '간절곶 일출',
    shortName: '간절곶',
    emoji:     '🌅',
    angle:     0,
    hex: {
      main: '#FF6635',  // 일출 오렌지
      sub:  '#FFB347',  // 여명 황금
      acc:  '#FFCF9E',  // 노을 크림
      base: '#1B2A4A',  // 새벽 심해청
    },
  },

  // ── 1. 대왕암공원 — 해송 숲과 기암괴석 ──────────────────────────
  {
    index: 1,
    name:      '대왕암공원',
    shortName: '대왕암',
    emoji:     '🌲',
    angle:     30,
    hex: {
      main: '#2A6640',  // 해송 심록
      sub:  '#607B8B',  // 기암 회청
      acc:  '#A8D5B5',  // 파도 이끼
      base: '#0D2318',  // 노송 그늘
    },
  },

  // ── 2. 강동 몽돌해변 — 검은 몽돌과 에메랄드 바다 ────────────────
  {
    index: 2,
    name:      '강동 몽돌해변',
    shortName: '강동몽돌',
    emoji:     '🪨',
    angle:     60,
    hex: {
      main: '#4A6880',  // 몽돌 회청
      sub:  '#38A89D',  // 청록 파도
      acc:  '#CAF0F8',  // 포말 흰
      base: '#1A2F3A',  // 몽돌 심흑
    },
  },

  // ── 3. 장생포 고래문화마을 — 귀환한 고래의 바다 ─────────────────
  {
    index: 3,
    name:      '장생포 고래문화마을',
    shortName: '장생포',
    emoji:     '🐋',
    angle:     90,
    hex: {
      main: '#0B5EA8',  // 고래 심청
      sub:  '#48A9C5',  // 항구 수면청
      acc:  '#C8E8F5',  // 물보라 흰
      base: '#02214A',  // 심해 감청
    },
  },

  // ── 4. 외고산 옹기마을 — 흙과 불로 빚은 전통 ────────────────────
  {
    index: 4,
    name:      '외고산 옹기마을',
    shortName: '외고산',
    emoji:     '🏺',
    angle:     120,
    hex: {
      main: '#B5693A',  // 옹기 황토
      sub:  '#7A3D2B',  // 전통 가마갈
      acc:  '#E8C99A',  // 생토 크림
      base: '#2E1810',  // 흙가마 흑
    },
  },

  // ── 5. 반구대 암각화 — 7천 년의 시간이 새겨진 바위 ──────────────
  {
    index: 5,
    name:      '반구대 암각화',
    shortName: '반구대',
    emoji:     '🗿',
    angle:     150,
    hex: {
      main: '#C4956A',  // 암반 황토
      sub:  '#6B3D1E',  // 선사 각화갈
      acc:  '#E8D5B5',  // 암벽 밝은면
      base: '#2C1508',  // 원시 암흑
    },
  },

  // ── 6. 대운산 내원암 계곡 — 비취빛 계곡과 천년 암자 ─────────────
  {
    index: 6,
    name:      '대운산 내원암 계곡',
    shortName: '대운산',
    emoji:     '⛰️',
    angle:     180,
    hex: {
      main: '#2D7D5E',  // 계곡 비취
      sub:  '#8B7214',  // 암자 목재
      acc:  '#D4E8D0',  // 물보라 연초
      base: '#1A3828',  // 심계곡 암록
    },
  },

  // ── 7. 울산대교 — 태화강 위의 현수교, 야경 명소 ─────────────────
  {
    index: 7,
    name:      '울산대교',
    shortName: '울산대교',
    emoji:     '🌉',
    angle:     210,
    hex: {
      main: '#4A6FA5',  // 현수교 강청
      sub:  '#C8A84B',  // 야경 황금
      acc:  '#E8F0F8',  // 수면 반사흰
      base: '#0D1B2A',  // 태화강 야경
    },
  },

  // ── 8. 울산대공원 — 도심 속 광활한 자연, 장미원 ─────────────────
  {
    index: 8,
    name:      '울산대공원',
    shortName: '울산대공원',
    emoji:     '🌸',
    angle:     240,
    hex: {
      main: '#5A9E6F',  // 공원 잔디록
      sub:  '#E8607A',  // 장미 정원
      acc:  '#F5DEB3',  // 산책로 크림
      base: '#1E3D2A',  // 수목 그늘
    },
  },

  // ── 9. 태화강 국가정원·십리대숲 — 생명의 강과 대나무 숲 ─────────
  {
    index: 9,
    name:      '태화강 국가정원·십리대숲',
    shortName: '태화강',
    emoji:     '🎋',
    angle:     270,
    hex: {
      main: '#3D8B5E',  // 대나무 청록
      sub:  '#6BBFD4',  // 태화강 청
      acc:  '#DFFFEF',  // 백로 순백
      base: '#1B3D28',  // 대숲 심연
    },
  },

  // ── 10. 신불산 억새평원 — 황금 물결치는 억새 ────────────────────
  {
    index: 10,
    name:      '신불산 억새평원',
    shortName: '신불산',
    emoji:     '🌾',
    angle:     300,
    hex: {
      main: '#D4A853',  // 억새 황금
      sub:  '#8FA8C8',  // 능선 하늘청
      acc:  '#F5E8C8',  // 억새 밝은끝
      base: '#3D5A47',  // 산정 어둠
    },
  },

  // ── 11. 가지산 사계 — 사계절 모두 다른 얼굴 ─────────────────────
  {
    index: 11,
    name:      '가지산 사계',
    shortName: '가지산',
    emoji:     '🏔️',
    angle:     330,
    hex: {
      main: '#6B8F6E',  // 산야 초록
      sub:  '#D4703A',  // 단풍 주황
      acc:  '#F5E6C8',  // 설원 크림
      base: '#2A1A0E',  // 산야 심흑
    },
  },
];

// =============================================================================
// ③ HSL 사전 계산 및 최종 SPOTS 배열 생성
// =============================================================================

/**
 * 사전 계산된 HSL·CSS 값이 포함된 울산 12경 클라이언트 팔레트 배열.
 *
 * @type {Array<{
 *   index:     number,
 *   name:      string,
 *   shortName: string,
 *   emoji:     string,
 *   angle:     number,
 *   hex: { main:string, sub:string, acc:string, base:string },
 *   hsl: { main:Object, sub:Object, acc:Object, base:Object },
 *   css: { main:string, sub:string, acc:string, base:string },
 * }>}
 *
 * @example
 * SPOTS[0].name        // → '간절곶 일출'
 * SPOTS[0].emoji       // → '🌅'
 * SPOTS[0].hex.main    // → '#FF6635'
 * SPOTS[0].css.main    // → 'hsl(16.0, 100.0%, 60.0%)'
 */
export const SPOTS = _RAW.map((spot) => {
  const hsl = {};
  const css = {};

  for (const key of ['main', 'sub', 'acc', 'base']) {
    hsl[key] = hexToHsl(spot.hex[key]);
    css[key] = toCss(hsl[key].h, hsl[key].s, hsl[key].l);
  }

  return { ...spot, hsl, css };
});

// =============================================================================
// ④ 접근자 함수 (Accessor Functions)
// =============================================================================

/**
 * 인덱스로 경승지 팔레트 데이터를 조회한다.
 *
 * @param {number} index  0~11
 * @returns {Object | null} SPOTS 항목
 */
export function getSpotByIndex(index) {
  return SPOTS.find((s) => s.index === index) ?? null;
}

/**
 * 이름(전체 또는 약칭)으로 경승지를 조회한다.
 *
 * @param {string} name  예: '간절곶 일출' 또는 '간절곶'
 * @returns {Object | null}
 */
export function getSpotByName(name) {
  return SPOTS.find(
    (s) => s.name === name || s.shortName === name
  ) ?? null;
}

/**
 * 모든 경승지의 main 색상(hex)을 배열로 반환한다.
 * 팔레트 미리보기·기본 색상 칩 표시에 사용.
 *
 * @returns {string[]} 12개 hex 색상
 */
export function getAllMainColors() {
  return SPOTS.map((s) => s.hex.main);
}

/**
 * 기본 팔레트를 panelColors 형식으로 변환한다.
 *
 * svg-renderer.js의 resetSVG() 에서 사용:
 *   applyColorsToSVG(getDefaultPanelColors());
 *
 * @returns {Array<{ index:number, main:string, sub:string, acc:string }>}
 */
export function getDefaultPanelColors() {
  return SPOTS.map((spot) => ({
    index: spot.index,
    main:  spot.hex.main,
    sub:   spot.hex.sub,
    acc:   spot.hex.acc,
  }));
}

// =============================================================================
// ⑤ Default Export
// =============================================================================

export default {
  SPOTS,
  getSpotByIndex,
  getSpotByName,
  getAllMainColors,
  getDefaultPanelColors,
};
