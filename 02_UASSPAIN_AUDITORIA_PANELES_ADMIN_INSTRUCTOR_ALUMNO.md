# UASSpain — Auditoría integral de Administrador, Instructor y Alumno

## 0. MISIÓN

Auditar, probar y reparar completamente los tres paneles reales:

```text
ADMINISTRADOR
INSTRUCTOR
ALUMNO/USUARIO
```

No revisar solo apariencia.

Validar de extremo a extremo:

```text
UI
→ API
→ backend Rust
→ PostgreSQL
→ Redis
→ WebSocket
→ permisos
→ archivos
→ estadísticas
→ chat
→ videoconferencia
→ exámenes
→ cursos
→ noticias
```

La aplicación se ejecuta mediante Docker.

Ciclo obligatorio:

```text
REPRODUCIR
→ CAUSA RAÍZ
→ REPARAR
→ BUILD
→ DOCKER UP
→ TEST
→ E2E
→ LOGS
→ REPETIR HASTA PASS
```

No aceptar falsos PASS.

## 1. REGLAS

- Trabajar sobre el proyecto real.
- No inventar rutas, tablas, endpoints, componentes o datos.
- Preservar arquitectura Rust-native existente.
- Mantener diseño/identidad visual.
- No borrar datos reales.
- No modificar los tres usuarios reales salvo necesidad funcional autorizada.
- No hardcodear estadísticas, nombres ni permisos.
- No crear datos ficticios para ocultar errores.
- No confiar en controles exclusivamente frontend.
- Toda autorización debe validarse también en backend.
- No imprimir secretos.
- No crear documentación innecesaria.
- Reparar automáticamente todos los fallos reparables.
- No detenerse después del primer fallo.
- No declarar PASS si un modal, panel, menú o formulario queda parcialmente fuera del viewport.

Estados permitidos:

```text
PASS
FAIL
BLOCKED
N/A
```

## 2. BASELINE

Antes de modificar:

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs
```

Ejecutar tests existentes frontend/backend/E2E.

Registrar:

- páginas que no cargan;
- botones rotos;
- APIs 4xx/5xx inesperados;
- errores de consola;
- datos inconsistentes;
- permisos incorrectos;
- WebSocket caído;
- imágenes rotas;
- overflow/responsive;
- modales fuera de pantalla;
- estados de carga infinitos.

## 3. IDENTIFICAR LOS 3 USUARIOS REALES

Localizar inequívocamente:

```text
ADMINISTRADOR
INSTRUCTOR
ALUMNO/USUARIO
```

Confirmar:

```text
ID
NOMBRE
EMAIL
ROL
ACTIVO
VERIFICADO
```

No mostrar contraseñas.

Separar TEST/DEMO/FIXTURE/SEED/TEMP de usuarios reales.

## 4. MATRIZ REAL DE PERMISOS

Construir automáticamente:

```text
FUNCIÓN | ADMIN | INSTRUCTOR | ALUMNO
```

Comprobar cada permiso en frontend, API, backend, DB, WebSocket, uploads y recursos privados.

Regla:

```text
OCULTAR BOTÓN != AUTORIZACIÓN
```

## 5. AISLAMIENTO DE ROLES

Validar:

```text
ADMIN → ADMIN = ALLOW
INSTRUCTOR → INSTRUCTOR = ALLOW
ALUMNO → ALUMNO = ALLOW

