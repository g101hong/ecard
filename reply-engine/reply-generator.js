/**
 * @fileoverview 울산 E-Card 답글 엔진 — 답글 생성 API 호출 모듈
 * @module reply-engine/reply-generator
 * @version 2.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   context-classifier.js의 ClassifiedContext를 받아
 *   Gemini API를 호출하고 E-Card 3단 답글을 반환한다.
 *
 *   [v2.0 변경] AI 엔진 : Anthropic Claude → Google Gemini 2.0 Flash
 *
 *   emotion-engine의 claude-extractor.js와 설계 패턴을 통일한다:
 *     - API 설정 상수 분리
 *     - 재시도 로직 내장 (MAX_RETRIES)
 *     - 응답 파싱 실패 시 reply-fallback으로 위임
 *     - 항상 유효한 ReplyResult 반환 보장
 *
 * ─────────────────────────────────────────────────────────────────
 * [파이프라인 내 위치]
 *
 *   context-classifier.ClassifiedContext
 *         │
 *         ▼
 *   reply-generator.js   ← 이 모듈
 *     ├─ 정상: Claude API → 답글 JSON 파싱 → ReplyResult
 *     └─ 실패: reply-fallback.js → 템플릿 답글 → ReplyResult
 *
 * ─────────────────────────────────────────────────────────────────
 * [출력 구조 — ReplyResult]
 *
 *   {
 *     success  : boolean         API 성공 여부
 *     tier     : 0|1|2|3        폴백 품질 계층
 *     reply    : {
 *       main    : string         메인 문장
 *       place   : string         장소 연결 문장
 *       tagline : string         ULSAN — 태그라인
 *     }
 *     meta     : {
 *       contextType      : string
 *       spotIndex        : number
 *       dominantEmotion  : string
 *       processingTimeMs : number
 *       retryCount       : number
 *       isFallback       : boolean
 *     }
 *   }
 */
 
'use strict';
 
import {
  REPLY_SYSTEM_PROMPT,
  buildReplyUserPrompt,
  parseReplyResponse,
} from './prompts/reply-prompt.js';
 
import { selectTemplate } from './constants/reply-templates.js';
 
// =============================================================================
// ① API 설정 상수
// =============================================================================
 
/**
 * Gemini API 설정.
 * emotion-engine/claude-extractor.js의 API_CONFIG와 동일한 구조.
 * 답글 생성은 토큰을 적게 사용하므로 MAX_TOKENS를 낮게 설정.
 */
const API_CONFIG = Object.freeze({
  // Gemini API — URL에 모델명 포함, 키는 쿼리 파라미터로 전달
  ENDPOINT:    'https://generativelanguage.googleapis.com/v1beta/models',
  MODEL:       'gemini-2.5-flash',
  MAX_TOKENS:  2048,    // 답글은 짧음 — 3필드 합산 최대 ~150자
  MAX_RETRIES: 2,
  RETRY_DELAY: 1000,   // ms (첫 재시도 1초, 두 번째 2초)
  TIMEOUT_MS:  15000,   // 8초 초과 시 타임아웃
});
 
// 폴백 계층 상수 (emotion-engine/fallback-handler.js와 동일 값)
export const REPLY_TIER = Object.freeze({
  NORMAL:   0,  // API 성공
  PARTIAL:  1,  // 응답 일부 보정
  TEMPLATE: 2,  // 템플릿 폴백
  SEED:     3,  // 시드 전용 폴백
});
 
// =============================================================================
// ② 내부 API 호출 함수
// =============================================================================
 
/**
 * Gemini API를 호출하고 응답 텍스트를 반환한다.
 * 실패 시 MAX_RETRIES만큼 재시도한다.
 *
 * [Gemini API 구조]
 *   URL  : {ENDPOINT}/{MODEL}:generateContent?key={GEMINI_API_KEY}
 *   요청 : { system_instruction: { parts:[{text}] },
 *             contents: [{ role:'user', parts:[{text}] }],
 *             generationConfig: { maxOutputTokens, temperature } }
 *   응답 : { candidates:[{ content:{ parts:[{text}] }, finishReason }] }
 *
 * @param {string} userPrompt
 * @returns {Promise<string>}  응답 텍스트
 * @throws {Error}  모든 재시도 실패 시
 */
