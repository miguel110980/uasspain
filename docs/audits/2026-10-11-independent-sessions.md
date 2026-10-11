# Sesiones por pestaña y caducidad por inactividad — 2026-10-11

La reparación está desplegada y validada en MAIN. Tras la autorización puntual
del usuario, se completó una única aceptación con cuatro perfiles TEMP, backup
cifrado restaurado y verificado, 45 gates funcionales y espera real de 900 segundos.
Los cuatro perfiles y sus 18 registros fueron eliminados por IDs exactos: cero
residuos y cero modificaciones/borrados de datos reales. Después se repitió la
regresión. No se reutilizaron excepciones anteriores ni se hizo commit o push.

## Causa y reparación

La implementación anterior mezclaba cookies compartidas, una sesión/rol global
por perfil y la finalización global de registros de acceso. La reproducción previa
de cuatro logins en un contexto de cookies produjo `401,401,401,200` al consultar
las identidades. Además, las peticiones y los heartbeats renovaban la actividad;
una sesión con 901 segundos sin interacción seguía aceptando HTTP 200.

Ahora una cookie de contexto de navegador HttpOnly, Secure y SameSite=Strict
protege un secreto sin identidad de usuario. Cada pestaña usa un UUID aleatorio
que el servidor vincula a ese contexto, perfil y rol en `auth_tab_session`.
El UUID por sí solo no autentica. No se entrega ningún JWT de usuario al navegador
ni se guarda una credencial reutilizable en localStorage. El middleware elimina
la cabecera de verificación externa antes de construir la identidad interna.

Login, selección de rol, logout y registros de acceso se aplican sólo a la sesión
correspondiente. Las revocaciones administrativas y de contraseña siguen
invalidando las sesiones del perfil. La propiedad de pestaña evita heredar login
al copiar sessionStorage o abrir una ventana; la recarga conserva su identidad.

`IDLE_TIMEOUT_SECONDS=900` es la constante del backend. PostgreSQL y el reloj del
servidor determinan la caducidad. Sólo el endpoint explícito de actividad actualiza
el contador, con autenticación, Origin y un límite de frecuencia. El frontend envía
actividad de eventos confiables: clic, escritura, formulario, rueda, gesto táctil
y arrastre pulsado. Hover, eventos sintéticos, polling, refresh y heartbeats no la
renuevan. El aviso es «Tu sesión ha caducado por inactividad» y sólo afecta a su
pestaña. Se abortan las peticiones dependientes y se retiran las conexiones locales.

HTTP comprueba autorización y caducidad en el servidor. WSS utiliza la misma cookie
protegida y el vínculo de pestaña, con validación de Origin, autorización por mensaje
y comprobación periódica de un segundo. Una sesión caducada cierra WSS con código
1008 y no puede reconectarse. Los trabajos HTTP en curso se invalidan al perder la
sesión; una operación bloqueante ya iniciada no se presenta como cancelación física
garantizada de su CPU.

## Archivos de esta reparación

- Migraciones nuevas: `backend-rust/migrations/0019_independent_tab_sessions.sql`
  y `0020_allow_concurrent_access_logs.sql`; no se editaron migraciones aplicadas.
- Rust: `src/auth.rs`, `app.rs`, `error.rs`, `chat.rs`, `connections.rs`,
  `dashboard.rs` y `video.rs` dentro de `backend-rust`.
- Frontend: `src/lib/windowSession.ts`, `sessionActivity.ts` y sus tests;
  `src/api/apiClient.ts` y sus tests; `src/hooks/useSession.ts`, `useWebrtc.ts`;
  `src/services/authService.ts` y `conexionesService.ts`.
- Pruebas: `frontend/e2e/session-realtime.spec.ts`, `concurrent-sessions.spec.ts`;
  `scripts/e2e/auth-fixtures.mjs`, `e2e-auth.mjs`, `e2e-concurrent-sessions.mjs`,
  `e2e_api.py`, `e2e-tab-sessions.mjs`, `e2e-tab-browser.mjs` y
  `e2e-session-security.mjs`.

