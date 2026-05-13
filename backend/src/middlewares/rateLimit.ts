// Rate limiters for sensitive endpoints. In-memory store is fine on a
// single backend instance; behind multiple replicas, switch to a Redis
// store (rate-limit-redis) so counters are shared.

import rateLimit from 'express-rate-limit';

// Login + OAuth callback — block credential stuffing / brute force
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  limit:    10,               // 10 attempts/min/IP
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'ログイン試行が多すぎます。1分後に再度お試しください。' },
});

// Uploads — limit per-user storage flooding
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit:    60,               // 60 files/min/IP (after auth, but IP still useful)
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'アップロード数が多すぎます。1分後に再度お試しください。' },
});

// Generic mutation routes — broad protection on POST/PATCH/DELETE
export const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit:    300,
  skip:     (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'リクエストが多すぎます。少し待ってから再度お試しください。' },
});
