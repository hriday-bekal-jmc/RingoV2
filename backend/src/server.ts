import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { pool } from './config/db';
import { redis } from './config/redis';
import { errorHandler } from './middlewares/errorHandler';

import path from 'path';
import authRoutes from './routes/authRoutes';
import templateRoutes from './routes/templateRoutes';
import applicationRoutes from './routes/applicationRoutes';
import approvalRoutes from './routes/approvalRoutes';
import settlementRoutes from './routes/settlementRoutes';
import adminRoutes from './routes/adminRoutes';
import uploadRoutes from './routes/uploadRoutes';
import sseRoutes from './routes/sseRoutes';
import accountingRoutes from './routes/accountingRoutes';

dotenv.config();

const app: Application = express();
const PORT = Number(process.env.PORT) || 3000;

// ── Security & parsing ────────────────────────────────────────────────────────
app.use(helmet({
  // Allow inline styles/scripts from same origin (Tailwind, Vite HMR)
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));

// Compress all JSON/text responses >1KB — significant win on slow office LAN
app.use(compression({ threshold: 1024 }));

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Structured logging: 'combined' in prod (Apache format), 'dev' locally
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

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

// ── Static uploads — long-lived cache (content-addressed via filename hash) ───
app.use('/uploads', (req, res, next) => {
  // Allow browsers to cache uploaded files for 7 days;
  // filenames include a timestamp so cache busting is automatic
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  next();
}, express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth',         authRoutes);
app.use('/api/templates',    templateRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/approvals',    approvalRoutes);
app.use('/api/settlements',  settlementRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/uploads',      uploadRoutes);
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
