/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — 울산 12경 전용 색상 팔레트 상수
 * @module emotion-engine/constants/spot-palettes
 *
 * ─────────────────────────────────────────────────────────────────
 * Single Source of Truth : 울산 12경 색상 데이터
 * ─────────────────────────────────────────────────────────────────
 *
 * 이 파일이 색상의 유일한 출처(Single Source of Truth)다.
 * 모든 모듈은 색상이 필요할 때 이 파일을 참조한다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [팔레트 구조 — 경승지별 4색 시스템]
 *
 *   main  주색    경승지를 대표하는 핵심 색상
 *   sub   보조색  주색을 보완하는 조화색
 *   acc   강조색  포인트·하이라이트·타이포그래피용
 *   base  배경색  어둡고 깊은 그늘·심층색
 *
 * ─────────────────────────────────────────────────────────────────
 * [색상 설계 철학]
 *
 *   각 경승지의 색상은 단순히 "예쁜 색"이 아니라
 *   그 장소가 가진 빛·자연·시간·문화를 색으로 번역한 것이다.
 *
 *   간절곶  → 한반도 최동단에서 가장 먼저 맞는 빛: 붉은 오렌지
 *   반구대  → 7천 년 시간이 새겨진 사암: 황토·암갈색
 *   태화강  → 십리 대숲의 서늘한 초록과 백로의 흰빛
 *   울산대교 → 강물 위에 뜬 황금 야경: 강청·황금
 */
 
'use strict';
 
// =============================================================================
// ① 내부 색상 변환 유틸리티
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
 * Hex → [R, G, B] (0~255)
 * @param {string} hex
 * @returns {number[]}
 */
function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
 
/**
 * HSL(h:0~360, s:0~100, l:0~100) → [R, G, B] (0~255)
 * @param {number} h  0~360
 * @param {number} s  0~100
 * @param {number} l  0~100
 * @returns {number[]}
 */
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60  ? [c, x, 0] : h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] : h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return [
    Math.min(255, Math.round((r + m) * 255)),
    Math.min(255, Math.round((g + m) * 255)),
    Math.min(255, Math.round((b + m) * 255)),
  ];
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
//    순서: 로즈 윈도우 시계 방향 (12시 = 0°부터)
// =============================================================================
 
