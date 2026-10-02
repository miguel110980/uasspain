# UASSpain — SEO, Login, Responsive, Docker, SMTP, OAuth, TURN, VPN y Seguridad

## 0. MISIÓN

Trabajar directamente sobre el proyecto UASSpain existente hasta dejarlo preparado para producción.

Ciclo obligatorio:

INSPECCIONAR → BASELINE → MODIFICAR → BUILD → DOCKER UP → PROBAR → REPARAR → REPETIR → VALIDAR → LIMPIAR → COMMIT/PUSH

Objetivos:

1. SEO fuerte usando solo contenido real de UASSpain.
2. Actualizar y endurecer contenedores Docker.
3. Arranque completo con Docker.
4. Login por email case-insensitive.
5. Auditoría completa del login.
6. Responsive real en toda la app.
7. Reparar overflow del menú y añadir scroll interno si no cabe.
8. Suavizar tema claro y eliminar niebla/velo.
9. Validar SMTP real.
10. Validar OAuth/OIDC real.
11. Validar TURN externo real para WebRTC.
12. Validar VPN real, rutas y aislamiento.
13. Pruebas funcionales, E2E, seguridad, scans y logs.
14. Reparación iterativa hasta superar gates.
15. Limpieza final.
16. Commit y push solo después de validación final.

## 1. REGLAS

- Leer primero código/configuración real.
- Detectar rutas, nombres, servicios, versiones y proveedores; no inventar.
- No rehacer arquitectura/UI salvo necesidad demostrada.
- Preservar datos, API, WebSocket, permisos, sesiones e identidad visual.
- No imprimir ni registrar secretos.
- No almacenar secretos en frontend, Git, imágenes Docker, logs o documentación.
- No crear Markdowns/informes adicionales salvo necesidad técnica estricta.
- No dejar TODO/FIXME generados por esta tarea.
- No marcar PASS por mera presencia de configuración.
- Si una integración externa no puede probarse por falta de credenciales/entorno autorizado: BLOCKED + causa exacta.
- NOT_RUN nunca equivale a PASS.
- No ejecutar pruebas destructivas ni sobre sistemas ajenos.

Prioridad:

P0 seguridad/datos/auth → P1 funcionalidad → P2 infraestructura/red → P3 responsive/UI → P4 SEO/performance → P5 limpieza

Ante fallo reparable:

FAIL → causa raíz → corregir → reconstruir → repetir → PASS

## 2. INVENTARIO INICIAL

Localizar antes de modificar:

- Dockerfile*, compose*.yml/yaml, .dockerignore.
- React/Vite/Tailwind y lockfile real.
- Rust, Cargo.toml, Cargo.lock.
- PostgreSQL, Redis, Nginx.
- redes, volúmenes, healthchecks, secrets/configs.
- rutas públicas/privadas.
- login, registro, recuperación, OTP/MFA.
- sesiones/JWT/cookies.
- CORS, CSRF si aplica, CSP, headers.
- menú desktop/móvil y tema.
- WebRTC, señalización, STUN/TURN.
- SMTP/email/OTP/notificaciones.
- OAuth/OIDC/social login.
- VPN/WireGuard/OpenVPN/Tailscale u otra implementación.
- backups/restore/transporte remoto.
- tests unit/integration/E2E/Lighthouse.

No asumir componentes que no existan.

## 3. BASELINE

Antes de tocar código:

1. Build frontend/backend.
2. Ejecutar tests existentes.
3. Validar Compose.
4. Levantar stack actual.
5. Revisar docker compose ps.
6. Revisar logs.
7. Probar rutas públicas/login.
8. Probar email lowercase/UPPERCASE/MixedCase.
9. Revisar responsive, menú y tema claro.
10. Revisar configuración/conectividad real SMTP/OAuth/TURN/VPN.
11. Registrar solo fallos relevantes para comparación final.

# A. SEO

## 4. KEYWORDS DESDE LA APLICACIÓN

Extraer términos exclusivamente de contenido público real:

