/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — AI 종합 분석 모듈
 * @module emotion-engine/claude-extractor
 * @version 4.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * [v4.0 변경] 방안B 단일 호출 통합
 * ─────────────────────────────────────────────────────────────────
 *
 *   reply-engine의 두 번째 Gemini 호출을 제거하고
 *   이 모듈의 단일 호출에서 감성 분석 + E-Card 3단 답글을 동시에 생성한다.
 *
 *   변경 사항:
 *     1. buildUserPrompt(pre, visitCtx?)
 *        - visitCtx 파라미터 추가 (collectVisitContext 결과)
 *        - 방문 시점 컨텍스트 섹션 신규 추가 (절기·계절·시간대·동행자)
 *        - 출력 스키마에 "reply" 블록 추가 (main / place / tagline)
 *
 *     2. validateAndSanitize()
 *        - reply 블록 유효성 검증 및 기본값 보정 추가
 *
 *     3. generateFallback()
 *        - reply 기본값 포함
 *
 *   하위 호환:
 *     - visitCtx 미전달 시 기존 동작과 동일 (visitCtx 섹션 생략)
 *     - ExtractionResult에 reply 필드가 추가될 뿐, 기존 필드 변경 없음
 *
 * ─────────────────────────────────────────────────────────────────
 * PIPELINE STAGE 2 : SlimPreprocessed → Full Emotion Analysis + Reply
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

import { SPOTS }         from './constants/spot-palettes.js';
import { SYSTEM_PROMPT } from './prompts/system-prompt.js';

// =============================================================================
// ① API 설정 상수
// =============================================================================

const API_CONFIG = Object.freeze({
  ENDPOINT:    'https://generativelanguage.googleapis.com/v1beta/models',
  MODEL:       'gemini-2.5-flash',
  // [v4.0] reply 3단이 추가되므로 토큰 여유 확보 (4096 → 5120)
  MAX_TOKENS:  5120,
  MAX_RETRIES: 2,
  RETRY_DELAY: 1000,
  TIMEOUT_MS:  20000,  // reply 포함으로 응답이 소폭 길어질 수 있어 15→20초
});

// =============================================================================
// ② 동적 사용자 프롬프트 생성기
// =============================================================================

/**
 * SlimPreprocessed + VisitContext를 받아 AI 분석용 사용자 프롬프트를 생성한다.
 *
 * [v4.0 추가] visitCtx 파라미터:
 *   reply-engine/visit-context.js의 collectVisitContext() 반환값.
 *   절기·계절·시간대 정보를 프롬프트에 포함해 reply 생성 품질을 높인다.
 *   미전달 시 해당 섹션을 생략하고 기존 동작과 동일하게 처리한다.
 *
 * @param {import('./preprocessor.js').SlimPreprocessed} pre
 * @param {Object|null} [visitCtx]  collectVisitContext() 반환값 (선택)
 * @returns {string}
 */
