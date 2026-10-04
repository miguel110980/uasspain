# Auditoría y reparación del frontend — 4 de octubre de 2026

La revisión parte de `e9fa7da` y conserva la identidad visual y los contratos del servidor. Los cambios se limitan al frontend, sus pruebas y esta documentación. Los resultados y el despliegue se registran en el cierre de esta auditoría.

## Cobertura y método

Se inspeccionaron rutas, layouts, componentes compartidos, temas, llamadas API, imports dinámicos, dependencias, fuentes, imágenes, Vite, Docker y Nginx antes de modificar el código. El inventario contiene **25 declaraciones de ruta, 59 archivos de página y 37 secciones de panel**: 19 de administrador, 10 de instructor y 8 de alumno. Una declaración dinámica representa todos los cursos; no equivale a una sola pantalla.

Se capturaron 84 estados iniciales y se inspeccionaron capturas antes de corregir los problemas. La matriz final usa el build de producción, datos sintéticos y todas las rutas públicas, cuatro cursos de las cuatro categorías, una URL inexistente larga, acceso, registro, recuperación y las 37 secciones de panel. Combina los temas claro y oscuro con anchuras de **320, 390, 768, 1280, 1440 y 2560 px**. Comprueba el desbordamiento del documento y de controles, consola, errores JavaScript y WCAG A/AA con axe en móvil y escritorio. Las pruebas de modales añaden pantallas de poca altura, scroll, teclado y ventanas equivalentes a zoom de 125 % y 150 %.

La matriz intercepta todas las API y los WebSockets; sus escrituras son respuestas sintéticas. Las pruebas funcionales utilizan exclusivamente el proyecto Docker `uasspain-e2e`, una base temporal, sus propios usuarios y recursos de recuperación. La instalación real se comprueba mediante lecturas públicas y healthchecks.

La auditoría utilizó la skill `product-design:audit`. Las capturas automatizadas complementan la inspección visual y de teclado; no constituyen por sí solas una certificación de accesibilidad ni sustituyen una prueba con lectores de pantalla.

## Hallazgos y correcciones

