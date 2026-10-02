# Despliegue, traslado y publicacion

## Despliegue soportado

UASSpain se despliega con `docker-compose.yml`. No se soportan Django, `manage.py`, servicios Python ni instalacion nativa.

```powershell
docker compose config --quiet
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-encrypted-stack.ps1 -Build
docker compose ps
```

Solo Nginx publica `127.0.0.1:80/443`. Compruebe `https://127.0.0.1/healthz` y `https://127.0.0.1/readyz`.

## Configuracion externa

Configure `SITE_URL` con el origen HTTPS público definitivo. Compose usa ese
valor tanto en el build del frontend (`VITE_SITE_URL`) como en el backend:
canonical, Open Graph, robots y sitemaps deben coincidir. Cambiarlo exige
reconstruir el frontend. El build prerenderiza los componentes de las 30 rutas
públicas; 27 se incluyen en `sitemap-static.xml`. El índice `sitemap.xml`
incluye también `sitemap-courses.xml`, actualizado desde los cursos publicados.
Nginx valida la existencia del curso y compone su HTML público con SSI; los
cursos pendientes/inexistentes responden 404. Conserve esta configuración al
poner otro proxy delante; las rutas privadas y el API llevan `noindex`.

Para comprobar el sitio compilado por HTTPS con una CA autorizada:

```powershell
$env:SITE_TEST_URL='https://localhost:8445'
$env:SITE_TEST_CA='.secrets/tls/ca.crt'
node scripts/e2e/verify-public-site.mjs
```

El script comprueba todas las páginas del sitemap, títulos únicos, contenido
sin JavaScript, cursos publicados, 404 y noindex. Requiere una pila ya levantada;
no cambia datos ni omite la verificación TLS.

- Google OAuth: configure la URL HTTPS publica y `GOOGLE_CLIENT_ID`. El backend valida el ID token; no guarde un secreto de cliente en el frontend.
- SMTP, SFTP y WireGuard: entregue credenciales o claves fuera de Git y montelas desde `.secrets/`.
- TLS: los certificados internos se generan localmente; las claves privadas nunca se versionan.

Google Identity Services utiliza ID tokens RS256 verificados con JWKS de Google,
audience/issuer/expiry/nbf y nonce firmado en cookie HttpOnly de cinco minutos, de un
solo uso. La migración `0007_google_subject.sql` añade un índice de sujeto Google
para vincular la identidad estable del proveedor. Solo se vinculan cuentas
activas ya verificadas y correos sobre los que Google es autoridad (Gmail o
Workspace). No es un flujo de autorización con intercambio de códigos/PKCE.
Si la cuenta exige OTP local, Google no crea sesión: acceda con correo, contraseña y código temporal. La caché y el registro de nonces usados corresponden a la única instancia del
backend; al escalar a varias instancias, compartalos antes de habilitar el flujo.

## Videollamadas WebRTC

El navegador intercambia audio y video mediante WebRTC. El backend autoriza cada participante y retransmite la señalización por WebSocket. El instructor puede invitar a todos sus alumnos a una misma sala; al finalizarla se cierran sus invitaciones. Las salas se generan en el servidor y no aceptan nombres enviados por el cliente.

En localhost o una LAN compatible funcionan los candidatos ICE locales. Para alumnos en redes distintas configure un servidor TURN accesible desde esas redes. Guarde un array JSON de `RTCIceServer` en `.secrets/webrtc_ice_servers.json`, con `urls`, `username` y `credential` de su proveedor, y arranque con:

```powershell
docker compose -f docker-compose.yml -f docker-compose.webrtc.yml up -d --wait
```

Utilice credenciales limitadas y rotables. El archivo se monta como secreto y el endpoint autenticado `/api/videollamadas/ice/` entrega la configuración necesaria al navegador. Verifique con dos redes reales que el servidor TURN transmite medios antes de habilitar llamadas por Internet. La prueba local de Chromium usa dispositivos simulados y comprueba bytes de audio y video recibidos entre tres participantes y la liberación de dispositivos al colgar; no acredita esa conectividad externa.

