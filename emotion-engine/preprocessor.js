/**
 * @fileoverview 울산 E-Card 감성 분석 엔진 — 입력 전처리 모듈 (v2.0)
 * @module emotion-engine/preprocessor
 *
 * ─────────────────────────────────────────────────────────────────
 * PIPELINE STAGE 1 : Raw Input → Slim Preprocessed Context
 * ─────────────────────────────────────────────────────────────────
 *
 * [v2.0 변경 사항]
 *   이 모듈은 "기계적 전처리"에만 집중합니다.
 *   의미론적 분석(맥락·감성·이모지 해석)은 전부 AI에 위임합니다.
 *
 *   ✅ 유지 (기계적, 오프라인, 즉시):
 *       - 텍스트 정규화 (HTML 제거, 공백 정리, truncate)
 *       - 언어 감지   (Unicode 분포 기반 휴리스틱)
 *       - 길이 분류   (단순 문자 수 카운트)
 *       - 품질 평가   (너무 짧거나 무의미한 입력 차단)
 *       - 이모지 추출 (문자 목록만 — 해석은 AI가)
 *       - 다양성 시드 (결정론적 해시)
 *
 *   ❌ 제거 → ai-extractor.js AI 프롬프트로 이전:
 *       - 시간/계절/동행자 맥락 키워드 사전
 *       - 이모지 감성 분류
 *       - 감성 부스터 사전
 *       - 강도 수식어 배수 처리
 *       - 부정 패턴 감지
 *
 * [설계 철학]
 *   코드로 처리하기에 경우의 수가 너무 많은 의미론적 판단은
 *   모두 AI에 위임합니다.
 *   preprocessor는 AI가 믿을 수 있는 "팩트 기반 메타데이터"만 생성합니다.
 */
 
'use strict';
 
// =============================================================================
// ① 설정 상수
// =============================================================================
 
export const CONFIG = {
  MAX_INPUT_LENGTH:  500,   // 최대 허용 문자 수
  MIN_VIABLE_LENGTH: 8,     // 의미 있는 최소 문자 수
  MIN_QUALITY_SCORE: 30,    // 품질 점수 하한 (0~100)
  REPEAT_CHAR_LIMIT: 3,     // 연속 반복 허용 최대 수 (ㅋㅋㅋ→ㅋㅋㅋ)
  LANG_SAMPLE_SIZE:  200,   // 언어 감지 샘플 문자 수
};
 
// =============================================================================
// ② 유니코드 범위 (언어 감지용)
// =============================================================================
 
const UNICODE_RANGES = {
  HANGUL_SYLLABLES: [0xAC00, 0xD7A3],  // 가~힣
  HANGUL_JAMO:      [0x1100, 0x11FF],  // 자모 (ㄱ~ㅎ, ㅏ~ㅣ)
  HANGUL_COMPAT:    [0x3130, 0x318F],  // 호환 자모
  HIRAGANA:         [0x3040, 0x309F],  // 히라가나
  KATAKANA:         [0x30A0, 0x30FF],  // 가타카나
  CJK_UNIFIED:      [0x4E00, 0x9FFF],  // CJK 통합 한자
  CJK_EXT_A:        [0x3400, 0x4DBF],
  LATIN:            [0x0041, 0x007A],  // A-Z, a-z
};
 
/** 코드 포인트가 범위 내에 있는지 확인 */
const inRange = (code, [min, max]) => code >= min && code <= max;
 
// =============================================================================
// ③ 이모지 추출 (문자 목록만 — 해석은 AI가 담당)
// =============================================================================
 
/** Unicode 이모지 감지 정규식 */
const EMOJI_REGEX = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
 
/**
 * 텍스트에서 이모지 문자 목록을 추출한다.
 * 이 단계에서는 이모지의 의미를 해석하지 않는다.
 * 해석은 ai-extractor.js AI 프롬프트가 담당한다.
 *
 * @param {string} text
 * @returns {string[]} 이모지 문자 배열
 */
