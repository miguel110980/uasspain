# Chat con alumnos en paralelo — 4 de octubre de 2026

El panel del instructor permite abrir varias conversaciones privadas al mismo tiempo. Seleccionar otro alumno añade su chat y mantiene los anteriores; seleccionar un chat ya abierto no lo duplica. El botón de cierre afecta exclusivamente a esa conversación. En escritorio los chats se distribuyen en columnas y en pantallas pequeñas se apilan.

Se extrajo el chat existente de `InstructorChat` a `StudentChats` y `StudentChatConversation`, dentro de los componentes de chat actuales. Cada conversación tiene su propio historial, borrador, errores, solicitudes, envío, exportación PDF y confirmación de limpieza. Un POST pendiente o fallido de un alumno no bloquea el envío a otro. Las respuestas tardías de un chat cerrado no modifican los demás.

Todos utilizan la conexión WebSocket compartida de la ventana y las API privadas existentes. Los avisos actualizan las conversaciones en paralelo. La difusión continúa creando un mensaje privado para cada destinatario. Se conservan los permisos de instructor/alumno y la separación del chat de administración.

Los chats que están ocultos o fuera del área visible reciben las actualizaciones, pero no marcan automáticamente los mensajes como leídos. Al volver a mostrarlos, se recupera el historial y se actualiza la lectura. El desplazamiento automático se limita al historial de cada conversación y no mueve toda la página.

No se necesita una migración: cada mensaje ya persiste con su `alumno_id` y `instructor_id`, y las comprobaciones de asignación se realizan en el backend. PostgreSQL y el cifrado siguen utilizando el esquema y la configuración existentes.

## Validación

Se amplió `frontend/e2e/session-realtime.spec.ts` para comprobar, mediante Chromium, la compilación de producción por HTTPS y PostgreSQL aislado:

- Dos alumnos envían a la vez y los mensajes aparecen en sus respectivos chats, sin recargar ni mezclarse.
- Los dos borradores se conservan independientemente.
- Se retiene la respuesta HTTP de un envío al primer alumno mientras el segundo recibe otro envío; después se cierra el primer chat y se libera su respuesta, sin alterar el segundo.
- Los chats se presentan juntos a 1440 × 1000 y sin desbordamiento horizontal a 390 × 844.
- Un mensaje recibido mientras está abierta Administración permanece sin leer; los borradores se conservan al volver a Alumnos.
- La limpieza de un chat deja intactos los mensajes del otro.
- Continúan funcionando difusión, chat de administración, presencia, renovación/reconexión de WebSocket y videollamadas con recepción RTP de audio/vídeo y cuatro reconexiones sucesivas.

Para repetir las pruebas en el entorno local configurado:

```powershell
./scripts/e2e/run-e2e.ps1 -FrontendOnly -SecureBrowser -BrowserScope realtime,presence
```

La base y los usuarios de prueba son independientes de la instalación real. Los medios de captura son sintéticos; no se prueba conectividad TURN entre redes externas.

## Resultado y despliegue

- `npm run check`: TypeScript, lint y build correctos; 133 entradas del manifiesto y 16 páginas prerenderizadas.
- `npm test`: 20 pruebas en seis archivos, todas correctas.
- Presencia y llamadas: la prueba existente pasa en 11,9 segundos. Comunicación en paralelo: pasa en 30,5 segundos, incluidas las cuatro reconexiones de vídeo y las comprobaciones finales de lectura y borradores.
- Revisión visual de las capturas de escritorio y móvil: dos conversaciones independientes, sin desbordamiento horizontal.
- Gitleaks: sin secretos detectados.
- Instalación real actualizada: `nginx -t` correcto, HTTPS con CA verificada, API readiness 200 y handshake WebSocket anónimo rechazado con 401. Pasan las 21 rutas, los 134 recursos HTTPS y las páginas de los 14 cursos.

Se reconstruyó y recreó únicamente el frontend, utilizando la configuración Docker cifrada existente. Los cinco servicios están saludables. Backend (`3cb6911b820a`), PostgreSQL (`fb10b95a9e30`), Redis (`b9950191c3e1`) y Nginx (`d01e270aab4c`) conservan sus contenedores. Los contadores permanecen en 16 migraciones, cinco usuarios, 14 cursos, un trabajo de backup y cero destinos de backup. Se conserva la imagen anterior del frontend con la etiqueta `parallel-chat-rollback-20261004`.

Evidencia local fuera de Git: `.run/parallel-chat-check.log`, `.run/parallel-chat-unit.log`, `.run/parallel-chat-e2e.log`, `.run/parallel-chat-e2e-final.log`, `.run/parallel-chat-desktop.png`, `.run/parallel-chat-mobile.png`, `.run/parallel-chat-assets-live.json`, `.run/parallel-chat-courses-live.log` y `.run/parallel-chat-gitleaks.log`.
