# UASSpain — auditoría del panel de alumno

Inicio: 2026-10-10. Continuación y actualización: **2026-10-11, Europe/Madrid**.

Estado: **BLOCKED / NOT_COMPLETE** para la auditoría integral. Las reparaciones de Material y la recuperación del texto PDF incrustado están desplegadas y pasan sus gates. El usuario ha indicado **«no generes preguntas»**: la generación queda excluida y no se crean nuevas preguntas, tampoco sintéticas, durante esta continuación. El catálogo principal contiene cero exámenes y cero preguntas; no se puede aprobar su realización, corrección y estadísticas sin evaluaciones. No se ha hecho commit, push, fetch ni staging.

## Alcance y secuencia

La solicitud exige fases secuenciales. No se ha utilizado la excepción de perfiles principales de las fases 03/04 ni la de instructor: todas estaban consumidas. Esta ejecución crea **cero perfiles de prueba en la instancia principal**. Sus escrituras se limitan al proyecto aislado `uasspain-e2e`, base `test_e2e_uasspain`, con volúmenes nuevos cuya creación está registrada.

| Fase | Estado observado |
| --- | --- |
| 01 — Inventario | PASS: ocho secciones, rutas y peticiones identificadas; navegación inicial real |
| 02 — Materiales | PASS de acceso, integridad, descarga, progreso y extracción de las tres fuentes seleccionadas; maquetación tabular sigue marcada para revisión, sin certificar semántica académica |
| 03 — Exámenes | Generación EXCLUDED_BY_USER; aceptación de evaluaciones NOT_COMPLETE porque no existen exámenes/preguntas principales y no se crean preguntas nuevas |
| 04–13 — Ciclo de exámenes y auditorías posteriores | NOT_RUN como aceptación; no se avanza el gate |
| 14 — Informe | Informe provisional de resultados y bloqueos; sin aprobación global |

No se presenta la regresión de permisos existentes como ejecución de las fases posteriores.

## 1. Inventario descubierto

La ruta privada es `/alumno`. Las ocho secciones son pestañas internas, no rutas nuevas. El catálogo público de cursos y `course_sections.course_id` existen; no existe matrícula ni relación curso-material-examen-alumno en el esquema académico actual. No se han inventado cursos asociados.

| Sección | Componentes y comunicación |
| --- | --- |
| Dashboard | AlumnoDashboard; resultados, materiales, completados, exámenes y dashboard counts |
| Exámenes | AlumnoExamenes y ExamenActivo; listados, bloqueos, inicio de intento, respuestas y entrega |
| Resultados | AlumnoResultados; historial de resultados y filtros de categoría |
| Material | AlumnoMaterial; materiales autorizados, progreso, descargas privadas, publicaciones BOE |
| Evolución | AlumnoEvolucion; resultados y series de notas |
| Chat | AlumnoChat; mensajes alumno-instructor, no leídos y suscripciones |
| Videollamada | AlumnoVideo; llamadas y señalización |
| Mi cuenta | AlumnoCuenta; perfil, avatar y cambio de contraseña |

Cabecera: búsqueda, notificaciones y menú de cuenta. AlumnoPanel registra conexiones y monta las pestañas visitadas. La realización completa de un examen, la edición de cuenta y la recepción de comunicaciones no se han aprobado mediante estas capturas iniciales.

El recorrido inicial usa bundle de producción y API Rust/PostgreSQL/Redis aislados: **17 capturas, 74 respuestas API, cero errores HTTP o JavaScript observados**. Incluye las ocho pestañas en ambos temas y Dashboard a 320 px. Evidencia: [phase01.json](../../.run/alumno-audit-20261010/phase01.json). Es un inventario inicial, no conformidad total de accesibilidad.

## 2. Hallazgos y reparaciones

1. **Aviso de revocación inventado en categorías vacías.** AlumnoMaterial infería permiso desde la existencia de documentos y anunciaba «Bloqueado por el Instructor» cuando no había documentos. La API ya devuelve sólo recursos autorizados. Se elimina esa inferencia y se conserva el estado vacío, sin ampliar permisos.
2. **Desbordamiento horizontal de las tarjetas de Material.** Las acciones no podían encogerse y alargaban la tarjeta a 320/390 px. Se usa una rejilla de dos columnas en móvil y acciones que pueden pasar a otra línea. Escritorio conserva la fila existente. Títulos largos pueden partirse.
3. **Contenido incompleto de fuentes PDF y extracción sin endpoint independiente.** Se añade GET `/api/materiales/{id}/contenido/` para admin/instructor, reutilizando el alcance de material y los guards de descarga privada. Devuelve páginas, texto, SHA-256 y categoría, sin crear exámenes ni modificar metadatos legacy.