INSTRUCTOR → ADMIN = DENY
ALUMNO → ADMIN = DENY
ALUMNO → INSTRUCTOR = DENY
```

Probar URL manual, API directa, IDs manipulados, WebSocket, archivos y endpoints internos.

Evitar IDOR/BOLA.

## 6. DATOS REALES Y CONTADORES

Auditar todas las estadísticas.

Para cada métrica:

```text
UI
→ endpoint
→ query backend
→ DB
→ valor real
```

No hardcode, no mock.

Los valores pueden diferir por ámbito:

```text
ADMIN = global
INSTRUCTOR = asignados
ALUMNO = propios
```

Validar usuarios, activos, instructores, alumnos, cursos, matrículas, exámenes, intentos, progreso, noticias, mensajes, videollamadas y sesiones cuando existan.

## 7. NAVEGACIÓN GENERAL

Comprobar en cada panel:

- menús/submenús;
- enlaces;
- logout;
- perfil;
- deep links;
- refresh;
- rutas protegidas;
- loading;
- 404;
- error boundaries.

Todo botón visible debe hacer algo real y comprobado.

# A. PANEL ADMINISTRADOR

## 8. DASHBOARD ADMIN

Auditar tarjetas, gráficas, contadores, tablas, búsquedas, filtros, paginación, ordenación, modales, acciones rápidas, estados vacíos, errores y refresco de datos.

Comparar datos con DB real.

## 9. GESTIÓN DE USUARIOS

Validar listar, buscar, filtrar, ver detalle, crear, editar, activar, desactivar, asignar rol, asignar instructor y asignar curso.

Evitar duplicados email case-insensitive, escalada de privilegios, IDOR, mass assignment y exposición de hashes/passwords.

## 10. MODALES / FORMULARIOS — FALLO ACTUAL OBLIGATORIO

Se ha detectado visualmente un fallo real:

> El modal/formulario supera la altura de la pantalla y NO tiene scroll interno; la parte inferior queda fuera del viewport.

Debe repararse en todos los paneles, no solo en el modal concreto.

Todo modal debe:

- caber dentro del viewport;
- tener `max-height` basada en viewport real;
- tener scroll vertical interno cuando el contenido no quepa;
- mantener accesibles TODOS los campos y botones;
- no provocar scroll horizontal;
- no depender de una altura fija arbitraria;
- funcionar con poca altura de pantalla;
- funcionar con zoom;
- funcionar en móvil;
- respetar safe areas cuando aplique.

Solución equivalente:

```css
.modal {
  max-height: calc(100dvh - 2rem);
  display: flex;
  flex-direction: column;
}

.modal__body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
```

Si existe header/footer del modal:

```css
.modal__header,
.modal__footer {
  flex: 0 0 auto;
}

