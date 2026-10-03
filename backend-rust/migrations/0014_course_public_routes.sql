-- Each course owns one stable public route, used by its catalog card and the
-- shared page template in both upcoming and published states. Match the Rust
-- slug validator, including the three existing legacy route prefixes.
-- Existing content, publication state and URLs are preserved.
ALTER TABLE courses
    ADD CONSTRAINT courses_public_slug_check
        CHECK (slug ~ '^(?:(?:easa|no-easa|instructor)/)?[a-z0-9]+(?:-[a-z0-9]+)*$');

COMMENT ON COLUMN courses.slug IS
    'Unique public route for the catalog card and shared course page; independent of publication status.';
