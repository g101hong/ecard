// server/routes/test.js
import express from 'express';
import { runPipeline } from '../../test/03_full_pipeline.js'; // 테스트 파이프라인 함수화 필요

const router = express.Router();

router.post('/run-pipeline', async (req, res) => {
  try {
    // 03_full_pipeline.js의 로직을 함수화하여 호출
    const results = await runPipeline(); 
    res.json({ status: 'success', results });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

export default router;