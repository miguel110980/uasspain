# Panel instructor — 2026-10-09

Fase 03 del orden solicitado, iniciada después de cerrar 00, 01 y 02.
La fase 02 está publicada en `bb1ec867b275244b2193f1abc5ba2cffca00aeb4`.

## Causa y reparación

La lista de contactos incluía instructores, pero la autorización de mensajes y
WebSocket sólo permitía parejas administrador/instructor. La vista del instructor
además filtraba sus contactos a administradores. Se permiten parejas de staff
activo, verificado y habilitado, excluyendo al propio usuario y a alumnos.
Los mensajes conservan persistencia cifrada y sala por pareja de UUID.

Las llamadas tampoco admitían instructor/instructor. La nueva migración 0017
añade `instructor_peer_id` y el canal `instructores`, sin modificar migraciones
aplicadas ni registros existentes. Ordena los participantes y bloquea la misma
fila antes de buscar/crear la llamada: dos solicitudes opuestas no pueden
reemplazar al primer iniciador ni crear salas diferentes. El servidor calcula
iniciador y moderador; no acepta el moderador enviado por el cliente.

Se añade la pestaña Instructores al panel de llamadas y se muestran los contactos
autorizados reales. Ambos participantes pueden listar y acceder a su llamada;
los alumnos y administradores ajenos quedan excluidos. Las salas existentes de
alumnos y administración conservan su modelo.

## Alcance de las comprobaciones

La versión Docker principal reconstruida tiene build ID
`38e9591f-c3fc-4ee5-9a37-00530e4a6b6f`. Se comprobaron los cinco servicios,
HTTP 200 con la CA en los cuatro endpoints, imagen/versión, permisos efectivos,
conservación de los ocho perfiles originales, clave y volúmenes. Los logs
posteriores al despliegue estable no contenían errores críticos.

Frontend: typecheck, lint y 46 tests. Rust: fmt, check, clippy y 93 tests del
target audit. El navegador de la instancia principal comprobó perfiles/roles,
totales cargados, roster asignado, navegación, pestaña nueva, reload y WSS
autenticado con ping/pong. Sus capturas estables están en
`.run/order-20261009/03/`; se descartó la primera captura tomada durante carga.

La primera regresión aislada superó API y 102 casos browser, pero fallaron dos
casos durante ediciones del frontend servido por Vite. Se conservan los fallos
como evidencia; no se presentan como PASS. Se repite con el código estable.
`e2e-instructor-peer.mjs` comprueba entrega privada, moderación con ambos
iniciadores, refresh/reconexión, autorización negativa y carrera de creación.
El runner incorpora esa prueba en su regresión API.

La migración nueva detectó una comprobación obsoleta de backups que esperaba
exactamente 16 migraciones. Ahora compara versiones, descripciones, checksums y
estado con el baseline previo a la copia. No se reduce el control de integridad.
La prueba nueva de peers se ajustó al formato real del evento privado
(`message`, sala, remitente y contenido); el evento no incluye ID de mensaje.
Después superó 25 gates sobre la pila aislada, incluidas ambas direcciones.

La regresión encontró además overflow a 375 px al añadir la tercera pestaña de
llamadas. Se permitió el salto de línea del grupo de pestañas. El caso exacto
de navegación instructor pasó tras corregirlo; la instancia principal se
reconstruyó de nuevo y verificó esa interfaz a seis anchuras (320–1440 px).
La prueba de guard verificó que la aceptación mutable de localhost se rechaza
antes de consultar cuentas, crear carpetas, abrir Docker o arrancar el navegador.

La regresión completa definitiva terminó en PASS: API, 72 gates de backups,
deltas/restauración, 48 de cursos, 18 de sesiones concurrentes, 59 de canales
privados, los 25 nuevos de peers, caídas/recuperación de dependencias,
124 casos browser y 876 estados UI (432 públicos, 228 admin, 120 instructor,
96 alumno). La auditoría UI final registró cero fallos, errores y avisos, y no
interceptó escrituras. Evidencia de fase: `e2e-all-final.log`, `ui-final.json`
y `peer-final.json` dentro de `.run/order-20261009/03/`.

La regresión de chat/medios pasó además sobre Docker HTTPS aislado en
`https://localhost:8444`. La aceptación específica superó 22 gates de UI/API/WSS:
datos asignados, mensajes en ambas direcciones sin F5, aislamiento A/B,
persistencia, reconexión, rechazo de instructor ajeno, contacto entre instructores,
moderación con ambos iniciadores y alumno iniciador sin permisos de moderador.
La aceptación registró el mismo build ID de frontend que la instancia principal.
Eliminó sus cuatro perfiles propios y verificó que los IDs previos permanecían.
Después se retiraron sólo los siete contenedores y diez volúmenes de su GUID.
Los recursos E2E anteriores ajenos a la tarea se conservaron.

## Excepción única y protección de datos

El usuario autorizó expresamente cuatro perfiles temporales para esta prueba
concreta de fase 03. La autorización no se extiende a pruebas posteriores.
Se reforzó el runner antes de ejecutarlo: no autentica ninguna cuenta existente,
crea exactamente dos instructores y dos alumnos con identidad TEMP_PHASE03,
dominios example.invalid, documento sintético TEMP y sin datos personales reales.
Las credenciales aleatorias y claves de cifrado sólo se utilizan en memoria.
La preparación SQL conserva el cifrado de campos e índices de búsqueda de la
aplicación; la aceptación usa login, cookies, UI, API y WSS reales.

