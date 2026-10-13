# Integración de correo API / SMTP — cierre local del 12/10/2026

La integración está implementada, probada y desplegada en Docker local. El cierre corporativo sigue **NOT_COMPLETE**: falta confirmar el remitente en Postmark, comprobar la credencial contra el proveedor y validar la recepción y Responder en el buzón. La comprobación corporativa está aplazada hasta producción por autorización del usuario. Postmark no se ha activado ni se han modificado los DNS de la web antigua.

Por la última instrucción del usuario, los tres últimos encargos quedan pendientes y no se inicia su implementación durante este cierre. No se ha realizado commit, push ni despliegue remoto: la petición de correo prohíbe esas operaciones sin autorización específica.

## Auditoría, backup y conservación

Registro, OTP, recuperación e invitaciones usaban `email.rs` mediante SMTP. Contacto tenía otra implementación SMTP y una ruta Postmark basada en variables del entorno. No existía una outbox de correo; `content_outbox` pertenece a sincronización de contenido y se conserva. Se reutilizan el almacén cifrado `core_systemsecret`, la autenticación, los permisos administrativos y los cinco servicios existentes.

Antes de migrar se creó un snapshot cifrado consistente y se restauró en un contenedor temporal sin red: **50 tablas y 506 registros**, sin perfiles de prueba en la instancia principal. Evidencia privada: `.run/mail-system-20261012/pre-migration-backup/inventory.json`. SHA-256 del archivo cifrado:

```text
58d8cd79202f42a62040c262fb889767cff4a12930ff2afa5d79fbfd5334703e
```

Después del despliegue y del registro de preparación se comprobaron los identificadores y hashes completos de los 506 registros anteriores, los nueve archivos de backup y las identidades de los volúmenes persistentes. Resultado: **cero modificaciones y cero borrados de registros anteriores**, nueve archivos idénticos y volúmenes conservados. Se conserva el volumen cifrado `uasspain-rebuild-20261003_postgres_ciphertext`, la clave DPAPI y las configuraciones anteriores.

La expansión añade las tablas de correo y dos circuitos iniciales. El registro de preparación añade exclusivamente metadatos de esta migración en las tablas nuevas; no modifica usuarios, sesiones, configuración SMTP ni secretos anteriores. En la instancia principal hay **cero mensajes en la outbox**, cero envíos de prueba y cero restauraciones destructivas. El flag de restauración principal ya estaba habilitado y se conserva; no se ha utilizado.

## Implementación y archivos

- `backend-rust/migrations/0027_mail_delivery.sql`: expansión compatible con `mail_outbox`, `mail_circuit`, `mail_migration` y `mail_migration_transition`. Aplicada mediante el arranque del backend; no se retiran tablas ni columnas antiguas.
- `backend-rust/src/mail_provider.rs`: transporte Postmark y SMTP centralizado, validación del sobre, TLS, timeout, límites de respuesta, redirecciones bloqueadas y clasificación redactada de errores. La comprobación Postmark exige servidor Live. Sólo un resultado auténtico acredita aceptación o entrega.
- `backend-rust/src/mail_config.rs`: configuración API/SMTP, candidato cifrado de API Key, preservación con campo vacío, comprobación real previa a promoción y activación, conmutación transaccional y reversión administrativa expresa. No se admiten timestamps de verificación proporcionados por el frontend.
- `backend-rust/src/mail_queue.rs`: outbox cifrada, idempotencia, reservas con caducidad, control concurrente, reintentos limitados con jitter y Retry-After, expiración de tokens y circuitos persistentes. Un resultado incierto queda UNKNOWN y no se reenvía automáticamente.
- `backend-rust/src/mail_migration.rs`: estados, historial, métricas, alertas internas y conciliación autenticada de resultados del proveedor sin reenviar mensajes.
- `backend-rust/src/{email,auth,registration,contact,runtime_config,system_status,app,lib,main}.rs`: integración con registro, login OTP, recuperación, Contacto y notificaciones existentes. El trabajador permanece dentro del servicio Rust; no se añade un sexto servicio.
- `.env.example`: añade únicamente `POSTMARK_SERVER_TOKEN=` vacío. Los secretos de runtime y los guardados cifrados no se incorporan a imágenes ni respuestas públicas.
- `frontend/src/components/admin/MailIntegrationForm.tsx`, `frontend/src/pages/admin/AdminConfiguracion.tsx` y `frontend/src/api/systemStatus.ts`: selector API exclusivo, conservación de SMTP, prueba autorizada, candidato de clave, estado de migración, monitorización y alertas. Se reutiliza el formulario SMTP existente.
- `frontend/src/components/sections/ContactSection.tsx` y `frontend/src/services/contactService.ts`: identidad persistente de la solicitud al reintentar un resultado incierto y mensajes que distinguen cola, aceptación del proveedor, fallo y resultado desconocido.
- `scripts/e2e/e2e-mail-system.mjs`, `scripts/e2e/e2e-contact.mjs`, `scripts/e2e/run-e2e.ps1` y `frontend/e2e/mail.spec.ts`: aceptación y regresión con fixtures aislados, receptor SMTP TLS propio y limpieza por IDs comprobados.
- `scripts/register-mail-preparation.mjs`: herramienta local que contrasta backup, integridad, versión y gates observados antes de registrar las fases iniciales. Bloquea estados inesperados y no puede sustituir la verificación del proveedor ni completar el cutover.
- Documentación operativa: [mail-api-smtp-operations.md](../mail-api-smtp-operations.md).

