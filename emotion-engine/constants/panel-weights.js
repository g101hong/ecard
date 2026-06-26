/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — 패널 가중치 상수
 * @module emotion-engine/constants/panel-weights
 *
 * ─────────────────────────────────────────────────────────────────
 * Single Source of Truth : 울산 12경 패널별 감성 반응 가중치
 * ─────────────────────────────────────────────────────────────────
 *
 * 이 파일이 "패널이 감성에 얼마나 민감한가"의 유일한 출처다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [데이터 레이어 구조]
 *
 *   LAYER 1  PANEL_WEIGHTS           기본 색채 파라미터 감도 (6종)
 *            각 패널이 글로벌 색채 파라미터(ΔHue·ΔSat 등)에
 *            얼마나 강하게 반응하는지 결정
 *
 *   LAYER 2  EMOTION_RESPONSE_MATRIX 감성 8차원 직접 반응 배수
 *            각 패널이 특정 감성(경이·평화 등)에
 *            얼마나 공명(resonance)하는지 결정
 *
 *   LAYER 3  SEASONAL_PANEL_MODS     계절별 색채 추가 보정
 *            패널마다 다른 계절 민감도 반영
 *            (가지산 사계 = 매우 민감 / 반구대 = 거의 불변)
 *
 *   LAYER 4  TIME_PANEL_MODS         시간대별 색채 추가 보정
 *            간절곶 = 아침 최고 / 울산대교 = 야경 최고
 *
 *   LAYER 5  COMPANION_PANEL_MODS    동행자 유형별 색채 추가 보정
 *            장소 분위기와 동행자 감성의 교차 효과
 *
 * ─────────────────────────────────────────────────────────────────
 * [설계 철학]
 *
 *   같은 소감(예: "너무 좋았어요")이라도 방문한 장소에 따라
 *   카드 색감이 달라야 한다. 간절곶에서의 감동과
 *   태화강 대숲에서의 감동은 색으로 표현될 때 달라야 한다.
 *
 *   이 파일이 그 "장소 고유의 색 언어"를 정의한다.
 */
 
'use strict';
 
// =============================================================================
// ① LAYER 1 — 기본 색채 파라미터 감도 가중치
// =============================================================================
//
// 형식: { hue, sat, light, contrast, temp, lightDir }
// 기준값 1.0 = 글로벌 파라미터를 그대로 반영
// > 1.0     = 더 강하게 반응 (민감)
// < 1.0     = 덜 반응       (둔감)
//
// 예) 간절곶의 temp: 1.60 → 색온도 변화에 글로벌값의 1.6배로 반응
//     반구대의 hue:  0.60 → 색조 변화에 글로벌값의 0.6배만 반응
 
export const PANEL_WEIGHTS = {
  // ── 0: 간절곶 일출 ─────────────────────────────────────────────
  //  일출의 색변화는 극적 → 색조·색온도·명도에 매우 민감
  0: {
    hue:      1.40,   // 일출 순간 색조가 빠르게 변함
    sat:      1.10,   // 채도는 보통 수준
    light:    1.35,   // 어둠에서 밝음으로 — 명도 변화가 큼
    contrast: 1.20,   // 새벽→일출의 극적인 명암 변화
    temp:     1.60,   // ★ 색온도에 가장 민감 (차가운 새벽→황금빛)
    lightDir: 1.30,   // 빛의 방향이 수평선에서 급격히 변함
  },
  // ── 1: 대왕암공원 ──────────────────────────────────────────────
  //  수백 년 해송과 기암 → 채도 민감, 색온도·색조에 둔감
  1: {
    hue:      0.70,   // 짙은 녹색 기조 유지 (색조 변화 제한)
    sat:      1.40,   // ★ 채도에 가장 민감 (울창한 해송의 짙음)
    light:    0.85,   // 솔숲 그늘로 명도 변화 제한
    contrast: 1.10,   // 바위와 솔숲의 자연스러운 대비
    temp:     0.60,   // 자연색은 색온도 변화에 둔감
    lightDir: 0.80,   // 고르게 분산된 솔숲 속 빛
  },
  // ── 2: 강동 몽돌해변 ───────────────────────────────────────────
  //  검은 몽돌 + 청록 바다 → 균형 있는 전반적 반응
  2: {
    hue:      0.90,
    sat:      0.80,   // 차분한 해변 분위기 → 채도 과도 상승 억제
    light:    1.10,   // 투명한 바다 → 약간 밝게
    contrast: 0.90,
    temp:     0.70,   // 청록 바다의 쿨한 색온도 유지
    lightDir: 1.00,
  },
  // ── 3: 장생포 고래문화마을 ─────────────────────────────────────
  //  고래 점프·항구 → 채도·대비에 민감 (역동성)
  3: {
    hue:      1.10,
    sat:      1.20,   // 역동적인 고래 → 비비드한 채도
    light:    0.90,   // 깊은 바다 → 약간 어둡게
    contrast: 1.30,   // ★ 대비에 민감 (고래 점프의 명암)
    temp:     0.80,
    lightDir: 0.70,   // 방향보다 깊이감이 중요
  },
  // ── 4: 외고산 옹기마을 ─────────────────────────────────────────
  //  흙·도자·가마 → 색온도·색조에 민감 (흙색의 따뜻함)
  4: {
    hue:      0.80,
    sat:      0.90,   // 옹기의 절제된 채도
    light:    0.80,   // 흙빛의 차분한 명도
    contrast: 0.70,   // 소박하고 부드러운 명암
    temp:     1.30,   // ★ 색온도에 민감 (가마의 따뜻한 흙색)
    lightDir: 0.60,   // 가마 열기로 방향성이 약함
  },
  // ── 5: 반구대 암각화 ───────────────────────────────────────────
  //  7천 년 사암 암벽 → 명암 대비에 매우 민감 (바위의 깊은 그림자)
  5: {
    hue:      0.60,   // 황토 암반 기조 유지 (색조 변화 최소)
    sat:      0.70,   // 차분하고 오래된 색감
    light:    0.65,   // 암벽 그림자 → 명도 변화 억제
    contrast: 1.50,   // ★★ 대비에 가장 민감 (바위 균열의 명암)
    temp:     1.10,   // 황토 암반 → 색온도 약간 반응
    lightDir: 0.50,   // ★★ 방향 변화에 가장 둔감 (암벽은 무방향)
  },
  // ── 6: 대운산 내원암 계곡 ──────────────────────────────────────
  //  비취빛 계곡·암자 → 채도·명도에 민감 (맑은 물빛)
  6: {
    hue:      0.85,
    sat:      1.30,   // ★ 채도 민감 (맑은 비취빛 계곡)
    light:    1.20,   // ★ 명도 민감 (햇빛에 반짝이는 물)
    contrast: 0.85,   // 부드러운 계곡 명암
    temp:     0.65,   // 계곡물 → 서늘한 색온도 유지
    lightDir: 1.10,   // 협곡 방향에 따른 광원 변화
  },
  // ── 7: 울산대교 ────────────────────────────────────────────────
  //  현수교 야경·수면 반영 → 광원 방향·대비에 가장 민감
  7: {
    hue:      1.20,
    sat:      0.95,
    light:    1.10,
    contrast: 1.40,   // ★ 야경의 극적 명암 변화
    temp:     1.00,
    lightDir: 1.50,   // ★★ 광원 방향에 가장 민감 (수면 반영 각도)
  },
  // ── 8: 울산대공원 ──────────────────────────────────────────────
  //  광활한 공원·장미원 → 명도에 민감 (개방적이고 밝은 분위기)
  8: {
    hue:      1.00,
    sat:      1.10,
    light:    1.25,   // ★ 명도 민감 (탁 트인 공원의 햇빛)
    contrast: 0.80,   // 소프트한 공원 명암
    temp:     0.90,
    lightDir: 1.00,
  },
  // ── 9: 태화강 국가정원·십리대숲 ──────────────────────────────
  //  대나무 숲·강 → 채도 민감, 색온도 둔감 (서늘한 초록)
  9: {
    hue:      0.75,   // 대나무 초록 기조 유지
    sat:      1.25,   // ★ 채도 민감 (짙은 초록의 풍요)
    light:    1.00,
    contrast: 0.75,   // 대숲의 부드러운 빛 산란
    temp:     0.55,   // ★★ 색온도에 가장 둔감 (대숲은 항상 서늘)
    lightDir: 0.85,
  },
  // ── 10: 신불산 억새평원 ────────────────────────────────────────
  //  황금 억새·능선·하늘 → 색조·색온도에 민감 (가을빛)
  10: {
    hue:      1.30,   // ★ 색조 민감 (억새의 황금빛 ← 계절·역광에 따라)
    sat:      1.00,
    light:    1.15,
    contrast: 1.00,
    temp:     1.40,   // ★ 색온도 민감 (가을 황금빛 강조)
    lightDir: 1.20,   // 역광 방향이 억새 색감을 크게 변화
  },
  // ── 11: 가지산 사계 ────────────────────────────────────────────
  //  사계절 극적 변화 → 색조에 가장 민감
  11: {
    hue:      1.50,   // ★★ 색조에 가장 민감 (봄 연분홍→가을 붉음)
    sat:      1.20,
    light:    1.00,
    contrast: 1.10,
    temp:     1.20,
    lightDir: 0.90,
  },
};
 
