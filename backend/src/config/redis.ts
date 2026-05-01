import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

export const redis = new Redis({
  host:     process.env.REDIS_HOST || 'localhost',
  port:     Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
});

redis.on('error', (err: Error) => {
  console.error('[redis] connection error', err.message);
});

redis.on('ready', () => {
  console.log('[redis] connected');
});

export const bullConnection = {
  host:     process.env.REDIS_HOST || 'localhost',
  port:     Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null as null,
};
