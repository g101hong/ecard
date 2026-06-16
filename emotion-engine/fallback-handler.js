/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — 오류 대응 & 폴백 처리 모듈
 * @module emotion-engine/fallback-handler
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 파이프라인 안전망 (Pipeline Safety Net)
 * ─────────────────────────────────────────────────────────────────
 *
 * 설계 원칙:
 *   "어떤 오류가 발생해도 방문객에게는 반드시 카드를 전달한다."
 *
 *   AI API 실패, 네트워크 오류, 입력 품질 불량, 파싱 오류 등
 *   모든 예외 상황에서 품질이 다소 낮더라도 유효한 결과를 반환한다.
 *   절대 빈 화면이나 에러 페이지를 보여주지 않는다.
 *
 * ─────────────────────────────────────────────────────────────────
 * [폴백 품질 계층 (Fallback Quality Tiers)]
 *
 *   TIER 0 : 정상 처리     — AI 분석 완전 성공
 *   TIER 1 : 부분 복구     — AI 응답 일부 손실, 나머지로 재구성
 *   TIER 2 : 템플릿 폴백   — AI 실패, 시드+템플릿으로 생성
 *   TIER 3 : 순수 시드     — 모든 AI 실패, 시드만으로 생성
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할:
 *   - 파이프라인 각 단계의 오류를 분류하고 처리
 *   - 오류 유형에 맞는 폴백 전략 선택·실행
 *   - 항상 유효한 결과 구조 반환
 *   - 비동기 래퍼 함수로 파이프라인 보호
 *   - 다국어 사용자 메시지 생성
 */
 
'use strict';
 
import { SPOT_BASE_PALETTES as PANEL_CONFIGS } from './panel-individualizer.js';
 
// =============================================================================
// ① 오류 유형 분류 (Error Type Classification)
// =============================================================================
 
/** 파이프라인에서 발생할 수 있는 오류 유형 */
export const ERROR_TYPES = Object.freeze({
  // ── 네트워크 & API ───────────────────────────────────────────────
  NETWORK_TIMEOUT:        'NETWORK_TIMEOUT',        // 응답 시간 초과
  NETWORK_OFFLINE:        'NETWORK_OFFLINE',        // 인터넷 연결 없음
  API_RATE_LIMIT:         'API_RATE_LIMIT',         // 429 Too Many Requests
  API_SERVER_ERROR:       'API_SERVER_ERROR',       // 5xx 서버 오류
  API_AUTH_ERROR:         'API_AUTH_ERROR',         // 401/403 인증 실패
  API_BAD_REQUEST:        'API_BAD_REQUEST',        // 400 잘못된 요청
 
  // ── 응답 파싱 ────────────────────────────────────────────────────
  JSON_PARSE_ERROR:       'JSON_PARSE_ERROR',       // JSON 파싱 실패
  SCHEMA_MISSING_FIELDS:  'SCHEMA_MISSING_FIELDS',  // 필수 필드 누락
  SCHEMA_INVALID_VALUES:  'SCHEMA_INVALID_VALUES',  // 값 범위 오류
 
  // ── 입력 품질 ────────────────────────────────────────────────────
  INPUT_TOO_SHORT:        'INPUT_TOO_SHORT',         // 최소 길이 미달
  INPUT_NONSENSE:         'INPUT_NONSENSE',          // 무의미한 입력
  INPUT_EMPTY:            'INPUT_EMPTY',             // 빈 입력
 
  // ── 처리 단계 오류 ───────────────────────────────────────────────
  SYNTHESIZER_ERROR:      'SYNTHESIZER_ERROR',      // param-synthesizer 실패
  INDIVIDUALIZER_ERROR:   'INDIVIDUALIZER_ERROR',   // panel-individualizer 실패
  GUARD_ERROR:            'GUARD_ERROR',            // diversity-guard 실패
 
  // ── 기타 ────────────────────────────────────────────────────────
  UNKNOWN:                'UNKNOWN',                // 분류 불가
});
 
/** 폴백 품질 계층 */
export const FALLBACK_TIER = Object.freeze({
  NORMAL:         0,   // 정상 처리 (폴백 아님)
  PARTIAL:        1,   // 부분 복구
  TEMPLATE:       2,   // 템플릿 기반
  SEED_ONLY:      3,   // 시드만 사용
});
 
// =============================================================================
// ② 오류 분류기 (Error Classifier)
// =============================================================================
 
