# Historial e inventario de copias de seguridad — 12/10/2026

Estado: IMPLEMENTED, TESTED, VALIDATED y DEPLOYED en Docker local. La aceptación ha pasado. Commit y push excluidos por la instrucción específica de esta reparación.

## Causas comprobadas

- La API de historial devolvía directamente `backups_backupjob`: historial e inventario compartían persistencia y acciones.
- La generación escribía una copia definitiva en la raíz local antes de consultar los destinos activos. Existía almacenamiento local implícito incluso con ese destino desactivado.
- SFTP comprobaba el éxito del comando de subida, sin comprobar de nuevo el contenido recibido.
- El frontend clasificaba `partial` como «Error» y afirmaba que siempre se conservaba una copia local.
- La duración entera se medía antes de transferir, perdiendo los tiempos inferiores a un segundo y el tiempo de almacenamiento.
- Las acciones admitían selección implícita de la última copia; la recuperación dependía de archivos locales y la consulta de orígenes excluía destinos desactivados.
- La copia preventiva se creaba antes de restaurar, pero su recuperación real no era un requisito previo a sustituir la base.

## Reparación

La migración nueva `0025_backup_operations_inventory.sql` conserva el catálogo existente, sus IDs, metadatos y relaciones de cadena. Añade medición en milisegundos, resultados por réplica y una tabla independiente `backups_operation`. No modifica migraciones aplicadas ni elimina copias existentes.

El historial tiene paginación, detalles y limpieza confirmada por IDs exactos. Sólo permite retirar operaciones finalizadas seleccionadas; registra la limpieza en `core_auditlog` dentro de la misma transacción. No borra archivos, inventario, dependencias, configuración ni auditoría protegida.

El inventario conserva una única identidad por backup y ofrece validación, recuperación aislada y restauración separadas. Las acciones requieren el ID exacto y comprueban que el origen pertenece a esa copia. La selección de réplica no cambia silenciosamente de destino; los ancestros de una cadena pueden utilizar otra réplica registrada y válida. Las ubicaciones y credenciales quedan en el backend. Las copias históricas sólo ofrecen almacenamiento local adicional cuando su archivo registrado está realmente presente.

La generación utiliza un directorio temporal exclusivo. Consulta los destinos persistidos activos y almacena únicamente en ellos. Cada réplica se vuelve a leer y verificar antes de declararse correcta. El staging y las descargas propias se eliminan; no hay una réplica local implícita cuando el destino está inactivo. La creación no ejecuta borrados automáticos de copias anteriores. Desactivar un destino no impide consultar sus copias históricas ni lo reactiva.

Las recuperaciones de prueba descifran y reconstruyen la cadena, restauran PostgreSQL y comprueban los archivos en espacios desechables identificados de forma exacta. Se conserva la habilitación de restauración que ya tenía esta instalación: no se cambió ese ajuste. Toda restauración exige ID, origen y confirmación `RESTAURAR`. Antes de sustituir datos exige una copia preventiva almacenada y verificada en los destinos activos, recuperación real de su base y archivos, y exclusión de operaciones concurrentes. Conserva catálogo, destinos, historial y auditoría; el rollback dispone del dump preventivo ya comprobado, sin depender de un catálogo parcialmente restaurado. No se ejecutó ninguna restauración destructiva en la instancia principal.

