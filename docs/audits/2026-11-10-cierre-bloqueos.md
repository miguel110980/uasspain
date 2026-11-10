# UAS Spain ORIGINAL — cierre parcial de bloqueos, 10 de noviembre de 2026

**CHANGE_STATUS=NOT_COMPLETE · RELEASE_GATE=BLOCKED.** No se acredita preparación
para producción ni entrega al cliente. Esta continuación conserva el alcance del
plan maestro y las evidencias del 9 de noviembre; no vuelve a presentar aquellas
ejecuciones como pruebas nuevas.

## Resultado y procedencia

- Los **81 casos históricos** conservan fila individual: **79 PASS y 2 BLOCKED**.
  De los 27 bloqueados anteriores, se verificaron 25 en laboratorio. Los 54 PASS
  anteriores del ORIGINAL se conservan con su procedencia, sin repetición masiva.
- Los **17 hallazgos** quedan en **14 PASS y 3 BLOCKED**: F15, F16 y F17. F17 tiene
  tres gates de API PASS; su confirmación gráfica continúa BLOCKED. No se da por
  terminado el hallazgo completo por una prueba parcial.
- Las **cuatro integraciones Rust antes ignoradas se ejecutaron: 4/4 PASS**.
  Las 167 pruebas Rust anteriores se reutilizan con 94 inputs del backend sin
  cambios. No se afirma haber repetido las 167 en esta continuación.
- La suite frontend ejecutada tras el ajuste de texto: **230/230 PASS**;
  typecheck, lint y build PASS. Imagen nueva construida y validada únicamente
  en laboratorio; el ORIGINAL aún no incorpora ese ajuste.
- Hay **53 gates únicos de API con último resultado PASS**, además de 15 casos
  de avatares PASS. Son comprobaciones adicionales, no otros 68 casos sumables a
  los 81. El registro bruto de API conserva 54 entradas, incluida una petición
  SMTP inicial incorrecta que recibió 400 y su repetición corregida con 200.

Matrices: [casos](2026-11-10-casos-cierre.csv),
[hallazgos](2026-11-10-hallazgos-cierre.csv),
[dependencias](2026-11-10-dependencias-cierre.csv).
El [informe anterior](2026-11-09-verificacion-anterior.md) sigue siendo evidencia
histórica; los estados actuales se consultan en estas matrices.

## Identidad del código, aislamiento y conservación

Evidencias locales ignoradas por Git:
`.run/closure-20261109-630870e0/`. Las horas de sus JSON están en UTC; la fecha
de este informe corresponde a Europe/Madrid.

El backend r6 del ORIGINAL y el laboratorio usa la imagen
`sha256:4e6e149c36da0be75e34e73244a4c82c12bd195f5a15c71dd174236610289297`.
Los **94 inputs conservan sus SHA256**, con huella conjunta
`69d2f1e093bd1bce118e42d9725bf4fdd69131c1d4ab9d31df1420d551e91a84`.
Evidencia: `backend-source-final.json` y `read-baseline.json`.

El laboratorio `uasspain-mail-audit-closure-630870e0` utiliza PostgreSQL nuevo,
vacío y sintético, migrado desde el código original; no se copió ni restauró la
base real. No se creó otra copia del proyecto. Se reutilizaron imágenes y cachés
existentes. Los servicios de ensayo son temporales y no cambian la arquitectura
permanente de cinco servicios. Sus credenciales sólo se retienen mediante DPAPI
en archivos locales ignorados; los informes no incluyen contraseñas, OTP ni cookies.

Sus accesos son **HTTP de loopback**, `http://127.0.0.1:18010` y
`http://localhost:18444`. No acreditan HTTPS/WSS, Redis ni medios remotos del
ORIGINAL por sí solos. El transporte SMTP ensayado sí utiliza STARTTLS real con
CA sintética validada y un receptor local que no reenvía correo a terceros.

El tag frontend inicial del laboratorio tenía un ID distinto del contenedor
original; se compararon **220 archivos servidos, todos idénticos** antes de usarlo
(`frontend-artifact-equivalence.json`). La imagen posterior con la corrección de
texto se identifica separadamente en el apartado correspondiente.

La verificación final del ORIGINAL es exclusivamente de lectura:

- Mismos cinco contenedores, imágenes, fechas de arranque y volúmenes; 5/5 healthy.
- HTTP 200 y validación TLS de Node con la CA existente en `/healthz`, `/readyz`,
  `/api/health/live/` y `/api/health/ready/`.
- **20/20 registros académicos anteriores con igual SHA256 por ID**. La misma
  canonicalización excluye las tres columnas nuevas ya autorizadas; las tablas
  que contienen esos 20 registros no dependen de ellas.