## Exámenes y validación

La migración `0005_exam_attempts.sql` guarda intentos, preguntas y respuestas. `POST /api/examenes/{id}/intentos/` inicia o recupera un intento; `PUT /api/intentos-examen/{id}/` guarda respuestas. El resultado requiere `attempt_id`: el servidor calcula la nota y el tiempo, aplica prerrequisitos y devuelve el mismo resultado ante reintentos. Pasado el plazo de 40 minutos solo puntúa las respuestas guardadas antes de vencer. La modalidad libre conserva su intento sin fecha límite.

La migración `0006_domain_deletion.sql` define el borrado de preguntas/bloqueos con su examen y conserva resultados históricos sin su referencia al examen. Al eliminar un perfil se borran sus filas dependientes, se mantienen contenidos y auditorías compartidos y se desasignan sus alumnos. La cuenta de autenticación queda inactiva en la misma transacción. El runtime del backend usa Ubuntu 26.04 actualizado y herramientas PostgreSQL 18; los builds y las comprobaciones se ejecutan localmente con los comandos de README y los escaneos de los cinco servicios.

Antes de ejecutar `scripts/e2e/run-e2e.ps1`, instale `npm ci` y `npx playwright install chromium` en `frontend`. El runner recrea exclusivamente el proyecto `uasspain-e2e`, verifica backups/restauraciones locales y SFTP y recorre los tres paneles en Chromium. `-SkipBrowser` omite únicamente el navegador; `-Keep` conserva la pila aislada para investigar un fallo.

## Reconstruccion PostgreSQL desde migraciones

La reconstruccion usa exclusivamente las siete migraciones de
`backend-rust/migrations/`, ejecutadas por SQLx en orden. No restaura un esquema
alternativo. `docker-compose.encrypted.yml` monta un volumen gocryptfs dedicado;
`docker-compose.rebuild.yml`, aplicado al final, crea una pila independiente
en HTTPS `localhost:8447`. Use siempre un proyecto `uasspain-rebuild-*`.

```powershell
node tools/postgres-rebuild.mjs backup uasspain-rebuild-20261003
docker compose -p uasspain-rebuild-20261003 -f docker-compose.yml -f docker-compose.encrypted.yml -f docker-compose.rebuild.yml build
docker compose -p uasspain-rebuild-20261003 -f docker-compose.yml -f docker-compose.encrypted.yml -f docker-compose.rebuild.yml up -d postgres
.\scripts\unlock-postgres-storage.ps1 -Project uasspain-rebuild-20261003
docker compose -p uasspain-rebuild-20261003 -f docker-compose.yml -f docker-compose.encrypted.yml -f docker-compose.rebuild.yml up -d --no-build --wait --wait-timeout 180
node tools/postgres-rebuild.mjs restore-admin uasspain-rebuild-20261003
node tools/verify-postgres-storage.mjs uasspain-rebuild-20261003
node tools/postgres-rebuild.mjs verify uasspain-rebuild-20261003
```

Este procedimiento requiere exactamente un administrador existente. Conserva
su UUID, hash Argon2id, indices ciegos y campos AES-256-GCM; no crea cuentas de
prueba ni cambia la contrasena. La copia completa se cifra en memoria antes de
escribirse en `.run/<proyecto>/original-database.pgcustom.enc`. Mantenga la clave
de campos por un canal independiente: perderla impide descifrar datos y backup.
El verificador compara columnas, PK/FK/UNIQUE/CHECK e indices, checksums SQLx,
privilegios y TLS y restaura el backup completo en una base temporal aislada.
No sobrescribe copias existentes: para repetir la reconstruccion use otro
nombre de proyecto y conserve sus evidencias en el directorio correspondiente.

TLS PostgreSQL exige `verify-full`, CA y hostname, y rechaza conexiones sin TLS.
Los roles de runtime no tienen privilegios DDL; backup solo lee y SQLx solo
puede ser modificado por el migrador. Los secretos quedan fuera de Git.

