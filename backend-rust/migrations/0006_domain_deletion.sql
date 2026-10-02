-- PostgreSQL must enforce the deletion semantics previously supplied by the ORM.
-- Exam results retain their name/category snapshot after the exam is deleted.
ALTER TABLE examenes_pregunta
    DROP CONSTRAINT examenes_pregunta_examen_id_677fe258_fk_examenes_examen_id,
    ADD CONSTRAINT examenes_pregunta_examen_id_677fe258_fk_examenes_examen_id
        FOREIGN KEY (examen_id) REFERENCES examenes_examen(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE examenes_bloqueoexamen
    DROP CONSTRAINT examenes_bloqueoexamen_examen_id_1267f016_fk_examenes_examen_id,
    ADD CONSTRAINT examenes_bloqueoexamen_examen_id_1267f016_fk_examenes_examen_id
        FOREIGN KEY (examen_id) REFERENCES examenes_examen(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE examenes_resultadoexamen
    DROP CONSTRAINT examenes_resultadoex_examen_id_5d949c37_fk_examenes_,
    ADD CONSTRAINT examenes_resultadoex_examen_id_5d949c37_fk_examenes_
        FOREIGN KEY (examen_id) REFERENCES examenes_examen(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

-- Required student-owned rows are removed with their profile. Nullable references
-- retain shared content, audit history and students when an instructor is removed.
DO $$
DECLARE relation record; constraint_name text;
BEGIN
    FOR relation IN SELECT * FROM (VALUES
        ('accounts_userprofile', 'assigned_instructor_id', 'SET NULL'),
        ('conexiones_conexion', 'alumno_id', 'CASCADE'),
        ('conexiones_conexion', 'instructor_id', 'SET NULL'),
        ('conexiones_mensaje', 'alumno_id', 'CASCADE'),
        ('conexiones_mensaje', 'instructor_id', 'SET NULL'),
        ('conexiones_mensajestaff', 'remitente_id', 'CASCADE'),
        ('conexiones_mensajestaff', 'destinatario_id', 'CASCADE'),
        ('conexiones_registroconexion', 'profile_id', 'SET NULL'),
        ('conexiones_videollamada', 'alumno_id', 'CASCADE'),
        ('conexiones_videollamada', 'instructor_id', 'SET NULL'),
        ('core_auditlog', 'profile_id', 'SET NULL'),
        ('examenes_archivoexamen', 'subido_por_id', 'SET NULL'),
        ('examenes_bloqueoexamen', 'alumno_id', 'CASCADE'),
        ('examenes_bloqueoexamen', 'creado_por_id', 'SET NULL'),
        ('examenes_examen', 'creado_por_id', 'SET NULL'),
        ('examenes_resultadoexamen', 'alumno_id', 'CASCADE'),
        ('examenes_resultadopractico', 'alumno_id', 'CASCADE'),
        ('examenes_resultadopractico', 'instructor_id', 'SET NULL'),
        ('materiales_material', 'subido_por_id', 'SET NULL'),
        ('materiales_materialcompletado', 'alumno_id', 'CASCADE'),
        ('materiales_permisoaccesomaterial', 'alumno_id', 'CASCADE'),
        ('materiales_permisoaccesomaterial', 'concedido_por_id', 'SET NULL')
    ) AS refs(table_name, column_name, delete_rule) LOOP
        SELECT c.conname INTO STRICT constraint_name
        FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
        WHERE c.contype='f' AND c.conrelid=relation.table_name::regclass
          AND c.confrelid='accounts_userprofile'::regclass AND a.attname=relation.column_name
          AND cardinality(c.conkey)=1;
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', relation.table_name, constraint_name);
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES accounts_userprofile(id) ON DELETE %s DEFERRABLE INITIALLY DEFERRED',
            relation.table_name, constraint_name, relation.column_name, relation.delete_rule);
    END LOOP;
END $$;