- home;
- servicios;
- formación/cursos;
- categorías;
- noticias/artículos;
- FAQ real;
- títulos/subtítulos;
- navegación;
- textos/descripciones públicas;
- contenido público administrable.

Excluir paneles privados, PII, emails privados, IDs internos, tokens, logs y texto técnico no público.

Mapa interno por URL:

URL → intención → tema → términos principales/secundarios → title → description → H1/headings → canonical → index/noindex

Prohibido keyword stuffing o palabras no justificadas por contenido real.

## 5. SEO TÉCNICO

Verificar/implementar:

- html lang=es.
- title único.
- meta description específica.
- canonical.
- robots.
- robots.txt.
- sitemap.xml solo público/indexable.
- Open Graph/Twitter Card.
- status HTTP correctos.
- enlaces internos descriptivos.
- headings semánticos.
- alt correcto.
- enlaces rotos/duplicados.

Excluir/noindexar login, registro, paneles, perfil, admin, API, WS y callbacks internos reales.

## 6. SPA Y RENDER

Analizar React/Vite y aplicar la solución menos invasiva:

- metadata por ruta;
- prerender/SSG si basta;
- SSR solo si aporta mejora real y es compatible.

El contenido SEO crítico no debe depender innecesariamente de ejecutar toda la SPA.

## 7. JSON-LD

Usar solo datos reales visibles y únicamente tipos aplicables:

Organization, WebSite, BreadcrumbList, Course, Article/NewsArticle, FAQPage.

No crear schemas ficticios.

## 8. PERFORMANCE SEO

Optimizar sin regresiones:

- bundles/lazy loading;
- JS/CSS innecesario;
- imágenes responsive, dimensiones, compresión/formato;
- fuentes;
- caché/compresión;
- recursos bloqueantes;
- LCP, CLS, INP, FCP, TTFB.

Lighthouse en páginas representativas. Objetivos orientativos:

SEO >=95; Accessibility >=95; Best Practices >=95; Performance >=90.

Si no se alcanza, corregir lo corregible y explicar causa exacta.

# B. LOGIN / EMAIL CASE-INSENSITIVE

## 9. NORMALIZACIÓN

usuario@dominio.es, Usuario@Dominio.es y USUARIO@DOMINIO.ES deben resolver la misma cuenta cuando representan el mismo email.

La autoridad debe estar en backend/DB, no solo frontend:

trim → normalización → comparación case-insensitive

Auditar:

- registro;
- login;
- cambio de email;
- recuperación;
- OTP;
- OAuth account linking;
- admin/creación/importación;
- UNIQUE.

Antes de migrar DB:

1. detectar colisiones equivalentes;
2. no borrar usuarios automáticamente;
3. migración segura;
4. unicidad normalizada con LOWER(email), CITEXT o equivalente compatible.

Input frontend:

- type=email;
- autocomplete=username;
- autocapitalize=none;
- spellcheck=false;
- paste/autofill funcional.

## 10. AUDITORÍA LOGIN

Probar:

- email/password;
- mostrar/ocultar password;
- Enter/submit/doble click;
- loading;
- autofill/password manager;
- registro/recuperación/OTP si existen;
- 4xx/5xx;
- backend caído;
- sesión expirada;
- logout.

Casos: vacío, inválido, espacios, minúsculas, mayúsculas, mixto, inexistente, password incorrecta, válido, respuesta lenta, submits repetidos.

Seguridad:

- rate limit/brute force;
- evitar enumeración de cuentas;
- validación server-side;
- XSS/inyección básica;
- open redirect;
- CSRF cuando aplique;
- sesión/JWT/cookies;
- expiración/rotación/revocación;
- no secretos sensibles en localStorage si existe alternativa segura.

Cookies de producción cuando aplique: Secure, HttpOnly, SameSite, Path y expiración correcta.

Accesibilidad: labels, focus, teclado, errores asociados, aria-live, contraste y targets táctiles.

# C. RESPONSIVE / MENÚ / TEMA

## 11. RESPONSIVE GLOBAL

