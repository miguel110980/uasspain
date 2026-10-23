# UASSpain — dominio público y Google OAuth, 23 de octubre de 2026

**CHANGE_STATUS=NOT_COMPLETE:** correcciones locales aplicadas y verificadas en Docker; acceso externo y autenticación real Google pendientes de TLS público válido. Sin commit, push, cambios de router, puertos ni Google Cloud.

## Causas raíz y correcciones

| Incidencia | Causa comprobada | Cambio y resultado |
| --- | --- | --- |
| URL administrativa localhost | FRONTEND_URL no estaba definido en .env; Compose utilizaba https://localhost. | URL pública general FRONTEND_URL/SITE_URL = https://uasspain-prueba.duckdns.org. Valores comprobados en API, HTML servido y navegador. |
| Callback sin www frente al cliente comunicado | El usuario especificó que Google Cloud tiene la URI con www; son orígenes distintos. | GOOGLE_OAUTH_PUBLIC_ORIGIN = https://www.uasspain-prueba.duckdns.org; callback exacto /auth/google/callback sin barra final. Un único resolvedor backend alimenta las vistas administrativas y el flujo. Si la variable está vacía, conserva el fallback a FRONTEND_URL. No se modificó Google Cloud. |
| Activación bloqueada pese a secreto disponible | Guardar un secreto cifrado no acredita un intercambio firmado con Google. La verificación exige fecha, flujo y origen coincidentes. | Se conserva ese control. El panel explica el motivo y usa verificación efectiva, no únicamente verified_at, que podría corresponder a otro origen. El Client ID y la fila cifrada se conservan por comparación de huellas antes/después. |
| Flujo iniciado desde origen distinto | Cookies host-only y sessionStorage no se transfieren entre localhost, dominio raíz y www. Antes el backend podía crear el flujo que luego rechazaba el navegador. | El backend comprueba origen exacto y gate TLS antes de reautenticar o crear flujo; el panel deshabilita el inicio incompatible y explica el origen requerido. El frontend exige la ruta exacta de callback antes de guardar el handoff. |
| HTTPS no válido para DuckDNS | Certificado local emitido por CA interna, sin SAN de ninguno de los dos nombres; navegador público rechaza la confianza. | No se sustituye el certificado ni se omiten errores. Ambos hosts se registran en allowlists, pero Nginx devuelve 503 antes del proxy mientras figuren en tls_pending_hosts.conf. OAuth externo continúa bloqueado. |
| Estado de seguridad poco preciso | Configuración mostraba una afirmación fija de CSP/HSTS y no exponía CORS ni los hosts pendientes de TLS. | Configuración general, pestaña Seguridad y Panel de Seguridad muestran valores efectivos del backend. Las cabeceras se midieron aparte sobre las respuestas reales. |

La configuración general usa el dominio **sin www**; Google conserva el **www** solicitado previamente. La consola de Google Cloud no se ha consultado: la coincidencia con su registro es información del usuario, no una validación independiente. El callback mostrado por UASSpain sí se verificó en la API y el navegador actualizados.

## Archivos modificados en este encargo

