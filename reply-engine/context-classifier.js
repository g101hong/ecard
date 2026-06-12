/**
 * @fileoverview 울산 E-Card 답글 엔진 — 답글 재료 분류 모듈
 * @module reply-engine/context-classifier
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   emotion-engine의 ExtractionResult와
 *   visit-context.js의 VisitContext를 받아
 *   reply-generator.js가 답글을 생성하는 데 필요한
 *   모든 재료를 하나의 ClassifiedContext로 조립한다.
 *
 *   핵심 결정사항:
 *     ① contextType — 답글 문장의 "장소 표현" 방식 결정
 *     ② replyMaterial — 실제 문장 생성에 쓸 구체적 재료
 *     ③ spotIndex 보정 — 자연 키워드 감지 시 spotIndex 재조정
 *
 * ─────────────────────────────────────────────────────────────────
 * [contextType 4단계 우선순위]
 *
 *   SPOT_NAME      소감에 경승지명이 직접 언급됨
 *                  "간절곶에서 일출을 봤어요"
 *                  → 장소명을 중심으로 답글 생성
 *
 *   NATURAL_KEYWORD 장소명 없음, 자연 환경 키워드 감지
 *                  "파도 소리가 귓가에 맴돌아요"
 *                  → 감지된 키워드 + 시간 맥락으로 생성
 *
 *   EMOTION_SEASON  키워드도 없음, 감성 + 계절 조합 사용
 *                  "너무 힐링됐어요"
 *                  → 지배 감성 + 계절 + 시간대로 생성
 *
 *   TIME_ONLY       극히 짧거나 단순한 소감
 *                  "좋았어요"
 *                  → 계절 + 시간대만으로 생성
 *
 * ─────────────────────────────────────────────────────────────────
 * [파이프라인 내 위치]
 *
 *   emotion-engine.ExtractionResult ─┐
 *                                    ├→ context-classifier.js
 *   visit-context.VisitContext ───────┘         │
 *                                               ▼
 *                                    ClassifiedContext
 *                                               │
 *                                               ▼
 *                                    reply-generator.js
 */
 
'use strict';
 
import {
  detectNaturalKeyword,
  detectAllNaturalKeywords,
  getCategoryMeta,
} from './constants/natural-keywords.js';
 
import {
  mergeWithExtractionContext,
} from './visit-context.js';
 
// =============================================================================
// ① 울산 12경 장소명 사전
// =============================================================================
 
/**
 * 소감 텍스트에서 경승지를 직접 감지하기 위한 사전.
 * 정식명·약칭·별칭을 모두 포함한다.
 *
 * index: spot-palettes.js의 경승지 인덱스 (0~11)
 * names: 감지할 텍스트 패턴 목록 (긴 것부터 → 우선순위 자동 부여)
 */
const SPOT_NAME_DICT = [
  {
    index: 0,
    names: ['간절곶 일출', '간절곶일출', '간절곶', '일출', '한반도 최동단'],
  },
  {
    index: 1,
    names: ['대왕암공원', '대왕암 공원', '대왕암', '해송숲', '해송 숲'],
  },
  {
    index: 2,
    names: ['강동 몽돌해변', '강동몽돌해변', '강동몽돌', '몽돌해변', '강동해변', '몽돌'],
  },
  {
    index: 3,
    names: ['장생포 고래문화마을', '장생포고래문화마을', '장생포 고래', '장생포', '고래문화마을', '고래마을'],
  },
  {
    index: 4,
    names: ['외고산 옹기마을', '외고산옹기마을', '외고산 옹기', '외고산', '옹기마을', '옹기'],
  },
  {
    index: 5,
    names: ['반구대 암각화', '반구대암각화', '반구대', '암각화', '울주 암각화'],
  },
  {
    index: 6,
    names: ['대운산 내원암', '대운산내원암', '대운산 계곡', '대운산계곡', '대운산', '내원암'],
  },
  {
    index: 7,
    names: ['울산대교', '울산 대교', '태화강 교량', '현수교'],
  },
  {
    index: 8,
    names: ['울산대공원', '울산 대공원', '대공원', '장미원'],
  },
  {
    index: 9,
    names: ['태화강 국가정원', '십리대숲', '태화강 대숲', '태화강국가정원', '태화강', '대나무숲', '대숲'],
  },
  {
    index: 10,
    names: ['신불산 억새평원', '신불산억새', '신불산 억새', '신불산', '억새평원', '영남알프스 억새'],
  },
  {
    index: 11,
    names: ['가지산 사계', '가지산사계', '가지산', '영남알프스'],
  },
];
 