export function buildUserPrompt(pre, visitCtx = null) {
  const { cleanText, language, lengthInfo, emojis, diversitySeed } = pre;

  // ── 섹션 A: 입력 메타데이터 ──────────────────────────────────────
  const metaSection = `
## 입력 메타데이터 (기계적 전처리 결과)
- 입력 언어: ${language} (${LANG_LABEL[language] || language})
- 입력 길이: ${lengthInfo.class} (${lengthInfo.charCount}자)
- 분석 신뢰도: ${(lengthInfo.analysisReliability * 100).toFixed(0)}%
- 포함된 이모지: ${emojis.length > 0 ? emojis.join(' ') : '없음'}
- 다양성 시드: ${diversitySeed % 10000}`.trim();

  // ── 섹션 B: 분석 신뢰도 지시 ─────────────────────────────────────
  const reliabilityNote = lengthInfo.analysisReliability < 0.5
    ? `\n⚠️ 입력이 매우 짧습니다. 명시적 표현이 없더라도 맥락과 분위기를 적극적으로 추론해 주세요.`
    : lengthInfo.analysisReliability >= 0.95
    ? `\n✅ 충분한 입력입니다. 텍스트에 담긴 모든 감성 신호를 세밀하게 분석해 주세요.`
    : '';

  // ── 섹션 C: 이모지 분석 지시 ─────────────────────────────────────
  const emojiInstruction = emojis.length > 0
    ? `\n이모지 분석 지시: [${emojis.join(', ')}]가 포함되어 있습니다.\n각 이모지의 이 문맥에서의 감성적 의미를 해석하여 감성 점수에 반영하세요.\n(예: 😭는 슬픔이 아닌 "너무 감동적"의 과장 표현일 수 있습니다)`
    : '';

  // ── 섹션 D: [v4.0 신규] 방문 시점 컨텍스트 ──────────────────────
  // reply 생성에 필수적인 절기·계절·시간대·동행자 정보를 AI에게 제공한다.
  // visitCtx 미전달 시 이 섹션은 완전히 생략된다.
  const visitSection = visitCtx ? `
## 방문 시점 컨텍스트 (시스템 자동 수집 — reply 작성에 활용)
- 계절    : ${visitCtx.seasonLabel} (${visitCtx.season})
- 시간대  : ${visitCtx.timeSlot?.label ?? '알 수 없음'}
- 절기    : ${visitCtx.solarTerm?.name ?? '없음'}${visitCtx.isNearSolarTerm ? ' ← 3일 이내 근접, reply에 반드시 활용' : ''}
- 주말    : ${visitCtx.isWeekend ? '주말' : '평일'}
- 시간 표현: ${visitCtx.timeExpression ?? ''}
- 동행자  : ${visitCtx.companionOverride ?? '소감 텍스트에서 추론'}`.trim()
  : '';

  // ── 섹션 E: 소감 원문 ─────────────────────────────────────────────
  const impressionSection = `
## 방문객 소감 원문
"${cleanText}"`;

  // ── 섹션 F: 울산 12경 참조 목록 ──────────────────────────────────
  const spotsReference = SPOTS
    .map((s, i) => `  ${i}: ${s.name}`)
    .join('\n');

  // ── 섹션 G: 출력 JSON 스키마 ─────────────────────────────────────
  // [v4.0] reply 블록 추가
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

### 단계 4: 타이포그래피 & responseText
responseType 기준:
  A = 활기·경이 중심 (amazement+vitality 합 > 110)
  B = 평화·서정 중심 (peace+nostalgia+warmth 합 > 150)
  C = 복합·혼합 감성

responseText: 울산 관광과 명의, 2~3문장, 소감에 직접 반응,
              언어는 ${language}로 작성.

### 단계 5: E-Card 3단 답글 (reply)
시스템 프롬프트의 [E-Card 3단 답글 작성 지시] 규칙을 준수하여 작성.
${visitCtx ? `위 "방문 시점 컨텍스트"의 절기·계절·시간대를 reply.place에 반드시 활용하세요.` : ''}

reply.main    : 10~18자, 시적이고 여운 있는 메인 문장
reply.place   : 20~35자, 경승지/자연/감성과 계절을 연결하는 장소 문장
reply.tagline : "ULSAN — " + 4~8자 한글 태그라인

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
  "responseText": "울산 관광과 명의 맞춤 답글 2~3문장",
  "reply": {
    "main":    "메인 문장 (10~18자)",
    "place":   "장소 연결 문장 (20~35자)",
    "tagline": "ULSAN — 태그라인"
  }
}`;

  return [
    metaSection,
    reliabilityNote,
    emojiInstruction,
    visitSection,        // [v4.0] 방문 시점 컨텍스트 섹션
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
 */
async function callGeminiAPI(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');

  const url = `${API_CONFIG.ENDPOINT}/${API_CONFIG.MODEL}:generateContent?key=${apiKey}`;

  let lastError;

  for (let attempt = 0; attempt <= API_CONFIG.MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, API_CONFIG.RETRY_DELAY * attempt));
    }

    try {
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

      const res = await fetch(url, {
        method:  'POST',
        signal:  controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            { role: 'user', parts: [{ text: userPrompt }] },
          ],
          generationConfig: {
            maxOutputTokens: API_CONFIG.MAX_TOKENS,
            temperature: 0.2,
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        const reason = data?.candidates?.[0]?.finishReason ?? 'UNKNOWN';
        throw new Error(`Gemini 응답 텍스트 없음 (finishReason: ${reason})`);
      }

      return text;

    } catch (err) {
      lastError = err;
      console.warn(`[ai-extractor] 시도 ${attempt + 1} 실패:`, err.message);
      if (err.status === 400 || err.status === 401 || err.status === 403) break;
    }
  }

  throw new Error(`Gemini API 호출 ${API_CONFIG.MAX_RETRIES + 1}회 모두 실패: ${lastError?.message}`);
}

// =============================================================================
// ④ JSON 파싱 & 유효성 검사
// =============================================================================

function parseAIResponse(rawResponse) {
  let text = rawResponse.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

  const jsonStart = text.indexOf('{');
  const jsonEnd   = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    text = text.slice(jsonStart, jsonEnd + 1);
  }

  return JSON.parse(text);
}

/**
 * 파싱된 AI 응답의 필수 필드를 검증하고 범위를 보정한다.
 * [v4.0] reply 블록 검증 추가
 */
function validateAndSanitize(parsed) {
  const errors = [];
  const p = parsed;

  // 기존 필수 키 검증
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
        p.emotionScores[k] = 25;
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

  // ── [v4.0] reply 블록 검증 및 보정 ───────────────────────────────
  if (!p.reply || typeof p.reply !== 'object') {
    // reply 블록 자체가 없으면 responseText를 main으로 대체
    p.reply = _buildFallbackReply(p);
    errors.push('reply 블록 누락 → 기본값 적용');
  } else {
    // main 검증
    if (typeof p.reply.main !== 'string' || !p.reply.main.trim()) {
      p.reply.main = '울산이 당신에게 건넨 소중한 순간';
      errors.push('reply.main 누락 → 기본값 적용');
    }
    // place 검증
    if (typeof p.reply.place !== 'string' || !p.reply.place.trim()) {
      p.reply.place = '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 남기를 바랍니다.';
      errors.push('reply.place 누락 → 기본값 적용');
    }
    // tagline 검증 — "ULSAN — " 접두어 보장
    if (typeof p.reply.tagline !== 'string' || !p.reply.tagline.trim()) {
      p.reply.tagline = 'ULSAN — 당신의 울산';
      errors.push('reply.tagline 누락 → 기본값 적용');
    } else {
      const t = p.reply.tagline.trim();
      p.reply.tagline = (t.startsWith('ULSAN —') || t.startsWith('ULSAN-'))
        ? t
        : `ULSAN — ${t}`;
    }
  }

  return { valid: errors.length === 0, errors, sanitized: p };
}

/**
 * reply 블록이 없을 때 responseText로 대체 reply를 구성한다.
 * @param {Object} p  파싱된 응답
 * @returns {{ main, place, tagline }}
 */
function _buildFallbackReply(p) {
  const responseText = p.responseText ?? '';
  // responseText 첫 문장을 main으로 활용 (20자 이내로 자름)
  const firstSentence = responseText.split(/[.。！!]/)[0]?.trim() ?? '';
  const main = firstSentence.length > 0 && firstSentence.length <= 20
    ? firstSentence
    : '울산이 당신에게 건넨 소중한 순간';

  return {
    main,
    place:   '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 남기를 바랍니다.',
    tagline: 'ULSAN — 당신의 울산',
  };
}

// =============================================================================
// ⑤ 폴백 응답 생성기
// =============================================================================

/**
 * API 실패 또는 파싱 오류 시 기본 응답을 생성한다.
 * [v4.0] reply 기본값 포함
 */
function generateFallback(pre) {
  const seed      = pre.diversitySeed % 12;
  const spotIndex = seed;
  const micro     = (pre.diversitySeed % 1000) / 1000;

  const FALLBACK_MESSAGES = {
    ko: `울산을 방문해 주셔서 감사합니다. 울산의 아름다운 풍경이 오래도록 기억에 남기를 바랍니다. 다시 울산에서 만나요!`,
    en: `Thank you for visiting Ulsan! We hope the beautiful scenery stays with you. See you again in Ulsan!`,
    ja: `울산にお越しいただきありがとうございます。美しい풍경が記憶に残りますように。またお越しください！`,
    zh: `感谢您来访蔚山！希望蔚山的美景长留心中。期待再次相见！`,
  };

  // [v4.0] 폴백에도 reply 포함
  const FALLBACK_REPLY = {
    main:    '울산이 당신에게 건넨 소중한 순간',
    place:   '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 남기를 바랍니다.',
    tagline: 'ULSAN — 당신의 울산',
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
    reply:            FALLBACK_REPLY,   // [v4.0]
    _isFallback:      true,
  };
}

// =============================================================================
// ⑥ 메인 추출 함수
// =============================================================================

/**
 * 전처리된 입력을 받아 Gemini AI로 종합 감성 분석 + reply 생성을 수행한다.
 *
 * [v4.0] visitCtx 파라미터 추가
 *
 * @param {import('./preprocessor.js').SlimPreprocessed} pre
 * @param {Object|null} [visitCtx]  collectVisitContext() 반환값
 * @returns {Promise<ExtractionResult>}
 */
export async function extractEmotions(pre, visitCtx = null) {
  const t0 = Date.now();

  // 품질 부족 → 즉시 폴백
  if (!pre.quality.isAcceptable) {
    return {
      ...generateFallback(pre),
      _meta: {
        skippedReason: `품질 미달 (${pre.quality.score}점): ${pre.quality.issues.join(', ')}`,
        processingTimeMs: Date.now() - t0,
      },
    };
  }

  // 프롬프트 생성 — [v4.0] visitCtx 전달
  const userPrompt = buildUserPrompt(pre, visitCtx);
  let rawResponse, parsed, sanitized;

  try {
    rawResponse = await callGeminiAPI(SYSTEM_PROMPT, userPrompt);
    parsed      = parseAIResponse(rawResponse);

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
      processingTimeMs:  Date.now() - t0,
      rawResponseLength: rawResponse.length,
      isFallback:        false,
    },
  };
}

// =============================================================================
// ⑦ 디버그 유틸리티
// =============================================================================

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
  console.log('💬 responseText:', result.responseText);

  // [v4.0] reply 출력
  if (result.reply) {
    console.group('📝 E-Card 3단 답글 (reply)');
    console.log('main   :', result.reply.main);
    console.log('place  :', result.reply.place);
    console.log('tagline:', result.reply.tagline);
    console.groupEnd();
  }

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
