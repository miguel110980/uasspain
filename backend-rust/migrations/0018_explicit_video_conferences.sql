-- Private calls stay independent. Sharing a room requires an explicit
-- instructor conference invitation; historical records are preserved.
ALTER TABLE conexiones_videollamada
    ADD COLUMN is_conference boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT video_conference_channel_check CHECK (
        NOT is_conference OR (canal='alumnos' AND administrador_id IS NULL)
    );