Los cambios previos de instructor/alumno y los archivos temporales del usuario se
han conservado. No se han generado preguntas. No se han modificado Compose ni los
Dockerfiles permanentes para esta reparación.

## Evidencia observada y alcance

Evidencia privada, sin credenciales: `.run/session-repair-20261011/`.

- Rust: fmt, check, clippy con warnings denegados y 113 tests; target Docker audit.
- Frontend final: typecheck, lint, 52 tests y build verificado.
- API: 40 gates de cuatro sesiones compartiendo contexto, roles, independencia,
  revocación, reloj controlado 840/899/900 y límite de actividad; ejecución final
  por HTTPS en `api-regression-final.log` y `api-sessions.json`.
- Autenticación: 54 casos de OTP, recuperación y políticas; SMTP y Google externos
  no se probaron (`auth-regression.json`).
- Seguridad HTTP/WSS: 10 gates; CSRF, cabecera interna falsificada, Bearer, contexto
  ajeno, identificador sin cookie, Origin, expiración y reconexión rechazados.
- Navegador final: 37 gates, cuatro usuarios distintos en UN contexto y dominio,
  recarga, copia/ventana nativa, tres paneles, datos/roles, actividad, logout y offline.
- Espera real: HTTP válido a 840 y 899 segundos, redirección por inactividad a
  900,067 segundos, aviso exacto y otras tres pestañas aún autenticadas.
  Se ejecutó con frontend `88f955e9-7994-4111-be33-69472c72ce08` y el mismo binario
  backend final. El único cambio frontend posterior añadió arrastre pulsado y
  movimiento táctil; se verificó después con los 37 gates sobre frontend final.
- Regresión de navegador final: dos casos de sesiones/recuperación (30,1 s) y
  un caso de chat bidireccional, difusión, lectura, aislamiento, reconexión y medios
  reales de videollamada (26,9 s), servido por HTTPS/WSS de Docker.
- Concurrencia aislada: 19 gates, hasta 100 sesiones y 100 WSS, cero errores
  inesperados. A 100 sesiones: 1.827 solicitudes, p95 65,32 ms. Es una medición
  aislada por HTTP, no un benchmark de MAIN.
- No se ejecutó el runner Python completo que crea preguntas. No se afirma una
  regresión exhaustiva de todas las funcionalidades ajenas a esta reparación.

MAIN se reconstruyó con `scripts/start-encrypted-stack.ps1 -Build`. La prueba
de versión no depende de archivos del host: se compararon manifiestos de plataforma,
SHA-256 del binario y build ID del frontend entre MAIN y los contenedores de prueba.

```text
FRONTEND_BUILD_ID=44b30ac4-80b0-4543-8e66-8e17cef781a8
BACKEND_BINARY_SHA256=bc604bfd296949042db680709a47a2342b1309ae7ed703e24671e9bddffa2f4f
BACKEND_PLATFORM_MANIFEST=sha256:ebe63c1380131bed1c9d6bc300eeed6417cd185ad9178d43d8da573cd7f792bc
FRONTEND_PLATFORM_MANIFEST=sha256:0bdb2b24372b87d8fcac2a3aeec63335a2868e20fe043802e14fc42d0c549737
```

MAIN: cinco servicios saludables, cuatro endpoints HTTP 200 con CA verificada,
GET protegidos y WSS sin cookie rechazados con 401. Se preservaron la clave DPAPI,
el volumen cifrado y las medidas de aislamiento. La aceptación positiva de cuatro sesiones autenticadas sobre la base principal
se completó con la nueva autorización descrita abajo.

## Backup, datos, seguridad y limpieza

