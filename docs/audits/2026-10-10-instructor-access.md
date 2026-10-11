# Panel de instructor — reparación de accesos, 2026-10-10

Solicitud: auditoría y reparación integral del panel de instructor. Los cambios
se mantienen locales; esta solicitud no autoriza commit ni push. El cierre del
correo corporativo de la fase anterior conserva su excepción independiente.

Estado actual: reparación aplicada y validada en Docker principal, aceptación
autenticada, limpieza y regresión completa posterior satisfactorias.
`CHANGE_STATUS=COMPLETE_LOCAL`. Se mantiene el alcance local autorizado.
No se ha ejecutado commit ni push. Los estados pendientes de las primeras secciones
son hitos históricos; el informe de cierre al final refleja el estado actual.

## Fase 01 — auditoría previa

Se revisaron arquitectura, sesiones por ventana, RBAC, consultas, tablas,
almacenamiento privado, listados y componentes. Las capturas mencionadas en la
solicitud no estaban adjuntas; el usuario indicó que no había comprobado si el
error ocurría en una sola ventana. No se atribuye su caso concreto a una causa
sin poder reproducirlo. Se capturó el flujo actual con fixtures aislados.

Evidencia nueva en `.run/instructor-repair-20261010/`: `audit-main.json`,
`audit-before.json` y las capturas numeradas `01` a `04`. Se repitió la captura
del modal después de terminar la animación; la captura inicial se descartó.

1. Dashboard: carga correctamente en una ventana autenticada. Tres recargas
   conservan la vinculación y permiten entrar. No se reproduce un fallo general
   con una sesión válida en ese escenario.
2. Alumnos: dos botones abren formularios independientes de acceso a exámenes.
   Ambos comparten la misma operación; sólo «Gestionar accesos» debe mantenerse.
3. Gestionar accesos: faltan metadatos, selección múltiple, estado de publicación
   e identificación de permisos heredados. Un fallo se comunica por toast pero
   después puede mostrarse como inventario vacío, sin reintento del listado.
4. Segunda ventana: iniciar sesión allí cambia las cookies compartidas. La
   ventana anterior conserva el perfil cacheado, sus consultas devuelven 401
   `session_window_mismatch` y Alumnos queda con «Reintentar» permanente. La
   restricción del backend es correcta; falta llevar esa ventana a autenticarse,
   sin cerrar ni alterar la sesión válida de la segunda ventana.

La lectura principal, sin iniciar sesiones reales ni modificar registros,
confirma ocho perfiles, diez materiales y cero exámenes. Los diez materiales
tienen URL y `archivo_path` vacío. La subida del instructor no persiste `path`,
tipo de contenido ni tamaño del upload. La descarga privada del alumno busca
`archivo_path`: el fixture antiguo devuelve 404 aun con permiso.

Hay además discrepancias reproducidas: el gestor muestra como concedido un
material con permiso individual positivo y denegación de categoría, pero la
consulta del alumno aplica cualquier denegación y lo excluye. La lista de
materiales del alumno devuelve también documentos no publicados. La política
debe coincidir entre gestor, listado, detalle y descarga, conservando las
denegaciones heredadas que no pueden revocarse individualmente.

El esquema relaciona materiales/exámenes con su autor y categoría; no contiene
FK de curso en esas tablas. La interfaz debe identificar la categoría formativa
y explicar que no hay un curso asociado, sin inventar relaciones ni duplicar
documentos. No se necesita modificar datos reales para reconocer las URLs
antiguas de almacenamiento privado.

Las capturas conservan el diseño existente. La inspección visual no acredita
por sí sola accesibilidad, persistencia o permisos; se comprobarán mediante
API, teclado, tamaños, temas y E2E. Redis no almacena estos inventarios: las
consultas revisadas acceden directamente a PostgreSQL.

`AUDITORIA=PASS`.

## Fase 02 — duplicidad

