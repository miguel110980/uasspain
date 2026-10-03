# Runbook de incidentes UASSpain

El runtime soportado es el stack Docker Compose de cinco servicios.

## Diagnostico inicial

```powershell
docker compose ps
docker compose logs --tail 200 nginx frontend backend postgres redis
curl.exe --fail --insecure https://127.0.0.1/healthz
curl.exe --fail --insecure https://127.0.0.1/readyz
```

No reinicie antes de guardar estado y logs. Para recuperar un servicio use `docker compose up -d --force-recreate --wait <servicio>`.

## Datos

Compruebe primero healthchecks y logs. No publique PostgreSQL/Redis, no borre volumenes y siga la [guia de backup y recovery](../../docs/BACKUP_RESTORE.md).

## Seguridad

Preserve evidencias, identifique alcance, rote solo el secreto afectado y recree sus consumidores. No copie secretos a tickets, logs o comandos. Ejecute los controles de [SECURITY.md](../../SECURITY.md) y documente causa raiz, timeline, impacto, rotaciones, pruebas y riesgo residual.

## Escalado

Registre hora UTC, servicio, contenedor, ultimo estado healthy, request ID y acciones. Si depende de correo, SFTP, VPN o una imagen upstream, declare el bloqueo externo sin alterar datos locales.