const _RAW = [
  // ──────────────────────────────────────────────────────────────────────────
  // 0. 간절곶 일출  |  angle: 0° (12시)
  // 한반도 최동단 — 가장 먼저 일출을 맞이하는 땅
  // 일출 오렌지·여명 황금·노을 심홍 → 새벽 깊은 남색
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 0,
    name:      '간절곶 일출',
    shortName: '간절곶',
    emoji:     '🌅',
    angle:     0,
    hex: {
      main: '#FF6635',  // 일출 오렌지   — 수평선 위로 솟는 태양
      sub:  '#FFB347',  // 여명 황금     — 하늘을 물드는 빛
      acc:  '#FFCF9E',  // 노을 크림     — 구름 가장자리
      base: '#1B2A4A',  // 새벽 심해청   — 빛이 오기 전의 바다
    },
    colorTemp:    2800, // K (따뜻한 일출 색온도)
    lightingChar: '방사형 직사광 — 수평선에서 팬처럼 퍼지는 빛',
    dominantSeason: 'all',
    notes: '한반도에서 가장 먼저 해가 뜨는 곳. 붉고 황금빛인 드라마틱한 색채.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 1. 대왕암공원  |  angle: 30° (1시)
  // 해송 숲과 기암괴석 — 울산의 수호 바위
  // 해송 심록·기암 회청·파도 이끼 → 노송 그늘
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 1,
    name:      '대왕암공원',
    shortName: '대왕암',
    emoji:     '🌲',
    angle:     30,
    hex: {
      main: '#2A6640',  // 해송 심록     — 수백 년 소나무의 짙음
      sub:  '#607B8B',  // 기암 회청     — 풍화된 화강암 빛
      acc:  '#A8D5B5',  // 파도 이끼     — 바위에 낀 이끼색
      base: '#0D2318',  // 노송 그늘     — 울창한 솔숲 그림자
    },
    colorTemp:    5500,
    lightingChar: '산란광 — 솔숲 사이로 스며드는 부드러운 자연광',
    dominantSeason: 'all',
    notes: '천연기념물 서식지. 짙은 해송과 기암이 만드는 자연의 조화.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 2. 강동 몽돌해변  |  angle: 60° (2시)
  // 검은 몽돌과 에메랄드 바다 — 독특한 해변
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 2,
    name:      '강동 몽돌해변',
    shortName: '강동몽돌',
    emoji:     '🪨',
    angle:     60,
    hex: {
      main: '#4A6880',  // 몽돌 회청     — 물에 젖은 검은 돌
      sub:  '#38A89D',  // 청록 파도     — 에메랄드빛 얕은 바다
      acc:  '#CAF0F8',  // 포말 흰       — 파도가 부서지는 순간
      base: '#1A2F3A',  // 몽돌 심흑     — 물빠진 몽돌의 어둠
    },
    colorTemp:    6500,
    lightingChar: '수평 반사광 — 바다가 하늘빛을 반사하는 투명한 빛',
    dominantSeason: 'summer',
    notes: '파도 소리와 함께 구르는 검은 몽돌. 시각과 청각이 어우러지는 해변.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 3. 장생포 고래문화마을  |  angle: 90° (3시)
  // 귀환한 고래의 바다 — 울산 해양 생태의 심장
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 3,
    name:      '장생포 고래문화마을',
    shortName: '장생포',
    emoji:     '🐋',
    angle:     90,
    hex: {
      main: '#0B5EA8',  // 고래 심청     — 고래가 사는 깊은 바다
      sub:  '#48A9C5',  // 항구 수면청   — 항구 안쪽 잔잔한 수면
      acc:  '#C8E8F5',  // 물보라 흰     — 고래 분수공의 물보라
      base: '#02214A',  // 심해 감청     — 고래가 헤엄치는 깊은 곳
    },
    colorTemp:    5800,
    lightingChar: '수직 투과광 — 수면을 뚫고 내리꽂히는 깊은 바닷속 광선',
    dominantSeason: 'all',
    notes: '한때 포경의 중심지, 지금은 고래 보호의 성지. 고래의 귀환을 기념한다.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 4. 외고산 옹기마을  |  angle: 120° (4시)
  // 흙과 불로 빚은 전통 — 세월이 담긴 옹기
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 4,
    name:      '외고산 옹기마을',
    shortName: '외고산',
    emoji:     '🏺',
    angle:     120,
    hex: {
      main: '#B5693A',  // 옹기 황토     — 구워진 옹기 몸통의 색
      sub:  '#7A3D2B',  // 전통 가마갈   — 가마 속 불꽃이 지난 자리
      acc:  '#E8C99A',  // 생토 크림     — 아직 굽기 전의 생도자기
      base: '#2E1810',  // 흙가마 흑     — 가마 내부의 깊은 어둠
    },
    colorTemp:    3200,
    lightingChar: '가마 열복사 — 불꽃이 만드는 따뜻하고 일렁이는 빛',
    dominantSeason: 'all',
    notes: '전국 최대 옹기 생산지. 500년 전통이 살아있는 도예 마을.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 5. 반구대 암각화  |  angle: 150° (5시)
  // 7천 년의 시간이 새겨진 바위 — 인류의 첫 고래 사냥 기록
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 5,
    name:      '반구대 암각화',
    shortName: '반구대',
    emoji:     '🗿',
    angle:     150,
    hex: {
      main: '#C4956A',  // 암반 황토     — 태양에 달궈진 사암 암벽
      sub:  '#6B3D1E',  // 선사 각화갈   — 암각화가 새겨진 깊은 홈
      acc:  '#E8D5B5',  // 암벽 밝은면   — 양지 쪽 암반 표면
      base: '#2C1508',  // 원시 암흑     — 암각화 배경의 깊은 그늘
    },
    colorTemp:    4200,
    lightingChar: '경사 입사광 — 암각화를 드러내는 비스듬한 측면 조명',
    dominantSeason: 'all',
    notes: '유네스코 세계유산 잠정목록. 신석기 시대 고래·동물 암각화 300여 점.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 6. 대운산 내원암 계곡  |  angle: 180° (6시)
  // 비취빛 계곡과 천년 암자 — 산과 물이 만나는 성소
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 6,
    name:      '대운산 내원암 계곡',
    shortName: '대운산',
    emoji:     '⛰️',
    angle:     180,
    hex: {
      main: '#2D7D5E',  // 계곡 비취     — 돌 위를 흐르는 맑은 물
      sub:  '#8B7214',  // 암자 목재     — 내원암의 오래된 나무 기둥
      acc:  '#D4E8D0',  // 물보라 연초   — 폭포 아래 물안개
      base: '#1A3828',  // 심계곡 암록   — 협곡 깊은 곳의 그늘
    },
    colorTemp:    6200,
    lightingChar: '협곡 산란광 — 좁은 계곡 사이로 내려오는 부드러운 빛',
    dominantSeason: 'summer',
    notes: '울산 최고의 계곡 피서지. 내원암 인근 폭포와 소가 절경.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 7. 울산대교  |  angle: 210° (7시)
  // 태화강 위의 현수교 — 울산 산업의 상징이자 야경 명소
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 7,
    name:      '울산대교',
    shortName: '울산대교',
    emoji:     '🌉',
    angle:     210,
    hex: {
      main: '#4A6FA5',  // 현수교 강청   — 태화강 물빛을 담은 교각
      sub:  '#C8A84B',  // 야경 황금     — 교량 조명의 황금빛
      acc:  '#E8F0F8',  // 수면 반사흰   — 강 위에 비친 야경
      base: '#0D1B2A',  // 태화강 야경   — 조명이 켜지기 전 강물의 어둠
    },
    colorTemp:    3600,
    lightingChar: '수면 반영광 — 교량 조명이 강물에 비쳐 만드는 이중 광원',
    dominantSeason: 'all',
    notes: '현수교 길이 1,150m. 태화강 하구를 가로지르며 울산 야경의 랜드마크.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 8. 울산대공원  |  angle: 240° (8시)
  // 도심 속 광활한 자연 — 장미원과 생태 공원
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 8,
    name:      '울산대공원',
    shortName: '울산대공원',
    emoji:     '🌸',
    angle:     240,
    hex: {
      main: '#5A9E6F',  // 공원 잔디록   — 광활하게 펼쳐진 잔디밭
      sub:  '#E8607A',  // 장미 정원     — 장미원의 붉은 꽃빛
      acc:  '#F5DEB3',  // 산책로 크림   — 햇빛에 빛나는 황토 길
      base: '#1E3D2A',  // 수목 그늘     — 울창한 나무 아래 그늘
    },
    colorTemp:    5600,
    lightingChar: '확산 자연광 — 탁 트인 공원의 균일하고 부드러운 낮 빛',
    dominantSeason: 'spring',
    notes: '면적 330만㎡. 국내 최대 도심 공원 중 하나. 장미 축제로 유명.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 9. 태화강 국가정원·십리대숲  |  angle: 270° (9시)
  // 생명의 강과 대나무 숲 — 울산 치유의 중심
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 9,
    name:      '태화강 국가정원·십리대숲',
    shortName: '태화강',
    emoji:     '🎋',
    angle:     270,
    hex: {
      main: '#3D8B5E',  // 대나무 청록   — 수십만 대나무의 짙은 초록
      sub:  '#6BBFD4',  // 태화강 청     — 맑게 흐르는 강물빛
      acc:  '#DFFFEF',  // 백로 순백     — 백로 떼가 날아오를 때
      base: '#1B3D28',  // 대숲 심연     — 대나무가 빛을 막은 깊은 그늘
    },
    colorTemp:    5200,
    lightingChar: '수직 투과 산란광 — 대나무 사이로 내려오는 초록빛 산란',
    dominantSeason: 'all',
    notes: '국내 2호 국가정원. 십리(4km) 대나무 숲에 백로 수천 마리가 서식.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 10. 신불산 억새평원  |  angle: 300° (10시)
  // 황금 물결치는 억새 — 영남알프스의 가을 대서사시
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 10,
    name:      '신불산 억새평원',
    shortName: '신불산',
    emoji:     '🌾',
    angle:     300,
    hex: {
      main: '#D4A853',  // 억새 황금     — 바람에 일렁이는 황금빛 억새
      sub:  '#8FA8C8',  // 능선 하늘청   — 억새 위로 펼쳐진 고산 하늘
      acc:  '#F5E8C8',  // 억새 밝은끝   — 역광에 빛나는 억새 끝
      base: '#3D5A47',  // 산정 어둠     — 산 정상의 서늘한 그늘
    },
    colorTemp:    4800,
    lightingChar: '역광 산란광 — 억새 끝을 빛으로 물들이는 가을 석양 역광',
    dominantSeason: 'autumn',
    notes: '해발 1,159m. 가을이면 광활한 억새 평원이 황금빛 바다로 변한다.',
  },
 
  // ──────────────────────────────────────────────────────────────────────────
  // 11. 가지산 사계  |  angle: 330° (11시)
  // 사계절 모두 다른 얼굴 — 영남알프스 최고봉
  // ──────────────────────────────────────────────────────────────────────────
  {
    index: 11,
    name:      '가지산 사계',
    shortName: '가지산',
    emoji:     '🏔️',
    angle:     330,
    hex: {
      main: '#6B8F6E',  // 산야 초록     — 여름 짙은 산록의 초록
      sub:  '#D4703A',  // 단풍 주황     — 가을 불타는 단풍빛
      acc:  '#F5E6C8',  // 설원 크림     — 겨울 설원의 밝은 빛
      base: '#2A1A0E',  // 산야 심흑     — 바위 틈새의 깊은 그늘
    },
    colorTemp:    5400,
    lightingChar: '고산 직달광 — 구름 위에서 쏟아지는 맑고 강한 산 정상의 빛',
    dominantSeason: 'all',
    notes: '경남·울산 최고봉(1,240m). 봄 철쭉, 여름 운해, 가을 단풍, 겨울 설경.',
  },
];
 
