# Materiales de estudio: reparación y validación local

> Criterio posterior del titular: el catálogo publicado debe mostrarse a todos los alumnos, con independencia de asignación. El criterio de visibilidad descrito a continuación es histórico y queda sustituido por [2026-11-10-catalogo-todos.md](2026-11-10-catalogo-todos.md). Sus pruebas se conservan con su alcance y fecha.

10 de noviembre de 2026. ORIGINAL `C:/Users/migue/OneDrive/Desktop/UASSpain`. **MATERIALS_STATUS=VALIDATED_LOCAL. RELEASE_GATE=BLOCKED.** No commit, push, migración real nueva ni despliegue público en esta continuación.

## Diagnóstico real

PostgreSQL contiene diez materiales activos: uno A1/A3, uno A2, uno STS y siete Radiofonista. Los diez PDF existen físicamente y tienen tamaño positivo. Existe además un material sintético antiguo inactivo, conservado sin modificar. No hay matrículas en student_course_registration ni publicaciones BOE. El esquema actual vincula el catálogo a su autor y concede/revoca acceso mediante materiales_permisoaccesomaterial; no se inventa una asignación implícita por matrícula.

Las siete cuentas de ensayo existentes se autenticaron con sus credenciales guardadas bajo DPAPI, sin mostrarlas ni restablecerlas. El administrador original se verificó por lectura y por la huella protegida, sin iniciar una sesión administrativa nueva. Se conservan las ocho cuentas.

| Cuenta de ensayo | Antes | Después, sin cambiar permisos |
|---|---|---|
| Alumno Prueba local, 2 y 3 | Sin asignaciones ni concesiones; lista vacía | Lista vacía correcta; se comprobó también en el navegador del alumno local |
| Alumno Prueba 4 | Nueve denegaciones explícitas; lista vacía incorrectamente indistinguible de ausencia | Nueve fichas bloqueadas, sin URL, ruta, hash, descripción privada ni contenido |
| Alumno Prueba 5 | Una concesión A1/A3, visible | El mismo material visible y descargable |
| Dos instructores | Catálogo según ámbito del autor | Mismo catálogo y permisos |

Se reprodujo la ausencia de fichas bloqueadas en el panel real del alumno 4 y en cuatro categorías del laboratorio. El material concedido al alumno 5 ya funcionaba: se descargaron sus10680174 bytes antes y después y ambos SHA256 coinciden. No se adjudica al frontend la ausencia legítima de materiales de los otros tres alumnos.

## Causa y reparación

El listado reutilizaba material_access, que exige concesión positiva y ausencia de denegación para leer contenido. Ese filtro también eliminaba las fichas de asignaciones bloqueadas. React recibía una lista vacía y mostraba correctamente su estado vacío para una respuesta que había perdido esa distinción.

- academic_scope.rs añade un ámbito exclusivo del listado: material activo, asignación explícita individual o de categoría, y el ámbito original de autor/instructor. Sin asignación, inactivo o ajeno continúa oculto.
- materials.rs determina bloqueado con la misma regla de concesión/denegación que protege el archivo. Para bloqueados devuelve únicamente id,titulo,categoria,tipo,orden,activo,bloqueado mediante una lista positiva; las columnas futuras también quedan excluidas.
- Detalle, descarga, extracción y completado conservan sus comprobaciones de acceso al contenido. No se amplían permisos de lectura de documentos.
- AlumnoMaterial.tsx conserva los contenedores, navegación, clases, iconos y categorías; los botones existentes se deshabilitan para bloqueados y el de descarga indica Bloqueado. El manejador de completado también rechaza esa acción.
- Dos regresiones existentes se adaptan al nuevo contrato: revocar conserva sólo ficha bloqueada y el contador disponible cuenta únicamente material desbloqueado. La suite nueva de catálogo prueba el recorrido real sin borrados.

No se cambiaron CSS, rutas, tablas, permisos, datos académicos, contraseñas ni configuración operativa de correo/TLS.

## Pruebas y evidencias