// =============================================================================
// ② LAYER 2 — 감성 8차원 직접 반응 행렬
// =============================================================================
//
// 각 패널이 특정 감성에 얼마나 "공명(resonance)"하는지 정의한다.
// 패널마다 고유한 감성 개성(Emotional Personality)을 부여한다.
//
// 형식: { amazement, peace, vitality, nostalgia, freshness, grandeur, warmth, mystery }
// 기준값 1.0 = 표준 반응
// > 1.0     = 해당 감성에 더 강하게 반응 (색변화 증폭)
// < 1.0     = 해당 감성을 덜 반영 (색변화 감쇠)
//
// 예) 간절곶의 warmth: 1.55 → "따뜻함" 감성에 표준의 1.55배 반응
//     반구대의 vitality: 0.55 → "활기" 감성을 거의 무시
 
export const EMOTION_RESPONSE_MATRIX = {
  // ── 0: 간절곶 일출 ─────────────────────────────────────────────
  //  경이·따뜻함·웅장함에 최고 반응 (드라마틱한 일출 장면)
  0: {
    amazement: 1.50,  // 일출은 언제나 경이롭다
    peace:     0.70,  // 고요하다기보다는 드라마틱
    vitality:  1.30,  // 새날을 알리는 에너지
    nostalgia: 0.80,  // 추억보다 현재 순간
    freshness: 1.20,  // 새벽 공기의 청량함
    grandeur:  1.40,  // 수평선 너머로 솟는 해의 웅장함
    warmth:    1.55,  // ★ 황금빛 온기 — 가장 높음
    mystery:   0.90,  // 신비보다 선명한 드라마
  },
  // ── 1: 대왕암공원 ──────────────────────────────────────────────
  //  평화·웅장·신선함에 강하게 반응 (울창한 자연의 안정감)
  1: {
    amazement: 1.10,  // 자연의 아름다움
    peace:     1.45,  // ★ 울창한 솔숲의 깊은 고요
    vitality:  0.85,  // 차분한 자연
    nostalgia: 1.20,  // 수백 년 된 소나무의 시간
    freshness: 1.30,  // 바다와 솔향이 어우러진 신선함
    grandeur:  1.35,  // 기암괴석의 웅장함
    warmth:    1.00,  // 중립
    mystery:   1.10,  // 기암의 형상들이 품은 이야기
  },
  // ── 2: 강동 몽돌해변 ───────────────────────────────────────────
  //  신선·평화·향수에 반응 (파도 소리와 검은 돌의 독특함)
  2: {
    amazement: 0.90,  // 독특하지만 압도적이지 않음
    peace:     1.35,  // 파도 소리가 만드는 리드미컬한 고요
    vitality:  1.00,  // 중립
    nostalgia: 1.15,  // 파도와 함께하는 여름 추억
    freshness: 1.50,  // ★ 바다의 청량함 — 가장 높음
    grandeur:  0.80,  // 아기자기한 해변 스케일
    warmth:    0.80,  // 차가운 몽돌과 바닷물
    mystery:   0.95,  // 검은 돌의 독특한 질감
  },
  // ── 3: 장생포 고래문화마을 ─────────────────────────────────────
  //  경이·활기·웅장에 강하게 반응 (고래의 역동적 생명력)
  3: {
    amazement: 1.45,  // ★ 고래 점프의 경이 — 가장 높음
    peace:     0.75,  // 역동적인 바다
    vitality:  1.40,  // 고래의 넘치는 생명력
    nostalgia: 1.10,  // 포경 역사의 아련함
    freshness: 1.20,  // 바다 바람과 물보라
    grandeur:  1.30,  // 고래의 거대한 몸집
    warmth:    0.90,  // 차가운 바다, 하지만 생명의 따뜻함
    mystery:   1.20,  // 심해에서 올라오는 신비
  },
  // ── 4: 외고산 옹기마을 ─────────────────────────────────────────
  //  향수·따뜻함에 압도적으로 반응 (흙·불·전통의 정겨움)
  4: {
    amazement: 0.70,  // 잔잔한 감동
    peace:     1.30,  // 고요한 전통 마을
    vitality:  0.75,  // 느리고 차분한 공예
    nostalgia: 1.60,  // ★★ 향수에 가장 민감 — 500년 전통의 그리움
    freshness: 0.60,  // 흙의 따뜻함 → 청량감은 적음
    grandeur:  0.70,  // 소박하고 겸손한 규모
    warmth:    1.55,  // ★ 가마의 온기·흙의 따뜻함
    mystery:   0.80,  // 전통 기술의 오묘한 매력
  },
  // ── 5: 반구대 암각화 ───────────────────────────────────────────
  //  웅장·신비에 압도적으로 반응 (7천 년의 시간이 새겨진 바위)
  5: {
    amazement: 1.25,  // 7천 년 시간의 경이
    peace:     0.90,  // 묵직하고 장엄한 고요
    vitality:  0.55,  // ★★ 활기에 가장 둔감 — 정적인 역사의 장소
    nostalgia: 1.40,  // 인류 최초 기억의 향수
    freshness: 0.70,  // 차갑고 오래된 암반의 분위기
    grandeur:  1.60,  // ★★ 웅장함에 가장 민감 — 7천년의 장엄
    warmth:    0.80,  // 차가운 바위
    mystery:   1.55,  // ★ 선사시대의 깊은 신비
  },
  // ── 6: 대운산 내원암 계곡 ──────────────────────────────────────
  //  평화·신선·신비에 강하게 반응 (산사와 계곡의 성스러운 공간)
  6: {
    amazement: 1.10,  // 아름다운 자연경관
    peace:     1.50,  // ★ 암자의 깊은 고요
    vitality:  1.00,  // 계곡물의 생동감
    nostalgia: 1.20,  // 천년 암자의 시간
    freshness: 1.50,  // ★ 계곡물의 청량함 — 동점 최고
    grandeur:  1.00,  // 중립
    warmth:    1.00,  // 중립
    mystery:   1.30,  // 산사의 영적인 신비
  },
  // ── 7: 울산대교 ────────────────────────────────────────────────
  //  경이·웅장·따뜻함(야경)에 강하게 반응 (도시 야경의 화려함)
  7: {
    amazement: 1.35,  // 야경의 경이
    peace:     0.80,  // 도시의 역동적 분위기
    vitality:  1.30,  // 도시의 에너지
    nostalgia: 0.90,  // 현대적인 장소
    freshness: 0.80,  // 밤공기
    grandeur:  1.40,  // 현수교의 거대한 규모
    warmth:    1.25,  // 황금 야경의 따뜻함
    mystery:   1.20,  // 밤 강물의 신비로운 반영
  },
  // ── 8: 울산대공원 ──────────────────────────────────────────────
  //  평화·따뜻함에 강하게 반응 (가족·공동체의 포근한 공간)
  8: {
    amazement: 0.90,  // 아름다움보다는 편안함
    peace:     1.45,  // ★ 공원의 여유로운 평화
    vitality:  1.20,  // 활동적인 공원 나들이
    nostalgia: 1.15,  // 소풍과 가족의 추억
    freshness: 1.20,  // 공원의 신선한 공기
    grandeur:  0.80,  // 규모보다는 아기자기함
    warmth:    1.45,  // ★ 가족·공동체의 따뜻함 — 동점
    mystery:   0.60,  // ★★ 신비에 가장 둔감 — 밝고 친숙한 공간
  },
  // ── 9: 태화강 국가정원·십리대숲 ──────────────────────────────
  //  평화·신선함에 압도적으로 반응 (대숲의 고요와 청량함)
  9: {
    amazement: 1.00,  // 중립
    peace:     1.60,  // ★★ 평화에 가장 민감 — 대숲의 절대 고요
    vitality:  0.90,  // 백로의 잔잔한 생동감
    nostalgia: 1.20,  // 정겨운 강변과 대숲
    freshness: 1.45,  // ★ 대숲의 서늘하고 맑은 공기
    grandeur:  0.80,  // 아기자기한 대숲 산책
    warmth:    1.10,  // 따뜻한 강변 햇살
    mystery:   0.90,  // 대숲의 고요 속 신비
  },
  // ── 10: 신불산 억새평원 ────────────────────────────────────────
  //  경이·웅장·신선에 강하게 반응 (광활한 황금 억새의 장관)
  10: {
    amazement: 1.40,  // 광활한 억새 평원의 압도적 경이
    peace:     1.20,  // 바람 소리와 억새의 평화
    vitality:  1.10,  // 고산의 바람 에너지
    nostalgia: 1.00,  // 중립
    freshness: 1.30,  // 고산의 청량한 공기
    grandeur:  1.35,  // 드넓은 억새밭의 웅장함
    warmth:    1.10,  // 황금빛 억새의 따뜻함
    mystery:   0.90,  // 안개 낀 능선의 신비
  },
  // ── 11: 가지산 사계 ────────────────────────────────────────────
  //  웅장·신비·경이에 강하게 반응 (영남알프스 최고봉의 변화무쌍함)
  11: {
    amazement: 1.35,  // 사계절 극적 변화의 경이
    peace:     1.10,  // 산 정상의 고요함
    vitality:  1.00,  // 중립
    nostalgia: 1.15,  // 계절마다 다른 추억
    freshness: 1.25,  // 고산의 청량한 공기
    grandeur:  1.40,  // 영남알프스 최고봉의 웅장함
    warmth:    0.90,  // 차가운 산봉우리
    mystery:   1.35,  // 운해 속 봉우리의 신비
  },
};
 
