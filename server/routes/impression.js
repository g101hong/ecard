/**
 * @fileoverview server/routes/impression.js
 * @description  POST /api/impression  (방안C: SSE 스트리밍)
 * @version 3.1.0
 *
 * [v3.1 변경] 폰트 불일치 수정
 * ─────────────────────────────────────────────────────────────────
 *   - pickDominantEmotion() 함수 추가
 *   - SSE colors 이벤트에 dominantEmotion 필드 추가
 *   → 클라이언트(app.js)와 서버(png-exporter.js) 모두
 *     이 값을 그대로 사용 → 재계산·불일치 원천 차단
 *
 * [v3.0 변경] 방안A — 결정론적 경승지 선택
 * [v2.0 변경] 방안B+C — 단일 Gemini 호출 + SSE 2단계 전송
 */

'use strict';

import { Router }             from 'express';
import { analyzeImpression }  from '../../emotion-engine/index.js';
import { collectVisitContext } from '../../reply-engine/visit-context.js';
import { saveToSupabase }     from '../services/supabase-logger.js';

const router = Router();

// =============================================================================
// ① dominant 감성 결정 함수
// =============================================================================

/**
 * 감성 점수에서 dominant 감성을 결정한다.
 * emotion-fonts.js의 EMOTION_PRIORITY와 동일한 순서·로직 사용.
 * 서버에서 한 번 결정한 값을 클라이언트와 PNG 저장 양쪽에 전달하여
 * 재계산에 의한 불일치를 방지한다.
 *
 * @param {Object} scores  { amazement, peace, ... } (0~100)
 * @returns {string}  감성 키
 */
function pickDominantEmotion(scores) {
  const PRIORITY = [
    'amazement', 'mystery', 'grandeur', 'nostalgia',
    'warmth',    'vitality', 'freshness', 'peace',
  ];
  if (!scores || typeof scores !== 'object') return 'amazement';
  let maxVal = -1;
  for (const k of PRIORITY) {
    const v = Number(scores[k]) || 0;
    if (v > maxVal) maxVal = v;
  }
  return PRIORITY.find((k) => (Number(scores[k]) || 0) === maxVal) ?? 'amazement';
}

// =============================================================================
// ② cyrb53 해시 (결정론적 경승지 선택용)
// =============================================================================

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
// ③ 입력값 검증
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
// ④ SSE 이벤트 전송 헬퍼
// =============================================================================

function sendEvent(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// =============================================================================
// ⑤ reply 추출 헬퍼
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
// ⑥ 경승지 키워드 목록
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
// ⑦ 여행 기간·동행자 매핑
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
// ⑧ POST /api/impression — SSE 스트리밍 핸들러
// =============================================================================

router.post('/', async (req, res) => {
  const t0 = Date.now();
  const { text, language = 'ko', tripDuration, companion } = req.body;

  // ── 1. 입력값 검증 ─────────────────────────────────────────────
  const validation = validateText(text);
  if (!validation.valid) {
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

  // ── 4. Gemini 단일 호출 ─────────────────────────────────────────
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

  // ── 5. dominant 감성 결정 (서버에서 1회 결정 → 클라이언트·PNG 동일 사용)
  const dominantEmotion = pickDominantEmotion(emotionScores);

  // ── 6. 경승지 이미지 선택 ──────────────────────────────────────
  const _charCount   = cleanText.replace(/\s+/g, '').length;
  const _aiSpotIndex = typography?.spotIndex ?? 0;

  const _mentionedIdx = SPOT_KEYWORDS.findIndex(keywords =>
    keywords.some(kw => cleanText.includes(kw))
  );

  const _seedSpotIndex = cyrb53Hash(cleanText) % 12;

  const spotIndex =
    _mentionedIdx  >= 0 ? _mentionedIdx
    : _charCount   <= 15 ? _seedSpotIndex
    : _aiSpotIndex;

  const processingTimeMs = Date.now() - t0;

  // ── 7. Phase 1: colors 이벤트 ──────────────────────────────────
  // [v3.1] dominantEmotion 추가 — 클라이언트가 재계산 없이 직접 사용
  sendEvent(res, 'colors', {
    type:             'colors',
    spotIndex,
    spotName:         typography?.spotName ?? '',
    emotionScores,
    dominantEmotion,                               // ← [v3.1] 추가
    meta: {
      processingTimeMs,
      isFallback:   emotionIsFallback,
      shortCircuit: meta?.shortCircuit ?? false,
    },
  });

  // ── 8. Phase 2: reply 이벤트 ───────────────────────────────────
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

  // ── 9. done 이벤트 ─────────────────────────────────────────────
  sendEvent(res, 'done', { type: 'done' });
  res.end();

  // ── 10. 완료 로그 ──────────────────────────────────────────────
  console.log(
    `[impression-sse] 완료 ${processingTimeMs}ms |`,
    `경승지: ${typography?.spotName}(${spotIndex}) |`,
    `감성: ${typography?.primaryEmotion} | 폰트: ${dominantEmotion} |`, // [v3.1]
    meta?.shortCircuit     ? '⚡ 단락회로'  : '🤖 AI분석',
    emotionIsFallback      ? '⚠️ 감성폴백' : '✅',
    replyIsFallback        ? '⚠️ 답글폴백' : '✅',
  );

  // ── 11. Supabase 저장 ──────────────────────────────────────────
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
