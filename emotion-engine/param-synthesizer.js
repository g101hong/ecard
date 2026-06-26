/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — 색채 파라미터 합성 모듈
 * @module emotion-engine/param-synthesizer
 *
 * ─────────────────────────────────────────────────────────────────
 * PIPELINE STAGE 3 : ExtractionResult → GlobalColorParams
 * ─────────────────────────────────────────────────────────────────
 *
 * 역할:
 *   AI가 추출한 8차원 감성 점수와 맥락 분석 결과를
 *   스테인드글라스 WebGL 렌더링에 직접 사용되는
 *   6개 글로벌 색채 파라미터로 수학적 변환한다.
 *
 * 입력:  ExtractionResult  (ai-extractor.js 출력)
 * 출력:  GlobalColorParams (panel-individualizer.js 입력)
 *
 * ─────────────────────────────────────────────────────────────────
 * [6개 글로벌 색채 파라미터]
 *
 *   1. deltaHue       색조 이동량     단위: ° (-25 ~ +25)
 *   2. deltaSat       채도 배수       단위: × (0.50 ~ 1.45)
 *   3. deltaLight     명도 조정량     단위: L (−0.20 ~ +0.20)
 *   4. deltaContrast  명암대비 배수   단위: × (0.65 ~ 1.45)
 *   5. colorTemp      색온도 오프셋   단위: K (−1500 ~ +1500)
 *   6. lightDir       광원 방향       단위: ° (−35 ~ +35)
 *
 * [3개 유리 재질 파라미터 (WebGL MeshPhysicalMaterial)]
 *
 *   7. glassTransmission  유리 투과율  (0.65 ~ 0.92)
 *   8. glassRoughness     유리 표면 거칠기 (0.02 ~ 0.12)
 *   9. leadMetalness      납선 금속성  (0.82 ~ 0.98)
 */
 
'use strict';
 
// =============================================================================
// ① 파라미터 범위 상수 (Clamping Limits)
// =============================================================================
 
const LIMITS = {
  deltaHue:          { min: -25,   max: +25   },
  deltaSat:          { min:  0.50, max:  1.45 },
  deltaLight:        { min: -0.20, max: +0.20 },
  deltaContrast:     { min:  0.65, max:  1.45 },
  colorTemp:         { min: -1500, max: +1500  },
  lightDir:          { min: -35,   max: +35   },
  glassTransmission: { min:  0.65, max:  0.92 },
  glassRoughness:    { min:  0.02, max:  0.12 },
  leadMetalness:     { min:  0.82, max:  0.98 },
};
 
// =============================================================================
// ② 유틸리티 함수
// =============================================================================
 
/**
 * 값을 [min, max] 범위로 제한한다.
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
 
/**
 * LIMITS 상수를 사용해 파라미터 키에 맞는 clamp를 적용한다.
 * @param {string} key  - LIMITS의 키
 * @param {number} value
 * @returns {number}
 */
const limit = (key, value) => clamp(value, LIMITS[key].min, LIMITS[key].max);
 
/**
 * 0~100 점수를 0~1 로 정규화한다.
 * @param {number} score
 * @returns {number}
 */
const norm = (score) => clamp(score, 0, 100) / 100;
 
// =============================================================================
// ③ 핵심 수식 — 감성 점수 → 6개 색채 파라미터
// =============================================================================
 
/**
 * 8차원 감성 점수에서 6개 글로벌 색채 파라미터를 계산한다.
 *
 * [수식 설계 철학]
 *   - 각 파라미터는 감성의 "대립쌍"으로 구동된다
 *     예) 따뜻함↑ vs 청량함↑ → 색온도 방향 결정
 *   - 단일 감성이 파라미터 하나를 독점하지 않음
 *   - 기저값(베이스라인)을 중심으로 감성이 미세 조정하는 방식
 *
 * @param {Object} scores - 8차원 감성 점수 (각 0~100)
 * @returns {Object} 6개 파라미터 (범위 보정 전)
 */
