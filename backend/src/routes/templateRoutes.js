import { Router } from 'express';
const router = Router();
router.get('/ping', (req, res) => res.json({ scope: 'templates', ok: true }));
export default router;
