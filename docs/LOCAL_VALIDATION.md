# Validación local y catálogo de evidencias

## Entrega documental validada localmente — 14 de octubre de 2026

Estado: **VALIDATED_LOCAL_Y_PUBLICADO**, con dependencias externas de producción
pendientes. Los commits de implementación, instaladores y documentación están
publicados; este cierre documental registra su aceptación posterior. El encargo autoriza Docker local,
commits y push normal; no instalaciones externas, cambios DNS ni escrituras de
prueba sobre cuentas reales. El VBS local ajeno se excluye de la publicación.

La inspección inventarió **47 documentos Markdown** y **169 rutas Rust**.
Se reutilizan README, ADMIN, SECURITY y las guías operativas: no se crea otro
manual paralelo. Se corrigen rutas administrativas inexistentes, el consejo
antiguo de activar Google sólo con Client ID, la dependencia exclusiva de SMTP
para recuperación y los dos editores duplicados de VPN/destinos. Los informes
históricos conservan sus resultados; no se actualizan sus PASS retroactivamente.

| Comprobación de esta entrega | Evidencia observada |
|---|---|
| Recuperación y rebuild oficial | Cinco servicios saludables; arranque con `-Build` y verificador de almacenamiento PASS. Reconstrucciones oficiales del 14/10 verificadas; caché sólo con inputs iguales. La política específica del callback está activa en el edge. |
| Backup previo | AES-GCM, checksum, descifrado y restauración sin red/volúmenes: **62 tablas, 1.242 filas idénticas**, 14/10 08:09 UTC; cero perfiles creados. |
| Seguridad de las imágenes finales | Gitleaks árbol/historial 0; Trivy cinco imágenes ejecutadas y lockfiles 0 HIGH/CRITICAL (14/10, incluidos los tres commits publicados). El cierre documental conserva el gate de escaneo antes de publicar. |
| Frontend actual | Tipos, lint, **86 tests / 17 archivos** y build PASS, 14/10; 10 páginas públicas, seis indexables, 152 entradas de manifiesto. |
| Rust actual | Nueva ejecución del 14/10 con `--no-cache-filter test,audit`: 143 tests, fmt, check y Clippy PASS; se reutiliza sólo compilación/dependencias donde los inputs coinciden. |
| API integral, 14/10 | 137/137 PASS en datos iniciales nuevos; autenticación/OTP, roles, asignaciones, cursos, contenido, backups FULL/delta, inventario 184 casos, concurrencia, canales/vídeo y recuperación de dependencias PASS. |
| OAuth aislado, 14/10 | 61 comprobaciones integradas y nueve escenarios de navegador PASS sobre las imágenes finales; proveedor sintético explícito. [Informe de origen](audits/2026-10-13-google-oauth.md); no acredita Google real. |
| Correo, bajas e infraestructura, 14/10 | 34 comprobaciones correo interno, 102 ciclo de cuenta y suite de infraestructura PASS; sin entregas externas ni escrituras MAIN. |
| Navegador aislado completo, 14/10 | **136/136 casos, 29 archivos y 44 grupos PASS** en el build `5d6501f0`, sin omisiones ni reintentos; mismo frontend/backend que MAIN durante esa ejecución. Después se retiró sólo una línea vacía final de `googleAuthorization.ts` (comparación SHA reconstruida del contenido anterior). El build final repitió los **12 casos OAuth/VPN/copias** y los **36 públicos MAIN**, todos PASS; no se presenta la suite anterior como repetida en el build nuevo. |
| Navegador MAIN, 14/10 | 36 casos PASS de responsive, teclado, navegación y temas. No se usa una cuenta real para pruebas. |
| HTTP/SEO MAIN, 14/10 | Seis páginas estáticas, siete servicios dinámicos, cursos publicados, 404/noindex, TLS y callback no-store/no-referrer PASS. Sin puntuación Lighthouse nueva. |
| Regresión después de limpiar | Protección de administradores, roles ordinarios, logout, aviso/reconexión WSS, cero residuos propios y perfiles ajenos idénticos PASS en la pila aislada (14/10 09:51 UTC). |
| Preservación MAIN | 1.242 registros previos idénticos, archivos de media/backups, volúmenes y clave DPAPI conservados. Adiciones: metadato SQLx 0030 y seis filas de tres conexiones concurrentes Firefox/Windows, ajenas a las pruebas y conservadas por IDs exactos. No se declara ausencia de actividad del usuario. |
| Instaladores externos | Nuevos parser PowerShell/Bash, 18 validadores PowerShell, 20 Linux y tres copias opcionales Linux PASS; seis casos de copias opcionales de ambas plataformas constan en 13/10. Instalación real NOT_RUN. |
| Enlaces | 254 referencias internas y anclas PASS; inventario revisado contra los archivos entregados. |

Evidencia privada: `.run/documentation-release-20261014/`, sin dumps en claro,
claves ni datos personales en Git. La revisión automática de permisos que
impidió los scans del día anterior ya no bloqueó esta ejecución: los scans
previos del 14/10 sí terminaron. Las comprobaciones posteriores se informan por
separado, sin convertir la autorización de publicación en evidencia de push.

### Cierre y comprobación posterior a GitHub

Los commits `259bac8` (OAuth y controles), `b54f28b` (instaladores) y
`37cbad4` (documentación) se publicaron mediante push normal en `main`.
HEAD, origin/main y la referencia remota coincidían en
`37cbad4ba43d1bc2fffbe75a4bb9de7caab0bbaf`; los **66 archivos** estaban
presentes. El SHA del posterior cierre documental se consulta en el historial
de Git y se entrega en la respuesta final, sin intentar incluir su propio SHA
en el contenido del commit.

Después del push: cinco servicios saludables, cuatro healthchecks HTTP 200,
HTTPS/SEO y WSS público PASS; un caso OAuth administrativo y tres casos
VPN/copias PASS en las mismas imágenes sobre datos aislados. Regresión posterior
de protección administrativa, revocación, logout, reconexión y limpieza PASS.
Los 1.242 registros originales, media, backups, volúmenes y clave DPAPI siguen
idénticos. No se crean perfiles ni se realizan escrituras de prueba en MAIN.

