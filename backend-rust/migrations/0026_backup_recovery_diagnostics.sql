-- Preserve existing results and allow a safe, useful diagnostic on failure.
-- The legacy varchar(20) masked recovery errors with a second SQL error.
ALTER TABLE public.backups_backupjob ALTER COLUMN restore_test_result TYPE text;