Los cambios anteriores de backups se documentan por separado en [2026-10-12-backup-inventory.md](2026-10-12-backup-inventory.md). El archivo preexistente `scripts/start-watch-hidden.vbs` no se modifica.

## Comportamiento validado

Registro, OTP y recuperación generan token y correo dentro de la misma transacción. Antes del envío se comprueba la vigencia del token. El login conserva el fallo seguro del transporte y no revoca una sesión anterior por no poder enviar el OTP.

Contacto utiliza From corporativo, To corporativo y Reply-To del visitante. Conserva validación, sanitización, honeypot, origen autorizado y rate limiting. Reutilizar el ID con contenido distinto se rechaza; un error incierto de proxy conserva la identidad y el reintento produce un solo mensaje. Un rechazo conocido del transporte devuelve HTTP 503 y no muestra entrega satisfactoria.

La selección API impide modificar SMTP y no habilita fallback. Guardar un candidato no sustituye la clave activa; una rotación fallida conserva el canal y secreto anteriores. La conmutación sólo reasigna mensajes PENDING/RETRY_SCHEDULED, conserva su identidad y contenido, y se bloquea si existe PROCESSING. Los mensajes UNKNOWN, ACCEPTED y DELIVERED no se convierten en nuevos envíos.

La reversión SMTP aislada se comprobó con aceptación real del receptor TLS: cambio autorizado atómico, mismo ID, contenido y Reply-To, un intento y ningún reenvío de resultados inciertos. No se realizó una reversión en la instancia principal.

## Pruebas y alcance de las evidencias

| Comprobación | Resultado observado | Evidencia privada |
|---|---|---|
| Rust fmt/check/clippy y tests | PASS; 130 tests, cero fallos | `rust-audit-final.log` |
| Frontend typecheck/lint/tests/build | PASS; 71 tests en 15 archivos | `typecheck.log`, `lint.log`, `frontend-tests.log`, `frontend-build.log` |
| Regresión API transversal | PASS; 137/137 casos principales y suites adicionales | `full-api-regression-final.log` |
| Cola, configuración, secretos, rotación, estados y reinicio | PASS; 34 casos internos | `production-mail-api.log` |
| Reversión con SMTP TLS real aislado | PASS; cinco casos adicionales dentro de Contacto | `production-contact.log` y suite anidada |
| Contacto API y navegador, TLS, Reply-To, antispam, duplicados y fallos | PASS; 43 casos | `production-contact-result.json` |
| Administración API/SMTP en navegador | PASS; ambos temas y anchos 320, 375, 768, 1024, 1440 y 1920; sin desbordamiento ni errores de página | `browser-mail-final.json`, capturas Playwright |
| Regresión del formulario administrativo existente | PASS | `browser-settings-regression.json` |
| Conservación de registros, archivos y volúmenes | PASS; 506 registros, nueve archivos | `preservation.json` |
| Secretos y vulnerabilidades HIGH/CRITICAL en código, historial e imágenes | PASS; cero hallazgos en el análisis | `security-final/summary.json` |
| Diff y diff cached | PASS; sin errores de whitespace | comprobación Git local |

Todos los nombres de evidencias de la tabla son relativos a `.run/mail-system-20261012/`. La regresión transversal se ejecutó antes de los últimos ajustes de manejo de errores de Contacto; después se repitieron el audit Rust, los gates frontend y la aceptación afectada sobre la versión desplegada final. No se presentan resultados antiguos como una nueva ejecución.