- Backend: [google_oauth.rs](../../backend-rust/src/google_oauth.rs), [runtime_config.rs](../../backend-rust/src/runtime_config.rs), [system_status.rs](../../backend-rust/src/system_status.rs).
- Frontend: [GoogleOAuthForm.tsx](../../frontend/src/components/admin/GoogleOAuthForm.tsx), [googleAuthorization.ts](../../frontend/src/lib/googleAuthorization.ts), [systemStatus.ts](../../frontend/src/api/systemStatus.ts), [AdminConfiguracion.tsx](../../frontend/src/pages/admin/AdminConfiguracion.tsx), [AdminSeguridad.tsx](../../frontend/src/pages/admin/AdminSeguridad.tsx).
- Nginx: [nginx.conf](../../nginx/nginx.conf), [allowed_hosts.conf](../../nginx/allowed_hosts.conf), nuevo [tls_pending_hosts.conf](../../nginx/tls_pending_hosts.conf), [Dockerfile](../../nginx/Dockerfile). La IP pública previamente añadida y todos los hosts anteriores se conservan.
- Operación: [docker-compose.yml](../../docker-compose.yml), [.env.example](../../.env.example), [start-encrypted-stack.ps1](../../scripts/start-encrypted-stack.ps1), [prepare-test-domain.mjs](../../tools/prepare-test-domain.mjs), [operación OAuth](../google-oauth-operations.md). .env local modificado únicamente en variables públicas; no se incluye su contenido en el informe.
- Pruebas: nuevo [googleAuthorization.test.ts](../../frontend/src/lib/googleAuthorization.test.ts), nuevo [google-oauth-state.spec.ts](../../frontend/e2e/google-oauth-state.spec.ts), [google-oauth-admin.spec.ts](../../frontend/e2e/google-oauth-admin.spec.ts), [e2e-google-oauth.mjs](../../scripts/e2e/e2e-google-oauth.mjs).

El arranque oficial admite seleccionar servicios afectados y verifica los cinco saludables. PostgreSQL/Redis no se recrean en el despliegue parcial. Los cambios de tema que ya estaban en el árbol también entraron en el frontend reconstruido; se preservan los restantes cambios previos ajenos. No se han creado/restaurado backups ni migraciones.

## Contenedores realmente actualizados

Arranque ejecutado: powershell.exe -NoProfile -Command con scripts/start-encrypted-stack.ps1 -Build -Services backend,frontend,nginx. Primero hubo una reconstrucción backend/frontend para OAuth; la incorporación posterior del dominio requirió reconstruir también Nginx. Arquitectura principal permanente: exactamente cinco servicios.

| Servicio | Acción final | Imagen ejecutada | Salud |
| --- | --- | --- | --- |
| nginx | Recreado | `sha256:1f2cb025a19391363dd4b6eb3cb5c1d009a8d3179ee53e6088341c2674a19a7f` | healthy |
| frontend | Recreado | `sha256:dafd8324016d8854d557e046489f3c1d937984a6b5d2373b11f3c7cf805980df` | healthy |
| backend | Recreado | `sha256:8f7c5a6fbaa213ce246e21b9ed374cfb03390a0de8304518d94c1b65f2da503a` | healthy |
| postgres | Conservado | `sha256:56524dcdf6db8ae7013ca2eefc96f6628422052cd1f22b8f8166d5856ce51da5` | healthy |
| redis | Conservado | `sha256:066f97d7a910497a1583cc8a32d952d03ed788e6bbd30bda646951cc4b0dc0e1` | healthy |

Frontend servido: build ID **9d098ff5-4691-4e35-966a-1205fc39a5df**. IDs, arranques, imágenes, montajes y variables públicas en [before.json](../../.run/oauth-duckdns-20261023/before.json) y [after.json](../../.run/oauth-duckdns-20261023/after.json). Huellas de configuración Google, secreto cifrado, correo, perfiles completos y certificados/clave TLS: idénticas antes/después. Volúmenes nombrados preservados. Verificación del almacenamiento PostgreSQL cifrado PASS en el arranque oficial.

## Pruebas ejecutadas y alcance

