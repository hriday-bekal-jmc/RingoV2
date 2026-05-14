-- Migration 022: auth lookup indexes
--
-- Google OAuth login looks users up by stable Google subject first, then by
-- normalized email when linking an existing local account.

CREATE INDEX IF NOT EXISTS idx_users_google_oauth_sub_present
  ON users(google_oauth_sub)
  WHERE google_oauth_sub IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_lower_email
  ON users(lower(email));