// 긴 이름이 먼저 매칭되도록 각 항목 내 names 정렬 (한 번만 실행)
SPOT_NAME_DICT.forEach((entry) => {
  entry.names.sort((a, b) => b.length - a.length);
});
 
// =============================================================================
// ② contextType 상수
// =============================================================================
 
export const CONTEXT_TYPE = Object.freeze({
  SPOT_NAME:       'SPOT_NAME',        // 경승지명 직접 감지
  NATURAL_KEYWORD: 'NATURAL_KEYWORD',  // 자연 환경 키워드 감지
  EMOTION_SEASON:  'EMOTION_SEASON',   // 감성 + 계절 조합
  TIME_ONLY:       'TIME_ONLY',        // 계절·시간대만
});
 
// =============================================================================
// ③ 경승지명 감지
// =============================================================================
 
/**
 * 소감 텍스트에서 울산 12경 경승지명을 감지한다.
 *
 * @param {string} text  정규화된 소감 텍스트
 * @returns {{ detected: boolean, spotIndex: number|null, spotName: string|null, matchedWord: string|null }}
 *
 * @example
 * detectSpotName("간절곶에서 일출을 봤어요");
 * // → { detected: true, spotIndex: 0, spotName: '간절곶 일출', matchedWord: '간절곶' }
 */
export function detectSpotName(text) {
  if (!text) return { detected: false, spotIndex: null, spotName: null, matchedWord: null };
 
  for (const entry of SPOT_NAME_DICT) {
    for (const name of entry.names) {
      if (text.includes(name)) {
        return {
          detected:   true,
          spotIndex:  entry.index,
          spotName:   entry.names[0], // 대표명(첫 번째)
          matchedWord: name,
        };
      }
    }
  }
 
  return { detected: false, spotIndex: null, spotName: null, matchedWord: null };
}
 
// =============================================================================
// ④ 지배 감성 추출
// =============================================================================
 
/**
 * 8차원 감성 점수에서 지배 감성을 추출한다.
 * emotion-engine의 dominantEmotion이 있으면 그것을 우선 사용한다.
 *
 * @param {Object} emotionScores  { amazement: 0~100, ... }
 * @param {string} [dominantEmotion]  AI가 추출한 지배 감성
 * @returns {string}  감성 키값
 */
function _resolveDominantEmotion(emotionScores, dominantEmotion) {
  // AI 추출값이 유효하면 우선 사용
  const validEmotions = [
    'amazement','peace','vitality','nostalgia',
    'freshness','grandeur','warmth','mystery',
  ];
  if (dominantEmotion && validEmotions.includes(dominantEmotion)) {
    return dominantEmotion;
  }
 
  // 직접 계산
  if (!emotionScores) return 'peace';
  return Object.entries(emotionScores)
    .sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'peace';
}
 
// =============================================================================
// ⑤ spotIndex 보정
// =============================================================================
 
/**
 * 자연 키워드 감지 결과와 AI의 spotIndex를 비교하여
 * 더 적합한 spotIndex를 결정한다.
 *
 * 보정 원칙:
 *   - AI spotIndex가 자연 키워드 카테고리의 경승지 후보에 포함되면 AI값 유지
 *   - 포함되지 않으면 자연 키워드 후보 중 첫 번째로 보정
 *
 * @param {number}   aiSpotIndex      emotion-engine 추출 spotIndex
 * @param {number[]} keywordSpotCandidates  자연 키워드 관련 경승지 후보
 * @returns {number} 최종 spotIndex
 */
function _resolveSpotIndex(aiSpotIndex, keywordSpotCandidates) {
  if (!keywordSpotCandidates || keywordSpotCandidates.length === 0) {
    return aiSpotIndex;
  }
  if (keywordSpotCandidates.includes(aiSpotIndex)) {
    return aiSpotIndex; // AI 값이 후보에 포함 → 유지
  }
  return keywordSpotCandidates[0]; // 후보 중 첫 번째로 보정
}
 
// =============================================================================
// ⑥ 메인 분류 함수
// =============================================================================
 
