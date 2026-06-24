/**
 * @fileoverview server/routes/impression.js
 * @description  POST /api/impression  (방안C: SSE 스트리밍)
 * @version 3.0.0
 *
 * [v3.0 변경] 방안A — 짧은 소감 경승지 선택 결정론적 전환
 * ─────────────────────────────────────────────────────────────────
 *   기존: 15자 이하 + 키워드 없음 → Math.floor(Math.random() * 12)
 *   변경: 15자 이하 + 키워드 없음 → cyrb53Hash(cleanText) % 12
 *
 *   추가: cyrb53Hash() 헬퍼 (preprocessor.js와 동일 알고리즘)
 *   추가: 완료 로그에 단락회로 여부(shortCircuit) 출력
 *
 * [v2.0 변경] 방안B+C — 단일 Gemini 호출 + SSE 2단계 전송 (유지)
 * ─────────────────────────────────────────────────────────────────
 *
 *   Phase 1 — colors 이벤트: emotionScores, spotIndex 등
 *   Phase 2 — reply  이벤트: reply { main, place, tagline }, keywords 등
 *   Phase 3 — done   이벤트: 스트림 종료
 */

'use strict';

import { Router }             from 'express';
import { analyzeImpression }  from '../../emotion-engine/index.js';
import { collectVisitContext } from '../../reply-engine/visit-context.js';
import { saveToSupabase }     from '../services/supabase-logger.js';

const router = Router();

// =============================================================================
// ① cyrb53 해시 (결정론적 경승지 선택용)
// =============================================================================

/**
 * cyrb53 해시 — emotion-engine/preprocessor.js의 cyrb53Hash()와 동일 알고리즘.
 * diversitySeed와 동일한 값을 impression.js에서 독립적으로 계산하는 데 사용한다.
 *
 * @param {string} str
 * @param {number} [seed=0]
 * @returns {number}  0 이상의 정수
 */
function cyrb53Hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)) >>> 0;
}

// =============================================================================
// ② 입력값 검증
// =============================================================================

function validateText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, error: '소감 텍스트가 없습니다.' };
  }
  const cleaned = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 8)   return { valid: false, error: '소감을 조금 더 자세히 적어주세요 (8자 이상).' };
  if (cleaned.length > 500) return { valid: false, error: '소감이 너무 깁니다 (500자 이하).' };
  return { valid: true, cleaned };
}

// =============================================================================
// ③ SSE 이벤트 전송 헬퍼
// =============================================================================

