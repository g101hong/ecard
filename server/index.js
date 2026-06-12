// server/index.js
import express  from 'express';
import cors     from 'cors';
import dotenv   from 'dotenv';
import path     from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json());

// 정적 파일 서빙 (public/ 폴더)
app.use(express.static(path.join(__dirname, '../public')));
// output/ 폴더 서빙 (PNG 다운로드)
app.use('/output', express.static(path.join(__dirname, '../output')));
// assets/ 폴더 서빙 (SVG 파일)
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// ── 헬스체크 ──────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time:   new Date().toISOString(),
    env:    process.env.NODE_ENV,
    apiKey: process.env.ANTHROPIC_API_KEY ? '설정됨 ✅' : '없음 ❌',
  });
});

// ── API 라우터 연결 ────────────────────────────────────
import apiRouter from './routes/api.js';
app.use('/api', apiRouter);

// ── 전역 오류 처리 ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[서버 오류]', err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 기동: http://localhost:${PORT}`);
  console.log(`   헬스체크: http://localhost:${PORT}/api/health`);
});