La lista explícita de hosts incluye también la dirección LAN configurada;
`nginx -t`, recarga y seis hosts autorizados HTTP 200 PASS. Un Host ajeno
cierra la conexión (444 de Nginx), sin comodines. Se conserva el VBS local ajeno.
Resultado del diff de entrega: **47 archivos modificados, 19 incorporados,
ninguno eliminado**; 13 documentos actualizados o integrados.

SMTP/OTP corporativo/Postmark, Google real, servidores WireGuard/SFTP y pruebas
nativas de instalación continúan pendientes externos según sus respectivas
guías. No se declara PRODUCTION_READY ni despliegue remoto.

### Versión observada en los contenedores

Frontend final: `b0f6f666-6dfa-4dd4-81c8-94eb2c67871a`. Backend SHA-256: `ef186fe65e2ed190738f23f8e5ef46e74d0adca9568462928bcafe2a89f014b3`.
Esquema SQLx: **30**. La aceptación autenticada usa los mismos manifests de
frontend/backend en la pila aislada; MAIN se comprueba por HTTPS/WSS sin
escrituras de prueba sobre cuentas reales. Los tags no sustituyen estos IDs.

| Servicio | Manifest de la plataforma ejecutada | Inicio UTC |
|---|---|---|
| `nginx` | `sha256:ccc71cacb89c8e9c06d1144228c7ac51839f34d5160e2d760c21d1a9ed0b035c` | 2026-10-14T08:48:38.052313389Z |
| `frontend` | `sha256:2ed7326551fa220f497dae508fd879c260f38cfabe970b90b5184dc680908574` | 2026-10-14T09:53:34.849732813Z |
| `backend` | `sha256:10c73c9ac8d3795ee024e5f47448bf247278e539820c404bfa9d772664b00e43` | 2026-10-14T08:24:02.9063779Z |
| `postgres` | `sha256:aae694d2425a70d17ed124512323790c419ea07a846b0469105bb7bb9e3550a9` | 2026-10-14T08:08:19.496647674Z |
| `redis` | `sha256:df78b20020e4bb220cf4763fea7e524d9a02a36c4f90a0ca42dce3c185987f8e` | 2026-10-14T08:08:26.684195992Z |

### Fallos reproducidos y correcciones de esta entrega

- El runner reutilizado conservaba resultados académicos y destinos anteriores:
  falló la preparación de un destino y luego el caso de prerrequisitos. Se
  repitió con volúmenes sintéticos nuevos, conservando todos los anteriores;
  137/137 PASS sin cambiar controles ni borrar datos MAIN.
- El runner conservador nuevo tuvo errores de montaje, comillas y referencia
  a un índice OCI local sin tag. Se corrigieron sus auxiliares privados, se
  retuvieron tags propios y se completaron los casos pendientes; no se retiró
  cobertura ni se confundió falta de imagen con caída del backend.
- El archivo «public» incluía logins E2E: se detuvo en MAIN después de un intento
  con cuenta inexistente. No hubo sesión creada, modificación de filas ni
  adiciones inesperadas. Allí sólo se seleccionan casos públicos revisados;
  la autenticación se prueba en la pila aislada.
- Un selector dependía de un nombre fijo de curso retirado del catálogo. Ahora
  verifica foco, viewport y cierre del último curso real, sin quitar el test.
  Las expectativas de activar Google sin verificar se sustituyen por UI
  deshabilitada y API manipulada rechazada.
- El verificador de sitemap esperaba diez rutas estáticas antiguas. Ahora
  exige las seis actuales sin duplicados y comprueba también servicios
  dinámicos, cursos y las protecciones previas.
- Nginx ocultaba el `no-referrer` del callback y aplicaba su política general.
  Se añadió política específica en el edge, conservando HSTS/nosniff/DENY y
  sin registrar la ruta. Rebuild y nueva prueba HTTPS PASS; no se relajó la
  aserción para aceptar el defecto.
- Un test de moderación asumía abierto el canal Alumnos aunque hubiera mensajes
  del personal. Selecciona ahora ese canal explícitamente antes de comprobar
  limpieza, cancelación, foco y accesibilidad; no cambia el chat del producto.
- El test de actualización de cursos exigía 14 registros. Ahora compara los
  IDs de PostgreSQL en todos los estados visibles (incluidos borradores,
  excluidos los eliminados lógicamente), y valida creación/retirada con un
  registro sintético único. No se modifica el catálogo para obtener un PASS.
- Los builds tienen un UUID incorporado a HTML/JavaScript: no se aceptó una
  supuesta equivalencia de archivos entre builds distintos. Se excluyó
  `frontend/e2e` del contexto de imagen, manteniendo los 136 casos en la suite
  del host; cambios de selectores reutilizan ahora la misma imagen y versión.
  La aceptación final identifica imágenes iguales en MAIN y E2E.

- El test de categorías eliminaba el curso A2 de la semilla y rompía ejecuciones
  posteriores. Ahora elimina sólo su curso TEMP por ID exacto, restaura la
  categoría editada y contrasta el catálogo con PostgreSQL. No se repone una
  semilla ni se oculta una diferencia para forzar el resultado.
- Los contextos manuales del examen apuntaban al puerto de desarrollo 8011.
  Usan ahora el origen HTTPS de producción de Playwright; ambos exámenes PASS.
- El estado VPN coincidía con el texto de dos destinos externos. El selector
  ahora identifica el párrafo VPN; los tres casos de supervisión, permisos y
  responsive PASS sin cambiar el estado mostrado por la aplicación.

Tres logins normales de Firefox/Windows crearon sus sesiones y conexiones durante
la auditoría. Se contrastaron actor, rol, fecha y relación por IDs exactos sin
mostrar identidades, cookies ni claves. No se cerraron ni modificaron. La
comparación de registros anteriores sigue sin diferencias; sólo se exceptúan
esas seis adiciones conocidas y el metadato SQLx, no tablas ni rangos de fechas.

