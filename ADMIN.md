# Administracion UASSpain

La administracion se realiza en la SPA `/admin`; no existe un panel separado ni un runtime Python.

## Administrador inicial

Con `BOOTSTRAP_ADMIN_ENABLED=true`, el backend Rust crea el administrador de arranque con `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD_FILE` (por defecto `.secrets/bootstrap_admin_password`). Si la cuenta ya existe, actualiza permisos y estado; no restablece su contraseña. No active este mecanismo para sustituir cuentas durante una auditoría de usuarios reales.

```powershell
docker compose up -d --build --wait backend nginx
docker compose logs --tail 100 backend
```

## Operaciones

- Usuarios y roles: `/admin/usuarios`.
- Estado: `/admin/configuracion` y `GET /api/system/status/`.
- Blog y cursos: secciones de administracion correspondientes.
- Backups y restauracion: `/admin/backups` y [guia de recovery](docs/BACKUP_RESTORE.md).
- Actividad e incidentes: auditoria de la SPA y [runbook](infra/monitoring/INCIDENT-RUNBOOK.md).

SMTP usa configuracion no secreta en `.env` y secretos montados desde `.secrets/`. Tras cambiar configuracion: `docker compose up -d --force-recreate --wait backend nginx`.

Nunca incluya secretos en Git, logs ni comandos que puedan quedar en el historial. Consulte [SECURITY.md](SECURITY.md).

## Recuperar acceso a una cuenta existente

Para administrador, instructor y alumno: abra **Acceso → ¿Ha olvidado su contraseña?**, introduzca el correo de la cuenta y siga el enlace recibido. El frontend solicita `POST /api/auth/password-reset/`; la confirmación pasa por `/restablecer-contrasena` y `POST /api/auth/password-reset/confirm/`. Requiere SMTP configurado y acceso al buzón de esa cuenta.

Un administrador autenticado también puede solicitar el enlace con `POST /api/users/{id}/reset-password/`, usando el ID del perfil existente. El mecanismo también utiliza SMTP; no devuelve contraseñas ni enlaces de recuperación en la respuesta. Una cuenta sin contraseña local debe contactar con el centro para configurar el acceso.

El backend genera hashes Argon2id y valida hashes heredados compatibles. No se recupera una contraseña desde el hash, ni se reemplaza mediante SQL arbitrario. Restablecerla requiere una petición expresa y revoca la sesión anterior.

Las dos [cuentas de prueba locales](docs/TEST_ACCOUNTS.md) tienen contraseñas
aleatorias conservadas con DPAPI; consulte esa guía para acceder a ellas.
