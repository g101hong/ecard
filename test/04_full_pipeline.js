// node test/04_full_pipeline.js
// 실제 서버가 떠 있어야 동작
const BASE = 'http://localhost:3000';

async function run() {
  console.log('⏳ 전체 파이프라인 테스트 시작...\n');

  // 1. 헬스체크
  const health = await fetch(`${BASE}/api/health`).then(r => r.json());
  console.log('1. 헬스체크:   ', health.status === 'ok' ? '✅' : '❌');

  // 2. 입력 검증 (짧은 텍스트 → 400 에러 확인)
  const bad = await fetch(`${BASE}/api/impression`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '좋아요' }),
  });
  console.log('2. 짧은 입력 거부:', bad.status === 400 ? '✅' : '❌');

  // 3. 전체 분석
  console.log('3. 전체 분석 시작... (5~10초 소요)');
  const res  = await fetch(`${BASE}/api/impression`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '신불산 억새밭을 가족과 함께 올랐어요. 황금빛 억새가 바람에 일렁이는 장관에 말을 잃었습니다 🌾',
    }),
  });
  const data = await res.json();

  // 4. 응답 필드 확인
  const checks = {
    'spotIndex 있음':       data.spotIndex !== undefined,
    'emotionScores 있음':   !!data.emotionScores,
    '8개 감성 점수':        Object.keys(data.emotionScores || {}).length === 8,
    'panelColors 있음':     !!data.panelColors,
    '12개 패널 색상':        Object.keys(data.panelColors || {}).length === 12,
    'reply.main 있음':      !!data.reply?.main,
    'reply.place 있음':     !!data.reply?.place,
    'reply.tagline 있음':   !!data.reply?.tagline,
    'tagline ULSAN 형식':   data.reply?.tagline?.startsWith('ULSAN'),
  };

  console.log('\n── 응답 필드 확인 ─────────────────────────');
  let pass = 0;
  for (const [label, ok] of Object.entries(checks)) {
    console.log(`   ${ok ? '✅' : '❌'} ${label}`);
    if (ok) pass++;
  }
  console.log(`\n결과: ${pass}/${Object.keys(checks).length} 항목 통과`);
  console.log('\n── 답글 내용 ───────────────────────────────');
  console.log('경승지:  ', data.spotIndex, '번');
  console.log('main:    ', data.reply?.main);
  console.log('tagline: ', data.reply?.tagline);
}

run().catch(console.error);