/**
 * @fileoverview server/routes/impression.js
 * @description  POST /api/impression  (방안C: SSE 스트리밍)
 *
 * ─────────────────────────────────────────────────────────────────
 * [방안C] SSE 스트리밍 — 2단계 분리 전송
 * ─────────────────────────────────────────────────────────────────
 *
 *   방안B (단일 Gemini 호출)를 유지하면서,
 *   Gemini 응답 완료 후 결과를 2개의 SSE 이벤트로 분리 전송한다.
 *
 *   Phase 1 — colors 이벤트 (Gemini 완료 즉시)
 *     → emotionScores, colorTempFilter, diversitySeed, spotIndex 등
 *     → 클라이언트가 즉시 SVG 색채 전환 + 블러 해제 실행
 *     → 사용자가 색채 애니메이션을 먼저 봄
 *
 *   Phase 2 — reply 이벤트 (colors 직후 ~수십ms)
 *     → reply { main, place, tagline }, primaryEmotion, keywords 등
 *     → 클라이언트가 답글 카드 등장 애니메이션 실행
 *
 *   체감 대기시간 단축 효과:
 *     - 기존: Gemini 완료(5~10초) 후 한 번에 렌더 → 긴 정적 로딩
 *     - 방안C: Gemini 완료 즉시 색채 전환 → 답글 뒤따라 등장
 *       "살아있는 느낌"의 순차 연출이 이 프로젝트 UX와 완벽히 맞음
 *
 * ─────────────────────────────────────────────────────────────────
 * 전송 형식 (text/event-stream)
 * ─────────────────────────────────────────────────────────────────
 *
 *   event: colors
 *   data: { type:'colors', spotIndex, spotName, emotionScores,
 *            colorTempFilter, diversitySeed, meta }
 *
 *   event: reply
 *   data: { type:'reply', reply, primaryEmotion, keywords,
 *            meta }
 *
 *   event: done
 *   data: { type:'done' }
 *
 *   오류 시:
 *   event: error
 *   data: { type:'error', message }
 *
 * ─────────────────────────────────────────────────────────────────
 * 클라이언트 처리 (public/js/api.js)
 * ─────────────────────────────────────────────────────────────────
 *
 *   fetch + ReadableStream으로 SSE를 수신한다.
 *   EventSource 대신 fetch를 사용하는 이유:
 *     - POST body(text, language 등)를 전송해야 하므로
 *     - EventSource는 GET만 지원
 *
 * ─────────────────────────────────────────────────────────────────
 * 하위 호환
 * ─────────────────────────────────────────────────────────────perfectly
 *
 *   기존 POST /api/impression JSON 응답 방식은 제거하고
 *   SSE로 단일화한다. api.js가 SSE를 파싱해 기존과 동일한
 *   data 객체를 resolve하므로 app.js 변경 불필요.
 *
 * ─────────────────────────────────────────────────────────────────
 * 처리시간: 약 5~10초 (Gemini 1회 호출) — 체감 로딩 50% 단축
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

import { Router }             from 'express';
import { analyzeImpression }  from '../../emotion-engine/index.js';
import { collectVisitContext } from '../../reply-engine/visit-context.js';
import { saveToSupabase }     from '../services/supabase-logger.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────
// 입력값 검증
// ─────────────────────────────────────────────────────────────────

function validateText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, error: '소감 텍스트가 없습니다.' };
  }
  const cleaned = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 8)   return { valid: false, error: '소감을 조금 더 자세히 적어주세요 (8자 이상).' };
  if (cleaned.length > 500) return { valid: false, error: '소감이 너무 깁니다 (500자 이하).' };
  return { valid: true, cleaned };
}

const TRIP_DURATION_LABELS = {
  day: '당일치기 여행', '1n2d': '1박 2일 여행',
  '2n3d': '2박 3일 여행', '3n4d': '3박 4일 여행', '4n+': '4박 이상의 긴 여행',
};
const COMPANION_MAP = {
  solo: 'solo', family: 'family', friends: 'friends', couple: 'couple', other: 'friends',
};

// ─────────────────────────────────────────────────────────────────
// SSE 헬퍼 — 이벤트 전송
// ─────────────────────────────────────────────────────────────────

/**
 * SSE 이벤트 한 건을 res에 기록한다.
 *
 * @param {import('express').Response} res
 * @param {string} eventName  이벤트 이름 (colors | reply | done | error)
 * @param {Object} payload    JSON 직렬화될 데이터
 */
