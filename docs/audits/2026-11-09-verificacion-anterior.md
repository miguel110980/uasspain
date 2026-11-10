# Verificación de la auditoría anterior sobre el ORIGINAL

Fecha: 9 de noviembre de 2026. Fuente de aplicación: únicamente este repositorio
ORIGINAL y su proyecto Docker `uasspain`, servido en `https://localhost`.

**DEPLOYED, pero CHANGE_STATUS=NOT_COMPLETE y RELEASE_GATE=BLOCKED.**
Las reparaciones de la aplicación están reconstruidas en Docker. La auditoría
maestra sigue abierta: los PASS parciales no acreditan preparación para cliente.
No se ha hecho staging, commit, fetch ni push en esta ejecución.

## Evidencia recuperada y criterio de comparación

Se leyeron, sin modificar ni arrancar el laboratorio, su `AUDITORIA-INICIAL.md`,
30 informes JSON y los informes originales de dependencias e imágenes en
`C:\Users\migue\UASSpain-lab-20261109\evidencias`.
Se reutilizaron sus casos y documentos sintéticos PDF/DOCX/DOC, no su código
corregido, base, secretos ni resultados como validación del ORIGINAL.

- Los 17 hallazgos F01–F17 se contrastan individualmente debajo: 11 PASS y 6 BLOCKED.
  También están disponibles en [hallazgos-anteriores.csv](2026-11-09-hallazgos-anteriores.csv).
- Los 81 casos históricos tienen fila propia en
  [comparacion-casos.csv](2026-11-09-comparacion-casos.csv): 54 PASS, 27 BLOCKED.
  Ningún caso se ha omitido ni convertido en PASS por su resultado en el laboratorio.
- [comparacion-dependencias.csv](2026-11-09-comparacion-dependencias.csv)
  conserva 14 instancias OS de 8 CVE, los 16 paquetes npm históricos (28 filas al
  separar avisos directos y cadenas transitivas), 11 avisos Rust históricos y un
  aviso Rust adicional actual. Son 54 filas: 52 PASS y 2 BLOCKED.
- Hay 72 comprobaciones propias únicas PASS en `fixture-api-latest-results.json`.
  Este número incluye API, BD, WSS y comprobaciones de interfaz; no significa
  72 E2E completos ni cobertura de todos los controles.

Los ficheros de evidencia citados sin directorio se encuentran en
`.run/original-20261109-evidence/`, excluido de Git. Los CSV conservan fuente,
estado histórico, resultado actual, adaptación, evidencia y bloqueo por caso.
El índice recuperado registra hashes de los 30 informes. Se corrigió su primera
clasificación de dos informes Rust: tenían diagnóstico antes del JSON, pero
contenían avisos válidos recuperables. Tampoco se interpretó «final» o «limpio»
en el nombre de un fichero como ausencia de vulnerabilidades.

## Hallazgos F01–F17

PASS acredita el contrato concretamente ensayado. BLOCKED puede coexistir con un
parche implementado y pruebas parciales PASS; no demuestra que el defecto siga
explotable ni que esté completamente resuelto.