// =============================================================================
// ③ HSL 사전 계산 및 최종 SPOTS 배열 생성
// =============================================================================
 
/**
 * 사전 계산된 HSL 값이 포함된 울산 12경 완전 팔레트 배열.
 *
 * @type {Array<{
 *   index:          number,
 *   name:           string,
 *   shortName:      string,
 *   emoji:          string,
 *   angle:          number,
 *   hex:            { main:string, sub:string, acc:string, base:string },
 *   hsl:            { main:Object, sub:Object, acc:Object, base:Object },
 *   rgb:            { main:number[], sub:number[], acc:number[], base:number[] },
 *   css:            { main:string, sub:string, acc:string, base:string },
 *   colorTemp:      number,
 *   lightingChar:   string,
 *   dominantSeason: string,
 *   notes:          string,
 * }>}
 */
export const SPOTS = _RAW.map((spot) => {
  const hsl = {};
  const rgb = {};
  const css = {};
 
  for (const key of ['main', 'sub', 'acc', 'base']) {
    hsl[key] = hexToHsl(spot.hex[key]);
    rgb[key] = hexToRgb(spot.hex[key]);
    css[key] = toCss(hsl[key].h, hsl[key].s, hsl[key].l);
  }
 
  return { ...spot, hsl, rgb, css };
});
 