// =============================================================================
// ③ LAYER 3 — 계절별 패널 색채 추가 보정
// =============================================================================
//
// 글로벌 계절 보정(param-synthesizer의 getSeasonModifier)에 더해
// 패널별로 추가로 적용되는 계절 색채 보정값이다.
//
// 형식: { deltaHue, deltaSat, deltaLight, deltaContrast, deltaTemp }
// null = 해당 계절에 이 패널의 추가 보정 없음
//
// [가중치 설계 원칙]
//   계절 민감도가 높은 패널(가지산·신불산·간절곶)은 값이 크고
//   계절과 관계없는 패널(반구대·외고산·울산대교)은 값이 작다
 
export const SEASONAL_PANEL_MODS = {
  // ── 0: 간절곶 일출 (계절별 일출 색감 변화) ───────────────────
  0: {
    spring: { deltaHue: -3,  deltaSat: +0.04, deltaLight: +0.06, deltaContrast: -0.05, deltaTemp: +100 },
    summer: { deltaHue:  0,  deltaSat: +0.06, deltaLight: +0.04, deltaContrast: +0.05, deltaTemp: -50  },
    autumn: { deltaHue: +8,  deltaSat: +0.10, deltaLight: -0.02, deltaContrast: +0.10, deltaTemp: +400 },
    winter: { deltaHue: -5,  deltaSat: -0.05, deltaLight: -0.04, deltaContrast: +0.12, deltaTemp: -200 },
  },
  // ── 1: 대왕암공원 (사계절 해송은 변화 적음) ──────────────────
  1: {
    spring: { deltaHue: -2,  deltaSat: +0.04, deltaLight: +0.04, deltaContrast: -0.04, deltaTemp: +50  },
    summer: { deltaHue:  0,  deltaSat: +0.08, deltaLight: +0.02, deltaContrast: +0.02, deltaTemp: -80  },
    autumn: { deltaHue: +4,  deltaSat: +0.03, deltaLight: -0.02, deltaContrast: +0.04, deltaTemp: +150 },
    winter: { deltaHue: -2,  deltaSat: -0.04, deltaLight: -0.03, deltaContrast: +0.06, deltaTemp: -150 },
  },
  // ── 2: 강동 몽돌해변 (여름이 전성기) ─────────────────────────
  2: {
    spring: { deltaHue: -2,  deltaSat: +0.02, deltaLight: +0.04, deltaContrast: -0.02, deltaTemp: +50  },
    summer: { deltaHue:  0,  deltaSat: +0.12, deltaLight: +0.06, deltaContrast: +0.04, deltaTemp: -200 },
    autumn: { deltaHue: +3,  deltaSat: -0.04, deltaLight: -0.02, deltaContrast: +0.04, deltaTemp: +100 },
    winter: { deltaHue: -4,  deltaSat: -0.10, deltaLight: -0.06, deltaContrast: +0.08, deltaTemp: -300 },
  },
  // ── 3: 장생포 고래 (계절 변화 보통) ──────────────────────────
  3: {
    spring: { deltaHue: -2,  deltaSat: +0.04, deltaLight: +0.03, deltaContrast:  0.00, deltaTemp: +100 },
    summer: { deltaHue:  0,  deltaSat: +0.08, deltaLight: +0.04, deltaContrast: +0.05, deltaTemp: -150 },
    autumn: { deltaHue: +3,  deltaSat: +0.02, deltaLight: -0.02, deltaContrast: +0.06, deltaTemp: +200 },
    winter: { deltaHue: -3,  deltaSat: -0.06, deltaLight: -0.04, deltaContrast: +0.08, deltaTemp: -200 },
  },
  // ── 4: 외고산 옹기 (사계절 큰 변화 없음) ─────────────────────
  4: {
    spring: { deltaHue:  0,  deltaSat: +0.02, deltaLight: +0.03, deltaContrast: -0.02, deltaTemp: +50  },
    summer: { deltaHue:  0,  deltaSat: +0.02, deltaLight: +0.02, deltaContrast:  0.00, deltaTemp: +50  },
    autumn: { deltaHue: +2,  deltaSat: +0.04, deltaLight: -0.01, deltaContrast: +0.02, deltaTemp: +100 },
    winter: { deltaHue: -1,  deltaSat: -0.02, deltaLight: -0.02, deltaContrast: +0.04, deltaTemp: -50  },
  },
  // ── 5: 반구대 암각화 (계절에 가장 둔감 — 바위는 변하지 않는다) ─
  5: {
    spring: { deltaHue:  0,  deltaSat: +0.01, deltaLight: +0.02, deltaContrast: -0.01, deltaTemp: +30  },
    summer: { deltaHue:  0,  deltaSat: +0.02, deltaLight: +0.02, deltaContrast: +0.02, deltaTemp: -30  },
    autumn: { deltaHue: +1,  deltaSat: +0.02, deltaLight: -0.01, deltaContrast: +0.03, deltaTemp: +80  },
    winter: { deltaHue: -1,  deltaSat: -0.01, deltaLight: -0.02, deltaContrast: +0.04, deltaTemp: -80  },
  },
  // ── 6: 대운산 내원암 계곡 (여름 계곡, 가을 단풍) ─────────────
  6: {
    spring: { deltaHue: -4,  deltaSat: +0.06, deltaLight: +0.06, deltaContrast: -0.04, deltaTemp: +50  },
    summer: { deltaHue: -2,  deltaSat: +0.14, deltaLight: +0.08, deltaContrast:  0.00, deltaTemp: -300 },
    autumn: { deltaHue:+12,  deltaSat: +0.12, deltaLight: -0.03, deltaContrast: +0.10, deltaTemp: +400 },
    winter: { deltaHue: -4,  deltaSat: -0.08, deltaLight: -0.06, deltaContrast: +0.12, deltaTemp: -250 },
  },
  // ── 7: 울산대교 (야경은 계절 관계없이 아름다움) ───────────────
  7: {
    spring: { deltaHue: -2,  deltaSat: +0.02, deltaLight: +0.03, deltaContrast: -0.02, deltaTemp: +100 },
    summer: { deltaHue:  0,  deltaSat: +0.04, deltaLight: +0.02, deltaContrast:  0.00, deltaTemp: -50  },
    autumn: { deltaHue: +4,  deltaSat: +0.06, deltaLight: -0.02, deltaContrast: +0.06, deltaTemp: +200 },
    winter: { deltaHue: -3,  deltaSat: -0.04, deltaLight: -0.04, deltaContrast: +0.10, deltaTemp: -150 },
  },
  // ── 8: 울산대공원 (봄 장미 전성기) ───────────────────────────
  8: {
    spring: { deltaHue: -8,  deltaSat: +0.10, deltaLight: +0.08, deltaContrast: -0.06, deltaTemp: +100 },
    summer: { deltaHue:  0,  deltaSat: +0.10, deltaLight: +0.06, deltaContrast: +0.04, deltaTemp: -100 },
    autumn: { deltaHue: +6,  deltaSat: +0.06, deltaLight: -0.02, deltaContrast: +0.06, deltaTemp: +250 },
    winter: { deltaHue: -4,  deltaSat: -0.08, deltaLight: -0.06, deltaContrast: +0.08, deltaTemp: -150 },
  },
  // ── 9: 태화강 국가정원·십리대숲 (사계절 아름답지만 겨울 철새) ─
  9: {
    spring: { deltaHue: -3,  deltaSat: +0.06, deltaLight: +0.05, deltaContrast: -0.04, deltaTemp: +50  },
    summer: { deltaHue: -2,  deltaSat: +0.10, deltaLight: +0.04, deltaContrast: -0.02, deltaTemp: -200 },
    autumn: { deltaHue: +6,  deltaSat: +0.04, deltaLight: -0.02, deltaContrast: +0.06, deltaTemp: +200 },
    winter: { deltaHue: -2,  deltaSat: -0.04, deltaLight: -0.04, deltaContrast: +0.08, deltaTemp: -100 },
  },
  // ── 10: 신불산 억새평원 (가을 억새 황금빛 절정) ───────────────
  10: {
    spring: { deltaHue: -8,  deltaSat: +0.06, deltaLight: +0.06, deltaContrast: -0.06, deltaTemp: +50  },
    summer: { deltaHue: -4,  deltaSat: +0.06, deltaLight: +0.04, deltaContrast: +0.02, deltaTemp: -150 },
    autumn: { deltaHue:+15,  deltaSat: +0.18, deltaLight: +0.04, deltaContrast: +0.12, deltaTemp: +600 },  // ★ 가을 황금빛
    winter: { deltaHue: -8,  deltaSat: -0.14, deltaLight: -0.06, deltaContrast: +0.14, deltaTemp: -400 },
  },
  // ── 11: 가지산 사계 (계절에 가장 민감) ────────────────────────
  11: {
    spring: { deltaHue:-14,  deltaSat: +0.06, deltaLight: +0.08, deltaContrast: -0.08, deltaTemp: +80  },  // 봄 철쭉 분홍
    summer: { deltaHue: -4,  deltaSat: +0.12, deltaLight: +0.04, deltaContrast: +0.04, deltaTemp: -200 },  // 짙은 여름 초록
    autumn: { deltaHue:+22,  deltaSat: +0.18, deltaLight: -0.02, deltaContrast: +0.14, deltaTemp: +550 },  // ★★ 가을 단풍 최고
    winter: { deltaHue: -8,  deltaSat: -0.18, deltaLight: -0.04, deltaContrast: +0.18, deltaTemp: -450 },  // 설백 설경
  },
};
 
