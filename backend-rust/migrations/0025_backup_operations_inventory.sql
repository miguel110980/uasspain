-- The existing artifact catalogue and all chain foreign keys stay intact.
-- Operation history is independently dispensable; deleting it cannot cascade
-- into the catalogue or protected core_auditlog.
ALTER TABLE public.backups_backupjob
    ADD COLUMN duration_milliseconds bigint,
    ADD COLUMN replica_checks jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE public.backups_operation (
    id uuid PRIMARY KEY,
    backup_job_id uuid REFERENCES public.backups_backupjob(id) ON DELETE SET NULL,
    operation_type varchar(32) NOT NULL,
    destination varchar(100) NOT NULL DEFAULT '',
    status varchar(30) NOT NULL,
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    duration_milliseconds bigint CHECK (duration_milliseconds >= 0),
    message text NOT NULL DEFAULT '',
    details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX backups_operation_order_idx ON public.backups_operation(started_at DESC, id DESC);

-- Import only recorded operations, never manufacture artifacts from history.
INSERT INTO public.backups_operation
    (id,backup_job_id,operation_type,status,started_at,finished_at,duration_milliseconds,message,details)
SELECT id,id,'create',status,started_at,finished_at,
    CASE WHEN finished_at IS NOT NULL THEN GREATEST(0,(EXTRACT(EPOCH FROM finished_at-started_at)*1000)::bigint) END,
    CASE WHEN error='' THEN '' ELSE 'legacy_operation_error' END,
    jsonb_build_object('legacy',true,'backup_type',job_type)
FROM public.backups_backupjob;

CREATE FUNCTION public.record_backup_creation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        INSERT INTO public.backups_operation
            (id,backup_job_id,operation_type,status,started_at,finished_at,duration_milliseconds,details)
        VALUES (NEW.id,NEW.id,'create',NEW.status,NEW.started_at,NEW.finished_at,NEW.duration_milliseconds,
                jsonb_build_object('backup_type',NEW.job_type)) ON CONFLICT (id) DO NOTHING;
    ELSIF OLD.status='creating' AND NEW.status<>'creating' THEN
        NEW.duration_milliseconds := GREATEST(1,(EXTRACT(EPOCH FROM NEW.finished_at-NEW.started_at)*1000)::bigint);
        UPDATE public.backups_operation SET status=NEW.status,finished_at=NEW.finished_at,
            duration_milliseconds=NEW.duration_milliseconds,
            message=CASE WHEN NEW.error='' THEN '' ELSE 'destination_or_generation_failed' END
        WHERE id=NEW.id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER backup_creation_history_before_update BEFORE UPDATE ON public.backups_backupjob
    FOR EACH ROW EXECUTE FUNCTION public.record_backup_creation();
CREATE TRIGGER backup_creation_history_after_insert AFTER INSERT ON public.backups_backupjob
    FOR EACH ROW EXECUTE FUNCTION public.record_backup_creation();
