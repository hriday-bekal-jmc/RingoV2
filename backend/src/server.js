import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { pool } from './config/db.js';
import { redis } from './config/redis.js';
import { errorHandler } from './middlewares/errorHandler.js';

import authRoutes from './routes/authRoutes.js';
import templateRoutes from './routes/templateRoutes.js';
import applicationRoutes from './routes/applicationRoutes.js';
import approvalRoutes from './routes/approvalRoutes.js';
import settlementRoutes from './routes/settlementRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

dotenv.config();

const app = express();
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

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const redisOk = redis.status === 'ready';
    res.json({ status: 'ok', db: 'ok', redis: redisOk ? 'ok' : redis.status });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/settlements', settlementRoutes);
app.use('/api/admin', adminRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[ringo] backend listening on port ${PORT}`);
});

const shutdown = async (signal) => {
  console.log(`[ringo] ${signal} received, shutting down`);
  await pool.end();
  await redis.quit();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
