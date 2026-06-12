// server/routes/api.js
import { Router }       from 'express';
import impressionRouter from './impression.js';
import cardRouter       from './card.js';

const router = Router();

router.use('/impression', impressionRouter);
router.use('/card',       cardRouter);

export default router;