// =============================================================================
// ④ LAYER 4 — 시간대별 패널 색채 추가 보정
// =============================================================================
//
// 시간대가 해당 패널의 "대표 시간"이면 강한 보정 적용
// 관계없는 시간대면 중립(0) 또는 약한 보정
//
// 형식: { deltaHue, deltaSat, deltaLight, deltaContrast, deltaTemp }
 
export const TIME_PANEL_MODS = {
  // ── 0: 간절곶 일출 (아침이 본연의 시간) ─────────────────────
  0: {
    morning:   { deltaHue: +4,  deltaSat: +0.12, deltaLight: +0.10, deltaContrast: +0.12, deltaTemp: +300 },  // ★ 최고
    afternoon: { deltaHue:  0,  deltaSat: +0.06, deltaLight: +0.04, deltaContrast: +0.04, deltaTemp: +100 },
    evening:   { deltaHue: +6,  deltaSat: +0.08, deltaLight: -0.02, deltaContrast: +0.08, deltaTemp: +400 },
    night:     { deltaHue: -4,  deltaSat: -0.08, deltaLight: -0.10, deltaContrast: +0.08, deltaTemp: -200 },
  },
  // ── 1: 대왕암공원 (낮이 최고, 밤에는 인상 약함) ──────────────
  1: {
    morning:   { deltaHue: -2,  deltaSat: +0.04, deltaLight: +0.05, deltaContrast: -0.02, deltaTemp: +50  },
    afternoon: { deltaHue:  0,  deltaSat: +0.08, deltaLight: +0.04, deltaContrast: +0.04, deltaTemp: -50  },
    evening:   { deltaHue: +4,  deltaSat: +0.04, deltaLight: -0.04, deltaContrast: +0.06, deltaTemp: +200 },
    night:     { deltaHue:  0,  deltaSat: -0.10, deltaLight: -0.12, deltaContrast: +0.06, deltaTemp: -100 },
  },
  // ── 2: 강동 몽돌해변 (낮 해수욕이 대표 시간) ─────────────────
  2: {
    morning:   { deltaHue: -4,  deltaSat: +0.06, deltaLight: +0.06, deltaContrast: +0.04, deltaTemp: -100 },
    afternoon: { deltaHue:  0,  deltaSat: +0.10, deltaLight: +0.06, deltaContrast: +0.06, deltaTemp: -150 },  // ★
    evening:   { deltaHue: +6,  deltaSat: +0.04, deltaLight: -0.04, deltaContrast: +0.08, deltaTemp: +300 },
    night:     { deltaHue: -4,  deltaSat: -0.08, deltaLight: -0.10, deltaContrast: +0.10, deltaTemp: -200 },
  },
  // ── 3: 장생포 고래 (낮 활동 → 아침·낮이 좋음) ───────────────
  3: {
    morning:   { deltaHue: -2,  deltaSat: +0.06, deltaLight: +0.05, deltaContrast: +0.04, deltaTemp: -50  },
    afternoon: { deltaHue:  0,  deltaSat: +0.08, deltaLight: +0.04, deltaContrast: +0.06, deltaTemp: -100 },  // ★
    evening:   { deltaHue: +4,  deltaSat: +0.04, deltaLight: -0.04, deltaContrast: +0.08, deltaTemp: +200 },
    night:     { deltaHue: -2,  deltaSat: -0.06, deltaLight: -0.08, deltaContrast: +0.10, deltaTemp: -150 },
  },
  // ── 4: 외고산 옹기 (낮 작업 → 오후 햇살이 좋음) ─────────────
  4: {
    morning:   { deltaHue:  0,  deltaSat: +0.02, deltaLight: +0.03, deltaContrast: -0.02, deltaTemp: +50  },
    afternoon: { deltaHue: +2,  deltaSat: +0.04, deltaLight: +0.04, deltaContrast:  0.00, deltaTemp: +200 },  // ★
    evening:   { deltaHue: +4,  deltaSat: +0.04, deltaLight: -0.03, deltaContrast: +0.04, deltaTemp: +300 },
    night:     { deltaHue: -2,  deltaSat: -0.04, deltaLight: -0.08, deltaContrast: +0.06, deltaTemp: +100 },
  },
  // ── 5: 반구대 암각화 (오전 측면 조명이 암각화를 드러냄) ───────
  5: {
    morning:   { deltaHue: -2,  deltaSat: +0.06, deltaLight: +0.04, deltaContrast: +0.10, deltaTemp: +100 },  // ★ 측면 조명
    afternoon: { deltaHue:  0,  deltaSat: +0.02, deltaLight: +0.02, deltaContrast: -0.04, deltaTemp: +50  },
    evening:   { deltaHue: +4,  deltaSat: +0.04, deltaLight: -0.04, deltaContrast: +0.12, deltaTemp: +300 },
    night:     { deltaHue:  0,  deltaSat: -0.06, deltaLight: -0.10, deltaContrast: +0.14, deltaTemp: -50  },
  },
  // ── 6: 대운산 계곡 (낮 계곡이 최고) ─────────────────────────
  6: {
    morning:   { deltaHue: -2,  deltaSat: +0.06, deltaLight: +0.08, deltaContrast: -0.04, deltaTemp: -100 },
    afternoon: { deltaHue:  0,  deltaSat: +0.10, deltaLight: +0.08, deltaContrast: +0.02, deltaTemp: -200 },  // ★
    evening:   { deltaHue: +4,  deltaSat: +0.04, deltaLight: -0.04, deltaContrast: +0.06, deltaTemp: +150 },
    night:     { deltaHue: -4,  deltaSat: -0.08, deltaLight: -0.12, deltaContrast: +0.10, deltaTemp: -100 },
  },
  // ── 7: 울산대교 (야경이 대표 → 밤 최고) ────────────────────
  7: {
    morning:   { deltaHue: -2,  deltaSat: -0.04, deltaLight: +0.04, deltaContrast: -0.04, deltaTemp: -50  },
    afternoon: { deltaHue:  0,  deltaSat:  0.00, deltaLight: +0.02, deltaContrast:  0.00, deltaTemp:  0   },
    evening:   { deltaHue: +6,  deltaSat: +0.08, deltaLight: -0.02, deltaContrast: +0.10, deltaTemp: +300 },
    night:     { deltaHue: +4,  deltaSat: +0.14, deltaLight: -0.08, deltaContrast: +0.20, deltaTemp: +200 },  // ★★ 야경 최고
  },
  // ── 8: 울산대공원 (낮 나들이가 핵심) ─────────────────────────
  8: {
    morning:   { deltaHue: -4,  deltaSat: +0.06, deltaLight: +0.06, deltaContrast: -0.04, deltaTemp: +50  },
    afternoon: { deltaHue:  0,  deltaSat: +0.10, deltaLight: +0.08, deltaContrast: +0.04, deltaTemp: +50  },  // ★
    evening:   { deltaHue: +6,  deltaSat: +0.06, deltaLight: -0.02, deltaContrast: +0.06, deltaTemp: +300 },
    night:     { deltaHue: -2,  deltaSat: -0.06, deltaLight: -0.10, deltaContrast: +0.06, deltaTemp: -50  },
  },
  // ── 9: 태화강 대숲 (새벽·아침 백로 군무가 절경) ──────────────
  9: {
    morning:   { deltaHue: -2,  deltaSat: +0.08, deltaLight: +0.08, deltaContrast: -0.06, deltaTemp: -100 },  // ★ 백로 군무
    afternoon: { deltaHue:  0,  deltaSat: +0.08, deltaLight: +0.04, deltaContrast: -0.02, deltaTemp: -100 },
    evening:   { deltaHue: +4,  deltaSat: +0.04, deltaLight: -0.02, deltaContrast: +0.04, deltaTemp: +150 },
    night:     { deltaHue: -2,  deltaSat: -0.06, deltaLight: -0.08, deltaContrast: +0.06, deltaTemp: -50  },
  },
  // ── 10: 신불산 억새 (오후 역광이 억새를 황금빛으로) ──────────
  10: {
    morning:   { deltaHue: -4,  deltaSat: +0.06, deltaLight: +0.08, deltaContrast: -0.02, deltaTemp: -100 },
    afternoon: { deltaHue: +4,  deltaSat: +0.10, deltaLight: +0.06, deltaContrast: +0.06, deltaTemp: +200 },
    evening:   { deltaHue:+10,  deltaSat: +0.14, deltaLight: +0.02, deltaContrast: +0.14, deltaTemp: +500 },  // ★ 역광 황금빛
    night:     { deltaHue: -4,  deltaSat: -0.10, deltaLight: -0.12, deltaContrast: +0.10, deltaTemp: -150 },
  },
  // ── 11: 가지산 사계 (운해는 아침, 설경은 이른 아침) ──────────
  11: {
    morning:   { deltaHue: -4,  deltaSat: +0.06, deltaLight: +0.06, deltaContrast: +0.04, deltaTemp: -150 },  // ★ 운해·안개
    afternoon: { deltaHue:  0,  deltaSat: +0.08, deltaLight: +0.04, deltaContrast: +0.04, deltaTemp: -50  },
    evening:   { deltaHue: +6,  deltaSat: +0.08, deltaLight: -0.04, deltaContrast: +0.10, deltaTemp: +300 },
    night:     { deltaHue: -4,  deltaSat: -0.08, deltaLight: -0.10, deltaContrast: +0.12, deltaTemp: -200 },
  },
};
 
