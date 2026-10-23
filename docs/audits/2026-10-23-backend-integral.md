# UASSpain — auditoría y validación aislada, 23 de octubre de 2026

## Actualización: despliegue principal autorizado

La petición posterior «hazme los commits, me actualiza los contenedores y me lo subes a github» autoriza actualizar Docker principal y publicar las correcciones. Sustituye las prohibiciones anteriores de despliegue, commit y push. Las escrituras de prueba continúan exclusivamente en la instancia aislada; se conservan las siete cuentas y todos los registros anteriores.

### Verificación de esta entrega

- Nueva ejecución de gates: **155 tests Rust aprobados, uno ignorado**, fmt, check y clippy PASS; **96 tests frontend**, typecheck, lint y build PASS. No se presentan ejecuciones históricas como nuevas.
- Ejecutado **`powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build`**. Principal: cinco servicios saludables; `/healthz`, `/readyz`, `/api/health/live/` y `/api/health/ready/` devuelven **200**.
- Backend, frontend, nginx y PostgreSQL reconstruidos y recreados. Redis conserva su servicio y datos. Base cifrada desbloqueada con la clave DPAPI existente; sin inicialización, borrado, restauración ni nuevos backups.
- Comparación antes/después: mismos ocho perfiles principales (incluidas las siete cuentas autorizadas), roles, estados, datos académicos, mensajes, llamadas, migraciones, volúmenes y secretos. No se crean registros de negocio de prueba en la principal.
- Browser E2E nuevo en principal: siete sesiones reales, **70 casos de lectura/permisos**, panel de exámenes, respuestas de alumnos sin claves, WSS autenticado, ping/pong real, reconexión y sala ajena denegada.
- Las **mismas cuatro imágenes exactas**, por ID, se aplicaron a la aislada. Nueva regresión real: cinco exámenes UI con notas 10/5/7,5/2,5/0, revisión 20 aciertos/20 errores sin claves, doble envío idempotente y resultados anteriores conservados. Chat bidireccional WSS entre las cinco parejas y dos instructores, más dos envíos desde la UI con recepción DOM/WSS; siete usuarios con cámara/micrófono reales en dos conferencias, reconexión y liberación de dispositivos.
- API aislada: banco incompleto 400, clave vacía 400, opción D inexistente 400, expansión DOCX 400, URL externa 400, traversal denegado, siete DNI opcionales vacíos aceptados y límite de vídeo de dos sockets/sala con tercero 429.
- Trivy sobre las cuatro imágenes reconstruidas: **0 HIGH/CRITICAL reportados**, misma base reciente del 22-10-2026. PostgreSQL emitió un aviso de metadatos ausentes para `CVE-2026-107891`; no se interpreta el escaneo como garantía exhaustiva. Redis sin cambios conserva la evidencia anterior, no se presenta como nuevo escaneo.

| Servicio | ID de imagen desplegada y probada |
| --- | --- |
| backend | `sha256:e281c002d8e8681c6f774a07c8aa17798fc25b7c9aab07d9bdd30bc2b8edc910` |
| frontend | `sha256:9c99dd189266afb8d62424720004910d4cba19642cb8653dd8129dafe56648e7` |
| nginx | `sha256:f2ef82fb64f3b8f008c5cc9b986bd98403626a0efcb0a576849935eaeb47a7b2` |
| postgres | `sha256:56524dcdf6db8ae7013ca2eefc96f6628422052cd1f22b8f8166d5856ce51da5` |

Evidencia local de esta entrega: `.run/deploy-20261023/`, con logs de gates y despliegue, `before.json`, `after.json`, resultados de navegador por origen y escaneos. Los SHA finales, commits, push y comprobaciones posteriores se registran al terminar en `release.json` de ese directorio y en el cierre de la conversación; este documento se prepara antes de crear los commits.

Commits de aplicación preparados tras superar los gates: `b51aae4` (correcciones) y `70ba199` (imágenes). Este informe se publica en un tercer commit. Conteo final aislado: **7 cuentas, 5 matrículas, 1 examen, 40 preguntas, 11 intentos/resultados, 36 mensajes y 27 llamadas finalizadas**. Los seis resultados y veinte mensajes anteriores se conservan por identificador; cero eliminaciones. En la principal, ocho perfiles existentes y todos los datos de negocio permanecen idénticos a la comparación previa.

