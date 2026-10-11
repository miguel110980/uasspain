-- Revisions and notices commit atomically with their content. Notices only
-- identify a collection and revision; they contain no draft or private fields.
ALTER TABLE blog_posts ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE courses ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE services ADD COLUMN version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE courses DROP CONSTRAINT courses_status_check;
ALTER TABLE courses ADD CONSTRAINT courses_status_check CHECK (status IN ('upcoming','draft','published','deleted'));
ALTER TABLE blog_posts DROP CONSTRAINT blog_posts_status_check;
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check CHECK (status IN ('draft','published','deleted'));
CREATE TABLE content_revisions (
    kind TEXT PRIMARY KEY CHECK (kind IN ('posts','courses','services')),
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO content_revisions(kind) VALUES ('posts'),('courses'),('services');
CREATE TABLE content_outbox (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL REFERENCES content_revisions(kind),
    revision BIGINT NOT NULL,
    entity_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(kind,revision)
);
CREATE FUNCTION content_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.version := OLD.version+1; NEW.updated_at := NOW(); RETURN NEW; END;
$$;
CREATE FUNCTION content_notice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision BIGINT;
BEGIN
    UPDATE content_revisions SET revision=revision+1 WHERE kind=TG_ARGV[0] RETURNING revision INTO current_revision;
    INSERT INTO content_outbox(kind,revision,entity_id) VALUES(TG_ARGV[0],current_revision,COALESCE(NEW.id,OLD.id));
    RETURN NULL;
END;
$$;
CREATE FUNCTION content_child_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME='blog_post_images' THEN
        UPDATE blog_posts SET updated_at=NOW() WHERE id=COALESCE(NEW.post_id,OLD.post_id);
    ELSE
        UPDATE courses SET updated_at=NOW() WHERE id=COALESCE(NEW.course_id,OLD.course_id);
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER blog_posts_version BEFORE UPDATE ON blog_posts FOR EACH ROW EXECUTE FUNCTION content_row_version();
CREATE TRIGGER courses_version BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION content_row_version();
CREATE TRIGGER services_version BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION content_row_version();
CREATE TRIGGER blog_posts_notice AFTER INSERT OR UPDATE OR DELETE ON blog_posts FOR EACH ROW EXECUTE FUNCTION content_notice('posts');
CREATE TRIGGER courses_notice AFTER INSERT OR UPDATE OR DELETE ON courses FOR EACH ROW EXECUTE FUNCTION content_notice('courses');
CREATE TRIGGER services_notice AFTER INSERT OR UPDATE OR DELETE ON services FOR EACH ROW EXECUTE FUNCTION content_notice('services');
CREATE TRIGGER blog_images_notice AFTER INSERT OR UPDATE OR DELETE ON blog_post_images FOR EACH ROW EXECUTE FUNCTION content_child_changed();
CREATE TRIGGER course_sections_notice AFTER INSERT OR UPDATE OR DELETE ON course_sections FOR EACH ROW EXECUTE FUNCTION content_child_changed();