Las pruebas autenticadas y destructivas utilizan exclusivamente PostgreSQL, Redis y usuarios sintéticos de la pila aislada. La aceptación final de correo y navegador se ejecutó por HTTPS a través de Nginx sobre **los mismos IDs de imagen de backend y frontend que ejecuta la instancia principal**. Se verificaron también los hashes del binario y la versión del frontend. La instancia principal se comprobó en lectura: salud, rutas públicas, denegación administrativa anónima y WSS; no se crearon perfiles ni se alteraron sesiones reales para probar.

El receptor SMTP es temporal, autenticado y usa TLS; recibe localmente las direcciones del sobre sin reenviar a Internet. Esto acredita transporte y cabeceras en aislamiento, **no la recepción en `info@uasspain.com`**. Las pruebas de política API usan metadatos sintéticos y circuito externo bloqueado. Las pruebas HTTP del adaptador usan respuestas locales. Ninguna de ellas acredita una credencial Postmark real o un remitente autorizado.

Se eliminaron únicamente trabajos propios por IDs demostrados y se restauró la configuración del fixture. Contacto confirma `queueResidue=0`, backend restaurado, CA temporal retirada y receptor eliminado. Se conserva la auditoría protegida y la evidencia de pruebas. No se eliminan volúmenes E2E anteriores ni backups para limpiar esta tarea.

## Reparaciones encontradas durante las pruebas

La prueba SMTP detectó que adoptar una configuración del entorno guardaba los campos SMTP sin conservar su contraseña en el almacén cifrado. Se corrigió la actualización transaccional para guardar la credencial comprobada y rechazar sobrescribir una distinta. La prueba real TLS posterior pasó.

Se corrigieron el padding Base64 del fixture, su comparación de nombres tras el recifrado legítimo del administrador sintético y el caso del honeypot en navegador: forzar escritura en un input oculto escribía en el campo que conservaba el foco. Se revela únicamente ese campo dentro de la prueba y se confirma el payload real y el rechazo 400. La sanitización del producto ya conservaba el honeypot; no se modifica por ese diagnóstico descartado.

Se corrigieron el tamaño mínimo y el desplazamiento interno de las tablas administrativas para evitar filas desmesuradas en móvil. Las capturas y comprobaciones finales pasan en los doce escenarios de tema/tamaño.

No se aplicaron optimizaciones adicionales sin evidencia de necesidad. Se reutilizan pools, la cola PostgreSQL e índices de trabajo pendiente/estado. La regresión registró hasta 100 sesiones concurrentes, 1.827 peticiones sin errores y p95 de 51,16 ms en ese escenario aislado; esta medición corresponde a regresión general, no a latencia del proveedor corporativo. No se inventan mejoras antes/después de una optimización que no se realizó.

## Docker desplegado y versión comprobada

Se ejecutó el procedimiento oficial `powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build`; el último build terminó a las **17:38 del 12/10/2026, Europe/Madrid**. Se alineó posteriormente el backend con su imagen reconstruida conservando los volúmenes, tras detectar un índice OCI de caché no resoluble; no sustituye al rebuild oficial.

| Servicio | ID de imagen del contenedor principal | Estado |
|---|---|---|
| nginx | `sha256:fc2d3f53053fe42e18c91154c44653a1779408aac1f52996d2703d3d5771f773` | healthy |
| frontend | `sha256:c35b3b8213b442050b64999f40fbde2112ee41e003b2406edf4adf51d8b1df84` | healthy |
| backend | `sha256:a1be0ef7b9cce74d3fdb83fa6e41f2c4cd955c8928a91f552d175ab80742b174` | healthy |
| postgres | `sha256:7fcdf204a88318b8b7fdd79e79e4eea40a1a98ee5b8deb227f719e4f91d17343` | healthy |
| redis | `sha256:186c08f0117fbb7c98b5e8b1b9bc03ac50f9e9b2958b446925a853f1d22c6d7b` | healthy |

El frontend se recreó a las 17:38 y el backend a las 17:40, Europe/Madrid. El detalle de IDs de contenedor, manifest, fecha y correspondencia con E2E está en `runtime-proof.json` y `main-runtime.json`. Binario backend SHA-256: `365573a9a5f1fa878ea7fc274589799cf31661721b6a84d49b1823a8ee446914`. Frontend build ID: `2eb821fb-99df-460c-8516-11c5e75b2afd`. Esquema aplicado: **27**.

