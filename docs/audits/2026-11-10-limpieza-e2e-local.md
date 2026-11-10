# UAS Spain ORIGINAL — limpieza controlada y E2E local

Fecha: **10 de noviembre de 2026, Europe/Madrid**. Continuación del
[cierre anterior](2026-11-10-cierre-bloqueos.md), sin reiniciar la auditoría.
**CHANGE_STATUS=NOT_COMPLETE · RELEASE_GATE=BLOCKED.**

Matrices actuales: [pruebas locales](2026-11-10-pruebas-locales.csv) y
[los 17 hallazgos](2026-11-10-hallazgos-tras-pruebas-locales.csv).
Tras la confirmación de la limpieza manual del chat, la matriz local queda en
**25 PASS, 6 BLOCKED y 2 NOT_RUN**. Este cierre de atribución no es una prueba
automatizada adicional ni cambia los bloqueos de la auditoría maestra.

## Resultado de la limpieza

Se actuó exclusivamente sobre identificadores cuya procedencia estaba acreditada,
sin seleccionar cuentas por contener «prueba» o «example.invalid».

| Ámbito | Eliminado en esta ejecución | Conservado |
|---|---:|---|
| ORIGINAL `uasspain` | 4 perfiles artificiales y sus 4 auth_user | Los 7 usuarios elegidos y el administrador restante |
| Laboratorio `uasspain-mail-audit-closure-630870e0` | 11 perfiles y sus 11 auth_user | El administrador de control del laboratorio |
| Mismo laboratorio, registros sin perfil | 65 auth_user: 64 del censo sintético y el auth_user inactivo de F17 | Sin selección por dominio ni borrado masivo de tablas |

Los cuatro perfiles retirados del ORIGINAL son:

- `20da41ce-7fe2-42d3-bacb-db9c52d7905d` — alumno de la ejecución anterior.
- `0eadd0b7-86f5-4e83-9ecd-cb931f08d5ba` — alumno de la ejecución anterior.
- `aa515e46-a38c-4886-83df-7793ab159c91` — alumno de la ejecución anterior.
- `c6130637-983a-4ab3-905c-b4239738051f` — instructor de la ejecución anterior.

Procedencia: `original-20261109-evidence/fixture-manifest.json`, cuentas bloqueadas,
fechas de creación, relaciones y ausencia de colisión con las ocho cuentas previas.
Los 602 resultados prácticos sintéticos asociados coincidían por ID con ese
manifiesto. Se identificaron también intentos, resultados, conversaciones,
llamadas y datos derivados de esas mismas cuentas. Ninguna relación compartida
no acreditada se añadió a la eliminación. Se conservaron exámenes, materiales,
archivos y registros que no estaban incluidos en las cascadas autorizadas.

En el laboratorio se comprobó el proyecto/propietario del contenedor PostgreSQL,
la base `test_e2e_uasspain` de origen vacío y sintético, y la ausencia de volúmenes
reales. Los 64 auth_user sin perfil se contrastaron con la lista explícita
`disabled_auth_ids` de `password-census-bounded.json`; no se dedujeron por un rango
numérico ni por sus nombres. El perfil F17 ya se había eliminado antes; ahora se
retiró sólo su auth_user inactivo restante. No se volvió a contabilizar su perfil.

Antes de confirmar **cada** borrado se comprobaron las claves foráneas y se ensayó
la eliminación dentro de una transacción, seguida de rollback y comparación de
las huellas de todas las tablas públicas. Se conservaron **20 paquetes de
recuperación de filas sintéticas cifrados con DPAPI**, con descifrado de comprobación
idéntico al contenido original en memoria. La eliminación efectiva comprobó
integridad referencial y huellas de filas ajenas antes del commit, y comprobación
posterior por cuenta. No se efectuó una restauración posterior al commit en
producción; los paquetes requieren una recuperación selectiva y autorización
específica si alguna vez fuese necesaria.

La limpieza fue mantenimiento transaccional delimitado, no una prueba del botón
de borrado del frontend. **No acredita por sí sola la aceptación gráfica de F17.**

Evidencias: `.run/cleanup-20261110/original-cleanup-preflight.json`,
`original-cleanup-results.json`, `lab-cleanup-results.json`,
`lab-auth-only-cleanup-results.json`, `cleanup-final-inventory.json`,
`recovery-index.json`. Los paquetes de recuperación están ignorados por Git.
No se borraron volúmenes, vaciaron tablas, reconstruyeron entornos ni reiniciaron
servicios. Otros entornos históricos sin esta comprobación de procedencia no
se declararon limpios ni se modificaron.

