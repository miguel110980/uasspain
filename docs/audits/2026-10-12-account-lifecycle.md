# Bajas, reactivaciones e histórico de alumnos — 12/10/2026

Estado de entrega local: `IMPLEMENTED`, `TESTED`, `VALIDATED`, `DEPLOYED`. La reparación está aplicada en Docker principal mediante el arranque oficial con `-Build`. La aceptación autenticada utiliza sus imágenes exactas con datos sintéticos aislados; la instancia principal se verifica en lectura. No se ha realizado commit, push ni despliegue remoto, conforme a la restricción expresa de esta petición. No se declara `PRODUCTION_READY` ni se cierra la validación corporativa pendiente de correo.

## Diagnóstico

Los tres paneles disponen de formularios válidos de Cuenta. Se incorpora un componente compartido de baja al final, sin sustituirlos. PostgreSQL utiliza un perfil único, roles principales/secundarios y estados activo, pendiente, bloqueado y rechazado. La baja añade el estado distinto `baja`; no se reclasifican usuarios bloqueados ni pendientes.

La autenticación valida el estado real, las sesiones independientes y su revocación en PostgreSQL. Chat, presencia y vídeo comprueban autorización también en las conexiones abiertas. Se reutilizan esos controles, la outbox de correo centralizada, el bus Redis, los modales accesibles y los estilos existentes.

Bootstrap podía volver a activar un administrador existente al reiniciar. Se impide hacerlo cuando el estado es baja. Las escrituras de estado/roles, la baja, reactivación y retirada de administradores se coordinan con un bloqueo transaccional compartido para proteger al último administrador operativo.

No existe una tabla de matrículas entre alumnos y cursos. Se añade la relación mínima, inicialmente vacía: las categorías de exámenes no se convierten en matrículas. Administración puede confirmar una asociación desde la fecha real de la operación. No se inventan cursos realizados ni fechas antiguas.

La pertenencia histórica de alumnos se conserva independientemente del rol actual. La expansión incorpora evidencias de roles presentes y actividad académica existente, preservando el alta original de la cuenta. La fecha de observación de esa evidencia se distingue de la fecha de alta. No se reconstruyen usuarios eliminados sin evidencia.

## Recuperación preventiva

Snapshot cifrado de la instancia principal con restauración aislada sin red: 54 tablas y 516 registros. Perfiles de prueba en MAIN: cero. Archivo y evidencia fuera de Git, en `.run/account-lifecycle-20261012/pre-migration-backup/`.

```text
SNAPSHOT_SHA256=a40e9ee4143fcfe09858fac73e5b486252ac8718279e46054483021097207c7c
BACKUP_RESTORE=PASS
```

La migración nueva es `0028_account_lifecycle.sql`. No modifica migraciones anteriores ni datos de perfiles existentes. Añade seis tablas y funciones de mantenimiento de la pertenencia/índice de búsqueda. La auditoría de ciclo de cuenta no admite UPDATE/DELETE con el rol de runtime.

## Implementación y seguridad

Los tres paneles reutilizan un único componente de confirmación y el mismo servicio Rust. Abrir o cancelar el modal no escribe la baja. Confirmar exige la frase exacta, la contraseña actual comprobada en backend y una sesión vigente. Los identificadores ajenos o campos manipulados se rechazan. La operación persiste la baja, la revocación y la intención de notificación de forma transaccional; controla concurrencia e idempotencia sin ejecutar una segunda baja al repetir el identificador después de reactivar.

Se revocan todas las sesiones y refresh tokens del perfil, los enlaces de recuperación anteriores y las conexiones protegidas. Chat, presencia y vídeo cierran las conexiones abiertas mediante los controles existentes. La baja no borra conversaciones, cursos, notas, exámenes, materiales ni asignaciones. La reactivación administrativa verifica el estado real, la revisión, los permisos y las restricciones de seguridad, conserva el identificador y exige una autenticación nueva. El PATCH genérico no permite eludirla. Se comprueba la sesión del actor también dentro de las operaciones administrativas coordinadas.