| ID | Impacto previo | Causa raíz y reparación en ORIGINAL | Estado y evidencia actual |
|---|---|---|---|
| F01 | HIGH | Registro/reset/alta verificaban la contraseña contra todos los hashes. Se eliminaron los tres barridos y se conserva la política individual. | **BLOCKED**. Alta administrativa de las cuatro cuentas nuevas con contraseña compartida PASS (`F01-CREATE`); registro público, reset por correo y medición dinámica de coste con el censo pendientes. No se cambió SMTP ni se fingió entrega OTP. |
| F02 | HIGH | La visibilidad de solicitudes dependía de estar asignado. Bandeja común para instructores, datos limitados, resolución transaccional única y sin asignación implícita. | **PASS**. `F02-0/1/2`, `F02-CONC` (200/409), `F02-ASSIGN`, `F02-REJECT`, `BROWSER-ADMISSION`; comprobación BD de asignación nula. OTP del fixture preparado, no entrega de correo. |
| F03 | HIGH | La edición de prácticas usaba al autor histórico. Ahora autoriza la asignación actual bajo bloqueo transaccional, conservando autor y fecha. | **PASS**. A→B→C, `F03-OLD/NEW`, `REASSIGN-C`, `HISTORY-C`; C edita una práctica nueva en navegador y el alumno ve la persistencia, sin controles de edición. |
| F04 | HIGH | Consultas de conversación por alumno omitían la pareja histórica de instructor. Se filtra pareja actual en lecturas y mutaciones y se invalida la vista al reasignar. | **PASS**. `F04`, aislamiento API de tres alumnos, tercero WSS 403, tres conversaciones reales sin cruces, reconexión y revocación; `browser-three-chats-original.json`. Historial privado conservado. |
| F05 | HIGH | El parser rechazaba DOC. Se integra lector de DOC binario genuino, límites de recursos y proceso con seccomp, sin macros ni acceso a red/archivos del proyecto. | **PASS**. DOC/PDF/DOCX equivalentes, dos preguntas y cuatro opciones, revisión y persistencia de borrador; `DOC-*`, `DOC-EQUIVALENCE`, `BROWSER-DOC-*`. El probe Linux deniega lectura, escritura, borrado, red y procesos. |
| F06 | HIGH | Aprobación desde nota redondeada >=7. Decisión exacta sobre porcentaje configurado del servidor. | **PASS**. 29/40 y 22/30 suspenden; 30/40 y 23/30 aprueban, mediante intentos y resultados nuevos reales (`A1-29/30`, `A2-22/23`). |
| F07 | HIGH | Duración fija de 40 minutos e importación en bloques de 40. Política de servidor y snapshot por intento; A2 30 preguntas/1800 segundos. | **PASS**. `A2-TIME`, importación y diálogo del navegador con 30 preguntas/30 minutos (`browser-a2-duration-check.json`). No se presenta como certificación oficial del examen. |
| F08 | HIGH | Envío no esperaba la cadena de guardados; vencimiento se decidía tras esperar al bloqueo SQL. Se esperan guardados, serializan respuestas, añade revisión optimista y se captura recepción antes del bloqueo. | **BLOCKED** para aceptación integral. `TWO-TABS`, `DEADLINE`, `SUBMIT-IDEMPOTENT`, `LOCK-DEADLINE` PASS contra Docker/BD, incluida espera SQL de 2 s; el flujo de última respuesta con latencia y dos ventanas completas en la interfaz de examen no se ha ejecutado. |
| F09 | HIGH | La falta de bloqueo equivalía a permiso. Concesión positiva por recurso/categoría y fechas en lista, detalle, descarga y progreso; metadatos del servidor. | **PASS**. `F09`, `MATERIAL-DENY/GRANT/REVOKE/HISTORY`, descarga real con SHA coincidente y progreso conservado al revocar. Denegación 403 o 404 es válida con control positivo de acceso. |
| F10 | MEDIUM | Historial truncado a 500 y clientes sin recorrer páginas. Se pagina con orden estable y se integra historial práctico común. | **PASS**. 602 prácticas nuevas, páginas 500+102, sin duplicados; navegador muestra 602 y permite llegar a registros antiguos. Se conservan resultados académicos al reasignar. No se afirma haber creado >500 resultados de exámenes. |
| F11 | MEDIUM | Nombre/apellidos enviados a ui-avatars.com. Se elimina el generador externo y se ofrece avatar local predeterminado. | **PASS**. Código corregido, regresión frontend y formulario público con nombres sintéticos sin imagen ui-avatars; `browser-registration-privacy.json`. Sin enviar registro ni crear una quinta cuenta. |
| F12 | MEDIUM | Avatar anónimo sin propiedad/cuota persistente suficiente. Tickets opacos, propiedad atómica, caducidad y cuota en migración 0034. | **BLOCKED**. Migración aplicada; ownership autenticado PASS no sustituye los 14 casos públicos de avatar pendientes. Registro OTP, cuota global y limpieza automática requieren un ensayo adicional delimitado que no modifique cargas ajenas ni borre archivos. |
| F13 | HIGH | Instructor admitido en DELETE individual/masivo sin propiedad. Se exige administrador antes de acceder al registro. | **PASS** para denegación. Ambos endpoints devuelven 403 en sesión instructor. Se adaptó la prueba a un UUID nuevo inexistente para garantizar cero borrados incluso ante regresión (`F13`). No se ejercitó borrado efectivo de administrador. |
| F14 | HIGH | Importación activaba bancos directamente y elegía parser solo por extensión. Firmas reales, límites, revisión autenticada con token HMAC, confirmación explícita, borrador y deduplicación. | **PASS** para revisión/confirmación/deduplicación y formatos ensayados. Vista previa no crea banco; confirmación crea un borrador; repetir no duplica. Error visible en navegador conserva la revisión. Tests del parser y probe Linux complementan estas pruebas. |
| F15 | MEDIUM | Script antiguo calculaba raíz en infra y añadía infra otra vez. Se corrige a raíz del repositorio mediante PSScriptRoot; se prepararon exactamente dos entregables autónomos en Escritorio. | **BLOCKED**. Ruta real a infra/config.ps1 y AST PASS (`wireguard-root-fix-validation.json`); PowerShell y bash -n de entregables PASS. Sin aplicar red. Dos máquinas, handshake, SFTP, idempotencia/reinicio/reversión reales y extremo servidor Windows nativo no validados. |
| F16 | HIGH | API de vídeo admitía participantes históricos; WSS silencioso tardaba hasta heartbeat en revocar. Se exige asignación actual en API y comprobación periódica WSS de sesión y autorización. | **BLOCKED** para aceptación integral de medios. API y señalización WSS PASS, tercero 403, entrega TLS legítima y ambas conexiones revocadas en 960 ms en imagen final. No se activaron cámaras/micrófonos ni se probaron medios entre dos redes. |
| F17 | MEDIUM | La interfaz preborraba recursos en paralelo y toleraba errores antes de eliminar perfil. Se retiran los preborrados y se usa la operación central del backend. | **BLOCKED**. Código y regresión frontend PASS. Eliminación real y retención/cascadas no ensayadas por la prohibición explícita de borrados; no se simula un PASS destructivo. |

