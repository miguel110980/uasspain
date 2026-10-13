-- Expand only. Existing SMTP settings/secrets and pending authentication records
-- remain untouched. Contact and authentication share a durable encrypted outbox.
CREATE TABLE mail_outbox (
    id uuid PRIMARY KEY,
    message_type text NOT NULL,
    provider text NOT NULL CHECK (provider IN ('smtp','postmark','isolated')),
    payload_ciphertext text NOT NULL CHECK (payload_ciphertext LIKE 'v1:%'),
    idempotency_key text NOT NULL UNIQUE,
    state text NOT NULL CHECK (state IN ('PENDING','PROCESSING','ACCEPTED','DELIVERED','FAILED','RETRY_SCHEDULED','EXPIRED','UNKNOWN')),
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
    lease_until timestamptz,
    external_id uuid,
    last_error text NOT NULL DEFAULT '',
    provider_latency_ms bigint,
    delivery_evidence jsonb,
    validity jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX mail_outbox_ready ON mail_outbox(next_attempt_at) WHERE state IN ('PENDING','RETRY_SCHEDULED');
CREATE INDEX mail_outbox_state ON mail_outbox(state,created_at);

CREATE TABLE mail_circuit (
    provider text PRIMARY KEY CHECK (provider IN ('smtp','postmark')),
    state text NOT NULL DEFAULT 'CLOSED' CHECK (state IN ('CLOSED','OPEN','HALF_OPEN')),
    failures integer NOT NULL DEFAULT 0,
    opened_at timestamptz,
    checked_at timestamptz,
    last_error text NOT NULL DEFAULT ''
);
INSERT INTO mail_circuit(provider) VALUES ('smtp'),('postmark');

CREATE TABLE mail_migration (
    id uuid PRIMARY KEY,
    attempt_id uuid NOT NULL,
    state text NOT NULL DEFAULT 'NOT_STARTED',
    last_passed text NOT NULL DEFAULT 'NOT_STARTED',
    version bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX mail_migration_singleton ON mail_migration ((true));
CREATE TABLE mail_migration_transition (
    id uuid PRIMARY KEY,
    migration_id uuid NOT NULL REFERENCES mail_migration(id),
    attempt_id uuid NOT NULL,
    previous_state text NOT NULL,
    new_state text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    software_version text NOT NULL,
    schema_version bigint NOT NULL,
    actor_id uuid,
    evidence jsonb NOT NULL,
    error_code text NOT NULL DEFAULT '',
    corrective_action text NOT NULL DEFAULT '',
    last_passed text NOT NULL
);
