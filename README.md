# UASSpain

Plataforma de formacion UAS con frontend React 19/TypeScript, API Rust con Axum, PostgreSQL 18, Redis 8 y Nginx. El despliegue soportado es Docker Compose; Django y el backend Python ya no forman parte del runtime.

## Funciones actuales

- Autenticacion, OTP, OAuth, sesiones y roles `admin`, `instructor` y `alumno`.
- Gestion de usuarios, examenes, materiales, resultados, conexiones, chat y videollamadas.
- Blog y catalogo de formacion dinamicos administrados desde la SPA.
- Backups cifrados locales/SFTP, comprobacion, retencion y restauracion auditada.

## Arranque local

Requisitos: Docker Desktop con Compose v2, FUSE y secretos locales en `.secrets/`.
PostgreSQL exige un volumen gocryptfs cifrado; en WSL configure `swap=0`.
Los `.env*` reales, claves y secretos estan excluidos de Git. La clave de
almacenamiento se protege con DPAPI del usuario Windows y se entrega solo a
tmpfs; conserve ese perfil y la recuperacion de claves fuera de Git.

El build, arranque y validacion se realizan localmente con Docker Desktop. No requieren GitHub Actions ni imagenes publicadas en un registro de GitHub.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-encrypted-stack.ps1 -Build
docker compose ps
```

Entrada unica:

- `http://127.0.0.1` redirige a HTTPS.
- `https://127.0.0.1` sirve SPA, API y WebSocket.
- PostgreSQL, Redis, frontend y backend no publican puertos al host.

En una instalacion nueva, con volumen vacio y sin clave existente, añada
`-InitializeKey`. En cada reinicio de PostgreSQL ejecute el mismo script; hasta
recibir la clave protegida permanece bloqueado. Las migraciones Rust siguen
siendo la unica fuente del esquema. Consulte [despliegue](docs/DEPLOYMENT.md).

## Arquitectura

| Servicio | Implementacion | Exposicion |
|---|---|---|
| `nginx` | Edge TLS y reverse proxy | `127.0.0.1:80/443` |
| `frontend` | React compilado y Nginx interno TLS | Red `edge` |
| `backend` | Rust/Axum con TLS interno | Redes `edge` y `data` |
| `postgres` | PostgreSQL 18, volumen cifrado, TLS y roles separados | Red interna `data` |
| `redis` | Redis 8, TLS y ACL | Red interna `data` |

Persistencia: `postgres_ciphertext`, `redis_data`, `uasspain_media_data`,
`backups_data` y `backup_keys`. El volumen PostgreSQL cifra PGDATA, WAL,
temporales y logs, incluidos los nombres de archivo.

## Validacion

```powershell
docker compose config --quiet
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-encrypted-stack.ps1 -Build
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend test -- --run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/e2e/run-e2e.ps1
```

La suite E2E crea un proyecto aislado con `docker-compose.e2e.yml` y cubre API, autorizacion, WebSocket, uploads, recovery, los tres paneles en escritorio/movil y medios WebRTC entre tres participantes. Requiere `npm ci` y `npx playwright install chromium` en `frontend`. El gate Rust completo se ejecuta con `docker build --target audit backend-rust`. Consulte el [resultado y alcance de la validación local](docs/LOCAL_VALIDATION.md).

## Documentacion

- [Administracion](ADMIN.md)
- [Despliegue y publicacion](docs/DEPLOYMENT.md)
- [Backup y recovery](docs/BACKUP_RESTORE.md)
- [Seguridad](SECURITY.md)
- [Respuesta a incidentes](infra/monitoring/INCIDENT-RUNBOOK.md)

No use `manage.py`, servidores Python ni despliegues nativos: son tecnologia retirada.