async function _callAPI(userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
 
  const url = `${API_CONFIG.ENDPOINT}/${API_CONFIG.MODEL}:generateContent?key=${apiKey}`;
 
  let lastError;
 
  for (let attempt = 0; attempt <= API_CONFIG.MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, API_CONFIG.RETRY_DELAY * attempt));
    }
 
    try {
      // AbortController로 타임아웃 구현
      const controller = new AbortController();
      const timeoutId  = setTimeout(
        () => controller.abort(),
        API_CONFIG.TIMEOUT_MS,
      );
 
      const res = await fetch(url, {
        method:  'POST',
        signal:  controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 시스템 프롬프트 — Gemini는 system_instruction 필드 사용
          system_instruction: {
            parts: [{ text: REPLY_SYSTEM_PROMPT }],
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
 
      clearTimeout(timeoutId);
 
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err  = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
 
      const data = await res.json();
 
      // Gemini 응답 구조: candidates[0].content.parts[0].text
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        const reason = data?.candidates?.[0]?.finishReason ?? 'UNKNOWN';
        throw new Error(`Gemini 응답 텍스트 없음 (finishReason: ${reason})`);
      }
 
      return text;
 
    } catch (err) {
      lastError = err;
      const isAbort = err.name === 'AbortError';
      console.warn(
        `[reply-generator] 시도 ${attempt + 1}/${API_CONFIG.MAX_RETRIES + 1} 실패:`,
        isAbort ? '타임아웃' : err.message,
      );
 
      // 인증 오류·잘못된 요청은 재시도 불필요
      if (err.status === 400 || err.status === 401 || err.status === 403) break;
    }
  }
 
  throw new Error(
    `Gemini API ${API_CONFIG.MAX_RETRIES + 1}회 모두 실패: ${lastError?.message}`,
  );
}
 
// =============================================================================
// ③ 오류 유형 분류
// =============================================================================
 
/**
 * 오류 객체를 분석하여 유형 문자열을 반환한다.
 * emotion-engine/fallback-handler.js의 classifyError와 동일 패턴.
 *
 * @param {Error} err
 * @returns {string}
 */
function _classifyError(err) {
  if (!err) return 'UNKNOWN';
  const msg    = (err.message ?? '').toLowerCase();
  const status = err.status ?? 0;
 
  if (status === 429)                              return 'API_RATE_LIMIT';
  if (status === 401 || status === 403)            return 'API_AUTH_ERROR';
  if (status === 400)                              return 'API_BAD_REQUEST';
  if (status >= 500)                               return 'API_SERVER_ERROR';
  if (msg.includes('abort') || msg.includes('timeout')) return 'NETWORK_TIMEOUT';
  if (msg.includes('fetch') || msg.includes('network'))  return 'NETWORK_OFFLINE';
  if (msg.includes('json')  || msg.includes('parse'))    return 'JSON_PARSE_ERROR';
  return 'UNKNOWN';
}
 
// =============================================================================
// ④ 폴백 답글 생성
// =============================================================================
 
/**
 * API 실패 시 reply-templates.js에서 폴백 답글을 선택한다.
 *
 * @param {import('./context-classifier.js').ClassifiedContext} ctx
 * @returns {{ main: string, place: string, tagline: string }}
 */
function _buildFallbackReply(ctx) {
  return selectTemplate({
    dominantEmotion: ctx.dominantEmotion,
    season:          ctx.season,
    diversitySeed:   ctx.diversitySeed ?? 0,
  });
}
 
// =============================================================================
// ⑤ 메인 생성 함수
// =============================================================================
 
