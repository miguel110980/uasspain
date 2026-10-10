# Chat y videollamadas — 2026-10-09

Fase 04 del orden solicitado. La fase 03 quedó validada, limpiada y publicada
en `d40027ddf6fa957d5fe1a5f9fea25ebffff00522`. La evidencia de esta fase y su excepción puntual se recoge aquí. El cierre de
publicación y los SHA efectivos se registran en el informe final indicado abajo.

## Causas y reparación

El backend reutilizaba la sala activa del instructor para llamadas privadas
con alumnos distintos. Su señalización y el cierre del moderador dependían
de esa sala compartida. Ahora cada llamada privada tiene una sala independiente
y su canal de señalización depende del UUID de la llamada, incluso cuando un
registro histórico conserva metadatos de sala coincidentes.

La conferencia del botón «Llamar a todos los alumnos» sigue disponible:
el instructor debe iniciarla explícitamente e invitar a los demás alumnos
mediante el ID de una conferencia activa que le pertenece. Una llamada privada,
una conferencia ajena o un rol no autorizado no permiten reutilizar esa sala.
La nueva migración 0018 añade `is_conference`, con valor inicial `false`;
preserva todos los registros históricos y no modifica migraciones aplicadas.
Cerrar una llamada privada conserva las otras. Cerrar una conferencia explícita
finaliza únicamente sus llamadas invitadas.

El instructor sigue siendo el moderador de una llamada con su alumno, también
cuando la inicia un administrador. Las parejas de staff conservan al primer
iniciador como moderador. El servidor calcula los permisos y rechaza valores
de moderación enviados por el cliente.

Las vistas del alumno y del instructor conservan la llamada por su ID.
Recibir otra llamada o refrescar una lista no sustituye arbitrariamente la que
está abierta. El instructor puede continuar una conferencia explícita cuando
sale el alumno de su primera invitación.

La limpieza del chat del alumno existía en el diseño anterior y desapareció
durante la extracción del hook. Se restaura con confirmación, bloqueo mientras
se ejecuta y autorización backend del canal propio. La confirmación explica
que borra el historial para ambos participantes. Cancelar conserva los mensajes;
los permisos de edición o eliminación de mensajes individuales siguen intactos.

## Evidencia registrada hasta ahora

Frontend: typecheck, lint, 46 tests y build de producción. Rust: fmt, check,
clippy y 93 tests del target `audit`. La migración 0018 y la restauración de
backups se comprobaron en la pila Docker aislada.

Las pruebas API de chat privado superaron 61 gates, las de instructores 25
y las nuevas de aislamiento de llamadas 22. Estas últimas prueban dos alumnos
simultáneos con el mismo instructor, ofertas y respuestas que sólo llegan a
su llamada, identificadores ajenos rechazados, metadatos históricos coincidentes,
conferencias explícitas, moderación y cierre sin afectar otra llamada.

El caso nuevo de exportación comprueba un PDF descargado real, su cabecera y
el contenido exclusivo de la conversación autorizada. La limpieza de A conserva
el historial y la interfaz de B; un acceso a su historial desde A recibe 403.

El caso nuevo de medios utiliza dos conexiones WebRTC reales dentro de una misma
ventana autenticada del instructor y la interfaz de producción de dos alumnos.
Cada llamada recibe un color y un tono sintéticos distintos. Se comprueban
píxeles y frecuencias del audio decodificado, un único peer por llamada, RTP
recibido de audio y vídeo y DTLS conectado. En la ejecución HTTP aislada del
09/10 a las 21:26 UTC se midieron 632,8125 y 1289,0625 Hz, con vídeo rojo y azul,
respectivamente, sin errores de negociación. Esta prueba aislada no acredita
por sí sola la instancia principal.

La primera regresión completó los 104 casos del grupo general, presencia y
asignación. Un caso de modales aún exigía que no existiera el botón de limpiar
del alumno. Falló con el botón restaurado y se conserva su traza. Se actualiza
la expectativa para verificar confirmación, foco y cancelación sin borrar datos;
se repite el grupo completo y se ejecutan los grupos restantes con código de
aplicación estable. No se contabiliza ese intento fallido como PASS.

Tras reanudar la tarea se encontró Docker Desktop detenido. Se recuperó la pila
existente con el arranque oficial, preservando clave y volúmenes. Una lectura
inmediata durante la transición del primer despliegue de fase 04 devolvió 502;
se detuvo la aceptación y se esperó a que el proxy se estabilizara. El rebuild
y la aceptación definitivos descritos abajo verifican el estado posterior.

## Aceptación principal autorizada — 2026-10-10

El usuario concedió una excepción específica y única para esta fase: exactamente
cuatro perfiles sintéticos temporales, dos de staff con roles instructor/admin
y dos alumnos. La excepción de la fase 03 no se reutilizó. Los nuevos perfiles
llevan el prefijo TEMP_PHASE04; el override de 2FA sólo de esos cuatro evita
correos OTP. No se autenticó ninguna cuenta real ni se cambió la política global.

El runner se verificó primero en Docker aislado. Su primer intento detectó que
un login administrador sustituye la sesión instructor del mismo perfil; se
corrigió el orden del test. La limpieza de ese intento conservó todas las filas
previas. El segundo ensayo superó los 58 gates y limpió todos sus registros.

El arranque oficial con -Build finalizó el 10/10 a las 08:40 UTC. El frontend
principal ejecuta el build 002dd854-5bfc-48e5-89a1-5340f234c267 y la imagen
sha256:f273453ffc85aedced310e923ce87fb4c6ce3ea6c5c8b9f6c6b42a9656a98460.
El backend ejecuta sha256:fde4a89c86dc834e2444a8925db296e3c2c614a2702aaaeb0f65422b1c994b8d.
Se verificaron cinco servicios saludables y cuatro HTTP 200 mediante la CA.
Los bundles servidos por HTTPS coinciden byte a byte con los del contenedor.
La migración 0018 está aplicada; se preservaron el volumen cifrado y la clave DPAPI.

