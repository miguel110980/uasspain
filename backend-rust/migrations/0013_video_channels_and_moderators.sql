-- Preserve the existing classroom model and add separate staff calls.
-- Calls require both participants; deleting an instructor also removes their calls.
ALTER TABLE conexiones_videollamada
    DROP CONSTRAINT conexiones_videollam_instructor_id_836e78f0_fk_accounts_,
    ADD CONSTRAINT conexiones_videollam_instructor_id_836e78f0_fk_accounts_
        FOREIGN KEY (instructor_id) REFERENCES accounts_userprofile(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE conexiones_videollamada
    ALTER COLUMN alumno_id DROP NOT NULL,
    ADD COLUMN canal text NOT NULL DEFAULT 'alumnos',
    ADD COLUMN administrador_id uuid REFERENCES accounts_userprofile(id) ON DELETE CASCADE,
    ADD COLUMN iniciador_id uuid REFERENCES accounts_userprofile(id) ON DELETE CASCADE,
    ADD COLUMN moderador_id uuid REFERENCES accounts_userprofile(id) ON DELETE CASCADE;

UPDATE conexiones_videollamada
SET iniciador_id = CASE WHEN iniciada_por = 'alumno' THEN alumno_id ELSE instructor_id END,
    moderador_id = instructor_id;

-- An old call with a deleted instructor is historical, never joinable.
UPDATE conexiones_videollamada SET estado = 'finalizada', fecha_fin = COALESCE(fecha_fin, NOW())
WHERE instructor_id IS NULL;

ALTER TABLE conexiones_videollamada
    ADD CONSTRAINT video_channel_check CHECK (canal IN ('alumnos', 'administracion')),
    ADD CONSTRAINT video_participants_check CHECK (
        (canal = 'alumnos' AND alumno_id IS NOT NULL AND alumno_id IS DISTINCT FROM instructor_id
            AND (administrador_id IS NULL OR (administrador_id <> alumno_id AND administrador_id IS DISTINCT FROM instructor_id)))
        OR (canal = 'administracion' AND alumno_id IS NULL AND administrador_id IS NOT NULL
            AND instructor_id IS NOT NULL AND administrador_id <> instructor_id)
    ),
    ADD CONSTRAINT video_moderator_check CHECK (
        moderador_id IS NULL OR COALESCE(moderador_id = instructor_id, false) OR COALESCE(moderador_id = administrador_id, false)
    ),
    ADD CONSTRAINT video_initiator_check CHECK (
        iniciador_id IS NULL OR COALESCE(iniciador_id = alumno_id, false) OR COALESCE(iniciador_id = instructor_id, false) OR COALESCE(iniciador_id = administrador_id, false)
    ),
    ADD CONSTRAINT video_live_participants_check CHECK (
        estado NOT IN ('activa', 'pendiente') OR
        (instructor_id IS NOT NULL AND iniciador_id IS NOT NULL AND moderador_id IS NOT NULL)
    );

CREATE INDEX video_admin_channel_state_idx ON conexiones_videollamada(administrador_id, canal, estado);
CREATE INDEX video_instructor_channel_state_idx ON conexiones_videollamada(instructor_id, canal, estado);
CREATE INDEX video_room_state_idx ON conexiones_videollamada(room_id, estado);