// =============================================================================
// ④ 확장 팔레트 생성 (Extended Palette — 11색)
// =============================================================================
 
/**
 * 경승지 인덱스에서 11색 확장 팔레트를 생성한다.
 *
 * [확장 방식]
 *   기본 4색(main, sub, acc)에서 각각 3가지 변형 생성:
 *     1. 원색            — 그대로
 *     2. 밝은 변형        — lightness +20%, saturation −10%
 *     3. 색조 이동 변형   — hue +20°
 *   + base 원색
 *   + base 약간 밝은 버전
 *   = 총 11색
 *
 * Three.js 셰이더 팔레트, 타이포그래피 컬러칩에 사용.
 *
 * @param {number} spotIndex  0~11
 * @returns {number[][]} 11개 [R, G, B] 배열 (각 0~255)
 */
export function buildExtendedPalette(spotIndex) {
  const spot = SPOTS[spotIndex];
  if (!spot) throw new RangeError(`spotIndex ${spotIndex} 범위 초과 (0~11)`);
 
  const result = [];
 
  for (const key of ['main', 'sub', 'acc']) {
    const { h, s, l } = spot.hsl[key];
 
    // ① 원색
    result.push(spot.rgb[key]);
 
    // ② 밝은 변형 (lightness +20%, saturation −10%)
    result.push(hslToRgb(
      h,
      Math.max(10, (s - 0.10) * 100),
      Math.min(88, (l + 0.20) * 100),
    ));
 
    // ③ 색조 이동 변형 (hue +20°)
    result.push(hslToRgb(
      (h + 20) % 360,
      Math.max(20, (s - 0.06) * 100),
      Math.min(85, (l + 0.08) * 100),
    ));
  }
 
  // ⑩ base 원색
  result.push(spot.rgb.base);
 
  // ⑪ base 밝은 변형
  const { h: bh, s: bs, l: bl } = spot.hsl.base;
  result.push(hslToRgb(bh, Math.max(15, (bs - 0.08) * 100), Math.min(55, (bl + 0.18) * 100)));
 
  return result; // 길이 11
}
 
