-- The server owns the clock, question snapshot and single submission of an exam.
CREATE TABLE examenes_intento (
    id uuid PRIMARY KEY,
    alumno_id uuid NOT NULL REFERENCES accounts_userprofile(id) ON DELETE CASCADE,
    examen_id uuid NOT NULL REFERENCES examenes_examen(id) ON DELETE CASCADE,
    modalidad text NOT NULL CHECK (modalidad IN ('libre', 'tiempo')),
    started_at timestamptz NOT NULL DEFAULT NOW(),
    expires_at timestamptz,
    preguntas jsonb NOT NULL CHECK (jsonb_typeof(preguntas) = 'array'),
    respuestas jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(respuestas) = 'object'),
    submitted_at timestamptz,
    result_id uuid REFERENCES examenes_resultadoexamen(id) ON DELETE SET NULL,
    CHECK ((modalidad = 'tiempo') = (expires_at IS NOT NULL)),
    CHECK (expires_at IS NULL OR expires_at > started_at)
);
CREATE UNIQUE INDEX examenes_intento_active
    ON examenes_intento (alumno_id, examen_id, modalidad) WHERE submitted_at IS NULL;