.modal__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
```

No aplicar simplemente `overflow: hidden` al body del modal.

Revisar:

```text
height
max-height
min-height
100vh
100dvh
overflow
position
inset
top/bottom
transform
flex
grid
min-height: auto
parent overflow
z-index
stacking context
```

Especial atención a `min-height: auto` en hijos flex.

Test obligatorio:

```text
320x568
360x640
375x667
390x844
412x915
768x600
1024x600
1366x768
1920x1080
```

y zoom 125% / 150% cuando sea viable.

Gates:

```text
MODAL_VERTICAL_OVERFLOW=PASS
MODAL_INTERNAL_SCROLL=PASS
MODAL_LAST_FIELD_ACCESSIBLE=PASS
MODAL_ACTION_BUTTONS_ACCESSIBLE=PASS
MODAL_NO_HORIZONTAL_OVERFLOW=PASS
```

## 11. REGISTRO DESDE ADMIN

Si ADMIN puede registrar usuarios, validar email, rol, campos obligatorios, duplicados, SMTP/OTP si aplica, persistencia y errores claros.

## 12. GESTIÓN DE CURSOS

Validar crear, editar, publicar, despublicar, archivar, ordenar, añadir contenido, subir imagen y cambiar imagen.

Al crear:

```text
ADMIN
→ backend
→ DB
→ API pública
→ menú Formación
→ página curso
```

Usar la plantilla existente.

## 13. CURSO NUEVO

Verificar nombre, slug, descripción, contenido, imagen, estado, orden, SEO, URL, menú, página pública, responsive y permisos.

## 14. NOTICIAS

Validar crear, editar, imagen, publicar, despublicar, fecha, contenido, slug y borrado/archivo seguro.

Comprobar DB → API → listado → detalle → home si aplica → SEO.

## 15. UPLOADS

Validar MIME real, extensión, tamaño, nombre seguro, path traversal, doble extensión, SVG si existe, almacenamiento, permisos, reemplazo, borrado y huérfanos.

## 16. CONTENIDO RICO

Proteger contra stored XSS, scripts, event handlers, `javascript:`, iframes no autorizados y URLs peligrosas.

## 17. AJUSTES

Auditar datos de contacto, correo corporativo, opciones públicas, banners, datos legales y cualquier configuración visible.

Nunca mostrar secretos completos.

# B. PANEL INSTRUCTOR

## 18. DASHBOARD INSTRUCTOR

Debe ver solo su ámbito.

Auditar alumnos asignados, cursos, exámenes, progreso, mensajes, estadísticas y videoconferencias.

## 19. ALUMNOS DEL INSTRUCTOR

Probar:

```text
alumno propio = ALLOW
alumno ajeno = DENY
ID manipulado = DENY
endpoint directo = DENY
```

## 20. CURSOS DEL INSTRUCTOR

Validar permisos de visualización, materiales, alumnos, progreso y edición solo si está permitida.

## 21. EXÁMENES

Auditar UAS A1/A3, UAS A2 y otros reales.

Validar aleatorización, preguntas, temporizador, autocorrección, puntuación, explicación de fallos, persistencia, historial y evolución.

## 22. INTEGRIDAD EXÁMENES

Probar inicio, refresh, timeout, submit, doble submit, resultado y persistencia.

No exponer respuestas correctas antes de submit.

Score definitivo en backend.

## 23. PROGRESO

Comprobar DB → backend → panel instructor → panel alumno.

## 24. CHAT

Auditar admin → instructores, instructor → alumnos/usuarios, permisos, tiempo real, reconexión, historial, scroll manual y concurrencia.

No permitir conversaciones ajenas ni spoofing de sender/recipient.

## 25. WEBSOCKET

Validar handshake, auth, room permissions, send/receive, reconnect, expiry y revocation.

Revalidar permisos en reconexión.

## 26. WEBRTC

Auditar señalización, offer/answer, ICE, STUN/TURN, DTLS/SRTP, audio, vídeo, hangup y reconnect.

## 27. TURN EXTERNO

Validar DNS, reachability, UDP/TCP, turn/turns, TLS, cert, realm, auth, TTL y relay candidate.

# C. PANEL ALUMNO

## 28. DASHBOARD ALUMNO

Mostrar solo datos propios: perfil, cursos, progreso, exámenes, resultados, mensajes, instructor y videollamada.

## 29. PERFIL

Validar edición permitida, email case-insensitive, cambio de password y backend validation.

No permitir cambiar rol/permisos/IDs.

## 30. CURSOS

Validar cursos matriculados, contenido, progreso y denegación de cursos privados no asignados.

## 31. EXÁMENES

Probar flujo completo: listado → inicio → preguntas → submit → resultado → explicaciones → historial → gráficos.

## 32. HISTORIAL

Comparar puntuaciones e intentos con DB real.

## 33. CHAT ALUMNO

Solo conversaciones autorizadas. Probar recipient/room manipulados = DENY.

## 34. VIDEOLLAMADA ALUMNO

Validar invitación, entrada, permisos cámara/micrófono, conexión, cierre, reconnect y salas ajenas denegadas.

# D. TRANSVERSAL

## 35. RESPONSIVE

Validar:

```text
320
360
375
390
412
480
768
820
1024
1280
1366
1440
1920
2560
```

y diferentes alturas.

No permitir scroll horizontal accidental, tablas imposibles, botones fuera de viewport, modales cortados, menús inaccesibles, gráficas desbordadas o formularios rotos.

## 36. MENÚS / OVERFLOW

Si no caben:

```text
scroll interno
último elemento accesible
```

Revisar max-height, overflow-y, 100dvh/svh, position, z-index, transform y stacking context.

## 37. TEMA

Validar dark/light/reload/navigation/modal/dropdown/table/form/chart.

Tema claro: sin deslumbramiento, niebla o blur global.

## 38. ACCESIBILIDAD

Auditar teclado, foco, labels, botones, tablas, modales, aria-live, contraste y zoom.

## 39. ERRORES

Manejar loading, sin datos, 403, 404, 409, 422, 500, timeout, backend/WS caídos.

Sin pantallas en blanco ni loops infinitos.

## 40. CONCURRENCIA

Probar doble click, doble submit, dos pestañas, dos sesiones y submit repetido.

## 41. API / BACKEND

Toda validación definitiva server-side.

## 42. SEGURIDAD

Revisar:

```text
IDOR/BOLA
BFLA
mass assignment
XSS
SQLi
path traversal
upload abuse
CSRF
CORS
session fixation
role escalation
WebSocket auth
```

Solo pruebas locales/autorizadas y no destructivas.

## 43. POSTGRESQL

Auditar ownership filters, índices, joins, integridad, constraints y transacciones.

## 44. REDIS

Si participa: sesión, cache, WS/pubsub y rate limits.

## 45. NGINX

Validar proxy HTTP/WS, timeouts, body size, headers y rutas.

## 46. E2E ADMIN

```text
ADMIN_LOGIN
ADMIN_DASHBOARD_REAL_DATA
ADMIN_USERS_LIST
ADMIN_USER_CREATE_OR_SAFE_TEST
ADMIN_USER_EDIT_SAFE_TEST
ADMIN_ROLE_SECURITY
ADMIN_CREATE_COURSE
ADMIN_EDIT_COURSE
ADMIN_COURSE_PUBLICATION
ADMIN_COURSE_IMAGE
ADMIN_CREATE_NEWS
ADMIN_NEWS_IMAGE
ADMIN_NEWS_PUBLICATION
ADMIN_MODAL_SCROLL
ADMIN_RESPONSIVE
```

## 47. E2E INSTRUCTOR

```text
INSTRUCTOR_LOGIN
INSTRUCTOR_DASHBOARD_SCOPE
INSTRUCTOR_ASSIGNED_STUDENTS
INSTRUCTOR_FOREIGN_STUDENT_DENIED
INSTRUCTOR_COURSES
INSTRUCTOR_EXAMS
INSTRUCTOR_CHAT
INSTRUCTOR_WEBSOCKET
INSTRUCTOR_VIDEO
INSTRUCTOR_MODAL_SCROLL
INSTRUCTOR_ADMIN_DENIED
INSTRUCTOR_RESPONSIVE
```

## 48. E2E ALUMNO

```text
USER_LOGIN
USER_DASHBOARD_SCOPE
USER_PROFILE
USER_COURSES
USER_UNAUTHORIZED_COURSE_DENIED
USER_EXAM
USER_EXAM_RESULT
USER_HISTORY
USER_CHAT
USER_VIDEO
USER_MODAL_SCROLL
USER_ADMIN_DENIED
USER_INSTRUCTOR_DENIED
USER_RESPONSIVE
```

## 49. DATOS REALES

Comparar:

```text
UI == API == DB esperado
```

en métricas y recursos principales.

## 50. LOGS

Tras todo:

```bash
docker compose logs
```

No aceptar panic, 500 inesperado, 404 funcional, SQL/Redis error, WS reconnect loop, TURN auth loop, console.error o unhandled rejection.

## 51. LIMPIEZA FINAL

Eliminar fixtures temporales, usuarios TEST creados, uploads de prueba y artefactos temporales.

No tocar usuarios/datos reales.

## 52. GATES ADMIN

```text
ADMIN_PANEL=PASS
ADMIN_DASHBOARD=PASS
ADMIN_REAL_DATA=PASS
ADMIN_USERS=PASS
ADMIN_USER_ROLES=PASS
ADMIN_COURSES=PASS
ADMIN_NEWS=PASS
ADMIN_UPLOAD_SECURITY=PASS
ADMIN_AUTHORIZATION=PASS
ADMIN_MODAL_SCROLL=PASS
ADMIN_RESPONSIVE=PASS
```

## 53. GATES INSTRUCTOR

```text
INSTRUCTOR_PANEL=PASS
INSTRUCTOR_DASHBOARD=PASS
INSTRUCTOR_REAL_DATA=PASS
INSTRUCTOR_STUDENT_SCOPE=PASS
INSTRUCTOR_COURSES=PASS
INSTRUCTOR_EXAMS=PASS
INSTRUCTOR_PROGRESS=PASS
INSTRUCTOR_CHAT=PASS
INSTRUCTOR_WEBSOCKET=PASS
INSTRUCTOR_VIDEO=PASS
INSTRUCTOR_AUTHORIZATION=PASS
INSTRUCTOR_MODAL_SCROLL=PASS
INSTRUCTOR_RESPONSIVE=PASS
```

## 54. GATES ALUMNO

```text
USER_PANEL=PASS
USER_DASHBOARD=PASS
USER_REAL_DATA=PASS
USER_PROFILE=PASS
USER_COURSES=PASS
USER_EXAMS=PASS
USER_HISTORY=PASS
USER_PROGRESS=PASS
USER_CHAT=PASS
USER_VIDEO=PASS
USER_AUTHORIZATION=PASS
USER_MODAL_SCROLL=PASS
USER_RESPONSIVE=PASS
```

## 55. GATES TRANSVERSALES

```text
ROLE_ISOLATION=PASS
IDOR_PROTECTION=PASS
API_AUTHORIZATION=PASS
WEBSOCKET_AUTHORIZATION=PASS
REAL_DATA_CONSISTENCY=PASS
NO_HARDCODED_METRICS=PASS
UPLOAD_SECURITY=PASS
MODAL_VERTICAL_OVERFLOW=PASS
MODAL_INTERNAL_SCROLL=PASS
MODAL_LAST_FIELD_ACCESSIBLE=PASS
MODAL_ACTION_BUTTONS_ACCESSIBLE=PASS
RESPONSIVE=PASS
ACCESSIBILITY=PASS
LIGHT_THEME=PASS
DARK_THEME=PASS
CONSOLE_ERRORS=0
UNEXPECTED_5XX=0
CRITICAL=0
HIGH=0
```

## 56. SALIDA FINAL

Responder únicamente:

```text
PANELS_AUDIT=PASS|FAIL|BLOCKED

