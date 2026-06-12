// test/api_direct.js
// node test/api_direct.js
import dotenv from 'dotenv';
dotenv.config();

const KEY = process.env.GEMINI_API_KEY;

if (!KEY) {
  console.error('❌ GEMINI_API_KEY 가 .env 에 없습니다.');
  process.exit(1);
}

console.log('⏳ API 직접 호출 테스트...');
console.log('   키 앞 15자:', KEY.slice(0, 15) + '...');

const API_CONFIG = Object.freeze({
  // Gemini API — URL에 모델명 포함, 키는 쿼리 파라미터로 전달
  ENDPOINT:    'https://generativelanguage.googleapis.com/v1beta/models',
  MODEL:       'gemini-1.5-flash',
  MAX_TOKENS:  400,    // 답글은 짧음 — 3필드 합산 최대 ~150자
  MAX_RETRIES: 2,
  RETRY_DELAY: 1000,   // ms (첫 재시도 1초, 두 번째 2초)
  TIMEOUT_MS:  8000,   // 8초 초과 시 타임아웃
});

const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');

const url = `${API_CONFIG.ENDPOINT}/${API_CONFIG.MODEL}:generateContent?key=${apiKey}`;

const controller = new AbortController();

try {
  const res = await fetch(url, {
    method:  'POST',
    signal:  controller.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        // 시스템 프롬프트 — Gemini는 system_instruction 필드 사용
        system_instruction: {
            parts: [{ text: '당신은 울산광역시 E-Card의 메시지 작가입니다.' }],
        },
        // 사용자 메시지
        contents: [
            { role: 'user', parts: [{ text: '안녕하세요' }] },
        ],
        generationConfig: {
            maxOutputTokens: API_CONFIG.MAX_TOKENS,
            // JSON 출력 안정성 향상: temperature를 낮게 설정
            temperature: 0.2,
        },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('❌ API 오류');
    console.error('   HTTP 상태:', res.status);
    console.error('   응답 내용:', JSON.stringify(data, null, 2));
  } else {
    console.log('✅ API 호출 성공');
    console.log('   응답:', data.content?.[0]?.text);
  }

} catch (err) {
  console.error('❌ 네트워크 오류 (연결 불가)');
  console.error('   오류:', err.message);
}