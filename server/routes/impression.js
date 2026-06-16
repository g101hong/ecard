/**
 * @fileoverview server/routes/impression.js
 * @description  POST /api/impression
 *               소감 텍스트 → 감성 분석 + 답글 생성 + SVG 패널 색상 반환
 *
 * ─────────────────────────────────────────────────────────────────
 * 처리 흐름
 * ─────────────────────────────────────────────────────────────────
 *
 *   POST /api/impression  { text, language? }
 *       │
 *       ├─ 1. 입력값 검증 (최소 8자, XSS 기본 처리)
 *       │
 *       ├─ 2. emotion-engine.analyzeImpression(text)   ← Gemini API ①
 *       │       → emotionScores, globalParams, allPanels[12], typography
 *       │
 *       ├─ 3. reply-engine 파이프라인                   ← Gemini API ②
 *       │       collectVisitContext()
 *       │       classify(extraction, visitCtx, text, seed)
 *       │       generateReply(classified, text)
 *       │       → reply { main, place, tagline }
 *       │
 *       ├─ 4. svg-engine.computeGlobalParams() + colorTempToFilter()
 *       │       → colorTempFilter (CSS filter 문자열)
 *       │       (v2: 패널별 색상 계산은 클라이언트가 직접 수행 —
 *       │        svg-renderer.applyDeltaColorsToSVG(emotionScores, diversitySeed))
 *       │
 *       └─ 5. 통합 응답 반환
 *
 * ─────────────────────────────────────────────────────────────────
 * 응답 JSON
 * ─────────────────────────────────────────────────────────────────
 *
 *   {
 *     spotIndex,          경승지 인덱스 (0~11)
 *     spotName,           경승지 이름
 *     emotionScores,      8차원 감성 점수
 *     primaryEmotion,     핵심 감성 한글
 *     keywords,           감성 키워드 5개
 *     colorTempFilter,    CSS filter 문자열
 *     diversitySeed,      다양성 시드 (SVG 색채 계산 + POST /api/card 에 전달)
 *     reply {             E-Card 3단 답글
 *       main,
 *       place,
 *       tagline
 *     },
 *     meta {
 *       processingTimeMs,
 *       isFallback,
 *       replyIsFallback,
 *     }
 *   }
 *
 * ─────────────────────────────────────────────────────────────────
 * 처리시간: 약 5~15초 (Gemini API 2회 호출)
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

import { Router }             from 'express';
import { analyzeImpression }  from '../../emotion-engine/index.js';
import { collectVisitContext } from '../../reply-engine/visit-context.js';
import { classify }           from '../../reply-engine/context-classifier.js';
import { generateReply }      from '../../reply-engine/reply-generator.js';
import { computeGlobalParams, colorTempToFilter } from '../../svg-engine/color-calculator.js';
import { saveToSupabase }     from '../services/supabase-logger.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────
// 입력값 검증
// ─────────────────────────────────────────────────────────────────

/**
 * 소감 텍스트 기본 검증
 * @param {any} text
 * @returns {{ valid:boolean, cleaned?:string, error?:string }}
 */
function validateText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, error: '소감 텍스트가 없습니다.' };
  }

  // XSS 기본 처리 — HTML 태그 제거
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

/** 클라이언트 tripDuration 값 → 답글 프롬프트에 덧붙일 한국어 문구 */
const TRIP_DURATION_LABELS = {
  day:    '당일치기 여행',
  '1n2d': '1박 2일 여행',
  '2n3d': '2박 3일 여행',
  '3n4d': '3박 4일 여행',
  '4n+':  '4박 이상의 긴 여행',
};

/** 클라이언트 companion 값 → emotion-engine/reply-engine companion 키 */
const COMPANION_MAP = {
  solo:    'solo',
  family:  'family',
  friends: 'friends',
  couple:  'couple',
  // '기타'는 reply-engine이 인식하는 4종(solo/couple/family/friends)에
  // 없으므로 가장 무난한 friends로 매핑한다.
  other:   'friends',
};

/**
 * tripDuration 값이 유효한지 확인하고 답글 프롬프트용 한국어 라벨을 반환한다.
 * @param {any} value
 * @returns {string|null}
 */
function resolveTripDurationLabel(value) {
  return TRIP_DURATION_LABELS[value] ?? null;
}

/**
 * companion 값이 유효한지 확인하고 reply-engine companion 키로 변환한다.
 * @param {any} value
 * @returns {string|null}
 */