### Archivos incluidos en la entrega

**Documentación reutilizada o integrada**

- [ADMIN.md](../ADMIN.md)
- [README.md](../README.md)
- [SECURITY.md](../SECURITY.md)
- [docs/BACKUPS_SIMPLIFIED.md](BACKUPS_SIMPLIFIED.md)
- [docs/BACKUP_RESTORE.md](BACKUP_RESTORE.md)
- [docs/DEPLOYMENT.md](DEPLOYMENT.md)
- [docs/GOOGLE_AUTH.md](GOOGLE_AUTH.md)
- [docs/LOCAL_VALIDATION.md](LOCAL_VALIDATION.md)
- [docs/audits/2026-10-13-google-oauth.md](audits/2026-10-13-google-oauth.md)
- [docs/google-oauth-operations.md](google-oauth-operations.md)
- [docs/infrastructure-operations.md](infrastructure-operations.md)
- [docs/mail-api-smtp-operations.md](mail-api-smtp-operations.md)
- [scripts/backup-external/README.md](../scripts/backup-external/README.md)

**Instaladores incorporados**

- [scripts/backup-external/linux/instalar-servidor-backup-linux.sh](../scripts/backup-external/linux/instalar-servidor-backup-linux.sh)
- [scripts/backup-external/windows/Instalar-Servidor-Backup-UASSpain.ps1](../scripts/backup-external/windows/Instalar-Servidor-Backup-UASSpain.ps1)

**Código, configuración y regresión previamente autorizados**

- [.dockerignore](../.dockerignore)
- [backend-rust/migrations/0030_google_oauth_authorization_code.sql](../backend-rust/migrations/0030_google_oauth_authorization_code.sql)
- [backend-rust/src/app.rs](../backend-rust/src/app.rs)
- [backend-rust/src/auth.rs](../backend-rust/src/auth.rs)
- [backend-rust/src/db.rs](../backend-rust/src/db.rs)
- [backend-rust/src/google_oauth.rs](../backend-rust/src/google_oauth.rs)
- [backend-rust/src/google_oidc.rs](../backend-rust/src/google_oidc.rs)
- [backend-rust/src/lib.rs](../backend-rust/src/lib.rs)
- [backend-rust/src/runtime_config.rs](../backend-rust/src/runtime_config.rs)
- [docker-compose.google-e2e.yml](../docker-compose.google-e2e.yml)
- [frontend/e2e/admin-courses-refresh.spec.ts](../frontend/e2e/admin-courses-refresh.spec.ts)
- [frontend/e2e/backups.spec.ts](../frontend/e2e/backups.spec.ts)
- [frontend/e2e/course-categories.spec.ts](../frontend/e2e/course-categories.spec.ts)
- [frontend/e2e/google-auth.spec.ts](../frontend/e2e/google-auth.spec.ts)
- [frontend/e2e/google-oauth-admin.spec.ts](../frontend/e2e/google-oauth-admin.spec.ts)
- [frontend/e2e/infrastructure.spec.ts](../frontend/e2e/infrastructure.spec.ts)
- [frontend/e2e/panel-modals.spec.ts](../frontend/e2e/panel-modals.spec.ts)
- [frontend/e2e/panels.spec.ts](../frontend/e2e/panels.spec.ts)
- [frontend/e2e/public.spec.ts](../frontend/e2e/public.spec.ts)
- [frontend/e2e/vpn-backups-ui.spec.ts](../frontend/e2e/vpn-backups-ui.spec.ts)
- [frontend/nginx.conf](../frontend/nginx.conf)
- [frontend/src/App.tsx](../frontend/src/App.tsx)
- [frontend/src/api/apiClient.ts](../frontend/src/api/apiClient.ts)
- [frontend/src/components/admin/AdminSidebar.tsx](../frontend/src/components/admin/AdminSidebar.tsx)
- [frontend/src/components/admin/AdminTopbar.tsx](../frontend/src/components/admin/AdminTopbar.tsx)
- [frontend/src/components/admin/BackupDestinationForm.tsx](../frontend/src/components/admin/BackupDestinationForm.tsx)
- [frontend/src/components/admin/BackupHistory.tsx](../frontend/src/components/admin/BackupHistory.tsx)
- [frontend/src/components/admin/BackupInventory.tsx](../frontend/src/components/admin/BackupInventory.tsx)
- [frontend/src/components/admin/GoogleOAuthForm.tsx](../frontend/src/components/admin/GoogleOAuthForm.tsx)
- [frontend/src/components/auth/AuthModal.tsx](../frontend/src/components/auth/AuthModal.tsx)
- [frontend/src/components/auth/GoogleSignInButton.tsx](../frontend/src/components/auth/GoogleSignInButton.tsx)
- [frontend/src/lib/backups.ts](../frontend/src/lib/backups.ts)
- [frontend/src/lib/googleAuthorization.ts](../frontend/src/lib/googleAuthorization.ts)
- [frontend/src/lib/googleCallbackHandoff.test.ts](../frontend/src/lib/googleCallbackHandoff.test.ts)
- [frontend/src/lib/googleCallbackHandoff.ts](../frontend/src/lib/googleCallbackHandoff.ts)
- [frontend/src/lib/infrastructure.test.ts](../frontend/src/lib/infrastructure.test.ts)
- [frontend/src/lib/infrastructure.ts](../frontend/src/lib/infrastructure.ts)
- [frontend/src/main.tsx](../frontend/src/main.tsx)
- [frontend/src/pages/AdminPanel.tsx](../frontend/src/pages/AdminPanel.tsx)
- [frontend/src/pages/GoogleOAuthCallback.tsx](../frontend/src/pages/GoogleOAuthCallback.tsx)
- [frontend/src/pages/admin/AdminBackups.tsx](../frontend/src/pages/admin/AdminBackups.tsx)
- [frontend/src/pages/admin/AdminConfiguracion.tsx](../frontend/src/pages/admin/AdminConfiguracion.tsx)
- [frontend/src/pages/admin/AdminInfrastructure.tsx](../frontend/src/pages/admin/AdminInfrastructure.tsx)
- [frontend/src/pages/admin/AdminVpn.tsx](../frontend/src/pages/admin/AdminVpn.tsx)
- [nginx/allowed_hosts.conf](../nginx/allowed_hosts.conf)
- [nginx/nginx.conf](../nginx/nginx.conf)
- [scripts/e2e/e2e-google-oauth.mjs](../scripts/e2e/e2e-google-oauth.mjs)
- [scripts/e2e/e2e_api.py](../scripts/e2e/e2e_api.py)
- [scripts/e2e/google-oidc-provider.mjs](../scripts/e2e/google-oidc-provider.mjs)
- [scripts/e2e/realtime-nginx.conf](../scripts/e2e/realtime-nginx.conf)
- [scripts/e2e/verify-public-site.mjs](../scripts/e2e/verify-public-site.mjs)

