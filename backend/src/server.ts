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

dotenv.config();

const app: Application = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan('dev'));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const redisOk = redis.status === 'ready';
    res.json({ status: 'ok', db: 'ok', redis: redisOk ? 'ok' : redis.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    res.status(503).json({ status: 'degraded', error: message });
  }
});

// Serve uploaded files as static (swap with Drive URLs when service account ready)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth',         authRoutes);
app.use('/api/templates',    templateRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/approvals',    approvalRoutes);
app.use('/api/settlements',  settlementRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/uploads',      uploadRoutes);

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
