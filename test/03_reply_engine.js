// node test/03_reply_engine.js
import { collectVisitContext }  from '../reply-engine/visit-context.js';
import { classify }            from '../reply-engine/context-classifier.js';
import { generateReply }       from '../reply-engine/reply-generator.js';

// 테스트용 더미 ExtractionResult
const dummyExtraction = {
  emotionScores: {
    amazement:75, peace:85, vitality:40, nostalgia:55,
    freshness:80, grandeur:50, warmth:65, mystery:35,
  },
  dominantEmotion: 'peace',
  spotIndex: 9,
  primaryEmotion: '깊은 평화',
  keywords: ['대나무', '백로', '힐링', '청량', '태화강'],
  contextAnalysis: {
    timeContext:      { detected: 'afternoon', confidence: 0.8 },
    seasonContext:    { detected: 'summer',    confidence: 0.9 },
    companionContext: { detected: 'couple',    confidence: 0.6 },
  },
};

const text     = '태화강 대나무숲을 연인과 함께 걸었어요. 백로가 날아오르는 모습이 인상적이었습니다.';
const visitCtx = collectVisitContext();

console.log('⏳ reply-engine 테스트 시작...');

const classified  = classify(dummyExtraction, visitCtx, text, 42);
console.log('contextType:', classified.contextType);   // SPOT_NAME or NATURAL_KEYWORD

const replyResult = await generateReply(classified, text);

console.log('\n── 결과 확인 ──────────────────────────────');
console.log('생성 성공:   ', replyResult.success ? '✅' : '⚠️ (폴백)');
console.log('tier:        ', replyResult.tier, replyResult.isFallback ? '(폴백)' : '');
console.log('main:        ', replyResult.reply?.main);
console.log('place:       ', replyResult.reply?.place);
console.log('tagline:     ', replyResult.reply?.tagline);