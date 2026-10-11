-- The legacy uniqueness rule prevented two sessions of the same account.
-- Keep historical access rows intact; uniqueness now belongs to a session.
DROP INDEX uniq_active_session_per_profile;
CREATE UNIQUE INDEX uniq_active_access_log_session
    ON conexiones_registroconexion(session_id)
    WHERE estado_sesion='activa' AND session_id<>'';
