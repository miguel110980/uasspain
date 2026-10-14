-- Expand only. Existing users, Google subject bindings and mail settings stay intact.
CREATE TABLE google_oauth_flow (
    id uuid PRIMARY KEY,
    state_lookup varchar(64) NOT NULL UNIQUE,
    cookie_lookup varchar(64) NOT NULL,
    window_lookup varchar(64) NOT NULL,
    purpose varchar(12) NOT NULL CHECK (purpose IN ('login','verify','link')),
    profile_id uuid REFERENCES accounts_userprofile(id),
    config_revision bigint NOT NULL,
    payload_ciphertext text NOT NULL CHECK (payload_ciphertext LIKE 'v1:%'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    result varchar(24) NOT NULL DEFAULT 'PENDING',
    CHECK ((purpose='login') = (profile_id IS NULL))
);
CREATE INDEX google_oauth_flow_expiry ON google_oauth_flow(expires_at) WHERE consumed_at IS NULL;

-- Immutable security evidence retains actor IDs even when a synthetic fixture
-- or an account is deleted through an independent authorised procedure.
CREATE TABLE google_oauth_event (
    id uuid PRIMARY KEY,
    actor_id uuid,
    operation text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    context jsonb NOT NULL
);
CREATE INDEX google_oauth_event_order ON google_oauth_event(created_at DESC, id);