function computeCoreParams(scores) {
  // 0~1 정규화된 값으로 작업
  const E = {
    amazement: norm(scores.amazement),
    peace:     norm(scores.peace),
    vitality:  norm(scores.vitality),
    nostalgia: norm(scores.nostalgia),
    freshness: norm(scores.freshness),
    grandeur:  norm(scores.grandeur),
    warmth:    norm(scores.warmth),
    mystery:   norm(scores.mystery),
  };
 
  /* ────────────────────────────────────────────────────────────
     파라미터 1: ΔHue (색조 이동, 단위: °)
     ─ 양수: 따뜻한 방향 (오렌지·황금·빨강)
     ─ 음수: 차가운 방향 (파랑·보라·청록)
 
     구동 감성:
       warmth  ↑ → 붉은 계열 이동  (+18°까지)
       freshness↑ → 청색 계열 이동  (-18°까지)
       nostalgia↑ → 앰버·세피아 (+8°)
       amazement↑ → 바이올렛 방향  (-8°)
       mystery ↑ → 보라 방향       (+12° 반대쪽)
  ──────────────────────────────────────────────────────────── */
  const deltaHue =
    (E.warmth    - E.freshness)  * 18   // 온도감 주축
  + (E.nostalgia - E.amazement)  *  8   // 향수↔경이 보조축
  +  E.mystery                   * 12   // 신비→보라
  -  6;                                  // 중심 보정 (warm bias 제거)
 
  /* ────────────────────────────────────────────────────────────
     파라미터 2: ΔSaturation (채도 배수)
     ─ 1.0 기준 / >1.0: 비비드 / <1.0: 뮤트·차분
 
     구동 감성:
       amazement + vitality ↑ → 비비드 (유리가 선명하게 빛남)
       peace + nostalgia    ↑ → 뮤트   (은은하고 부드럽게)
       grandeur             ↑ → 약간 채도↑ (깊이 있는 채색)
  ──────────────────────────────────────────────────────────── */
  const deltaSat = clamp(
    0.70
  + (E.amazement + E.vitality)            * 0.30
  - (E.peace     + E.nostalgia)           * 0.18
  +  E.grandeur                           * 0.08
  , 0.50, 1.45
  );
 
  /* ────────────────────────────────────────────────────────────
     파라미터 3: ΔLightness (명도 조정)
     ─ 양수: 밝게 / 음수: 어둡게
 
     구동 감성:
       vitality + freshness ↑ → 밝고 투명한 유리
       grandeur + mystery   ↑ → 어둡고 깊은 색감
       warmth               ↑ → 약간 밝게 (따뜻한 빛감)
  ──────────────────────────────────────────────────────────── */
  const deltaLight = clamp(
    (E.vitality  + E.freshness) *  0.14
  - (E.grandeur  + E.mystery)   *  0.12
  +  E.warmth                   *  0.05
  -  0.03                             // 중심 보정
  , -0.20, +0.20
  );
 
  /* ────────────────────────────────────────────────────────────
     파라미터 4: ΔContrast (명암대비 배수)
     ─ 1.0 기준 / >1.0: 하이 콘트라스트 / <1.0: 소프트
 
     구동 감성:
       amazement + grandeur ↑ → 강한 빛과 그림자 대비
       peace + nostalgia    ↑ → 부드럽고 균일한 명암
       mystery              ↑ → 극적인 명암 대비
  ──────────────────────────────────────────────────────────── */
  const deltaContrast = clamp(
    0.80
  + (E.amazement + E.grandeur)            * 0.28
  - (E.peace     + E.nostalgia)           * 0.15
  +  E.mystery                            * 0.10
  , 0.65, 1.45
  );
 
  /* ────────────────────────────────────────────────────────────
     파라미터 5: ColorTemp (색온도 오프셋, 단위: K)
     ─ 양수(+K): 따뜻한 빛 (황금·앰버·오렌지)
     ─ 음수(-K): 차가운 빛 (청백·아이시 블루)
 
     구동 감성:
       warmth    ↑ → 깊은 황금빛
       freshness ↑ → 청명한 청백색
       nostalgia ↑ → 앰버·세피아 (오래된 사진 느낌)
       mystery   ↑ → 약간 차갑게 (신비로운 달빛)
  ──────────────────────────────────────────────────────────── */
  const colorTemp =
    (E.warmth    - E.freshness) * 1400
  +  E.nostalgia                *  700
  -  E.mystery                  *  350;
 
  /* ────────────────────────────────────────────────────────────
     파라미터 6: LightDir (광원 방향, 단위: °)
     ─ 0°  = 정상단 (정오 태양)
     ─ 양수 = 오른쪽 이동 (오후·저녁)
     ─ 음수 = 왼쪽 이동  (오전·새벽)
 
     구동 감성:
       warmth    ↑ → 오른쪽 하단 (석양 방향)
       freshness ↑ → 왼쪽 상단  (새벽 방향)
       vitality  ↑ → 정중앙 상단 (정오 방향)
       peace     ↑ → 부드러운 확산광 (방향성 약화)
  ──────────────────────────────────────────────────────────── */
  const lightDir =
    (E.warmth   - E.freshness) * 25
  + (E.vitality - E.peace)     * 10;
 
  return { deltaHue, deltaSat, deltaLight, deltaContrast, colorTemp, lightDir };
}
 
