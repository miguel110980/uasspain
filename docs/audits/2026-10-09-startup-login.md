# Estabilización de arranque y acceso — 2026-10-09

Primera fase del orden solicitado en `README_ORDEN.md`. La validación se realizó
en esta sesión; se distinguen la instancia permanente y las pruebas aisladas.

## Causas y reparaciones

- Docker Desktop estaba detenido. PostgreSQL permanecía bloqueado porque el
  desbloqueador había terminado con `0xC000013A` y sólo tenía un trigger de login.
  La tarea conserva el usuario y los permisos limitados y añade recuperación
  periódica. Resuelve el SID del propietario antes de modificar una tarea.
- Tini no podía reenviar señales al servicio tras el cambio de UID. Se permite
  `CAP_KILL` al supervisor de PostgreSQL, Redis y frontend; los tres procesos de
  aplicación mantienen `CapEff=0`, raíz de sólo lectura y no-new-privileges.
- La llegada tardía de la configuración Google reemplazaba los campos del login
  y perdía el foco. El proveedor envuelve sólo los controles de Google, incluido
  su fallback, y conserva el formulario. Hay regresión de identidad, valores y
  foco durante la llegada de la configuración.
- Se corrigieron siete hallazgos HIGH: gosu se compila con Go 1.27.2 fijado por
  digest, se retira el binario Pebble sin uso del runtime Rust, TIFF se actualiza
  a 4.7.2-r0 y source-map-js a 1.2.2.
- Redis de E2E tiene un tag separado para que sus builds no sustituyan el tag
  de la instancia permanente.
- La precarga existente de la fotografía Hero se conserva sólo en Inicio.
  El verificador de artefactos impide publicarla en rutas que no usan la imagen.

## Evidencia de ejecución

- Frontend: typecheck, lint, 46 tests y build de producción superados.
- Rust: target audit ejecutado de nuevo, sin caché en test/audit: fmt, check,
  clippy y 89 tests superados.
- Arranque oficial con `scripts/start-encrypted-stack.ps1 -Build` completado.
  Cinco servicios permanentes saludables; los cuatro endpoints de salud
  respondieron 200 mediante TLS validado contra la CA local.
- Build frontend servido por Docker: `c65aa27b-31ab-4552-b2bb-cc8d40c81667`.
  Se cotejaron imagen en ejecución, manifiesto del tag y `/version.json`.
- Tres ciclos de parada completa y arranque oficial: 3/3. Se conservaron el
  volumen cifrado, el hash de la clave DPAPI y los ocho perfiles existentes.
  El watcher respetó la parada manual; su terminación controlada se recuperó
  mediante el trigger periódico, sin intervención manual.
- Reinicios individuales de backend, Redis, nginx y frontend, y reinicio de
  Docker Desktop: recuperación saludable y sesión conservada.
- Browser sobre `https://localhost`: login de las cuentas ficticias existentes
  de instructor y alumno, panel real, recarga, refresh, logout, rechazo del
  cookie revocado con 401, contraseña incorrecta y nuevo login. Los secretos
  DPAPI se transmitieron al runner por stdin; no se incluyeron en artefactos.
- Regresión Google/login: 10 casos superados sobre el frontend Docker, incluida
  configuración tardía y fallo del SDK. No equivale a acceso OAuth externo.
- Radar Docker: 16 estados y 80 fases de giro; círculos concéntricos, arcos
  iguales, pivote centrado y punto móvil correctos. Su código quedó preservado.
- E2E aislado: API, autenticación, permisos, backups/restauración, cursos,
  concurrencia y nueve grupos browser (123 casos) superados. El runner completo
  detectó 56 avisos por precarga fuera de Inicio y terminó con fallo en su último
  gate; se reparó la causa y se repitió la auditoría afectada.
- Auditoría UI repetida: 888 estados (444 públicos, 228 admin, 120 instructor,
  96 alumno), cero fallos, errores y avisos. Usó el bundle de producción en
  `http://127.0.0.1:8011` y API/fixtures del proyecto aislado `uasspain-e2e`.
  Los IDs, imágenes y tiempos de arranque de los cinco contenedores permanentes
  permanecieron iguales. Complementa las pruebas sobre la instancia principal.
- Seguridad final: cinco imágenes desplegadas, dependencias, directorio e
  historial Git; HIGH=0, CRITICAL=0 y secretos detectados=0. Logs desde el último
  arranque: cero ERROR/FATAL/PANIC.

Los informes locales detallados están en `.run/order-20261009/00/` (ignorados por
Git). Los cambios visuales y pruebas de canales privados que ya existían en el
working tree quedan fuera de esta fase. Las fases 01–05 requieren sus propias
ejecuciones y validaciones; este informe no las declara terminadas.
