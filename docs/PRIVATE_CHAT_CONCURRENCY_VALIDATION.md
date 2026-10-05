# Reparación de canales privados — 5 de octubre de 2026

## Modelo de acceso y persistencia

El chat STAFF comunica administradores e instructores autorizados. El canal privado usa el UUID del alumno y admite exclusivamente a ese alumno activo/verificado y a su instructor actual activo. Un administrador no puede listar, contar, leer, modificar, borrar ni abrir por WebSocket estos mensajes. No se concede una excepción administrativa implícita.

La API y WebSocket comparten la autorización y persistencia. El bloqueo del perfil seguido de una lectura actual de la asignación protege las escrituras y la moderación. El instructor puede borrar mensajes recibidos y vaciar su canal; el alumno puede borrar los propios, pero no los del instructor ni toda la conversación. Un alumno sin instructor no puede enviar y ve ese estado en la interfaz.

La reasignación publica un aviso de autorización, cierra el socket del instructor anterior y actualiza `/me/` y el nombre del instructor en el alumno. Además se revalida la sesión y el ámbito antes de procesar/reenviar eventos y durante heartbeat. La expiración, revocación o cambio de sesión nunca autoriza un nuevo mensaje por conservar un socket antiguo.

El broadcast valida todos los destinatarios y guarda filas independientes en una transacción; si uno es ajeno, no persiste ninguna. Después del commit publica un evento en cada canal privado. Los avisos globales contienen metadatos mínimos y audiencia, nunca cuerpos de mensajes privados.

## Interfaz y transporte

Cada conversación abierta mantiene su suscripción `/ws/chat/{alumnoId}/`, borrador, carga, error, scroll y estado de lectura. Un único transporte compartido sirve los avisos generales por ventana. Los eventos privados incluyen el DTO persistido completo, con ID; REST y eco propio se fusionan por ID y se ordenan por fecha e ID. No se recarga todo el historial al recibir un mensaje completo.

Las cargas iniciales, reconciliaciones y respuestas antiguas están secuenciadas. Borrados y limpieza no reaparecen por una petición anterior. Si el usuario consulta mensajes anteriores se conserva el scroll y se indica que hay mensajes nuevos. Al cerrar el componente se retira su suscripción.

Las listas utilizan resúmenes autorizados de conversaciones y contadores exactos de no leídos. Se conserva la recuperación por polling si falla el transporte, sin sustituir errores de permiso por una lista aparentemente vacía. Los errores distinguen sesión, permiso, desconexión, timeout y servidor; los logs sólo incluyen metadatos de diagnóstico y nunca cookies o contenido.

## Pruebas y comparación

El backend aislado ejercita dos instructores, veinte alumnos y cuarenta sockets privados reales, además del socket global administrativo. La referencia tuvo 18/46 gates correctos; la reparación inicial tuvo 52/52, incluidos seis gates nuevos de contadores, resúmenes y orden estable. La comprobación final tiene 59/59: incluye moderación de mensajes recibidos, denegación de modificación de mensajes del instructor por el alumno, borrado propio, IDs no duplicados y revocación mediante logout real.

La prueba de navegador usa diez conversaciones abiertas y cuatro contextos autenticados. Comprueba borradores independientes, entrega entre ambos participantes, IDs únicos, cero contenido ajeno, lectura por canal, conservación del scroll, desconexión de cinco segundos, reinicio del backend, parada/arranque de Redis y reasignación con actualización de identidad. Otra prueba comprueba el estado de un alumno sin instructor.

La comparación de UI utiliza el frontend `acc7878` y el frontend reparado con el mismo backend aislado actual: seis mensajes reales y tres contextos. Por tanto mide el cambio del frontend manteniendo la API, no dos sistemas completos históricos. La medición registra todas las peticiones API durante las entregas, además de distinguir las descargas del historial.

| Métrica (seis mensajes) | Antes | Después |
|---|---:|---:|
| Peticiones API totales | 138 | 48 |
| Peticiones API por mensaje | 23 | 8 |
| GET de historial totales | 84 | 0 |
| GET de historial por mensaje | 14 | 0 |
| POST de mensaje | 6 | 6 |
| POST de lectura | 12 | 6 |
| GET de videollamadas | 24 | 0 |
| GET de historial STAFF | 12 | 0 |
| GET de contador privado | 0 | 24 |
| GET de contador STAFF | 0 | 12 |
| Latencia DOM p50 (ms) | 145 | 88 |
| Latencia DOM p95/p99 (ms) | 160/160 | 103/103 |