// =============================================================================
// ④ 맥락 보정값 계산 (Context Modifiers)
// =============================================================================
 
/**
 * 시간대 맥락에 따른 파라미터 보정값을 반환한다.
 *
 * @param {string|null} timeContext - 'morning'|'afternoon'|'evening'|'night'|null
 * @returns {Object} 파라미터 델타값
 */
function getTimeModifier(timeContext) {
  const MODS = {
    morning: {
      // 새벽·아침: 청명한 빛, 약간 쿨, 밝게
      deltaHue:      -4,
      deltaSat:      +0.06,
      deltaLight:    +0.08,
      deltaContrast: +0.05,
      colorTemp:     -200,
      lightDir:      -12,
    },
    afternoon: {
      // 낮: 강한 채도, 밝고 선명
      deltaHue:       0,
      deltaSat:      +0.10,
      deltaLight:    +0.05,
      deltaContrast: +0.10,
      colorTemp:     +100,
      lightDir:       0,
    },
    evening: {
      // 저녁·노을: 따뜻한 황금빛, 강한 대비
      deltaHue:      +8,
      deltaSat:      +0.08,
      deltaLight:    -0.04,
      deltaContrast: +0.12,
      colorTemp:     +600,
      lightDir:      +20,
    },
    night: {
      // 밤·야경: 어둡고 신비로운, 강한 명암
      deltaHue:      +5,
      deltaSat:      -0.08,
      deltaLight:    -0.12,
      deltaContrast: +0.18,
      colorTemp:     -300,
      lightDir:      +5,
    },
  };
 
  return MODS[timeContext] || {
    deltaHue: 0, deltaSat: 0, deltaLight: 0,
    deltaContrast: 0, colorTemp: 0, lightDir: 0,
  };
}
 
/**
 * 계절 맥락에 따른 파라미터 보정값을 반환한다.
 *
 * @param {string|null} seasonContext - 'spring'|'summer'|'autumn'|'winter'|null
 * @returns {Object} 파라미터 델타값
 */
function getSeasonModifier(seasonContext) {
  const MODS = {
    spring: {
      // 봄: 파스텔·밝고 가볍게, 핑크·연초록 방향
      deltaHue:      -6,    // 핑크·라벤더 방향
      deltaSat:      -0.05, // 파스텔 느낌
      deltaLight:    +0.08, // 밝고 가볍게
      deltaContrast: -0.08,
      colorTemp:     +100,
      lightDir:      -5,
    },
    summer: {
      // 여름: 선명하고 강렬한 색, 청량한 색온도
      deltaHue:      -3,
      deltaSat:      +0.12, // 강렬한 채도
      deltaLight:    +0.05,
      deltaContrast: +0.08,
      colorTemp:     -300,  // 시원한 색온도
      lightDir:       0,
    },
    autumn: {
      // 가을: 황금·붉은 계열, 따뜻하고 깊게
      deltaHue:      +10,   // 황금·오렌지 방향
      deltaSat:      +0.08,
      deltaLight:    -0.05, // 약간 어둡게 (깊이감)
      deltaContrast: +0.10,
      colorTemp:     +500,  // 따뜻한 황금빛
      lightDir:      +8,
    },
    winter: {
      // 겨울: 차갑고 고요한 색조, 높은 대비
      deltaHue:      -8,
      deltaSat:      -0.10, // 차분한 채도
      deltaLight:    -0.06,
      deltaContrast: +0.14, // 선명한 명암
      colorTemp:     -500,  // 차가운 색온도
      lightDir:      -8,
    },
  };
 
  return MODS[seasonContext] || {
    deltaHue: 0, deltaSat: 0, deltaLight: 0,
    deltaContrast: 0, colorTemp: 0, lightDir: 0,
  };
}
 
