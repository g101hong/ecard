/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — AI 종합 분석 모듈
 * @module emotion-engine/claude-extractor
 * @version 3.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * PIPELINE STAGE 2 : SlimPreprocessed → Full Emotion Analysis
 * ─────────────────────────────────────────────────────────────────
 *
 * [v3.0 변경] AI 엔진 : Anthropic Claude → Google Gemini
 *   - API: https://generativelanguage.googleapis.com (Gemini 2.0 Flash)
 *   - 인증: GEMINI_API_KEY (URL 쿼리 파라미터 방식)
 *   - 요청 구조: system_instruction + contents[{role,parts}]
 *   - 응답 파싱: candidates[0].content.parts[0].text
 *
 * 이 모듈이 AI(Gemini)에 위임하는 모든 의미론적 판단:
 *   ① 시간대 맥락   — 아침/낮/저녁/밤 (관용어·묘사 포함)
 *   ② 계절 맥락     — 봄/여름/가을/겨울
 *   ③ 동행자 맥락   — 혼자/연인/가족/친구
 *   ④ 이모지 해석   — 문자가 아닌 감성적 의미
 *   ⑤ 감성 8차원    — amazement·peace·vitality·nostalgia·
 *                      freshness·grandeur·warmth·mystery
 *   ⑥ 울산 12경 매칭 — 소감과 가장 연관된 경승지
 *   ⑦ 타이포그래피  — A(감탄)/B(서정)/C(복합) 유형
 *   ⑧ 답글 생성     — 울산 관광과 명의 맞춤 답글
 *
 * [설계 원칙]
 *   - 단일 API 호출로 모든 분석 완료 (비용·속도 최적화)
 *   - Chain-of-Thought 추론 포함 (정확도 향상)
 *   - 구조화된 JSON 출력 (파싱 안정성)
 *   - 재시도 로직 내장 (네트워크 오류 대응)
 *   - 폴백 전략 내장 (API 실패 시 기본값)
 */
 
'use strict';
 
import { SPOTS }        from './constants/spot-palettes.js';
import { SYSTEM_PROMPT } from './prompts/system-prompt.js';
 
// =============================================================================
// ① API 설정 상수
// =============================================================================
 
const API_CONFIG = Object.freeze({
  // Gemini API — URL에 모델명 포함, 키는 쿼리 파라미터로 전달
  ENDPOINT:    'https://generativelanguage.googleapis.com/v1beta/models',
  MODEL:       'gemini-2.5-flash',
  MAX_TOKENS:  4096,    // 답글은 짧음 — 3필드 합산 최대 ~150자
  MAX_RETRIES: 2,
  RETRY_DELAY: 1000,   // ms (첫 재시도 1초, 두 번째 2초)
  TIMEOUT_MS:  15000,   // 8초 초과 시 타임아웃
});
 
// =============================================================================
// ② 동적 사용자 프롬프트 생성기 (핵심)
// =============================================================================
 
/**
 * SlimPreprocessed 객체를 받아 AI 분석용 사용자 프롬프트를 생성한다.
 *
 * 프롬프트 구성 전략:
 *   - 기계적 팩트(언어·길이·이모지)를 명시적으로 제공
 *   - 분석 신뢰도에 따라 AI 추론 깊이 지시
 *   - 이모지는 "해석하라"고 명시 (단순 나열이 아닌)
 *   - 언어별 답글 생성 지시
 *   - 출력 JSON 스키마를 정확히 명시
 *
 * @param {import('./preprocessor.js').SlimPreprocessed} pre
 * @returns {string} 사용자 프롬프트 문자열
 */
