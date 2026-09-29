# Despliegue, traslado y publicacion

## Despliegue soportado

UASSpain se despliega con `docker-compose.yml`. No se soportan Django, `manage.py`, servicios Python ni instalacion nativa.

```powershell
docker compose config --quiet
docker compose build --pull
docker compose up -d --wait --wait-timeout 180
docker compose ps
```

Solo Nginx publica `127.0.0.1:80/443`. Compruebe `https://127.0.0.1/healthz` y `https://127.0.0.1/readyz`.

## Configuracion externa

- Google OAuth: configure la URL HTTPS publica y `GOOGLE_CLIENT_ID`. El backend valida el ID token; no guarde un secreto de cliente en el frontend.
- SMTP, SFTP y WireGuard: entregue credenciales o claves fuera de Git y montelas desde `.secrets/`.
- TLS: los certificados internos se generan localmente; las claves privadas nunca se versionan.

## Traslado

Conserve el repositorio sin `.env` ni `.secrets`, un backup PostgreSQL verificado, los volumenes de media/backups necesarios y los secretos por un canal independiente. No exporte `node_modules`, `target`, caches, artefactos E2E ni `.local-snapshots`.

## Gate previo a GitHub

```powershell
git status --short
git diff --check
docker compose config --services
```

Ejecute los gates de [README.md](../README.md) y [SECURITY.md](../SECURITY.md). No publique mientras Gitleaks sobre el historial no sea 0 o existan credenciales antiguas sin revocar.

La reescritura remota requiere autorizacion explicita, congelar merges, capturar refs, usar `--force-with-lease` y verificar el resultado con un clon nuevo. Nunca use `--force` ni reescriba con trabajo local sin consolidar.

Rollback: restaure refs desde un bundle verificado y el worktree desde su snapshot; cualquier recuperacion remota necesita una nueva autorizacion.