Se reducen un 65,2% las peticiones totales de esta muestra y se conservan los contadores escalares y la lectura real. El p95/p99 es el máximo de sólo seis muestras, no un SLA ni una predicción de producción. El instructor mantiene un socket general más dos privados; cada alumno, uno general más uno privado. Se excluye del recuento de sockets de aplicación el transporte de HMR de Vite (`/`).

La muestra API→WS inicial fue 23,89 ms antes y 27,17 ms después. El evento anterior carecía del ID completo; son muestras individuales, no percentiles ni prueba de latencia DOM. El primer ensayo de diez habitaciones tuvo cero GET de historial por entrega y una muestra DOM de 60 ms. No se interpreta como un SLA.

## Edge y cierre

La configuración anterior agrupaba todos los WebSocket bajo diez conexiones por IP. La reproducción HTTPS alcanzó nueve sockets privados más uno general; el siguiente devolvió 429. La configuración reparada separa los sockets `/ws/chat/` (privados y STAFF) del contador general: máximo cuarenta por IP y dos por IP/sala. Conserva diez sockets generales por IP y cinco nuevos handshakes por segundo, con burst diez. Las cuotas de API, login, contacto y uploads se conservan.

La regresión del edge pasa 16/16: abre veinte salas con sus dos participantes, mantiene el socket general, deniega salas ajenas, el tercer socket de una sala, el número 41 de chat y el número 11 general. Una petición autenticada a `/api/auth/me/` por ese mismo HTTPS responde 200 con cincuenta sockets de aplicación abiertos. El helper verifica el certificado con la CA pública local y no imprime cookies.

También pasan por HTTPS las tres pruebas de chat de navegador, las cinco de concurrencia (ocho paneles/cien cambios/cincuenta ventanas), dos de sesión, una de presencia y una de chats/medios reales. El ensayo de diez salas registra 41 mensajes, diez sockets privados, cero GET de historial en la entrega observada, cero errores JavaScript y recuperación/reasignación correctas. La última muestra DOM de esa entrega fue 54 ms.

El fixture HTTPS utiliza el build de producción y el backend temporal; su fallback SPA comprueba layout y canales, no reproduce el SSI SEO del edge principal. Las validaciones públicas del edge principal y su CA se realizan aparte. La carga de cien usuarios se mide en el backend aislado; no se interpreta como permiso para cien sockets desde una misma IP pública.

Los cinco contenedores principales están actualizados y saludables. La verificación del 5 de octubre a las 20:48:48 UTC confirma el mismo volumen `uasspain-rebuild-20261003_postgres_ciphertext`, AES-256-GCM/gocryptfs, nombres cifrados, PGDATA/WAL/temp/logs cubiertos, ninguna persistencia en claro, clave tmpfs retirada, capacidades cero, volumen ilegible sin clave, rechazo de clave incorrecta y swap deshabilitado. Los cuatro healthchecks públicos responden 200 con verificación de CA/hostname.

La auditoría Chromium del build de producción por HTTPS pasa 888 estados en seis anchuras y ambos temas, incluyendo rutas públicas y los tres roles: cero fallos de layout/accesibilidad, errores JavaScript y warnings. Axe cubre las cinco anchuras hasta 1440; 2560 comprueba layout. Se corrigió el acceso por teclado a las regiones con scroll de Actividad y Conexiones. El auditor local sirve `app.html` en las rutas del panel, como Nginx, para evitar hidratar allí el HTML prerenderizado de Home; replica sus cabeceras y la política de caché del fixture. Su comprobación final de 16 estados del alumno pasa sin avisos ni filtros de consola.

Validación y limpieza terminadas. Se retiraron exclusivamente los siete contenedores, la red y los 60 volúmenes de los seis montajes E2E creados en esta auditoría, junto con once rutas temporales propias. Se conservaron los recursos anteriores y todas las claves/volúmenes principales. Los cinco contenedores principales siguen saludables, con los cuatro healthchecks públicos a 200 y TLS verificado.

El commit del chat es `Repara canales privados de chat instructor alumno`, precedido por `Audita y optimiza sesiones concurrentes y flujo E2E`. Las comprobaciones de secretos de worktree, ambos índices e historial y la verificación posterior al push de los SHA remotos quedan en `.run/concurrency-audit/`; `result.json` contiene el estado final. No se versionan estos artefactos ni secretos. SMTP y Google OAuth externos no se validaron sin credenciales. Véase también [auditoría de sesiones](CONCURRENT_SESSIONS_VALIDATION.md).
