-- Recovery-chain metadata is kept in PostgreSQL as well as in the signed-by-
-- checksum sidecar manifest.  RESTRICT prevents deleting a parent while an
-- incremental recovery point still depends on it.
ALTER TABLE public.backups_backupjob
    ADD COLUMN parent_backup_id uuid,
    ADD COLUMN base_full_id uuid,
    ADD COLUMN chain_index integer NOT NULL DEFAULT 0,
    ADD COLUMN manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN manifest_checksum character varying(128) NOT NULL DEFAULT '',
    ADD COLUMN manifest_path character varying(500) NOT NULL DEFAULT '',
    ADD COLUMN backup_format_version integer NOT NULL DEFAULT 1,
    ADD COLUMN encryption_key_id character varying(64) NOT NULL DEFAULT '';

ALTER TABLE public.backups_backupjob
    ADD CONSTRAINT backups_backupjob_parent_fk
        FOREIGN KEY (parent_backup_id)
        REFERENCES public.backups_backupjob(id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT backups_backupjob_base_full_fk
        FOREIGN KEY (base_full_id)
        REFERENCES public.backups_backupjob(id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT backups_backupjob_chain_index_check
        CHECK (chain_index >= 0),
    ADD CONSTRAINT backups_backupjob_format_version_check
        CHECK (backup_format_version > 0),
    ADD CONSTRAINT backups_backupjob_chain_shape_check
        CHECK (
            (job_type = 'full' AND parent_backup_id IS NULL AND chain_index = 0)
            OR
            (job_type <> 'full')
        );

CREATE INDEX backups_backupjob_parent_idx
    ON public.backups_backupjob(parent_backup_id);
CREATE INDEX backups_backupjob_base_full_idx
    ON public.backups_backupjob(base_full_id);