La primera enumeración del verificador agotó su tiempo antes de ejecutar DML;
se recuperó el estado desde las evidencias y se agruparon las lecturas SQL.
El control de identidad del censo también impidió actuar hasta contrastar su
lista exacta de IDs. Estos controles no se retiraron ni se rebajaron para borrar.

## Siete cuentas conservadas y autenticación

Se recuperaron las credenciales existentes desde su almacén DPAPI autorizado,
sin restablecer contraseñas ni mostrarlas. La identificación se contrastó con la
base y el inventario anterior; no se afirma haber cotejado una imagen no disponible
como archivo en esta ejecución.

| Perfil | Rol de prueba | Estado y acceso |
|---|---|---|
| `47c5077c-1a6a-4592-90db-732f33cae9e2` | instructor; conserva también su rol admin anterior | activo, OTP verificado, login 200 |
| `b6f3477f-70c7-44e4-98bd-97917b4abb08` | instructor | activo, OTP verificado, login 200 |
| `fdfe736e-9ee6-4739-9bdb-3f89ad8a744b` | alumno | activo, OTP verificado, login 200 |
| `956308c2-d2ab-4d9d-b869-5ae0749ac802` | alumno | activo, OTP verificado, login 200 |
| `f94a95e3-a6d9-4c07-b06d-3097047519d0` | alumno | activo, OTP verificado, login 200 |
| `c46592e0-dd3e-4b99-a941-542ca6bf142a` | alumno | activo, OTP verificado, login 200 |
| `340942da-f68a-4a5c-8fbd-2151acdba5c8` | alumno | activo, OTP verificado, login 200 |

El administrador restante `e89b3e28-1f0e-49c8-948b-8a4e3eb346c8` también se conservó.
Las huellas de perfil y credenciales de **8/8 cuentas permanecen iguales**;
se excluyen de esta comparación únicamente las marcas de actualización/último
login, no los hashes de contraseña, roles, activación o asignación.
Las sesiones propias de ensayo se distinguen por su ventana; no se cerraron
sesiones ajenas para liberar conexiones.

Evidencias: `seven-authentication.json`, `seven-auth-after-cleanup.json`,
`protected-eight-before.json`, `final-original-integrity.json`.

## Chat real: PASS en el alcance ejecutado

- Siete contextos de cuenta independientes y WSS con validación TLS contra la CA
  existente. Mensajes bidireccionales por las parejas actualmente asignadas.
- Matriz de **35 comprobaciones**: diez accesos propios permitidos y 25 ajenos
  denegados. IDOR de un mensaje ajeno: 403. Handshakes WSS anónimo: 401; alumno
  e instructor ajenos: 403.
- Cuatro parejas WSS simultáneas y después **cinco conversaciones durante el
  mismo intervalo**: cuatro parejas API/WSS y la pareja de la interfaz. Sin
  mensajes cruzados entre las salas observadas.
- Se observó inicialmente un 429 del límite `chat_room` de Nginx. Tras cerrar
  conexiones propias y usar ventanas nuevas, la quinta sala admitió a ambos
  clientes. No se cambió el límite ni se presentó el rechazo inicial como un
  defecto confirmado del producto.
- Desconexión de un cliente, envío durante la ausencia, recuperación por historial
  y recepción WSS posterior: PASS. Logout de una sesión propia cerró su socket
  con 1008; otra sesión siguió activa. No se reinició backend ni Redis.
- PostgreSQL almacenó los mensajes nuevos cifrados, sin el marcador de prueba
  en claro. Esto acredita cifrado almacenado en el alcance observado, **no E2EE**.
- En `https://localhost` se comprobó la pareja **Instructor Prueba local ↔ Alumno
  Prueba local**: envío y recepción visibles en los dos sentidos. El PDF exportado
  es válido, contiene los dos mensajes seleccionados y no el marcador de otras
  conversaciones.

Evidencias: `local-chat-checks.json`, `chat-access-matrix.json`,
`fifth-chat-room-retest.json`, `local-chat-ui-proof.json`,
`local-chat-instructor.png`, `local-chat-pdf-proof.json`,
`local-message-manifest.json`. Las acciones de cierre de ventanas de chat no
eliminan su historial.