La extracción limita PDF a 20 MiB, 500 páginas y 2 MiB de texto, sin truncamiento silencioso. Un semáforo admite una extracción por proceso; hay timeout de respuesta de 30 s y el permiso se conserva si la tarea sigue terminando. No hay servicio permanente ni dependencia nueva. PDF corrupto, cifrado o sin texto reciben diagnóstico; no se inventa texto ni se ejecuta OCR.

El rechazo preventivo anterior de Forms se sustituye por extracción real: se recorren únicamente los objetos invocados mediante Do, en su punto de aparición. Se resuelven Resources propios/heredados, fuentes por ámbito y Unicode; se restaura el estado de fuente del padre y de q/Q. Los objetos sin referencias no se convierten en fuente. Se rechazan ciclos, fuentes ilegibles, Contents incompleto, carga parcial tolerante, PDF cifrado y estructuras no soportadas.

Se mantienen límites de 20 MiB por flujo, 64 MiB de contenido recorrido por documento, 32 niveles de profundidad, 4096 invocaciones Form, un millón de operaciones y 256 fuentes por página. **Son límites de procesamiento, no una garantía de RAM total.** El timeout de 30 segundos no mata la tarea bloqueante; el semáforo permanece ocupado hasta que termina. No se afirma una auditoría DoS completa.

La respuesta incluye `requiere_revision=true` y `estructura_tablas_verificada=false`. El texto es entrada no confiable y nunca se interpreta como instrucciones. Esta extracción no demuestra validez semántica de preguntas, orden de columnas o exactitud de tablas.

Archivos propios de esta reparación: backend-rust/src/material_text.rs, la ruta en app.rs y exportación en lib.rs, visibilidad interna del guard en uploads.rs, AlumnoMaterial.tsx y scripts/e2e/e2e-student-materials.mjs. Se preservan todos los cambios previos de instructor y los diez archivos temporales del usuario. No cambian Compose, Dockerfiles, migraciones, DNS ni Postmark.

## 3. Materiales y verificación SQL

Se inventarían **10 PDF principales** en lectura, con tamaño, almacenamiento y SHA-256 comprobados. Categorías presentes: Radiofonista, A1/A3, A2 y STS. Las referencias de curso se consignan ausentes. El inventario privado completo queda en [material-preflight.json](../../.run/alumno-audit-20261010/material-preflight.json); no se exportan perfiles personales ni secretos.

Se copian tres documentos existentes a la evidencia privada y se suben copias a fixtures aislados. No se publica ninguna evaluación a alumnos reales.

| Material original | Categoría | Páginas | Texto, bytes UTF-8 | SHA-256 | Fixture final eliminado |
| --- | --- | --- | --- | --- | --- |
| 092ec512-3685-4cc8-8158-605f44d537c1 | Radiofonista | 45 | 47394 | 8ce676a452f1228f2e942544fe361ed3de0b4bddf00c2965b99b22a97eecc082 | 8add6ffc-f116-42a6-90a0-baa903150927 |
| 0b5c1c3f-eef1-4cc3-ae67-49db4a721208 | Radiofonista | 13 | 11573 | 1d5f56e410dc00c86541d7baf528b6c15d446d7afed440d96457a5284770d9b8 | caea97f2-bd30-43d0-96eb-3312aaeb1f08 |
| 2b520e9c-58b5-44e6-8234-8fa39f06598b | A1/A3 | 161 | 179092 | 7d679d2d47a45b9a4ca509951fec1e8afb20f1ba9ed5df1bce2d2abbb3336f59 | 8fe62ed9-ed96-40c1-b6c2-cc9ae92524ee |

Los hashes de las copias, la extracción y la descarga autorizada coinciden. La prueba confirma que la extracción conserva los registros legacy sin archivo_path. Se prueban denegaciones de otro alumno/instructor, revocación persistida, listado oculto, alumnos sin acceso al endpoint de staff, anonimato y PDF corrupto/vacío. Las pruebas controladas Rust conservan páginas y párrafos y exigen revisión explícita.

