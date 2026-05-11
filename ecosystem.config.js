// PM2 ecosystem config — runs 3 procs:
//   1. ringo-api          (Express API on :3000)
//   2. ringo-csv-worker   (BullMQ worker for CSV exports)
//   3. ringo-outbox       (event_outbox publisher → Redis pub/sub)
//
// All 3 should be running for full functionality:
//   - ringo-api alone:        HTTP works but SSE events never reach clients
//   - +ringo-outbox:          SSE events delivered via Redis pub/sub fanout
//   - +ringo-csv-worker:      CSV exports become possible
//
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup            (then run the printed command to enable boot-start)
//
// Per-proc commands:
//   pm2 logs ringo-api
//   pm2 restart ringo-outbox
//   pm2 reload ringo-api   (zero-downtime restart)
//
// For multi-instance API (horizontal scale on single box):
//   change instances: 1 → instances: 'max' (or fixed number)
//   and exec_mode: 'fork' → exec_mode: 'cluster'
//   API code is stateless thanks to outbox + Redis pub/sub.

module.exports = {
  apps: [
    {
      name: 'ringo-api',
      cwd:  './backend',
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ringo-outbox',
      cwd:  './backend',
      script: 'dist/workers/outboxPublisher.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '256M',
      // Restart on crash, but not too aggressively
      min_uptime: '10s',
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ringo-csv-worker',
      cwd:  './backend',
      script: 'dist/workers/csvExportWorker.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
