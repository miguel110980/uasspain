# Publicación Docker y GitHub — 13 de octubre de 2026

El usuario autorizó expresamente actualizar los contenedores, crear commits y publicar en GitHub. Esta autorización sustituye la limitación anterior de no publicar estas tareas. Los informes del 12 de octubre conservan sus resultados históricos; su `COMMIT=NOT_RUN` describe aquel cierre, no esta publicación.

## Alcance

Se publican conjuntamente los cambios ya integrados de backups e inventario, correo API/SMTP, bajas y reactivaciones, e infraestructura configurable. Comparten rutas, permisos, configuración y componentes administrativos; el primer commit incluye código, migraciones, herramientas y pruebas, y el segundo la documentación y los informes. El archivo preexistente `scripts/start-watch-hidden.vbs` queda fuera de esta entrega.

No se activan servidores externos, WireGuard, firewall, enrutamiento ni DNS. No se envían correos corporativos de prueba ni se ejecutan bajas, restauraciones o escrituras de fixtures sobre usuarios reales.

## Evidencias y límites

Las evidencias privadas de esta publicación se conservan en `.run/release-20261013/`, fuera de Git. El arranque oficial con `scripts/start-encrypted-stack.ps1 -Build` conserva el volumen PostgreSQL cifrado y las claves existentes; la versión de esquema sigue siendo 29. Las migraciones 0025–0029 se habían aplicado y validado previamente con backups cifrados y restauración aislada, documentados en los informes de cada tarea.

Las pruebas autenticadas utilizan exclusivamente el proyecto aislado `uasspain-e2e`, con las mismas imágenes ejecutadas por la instancia principal. Se comparan manifiestos, IDs, hash del binario Rust y versión del frontend. La instancia principal se verifica por HTTPS y WSS, salud y denegación de APIs privadas a usuarios anónimos, con controles de preservación de datos y archivos. No se atribuyen las escrituras E2E a la instancia principal.

Docker Desktop conserva referencias de configuración OCI que no siempre pueden utilizarse como nombres de imagen. Los helpers de conmutación de E2E resuelven ahora el índice local y comprueban que su manifiesto de plataforma coincide con el contenedor en ejecución antes de recrearlo. El cambio no permite sustituir silenciosamente la imagen bajo prueba.

La primera comparación estricta del campo `Image` falló porque Docker devolvía el digest de configuración para los contenedores anteriores y el digest de índice para los creados por referencia inmutable. Se verificó la identidad del manifiesto de plataforma de ambos, además del binario y la versión de frontend. Esta comprobación distingue referencias OCI diferentes de contenido realmente diferente; no se omitió el gate de equivalencia.

La auditoría Rust reutiliza capas verificadas porque no han cambiado sus entradas; los 140 tests, fmt, check y clippy pertenecen a esa misma fuente. Se distingue esta reutilización de una nueva ejecución de los 140 tests. Frontend y regresión Docker se ejecutan nuevamente para esta publicación.

La aceptación del proveedor de correo no equivale a entrega: remitente corporativo autorizado, recepción en buzón y destinatario real al responder siguen pendientes para producción. No se declara `PRODUCTION_READY`. La comprobación nativa de Linux, Windows Server, NAS y servidores corporativos no disponibles conserva sus estados NOT_RUN o BLOCKED_EXTERNAL.

## Resultado de publicación

El cierre verificable de pruebas, salud, seguridad y sincronización se registra aquí antes del commit documental. El SHA final publicado se entrega en la respuesta de cierre y se conserva en la evidencia privada posterior al push, evitando una referencia autorreferencial dentro del propio commit.

| Comprobación | Resultado |
|---|---|
| Reconstrucción oficial final | PASS, 2026-10-13 09:25:54 UTC; caché con entradas iguales |
| PostgreSQL, Redis, backend, frontend, Nginx | HEALTHY, 5/5 |
| `/healthz`, `/readyz`, `/api/health/live/`, `/api/health/ready/` | HTTP 200 |
| Frontend typecheck, lint y unit tests | PASS; 71 tests en 15 archivos |
| Rust audit | PASS, caché de fuente verificada; 140 tests y fmt/check/clippy |
| Regresión completa Docker | PASS; 137/137 base, autenticación, OTP, permisos, sesiones, WSS, chat, vídeo y dependencias |
| Backups | PASS; 75 API, 184 inventario, full/incremental y recuperación aislada |
| Correo interno | PASS; 34 API; entrega corporativa real NOT_RUN |
| Bajas / cuentas esenciales | PASS; 102 + 10 comprobaciones |
| Infraestructura / rollback | PASS; 50 + 12 comprobaciones |
| Navegador HTTPS | PASS; 4 escenarios, 133 capturas; responsive y ambos temas |
| Regresión tras limpieza | PASS; 40 comprobaciones, cero residuos de los perfiles propios |
| Equivalencia MAIN/E2E | PASS; manifiestos, hash Rust y build ID frontend coincidentes |
| Seguridad fuentes, historial y cinco imágenes | PASS; cero secretos, HIGH y CRITICAL |
| Revisión del índice | `git diff --cached --check` PASS |
| Backups, medios y volúmenes originales | 9 backups y 10 medios intactos; identidades conservadas |

### Actividad administrativa concurrente

La comparación estricta final contra el snapshot original detectó diferencias reales: 15 registros de `backups_operation` eliminados y dos registros operativos de correo modificados. No se declara que los 1.236 registros originales continúen todos idénticos: permanecen idénticos 1.219.

La auditoría protegida registra dos acciones `backup_history_clear` a las 09:22:29 y 09:22:34 UTC, con los 15 IDs exactos eliminados, y guardados de configuración de correo a las 09:25:50 y 09:27:20. Los accesos de Nginx corresponden a una sesión Firefox de administración de MAIN; las pruebas de navegador utilizan Chromium a través del puerto 8444 y un actor distinto en PostgreSQL aislado. La configuración de correo actualiza sus estados operativos de circuito y migración. La evidencia de comparación y correlación queda en `.run/release-20261013/` sin credenciales ni contenido personal.

No hay diferencias en cuentas, cursos, resultados, relaciones académicas o los otros registros originales. No se restauran las operaciones limpiadas ni se revierten los cambios administrativos de correo. La prueba estricta de igualdad global queda documentada como detección de actividad concurrente, resuelta por su trazabilidad; no se sustituye el snapshot ni se ocultan diferencias para obtener un cero. Esta publicación no ejecuta escrituras de prueba en MAIN.
