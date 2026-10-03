ALTER TABLE accounts_userprofile ADD COLUMN active_window_lookup TEXT NOT NULL DEFAULT '';

CREATE TABLE core_systemsecret (
    id UUID PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    ciphertext TEXT NOT NULL CHECK (ciphertext LIKE 'v1:%'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep existing legacy destinations intact; the new named slots are exclusive.
CREATE UNIQUE INDEX backups_backupserver_named_role_unique
    ON backups_backupserver(role) WHERE role IN ('local','external_1','external_2');
