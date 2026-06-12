/**
 * @fileoverview 울산 E-Card 답글 엔진 — 자연 환경 키워드 사전
 * @module reply-engine/constants/natural-keywords
 * @version 1.0.0
 *
 * ─────────────────────────────────────────────────────────────────
 * 역할
 * ─────────────────────────────────────────────────────────────────
 *
 *   방문 소감 텍스트에 장소명이 없을 때
 *   context-classifier.js가 이 사전을 참조하여
 *   소감 안의 자연 환경 키워드를 감지하고
 *   답글 문장 재료로 변환한다.
 *
 *   "파도 소리가 아직도 귓가에 맴돌아요"
 *     → '파도' 감지 → category: 'sea'
 *     → 답글: "그 파도 소리가 새긴 자리"
 *
 * ─────────────────────────────────────────────────────────────────
 * [카테고리 설계]
 *
 *   울산 12경의 자연 환경을 7개 카테고리로 분류한다.
 *   각 카테고리는 관련 경승지(spotIndices)와 연결되어
 *   context-classifier가 spotIndex를 보정하는 데 사용된다.
 *
 *   sea      바다·해양  → 간절곶(0)·대왕암(1)·강동(2)·장생포(3)
 *   mountain 산·능선    → 대운산(6)·신불산(10)·가지산(11)
 *   river    강·물      → 태화강(9)·울산대교(7)
 *   forest   숲·나무    → 대왕암(1)·대운산(6)·울산대공원(8)·태화강(9)
 *   sky      하늘·빛    → 간절곶(0)·신불산(10)
 *   earth    흙·바위    → 반구대(5)·외고산(4)
 *   wind     바람·소리  → 신불산(10)·강동(2)·간절곶(0)
 *
 * ─────────────────────────────────────────────────────────────────
 * [답글 연동 구조]
 *
 *   키워드 감지 결과는 아래 형식으로 context-classifier에 전달된다:
 *
 *   {
 *     detected:    true,
 *     category:    'sea',
 *     keyword:     '파도',          ← 실제 감지된 단어
 *     expression:  '파도',          ← 답글 문장에 쓸 표현
 *     langTone:    '리드미컬한 고요·반복·파도의 기억',
 *     spotIndices: [0, 1, 2, 3],    ← 관련 경승지 후보
 *   }
 */
 
'use strict';
 
// =============================================================================
// ① 자연 환경 카테고리 정의
// =============================================================================
 
/**
 * 7개 자연 환경 카테고리
 * 각 카테고리는 답글 생성에 필요한 메타데이터를 포함한다.
 */
export const NATURAL_CATEGORIES = {
 
  // ── 바다·해양 ──────────────────────────────────────────────────
  sea: {
    label:       '바다·해양',
    spotIndices: [0, 1, 2, 3],
    langTone:    '탁 트인 수평선·바람·파도의 리듬',
    colorHint:   '청록·코발트블루·파도 흰빛',
    expressions: ['바다', '그 바다', '수평선', '파도'],
  },
 
  // ── 산·능선 ────────────────────────────────────────────────────
  mountain: {
    label:       '산·능선',
    spotIndices: [6, 10, 11],
    langTone:    '높이·고요한 정상·능선의 바람',
    colorHint:   '깊은 초록·산안개·하늘 경계',
    expressions: ['산', '그 산', '능선', '봉우리', '정상'],
  },
 
  // ── 강·물 ──────────────────────────────────────────────────────
  river: {
    label:       '강·물',
    spotIndices: [7, 9],
    langTone:    '흐르는 것·반영·잔잔한 물결',
    colorHint:   '청록·수면 반영·물빛',
    expressions: ['강', '그 강물', '물', '강물', '수면'],
  },
 
  // ── 숲·나무 ────────────────────────────────────────────────────
  forest: {
    label:       '숲·나무',
    spotIndices: [1, 6, 8, 9],
    langTone:    '초록의 깊이·산란광·고요한 그늘',
    colorHint:   '깊은 초록·빛 산란·이끼빛',
    expressions: ['숲', '그 숲', '나무', '숲길', '나뭇잎'],
  },
 
  // ── 하늘·빛 ────────────────────────────────────────────────────
  sky: {
    label:       '하늘·빛',
    spotIndices: [0, 10],
    langTone:    '드넓음·빛의 방향·구름과 시간',
    colorHint:   '하늘빛·황금빛·노을 오렌지',
    expressions: ['하늘', '그 하늘', '빛', '노을', '석양', '일출', '햇빛'],
  },
 
  // ── 흙·바위 ────────────────────────────────────────────────────
  earth: {
    label:       '흙·바위',
    spotIndices: [4, 5],
    langTone:    '오래됨·묵직함·시간이 새긴 것',
    colorHint:   '황토·암갈색·사암빛',
    expressions: ['바위', '그 바위', '돌', '흙', '암벽'],
  },
 
  // ── 바람·소리 ──────────────────────────────────────────────────
  wind: {
    label:       '바람·소리',
    spotIndices: [0, 2, 10],
    langTone:    '감각적 기억·청각·몸으로 느낀 것',
    colorHint:   '투명함·흔들림·은은한 움직임',
    expressions: ['바람', '그 바람', '소리', '바람 소리', '파도 소리'],
  },
};
 