**Contraste independiente nuevo:** lector PyMuPDF 1.28.2 instalado sólo bajo .run como herramienta de auditoría, retirado después. Sin dependencia permanente ni cambios de Dockerfile. [Documentación oficial de renderizado](https://pymupdf.readthedocs.io/en/latest/recipes-images.html). Se comparan las 219 páginas, referencias y **344/344 párrafos contiguos**: 39/39 y 11/11 de radiofonista, 294/294 de A1/A3. Cero caracteres Unicode de sustitución en las tres extracciones.

El A1/A3 ahora devuelve HTTP 200, procesa dos invocaciones Form y recupera las **24 celdas de la matriz de la página 46** y el bloque antes omitido. La matriz se distingue del marco de página que el detector independiente identificaba erróneamente como otra tabla. Se inspeccionaron las páginas originales 46 y 114 y se contrastó el contenido recuperado. **La presencia de las celdas no certifica por sí sola la relación de cada fila/columna en el texto plano.** El endpoint conserva requiere_revision=true y estructura_tablas_verificada=false. No se generan preguntas ni se asigna aprobación académica automática a estas tablas.

Evidencia nueva: [source-oracle-form-support.json](../../.run/alumno-audit-20261010/source-oracle-form-support.json), [phase02-api.json](../../.run/alumno-audit-20261010/phase02-api.json) y [forms-source-coverage.json](../../.run/alumno-audit-20261010/forms-source-coverage.json). Las evidencias anteriores, incluido el HTTP 400 preventivo, quedan archivadas en before-form-support; no se confunden con la extracción actual.

Gate de materiales aprobado en el alcance de acceso y extracción seleccionados. La preparación de preguntas queda fuera de alcance por la instrucción posterior del usuario.

## 4. Alcance de exámenes tras la instrucción del usuario

El usuario respondió **«no generes preguntas»**. La generación automática se excluye: su ausencia deja de ser un bloqueo que haya que resolver en esta ejecución. No se instala modelo, no se envían documentos a servicios externos y no se implementa un conector no solicitado. Se adopta la interpretación conservadora de no crear tampoco nuevas preguntas sintéticas mientras no se aclare lo contrario.

La consulta de sólo lectura realizada nuevamente el 2026-10-11 devuelve **EXAMS=0, QUESTIONS=0, ATTEMPTS=0** en la instancia principal. No hay evaluaciones existentes que copiar para demostrar el ciclo completo. Las fases de realización, autocorrección y estadísticas no pueden declararse PASS con ese catálogo y esa restricción. No se declara el catálogo vacío como fallo de autorización ni de persistencia.

La regresión académica anterior de 49 casos creó una pregunta manual y un intento aislados antes de esta instrucción. **No se ha repetido ni contado como prueba nueva en esta continuación.** La pila aislada de esta continuación se sembró antes de recibir «no generes preguntas»; después se ejecutaron únicamente casos de materiales, acceso, descarga y progreso. Toda esa pila y sus datos propios se eliminaron al cerrar.

El bloqueo actual es **EMPTY_EXAM_QUESTION_CATALOG** para la aceptación integral. La generación es EXCLUDED_BY_USER, no GENERATION_ENGINE_UNCONFIRMED como dependencia pendiente de aprobación.

## 5. Validaciones nuevas ejecutadas

| Gate | Resultado y evidencia |
| --- | --- |
| Frontend | fuente sin cambios en esta continuación; typecheck, lint y **48 tests** PASS en la ejecución anterior, no repetidos; [frontend-build-final.log](../../.run/alumno-audit-20261010/frontend-build-final.log) |
| Rust | fmt, check, clippy -D warnings y **111 tests** PASS nuevos; [rust-audit-form-support.log](../../.run/alumno-audit-20261010/rust-audit-form-support.log) |
| API PDF/acceso | **60 comprobaciones** PASS nuevas sobre binario principal exacto y datos aislados; [phase02-api.json](../../.run/alumno-audit-20261010/phase02-api.json) |
| Browser materiales | **7 comprobaciones**, **8 capturas** PASS: temas claro/oscuro y 320/390/768/1440 px; descarga por hash, progreso y reload; [phase02-form-support-docker-browser.json](../../.run/alumno-audit-20261010/phase02-form-support-docker-browser.json) |
| Regresión afectada | API materiales y permisos: 60 comprobaciones; browser descarga/progreso/responsive: 7. La regresión académica previa de 49 no se repite por la instrucción de no crear preguntas |
| Seguridad | verificador oficial, código/historial/dependencias y cinco imágenes; **0 secretos, 0 vulnerabilidades altas/críticas**; [summary.json](../../.run/alumno-audit-20261010/security-form-support/summary.json) |

Se conservan también las pruebas fallidas: el desbordamiento real anterior, una comprobación de progreso que usaba innerText transformado por CSS y pasaba antes de completar la petición, y un selector ambiguo debido a nombres iguales de fixtures de distintas ejecuciones. Se corrige el harness para esperar la mutación y usar nombres únicos. El resultado final Docker es PASS; no se borran esas evidencias para ocultar fallos.

## 6. Versión Docker y alcance

Arranque oficial ejecutado: powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build. [main-build-form-support.log](../../.run/alumno-audit-20261010/main-build-form-support.log).

BuildID: **7b94d330-e89b-4ec8-93fa-448e7e8ce32c**. Backend SHA-256 del binario: **53c4f63d0f06d451d5349f4995db89fce0fbb9ea960704877520f89a54b859d1**.

| Servicio | Imagen runtime | Manifest linux/amd64 | Creación UTC |
| --- | --- | --- | --- |
| backend | sha256:551f2957a8903567ddd3d61957dfedb5af79691f6fac61e1b5837eacb8d7dfdc | sha256:1b79ec9956f7ff5e9a9b263dadd3466c04c4898398b61291215ffe08b2e77188 | 2026-10-11T06:46:24.601922697Z |
| frontend (fuente sin cambios) | sha256:953048a512af7862c56fdf2c6388876524ceb8116b77069c7534e48e629f1a53 | sha256:334c6cc0c8a4420fd424f59d13f7dc15ae9a43328f4687d24b2f49628f127cfb | 2026-10-10T21:10:43.830111087Z |

El proxy HTTPS temporal usa la misma imagen frontend, cabeceras de seguridad y certificado fijado en el navegador. El backend aislado usa el binario e imagen principales exactos; sólo configuración y datos son aislados. Igualdad de manifiestos, binario y BuildID: [production-fixture.json](../../.run/alumno-audit-20261010/production-fixture.json). **Esta prueba complementa la instancia principal; no es aceptación positiva de alumnos autenticados contra su base real.**

En https://localhost se validan salud, imágenes activas, el nuevo endpoint que responde 401 a un anónimo, el chunk nuevo con corrección móvil y ausencia del mensaje falso, y el guard de /alumno que abre login. No se inicia sesión en perfiles reales. [main-readonly.json](../../.run/alumno-audit-20261010/main-readonly.json).

Última salud tras limpieza: cinco servicios saludables, HTTP 200 en healthz, readyz, api/health/live y api/health/ready. DPAPI y volumen PostgreSQL cifrado preservados: [alumno-final-form-support.json](../../.run/order-20261009/00/alumno-final-form-support.json).

## 7. Datos, limpieza y Git

Una nueva comparación **en lectura** de las 42 tablas y los **396 registros originales** frente a la baseline preservada confirma:

```text
MAIN_INSTANCE_TEST_PROFILES=0
REAL_USER_DATA_MODIFIED=0
REAL_USER_DATA_DELETED=0
TEMP_DATA_RESIDUE=0
```

[preservation.json](../../.run/alumno-audit-20261010/preservation.json). Se usa la baseline previa únicamente para comparar; no se reutiliza autorización de escrituras.

Runs propios: 89630a2cec074ce1a624d7d09af1ce1d, 7e49a351c93947b9a900daab6ef28969 y 43791d148d11438ea23ee0cbf4a4a88f. Eliminados en total **21 contenedores, 24 volúmenes nombrados y 3 volúmenes anónimos**, todos registrados y comprobados sin referencias ajenas. Residuos Docker propios: 0. Evidencias: [primer cleanup](../../.run/alumno-audit-20261010/cleanup-89630a2cec074ce1a624d7d09af1ce1d.json) y [segundo cleanup](../../.run/alumno-audit-20261010/cleanup-7e49a351c93947b9a900daab6ef28969.json). La tercera limpieza está registrada en [cleanup-43791d148d11438ea23ee0cbf4a4a88f.json](../../.run/alumno-audit-20261010/cleanup-43791d148d11438ea23ee0cbf4a4a88f.json). Se retiran los dos tags temporales de backend y la imagen temporal del harness PDF, sin referencias. Se conservan red y caches compartidos, recursos de ejecuciones anteriores y todos los recursos principales. No hay prune ni borrado de datos reales.

La instalación temporal de la herramienta PDF se retiró después del contraste; se conserva su versión y el log de instalación. Las copias de PDF, extracciones, capturas y logs privados necesarios permanecen como evidencia en .run, fuera de Git. Código y documentación permanecen locales, índice vacío; diff --check y diff --cached --check pasan. Fuente agregada: **3f8b15c5ad61c4020a2d8110684af3e42d563502ac2b6ec818080fdd333779a7**, [source-final.json](../../.run/alumno-audit-20261010/source-final.json).

HEAD y origin/main mostrado son referencias **locales**; no se hace fetch ni se afirma una nueva comprobación remota. El correo Postmark real sigue aplazado hasta producción según la autorización anterior; no es un nuevo gate de esta reparación.

## 8. Capturas inspeccionadas y pasos

1. Dashboard inicial oscuro: navegación y vacío correctos; no demuestra estadísticas con resultados.
2. Material inicial claro: aviso falso de bloqueo reproducido.
3. Material móvil anterior: desbordamiento reproducido.
4. Material corregido en imágenes Docker: sin desbordamiento, descarga real y progreso persistido.
5. Guard principal anónimo: denegación correcta; no es un login de aceptación.

![Material vacío, mensaje incorrecto anterior](../../.run/alumno-audit-20261010/12-light-material.png)
![Material móvil anterior](../../.run/alumno-audit-20261010/phase02-light-material-320.png)
![Material corregido en Docker, modo claro 320](../../.run/alumno-audit-20261010/phase02-form-support-docker-light-material-320.png)

Las imágenes contienen exclusivamente nombres y datos sintéticos. No se declara accesibilidad completa por capturas.

## 9. Diagnósticos y reproducción

El registro HTTP inicial incluye timestamp, método, endpoint real, estado, request ID disponible y tiempo. La prueba de PDF registra 42 solicitudes con tiempo y correlation ID si existe. Se añaden el 401 principal observado: **117 solicitudes instrumentadas en la iteración anterior**. En la continuación nueva hay 42 solicitudes API de materiales y el 401 principal, **43 solicitudes con resultado esperado**; no se suman ni se presentan como nuevas las 74 respuestas iniciales. Las denegaciones 400/401/403/404 son casos negativos aprobados, no fallos injustificados. No se cuentan peticiones no instrumentadas ni se asegura cobertura de todos los endpoints. El formato completo por componente/SQL/Redis de la fase 09 permanece pendiente.

Reproducción local de los gates de materiales: los scripts y preflight de esta ejecución permanecen en .run/alumno-audit-20261010; el test de API reutilizable está en scripts/e2e/e2e-student-materials.mjs. Requiere recrear un run aislado con -FrontendOnly -SkipBrowser -Keep -PreserveVolumes, volver a registrar identidad de los nuevos recursos y usar copias de materiales autorizados. No reusar un GUID limpio ni ejecutar fixtures principales anteriores. La creación de perfiles principales requeriría una autorización nueva, si fuera necesaria en el futuro.

## 10. Formato final solicitado

NOT_RUN, PARTIAL y estados acotados indican verificaciones no realizadas o de alcance limitado: no se convierten en PASS/FAIL inventados. Los contadores críticos/altos funcionales globales no están evaluados; el scanner sí da cero en su alcance.

```text
PROJECT=UASSPAIN
PANEL=ALUMNO
FULL_AUDIT=BLOCKED
FUNCTIONAL_INVENTORY=PASS
AUTHENTICATION=PASS_INITIAL_LOGIN_ONLY
STUDENT_PROFILE=NOT_RUN
STUDENT_DASHBOARD=PASS_INITIAL_EMPTY_STATE_ONLY
COURSES=NO_STUDENT_ENROLLMENT_IMPLEMENTED
MATERIAL_ACCESS=PASS
PDF_READING=PASS_DOWNLOAD_AND_SELECTED_TEXT
PDF_DOWNLOAD=PASS
AUTOMATIC_EXAM_GENERATION=EXCLUDED_BY_USER
SOURCE_EXTRACTION=PASS_3_SELECTED_PDFS_LAYOUT_REVIEW_REQUIRED
QUESTION_GENERATION=EXCLUDED_BY_USER
QUESTION_VALIDATION=NOT_RUN
QUESTION_RANDOMIZATION=NOT_RUN
EXAM_CREATION=NOT_RUN_ACCEPTANCE
EXAM_PUBLICATION=NOT_RUN_ACCEPTANCE
EXAM_ASSIGNMENT=NOT_RUN_ACCEPTANCE
EXAM_EXECUTION=NOT_RUN_ACCEPTANCE
EXAM_TIMER=NOT_RUN
EXAM_SUBMISSION=NOT_RUN_ACCEPTANCE
AUTOMATIC_CORRECTION=NOT_RUN_ACCEPTANCE
SCORING_ACCURACY=NOT_RUN_20_QUESTION_CASES
ERROR_EXPLANATIONS=NOT_RUN
RESULT_PERSISTENCE=NOT_RUN_ACCEPTANCE
RESULT_HISTORY=NOT_RUN_ACCEPTANCE
STUDENT_STATISTICS=NOT_RUN_FULL_METRICS
INSTRUCTOR_STATISTICS=NOT_RUN_FULL_METRICS
ADMIN_STATISTICS=NOT_RUN_FULL_METRICS
CHARTS=NOT_RUN_WITH_RESULTS
STATISTICAL_ACCURACY=NOT_RUN
CHAT=NOT_RUN_DELIVERY
VIDEO_CALLS=NOT_RUN_MEDIA
NOTIFICATIONS=NOT_RUN_DELIVERY
HTTP_DIAGNOSTICS=PARTIAL
SESSION_SECURITY=PASS_ANONYMOUS_GUARD_ONLY
RBAC=PASS_MATERIAL_SCOPE
IDOR_PROTECTION=PASS_MATERIAL_SCOPE
FRONTEND=PASS_AFFECTED_GATES
RUST_BACKEND=PASS_AFFECTED_GATES
POSTGRESQL=PASS
REDIS=PASS
NGINX=PASS
DOCKER=PASS_DEPLOYMENT
RESPONSIVE=PASS_MATERIAL_320_390_768_1440
LIGHT_MODE=PASS_MATERIAL
DARK_MODE=PASS_MATERIAL
ACCESSIBILITY=NOT_RUN_FULL_AUDIT
E2E_COMPLETE_FLOW=NOT_RUN
REGRESSION_TESTS=PASS_MATERIAL_API_60_BROWSER_7
EXAMS_GENERATED=0
QUESTIONS_GENERATED=0
QUESTIONS_VALIDATED=0
EXAMS_EXECUTED=0_THIS_CONTINUATION
EXAMS_CORRECTED=0_THIS_CONTINUATION
STATISTICS_VERIFIED=0_THIS_CONTINUATION
HTTP_REQUESTS_TESTED=43_THIS_CONTINUATION
HTTP_REQUESTS_PASSED=43_THIS_CONTINUATION
HTTP_REQUESTS_FAILED=0
CRITICAL_ERRORS=NOT_ASSESSED_FULL_FLOW
HIGH_ERRORS=NOT_ASSESSED_FULL_FLOW
MEDIUM_ERRORS=3_REPAIRED_IN_MATERIAL_SCOPE
LOW_ERRORS=NOT_ASSESSED_FULL_FLOW
UNRESOLVED_BLOCKERS=1
COMMIT=NOT_PERFORMED
PUSH=NOT_PERFORMED
FINAL_STATUS=BLOCKED
```

## 11. Cierre según REPAIR_WORKFLOW, sección 25

```text
CODE=PASS_AFFECTED_CHANGES
TESTS=PASS_NEW_111_RUST_60_API_7_BROWSER_FRONTEND_UNCHANGED_PREVIOUS_48
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
E2E_DOCKER=PASS_AFFECTED_EXACT_IMAGES_ISOLATED_DATA
FUNCTIONAL_TEST=PASS_MATERIAL_PARTIAL_MAIN_ANONYMOUS_ONLY
SECURITY=PASS_SCANNER_AND_MATERIAL_SCOPE
SECRETS_IN_GIT=0
COMMIT=NOT_PERFORMED_BY_USER_REQUEST
PUSH=NOT_PERFORMED_BY_USER_REQUEST
LOCAL_HEAD=01897a206dc98202e05a0fa910d9a44efcf4b58a
ORIGIN_MAIN=01897a206dc98202e05a0fa910d9a44efcf4b58a
CRITICAL=0_SCANNER_NOT_FULL_FUNCTIONAL_AUDIT
HIGH=0_SCANNER_NOT_FULL_FUNCTIONAL_AUDIT
ERRORS=[EMPTY_EXAM_QUESTION_CATALOG]
CHANGE_STATUS=NOT_COMPLETE
```

```text
SEQUENCE=BLOCKED
CURRENT=FASE_03_ACCEPTANCE_WITHOUT_QUESTIONS
NEXT=NOT_RUN
REASON=EMPTY_EXAM_QUESTION_CATALOG; QUESTION_GENERATION_EXCLUDED_BY_USER
```

Las reparaciones locales probadas están desplegadas. La auditoría integral y sus gates posteriores continúan sin completar.