## Defectos adicionales encontrados durante la validación

1. **Admisión y reactivación (HIGH funcional):** rechazar una solicitud alteraba
   también `auth_user.is_active`; reactivar el perfil dejaba el acceso en 401.
   Se conserva ese indicador independiente y se controla la admisión con el estado
   del perfil, sin saltarse la exigencia de cuenta habilitada. Reproducción sobre
   alumno nuevo, parche, Rust y reconstrucción; rechazo→401→reactivación admin→200
   PASS (`ADMISSION-REACTIVATION-REGRESSION`). Ningún usuario previo reactivado.
2. **Revocación de señalización silenciosa (HIGH):** ambos sockets continuaban
   abiertos tras 3 s sin tráfico. Se comprueba autorización cada segundo además
   de la sesión. Antes FAIL conservado; después 928 ms y repetición final 960 ms,
   ambos cerrados. El control positivo de señalización legítima sigue PASS.
3. **Nombre del banco importado (LOW):** se usaba el UUID del almacenamiento en
   vez del nombre original. Se obtiene el nombre validado de metadata, separando
   rutas y extensión y limitando longitud/caracteres. Rust audit y reconstrucción;
   nuevo DOC genuino con una pregunta distinta, confirmación con título legible,
   dos preguntas y activo=false PASS en BD e interfaz. Se conservan títulos previos.

No se sustituyeron preguntas solo para eludir la deduplicación: los dos documentos
de interfaz nuevos contienen una pregunta semánticamente distinta, conservan el
formato OLE genuino y quedan identificados en el manifiesto de fixtures.

## Dependencias, contenedores y secretos

- Las imágenes finales activas nginx, frontend, backend, postgres y redis tienen
  **0 HIGH y 0 CRITICAL OS** en Trivy. Se escaneó nuevamente backend r6; los otros
  cuatro informes se reutilizan únicamente tras comprobar igualdad exacta de ID.
  El ORIGINAL tenía 21 HIGH + 1 CRITICAL antes de las actualizaciones; el informe
  histórico del laboratorio tenía otra línea base, 13 HIGH + 1 CRITICAL (14
  instancias), que también se conserva individualmente.
- npm raíz y frontend: **0 avisos de cualquier severidad**. DOMPurify 3.4.17.
  La línea base del ORIGINAL eran 20 paquetes afectados; la del laboratorio,
  16. No se confunden esas dos mediciones.
- Cargo audit RAW conserva **2 avisos**, RSA RUSTSEC-2023-0071 y
  libsqlite3-sys RUSTSEC-2026-0459. Las ramas opcionales MySQL/SQLite no aparecen
  en el árbol Linux normal/build actual, comprobado con `cargo tree --offline
  --locked --target x86_64-unknown-linux-gnu --edges normal,build --invert ...`.
  Esto acota exposición del build; no corrige el lockfile ni convierte RAW en PASS.
  Los otros diez avisos Rust previos ya no aparecen: rustls 0.23.46,
  rustls-webpki 0.103.16, webpki-roots 1.0.11 y zip 9.5.0.
- Gitleaks del árbol distribuible final: 0 coincidencias, con exclusiones
  documentadas en `.gitleaks.toml` (incluye .env, .secrets y .run). La revisión
  histórica estricta obtuvo 46 coincidencias, clasificadas como campos de hashes
  del baseline, no credenciales; no se publica el contenido de secretos.
  Esto no es una promesa de ausencia universal de secretos.
