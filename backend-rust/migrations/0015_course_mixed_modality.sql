-- Extend the existing course model without rewriting any course or public URL.
-- The canonical mixed value has 17 characters, so preserve all existing values
-- while widening the column before updating its whitelist.
ALTER TABLE courses
    DROP CONSTRAINT courses_modality_check,
    ALTER COLUMN modality TYPE VARCHAR(24),
    ADD CONSTRAINT courses_modality_check
        CHECK (modality IN ('online', 'presencial', 'presencial_online'));

COMMENT ON COLUMN courses.modality IS
    'Course delivery: online, presencial or presencial_online (Presencial/Online).';
