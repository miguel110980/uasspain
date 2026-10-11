-- Keep an inventory of verified content images, including replaced covers.
-- A reused resource survives removal of the original content block.
CREATE TABLE content_image_resources (
    id UUID PRIMARY KEY,
    file_url VARCHAR(600) NOT NULL UNIQUE,
    storage_path VARCHAR(500) NOT NULL UNIQUE,
    content_type VARCHAR(64),
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes > 0),
    created_by UUID REFERENCES accounts_userprofile(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO content_image_resources(id,file_url,storage_path,content_type,size_bytes,created_at)
SELECT id,file_url,storage_path,content_type,size_bytes,created_at FROM blog_post_images
ON CONFLICT DO NOTHING;
INSERT INTO content_image_resources(id,file_url,storage_path,created_at)
SELECT md5('uasspain-image:'||cover_image_url)::uuid,cover_image_url,cover_image_path,created_at
FROM courses WHERE cover_image_url<>'' AND cover_image_path<>'' ON CONFLICT DO NOTHING;
ALTER TABLE services ADD COLUMN image_resource_id UUID REFERENCES content_image_resources(id) ON DELETE RESTRICT;
CREATE INDEX services_image_resource_idx ON services(image_resource_id) WHERE image_resource_id IS NOT NULL;