**Atribución aclarada — PASS:** durante la interacción con las pestañas visibles
se eliminaron dos mensajes creados en esta ejecución. Nginx registra un POST a
`/api/mensajes/clear-chat/` con respuesta 200 y el usuario confirmó expresamente:
«Sí, he limpiado esa conversación». La eliminación corresponde a esa acción manual;
no se atribuye a un fallo de persistencia ni a un borrado espontáneo del producto.
Los identificadores ausentes son de ensayo y no había mensajes legítimos previos
en esta tabla después de la limpieza delimitada. No se restauran esos mensajes
ni se ejecuta otra limpieza. La observación original y su resolución se conservan
por separado para mantener la trazabilidad.
Evidencia: `chat-history-observation.json`.

## Videollamada local: medios reales y límites de la evidencia

La prueba utilizó dos sesiones de navegador de **este equipo** contra el ORIGINAL
en `https://localhost`, sin RustDesk ni acceso remoto al sobremesa. No constituye
una prueba entre redes físicas diferentes.

- Instructor y alumno correctos, llamada entrante y adhesión: PASS. El instructor
  es moderador; el alumno es participante. «Participante 1» es el texto genérico
  del vídeo remoto, no otra cuenta de alumno.
- El usuario concedió acceso a cámara/micrófono. Se observaron imágenes de cámara
  real en ambos extremos, vídeos local y remoto de 640×480, `readyState=4`, no
  pausados y tiempo de reproducción creciente. Se mantuvieron muestras antes
  y después de las reconexiones; no se utilizaron dispositivos multimedia falsos.
- **Audio audible en ambos sentidos: PASS manual**, confirmado por el usuario
  tras probar los sentidos por separado. La herramienta no grabó ni escuchó el
  audio; no se presenta esa confirmación como medición automática de energía RTP.
- Recargar y reentrar primero como alumno y después como instructor recuperó
  «Conectado» y ambos vídeos, con las identidades correctas: PASS. Se ensayó la
  reconexión del navegador, no una caída real de la red ni del servidor.
- Desactivar/reactivar cámara y micrófono en ambos clientes: PASS de controles.
  La captura guardada se tomó con cámaras y micrófonos desactivados para no
  conservar imágenes personales. Después se restauraron los controles.
- Colgar retiró el diálogo y los elementos de vídeo de ambos extremos. El registro
  de llamada quedó finalizado; no se borró su historial.
- Siete comprobaciones de API de llamada: dos participantes permitidos, cinco
  ajenos rechazados. En dos salas separadas se verificaron WSS, moderación,
  retransmisión real de señales ping, ausencia de cruce, reconexión y cierre al
  finalizar. No se usó SDP ficticio como prueba multimedia.

La configuración ICE actual devuelve `iceServers=[]`: no hay STUN/TURN configurado
en esa respuesta. Los medios locales demuestran conectividad WebRTC funcional,
pero **no una prueba de TURN o NAT externo**. La inspección directa de pareja ICE,
estadísticas RTP y cifrado DTLS negociado permanece **BLOCKED**: el navegador
rechazó el diagnóstico interno por su política de protocolos permitidos. No se
intentó acceder por otro mecanismo ni sortear esa restricción. No se declara
PASS del caso histórico que exigía observar ese cifrado y todos esos detalles.

Evidencias: `local-media-connected.json`,
`local-video-student-reconnection.json`, `local-video-instructor-reconnection.json`,
`local-video-controls.json`, `local-video-controls-restored.json`,
`local-video-controls-muted.png`, `local-video-ended.json`,
`video-access-matrix.json`, `video-wss-signaling.json`, `video-transport-proof.json`.

## Continuación de auditoría, posterior a la limpieza

- **108 comprobaciones de API de lectura:** 64 lecturas de funciones de los
  tres roles; 18 límites de administración; ocho accesos a solicitudes; diez
  permisos académicos por asignación; ocho verificaciones de contadores. Todas
  las respuestas y los contadores comprobados coincidieron con lo esperado.
  No se confunde este número con 108 controles únicos de interfaz.
- Los datos de SMTP, OAuth, política y backups se consultaron sin cambiarlos.
  No se observaron campos secretos no vacíos en las respuestas de configuración
  revisadas. SMTP original declara STARTTLS/Postmark configurado; su último test
  registrado es del **25/10/2026**, no una aceptación nueva. Entrega por el
  proveedor externo: NOT_RUN. Las cuatro integraciones y el SMTP/TLS real del
  laboratorio siguen como evidencias anteriores PASS, sin presentarlos como
  pruebas nuevas del proveedor.
- Google ORIGINAL sigue desactivado/no vinculado, con estado `BLOCKED_PUBLIC_TLS`.
  Se respeta la decisión previa de no vincular cuentas; no se cambia Google Cloud.
