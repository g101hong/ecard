/**
 * @fileoverview server/routes/impression.js
 * @description  POST /api/impression
 *               소감 텍스트 → 감성 분석 + E-Card 3단 답글 + SVG 파라미터 반환
 *
 * ─────────────────────────────────────────────────────────────────
 * [방안B] 단일 Gemini 호출 통합
 * ─────────────────────────────────────────────────────────────────
 *
 *   변경 전 (2회 호출, 직렬 8~17초):
 *     ① collectVisitContext()           — emotion-engine 완료 후 실행 (동기)
 *     ② emotion-engine.analyzeImpression()  ← Gemini 호출 1
 *     ③ classify() → generateReply()        ← Gemini 호출 2 (직렬 대기)
 *
 *   변경 후 (1회 호출):
 *     ① collectVisitContext()           — emotion-engine 호출 전에 선행 실행 (동기)
 *     ② emotion-engine.analyzeImpression(text, { visitCtx })  ← Gemini 호출 1회
 *          → 감성 분석 + reply 3단 동시 반환
 *          → typography.reply.main / .place / .tagline
 *     ③ reply-engine 호출 없음
 *
 *   효과:
 *     - Gemini API 호출 횟수: 2회 → 1회
 *     - 레이턴시: 40~60% 감소
 *     - API 비용: 절반
 *
 *   폴백 안전망:
 *     - emotion-engine 자체 폴백(generateFallback)이 reply 기본값 포함
 *     - typography.reply가 없을 때를 대비한 인라인 기본값 처리
 *     - reply-engine 모듈은 삭제하지 않고 유지 (향후 재활용 가능)
 *
 * ─────────────────────────────────────────────────────────────────
 * 처리 흐름
 * ─────────────────────────────────────────────────────────────────
 *
 *   POST /api/impression  { text, language?, tripDuration?, companion? }
 *       │
 *       ├─ 1. 입력값 검증 (최소 8자, XSS 기본 처리)
 *       │
 *       ├─ 2. collectVisitContext()             ← 동기, Gemini 호출 전 선행 실행
 *       │       → 절기·계절·시간대 (reply 품질 향상에 활용)
 *       │
 *       ├─ 3. emotion-engine.analyzeImpression(text, { visitCtx })
 *       │       → emotionScores, globalParams, typography (reply 포함)
 *       │         ↑ 단일 Gemini 호출로 감성 분석 + 답글 동시 생성
 *       │
 *       ├─ 4. svg-engine.computeGlobalParams() + colorTempToFilter()
 *       │
 *       └─ 5. 통합 응답 반환
 *
 * ─────────────────────────────────────────────────────────────────
 * 응답 JSON (기존과 동일 — 하위 호환 유지)
 * ─────────────────────────────────────────────────────────────────
 *
 *   {
 *     spotIndex, spotName,
 *     emotionScores, primaryEmotion, keywords,
 *     colorTempFilter, diversitySeed,
 *     reply { main, place, tagline },
 *     meta { processingTimeMs, isFallback, replyIsFallback, ... }
 *   }
 *
 * ─────────────────────────────────────────────────────────────────
 * 처리시간: 약 5~10초 (Gemini API 1회 호출 — 기존 대비 40~60% 단축)
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

import { Router }             from 'express';
import { analyzeImpression }  from '../../emotion-engine/index.js';
import { collectVisitContext } from '../../reply-engine/visit-context.js';
import { computeGlobalParams, colorTempToFilter } from '../../svg-engine/color-calculator.js';
import { saveToSupabase }     from '../services/supabase-logger.js';

// [방안B] reply-engine classify / generateReply 임포트 제거
// import { classify }           from '../../reply-engine/context-classifier.js';
// import { generateReply }      from '../../reply-engine/reply-generator.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────
// 입력값 검증
// ─────────────────────────────────────────────────────────────────

function validateText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, error: '소감 텍스트가 없습니다.' };
  }

  const cleaned = text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 8) {
    return { valid: false, error: '소감을 조금 더 자세히 적어주세요 (8자 이상).' };
  }

  if (cleaned.length > 500) {
    return { valid: false, error: '소감이 너무 깁니다 (500자 이하).' };
  }

  return { valid: true, cleaned };
}

// ─────────────────────────────────────────────────────────────────
// 여행일정 / 동행 입력값 매핑
// ─────────────────────────────────────────────────────────────────

const TRIP_DURATION_LABELS = {
  day:    '당일치기 여행',
  '1n2d': '1박 2일 여행',
  '2n3d': '2박 3일 여행',
  '3n4d': '3박 4일 여행',
  '4n+':  '4박 이상의 긴 여행',
};

const COMPANION_MAP = {
  solo:    'solo',
  family:  'family',
  friends: 'friends',
  couple:  'couple',
  other:   'friends',
};

function resolveTripDurationLabel(value) {
  return TRIP_DURATION_LABELS[value] ?? null;
}

function resolveCompanionKey(value) {
  return COMPANION_MAP[value] ?? null;
}

// ─────────────────────────────────────────────────────────────────
// reply 안전 추출 헬퍼
// ─────────────────────────────────────────────────────────────────

/**
 * emotionResult.typography.reply에서 3단 답글을 안전하게 추출한다.
 * 필드 누락 시 기본값으로 보정한다.
 *
 * @param {Object} typography  emotionResult.typography
 * @returns {{ main: string, place: string, tagline: string, isFallback: boolean }}
 */
