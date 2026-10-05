# Auditoría de concurrencia y E2E — 5 de octubre de 2026

## Alcance y método

La inspección de producción fue pasiva: ocho perfiles anonimizados (un administrador, dos instructores y cinco alumnos). Se encontraron dos sesiones recientes de instructor, un registro administrativo caducado y cinco claves de alumno sin refresh vigente. No se cambiaron contraseñas, sesiones, permisos ni datos de estos usuarios. Una clave antigua por sí sola no equivale a una sesión activa.

Las pruebas con escritura utilizan exclusivamente `uasspain-e2e`, `test_e2e_uasspain`, claves nuevas y usuarios sintéticos. Los helpers comprueban las etiquetas de proyecto y la clave de 32 bytes antes de acceder a sus fixtures. El registro y login pasan por la API real; las modificaciones SQL preparan datos sintéticos y carreras deterministas, sin fabricar cookies ni JWT.

La referencia es `acc7878`. La carga ejecuta los mismos grupos de endpoints con 8, 10, 25, 50 y 100 usuarios, cada uno con cookies y UUID de ventana propios, y sockets reales. Después de reparar RBAC se omiten tres peticiones administrativas al chat privado que antes eran aceptadas; el resto del recorrido es comparable. Las mediciones de 100 usuarios son del backend directo aislado, no una autorización para omitir los límites del edge ni una prueba de 100 usuarios detrás de una sola IP pública.

## Reparaciones

- Login, refresh y selección de rol vuelven a leer las credenciales y permisos después del bloqueo del perfil. Se evita que una petición antigua modifique una sesión nueva o acepte la contraseña/rol anterior durante una carrera.
- Argon2 se ejecuta fuera de los workers asíncronos, con un máximo de cuatro trabajos. La validación de sesión y ventana reutiliza una consulta conjunta. La cola limita CPU/memoria; el login masivo puede tardar más.
- La interfaz espera la selección de rol y reconcilia `/me/` antes de montar los recursos protegidos. Los 401 tardíos de la misma generación reutilizan el refresh ya completado.
- Los KPIs usan una agregación del ámbito autorizado completo, independiente de listas limitadas a 200/500 filas. Los gráficos de muestras indican su cobertura. Los administradores no reciben contadores de mensajes privados de alumnos.
- Una carga parcial conserva cada recurso válido. Los avisos de conexiones actualizan el contador mediante una única petición agrupada, en vez de recargar todos los recursos del panel.
- Se eliminaron arrays/props sin uso del instructor, persistencia duplicada de mensajes por WebSocket y callbacks del chat sustituidos por canales privados. No se retiraron dependencias ni índices sin evidencia.

## Medición antes/después

Milisegundos; RPS medidos en la fase de peticiones. `pg_stat_statements` se habilitó solamente en PostgreSQL E2E. Las consultas son el incremento de llamadas durante cada nivel, no el acumulado de toda la base.

| Usuarios | p50 antes → después | p95 antes → después | p99 antes → después | RPS antes → después | Consultas antes → después | WS después |
|---:|---:|---:|---:|---:|---:|---:|
| 8 | 4,24 → 4,79 | 7,49 → 12,95 | 8,98 → 16,16 | 83,81 → 82,14 | 831 → 696 | 8 |
| 10 | 4,12 → 4,34 | 6,31 → 7,86 | 7,15 → 11,44 | 112,24 → 111,47 | 1005 → 846 | 10 |
| 25 | 7,05 → 7,36 | 14,37 → 20,54 | 17,18 → 24,84 | 263,04 → 264,69 | 2310 → 1971 | 25 |
| 50 | 12,56 → 12,06 | 24,90 → 20,81 | 28,57 → 24,20 | 533,49 → 543,14 | 4485 → 3846 | 50 |
| 100 | 25,23 → 22,37 | 47,03 → 44,49 | 58,35 → 49,39 | 1135,75 → 1197,13 | 8835 → 7596 | 100 |

La repetición final a 100 usuarios produjo p50 24,28 ms, p95 51,46 ms, p99 58,41 ms y 1226,29 RPS, con las mismas 7596 consultas. No hay una mejora universal de latencia: el p95 de esa repetición superó la referencia. Login p95 pasó de 230,89 a 335,16 ms (374,40 ms en la repetición); liveness p95 pasó de 37,95 a 12,39 ms (13,59 ms en la repetición). Todas las fases de carga tuvieron cero respuestas inesperadas y cero reconexiones durante la ventana de medición.

Las muestras Docker durante la comparación a 100 usuarios fueron backend 12,56%/366,4 MiB → 24,09%/167,4 MiB; PostgreSQL 23,61%/132,8 MiB → 34,69%/125 MiB; Redis 0,27%/7,504 MiB → 0,25%/7,797 MiB. Son instantáneas, no máximos ni promedios. `EXPLAIN (ANALYZE, BUFFERS)` sobre el contador con 600 resultados usó el índice existente de asignación: última ejecución 4,776 ms, 974 bloques en caché, cero lecturas. No justifica añadir otro índice.

Un aviso real de conexión pasó de diez GET a uno (`/api/dashboard/counts/`): reducción del 90% de peticiones en ese caso. La prueba espera el socket abierto y genera el aviso mediante una escritura real.

## Evidencia de validación

