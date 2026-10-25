-- Expand only: no queued message, setting or credential is altered.
-- Operational application is not authorized in this task.
ALTER TABLE mail_circuit DROP CONSTRAINT mail_circuit_provider_check;
ALTER TABLE mail_circuit ADD CONSTRAINT mail_circuit_provider_check
CHECK (provider IN ('smtp','postmark','smtp_contact','smtp_automatic'));