// =============================================================================
// ⑤ LAYER 5 — 동행자 유형별 패널 색채 추가 보정
// =============================================================================
//
// 장소의 분위기와 동행자의 감성이 교차할 때 색채에 추가 영향을 준다.
// 예) 연인과 함께한 간절곶 일출 → 더욱 따뜻하고 낭만적인 색감
 
export const COMPANION_PANEL_MODS = {
  // ── 0: 간절곶 일출 ─────────────────────────────────────────────
  0: {
    solo:    { deltaHue: -2,  deltaSat: -0.04, deltaLight: -0.02, deltaTemp: -100 },  // 홀로 새벽 → 차분
    couple:  { deltaHue: +6,  deltaSat: +0.06, deltaLight: +0.03, deltaTemp: +400 },  // ★ 연인 → 가장 낭만적
    family:  { deltaHue: +3,  deltaSat: +0.04, deltaLight: +0.05, deltaTemp: +200 },
    friends: { deltaHue:  0,  deltaSat: +0.06, deltaLight: +0.04, deltaTemp: +100 },
  },
  // ── 1: 대왕암공원 ──────────────────────────────────────────────
  1: {
    solo:    { deltaHue:  0,  deltaSat: -0.04, deltaLight: -0.02, deltaTemp: -50  },
    couple:  { deltaHue: +2,  deltaSat: +0.04, deltaLight: +0.02, deltaTemp: +100 },
    family:  { deltaHue:  0,  deltaSat: +0.04, deltaLight: +0.04, deltaTemp: +50  },  // ★ 가족 소풍
    friends: { deltaHue:  0,  deltaSat: +0.06, deltaLight: +0.02, deltaTemp:  0   },
  },
  // ── 2: 강동 몽돌해변 ───────────────────────────────────────────
  2: {
    solo:    { deltaHue: -2,  deltaSat: -0.06, deltaLight: -0.02, deltaTemp: -100 },
    couple:  { deltaHue: +2,  deltaSat: +0.04, deltaLight: +0.02, deltaTemp: +100 },
    family:  { deltaHue:  0,  deltaSat: +0.06, deltaLight: +0.06, deltaTemp: +50  },  // ★ 아이들과
    friends: { deltaHue:  0,  deltaSat: +0.08, deltaLight: +0.04, deltaTemp: -50  },
  },
  // ── 3: 장생포 고래문화마을 ─────────────────────────────────────
  3: {
    solo:    { deltaHue:  0,  deltaSat: -0.02, deltaLight: -0.02, deltaTemp: -50  },
    couple:  { deltaHue: +2,  deltaSat: +0.04, deltaLight: +0.02, deltaTemp: +100 },
    family:  { deltaHue:  0,  deltaSat: +0.06, deltaLight: +0.04, deltaTemp:  0   },  // ★ 아이들과 고래 관람
    friends: { deltaHue:  0,  deltaSat: +0.08, deltaLight: +0.02, deltaTemp: -50  },
  },
  // ── 4: 외고산 옹기마을 ─────────────────────────────────────────
  4: {
    solo:    { deltaHue:  0,  deltaSat: -0.04, deltaLight: -0.02, deltaTemp: +100 },  // ★ 홀로 → 더 깊은 성찰
    couple:  { deltaHue: +3,  deltaSat: +0.02, deltaLight: +0.02, deltaTemp: +200 },
    family:  { deltaHue: +2,  deltaSat: +0.04, deltaLight: +0.04, deltaTemp: +150 },
    friends: { deltaHue:  0,  deltaSat: +0.04, deltaLight: +0.02, deltaTemp: +50  },
  },
  // ── 5: 반구대 암각화 ───────────────────────────────────────────
  5: {
    solo:    { deltaHue: -2,  deltaSat: -0.06, deltaLight: -0.04, deltaTemp: +50  },  // ★ 홀로 → 깊은 사색
    couple:  { deltaHue:  0,  deltaSat: +0.02, deltaLight: +0.02, deltaTemp: +100 },
    family:  { deltaHue:  0,  deltaSat: +0.04, deltaLight: +0.04, deltaTemp: +50  },
    friends: { deltaHue: +2,  deltaSat: +0.04, deltaLight: +0.02, deltaTemp:  0   },
  },
  // ── 6: 대운산 내원암 계곡 ──────────────────────────────────────
  6: {
    solo:    { deltaHue: -2,  deltaSat: -0.04, deltaLight: -0.02, deltaTemp: -100 },  // ★ 홀로 명상
    couple:  { deltaHue: +2,  deltaSat: +0.04, deltaLight: +0.02, deltaTemp: +100 },
    family:  { deltaHue:  0,  deltaSat: +0.06, deltaLight: +0.06, deltaTemp:  0   },
    friends: { deltaHue:  0,  deltaSat: +0.06, deltaLight: +0.04, deltaTemp: -50  },
  },
  // ── 7: 울산대교 ────────────────────────────────────────────────
  7: {
    solo:    { deltaHue: -2,  deltaSat: -0.02, deltaLight: -0.04, deltaTemp: -50  },
    couple:  { deltaHue: +4,  deltaSat: +0.08, deltaLight: -0.02, deltaTemp: +300 },  // ★ 야경 연인
    family:  { deltaHue: +2,  deltaSat: +0.04, deltaLight: +0.02, deltaTemp: +150 },
    friends: { deltaHue:  0,  deltaSat: +0.08, deltaLight:  0.00, deltaTemp: +100 },
  },
  // ── 8: 울산대공원 ──────────────────────────────────────────────
  8: {
    solo:    { deltaHue: -2,  deltaSat: -0.04, deltaLight: +0.02, deltaTemp:  0   },
    couple:  { deltaHue: +4,  deltaSat: +0.06, deltaLight: +0.03, deltaTemp: +200 },
    family:  { deltaHue: +2,  deltaSat: +0.06, deltaLight: +0.08, deltaTemp: +100 },  // ★ 가족 공원 나들이
    friends: { deltaHue:  0,  deltaSat: +0.10, deltaLight: +0.04, deltaTemp:  0   },
  },
  // ── 9: 태화강 대숲 ─────────────────────────────────────────────
  9: {
    solo:    { deltaHue: -2,  deltaSat: -0.04, deltaLight: -0.02, deltaTemp: -100 },  // ★ 홀로 힐링
    couple:  { deltaHue: +2,  deltaSat: +0.04, deltaLight: +0.02, deltaTemp: +100 },
    family:  { deltaHue:  0,  deltaSat: +0.06, deltaLight: +0.06, deltaTemp: +50  },
    friends: { deltaHue:  0,  deltaSat: +0.06, deltaLight: +0.04, deltaTemp:  0   },
  },
  // ── 10: 신불산 억새평원 ────────────────────────────────────────
  10: {
    solo:    { deltaHue: +2,  deltaSat: +0.04, deltaLight: +0.02, deltaTemp: +100 },  // 홀로 등산
    couple:  { deltaHue: +6,  deltaSat: +0.08, deltaLight: +0.02, deltaTemp: +400 },  // ★ 연인 → 황금빛 억새
    family:  { deltaHue: +2,  deltaSat: +0.06, deltaLight: +0.06, deltaTemp: +200 },
    friends: { deltaHue:  0,  deltaSat: +0.08, deltaLight: +0.04, deltaTemp: +100 },
  },
  // ── 11: 가지산 사계 ────────────────────────────────────────────
  11: {
    solo:    { deltaHue: -2,  deltaSat: +0.02, deltaLight:  0.00, deltaTemp: -100 },  // 홀로 등산
    couple:  { deltaHue: +4,  deltaSat: +0.06, deltaLight: +0.02, deltaTemp: +200 },
    family:  { deltaHue: +2,  deltaSat: +0.06, deltaLight: +0.06, deltaTemp: +100 },
    friends: { deltaHue:  0,  deltaSat: +0.10, deltaLight: +0.04, deltaTemp:  0   },  // ★ 친구들과 등산
  },
};
 