/**
 * 동행자 맥락에 따른 파라미터 보정값을 반환한다.
 *
 * @param {string|null} companionContext - 'solo'|'couple'|'family'|'friends'|null
 * @returns {Object} 파라미터 델타값
 */
function getCompanionModifier(companionContext) {
  const MODS = {
    solo: {
      // 혼자: 내성적, 차분하고 깊은 색감
      deltaHue:       0,
      deltaSat:      -0.08, // 뮤트한 색감
      deltaLight:    -0.04,
      deltaContrast: +0.06, // 약간 극적인 명암
      colorTemp:     -100,
      lightDir:       0,
    },
    couple: {
      // 연인: 따뜻하고 낭만적인 색감
      deltaHue:      +5,    // 따뜻한 방향
      deltaSat:      +0.06,
      deltaLight:    +0.03,
      deltaContrast: -0.05, // 부드러운 명암
      colorTemp:     +300,  // 따뜻한 빛
      lightDir:      +5,
    },
    family: {
      // 가족: 밝고 따뜻하며 안정적인 색감
      deltaHue:      +3,
      deltaSat:      +0.04,
      deltaLight:    +0.07, // 밝고 화사하게
      deltaContrast: -0.08, // 소프트한 명암
      colorTemp:     +200,
      lightDir:      -3,
    },
    friends: {
      // 친구: 활기차고 생동감 있는 색감
      deltaHue:       0,
      deltaSat:      +0.10, // 비비드하게
      deltaLight:    +0.05,
      deltaContrast: +0.05,
      colorTemp:      0,
      lightDir:       0,
    },
  };
 
  return MODS[companionContext] || {
    deltaHue: 0, deltaSat: 0, deltaLight: 0,
    deltaContrast: 0, colorTemp: 0, lightDir: 0,
  };
}
 
/**
 * 여러 보정값 객체를 합산한다.
 *
 * @param {...Object} modifiers
 * @returns {Object} 합산된 보정값
 */
function mergeModifiers(...modifiers) {
  const keys = ['deltaHue','deltaSat','deltaLight','deltaContrast','colorTemp','lightDir'];
  const result = {};
  for (const key of keys) {
    result[key] = modifiers.reduce((sum, mod) => sum + (mod[key] || 0), 0);
  }
  return result;
}
 
// =============================================================================
// ⑤ 유리 재질 파라미터 파생 (Glass Material Parameters)
// =============================================================================
 
/**
 * 감성 점수에서 WebGL MeshPhysicalMaterial 파라미터를 파생한다.
 *
 * [파라미터 의미]
 *   glassTransmission: 빛 투과율 (높을수록 더 투명한 유리)
 *   glassRoughness:    표면 거칠기 (높을수록 뿌옇고 오래된 느낌)
 *   leadMetalness:     납선 금속성 (높을수록 반짝이는 납선)
 *
 * [감성과 재질의 관계]
 *   mystery  ↑ → 투과율↓ (뿌연 유리), roughness↑ (질감↑)
 *   freshness↑ → 투과율↑ (맑은 유리), roughness↓
 *   grandeur ↑ → leadMetalness↑ (화려한 납선)
 *   peace    ↑ → roughness 약간↑ (부드러운 질감)
 *
 * @param {Object} scores - 8차원 감성 점수 (0~100)
 * @returns {{ glassTransmission: number, glassRoughness: number, leadMetalness: number }}
 */
