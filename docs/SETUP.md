# RINGO Setup — Local E2E Test (Business Trip Workflow)

## Prerequisites
- Node.js 20+
- PostgreSQL 15+ running locally (or AWS RDS endpoint)
- Redis 7+ (optional for now — only needed for cache + BullMQ later)

## 1. PostgreSQL setup

Create database + user:
```sql
CREATE USER ringo_user WITH PASSWORD 'changeme_local';
CREATE DATABASE ringo_dev OWNER ringo_user;
GRANT ALL PRIVILEGES ON DATABASE ringo_dev TO ringo_user;
```

Connect to `ringo_dev` and enable required extensions:
```sql
\c ringo_dev
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
```

## 2. Backend env

```bash
cd backend
cp .env.example .env
```

Edit `.env` — at minimum set:
```
PGHOST=localhost
PGPORT=5432
PGUSER=ringo_user
PGPASSWORD=changeme_local
PGDATABASE=ringo_dev
JWT_SECRET=any_random_string_for_dev
```

## 3. Install + migrate + seed

```bash
cd backend
npm install
npm run migrate    # applies migrations/001_initial_schema.sql
npm run seed       # inserts BUSINESS_TRIP template + departments + users + routes
```

After seed you should have:
- 5 departments (総務, 健保, 美容, DX人材, 経理)
- 8 users (1 employee, 1 manager, 1 GM, 総務, 専務, 社長, 経理, admin)
- BUSINESS_TRIP template with full schema + settlement_schema
- Predetermined approval routes (RINGI: 2 steps, SETTLEMENT: 5 steps)

## 4. Start backend

```bash
cd backend
npm run dev
```
Backend listens on http://localhost:3000. Sanity check:
```
curl http://localhost:3000/health
curl http://localhost:3000/api/templates/BUSINESS_TRIP
```

## 5. Start frontend

```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173.

## 6. Test the Business Trip workflow

1. Dashboard loads at `/dashboard` — you see template grid
2. Click **出張伺い** card → navigates to `/applications/new/BUSINESS_TRIP`
3. Form auto-renders from JSONB schema (出張先, 開始日, 終了日, 出張目的, 予定金額, 交通手段)
4. Fill required fields, click **申請** — alert confirms save, status set to PENDING_APPROVAL
5. Click **承認待ち** in sidebar → list of pending applications
6. Click **承認する** on the row — backend issues `application_number` (e.g. `RNG-2026-000001`) and marks APPROVED
7. Go back to 承認待ち — the row disappears (no longer pending)

This satisfies the top half of the workflow image: User → submit → approval → 申請番号自動発行.

## What's not yet wired (next phases)
- **Auth**: backend POST currently picks first user from DB as applicant (no real login). Frontend has Google login button but OAuth flow not implemented.
- **Multi-step approval chain**: current approve endpoint moves PENDING → APPROVED in one shot. Real chain (Approver1 → Approver2 → ...) using `approval_route_steps` is next.
- **Settlement phase**: bottom half of workflow image. After ringi APPROVED, user creates settlement, receipts upload to Drive, route through 5 settlement steps to 経理.
- **Admin UI**: edit `approval_routes` per template/department.

## Common issues
- `extension "pgcrypto" does not exist` → run as superuser: `CREATE EXTENSION pgcrypto;`
- `connection refused` → check Postgres is running and `.env` PGHOST/PGPORT match
- `relation "form_templates" does not exist` → migration didn't run; re-run `npm run migrate`
- Template returns 404 → seed didn't run; check `SELECT * FROM form_templates;`