REAL_USERS_FOUND=3/3

ADMIN:
EMAIL=<email>
PANEL=PASS|FAIL
REAL_DATA=PASS|FAIL
USERS=PASS|FAIL
COURSES=PASS|FAIL
NEWS=PASS|FAIL
MODAL_SCROLL=PASS|FAIL
AUTHORIZATION=PASS|FAIL

INSTRUCTOR:
EMAIL=<email>
PANEL=PASS|FAIL
REAL_DATA=PASS|FAIL
STUDENTS=PASS|FAIL
COURSES=PASS|FAIL
EXAMS=PASS|FAIL
CHAT=PASS|FAIL
VIDEO=PASS|FAIL
MODAL_SCROLL=PASS|FAIL
AUTHORIZATION=PASS|FAIL

USER:
EMAIL=<email>
PANEL=PASS|FAIL
REAL_DATA=PASS|FAIL
COURSES=PASS|FAIL
EXAMS=PASS|FAIL
PROGRESS=PASS|FAIL
CHAT=PASS|FAIL
VIDEO=PASS|FAIL
MODAL_SCROLL=PASS|FAIL
AUTHORIZATION=PASS|FAIL

ROLE_ISOLATION=PASS|FAIL
REAL_DATA_CONSISTENCY=PASS|FAIL
RESPONSIVE=PASS|FAIL
ACCESSIBILITY=PASS|FAIL

E2E_ADMIN=<pass>/<total>
E2E_INSTRUCTOR=<pass>/<total>
E2E_USER=<pass>/<total>

CRITICAL=<n>
HIGH=<n>

FIXED:
- ...

BLOCKERS:
- NONE | ...
```

No terminar mientras exista un fallo reparable.