Se retiró del panel de instructor el botón «Exámenes» de la fila de alumno y
su modal, estado y manejadores redundantes. Se comprobaron sus referencias antes
de eliminar el componente. «Gestionar accesos» sigue abriendo el inventario
único de materiales y exámenes; Resultados y la sección de edición de exámenes
conservan sus funciones. Typecheck y la comprobación de navegador aislada
`phase02-browser.log` pasan: cero botones duplicados y un gestor por fila.

`DUPLICIDAD_ACCESOS=PASS`. Las fases 03–06 permanecen pendientes.

## Fase 03 — materiales

Typecheck, lint y Docker target audit (fmt, check, clippy, 99 tests) pasan.
La aceptación nueva supera 22 comprobaciones API/UI con backend reconstruido
aislado: inventario antiguo, metadatos, publicación, bloqueo heredado, descarga
por URL antigua sin escribir la base principal, concesión/revocación, subida
desde el formulario, sincronización sin F5 y modal a 390/768/1440 px.

El listado de accesos incluye documentos sin publicar, con acción deshabilitada,
y calcula el mismo permiso efectivo que el backend: una denegación de categoría
no puede superarse con una concesión individual. Los recursos se limitan al
autor instructor, al catálogo compartido de administración/legado y a los
alumnos asignados. No se inventan asociaciones de curso. Los cambios se auditan
en la transacción existente; se bloquea la fila del alumno para evitar carreras
con reasignaciones. No se modifican migraciones ni documentos reales.

El primer intento de rebuild aislado no reconstruía nada: ese Compose sólo
declara una imagen para el backend. Se corrigió el preparativo para construirla
explícitamente y comprobar su manifiesto antes de repetir las pruebas. También
se corrigió un selector de prueba que no coincidía con «Subir Material».
Los intentos fallidos quedan registrados y no se presentan como PASS.

Evidencia: `phase03-rust-audit-final.log`, `phase03-isolated-build-final.log`,
`phase03-result.json` y `06-materials-phase03.png`. Su alcance es el entorno
aislado; todavía no acredita el despliegue principal de esta reparación.

`MATERIALES_EXISTENTES=PASS_ISOLATED`, `ASIGNACION_MATERIALES=PASS_ISOLATED`.
Las fases 04–06 permanecen pendientes.

## Fase 04 — API y sesión

La aceptación aislada pasa 19 comprobaciones nuevas: ocho secciones, tres
recargas, los cinco recursos del panel, un fallo independiente con recuperación,
sesión por ventana y refresh realmente caducado. La ventana que perdió su
vinculación vuelve al login sin refresh ni logout de las cookies compartidas;
la ventana propietaria conserva su sesión. Los contadores usan agregados reales
y las respuestas antiguas no sustituyen una carga más reciente.

Evidencia: `phase04-result.json`. El primer token de prueba sólo había caducado
30 segundos y seguía dentro de la tolerancia de reloj del verificador; se repitió
con caducidad de cinco minutos. No se cambió esa tolerancia ni la autenticación.

La regresión con cookies compartidas detectó otro caso real: una pestaña pública
que consulta opcionalmente el perfil no debe abrir el login porque pertenece a
otra ventana. Esa consulta devuelve visitante anónimo; el backend sigue devolviendo
401 para la vinculación incorrecta y la ventana autenticada conserva su sesión.
Las rutas privadas siguen exigiendo autenticación. Esta variante se volvió a
probar y se añadieron comprobaciones unitarias. El mock del catálogo público
se ajustó al contrato real del visitante: 200/null para `me?optional=true`.

`ERROR_ACTUALIZACION=PASS_ISOLATED`, `ERROR_SESION=PASS_ISOLATED`.
Las fases 05–06 permanecen pendientes.

## Fase 05 — sincronización y permisos