export function extractEmojis(text) {
  if (!text) return [];
  return [...(text.match(EMOJI_REGEX) || [])];
}
 
// =============================================================================
// ④ 다양성 시드 생성 (결정론적 해시)
// =============================================================================
 
/**
 * cyrb53 해시 알고리즘
 * 동일 입력 → 항상 같은 시드, 미세 노이즈 주입에 사용
 * @param {string} str
 * @param {number} [seed=0]
 * @returns {number}
 */
export function cyrb53Hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x9e3779b1);
    h2 = Math.imul(h2 ^ ch, 0x5f4a417d);
  }
  h1 ^= Math.imul(h1 ^ (h2 >>> 15), 0x735a2d97);
  h2 ^= Math.imul(h2 ^ (h1 >>> 15), 0xcaf649a9);
  h1 ^= h2 >>> 16;
  h2 ^= h1 >>> 16;
  return 2097152 * (h2 >>> 0) + (h1 >>> 11);
}
 
// =============================================================================
// ⑤ 언어 감지 (Unicode 분포 기반 — 오프라인, 빠름)
// =============================================================================
 
/**
 * 입력 텍스트의 주 언어를 감지한다.
 *
 * 판정 방식: 문자 유형별 카운트 비율 비교
 * 우선순위: 한국어 > 일본어(히라가나·가타카나) > 중국어(CJK) > 영어
 *
 * @param {string} text
 * @returns {'ko' | 'ja' | 'zh' | 'en'} 언어 코드
 */
export function detectLanguage(text) {
  if (!text?.trim()) return 'ko';
 
  const sample = text.slice(0, CONFIG.LANG_SAMPLE_SIZE);
  const counts = { ko: 0, hiragana: 0, katakana: 0, cjk: 0, latin: 0 };
 
  for (const char of sample) {
    const cp = char.codePointAt(0);
    if (
      inRange(cp, UNICODE_RANGES.HANGUL_SYLLABLES) ||
      inRange(cp, UNICODE_RANGES.HANGUL_JAMO) ||
      inRange(cp, UNICODE_RANGES.HANGUL_COMPAT)
    ) counts.ko++;
    else if (inRange(cp, UNICODE_RANGES.HIRAGANA))   counts.hiragana++;
    else if (inRange(cp, UNICODE_RANGES.KATAKANA))   counts.katakana++;
    else if (
      inRange(cp, UNICODE_RANGES.CJK_UNIFIED) ||
      inRange(cp, UNICODE_RANGES.CJK_EXT_A)
    ) counts.cjk++;
    else if (inRange(cp, UNICODE_RANGES.LATIN))      counts.latin++;
  }
 
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return 'en';
 
  const r = (key) => counts[key] / total;
 
  if (r('ko') > 0.20)                                   return 'ko';
  if (r('hiragana') + r('katakana') > 0.08)             return 'ja';
  if (r('cjk') > 0.15 && r('hiragana') < 0.05)         return 'zh';
  if (r('latin') > 0.35)                                return 'en';
 
  // 최다 카운트 언어 반환
  const top = Object.entries(counts).sort(([,a],[,b]) => b - a)[0][0];
  return top === 'hiragana' || top === 'katakana' ? 'ja'
       : top === 'cjk'  ? 'zh'
       : top === 'latin' ? 'en'
       : 'ko';
}
 
// =============================================================================
// ⑥ 텍스트 정규화
// =============================================================================
 
/**
 * 텍스트를 AI 분석에 적합하게 정규화한다.
 *
 * 수행 작업:
 *   - HTML/XML 태그 제거
 *   - 전각 문자 → 반각 변환 (일본어 입력 패드 대응)
 *   - 연속 공백 → 단일 공백
 *   - 반복 문자 축약 (ㅋㅋㅋㅋㅋ → ㅋㅋㅋ)
 *   - 앞뒤 공백 제거
 *   - 최대 길이 초과 시 단어 경계 truncate
 *
 * @param {string} rawText
 * @returns {{ cleanText: string, truncated: boolean, originalLength: number }}
 */