El archivo local `scripts/start-watch-hidden.vbs` se conserva sin incluirlo; no
se eliminan archivos históricos, backups ni secretos para preparar los commits.

### Catálogo documental y prioridad

Las referencias operativas son actuales; describen capacidades y requisitos,
no una certificación de que todos los servicios empresariales estén activos.

| Documento de referencia | Finalidad y revisión |
|---|---|
| [README](../README.md), [ADMIN](../ADMIN.md) | Entrada única, inventario y procedimientos de los tres roles; actualizados contra rutas/componentes. |
| [SECURITY](../SECURITY.md) | Controles por módulo, evidencia y riesgos pendientes; separa baseline histórica. |
| [Despliegue](DEPLOYMENT.md) | Operación, arquitectura, APIs y entidades; reconstrucción histórica expresamente separada del arranque actual. |
| [REPAIR_WORKFLOW](REPAIR_WORKFLOW.md), [AGENTS](../AGENTS.md) | Gates obligatorios; conservados sin cambiar permisos ni relajar pruebas. |
| [Backup/recovery](BACKUP_RESTORE.md), [copias simplificadas](BACKUPS_SIMPLIFIED.md) | Destinos, FULL/deltas, inventario y recuperación; se complementan, no son dos motores. |
| [Infraestructura](infrastructure-operations.md) | Plataformas, agente, VPN, destinos y entrega al técnico; navegación de editores actualizada. |
| [Instaladores](../scripts/backup-external/README.md) | Inventario, parámetros, instalación Windows/Linux y límites de verificación; dos scripts disponibles. |
| [Correo](mail-api-smtp-operations.md) | API/SMTP, cola, estados, diagnóstico 400/503 y validación corporativa pendiente. |
| [Google OAuth](google-oauth-operations.md), [entrada de compatibilidad](GOOGLE_AUTH.md) | Una sola guía de activación segura; la segunda conserva enlaces sin duplicar el procedimiento antiguo. |
| [Ciclo de cuenta](account-lifecycle-operations.md) | Baja lógica, reactivación, auditoría, conservación y retención pendiente. |
| [Asignaciones](STUDENT_INSTRUCTOR_ASSIGNMENT.md) | Relación alumno/instructor y permisos existentes; sin reasignaciones automáticas inventadas. |
| [Cursos públicos](COURSE_PUBLIC_PAGES.md) | Publicación, slugs, estados y temario; no matrícula ni compra automática. |
| [Assets](FRONTEND_ASSETS.md) | Publicación de chunks y recuperación de pestañas; separado de mediciones históricas. |
| [Cuentas locales](TEST_ACCOUNTS.md) | Referencia operativa restringida; no publica contraseñas ni autoriza usar datos reales en tests. |
| [Incidentes](../infra/monitoring/INCIDENT-RUNBOOK.md) | Diagnóstico, preservación de evidencia y recuperación supervisada. |
| [Excepciones Rust](../backend-rust/SECURITY_ADVISORY_EXCEPTIONS.md) | Alcance/condiciones del advisory; no sustituye escaneo actual. |

Informes históricos conservados como evidencia fechada; su alcance se revisa en
el contexto de su commit/imagen, no como instrucciones nuevas:

| Área | Documentos y finalidad |
|---|---|
| Auditorías iniciales | [Login](../01_UASSPAIN_AUDITORIA_COMPLETA_LOGIN.md), [paneles](../02_UASSPAIN_AUDITORIA_PANELES_ADMIN_INSTRUCTOR_ALUMNO.md), [SEO/seguridad](../UASSPAIN_SEO_DOCKER_LOGIN_SECURITY_AUDIT.md): diagnóstico y pruebas anteriores. |
| Frontend y publicación anterior | [Frontend 04/10](FRONTEND_AUDIT.md), [assets](FRONTEND_ASSETS_REVALIDATION.md), [Docker 06/10](DOCKER_REDEPLOY_VALIDATION_20261006.md), [responsive 09/10](audits/2026-10-09-responsive.md), [release 13/10](audits/2026-10-13-docker-github-release.md). |
| Comunicación | [General](COMMUNICATIONS_VALIDATION.md), [sesión/chat/vídeo](SESSION_CHAT_VIDEO_VALIDATION.md), [paralelo](PARALLEL_STUDENT_CHAT_VALIDATION.md), [concurrencia](CONCURRENT_SESSIONS_VALIDATION.md), [privado](PRIVATE_CHAT_CONCURRENCY_VALIDATION.md), [09/10](audits/2026-10-09-chat-video.md). |
| Instructor y alumno | [Instructor 09/10](audits/2026-10-09-instructor.md), [accesos 10/10](audits/2026-10-10-instructor-access.md), [alumno 10/10](audits/2026-10-10-student-panel.md). |
| Autenticación y contacto | [Arranque](audits/2026-10-09-startup-login.md), [sesiones independientes](audits/2026-10-11-independent-sessions.md), [contacto fase 05](audits/2026-10-10-contact.md), [OAuth aislado](audits/2026-10-13-google-oauth.md). |
| Operación | [Backups 09/10](audits/2026-10-09-backups.md), [inventario 12/10](audits/2026-10-12-backup-inventory.md), [correo](audits/2026-10-12-mail-system.md), [bajas](audits/2026-10-12-account-lifecycle.md), [infraestructura](audits/2026-10-12-infrastructure.md). |