- Rust: fmt, check, clippy de todos los targets/features con `-D warnings`, y 89 tests.
- Frontend: instalación reproducible, typecheck, lint, 46 tests y build; manifiesto de 151 recursos y prerender de 16 rutas públicas.
- API: 134 comprobaciones; auth: 54; SMTP controlado: 14; ámbitos de panel: 29; asignaciones: 24; backups: 72; cursos: 48. Operaciones incluyen normalización de email, expiración, idempotencia concurrente, lifecycle y 400 peticiones con concurrencia 24.
- Concurrencia: 18/18 gates, frente a 13/16 de la referencia. Las tres carreras de credenciales/rol se reproducían antes y rechazan la operación obsoleta después. Los dos gates adicionales prueban contadores exactos con 600 resultados.
- Navegador: ocho paneles autenticados, cien cambios de sección por panel, desconexión de cinco segundos y veinte peticiones con access caducado terminan con un solo refresh y sin errores. El número de sockets vuelve al nivel inicial tras la navegación.
- Ventanas: cincuenta ventanas con copia del almacenamiento generan cincuenta UUID distintos; la recarga conserva su vinculación. Son ventanas de ownership, no cincuenta sesiones autenticadas compartiendo una cookie.
- Recuperación real: PostgreSQL/Redis se detienen y arrancan únicamente en E2E; readiness degrada y se recupera. Las respuestas negativas esperadas de RBAC, expiración y caída de dependencias se contabilizan aparte de los errores inesperados.

La primera ejecución integral de navegador tuvo 102 casos correctos y un caso interrumpido por HMR al editar una página durante el test. Se repitió el caso de categorías sin cambios de código y pasó. Los grupos restantes pasaron por separado con los archivos de producto fijos: presencia, asignaciones, modales, cursos, sesiones, realtime, concurrencia y canales privados. El log del primer runner conserva su salida fallida; el cierre utiliza los resultados individuales y no atribuye un exit 0 a aquella ejecución. Las pruebas de modal se actualizaron para la política de moderación y el refresco real de 30 segundos; no convierten una respuesta simulada de éxito en evidencia de integración.

La auditoría Chromium del build de producción por HTTPS recorre 888 estados, seis anchuras (320, 390, 768, 1280, 1440 y 2560), ambos temas, rutas públicas y los tres roles. Resultado: cero desbordamientos, controles recortados, fallos de accesibilidad, errores JavaScript y warnings. Axe se ejecuta en las cinco anchuras hasta 1440; 2560 comprueba layout. Se repararon dos regiones de scroll sin acceso por teclado (Actividad del administrador y Conexiones del instructor), que originaban seis incidencias Axe. Los 18 avisos de reduced motion del primer ensayo de desarrollo se verificaron de nuevo con el bundle de producción: cero avisos, sin filtros de consola.

El auditor local utiliza el bundle de producción, la entrada `app.html` para los paneles y las cabeceras reales de seguridad. Un recorrido local de 148 estados de los tres roles pasó layout y accesibilidad, pero falló por 36 avisos de precarga. Se reprodujo la diferencia de caché con el fixture HTTPS y se igualó `Cache-Control: no-store`; la comprobación final del alumno a 320 px, ambos temas y ocho secciones pasó 16 estados con cero avisos, errores y fallos. Los resultados anteriores se conservan; no se filtra ni reclasifica la consola para producir un PASS.

SMTP externo y Google OAuth externo no se validan sin credenciales de esos servicios. Sí se validan sus respuestas controladas y el resto del recorrido real local. No se modificaron sus credenciales.

## Estado de cierre

Validación terminada. La repetición final de las cinco pruebas locales de concurrencia pasó, igual que su ejecución HTTPS; la de cincuenta ventanas utiliza el arranque real de la aplicación. El chat privado pasa 59 gates y el edge HTTPS 16. No quedan hallazgos críticos o mayores reproducidos sin reparar en el alcance local probado; SMTP y OAuth externos conservan el estado no validado indicado arriba.

Se retiraron los siete contenedores E2E, su red y los 60 volúmenes identificados por seis registros de montaje de esta auditoría, después de comprobar proyecto y ausencia de referencias. También se eliminaron once rutas temporales propias (checkouts, archivos, trace expandido y overrides). Los volúmenes anteriores, la pila principal y sus claves se conservaron. Los cinco servicios principales permanecen saludables y los cuatro healthchecks públicos responden 200 con CA y hostname verificados.

Los cambios se distribuyen en los commits `Audita y optimiza sesiones concurrentes y flujo E2E` y `Repara canales privados de chat instructor alumno`. Los controles Gitleaks de worktree, ambos índices e historial utilizan la imagen inmutable indicada en los logs; el resultado final, los SHA y la igualdad con `origin/main` se registran tras el push en `.run/concurrency-audit/result.json`. No se incluyen secretos ni artefactos temporales en los commits.

Artefactos locales ignorados: `.run/concurrency-audit/`, con métricas agregadas, logs de cada grupo y planes sin parámetros personales. Los resultados reproducibles están en `scripts/e2e/e2e-concurrent-sessions.mjs`, `frontend/e2e/concurrent-sessions.spec.ts` y el runner oficial. Para el comportamiento privado, véase [validación del chat](PRIVATE_CHAT_CONCURRENCY_VALIDATION.md).