Validar páginas principales en anchuras:

320, 360, 375, 390, 412, 480, 768, 820, 1024, 1280, 1366, 1440, 1920, 2560

Probar también diferentes alturas y portrait/landscape.

No permitir scroll horizontal accidental, clipping, solapes, grids/modales fuera de viewport, botones inaccesibles ni imágenes deformadas.

Preservar cabecera pública de tres bloques:

logo/UAS Spain | menú | tema/acceso

## 12. MENÚ DESPLEGABLE

Corregir la causa real del overflow. Solución equivalente:

~~~css
max-height: calc(100dvh - var(--available-space));
overflow-y: auto;
overscroll-behavior: contain;
~~~

Usar dvh/svh cuando corresponda. Revisar padres, overflow, position, transform, z-index y stacking contexts.

Si cabe: sin scroll innecesario. Si no cabe: scroll interno por ratón, trackpad, táctil y teclado.

Probar móvil: abrir/cerrar, click fuera, Escape, cambio de ruta, scroll, orientación, resize, focus y restauración de body.

Gate obligatorio: el último elemento del menú siempre debe poder verse y activarse.

## 13. TEMA CLARO

Reducir deslumbramiento sin perder identidad. Usar tokens existentes; referencia visual aproximada para fondo principal: #F5F7FA/#F6F7F9, evitando blanco puro masivo.

Buscar causa real del efecto niebla:

- backdrop-filter;
- filter/blur;
- overlays;
- opacidades;
- gradients;
- sombras excesivas;
- pseudo-elementos;
- mix-blend-mode;
- glassmorphism.

Resultado: limpio, nítido, suave, sin velo y WCAG AA cuando aplique.

Probar dark↔light, reload, rutas, login/logout, menú y formularios; evitar flash de tema incorrecto cuando sea posible.

# D. DOCKER / HARDENING

## 14. ACTUALIZACIÓN

Auditar servicios reales, previsiblemente frontend, backend Rust, PostgreSQL, Redis y Nginx.

Por imagen:

1. versión/digest actual;
2. versión estable mantenida actual;
3. compatibilidad;
4. actualizar;
5. rebuild;
6. tests/migraciones;
7. healthcheck;
8. fijar versión explícita y preferir digest tras validación.

No usar latest en producción.

Rust: multi-stage builder → release → runtime mínimo; toolchain fuera del runtime.

## 15. HARDENING COMPOSE

Aplicar donde sea compatible:

- no-root verificado por UID/GID;
- no-new-privileges:true;
- cap_drop ALL y solo capabilities imprescindibles;
- read_only cuando pueda prepararse correctamente;
- tmpfs para temporales;
- límites CPU/RAM/PIDs/ulimits razonables;
- healthchecks reales;
- restart coherente;
- dependencia por health cuando sea necesaria;
- .dockerignore mínimo.

No romper runtime por forzar hardening sin preparar rutas escribibles.

## 16. REDES / DB / REDIS / NGINX

Topología de mínimo privilegio:

Internet → Nginx → frontend/API/backend → PostgreSQL/Redis

- PostgreSQL/Redis no públicos.
- Eliminar ports innecesarios; usar redes internas/expose.
- Separar redes cuando mejore aislamiento.

PostgreSQL: versión mantenida, roles mínimos, runtime no-superuser, volumen, backup/restore, healthcheck, migraciones y SSL/TLS si aplica.

Redis: versión mantenida, no público, auth/ACL/protected mode, persistencia/limits/healthcheck, TLS si aplica.

Nginx: server_tokens off, TLS/protocolos/cifrados actuales, timeouts/body limits, proxy headers, WebSocket, rate limits, caché/compresión y headers.

Headers: CSP, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, HSTS solo con HTTPS correcto, frame-ancestors.

CORS autenticado: nunca wildcard; solo orígenes necesarios.

# E. SMTP

## 17. CONFIGURACIÓN Y CONECTIVIDAD

Detectar proveedor/configuración real y todos los usos: OTP, recuperación, contacto, avisos, etc.