Administración → Gestión de Usuarios → Alumnos incorpora dos tablas independientes, contadores de PostgreSQL, detalles e historial, reactivación confirmada, búsqueda, filtros, ordenación y paginación de backend. Las lecturas y contadores se realizan en una transacción consistente. El histórico completo incluye cambios de rol sin atribuir permisos actuales de alumno. Los instructores excluyen las bajas de sus listados vigentes y pueden consultar explícitamente su histórico; las asignaciones dependientes de un instructor dado de baja se señalan sin reasignarlas.

El CSV es manual, autorizado, auditado, respeta los filtros, limita la exportación a 5.000 filas y neutraliza fórmulas. La búsqueda usa HMAC de fragmentos y comprobación final sobre datos descifrados, sin persistir nombres/emails en claro. La ordenación por nombre y las búsquedas verificadas limitan los candidatos a 10.000 y piden acotar filtros si se supera el límite. No devuelven un total incompleto como si fuese exacto.

Las notificaciones reutilizan la outbox centralizada. La intención se conserva aunque el proveedor no esté disponible; la baja permanece efectiva. El modo API exclusivo no activa SMTP como alternativa automática. Aceptación del transporte y entrega corporativa son estados diferentes.

## Migración y preservación

`0028_account_lifecycle.sql` está aplicada mediante el mecanismo del proyecto en MAIN y en E2E. Añade `account_lifecycle`, `account_lifecycle_event`, `account_notice`, `student_membership`, `student_course_registration` y `student_search_token`, con índices y mantenimiento de pertenencia/búsqueda. No elimina columnas, tablas ni registros anteriores. `account_notice` conserva intenciones; el envío sigue usando la outbox existente. Las nuevas asociaciones académicas empiezan vacías y sólo se registran mediante confirmación administrativa real.

Tras el rebuild y nuevamente tras las pruebas se compararon los identificadores y huellas de todos los registros anteriores: **54 tablas, 516 registros originales sin cambios ni borrados**, **9 archivos de backup** y **10 archivos privados** conservados. Los volúmenes persistentes mantienen su identidad, incluido `uasspain-rebuild-20261003_postgres_ciphertext`; no se regeneraron claves ni se restauró sobre MAIN. La expansión crea metadatos nuevos de pertenencia/índice, sin modificar los perfiles originales.

```text
BACKUP_RESTORE=PASS
MIGRATION_0028=PASS
MAIN_INSTANCE_TEST_PROFILES=0
MAIN_TEST_WRITES=0
MAIN_DESTRUCTIVE_RESTORES=0
REAL_USER_DATA_MODIFIED=0
REAL_USER_DATA_DELETED=0
ORIGINAL_BACKUP_FILES_PRESERVED=9
ORIGINAL_PRIVATE_FILES_PRESERVED=10
PERSISTENT_VOLUMES=UNCHANGED
```

## Pruebas ejecutadas

| Comprobación | Resultado y evidencia local |
|---|---|
| Rust fmt/check/clippy/tests | PASS; 134 tests, `rust-audit-final.log` |
| Frontend typecheck/lint/tests/build | PASS; 71 tests en 15 archivos, logs correspondientes |
| Regresión API transversal | PASS; 137/137 y los bloques adicionales de autenticación, correo, backups, paneles, exámenes, sesiones, chat, vídeo y recuperación de dependencias, `full-api-regression.log` |
| Bajas y reactivación con imágenes exactas de MAIN | PASS; 102 comprobaciones, `production-api-e2e.log` y `api-result.json` |
| Cuenta técnica esencial mediante configuración real de runtime aislado | PASS; 10 comprobaciones, `production-essential-e2e.log` y `essential-result.json` |
| Aceptación de interfaz de los tres paneles y tablas | PASS; navegador Chromium sobre Docker HTTPS, `browser-account-lifecycle.log` y JSON correspondiente |
| Responsive y temas | PASS; 320, 375, 768, 1024, 1440 y 1920 px; claro/oscuro; 36 capturas de confirmación y 12 de tablas |
| Regresión posterior a limpieza | PASS; protección de administradores, permisos sobre instructor/alumno, WSS, logout voluntario y conservación de perfiles ajenos; `post-cleanup-regression.log` y `post-cleanup-admin-protection/api-protection.json` |
| Seguridad y secretos | PASS; Gitleaks en árbol/historial y Trivy en fuentes/imágenes en ejecución, `security-final/` |