/**
 * Error 객체를 분석하여 파이프라인 오류 유형을 반환한다.
 *
 * @param {Error|unknown} err
 * @returns {string} ERROR_TYPES 중 하나
 */
export function classifyError(err) {
  if (!err) return ERROR_TYPES.UNKNOWN;
 
  const msg = (err.message || String(err)).toLowerCase();
  const status = err.status || err.statusCode || 0;
 
  // HTTP 상태 코드 기반 분류
  if (status === 429) return ERROR_TYPES.API_RATE_LIMIT;
  if (status === 401 || status === 403) return ERROR_TYPES.API_AUTH_ERROR;
  if (status === 400) return ERROR_TYPES.API_BAD_REQUEST;
  if (status >= 500 && status < 600) return ERROR_TYPES.API_SERVER_ERROR;
 
  // 메시지 패턴 기반 분류
  if (msg.includes('timeout') || msg.includes('timed out'))
    return ERROR_TYPES.NETWORK_TIMEOUT;
  if (msg.includes('network') || msg.includes('offline') || msg.includes('fetch'))
    return ERROR_TYPES.NETWORK_OFFLINE;
  if (msg.includes('json') || msg.includes('parse') || msg.includes('syntax'))
    return ERROR_TYPES.JSON_PARSE_ERROR;
  if (msg.includes('missing') || msg.includes('undefined') || msg.includes('required'))
    return ERROR_TYPES.SCHEMA_MISSING_FIELDS;
  if (msg.includes('rate limit') || msg.includes('quota'))
    return ERROR_TYPES.API_RATE_LIMIT;
 
  return ERROR_TYPES.UNKNOWN;
}
 
// =============================================================================
// ③ 다국어 사용자 메시지 (Multilingual User Messages)
// =============================================================================
 
/**
 * 오류 유형과 폴백 계층에 따른 사용자 친화적 메시지.
 * 방문객에게 직접 표시되므로 부드럽고 긍정적인 톤 유지.
 */
const USER_MESSAGES = {
  // ── 입력 품질 메시지 ─────────────────────────────────────────────
  INPUT_TOO_SHORT: {
    ko: '소감을 조금 더 자세히 남겨주세요. 더 특별한 색채로 카드를 만들 수 있어요 😊',
    en: 'Please share a bit more about your experience for a more personalized card 😊',
    ja: 'もう少し詳しく感想をお書きいただくと、より素敵なカードができます 😊',
    zh: '请再多写一些感想，让我们为您创作更独特的卡片 😊',
  },
  INPUT_NONSENSE: {
    ko: '울산에서의 소중한 순간을 문장으로 남겨주세요 :)',
    en: 'Please describe your Ulsan experience in a few words :)',
    ja: 'ご感想を文章でお聞かせください :)',
    zh: '请用几句话描述您在蔚山的体验 :)',
  },
 
  // ── API/네트워크 오류 메시지 ─────────────────────────────────────
  // (방문객에게는 기술 용어를 노출하지 않음)
  NETWORK_TIMEOUT: {
    ko: '잠시 시간이 걸렸습니다. 소감을 담아 특별한 색채로 카드를 만들었어요 🌟',
    en: 'It took a moment, but your card is ready with a special color palette 🌟',
    ja: '少し時間がかかりましたが、素敵なカードができました 🌟',
    zh: '花了一点时间，但您的专属卡片已经完成了 🌟',
  },
  API_SERVER_ERROR: {
    ko: '서버가 잠시 바쁩니다. 울산의 기본 색감으로 카드를 만들었습니다 💙',
    en: 'Server is busy. Here\'s your card with Ulsan\'s signature colors 💙',
    ja: 'サーバーが少し混んでいます。蔚山の基本色でカードを作りました 💙',
    zh: '服务器暂时繁忙，为您使用蔚山特色色彩制作了卡片 💙',
  },
  API_RATE_LIMIT: {
    ko: '요청이 많아 잠시 기다렸습니다. 울산의 색채로 카드를 만들었어요 🎨',
    en: 'High demand right now. Your card is ready with Ulsan\'s beautiful colors 🎨',
    ja: 'リクエストが多く少し待ちました。蔚山の色でカードができました 🎨',
    zh: '请求较多，稍等片刻后已为您制作了卡片 🎨',
  },
  DEFAULT: {
    ko: '울산의 아름다운 색채로 당신만의 카드를 만들었습니다 ✨',
    en: 'Your personalized Ulsan E-Card is ready with beautiful colors ✨',
    ja: '蔚山の美しい色でオリジナルカードができました ✨',
    zh: '您的专属蔚山卡片已用美丽的色彩制作完成 ✨',
  },
};
 