// =============================================================================
// ② 자연 환경 키워드 사전
// =============================================================================
 
/**
 * 키워드 항목 구조:
 *   word       : 감지할 원본 단어 (소감에서 매칭)
 *   category   : NATURAL_CATEGORIES 키
 *   expression : 답글 문장에 쓸 표현 (word와 다를 수 있음)
 *   weight     : 감지 우선순위 (높을수록 먼저 사용, 1~5)
 *   variants   : 동의어·유사 표현 목록 (추가 매칭용)
 */
export const NATURAL_KEYWORDS = [
 
  // ══════════════════════════════════════════════════════════════
  // 바다·해양 (sea)
  // ══════════════════════════════════════════════════════════════
  {
    word:       '바다',
    category:   'sea',
    expression: '바다',
    weight:     5,
    variants:   ['바닷가', '해변', '해안', '바닷물', '바다색'],
  },
  {
    word:       '파도',
    category:   'sea',
    expression: '파도',
    weight:     5,
    variants:   ['파도 소리', '파도소리', '물결', '너울'],
  },
  {
    word:       '수평선',
    category:   'sea',
    expression: '수평선',
    weight:     4,
    variants:   ['지평선', '수평선 너머'],
  },
  {
    word:       '해변',
    category:   'sea',
    expression: '해변',
    weight:     4,
    variants:   ['백사장', '모래사장', '몽돌', '자갈밭', '해수욕장'],
  },
  {
    word:       '항구',
    category:   'sea',
    expression: '항구',
    weight:     3,
    variants:   ['포구', '선착장', '부두', '방파제'],
  },
  {
    word:       '갈매기',
    category:   'sea',
    expression: '갈매기',
    weight:     3,
    variants:   ['갈매기 소리', '바닷새'],
  },
  {
    word:       '고래',
    category:   'sea',
    expression: '고래',
    weight:     4,
    variants:   ['돌고래', '혹등고래', '고래 점프'],
  },
 
  // ══════════════════════════════════════════════════════════════
  // 산·능선 (mountain)
  // ══════════════════════════════════════════════════════════════
  {
    word:       '산',
    category:   'mountain',
    expression: '산',
    weight:     5,
    variants:   ['산길', '산속', '산자락', '산봉우리', '등산'],
  },
  {
    word:       '능선',
    category:   'mountain',
    expression: '능선',
    weight:     4,
    variants:   ['산릉', '산등성이', '능선길'],
  },
  {
    word:       '억새',
    category:   'mountain',
    expression: '억새',
    weight:     5,
    variants:   ['억새밭', '억새 평원', '억새 물결', '갈대'],
  },
  {
    word:       '단풍',
    category:   'mountain',
    expression: '단풍',
    weight:     4,
    variants:   ['단풍나무', '단풍잎', '붉은 단풍', '가을 단풍'],
  },
  {
    word:       '철쭉',
    category:   'mountain',
    expression: '철쭉',
    weight:     4,
    variants:   ['진달래', '철쭉꽃'],
  },
  {
    word:       '운해',
    category:   'mountain',
    expression: '운해',
    weight:     5,
    variants:   ['구름 바다', '안개', '산안개', '운무'],
  },
  {
    word:       '정상',
    category:   'mountain',
    expression: '정상',
    weight:     3,
    variants:   ['꼭대기', '산정', '봉우리'],
  },
  {
    word:       '계곡',
    category:   'mountain',
    expression: '계곡',
    weight:     5,
    variants:   ['골짜기', '계곡물', '폭포', '소(沼)', '여울'],
  },
 
  // ══════════════════════════════════════════════════════════════
  // 강·물 (river)
  // ══════════════════════════════════════════════════════════════
  {
    word:       '강',
    category:   'river',
    expression: '강',
    weight:     5,
    variants:   ['강변', '강가', '강물', '강줄기', '태화강'],
  },
  {
    word:       '강물',
    category:   'river',
    expression: '강물',
    weight:     5,
    variants:   ['물줄기', '흐르는 물', '강의 흐름'],
  },
  {
    word:       '다리',
    category:   'river',
    expression: '다리',
    weight:     3,
    variants:   ['교량', '현수교', '울산대교'],
  },
  {
    word:       '야경',
    category:   'river',
    expression: '야경',
    weight:     4,
    variants:   ['밤 풍경', '야간 조명', '야간 경관', '불빛'],
  },
  {
    word:       '백로',
    category:   'river',
    expression: '백로',
    weight:     5,
    variants:   ['백로 떼', '새', '철새', '왜가리'],
  },
 
  // ══════════════════════════════════════════════════════════════
  // 숲·나무 (forest)
  // ══════════════════════════════════════════════════════════════
  {
    word:       '숲',
    category:   'forest',
    expression: '숲',
    weight:     5,
    variants:   ['숲길', '숲속', '삼림', '수풀'],
  },
  {
    word:       '나무',
    category:   'forest',
    expression: '나무',
    weight:     4,
    variants:   ['나뭇잎', '나뭇가지', '나무 그늘', '수목'],
  },
  {
    word:       '소나무',
    category:   'forest',
    expression: '소나무',
    weight:     4,
    variants:   ['해송', '솔나무', '솔숲', '솔향'],
  },
  {
    word:       '대나무',
    category:   'forest',
    expression: '대나무',
    weight:     5,
    variants:   ['대숲', '십리대숲', '대나무 숲', '대밭'],
  },
  {
    word:       '꽃',
    category:   'forest',
    expression: '꽃',
    weight:     3,
    variants:   ['장미', '봄꽃', '꽃향기', '꽃밭', '꽃길'],
  },
 
  // ══════════════════════════════════════════════════════════════
  // 하늘·빛 (sky)
  // ══════════════════════════════════════════════════════════════
  {
    word:       '하늘',
    category:   'sky',
    expression: '하늘',
    weight:     5,
    variants:   ['푸른 하늘', '맑은 하늘', '드넓은 하늘'],
  },
  {
    word:       '노을',
    category:   'sky',
    expression: '노을',
    weight:     5,
    variants:   ['붉은 노을', '저녁 노을', '석양', '황혼', '노을빛'],
  },
  {
    word:       '일출',
    category:   'sky',
    expression: '일출',
    weight:     5,
    variants:   ['해돋이', '새벽', '떠오르는 해', '해뜨는'],
  },
  {
    word:       '햇빛',
    category:   'sky',
    expression: '햇빛',
    weight:     4,
    variants:   ['햇살', '햇볕', '빛', '광선', '태양빛'],
  },
  {
    word:       '구름',
    category:   'sky',
    expression: '구름',
    weight:     3,
    variants:   ['흰 구름', '뭉게구름', '구름 사이'],
  },
  {
    word:       '별',
    category:   'sky',
    expression: '별',
    weight:     4,
    variants:   ['별빛', '별하늘', '밤하늘', '은하수', '별이 쏟아'],
  },
 
  // ══════════════════════════════════════════════════════════════
  // 흙·바위 (earth)
  // ══════════════════════════════════════════════════════════════
  {
    word:       '바위',
    category:   'earth',
    expression: '바위',
    weight:     5,
    variants:   ['암벽', '암각화', '기암', '기암괴석', '돌'],
  },
  {
    word:       '흙',
    category:   'earth',
    expression: '흙',
    weight:     4,
    variants:   ['황토', '진흙', '흙냄새', '토기', '옹기'],
  },
  {
    word:       '몽돌',
    category:   'earth',
    expression: '몽돌',
    weight:     5,
    variants:   ['자갈', '검은 돌', '자갈밭', '몽돌 소리'],
  },
 
  // ══════════════════════════════════════════════════════════════
  // 바람·소리 (wind)
  // ══════════════════════════════════════════════════════════════
  {
    word:       '바람',
    category:   'wind',
    expression: '바람',
    weight:     5,
    variants:   ['바람 소리', '바람결', '산바람', '바닷바람', '해풍'],
  },
  {
    word:       '소리',
    category:   'wind',
    expression: '소리',
    weight:     4,
    variants:   ['파도 소리', '바람 소리', '새소리', '물소리', '자연의 소리'],
  },
  {
    word:       '공기',
    category:   'wind',
    expression: '공기',
    weight:     4,
    variants:   ['청량한 공기', '맑은 공기', '신선한 공기', '공기가 좋'],
  },
  {
    word:       '냄새',
    category:   'wind',
    expression: '냄새',
    weight:     3,
    variants:   ['향기', '바다 냄새', '풀 냄새', '솔향', '흙냄새'],
  },
];
 