La aceptación API supera 49 comprobaciones HTTP/PostgreSQL, incluida propiedad
de recursos y alumnos, rutas antiguas, lectura/edición/borrado ajenos, falsificación
de referencia a archivo privado, publicación, fechas de bloqueo, denegación de
categoría, intentos y resultados reales de fixture. Revocar y conceder no altera
los registros históricos comparados. Los contadores coinciden con el universo
autorizado. Las URLs públicas externas conservan su comportamiento; la protección
de referencias afecta a archivos privados gestionados. La importación PDF verifica
la propiedad del archivo canónico antes de leerlo, y persiste tamaño y checksum
calculados en el servidor. La política SQL de autor se comparte entre las consultas
Rust y la instrumentación EXPLAIN de la regresión de concurrencia.

La aceptación de navegador nueva pasa con tres paneles: dos materiales mediante
selección múltiple, lectura del estado persistido desde administración, cambios
visibles sin F5 para el alumno y concesión/revocación de examen. Un fallo 503 en
la segunda escritura informa el primer recurso guardado y conserva el estado real
del segundo. El modal pasa Axe en claro/oscuro, tamaños 320/768/1440 y restauración
de foco al cerrarlo. Se incorporan ambos casos al runner oficial aislado.

Se corrigen además lecturas de exámenes que ignoraban fechas de bloqueo y autor;
los PDFs de origen del editor conservan descarga autorizada para staff. Las rutas
antiguas de permisos y borrado múltiple respetan la asignación de alumnos. La
limpieza del primer fixture de navegador necesitaba retirar sus permisos por ID
antes del material debido a su FK; la nueva ejecución completa pasa. Ese intento
no se presenta como una validación final y su volumen propio se limpia al terminar.

Evidencia: `phase05-api-final.log`, `phase05-browser-retry.log`.
La lectura principal `main-resource-preflight.json` verifica diez URLs gestionadas
y diez archivos existentes, sin editar registros ni usar sesiones reales.

`ASIGNACION_EXAMENES=PASS_ISOLATED`, `SINCRONIZACION_PANELES=PASS_ISOLATED`.
La fase 06 queda pendiente de regresión, rebuild oficial, seguridad y aceptación
de la función en la instancia principal. No se reutilizan las excepciones de
perfiles temporales de las fases 03/04 anteriores.

## Fase 06 — pruebas, aceptación y regresión posterior completas

Se mantiene el historial de intentos fallidos: instrumentación EXPLAIN incompatible
con una consulta transformada en función, mock público con contrato incorrecto,
redirigir una pestaña pública con cookies de otra ventana, y desbordamiento de
dashboard con títulos largos de resultados. Los tres primeros se corrigieron y
sus casos afectados volvieron a pasar. La última medición localiza el ancho mínimo
automático de las tarjetas de gráficos/actividad: 479 px y 404 px en una pantalla
de 390 px. Se permite que esas tarjetas se encojan sin cambiar colores, gráficos,
tipografías, espaciados ni contenido. La medición nueva devuelve 390/390 px y
ningún elemento fuera de pantalla en ambos paneles.

Las pruebas frontend actuales pasan 48 tests, typecheck, lint y build. El último
target audit Rust pasa fmt, check, clippy y 99 tests. Pasan los seis casos de
navegación, recarga y logout de los tres roles en escritorio/móvil, incluyendo
la revisión de todas sus secciones entre 320 y 2560 px. La regresión completa
termina con exit 0: 128 casos de navegador y 876 estados de interfaz sobre backend
real aislado, con cero errores, avisos y fallos en la auditoría. La suite API nueva
pasa 49 comprobaciones; la carga de 100 sesiones pasa 1.827 peticiones sin errores,
con p95 de 44,09 ms y 100 conexiones WebSocket. Estos tiempos corresponden al
entorno Docker aislado y a ese workload, no a una medición de producción pública.