| Prueba | Resultado observado |
| --- | --- |
| Typecheck, lint, tests y build frontend | PASS; 224 tests, 153 entradas del manifiesto, 10 páginas prerenderizadas. |
| Rust target audit | PASS fmt/check/clippy y 156 tests; 1 test marcado ignored por la suite, no se cuenta como ejecutado. |
| Preparador DNS/TLS | PASS: 12 tests. Certificados existentes conservados; no emisión ejecutada. |
| Cinco servicios y cuatro endpoints de salud | PASS: 5/5 healthy; /healthz, /readyz, /api/health/live/, /api/health/ready/ = 200. |
| Navegador real de MAIN actualizado | PASS: acceso convencional de admin/instructor/alumno, 13 lecturas/permisos, denegación de configuración OAuth a roles ajenos y de perfil instructor a alumno. Cookies Secure/HttpOnly/SameSite Strict observadas. |
| Configuración general, Seguridad y Google | PASS en navegador real, URL pública raíz, callback www, secreto disponible sin devolverse, casilla deshabilitada y explicación TLS. 12 estados responsive reales (3 vistas × 2 temas × 320/1440 px), sin overflow detectado. |
| Acceso LAN | PASS: /healthz 200 con CA local y formulario de acceso visible desde https://192.168.1.38. |
| Regresión browser sobre frontend MAIN | PASS: 17 E2E (contratos OAuth y temas). API interceptadas con fixtures, no se confunde con las autenticaciones reales anteriores. |
| Accesibilidad/layout de pantallas afectadas | PASS: 32 estados con fixtures, ambos temas y cuatro anchos; cero infracciones axe detectadas, overflow, errores JS o warnings. No certifica una auditoría WCAG manual completa. |
| Seguridad HTTP real | PASS: 18 controles de localhost/LAN, CORS exacto con credenciales, rechazo de origen ajeno/cross-site por CSRF, CSP, HSTS, redirección HTTP local, callback no-store/no-referrer y bloqueo de hosts pendientes/ajenos. Las pruebas de Host usan SNI localhost validado y sólo acreditan enrutamiento, no TLS DuckDNS. |
| OAuth firmado en pila aislada existente | PASS: 61 gates de Authorization Code/PKCE, claims, state, nonce, cookies/ventana, replay, expiración, revocación, aislamiento de roles, persistencia tras reinicio, vínculo explícito y secreto preservado. Proveedor OIDC sintético; cero escrituras en MAIN. |
| Flujo browser aislado | PASS: 1 E2E de verificar, habilitar, vincular, desvincular y volver a entrar con contraseña. No es aceptación real de Google. |
| DNS/IP | PASS: ambos nombres resuelven a 81.38.148.209, igual a la salida pública observada; sin AAAA observado. |
| HTTPS público y navegador DuckDNS | FAIL de confianza TLS: UNABLE_TO_VERIFY_LEAF_SIGNATURE; ambos nombres dan ERR_CERT_AUTHORITY_INVALID en navegador sin ignorar TLS. Aceptación externa BLOCKED. |
| Nginx activo | PASS: nginx -t dentro del contenedor actualizado. |
| Preservación y Git | PASS comparación de huellas y montajes; diff --check y diff --cached --check sin errores. No stage, commit, fetch ni push. |

Escaneo final Gitleaks: **PASS, cero hallazgos** en el árbol distribuible según .gitleaks.toml; excluye artefactos .run, secretos locales, .env y dependencias. No se afirma un escaneo de esas carpetas excluidas. [Resultado](../../.run/oauth-duckdns-20261023/secrets-dir.json).

Evidencias: [navegador MAIN](../../.run/oauth-duckdns-20261023/main-browser.json), [seguridad HTTP y DuckDNS](../../.run/oauth-duckdns-20261023/domain-http.json), [TLS público](../../.run/oauth-duckdns-20261023/tls.json), [UI afectada](../../.run/oauth-duckdns-20261023/ui-affected.json), [61 gates aislados](../../.run/oauth-duckdns-20261023/isolated-api/google-api.json), [regresión MAIN](../../.run/oauth-duckdns-20261023/main-ui-regression-final.log), [browser aislado](../../.run/oauth-duckdns-20261023/isolated-browser.log), [build/deploy](../../.run/oauth-duckdns-20261023/deploy-domain.log). Capturas locales del módulo Google y estado efectivo en el mismo directorio; no contienen secretos.

Incidencias de ejecución reparadas: primer fmt Rust exigió formato y se corrigió antes del despliegue; esbuild necesitó lectura fuera del sandbox; el runner API necesitó cargar la CA local, sin desactivar TLS; se ajustaron dos expectativas del harness (el contrato público Google no devuelve callback y sólo algunas secciones privadas admiten navegación por query). Los PASS anteriores son nuevas ejecuciones posteriores a esos ajustes.

