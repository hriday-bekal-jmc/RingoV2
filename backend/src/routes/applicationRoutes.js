import { Router } from 'express';
const router = Router();
router.get('/ping', (req, res) => res.json({ scope: 'applications', ok: true }));
export default router;