- **8/8 perfiles anteriores** conservan roles, email cifrado, estado, verificación
  y asignación. La comparación es por ID y campos, no por orden de los arrays.
- Cero escrituras de esta continuación en la base original. Se conservan el
  volumen cifrado PostgreSQL, las claves y las modificaciones ajenas previas.

Evidencias: `original-final-read-verification.json`,
`original-academic-preservation.json`, `original-profiles-preservation.json`.

## Pruebas cerradas en laboratorio

**Correo, registro y recuperación (F01).** Dos cuentas con la misma contraseña
completaron registro, recepción real de OTP por SMTP/TLS, verificación y acceso
tras aprobación. Se rechazaron acceso prematuro, consumo concurrente duplicado
y replay. Ambas completaron recuperación mediante el correo recibido, cambio
efectivo y rechazo del token reutilizado. Una recuperación utilizó una contraseña
ya usada por otra cuenta, sin búsquedas globales de contraseñas. La medición
acotada añadió 64 auth_user sintéticos inactivos: medianas de tres registros
100 ms antes y 96 ms después. Esto no constituye un ensayo general de carga.
Evidencias: `api-results.json`, `api-trace.json`, `password-census-bounded.json`.
La entrega mediante el proveedor SMTP externo sigue **NOT_RUN**.

**Avatares (F12).** 15/15 casos públicos PASS: propiedad, ticket de un solo uso,
competencia entre registros, caducidad, cuota persistente y conservación de fotos
registradas y legadas. No se ejecutó limpieza sobre el ORIGINAL. La limpieza TTL
de pendientes expirados es global por diseño; el ensayo no acredita conservación
de pendientes expirados de otro solicitante. Evidencia: `avatar-results.json`.

**Examen y concurrencia (F08).** Dos ventanas del mismo intento reprodujeron
revisión obsoleta: la segunda obtuvo 409 y aviso visible; la respuesta de la
primera permaneció en PostgreSQL. En otro intento se mantuvo bloqueada la fila
durante **19 953 ms**: Finalizar permaneció deshabilitado mientras el guardado
estaba pendiente; tras liberar el bloqueo se persistieron la última respuesta,
la revisión y el resultado. No se atribuye esa latencia al producto: fue inducida
para verificar el orden de las operaciones. El requisito A1/A3 del alumno se
completó mediante la API real antes de realizar A2.
Evidencias: `browser-held-submit.json`, `browser-final-attempt-proof.json`,
`browser-stale-window.txt/png`, `browser-latency-result.txt/png`.

**Cuatro integraciones Rust.** Los ejecutables corresponden al código r6 y se
ejecutaron con PostgreSQL y SMTP aislados, sin workers ajenos:

1. `runtime_config::tests::mail_repair_preserves_active_transport_credentials_2fa_and_history`
2. `mail_queue::tests::persistent_circuit_probe_recovery_and_uncertainty`
3. `mail_queue::tests::smtp_candidate_failures_preserve_the_active_circuit_and_unknown_messages`
4. `smtp_services::isolated_integration::dual_smtp_services_isolated_integration`

La cuarta registra 62 observaciones, incluidas autenticación SMTP, TLS, separación
de remitentes, OTP/2FA/reset, idempotencia, persistencia de circuitos y respuestas
inciertas. Evidencias y códigos de salida: `integration-results.json` y sus logs.

**Backups completo e incremental.** Se creó y verificó el completo sintético
`377414f5-48e5-45a4-96c5-5f905b999131` y el incremental
`d73af5dc-67f1-43eb-967a-bce14f1b5f78`, con restauraciones temporales PASS mediante
la API. Una comprobación independiente validó checksum y AES-GCM, reconstruyó
el delta UASDLT01 y comprobó con pg_restore que el registro posterior al completo
está presente en el incremental reconstruido y ausente del completo. No se guardó
SQL descifrado ni se restauró el ORIGINAL. El primer intento de backup fue
rechazado por capacidad insuficiente del tmpfs; se amplió sólo el almacenamiento
del laboratorio, conservando los archivos y sin desactivar el control de espacio.
Evidencias: `incremental-content-proof.json` y gates de backup en `api-results.json`.

## F17: borrado sintético autorizado, API PASS y UI BLOCKED

La autorización del usuario del 10 de noviembre se limitó al perfil
`733b458d-e703-43e0-8f7b-bb842d357afc`, «F17-Eliminar Synthetic», su resultado y
su práctica en el laboratorio indicado. No se eliminó ninguna cuenta real.

La reparación previa del frontend retira los preborrados paralelos de resultados
y prácticas y utiliza una operación central. El backend aplica la desactivación
de auth_user y el borrado del perfil dentro de una transacción.

