/**
 * server/routes/impression.js  — 수정본 (방안A 반영)
 *
 * [v3.0 변경] 방안A — 짧은 소감 경승지 선택 결정론적 전환
 * ─────────────────────────────────────────────────────────────────
 *
 *   기존: 15자 이하 + 키워드 없음 → Math.random() * 12 (매 요청마다 다름)
 *   변경: 15자 이하 + 키워드 없음 → cyrb53Hash(cleanText) % 12 (결정론적)
 *
 *   변경 이유:
 *     1. emotion-engine/index.js의 단락회로(SHORT_CIRCUIT)에서
 *        spotIndex = diversitySeed % 12 로 결정론적으로 산출한다.
 *        impression.js가 Math.random()으로 덮어쓰면 두 값이 불일치한다.
 *     2. 같은 소감을 여러 번 제출해도 동일한 경승지가 나와야
 *        사용자 경험이 일관된다.
 *
 *   수정 범위:
 *     - _charCount <= 15 분기의 Math.floor(Math.random() * 12)
 *       → cyrb53Hash(cleanText) % 12  (로컬 해시 함수 사용)
 *     - 로그 메시지에 단락회로 여부(emotionResult.meta.shortCircuit) 추가
 *
 *   변경되지 않는 부분:
 *     - 1순위 키워드 매칭 로직 (기존 유지)
 *     - 3순위 AI 결과 사용 로직 (기존 유지)
 *     - SSE 이벤트 전송 구조 전체 (기존 유지)
 *
 * ─────────────────────────────────────────────────────────────────
 * 아래는 변경된 부분만 포함한 diff 형식 표기입니다.
 * 실제 파일 반영 시 기존 코드에서 해당 부분만 교체하세요.
 * ─────────────────────────────────────────────────────────────────
 */

// =============================================================================
// [추가] 결정론적 해시 함수 (cyrb53 — preprocessor.js와 동일 알고리즘)
// =============================================================================

/**
 * cyrb53 해시 — 32비트 부호 없는 정수 반환.
 * emotion-engine/preprocessor.js의 cyrb53Hash()와 동일한 알고리즘.
 * diversitySeed와 동일한 값을 impression.js에서 독립적으로 계산하는 데 사용.
 *
 * @param {string} str   입력 문자열
 * @param {number} [seed=0]  시드 오프셋 (기본 0)
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
// [수정] 경승지 선택 로직 — impression.js 라우트 핸들러 내부
// =============================================================================

/*
 * ── 수정 전 (기존 코드) ────────────────────────────────────────────
 *
 *   const spotIndex =
 *     _mentionedIdx >= 0 ? _mentionedIdx
 *     : _charCount   <= 15 ? Math.floor(Math.random() * 12)   // ← 랜덤
 *     : _aiSpotIndex;
 *
 * ── 수정 후 ────────────────────────────────────────────────────────
 *
 *   const _seedSpotIndex = cyrb53Hash(cleanText) % 12;
 *
 *   const spotIndex =
 *     _mentionedIdx  >= 0 ? _mentionedIdx           // 1순위: 키워드 명시
 *     : _charCount   <= 15 ? _seedSpotIndex          // 2순위: 시드 결정론적
 *     : _aiSpotIndex;                                // 3순위: AI 결과
 *
 * ────────────────────────────────────────────────────────────────────
 */

// =============================================================================
// [수정] 완성된 경승지 선택 + 로그 블록 (라우트 핸들러에서 교체할 전체 구간)
// =============================================================================

/*
 * 아래 코드를 impression.js의 "경승지 이미지 선택" 주석 블록과 교체:
 */

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

const _charCount   = cleanText.replace(/\s+/g, '').length;
const _aiSpotIndex = typography?.spotIndex ?? 0;

// 1순위: 글자 수와 무관하게 항상 키워드 먼저 검사
const _mentionedIdx = SPOT_KEYWORDS.findIndex(keywords =>
  keywords.some(kw => cleanText.includes(kw))
);

// [v3.0] 2순위: 랜덤 → 시드 결정론적으로 변경
// emotion-engine 단락회로의 diversitySeed % 12 와 동일 결과 보장
const _seedSpotIndex = cyrb53Hash(cleanText) % 12;

// ── 경승지 최종 결정 ──────────────────────────────────────────────
//
//   1순위: 소감에 12경 키워드 명시 → 글자 수 무관하게 해당 경승지
//   2순위: 15자 이하 + 키워드 없음 → 시드 결정론적 (같은 소감 = 항상 같은 경승지)
//   3순위: 16자 이상 + 키워드 없음 → AI 분석 결과
//
//   변경 전: Math.floor(Math.random() * 12)  → 매 요청마다 다른 경승지
//   변경 후: cyrb53Hash(cleanText) % 12      → 같은 소감이면 항상 같은 경승지
//
const spotIndex =
  _mentionedIdx  >= 0 ? _mentionedIdx     // 1순위: 키워드 명시
  : _charCount   <= 15 ? _seedSpotIndex   // 2순위: 시드 결정론적 [v3.0]
  : _aiSpotIndex;                         // 3순위: AI 결과

const processingTimeMs = Date.now() - t0;

// =============================================================================
// [수정] 완료 로그 — shortCircuit 여부 추가
// =============================================================================

/*
 * 기존 로그:
 *   console.log(
 *     `[impression-sse] 완료 ${processingTimeMs}ms |`,
 *     `경승지: ${typography?.spotName} |`,
 *     `감성: ${typography?.primaryEmotion} |`,
 *     emotionIsFallback ? '⚠️ 감성폴백' : '✅',
 *     replyIsFallback   ? '⚠️ 답글폴백' : '✅',
 *     '| SSE 2단계 전송',
 *   );
 *
 * 수정 후:
 */
console.log(
  `[impression-sse] 완료 ${processingTimeMs}ms |`,
  `경승지: ${typography?.spotName}(${spotIndex}) |`,
  `감성: ${typography?.primaryEmotion} |`,
  emotionResult?.meta?.shortCircuit ? '⚡ 단락회로' : '🤖 AI분석',  // [v3.0]
  emotionIsFallback ? '⚠️ 감성폴백' : '✅',
  replyIsFallback   ? '⚠️ 답글폴백' : '✅',
  '| SSE 2단계 전송',
);

// =============================================================================
// 변경 사항 요약
// =============================================================================

/*
 * 파일:   server/routes/impression.js
 * 버전:   v3.0 (방안A)
 *
 * 변경 1: cyrb53Hash() 함수 추가 (파일 상단 import 이후)
 *         → preprocessor.js의 cyrb53Hash와 동일한 알고리즘
 *
 * 변경 2: 경승지 선택 로직
 *   -: : _charCount <= 15 ? Math.floor(Math.random() * 12)
 *   +:   const _seedSpotIndex = cyrb53Hash(cleanText) % 12;
 *   +: : _charCount <= 15 ? _seedSpotIndex
 *
 * 변경 3: 주석 업데이트
 *   - "랜덤 (AI 신뢰도 낮음)" → "시드 결정론적 (같은 소감 = 항상 같은 경승지)"
 *
 * 변경 4: 완료 로그에 단락회로 여부 추가
 *   + emotionResult?.meta?.shortCircuit ? '⚡ 단락회로' : '🤖 AI분석'
 *
 * 변경되지 않은 부분:
 *   - SSE 이벤트 전송 구조 전체
 *   - SPOT_KEYWORDS 배열
 *   - 1순위(키워드 명시), 3순위(AI 결과) 로직
 *   - Supabase 저장 로직
 *   - 에러 처리 구조
 */