| Hallazgo | Causa y solución | Evidencia / validación |
| --- | --- | --- |
| El formulario de contacto quedaba cortado a 320 px aunque el documento no indicaba overflow. | El grid conservaba un tamaño mínimo implícito. Se define una columna en móvil y `min-w-0`, y se ajusta el padding en pantallas pequeñas. | [Antes](audits/frontend-2026-10-04/contact-before.png), [después](audits/frontend-2026-10-04/contact-after.png); comprobación de límites de cada control. |
| Textos secundarios, estados y selección de sidebar tenían contraste insuficiente. | Se ajustan los tokens existentes de texto y estado por tema; los avisos de alumno dejan de reducir la opacidad. Los botones destructivos utilizan su pareja de fondo/texto. | [Panel claro](audits/frontend-2026-10-04/admin-light.png), [panel oscuro](audits/frontend-2026-10-04/admin-dark.png), [material](audits/frontend-2026-10-04/student-material.png); axe en ambos temas. |
| Había campos sin etiqueta asociada y acciones solo con icono sin nombre accesible. | Se reutilizan las etiquetas y se enlazan a IDs únicos; se nombran los controles de búsqueda, filtros, paginación y acciones. El registro deja de transmitir props internas al DOM y relaciona sus errores con el campo. | Formularios de cuentas, contacto, registro, material y exámenes; modales de edición y asignación; pruebas de teclado y axe. |
| El drawer del panel no gestionaba el foco como un diálogo y podía interferir con el menú de cuenta al cambiar a escritorio. | Drawer, autenticación y modales comparten una gestión de foco que respeta el diálogo superior. El drawer cierra en el breakpoint y deja de capturar teclado cuando queda oculto. Los popovers admiten flechas y Escape. | Prueba de Tab/Shift+Tab, Escape, devolución de foco, resize y diálogos anidados. |
| Algunos textos de modal perdían contraste sobre el contenido situado detrás y una tabla de resultados no admitía scroll por teclado. | Los contenedores compartidos de modal utilizan el fondo del tema, el foco visible tiene un token legible y el historial desplazable admite foco y nombre accesible. | [Acceso móvil](audits/frontend-2026-10-04/login-mobile.png); axe en modales poblados en ambos temas y pruebas de teclado. |
| Varios fallos de carga se confundían con datos vacíos o dejaban promesas rechazadas sin tratar. | Se presenta un aviso con reintento; las pantallas con actualización conservan los últimos datos. Blog distingue carga, error y vacío. | 16 casos de fallo/recuperación en paneles y prueba de carga/error/reintento/vacío del blog. |
| Los paneles importaban inicialmente casi todas sus secciones y dependencias pesadas. | Se cargan las secciones y modales cuando se visitan. El fallback conserva la navegación y las secciones ya visitadas mantienen su estado. | Verificación del manifest completo y medición de los grafos estáticos del build. |
| El estado del instructor en el chat de alumno se calculaba a partir de las conexiones del propio alumno. | Se reutiliza `useActiveProfileSessions` con `assigned_instructor_id` y el endpoint existente de presencia, que ya admite ese rol. | Flujo de presencia y llamadas con administrador, instructor y alumno en la pila aislada. |
| Formación en el pie de página conservaba enlaces de un catálogo fijo. | Se utiliza el catálogo público y la misma clave de caché que el menú y el listado, con `coursePath` compartido. | Pruebas de creación, edición, publicación, URL estable y eliminación de cursos. |
| Dos cursos con el mismo nombre producían keys duplicadas en los enlaces. | El menú y el pie de página usan la URL del curso como key. | Dos cursos sintéticos homónimos: ambos enlaces funcionan en móvil/escritorio sin warnings. |
| La cabecera prerenderizada aparecía inicialmente sin sus estilos compartidos. | La búsqueda del manifest omitía la extensión `.tsx` y devolvía silenciosamente un preload vacío. Ahora resuelve la entrada real, incluye sus imports estáticos y CSS y falla si falta la entrada. | El build verifica las hojas iniciales de todos los módulos precargados; una copia del build con ese CSS eliminado falla como corresponde. Network y layout inicial comprobados después del despliegue. |
| Había un servicio público sin consumidores y dependencias de compilación obsoletas. | Se elimina el servicio confirmado como inaccesible, DOMPurify sin uso y la configuración PostCSS sustituida por el plugin de Vite. | Grafo de imports estáticos/dinámicos sin imports sin resolver ni módulos candidatos a código muerto. |

Se conserva la cabecera pública de tres bloques, las categorías de Formación, las plantillas de curso y las rutas existentes. Se respeta `prefers-reduced-motion` tanto en CSS como en Framer Motion. La 404 permite partir rutas largas para evitar cortes.

## Dependencias y compatibilidad

La instalación se verifica con `npm ci`. `npm audit` no encuentra vulnerabilidades de ninguna severidad en el lockfile validado.