/**
 * @typedef {Object} ClassifiedContext
 *
 * [분류 결과]
 * @property {string}  contextType      CONTEXT_TYPE 값
 * @property {number}  spotIndex        최종 확정 경승지 인덱스 (0~11)
 *
 * [장소 표현 재료]
 * @property {string|null} spotName     감지된 경승지명 (SPOT_NAME일 때)
 * @property {string|null} naturalKeyword 감지된 자연 키워드 (NATURAL_KEYWORD일 때)
 * @property {string|null} naturalExpression 답글에 쓸 자연 표현
 * @property {string|null} naturalCategory   자연 키워드 카테고리
 * @property {string|null} naturalLangTone   자연 카테고리 언어 분위기
 *
 * [감성 재료]
 * @property {string}  dominantEmotion  지배 감성 키값
 * @property {Object}  emotionScores    8차원 감성 점수
 * @property {string}  primaryEmotion   핵심 감성 한글 (타이포그래피용)
 * @property {string[]} keywords        감성 키워드 5개
 *
 * [시간 재료]
 * @property {string}  season           최종 계절 키값
 * @property {string}  seasonLabel      계절 한글
 * @property {string}  timeSlotLabel    시간대 한글
 * @property {string}  timeExpression   "한로의 오후" | "가을 오후" 등
 * @property {string}  langToneHint     언어 분위기 힌트 (전체 결합)
 * @property {boolean} isNearSolarTerm  절기 근접 여부
 * @property {boolean} isWeekend        주말 여부
 * @property {Object}  solarTerm        절기 정보
 *
 * [프롬프트 재료 — reply-generator.js 직접 사용]
 * @property {string}  placeExpression  장소 연결 문장의 핵심 표현
 *                                      "간절곶" | "파도" | "가을 울산" | "겨울 오후 울산"
 * @property {string}  colorTone        색채톤 힌트 (언어톤 일치용)
 *
 * [메타]
 * @property {string}  contextSource    분류 근거 요약
 * @property {number}  diversitySeed    다양성 시드
 */
 
/**
 * ExtractionResult와 VisitContext를 받아 ClassifiedContext를 반환한다.
 *
 * @param {Object} extraction   emotion-engine ExtractionResult
 * @param {Object} visitCtx     visit-context.js VisitContext
 * @param {string} cleanText    정규화된 소감 텍스트 (preprocessor 출력)
 * @param {number} diversitySeed
 * @returns {ClassifiedContext}
 *
 * @example
 * // CASE 1 — 장소명 있음
 * classify(extraction, visitCtx, "간절곶에서 일출을 봤어요", seed);
 * // → { contextType: 'SPOT_NAME', placeExpression: '간절곶', ... }
 *
 * @example
 * // CASE 2 — 자연 키워드만
 * classify(extraction, visitCtx, "파도 소리가 아직도 귓가에", seed);
 * // → { contextType: 'NATURAL_KEYWORD', placeExpression: '파도', ... }
 *
 * @example
 * // CASE 3 — 감성만
 * classify(extraction, visitCtx, "너무 힐링됐어요", seed);
 * // → { contextType: 'EMOTION_SEASON', placeExpression: '가을 울산', ... }
 *
 * @example
 * // CASE 4 — 매우 짧은 소감
 * classify(extraction, visitCtx, "좋았어요", seed);
 * // → { contextType: 'TIME_ONLY', placeExpression: '동지의 오후 울산', ... }
 */