/**
 * 오류 유형·언어·계층에 맞는 사용자 메시지를 반환한다.
 *
 * @param {string} errorType   ERROR_TYPES 값
 * @param {string} language    'ko'|'en'|'ja'|'zh'
 * @param {number} tier        FALLBACK_TIER 값
 * @returns {string}
 */
export function getUserMessage(errorType, language = 'ko', tier = FALLBACK_TIER.TEMPLATE) {
  const msgMap = USER_MESSAGES[errorType] ?? USER_MESSAGES.DEFAULT;
  return msgMap[language] ?? msgMap.ko;
}
 
// =============================================================================
// ④ 폴백 응답 텍스트 템플릿
// =============================================================================
 
/**
 * AI 생성 답글을 대신하는 사전 작성 템플릿.
 * 시드 값에 따라 다양한 버전 중 하나를 선택한다.
 */
const RESPONSE_TEMPLATES = {
  ko: [
    '울산을 찾아주셔서 진심으로 감사드립니다. 이 아름다운 순간의 기억이 오래도록 당신 곁에 머물기를 바랍니다. 언제든 다시 울산에서 뵙겠습니다.',
    '울산의 자연과 문화가 당신의 마음속에 깊이 새겨지길 바랍니다. 소중한 방문 감사드리며, 울산은 언제나 당신을 기다리고 있습니다.',
    '울산과 함께한 특별한 시간을 담아 이 카드를 드립니다. 다음에는 더 많은 울산의 아름다움을 발견하시길 기대합니다.',
    '당신의 방문이 울산을 더욱 빛나게 합니다. 아름다운 추억 간직하시고, 다음에 또 만나요!',
    '울산의 12경이 품은 아름다움처럼, 이 카드가 당신의 기억 속에 영원히 빛나기를 바랍니다.',
  ],
  en: [
    'Thank you so much for visiting Ulsan! We hope these beautiful memories stay with you for a long time. We look forward to welcoming you again.',
    'May the spirit of Ulsan\'s natural beauty remain in your heart. Thank you for your precious visit — Ulsan always awaits you.',
    'We hope this card captures a little of the magic you experienced in Ulsan. We can\'t wait to share more of Ulsan\'s beauty with you.',
    'Your visit makes Ulsan shine even brighter. Keep these beautiful memories close, and see you again soon!',
    'Like the beauty held within Ulsan\'s 12 landscapes, may this card shine in your memory forever.',
  ],
  ja: [
    '蔚山にお越しいただき、誠にありがとうございます。この美しい思い出がいつまでも心に残ることを願っています。またのお越しをお待ちしております。',
    '蔚山の自然と文化が心に深く刻まれますように。大切なご来訪をありがとうございます。蔚山はいつでもお待ちしています。',
    '蔚山での特別なひとときを、このカードに込めてお届けします。次回はさらに多くの美しさを発見されることを楽しみにしています。',
    'あなたのご来訪が蔚山をより輝かせています。美しい思い出と共に、またお会いしましょう！',
    '蔚山12景が秘める美しさのように、このカードがあなたの記憶の中でいつまでも輝きますように。',
  ],
  zh: [
    '非常感谢您来访蔚山！希望这些美好的回忆能长久地陪伴您。期待再次与您相聚。',
    '愿蔚山的自然之美永远留在您心中。感谢您的宝贵到来，蔚山随时欢迎您的归来。',
    '我们将这张卡片作为您在蔚山特别时光的纪念。期待您下次来发现更多蔚山之美。',
    '您的到来让蔚山更加闪耀。请珍藏这段美好回忆，我们期待再次相见！',
    '就像蔚山十二景所蕴藏的美丽一样，愿这张卡片永远在您的记忆中闪光。',
  ],
};
 
/**
 * 시드와 언어에 맞는 폴백 응답 텍스트를 반환한다.
 *
 * @param {number} diversitySeed
 * @param {string} language
 * @returns {string}
 */
function getTemplateResponse(diversitySeed, language = 'ko') {
  const templates = RESPONSE_TEMPLATES[language] ?? RESPONSE_TEMPLATES.ko;
  const idx = diversitySeed % templates.length;
  return templates[idx];
}
 