// =============================================================================
// ⑥ 헬퍼 함수 (Accessor Functions)
// =============================================================================
 
/**
 * 인덱스로 패널의 기본 6종 가중치를 반환한다.
 *
 * @param {number} spotIndex  0~11
 * @returns {{ hue:number, sat:number, light:number, contrast:number, temp:number, lightDir:number } | null}
 */
export function getWeights(spotIndex) {
  return PANEL_WEIGHTS[spotIndex] ?? null;
}
 
/**
 * 패널의 특정 감성에 대한 반응 배수를 반환한다.
 *
 * @param {number} spotIndex
 * @param {string} emotionKey  'amazement'|'peace'|'vitality'|'nostalgia'|
 *                             'freshness'|'grandeur'|'warmth'|'mystery'
 * @returns {number} 반응 배수 (기본 1.0)
 */
export function getEmotionResponse(spotIndex, emotionKey) {
  return EMOTION_RESPONSE_MATRIX[spotIndex]?.[emotionKey] ?? 1.0;
}
 
/**
 * 패널의 계절별 색채 추가 보정값을 반환한다.
 *
 * @param {number} spotIndex
 * @param {string|null} season  'spring'|'summer'|'autumn'|'winter'|null
 * @returns {Object} 보정값 (season이 null이면 전부 0)
 */