- TLS validado en Node, WSS y navegador. No se modificó la CA existente:
  continúa BLOCKED la compatibilidad estricta de KeyUsage con Python 3.13.
  No se deshabilitó la validación de certificados para superar las pruebas.
- PostgreSQL permanece sobre el mismo volumen cifrado gocryptfs. Redis protegido,
  TLS interno/externo y cinco servicios; sin servicios nuevos permanentes, cambios
  de Compose, secretos, claves DPAPI, OAuth, certificados, dominio ni red.
- No se acredita E2EE de aplicación para chat. TLS y cifrado de disco no son E2EE.

## Construcción y validación operativa

Se ejecutó el arranque oficial autorizado con `-Build`, después del backup y de
verificar recursos de reversión. Se repitió tras los parches adicionales, no para
crear una instalación paralela. El último registro es `official-stack-build-r4.log`.
Las migraciones 0032, 0033 y 0034 están aplicadas con success=true; no se editaron
migraciones aplicadas ni se recalcularon expedientes anteriores.

| Servicio | ID de imagen activo final |
|---|---|
| nginx | sha256:cd00ca5c1c923d36049e9c670b61fa6d2e7a1d5b8cf4a893b8bd7fced1649cce |
| frontend | sha256:9ad408c1361342ff51fc1796655ff0959153ad2afc449d73027083447f121e4a |
| backend | sha256:4e6e149c36da0be75e34e73244a4c82c12bd195f5a15c71dd174236610289297 |
| postgres | sha256:c4abfd8d90e9778d0df185f6f8547d59acd9e97b80264619059d6acc144317e3 |
| redis | sha256:41ab076c0cf4886f65c4373b15dbba5594f182c20c70ddc5a9660beff835f4e3 |

`deployed-services-final.json` registra contenedores, creación, arranque, imágenes,
montajes, salud y controles Docker. Los cinco están healthy en proyecto uasspain.
`final-health.json`: los cuatro endpoints obligatorios responden 200 por TLS.
El recibo de 94 inputs backend r6 tiene SHA256
`69d2f1e093bd1bce118e42d9725bf4fdd69131c1d4ab9d31df1420d551e91a84`.
El arreglo posterior del helper WireGuard es un script del host ajeno a los
ficheros COPY de las imágenes; no se ejecutó ni exige recrear servicios de red.

Pruebas ejecutadas: frontend typecheck/lint, 21 archivos/230 tests y build PASS;
backend Linux audit fmt/check/clippy, 167 tests PASS, cuatro ignorados, y probe
del conversor PASS (`linux-audit-r6.log`). Los cuatro ignorados exigen fixtures
SMTP/BD desechable marcados y no se ejecutan sobre la base activa.
Los casos no afectados de builds Docker anteriores de esta misma reparación
conservan su imagen de ejecución; no se les atribuye falsamente una ejecución r6.
En r6 se repitieron importación/nombre, WSS de vídeo y revocación silenciosa,
admisión visible, tres chats visibles y privacidad del registro.

## Integridad, reversión y cierre de ensayos

El backup completo nuevo autorizado, cifrado y verificado, tiene ID
`0eb6193a-22f2-4f00-8efb-19fcd60b21fa`. Verificación API 200, valid=true y errors=[].
Sus 17 predecesores conservaron sus registros y checksums. No se restauró ninguno.
SHA256 BD: `4ac8efe10056e94652846a8fe241be03f1ff1c81560effeb61d5284e3ca22143`.

Con la excepción expresamente aceptada se conservaron imágenes locales de Nginx
y Redis con `--no-pause`, sin volúmenes ni servicios duplicados; escaneo de
secretos 0 y comparación de binarios/configuración. Frontend/backend/postgres
antiguos conservan referencias a imágenes ya existentes. `rollback-resources-verified.json`
acredita recursos disponibles, no una restauración funcional ensayada.
Las imágenes de emergencia conservan avisos antiguos y no son la versión de entrega.

El manifiesto de esta ejecución `UAS-AUDIT-20261109-eea9d1c2` delimita todos los
ensayos. Se crearon un instructor y tres alumnos, nunca una cuenta real.
Los cuatro están ahora bloqueados; ocho bancos y un material nuevos inactivos.
Se conservan 602 prácticas y demás datos de ensayo, sin borrados. Las credenciales
nuevas se retienen solo cifradas con DPAPI en un fichero local ignorado; no van al
informe ni a Git. Se cerraron 15 contextos API propios y las pestañas de ensayo.