Validar sin revelar secretos:

- host/puerto;
- DNS;
- TCP reachability;
- TLS directo o STARTTLS correcto;
- cadena de certificado;
- hostname/SAN;
- expiración;
- versión TLS;
- autenticación;
- remitente permitido;
- timeouts;
- retries/backoff;
- límites del proveedor.

Nunca desactivar validación TLS para conseguir conexión.

## 18. SMTP FUNCIONAL

Si existe cuenta/destino de prueba autorizado:

1. conectar;
2. negociar TLS;
3. autenticar;
4. enviar prueba controlada;
5. verificar respuesta SMTP aceptada;
6. probar flujo real OTP/recuperación sin exponer códigos en logs.

Sin receptor/credencial autorizada: SMTP_FUNCTIONAL=BLOCKED con causa exacta; seguir validando red/configuración posible.

Si aplica, revisar SPF, DKIM, DMARC, envelope-from/return-path y dominio remitente.

## 19. SMTP SECURITY

- secretos solo backend/secret store/env externa;
- logs redactados;
- timeout/retry limitado;
- evitar header injection;
- validar destinos/plantillas;
- HTML seguro;
- rate-limit OTP/recuperación;
- errores sin enumeración de cuentas.

Gates: SMTP_DNS, SMTP_TCP, SMTP_TLS, SMTP_CERT, SMTP_AUTH, SMTP_SEND, SMTP_APP_FLOW y SPF/DKIM/DMARC cuando aplique.

# F. OAUTH / OIDC

## 20. INVENTARIO

Detectar proveedores reales; no añadir otros.

Por proveedor validar:

- issuer/discovery si OIDC;
- client_id;
- client_secret solo backend;
- redirect URI exacta;
- post-logout redirect si aplica;
- scopes mínimos;
- HTTPS producción;
- auth/token/userinfo/JWKS;
- refresh/revocación;
- clock skew razonable.

## 21. SEGURIDAD OAUTH

Comprobar:

- Authorization Code Flow;
- PKCE cuando corresponda;
- state anti-CSRF;
- nonce en OIDC;
- validación iss/aud/exp/nbf;
- firma/JWKS y rotación;
- redirect sin wildcards inseguros;
- email claim/verificación correcta;
- account linking seguro;
- evitar takeover por colisión de email;
- normalización case-insensitive coherente con login local;
- logout/revocación;
- tokens fuera de URL/logs/frontend innecesario.

## 22. OAUTH E2E

Con cuenta/credenciales autorizadas:

login → callback → state/nonce/PKCE → sesión → refresh si aplica → logout/revocación

Probar state inválido, code reutilizado, token expirado, proveedor caído, email existente con distinto case y cancelación de consentimiento.

Sin cuenta/credenciales: OAUTH_E2E=BLOCKED; sí validar discovery/config local/tests mock.

Gates: OAUTH_CONFIG, OAUTH_REDIRECT, OAUTH_PKCE, OAUTH_STATE, OIDC_NONCE, TOKEN_VALIDATION, OAUTH_ACCOUNT_LINKING, OAUTH_E2E.

# G. TURN EXTERNO / WEBRTC

## 23. DETECCIÓN TURN/STUN

Localizar configuración WebRTC real, STUN/TURN externo, URLs, realm y mecanismo de credenciales.

Si TURN es externo, mantenerlo externo; no crear contenedor local para sustituirlo.

Validar:

- DNS;
- reachability;
- UDP/TCP configurados;
- turn:/turns:;
- puertos reales configurados;
- TLS/certificado en turns:;
- auth/realm;
- expiración de credenciales;
- IPv4/IPv6 si aplica;
- latencia básica;
- failover si existe.

## 24. TURN SECURITY

- no anonymous/open relay;
- credenciales temporales si la infraestructura lo soporta;
- no secreto TURN de larga duración en frontend;
- credenciales efímeras desde backend cuando aplique;
- TTL razonable;
- TLS válido;
- no exponer administración;
- logs sin credenciales.

