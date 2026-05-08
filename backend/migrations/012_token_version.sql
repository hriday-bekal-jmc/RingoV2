-- 012_token_version.sql
-- Adds a per-user token version counter. Existing JWTs become invalid the
-- moment this value is bumped — used to revoke sessions when:
--   - a user is disabled (is_active=false)
--   - role/department changes (privilege escalation/demotion)
--   - explicit logout-everywhere
--
-- The auth middleware reads this column (cached in Redis for ~60s) and
-- rejects tokens whose embedded `tv` does not match.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