// =============================================================================
// ⑤ 시드 기반 감성 점수 생성
// =============================================================================
 
/**
 * 다양성 시드만으로 결정론적 감성 점수 세트를 생성한다.
 * AI 분석이 완전 실패했을 때 사용.
 *
 * 생성 방식:
 *   - 시드의 각 비트를 다른 감성 차원에 매핑
 *   - 기저값(35) + 시드 기반 변동(0~40)
 *   - 항상 합리적인 범위 내 값 생성
 *
 * @param {number} diversitySeed
 * @returns {Object} 8차원 감성 점수
 */
function generateSeedEmotions(diversitySeed) {
  const EMOTION_KEYS = [
    'amazement', 'peace', 'vitality', 'nostalgia',
    'freshness', 'grandeur', 'warmth', 'mystery',
  ];
 
  const scores = {};
  EMOTION_KEYS.forEach((key, i) => {
    // 시드의 다른 비트 조각을 각 감성에 사용
    const chunk = ((diversitySeed >> (i * 4)) & 0x0F); // 0~15
    scores[key] = 30 + chunk * 2.5; // 30~67.5 범위
  });
 
  // 가장 높은 감성을 약간 더 올려서 지배적 감성 부여
  const dominant = EMOTION_KEYS[diversitySeed % EMOTION_KEYS.length];
  scores[dominant] = Math.min(100, scores[dominant] + 25);
 
  return scores;
}
 
/**
 * 시드 기반 감성 점수에서 지배 감성(dominant emotion)을 추출한다.
 * @param {Object} scores
 * @returns {string} 감성 키
 */
function getDominantEmotion(scores) {
  return Object.entries(scores).sort(([, a], [, b]) => b - a)[0][0];
}
 
// =============================================================================
// ⑥ 시드 기반 패널 색채 생성
// =============================================================================
 
/**
 * AI 없이 시드만으로 12개 패널의 최종 색채값을 생성한다.
 * 각 패널의 기본 색상(baseHex)에 시드 기반 미세 변동을 적용.
 *
 * @param {number} diversitySeed
 * @param {number} [matchedSpotIndex=-1]  강조할 경승지 인덱스
 * @returns {Object[]} PanelColorParams 형식의 배열
 */
function generateSeedPanels(diversitySeed, matchedSpotIndex = -1) {
  return PANEL_CONFIGS.map((config, i) => {
    // 기본 색상 파싱
    const hex = config.baseHex;
    const r   = parseInt(hex.slice(1, 3), 16) / 255;
    const g   = parseInt(hex.slice(3, 5), 16) / 255;
    const b   = parseInt(hex.slice(5, 7), 16) / 255;
 
    // RGB → HSL 변환
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l  = (mx + mn) / 2;
    const d  = mx - mn;
    const s  = d === 0 ? 0 : l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = 0;
    if (d !== 0) {
      h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
        : mx === g ? ((b - r) / d + 2) / 6
        :             ((r - g) / d + 4) / 6;
      h *= 360;
    }
 
    // 시드 기반 미세 변동
    const slot      = i * 10;
    const dHue      = (((diversitySeed ^ (slot + 1) * 2654435761) >>> 0) % 1000 / 1000 - 0.5) * 12;
    const dSat      = (((diversitySeed ^ (slot + 2) * 2654435761) >>> 0) % 1000 / 1000 - 0.5) * 0.12;
    const dLight    = (((diversitySeed ^ (slot + 3) * 2654435761) >>> 0) % 1000 / 1000 - 0.5) * 0.10;
 
    const finalH = ((h + dHue) % 360 + 360) % 360;
    const finalS = Math.min(1, Math.max(0.06, s + dSat));
    const finalL = Math.min(0.88, Math.max(0.18, l + dLight));
 
    // 매칭 경승지는 채도를 약간 높여 강조
    const satBoost  = config.index === matchedSpotIndex ? 0.08 : 0;
    const adjSat    = Math.min(0.98, finalS + satBoost);
 
    return {
      index:     config.index,
      name:      config.name,
      shortName: config.shortName,
      angle:     config.angle,
      hue:       finalH,
      saturation:adjSat,
      lightness: finalL,
      contrast:  1.0,
      colorTemp: 0,
      lightDir:  0,
      glassTransmission: 0.82,
      glassRoughness:    0.04,
      leadMetalness:     0.90,
      rgbTint: { r: 1.0, g: 1.0, b: 1.0 },
      cssHSL: `hsl(${finalH.toFixed(1)}, ${(adjSat*100).toFixed(1)}%, ${(finalL*100).toFixed(1)}%)`,
      _fallback: true,
    };
  });
}
 