## 25. WEBRTC RELAY E2E

Probar conexión autorizada extremo a extremo y, en test, forzar relay de forma temporal equivalente a:

iceTransportPolicy = relay

Verificar:

- candidate relay;
- ICE connected/completed;
- DTLS/SRTP activo;
- audio/vídeo/data según funciones reales;
- reconexión;
- cierre limpio;
- failover cuando exista.

Sin credenciales/red autorizada: TURN_RELAY_E2E=BLOCKED.

Gates: TURN_DNS, TURN_REACHABILITY, TURN_TLS, TURN_AUTH, TURN_CREDENTIAL_TTL, ICE_RELAY_CANDIDATE, WEBRTC_RELAY_E2E.

# H. VPN

## 26. DETECCIÓN Y ALCANCE

Identificar implementación real y su propósito: backups, administración, sedes/servicios u otro.

No enrutar todo UASSpain por VPN salvo requisito real de arquitectura.

## 27. VALIDACIÓN VPN

Comprobar:

- peer/endpoint;
- DNS endpoint;
- handshake/túnel;
- protocolo/cifrado;
- claves/certificados vigentes;
- permisos de archivos secretos;
- rutas/AllowedIPs de mínimo privilegio;
- ausencia de rutas inesperadas;
- DNS según diseño;
- MTU/fragmentación;
- keepalive si aplica;
- reconexión tras caída;
- reinicio Docker/host;
- firewall/kill-switch solo si el diseño lo requiere;
- reachability solo a destinos autorizados.

WireGuard: handshake reciente y RX/TX sin mostrar claves.
OpenVPN: cadena de certificados/TLS/rutas sin mostrar material privado.

## 28. VPN + BACKUPS

Si transporta backups:

1. destino accesible solo por ruta prevista;
2. backup controlado;
3. checksum/integridad;
4. restore en entorno aislado si existe procedimiento seguro;
5. caída VPN debe fallar explícitamente y no usar una ruta pública alternativa accidental.

Gates: VPN_ENDPOINT, VPN_HANDSHAKE, VPN_ROUTES, VPN_DNS, VPN_MTU, VPN_RECONNECT, VPN_ISOLATION, VPN_BACKUP_TRANSPORT cuando aplique.

# I. SECRETOS / FALLOS EXTERNOS

## 29. SECRETOS

Buscar exposición de:

DB/Redis passwords, SMTP credentials, OAuth client secrets, JWT/session secrets, TURN secrets, VPN private keys/certs, API keys y claves privadas.

No deben estar en Git, frontend, imágenes, logs o ejemplos con valores reales.

Usar secret store, Docker secrets, archivos montados o variables externas según la arquitectura. Ejemplos solo con placeholders.

Verificar .gitignore y .dockerignore.

## 30. CAÍDAS CONTROLADAS

Simular/validar caída de SMTP, OAuth, TURN, VPN, PostgreSQL y Redis cuando sea seguro.

La app debe:

- no filtrar secretos;
- no entrar en retry infinito;
- no bloquear UI permanentemente;
- usar timeouts/retries limitados;
- registrar errores accionables pero redactados;
- reflejar health/readiness coherente.

# J. TESTS / SCANS / LOGS

## 31. FRONTEND/BACKEND

Ejecutar tooling real disponible.

Frontend: build, lint, typecheck, unit/integration y E2E.

Rust como mínimo:

~~~bash
cargo fmt --check
cargo check
cargo test
cargo clippy
~~~

Corregir warnings relevantes, console.error, panics, 500 inesperados y errores WebSocket.

## 32. E2E OBLIGATORIOS

Login: lowercase/UPPERCASE/MixedCase, espacios, incorrecto, inexistente, válido, logout/session.

Responsive/menu: desktop/tablet/móvil, poca altura, scroll interno, último elemento accesible, sin overflow horizontal real.

Tema: dark/light/reload/rutas/login/menu/formularios, sin niebla/deslumbramiento.