export function getSeasonalMod(spotIndex, season) {
  const ZERO = { deltaHue: 0, deltaSat: 0, deltaLight: 0, deltaContrast: 0, deltaTemp: 0 };
  if (!season) return ZERO;
  return SEASONAL_PANEL_MODS[spotIndex]?.[season] ?? ZERO;
}
 
/**
 * 패널의 시간대별 색채 추가 보정값을 반환한다.
 *
 * @param {number} spotIndex
 * @param {string|null} timeContext  'morning'|'afternoon'|'evening'|'night'|null
 * @returns {Object} 보정값
 */
export function getTimeMod(spotIndex, timeContext) {
  const ZERO = { deltaHue: 0, deltaSat: 0, deltaLight: 0, deltaContrast: 0, deltaTemp: 0 };
  if (!timeContext) return ZERO;
  return TIME_PANEL_MODS[spotIndex]?.[timeContext] ?? ZERO;
}
 
/**
 * 패널의 동행자별 색채 추가 보정값을 반환한다.
 *
 * @param {number} spotIndex
 * @param {string|null} companion  'solo'|'couple'|'family'|'friends'|null
 * @returns {Object} 보정값
 */
export function getCompanionMod(spotIndex, companion) {
  const ZERO = { deltaHue: 0, deltaSat: 0, deltaLight: 0, deltaTemp: 0 };
  if (!companion) return ZERO;
  return COMPANION_PANEL_MODS[spotIndex]?.[companion] ?? ZERO;
}
 
