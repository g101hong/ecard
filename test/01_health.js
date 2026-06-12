// node test/01_health.js
import dotenv from 'dotenv';
dotenv.config();

const res  = await fetch('http://localhost:3000/api/health');
const data = await res.json();

console.log('── 헬스체크 ────────────────────────────────');
console.log('서버 상태:   ', data.status === 'ok' ? '✅ 정상' : '❌ 오류');
console.log('Gemini 키:  ', data.geminiKey);
console.log('응답 시각:  ', data.time);