function deriveGlassMaterialParams(scores) {
  const E = {
    mystery:  norm(scores.mystery),
    freshness:norm(scores.freshness),
    grandeur: norm(scores.grandeur),
    peace:    norm(scores.peace),
    amazement:norm(scores.amazement),
  };
 
  // 유리 투과율: 맑은 감성 ↑ → 투명, 신비 ↑ → 불투명
  const glassTransmission = limit('glassTransmission',
    0.82
  + E.freshness  *  0.08   // 청량 → 맑은 유리
  - E.mystery    *  0.12   // 신비 → 뿌연 유리
  - E.grandeur   *  0.04   // 웅장 → 약간 두꺼운 유리
  );
 
  // 유리 표면 거칠기: 신비/평화 ↑ → 질감 있는 표면
  const glassRoughness = limit('glassRoughness',
    0.04
  + E.mystery    *  0.06   // 신비 → 울퉁불퉁한 표면
  + E.peace      *  0.02   // 평화 → 약간 매트한 느낌
  - E.freshness  *  0.02   // 청량 → 매끄러운 표면
  );
 
  // 납선 금속성: 경이/웅장 ↑ → 화려한 금속 납선
  const leadMetalness = limit('leadMetalness',
    0.88
  + E.grandeur   *  0.08   // 웅장 → 반짝이는 납선
  + E.amazement  *  0.04   // 경이 → 빛나는 납선
  - E.peace      *  0.04   // 평화 → 차분한 납선
  );
 
  return { glassTransmission, glassRoughness, leadMetalness };
}
 
// =============================================================================
// ⑥ 색온도 → RGB 틴트 변환
// =============================================================================
 
/**
 * 색온도 오프셋(K)을 WebGL 셰이더용 RGB 틴트 배수로 변환한다.
 *
 * 사용 방법 (GLSL):
 *   vec3 tintedColor = baseColor * vec3(tint.r, tint.g, tint.b);
 *
 * @param {number} kelvinOffset - 색온도 오프셋 (-1500 ~ +1500)
 * @returns {{ r: number, g: number, b: number }} RGB 배수 (1.0 기준)
 */
export function colorTempToRGBTint(kelvinOffset) {
  // -1500K ~ +1500K → -1 ~ +1 정규화
  const n = clamp(kelvinOffset / 1500, -1, 1);
 
  return {
    r: clamp(1.0 + n *  0.14, 0.80, 1.20),  // 따뜻: R↑, 차가움: R↓
    g: clamp(1.0 + n *  0.05, 0.90, 1.10),  // 변화 작음
    b: clamp(1.0 - n *  0.18, 0.70, 1.25),  // 따뜻: B↓, 차가움: B↑
  };
}
 
// =============================================================================
// ⑦ 메인 합성 함수
// =============================================================================
 
/**
 * @typedef {Object} GlobalColorParams
 *
 * [6개 색채 파라미터]
 * @property {number} deltaHue          색조 이동량 (°, -25~+25)
 * @property {number} deltaSat          채도 배수 (×, 0.50~1.45)
 * @property {number} deltaLight        명도 조정량 (-0.20~+0.20)
 * @property {number} deltaContrast     명암대비 배수 (×, 0.65~1.45)
 * @property {number} colorTemp         색온도 오프셋 (K, -1500~+1500)
 * @property {number} lightDir          광원 방향 (°, -35~+35)
 *
 * [유리 재질 파라미터]
 * @property {number} glassTransmission 유리 투과율 (0.65~0.92)
 * @property {number} glassRoughness    유리 거칠기 (0.02~0.12)
 * @property {number} leadMetalness     납선 금속성 (0.82~0.98)
 *
 * [파생 값 (WebGL 직접 사용)]
 * @property {{ r:number, g:number, b:number }} rgbTint  색온도 RGB 배수
 * @property {number} lightDirRad       광원 방향 (라디안)
 *
 * [메타]
 * @property {Object} appliedModifiers  적용된 보정값 내역
 * @property {Object} dominantEmotion  최고 점수 감성 키
 */
 
/**
 * 8차원 감성 점수와 맥락 정보를 받아 글로벌 색채 파라미터를 합성한다.
 *
 * 처리 순서:
 *   1. 감성 점수 → 핵심 파라미터 수식 계산
 *   2. 시간대 맥락 보정 적용
 *   3. 계절 맥락 보정 적용
 *   4. 동행자 맥락 보정 적용
 *   5. 최종값 clamp (범위 보정)
 *   6. 유리 재질 파라미터 파생
 *   7. WebGL 직접 사용 파생값 계산
 *
 * @param {import('./ai-extractor.js').ExtractionResult} extraction
 * @returns {GlobalColorParams}
 *
 * @example
 * const params = synthesizeColorParams(extractionResult);
 * // params.deltaHue          → +12.4  (따뜻한 방향 색조 이동)
 * // params.deltaSat          → 1.28   (비비드한 채도)
 * // params.colorTemp         → +680   (따뜻한 색온도)
 * // params.glassTransmission → 0.85   (맑은 유리)
 * // params.rgbTint           → { r:1.06, g:1.02, b:0.87 }
 */