## Bloqueos pendientes

1. Certificado público confiable y válido para el dominio raíz y el hostname www. Certificados/clave actuales conservados. No se han abierto puertos, cambiado DNS/router ni habilitado el proxy de aplicación para esos hosts.
2. Tras disponer de TLS correcto: aplicar la cadena/SNI adecuada, verificar HTTPS normal, retirar únicamente los hosts ya validados del gate y registrar el origen exacto validado para OAuth. No se ha realizado esa activación.
3. Confirmación independiente de la URI del cliente en Google Cloud e interacción real de un usuario autorizado con Google. No se ha accedido ni modificado Google Cloud; no se declara PASS del proveedor por disponer de un secreto o por superar un proveedor sintético.
4. Las cookies/sesiones y redirecciones sobre DuckDNS público permanecen BLOCKED hasta TLS. El inicio Google debe ocurrir en www, que es su callback configurado; las sesiones locales se mantienen separadas.

Google exige coincidencia exacta de protocolo, hostname, puerto y ruta: [documentación oficial OAuth web](https://developers.google.com/identity/protocols/oauth2/web-server). La comprobación de UASSpain conserva ese requisito.

## Cierre obligatorio

```text
CHANGE_STATUS=NOT_COMPLETE
CODE=PASS_LOCAL_IMPLEMENTATION_AND_RUNTIME; EXTERNAL_FUNCTION_BLOCKED
TESTS=PASS_FRONTEND_224_RUST_156_IGNORED_1_DOMAIN_12_UI_E2E_17_ISOLATED_OAUTH_61_BROWSER_1
DOCKER_BUILD=PASS_BACKEND_FRONTEND_NGINX
DOCKER_DEPLOY=PASS_LOCAL_ONLY_3_RECREATED
POSTGRES=HEALTHY_UNCHANGED_CONTAINER_AND_VOLUME
REDIS=HEALTHY_UNCHANGED_CONTAINER_AND_VOLUME
BACKEND=HEALTHY_REBUILT
FRONTEND=HEALTHY_REBUILT
NGINX=HEALTHY_REBUILT
CONTAINERS_HEALTHY=5/5
HEALTHZ=200
READYZ=200
API_LIVE=200
API_READY=200
E2E_DOCKER=PASS_LOCAL_REBUILT_MAIN; EXTERNAL_TLS_AND_REAL_GOOGLE_BLOCKED
FUNCTIONAL_TEST=PASS_MAIN_AUTH_3_ROLES_13_READ_CHECKS_GENERAL_SECURITY_GOOGLE_UI_LAN; EXTERNAL_BLOCKED
SECURITY=PASS_18_TARGETED_CHECKS; PUBLIC_TLS_FAIL; FULL_AUDIT_NOT_RUN
SECRETS_IN_GIT=0_FINDINGS_SCANNED_DISTRIBUTABLE_TREE; NO_NEW_COMMITS
COMMIT=NOT_RUN_USER_FORBIDS
PUSH=NOT_RUN_USER_FORBIDS
LOCAL_HEAD=535c05670a3f509ec8e72c16464b65a84710a671
ORIGIN_MAIN=535c05670a3f509ec8e72c16464b65a84710a671
ORIGIN_MAIN_VERIFICATION=CACHED_NO_FETCH
CRITICAL=NOT_ASSESSED_IN_FULL_AUDIT
HIGH=NOT_ASSESSED_IN_FULL_AUDIT
ERRORS=PUBLIC_HTTPS_UNTRUSTED; REAL_GOOGLE_NOT_VALIDATED; CORRECTED_TEST_HARNESS_FAILURES
SEQUENCE=BLOCKED
CURRENT=PUBLIC_TLS_AND_REAL_GOOGLE_ACCEPTANCE
NEXT=NOT_RUN
REASON=NO_TRUSTED_CERTIFICATE_FOR_ROOT_AND_WWW; GOOGLE_CLOUD_REGISTRATION_ONLY_USER_REPORTED
```