- Se introdujo un fallo de base de datos que sólo podía activarse al eliminar
  la práctica identificada. La API devolvió 500; las huellas del perfil, auth_user,
  resultado, práctica e intento siguieron iguales. También los otros 102 registros
  comparados de diez tablas. Después se retiró íntegramente ese trigger de ensayo.
- Un solicitante anónimo obtuvo 401 y el alumno 403 al intentar borrar ese perfil.
- El administrador obtuvo 204: perfil, resultado, práctica e intento desaparecen;
  auth_user permanece con is_active=false. No quedan sesiones del perfil.
- La sesión anterior y un nuevo login obtuvieron 401; consultar el perfil devuelve
  404. Los otros 102 registros comparados siguen iguales. No es una comprobación
  universal de retención de todas las tablas: el alcance está en `f17-before.json`.
- El navegador permitió entrar al administrador sintético y mostrar la fila,
  pero los controles documentados no consiguieron ejecutar su confirmación nativa;
  tampoco pudo completarse la recarga posterior. No se simuló una pulsación ni se
  modificó el código para sortearla. **La aceptación gráfica continúa BLOCKED**.

Evidencias: `f17-review-approved.json`, `f17-rollback-proof.json`,
`f17-delete-proof.json`, `f17-ui-control-block.json`, `f17-review-final.json`.
Los tres gates de API son PASS; F17 conserva BLOCKED en la matriz integral.

## Reparación adicional y estado de despliegue

Se corrigió únicamente el texto de `frontend/src/pages/alumno/ExamenActivo.tsx`:
«Volver a exámenes» pasa a **«Volver a resultados»**, coherente con el destino real
que ya abría el botón. No se cambió la navegación ni la lógica académica.

Typecheck, lint, 230 tests y build PASS. Se construyó
`uasspain-closure-frontend:630870e0`; ImageID de Trivy
`sha256:be5252a2cdda55525a291ff207ae1a3f0411431156c9eb2a067d64c62f4b4308`.
El navegador comprobó en esa imagen el texto nuevo y su regreso a Resultados.
Evidencias: `frontend-*.log`, `frontend-label-trivy.json`,
`browser-return-label-fixed.json/png`.

**Sólo está desplegada en laboratorio.** La instrucción de cierre prohíbe nuevos
despliegues, interrupciones y commit/push sin autorización posterior. Por tanto,
esta reparación no está terminada según el gate Docker del ORIGINAL. No se
reconstruye la pila real por rutina ni se usa su salud como prueba del texto nuevo.

## Seguridad y bloqueos que permanecen

- **CA estricta: BLOCKED.** Python 3.13 con VERIFY_X509_STRICT rechaza la CA
  operativa por ausencia de KeyUsage. Node con la CA explícita sí verifica los
  cuatro endpoints. No se cambió ni debilitó validación. El generador actualizado
  no modifica retrospectivamente el certificado legado. Repararlo requiere una
  ventana específica para certificados y confianza de los clientes.
  Evidencias: `python-strict-ca.json`, `operational-ca-public-inspection.log`.
- **F16 y medios reales: BLOCKED.** Tailscale alcanza el otro equipo, pero eso
  no demuestra WebRTC de UAS Spain. RustDesk mostró su sesión; el control remoto
  siguió bloqueado y el control del navegador Windows se detuvo por una limitación
  de comprobación de URL de la herramienta. No se acreditan audio/vídeo, ICE,
  DTLS-SRTP, estabilidad ni reconexión entre las dos redes físicas. La etiqueta
  WebRTC de RustDesk describe RustDesk. Los pasos manuales se entregaron al usuario.
- El usuario identifica el sobremesa como 100.65.143.50; es la identidad Self de
  Tailscale en este host. El otro peer Windows es 100.74.218.27; atribuirlo al
  portátil es una inferencia. Las redes móvil/doméstica constan por declaración
  del usuario, sin una captura de medios que las valide. No se instalaron agentes,
  abrieron puertos ni cambiaron reglas de red o seguridad.
- El acceso existente `https://miguel.taile0e59c.ts.net` respondió 200 en readiness
  con TLS predeterminado de Node, desde este host. Su Serve ya configurado apunta
  a `https+insecure://127.0.0.1:443`; no se cambió. El TLS externo no prueba la
  validación del certificado en ese salto interno. Esta observación tampoco
  demuestra acceso público DuckDNS, TURN ni llamada desde el otro equipo.
- **F15: BLOCKED.** Scripts preparados y validación estática anterior conservada;
  faltan dos extremos administrables autorizados para WireGuard/SFTP, recuperación,
  reinicio y reversión reales. No se configuraron servidores ni firewall.