// =============================================================================
// ⑦ 부분 복구 (Partial Recovery)
// =============================================================================
 
/**
 * AI 응답에서 부분적으로 유효한 데이터를 복구한다.
 * JSON 파싱 성공 but 일부 필드 누락인 경우에 사용.
 *
 * @param {Object}  partial         파싱된 AI 응답 (불완전)
 * @param {number}  diversitySeed
 * @param {string}  language
 * @returns {Object} 복구된 ExtractionResult 형식
 */
function recoverPartialResponse(partial, diversitySeed, language) {
  const EMOTION_KEYS = ['amazement','peace','vitality','nostalgia',
                        'freshness','grandeur','warmth','mystery'];
  const DEFAULT_SCORE = 40;
 
  // 감성 점수 복구
  const emotionScores = {};
  EMOTION_KEYS.forEach((k) => {
    const v = partial?.emotionScores?.[k] ?? partial?.[k];
    emotionScores[k] = typeof v === 'number' ? Math.min(100, Math.max(0, v)) : DEFAULT_SCORE;
  });
 
  // 나머지 필드 복구
  const spotIndex = typeof partial?.spotIndex === 'number'
    ? Math.min(11, Math.max(0, Math.round(partial.spotIndex))) : diversitySeed % 12;
 
  const responseType = ['A','B','C'].includes(partial?.responseType)
    ? partial.responseType : 'C';
 
  const primaryEmotion = typeof partial?.primaryEmotion === 'string' && partial.primaryEmotion.length > 0
    ? partial.primaryEmotion : '울산의 감동';
 
  const keywords = Array.isArray(partial?.keywords) && partial.keywords.length >= 3
    ? partial.keywords.slice(0, 5)
    : ['자연', '아름다움', '감동', '추억', '울산'];
 
  const responseText = typeof partial?.responseText === 'string' && partial.responseText.length > 10
    ? partial.responseText
    : getTemplateResponse(diversitySeed, language);
 
  const contextAnalysis = partial?.contextAnalysis ?? {
    timeContext:         { detected: null, confidence: 0, reasoning: '복구 불가' },
    seasonContext:       { detected: null, confidence: 0 },
    companionContext:    { detected: null, confidence: 0 },
    emojiInterpretation: null,
    keyEmotionalPhrases: [],
  };
 
  return {
    contextAnalysis,
    emotionScores,
    dominantEmotion: getDominantEmotion(emotionScores),
    spotIndex,
    spotMatchReason: '부분 복구',
    responseType,
    primaryEmotion,
    keywords,
    responseText,
    _tier: FALLBACK_TIER.PARTIAL,
  };
}
 
// =============================================================================
// ⑧ 폴백 ExtractionResult 생성
// =============================================================================
 
/**
 * 완전 폴백 ExtractionResult를 생성한다.
 * AI 호출이 완전히 실패했을 때 사용.
 *
 * @param {number} diversitySeed
 * @param {string} language
 * @param {number} tier  FALLBACK_TIER.TEMPLATE 또는 SEED_ONLY
 * @returns {Object} ExtractionResult 형식
 */
function buildFallbackExtraction(diversitySeed, language = 'ko', tier = FALLBACK_TIER.TEMPLATE) {
  const emotionScores = generateSeedEmotions(diversitySeed);
  const spotIndex     = diversitySeed % 12;
  const dominant      = getDominantEmotion(emotionScores);
 
  // 지배 감성에 따른 primaryEmotion 한글 매핑
  const EMOTION_KO = {
    amazement: '경이로움', peace: '깊은 평화', vitality: '활기찬 감동',
    nostalgia: '그리운 추억', freshness: '청량한 기쁨', grandeur: '웅장한 감동',
    warmth: '따뜻한 기억', mystery: '신비로운 여운',
  };
 
  // responseType 결정 (감성 점수 기반)
  const s = emotionScores;
  const responseType =
    s.amazement + s.vitality > 110 ? 'A' :
    s.peace + s.nostalgia + s.warmth > 150 ? 'B' : 'C';
 
  return {
    contextAnalysis: {
      timeContext:         { detected: null, confidence: 0, reasoning: '폴백' },
      seasonContext:       { detected: null, confidence: 0 },
      companionContext:    { detected: null, confidence: 0 },
      emojiInterpretation: null,
      keyEmotionalPhrases: [],
    },
    emotionScores,
    dominantEmotion:  dominant,
    spotIndex,
    spotMatchReason:  '시드 기반 자동 매칭',
    responseType,
    primaryEmotion:   EMOTION_KO[dominant] ?? '울산의 감동',
    keywords:         ['자연', '아름다움', '감동', '추억', '울산'],
    responseText:     getTemplateResponse(diversitySeed, language),
    _tier: tier,
  };
}
 
