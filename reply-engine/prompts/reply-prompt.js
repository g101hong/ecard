/**
 * @fileoverview 울산 E-Card 답글 엔진 — 답글 생성 전용 Claude API 프롬프트
 * @module reply-engine/prompts/reply-prompt
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   reply-generator.js가 Claude API를 호출할 때 사용하는
 *   시스템 프롬프트와 유저 프롬프트 빌더를 제공한다.
 *
 *   emotion-engine의 system-prompt.js (감성 분석 전용)와
 *   역할이 완전히 분리된다:
 *
 *   system-prompt.js   소감 → 감성 8차원 점수 추출
 *   reply-prompt.js    감성 + 컨텍스트 → 답글 3단 생성  ← 이 파일
 *
 * ─────────────────────────────────────────────────────────────────
 * [출력 구조 — E-Card 3단]
 *
 *   main     메인 문장   12~20자, 시적이고 여운 있게
 *   place    장소 문장   1~2줄, 방문 맥락 자연스럽게 연결
 *   tagline  태그라인    "ULSAN — [4~8자]" 고정 형식
 *
 * ─────────────────────────────────────────────────────────────────
 * [contextType별 작성 전략]
 *
 *   SPOT_NAME        경승지명을 중심으로 직접 연결
 *   NATURAL_KEYWORD  감지된 자연 키워드 + 시간 맥락 결합
 *   EMOTION_SEASON   지배 감성 + 계절 + 시간대 조합
 *   TIME_ONLY        절기·계절·시간대만으로 시적 표현
 *
 * ─────────────────────────────────────────────────────────────────
 * [색채톤 ↔ 언어톤 매핑]
 *
 *   이미지의 색채 파라미터와 답글의 언어 톤을 일치시켜
 *   시각과 텍스트가 하나의 감성으로 통일되도록 한다.
 */
 
'use strict';
 
import { CONTEXT_TYPE } from '../context-classifier.js';
 
// =============================================================================
// ① 시스템 프롬프트
// =============================================================================
 