Externos: SMTP real si hay destino autorizado; OAuth E2E si hay cuenta; TURN relay forzado si hay credenciales; VPN handshake/rutas y backup si aplica.

## 33. SECURITY SCAN

Analizar imágenes Docker, dependencias frontend/Rust, secretos, CVEs y Compose.

Objetivo:

CRITICAL_CORRECTABLE_CVE=0
HIGH_CORRECTABLE_CVE=0

Si queda CVE no corregible: CVE, componente, versión, impacto, causa y mitigación.

SBOM solo si existe tooling adecuado o aporta valor sin ensuciar repo.

## 34. LOGS / HEALTH

Tras tests revisar docker compose ps y docker compose logs.

No aceptar como final: panics, 500 inesperados, reconnect loops, errores DB/Redis, fallos externos ignorados, warnings críticos o frontend exceptions.

Healthchecks deben comprobar servicio real; separar readiness/liveness si está soportado.

# K. ARRANQUE / REPRODUCIBILIDAD

## 35. DOCKER COMO ARRANQUE ÚNICO

Objetivo:

~~~bash
docker compose up -d --build
docker compose ps
~~~

No exigir iniciar frontend/backend manualmente fuera de Docker.

Desde entorno limpio:

clone/copiar → secrets externos → build → up → migraciones → app funcional

Eliminar dependencias accidentales del host.

# L. LIMPIEZA Y GIT

## 36. LIMPIEZA FINAL

Solo tras superar pruebas. Eliminar temporales, logs de trabajo, caches/builds no versionables, duplicados y archivos descartables generados por esta tarea.

No borrar datos, migraciones válidas, tests útiles, assets, configuración necesaria o documentación vigente.

No crear nuevos Markdowns salvo este documento solicitado o necesidad técnica inequívoca.

## 37. COMMIT / PUSH FINAL

Solo si no hay blockers P0/P1 y los gates críticos están validados:

1. git status;
2. comprobar que no se incluyen secretos/temporales;
3. tests finales;
4. commit coherente;
5. push a remoto/rama configurados;
6. verificar SHA remoto.

Prohibido force push o reescritura de historial. Si branch protection exige PR, respetarla y reportarlo.

# M. GATES FINALES

Usar solo PASS, FAIL, BLOCKED o N/A según corresponda.

~~~text
BUILD_FRONTEND=PASS
BUILD_BACKEND=PASS
FRONTEND_TESTS=PASS
BACKEND_TESTS=PASS
E2E=PASS

LOGIN=PASS
EMAIL_CASE_INSENSITIVE=PASS
LOGIN_SECURITY=PASS
OAUTH_ACCOUNT_LINKING=PASS|N/A

RESPONSIVE=PASS
MOBILE=PASS
TABLET=PASS
DESKTOP=PASS
DROPDOWN_OVERFLOW=PASS
DROPDOWN_SCROLL=PASS
LIGHT_THEME=PASS
FOG_EFFECT=REMOVED
CONTRAST=PASS

SEO=PASS
SEO_KEYWORDS_SOURCE=APPLICATION_ONLY
METADATA=PASS
SITEMAP=PASS
ROBOTS=PASS
CANONICAL=PASS
STRUCTURED_DATA=PASS
PRIVATE_ROUTES_NOINDEX=PASS

DOCKER_BUILD=PASS
DOCKER_START=PASS
CONTAINERS_HEALTHY=PASS
CONTAINERS_UPDATED=PASS
CONTAINER_HARDENING=PASS
POSTGRES_SECURITY=PASS
REDIS_SECURITY=PASS
NGINX_SECURITY=PASS
SECURITY_HEADERS=PASS
SECRETS=PASS

SMTP_DNS=PASS
SMTP_TCP=PASS
SMTP_TLS=PASS
SMTP_CERT=PASS
SMTP_AUTH=PASS|BLOCKED
SMTP_SEND=PASS|BLOCKED
SMTP_APP_FLOW=PASS|BLOCKED