function sendEvent(res, eventName, payload) {
  // SSE 규격: "event: name\ndata: json\n\n"
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

// ─────────────────────────────────────────────────────────────────
// reply 안전 추출
// ─────────────────────────────────────────────────────────────────

function extractReply(typography) {
  const r = typography?.reply;
  const main    = (typeof r?.main    === 'string' && r.main.trim())    ? r.main.trim()    : '울산이 당신에게 건넨 소중한 순간';
  const place   = (typeof r?.place   === 'string' && r.place.trim())   ? r.place.trim()   : '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 남기를 바랍니다.';
  const rawTag  = typeof r?.tagline === 'string' ? r.tagline.trim() : '';
  const tagline = rawTag ? (rawTag.startsWith('ULSAN') ? rawTag : `ULSAN — ${rawTag}`) : 'ULSAN — 당신의 울산';
  return { main, place, tagline, isFallback: !r?.main?.trim() };
}

// ─────────────────────────────────────────────────────────────────
// POST /api/impression  (SSE)
// ─────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const t0 = Date.now();
  const { text, language, tripDuration, companion } = req.body;

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
  // 헤더를 보내는 순간 클라이언트와 스트림 연결이 시작된다.
  // 이후 오류는 SSE error 이벤트로 전달한다.
  res.setHeader('Content-Type',  'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');  // Nginx 버퍼링 비활성화
  res.flushHeaders();                         // 헤더 즉시 전송

  // ── 3. visitContext 선행 수집 ────────────────────────────────────
  const visitCtx = collectVisitContext();
  if (companionKey) visitCtx.companionOverride = companionKey;

  const replySourceText = tripLabel ? `[${tripLabel}] ${cleanText}` : cleanText;

  // ── 4. Gemini 단일 호출 (방안B 유지) ─────────────────────────────
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

  // ── 경승지 이미지 선택 ────────────────────────────────────────────
  //
  // 우선순위:
  //   1순위: 소감에 12경 키워드 명시 → 글자 수 무관하게 해당 경승지
  //   2순위: 15자 이하 + 키워드 없음  → 랜덤 (AI 신뢰도 낮음)
  //   3순위: 16자 이상 + 키워드 없음  → AI 분석 결과
  //
  //   '대왕암공원 해안길을 걸었어요' (긴 소감, 대왕암 언급) → 대왕암공원 ✅
  //   '울산 너무 좋아요'              (8자, 언급 없음)       → 랜덤
  //   '파도 소리가 인상적이었습니다'  (16자 이상, 언급 없음) → AI 결과
  // ──────────────────────────────────────────────────────────────────

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

  const _charCount      = cleanText.replace(/\s+/g, '').length;
  const _aiSpotIndex    = typography?.spotIndex ?? 0;

  // 1순위: 글자 수와 무관하게 항상 키워드 먼저 검사
  const _mentionedIdx = SPOT_KEYWORDS.findIndex(keywords =>
    keywords.some(kw => cleanText.includes(kw))
  );

  const spotIndex =
    _mentionedIdx >= 0 ? _mentionedIdx              // 키워드 언급 → 해당 경승지
    : _charCount   <= 15 ? Math.floor(Math.random() * 12)  // 짧고 언급 없음 → 랜덤
    : _aiSpotIndex;                                  // 충분한 길이 → AI 결과

  const processingTimeMs = Date.now() - t0;

  // ─────────────────────────────────────────────────────────────────
  // Phase 1: colors 이벤트 — emotionScores 전달 (스펙트럼/폰트 선택용)
  // ─────────────────────────────────────────────────────────────────
  sendEvent(res, 'colors', {
    type:        'colors',
    spotIndex,
    spotName:    typography?.spotName ?? '',
    emotionScores,
    meta: {
      processingTimeMs,
      isFallback: emotionIsFallback,
    },
  });

  // ─────────────────────────────────────────────────────────────────
  // Phase 2: reply 이벤트 전송 — 답글 카드 렌더에 필요한 데이터
  //
  // colors 이벤트 직후 수십ms 이내에 전송된다.
  // 클라이언트는 이 이벤트를 받으면:
  //   ① renderResult(data) — 답글 카드 + 키워드 + 스펙트럼
  //   ② setPhase('done')
  // ─────────────────────────────────────────────────────────────────
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

  // ── done 이벤트 — 스트림 종료 신호 ─────────────────────────────
  sendEvent(res, 'done', { type: 'done' });
  res.end();

  // ── 완료 로그 ────────────────────────────────────────────────────
  console.log(
    `[impression-sse] 완료 ${processingTimeMs}ms |`,
    `경승지: ${typography?.spotName} |`,
    `감성: ${typography?.primaryEmotion} |`,
    emotionIsFallback ? '⚠️ 감성폴백' : '✅',
    replyIsFallback   ? '⚠️ 답글폴백' : '✅',
    '| SSE 2단계 전송',
  );

  // ── Supabase 저장 (fire-and-forget) ─────────────────────────────
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