export function buildUserPrompt(pre) {
  const {
    cleanText,
    language,
    lengthInfo,
    emojis,
    diversitySeed,
  } = pre;
 
  // ── 섹션 A: 입력 메타데이터 ──────────────────────────────────────
  const metaSection = `
## 입력 메타데이터 (기계적 전처리 결과)
- 입력 언어: ${language} (${LANG_LABEL[language] || language})
- 입력 길이: ${lengthInfo.class} (${lengthInfo.charCount}자)
- 분석 신뢰도: ${(lengthInfo.analysisReliability * 100).toFixed(0)}%
- 포함된 이모지: ${emojis.length > 0 ? emojis.join(' ') : '없음'}
- 다양성 시드: ${diversitySeed % 10000}`.trim();
 
  // ── 섹션 B: 분석 지시 — 신뢰도에 따라 달라짐 ────────────────────
  const reliabilityNote = lengthInfo.analysisReliability < 0.5
    ? `\n⚠️ 입력이 매우 짧습니다. 명시적 표현이 없더라도 맥락과 분위기를 적극적으로 추론해 주세요.`
    : lengthInfo.analysisReliability >= 0.95
    ? `\n✅ 충분한 입력입니다. 텍스트에 담긴 모든 감성 신호를 세밀하게 분석해 주세요.`
    : '';
 
  // ── 섹션 C: 이모지 분석 지시 ─────────────────────────────────────
  const emojiInstruction = emojis.length > 0
    ? `\n이모지 분석 지시: [${emojis.join(', ')}]가 포함되어 있습니다.
각 이모지의 이 문맥에서의 감성적 의미를 해석하여 감성 점수에 반영하세요.
(예: 😭는 슬픔이 아닌 "너무 감동적"의 과장 표현일 수 있습니다)`
    : '';
 
  // ── 섹션 D: 소감 원문 ────────────────────────────────────────────
  const impressionSection = `
## 방문객 소감 원문
"${cleanText}"`;
 
  // ── 섹션 E: 울산 12경 참조 목록 ─────────────────────────────────
  const spotsReference = SPOTS
    .map((s, i) => `  ${i}: ${s.name}`)
    .join('\n');
 
  // ── 섹션 F: 출력 JSON 스키마 ─────────────────────────────────────
  const outputSchema = `
## 분석 및 출력 요청
 
다음 단계로 분석하여 JSON만 출력하세요 (마크다운·설명·코드블록 금지):
 
### 단계 1: 맥락 분석 (Chain-of-Thought)
다음을 추론하세요:
- 시간대: 아침/낮/저녁/밤 중 하나 (명시 없으면 null)
- 계절: 봄/여름/가을/겨울 중 하나 (명시 없으면 null)
- 동행자: 혼자/연인/가족/친구 중 하나 (명시 없으면 null)
- 이모지 의미: 각 이모지의 이 맥락에서 감성적 역할
 
### 단계 2: 감성 8차원 점수화
각 0~100으로 점수화 (기준값 25 — 완전 무감성은 없음):
- amazement  (경이·감탄): 압도감, 놀라움, 스펙터클
- peace      (고요·평화): 힐링, 조용함, 여유, 치유
- vitality   (활기·생동): 에너지, 신남, 역동성
- nostalgia  (그리움·향수): 추억, 그리움, 옛 기억
- freshness  (청량·신선): 시원함, 맑음, 상쾌함
- grandeur   (웅장·장엄): 거대함, 장엄함, 스케일
- warmth     (따뜻·포근): 포근함, 다정함, 정겨움
- mystery    (신비·몽환): 신비로움, 환상적, 몽환적
 
관용어·이모지·행간 감성까지 반영하세요.
 
### 단계 3: 울산 12경 매칭
소감의 내용·감성·장소 언급을 기반으로 가장 연관된 경승지:
${spotsReference}
 
### 단계 4: 타이포그래피 & 답글
responseType 기준:
  A = 활기·경이 중심 (amazement+vitality 합 > 110)
  B = 평화·서정 중심 (peace+nostalgia+warmth 합 > 150)
  C = 복합·혼합 감성
 
responseText: 울산 관광과 명의, 2~3문장, 소감에 직접 반응,
              언어는 ${language}로 작성.
 
### 출력 JSON 스키마
 
{
  "contextAnalysis": {
    "timeContext": {
      "detected": "morning" | "afternoon" | "evening" | "night" | null,
      "confidence": 0.0~1.0,
      "reasoning": "추론 근거 한 문장"
    },
    "seasonContext": {
      "detected": "spring" | "summer" | "autumn" | "winter" | null,
      "confidence": 0.0~1.0
    },
    "companionContext": {
      "detected": "solo" | "couple" | "family" | "friends" | null,
      "confidence": 0.0~1.0
    },
    "emojiInterpretation": "이모지 감성 해석 (이모지 없으면 null)",
    "keyEmotionalPhrases": ["핵심 감성 표현 1", "표현 2", "표현 3"]
  },
  "emotionScores": {
    "amazement": 0~100,
    "peace":     0~100,
    "vitality":  0~100,
    "nostalgia": 0~100,
    "freshness": 0~100,
    "grandeur":  0~100,
    "warmth":    0~100,
    "mystery":   0~100
  },
  "dominantEmotion": "가장 높은 점수의 감성 영문 키",
  "spotIndex": 0~11,
  "spotMatchReason": "경승지 선택 이유 한 문장",
  "responseType": "A" | "B" | "C",
  "primaryEmotion": "핵심 감성 한글 1~2단어 (타이포그래피 메인 텍스트)",
  "keywords": ["감성 키워드 5개 한글"],
  "responseText": "울산 관광과 명의 맞춤 답글 2~3문장"
}`;
 
  return [
    metaSection,
    reliabilityNote,
    emojiInstruction,
    impressionSection,
    outputSchema,
  ].filter(Boolean).join('\n');
}
 
