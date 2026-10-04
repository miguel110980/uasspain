# Sesión, chat y videollamada — 4 de octubre de 2026

## Diagnóstico y cambios

Se reprodujeron los fallos con la compilación de producción del frontend, HTTPS y un backend Rust con PostgreSQL aislado. No se utilizaron cuentas ni conversaciones de la instalación real.

| Problema reproducido | Corrección |
| --- | --- |
| `/auth/me/` devuelve temporalmente 503 y el panel redirige al inicio aunque la sesión siga siendo válida. | Solo una respuesta 401 invalida la sesión. Los fallos temporales muestran un mensaje con reintento y conservan la ruta. |
| Sin Web Locks ni BroadcastChannel, cada navegación cambia el identificador de ventana y el backend rechaza la cookie vinculada. | El documento saliente entrega un marcador de un solo uso al siguiente documento. Recargar conserva la identidad; copiar una pestaña activa obtiene otra identidad. Con Web Locks se espera brevemente la liberación del documento anterior. |
| Varias respuestas 401 pueden iniciar renovaciones simultáneas de la misma cookie. | La promesa compartida se asigna antes de cualquier `await`; seis peticiones concurrentes producen una única renovación. |
| Panel, chat, presencia y llamadas abren sockets independientes y alcanzan el límite de Nginx al conectar varios usuarios. | Una conexión autenticada `/ws/conexiones/` por ventana distribuye los eventos a todos los componentes. Se eliminan las suscripciones redundantes por conversación. |
| La difusión a alumnos guarda los mensajes pero no publica ningún aviso. Lectura y limpieza tampoco notifican cambios. | Rust publica avisos mínimos de actualización después de guardar, marcar como leído o limpiar. Los destinatarios recuperan mediante las API existentes únicamente los datos que pueden consultar. |
| Un socket cerrado puede necesitar una cookie renovada antes de reconectar. | Reconexión con espera progresiva, comprobación de sesión y renovación HTTP; reconciliación al volver a estar visible/en línea y consulta periódica de respaldo. |
| Una respuesta tardía puede incorporar mensajes de la conversación anterior. | Las cargas tienen un número de solicitud y los resultados del envío se aplican solo al contacto seleccionado. |
| El contador de reintentos WebRTC no se reinicia al recuperar la señalización. | Se reinicia al recibir `welcome`, permitiendo futuras reconexiones. |

Se conserva la autenticación con cookies HttpOnly, el vínculo a la ventana, los permisos, los canales separados de administración/alumnos y el cifrado existente. No hay cambios de modelos, tablas ni migraciones: las operaciones utilizan el esquema actual. Nginx conserva el límite de diez conexiones WebSocket por IP.

La CSP permite explícitamente `wss://$http_host`, limitado al mismo host. [MDN documenta que `connect-src 'self'` no cubre los esquemas WebSocket en todos los navegadores](https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src).

## Validación automatizada

La pila `uasspain-e2e` tiene su propia base `test_e2e_uasspain`, volúmenes temporales y usuarios sintéticos. El frontend se sirve desde su imagen de producción, sin Vite. La entrada HTTPS reproduce los límites de WebSocket de producción; todo el tráfico API y de señalización se dirige al backend de pruebas. Al terminar se eliminan exclusivamente los recursos de esa pila.

Para repetir las pruebas en este equipo, con Docker Desktop, Node, Chromium de Playwright y los certificados locales ya configurados:

```powershell
./scripts/e2e/run-e2e.ps1 -FrontendOnly -SecureBrowser
```

`-SkipBuild` solo debe utilizarse si `uasspain-backend:e2e-local` ya corresponde al código actual. `SecureBrowser` ejecuta los grupos `sessions`, `realtime` y `presence`; los demás grupos mantienen su configuración habitual.

Las cuatro pruebas de navegador comprueban:

1. Administrador, instructor y alumno: tres recargas consecutivas, navegación completa, renovación tras eliminar la cookie de acceso, recuperación de un 503 y conservación del identificador de ventana.
2. Navegador sin las dos API de propiedad de ventana: persistencia al recargar y rechazo de una pestaña que copia la identidad de una pestaña activa.
3. Cuatro usuarios simultáneos: envío y respuesta instructor/alumno, difusión a dos alumnos, chat administrador/instructor en ambos sentidos, aislamiento entre alumnos, lectura persistida en API/PostgreSQL, ausencia de recargas y una sola conexión de eventos por ventana. Incluye respuesta POST retrasada mientras el instructor cambia de alumno, recuperación de mensajes tras corte del socket y renovación de cookie, y limpieza reflejada en el destinatario. Entrega normal exigida en cinco segundos; tras reconexión, en ocho segundos.
4. Presencia de todos los roles, cierre de sesión, exclusión de llamadas a sí mismo, moderación según el iniciador, aislamiento REST/WebSocket de las llamadas de administración y separación respecto a las llamadas de alumnos.

La prueba de comunicación también establece llamadas instructor/dos alumnos y administrador/instructor. Comprueba recepción de bytes RTP de audio y vídeo y fotogramas decodificados para cada interlocutor; apaga/activa cámara y micrófono y provoca cuatro cortes sucesivos de señalización. En cada recuperación exige un socket nuevo, el cierre de las conexiones anteriores, dos conexiones nuevas y recepción de medios. Verifica además que colgar libera las pistas de captura y termina la sala cuando corresponde. No se limita a comprobar que se abre un diálogo.

La captura utiliza cámara y micrófono sintéticos de Chromium, con transporte WebRTC real. La prueba es local: no certifica cámaras físicas, otros motores de navegador ni conectividad TURN entre redes externas.

## Resultados y despliegue

| Comprobación | Resultado |
| --- | --- |
| `npm run check` (TypeScript, ESLint y build) | Correcto: 133 entradas del manifiesto, 16 páginas prerenderizadas. |
| `npm test` | 20 pruebas, seis archivos; todas pasan. |
| Imagen Rust de pruebas, workspace/release/all-features | 81 pruebas; todas pasan. |
| Navegador HTTPS: presencia, sesiones y comunicación | Cuatro pruebas; todas pasan. La comunicación se volvió a ejecutar con los cuatro cortes sucesivos y pasó en 29,1 segundos incluyendo inicio del runner Playwright. |
| `nginx -t`, frontend y entrada | Ambas configuraciones válidas. |
| Instalación real: certificado HTTPS, readiness, CSP y HSTS | Correctos; API y handshake WebSocket anónimos devuelven 401. |
| Instalación real: rutas y assets | 21 rutas con acceso directo/recarga y 134 recursos HTTPS correctos; también pasan recuperación de chunks, historial y prevención de bucles. |
| Instalación real: cursos existentes | Los 14 cursos conservan sus enlaces, páginas compartidas, estados, SSR y sitemap. |
| Gitleaks | Sin secretos detectados. |

Se reconstruyeron y activaron backend, frontend y Nginx usando conjuntamente `docker-compose.yml` y `docker-compose.encrypted.yml`. Los cinco servicios están saludables. Las imágenes previas de backend y frontend se conservaron con las etiquetas `realtime-rollback-20261004`.

PostgreSQL conserva el contenedor `fb10b95a9e30` y Redis `b9950191c3e1`. Los contadores anteriores y posteriores coinciden: 16 migraciones, cinco usuarios, 14 cursos, un trabajo de backup y cero destinos de backup. No se recrearon sus contenedores ni se eliminaron sus volúmenes.

Evidencia local de esta ejecución, fuera de Git: `.run/session-chat-check-final.log`, `.run/session-chat-unit-final.log`, `.run/realtime-backend-tests.log`, `.run/session-realtime-e2e-latest.log` (los tres grupos), `.run/session-realtime-e2e-final.log` (comunicación con cuatro reconexiones), `.run/realtime-live-transport.json`, `.run/realtime-assets-live.json`, `.run/realtime-courses-live.log` y `.run/realtime-gitleaks.log`.