La migración adicional `0026_backup_recovery_diagnostics.sql` amplía el campo del resultado de recuperación a `text`, conservando sus valores. Evita que un límite de 20 caracteres oculte el error real con un segundo fallo SQL. `build.rs` declara la dependencia de Cargo sobre las migraciones para actualizar el migrador SQLx embebido también cuando se reutiliza la caché de compilación; es el mecanismo documentado por [SQLx](https://docs.rs/sqlx/latest/sqlx/macro.migrate.html).

La regresión concurrente libera la extensión de telemetría únicamente cuando esa ejecución la creó. Una extensión residual de pruebas anteriores exigía privilegios de superusuario durante el simulacro; se corrigió su propiedad y limpieza sin conceder privilegios adicionales al restaurador. La prueba de navegador identifica cada fila por el ID devuelto al crear la copia, evitando validar por error la copia anterior mientras llega la actualización automática.

## Protección de la instancia principal

Antes de la migración se creó un snapshot cifrado mediante lectura consistente de la base principal. Su restauración en un contenedor temporal sin red reprodujo exactamente 49 tablas y 489 registros. SHA-256 del archivo cifrado: `44fb4605ddcbb08efbb8b61c458f9211981650a8da4e75ff294a944c13797e4f`.

Las pruebas de escritura y restauración se ejecutan exclusivamente en `uasspain-e2e` con datos sintéticos. La instancia principal se comprueba en lectura; no se autentican usuarios reales ni se crean perfiles temporales en ella. Se preservan el volumen PostgreSQL cifrado, la clave DPAPI, los backups y los cinco servicios permanentes.

## Evidencia de cierre

- Frontend: typecheck, lint, 71 tests y build de producción comprobados.
- Backend: 125 tests, fmt, check y clippy con `-D warnings`, todos PASS.
- Regresión completa aislada: 137/137 comprobaciones de la API principal y suites adicionales de autenticación, sesiones, paneles, asignaciones, cursos, contenido, WSS, carga y caída/recuperación de dependencias, PASS.
- Backups: 75 comprobaciones API y recuperación completa más dos incrementales de base y archivos en ambos servidores externos, PASS.
- Inventario: 184 comprobaciones, repetidas sobre las imágenes finales mediante HTTPS, PASS. Incluyen las ocho combinaciones, readback, checksums, restauración PostgreSQL real, corrupción de una réplica sin invalidar otra correcta, limpieza independiente, fallos parciales y persistencia tras reinicio.
- Navegador: backups y regresión de protección de administradores, PASS. Backups comprobado en ambos temas y anchuras 320, 375, 768, 1024, 1440 y 1920; sin errores de consola ni desbordamiento del panel.
- Docker: arranque oficial con `-Build`, cinco servicios saludables, cuatro endpoints de salud HTTP 200 y WSS público operativo. Se alineó el backend con el índice OCI reconstruido; su manifiesto y binario eran iguales. La aceptación final usa exactamente los mismos IDs de imagen que la instancia principal, sobre volúmenes E2E aislados.
- Backend desplegado: SHA-256 `b01ae1f273451530a78d9e61927fdafcc2845ea76ffc6d65cc2d09b994b9a4df`; imagen `sha256:d0b9ab06110f93fb58148229f2f9bec83b6707546d664d809cee535fa25b1301`.
- Frontend desplegado: build `371b6f4e-703b-484a-826a-ba780004dcb9`; imagen `sha256:1c54d0ad1fecf59a16babad5ff545d1b1983154f78f5fd2a0b7d7d00eb742e55`.
- Conservación: 489 registros preexistentes de 49 tablas comprobados, cero modificaciones y cero eliminaciones; nueve archivos originales de backup con hashes idénticos; volúmenes persistentes sin cambios. Migraciones 25 y 26 aplicadas por el backend.
- Seguridad: cinco imágenes, dependencias Cargo/npm, árbol de trabajo e historial Git revisados; cero secretos y cero hallazgos altos o críticos. `git diff --check` y `git diff --cached --check`, PASS.
- Se retiró por nombre exacto una base vacía del simulacro E2E interrumpido, tras verificar proyecto aislado, propietario técnico y ausencia de objetos de usuario. La última aceptación verifica cero bases desechables de recuperación restantes.

Los logs, informes JSON y capturas verificables están en `.run/backup-restructure-20261012/`, fuera de Git. La instancia principal se comprobó exclusivamente en lectura para la aceptación funcional: no se usaron perfiles reales. Las escrituras de esquema se limitaron a las migraciones compatibles, precedidas del snapshot restaurado. No se atribuye la aceptación autenticada a escrituras en producción.

## Archivos afectados

Backend: Dockerfile, build.rs, migraciones 25/26, app.rs, backups.rs, backup_operations.rs y backup_artifacts.rs. Frontend: endpoints.ts, AdminBackups.tsx, BackupHistory.tsx, BackupInventory.tsx, lib/backups.ts y su test. Pruebas: backups.spec.ts, e2e-backups.mjs, e2e-backup-deltas.mjs, e2e-backup-inventory.mjs, e2e_api.py, e2e-concurrent-sessions.mjs y run-e2e.ps1. Se conserva el archivo ajeno `scripts/start-watch-hidden.vbs`.

## Cierre obligatorio

```text
CHANGE_STATUS=COMPLETE_LOCAL
CODE=PASS
TESTS=PASS
DOCKER_BUILD=PASS
DOCKER_DEPLOY=PASS
POSTGRES=HEALTHY
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5
HEALTHZ=PASS (200)
READYZ=PASS (200)
API_LIVE=PASS (200)
API_READY=PASS (200)
E2E_DOCKER=PASS (imágenes principales, datos aislados)
FUNCTIONAL_TEST=PASS
SECURITY=PASS
SECRETS_IN_GIT=0
COMMIT=NOT_RUN (prohibido por esta solicitud)
PUSH=NOT_RUN (prohibido por esta solicitud)
LOCAL_HEAD=f53a4b2c7b1a259c6dfa8b488811f711f9ca74c8
ORIGIN_MAIN=f53a4b2c7b1a259c6dfa8b488811f711f9ca74c8 (referencia local, sin fetch nuevo)
CRITICAL=0
HIGH=0
ERRORS=[]
REAL_USER_DATA_MODIFIED=0
REAL_USER_DATA_DELETED=0
EXISTING_BACKUP_FILES_PRESERVED=9/9
MAIN_TEST_WRITES=0
```
