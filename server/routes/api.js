/**
 * @fileoverview server/routes/api.js
 * @description  API 라우터 통합
 *
 * /api/impression  → impression.js
 * /api/card        → card.js
 */

'use strict';

import { Router }       from 'express';
import impressionRouter from './impression.js';
import cardRouter       from './card.js';

const router = Router();

router.use('/impression', impressionRouter);
router.use('/card',       cardRouter);

export default router;