PGDATA, WAL, archivos temporales y logs PostgreSQL persisten exclusivamente en
`postgres_ciphertext`, con contenido AES-256-GCM y nombres cifrados. La vista
descifrada es un montaje FUSE dentro del contenedor; el directorio padre y la
entrega de clave usan tmpfs. No se admite un arranque de produccion sin ese
montaje. Se mantiene TLS `verify-full` y el cifrado independiente de campos.

La clave de almacenamiento es aleatoria de 32 bytes y se guarda solo como blob
DPAPI CurrentUser en `.secrets/postgres-storage-key.dpapi`. En una instalacion
nueva sin datos cifrados ni clave, use `-InitializeKey` al primer desbloqueo.
No se sobrescribe una clave existente ni se genera un reemplazo para un volumen
ya cifrado. Se entrega por stdin a tmpfs y se elimina despues del montaje;
nunca se incorpora al entorno, argv, imagen ni log. El usuario Windows debe ser
el propietario del perfil DPAPI; conserve ese perfil y una estrategia de
recuperacion de claves antes de reinstalar o trasladar el equipo.

BitLocker esta desactivado en esta instalacion y no es dependencia de PostgreSQL.
Se configura `%UserProfile%/.wslconfig` con `[wsl2]` y `swap=0`, aplicado tras
reiniciar WSL/Docker Desktop. El gate lee `/proc/swaps` y rechaza la activacion
si queda swap. La desactivacion afecta a la VM WSL 2, no solo a este contenedor.
El cifrado protege los archivos activos de PostgreSQL; no cifra todo Windows
ni acredita borrado forense de bloques historicos del VHDX.

Para el arranque habitual y la verificacion:

```powershell
.\scripts\start-encrypted-stack.ps1
node tools/verify-postgres-storage.mjs uasspain
```

El desbloqueo se requiere tras cada reinicio de PostgreSQL; sin clave no arranca
ni crea un cluster en claro. FUSE necesita `/dev/fuse` y SYS_ADMIN en el arranque,
pero el proceso PostgreSQL pierde esa capacidad y funciona con CapEff cero.
No se usa `privileged`, el socket Docker ni dispositivos de disco del host.
El verificador comprueba montaje, flags criptograficos, cobertura, ausencia de
clave persistente y rechazo de clave incorrecta desde una vista raw sin FUSE.
Antes de activar deben pasar tambien login, datos personales, panel admin y aislamiento multirrol desde
la aplicacion real; conserve su evidencia local sin credenciales en
`application-verification.json`. La activacion comprueba esa evidencia y vuelve
a verificar PostgreSQL antes de cambiar los volumenes:

```powershell
.\scripts\activate-postgres-rebuild.ps1 -Project uasspain-rebuild-20261003
```

La activacion configura los dos archivos Compose en `.env` y marca el volumen
cifrado promovido como externo para protegerlo de la eliminacion por Compose.
Los proyectos nuevos conservan nombres independientes incluso con esa `.env`.
El desbloqueo rechaza dos servidores activos que compartan el mismo volumen.
Si falla la activacion, conserva la configuracion y datos anteriores y solo
recupera automaticamente un destino anterior ya cifrado; no permite volver a
produccion en claro.

Los cuatro volumenes anteriores se han retirado con autorizacion expresa tras
crear archivos AES-256-GCM en `.run/uasspain/retired-postgres/` y comprobar una
restauracion fisica con PostgreSQL. Estos archivos usan una subclave de archivo
derivada de la clave DPAPI de almacenamiento; conserve tambien ese blob/perfil.
`tools/archive-postgres-volumes.mjs` crea/verifica los archivos y realiza el drill;
no elimina volumenes. El rollback actual se realiza restaurando el archivo
cifrado en otro volumen cifrado, nunca reactivando copias en claro. Nunca use
`down -v` sobre la instalacion real.

## Traslado de la instalacion

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