/** 언어 코드 → 사람이 읽을 수 있는 레이블 */
const LANG_LABEL = {
  ko: '한국어', en: 'English', ja: '日本語', zh: '中文',
};
 
// =============================================================================
// ③ API 호출 & 재시도 로직
// =============================================================================
 
/**
 * Gemini API를 호출하고 원시 텍스트 응답을 반환한다.
 * 실패 시 MAX_RETRIES 만큼 재시도한다.
 *
 * [Gemini API 구조]
 *   URL  : {ENDPOINT}/{MODEL}:generateContent?key={GEMINI_API_KEY}
 *   요청 : { system_instruction: { parts:[{text}] },
 *             contents: [{ role:'user', parts:[{text}] }],
 *             generationConfig: { maxOutputTokens } }
 *   응답 : { candidates:[{ content:{ parts:[{text}] } }] }
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>} 모델 응답 텍스트
 * @throws {Error} 모든 재시도 실패 시
 */
async function callGeminiAPI(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
 
  const url = `${API_CONFIG.ENDPOINT}/${API_CONFIG.MODEL}:generateContent?key=${apiKey}`;
 
  let lastError;
 
  for (let attempt = 0; attempt <= API_CONFIG.MAX_RETRIES; attempt++) {
    // 재시도 전 대기
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, API_CONFIG.RETRY_DELAY * attempt));
    }
 
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 시스템 프롬프트 — Gemini는 system_instruction 필드 사용
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          // 사용자 메시지
          contents: [
            { role: 'user', parts: [{ text: userPrompt }] },
          ],
          generationConfig: {
            maxOutputTokens: API_CONFIG.MAX_TOKENS,
            // JSON 출력 안정성 향상: temperature를 낮게 설정
            temperature: 0.2,
          },
        }),
      });
 
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
 
      const data = await res.json();
 
      // Gemini 응답 구조: candidates[0].content.parts[0].text
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        // finishReason 확인 (SAFETY, MAX_TOKENS 등)
        const reason = data?.candidates?.[0]?.finishReason ?? 'UNKNOWN';
        throw new Error(`Gemini 응답 텍스트 없음 (finishReason: ${reason})`);
      }
 
      return text;
 
    } catch (err) {
      lastError = err;
      console.warn(`[ai-extractor] 시도 ${attempt + 1} 실패:`, err.message);
 
      // 인증 오류는 재시도 불필요
      if (err.status === 400 || err.status === 401 || err.status === 403) break;
    }
  }
 
  throw new Error(`Gemini API 호출 ${API_CONFIG.MAX_RETRIES + 1}회 모두 실패: ${lastError?.message}`);
}
 
