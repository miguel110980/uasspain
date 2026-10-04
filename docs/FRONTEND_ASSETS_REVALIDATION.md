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

La fase Home/Docker del 4 de octubre vuelve a validar el frontend actualizado:
21 rutas con acceso directo y refresco, 151 assets HTTPS, Firefox 157 (6 rutas,
142 respuestas de assets) y navegación desde cuatro versiones sin recargar.
La prueba `e2e-home-rendering.mjs` comprueba contenido con JavaScript desactivado,
conservación del H1 original durante la hidratación, el primer clic en Acceso
mientras se descarga App, menú móvil y cambio de tema. Todos pasan sin errores.

La Home conserva el HTML de sus componentes reales, hidrata después del primer
contenido pintado y utiliza CSS para sus animaciones. Framer Motion y los avisos
se cargan cuando la ruta o el usuario los necesitan. El CSS compilado se entrega
inline y el cargador reconoce esa misma hoja para evitar aplicarla dos veces.
Los nombres de clases CSS Modules se mantienen iguales entre SSR y cliente.
Las imágenes tienen variantes WebP y dimensiones; las fuentes críticas se
subdividen preservando los originales como fallback. El favicon usa su tamaño
real, evitando dos descargas iniciales del icono completo. Se mantiene CSP.

La sesión pública anónima devuelve `200 null` con `private, no-store` solamente
en `me?optional=true` y sin credenciales. Las sesiones inválidas siguen dando 401.
Los guards de panel y de elección de rol redirigen correctamente al acceso.

Para regenerar los assets desde los originales, use
`node frontend/scripts/optimize-images.mjs` y
`python frontend/scripts/optimize-fonts.py` con fonttools 4.66.1,
brotli 1.2.0 y zopfli 0.4.3 instalados en un entorno Python propio.
Los archivos optimizados se versionan; Python no se necesita durante el build
Docker ni en ejecución.

Los cinco servicios usan raíz de solo lectura, `cap_drop: ALL`,
`no-new-privileges`, tmpfs, límites de PID/CPU/RAM y healthchecks.
Nginx edge y el backend funcionan sin root; los procesos Nginx del frontend y
Redis abandonan root después de preparar sus permisos. PostgreSQL necesita
FUSE/SYS_ADMIN para montar el sistema cifrado, pero el servidor se ejecuta con
cero capabilities. El healthcheck del edge ahora valida CA y hostname.
Las cinco imágenes ejecutadas coinciden con las construidas, incluido Redis
recreado conservando su volumen. La base conserva 5 usuarios, 5 perfiles,
14 cursos y 16 migraciones, sin cambiar el esquema.

La limpieza conserva el almacén cifrado, claves DPAPI, copias de recuperación,
assets antiguos necesarios y los informes vigentes. Dependabot se conserva
porque el repositorio contiene 13 PR suyas; la entrada Docker pasa a señalar
sus cinco Dockerfiles reales en lugar de la raíz sin Dockerfile, usando
[directories](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).
No se consultaron ejecuciones ni configuración de GitHub Actions.

Lighthouse 13.5.0 sobre `https://localhost`, móvil estándar 412×823,
simulación de red y CPU ×4, dio **100/100/100/100 en tres ejecuciones
consecutivas** después de actualizar la pila y completar los escaneos.
No se interceptaron peticiones, cambiaron categorías o desactivaron funciones
en esa medición. El baseline era 85/100/96/100.

| Ejecución | Performance | Accesibilidad | Buenas prácticas | SEO | FCP | LCP | TBT | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 100 | 100 | 100 | 100 | 1,276 s | 1,680 s | 61,5 ms | 0,002566 |
| 2 | 100 | 100 | 100 | 100 | 1,351 s | 1,651 s | 13 ms | 0,002566 |
| 3 | 100 | 100 | 100 | 100 | 1,246 s | 1,651 s | 24,5 ms | 0,002566 |

Frontend: typecheck, lint, build (149 entradas del manifiesto) y 20/20
unitarias pasan. Rust 1.99: formato, check, Clippy `-D warnings` y 82/82
tests pasan. La regresión reúne 95 casos de navegador: los 82 casos correctos
del primer grupo, el chat repetido con selector de conversación inequívoco y
los otros 12 casos de presencia, asignaciones, modales, cursos, sesión y
comunicación. La prueba de fallo temporal de sesión se actualizó para interceptar
el pathname también con `optional=true`; sesiones y comunicación se validaron
de nuevo a través del Nginx HTTPS compilado. La auditoría verifica 768 estados
de los cuatro roles, dos temas y seis anchuras, con cero errores, avisos,
fallos de disposición o de accesibilidad.

API adicional: recuperación/OTP 46 casos, permisos de panel 29, asignación 24,
backups/restauración 72 y cursos 48 pasan, además de la suite API general,
plazos, concurrencia y recuperación tras caída de PostgreSQL/Redis.
Los dispositivos de medios y el correo son fixtures aisladas; no se probó
SMTP ni Google externos porque no están configurados en la instalación.

Trivy 0.75.0 comprueba las cinco imágenes ejecutadas y los lockfiles completos
Cargo/npm, incluyendo dependencias de desarrollo: cero vulnerabilidades altas
y críticas. `npm audit` devuelve cero vulnerabilidades. Gitleaks 8.28 comprueba
árbol e historial (47 commits) con cero hallazgos; el historial incluye los
paths de secretos locales aunque estén excluidos del escaneo del árbol.
No se requiere rotación por hallazgos de Git. Herramientas de escaneo fijadas
por digest, sin modificar imágenes o datos durante la inspección.

Los informes vigentes están en `.run/home100/final/` (tres JSON/HTML originales
y resumen), `.run/home100/security/`, `.run/home100/ui-final/report.json`,
`.run/home100/hardening.json` y `.run/home100/cleanup.json`. Se repiten con
`node scripts/e2e/e2e-home-lighthouse.mjs`,
`node frontend/scripts/audit-ui.mjs` y
`powershell -NoProfile -File scripts/verify-production-security.ps1`.

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