function sendEvent(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// =============================================================================
// ④ reply 추출 헬퍼
// =============================================================================

function extractReply(typography) {
  const reply = typography?.reply;
  if (reply && reply.main && reply.place && reply.tagline) {
    return { ...reply, isFallback: false };
  }
  return {
    main:    '울산이 당신에게 건넨 소중한 순간',
    place:   '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 남기를 바랍니다.',
    tagline: 'ULSAN — 당신의 울산',
    isFallback: true,
  };
}

// =============================================================================
// ⑤ 경승지 키워드 목록
// =============================================================================

const SPOT_KEYWORDS = [
  ['간절곶'],                          // 0 간절곶 일출
  ['대왕암'],                          // 1 대왕암공원
  ['강동', '몽돌'],                    // 2 강동 몽돌해변
  ['장생포', '고래'],                  // 3 장생포 고래문화마을
  ['외고산', '옹기'],                  // 4 외고산 옹기마을
  ['반구대', '암각화'],                // 5 반구대 암각화
  ['대운산', '내원암'],                // 6 대운산 내원암 계곡
  ['울산대교'],                        // 7 울산대교
  ['울산대공원'],                      // 8 울산대공원
  ['태화강', '십리대숲', '대숲'],      // 9 태화강 국가정원·십리대숲
  ['신불산', '억새'],                  // 10 신불산 억새평원
  ['가지산'],                          // 11 가지산 사계
];

// =============================================================================
// ⑥ 여행 기간·동행자 매핑
// =============================================================================

const TRIP_DURATION_LABELS = {
  day:   '당일치기',
  '1n2d': '1박2일',
  '2n3d': '2박3일',
  '3n4d': '3박4일',
  '4n+':  '4박 이상',
};

const COMPANION_MAP = {
  solo:    'solo',
  family:  'family',
  friends: 'friends',
  couple:  'couple',
  other:   'other',
};

// =============================================================================
// ⑦ POST /api/impression — SSE 스트리밍 핸들러
// =============================================================================

router.post('/', async (req, res) => {
  const t0 = Date.now();
  const { text, language = 'ko', tripDuration, companion } = req.body;

  // ── 1. 입력값 검증 ─────────────────────────────────────────────
  const validation = validateText(text);
  if (!validation.valid) {
    // SSE 헤더 전에 오류면 일반 JSON 응답
    return res.status(400).json({ error: validation.error });
  }
  const cleanText    = validation.cleaned;
  const tripLabel    = TRIP_DURATION_LABELS[tripDuration] ?? null;
  const companionKey = COMPANION_MAP[companion] ?? null;

  // ── 2. SSE 헤더 설정 ───────────────────────────────────────────
  res.setHeader('Content-Type',      'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // ── 3. visitContext 선행 수집 ───────────────────────────────────
  const visitCtx = collectVisitContext();
  if (companionKey) visitCtx.companionOverride = companionKey;

  const replySourceText = tripLabel ? `[${tripLabel}] ${cleanText}` : cleanText;

  // ── 4. Gemini 단일 호출 (방안B 유지) ───────────────────────────
  let emotionResult;
  try {
    emotionResult = await analyzeImpression(replySourceText, { language, visitCtx });
  } catch (err) {
    console.error('[impression-sse] emotion-engine 오류:', err.message);
    sendEvent(res, 'error', { type: 'error', message: `감성 분석 실패: ${err.message}` });
    res.end();
    return;
  }

  const { emotionScores, typography, isFallback: emotionIsFallback, meta } = emotionResult;

  // ── 5. 경승지 이미지 선택 ──────────────────────────────────────
  //
  //   1순위: 소감에 12경 키워드 명시 → 글자 수 무관하게 해당 경승지
  //   2순위: 15자 이하 + 키워드 없음 → 시드 결정론적 [v3.0]
  //            (기존 Math.random() → cyrb53Hash로 변경)
  //            emotion-engine 단락회로의 diversitySeed % 12와 일치
  //   3순위: 16자 이상 + 키워드 없음 → AI 분석 결과
  //
  const _charCount   = cleanText.replace(/\s+/g, '').length;
  const _aiSpotIndex = typography?.spotIndex ?? 0;

  // 1순위: 키워드 명시 여부
  const _mentionedIdx = SPOT_KEYWORDS.findIndex(keywords =>
    keywords.some(kw => cleanText.includes(kw))
  );

  // [v3.0] 2순위: Math.random() → cyrb53Hash 결정론적
  const _seedSpotIndex = cyrb53Hash(cleanText) % 12;

  const spotIndex =
    _mentionedIdx  >= 0 ? _mentionedIdx    // 1순위: 키워드 명시
    : _charCount   <= 15 ? _seedSpotIndex  // 2순위: 시드 결정론적 [v3.0]
    : _aiSpotIndex;                        // 3순위: AI 결과

  const processingTimeMs = Date.now() - t0;

  // ── 6. Phase 1: colors 이벤트 ──────────────────────────────────
  sendEvent(res, 'colors', {
    type:         'colors',
    spotIndex,
    spotName:     typography?.spotName ?? '',
    emotionScores,
    meta: {
      processingTimeMs,
      isFallback:   emotionIsFallback,
      shortCircuit: meta?.shortCircuit ?? false,   // [v3.0]
    },
  });

  // ── 7. Phase 2: reply 이벤트 ───────────────────────────────────
  const { main, place, tagline, isFallback: replyIsFallback } = extractReply(typography);

  sendEvent(res, 'reply', {
    type:           'reply',
    reply:          { main, place, tagline },
    primaryEmotion: typography?.primaryEmotion ?? '',
    keywords:       typography?.keywords       ?? [],
    meta: {
      replyIsFallback,
      tripDuration: tripDuration ?? null,
      companion:    companion    ?? null,
    },
  });

  // ── 8. done 이벤트 — 스트림 종료 ──────────────────────────────
  sendEvent(res, 'done', { type: 'done' });
  res.end();

  // ── 9. 완료 로그 ───────────────────────────────────────────────
  console.log(
    `[impression-sse] 완료 ${processingTimeMs}ms |`,
    `경승지: ${typography?.spotName}(${spotIndex}) |`,
    `감성: ${typography?.primaryEmotion} |`,
    meta?.shortCircuit     ? '⚡ 단락회로'  : '🤖 AI분석',   // [v3.0]
    emotionIsFallback      ? '⚠️ 감성폴백' : '✅',
    replyIsFallback        ? '⚠️ 답글폴백' : '✅',
    '| SSE 2단계 전송',
  );

  // ── 10. Supabase 저장 (fire-and-forget) ────────────────────────
  saveToSupabase({
    text:            cleanText,
    tripDuration:    tripDuration  ?? null,
    companion:       companion     ?? null,
    primaryEmotion:  typography?.primaryEmotion ?? '',
    isFallback:      emotionIsFallback,
    processingTimeMs,
  }).catch(err => console.error('[Supabase] 저장 실패:', err.message));
});

export default router;