// =============================================================================
// ④ JSON 파싱 & 유효성 검사
// =============================================================================
 
/**
 * AI 응답 텍스트에서 JSON을 추출하고 파싱한다.
 *
 * 처리 케이스:
 *   - 순수 JSON 텍스트 (이상적)
 *   - 마크다운 코드블록으로 감싸진 JSON
 *   - 앞뒤 설명이 붙은 JSON
 *
 * @param {string} rawResponse
 * @returns {Object} 파싱된 JSON
 * @throws {SyntaxError} JSON 추출/파싱 실패 시
 */
function parseAIResponse(rawResponse) {
  let text = rawResponse.trim();
 
  // 1. 마크다운 코드블록 제거 (```json ... ``` 또는 ``` ... ```)
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
 
  // 2. 중괄호 블록 추출 (앞뒤 설명이 있는 경우 대비)
  const jsonStart = text.indexOf('{');
  const jsonEnd   = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    text = text.slice(jsonStart, jsonEnd + 1);
  }
 
  return JSON.parse(text);
}
 
/**
 * 파싱된 AI 응답의 필수 필드를 검증하고 범위를 보정한다.
 *
 * @param {Object} parsed
 * @returns {{ valid: boolean, errors: string[], sanitized: Object }}
 */
function validateAndSanitize(parsed) {
  const errors = [];
  const p = parsed;
 
  // 필수 최상위 키 확인
  const requiredKeys = ['contextAnalysis', 'emotionScores', 'spotIndex',
                        'responseType', 'primaryEmotion', 'keywords', 'responseText'];
  for (const key of requiredKeys) {
    if (!(key in p)) errors.push(`필수 키 누락: ${key}`);
  }
 
  // 감성 점수 범위 보정 (0~100)
  if (p.emotionScores) {
    const EMOTION_KEYS = ['amazement','peace','vitality','nostalgia',
                          'freshness','grandeur','warmth','mystery'];
    for (const k of EMOTION_KEYS) {
      if (typeof p.emotionScores[k] !== 'number') {
        p.emotionScores[k] = 25; // 기본값
        errors.push(`감성 점수 누락: ${k} → 기본값 25 적용`);
      } else {
        p.emotionScores[k] = Math.min(100, Math.max(0, Math.round(p.emotionScores[k])));
      }
    }
  }
 
  // spotIndex 범위 보정 (0~11)
  if (typeof p.spotIndex !== 'number' || p.spotIndex < 0 || p.spotIndex > 11) {
    p.spotIndex = 0;
    errors.push('spotIndex 범위 오류 → 0으로 보정');
  } else {
    p.spotIndex = Math.round(p.spotIndex);
  }
 
  // responseType 유효성
  if (!['A','B','C'].includes(p.responseType)) {
    p.responseType = 'C';
    errors.push('responseType 오류 → C로 보정');
  }
 
  // keywords 배열 보정
  if (!Array.isArray(p.keywords) || p.keywords.length < 3) {
    p.keywords = (p.keywords || []).slice(0, 5);
    while (p.keywords.length < 5) p.keywords.push('울산');
    errors.push('keywords 보정 적용');
  }
 
  // contextAnalysis 기본값 보정
  if (!p.contextAnalysis) {
    p.contextAnalysis = {
      timeContext:            { detected: null, confidence: 0, reasoning: '정보 없음' },
      seasonContext:          { detected: null, confidence: 0 },
      companionContext:       { detected: null, confidence: 0 },
      emojiInterpretation:    null,
      keyEmotionalPhrases:    [],
    };
    errors.push('contextAnalysis 기본값 적용');
  }
 
  return { valid: errors.length === 0, errors, sanitized: p };
}
 
// =============================================================================
// ⑤ 폴백 응답 생성기
// =============================================================================
 