Antes de las migraciones se creó un snapshot cifrado y se comprobó su restauración
completa en un PostgreSQL temporal sin red y sin almacenamiento persistente:
42 tablas, 402 registros; `backup/inventory.json` registra `restoreVerified=true`.
El helper terminó con error en su comparación final de inmutabilidad porque había
actividad concurrente de la aplicación; no se confunde con el éxito de restauración.

La comparación en lectura de MAIN a las 09:47:52 UTC muestra 43 tablas y 431 filas:
dos migraciones nuevas, cambios en tres registros existentes y altas de aplicación.
No se observaron eliminaciones de las filas de la referencia. Las pruebas sólo
escribieron en la base E2E; no se atribuyen los cambios concurrentes a los fixtures
ni se declara falsamente que toda la base real permaneció idéntica.

La revisión de las cinco imágenes, fuentes e historial Git terminó con cero secretos
y cero vulnerabilidades altas/críticas (`security-current/summary.json`).
`git diff --check` y `git diff --cached --check` no encontraron errores. El índice
no se ha modificado. Las referencias Git indicadas abajo son locales; no hubo fetch.

Limpieza de recursos aislados propios: PASS. Se retiraron siete contenedores,
ocho volúmenes con nombres únicos y un volumen anónimo cuya creación y propietario
se verificaron por ID, del run `b0808d1d91ad443896ee53c56891e2c3`: cero residuos.
MAIN, backups, claves y recursos previos ajenos se preservaron. Después de limpiar
volvieron a pasar los 52 tests frontend (`post-cleanup-frontend-tests.log`).
También se retiraron la red temporal vacía y las dos etiquetas de imagen propias,
comprobando su identidad y ausencia de referencias. A las 09:52:19 UTC se repitieron
la versión, los GET/WS anónimos y la salud de MAIN: build ID final, 5/5 HEALTHY,
los cuatro HTTP 200, clave y volumen cifrado preservados.

## Aceptación autorizada en MAIN y regresión posterior

La autorización sólo cubrió esta prueba, en un único contexto de navegador y
dominio `https://localhost`, usando el frontend final y el backend registrados
arriba. Antes de crear perfiles se exportó una instantánea consistente de PostgreSQL
para el dump y sus huellas. Se restauró el archivo cifrado en un contenedor temporal
sin red ni disco persistente, verificando 43 tablas y 431 registros.
El contenedor verificador se retiró por su etiqueta e ID comprobados.

| Rol temporal | Perfil UUID | auth_user ID |
| --- | --- | --- |
| admin | 64ab9de8-fb21-43bb-9982-707efda47044 | 21 |
| instructor | d05bba3c-0d64-4b74-8da3-627e57578b4c | 22 |
| alumno | d871f0aa-38b7-44bc-a683-ffd168ec8896 | 23 |
| alumno | 37ea81bb-1a0a-4763-91d8-137decb09b90 | 24 |

Los 45 gates verificaron identidad/rol de cuatro pestañas, recarga, WSS,
duplicación nativa, identificador sin cookie, Origin, permisos, intento de
escalada, actividad confiable, eventos sintéticos, polling/refresh, expiración,
logout independiente y recuperación offline. No se crearon mensajes, exámenes,
preguntas ni archivos de material.

En MAIN, la sesión siguió válida a 840 y 899 segundos sin alterar su marca de
actividad. La redirección y el aviso exacto se observaron a
900,713 segundos; su WSS cerró con código 1008
y razón `session_expired`. HTTP y reconexión WSS posteriores fueron
rechazados. Las otras tres sesiones permanecieron autenticadas; logout de la
cuarta no afectó al instructor ni al alumno restante.

`main-acceptance/inventory.json` conserva los IDs exactos de los cuatro perfiles
y todos los 18 registros creados: usuarios, perfiles, sesiones por pestaña,
registros de acceso y conexiones. La limpieza comprobó todas las pertenencias y
referencias entrantes; borró exclusivamente esos IDs y comparó, bajo bloqueo
transaccional, las huellas de cada fila ajena antes y después de borrar.
La comparación final contra el snapshot previo de esta prueba dio
43 tablas, 431 registros y ninguna modificación, eliminación ni alta residual.
No se restauró la base real ni se reiniciaron secuencias.