La revisión final encontró un refresco de conexiones que aplicaba los contadores
fuera de la protección de las cargas generales. Se añade una generación común
de contadores para ambas rutas, sin aumentar peticiones ni alterar los límites.
La prueba `late connection totals` mantiene el WebSocket real, retrasa la respuesta
anterior y confirma que la navegación conserva el total más reciente. Al retirar
temporalmente esa protección la prueba reproduce el fallo; después de restaurarla
pasa. Los valores artificiales sólo se inyectan en la respuesta de la prueba
aislada, nunca en PostgreSQL ni en la instancia principal. Evidencia:
`stale-totals-before-guard.log` y `stale-totals-restored.log`.

El arranque oficial `scripts/start-encrypted-stack.ps1 -Build` termina correctamente
con las correcciones responsive y de contadores. La verificación del 2026-10-10
15:57 UTC comprueba
cinco servicios saludables, las cuatro rutas HTTPS de salud con HTTP 200 y CA
válida, imágenes/manifiestos actuales, volúmenes y clave cifrada conservados.
Build frontend: `1a52f4ab-baa7-4798-871b-581eb294058c`. La lectura posterior confirma
los diez documentos y sus diez archivos existentes; sus filas conservan el hash
previo `e04a04451c8cc6adfa04cc5413b9f5842aad44302e22b50523dc56ed488996be`.
El escáner del código, historial, dependencias e imágenes desplegadas informa
cero secretos y cero vulnerabilidades altas/críticas. El navegador anónimo real
de `https://localhost` valida el guard del instructor sin errores JavaScript.
No se ha iniciado sesión ni escrito con perfiles de prueba en la base principal.

La aceptación HTTPS/WSS adicional ejecuta los mismos manifiestos de plataforma
del frontend y backend principales contra PostgreSQL/Redis aislados. Verifica
CA, `version.json`, bytes del chunk de accesos y SHA del binario. Pasan cinco casos
de navegador (accesos/contadores, sesiones y chat/medios) y 19 comprobaciones de
recuperación, incluidos caducidad real del fixture, vinculación por ventana y
consulta pública opcional. Se retira el proxy temporal y se restaura la imagen
E2E anterior. Esta prueba acredita las imágenes principales con datos aislados;
no sustituye la aceptación autenticada en la base principal.

El primer verificador de esa prueba comparaba IDs de índice de Docker/containerd.
Se detuvo antes de la función y restauró el backend aislado. La repetición compara
el manifiesto exacto de plataforma y el binario: no se acepta una imagen diferente
por coincidir sólo el nombre de su tag. Se conserva el intento fallido en
`production-acceptance-image-check-failed.json`.

Evidencia actual en `.run/instructor-repair-20261010/`: `full-regression-reviewed.log`,
`ui-live-report.json`, `production-acceptance.json`, `production-acceptance-final.log`,
`production-academic.log`, `production-session.log`, `production-realtime.log`,
`production-recovery.log`,
`phase04-result.json`, `security-reviewed/summary.json` y los logs `final-*-reviewed`.
La prueba Rust actual figura en `final-rust-audit-import.log` (99 tests).
Los 30 inputs modificados de aplicación/regresión conservan el SHA agregado
`eeb12b57559dad248f5ae9494f6d3d445d6d1c093838399d96073cca8191435a`.

Backend principal: imagen
`sha256:c4705b10d6266869de8c95a4407f4fda28013c0794d8cf0dee6c8bbadd88a1d5`,
recreado/iniciado el 2026-10-10 a las 15:11:25/15:11:27 UTC. Frontend:
`sha256:99bec7bc704cf225fc9594a96d527c1767d558dda780cb127085e9a715e63cb6`,
recreado/iniciado a las 15:56:59/15:57:01 UTC. Los manifiestos y SHA del binario/chunk
están en el informe de aceptación. PostgreSQL, Redis y Nginx conservan sus
contenedores; los cinco siguen saludables. La comprobación posterior a limpiar,
16:37 UTC, confirma nuevamente los cuatro HTTP 200, versión, clave y volúmenes,
y el mismo hash de los diez materiales principales.

