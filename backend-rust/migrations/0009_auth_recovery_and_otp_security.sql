-- Extend the legacy schema without replacing historical migrations or users.
ALTER TABLE accounts_userprofile
    ADD COLUMN otp_created_at TIMESTAMPTZ,
    ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0 CHECK (otp_attempts BETWEEN 0 AND 5),
    ADD COLUMN active_refresh_jti TEXT NOT NULL DEFAULT '';

-- Previously issued registration codes had no provable expiry. Require resend.
UPDATE accounts_userprofile SET otp_hash = '' WHERE NOT otp_verified;

CREATE TABLE accounts_passwordresettoken (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    credential_hash TEXT NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    CHECK (expires_at > created_at),
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE INDEX accounts_passwordresettoken_user_pending_idx
    ON accounts_passwordresettoken(user_id, expires_at) WHERE consumed_at IS NULL;