export function classify(extraction, visitCtx, cleanText, diversitySeed = 0) {
 
  // ── 공통 재료 준비 ──────────────────────────────────────────────
  const emotionScores    = extraction?.emotionScores    ?? {};
  const dominantEmotion  = _resolveDominantEmotion(emotionScores, extraction?.dominantEmotion);
  const primaryEmotion   = extraction?.primaryEmotion   ?? '울산의 감동';
  const keywords         = extraction?.keywords         ?? ['자연','아름다움','감동','힐링','울산'];
  const aiSpotIndex      = extraction?.spotIndex        ?? 0;
 
  // 시간 컨텍스트 병합 (AI 신뢰도 기반)
  const merged = mergeWithExtractionContext(visitCtx, extraction?.contextAnalysis ?? null);
 
  // 색채톤 결정 (감성 + 계절 기반)
  const colorTone = _resolveColorTone(dominantEmotion, merged.season);
 
  // ── 1순위: 경승지명 직접 감지 ───────────────────────────────────
  const spotDetect = detectSpotName(cleanText);
 
  if (spotDetect.detected) {
    const placeExpression = spotDetect.matchedWord;
 
    return {
      contextType:        CONTEXT_TYPE.SPOT_NAME,
      spotIndex:          spotDetect.spotIndex,
 
      spotName:           spotDetect.spotName,
      naturalKeyword:     null,
      naturalExpression:  null,
      naturalCategory:    null,
      naturalLangTone:    null,
 
      dominantEmotion,
      emotionScores,
      primaryEmotion,
      keywords,
 
      season:             merged.season,
      seasonLabel:        merged.seasonLabel,
      timeSlotLabel:      merged.timeSlotLabel,
      timeExpression:     merged.timeExpression,
      langToneHint:       merged.langToneHint,
      isNearSolarTerm:    merged.isNearSolarTerm,
      isWeekend:          merged.isWeekend,
      solarTerm:          merged.solarTerm,
 
      placeExpression,
      colorTone,
 
      contextSource:  `SPOT_NAME: "${spotDetect.matchedWord}" (index:${spotDetect.spotIndex})`,
      diversitySeed,
    };
  }
 
  // ── 2순위: 자연 환경 키워드 감지 ────────────────────────────────
  const naturalDetect = detectNaturalKeyword(cleanText);
 
  if (naturalDetect.detected) {
    const resolvedSpotIndex = _resolveSpotIndex(aiSpotIndex, naturalDetect.spotIndices);
    const placeExpression   = naturalDetect.expression;
 
    // 자연 키워드 언어톤과 시간 언어톤 결합
    const langToneHint = [
      naturalDetect.langTone,
      merged.langToneHint,
    ].filter(Boolean).join(' · ');
 
    return {
      contextType:        CONTEXT_TYPE.NATURAL_KEYWORD,
      spotIndex:          resolvedSpotIndex,
 
      spotName:           null,
      naturalKeyword:     naturalDetect.keyword,
      naturalExpression:  naturalDetect.expression,
      naturalCategory:    naturalDetect.category,
      naturalLangTone:    naturalDetect.langTone,
 
      dominantEmotion,
      emotionScores,
      primaryEmotion,
      keywords,
 
      season:             merged.season,
      seasonLabel:        merged.seasonLabel,
      timeSlotLabel:      merged.timeSlotLabel,
      timeExpression:     merged.timeExpression,
      langToneHint,
      isNearSolarTerm:    merged.isNearSolarTerm,
      isWeekend:          merged.isWeekend,
      solarTerm:          merged.solarTerm,
 
      placeExpression,
      colorTone,
 
      contextSource:  `NATURAL_KEYWORD: "${naturalDetect.keyword}" (${naturalDetect.category}) → spotIndex: ${resolvedSpotIndex}`,
      diversitySeed,
    };
  }
 
  // ── 3순위: 감성 + 계절 조합 ─────────────────────────────────────
  // 소감이 충분히 길거나 감성 점수가 명확할 때
  const hasEmotionSignal = _hasStrongEmotion(emotionScores);
  const hasLengthSignal  = cleanText && cleanText.replace(/\s/g, '').length >= 15;
 
  if (hasEmotionSignal || hasLengthSignal) {
    const placeExpression = `${merged.seasonLabel} 울산`;
 
    return {
      contextType:        CONTEXT_TYPE.EMOTION_SEASON,
      spotIndex:          aiSpotIndex,
 
      spotName:           null,
      naturalKeyword:     null,
      naturalExpression:  null,
      naturalCategory:    null,
      naturalLangTone:    null,
 
      dominantEmotion,
      emotionScores,
      primaryEmotion,
      keywords,
 
      season:             merged.season,
      seasonLabel:        merged.seasonLabel,
      timeSlotLabel:      merged.timeSlotLabel,
      timeExpression:     merged.timeExpression,
      langToneHint:       merged.langToneHint,
      isNearSolarTerm:    merged.isNearSolarTerm,
      isWeekend:          merged.isWeekend,
      solarTerm:          merged.solarTerm,
 
      placeExpression,
      colorTone,
 
      contextSource:  `EMOTION_SEASON: dominant=${dominantEmotion} season=${merged.season}`,
      diversitySeed,
    };
  }
 
  // ── 4순위: 계절·시간대만 ─────────────────────────────────────────
  const placeExpression = `${merged.timeExpression} 울산`;
 
  return {
    contextType:        CONTEXT_TYPE.TIME_ONLY,
    spotIndex:          aiSpotIndex,
 
    spotName:           null,
    naturalKeyword:     null,
    naturalExpression:  null,
    naturalCategory:    null,
    naturalLangTone:    null,
 
    dominantEmotion,
    emotionScores,
    primaryEmotion,
    keywords,
 
    season:             merged.season,
    seasonLabel:        merged.seasonLabel,
    timeSlotLabel:      merged.timeSlotLabel,
    timeExpression:     merged.timeExpression,
    langToneHint:       merged.langToneHint,
    isNearSolarTerm:    merged.isNearSolarTerm,
    isWeekend:          merged.isWeekend,
    solarTerm:          merged.solarTerm,
 
    placeExpression,
    colorTone,
 
    contextSource:  `TIME_ONLY: ${merged.timeExpression}`,
    diversitySeed,
  };
}
 