Los tres archivos de auditoría de raíz se mantienen por referencias/contexto;
no reemplazan las guías vigentes. El inventario mecánico privado registra para
cada documento título, finalidad, clase, secciones y enlaces; su comprobación
no se presenta como repetición de todas las pruebas históricas.

## Evidencias históricas anteriores

Los apartados que siguen describen el estado de sus fechas. Las siete
migraciones, recuentos, políticas Google y rutas antiguas mencionadas no son
el procedimiento vigente; prevalecen el código actual y las guías enlazadas.

## Estado histórico — 4 de octubre de 2026: reparación del login

Se reprodujo en Chromium sobre Docker real: PostgreSQL esperaba su clave
protegida tras un reinicio, el backend no arrancaba y login/configuración
Google devolvían 502. El formulario presentaba ese 502 como contraseña
incorrecta. Se recuperó la base con su clave DPAPI existente, sin cambiar
cuentas, contraseñas, esquema ni volumen. El formulario distingue errores
de servicio, red y timeout de un rechazo real 401.

Administrador, instructor multirrol y tres alumnos acceden con sus
credenciales existentes y mantienen la ruta del panel al refrescar; las
cookies son HttpOnly, Secure y SameSite=Strict. La copia bootstrap de la
contraseña administrativa está desactualizada y no se usa para concluir
que la contraseña indicada por el usuario haya dejado de funcionar.

Tipos, lint, build y 29 tests frontend pasan. Nueve pruebas de navegador
del login y Google pasan contra el frontend compilado HTTPS con proveedor
simulado exclusivamente en las pruebas. Se corrige también la carrera
Compose/healthcheck de un PostgreSQL ya marcado unhealthy tras desbloquearlo.
La recuperación automática por usuario Windows se instala con token
Interactive/Limited y reutiliza el helper DPAPI; un reinicio real recuperó
PostgreSQL y backend sanos en 11,2 segundos. Se conserva el gate completo
del cifrado, incluido rechazo de clave incorrecta y ausencia de montaje
persistente en claro.
También se comprobó que una parada manual permanece detenida y que la
recuperación automática se produce al iniciar de nuevo el contenedor.

Google tiene configuración efectiva habilitada en PostgreSQL. En el flujo
real API/configuración, challenge y SDK responden 200, pero el iframe oficial
devuelve 403 y «The given origin is not allowed for the given client ID».
Queda pendiente autorizar `https://localhost` y `https://www.uasspain.com` en
Google Cloud y completar el acceso con la cuenta del titular; no se declara
probado el login externo. El dominio www actualmente redirige a
`https://uasspain.com`, sirve otra web y su API OAuth devuelve 404. Si se
conserva esa redirección al desplegar esta aplicación, también se debe autorizar
el origen final `https://uasspain.com`. Evidencia local sin contraseñas ni
tokens: `.run/login-audit/`.

## Estado anterior — 3 de octubre de 2026: integración Google restaurada

Por petición posterior del usuario se restaura Google Identity Services con
botón oficial visible y adaptable, estados de disponibilidad, reintentos ante
fallos de configuración/SDK/nonce, renovación del nonce antes de caducar y
rechazo de tokens inválidos sin reintento de refresh de sesión. El backend
conserva firma RS256/JWKS, claims, nonce de un uso, vínculo de identidad estable,
roles y política de OTP. No se modifican las migraciones.

Rust: 52 tests, formato, check y Clippy pasan. Frontend: tipos, lint, 4 tests
unitarios y build pasan. Cuatro pruebas Chromium con proveedor simulado pasan:
configuración ausente y recuperación, nonce fallido y cuenta inexistente,
token inválido sin refresh, y SDK fallido con recuperación. Comprueban además
redirección al rol instructor y anchuras de 320, 390 y 1440 píxeles.

`GOOGLE_PROVIDER_LOGIN=BLOCKED`: no existe un Client ID real autorizado en esta
instalación. Los mocks del navegador no emiten sesiones del backend ni prueban
un login real contra Google. La [guía de activación](GOOGLE_AUTH.md) y el script
de configuración local dejan preparada esa operación. Las cuentas de prueba
siguen activas y asignadas; la copia DPAPI de sus contraseñas se conserva.

La aplicación compilada por HTTPS pasa la verificación de CA/hostname,
cabeceras CSP/COOP, estado Google, botón visible sin configuración, login real
del administrador y login API/Chromium de instructor y alumno. Se mantienen la
asignación y la denegación de permisos administrativos. La evidencia está en
`.run/uasspain/google-restoration-verification.json`. Los cinco servicios están
saludables y el verificador de almacenamiento cifrado pasa: tres cuentas con
PII no vacía cifrada y Argon2id, sin privilegios PostgreSQL añadidos, con las
siete migraciones intactas.

## Validación anterior — 3 de octubre de 2026: cuentas de prueba y retirada de Google

La instalación principal conserva el administrador y ahora contiene también un
instructor y un alumno de prueba activos, con un único rol por cuenta. El alumno
está asignado al instructor. Las contraseñas se generan aleatoriamente, se
hashean con Argon2id mediante el backend y su copia de acceso local está protegida
por DPAPI. Consulte [las cuentas de prueba](TEST_ACCOUNTS.md).

Se retira la autenticación Google por petición del usuario: botón, componentes,
librería npm, handlers y endpoints, variable de configuración, permisos CSP
específicos e indicadores/notificaciones del panel. Las siete migraciones y el
esquema histórico se mantienen sin cambios.

Validación ejecutada sobre las imágenes finales y la aplicación principal:

- Rust: 49 tests pasan; formato, check y Clippy con `-D warnings` pasan.
- Frontend: tipos, lint, 4 tests y build con prerender pasan.
- API HTTPS con CA y hostname verificados: login de los tres roles, emails de
  prueba en mayúsculas, asignación instructor/alumno y permisos pasan.