export const REPLY_SYSTEM_PROMPT = `
당신은 울산광역시 E-Card의 메시지 작가입니다.
방문객의 감성 데이터와 방문 맥락을 받아
E-Card에 인쇄될 3단 답글을 작성합니다.
 
══════════════════════════════════════════════════════════
[E-Card 3단 구조]
══════════════════════════════════════════════════════════
 
① main (메인 문장)
   - 12~20자
   - 시적이고 여운 있게
   - 방문객 마음속에 오래 남을 한 줄
   - 직접적인 서술보다 이미지·감각·여운 중심
 
② place (장소 연결 문장)
   - 1~2줄 (최대 60자)
   - placeExpression을 자연스럽게 녹여 방문 맥락 연결
   - contextType에 따라 전략이 달라짐 (아래 지시 참조)
 
③ tagline (태그라인)
   - 반드시 "ULSAN — " 으로 시작
   - 뒤에 4~8자 한글 문구
   - 브랜딩 느낌의 짧고 인상적인 표현
 
══════════════════════════════════════════════════════════
[contextType별 place 작성 전략]
══════════════════════════════════════════════════════════
 
SPOT_NAME (경승지명 직접 언급)
  → placeExpression에 담긴 경승지명을 중심으로 작성
  → 그 장소만의 고유한 빛·자연·분위기를 담을 것
  → 예) placeExpression: "간절곶"
       "간절곶의 겨울 새벽, 빛이 당신의 눈에 닿은 날"
 
NATURAL_KEYWORD (자연 환경 키워드 감지)
  → placeExpression(자연 키워드) + timeExpression(시간 맥락) 결합
  → 감각적 기억(청각·시각·촉각)을 살려 표현
  → 예) placeExpression: "파도", timeExpression: "가을 오후"
       "가을 오후, 그 파도 소리가 당신 안에 새겨진 자리"
 
EMOTION_SEASON (감성 + 계절)
  → placeExpression(계절 + 울산) + 지배 감성의 언어톤 결합
  → 장소 대신 감정의 질감으로 연결
  → 예) placeExpression: "가을 울산", dominantEmotion: warmth
       "황금빛 가을, 울산이 당신의 마음을 따뜻하게 감싼 날"
 
TIME_ONLY (계절·시간대만)
  → placeExpression(절기·시간 + 울산)을 시적으로 표현
  → 그날 그 순간에 집중
  → 예) placeExpression: "동지의 밤 울산"
       "동지의 밤, 울산이 조용히 당신 곁에 있었습니다"
 
══════════════════════════════════════════════════════════
[색채톤 ↔ 언어톤 매핑 — 반드시 일치시킬 것]
══════════════════════════════════════════════════════════
 
colorTone에 담긴 힌트를 읽고 언어의 질감을 맞춘다:
 
비비드·고채도·강렬한 빛
  → 선명하고 압도적인 언어 / 짧고 강한 문장
  → 예: "그 빛은 당신의 눈을 빼앗았습니다"
 
뮤트·저채도·부드러운 확산광
  → 조용하고 차분한 언어 / 여백이 있는 문장
  → 예: "고요히, 울산이 당신을 안아주었습니다"
 
골든·앰버·포근하고 따뜻한
  → 따뜻하고 포근한 언어 / 온기가 느껴지는 단어
  → 예: "황금빛 온기가 당신 마음에 스며든 날"
 
청량한 블루·투명한·맑은
  → 시원하고 투명한 언어 / 깨끗한 감각 표현
  → 예: "맑고 투명한 울산의 공기가 당신을 채웠습니다"
 
하이 콘트라스트·깊고 강한
  → 무게감 있고 장엄한 언어 / 대비되는 표현
  → 예: "광활함 앞에 잠시 멈춰선 그 순간"
 
세피아·앰버 틴트·따뜻하고 바랜
  → 그리움·회상 투의 언어 / 시간의 감각 포함
  → 예: "오래된 것처럼 친숙한, 울산의 그 장면"
 
바이올렛·딥블루·몽환적인
  → 신비롭고 몽환적인 언어 / 꿈과 현실 경계
  → 예: "꿈인지 현실인지 모를 울산의 어느 한 순간"
 
══════════════════════════════════════════════════════════
[절대 금지 표현]
══════════════════════════════════════════════════════════
 
서비스 어투 금지:
  ✗ "감사합니다", "소감 잘 받았습니다"
  ✗ "다음에 또 방문해 주세요"
  ✗ "울산을 찾아주셔서 감사합니다"
  ✗ "좋은 시간 보내셨나요?"
 
과장·상투어 금지:
  ✗ "아름다운 추억이 되셨으면 합니다"
  ✗ "소중한 하루가 되셨길 바랍니다"
  ✗ "행복한 시간"
 
너무 짧은 tagline 금지:
  ✗ "ULSAN — 울산"  (의미 없음)
  ✗ "ULSAN — 좋은 곳" (진부함)
 
══════════════════════════════════════════════════════════
[출력 형식 규칙]
══════════════════════════════════════════════════════════
 
반드시 순수 JSON만 출력:
- 마크다운 코드블록(\`\`\`) 사용 금지
- JSON 앞뒤 설명 텍스트 금지
- 주석(//) 금지
- 모든 문자열은 큰따옴표(") 사용
 
응답의 첫 문자는 반드시 '{'
마지막 문자는 반드시 '}'

══════════════════════════════════════════════════════════
[출력 길이 엄수]
══════════════════════════════════════════════════════════

반드시 아래 글자 수를 지켜야 합니다:
  main    : 최대 20자 (초과 금지)
  place   : 최대 50자 (초과 금지)
  tagline : 최대 20자 ("ULSAN — " 포함)

글자 수가 넘으면 줄여서 완성된 JSON을 출력하세요.
JSON이 잘리는 것은 절대 허용되지 않습니다.
`.trim();

 
// =============================================================================
// ② 유저 프롬프트 빌더
// =============================================================================
 
/**
 * ClassifiedContext를 받아 Claude API 유저 프롬프트 문자열을 생성한다.
 *
 * @param {import('../context-classifier.js').ClassifiedContext} ctx
 * @param {string} originalText  방문객 소감 원문
 * @returns {string}  유저 프롬프트 문자열
 *
 * @example
 * const prompt = buildReplyUserPrompt(classified, "파도 소리가 아직도 귓가에 맴돌아요");
 * // → Claude API messages[0].content 에 전달
 */
