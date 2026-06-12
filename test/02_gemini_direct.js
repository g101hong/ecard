// node test/02_gemini_direct.js
// Gemini API를 서버 없이 직접 호출해서 키·네트워크 연결 확인
import dotenv from 'dotenv';
dotenv.config();

const KEY = process.env.GEMINI_API_KEY;

if (!KEY) {
  console.error('❌ GEMINI_API_KEY 가 .env 에 없습니다.');
  console.error('   https://aistudio.google.com/app/apikey 에서 발급하세요.');
  process.exit(1);
}

console.log('⏳ Gemini API 직접 호출 테스트...');
console.log('   키 앞 10자:', KEY.slice(0, 10) + '...');

// Gemini API 엔드포인트 (claude-extractor.js 와 동일 구조)
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL    = 'gemini-2.5-flash';
const url      = `${ENDPOINT}/${MODEL}:generateContent?key=${KEY}`;

try {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Gemini 요청 구조 (claude-extractor.js API_CONFIG 동일)
      system_instruction: {
        parts: [{ text: '당신은 테스트 AI입니다. 한 줄로만 답하세요.' }],
      },
      contents: [
        { role: 'user', parts: [{ text: '울산 관광 E-Card 프로젝트 테스트입니다. "연결 성공"이라고만 답하세요.' }] },
      ],
      generationConfig: {
        maxOutputTokens: 50,
        temperature:     0.1,
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('\n❌ Gemini API 오류');
    console.error('   HTTP 상태:', res.status);
    console.error('   오류 내용:', JSON.stringify(data?.error, null, 2));

    // 상태 코드별 안내
    if (res.status === 400) console.error('   → 요청 형식 오류. MODEL 이름 확인:', MODEL);
    if (res.status === 403) console.error('   → API 키 권한 없음. Google AI Studio에서 키 재확인');
    if (res.status === 429) console.error('   → 요청 한도 초과. 잠시 후 재시도');
  } else {
    // Gemini 응답 파싱 (candidates[0].content.parts[0].text)
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const finishReason = data?.candidates?.[0]?.finishReason;

    console.log('\n✅ Gemini API 호출 성공');
    console.log('   응답:        ', text?.trim());
    console.log('   finishReason:', finishReason);
    console.log('   모델:        ', MODEL);
  }

} catch (err) {
  console.error('\n❌ 네트워크 오류 (generativelanguage.googleapis.com 연결 불가)');
  console.error('   오류:', err.message);
  console.error('   → 서버에서 구글 API 서버로 아웃바운드 443 허용 여부 확인 필요');
}