`existing-academic-preservation-final.json`: **20/20 registros previos con igual
SHA256 por ID**, excluidas exclusivamente las tres columnas nuevas autorizadas.
`existing-profiles-preservation-final.json`: **8/8 perfiles previos conservan
roles, email cifrado, estado, verificación y asignación**. Actividad/sesiones de
login propias no son expedientes y no se confunden con esa huella.
No se cambió contraseña, rol, asignación ni estado de una cuenta anterior.
La modificación previa de allowed_hosts y su backup se mantienen.

## Pendientes del plan maestro, sin reducir alcance

1. SMTP/OTP y reset reales con destinatario controlado; cuatro integraciones Rust
   ignoradas. No se activa DEV_EMAIL ni se cambia configuración operativa.
2. Registro/avatares anónimos, cuotas y limpieza; latencia y dos ventanas completas
   del examen en navegador; borrado efectivo y retención, actualmente no autorizado.
3. Google real del ORIGINAL: desactivado; se respeta «verificado sin vincular».
   La prueba anterior de otra instalación no valida este origen. Sin vincular
   identidad personal a ninguna cuenta sintética ni activar/configurar OAuth.
4. WebRTC con medios reales en dos redes, TURN público/NAT; dos extremos VPN/SFTP,
   reinicio/idempotencia/reversión de scripts. No hay extremos de ensayo disponibles.
5. Restauración y copia incremental: sin entorno de restauración autorizado y
   sin duplicar instalaciones. El backup completo verificado no acredita un drill.
6. Dos avisos RAW Rust y compatibilidad estricta de la CA anterior con Python.
7. Cobertura de **cada** control de los tres paneles. Se navegaron 39 secciones y
   se ejecutaron acciones concretas, pero no todos los botones/formularios ni
   pruebas de carga/concurrencia generales. El inventario estático inicial de 496
   y la extracción posterior de 441 usan heurísticas distintas; no son cobertura.
   Los controles no ejecutados conservan NOT_RUN/BLOCKED. No se infiere PASS por
   una navegación ni por un test unitario. La matriz maestra sigue pendiente de
   expansión completa por rol y acciones; las filas comprobadas se trazan aparte.
   [controles-ejecutados.csv](2026-11-09-controles-ejecutados.csv) contiene 51 filas
   de acciones observadas (39 son navegación de sección), con sus límites.

No se solicita de nuevo permiso para código, ventana local ni ensayos ya aprobados.
Las dependencias externas o destructivas necesitan su alcance específico; no se
ejecutan por el mero hecho de estar descritas en un documento.

## Cierre obligatorio de la sección 25

```text
SEQUENCE=BLOCKED
CURRENT=VALIDACION_MAESTRA
NEXT=NOT_RUN
REASON=27 casos históricos y verificaciones maestras externas/funcionales pendientes
CHANGE_STATUS=NOT_COMPLETE
RELEASE_GATE=BLOCKED
DEPLOYMENT=DEPLOYED
CODE=IMPLEMENTED; reparaciones de aplicación probadas y desplegadas; helper WireGuard estático
TESTS=BLOCKED; 230 frontend y 167 Rust PASS; 4 Rust ignorados
DOCKER_BUILD=PASS
DOCKER_DEPLOY=PASS
POSTGRES=HEALTHY
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5
HEALTHZ=PASS; HTTP 200
READYZ=PASS; HTTP 200
API_LIVE=PASS; HTTP 200
API_READY=PASS; HTTP 200
E2E_DOCKER=BLOCKED; 54/81 casos históricos PASS, 27 BLOCKED
FUNCTIONAL_TEST=BLOCKED; 72 comprobaciones propias únicas PASS, cobertura maestra incompleta
SECURITY=BLOCKED; OS imágenes 0 HIGH/CRITICAL, npm 0, Cargo audit RAW 2 opcionales inactivos
SECRETS_IN_GIT=0 credenciales detectadas en alcance revisado; exclusiones y baseline documentados
COMMIT=NOT_RUN
PUSH=NOT_RUN
LOCAL_HEAD=16d1f208acf3dc881cfb272728b57a2ae00d4779
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779; referencia local, sin fetch
CRITICAL=0 detectadas en imágenes activas y npm; no dictamen global por verificaciones pendientes
HIGH=0 detectadas en imágenes activas y npm; F01/F08/F16 pendientes de aceptación integral
ERRORS=[4 integraciones Rust ignoradas; 27 casos históricos BLOCKED; 2 avisos Cargo RAW; CA Python estricta; cobertura maestra incompleta]
```

Las referencias Git locales coinciden, pero no incluyen los cambios sin commit ni
acreditan el estado actual del servidor remoto. El permiso condicionado de GitHub
no se activa mientras el RELEASE_GATE siga bloqueado.
