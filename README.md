# RINGO — Internal Workflow & Settlement System

Enterprise workflow + settlement system replacing rakumo. Handles 稟議 (ringi) approvals, expense settlements, and accounting workflows with predetermined approval routes assigned by admin.

## Stack
- **Frontend**: React 18 + Vite + Tailwind CSS + React Query + react-hook-form
- **Backend**: Node.js + Express + BullMQ (background jobs)
- **DB**: PostgreSQL (RDS) with JSONB + GIN indexes + optimistic locking
- **Cache**: Redis (ElastiCache) — matrix cache + BullMQ queue
- **Storage**: Google Drive API (direct upload, server doesn't proxy files)
- **Auth**: Google Workspace OAuth + JWT in HttpOnly cookies
- **Deploy**: AWS (RDS + ElastiCache + EC2/ECS + S3 + CloudFront)

## Workflow Patterns
1. **Pattern 1 (Approval Only)**: PC Take-out, Leave Request → Draft → A1 → A2 → Approved
2. **Pattern 2 (Settlement Only)**: Daily transport expense → Draft → Pending Settlement → Settled
3. **Pattern 3 (Approval + Settlement)**: Business Trip → Draft → A1 → A2 → Approved → Receipt upload → A1 → Dept Approval → 総務 → 専務/社長 → 経費精算

## Approval Routes
Admin-configured per template + department. Users do NOT pick approvers — system applies predetermined route.

## Folder Structure
```
backend/
  src/
    config/        # DB, Redis, Google API
    controllers/   # Request handlers
    middlewares/   # Auth, RBAC, error handling
    routes/        # Express routes
    services/      # Business logic (workflow engine, cache, etc.)
    workers/       # BullMQ background jobs
    models/        # Data access layer
  migrations/      # SQL schema migrations
  scripts/         # Seed data, utilities

frontend/
  src/
    components/
      common/      # Layout, sidebar, buttons, modals
      forms/       # DynamicForm, StandardInput
      workflow/    # Approval timeline UI
    pages/         # Dashboards, application pages, admin
    hooks/         # useAuth, useApplication
    services/      # apiClient, gdriveClient
    context/       # AuthContext

docs/              # API reference, deployment guides
```

## Development
```bash
# Backend
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

## Local Prerequisites
- Node.js 20+
- PostgreSQL 15+ (or connect to RDS)
- Redis 7+ (or connect to ElastiCache)