Antes de crear perfiles, un pg_dump completo de la base principal se cifró con
AES-GCM y se restauró desde el fichero guardado en un verificador temporal sin
red ni volúmenes persistentes. Se compararon las 42 tablas y los 379 registros
existentes, incluyendo la migración 0018 y el backup nocturno del scheduler.
El SHA256 cifrado es a6785fcdfa50949575543956922088860beb833e7e6afb150656fee0474b516d.
El snapshot se conserva fuera de Git; la clave y las contraseñas permanecieron
sólo en memoria. El verificador fue retirado tras comprobar su identidad.

La aceptación en https://localhost, a través de nginx, frontend/backend y
PostgreSQL/Redis principales, superó 58 gates: entrega real bidireccional,
persistencia, reconexión WSS, accesos ajenos rechazados, moderación autoritativa,
PDF descargado con contenido exclusivo, cancelación y limpieza del canal propio.
Dos llamadas privadas simultáneas con el mismo instructor transmitieron vídeo
rojo/azul y tonos de 640/1280 Hz. El audio decodificado fue 632,8125/1289,0625 Hz,
con un peer por llamada, DTLS conectado y RTP de audio/vídeo recibido, sin mezcla.
Se cerró A y B siguió activa con su interfaz de medios. Se verificó también la
reconexión real del hook del alumno, conferencias explícitas y su cierre aislado.

El inventario [de fixtures](2026-10-09-chat-video-fixtures.json) registra los cuatro
UUID, IDs de auth_user y los 32 registros creados. Cuatro mensajes propios se
registraron antes de borrarlos mediante la limpieza del chat; los 28 registros
restantes se eliminaron exclusivamente por IDs y referencias demostradas.
Una transacción con bloqueo y comparación de hashes protegió los datos previos.
Después, las 42 tablas coincidieron exactamente con los 379 registros iniciales:
REAL_USER_DATA_MODIFIED=0, REAL_USER_DATA_DELETED=0 y TEMP_DATA_RESIDUE=0.

La comparación adicional con el inventario de ayer detectó un backup completado
por scheduler a las 01:00 UTC y un destino actualizado. El delta exacto fue:
ninguna fila borrada, dos nuevas (backup y migración 18) y un destino diferente.
Sus marcas last_backup/last_seen son de las 01:00 UTC; configuration_updated_at
sigue siendo del 05/10. Ese inventario anterior no se presenta como una
comparación exacta actual. La prueba autorizada usa el snapshot completo de
inmediatamente antes de crear los perfiles y demuestra que ninguna de sus
filas cambió durante la aceptación. No se modificaron ni borraron registros
de backup para ajustar el resultado.

La regresión completa posterior a la limpieza terminó el 10/10 a las 09:13 UTC
en Docker aislado: API, 72 gates de backups, 48 de cursos, 18 de concurrencia,
61 de chat privado, 25 de peers, 22 de aislamiento de vídeo y 126 casos de
navegador. La auditoría verificó 876 estados (432 públicos, 228 admin, 120
instructor y 96 alumno), con cero fallos, errores, avisos y escrituras
interceptadas. No se reutilizan pruebas anteriores como nueva ejecución.

Una muestra de seis mensajes registró p95 de entrega de 109 ms, sin duplicados
ni cruces de canal y sin GET adicional del historial por mensaje. Este resultado
pertenece al entorno aislado; no representa una medición de tráfico real.
Se retiraron sólo seis contenedores/diez volúmenes del GUID propio
00772d6041154e15aafe7d109ab97479. Después, los 379 registros principales
seguían idénticos al snapshot previo y no quedaban registros temporales.

La auditoría actual de fuente, historial, dependencias y las cinco imágenes
desplegadas registró cero secretos y cero vulnerabilidades HIGH/CRITICAL.
El guard de uso único rechaza el inventario consumido antes de SQL o login;
la bandera antigua de fase 03 tampoco autoriza la nueva excepción.

La regresión HTTPS/WSS posterior a la limpieza terminó correctamente: siete
casos de navegador y 16 gates del edge con 20 conversaciones/40 sockets.
Se comprobó mediante la CA que el build ID y los hashes de los bundles eran
idénticos a los del frontend principal. Incluye PDF, limpieza, reconexión,
aislamiento y audio/vídeo decodificados de ambas llamadas privadas.
Se retiraron sus siete contenedores y diez volúmenes del GUID exclusivo
d3cacb74927143e19ca91e597c9b80dd.

```text
MAIN_INSTANCE_TEST_PROFILES=4
REAL_USER_DATA_MODIFIED=0
REAL_USER_DATA_DELETED=0
TEMP_DATA_RESIDUE=0
MESSAGE_VALIDATION=PASS
MODERATION_VALIDATION=PASS
PERMISSION_VALIDATION=PASS
POST_CLEANUP_REGRESSION=PASS
```

El cierre de publicación registra todos los campos de REPAIR_WORKFLOW, los
SHA efectivos y los resultados de commit/push y comprobaciones posteriores en
`.run/order-20261009/04/final.json`. La comprobación posterior al push usa sólo
lecturas de HTTPS, API/WSS, bundles, versión, esquema y huellas de las 42 tablas,
con las mismas imágenes que superaron los 58 gates principales. La excepción
consumida no se reutiliza para nuevos perfiles, logins ni escrituras de prueba.
La fase 05 comienza únicamente después de que ese cierre registre PHASE_04=PASS.