// =============================================================================
// ⑦ 내부 헬퍼
// =============================================================================
 
/**
 * 감성 점수 중 하나라도 강한 신호(60점 이상)가 있는지 확인한다.
 * @param {Object} scores
 * @returns {boolean}
 */
function _hasStrongEmotion(scores) {
  if (!scores) return false;
  return Object.values(scores).some((v) => v >= 60);
}
 
/**
 * 지배 감성 + 계절을 기반으로 색채톤 힌트를 결정한다.
 * reply-generator의 프롬프트에 전달되어 언어톤과 색채톤을 일치시킨다.
 *
 * @param {string} dominantEmotion
 * @param {string} season
 * @returns {string}
 */
function _resolveColorTone(dominantEmotion, season) {
  // 감성 기반 기본 색채톤
  const EMOTION_TONE = {
    amazement: '비비드·고채도·강렬한 빛',
    peace:     '뮤트·저채도·부드러운 확산광',
    vitality:  '밝고 선명한·생동감 있는',
    nostalgia: '세피아·앰버 틴트·따뜻하고 바랜',
    freshness: '청량한 블루·투명한·맑은',
    grandeur:  '하이 콘트라스트·깊고 강한',
    warmth:    '골든·앰버·포근하고 따뜻한',
    mystery:   '바이올렛·딥블루·몽환적인',
  };
 
  // 계절 보정
  const SEASON_MOD = {
    spring: ' (봄: 파스텔·밝게)',
    summer: ' (여름: 청록·비비드)',
    autumn: ' (가을: 황금·오렌지)',
    winter: ' (겨울: 청백·차갑고 선명하게)',
  };
 
  const base = EMOTION_TONE[dominantEmotion] ?? '균형잡힌 자연색';
  const mod  = SEASON_MOD[season] ?? '';
 
  return base + mod;
}
 
// =============================================================================
// ⑧ 디버그 유틸리티
// =============================================================================
 
/**
 * 분류 결과를 콘솔에 출력한다. (개발 전용)
 * @param {ClassifiedContext} ctx
 */
export function debugPrintClassified(ctx) {
  /* eslint-disable no-console */
  const TIER_ICON = {
    SPOT_NAME:       '📍 1순위',
    NATURAL_KEYWORD: '🌿 2순위',
    EMOTION_SEASON:  '💛 3순위',
    TIME_ONLY:       '⏰ 4순위',
  };
 
  console.group('🗂️ ClassifiedContext (context-classifier)');
  console.log('contextType   :', TIER_ICON[ctx.contextType] ?? ctx.contextType);
  console.log('contextSource :', ctx.contextSource);
  console.log('spotIndex     :', ctx.spotIndex);
  console.log('');
 
  console.group('✍️ 답글 재료');
  console.log('placeExpression:', ctx.placeExpression);
  console.log('timeExpression :', ctx.timeExpression);
  console.log('langToneHint   :', ctx.langToneHint);
  console.log('colorTone      :', ctx.colorTone);
  console.groupEnd();
 
  console.group('💛 감성');
  console.log('dominantEmotion:', ctx.dominantEmotion);
  console.log('primaryEmotion :', ctx.primaryEmotion);
  console.log('keywords       :', ctx.keywords?.join(' · '));
  console.groupEnd();
 
  console.group('🌸 시간 맥락');
  console.log('season     :', ctx.seasonLabel, `(${ctx.season})`);
  console.log('timeSlot   :', ctx.timeSlotLabel);
  console.log('solarTerm  :', ctx.solarTerm?.name, ctx.isNearSolarTerm ? '(근접 ✅)' : '');
  console.log('isWeekend  :', ctx.isWeekend ? '주말' : '평일');
  console.groupEnd();
 
  if (ctx.contextType === CONTEXT_TYPE.NATURAL_KEYWORD) {
    console.group('🌿 자연 키워드 상세');
    console.log('keyword    :', ctx.naturalKeyword);
    console.log('category   :', ctx.naturalCategory);
    console.log('langTone   :', ctx.naturalLangTone);
    console.groupEnd();
  }
 
  if (ctx.contextType === CONTEXT_TYPE.SPOT_NAME) {
    console.group('📍 장소명 상세');
    console.log('spotName   :', ctx.spotName);
    console.groupEnd();
  }
 
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  classify,
  detectSpotName,
  CONTEXT_TYPE,
  SPOT_NAME_DICT,
  debugPrintClassified,
};