// =============================================================================
// ③ 핵심 감지 함수
// =============================================================================
 
/**
 * 소감 텍스트에서 자연 환경 키워드를 감지하여 결과를 반환한다.
 *
 * 감지 우선순위:
 *   1. weight가 높은 키워드 우선
 *   2. 동일 weight면 word 길이가 긴 것 우선 (더 구체적)
 *   3. variants도 포함하여 매칭
 *
 * @param {string} text  정규화된 소감 텍스트
 * @returns {NaturalKeywordResult}
 *
 * @typedef {Object} NaturalKeywordResult
 * @property {boolean}  detected      키워드 감지 여부
 * @property {string|null} category   감지된 카테고리 (NATURAL_CATEGORIES 키)
 * @property {string|null} keyword    실제 감지된 단어
 * @property {string|null} expression 답글 문장에 쓸 표현
 * @property {string|null} langTone   해당 카테고리 언어 분위기
 * @property {string|null} colorHint  해당 카테고리 색채 힌트
 * @property {number[]}    spotIndices 관련 경승지 인덱스 후보
 * @property {Object[]}    allMatches  감지된 모든 키워드 목록 (디버그용)
 *
 * @example
 * detectNaturalKeyword("파도 소리가 아직도 귓가에 맴돌아요");
 * // → {
 * //     detected: true,
 * //     category: 'sea',
 * //     keyword: '파도',
 * //     expression: '파도',
 * //     langTone: '탁 트인 수평선·바람·파도의 리듬',
 * //     spotIndices: [0, 1, 2, 3],
 * //   }
 */