export function normalizeText(rawText) {
  if (typeof rawText !== 'string') rawText = String(rawText ?? '');
 
  const originalLength = rawText.length;
  let t = rawText;
 
  // 1. HTML 태그 제거
  t = t.replace(/<[^>]*>/g, ' ');
 
  // 2. 전각 → 반각 (FF01-FF5E → 21-7E)
  t = t.replace(/[\uFF01-\uFF5E]/g,
    (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
 
  // 3. 연속 공백 → 단일 공백
  t = t.replace(/\s+/g, ' ');
 
  // 4. 연속 반복 문자 축약 (3회로 제한)
  t = t.replace(/(.)\1{3,}/g, '$1$1$1');
 
  // 5. 앞뒤 공백 제거
  t = t.trim();
 
  // 6. 최대 길이 truncate (가능하면 단어 경계에서)
  const truncated = t.length > CONFIG.MAX_INPUT_LENGTH;
  if (truncated) {
    t = t.slice(0, CONFIG.MAX_INPUT_LENGTH);
    const lastBreak = Math.max(t.lastIndexOf(' '), t.lastIndexOf('\n'));
    if (lastBreak > CONFIG.MAX_INPUT_LENGTH * 0.85) t = t.slice(0, lastBreak);
    t = t.trimEnd() + '…';
  }
 
  return { cleanText: t, truncated, originalLength };
}
 
// =============================================================================
// ⑦ 길이 분류
// =============================================================================
 
/**
 * @typedef {'minimal'|'short'|'medium'|'long'|'extended'} LengthClass
 */
 
/**
 * 정규화된 텍스트의 길이를 분류하고 AI 분석 신뢰도를 산출한다.
 *
 * 신뢰도(analysisReliability):
 *   - AI 프롬프트에 포함되어 "짧은 입력은 추론에 의존해 주세요"를
 *     자동으로 전달하는 데 사용된다.
 *
 * @param {string} cleanText
 * @returns {{ class: LengthClass, charCount: number, analysisReliability: number }}
 */
export function classifyInputLength(cleanText) {
  const charCount = cleanText.replace(/\s+/g, '').length;
 
  const [cls, reliability] =
    charCount <  8  ? ['minimal',  0.15] :
    charCount <= 25 ? ['short',    0.50] :
    charCount <= 120? ['medium',   0.82] :
    charCount <= 350? ['long',     0.95] :
                      ['extended', 1.00];
 
  return { class: cls, charCount, analysisReliability: reliability };
}
 
// =============================================================================
// ⑧ 품질 평가 (기계적 검사만 — 의미적 판단은 AI가)
// =============================================================================
 
/**
 * 텍스트의 기계적 품질을 평가한다.
 *
 * 기계적 검사 (이 모듈이 담당):
 *   - 최소 길이 미달
 *   - 무의미 문자 연속 (ㅋㅋㅋ, ㅎㅎㅎ만 있는 경우)
 *   - 특수문자만으로 구성된 입력
 *   - 완전 동일 문자 반복 (aaaaaaaaa)
 *
 * 의미적 판단 (AI가 담당):
 *   - 부정적 소감 감지
 *   - 관련성 판단
 *   - 문법적 완성도
 *
 * @param {string} cleanText
 * @param {string} language
 * @returns {{
 *   score: number,
 *   isAcceptable: boolean,
 *   issues: string[],
 *   uiMessage: string | null,
 *   fallbackStrategy: 'normal' | 'request_more' | 'use_defaults'
 * }}
 */
export function assessQuality(cleanText, language = 'ko') {
  const issues = [];
  let score = 100;
 
  const bare = cleanText.replace(/\s+/g, '');
  const len  = bare.length;
 
  // 검사 1: 최소 길이
  if (len < CONFIG.MIN_VIABLE_LENGTH) {
    score -= 70;
    issues.push('TOO_SHORT');
  }
 
  // 검사 2: 단일 문자만 반복 (ㅋㅋㅋㅋ, hahaha)
  if (len > 2 && new Set(bare).size <= 2) {
    score -= 55;
    issues.push('SINGLE_CHAR_REPEAT');
  }
 
  // 검사 3: 특수문자/숫자만으로 구성
  const meaningfulRatio =
    (bare.match(/[\p{L}\p{N}]/gu) || []).length / Math.max(len, 1);
  if (meaningfulRatio < 0.40 && len > 3) {
    score -= 40;
    issues.push('LOW_MEANINGFUL_CHARS');
  }
 
  // 검사 4: 자음/모음만 (한국어 — ㄱㄴㄷ 등)
  if (/^[\u1100-\u11FF\u3130-\u318F\s]+$/.test(cleanText.trim())) {
    score -= 50;
    issues.push('JAMO_ONLY');
  }
 
  score = Math.max(0, Math.min(100, score));
  const isAcceptable = score >= CONFIG.MIN_QUALITY_SCORE;
 
  // UI 메시지 (언어별)
  const MSG = {
    TOO_SHORT: {
      ko: '소감을 조금 더 자세히 적어주시면 더 특별한 카드를 만들 수 있어요 😊',
      en: 'Please share a bit more to create a more personalized card 😊',
      ja: 'もう少し詳しくご感想をお書きいただくと、より素敵なカードができます 😊',
      zh: '请再多写一些感想，让我们为您创作更独特的卡片 😊',
    },
    SINGLE_CHAR_REPEAT: {
      ko: '울산에서 느낀 점을 문장으로 남겨주세요 :)',
      en: 'Please describe your experience in a sentence :)',
      ja: 'ご感想を文章でお聞かせください :)',
      zh: '请用一句话描述您的感受 :)',
    },
  };
 
  const primaryIssue = issues[0];
  const uiMessage = primaryIssue && MSG[primaryIssue]
    ? (MSG[primaryIssue][language] || MSG[primaryIssue].ko)
    : null;
 
  const fallbackStrategy =
    !isAcceptable && issues.includes('TOO_SHORT')       ? 'request_more'  :
    !isAcceptable && issues.includes('SINGLE_CHAR_REPEAT') ? 'request_more':
    !isAcceptable                                        ? 'use_defaults'  :
    'normal';
 
  return { score, isAcceptable, issues, uiMessage, fallbackStrategy };
}
 
// =============================================================================
// ⑨ 메인 전처리 함수
// =============================================================================
 
/**
 * @typedef {Object} SlimPreprocessed
 *
 * [기계적 팩트 — 이 모듈이 생성]
 * @property {string}       rawText             원본 입력 텍스트
 * @property {string}       cleanText           정규화된 텍스트
 * @property {boolean}      truncated           최대 길이 초과 truncate 여부
 * @property {number}       originalLength      원본 길이
 * @property {'ko'|'ja'|'zh'|'en'} language    감지된 언어
 * @property {Object}       lengthInfo          길이 분류 결과
 * @property {string[]}     emojis              추출된 이모지 목록 (해석은 AI가)
 * @property {Object}       quality             품질 평가 결과
 * @property {number}       diversitySeed       다양성 주입용 결정론적 시드
 * @property {Object}       metadata            처리 메타데이터
 *
 * [의미론적 분석 — ai-extractor.js AI가 채움]
 * @property {null}         contextAnalysis     AI 분석 전: null
 * @property {null}         emotionScores       AI 분석 전: null
 * @property {null}         colorParams         AI 분석 전: null
 * @property {null}         responseData        AI 분석 전: null
 */
 
/**
 * 방문객 소감을 기계적으로 전처리한다.
 * 출력은 ai-extractor.js의 직접 입력으로 사용된다.
 *
 * @param {string} rawText
 * @returns {SlimPreprocessed}
 *
 * @example
 * const pre = preprocessInput("신불산 억새밭, 정말 장관이었어요! 🌾✨");
 * // pre.language  → 'ko'
 * // pre.emojis    → ['🌾', '✨']   ← 해석은 AI가
 * // pre.quality.isAcceptable → true
 * // → ai-extractor.js 에 전달
 */
export function preprocessInput(rawText) {
  const t0 = Date.now();
 
  // 타입 보정
  if (rawText === null || rawText === undefined) rawText = '';
  if (typeof rawText !== 'string') rawText = String(rawText);
 
  // ── 기계적 처리 단계 ─────────────────────────────────────────────
 
  // 1. 텍스트 정규화
  const { cleanText, truncated, originalLength } = normalizeText(rawText);
 
  // 2. 언어 감지
  const language = detectLanguage(cleanText);
 
  // 3. 길이 분류
  const lengthInfo = classifyInputLength(cleanText);
 
  // 4. 이모지 추출 (목록만 — 해석은 AI가)
  const emojis = extractEmojis(rawText); // 원본에서 추출 (정규화 전 이모지 보존)
 
  // 5. 품질 평가
  const quality = assessQuality(cleanText, language);
 
  // 6. 다양성 시드
  const diversitySeed = cyrb53Hash(rawText);
 
  // 7. 처리 메타데이터
  const metadata = {
    processedAt:      new Date().toISOString(),
    processingTimeMs: Date.now() - t0,
    engineVersion:    '2.0.0',
    diversitySeed,
  };
 
  return {
    // ── 기계적 팩트 (이 모듈이 확정) ────────────────────────────
    rawText,
    cleanText,
    truncated,
    originalLength,
    language,
    lengthInfo,
    emojis,
    quality,
    diversitySeed,
    metadata,
 
    // ── 의미론적 분석 슬롯 (AI가 채울 자리) ─────────────────────
    contextAnalysis: null,   // AI: 시간·계절·동행자·이모지 해석
    emotionScores:   null,   // AI: 8차원 감성 점수
    colorParams:     null,   // AI + param-synthesizer: 색채 파라미터
    responseData:    null,   // AI: 타이포그래피·답글
  };
}
 
// =============================================================================
// ⑩ 디버그 유틸리티
// =============================================================================
 
/**
 * 전처리 결과를 콘솔에 출력한다. (개발 전용)
 * @param {SlimPreprocessed} result
 */
export function debugPrint(result) {
  /* eslint-disable no-console */
  console.group('🔧 PreprocessedInput v2.0');
  console.log('언어:',   result.language);
  console.log('길이:',   result.lengthInfo.class,
    `(${result.lengthInfo.charCount}자, 신뢰도 ${result.lengthInfo.analysisReliability})`);
  console.log('이모지:', result.emojis.join(' ') || '없음',
    '← 해석은 AI가');
  console.log('품질 점수:', result.quality.score,
    result.quality.isAcceptable ? '✅' : '❌ ' + result.quality.fallbackStrategy);
  if (result.quality.issues.length)
    console.warn('품질 이슈:', result.quality.issues);
  if (result.quality.uiMessage)
    console.info('UI 메시지:', result.quality.uiMessage);
  console.log('다양성 시드:', result.diversitySeed);
  console.log('처리 시간:', result.metadata.processingTimeMs + 'ms');
  console.log('--- AI 분석 슬롯 (모두 null — ai-extractor가 채움) ---');
  console.log('contextAnalysis:', result.contextAnalysis);
  console.log('emotionScores:',   result.emotionScores);
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  preprocessInput,
  detectLanguage,
  normalizeText,
  classifyInputLength,
  extractEmojis,
  assessQuality,
  cyrb53Hash,
  debugPrint,
  CONFIG,
};
 