Se retiraron por identidad siete conjuntos propios de ocho volúmenes E2E,
los contenedores propios todavía presentes y la imagen audit propia no referenciada.
Cada conjunto dispone de `cleanup-<GUID>.json` con residuo cero. Se conservan red,
imágenes/cachés compartidas, montajes anónimos anteriores y recursos ajenos. No se
ejecuta prune global ni se toca ningún volumen principal, backup o clave DPAPI.

### Prueba principal autorizada — finalizada

`AGENTS.md` exige: «Ejecutar E2E sobre la versión Docker reconstruida y validar
la función real». `docs/REPAIR_WORKFLOW.md` exige la validación de la aplicación
desplegada. Además `AGENTS.md` dispone: «Las escrituras y pruebas destructivas
usan fixtures aislados». Las excepciones anteriores sólo
autorizaban pruebas concretas de sus fases 03 y 04; no autorizan esta reparación.

El usuario autorizó exclusivamente esta prueba del panel («Autorizar sólo esta
prueba»). El 10 de octubre se reanudó Docker Desktop y se ejecutó nuevamente el
arranque oficial con `-Build`: cinco servicios saludables y las cuatro rutas
HTTPS 200, sin cambios de versión ni pérdida del volumen o la clave.

La prueba principal tiene exactamente cuatro perfiles sintéticos:
administrador, instructor, alumno asignado al instructor y alumno asignado al
administrador. Antes de crearlos, backup cifrado y restauración verificable en
un contenedor temporal sin red ni volumen persistente. Se registrarán los IDs
de perfiles, usuarios, materiales, archivos, exámenes, preguntas, permisos,
intentos, resultados y registros de conexión/auditoría creados exclusivamente
por ellos. Los materiales reales se comprobarán sólo mediante lectura.

Alcance propuesto: gestor único, subida/listado/PDF antiguo y nuevo, concesión y
revocación individual y múltiple, sincronización en los tres paneles, persistencia,
publicación, bloqueos heredados y alumno ajeno, contadores, navegación/recarga y
recuperación de sesión por ventana. Las escrituras afectarán sólo a fixtures.
No se cambiarán usuarios, contraseñas, sesiones, documentos ni permisos reales.

La limpieza requerirá demostrar cada pertenencia y retirar únicamente IDs exactos
y archivos propios sin referencias ajenas. Cualquier registro sin prueba de
propiedad quedará intacto y bloqueará el cierre. Después se comprobarán ausencia
de residuos, hashes de registros anteriores y regresión posterior. El backup
cifrado se restauró en aislamiento antes de crear los perfiles: 42 tablas y
396 registros idénticos. La fase 06 sólo se cierra después de la aceptación,
la limpieza y la regresión posterior documentadas abajo. No se reutiliza ninguna
excepción de fases anteriores y esta autorización no habilita futuras pruebas.

### Resultado de la aceptación principal y limpieza

La ejecución final supera 58 comprobaciones sobre `https://localhost`, pasando
por nginx y los contenedores principales: cuatro inicios de sesión independientes,
gestor único, PDF nuevo desde el formulario, descarga de los diez PDF existentes
sólo en lectura, documento propio con URL antigua y sin `archivo_path`, permisos
individuales/múltiples confirmados por administración, sincronización sin F5,
publicación y denegaciones heredadas, aislamiento de alumno ajeno, intento y
resultado reales de prueba, históricos intactos, navegación y tres recargas,
WSS con entrega/reconexión y rechazo de ventana incorrecta. Cambiar de ventana
recupera el login sin cerrar ni refrescar la sesión propietaria; la pestaña pública
conserva su comportamiento anónimo. Cero errores JavaScript.

Los dos intentos anteriores se conservan: pérdida de transporte en una petición
del runner y desbordamiento de cabecera con nombre largo. Se consume completamente
la respuesta binaria en el runner y se añade timeout; no se modifica la seguridad
del servidor. Se corrige el ajuste del nombre en la interfaz y se reconstruye el
frontend. La ejecución nueva pasa a 320/768/1440 px. Los tres intentos emplean
exclusivamente las mismas cuatro identidades; no se crean perfiles adicionales.

