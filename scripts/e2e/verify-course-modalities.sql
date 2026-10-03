-- Validate the migrated PostgreSQL whitelist without retaining test data.
BEGIN;
DO $check$
DECLARE
    mode text;
    course_id uuid;
BEGIN
    FOREACH mode IN ARRAY ARRAY['online', 'presencial', 'presencial_online'] LOOP
        course_id := gen_random_uuid();
        INSERT INTO courses (id, name, slug, modality)
            VALUES (course_id, 'Modality validation', 'modality-check-' || course_id, mode);
        UPDATE courses SET modality = 'presencial_online' WHERE id = course_id;
        IF (SELECT modality FROM courses WHERE id = course_id) <> 'presencial_online' THEN
            RAISE EXCEPTION 'Mixed modality did not persist';
        END IF;
    END LOOP;
    FOREACH mode IN ARRAY ARRAY['', 'hybrid', 'mixta', 'Presencial/Online', 'presencial/online'] LOOP
        BEGIN
            course_id := gen_random_uuid();
            INSERT INTO courses (id, name, slug, modality)
                VALUES (course_id, 'Invalid modality validation', 'modality-check-' || course_id, mode);
            RAISE EXCEPTION 'Invalid modality accepted: %', mode;
        EXCEPTION WHEN check_violation THEN
            IF SQLERRM NOT LIKE '%courses_modality_check%' THEN RAISE; END IF;
        END;
    END LOOP;
END;
$check$;
ROLLBACK;
