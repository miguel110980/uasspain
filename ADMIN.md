# Administracion UASSpain

La administracion se realiza en la SPA `/admin`; no existe un panel separado ni un runtime Python.

## Administrador inicial

El backend Rust crea o actualiza el administrador de arranque con `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD_FILE` (por defecto `.secrets/bootstrap_admin_password`).

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

SMTP y Google OAuth usan configuracion no secreta en `.env` y secretos montados desde `.secrets/`. Tras cambiar configuracion: `docker compose up -d --force-recreate --wait backend nginx`.

Nunca incluya secretos en Git, logs ni comandos que puedan quedar en el historial. Consulte [SECURITY.md](SECURITY.md).