| Perfil temporal | ID exacto |
| --- | --- |
| Administrador | `08e5f717-a1b5-4794-9bbd-572074e84eda` |
| Instructor | `f9032892-87f9-43a9-8a1c-f1f51727f249` |
| Alumno asignado al instructor | `7e595f4d-ea03-499b-a934-d164e3c11180` |
| Alumno asignado al administrador | `f51ae101-2e3a-4f8e-bcd7-fde1a04568c1` |

Se limpian por ID exacto los 70 registros propios (incluidos estos perfiles y sus
usuarios de autenticación) y tres archivos PDF nuevos. Se comprueban todas las
FK entrantes a identidades y recursos y se bloquean las tablas durante la limpieza;
los hashes originales se verifican dentro de la transacción antes de confirmar.
Cada archivo tenía ruta nueva, checksum registrado y cero referencias después de
la limpieza. No se aplican borrados por patrón, fecha, TRUNCATE ni restauraciones
sobre la base principal. El snapshot se restaura únicamente en el verificador
aislado previo. Redis usa pub/sub para estos eventos; no persiste inventarios ni
sesiones de los perfiles de prueba.

Evidencia en `.run/instructor-repair-20261010/main-acceptance/`: `inventory.json`
registra todos los IDs/relaciones y archivos; `before-fingerprints.json` y
`after-fingerprints.json` comparan las 42 tablas/396 registros; `result.json`
contiene los 58 gates; `clean-independent.json` repite la comprobación en una
transacción de sólo lectura. Backup cifrado `pre-test-snapshot.enc`, SHA-256
`aea3ed06422f981d04302ecedad96248523c2270be0b40eb9585db11fd66ad4c`, con restauración
verificada antes de la creación. Capturas `main-unified-access.png` y
`main-window-recovery.png`, inspeccionadas junto con la medición responsive.

```text
MAIN_INSTANCE_TEST_PROFILES=4
MAIN_AUTHENTICATED_ACCEPTANCE=PASS
REAL_USER_DATA_MODIFIED=0
REAL_USER_DATA_DELETED=0
TEMP_DATA_RESIDUE=0
TEMP_FILES_RESIDUE=0
POST_CLEANUP_REGRESSION=PASS
```

La salud posterior a la limpieza vuelve a comprobar cinco servicios y cuatro
HTTP 200; los diez materiales conservan su hash previo y sus archivos. El guard
del instructor se valida en un navegador principal anónimo nuevo. Las entradas
de código actuales tienen SHA agregado
`280a6135723f75694f50d0a035ea852f594960714c25046d8ca8a293e61ea660`; el anterior
`eeb12b57559dad248f5ae9494f6d3d445d6d1c093838399d96073cca8191435a` se conserva
como hito previo al ajuste de nombres largos. El último escaneo
`security-longname/summary.json` vuelve a dar cero secretos y cero hallazgos altos
o críticos en código, historial, dependencias y las cinco imágenes actuales.

### Regresión posterior y comprobación final

Después de limpiar la instancia principal se ejecuta de nuevo el runner oficial
completo sobre una base E2E nueva: `full-regression-postcleanup.log`, exit 0.
Pasan autenticación (54), fallo seguro de transporte SMTP (14), contacto con
receptor exclusivamente aislado, paneles (29), asignaciones (24), backups (72),
deltas/restauración, cursos (48), accesos académicos (49), carga/concurrencia,
100 sesiones (18) y canales privados (61), incluidos los escenarios de caída
y recuperación. No se presenta el correo externo sin credenciales como probado.
Esta regresión no cambia el aplazamiento del correo corporativo a producción.

