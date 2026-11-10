CREATE TABLE registration_avatar_upload (
    ticket_lookup TEXT PRIMARY KEY CHECK (length(ticket_lookup)=64),
    storage_path TEXT NOT NULL UNIQUE,
    requester_lookup TEXT NOT NULL CHECK (length(requester_lookup)=64),
    byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '30 minutes',
    owner_id UUID,
    consumed_at TIMESTAMPTZ,
    CHECK ((owner_id IS NULL)=(consumed_at IS NULL))
);
CREATE INDEX registration_avatar_requester ON registration_avatar_upload(requester_lookup,created_at);
CREATE INDEX registration_avatar_expiry ON registration_avatar_upload(expires_at) WHERE owner_id IS NULL;