// =============================================================================
// ⑨ 메인 폴백 핸들러
// =============================================================================
 
/**
 * @typedef {Object} FallbackContext
 * @property {number}  diversitySeed  preprocessInput().diversitySeed
 * @property {string}  language       감지된 언어 코드
 * @property {number}  [spotIndex]    알려진 경승지 인덱스 (있으면 활용)
 * @property {Object}  [partial]      부분 복구 가능한 AI 응답 (있으면 활용)
 * @property {string}  [stage]        실패한 파이프라인 단계 이름
 */
 
/**
 * @typedef {Object} FallbackResult
 * @property {boolean}      success         false (폴백임을 표시)
 * @property {number}       tier            FALLBACK_TIER 값
 * @property {string}       errorType       ERROR_TYPES 값
 * @property {string}       userMessage     방문객에게 보여줄 메시지
 * @property {Object}       extraction      ExtractionResult 형식
 * @property {Object[]}     panels          PanelColorParams[] 형식
 * @property {Object}       meta            처리 메타데이터
 */
 
/**
 * 파이프라인 오류를 처리하고 항상 유효한 결과를 반환한다.
 *
 * @param {Error|unknown}   err      발생한 오류
 * @param {FallbackContext} context  폴백 생성에 필요한 컨텍스트
 * @returns {FallbackResult}
 *
 * @example
 * try {
 *   const result = await extractEmotions(pre);
 * } catch (err) {
 *   const fallback = handleFallback(err, {
 *     diversitySeed: pre.diversitySeed,
 *     language:      pre.language,
 *     stage:         'ai-extractor',
 *   });
 *   // fallback.extraction, fallback.panels 사용 가능
 * }
 */
export function handleFallback(err, context) {
  const t0 = Date.now();
 
  const {
    diversitySeed = 0,
    language      = 'ko',
    spotIndex     = -1,
    partial       = null,
    stage         = 'unknown',
  } = context;
 
  const errorType = classifyError(err);
 
  // ── 전략 결정 ────────────────────────────────────────────────────
  let tier, extraction, panels;
 
  if (partial && typeof partial === 'object' && Object.keys(partial).length > 2) {
    // 부분 복구 가능
    tier       = FALLBACK_TIER.PARTIAL;
    extraction = recoverPartialResponse(partial, diversitySeed, language);
  } else if (
    errorType === ERROR_TYPES.INPUT_TOO_SHORT ||
    errorType === ERROR_TYPES.INPUT_NONSENSE  ||
    errorType === ERROR_TYPES.INPUT_EMPTY
  ) {
    // 입력 품질 문제 → 시드 폴백
    tier       = FALLBACK_TIER.SEED_ONLY;
    extraction = buildFallbackExtraction(diversitySeed, language, FALLBACK_TIER.SEED_ONLY);
  } else {
    // API/처리 오류 → 템플릿 폴백
    tier       = FALLBACK_TIER.TEMPLATE;
    extraction = buildFallbackExtraction(diversitySeed, language, FALLBACK_TIER.TEMPLATE);
  }
 
  // 경승지 인덱스 보정
  const resolvedSpotIndex = spotIndex >= 0 && spotIndex <= 11
    ? spotIndex : extraction.spotIndex;
 
  extraction.spotIndex = resolvedSpotIndex;
 
  // 시드 기반 패널 생성
  panels = generateSeedPanels(diversitySeed, resolvedSpotIndex);
 
  return {
    success:     false,
    tier,
    errorType,
    userMessage: getUserMessage(errorType, language, tier),
    extraction,
    panels,
    meta: {
      failedStage:      stage,
      errorMessage:     err?.message ?? String(err ?? 'unknown'),
      diversitySeed,
      processingTimeMs: Date.now() - t0,
    },
  };
}
 