Gitleaks de esta entrega: cero hallazgos en el árbol distribuible; `git diff --check` y `git diff --cached --check` pasan. El índice incluye únicamente los archivos propios de la entrega. Git no tenía identidad configurada; se utiliza sólo por comando la identidad `uass-bot` ya presente en el historial, sin cambiar configuración global.

Permanecen pendientes la validación externa de Postmark/Reply-To, la revisión académica independiente y la cobertura positiva completa de todas las operaciones. No se fuerza `api_exclusive=true` sin verificación real ni se envían correos. No se declara preparación integral para producción.

Se preservan fuera de estos commits los cambios locales previos ajenos: `nginx/allowed_hosts.conf`, `scripts/start-watch-hidden.vbs`, `package.json` y `package-lock.json` de la raíz.

Tres incidencias del runner resueltas sin cambiar código de aplicación: comparación JSON de campos `undefined` omitidos al serializar, expectativa demasiado estricta 403 frente a denegación válida 404 del documento docente, y observación del socket de chat antes de que terminara de abrirse. La réplica de imágenes también requirió etiquetas locales en vez de IDs interpretados por Compose como repositorios; Redis se mantuvo con su etiqueta existente. Se conservan logs y gates históricos fallidos del runner; las comprobaciones corregidas pasan.

---

## Auditoría histórica previa a la autorización de despliegue

Los apartados siguientes describen la auditoría original aislada. Sus estados `NOT_COMPLETE`, prohibiciones y conteos son históricos; la actualización anterior recoge el despliegue principal posterior y su nueva ejecución de pruebas.

## Estado y alcance

**CHANGE_STATUS=NOT_COMPLETE para la instancia principal. Funciones centrales validadas en Docker aislado. PRODUCTION_READY=NO.**

La respuesta final del usuario, «Solo en una instancia aislada; conserva las siete cuentas», limita todas las escrituras de prueba al proyecto **`uasspain-audit-20261023`**, servido en **`https://localhost:9443`**, publicado únicamente en `127.0.0.1`. Sus cinco servicios quedan disponibles con todos los registros conservados. No se desplegó en el proyecto principal `uasspain`, ni se crearon commits, preparó el índice o hizo push.

Las siete cuentas originales de `https://localhost` mantienen sus identificadores, estado activo y roles. Las réplicas aisladas conservan correos y credenciales autorizadas, con UUID nuevos. Se crearon mediante bootstrap, API administrativa, registro y OTP legítimos. El OTP se entregó por el buzón local cifrado de fixtures: **no acredita entrega Postmark**. No se clonó la base principal ni se compartieron volúmenes persistentes o secretos entre proyectos.

La denegación automática anterior afectaba a escrituras persistentes en la principal. La elección expresa de una instancia aislada resolvió ese bloqueo; no queda una confirmación pendiente. Siguen prohibidos el despliegue principal, los correos reales, los backups/restauraciones y borrar registros.

| Categoría | Resultado |
| --- | --- |
| IMPLEMENTED | Siete reparaciones y actualización de imágenes, sin commit. |
| TESTED | Gates Rust/frontend, escaneos y pruebas reales descritas abajo. |
| VALIDATED | Importación, examen, notas, revisión, chat, audio/vídeo real y persistencia en Docker aislado reconstruido. |
| PRODUCTION_READY | NO: principal antigua, cobertura integral pendiente y validaciones externas no ejecutadas. |

## 1. AUDITORÍA

### Arquitectura y cobertura

Se inspeccionaron Rust/Axum, React, nginx, PostgreSQL cifrado, Redis con TLS/ACL, Compose, redes, mounts, imágenes y permisos. Cada proyecto mantiene cinco servicios: nginx, frontend, backend, postgres y redis.