export function detectNaturalKeyword(text) {
  if (!text || typeof text !== 'string') {
    return _emptyResult();
  }
 
  const matches = [];
 
  for (const entry of NATURAL_KEYWORDS) {
    // 기본 word 매칭
    if (text.includes(entry.word)) {
      matches.push({ ...entry, matchedWord: entry.word });
      continue;
    }
    // variants 매칭
    for (const variant of entry.variants) {
      if (text.includes(variant)) {
        matches.push({ ...entry, matchedWord: variant });
        break;
      }
    }
  }
 
  if (matches.length === 0) {
    return _emptyResult();
  }
 
  // weight 내림차순 → 동일 weight면 matchedWord 길이 내림차순 정렬
  matches.sort((a, b) =>
    b.weight - a.weight || b.matchedWord.length - a.matchedWord.length
  );
 
  const top      = matches[0];
  const category = NATURAL_CATEGORIES[top.category];
 
  return {
    detected:    true,
    category:    top.category,
    keyword:     top.matchedWord,
    expression:  top.expression,
    langTone:    category.langTone,
    colorHint:   category.colorHint,
    spotIndices: category.spotIndices,
    allMatches:  matches.map((m) => ({
      word:     m.matchedWord,
      category: m.category,
      weight:   m.weight,
    })),
  };
}
 