/**
 * @typedef {Object} ReplyResult
 *
 * @property {boolean} success         API 성공 여부
 * @property {number}  tier            REPLY_TIER 값
 * @property {boolean} isFallback      폴백 사용 여부
 *
 * @property {{ main:string, place:string, tagline:string }} reply  E-Card 3단 답글
 *
 * @property {Object} meta
 * @property {string} meta.contextType       분류 유형
 * @property {number} meta.spotIndex         경승지 인덱스
 * @property {string} meta.dominantEmotion   지배 감성
 * @property {string} meta.season            계절
 * @property {string} meta.placeExpression   장소 표현
 * @property {number} meta.processingTimeMs  처리 시간
 * @property {number} meta.retryCount        재시도 횟수
 * @property {string} [meta.errorType]       오류 유형 (폴백 시)
 * @property {string} [meta.fallbackTier]    폴백 계층명
 */
 
/**
 * ClassifiedContext를 받아 E-Card 3단 답글을 생성한다.
 *
 * 처리 흐름:
 *   1. buildReplyUserPrompt로 프롬프트 생성
 *   2. Claude API 호출 (재시도 포함)
 *   3. parseReplyResponse로 JSON 파싱
 *   4. 실패 시 템플릿 폴백으로 전환
 *   5. 항상 유효한 ReplyResult 반환
 *
 * @param {import('./context-classifier.js').ClassifiedContext} ctx
 * @param {string} [originalText='']  방문객 소감 원문
 * @returns {Promise<ReplyResult>}
 *
 * @example
 * const result = await generateReply(classified, "파도 소리가 귓가에 맴돌아요");
 * result.reply.main    // → "울산의 파도는 당신을 기억합니다"
 * result.reply.place   // → "가을 오후, 그 파도 소리가 새긴 자리"
 * result.reply.tagline // → "ULSAN — 다시 돌아오는 곳"
 * result.success       // → true
 * result.tier          // → 0 (NORMAL)
 */
export async function generateReply(ctx, originalText = '') {
  const t0 = Date.now();
 
  const baseMeta = {
    contextType:     ctx.contextType,
    spotIndex:       ctx.spotIndex,
    dominantEmotion: ctx.dominantEmotion,
    season:          ctx.season,
    placeExpression: ctx.placeExpression,
  };
 
  // ── 프롬프트 생성 ────────────────────────────────────────────
  const userPrompt = buildReplyUserPrompt(ctx, originalText);
 
  // ── API 호출 ─────────────────────────────────────────────────
  let rawResponse, reply, retryCount = 0;
 
  try {
    rawResponse = await _callAPI(userPrompt);
 
    // 재시도 횟수 추정 (실제 횟수는 내부에서만 알 수 있으므로 0으로 설정)
    retryCount = 0;
 
  } catch (apiErr) {
    // ── API 실패 → 템플릿 폴백 ───────────────────────────────
    const errorType = _classifyError(apiErr);
    console.warn(`[reply-generator] API 실패 (${errorType}), 템플릿 폴백 사용`);
 
    const fallbackReply = _buildFallbackReply(ctx);
 
    return {
      success:    false,
      tier:       REPLY_TIER.TEMPLATE,
      isFallback: true,
      reply:      fallbackReply,
      meta: {
        ...baseMeta,
        processingTimeMs: Date.now() - t0,
        retryCount:       API_CONFIG.MAX_RETRIES,
        errorType,
        fallbackTier:     'TEMPLATE',
      },
    };
  }
 
  // ── JSON 파싱 ─────────────────────────────────────────────────
  let tier = REPLY_TIER.NORMAL;
 
  try {
    reply = parseReplyResponse(rawResponse);
 
  } catch (parseErr) {
    // ── 파싱 실패 → 템플릿 폴백 ─────────────────────────────
    console.warn('[reply-generator] JSON 파싱 실패, 템플릿 폴백 사용:', parseErr.message);
 
    const fallbackReply = _buildFallbackReply(ctx);
 
    return {
      success:    false,
      tier:       REPLY_TIER.TEMPLATE,
      isFallback: true,
      reply:      fallbackReply,
      meta: {
        ...baseMeta,
        processingTimeMs: Date.now() - t0,
        retryCount,
        errorType:    'JSON_PARSE_ERROR',
        fallbackTier: 'TEMPLATE',
      },
    };
  }
 
// ★ 수정 — JSON 잘림 복구가 발생한 경우도 PARTIAL로 표시
// reply-prompt.js의 parseReplyResponse가 _wasTruncated 플래그를 반환하도록 연동
const isPartial = (
  reply.main    === '울산이 당신에게 건넨 소중한 순간' ||
  reply.place   === '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 남기를 바랍니다.' ||
  reply.tagline === 'ULSAN — 당신의 울산' ||
  reply._wasTruncated === true   // ★ 추가
);
  if (isPartial) tier = REPLY_TIER.PARTIAL;
 
  // ── 정상 반환 ─────────────────────────────────────────────────
  return {
    success:    true,
    tier,
    isFallback: false,
    reply,
    meta: {
      ...baseMeta,
      processingTimeMs: Date.now() - t0,
      retryCount,
    },
  };
}
 