function resolveCompanionKey(value) {
  return COMPANION_MAP[value] ?? null;
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

  // ── 2. emotion-engine 감성 분석 ────────────────────────────────
  let emotionResult;
  try {
    emotionResult = await analyzeImpression(cleanText, { language });
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

  // ── 3. reply-engine 답글 생성 ──────────────────────────────────
  let replyResult;
  try {
    // 방문 시점 컨텍스트 수집 (현재 시각 기준 — 절기·계절·시간대)
    const visitCtx = collectVisitContext();

    // 사용자가 선택한 동행 정보를 emotion-engine 분석 결과의
    // contextAnalysis.companionContext에 confidence 1.0으로 덮어쓴다.
    // → classify() 내부 mergeWithExtractionContext()가
    //   AI 추론값(confidence < 0.6)보다 사용자 선택값을 우선 사용하게 됨.
    // 색채 파라미터(emotionScores/globalParams)는 변경하지 않으므로
    // 이미지 색감에는 영향이 없고 답글 맥락에만 반영된다.
    const extractionForReply = {
      ...emotionResult,
      contextAnalysis: {
        ...(emotionResult.context ?? {}),
        timeContext:      { detected: emotionResult.context?.timeContext ?? null,
                             confidence: emotionResult.context?.timeConfidence ?? 0 },
        seasonContext:    { detected: emotionResult.context?.seasonContext ?? null, confidence: 0 },
        companionContext: companionKey
          ? { detected: companionKey, confidence: 1.0 }
          : { detected: emotionResult.context?.companionContext ?? null, confidence: 0 },
        emojiInterpretation: emotionResult.context?.emojiInterpretation ?? null,
        keyEmotionalPhrases: emotionResult.context?.keyEmotionalPhrases ?? [],
      },
      emotionScores:   emotionResult.emotionScores,
      dominantEmotion: typography?.dominantEmotion,
      spotIndex:       typography?.spotIndex,
      primaryEmotion:  typography?.primaryEmotion,
      keywords:        typography?.keywords,
    };

    // 소감 분류 (경승지명 / 자연키워드 / 감성+계절 / 시간대)
    const classified = classify(
      extractionForReply,
      visitCtx,
      cleanText,
      diversitySeed,
    );

    // 여행일정 정보는 reply-engine에 별도 필드가 없으므로,
    // 답글 생성용 원문(originalText)에 자연어로 결합하여
    // Gemini가 맥락으로 인식하도록 한다 (정상 API 경로에서만 의미 있음;
    // 폴백 템플릿은 이 텍스트를 사용하지 않으므로 영향 없음).
    const replyOriginalText = tripLabel
      ? `[${tripLabel}] ${cleanText}`
      : cleanText;

    replyResult = await generateReply(classified, replyOriginalText);

  } catch (err) {
    console.warn('[impression] reply-engine 오류 (폴백 사용):', err.message);
    // 답글 생성 실패 시 기본값으로 계속 진행 (전체 실패 아님)
    replyResult = {
      success:    false,
      isFallback: true,
      reply: {
        main:    '울산이 당신에게 건넨 소중한 순간',
        place:   '울산의 아름다운 풍경이 오래도록 당신의 기억 속에 남기를 바랍니다.',
        tagline: 'ULSAN — 당신의 울산',
      },
    };
  }

  // ── 4. SVG 색채 글로벌 파라미터 계산 ────────────────────────────
  // v2: 패널별 색상은 클라이언트가 SVG 'spot-XX-N' 요소의 현재 색을
  // 읽어 color-engine.js(applyDeltaToHex)로 직접 계산하므로,
  // 서버는 컨테이너 전체에 적용할 colorTempFilter만 계산해 전달한다.
  const gp = computeGlobalParams(emotionScores);
  const colorTempFilterStr = colorTempToFilter(gp.colorTemp);

  // ── 5. 통합 응답 ───────────────────────────────────────────────
  const processingTimeMs = Date.now() - t0;
  console.log(
    `[impression] 완료 ${processingTimeMs}ms |`,
    `경승지: ${typography?.spotName} |`,
    `감성: ${typography?.primaryEmotion} |`,
    `여행: ${tripLabel ?? '-'} | 동행: ${companionKey ?? '-'} |`,
    emotionIsFallback ? '⚠️ 감성폴백' : '✅',
    replyResult.isFallback ? '⚠️ 답글폴백' : '✅',
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
    // v2: panelColors 없음 — 클라이언트(svg-renderer.applyDeltaColorsToSVG)가
    // emotionScores + diversitySeed로 SVG 'spot-XX-N' 요소의 현재 색에서
    // 직접 계산·적용한다.
    colorTempFilter: colorTempFilterStr,
    diversitySeed,

    // E-Card 3단 답글
    reply: replyResult.reply,

    // 메타 정보
    meta: {
      processingTimeMs,
      isFallback:       emotionIsFallback,
      replyIsFallback:  replyResult.isFallback,
      tripDuration:     tripDuration ?? null,
      companion:        companion    ?? null,
    },
  });

  // ── 6. Supabase 저장 (응답 후 비동기 — 사용자 대기 없음) ──────────
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