- Chromium móvil: login, panel y persistencia tras recarga de ambas cuentas
  pasan; no hay errores JavaScript ni solicitudes al SDK/configuración Google.
- Instructor y alumno: API administrativa y cambio a rol admin devuelven 403;
  el alumno no puede consultar el perfil del administrador.
- Las tres rutas antiguas de Google devuelven 404 con sesión autenticada.
- PostgreSQL: tres perfiles activos, PII no vacía cifrada, hashes Argon2id,
  cuentas de prueba sin `is_staff`/`is_superuser` y 7 migraciones válidas.
- Los cinco servicios Docker están saludables; PostgreSQL conserva su volumen
  cifrado y el arranque exige la clave DPAPI.

La evidencia local está en `.run/uasspain/test-accounts-verification.json`.
Los resultados fechados que siguen documentan las auditorías anteriores.

La validación utiliza el entorno disponible en este equipo. La pila principal y sus datos se han conservado. Las pruebas destructivas de fixtures, restauración y caída de dependencias se ejecutan exclusivamente en `uasspain-e2e`; la comprobación de los cinco servicios con TLS utiliza `uasspain-audit`, con volúmenes independientes y puertos 8085/8445.

## Correcciones aplicadas

- Exámenes: intentos persistentes, selección sin duplicados, respuestas guardadas, reloj y autocorrección en el servidor, preguntas inmutables, prerrequisitos y envío idempotente. Los resultados usan notas numéricas compatibles con los paneles.
- Acceso: aislamiento de mensajes y registros, operaciones limitadas a alumnos asignados, revocación de sesiones y WebSockets, y reenvío OTP que conserva cuentas ya verificadas.
- Chat: salas de personal coherentes entre cliente y servidor, mensajes persistidos y actualización entre participantes sin recargar.
- Videollamadas: audio/vídeo WebRTC, salas autorizadas por el servidor, llamadas de grupo, controles de cámara/micrófono, reconexión de señalización y liberación de dispositivos. Configuración TURN opcional mediante secreto.
- Persistencia: migraciones 0005/0006 para intentos y borrado transaccional de perfiles/exámenes, conservando contenido compartido y resultados históricos cuando corresponde.
- Operación: readiness acotado, tolerancia a caída de Redis, respuestas 503 ante fallos de conexión PostgreSQL, proxy sin query strings/referer en logs y protección contra cabeceras IP suministradas por el cliente.
- Seguridad y reproducibilidad: dependencias corregidas, runtime Ubuntu 26.04 actualizado, builds locales desde lockfiles y scripts Bash normalizados a LF.

## Evidencia ejecutada

| Comprobación | Resultado |
| --- | --- |
| Rust desde cero, sin capas ni caches Cargo | Build, fmt, check y Clippy con `-D warnings`; 47 tests pasan |
| Frontend desde instalación y build limpios | Tipos, lint, build y 2 tests pasan |
| Suite API aislada | 108/108 pasan; incluye permisos, uploads, chat y backups/restauraciones locales y dos destinos SFTP |
| Navegador Chromium | 11/11 pasan: 36 secciones en escritorio/móvil, sesión, autorización, chat, cursos, exámenes y medios WebRTC de tres participantes |
| Exámenes vencidos y envíos concurrentes | Respuestas tardías rechazadas; snapshot conservado; duración del servidor; un único resultado |
| Borrado de perfiles | Instructor ajeno rechazado; sesión revocada; alumnos/contenido compartido conservados; dependencias eliminadas |
| Carga local acotada | 400 peticiones, 24 concurrentes, cero errores; p95 de 389,8 ms (límite de la prueba: 2 segundos) |
| Caída y recuperación | PostgreSQL y Redis detenidos realmente; liveness 200, readiness 503 acotado y recuperación con autenticación/persistencia |
| Pila TLS de cinco servicios | Servicios saludables; CA verificada; PostgreSQL TLS 1.3; migraciones 1–6; roles sin superusuario; Redis exige autenticación y rechaza CONFIG |
| Frontend compilado por HTTPS | Inicio y formación sin errores de ejecución, consola ni respuestas 5xx; revisión de capturas |
| Dependencias | npm audit: cero vulnerabilidades; cargo-audit pasa con la excepción documentada de RSA no activa en el árbol seleccionado |
| Imágenes backend/frontend/nginx/postgres/redis | Trivy: cero HIGH/CRITICAL, incluyendo vulnerabilidades sin parche; escaneo por archivos de imagen, sin socket Docker |
| Secretos | Gitleaks pasa en árbol e historial; detect-secrets pasa incluyendo archivos nuevos y baseline; excepciones puntuales exclusivamente para fixtures ficticios |
| Scripts locales | Sintaxis PowerShell/Python/Bash pasa; 4 tests del comparador de secretos verifican reubicación, duplicados, valores nuevos y cambio de archivo |

Los logs, JSON de escaneo y capturas locales se conservan en `.run/`, excluido de Git. Los archivos de imágenes exportadas y la pila E2E se retiran al finalizar. Los comandos reproducibles de validación figuran en README y en `DEPLOYMENT.md`; la suite completa es `scripts/e2e/run-e2e.ps1`.

## Ampliación SEO, login y responsive

Validación local del segundo documento, sobre el mismo proyecto y sin modificar
los datos de la pila principal:

