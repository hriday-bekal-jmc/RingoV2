import { Router } from 'express';
const router = Router();
router.get('/ping', (req, res) => res.json({ scope: 'admin', ok: true }));
export default router;