Tailwind se migra de 3.4 a 4.3 porque la cadena anterior incluía `braces` afectado por un aviso sin versión corregida. Se utiliza `@tailwindcss/vite`, se conserva la configuración de diseño y se retira PostCSS/autoprefixer como dependencias directas innecesarias. La razón de este cambio mayor es concreta: eliminar esa dependencia vulnerable. Véanse el [aviso de GitHub](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) y la [guía oficial de migración](https://tailwindcss.com/docs/upgrade-guide).

La nueva herramienta de pruebas `@axe-core/playwright` permite comprobar contraste, etiquetas y semántica en pantallas y formularios reales. `tailwindcss-animate` se mantiene: lo utiliza la configuración de Tailwind aunque un análisis de imports de `src` no lo vea.

Se revisó `npm outdated`. Se mantienen las versiones mayores existentes de Vite, TypeScript, Framer Motion, Recharts y herramientas de lint; actualizar todas a la última versión no es necesario para resolver los hallazgos y requeriría migraciones adicionales. Recharts 2 emite un aviso de mantenimiento durante la instalación; no se oculta. El resultado de seguridad se refiere al árbol npm validado, no a una garantía sobre futuras vulnerabilidades.

Tailwind 4 requiere Chrome 111+, Safari 16.4+ y Firefox 128+ según su documentación. La ejecución de navegador de esta auditoría se realiza en Chromium. La descarga de Firefox y WebKit de Playwright agotó los tiempos de espera de los mirrors disponibles; no se declara validación en esos motores.

## Rendimiento

Medición del JavaScript sin comprimir: suma de archivos alcanzables por imports **estáticos** de cada entrada de panel, incluyendo su runtime compartido. No representa el total transferido en una sesión, el tamaño gzip ni una medición de Core Web Vitals.

| Panel | Antes (bytes) | Después (bytes) | Reducción |
| --- | ---: | ---: | ---: |
| Administrador | 1.685.554 | 578.550 | 65,68 % |
| Instructor | 1.581.414 | 987.289 | 37,57 % |
| Alumno | 1.472.142 | 987.975 | 32,89 % |

Las tres fuentes existentes son locales, variables, WOFF2 y usan `font-display: swap`; se conservan los dos preload de la cabecera y los fallbacks. Las imágenes principales mantienen los assets existentes, los ratios y la carga diferida de contenido secundario. No se eliminan recursos cuyo uso pueda depender de contenido almacenado o de referencias externas.

Después del despliegue se midieron ocho cargas nuevas en Chromium: Inicio, Formación, Tecnología y Contacto, a 390 y 1440 px. Cada una realiza una sola petición al catálogo; las tres fuentes cargan y no se detectan assets fallidos, imágenes visibles rotas ni errores JavaScript. El CLS inicial observado es 0 en siete cargas y 0,0896 en Inicio móvil; el LCP observado está entre 152 y 496 ms. Son mediciones locales sin limitación de red/CPU y con API sintética, hasta la carga inicial: no acreditan Core Web Vitals de usuarios reales ni percentiles de producción.

## Rutas y entrega web

Se mantiene la solución de assets versionados: el volumen `frontend_static` conserva los chunks de versiones anteriores; HTML y `version.json` se sirven sin caché y los assets existentes con nombre hash admiten caché inmutable. Un asset inexistente debe devolver 404 y nunca el HTML de la SPA. La recuperación de un import fallido sigue limitada a una recarga ante un cambio de versión; los errores normales permanecen visibles.

Las pruebas de entrega verifican URL directa, refresh, navegación, atrás/adelante, MIME, caché, redirección HTTPS, alias `/tecnología`, ausencia de Service Worker y fallos de import transitorios/persistentes. También se comprueban las páginas de los 14 cursos reales mediante lecturas públicas, metadatos, sitemap y estado publicado/próximamente. Véase [la documentación de assets](FRONTEND_ASSETS.md).

## Bloqueos y límites externos

La suite general del servidor detectó un fallo en `retention_keeps_last_usable_point_beside_newer_safety_dump` (`scripts/e2e/e2e-backups.mjs:108`): después de restaurar una copia y envejecer el último punto utilizable, falla la condición que exige una respuesta 200 de retención y la conservación del manifiesto completo verificado. Esa condición conjunta no permite atribuir aquí el fallo a una eliminación o a una respuesta de error. Se reprodujo exclusivamente en la base E2E; la imagen del backend coincide con la existente en producción. No se modifica la lógica de backups porque está expresamente fuera del alcance. La suite general continúa mostrando ese fallo; `-FrontendOnly` permite ejecutar los flujos web sin declarar aprobadas las pruebas del servidor.

Google OAuth y SMTP se validan como interfaz, recuperación de errores y contratos con fixtures. La instalación no dispone de credenciales externas para verificar acceso real con Google o entrega a un proveedor SMTP. La prueba de videollamada utiliza medios de navegador simulados; comprueba señalización, intercambio WebRTC y liberación de dispositivos en local, no conectividad TURN por Internet.

## Reproducir las comprobaciones

Desde `frontend`:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd audit
npm.cmd outdated
# Requiere Chromium de Playwright y el build disponible en el origen elegido.
$env:UI_AUDIT_ORIGIN = 'https://localhost'
npm.cmd run test:ui-audit
```

Desde la raíz, con Docker Desktop activo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e/run-e2e.ps1 -SkipBuild -FrontendOnly
node scripts/e2e/e2e-frontend-assets.mjs
```

`-SkipBuild` requiere que exista la imagen E2E del backend correspondiente al código actual. Sin ese parámetro, el runner prepara su pila aislada. `-FrontendOnly` conserva las reglas y los límites de acceso del servidor: los grupos se separan mediante reinicios exclusivos del backend E2E. Sin `-FrontendOnly`, se ejecutan también las comprobaciones originales del servidor, incluido el fallo de retención documentado.

Se puede repetir un grupo con `-BrowserScope`, cuyos valores son `panels`, `presence`, `assignments`, `modals` y `courses`. Por ejemplo, desde PowerShell: `& ./scripts/e2e/run-e2e.ps1 -SkipBuild -FrontendOnly -BrowserScope @('modals','courses')`. Cada grupo prepara sus datos en la pila temporal.

Para comprobar todos los JS/CSS de la imagen desplegada, copiar su manifest y pasarlo al verificador:

```powershell
docker cp uasspain-frontend:/usr/share/nginx/html/.vite/manifest.json .run/frontend-manifest-live.json
$env:FRONTEND_TEST_MANIFEST = '.run/frontend-manifest-live.json'
node scripts/e2e/e2e-frontend-assets.mjs
```

## Cierre de validación y despliegue

Comprobaciones completadas antes del commit y push:

| Comprobación | Resultado |
| --- | --- |
| Instalación, TypeScript, ESLint y build | `npm ci` y `npm run check` aprobados; ESLint sin `--quiet` también termina sin warnings ni errores. |
| Pruebas unitarias | 16 aprobadas en 4 archivos. |
| Dependencias | `npm audit`: 0 vulnerabilidades de todas las severidades; revisión de `npm outdated`. |
| Build | 134 entradas de manifest verificadas, 16 páginas públicas prerenderizadas y 13 URLs estáticas indexables. La regresión negativa de CSS omitido se detecta. |
| Matriz visual y accesibilidad | 768 estados, seis anchuras y dos temas; 0 fallos de controles/layout, errores JavaScript o warnings. Axe se ejecuta en las anchuras móvil y escritorio de cada tema. |
| Navegador funcional aislado | 92 pruebas aprobadas por grupos: 83 de paneles/acceso/errores y flujos, 1 de presencia/vídeo, 1 de asignación, 6 de modales y 1 de cursos. Los siete últimos casos se repitieron después de corregir el nombre accesible del cierre de confirmación del chat. No se presenta como una única ejecución de la suite general del servidor. |
| Entrega Docker real | 21 rutas directas/refrescadas, historial atrás/adelante y 135 assets HTTPS del manifest y navegación; MIME, caché, redirecciones, 404 y cuatro casos de recuperación de chunks aprobados. |
| Pestañas anteriores durante el despliegue | Dos pestañas con versiones previas navegan a Tecnología después de actualizar Docker; sin errores JavaScript ni assets fallidos. |
| Cursos reales, solo lectura | 14 cursos: 11 publicados y 3 próximos; tarjetas enlazadas, página común, refresh, SSR, sitemap/noindex y anchuras 320/768/1440 aprobados. |
| Secretos | Gitleaks sobre el árbol de trabajo: sin hallazgos. No se incluyen credenciales, archivos `.secrets`, `.env` ni artefactos privados de `.run`. |

Se reconstruyeron las imágenes `frontend` y `nginx` con los dos archivos Compose de la instalación cifrada y se aplicó `up -d --no-deps --wait frontend nginx`. El frontend se recreó; Nginx ya utilizaba la imagen resultante y se mantuvo. Ambos `nginx -t` pasan y los cinco servicios están sanos. Se conserva la imagen anterior como `uasspain-frontend:audit-rollback-20261004` y el volumen de chunks antiguos.

Se verificó que PostgreSQL, Redis y backend conservan sus IDs de contenedor. Los contadores reales siguen en 16 migraciones, 5 usuarios, 14 cursos, 1 trabajo de backup y 0 destinos de backup. La auditoría no inicia sesión ni ejecuta escrituras en esa instalación.

| Flujo | Estado de la validación |
| --- | --- |
| Web pública y Formación | Navegación, páginas, tarjetas, estilos y entrega comprobados; cursos reales comprobados por lectura. |
| Acceso, registro, recuperación y OTP | Flujos de interfaz y contratos aprobados en la pila aislada. |
| Administrador | 19 secciones revisadas; formularios, modales, errores y flujos funcionales web aprobados. |
| Instructor | 10 secciones revisadas; alumnos, asignación, exámenes, material, resultados, chat y vídeo comprobados en E2E. |
| Alumno | 8 secciones revisadas; examen, resultados, material, chat, vídeo y cuenta comprobados en E2E. |
| Backups | Interfaz, copia/restauración por la aplicación y errores comprobados; el gate de retención del servidor permanece como bloqueo externo. |
| Proveedores y motores externos | OAuth/SMTP con fixtures y WebRTC local; Firefox/WebKit pendientes por descarga no disponible. Límites descritos arriba. |

## Inventario extraído del código

### Rutas declaradas

- `/`
- `/nosotros`
- `/tecnologia`
- `/tecnología`
- `/blog`
- `/contacto`
- `/servicios`
- `/politica-privacidad`
- `/aviso-legal`
- `/politica-cookies`
- `/servicios/seguridad`
- `/servicios/emergencias`
- `/servicios/audiovisuales`
- `/servicios/radiofonista`
- `/servicios/fumigacion`
- `/servicios/inspeccion`
- `/servicios/termografia`
- `/formacion`
- `/formacion/*`
- `/elegir-panel`
- `/restablecer-contrasena`
- `/admin`
- `/instructor`
- `/alumno`
- `*`

### AdminPanel

- Dashboard (`dashboard`)
- Actividad en tiempo real (`actividad`)
- Estadísticas (`estadisticas`)
- Conexiones en vivo (`conexiones-rt`)
- Registro de Conexiones (`registro-conexiones`)
- Seguridad (`seguridad`)
- Auditoría (`auditoria`)
- Chat (`chat`)
- Videollamada (`video`)
- Gestión de Usuarios (`usuarios`)
- Instructores (`instructores`)
- Blog / Publicaciones (`blog`)
- Formación / Cursos (`cursos`)
- Monitorización (`monitorizacion`)
- Notificaciones (`notificaciones`)
- Backups (`backups`)
- VPN (`vpn`)
- Configuración (`configuracion`)
- Mi cuenta (`cuenta`)

### InstructorPanel

- Dashboard (`dashboard`)
- Alumnos (`usuarios`)
- Exámenes (`examenes`)
- Material (`material`)
- Resultados (`resultados`)
- Estadísticas (`estadisticas`)
- Chat (`chat`)
- Videollamada (`video`)
- Conexiones activas (`conexiones`)
- Cuenta (`cuenta`)

### AlumnoPanel

- Dashboard (`dashboard`)
- Exámenes (`examenes`)
- Resultados (`resultados`)
- Material (`material`)
- Evolución (`evolucion`)
- Chat (`chat`)
- Videollamada (`video`)
- Mi cuenta (`cuenta`)

### Archivos de página

- `frontend/src/pages/admin/AdminActividad.tsx`
- `frontend/src/pages/admin/AdminAuditoria.tsx`
- `frontend/src/pages/admin/AdminBackups.tsx`
- `frontend/src/pages/admin/AdminBlog.tsx`
- `frontend/src/pages/admin/AdminChat.tsx`
- `frontend/src/pages/admin/AdminConexiones.tsx`
- `frontend/src/pages/admin/AdminConexionesTiempoReal.tsx`
- `frontend/src/pages/admin/AdminConfiguracion.tsx`
- `frontend/src/pages/admin/AdminCursos.tsx`
- `frontend/src/pages/admin/AdminDashboard.tsx`
- `frontend/src/pages/admin/AdminEstadisticas.tsx`
- `frontend/src/pages/admin/AdminInstructores.tsx`
- `frontend/src/pages/admin/AdminMonitorizacion.tsx`
- `frontend/src/pages/admin/AdminNotificaciones.tsx`
- `frontend/src/pages/admin/AdminSeguridad.tsx`
- `frontend/src/pages/admin/AdminUsuarios.tsx`
- `frontend/src/pages/admin/AdminVpn.tsx`
- `frontend/src/pages/AdminPanel.tsx`
- `frontend/src/pages/alumno/AlumnoChat.tsx`
- `frontend/src/pages/alumno/AlumnoCuenta.tsx`
- `frontend/src/pages/alumno/AlumnoDashboard.tsx`
- `frontend/src/pages/alumno/AlumnoEvolucion.tsx`
- `frontend/src/pages/alumno/AlumnoExamenes.tsx`
- `frontend/src/pages/alumno/AlumnoMaterial.tsx`
- `frontend/src/pages/alumno/AlumnoResultados.tsx`
- `frontend/src/pages/alumno/ExamenActivo.tsx`
- `frontend/src/pages/AlumnoPanel.tsx`
- `frontend/src/pages/AvisoLegal.tsx`
- `frontend/src/pages/Blog.tsx`
- `frontend/src/pages/Contacto.tsx`
- `frontend/src/pages/CursoDinamico.tsx`
- `frontend/src/pages/Formacion.tsx`
- `frontend/src/pages/Home.tsx`
- `frontend/src/pages/instructor/BloqueoExamenesModal.tsx`
- `frontend/src/pages/instructor/InstructorAccesos.tsx`
- `frontend/src/pages/instructor/InstructorChat.tsx`
- `frontend/src/pages/instructor/InstructorConexiones.tsx`
- `frontend/src/pages/instructor/InstructorCuenta.tsx`
- `frontend/src/pages/instructor/InstructorDashboard.tsx`
- `frontend/src/pages/instructor/InstructorEstadisticas.tsx`
- `frontend/src/pages/instructor/InstructorExamenes.tsx`
- `frontend/src/pages/instructor/InstructorMaterial.tsx`
- `frontend/src/pages/instructor/InstructorResultados.tsx`
- `frontend/src/pages/instructor/NuevoInstructorForm.tsx`
- `frontend/src/pages/instructor/ResultadosAlumnoModal.tsx`
- `frontend/src/pages/InstructorPanel.tsx`
- `frontend/src/pages/Nosotros.tsx`
- `frontend/src/pages/PanelChoice.tsx`
- `frontend/src/pages/PoliticaCookies.tsx`
- `frontend/src/pages/PoliticaPrivacidad.tsx`
- `frontend/src/pages/RestablecerContrasena.tsx`
- `frontend/src/pages/servicios/Audiovisuales.tsx`
- `frontend/src/pages/servicios/Emergencias.tsx`
- `frontend/src/pages/servicios/Fumigacion.tsx`
- `frontend/src/pages/servicios/Inspeccion.tsx`
- `frontend/src/pages/servicios/Radiofonista.tsx`
- `frontend/src/pages/servicios/Seguridad.tsx`
- `frontend/src/pages/servicios/Termografia.tsx`
- `frontend/src/pages/Tecnologia.tsx`