Antes de crear perfiles se generó un snapshot completo pg_dump cifrado AES-GCM.
Se volvió a leer y descifrar el artefacto guardado, se verificó su SHA-256 y se
restauró en un contenedor temporal sin red, con almacenamiento tmpfs, sin mounts
ni volúmenes de la instancia principal. Las 42 tablas y sus 377 registros
coincidieron exactamente con las huellas SHA-256 de la base principal.
El snapshot cifrado se conserva en
`.run/order-20261009/03/main-acceptance/pre-test-snapshot.enc`.
SHA-256 del artefacto:
`b8256708262cab2b5fb842daae5bd5118de5ff7184689abf520868d83a6b1269`.

El primer preparativo falló al referenciar la imagen de PostgreSQL por el ID de
configuración en lugar de la referencia y plataforma desplegadas. No se creó
ningún perfil en ese intento. Se corrigió y ensayó de nuevo en Docker aislado;
la restauración espera también a la inicialización completa de la base temporal.
La única creación principal se ejecutó después de verificar el snapshot.

La aceptación principal pasó 22 gates: entrega instructor/alumno en ambos
sentidos sin refrescar, aislamiento de otro alumno, persistencia, reconexión,
rechazo de instructor no asignado, entrega entre instructores, moderación según
primer iniciador, persistencia de moderador tras reload/reconexión y alumno
iniciador sin permisos de moderador. Se probó el frontend Docker con build ID
`38e9591f-c3fc-4ee5-9a37-00530e4a6b6f`, igual al despliegue comprobado.

El inventario registra los IDs exactos de los cuatro perfiles, cuatro usuarios
auth, dos conexiones, tres mensajes alumno/instructor, un mensaje entre staff,
cuatro registros de acceso y tres llamadas: 21 registros en total. Antes de
borrar se comprobó que cada fila era nueva y que todos sus participantes eran
exclusivamente uno de esos cuatro perfiles. La limpieza bloqueó las tablas,
revalidó propiedad y referencias entrantes, borró sólo IDs inventariados y
comprobó cada fila preexistente antes de confirmar la transacción. No utilizó
borrados por patrón, fecha ni TRUNCATE, ni restauró la base principal.

Después se compararon de nuevo las huellas completas de las 42 tablas:
377 registros originales idénticos, cero registros adicionales y ocho perfiles
originales conservados. Los cinco servicios quedaron saludables y los cuatro
endpoints HTTP respondieron 200 con validación de CA. Los IDs y la evidencia de
propiedad y limpieza están registrados en
[el inventario de la excepción](2026-10-09-instructor-fixtures.json).
Las huellas antes/después y el informe browser permanecen en
`.run/order-20261009/03/main-acceptance/`.

## Regresión posterior a la limpieza

Se ejecutó de nuevo la regresión completa en una pila Docker E2E aislada,
posterior a `2026-10-09T20:20:58.365Z`, sin volver a utilizar la excepción para
escribir en la instancia principal. El log es
`.run/order-20261009/03/post-cleanup-regression.log`.
La nueva ejecución terminó correctamente: API, 72 gates de backups, 48 de cursos,
18 de sesiones concurrentes, 59 de canales privados, 25 de peers, 124 casos
browser y 876 estados UI. El informe UI registró cero fallos, errores y avisos,
y cero escrituras interceptadas. Son pruebas nuevas posteriores a la limpieza;
no se reutilizan los resultados previos como si fueran una nueva ejecución.
Los informes conservados son `ui-post-cleanup.json` y `peer-post-cleanup.json`.
Después se retiraron sólo los seis contenedores y diez volúmenes de su GUID
`cc3c671428b0485eb158eaeec2d8a3b0`. La comprobación principal posterior volvió
a verificar las 42 tablas y los 377 registros originales idénticos, sin residuos.

La regresión adicional HTTPS de chat, reconexión y medios reales pasó también
después de limpiar la instancia principal: un caso browser (28,1 s), sobre
Docker aislado en https://localhost:8444. Se retiraron exclusivamente sus siete
contenedores y diez volúmenes del GUID `455572269fa5405687b06e5128f33ac0`.
Antes de publicar se repitieron salud 5/5, cuatro HTTP 200 con CA y la comparación
completa de las huellas principales; todos los controles volvieron a pasar.

El selector de la prueba de reasignación de chat identifica el párrafo del
contacto: el dashboard oculto conserva otro elemento con el mismo nombre.
La regresión completa utiliza y valida ese selector sin cambiar la interfaz.

La auditoría de seguridad revisó las cinco imágenes principales definitivas,
fuente, historial y dependencias: cero secretos y cero hallazgos altos/críticos.
La comprobación adicional del guard impide repetir la creación al encontrar
el inventario consumido de los cuatro perfiles, antes de SQL o autenticación.

El cierre de publicación registra los SHA efectivos y los resultados de
commit/push, salud, función desplegada y huellas de datos posteriores al push en
`.run/order-20261009/03/final.json`. La comprobación posterior sobre la instancia
principal usa sólo lecturas de HTTPS, API/WSS, bundles, versión y esquema:
la imagen aceptada permanece igual y la excepción no autoriza nuevos logins ni
escrituras de prueba en la base principal.
