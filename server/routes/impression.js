// server/routes/impression.js  ← 1차: 더미 버전
import { Router } from 'express';
const router = Router();

router.post('/', async (req, res) => {
  const { text } = req.body;

  // ① 입력값 기본 검증
  if (!text || text.trim().length < 8) {
    return res.status(400).json({ error: '소감이 너무 짧습니다 (8자 이상)' });
  }

  // ② 더미 응답 (emotion-engine 연결 전 라우트 동작 확인용)
  res.json({
    _dummy: true,
    text,
    message: '라우트 연결 확인 완료 ✅',
  });
});

export default router;