// Validate env first — boot fails fast if config is malformed
import { env } from './config/env';

import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import { pool } from './config/db';
import { redis } from './config/redis';
import { errorHandler } from './middlewares/errorHandler';


import authRoutes from './routes/authRoutes';
import templateRoutes from './routes/templateRoutes';
import applicationRoutes from './routes/applicationRoutes';
import approvalRoutes from './routes/approvalRoutes';
import settlementRoutes from './routes/settlementRoutes';
import adminRoutes from './routes/adminRoutes';
import uploadRoutes from './routes/uploadRoutes';
import fileRoutes from './routes/fileRoutes';
import sseRoutes from './routes/sseRoutes';
import accountingRoutes from './routes/accountingRoutes';

const app: Application = express();
const PORT = env.PORT;

// ── Security & parsing ────────────────────────────────────────────────────────
app.use(helmet({
  // Allow inline styles/scripts from same origin (Tailwind, Vite HMR)
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
}));

// Compress all JSON/text responses >1KB — significant win on slow office LAN
app.use(compression({ threshold: 1024 }));

app.use(cors({
  origin: env.FRONTEND_ORIGIN,
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Structured logging: 'combined' in prod (Apache format), 'dev' locally
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const redisOk = redis.status === 'ready';
    res.json({ status: 'ok', db: 'ok', redis: redisOk ? 'ok' : redis.status, ts: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    res.status(503).json({ status: 'degraded', error: message });
  }
});

// NOTE: public /uploads mount removed — files now served via auth-gated
//       GET /api/files/:id route (see fileRoutes). Receipts/images should
//       move to Google Drive (service account) — see uploadRoutes.

app.use('/api/auth',         authRoutes);
app.use('/api/templates',    templateRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/approvals',    approvalRoutes);
app.use('/api/settlements',  settlementRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/uploads',      uploadRoutes);
app.use('/api/files',        fileRoutes);
app.use('/api/events',       sseRoutes);
app.use('/api/accounting',   accountingRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[ringo] backend listening on port ${PORT}`);
});

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[ringo] ${signal} received, shutting down`);
  await pool.end();
  await redis.quit();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

export default app;