`https://localhost/healthz`, `/readyz`, `/api/health/live/` y `/api/health/ready/` responden 200. Las rutas administrativas de correo sin autenticación responden 401. WSS público funciona, el origen ajeno se rechaza y el WSS privado sin autenticación se rechaza.

## Estado persistente y pendientes de producción

La herramienta de preparación registró seis transiciones: NOT_STARTED → AUDITED → BACKUP_VERIFIED → SCHEMA_EXPANDED → DATA_MIGRATED → DATA_VERIFIED → BLOCKED. ID de migración: `94781a1d-f809-42da-a9ef-defb75b88ffb`; intento: `0df76364-50fb-4a27-9399-5180bf502bd9`; versión: 6. La última fase superada es DATA_VERIFIED. El responsable se identifica como herramienta local de operación; no se atribuye la operación a un usuario inventado.

El secreto de servidor Postmark está disponible en runtime; no se lee ni expone su valor. Su validez no está comprobada contra Postmark. No se dispone de Account Token, remitente confirmado ni acceso autorizado al buzón. El canal seleccionado permanece SMTP, sin configuración operativa acreditada en la instancia principal; la integración conserva los valores anteriores y no presenta el servicio como capaz de enviar hasta configurarlo y comprobarlo.

Para producción, una persona autorizada debe confirmar el remitente `@uasspain.com`, autorizar y ejecutar la prueba con Postmark, comprobar recepción y cabeceras en `info@uasspain.com`, y pulsar Responder para verificar el destinatario del visitante. Después debe ejecutar aceptación de cutover y registrar su evidencia. No se cambia DNS ni se inventan SPF/DKIM/Return-Path.

```text
LOCAL_PREPARATION=VALIDATED
LOCAL_DEPLOYMENT=DEPLOYED
CHANGE_STATUS=NOT_COMPLETE
MAIL_MIGRATION=BLOCKED
LAST_PASSED=DATA_VERIFIED
POSTMARK_SERVER_TOKEN_RUNTIME=AVAILABLE
POSTMARK_ACCOUNT_API=NOT_PROVIDED
POSTMARK_CREDENTIAL_VALIDATION=NOT_RUN
VERIFIED_SENDER=UNCONFIRMED
CONTACT_INTERNAL_TESTS=PASS
POSTMARK_SEND_TEST=BLOCKED_EXTERNAL
REAL_INBOX_RECEPTION=BLOCKED_EXTERNAL (aplazada hasta producción)
REAL_REPLY_TO_VALIDATION=BLOCKED_EXTERNAL (aplazada hasta producción)
PHASE_05=NOT_COMPLETE
PRODUCTION_READY=NOT_COMPLETE
MAIN_INSTANCE_TEST_PROFILES=0
REAL_USER_DATA_MODIFIED=0
REAL_USER_DATA_DELETED=0
MAIN_DESTRUCTIVE_RESTORES=0
LAST_THREE_REQUESTS=NOT_RUN
SEQUENCE=BLOCKED
CURRENT=CORPORATE_MAIL_RELEASE_GATE
NEXT=NOT_RUN
REASON=Remitente y credencial Postmark pendientes; recepción y Responder aplazados hasta producción
```

## Cierre obligatorio de REPAIR_WORKFLOW, sección 25

```text
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
HEALTHZ=200
READYZ=200
API_LIVE=200
API_READY=200
E2E_DOCKER=PASS (imágenes MAIN idénticas, escrituras aisladas)
FUNCTIONAL_TEST=PASS (preparación local; recepción corporativa BLOCKED_EXTERNAL)
SECURITY=PASS
SECRETS_IN_GIT=0
COMMIT=NOT_RUN (sin autorización específica para esta solicitud)
PUSH=NOT_RUN (sin autorización específica para esta solicitud)
LOCAL_HEAD=f53a4b2c7b1a259c6dfa8b488811f711f9ca74c8
ORIGIN_MAIN=f53a4b2c7b1a259c6dfa8b488811f711f9ca74c8 (referencia local; sin fetch remoto)
CRITICAL=0 (análisis ejecutado)
HIGH=0 (análisis ejecutado)
ERRORS=[BLOCKED_EXTERNAL: sender_unconfirmed, credential_not_validated, real_inbox_and_reply_validation_deferred]
```
