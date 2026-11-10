-- Keep ownership after account removal; never reassign an existing private path.
CREATE TABLE upload_ownership (
    storage_path TEXT PRIMARY KEY,
    owner_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX upload_ownership_owner ON upload_ownership(owner_id);