| Comprobación | Resultado |
| --- | --- |
| Backend final | Build release, fmt, check y Clippy con `-D warnings`; 52 tests pasan |
| Frontend final | Tipos, lint, build/prerender y 4 tests pasan |
| API y operación | 108/108; email trim/lower/mixed resuelve la misma identidad; duplicados de email 409; cambios inválidos 400; carga 400 peticiones, 24 concurrentes, cero errores, p95 429,8 ms; caída/recuperación PostgreSQL y Redis pasa |
| Navegador | 33/33; 36 secciones de tres roles en las 14 anchuras de 320–2560 (504 comprobaciones), navegación móvil, 4 páginas públicas en dark/light, menús con poca altura, foco/Escape, sesión y doble submit |
| HTML compilado por HTTPS | 27 URLs indexables del sitemap pasan: H1 y títulos únicos, canonical, CSP, noindex privado/API, 404 reales; curso publicado con introducción/temario, JSON-LD y escaping; pendiente excluido; CA y hostname verificados |
| SEO/render | 30 componentes públicos prerenderizados; 27 URLs indexables y tres páginas legales noindex; cursos publicados compuestos en vivo por Nginx/SSI, sitemap dinámico sin pendientes |
| Lighthouse 13.5.0 móvil, HTTPS local | Inicio: performance 86, accesibilidad 100, buenas prácticas 96, SEO 100; formación con cursos publicados/pendientes: 94/100/96/100. CLS 0 en ambas |
| Seguridad | npm audit 0; Gitleaks árbol 0; detect-secrets sin valores nuevos. Cargo.toml/Cargo.lock no cambian: se conserva el cargo-audit y árbol RSA no activo ya verificados en la baseline |
| Imágenes exactas de la pila final | Backend, frontend, Nginx, PostgreSQL y Redis: Trivy 0 HIGH/CRITICAL, sin `ignore-unfixed`, por archivos de imagen sin socket Docker |
| Scripts locales | Parseo PowerShell pasa; 4 tests del comparador de secretos pasan |

Inicio queda por debajo del objetivo orientativo de rendimiento 90: LCP móvil
simulado de 3,9 s y FCP de 2,0 s. El HTML inicial permanece visible mientras carga
React; las fuentes se sirven localmente y el login carga bajo demanda. El informe
mide aproximadamente 132 KB comprimidos del bundle inicial y 38 KB del módulo
compartido de red, con unos 81 KB estimados sin uso en esa página. Las buenas
prácticas pierden cuatro puntos por las respuestas 401 esperadas de la consulta
de sesión/refresh anónima. No se ocultan esos errores ni se presentan estas
métricas locales como capacidad de producción. Chromium omite la confianza del
certificado únicamente al medir Lighthouse; el verificador HTTPS independiente
comprueba CA y hostname sin excepciones.

## Retirada de GitHub Actions

Por petición del usuario se retiran los cuatro workflows, el script de
diagnóstico y la actualización de dependencias del ecosistema `github-actions`.
Se elimina la documentación operativa de CI y publicación automática de imágenes.
La compilación, los tests y los escaneos se mantienen como herramientas locales;
Docker Compose construye frontend/backend desde el código del repositorio.
Las actualizaciones de dependencias Cargo, npm y Docker de Dependabot no
contienen workflows y se conservan.

No se ha ejecutado la prueba de una rama temporal ni se ha instalado un runner.
No se crean repositorios públicos ni se cambia la visibilidad de UASSpain.

La API confirma `enabled: false` para Actions en `miguel110980/uasspain`, que
permanece privado. No hay secrets, variables, runners ni entornos asociados.
La retirada pasa typecheck, lint y los cuatro tests frontend; Compose valida y
`up --no-build --no-recreate --wait` confirma los cinco contenedores saludables.
El YAML de Dependabot valida y Gitleaks pasa en árbol e historial. `/healthz` y `/readyz`
responden 200 por HTTPS con CA y hostname verificados; readiness confirma
PostgreSQL y Redis disponibles. No cambia código de aplicación, imágenes,
volúmenes ni datos.

## Inspección de usuarios de la instalación activa

La inspección de solo lectura confirma que el backend `uasspain-backend` usa
`postgres`, base `uasspain`, rol `uasspain_app`, sin override `DATABASE_URL`.
`auth_user`, `accounts_userprofile` y `core_auditlog` contienen cero filas.
La otra base, `postgres`, no contiene tablas de usuarios de la aplicación.
Los dos contextos Docker locales muestran la misma pila y el volumen de backups
está vacío. `BOOTSTRAP_ADMIN_ENABLED=false`; no se crean cuentas para completar
la auditoría. En esa inspección, identificación, login y aislamiento de los tres usuarios reales
quedaron BLOCKED hasta localizar su base o copia original. No se puede verificar
el algoritmo de una contraseña existente cuando no hay filas; el código genera
Argon2id y la base conserva el índice UNIQUE sobre `email_lookup`.

El campo de email del login conservaba únicamente minúsculas porque saneaba
cada pulsación. Ahora conserva la entrada y normaliza al enviar. Typecheck,
lint y build Docker pasan. Chromium contra HTTPS de la instalación real, sin
mocks ni envío de login, demuestra `ABC → abc` antes y `ABC → ABC` después.
Se actualiza únicamente el frontend; backend y PostgreSQL conservan sus
contenedores. No se cambian usuarios, roles, emails, contraseñas ni datos.

### Aprovisionamiento posterior autorizado

El usuario confirma que las cuentas no existían y autoriza crear únicamente
su administrador. Se utiliza el bootstrap oficial del backend, con la
contraseña solicitada en un archivo local de secretos durante la creación.
El backend se reconstruye y aplica las migraciones 1–7. La base contiene ahora
un único usuario y perfil: activo, verificado, rol/roles `admin`, flags staff y
superuser, contraseña Argon2id. DNI y fecha de nacimiento se comprueban desde
el perfil autenticado; los datos personales y la contraseña no se versionan.

Cuatro logins reales — minúsculas, mayúsculas, mixto y espacios exteriores —
resuelven el mismo ID. La API administrativa responde 200 y Chromium accede a
`/admin` mediante el login real. Solicitar sesión como instructor o alumno con
esta cuenta devuelve 403. No se crean cuentas para esos dos roles.

Tras crear la cuenta se deshabilita el bootstrap en configuración y runtime,
se retiran los datos personales del archivo de entorno y se reemplaza la
credencial temporal de bootstrap por una aleatoria sin modificar el hash de la
cuenta. Los scripts temporales de validación no forman parte del repositorio.

## Reconstruccion PostgreSQL cifrada: instalacion activa