/**
 * 특정 패널의 모든 가중치·보정값을 통합한 완전한 설정 객체를 반환한다.
 * panel-individualizer.js에서 이 함수를 호출하여 사용한다.
 *
 * @param {number} spotIndex
 * @param {Object} [context]
 * @param {string|null} [context.season]
 * @param {string|null} [context.timeContext]
 * @param {string|null} [context.companion]
 * @returns {Object}
 */
export function getFullPanelConfig(spotIndex, context = {}) {
  const { season = null, timeContext = null, companion = null } = context;
  return {
    index:         spotIndex,
    weights:       getWeights(spotIndex),
    emotionMatrix: EMOTION_RESPONSE_MATRIX[spotIndex],
    seasonalMod:   getSeasonalMod(spotIndex, season),
    timeMod:       getTimeMod(spotIndex, timeContext),
    companionMod:  getCompanionMod(spotIndex, companion),
  };
}
 
/**
 * 8차원 감성 점수에 감성 반응 행렬을 적용하여 패널 보정된 감성 점수를 반환한다.
 *
 * @param {number} spotIndex
 * @param {Object} emotionScores  { amazement:0~100, ... }
 * @returns {Object} 패널 개성이 반영된 감성 점수
 */
export function applyEmotionMatrix(spotIndex, emotionScores) {
  const matrix = EMOTION_RESPONSE_MATRIX[spotIndex];
  if (!matrix) return emotionScores;
 
  const result = {};
  for (const [key, score] of Object.entries(emotionScores)) {
    const multiplier = matrix[key] ?? 1.0;
    result[key] = Math.min(100, Math.max(0, score * multiplier));
  }
  return result;
}
 
// =============================================================================
// ⑦ 디버그 유틸리티
// =============================================================================
 
import { SPOTS } from './spot-palettes.js';
 
/**
 * 모든 패널의 가중치 요약을 콘솔에 출력한다. (개발 전용)
 * @param {number} [highlightIndex]  강조할 패널 인덱스
 */
export function debugPrintWeights(highlightIndex = -1) {
  /* eslint-disable no-console */
  console.group('⚖️ PANEL_WEIGHTS — 울산 12경 색채 파라미터 감도');
 
  const headers = ['idx', '경승지', 'Hue', 'Sat', 'Light', 'Con', 'Temp', 'LDir'];
  console.log(headers.join('\t'));
  console.log('─'.repeat(80));
 
  for (let i = 0; i <= 11; i++) {
    const w    = PANEL_WEIGHTS[i];
    const name = (SPOTS[i]?.shortName ?? `[${i}]`).padEnd(8);
    const mark = i === highlightIndex ? '★' : ' ';
    console.log(
      `${mark}[${i}]\t${name}\t` +
      `${w.hue.toFixed(2)}\t${w.sat.toFixed(2)}\t` +
      `${w.light.toFixed(2)}\t${w.contrast.toFixed(2)}\t` +
      `${w.temp.toFixed(2)}\t${w.lightDir.toFixed(2)}`
    );
  }
 
  console.groupEnd();
 
  console.group('🧬 EMOTION_RESPONSE_MATRIX — 감성 직접 반응');
  const emoKeys = ['ama','pea','vit','nos','fre','gra','war','mys'];
  console.log(['idx','경승지',...emoKeys].join('\t'));
  console.log('─'.repeat(80));
 
  for (let i = 0; i <= 11; i++) {
    const m    = EMOTION_RESPONSE_MATRIX[i];
    const name = (SPOTS[i]?.shortName ?? `[${i}]`).padEnd(8);
    const vals = [m.amazement,m.peace,m.vitality,m.nostalgia,
                  m.freshness,m.grandeur,m.warmth,m.mystery]
      .map(v => v.toFixed(2));
    console.log(`[${i}]\t${name}\t${vals.join('\t')}`);
  }
 
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  PANEL_WEIGHTS,
  EMOTION_RESPONSE_MATRIX,
  SEASONAL_PANEL_MODS,
  TIME_PANEL_MODS,
  COMPANION_PANEL_MODS,
  getWeights,
  getEmotionResponse,
  getSeasonalMod,
  getTimeMod,
  getCompanionMod,
  getFullPanelConfig,
  applyEmotionMatrix,
  debugPrintWeights,
};