export function buildReplyUserPrompt(ctx, originalText = '') {
 
  // ── 섹션 A: 방문객 소감 원문 ─────────────────────────────────
  const sectionOriginal = `
## 방문객 소감
"${originalText}"`.trim();
 
  // ── 섹션 B: 분류된 컨텍스트 ──────────────────────────────────
  const sectionContext = `
## 분류 결과
contextType    : ${ctx.contextType}
placeExpression: ${ctx.placeExpression}
timeExpression : ${ctx.timeExpression}
langToneHint   : ${ctx.langToneHint}
colorTone      : ${ctx.colorTone}`.trim();
 
  // ── 섹션 C: 감성 데이터 ───────────────────────────────────────
  const emotionBar = _buildEmotionBar(ctx.emotionScores);
  const sectionEmotion = `
## 감성 데이터
지배 감성    : ${ctx.dominantEmotion} (${_emotionLabel(ctx.dominantEmotion)})
핵심 감성 한글: ${ctx.primaryEmotion}
키워드       : ${ctx.keywords?.join(' · ')}
 
감성 점수:
${emotionBar}`.trim();
 
  // ── 섹션 D: 시간 맥락 ─────────────────────────────────────────
  const sectionTime = `
## 시간 맥락
계절    : ${ctx.seasonLabel} (${ctx.season})
시간대  : ${ctx.timeSlotLabel}
절기    : ${ctx.solarTerm?.name ?? '없음'}${ctx.isNearSolarTerm ? ' (3일 이내 근접)' : ''}
주말    : ${ctx.isWeekend ? '주말' : '평일'}`.trim();
 
  // ── 섹션 E: 장소 상세 (contextType별 추가 정보) ───────────────
  const sectionPlace = _buildPlaceSection(ctx);
 
  // ── 섹션 F: 출력 스키마 ───────────────────────────────────────
  const sectionSchema = `
## 출력 JSON 스키마

위 데이터를 바탕으로 E-Card 답글을 JSON만 출력하세요.

글자 수 제한 (반드시 엄수):
  main    : 한글 10~18자 이내
  place   : 한글 20~35자 이내 (1문장)
  tagline : "ULSAN — " 포함 전체 15자 이내

{
  "main": "메인 문장",
  "place": "장소 연결 문장",
  "tagline": "ULSAN — 태그라인"
}`.trim();
 
  return [
    sectionOriginal,
    sectionContext,
    sectionEmotion,
    sectionTime,
    sectionPlace,
    sectionSchema,
  ].filter(Boolean).join('\n\n');
}
 
// =============================================================================
// ③ contextType별 장소 섹션 빌더
// =============================================================================
 
/**
 * contextType에 따라 장소 관련 추가 정보 섹션을 생성한다.
 *
 * @param {Object} ctx  ClassifiedContext
 * @returns {string}
 */
function _buildPlaceSection(ctx) {
  switch (ctx.contextType) {
 
    case CONTEXT_TYPE.SPOT_NAME:
      return `
## 장소 작성 지시 (SPOT_NAME)
소감에 "${ctx.spotName}" 이(가) 직접 언급되었습니다.
"${ctx.placeExpression}"을 place 문장의 중심에 놓고
그 장소만의 고유한 분위기(빛·자연·색채)를 담아 작성하세요.
timeExpression "${ctx.timeExpression}"을 자연스럽게 결합해도 좋습니다.`.trim();
 
    case CONTEXT_TYPE.NATURAL_KEYWORD:
      return `
## 장소 작성 지시 (NATURAL_KEYWORD)
소감에서 자연 환경 키워드 "${ctx.naturalKeyword}"(${ctx.naturalCategory})가 감지되었습니다.
place 문장에 "${ctx.placeExpression}"과 "${ctx.timeExpression}"을 결합하여
그 자연 요소의 감각적 기억(소리·색·느낌)을 살려 작성하세요.
자연 키워드 언어 분위기: ${ctx.naturalLangTone}`.trim();
 
    case CONTEXT_TYPE.EMOTION_SEASON:
      return `
## 장소 작성 지시 (EMOTION_SEASON)
소감에 장소명·자연 키워드가 없습니다.
"${ctx.placeExpression}"(${ctx.seasonLabel} 울산)을 중심으로
지배 감성 "${ctx.dominantEmotion}"(${_emotionLabel(ctx.dominantEmotion)})의 언어 질감으로 작성하세요.
계절의 색채 힌트를 활용해 시각적 연결감을 줘도 좋습니다.`.trim();
 
    case CONTEXT_TYPE.TIME_ONLY:
      return `
## 장소 작성 지시 (TIME_ONLY)
소감이 매우 짧거나 단순합니다.
"${ctx.placeExpression}"(${ctx.timeExpression} 울산)을 시적으로 표현하여
그날 그 순간의 울산을 담아내세요.
절기 "${ctx.solarTerm?.name ?? ctx.seasonLabel}"의 분위기를 언어에 반영하세요.`.trim();
 
    default:
      return '';
  }
}
 
// =============================================================================
// ④ 내부 헬퍼
// =============================================================================
 
/**
 * 감성 키값 → 한글 레이블
 * @param {string} key
 * @returns {string}
 */
function _emotionLabel(key) {
  const MAP = {
    amazement: '경이·감탄',
    peace:     '고요·평화',
    vitality:  '활기·생동',
    nostalgia: '그리움·향수',
    freshness: '청량·신선',
    grandeur:  '웅장·장엄',
    warmth:    '따뜻·포근',
    mystery:   '신비·몽환',
  };
  return MAP[key] ?? key;
}
 