Los grupos de navegador completan 128 casos: 104 base, presencia y asignación
uno cada uno, modales seis, cursos uno, instructor dos, sesiones dos, tiempo real
uno, concurrencia cinco y canales privados cinco. La auditoría del bundle de
producción con backend aislado real verifica 876 estados (público 432, admin 228,
instructor 120 y alumno 96), seis anchuras y dos temas: cero fallos, errores,
avisos y escrituras interceptadas. Se conserva su informe nuevo en
`ui-live-postcleanup-report.json`; no se reutiliza el informe de la ejecución anterior.

Se retiran los seis contenedores y ocho volúmenes nombrados del GUID
`1b71b8f4d0264224b84380c73fa0de30`, más el volumen anónimo nuevo cuya creación,
contenedor originario y referencias se registraron previamente. Se preservan
todos los recursos principales, volúmenes anteriores ajenos, red E2E preexistente
y cachés compartidas. Evidencia: `cleanup-1b71b8f4d0264224b84380c73fa0de30.json`,
residuo cero. Con las limpiezas previas son 64 volúmenes nombrados propios y
un anónimo propio; no se ejecuta ningún prune global.

La comprobación del 2026-10-10 a las 20:39 UTC, posterior a esta limpieza,
confirma cinco servicios principales saludables, las cuatro rutas HTTPS 200,
manifiestos actuales, volumen cifrado y clave conservados. La versión actual
es `16423dd8-fd10-4ae4-8c83-26201dc6e879`, manifiesto frontend
`sha256:3261ffabff28bb0d58ad82e81e40be6b7cc1d1f2a5aae7fe4a29eac49a5542fb`;
chunk `/assets/InstructorAccesos-CT6XRT-E.js`, SHA-256
`cefdf9726dc700baab7f7cb97e910b3d3e20c9a5ea188aaf06fbc77ae2c30f34`.
El binario backend conserva SHA-256
`e3afdb095f03f8267742817e45c1b8ae9001ed3281f53013f6a8c01a1f5d869e`.
Los IDs/manifiestos, creación y arranque se registran en `main-version-final.json`.
El hash Git corresponde al HEAD sin nuevos commits; el SHA agregado de inputs
y los hashes de artefactos acreditan los cambios locales realmente desplegados.

El escaneo de cierre `security-closed/summary.json`, ejecutado también después
de redactar este informe, termina con cero secretos y cero hallazgos altos o
críticos. El guard anónimo principal se repite a las 20:40 UTC con resultado PASS,
cero errores JavaScript y cero logins/escrituras de perfiles o recursos. El único
POST es el nonce Google auditado, que no crea registros en PostgreSQL.
`closure-final.json` reúne los campos de cierre y contrasta automáticamente
aceptación, propiedad, limpieza, regresión, salud, versión y seguridad. Los SHA
local, tracking y GitHub `refs/heads/main` coinciden, comprobados sólo en lectura.

`main-acceptance/clean-final.json` vuelve a comprobar en lectura la propiedad por
tipo de FK, igualdad de las 42 tablas/396 registros, cuatro perfiles eliminados,
cero modificaciones/borrados reales y ausencia de los tres archivos propios.
Los diez materiales y archivos existentes mantienen su hash original. No se
ejecutan nuevas escrituras de prueba en la instancia principal tras consumir
esta excepción.

`PHASE_01=PASS`, `PHASE_02=PASS`, `PHASE_03=PASS`, `PHASE_04=PASS`,
`PHASE_05=PASS` y `PHASE_06=PASS` corresponden exclusivamente a las seis fases
de esta reparación del instructor. La fase anterior de Postmark mantiene su
aplazamiento independiente. El commit/push permanece sin ejecutar por solicitud
expresa; no se necesita otra prueba principal ni se autoriza una futura.

## Archivos y alcance de las correcciones