- **Google ORIGINAL: BLOCKED para acceso real.** Sigue desactivado; se respeta la
  decisión de dejarlo verificado sin vincular. No se vincula una cuenta personal
  con un administrador sintético ni se activa OAuth por inferencia.
- **Cobertura maestra: incompleta.** Los 81 casos no sustituyen los 441 controles
  inventariados ni todas las acciones de los tres paneles. Se conservan las 51 filas
  de acciones previas, sus 39 navegaciones y la matriz de controles; no se promueve
  una navegación a validación de todos sus botones. Rendimiento general, flujos
  externos y controles no ejecutados mantienen NOT_RUN/BLOCKED.
- **Dependencias.** Se conservan los escaneos previos de imágenes originales y
  npm con cero HIGH/CRITICAL en aquel alcance. La imagen frontend nueva registra
  cero HIGH/CRITICAL en su escaneo. Cargo RAW mantiene RSA RUSTSEC-2023-0071 y
  libsqlite3-sys RUSTSEC-2026-0459. Los árboles Linux normal/build repetidos no
  incluyen esas ramas opcionales: exposición N/A para las features ejecutadas,
  **sin afirmar corregido el lockfile ni cero avisos RAW**. Evidencia:
  `rust-exposure-evaluation.json`, `rsa-linux-tree.log`, `sqlite-linux-tree.log`.
- **Secretos.** Gitleaks del árbol distribuible tiene cero coincidencias con las
  exclusiones existentes de `.gitleaks.toml`; no acredita ausencia universal de
  secretos ni incluye los secretos operativos excluidos. Sin staging, commit,
  fetch ni push. HEAD y origin/main local coinciden, no incluyen estas reparaciones
  sin commit y no acreditan el estado actual del servidor remoto.

## Cierre obligatorio de la sección 25

```text
SEQUENCE=BLOCKED
CURRENT=VALIDACION_MAESTRA_Y_DEPENDENCIAS_EXTERNAS
NEXT=NOT_RUN
REASON=CA estricta, medios reales, F15, confirmacion grafica F17 y cobertura maestra pendientes
CHANGE_STATUS=NOT_COMPLETE
RELEASE_GATE=BLOCKED
CODE=IMPLEMENTED; backend r6 sin cambios; texto adicional validado solo en laboratorio
TESTS=PASS en alcance ejecutado; 230 frontend, 4 integraciones; 167 Rust previos conservados
DOCKER_BUILD=PASS imagen frontend de laboratorio; no nueva reconstruccion del ORIGINAL
DOCKER_DEPLOY=PASS LAB; NOT_RUN ORIGINAL para el texto nuevo
POSTGRES=HEALTHY ORIGINAL
REDIS=HEALTHY ORIGINAL
BACKEND=HEALTHY ORIGINAL
FRONTEND=HEALTHY ORIGINAL; texto nuevo no desplegado
NGINX=HEALTHY ORIGINAL
CONTAINERS_HEALTHY=5/5 ORIGINAL
HEALTHZ=PASS; HTTP 200, TLS Node con CA existente
READYZ=PASS; HTTP 200, TLS Node con CA existente
API_LIVE=PASS; HTTP 200, TLS Node con CA existente
API_READY=PASS; HTTP 200, TLS Node con CA existente
E2E_DOCKER=BLOCKED integral; 79/81 casos en sus origenes documentados
FUNCTIONAL_TEST=BLOCKED integral; F17 API PASS y confirmacion grafica BLOCKED
SECURITY=BLOCKED integral; CA estricta y verificaciones de medios pendientes
SECRETS_IN_GIT=0 coincidencias Gitleaks del arbol distribuible con exclusiones documentadas
COMMIT=NOT_RUN; requiere autorizacion posterior
PUSH=NOT_RUN; requiere autorizacion posterior
LOCAL_HEAD=16d1f208acf3dc881cfb272728b57a2ae00d4779
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779; referencia local, sin fetch
CRITICAL=0 detectadas en escaneos OS/npm citados; no dictamen global por verificaciones pendientes
HIGH=0 detectadas en escaneos OS/npm citados; F16 pendiente de aceptacion integral
ERRORS=[CA KeyUsage estricta; medios entre redes; F15 real; UI F17; cobertura maestra; proveedor SMTP externo y Google ORIGINAL sin validar; 2 avisos Cargo RAW opcionales; texto nuevo no desplegado]
```

No se borraron datos ajenos al caso sintético expresamente autorizado. No se
restauró producción, alteró seguridad de red ni publicaron cambios. Este informe
es un cierre de evidencias de la continuación, no el cierre de la auditoría maestra.