La aceptación comprueba bajas de los tres roles, cancelación sin escritura, confirmación incorrecta, peticiones manipuladas, sesión caducada/revocada, repetición de solicitudes, carrera entre administradores, protección del último administrador operativo, reinicio real del backend sin reactivar bootstrap, recuperación autorizada y denegada, aislamiento y cierre efectivo de WSS, chat y vídeo. Verifica persistencia de fechas/eventos y conservación exacta de la actividad académica creada. No se generaron preguntas.

Comprueba búsquedas Unicode y UUID parciales, paginación sin duplicados, filtros y ordenación permitidos, neutralización CSV, contadores consistentes, pertenencia histórica tras cambios de rol y asociación de curso con confirmación. Las notificaciones se verifican exclusivamente contra el sumidero cifrado aislado: ocho aceptadas; no constituye evidencia de recepción corporativa. La indisponibilidad simulada del proveedor deja la baja efectiva y la notificación pendiente, sin llamadas a proveedores externos.

La limpieza elimina sólo perfiles, relaciones, trabajos y archivos cuya pertenencia a los fixtures está comprobada mediante IDs/contenido. Residuos de perfiles y trabajos propios: cero. Los eventos protegidos de auditoría se conservan deliberadamente en E2E; no se declara que toda evidencia temporal haya desaparecido. Los recursos de fixture anteriores y los de MAIN quedan fuera de los borrados.

Los primeros intentos detectaron expectativas erróneas del runner sobre el HTTP de JSON inválido, la ruta de vídeo, el formato de recuperación y selectores de menús/cursos. Se corrigieron contra los contratos existentes y se repitieron los casos. Las evidencias fallidas se conservan con nombres explícitos; no se desactivaron comprobaciones para conseguir PASS. La captura de modales espera además a que termine la animación y comprueba fondo opaco.

## Docker y versión comprobada

Arranque oficial completado el 12/10/2026 a las 22:39 de Madrid mediante `powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build`. Cinco servicios permanentes saludables, sin incorporar otros a MAIN. Los cuatro endpoints obligatorios devuelven HTTP 200. La navegación y WSS públicos siguen operativos y los endpoints privados deniegan acceso anónimo.

```text
BACKEND_IMAGE=sha256:87dd349aa11e0917411b9d80d3b16acbc8f357846be3359ca37bd6d3e366193f
BACKEND_CONTAINER=9517fa25f3daee4f4fb1c966b3d566ac0cc36dbd9876b29c980c5da1a26478e2
BACKEND_STARTED_UTC=2026-10-12T20:39:42.622945332Z
BACKEND_BINARY_SHA256=6418719e2ce903eee3f73af6494f21f4061f5a07ae5c2a794425365d168ca3cb
FRONTEND_IMAGE=sha256:6ef09bfb81ac17612d92e7f8d8a5d4c3d4358032bab2c492da49cbacd9c73c0b
FRONTEND_CONTAINER=a873d39cef626d295148cbc3148dbc188ba25256465705cfaecef4e3aaf85c48
FRONTEND_STARTED_UTC=2026-10-12T20:39:48.312932869Z
FRONTEND_BUILD_ID=9d67a1c2-38ea-446a-bfd7-d3b769270335
```

`runtime-proof.json` acredita coincidencia de imágenes, binario y build del frontend entre MAIN y la instancia de aceptación aislada. `main-runtime.json` acredita la ruta Nginx → frontend/backend → PostgreSQL/Redis de MAIN. No se presenta la aceptación destructiva aislada como una baja realizada en la base principal.

## Rendimiento

Se midieron doce consultas paginadas en el entorno sintético: mediana aproximadamente 9,81 ms y p95 observado por rango más próximo aproximadamente 19,29 ms, conservados en `api-result.json`. La regresión general de 100 sesiones hizo 1.827 solicitudes con cero errores y p95 de 52,37 ms; es una medición de ese escenario aislado, no de producción ni del proveedor de correo. No se atribuyen mejoras antes/después sin medición comparativa. Se reutilizan pools y consultas agrupadas, con índices justificados para pertenencia, filtros y candidatos de búsqueda. No se introduce caché que mantenga permisos tras la baja.

