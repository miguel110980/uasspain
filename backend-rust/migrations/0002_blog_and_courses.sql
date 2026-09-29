CREATE TABLE blog_posts (
    id UUID PRIMARY KEY,
    title VARCHAR(180) NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_by UUID REFERENCES accounts_userprofile(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    CONSTRAINT blog_posts_body_not_blank CHECK (length(btrim(body)) > 0)
);

CREATE INDEX blog_posts_public_order_idx
    ON blog_posts (status, sort_order, published_at DESC, created_at DESC);

CREATE TABLE blog_post_images (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    storage_path VARCHAR(500) NOT NULL UNIQUE,
    file_url VARCHAR(600) NOT NULL,
    alt_text VARCHAR(240) NOT NULL DEFAULT '',
    content_type VARCHAR(64) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX blog_post_images_post_order_idx
    ON blog_post_images (post_id, sort_order, created_at);

CREATE TABLE courses (
    id UUID PRIMARY KEY,
    name VARCHAR(180) NOT NULL,
    slug VARCHAR(180) NOT NULL UNIQUE,
    short_description VARCHAR(320) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    introduction TEXT NOT NULL DEFAULT '',
    syllabus TEXT NOT NULL DEFAULT '',
    cover_image_url VARCHAR(600) NOT NULL DEFAULT '',
    cover_image_path VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'published')),
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_by UUID REFERENCES accounts_userprofile(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    CONSTRAINT courses_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX courses_public_order_idx ON courses (sort_order, name);

CREATE TABLE course_sections (
    id UUID PRIMARY KEY,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(180) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT course_sections_title_not_blank CHECK (length(btrim(title)) > 0)
);

CREATE INDEX course_sections_course_order_idx
    ON course_sections (course_id, sort_order, created_at);