// =============================================================================
// ⑥ 유효성 검사
// =============================================================================
 
/**
 * ReplyResult가 유효한지 검사한다.
 *
 * @param {ReplyResult} result
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateReplyResult(result) {
  const issues = [];
 
  if (!result)                        issues.push('result가 null');
  if (!result?.reply)                 issues.push('reply 객체 없음');
  if (!result?.reply?.main)           issues.push('reply.main 없음');
  if (!result?.reply?.place)          issues.push('reply.place 없음');
  if (!result?.reply?.tagline)        issues.push('reply.tagline 없음');
  if (!result?.reply?.tagline?.startsWith('ULSAN'))
                                      issues.push('tagline ULSAN 형식 오류');
  if (typeof result?.tier !== 'number') issues.push('tier 없음');
 
  return { valid: issues.length === 0, issues };
}
 
// =============================================================================
// ⑦ 디버그 유틸리티
// =============================================================================
 
/**
 * ReplyResult를 콘솔에 출력한다. (개발 전용)
 * @param {ReplyResult} result
 */
export function debugPrintReplyResult(result) {
  /* eslint-disable no-console */
  const TIER_LABELS = ['✅ NORMAL', '⚠️  PARTIAL', '🟡 TEMPLATE', '🔴 SEED'];
 
  console.group('💬 ReplyResult (reply-generator)');
  console.log('상태     :', TIER_LABELS[result.tier] ?? result.tier);
  console.log('폴백     :', result.isFallback ? '✅ 사용됨' : '❌ 미사용');
  console.log('처리시간 :', result.meta?.processingTimeMs + 'ms');
  console.log('');
 
  console.group('📝 E-Card 3단 답글');
  console.log('main    :', result.reply?.main);
  console.log('place   :', result.reply?.place);
  console.log('tagline :', result.reply?.tagline);
  console.groupEnd();
 
  console.group('📊 메타');
  console.log('contextType    :', result.meta?.contextType);
  console.log('spotIndex      :', result.meta?.spotIndex);
  console.log('dominantEmotion:', result.meta?.dominantEmotion);
  console.log('season         :', result.meta?.season);
  console.log('placeExpression:', result.meta?.placeExpression);
  if (result.meta?.errorType) {
    console.log('errorType      :', result.meta.errorType);
    console.log('fallbackTier   :', result.meta.fallbackTier);
  }
  console.groupEnd();
 
  const { valid, issues } = validateReplyResult(result);
  console.log('유효성   :', valid ? '✅ 통과' : '❌ ' + issues.join(', '));
 
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  generateReply,
  validateReplyResult,
  debugPrintReplyResult,
  REPLY_TIER,
  API_CONFIG,
};
 