# UASSpain

Plataforma de formacion UAS con frontend React 19/TypeScript, API Rust con Axum, PostgreSQL 18, Redis 8 y Nginx. El despliegue soportado es Docker Compose; Django y el backend Python ya no forman parte del runtime.

## Funciones actuales

- Autenticacion por correo y contraseña, OTP, Google Identity Services y roles `admin`, `instructor` y `alumno`.
- Gestion de usuarios, examenes, materiales, resultados, conexiones, chat y videollamadas.
- Blog y catalogo de formacion dinamicos administrados desde la SPA.
- Backups cifrados locales/SFTP, comprobacion, retencion y restauracion auditada.

## Arranque local

Requisitos: Docker Desktop con el plugin actual de Compose, FUSE y secretos locales en `.secrets/`.
PostgreSQL exige un volumen gocryptfs cifrado; en WSL configure `swap=0`.
Los `.env*` reales, claves y secretos estan excluidos de Git. La clave de
almacenamiento se protege con DPAPI del usuario Windows y se entrega solo a
tmpfs; conserve ese perfil y la recuperacion de claves fuera de Git.

El build, arranque y validacion se realizan localmente con Docker Desktop. No requieren GitHub Actions ni imagenes publicadas en un registro de GitHub.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-encrypted-stack.ps1 -Build
docker compose -f docker-compose.yml -f docker-compose.encrypted.yml ps
```

Entrada unica:

- `http://127.0.0.1` redirige a HTTPS.
- `https://127.0.0.1` sirve SPA, API y WebSocket.
- PostgreSQL, Redis, frontend y backend no publican puertos al host.

En una instalacion nueva, con volumen vacio y sin clave existente, añada
`-InitializeKey`. Tras reiniciar PostgreSQL, el mismo script entrega la clave
protegida. Para recuperarlo automaticamente al reiniciar Docker Desktop, ejecute
una vez `scripts/install-encrypted-autostart.ps1` con el usuario Windows dueño
de la clave DPAPI. La tarea tiene privilegios limitados, conserva el cifrado y
respeta las paradas manuales; se puede retirar con `-Uninstall`.
Sin clave PostgreSQL permanece bloqueado. Las migraciones Rust siguen
siendo la unica fuente del esquema. Consulte [despliegue](docs/DEPLOYMENT.md).

Para habilitar Google, configure un Client ID web y el origen autorizado como
se explica en [acceso con Google](docs/GOOGLE_AUTH.md). Las
[cuentas de prueba locales](docs/TEST_ACCOUNTS.md) están disponibles con contraseña.

## Arquitectura

| Servicio | Implementacion | Exposicion |
|---|---|---|
| `nginx` | Edge TLS y reverse proxy | `127.0.0.1:80/443` |
| `frontend` | React compilado y Nginx interno TLS | Red `edge` |
| `backend` | Rust/Axum con TLS interno | Redes `edge` y `data` |
| `postgres` | PostgreSQL 18, volumen cifrado, TLS y roles separados | Red interna `data` |
| `redis` | Redis 8, TLS y ACL | Red interna `data` |

Persistencia: `postgres_ciphertext`, `redis_data`, `uasspain_media_data`,
`backups_data`, `backup_keys` y `frontend_static`. Este último es externo y
conserva los assets con hash de versiones anteriores para las pestañas abiertas;
el script de arranque lo crea cuando falta. El volumen PostgreSQL cifra PGDATA, WAL,
temporales y logs, incluidos los nombres de archivo.

## Validacion

Todas las reparaciones deben seguir la [regla obligatoria de Docker y GitHub](docs/REPAIR_WORKFLOW.md),
persistida para los agentes en [AGENTS.md](AGENTS.md): tests, rebuild con
`scripts/start-encrypted-stack.ps1 -Build`, cinco servicios saludables, E2E y
funcion real sobre Docker, seguridad, commit y push. Una imagen antigua deja el
cambio incompleto. Despues del push, verificar SHA remoto y salud local.

Las imágenes base usan versiones explícitas y digest: Node 22.23.2 LTS,
Nginx 1.30.5/Alpine 3.24, PostgreSQL 18.6, Redis 8.2.10 (rama Extended),
Rust 1.99.0 y Ubuntu 26.04. El auxiliar `gosu` se compila con Go 1.27.1.
Se verificaron con las publicaciones oficiales de
[Rust](https://blog.rust-lang.org/2026/10/01/Rust-1.99.0/),
[Go](https://go.dev/doc/devel/release), [Alpine](https://alpinelinux.org/releases/),
[Nginx](https://nginx.org/), [PostgreSQL](https://www.postgresql.org/docs/release/18.6/)
y [la política de versiones de Redis](https://redis.io/docs/latest/operate/oss_and_stack/install/version-mgmt/).
El escáner comprueba las imágenes realmente ejecutadas mediante su ID inmutable.

```powershell
docker compose -f docker-compose.yml -f docker-compose.encrypted.yml config --quiet
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-encrypted-stack.ps1 -Build
npm.cmd --prefix frontend run typecheck
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend test -- --run
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/e2e/run-e2e.ps1
node scripts/e2e/e2e-home-rendering.mjs
node scripts/e2e/e2e-home-lighthouse.mjs
powershell.exe -NoProfile -File scripts/verify-production-security.ps1
```

La suite E2E crea un proyecto aislado con `docker-compose.e2e.yml` y cubre API, autorizacion, WebSocket, uploads, recovery, los tres paneles en escritorio/movil y medios WebRTC entre tres participantes. Requiere `npm ci` y `npx playwright install chromium` en `frontend`. El gate Rust completo se ejecuta con `docker build --target audit backend-rust`. Consulte el [resultado y alcance de la validación local](docs/LOCAL_VALIDATION.md).

## Documentacion

- [Administracion](ADMIN.md)
- [Despliegue y publicacion](docs/DEPLOYMENT.md)
- [Backup y recovery](docs/BACKUP_RESTORE.md)
- [Seguridad](SECURITY.md)
- [Respuesta a incidentes](infra/monitoring/INCIDENT-RUNBOOK.md)

No use `manage.py`, servidores Python ni despliegues nativos: son tecnologia retirada.