- Backend: `academic_scope.rs` y su SQL compartido; `instructor_access.rs`,
  `materials.rs`, `uploads.rs`, `exams.rs`, `exam_admin.rs`, `exam_import.rs`,
  `dashboard.rs` y registro del módulo en `lib.rs`. Coherencia de autorización,
  descarga antigua, metadatos reales de importación y contadores PostgreSQL.
- Instructor: `InstructorPanel.tsx`, `InstructorAccesos.tsx`,
  `InstructorMaterial.tsx`, `InstructorExamenes.tsx`, `InstructorDashboard.tsx`.
  Se elimina `BloqueoExamenesModal.tsx` tras comprobar sus referencias.
- Sincronización y administración: `AlumnoMaterial.tsx`, `AlumnoExamenes.tsx`,
  `AlumnoDashboard.tsx`, `AdminUsuarios.tsx` y `sanitizeSchemas.ts`.
- Sesiones: `apiClient.ts`, sus tests y `authService.ts`; no se relaja el backend,
  no se borran cookies compartidas ni se cambian las claves de sesión.
- Regresión: `instructor-access.spec.ts`, `panel-modals.spec.ts`, mock de visitante
  de `course-catalog.spec.ts`, `e2e-instructor-access.mjs`, instrumentación SQL de
  `e2e-concurrent-sessions.mjs` y grupos de `run-e2e.ps1`.

No se modifica ningún Compose, Dockerfile, migración ni configuración DNS/correo.
Se conservan los ficheros temporales del usuario que existían antes de esta tarea.

## Informe de cierre — reparación local completa

Las comprobaciones aisladas complementan la aceptación autenticada principal de
58 gates. La instancia principal está actualizada y limpia; la regresión completa
posterior y las comprobaciones finales en lectura han terminado correctamente.

```text
PROYECTO=UASSPAIN
PANEL=INSTRUCTOR
AUDITORIA=PASS
DUPLICIDAD_ACCESOS=PASS
MATERIALES_EXISTENTES=PASS
ASIGNACION_MATERIALES=PASS
ASIGNACION_EXAMENES=PASS
SINCRONIZACION_PANELES=PASS
ERROR_ACTUALIZACION=PASS
ERROR_SESION=PASS
SEGURIDAD=PASS
FRONTEND=PASS
BACKEND=PASS
DATABASE=PASS
DOCKER=PASS
E2E=PASS_MAIN_AND_ISOLATED
REGRESIONES=PASS_POST_CLEANUP
ERRORES_PENDIENTES=0
ESTADO_FINAL=PASS_LOCAL
```

La prueba de nombres largos localizó un desbordamiento de la cabecera del gestor
a 320 px; se permite encoger el contenedor y partir el texto, manteniendo el diseño.
Typecheck, lint, 48 tests, build y rebuild pasan con esta corrección. La versión
actual es `16423dd8-fd10-4ae4-8c83-26201dc6e879`. La aceptación y la regresión
posterior verifican la corrección. Informe del workflow:

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
E2E_DOCKER=PASS
FUNCTIONAL_TEST=PASS
SECURITY=PASS
SECRETS_IN_GIT=0
COMMIT=NOT_RUN_BY_USER_REQUEST
PUSH=NOT_RUN_BY_USER_REQUEST
LOCAL_HEAD=01897a206dc98202e05a0fa910d9a44efcf4b58a
ORIGIN_MAIN=01897a206dc98202e05a0fa910d9a44efcf4b58a
CRITICAL=0
HIGH=0
ERRORS=[]
CHANGE_STATUS=COMPLETE_LOCAL
SEQUENCE=COMPLETE_WITHOUT_GIT_BY_USER_REQUEST
CURRENT=06_COMPLETE
NEXT=NONE
REASON=ALL_AUTHORIZED_GATES_PASSED
```

GitHub se comprueba mediante `git ls-remote` en lectura; no se ejecuta fetch,
staging, commit o push en esta reparación. `git diff --check` y
`git diff --cached --check` pasan; el índice permanece vacío. El escáner cubre
también el código no staged y las imágenes actuales.
