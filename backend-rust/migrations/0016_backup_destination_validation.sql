-- Keep existing destinations, schedules and recovery chains. New activation
-- requires a successful write/read/delete probe of the current configuration.
ALTER TABLE public.backups_backupserver
    ADD COLUMN configuration_updated_at timestamptz NOT NULL DEFAULT NOW(),
    ADD COLUMN connection_checked_at timestamptz,
    ADD COLUMN connection_ok boolean NOT NULL DEFAULT FALSE;

ALTER TABLE public.backups_backupserver
    ADD CONSTRAINT backups_destination_probe_check
    CHECK (NOT connection_ok OR connection_checked_at IS NOT NULL);

CREATE INDEX backups_backupjob_history_idx
    ON public.backups_backupjob (created_date DESC, id DESC);

-- New installs and compatible existing policies expose one retention value.
-- Preserve distinct legacy policies until the administrator explicitly saves.
UPDATE public.backups_backupconfig
SET value = value || jsonb_build_object(
    'retention_days', COALESCE(value->'retention_incremental', value->'retention_full', '30'::jsonb),
    'retention_policy', CASE
        WHEN COALESCE(value->'retention_full', '4'::jsonb)
           = COALESCE(value->'retention_incremental', '30'::jsonb) THEN 'unified'
        ELSE 'legacy'
    END)
WHERE key = 'backups' AND NOT (value ? 'retention_days');
