/**
 * @fileoverview server/index.js
 * @description  울산 E-Card Express 서버 진입점
 */

'use strict';

import express   from 'express';
import cors      from 'cors';
import dotenv    from 'dotenv';
import path      from 'path';
import { fileURLToPath } from 'url';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app       = express();

// ── CORS ────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://127.0.0.1:5500',   // Live Server 개발
    'http://localhost:5500',
    'http://localhost:3000',
    process.env.CORS_ORIGIN,   // 운영 도메인 (.env 설정)
  ].filter(Boolean),
}));

// ── 미들웨어 ────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── 정적 파일 서빙 ───────────────────────────────────────────────
// public/ → HTML/JS/CSS
app.use(express.static(path.join(__dirname, '../public')));
// assets/ → 경승지 이미지(scenes/), 폰트(*.ttf)
app.use('/assets', express.static(path.join(__dirname, '../assets')));
// output/ → 생성된 PNG 다운로드
app.use('/output', express.static(path.join(__dirname, '../output')));

// ── 헬스체크 ─────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    time:      new Date().toISOString(),
    env:       process.env.NODE_ENV,
    geminiKey: process.env.GEMINI_API_KEY ? '설정됨 ✅' : '없음 ❌',
  });
});

// ── API 라우터 ────────────────────────────────────────────────────
import apiRouter from './routes/api.js';
app.use('/api', apiRouter);

// ── SPA 폴백 (모든 미매칭 GET → index.html) ───────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── 404 / 전역 오류 처리 ─────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── 서버 기동 ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 서버 기동: http://localhost:${PORT}`);
  console.log(`   헬스체크: http://localhost:${PORT}/api/health`);
  console.log(`   Gemini 키: ${process.env.GEMINI_API_KEY ? '설정됨 ✅' : '없음 ❌'}`);
});