/**
 * 감성 점수를 텍스트 바 형식으로 변환한다.
 * 프롬프트에 포함되어 AI가 감성 강도를 직관적으로 파악하게 한다.
 *
 * @param {Object} scores  { amazement: 0~100, ... }
 * @returns {string}
 */
function _buildEmotionBar(scores) {
  if (!scores) return '';
 
  const KEYS = [
    'amazement','peace','vitality','nostalgia',
    'freshness','grandeur','warmth','mystery',
  ];
 
  return KEYS.map((key) => {
    const score = scores[key] ?? 0;
    const bar   = '▓'.repeat(Math.round(score / 10)).padEnd(10, '░');
    const label = _emotionLabel(key).padEnd(8);
    return `  ${key.padEnd(12)} ${bar} ${score}`;
  }).join('\n');
}
 
// =============================================================================
// ⑤ 응답 파싱 유틸리티
// =============================================================================
 
/**
 * Claude API 응답 텍스트에서 답글 JSON을 파싱한다.
 *
 * 처리 케이스:
 *   - 순수 JSON
 *   - 마크다운 코드블록으로 감싸진 JSON
 *   - 앞뒤 설명이 붙은 JSON
 *
 * @param {string} rawResponse  Claude API 응답 텍스트
 * @returns {{ main: string, place: string, tagline: string }}
 * @throws {Error}  파싱 실패 시
 */

export function parseReplyResponse(rawResponse) {
  let text = rawResponse.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }

  let wasTruncated = false;

  try {
    return _sanitizeReply(JSON.parse(text));
  } catch (e) {
    console.warn('[reply-prompt] JSON 잘림 감지, 복구 시도:', e.message);
    wasTruncated = true;
    const fixed = _fixTruncatedJSON(text);
    const parsed = JSON.parse(fixed);           // 복구 실패 시 throw
    const result = _sanitizeReply(parsed);
    result._wasTruncated = true;                // ★ 잘림 표시 플래그
    return result;
  }
}

// ★ 추가: 잘린 JSON 복구 헬퍼
function _fixTruncatedJSON(text) {
  let fixed = text;

  // 열린 문자열이 닫히지 않은 경우 — 마지막 따옴표 뒤에 닫기
  const quoteCount = (fixed.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    fixed += '"';
  }

  // 열린 중괄호 수만큼 닫기
  const opens  = (fixed.match(/{/g) || []).length;
  const closes = (fixed.match(/}/g) || []).length;
  for (let i = 0; i < opens - closes; i++) {
    fixed += '}';
  }

  return fixed;
}

// ★ 추가: 필수 필드 보정
function _sanitizeReply(parsed) {
  return {
    main:    _field(parsed.main,    '울산이 당신에게 건넨 소중한 순간'),
    place:   _field(parsed.place,   '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 남기를 바랍니다.'),
    tagline: _tagline(parsed.tagline),
  };
}

function _field(value, fallback) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim() : fallback;
}

function _tagline(value) {
  if (typeof value !== 'string' || value.trim().length === 0)
    return 'ULSAN — 당신의 울산';
  const t = value.trim();
  return t.startsWith('ULSAN') ? t : `ULSAN — ${t}`;
}
 
/**
 * 문자열 필드 보정 — null·빈값 방지
 * @param {string} value
 * @param {string} fallback
 * @returns {string}
 */
function _sanitizeField(value, fallback) {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
}
 
/**
 * tagline 형식 보정 — "ULSAN — " 접두어 보장
 * @param {string} value
 * @returns {string}
 */
function _sanitizeTagline(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'ULSAN — 당신의 울산';
  }
  const t = value.trim();
  if (t.startsWith('ULSAN —') || t.startsWith('ULSAN-')) return t;
  return `ULSAN — ${t}`;
}
 
// =============================================================================
// ⑥ 디버그 유틸리티
// =============================================================================
 
/**
 * 생성된 유저 프롬프트를 콘솔에 출력한다. (개발 전용)
 * @param {Object} ctx          ClassifiedContext
 * @param {string} originalText 소감 원문
 */
export function debugPrintPrompt(ctx, originalText = '') {
  /* eslint-disable no-console */
  console.group('📋 Reply UserPrompt (reply-prompt.js)');
  const prompt = buildReplyUserPrompt(ctx, originalText);
  console.log(prompt);
  console.log('\n--- 시스템 프롬프트 길이:', REPLY_SYSTEM_PROMPT.length, '자');
  console.log('--- 유저 프롬프트 길이  :', prompt.length, '자');
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  REPLY_SYSTEM_PROMPT,
  buildReplyUserPrompt,
  parseReplyResponse,
  debugPrintPrompt,
};