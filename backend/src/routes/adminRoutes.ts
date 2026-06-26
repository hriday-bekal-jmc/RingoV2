import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middlewares/authMiddleware';
import { mutationLimiter } from '../middlewares/rateLimit';
import usersRouter from './admin/usersRouter';
import departmentsRouter from './admin/departmentsRouter';
import legacyRoutesRouter from './admin/legacyRoutesRouter';
import applicationsRouter from './admin/applicationsRouter';
import permissionsRouter from './admin/permissionsRouter';
import notificationsRouter from './admin/notificationsRouter';
import slotsRouter from './admin/slotsRouter';
import patternsRouter from './admin/patternsRouter';
import templatesRouter from './admin/templatesRouter';

const router = Router();

// Auth + rate limit applied once here; sub-routers carry no middleware.
router.use(requireAuth);
router.use(requireAdmin);
router.use(mutationLimiter);

router.use('/', usersRouter);
router.use('/', departmentsRouter);
router.use('/', legacyRoutesRouter);
router.use('/', applicationsRouter);
router.use('/', permissionsRouter);
router.use('/', notificationsRouter);
router.use('/', slotsRouter);
router.use('/', patternsRouter);
router.use('/', templatesRouter);

export default router;
