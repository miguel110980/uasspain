ALTER TABLE courses
    ADD COLUMN modality VARCHAR(16) NOT NULL DEFAULT 'online'
        CHECK (modality IN ('online', 'presencial')),
    ADD COLUMN duration VARCHAR(120) NOT NULL DEFAULT ''
        CHECK (duration = btrim(duration));

-- Preserve existing content and stable URLs. Legacy description/sections and
-- managed covers remain readable; the admin editor consolidates content on save.
