-- Authentication belongs to a browser context AND a tab, never to a profile.
CREATE TABLE auth_tab_session (
    id UUID PRIMARY KEY,
    profile_id UUID NOT NULL REFERENCES accounts_userprofile(id) ON DELETE CASCADE,
    context_lookup TEXT NOT NULL,
    window_lookup TEXT NOT NULL,
    session_key TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin','instructor','alumno')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    UNIQUE(context_lookup, window_lookup)
);
CREATE INDEX auth_tab_session_profile ON auth_tab_session(profile_id);

-- Keep password reset, account blocking and administrative revocation effective.
CREATE FUNCTION revoke_profile_tab_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.active_session_key IS DISTINCT FROM NEW.active_session_key
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.roles IS DISTINCT FROM NEW.roles
       OR OLD.role IS DISTINCT FROM NEW.role
       OR OLD.otp_verified IS DISTINCT FROM NEW.otp_verified THEN
        UPDATE auth_tab_session SET revoked_at=clock_timestamp()
        WHERE profile_id=NEW.id AND revoked_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER revoke_profile_tab_sessions AFTER UPDATE ON accounts_userprofile
FOR EACH ROW EXECUTE FUNCTION revoke_profile_tab_sessions();

CREATE FUNCTION revoke_user_tab_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.password IS DISTINCT FROM NEW.password OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        UPDATE auth_tab_session SET revoked_at=clock_timestamp()
        WHERE profile_id IN (SELECT id FROM accounts_userprofile WHERE user_id=NEW.id)
          AND revoked_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER revoke_user_tab_sessions AFTER UPDATE ON auth_user
FOR EACH ROW EXECUTE FUNCTION revoke_user_tab_sessions();

CREATE FUNCTION revoke_logged_tab_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado_sesion='finalizada' AND OLD.estado_sesion IS DISTINCT FROM NEW.estado_sesion THEN
        UPDATE auth_tab_session SET revoked_at=clock_timestamp()
        WHERE profile_id=NEW.profile_id AND session_key=NEW.session_id AND revoked_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER revoke_logged_tab_session AFTER UPDATE ON conexiones_registroconexion
FOR EACH ROW EXECUTE FUNCTION revoke_logged_tab_session();
