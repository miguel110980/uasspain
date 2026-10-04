# Publicación del frontend y carga de rutas

El fallo se reprodujo en Chromium con Network y Runtime de DevTools habilitados: una pestaña ejecutando la versión anterior pedía `https://localhost/assets/Tecnologia-B1UE9uCp.js`. La nueva imagen solo contenía `Tecnologia-BIWhdFID.js`; el primero devolvía HTTP 404 y HTML. React mostraba «No se pudo cargar la aplicación». La ruta actual `/tecnologia` funcionaba en una pestaña nueva. `/tecnología` era además una ruta inexistente.

Se descartaron imports rotos en la versión actual, HTTP mixto, un `base` incorrecto y Service Workers. Las páginas y los assets se solicitan al mismo origen HTTPS, Vite usa explícitamente `base: '/'` y no hay Service Worker registrado. La configuración del API no interviene en la resolución de los módulos.

La imagen conserva el HTML y los assets de su propio build. Al arrancar, `publish-assets.sh` publica todos los archivos de `/usr/share/nginx/html/assets` en el volumen nombrado `frontend_static`, antes de iniciar Nginx. Cada archivo se publica mediante un renombrado y una URL ya existente debe tener exactamente los mismos bytes. Los archivos anteriores permanecen disponibles para las pestañas abiertas y para un rollback. En esta instalación también se incorporaron los assets de las dos imágenes anteriores disponibles.

El HTML y `version.json` usan `Cache-Control: no-store, must-revalidate`. Los assets con hash conservan la caché inmutable durante un año. Una URL de asset inexistente devuelve 404 de texto y `no-store`, sin ejecutar el documento de error ni devolver HTML con HTTP 200. Las rutas desconocidas mantienen su verdadero 404 y las páginas públicas mantienen el prerenderizado. `/tecnología` redirige con 308 a `/tecnologia`; el router también reconoce el alias al navegar dentro de la aplicación.

Cada build incorpora un identificador y publica `version.json`. Ante un error de importación, la aplicación consulta esa versión sin caché. Solo recarga automáticamente si hay una versión diferente y no lo ha intentado ya para esa versión en la sesión. La URL actual se conserva. Los errores de renderizado, la falta de conexión, la misma versión y los errores al consultar la versión no provocan recargas automáticas. El arranque asíncrono de Inicio también tiene manejo de errores. Esta recuperación complementa la conservación de assets; no la sustituye. Véase el [manejo de errores de carga documentado por Vite](https://vite.dev/guide/build#load-error-handling).

Nginx edge resuelve los upstreams mediante el DNS de Docker (`127.0.0.11`, actualización cada cinco segundos y zonas compartidas). Recrear el frontend con otra IP no obliga a reiniciar el edge. La verificación TLS de los upstreams permanece activa. Véase [`resolve` en Nginx](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#resolve).

## Actualización

```powershell
docker compose -f docker-compose.yml -f docker-compose.encrypted.yml build frontend nginx
docker compose -f docker-compose.yml -f docker-compose.encrypted.yml up -d --no-deps frontend nginx
```

Después de la primera instalación de esta configuración, basta con reconstruir y recrear `frontend` cuando no cambia el edge. Los cinco servicios existentes se mantienen; este cambio no modifica PostgreSQL, Redis, usuarios, cursos ni claves de cifrado.

El volumen almacena únicamente archivos públicos compilados. No se limpia automáticamente: borrar assets antiguos puede romper una pestaña que siga ejecutando esa versión. No usar `down -v` ni eliminar `frontend_static` durante una actualización. Supervisar su espacio con `docker system df -v`; cualquier purga requiere una política explícita de caducidad de versiones. Los assets de versiones anteriores a la instalación de este volumen solo pueden recuperarse si se conserva su imagen o artefacto.

## Verificación

El build comprueba todas las entradas del manifiesto de Vite, las referencias a imports dinámicos, CSS, assets y los enlaces del HTML prerenderizado. Un archivo o dependencia ausente impide publicar el build.

```powershell
cd frontend
npm.cmd run check
npm.cmd test
cd ..
node scripts/e2e/e2e-frontend-assets.mjs
```

La prueba de producción usa `https://localhost` y valida su certificado con `.secrets/tls/ca.crt` en las peticiones HTTP. Se puede configurar otro origen y CA mediante `FRONTEND_TEST_ORIGIN` y `FRONTEND_TEST_CA`, y guardar el informe con `FRONTEND_TEST_REPORT`. Revisa acceso directo y refresco de todas las rutas estáticas, navegación, HTTPS, MIME, caché, alias y 404 reales. Inyecta fallos únicamente dentro de dos contextos de navegador para comprobar la recuperación y la ausencia de bucles; no escribe datos ni inicia sesión con usuarios reales.

Para verificar también los chunks de paneles privados sin iniciar sesión, copiar el manifiesto de la imagen activa y pasar su ruta mediante `FRONTEND_TEST_MANIFEST`. No publicar el manifiesto como una ruta web.

Validación local del 4 de octubre de 2026: 16 pruebas unitarias, build con 69 entradas de manifiesto, 21 rutas con acceso directo y refresco, 70 recursos JS/CSS por HTTPS y las 14 páginas reales de cursos. La prueba de actualización mantuvo abiertas pestañas de dos versiones anteriores y ambas navegaron a Tecnología usando sus chunks originales. Se cambió la IP del frontend de `172.19.0.3` a `172.19.0.5`, manteniendo el mismo Nginx edge y validando su respuesta HTTPS con la CA local. Los fallos inyectados en Inicio y Tecnología se recuperaron una sola vez; los persistentes mostraron el estado de error sin bucles. PostgreSQL y Redis conservaron sus contenedores y los cinco servicios quedaron sanos.

La [revalidación posterior](FRONTEND_ASSETS_REVALIDATION.md) comprueba el frontend actualizado, Firefox real y pestañas de cuatro versiones durante un nuevo despliegue. El diagnóstico inicial descrito arriba es histórico; el fallo no reapareció en esa revalidación.