Inventario: **169 rutas, 226 pares método/ruta**. Las **209 sondas originales de autenticación y endpoints públicos** no equivalen a ejecutar todas las operaciones de negocio. Se conservan su alcance y fecha en [la matriz JSON](../../.run/backend-audit-20261023/endpoint-validation.json) y [CSV](../../.run/backend-audit-20261023/endpoints.csv). Las 70 comprobaciones autenticadas de lectura/permisos de la fase principal y las 70 de la aislada no tuvieron fallos de expectativa. Los flujos positivos aislados complementan esa cobertura; no convierten cada ruta en PASS.

Referencias metodológicas: [OWASP ASVS](https://asvs.owasp.org/) y [OWASP API Security Top 10](https://api-security.owasp.org/editions/2023/en/0x00-header/). No se declara certificación ni ejecución exhaustiva de esos estándares.

### Siete hallazgos reparados

| Severidad | Defecto reproducido | Reparación y revalidación |
| --- | --- | --- |
| Alta | Resultados de alumno revelaban `respuesta_correcta`. | Vista según rol elimina claves recursivamente en envío, listado, detalle y reenvío. Frontend utiliza `acerto`. Cinco alumnos sin claves; revisión real con 20 aciertos/20 errores, sin solucionario. Profesor conserva información autorizada. |
| Media | Banco insuficiente iniciaba un examen más corto. | Validar disponibilidad antes del snapshot. Pedir 41 con banco de 40 devuelve 400 sin crear intento; fixture restaurado a 40. |
| Alta | Expansión documental y trabajo de importación sin límites suficientes. | Límites de entrada, XML, texto, ZIP, páginas, fuentes, contenido y operaciones PDF; dos permisos de concurrencia durante parseo/persistencia. DOCX de 8.358 bytes que expande a 8.388.736 rechazado 400; documento legítimo importa 40 preguntas. |
| Media | Solucionario vacío u opción inexistente aceptados. | Clave A–D obligatoria y opción presente; cálculo rechaza vacías. Clave vacía y D en ABC devuelven 400; nota/identidad fraudulentas del cliente no alteran la corrección del servidor. |
| Media | DNI opcional vacío generaba índice único compartido. | Vacío usa el centinela del índice parcial; HMAC no vacío se conserva. Registro inicial reprodujo fallo; unit test y actualización real de siete DNI vacíos pasan. No se creó una octava cuenta para repetir registro tras reparar. |
| Media | Ráfagas de invalidaciones multiplicaban peticiones y causaban 429. | Agrupar eventos durante 150 ms, carga inicial inmediata, cancelar al desmontar. Cinco eventos producen un callback en test; llamadas finales funcionan con siete participantes. No se midió tasa global HTTP antes/después. |
| Media | Cap WSS genérico de 10 impedía siete presencias más siete vídeos. | Ubicación de vídeo: 14 conexiones/IP y dos/IP/sala; límites de frecuencia y autenticación conservados. Siete usuarios en dos conferencias; dos sockets autorizados por sala aceptados, tercero 429 confirmado en nginx. |

Archivos: `backend-rust/src/{exams,exam_admin,exam_import,security}.rs`, `frontend/src/pages/alumno/ExamenActivo.tsx`, `frontend/src/services/conexionesService{,.test}.ts`, `nginx/nginx.conf`, Dockerfiles frontend/nginx/PostgreSQL y referencias de imagen de Compose. Sin cambios a migraciones aplicadas. Se preservaron cambios previos ajenos en `nginx/allowed_hosts.conf`, `scripts/start-watch-hidden.vbs` y paquetes de raíz.

### Gates y construcción

- Rust: **155 PASS, 0 FAIL, 1 ignorado**; fmt, check y clippy `-D warnings` PASS. El test DB ignorado borra sus filas y no se ejecutó por la obligación de conservar registros.
- Frontend: **96 PASS en 18 archivos**, typecheck, lint y build PASS.
- Builds Docker aislados backend/frontend/nginx/PostgreSQL y `nginx -t` PASS. Redis reutiliza imagen sin cambios.
- Pruebas contra imágenes reconstruidas a través de nginx/TLS; ningún servidor de desarrollo sustituye esta evidencia.

### Vulnerabilidades de imágenes

Base Trivy actualizada **22-10-2026, 19:14:47 UTC**. Imágenes que siguen ejecutándose en la principal: **0 CRITICAL, 11 ocurrencias HIGH de 6 CVE distintos**; nginx cinco, frontend cinco, PostgreSQL una, backend/Redis cero. CVE: `CVE-2026-77214`, `CVE-2026-88806`, `CVE-2026-15176`, `CVE-2026-93479`, `CVE-2026-97205`, `CVE-2026-111943`.

Las cinco imágenes aisladas y el lockfile Rust escaneados quedan en **0 HIGH/CRITICAL**. Se actualizó nginx a 1.30.6 Alpine 3.24, construcción Go a 1.27.3 Alpine 3.24 y gocryptfs al paquete disponible 2.6.1-r7. No se probó explotabilidad: [nginx](https://nginx.org/en/security_advisories.html) clasifica sus avisos correspondientes como medios, mientras Trivy reporta HIGH; tampoco se demostró alcanzable la ruta x509 en gosu. Evidencia: JSON `vulnerabilities-fresh-*`, `isolated/vulnerabilities-*-final.json`, `isolated/vulnerabilities-backend-runtime.json` y `vulnerabilities-candidate-uasspain-postgres.json` del directorio de auditoría.

## 2. EXAMEN

### Fuente y PDF

Descarga autenticada y hashes contrastados de **10 PDF, 618 páginas extraídas**: A1/A3, A2, STS y Radiofonista. No se localizaron otros formatos entre esos diez archivos. Extraer 618 páginas no equivale a inspeccionarlas visualmente todas.

Examen basado exclusivamente en **Teoría A1/A3, AESA, edición 09 de julio de 2024**: **40 preguntas españolas únicas, tres opciones ABC y una correcta**, distribución 14/13/13. [Trazabilidad por página/sección](../../.run/backend-audit-20261023/question-traceability.json), sin claves.

**[PDF de 40 preguntas](../../.run/backend-audit-20261023/UASSpain_Examen_40_Preguntas.pdf)**: siete páginas, 39.316 bytes, texto seleccionable, sin solucionario. SHA256: `8134a8dd47704d222b2400b04e499a7fae58ab20a4734238cb7634a2758ddb52`.

Se inspeccionaron visualmente las siete páginas renderizadas y se verificaron por extracción independiente numeración 1–40, 120 opciones y caracteres. **Revisión académica independiente: NOT_RUN**; la revisión del mismo agente no cuenta como segundo revisor. DOCX docente de importación y claves en carpeta privada fuera de Git, sin publicar aquí.

### Importación y cinco ejecuciones simultáneas

Curso `9e724efa-46aa-4a0f-88eb-f21b0690bbb4`, examen `0b222298-0a62-4f66-a671-f2a04849a9fe`. Subida/importador existentes: **40 preguntas, un examen, cero errores**. Cinco matrículas de prueba conservadas. La asociación usa categoría y contexto de material; la plataforma no tiene FK directa examen–curso.

Cinco sesiones independientes respondieron en la UI Docker real, con ejecución concurrente. El servidor corrigió:

| Cuenta | Aciertos | Nota | Resultado |
| --- | ---: | ---: | --- |
| Alumno 1 | 40/40 | 10 | Aprobado |
| Alumno 2 | 20/40 | 5 | No aprobado |
| Alumno 3 | 30/40 | 7,5 | Aprobado |
| Alumno 4 | 10/40 | 2,5 | No aprobado |
| Alumno 5 | 0/40 | 0 | No aprobado |

Verificado: cambio de selección, guardado PostgreSQL, recuperación tras recarga, arranque idempotente, doble envío sin duplicados, historial y aislamiento entre alumnos. Instructores ven asignados 3/2. Los cinco descargan PDF con hash correcto y reciben denegación al DOCX docente.

Un **sexto intento conservado de Alumno 2** verifica la revisión modificada: nota 5, 20 respuestas verdes/20 rojas, sin solución no elegida. Resultado `689ed22f-bbea-4ad9-8392-58c4adfa738b`. Ambas capturas inspeccionadas; resultado persistente después de reiniciar backend. Los cinco resultados originales no cambian.

## 3. CHAT Y VIDEOLLAMADAS

### Chat real

Cinco parejas instructor–alumno y canal entre instructores mediante REST autenticado y WSS real. Diez mensajes directos simultáneos llegaron al navegador contrario. Se comprobaron identidad, historial, ausencia de duplicados, desconexión/reconexión y recuperación del mensaje enviado sin conexión. Envío y recepción también desde la UI, observando socket nativo y DOM.

Se conservan **20 mensajes: 18 directos y dos entre instructores**, incluidos intentos previos del runner y dos probes XSS. Payload persistido por API aparece como texto sin ejecutar/crear `img` o `script`. Conversaciones ajenas y escrituras no autorizadas denegadas. Chat de grupo: N/A, inexistente en este flujo.

### Cámara y micrófono reales

**PASS: siete usuarios, dos conferencias simultáneas**, de cuatro y tres participantes. Chromium completo, cámara/micrófono reales, sin dispositivos ficticios, canvas, SDP ni respuestas simuladas. Headless-shell inicial no soportó dispositivos; cambio de motor con sesiones legítimas independientes.

18 conexiones dirigidas de pares: tres por usuario en sala de cuatro, dos en sala de tres. Todos aumentaron bytes de audio, muestras y frames de vídeo decodificados durante 3,5 segundos: 30.425–41.667 bytes de audio y 81–108 frames por usuario. Controles de micrófono/cámara, sala ajena denegada, corte de señalización y reconexión de media PASS.

Al colgar se liberaron las pistas de los siete usuarios. Conteo deduplicado: un stream, una pista audio y otra vídeo por usuario; contadores anteriores duplicaban referencias, no dispositivos. **No se guardaron frames de cámara ni grabaciones.**

**21 registros de llamadas conservados, todos finalizados**, incluidos intentos fallidos, cinco invitaciones finales y prueba del límite. UI sin acción distinta «Rechazar»: N/A. ICE devuelve cero STUN/TURN: el éxito local directo **no acredita redes externas/NAT/TURN**.

## 4. CONCURRENCIA Y PERSISTENCIA

### Medición final

Después de recrear los cinco servicios: cinco rondas de siete lecturas autenticadas concurrentes de resultados; **35 respuestas 200, cero 5xx; mediana 22,96 ms, p95 32,49 ms, máximo 35,06 ms**. Entonces cada alumno tenía un resultado original y los instructores veían 3/2.

| Servicio | CPU antes → después | Memoria antes → después |
| --- | --- | --- |
| Backend | 0,45 % → 1,07 % | 6,727 → 8,27 MiB |
| PostgreSQL | 0,57 % → 0,98 % | 131,2 → 130,1 MiB |
| Redis | 0,28 % → 3,43 % | 6,645 → 6,531 MiB |

Instantáneas, no picos. No permiten extrapolar capacidad ni demostrar cuello SQL. Las lecturas principales anteriores usaron otros datos/carga; no son comparación de optimización antes/después.

### Conservación demostrada

Se recrearon los cinco contenedores aislados usando los mismos volúmenes/claves, sin `down -v`, prune, reset o restauración. Se desbloqueó almacenamiento existente sin `-InitializeKey`. Sobrevivieron siete identidades/sesiones, cinco matrículas/resultados originales, veinte mensajes por ID, veintiuna llamadas y dato nuevo Redis mediante AOF. El sexto intento se creó después y se conservó adicionalmente tras reiniciar backend.

**Conteo final:** 7 cuentas, 15 cursos (14 de migración existente y uno de prueba), 5 matrículas, 1 examen, 40 preguntas, **6 intentos/6 resultados**, 18 mensajes directos/2 staff y 21 llamadas finalizadas. Eliminaciones: **0**.

Secretos aislados y DPAPI conservados byte por byte en **`.secrets/backend-audit-20261023/`**, ACL usuario Windows y SYSTEM. Clave `postgres-storage-key.dpapi`: no regenerar ni inicializar esta base existente. Configuración/origen en `.run/backend-audit-20261023/isolated/{compose,identity}.json`, con archivo de entorno vacío sin cargar `.env` principal.

Verificación de almacenamiento: AES-256-GCM, nombres cifrados, PGDATA/WAL/temporales/logs cubiertos, sin mount persistente en claro, clave temporal retirada, capacidades postmaster cero, clave incorrecta rechazada y swap deshabilitado. Backend/datos sin salida externa; TLS, ACL y mínimos privilegios conservados.

## 5. VALIDACIÓN Y LÍMITES

### Estado Docker final

**5/5 saludables en ambos proyectos**. Ambos orígenes devuelven 200 en `/healthz`, `/readyz`, `/api/health/live/`, `/api/health/ready/`: ocho comprobaciones. Principal conserva imágenes y arranques anteriores, siete perfiles activos y **cero volúmenes persistentes compartidos**.

Identidad, imagen/ID, creación, reinicio, mounts, redes, hash de fuentes y SHA Git: [runtime-final.json](../../.run/backend-audit-20261023/isolated/runtime-final.json). Recreación y hashes ejecutados backend/frontend/nginx: [validation.json](../../.run/backend-audit-20261023/isolated/validation.json), `fullRestart` y `finalRetention`. Aislada: `uasspain-backend:audit-runtime-20261023`, `uasspain-{frontend,nginx,postgres}:audit-only-20261023` y Redis sin cambios. Las principales siguen antiguas.

No se ejecutó `scripts/start-encrypted-stack.ps1 -Build`: apunta a la principal y violaría el aislamiento. Esto impide declarar finalizada la reparación principal conforme a AGENTS.md.

### Correo pendiente

Aislada: Postmark, `no-reply@uasspain.com`, contacto `info@uasspain.com`, sin clave externa, `ready=false`, **`api_exclusive=false` pendiente**. Activación con fecha/ID de verificación falsificados devuelve 400. Contacto válido devuelve **503 service_unavailable**, cerrado sin transporte verificado; cero correos reales.

No se fuerza `api_exclusive=true`: exige verificación real incompatible con direcciones `.invalid` y prohibición de envío. Buzón OTP fixture no sustituye ese gate. Entrega Postmark, Reply-To real y recuperación externa del circuit breaker: **BLOCKED**. Configuración principal intacta; el estado pendiente y circuit breaker abierto observados antes no se declaran corregidos.

### Seguridad adicional y omisiones

Filtros tipo SQLi sin ampliar alcance, URL externa de importación rechazada antes de fetch, traversal codificado denegado, XSS almacenado como texto, autenticación/autorización REST/WSS comprobados. No acreditan ausencia exhaustiva de vulnerabilidades.

**NOT_RUN:** todos los flujos positivos de las 226 operaciones, cambio/caducidad/reset completo de contraseñas, backups/restauración, borrados positivos, test DB que elimina filas y revisión académica independiente. **BLOCKED:** correo real; redes externas/TURN sin configurar. No se reutilizan pruebas E2E anteriores como ejecuciones nuevas.

### Fallos históricos conservados

Evidencia mantiene cinco gates FAIL históricos y once errores de runner; no se borraron. Causas/revalidaciones:

1. Colisión DNI vacío: reparación con alcance de retest descrito.
2. Asignaciones antes de rol y lectura previa a propagación: orden/race de setup corregidos; siete identidades finales pasan.
3. 429 sin cuerpo esperado: ráfaga reparada y comprobación explícita del runner.
4. Captura headless-shell no soportada: Chromium completo real PASS.
5. Cap WSS diez: reparación, siete usuarios con RTP y denegación del tercer socket PASS.
6. Selector abría sección equivocada; texto coincidía con preview y burbuja: selectores corregidos, no duplicados DB.
7. Observador posterior a apertura de socket: observar socket existente, UI/WSS PASS.
8. Probe XSS esperaba caracteres saneados: segundo probe API confirma escape; ambos mensajes conservados.
9. Contacto con servicio no publicado dio correctamente 400; «Otro» válido da 503.

También resueltos errores iniciales de CA, secuenciación, ACL, nombres TLS, conectividad aislada, gocryptfs-r6 no disponible, tamaño cache Trivy y render PDF GPU. No se cambiaron datos principales, desactivaron tests ni borraron registros para conseguir PASS. Sin fallo abierto de build, salud o función central aislada; limitaciones pendientes explícitas.

### Git y cierre obligatorio

Gitleaks redactado: **0 hallazgos** en árbol distribuible usando `.gitleaks.toml` (excluye `.run`, `.secrets`, `.env`, dependencias), y 0 en historial con configuración más estricta y límite de 80 commits; el scanner informa **67 commits procesados**. No significa ausencia de claves en carpetas privadas: existen deliberadamente fuera de Git. `git diff --check` y `git diff --cached --check` pasan; índice vacío, sin preparar archivos.

SHA son referencias locales: `origin/main` **cacheado, sin fetch ni comprobación nueva del servidor GitHub**.

```text
CHANGE_STATUS=NOT_COMPLETE
CODE=IMPLEMENTED_UNCOMMITTED
TESTS=PASS_RUST_155_FRONTEND_96; IGNORED_DB_TEST=1
DOCKER_BUILD=PASS
DOCKER_DEPLOY=PASS_ISOLATED_ONLY; MAIN=NOT_RUN_USER_FORBIDS
POSTGRES=HEALTHY_MAIN_AND_ISOLATED
REDIS=HEALTHY_MAIN_AND_ISOLATED
BACKEND=HEALTHY_BOTH; CORRECTIONS_ONLY_ISOLATED
FRONTEND=HEALTHY_BOTH; CORRECTIONS_ONLY_ISOLATED
NGINX=HEALTHY_BOTH; CORRECTIONS_ONLY_ISOLATED
CONTAINERS_HEALTHY=5/5_MAIN_AND_5/5_ISOLATED
HEALTHZ=200_BOTH
READYZ=200_BOTH
API_LIVE=200_BOTH
API_READY=200_BOTH
E2E_DOCKER=PASS_CORE_FLOWS_ISOLATED; ALL_ENDPOINT_BUSINESS=PARTIAL
FUNCTIONAL_TEST=PASS_EXAM_IMPORT_UI_GRADING_REVIEW_CHAT_REAL_AUDIO_VIDEO_PERSISTENCE_ISOLATED
SECURITY=PARTIAL_VALIDATED_ISOLATED; MAIN_FINDINGS_REMAIN
SECRETS_IN_GIT=0_FINDINGS_IN_SCANNED_TREE_AND_HISTORY_67_PROCESSED_LIMIT_80
COMMIT=NOT_RUN_USER_FORBIDS
PUSH=NOT_RUN_USER_FORBIDS
LOCAL_HEAD=a06d95a8daf32378463ff9857c887f97858c1de9
ORIGIN_MAIN=a06d95a8daf32378463ff9857c887f97858c1de9
ORIGIN_MAIN_VERIFICATION=CACHED_NO_FETCH
CRITICAL=0_IN_SCANNED_IMAGES; FULL_BUSINESS_AUDIT_INCOMPLETE
HIGH=MAIN_2_CODE_FINDINGS_AND_11_IMAGE_OCCURRENCES_6_CVE; ISOLATED_SCANNED_IMAGES_0
ERRORS=HISTORICAL_FAILURES_RETAINED_AND_EXPLAINED; EXTERNAL_AND_OMITTED_VALIDATIONS_LISTED
SEQUENCE=BLOCKED
CURRENT=MAIN_DEPLOY_AND_REMAINING_ACCEPTANCE
NEXT=NOT_RUN
REASON=MAIN_DEPLOY_FORBIDDEN; REAL_MAIL_FORBIDDEN; INDEPENDENT_REVIEW_AND_FULL_BUSINESS_COVERAGE_NOT_RUN
```

Instancia aislada conservada para inspección con siete cuentas, datos y claves. Navegadores y runner de esta auditoría cerrados; registros persistentes conservados.