/**
 * API 실패 또는 파싱 오류 시 기본 응답을 생성한다.
 * 다양성 시드로 최소한의 개별성을 부여한다.
 *
 * @param {import('./preprocessor.js').SlimPreprocessed} pre
 * @returns {Object} 폴백 분석 결과
 */
function generateFallback(pre) {
  const seed      = pre.diversitySeed % 12;
  const spotIndex = seed;                         // 시드로 경승지 선택
  const micro     = (pre.diversitySeed % 1000) / 1000; // 0~0.999
 
  const FALLBACK_MESSAGES = {
    ko: `울산을 방문해 주셔서 감사합니다. 울산의 아름다운 풍경이 오래도록 기억에 남기를 바랍니다. 다시 울산에서 만나요!`,
    en: `Thank you for visiting Ulsan! We hope the beautiful scenery stays with you. See you again in Ulsan!`,
    ja: `울산にお越しいただきありがとうございます。아름다운 풍경が記憶に残りますように。またお越しください！`,
    zh: `感谢您来访蔚山！希望蔚山的美景长留心中。期待再次相见！`,
  };
 
  return {
    contextAnalysis: {
      timeContext:         { detected: null, confidence: 0, reasoning: '폴백' },
      seasonContext:       { detected: null, confidence: 0 },
      companionContext:    { detected: null, confidence: 0 },
      emojiInterpretation: null,
      keyEmotionalPhrases: [],
    },
    emotionScores: {
      amazement: Math.round(40 + micro * 20),
      peace:     Math.round(40 + micro * 20),
      vitality:  Math.round(30 + micro * 20),
      nostalgia: Math.round(25 + micro * 15),
      freshness: Math.round(35 + micro * 20),
      grandeur:  Math.round(30 + micro * 20),
      warmth:    Math.round(40 + micro * 20),
      mystery:   Math.round(25 + micro * 15),
    },
    dominantEmotion:  'peace',
    spotIndex,
    spotMatchReason:  '기본 매칭 (폴백)',
    responseType:     'C',
    primaryEmotion:   '울산의 추억',
    keywords:         ['자연', '평화', '감동', '힐링', '울산'],
    responseText:     FALLBACK_MESSAGES[pre.language] || FALLBACK_MESSAGES.ko,
    _isFallback:      true,
  };
}
 
// =============================================================================
// ⑥ 메인 추출 함수
// =============================================================================
 
/**
 * @typedef {Object} ExtractionResult
 * @property {Object} contextAnalysis   맥락 분석 (시간·계절·동행자·이모지)
 * @property {Object} emotionScores     8차원 감성 점수
 * @property {string} dominantEmotion  최고 점수 감성 키
 * @property {number} spotIndex        매칭된 울산 12경 인덱스
 * @property {string} spotMatchReason  경승지 선택 이유
 * @property {string} responseType    타이포그래피 유형 (A|B|C)
 * @property {string} primaryEmotion  핵심 감성 한글
 * @property {string[]} keywords      감성 키워드 5개
 * @property {string} responseText    맞춤 답글
 * @property {boolean} [_isFallback]  폴백 여부
 * @property {Object} _meta           처리 메타데이터
 */
 
/**
 * 전처리된 입력을 받아 Claude AI로 종합 감성 분석을 수행한다.
 *
 * @param {import('./preprocessor.js').SlimPreprocessed} pre
 *   preprocessInput()의 출력
 * @returns {Promise<ExtractionResult>}
 *
 * @example
 * import { preprocessInput }  from './preprocessor.js';
 * import { extractEmotions }  from './claude-extractor.js';
 *
 * const pre    = preprocessInput("태화강 대나무숲을 가족과 함께! 너무 힐링 됐어요 🎋😊");
 * const result = await extractEmotions(pre);
 *
 * result.contextAnalysis.companionContext.detected  // → 'family'
 * result.contextAnalysis.emojiInterpretation        // → "🎋은 대나무를 연상, 😊는 ..."
 * result.emotionScores.peace                        // → 78
 * result.responseType                               // → 'B'
 */
