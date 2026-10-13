-- Additive expansion. Blocking, verification and voluntary deactivation remain
-- different states. No existing profile, role, session or academic row is changed.
CREATE TABLE account_lifecycle (
    profile_id uuid PRIMARY KEY REFERENCES accounts_userprofile(id) ON DELETE CASCADE,
    deactivated_at timestamptz,
    deactivated_by uuid,
    deactivation_type text CHECK (deactivation_type IN ('voluntary','administrative')),
    previous_status text,
    reactivated_at timestamptz,
    reactivated_by uuid,
    revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE account_lifecycle_event (
    id uuid PRIMARY KEY,
    profile_id uuid NOT NULL,
    actor_id uuid,
    operation text NOT NULL,
    result text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    correlation_id uuid NOT NULL,
    context jsonb NOT NULL DEFAULT '{}',
    request_id uuid,
    UNIQUE(profile_id, request_id)
);
CREATE INDEX account_event_profile_time ON account_lifecycle_event(profile_id,created_at DESC,id);
-- The notice records intent only; actual delivery uses the existing mail outbox.
CREATE TABLE account_notice (
    event_id uuid PRIMARY KEY REFERENCES account_lifecycle_event(id),
    recipient_ciphertext text NOT NULL,
    mail_id uuid REFERENCES mail_outbox(id) ON DELETE SET NULL,
    queued_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT NOW(),
    last_error text NOT NULL DEFAULT ''
);
CREATE TABLE student_membership (
    profile_id uuid PRIMARY KEY REFERENCES accounts_userprofile(id) ON DELETE CASCADE,
    account_registered_at timestamptz NOT NULL,
    current_member boolean NOT NULL,
    evidence text NOT NULL,
    observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    indexed_source text
);
INSERT INTO student_membership(profile_id,account_registered_at,current_member,evidence)
SELECT p.id,p.created_date,(p.role='alumno' OR p.roles ? 'alumno'),
    CASE WHEN p.role='alumno' OR p.roles ? 'alumno' THEN 'existing_role' ELSE 'existing_academic_record' END
FROM accounts_userprofile p
WHERE p.role='alumno' OR p.roles ? 'alumno'
   OR EXISTS(SELECT 1 FROM examenes_resultadoexamen r WHERE r.alumno_id=p.id)
   OR EXISTS(SELECT 1 FROM examenes_resultadopractico r WHERE r.alumno_id=p.id)
   OR EXISTS(SELECT 1 FROM examenes_intento r WHERE r.alumno_id=p.id)
   OR EXISTS(SELECT 1 FROM materiales_materialcompletado r WHERE r.alumno_id=p.id);

CREATE FUNCTION maintain_student_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.role='alumno' OR NEW.roles ? 'alumno' THEN
        INSERT INTO student_membership(profile_id,account_registered_at,current_member,evidence)
        VALUES(NEW.id,NEW.created_date,true,'observed_role')
        ON CONFLICT(profile_id) DO UPDATE SET current_member=true;
    ELSE
        UPDATE student_membership SET current_member=false WHERE profile_id=NEW.id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER preserve_student_membership AFTER INSERT OR UPDATE OF role,roles ON accounts_userprofile
FOR EACH ROW EXECUTE FUNCTION maintain_student_membership();

-- No legacy enrollment relation exists. This starts empty: neither an exam
-- category nor a public course is evidence of a student's enrollment.
CREATE TABLE student_course_registration (
    profile_id uuid NOT NULL REFERENCES student_membership(profile_id) ON DELETE CASCADE,
    course_id uuid NOT NULL REFERENCES courses(id),
    registered_at timestamptz NOT NULL,
    ended_at timestamptz,
    PRIMARY KEY(profile_id,course_id),
    CHECK(ended_at IS NULL OR ended_at>=registered_at)
);
CREATE INDEX student_registration_course ON student_course_registration(course_id,profile_id);

-- Blind search tokens index encrypted PII without persisting clear names/emails.
CREATE TABLE student_search_token (
    profile_id uuid NOT NULL REFERENCES student_membership(profile_id) ON DELETE CASCADE,
    token text NOT NULL,
    PRIMARY KEY(token,profile_id)
);
CREATE FUNCTION invalidate_student_search() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE student_membership SET indexed_source=NULL WHERE profile_id=NEW.id;
    RETURN NEW;
END $$;
CREATE TRIGGER invalidate_student_search AFTER UPDATE OF nombre,apellidos,email ON accounts_userprofile
FOR EACH ROW EXECUTE FUNCTION invalidate_student_search();
