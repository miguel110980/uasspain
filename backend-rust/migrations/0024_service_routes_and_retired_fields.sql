-- Archive the two retired values before removing them from the live contract.
-- No service, description, image, publication or independent map is deleted.
CREATE TABLE service_retired_fields (
    service_id UUID PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
    coordinate VARCHAR(80) NOT NULL,
    action_href VARCHAR(600) NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO service_retired_fields(service_id,coordinate,action_href)
SELECT id,coordinate,action_href FROM services;
ALTER TABLE services DROP COLUMN coordinate, DROP COLUMN action_href;

-- Canonical and historic slugs share one unique namespace, including tombstones.
CREATE TABLE service_routes (
    slug VARCHAR(180) PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE
);
CREATE INDEX service_routes_service_idx ON service_routes(service_id);
INSERT INTO service_routes(slug,service_id) SELECT slug,id FROM services;

CREATE FUNCTION reserve_service_route() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO service_routes(slug,service_id) VALUES(NEW.slug,NEW.id)
    ON CONFLICT (slug) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM service_routes WHERE slug=NEW.slug AND service_id=NEW.id) THEN
        RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='Service route already reserved';
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER services_reserve_route AFTER INSERT OR UPDATE OF slug ON services
FOR EACH ROW EXECUTE FUNCTION reserve_service_route();

-- NOT VALID preserves historical records; all future writes enforce the limit.
ALTER TABLE services ADD CONSTRAINT services_description_length
CHECK (length(description) <= 100000) NOT VALID;

ALTER TABLE services ADD CONSTRAINT services_icon_catalog
CHECK (icon IN ('Shield', 'Siren', 'Radio', 'Camera', 'SprayCan', 'ScanLine', 'Thermometer', 'CheckCircle', 'ArrowRight', 'ChevronLeft', 'Sprout', 'Tractor', 'Leaf', 'Bug', 'Droplets', 'Map', 'Trees', 'Wheat', 'Search', 'LifeBuoy', 'Eye', 'ShieldCheck', 'Flame', 'FireExtinguisher', 'Moon', 'Crosshair', 'MapPin', 'Layers', 'Compass', 'Box', 'Scan', 'Mountain', 'Ruler', 'Globe', 'Factory', 'Building2', 'Zap', 'Sun', 'Wind', 'House', 'PanelsTopLeft', 'Cable', 'Route', 'TowerControl', 'Pipette', 'Anchor', 'Bird', 'Waves', 'Recycle', 'Cloud', 'Fish', 'Flower2', 'Heart', 'Image', 'Video', 'Clapperboard', 'Calendar', 'Megaphone', 'Plane', 'Bike', 'Film', 'Tv', 'Package', 'Truck', 'Navigation', 'Bot', 'TrafficCone', 'Construction', 'Ship', 'Satellite', 'Cpu', 'Radar')) NOT VALID;