export function synthesizeColorParams(extraction) {
  const { emotionScores, contextAnalysis } = extraction;
 
  // ── 1. 핵심 수식 계산 ────────────────────────────────────────────
  const core = computeCoreParams(emotionScores);
 
  // ── 2~4. 맥락 보정값 계산 ────────────────────────────────────────
  const timeMod      = getTimeModifier(
    contextAnalysis?.timeContext?.detected ?? null
  );
  const seasonMod    = getSeasonModifier(
    contextAnalysis?.seasonContext?.detected ?? null
  );
  const companionMod = getCompanionModifier(
    contextAnalysis?.companionContext?.detected ?? null
  );
 
  // ── 5. 보정값 합산 ───────────────────────────────────────────────
  const totalMod = mergeModifiers(timeMod, seasonMod, companionMod);
 
  // ── 6. 최종 파라미터 = 핵심 + 보정, 범위 clamp ───────────────────
  const deltaHue      = limit('deltaHue',
    core.deltaHue      + totalMod.deltaHue);
  const deltaSat      = limit('deltaSat',
    core.deltaSat      + totalMod.deltaSat);
  const deltaLight    = limit('deltaLight',
    core.deltaLight    + totalMod.deltaLight);
  const deltaContrast = limit('deltaContrast',
    core.deltaContrast + totalMod.deltaContrast);
  const colorTemp     = limit('colorTemp',
    core.colorTemp     + totalMod.colorTemp);
  const lightDir      = limit('lightDir',
    core.lightDir      + totalMod.lightDir);
 
  // ── 7. 유리 재질 파라미터 파생 ───────────────────────────────────
  const {
    glassTransmission,
    glassRoughness,
    leadMetalness,
  } = deriveGlassMaterialParams(emotionScores);
 
  // ── 8. WebGL 직접 사용 파생값 ────────────────────────────────────
  const rgbTint    = colorTempToRGBTint(colorTemp);
  const lightDirRad = lightDir * (Math.PI / 180);
 
  // ── 9. 최고 감성 감지 ────────────────────────────────────────────
  const dominantEmotion = Object.entries(emotionScores)
    .sort(([, a], [, b]) => b - a)[0][0];
 
  // ── 10. 적용된 보정값 메타 ──────────────────────────────────────
  const appliedModifiers = {
    timeContext:      contextAnalysis?.timeContext?.detected      ?? null,
    seasonContext:    contextAnalysis?.seasonContext?.detected    ?? null,
    companionContext: contextAnalysis?.companionContext?.detected ?? null,
    timeModifier:     timeMod,
    seasonModifier:   seasonMod,
    companionModifier:companionMod,
    totalModifier:    totalMod,
  };
 
  return {
    // 6개 색채 파라미터
    deltaHue,
    deltaSat,
    deltaLight,
    deltaContrast,
    colorTemp,
    lightDir,
 
    // 유리 재질 파라미터
    glassTransmission,
    glassRoughness,
    leadMetalness,
 
    // WebGL 직접 사용 파생값
    rgbTint,
    lightDirRad,
 
    // 메타
    dominantEmotion,
    appliedModifiers,
  };
}
 
// =============================================================================
// ⑧ 파라미터 요약 설명 생성 (디버그·로그용)
// =============================================================================
 
/**
 * GlobalColorParams를 사람이 읽기 쉬운 설명으로 변환한다.
 *
 * @param {GlobalColorParams} params
 * @returns {string[]} 설명 문자열 배열
 */
