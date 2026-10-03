-- Run after SQLx migrations. All fixtures are rolled back, including on failure
-- when psql exits with ON_ERROR_STOP; no application sessions are touched.
BEGIN;
DO $check$
DECLARE
    route text;
BEGIN
    FOREACH route IN ARRAY ARRAY[
        'route-check', 'easa/route-check', 'no-easa/route-check',
        'instructor/route-check', 'route-123-check'
    ] LOOP
        INSERT INTO courses (id, name, slug)
            VALUES (gen_random_uuid(), 'Route validation', route);
    END LOOP;

    FOREACH route IN ARRAY ARRAY[
        '', ' ', 'Uppercase', '../course', 'unknown/course', 'easa/',
        'easa/course/extra', '/course', 'course/', 'course--name',
        '-course', 'course-', 'course?query', 'course#fragment'
    ] LOOP
        BEGIN
            INSERT INTO courses (id, name, slug)
                VALUES (gen_random_uuid(), 'Invalid route validation', route);
            RAISE EXCEPTION 'Invalid course route accepted: %', route;
        EXCEPTION WHEN check_violation THEN
            IF SQLERRM NOT LIKE '%courses_public_slug_check%' THEN
                RAISE;
            END IF;
        END;
    END LOOP;

    BEGIN
        INSERT INTO courses (id, name, slug)
            VALUES (gen_random_uuid(), 'Duplicate route validation', 'route-check');
        RAISE EXCEPTION 'Duplicate course route accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
END;
$check$;
ROLLBACK;