export async function extractEmotions(pre) {
  const t0 = Date.now();
 
  // ── 품질 부족 → 즉시 폴백 ──────────────────────────────────────
  if (!pre.quality.isAcceptable) {
    return {
      ...generateFallback(pre),
      _meta: {
        skippedReason: `품질 미달 (${pre.quality.score}점): ${pre.quality.issues.join(', ')}`,
        processingTimeMs: Date.now() - t0,
      },
    };
  }
 
  // ── 프롬프트 생성 ───────────────────────────────────────────────
  const userPrompt = buildUserPrompt(pre);
  let rawResponse, parsed, sanitized;
 
  try {
    // ── API 호출 (재시도 포함) ──────────────────────────────────
    rawResponse = await callGeminiAPI(SYSTEM_PROMPT, userPrompt);
 
    // ── JSON 파싱 ───────────────────────────────────────────────
    parsed = parseAIResponse(rawResponse);
 
    // ── 유효성 검증 & 범위 보정 ────────────────────────────────
    const validation = validateAndSanitize(parsed);
    sanitized = validation.sanitized;
 
    if (validation.errors.length > 0) {
      console.warn('[ai-extractor] 유효성 보정:', validation.errors);
    }
 
  } catch (err) {
    console.error('[ai-extractor] 분석 실패, 폴백 사용:', err.message);
    return {
      ...generateFallback(pre),
      _meta: {
        error:            err.message,
        processingTimeMs: Date.now() - t0,
        isFallback:       true,
      },
    };
  }
 
  return {
    ...sanitized,
    _meta: {
      processingTimeMs: Date.now() - t0,
      rawResponseLength: rawResponse.length,
      isFallback: false,
    },
  };
}
 
// =============================================================================
// ⑦ 디버그 유틸리티
// =============================================================================
 
/**
 * 추출 결과를 콘솔에 상세 출력한다. (개발 전용)
 * @param {ExtractionResult} result
 */
export function debugPrintExtraction(result) {
  /* eslint-disable no-console */
  console.group('🤖 ExtractionResult (AI 분석)');
 
  if (result._isFallback || result._meta?.isFallback) {
    console.warn('⚠️ 폴백 응답:', result._meta?.skippedReason || result._meta?.error);
  }
 
  const ctx = result.contextAnalysis;
  console.group('📍 맥락 분석');
  console.log('시간대:', ctx.timeContext?.detected ?? 'null',
    `(신뢰도 ${((ctx.timeContext?.confidence || 0)*100).toFixed(0)}%)`);
  console.log('계절:', ctx.seasonContext?.detected ?? 'null');
  console.log('동행자:', ctx.companionContext?.detected ?? 'null');
  console.log('이모지 해석:', ctx.emojiInterpretation ?? '없음');
  console.log('핵심 감성 표현:', ctx.keyEmotionalPhrases?.join(', '));
  console.groupEnd();
 
  console.group('💛 감성 점수');
  const scores = result.emotionScores;
  const maxScore = Math.max(...Object.values(scores));
  Object.entries(scores).forEach(([k, v]) => {
    const bar = '█'.repeat(Math.round(v / 10)) + '░'.repeat(10 - Math.round(v / 10));
    console.log(`  ${k.padEnd(10)} ${bar} ${v}${v === maxScore ? ' ← 최고' : ''}`);
  });
  console.groupEnd();
 
  console.log('🏔️ 매칭 경승지:', `[${result.spotIndex}] ${SPOTS[result.spotIndex]?.name}`,
    `— ${result.spotMatchReason}`);
  console.log('🎨 타이포그래피:', result.responseType, '|', result.primaryEmotion);
  console.log('🏷️ 키워드:', result.keywords?.join(' · '));
  console.log('💬 답글:', result.responseText);
  console.log('⏱️ 처리시간:', result._meta?.processingTimeMs + 'ms');
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  extractEmotions,
  buildUserPrompt,
  debugPrintExtraction,
  API_CONFIG,
};