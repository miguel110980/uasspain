# Validación local — 2 de octubre de 2026

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

Google incorpora firma RS256/JWKS, issuer/audience/expiry/nbf estrictos, nonce de un
uso y vínculo al sujeto estable del proveedor. Los tests locales comprueban
claims inválidos, tipo de prueba, expiración y replay; no acreditan un login
contra el proveedor. El email se normaliza en servidor y el cambio actualiza
perfil y cuenta de autenticación en una transacción; las contraseñas conservan
sus caracteres. Google rechaza el acceso cuando la política local exige OTP y dirige al flujo de correo, contraseña y código, evitando omitir la segunda verificación. Se mantienen los límites de intentos y la revocación existentes.

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
la auditoría. Identificación, login y aislamiento de los tres usuarios reales
quedan BLOCKED hasta localizar su base o copia original. No se puede verificar
el algoritmo de una contraseña existente cuando no hay filas; el código genera
Argon2id y la base conserva el índice UNIQUE sobre `email_lookup`.

El campo de email del login conservaba únicamente minúsculas porque saneaba
cada pulsación. Ahora conserva la entrada y normaliza al enviar. Typecheck,
lint y build Docker pasan. Chromium contra HTTPS de la instalación real, sin
mocks ni envío de login, demuestra `ABC → abc` antes y `ABC → ABC` después.
Se actualiza únicamente el frontend; backend y PostgreSQL conservan sus
contenedores. No se cambian usuarios, roles, emails, contraseñas ni datos.

## Integraciones externas pendientes

El usuario indica que no hay un entorno externo de pruebas configurado y pide validar lo local disponible. **SMTP_FUNCTIONAL, OAUTH_E2E, TURN_RELAY_E2E y VPN_BACKUP_TRANSPORT = BLOCKED**: faltan cuenta/destinatario SMTP autorizado, cliente y cuenta Google de prueba, credenciales TURN y peer/rutas VPN autorizados. El OTP de los fixtures se activa únicamente en la base aislada; la prueba no demuestra entrega de correo. La carga es una muestra local y no certifica capacidad de producción. Los dispositivos WebRTC son simulados, con intercambio real de medios en localhost. Los dos destinos SFTP aislados prueban transporte/restauración, no una VPN real.

La validación local no acredita un despliegue público. El cierre autorizado incluye commit y push normal a `origin/main`, sin reescritura del historial. El despliegue remoto permanece fuera del alcance.