## Archivos de esta reparación

- Backend nuevo: `backend-rust/src/account_lifecycle.rs`, `student_directory.rs` y `migrations/0028_account_lifecycle.sql`.
- Integración Rust: `app.rs`, `lib.rs`, `main.rs`, `auth.rs`, `registration.rs`, `users.rs`, `dashboard.rs` y `db.rs`.
- Interfaz compartida: `frontend/src/components/account/AccountDeactivation.tsx`; integración en `AdminCuenta.tsx`, `AlumnoCuenta.tsx` e `InstructorCuenta.tsx`.
- Gestión y autenticación frontend: `frontend/src/pages/admin/AdminStudents.tsx`, `AdminUsuarios.tsx`, `frontend/src/pages/AdminPanel.tsx`, `Home.tsx`, `frontend/src/lib/roles.ts` y `services/authService.ts`.
- Runtime: `.env.example` y `docker-compose.yml`, únicamente para exponer el nombre/configuración de UUID esenciales, sin valores secretos.
- Pruebas: `scripts/e2e/e2e-account-lifecycle.mjs`, `e2e-account-essential.mjs`, `account-essential-runtime.ps1` y `frontend/e2e/account-lifecycle.spec.ts`.
- Documentación: este informe y `docs/account-lifecycle-operations.md`.

Los cambios previos de backups y correo se preservan y no se atribuyen íntegramente a esta reparación. `scripts/start-watch-hidden.vbs` era un archivo ajeno preexistente y no se ha alterado. Las evidencias privadas permanecen fuera de Git, bajo `.run/account-lifecycle-20261012/`.

## Pendientes de empresa y producción

No hay una política de retención aprobada disponible en el proyecto. Se registra `PENDING_APPROVED_POLICY`; no se inventan plazos ni se ejecutan supresiones o anonimizaciones. Este pendiente no autoriza conservar datos indefinidamente y no bloquea una baja lógica segura. La notificación usa el canal centralizado cuando está configurado; su ausencia no revierte la baja.

Los IDs de cuentas técnicas esenciales deben configurarse explícitamente mediante `ESSENTIAL_ACCOUNT_PROFILE_IDS`. No se deduce que una cuenta personal sea técnica por su nombre o por haber sido creada mediante bootstrap.

Sigue aplazada la validación real de Postmark: falta confirmar remitente autorizado y comprobar recepción/cabeceras y Responder en el buzón corporativo. No se solicitaron tokens, modificaron DNS ni enviaron mensajes reales para esta reparación. Este pendiente del canal corporativo no desactiva la baja segura ni convierte la fase 05 de correo en PASS. La infraestructura multiplataforma/WireGuard pendiente no se ha iniciado.

## Cierre obligatorio de la reparación local

```text
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
HEALTHZ=PASS_HTTP_200
READYZ=PASS_HTTP_200
API_LIVE=PASS_HTTP_200
API_READY=PASS_HTTP_200
E2E_DOCKER=PASS_MAIN_IMAGES_ISOLATED_FIXTURES
FUNCTIONAL_TEST=PASS_WITH_SCOPE_DESCRIBED_ABOVE
SECURITY=PASS
SECRETS_IN_GIT=0
COMMIT=NOT_RUN_BY_EXPLICIT_REQUEST
PUSH=NOT_RUN_BY_EXPLICIT_REQUEST
LOCAL_HEAD=f53a4b2c7b1a259c6dfa8b488811f711f9ca74c8
ORIGIN_MAIN=f53a4b2c7b1a259c6dfa8b488811f711f9ca74c8
CRITICAL=0
HIGH=0
ERRORS=[]
CHANGE_STATUS=COMPLETE_LOCAL
PRODUCTION_READY=NOT_DECLARED
```

`ORIGIN_MAIN` es la referencia local observada; no se ejecutó fetch ni se afirma una publicación nueva en GitHub. `CRITICAL/HIGH` corresponde a los escaneos ejecutados, no a una garantía absoluta de ausencia de defectos. `git diff --check` y `git diff --cached --check` pasan; no hay cambios staged. La entrega local no autoriza commit/push posteriores ni operaciones irreversibles sobre datos reales.