OAUTH_CONFIG=PASS|N/A
OAUTH_REDIRECT=PASS|N/A
OAUTH_PKCE=PASS|N/A
OAUTH_STATE=PASS|N/A
OIDC_NONCE=PASS|N/A
TOKEN_VALIDATION=PASS|N/A
OAUTH_E2E=PASS|BLOCKED|N/A

TURN_DNS=PASS|N/A
TURN_REACHABILITY=PASS|BLOCKED|N/A
TURN_TLS=PASS|N/A
TURN_AUTH=PASS|BLOCKED|N/A
ICE_RELAY_CANDIDATE=PASS|BLOCKED|N/A
WEBRTC_RELAY_E2E=PASS|BLOCKED|N/A

VPN_ENDPOINT=PASS|N/A
VPN_HANDSHAKE=PASS|BLOCKED|N/A
VPN_ROUTES=PASS|N/A
VPN_DNS=PASS|N/A
VPN_MTU=PASS|N/A
VPN_RECONNECT=PASS|BLOCKED|N/A
VPN_ISOLATION=PASS|N/A
VPN_BACKUP_TRANSPORT=PASS|BLOCKED|N/A

CRITICAL_CORRECTABLE_CVE=0
HIGH_CORRECTABLE_CVE=0
CONSOLE_ERRORS=0
UNEXPECTED_5XX=0
CRITICAL_ERRORS=0
HIGH_ERRORS=0
~~~

BLOCKED solo cuando dependa realmente de una credencial/cuenta/infraestructura externa ausente, indicando causa exacta.

# N. SALIDA FINAL — MÍNIMO CONSUMO DE TOKENS

Durante el trabajo evitar narración larga, repeticiones y volcado de archivos completos. Mostrar solo hallazgos importantes, cambios y bloqueos.

Salida final:

~~~text
UASSPAIN_AUDIT=PASS|FAIL|BLOCKED

SEO=PASS|FAIL
SEO_KEYWORDS_SOURCE=APPLICATION_ONLY
LIGHTHOUSE_SEO=<n>

LOGIN=PASS|FAIL
EMAIL_CASE_INSENSITIVE=PASS|FAIL
LOGIN_SECURITY=PASS|FAIL

RESPONSIVE=PASS|FAIL
DROPDOWN_SCROLL=PASS|FAIL
LIGHT_THEME=PASS|FAIL
FOG_EFFECT=REMOVED|PRESENT

DOCKER_BUILD=PASS|FAIL
DOCKER_START=PASS|FAIL
CONTAINERS_HEALTHY=<n>/<n>
CONTAINERS_UPDATED=PASS|FAIL
CONTAINER_HARDENING=PASS|FAIL

SMTP=PASS|FAIL|BLOCKED
OAUTH=PASS|FAIL|BLOCKED|N/A
TURN_EXTERNAL=PASS|FAIL|BLOCKED|N/A
VPN=PASS|FAIL|BLOCKED|N/A

FRONTEND_TESTS=<pass>/<total>
BACKEND_TESTS=<pass>/<total>
E2E=<pass>/<total>

CRITICAL_CVE=<n>
HIGH_CVE=<n>
CRITICAL_ERRORS=<n>
HIGH_ERRORS=<n>

FILES_MODIFIED=<n>
FILES_DELETED=<n>
COMMIT_SHA=<sha|NONE>
PUSH=PASS|FAIL|NOT_RUN
BLOCKERS=[...]

CAMBIOS_PRINCIPALES:
- ...

PENDIENTE:
- NONE | ...
~~~

## CRITERIO DE TERMINACIÓN

No terminar por haber escrito código. Terminar solo cuando UASSpain arranque íntegramente con Docker, contenedores estén actualizados/endurecidos, login/email case-insensitive funcionen, responsive/menú/tema estén corregidos, SEO use exclusivamente contenido real, SMTP/OAuth/TURN/VPN hayan sido validados hasta el nivel permitido por credenciales reales, tests/scans críticos pasen, no existan secretos expuestos y el estado final esté verificado antes del commit/push.