// =============================================================================
// ⑩ 비동기 파이프라인 래퍼 (Async Pipeline Wrapper)
// =============================================================================
 
/**
 * 비동기 함수를 폴백 안전망으로 감싼다.
 * 파이프라인의 각 단계를 보호하는 데 사용.
 *
 * @template T
 * @param {() => Promise<T>}  asyncFn   보호할 비동기 함수
 * @param {FallbackContext}   context   폴백 컨텍스트
 * @returns {Promise<T | FallbackResult>}
 *
 * @example
 * // claude-extractor 단계 보호
 * const result = await withFallback(
 *   () => extractEmotions(pre),
 *   { diversitySeed: pre.diversitySeed, language: pre.language, stage: 'extractor' }
 * );
 * if (result.success === false) {
 *   // 폴백 결과 사용
 * }
 */
export async function withFallback(asyncFn, context) {
  try {
    const result = await asyncFn();
    // 성공 결과에 success 플래그 추가
    return { ...result, success: true, tier: FALLBACK_TIER.NORMAL };
  } catch (err) {
    console.warn(`[fallback-handler] ${context.stage ?? 'unknown'} 실패:`, err?.message);
    return handleFallback(err, context);
  }
}
 
/**
 * 동기 함수를 폴백 안전망으로 감싼다.
 *
 * @template T
 * @param {() => T}         fn       보호할 동기 함수
 * @param {FallbackContext} context
 * @returns {T | FallbackResult}
 */
export function withFallbackSync(fn, context) {
  try {
    return fn();
  } catch (err) {
    console.warn(`[fallback-handler] ${context.stage ?? 'unknown'} 동기 실패:`, err?.message);
    return handleFallback(err, context);
  }
}
 
// =============================================================================
// ⑪ 결과 유효성 검사 유틸리티
// =============================================================================
 
/**
 * 결과가 폴백인지 확인한다.
 * @param {Object} result
 * @returns {boolean}
 */
export function isFallback(result) {
  return result?.success === false || result?.tier > FALLBACK_TIER.NORMAL;
}
 
/**
 * 결과의 폴백 계층 이름을 반환한다.
 * @param {number} tier
 * @returns {string}
 */
export function tierName(tier) {
  return ['NORMAL', 'PARTIAL', 'TEMPLATE', 'SEED_ONLY'][tier] ?? 'UNKNOWN';
}
 
// =============================================================================
// ⑫ 디버그 유틸리티
// =============================================================================
 
/**
 * 폴백 처리 결과를 콘솔에 출력한다. (개발 전용)
 * @param {FallbackResult} result
 */
export function debugPrintFallback(result) {
  /* eslint-disable no-console */
  const tierLabels = ['✅ NORMAL','⚠️  PARTIAL','🟡 TEMPLATE','🔴 SEED_ONLY'];
 
  console.group('🆘 FallbackHandler — 처리 결과');
  console.log('폴백 계층:', tierLabels[result.tier] ?? result.tier);
  console.log('오류 유형:', result.errorType);
  console.log('실패 단계:', result.meta?.failedStage ?? '-');
  console.log('오류 메시지:', result.meta?.errorMessage ?? '-');
  console.log('사용자 메시지:', result.userMessage);
 
  console.group('복구된 ExtractionResult');
  const e = result.extraction;
  console.log('매칭 경승지:', `[${e.spotIndex}] ${
    PANEL_CONFIGS[e.spotIndex]?.name ?? '?'
  }`);
  console.log('지배 감성:', e.dominantEmotion);
  console.log('타이포그래피:', e.responseType, '|', e.primaryEmotion);
  console.log('답글:', e.responseText?.slice(0, 60) + '...');
  console.groupEnd();
 
  console.group('시드 기반 패널 색상 (12경)');
  result.panels.forEach((p) => {
    console.log(`  [${p.index}] ${p.name.padEnd(14)} ${p.cssHSL}`);
  });
  console.groupEnd();
 
  console.log('처리 시간:', result.meta?.processingTimeMs + 'ms');
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  handleFallback,
  withFallback,
  withFallbackSync,
  classifyError,
  getUserMessage,
  isFallback,
  tierName,
  debugPrintFallback,
  ERROR_TYPES,
  FALLBACK_TIER,
};