export function describeParams(params) {
  const desc = [];
 
  // 색조
  if (Math.abs(params.deltaHue) < 5)
    desc.push(`색조: 원본 유지 (${params.deltaHue.toFixed(1)}°)`);
  else if (params.deltaHue > 0)
    desc.push(`색조: 따뜻한 방향 이동 (+${params.deltaHue.toFixed(1)}°)`);
  else
    desc.push(`색조: 차가운 방향 이동 (${params.deltaHue.toFixed(1)}°)`);
 
  // 채도
  if (params.deltaSat > 1.15)
    desc.push(`채도: 비비드 (×${params.deltaSat.toFixed(2)})`);
  else if (params.deltaSat < 0.80)
    desc.push(`채도: 뮤트 (×${params.deltaSat.toFixed(2)})`);
  else
    desc.push(`채도: 보통 (×${params.deltaSat.toFixed(2)})`);
 
  // 명도
  if (params.deltaLight > 0.08)
    desc.push(`명도: 밝게 (+${params.deltaLight.toFixed(2)})`);
  else if (params.deltaLight < -0.08)
    desc.push(`명도: 어둡게 (${params.deltaLight.toFixed(2)})`);
  else
    desc.push(`명도: 보통 (${params.deltaLight.toFixed(2)})`);
 
  // 색온도
  if (params.colorTemp > 400)
    desc.push(`색온도: 따뜻함 (+${Math.round(params.colorTemp)}K)`);
  else if (params.colorTemp < -400)
    desc.push(`색온도: 차가움 (${Math.round(params.colorTemp)}K)`);
  else
    desc.push(`색온도: 중립 (${Math.round(params.colorTemp)}K)`);
 
  // 유리 재질
  desc.push(`유리 투과율: ${(params.glassTransmission * 100).toFixed(0)}%`);
  desc.push(`광원 방향: ${params.lightDir.toFixed(1)}° (${
    params.lightDir > 10 ? '오후·석양' :
    params.lightDir < -10 ? '아침·새벽' : '정면'
  })`);
 
  return desc;
}
 
// =============================================================================
// ⑨ 디버그 유틸리티
// =============================================================================
 
/**
 * 합성 결과를 콘솔에 상세 출력한다. (개발 전용)
 * @param {GlobalColorParams} params
 */
export function debugPrintParams(params) {
  /* eslint-disable no-console */
  console.group('🎨 GlobalColorParams (param-synthesizer)');
 
  console.group('색채 파라미터 6종');
  const bar = (v, min, max, unit = '') => {
    const pct = ((v - min) / (max - min)) * 20;
    return '▓'.repeat(Math.round(pct)).padEnd(20, '░') +
      ` ${v.toFixed(unit === '°' ? 1 : 2)}${unit}`;
  };
  console.log('deltaHue     ', bar(params.deltaHue,      -25,   +25,  '°'));
  console.log('deltaSat     ', bar(params.deltaSat,       0.5,  1.45, '×'));
  console.log('deltaLight   ', bar(params.deltaLight,    -0.2,  +0.2, ''));
  console.log('deltaContrast', bar(params.deltaContrast,  0.65, 1.45, '×'));
  console.log('colorTemp    ', bar(params.colorTemp,    -1500, +1500, 'K'));
  console.log('lightDir     ', bar(params.lightDir,       -35,  +35,  '°'));
  console.groupEnd();
 
  console.group('유리 재질 파라미터');
  console.log('transmission:', (params.glassTransmission * 100).toFixed(0) + '%');
  console.log('roughness:   ', params.glassRoughness.toFixed(3));
  console.log('leadMetal:   ', params.leadMetalness.toFixed(3));
  console.groupEnd();
 
  console.group('RGB 틴트 (색온도→색상)');
  const t = params.rgbTint;
  console.log(`R×${t.r.toFixed(3)}  G×${t.g.toFixed(3)}  B×${t.b.toFixed(3)}`);
  console.groupEnd();
 
  console.group('적용된 맥락 보정');
  const m = params.appliedModifiers;
  console.log('시간대:', m.timeContext     ?? '없음');
  console.log('계절:  ', m.seasonContext   ?? '없음');
  console.log('동행자:', m.companionContext ?? '없음');
  console.groupEnd();
 
  console.group('해석');
  describeParams(params).forEach((d) => console.log('  •', d));
  console.groupEnd();
 
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  synthesizeColorParams,
  colorTempToRGBTint,
  describeParams,
  debugPrintParams,
  LIMITS,
};
