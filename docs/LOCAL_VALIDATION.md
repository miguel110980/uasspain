# Validación local — 2 de octubre de 2026

La validación utiliza el entorno disponible en este equipo. La pila principal y sus datos se han conservado. Las pruebas destructivas de fixtures, restauración y caída de dependencias se ejecutan exclusivamente en `uasspain-e2e`; la comprobación de los cinco servicios con TLS utiliza `uasspain-audit`, con volúmenes independientes y puertos 8085/8445.

## Correcciones aplicadas

- Exámenes: intentos persistentes, selección sin duplicados, respuestas guardadas, reloj y autocorrección en el servidor, preguntas inmutables, prerrequisitos y envío idempotente. Los resultados usan notas numéricas compatibles con los paneles.
- Acceso: aislamiento de mensajes y registros, operaciones limitadas a alumnos asignados, revocación de sesiones y WebSockets, y reenvío OTP que conserva cuentas ya verificadas.
- Chat: salas de personal coherentes entre cliente y servidor, mensajes persistidos y actualización entre participantes sin recargar.
- Videollamadas: audio/vídeo WebRTC, salas autorizadas por el servidor, llamadas de grupo, controles de cámara/micrófono, reconexión de señalización y liberación de dispositivos. Configuración TURN opcional mediante secreto.
- Persistencia: migraciones 0005/0006 para intentos y borrado transaccional de perfiles/exámenes, conservando contenido compartido y resultados históricos cuando corresponde.
- Operación: readiness acotado, tolerancia a caída de Redis, respuestas 503 ante fallos de conexión PostgreSQL, proxy sin query strings/referer en logs y protección contra cabeceras IP suministradas por el cliente.
- Seguridad y reproducibilidad: dependencias corregidas, runtime Ubuntu 26.04 actualizado, compilaciones desde lockfiles, publicación de imágenes condicionada a CI/Security y scripts Bash normalizados a LF.

## Evidencia ejecutada

| Comprobación | Resultado |
| --- | --- |
| Rust desde cero, sin capas ni caches Cargo | Build, fmt, check y Clippy con `-D warnings`; 47 tests pasan |
| Frontend desde instalación y build limpios | Tipos, lint, build y 2 tests pasan |
| Suite API aislada | 108/108 pasan; incluye permisos, uploads, chat y backups/restauraciones locales y dos destinos SFTP |
| Navegador Chromium | 11/11 pasan: 36 secciones en escritorio/móvil, sesión, autorización, chat, cursos, exámenes y medios WebRTC de tres participantes |
| Exámenes vencidos y envíos concurrentes | Respuestas tardías rechazadas; snapshot conservado; duración del servidor; un único resultado |
| Borrado de perfiles | Instructor ajeno rechazado; sesión revocada; alumnos/contenido compartido conservados; dependencias eliminadas |
| Carga local acotada | 400 peticiones, 24 concurrentes, cero errores; p95 de 389,8 ms (límite de la prueba: 2 segundos) |
| Caída y recuperación | PostgreSQL y Redis detenidos realmente; liveness 200, readiness 503 acotado y recuperación con autenticación/persistencia |
| Pila TLS de cinco servicios | Servicios saludables; CA verificada; PostgreSQL TLS 1.3; migraciones 1–6; roles sin superusuario; Redis exige autenticación y rechaza CONFIG |
| Frontend compilado por HTTPS | Inicio y formación sin errores de ejecución, consola ni respuestas 5xx; revisión de capturas |
| Dependencias | npm audit: cero vulnerabilidades; cargo-audit pasa con la excepción documentada de RSA no activa en el árbol seleccionado |
| Imágenes backend/frontend/nginx/postgres/redis | Trivy: cero HIGH/CRITICAL, incluyendo vulnerabilidades sin parche; escaneo por archivos de imagen, sin socket Docker |
| Secretos | Gitleaks pasa en árbol e historial; detect-secrets pasa incluyendo archivos nuevos y baseline; excepciones puntuales exclusivamente para fixtures ficticios |
| Scripts y workflows | Sintaxis PowerShell/Python/Bash y actionlint pasan; 4 tests del comparador de secretos verifican reubicación, duplicados, valores nuevos y cambio de archivo |

Los logs, JSON de escaneo y capturas locales se conservan en `.run/`, excluido de Git. Los archivos de imágenes exportadas y la pila E2E se retiran al finalizar. Los comandos reproducibles de validación figuran en README y en `DEPLOYMENT.md`; la suite completa es `scripts/e2e/run-e2e.ps1`.

## Límites del alcance

Por indicación del usuario, no se validan SMTP real, Google OAuth con proveedor, TURN entre redes externas ni SFTP a través de una VPN real. El OTP de los fixtures se activa únicamente en la base aislada; la prueba no demuestra entrega de correo. La carga es una muestra local y no certifica capacidad de producción. Los dispositivos WebRTC son simulados, con intercambio real de medios en localhost.

La validación local no acredita un despliegue público ni sustituye los resultados de GitHub Actions. El cierre autorizado incluye commit y push normal a `origin/main`, sin reescritura del historial. El despliegue remoto permanece fuera del alcance.