Evidencias locales excluidas de Git: `.run/materiales-20261110/`. Matriz revisable: `2026-11-10-materiales-verificacion.csv`.

- Frontend: typecheck y lint,244 pruebas en22 ficheros y build con155 entradas/10 páginas públicas: PASS. frontend-checks.json y frontend-build.log.
- Rust: target audit Docker,169 pruebas PASS, fmt/check/Clippy con -D warnings y prueba de aislamiento del conversor PASS. Cuatro pruebas ignoradas permanecen NOT_RUN. backend-audit-formatted.log.
- Laboratorio existente actualizado:86 casos PASS. Creación por API del instructor, persistencia PostgreSQL, permisos administrativos, reglas individuales/de categoría, denegación prevalente, inactivos, privados sin asignación, instructor ajeno, alumno ajeno incluso con concesión, suplantación por query, anónimo, detalle, descarga y completado. catalog-after.json.
- Navegador del alumno sintético: cuatro categorías con fichas concedidas/bloqueadas; cuatro descargas reales PDF,DOCX,DOC,PDF, con bytes y hashes idénticos a los documentos sintéticos. Privados e inactivos ausentes. lab-ui-after.txt y lab-browser-downloads.json.
- ORIGINAL reconstruido: nueve fichas bloqueadas reales y controles deshabilitados;18 solicitudes a sus detalles/archivos denegadas con404; material concedido visible y PDF real descargado íntegro. Estado vacío legítimo verificado en otra cuenta. original-after-update.json, blocked-ui-after.txt, empty-ui-proof.json y browser-download-after.json. No existen DOC/DOCX reales publicados en el ORIGINAL: su transporte se acredita en el laboratorio, no como una descarga de datos originales inexistentes.
- Fidelidad: CSS servido con SHA256 idéntico al de la imagen anterior; ocho geometrías/tipografías/clases idénticas en el estado concedido sin cambios de datos. Una diferencia de color registrada corresponde al estado hover del botón, sin cambio de clases/CSS. No se afirma igualdad de píxeles. Posiciones muestreadas iguales durante88252ms con actualización automática; no se presenta como medición continua de pintura ni de CLS. visual-final.json.
- Consola: ninguna advertencia/error capturada en las tres páginas comprobadas de materiales. browser-console.json.
- Integridad: huellas de las ocho cuentas y autenticación, trece tablas académicas, clave DPAPI y versión de migración34 iguales al inicio. original-integrity-after.json.

## Aplicación en Docker

Se ejecutó el arranque oficial con -Build -Services backend,frontend, salida0. Ambos contenedores fueron recreados; Nginx, PostgreSQL y Redis conservan ID e imagen. Los cinco servicios están healthy y las cuatro rutas de salud devuelven200 con validación TLS y CA explícita. original-update.log, original-after-update.json y final-health.json.

Frontend desplegado: buildId `a86d8b10-4d1d-484f-8108-00f9e37f11d9`. El hash del ejecutable backend en el ORIGINAL coincide con la imagen runtime utilizada por las pruebas; sólo academic_scope.rs y materials.rs cambian entre los94 inputs del backend anterior y el actual. source-deployment-proof.json.

Se reutilizó el laboratorio detenido, sin copiar el proyecto ni recrear PostgreSQL. Sólo sus imágenes backend/web se actualizaron. Un override local retira la publicación directa duplicada del backend del laboratorio; su acceso web existente permanece en loopback y conserva el proxy. Compose, redes y puertos del ORIGINAL no se modificaron. Se generaron tres cuentas sintéticas nuevas; al terminar quedan bloqueadas/inactivas y sus sesiones propias revocadas, con401 comprobado. Los20 materiales sintéticos de los dos intentos, archivos y permisos se conservan identificados; los diez del ensayo previo quedan inactivos. No se borró ningún registro. fixtures-ledger.json y fixture-retirement.json.

## Incidencias del procedimiento, conservadas

El primer audit Rust se detuvo por formato de una aserción nueva. Se corrigió y se repitió íntegramente el target audit con salida0. El primer verificador de catálogo exigía la nueva marca false al backend anterior; se corrigió ese supuesto y la ausencia de cuatro fichas bloqueadas se confirmó por separado en before-reproduction.json. El segundo ensayo contra la versión corregida supera86 casos.

