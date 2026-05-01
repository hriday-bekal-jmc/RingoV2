import { Router, Request, Response } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

// ── Client registry ──────────────────────────────────────────────────────────
// userId → Set of active SSE response objects
const clients = new Map<string, Set<Response>>();

function register(userId: string, res: Response) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(res);
}

function unregister(userId: string, res: Response) {
  clients.get(userId)?.delete(res);
  if (clients.get(userId)?.size === 0) clients.delete(userId);
}

function writeEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Emit an event to all connected clients (broadcast). */
export function emitAll(event: string, data: unknown = {}) {
  for (const [, resSet] of clients) {
    for (const res of resSet) {
      try { writeEvent(res, event, data); } catch { /* disconnected mid-write */ }
    }
  }
}

/** Emit an event only to specific users. */
export function emitToUsers(userIds: string[], event: string, data: unknown = {}) {
  for (const uid of userIds) {
    const resSet = clients.get(uid);
    if (!resSet) continue;
    for (const res of resSet) {
      try { writeEvent(res, event, data); } catch { /* disconnected */ }
    }
  }
}

// ── SSE endpoint ──────────────────────────────────────────────────────────────
router.use(requireAuth);

router.get('/', (req: Request, res: Response) => {
  const userId = req.user!.id;

  // Required SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering

  // Flush immediately so browser knows it's SSE
  res.flushHeaders();

  register(userId, res);

  // Initial handshake event
  writeEvent(res, 'connected', { userId, ts: Date.now() });

  // Heartbeat every 25s — keeps proxies/load-balancers from closing idle connections
  const hb = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); }
  }, 25_000);

  req.on('close', () => {
    clearInterval(hb);
    unregister(userId, res);
  });
});

export default router;