- Rendimiento acotado de 64 GET secuenciales: p50 **9 ms**, p95 **17 ms**. No
  constituye una prueba de carga, capacidad o concurrencia general.
- npm raíz y frontend se volvieron a auditar: **cero avisos**. Los resultados
  anteriores de imágenes originales y Rust se reutilizan con sus límites;
  no se declara un nuevo escaneo OS. Permanecen los dos avisos Cargo RAW de
  ramas opcionales evaluadas como no activas en el grafo Linux ejecutado.
- Los **20 registros académicos previos mantienen sus SHA256**. Se conservaron
  las seis llamadas históricas de octubre y las nuevas llamadas de ensayo
  finalizadas. Cinco servicios healthy, mismas imágenes/arranques/volúmenes y
  cuatro endpoints HTTP 200 con validación TLS de Node.

Evidencias: `panel-api-read-regression.json`, `admission-and-resource-access.json`,
`dashboard-counts-after-cleanup.json`, `operational-integrations-state.json`,
`panel-read-timing.json`, `npm-root.json`, `npm-frontend.json`,
`preserved-call-history.json`, `final-original-integrity.json`.

La matriz histórica conserva **79/81 PASS y 2 BLOCKED**; esta ejecución aporta
subpruebas multimedia locales, no promueve sin evidencia el caso integral de
ICE/cifrado observado. Los **17 hallazgos conservan 14 PASS y 3 BLOCKED** hasta
completar sus condiciones: F15 externo, F16 integral y F17 gráfico. La matriz
maestra de 441 controles no queda cerrada por estas lecturas ni por navegar
secciones. Registro/OTP/reset, importaciones, exámenes, reasignación, avatares y
restauraciones sintéticas conservan las pruebas anteriores válidas; no se
repitieron ni se modificaron expedientes de las siete cuentas para aparentar
cobertura adicional.

Siguen pendientes CA estricta de Python/KeyUsage, diagnóstico ICE/DTLS, aceptación
gráfica F17, comprobación externa SMTP y OAuth, WireGuard/SFTP con extremos
autorizados y controles maestros no ejecutados. La atribución de la limpieza de
los dos mensajes de ensayo está aclarada. El ajuste de texto anterior sólo está desplegado en
laboratorio. No hay un nuevo defecto de código confirmado y reparado en esta
ejecución; no se reconstruye ni despliega por rutina.

## Cierre obligatorio

```text
SEQUENCE=BLOCKED
CURRENT=VALIDACION_MAESTRA
NEXT=NOT_RUN
REASON=Verificaciones obligatorias externas y de seguridad pendientes
CHANGE_STATUS=NOT_COMPLETE
RELEASE_GATE=BLOCKED
CODE=NO_NEW_APPLICATION_CHANGE; mantenimiento de datos sinteticos autorizado
TESTS=PASS en los alcances ejecutados; aceptacion integral BLOCKED
DOCKER_BUILD=NOT_RUN; sin nuevos inputs de aplicacion, no reconstruccion autorizada por rutina
DOCKER_DEPLOY=UNCHANGED; ajuste previo de texto aun sin desplegar en ORIGINAL
POSTGRES=HEALTHY; mismo volumen cifrado
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5
HEALTHZ=PASS; HTTP 200, TLS verificado con CA existente
READYZ=PASS; HTTP 200, TLS verificado con CA existente
API_LIVE=PASS; HTTP 200, TLS verificado con CA existente
API_READY=PASS; HTTP 200, TLS verificado con CA existente
E2E_DOCKER=PASS local chat y medios documentados; BLOCKED integral
FUNCTIONAL_TEST=PASS alcances ejecutados; 108 lecturas no equivalen a cobertura completa
SECURITY=BLOCKED integral; npm 0, sin debilitar protecciones, diagnosticos pendientes
SECRETS_IN_GIT=0 coincidencias Gitleaks; exclusiones documentadas, no promesa universal
COMMIT=NOT_RUN; RELEASE_GATE no superado
PUSH=NOT_RUN; RELEASE_GATE no superado
LOCAL_HEAD=16d1f208acf3dc881cfb272728b57a2ae00d4779
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779; referencia local sin fetch
CRITICAL=Sin nuevos defectos confirmados; no dictamen global por cobertura pendiente
HIGH=Sin nuevos defectos confirmados; F16 integral pendiente
ERRORS=[CA estricta; ICE/DTLS observado; F17 grafico; integraciones externas; cobertura maestra; texto previo sin desplegar en ORIGINAL]
```

No se declara VALIDATED, PRODUCTION_READY ni listo para entregar al cliente.