Una espera de descarga del navegador caducó y reinició su sesión de herramienta; el intento posterior por el control visible capturó el archivo y comprobó los bytes. El fixture SQL inicial necesitó corregir su codificación AES-GCM a base64 URL-safe; sólo afectó a los tres perfiles nuevos del laboratorio. El registro público de ese laboratorio no pudo crear cuentas por remitente SMTP sin verificar tras el reinicio de sus datos temporales; las cuentas de materiales se prepararon por SQL exclusivamente sintético. Eso no acredita ni invalida el registro/SMTP del ORIGINAL. Una sonda de URL relativa se corrigió usando una base explícita antes de repetir las18 denegaciones. No se ocultan estos fallos del verificador como éxitos de la aplicación.

Las dos suites antiguas completas con limpieza DELETE no se ejecutaron con esta restricción. Sus casos relevantes se cubren mediante la suite nueva sin borrado y la UI real. No se afirma una regresión E2E global completa.

## Continuación de auditoría general

Se ejecutaron16 controles nuevos PASS de cabeceras, acceso anónimo, CORS autorizado/ajeno, atributos de cookie sin valores, denegación de panel admin a los cinco alumnos, coherencia de sus contadores de material disponible y conexiones PostgreSQL TLS1.3. Se repitieron30 controles HTTP/TLS/routing sobre el ORIGINAL, PASS. general-security-continuation.json.

F15 y F16 permanecen BLOCKED; F17 conserva su PASS histórico sin nuevos borrados. No se repitieron mediciones WebRTC ni se sustituyó la falta de extremos externos. La CA antigua sigue fallando la verificación estricta OpenSSL con error92 por falta de keyUsage, comprobado de nuevo sin reemplazar claves/certificados. El aviso Firefox continúa sin causa detallada nueva. La evidencia histórica de transporte SMTP validado se conserva; entrega externa/AUTH no se ejecutan ni se declaran PASS. La reparación de materiales no elimina estos requisitos de la auditoría maestra.

## Cierre obligatorio

```text
CODE=PASS reparación quirúrgica de catálogo bloqueado
TESTS=PASS 244 frontend,169 Rust,86 integración materiales;4 ignoradas NOT_RUN
DOCKER_BUILD=PASS procedimiento oficial, salida0
DOCKER_DEPLOY=PASS backend/frontend recreados y verificados
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
E2E_DOCKER=PASS materiales en laboratorio y tres estados reales del ORIGINAL; integral NOT_RUN
FUNCTIONAL_TEST=PASS UI y bytes reales; privacidad y bloqueos denegados
SECURITY=PASS reparación de materiales; FAIL CA estricta previa; global BLOCKED
SECRETS_IN_GIT=0 detecciones Gitleaks en árbol distribuible según exclusiones; historial NOT_RUN
COMMIT=NOT_RUN no autorizado para este cambio
PUSH=NOT_RUN no autorizado para este cambio
LOCAL_HEAD=3db68f34e62f382ee60a21ec4e2d035957c70282
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779
CRITICAL=Sin nuevos confirmados en materiales; no se declara cero global
HIGH=F16 BLOCKED, estado histórico conservado
ERRORS=[F15 externos,F16 ICE/DTLS/RTP,CA estricta error92,Firefox,SMTP entrega externa,E2E integral pendiente]
MATERIALS_STATUS=VALIDATED_LOCAL
CHANGE_STATUS=COMPLETE reparación local de materiales
AUDIT_STATUS=BLOCKED
RELEASE_GATE=BLOCKED
PRODUCTION_READY=NOT_VALIDATED
SEQUENCE=BLOCKED auditoría integral
CURRENT=DEPENDENCIAS_PENDIENTES_AUDITORIA_MAESTRA
NEXT=NOT_RUN comprobaciones dependientes
REASON=No se sustituyen extremos, mediciones o autorizaciones ausentes
```