/**
 * 소감 텍스트에서 카테고리별로 감지된 모든 키워드를 반환한다.
 * 답글 생성 시 여러 자연 요소를 동시에 활용할 때 사용.
 *
 * @param {string} text
 * @returns {Object.<string, string[]>} 카테고리 → 감지된 단어 목록
 *
 * @example
 * detectAllNaturalKeywords("파도 소리와 노을이 정말 아름다웠어요");
 * // → { sea: ['파도'], sky: ['노을'] }
 */
export function detectAllNaturalKeywords(text) {
  if (!text) return {};
 
  const result = {};
 
  for (const entry of NATURAL_KEYWORDS) {
    const allWords = [entry.word, ...entry.variants];
    for (const w of allWords) {
      if (text.includes(w)) {
        if (!result[entry.category]) result[entry.category] = [];
        if (!result[entry.category].includes(entry.word)) {
          result[entry.category].push(entry.word);
        }
        break;
      }
    }
  }
 
  return result;
}
 
/**
 * 카테고리 키로 메타데이터를 조회한다.
 *
 * @param {string} categoryKey
 * @returns {Object|null} NATURAL_CATEGORIES 항목
 */
export function getCategoryMeta(categoryKey) {
  return NATURAL_CATEGORIES[categoryKey] ?? null;
}
 
/**
 * spotIndex와 관련된 카테고리 목록을 반환한다.
 * emotion-engine의 spotIndex를 자연 카테고리와 연결할 때 사용.
 *
 * @param {number} spotIndex  0~11
 * @returns {string[]}  카테고리 키 배열
 *
 * @example
 * getCategoriesBySpot(0);
 * // → ['sea', 'sky', 'wind']  (간절곶 = 바다·하늘·바람)
 */
export function getCategoriesBySpot(spotIndex) {
  return Object.entries(NATURAL_CATEGORIES)
    .filter(([, meta]) => meta.spotIndices.includes(spotIndex))
    .map(([key]) => key);
}
 
// =============================================================================
// ④ 내부 유틸리티
// =============================================================================
 
/** 감지 실패 시 반환할 빈 결과 */
function _emptyResult() {
  return {
    detected:    false,
    category:    null,
    keyword:     null,
    expression:  null,
    langTone:    null,
    colorHint:   null,
    spotIndices: [],
    allMatches:  [],
  };
}
 
// =============================================================================
// ⑤ 디버그 유틸리티
// =============================================================================
 
/**
 * 키워드 감지 결과를 콘솔에 출력한다. (개발 전용)
 * @param {string} text  소감 텍스트
 */
export function debugDetect(text) {
  /* eslint-disable no-console */
  const result = detectNaturalKeyword(text);
  const all    = detectAllNaturalKeywords(text);
 
  console.group('🌿 NaturalKeyword 감지 결과');
  console.log('입력:', `"${text}"`);
  console.log('');
 
  if (result.detected) {
    console.log('✅ 감지 성공');
    console.log('  카테고리 :', result.category, `(${getCategoryMeta(result.category)?.label})`);
    console.log('  감지 단어 :', result.keyword);
    console.log('  답글 표현 :', result.expression);
    console.log('  언어 분위기:', result.langTone);
    console.log('  색채 힌트  :', result.colorHint);
    console.log('  관련 경승지:', result.spotIndices);
  } else {
    console.log('❌ 자연 키워드 없음');
  }
 
  if (Object.keys(all).length > 1) {
    console.log('');
    console.log('📋 전체 감지 목록:');
    Object.entries(all).forEach(([cat, words]) => {
      console.log(`  ${cat}: [${words.join(', ')}]`);
    });
  }
 
  if (result.allMatches.length > 0) {
    console.log('');
    console.log('🔢 우선순위 정렬 결과:');
    result.allMatches.forEach((m, i) => {
      console.log(`  ${i + 1}. "${m.word}" (${m.category}, weight:${m.weight})`);
    });
  }
 
  console.groupEnd();
  /* eslint-enable no-console */
}
 
// =============================================================================
// Default Export
// =============================================================================
 
export default {
  NATURAL_KEYWORDS,
  NATURAL_CATEGORIES,
  detectNaturalKeyword,
  detectAllNaturalKeywords,
  getCategoryMeta,
  getCategoriesBySpot,
  debugDetect,
};