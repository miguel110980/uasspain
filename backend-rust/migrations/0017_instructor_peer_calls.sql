-- Existing classroom and administrator calls retain their participants and history.
ALTER TABLE conexiones_videollamada
    ADD COLUMN instructor_peer_id uuid REFERENCES accounts_userprofile(id) ON DELETE CASCADE,
    DROP CONSTRAINT video_channel_check,
    DROP CONSTRAINT video_participants_check,
    DROP CONSTRAINT video_moderator_check,
    DROP CONSTRAINT video_initiator_check;

ALTER TABLE conexiones_videollamada
    ADD CONSTRAINT video_channel_check CHECK (canal IN ('alumnos', 'administracion', 'instructores')),
    ADD CONSTRAINT video_participants_check CHECK (
        (canal = 'alumnos' AND instructor_peer_id IS NULL AND alumno_id IS NOT NULL
            AND alumno_id IS DISTINCT FROM instructor_id
            AND (administrador_id IS NULL OR (administrador_id <> alumno_id AND administrador_id IS DISTINCT FROM instructor_id)))
        OR (canal = 'administracion' AND instructor_peer_id IS NULL AND alumno_id IS NULL
            AND administrador_id IS NOT NULL AND instructor_id IS NOT NULL AND administrador_id <> instructor_id)
        OR (canal = 'instructores' AND alumno_id IS NULL AND administrador_id IS NULL
            AND instructor_id IS NOT NULL AND instructor_peer_id IS NOT NULL AND instructor_id < instructor_peer_id)
    ),
    ADD CONSTRAINT video_moderator_check CHECK (
        moderador_id IS NULL OR COALESCE(moderador_id = instructor_id, false)
            OR COALESCE(moderador_id = administrador_id, false) OR COALESCE(moderador_id = instructor_peer_id, false)
    ),
    ADD CONSTRAINT video_initiator_check CHECK (
        iniciador_id IS NULL OR COALESCE(iniciador_id = alumno_id, false) OR COALESCE(iniciador_id = instructor_id, false)
            OR COALESCE(iniciador_id = administrador_id, false) OR COALESCE(iniciador_id = instructor_peer_id, false)
    );

CREATE INDEX video_instructor_peer_state_idx ON conexiones_videollamada(instructor_peer_id, estado)
    WHERE canal = 'instructores';