// =============================================================================
// ⑤ 스테인드글라스 유리 기본 재질 파라미터
// =============================================================================
 
/**
 * 각 경승지의 유리 재질 기본 파라미터.
 * Three.js MeshPhysicalMaterial에 직접 사용.
 *
 * [장소 특성에 따른 차이]
 *   투명도(transmission): 맑은 장소(계곡·해변) → 높음, 어두운 장소(암각화·숲) → 낮음
 *   거칠기(roughness):    오래된 장소(옹기·암각화) → 높음, 현대 장소 → 낮음
 */
export const SPOT_GLASS_PARAMS = SPOTS.map((spot) => {
  // 색온도·장소 특성으로 기본 유리 재질 추론
  const isClear  = ['강동몽돌', '대운산', '태화강'].includes(spot.shortName);
  const isAncient= ['반구대', '외고산'].includes(spot.shortName);
  const isUrban  = ['울산대교', '울산대공원'].includes(spot.shortName);
 
  return {
    index:            spot.index,
    name:             spot.name,
    transmission:     isClear ? 0.88 : isAncient ? 0.76 : 0.82,
    roughness:        isAncient ? 0.08 : isClear ? 0.03 : 0.05,
    ior:              1.52,
    metalness:        0,
    leadMetalness:    isUrban ? 0.94 : 0.88,
    leadRoughness:    isAncient ? 0.32 : 0.22,
  };
});
 
// =============================================================================
// ⑥ 접근자 함수 (Accessor Functions)
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
 * UI 팔레트 미리보기, 컬러칩 표시에 사용.
 *
 * @returns {string[]} 12개 hex 색상
 */
export function getAllMainColors() {
  return SPOTS.map((s) => s.hex.main);
}
 
/**
 * 특정 경승지의 4색 CSS hsl() 배열을 반환한다.
 *
 * @param {number} spotIndex
 * @returns {{ main:string, sub:string, acc:string, base:string } | null}
 */
export function getSpotCSSColors(spotIndex) {
  const spot = getSpotByIndex(spotIndex);
  return spot ? spot.css : null;
}
 
/**
 * Claude API 프롬프트용 경승지 목록 텍스트를 생성한다.
 *
 * @returns {string}
 * @example
 * // '0=간절곶일출 1=대왕암공원 2=강동몽돌해변 ...'
 */