Después de limpiar se ejecutaron nuevamente los 113 tests Rust (etapa test sin
reutilizar su resultado en caché), los 52 frontend, GET/WS anónimos de autorización
y los cuatro endpoints de salud. Se comprobó 5/5 HEALTHY, versión final, volumen
cifrado y clave DPAPI preservados. El lanzador PowerShell se corrigió tras confundir
el progreso de Docker en stderr con un fallo; la ejecución posterior terminó con
código 0. La regresión PASS cubre las funciones afectadas; no implica ejecutar
el runner Python que crea preguntas. Evidencia: `main-acceptance/acceptance.json`,
`post-main-cleanup-rust.log`, `post-main-cleanup-frontend.log` y
`main-acceptance/post-cleanup-preservation.json`.

## Gates y cierre

Los PASS siguientes acreditan la aceptación autorizada en MAIN y la regresión
afectada descrita arriba, complementadas por las pruebas aisladas anteriores.

```text
MULTI_TAB_SESSIONS=PASS
INDEPENDENT_AUTHENTICATION=PASS
ROLE_ISOLATION=PASS
IDLE_TIMEOUT_900_SECONDS=PASS
INDEPENDENT_LOGOUT=PASS
HTTP_WSS_AUTHORIZATION=PASS
SECURITY_TESTS=PASS
REGRESSION_TESTS=PASS
DOCKER_HEALTH=PASS
MAIN_AUTHENTICATED_ACCEPTANCE=PASS
MAIN_INSTANCE_TEST_PROFILES=4
REAL_USER_DATA_MODIFIED=0
REAL_USER_DATA_DELETED=0
TEMP_DATA_RESIDUE=0
POST_CLEANUP_REGRESSION=PASS
CHANGE_STATUS=COMPLETE

CODE=PASS
TESTS=PASS
DOCKER_BUILD=PASS
DOCKER_DEPLOY=PASS
POSTGRES=HEALTHY
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5
HEALTHZ=PASS_HTTP_200
READYZ=PASS_HTTP_200
API_LIVE=PASS_HTTP_200
API_READY=PASS_HTTP_200
E2E_DOCKER=PASS_MAIN_AND_ISOLATED
FUNCTIONAL_TEST=PASS
SECURITY=PASS
SECRETS_IN_GIT=0
COMMIT=NOT_RUN_USER_RESTRICTION
PUSH=NOT_RUN_USER_RESTRICTION
LOCAL_HEAD=01897a206dc98202e05a0fa910d9a44efcf4b58a
ORIGIN_MAIN=01897a206dc98202e05a0fa910d9a44efcf4b58a
CRITICAL=0
HIGH=0
ERRORS=[]
SEQUENCE=COMPLETE
CURRENT=VALIDATED_MAIN_AND_CLEANED
NEXT=NOT_RUN_USER_GIT_RESTRICTION
REASON=COMMIT_PUSH_NOT_AUTHORIZED
```

El rechazo previo de revisión automática al POST `/api/auth/context/` no se
eludió. El usuario autorizó después esta única prueba de sesiones en MAIN, que
se ejecutó y limpió conforme a sus condiciones. La excepción queda consumida y
no autoriza nuevas escrituras de prueba. Commit y push siguen sin autorización.

La revisión final de fuentes e historial con Gitleaks pasó con cero secretos
(`security-final-secrets/summary.json`). Se retiró la etiqueta temporal del audit
Rust y se comprobó ausencia del verificador de snapshot. La última comprobación
de MAIN conserva 5/5 HEALTHY, los cuatro HTTP 200, el build ID final, las imágenes,
el volumen cifrado y la clave. El índice Git sigue vacío y ambos diff checks pasan.