Se crea una base desde cero en el proyecto aislado
`uasspain-rebuild-20261003`, usando sin modificar las migraciones SQLx 1–7.
La comparacion literal con la base original confirma 40 tablas, 411 columnas,
492 restricciones de catalogo y 194 indices, con los mismos checksums de
migracion. No se simplifica el esquema. El administrador real se recupera de
la copia cifrada, conservando UUID, hash y campos cifrados; no se crean usuarios
adicionales ni se resetean contrasenas.

La copia completa usa pg_dump custom y AES-256-GCM, sin archivo intermedio
en claro. Se verifica autenticacion/checksums y se restaura realmente en otra
base temporal. pg_restore reescribe de forma equivalente dos CHECK de estado
con ANY y casts de arrays; la comparacion del drill normaliza exclusivamente
esas dos formas. La base creada por migraciones coincide literalmente.

Pasan PII con prefijo `v1:`, password Argon2id, credenciales PostgreSQL SCRAM,
runtime sin privilegios elevados, SQLx de solo lectura para runtime, backup sin
DML y rechazo real de DDL/DML prohibido. Se revocan privilegios PUBLIC de base,
esquema y funciones. Backend/PostgreSQL usan TLS y una conexion real
`verify-full` pasa; la misma conexion con TLS deshabilitado es rechazada.

Login HTTPS con CA y hostname verificados y login Chromium pasan contra el
candidato. Se comprueban los datos personales sin publicarlos. Una asignacion
temporal de los tres roles sobre la copia aislada demuestra cambio de sesion y
403 del endpoint administrativo de politica de autenticacion para
instructor/alumno. Al terminar, el perfil vuelve a tener unicamente admin y se
cierra la sesion. `/api/system/status/` es un endpoint de estado publico y no
se usa como evidencia de aislamiento administrativo.

El build audit Rust pasa 52 tests, fmt, check y clippy con warnings denegados.
Compose y la sintaxis Node/PowerShell validan; Gitleaks no encuentra secretos
en el arbol distribuible.
El usuario confirma BitLocker desactivado y mantiene obligatorio el cifrado
completo de PostgreSQL. Se implementa gocryptfs 2.6.1-r6 dentro del contenedor
PostgreSQL, con AES-256-GCM, HKDF y nombres cifrados. Se conserva la imagen base
PostgreSQL 18.6 y las siete migraciones, sin modificar su contenido.

La instalacion principal ya usa exclusivamente
`uasspain-rebuild-20261003_postgres_ciphertext`. No hay volumen persistente bajo
PGDATA: la imagen cifrada elimina VOLUME heredado y monta solo ciphertext;
la vista descifrada, su padre y la entrega de clave son FUSE/tmpfs. WAL,
temporales, tablespaces por defecto y logs quedan dentro del montaje cifrado.
La clave aleatoria de 32 bytes se protege con DPAPI CurrentUser, se entrega
por stdin y se borra de tmpfs tras montar. No aparece en env, argv ni logs.
El postmaster tiene CapEff cero; SYS_ADMIN se usa solo para montar FUSE.

Se detecta swap WSL sin cifrar y se guarda `[wsl2] swap=0` en la configuracion
del usuario. Solo Docker Desktop estaba activo en WSL; se detienen ordenadamente
las dos pilas antes de reiniciarlo. `/proc/swaps` confirma ausencia de swap.
Los nuevos proyectos conservan volumen independiente incluso despues de
configurar el volumen promovido en `.env`.

**POSTGRES_ACTIVE_STORAGE_ENCRYPTION = PASS; ACTIVATION = PASS.** Se confirma
lectura raw de archivos con nombres cifrados sin clave, rechazo de clave
incorrecta, PGDATA sobre fuse.gocryptfs, clave temporal ausente y TLS verificado.
Un reinicio real sin clave mantiene PostgreSQL inaccesible y no crea PGDATA en
claro; al entregar la clave DPAPI recupera los mismos datos y los cinco servicios
quedan saludables. El entrypoint TLS tambien rechaza un montaje ausente.
Chromium y HTTPS con CA/hostname pasan en `https://localhost`, con el mismo
administrador, sus datos y password, y rechazo de sesiones instructor/alumno.
El test multirrol se realiza exclusivamente sobre la copia aislada y se restaura
admin como unico rol antes de promover. No se crean otras cuentas.

Los cuatro volumenes PostgreSQL antiguos se archivan con AES-256-GCM y una
subclave de la raiz DPAPI de almacenamiento. Pasa roundtrip autenticado de los
cuatro y restauracion fisica real con PostgreSQL y el administrador original.
La revision automatica rechazo inicialmente eliminar las copias originales;
tras autorizacion expresa del usuario se eliminan solo esos cuatro volumenes
desconectados. Se conservan los archivos cifrados y el backup logico original.
Los contenedores/redes temporales se retiran; quedan exactamente cinco servicios.
Trivy sobre la nueva imagen PostgreSQL cifrada detecta 0 HIGH/CRITICAL,
incluyendo hallazgos sin parche. No se certifica cifrado de todo Windows ni
borrado forense de bloques historicos del VHDX; el perfil DPAPI debe preservarse
para recuperar la clave. Validacion realizada el 2026-10-03, Europe/Madrid.

## Integraciones externas pendientes y alcance

El usuario indica que no hay un entorno externo de pruebas configurado y pide validar lo local disponible. **SMTP_FUNCTIONAL, TURN_RELAY_E2E y VPN_BACKUP_TRANSPORT = BLOCKED**: faltan cuenta/destinatario SMTP autorizado, credenciales TURN y peer/rutas VPN autorizados. El OTP de los fixtures se activa únicamente en la base aislada; la prueba no demuestra entrega de correo. La carga es una muestra local y no certifica capacidad de producción. Los dispositivos WebRTC son simulados, con intercambio real de medios en localhost. Los dos destinos SFTP aislados prueban transporte/restauración, no una VPN real.

La validación local no acredita un despliegue público. El cierre autorizado incluye commit y push normal a `origin/main`, sin reescritura del historial. El despliegue remoto permanece fuera del alcance.
