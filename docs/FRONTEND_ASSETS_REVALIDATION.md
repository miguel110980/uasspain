# Revalidación de módulos, assets y rutas

4 de octubre de 2026, instalación Docker Desktop en `https://localhost`.

El error comunicado no se reprodujo en la instalación actual antes de modificar archivos. Chromium y Firefox cargaban Tecnología correctamente. La causa anteriormente reproducida y reparada fue una pestaña antigua que solicitaba `https://localhost/assets/Tecnologia-B1UE9uCp.js`, ausente tras reemplazar la imagen. La solución instalada conserva los assets publicados en el volumen del frontend; esa URL ahora devuelve 200 y JavaScript. Véase el [diagnóstico y la implementación](FRONTEND_ASSETS.md).

En esta revisión se añadió una regresión con Firefox real y se corrigieron cuatro esperas de la prueba de Chromium: ahora exigen el H1 de Tecnología. Inicio también contiene una sección con ese título y esperar cualquier encabezado podía dar por terminada la navegación antes de cargar el módulo. No fue necesario cambiar la lógica de carga de la aplicación ni su esquema PostgreSQL.

## Diagnóstico antes del despliegue

| Comprobación | Evidencia |
| --- | --- |
| Reproducción y DevTools | Chromium con Network y Runtime habilitados; consola, excepciones, peticiones y respuestas capturadas. No hubo error de importación ni pantalla de error. |
| Módulo y URL | `https://localhost/assets/Tecnologia-nhJeEmRl.js`, correspondiente al manifiesto de la imagen inicial: 200, `application/javascript`. |
| Existencia | El archivo está en la imagen compilada y en el volumen servido por Nginx. Los siete chunks de Tecnología disponibles inicialmente respondieron 200. |
| HTTP/HTTPS | HTML y módulos usan el mismo origen HTTPS. HTTP redirige a HTTPS. Las peticiones Node verifican el certificado con la CA local. |
| Caché | HTML y `version.json`: `no-store, must-revalidate`. Assets con hash: `immutable`. Firefox también pasó con respuestas desde caché. |
| Routing | `/tecnologia`: 200. `/tecnolog%C3%ADa`: 308 a `/tecnologia`. Navegación, acceso directo y refresco funcionan. |
| Respuesta para JS inexistente | 404, texto plano y `no-store`; no devuelve `index.html`. |
| Vite e imports | Manifiesto y dependencias verificados durante el build; todos los archivos JS/CSS declarados están disponibles. |
| Referencias anteriores | Se conservaron los chunks originales de las imágenes anteriores. No se borró el volumen de assets. |
| Service Worker | Ningún registro en los perfiles de prueba de ambos navegadores. No hay implementación de Service Worker en el proyecto. |
| `base` y variables | Vite usa `/`; se mantuvo el argumento existente `VITE_SITE_URL=https://uas-spain.com`. Las rutas de módulos no dependen de la URL del API. |
| Nginx | `nginx -t` pasa en el frontend y el edge. Assets sin fallback HTML, DNS Docker dinámico y verificación TLS entre servicios. |
| Docker | Volumen de assets montado y publicación antes de iniciar Nginx. Solo se reconstruyó/recreó el frontend; backend, edge, PostgreSQL y Redis conservaron sus contenedores. |

## Prueba de actualización real

Se mantuvieron cuatro contextos de Chromium abiertos en Inicio, sin haber solicitado el chunk de Tecnología. Para las versiones anteriores se entregó únicamente su HTML inicial desde la imagen de rollback; sus recursos se solicitaron al servidor HTTPS real. Tras reconstruir y recrear el frontend, cada pestaña navegó a Tecnología y se esperó específicamente su H1 y el final de las peticiones.

El build activo cambió de `d9926553-c12d-49cd-98ac-709ad600cd89` a `09644e39-f3ea-403d-b22b-8c981f48a1fb`. Las cuatro pestañas conservaron su documento original: una sola navegación de documento por pestaña, sin recarga automática o manual.

| Versión abierta | Chunk solicitado después del despliegue | Resultado |
| --- | --- | --- |
| Versión activa antes de reconstruir | `/assets/Tecnologia-CDiTbHT8.js` | 200, JavaScript |
| Imagen `parallel-chat-rollback-20261004` | `/assets/Tecnologia-DktOJtTj.js` | 200, JavaScript |
| Imagen `realtime-rollback-20261004` | `/assets/Tecnologia-CqtXa_Ar.js` | 200, JavaScript |
| Imagen `audit-rollback-20261004` | `/assets/Tecnologia-BkM6J0AH.js` | 200, JavaScript |

La versión final usa `/assets/Tecnologia-V9FzXBOK.js`. Los nueve chunks de Tecnología retenidos respondieron 200 tras la actualización. Las capturas de consola y red de Chromium no registraron errores de módulos ni peticiones fallidas de assets. Los cinco servicios quedaron sanos; se preservó PostgreSQL cifrado.

## Resultados y repetición

- Build: 133 entradas del manifiesto verificadas, incluidos imports dinámicos y referencias del HTML.
- Chromium: 21 rutas con acceso directo y refresco, 134 recursos JS/CSS por HTTPS, atrás/adelante, alias, 404 reales, recuperación de fallos inyectados y prevención de bucles.
- Firefox 157.0: seis comprobaciones de ruta —directo y refresco de ambas variantes, Inicio y navegación a Tecnología—; 83 respuestas de assets con 200 y MIME correcto, sin errores de módulos.
- Las 14 páginas reales de cursos pasaron enlaces, plantilla, refresco, diseño adaptable, HTML del servidor y sitemap.
- 20 pruebas unitarias pasaron, incluida la recuperación ante errores de carga.

```powershell
docker cp uasspain-frontend:/usr/share/nginx/html/.vite/manifest.json .run/assets-current-live-manifest.json
$env:FRONTEND_TEST_MANIFEST='.run/assets-current-live-manifest.json'
node scripts/e2e/e2e-frontend-assets.mjs
node scripts/e2e/e2e-frontend-firefox.mjs
```

Firefox debe estar instalado; `FIREFOX_BINARY` permite indicar su ejecutable. Ambas pruebas aceptan `FRONTEND_TEST_ORIGIN` y `FRONTEND_TEST_REPORT`. La prueba de Firefox usa un perfil temporal propio, sin credenciales ni sesiones reales, y el [endpoint WebDriver BiDi nativo documentado por Mozilla](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection). Los errores de assets y documentos se verifican por separado de las cancelaciones normales de peticiones del API al abandonar una página.

Los informes locales están en `.run/assets-current-diagnosis.json`, `.run/assets-transition-browser.json`, `.run/assets-revalidation-live.json` y `.run/assets-firefox-revalidation.json`. Estos artefactos están excluidos de Git. Esta validación cubre la instalación local disponible; no atribuye una causa nueva a una ejecución del navegador del usuario que no se ha capturado.
