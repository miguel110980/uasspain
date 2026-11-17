-- Preparation only: applying this migration requires production approval.
ALTER TABLE examenes_examen
    ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 2400 CHECK (duration_seconds BETWEEN 1 AND 86400),
    ADD COLUMN passing_percent INTEGER NOT NULL DEFAULT 75 CHECK (passing_percent BETWEEN 1 AND 100);
UPDATE examenes_examen SET duration_seconds=1800 WHERE categoria='A2';

ALTER TABLE examenes_intento
    ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 2400 CHECK (duration_seconds BETWEEN 1 AND 86400),
    ADD COLUMN passing_percent INTEGER NOT NULL DEFAULT 75 CHECK (passing_percent BETWEEN 1 AND 100),
    ADD COLUMN answer_revision BIGINT NOT NULL DEFAULT 0 CHECK (answer_revision>=0);
-- Preserve the actual duration and deadline of existing attempts.
UPDATE examenes_intento SET duration_seconds=LEAST(86400,GREATEST(1,EXTRACT(EPOCH FROM expires_at-started_at)::INTEGER))
WHERE expires_at IS NOT NULL;