function extractReply(typography) {
  const r = typography?.reply;

  const main    = (typeof r?.main    === 'string' && r.main.trim())
    ? r.main.trim()
    : '울산이 당신에게 건넨 소중한 순간';

  const place   = (typeof r?.place   === 'string' && r.place.trim())
    ? r.place.trim()
    : '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 남기를 바랍니다.';

  const rawTag  = typeof r?.tagline === 'string' ? r.tagline.trim() : '';
  const tagline = rawTag
    ? (rawTag.startsWith('ULSAN') ? rawTag : `ULSAN — ${rawTag}`)
    : 'ULSAN — 당신의 울산';

  const isFallback = !r?.main?.trim();   // reply 블록이 비어 있었으면 폴백으로 간주

  return { main, place, tagline, isFallback };
}

// ─────────────────────────────────────────────────────────────────
// POST /api/impression
// ─────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const t0 = Date.now();
  const { text, language, tripDuration, companion } = req.body;

  // ── 1. 입력값 검증 ─────────────────────────────────────────────
  const validation = validateText(text);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }
  const cleanText = validation.cleaned;

  const tripLabel    = resolveTripDurationLabel(tripDuration);
  const companionKey = resolveCompanionKey(companion);

  // ── 2. [방안B] visitContext 선행 수집 ──────────────────────────
  // collectVisitContext()는 순수 동기 함수 (현재 시각만 읽음).
  // emotion-engine 호출 전에 미리 실행하여:
  //   a) Gemini 프롬프트에 절기·계절·시간대를 포함 → reply 품질 향상
  //   b) 코드 흐름 명확화 (컨텍스트 수집 → 분석 → 응답)
  const visitCtx = collectVisitContext();

  // 사용자가 선택한 동행 정보를 visitCtx에 주입 (옵션)
  // ai-extractor의 buildUserPrompt가 이 값을 프롬프트에 포함한다.
  if (companionKey) {
    visitCtx.companionOverride = companionKey;
  }

  // 여행일정 정보는 소감 원문에 자연어로 결합
  // (Gemini가 reply 작성 맥락으로 인식하도록)
  const replySourceText = tripLabel
    ? `[${tripLabel}] ${cleanText}`
    : cleanText;

  // ── 3. [방안B] emotion-engine — 단일 Gemini 호출 ───────────────
  // analyzeImpression이 visitCtx를 받아 extractEmotions에 전달.
  // 반환값의 typography.reply에 E-Card 3단 답글이 포함된다.
  let emotionResult;
  try {
    emotionResult = await analyzeImpression(replySourceText, {
      language,
      visitCtx,   // [방안B] 핵심: 방문 시점 컨텍스트 전달
    });
  } catch (err) {
    console.error('[impression] emotion-engine 오류:', err.message);
    return res.status(500).json({ error: `감성 분석 실패: ${err.message}` });
  }

  const {
    emotionScores,
    globalParams,
    typography,
    isFallback: emotionIsFallback,
    meta,
  } = emotionResult;

  const diversitySeed = meta?.diversitySeed ?? 0;
  const spotIndex     = typography?.spotIndex ?? 0;

  // ── 4. [방안B] reply 추출 — 두 번째 Gemini 호출 없음 ─────────
  // emotion-engine이 단일 호출에서 reply까지 생성했으므로
  // reply-engine의 classify / generateReply 호출이 불필요하다.
  const { main, place, tagline, isFallback: replyIsFallback } = extractReply(typography);

  // ── 5. SVG 색채 글로벌 파라미터 계산 ────────────────────────────
  const gp = computeGlobalParams(emotionScores);
  const colorTempFilterStr = colorTempToFilter(gp.colorTemp);

  // ── 6. 통합 응답 ───────────────────────────────────────────────
  const processingTimeMs = Date.now() - t0;
  console.log(
    `[impression] 완료 ${processingTimeMs}ms |`,
    `경승지: ${typography?.spotName} |`,
    `감성: ${typography?.primaryEmotion} |`,
    `여행: ${tripLabel ?? '-'} | 동행: ${companionKey ?? '-'} |`,
    emotionIsFallback ? '⚠️ 감성폴백' : '✅',
    replyIsFallback   ? '⚠️ 답글폴백' : '✅',
    '| Gemini 1회 호출',   // [방안B] 로그에 명시
  );

  res.json({
    // 경승지 정보
    spotIndex,
    spotName:        typography?.spotName       ?? '',

    // 감성 데이터
    emotionScores,
    primaryEmotion:  typography?.primaryEmotion ?? '',
    keywords:        typography?.keywords       ?? [],

    // SVG 색채 데이터
    colorTempFilter: colorTempFilterStr,
    diversitySeed,

    // E-Card 3단 답글 (기존 응답 구조 유지 — 하위 호환)
    reply: { main, place, tagline },

    // 메타 정보
    meta: {
      processingTimeMs,
      isFallback:       emotionIsFallback,
      replyIsFallback,
      tripDuration:     tripDuration ?? null,
      companion:        companion    ?? null,
    },
  });

  // ── 7. Supabase 저장 (응답 후 비동기 — 사용자 대기 없음) ──────────
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
