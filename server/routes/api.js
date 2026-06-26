/**
 * @fileoverview server/routes/api.js
 * @description  API 라우터 통합
 *
 * /api/impression  → impression.js  (impressionLimiter 적용)
 * /api/card        → card.js        (cardLimiter 적용)
 */

'use strict';

import { Router }       from 'express';
import impressionRouter from './impression.js';
import cardRouter       from './card.js';
import { impressionLimiter,
         cardLimiter }  from '../middleware/rateLimit.js';

const router = Router();

router.use('/impression', impressionLimiter, impressionRouter);
router.use('/card',       cardLimiter,       cardRouter);

export default router;