export function buildSpotReferenceText() {
  return SPOTS.map((s) => `${s.index}=${s.name.replace(/[·\s]/g, '')}`).join(' ');
}
 
/**
 * 경승지 목록을 프롬프트 삽입용 형식으로 반환한다.
 *
 * @returns {string}  각 줄에 '  N: 경승지명' 형식
 */
export function buildSpotListForPrompt() {
  return SPOTS.map((s) => `  ${s.index}: ${s.name}`).join('\n');
}
 
// =============================================================================
// ⑦ CSS 변수 & 스타일 헬퍼
// =============================================================================
 
/**
 * 특정 경승지의 4색을 CSS 커스텀 속성(변수) 문자열로 생성한다.
 * `<style>` 태그 또는 인라인 스타일에 삽입 가능.
 *
 * @param {number} spotIndex
 * @returns {string}
 * @example
 * // '--ulsan-main: hsl(16.0, 100.0%, 60.0%); --ulsan-sub: ...'
 */
export function generateCSSVars(spotIndex) {
  const spot = getSpotByIndex(spotIndex);
  if (!spot) return '';
  return [
    `--ulsan-main: ${spot.css.main};`,
    `--ulsan-sub:  ${spot.css.sub};`,
    `--ulsan-acc:  ${spot.css.acc};`,
    `--ulsan-base: ${spot.css.base};`,
  ].join(' ');
}
 
/**
 * Three.js uniform 형식으로 변환된 경승지 색상을 반환한다.
 * WebGL 셰이더에 직접 전달.
 *
 * @param {number} spotIndex
 * @returns {{ mainColor:number[], subColor:number[], accColor:number[], baseColor:number[] } | null}
 */
export function getSpotUniformColors(spotIndex) {
  const spot = getSpotByIndex(spotIndex);
  if (!spot) return null;
 
  // Three.js는 0~1 정규화된 색상을 사용
  const norm = (rgb) => rgb.map((v) => v / 255);
 
  return {
    mainColor: norm(spot.rgb.main),
    subColor:  norm(spot.rgb.sub),
    accColor:  norm(spot.rgb.acc),
    baseColor: norm(spot.rgb.base),
  };
}
 
// =============================================================================
// ⑧ 디버그 유틸리티
// =============================================================================
 
/**
 * 12경 팔레트 전체를 콘솔에 출력한다. (개발 전용)
 * @param {boolean} [showHSL=false]  HSL 값도 출력할지 여부
 */
export function debugPrintPalettes(showHSL = false) {
  /* eslint-disable no-console */
  console.group('🎨 울산 12경 팔레트 (spot-palettes.js)');
 
  SPOTS.forEach((spot) => {
    console.group(`[${spot.index}] ${spot.emoji} ${spot.name}`);
    console.log(`  위치: ${spot.angle}° | 색온도: ${spot.colorTemp}K`);
    console.log(`  main  hex: ${spot.hex.main}  css: ${spot.css.main}`);
    console.log(`  sub   hex: ${spot.hex.sub}   css: ${spot.css.sub}`);
    console.log(`  acc   hex: ${spot.hex.acc}   css: ${spot.css.acc}`);
    console.log(`  base  hex: ${spot.hex.base}  css: ${spot.css.base}`);
    if (showHSL) {
      ['main','sub','acc','base'].forEach((k) => {
        const { h, s, l } = spot.hsl[k];
        console.log(`  ${k.padEnd(4)} hsl: H${h.toFixed(0)}° S${(s*100).toFixed(0)}% L${(l*100).toFixed(0)}%`);
      });
    }
    console.log(`  특성: ${spot.lightingChar}`);
    console.groupEnd();
  });
 
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  SPOTS,
  SPOT_GLASS_PARAMS,
  buildExtendedPalette,
  getSpotByIndex,
  getSpotByName,
  getAllMainColors,
  getSpotCSSColors,
  buildSpotReferenceText,
  buildSpotListForPrompt,
  generateCSSVars,
  getSpotUniformColors,
  debugPrintPalettes,
};
 