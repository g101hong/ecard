// node test/02_emotion_engine.js
// emotion-engine을 서버 없이 직접 호출해서 확인
import { analyzeImpression } from '../emotion-engine/index.js';

console.log('⏳ emotion-engine 테스트 시작...');

const result = await analyzeImpression(
  '간절곶에서 일출을 봤어요. 수평선 위로 해가 솟아오르는 순간 눈물이 날 것 같았습니다 🌅',
  { debugMode: true }
);

// 확인 항목
console.log('\n── 결과 확인 ──────────────────────────────');
console.log('처리 성공:     ', result.success ? '✅' : '❌ (폴백)');
console.log('매칭 경승지:   ', result.typography?.spotName);
console.log('핵심 감성:     ', result.typography?.primaryEmotion);
console.log('최고 감성 키:  ', result.meta?.isFallback ? '(폴백)' : '정상');
console.log('emotionScores 존재:', !!result.emotionScores ? '✅' : '❌');
console.log('panels 12개:  ', result.allPanels?.length === 12 ? '✅' : '❌');
console.log('처리 시간:     ', result.meta?.processingTimeMs + 'ms');