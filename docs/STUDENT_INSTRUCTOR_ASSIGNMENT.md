# Asignación de instructor desde Alumnos

El panel de instructor reutiliza `AdminUsuarios`, el servicio `authService` y la relación existente `accounts_userprofile.assigned_instructor_id`. Cada alumno tiene un selector en la columna Instructor. No se añade otra relación ni una migración: PostgreSQL ya dispone de la columna, su índice y la clave foránea con `ON DELETE SET NULL`.

## API y permisos

- `GET /api/profiles/instructores/`: administrador e instructor. Solo devuelve `id`, `nombre`, `apellidos` y `username`. Los campos se descifran con el servicio existente; no se exponen email, DNI, fecha de nacimiento ni información de autenticación.
- Son asignables los perfiles con rol principal o secundario instructor, estado activo, OTP verificado y cuenta `auth_user.is_active`. Los eliminados, pendientes, bloqueados, rechazados y no verificados quedan excluidos.
- `POST /api/profiles/{instructor_id}/assign-alumnos/` recibe `student_ids` y devuelve `assigned_count` y `assigned_instructor_id` después del commit.
- El administrador puede reasignar alumnos entre instructores. Un instructor puede transferir sus propios alumnos; no puede apropiarse de alumnos de otro instructor. Se conserva la posibilidad existente de asignarse un alumno sin instructor.
- Los alumnos con roles adicionales de administrador o instructor quedan protegidos frente a transferencias desde el panel de instructor. Su asignación corresponde a administración; el endpoint admite la confirmación sin cambios de una asignación propia existente.
- Los alumnos y usuarios anónimos no pueden consultar el directorio ni realizar asignaciones. No se permite asignarse a sí mismo como instructor.
- Se conserva la regla existente que impide desasignar sin reasignar. La opción «Sin instructor asignado» indica el estado actual y no permite borrar la relación.

La transacción bloquea el instructor de destino y los alumnos en orden de UUID, valida el lote completo y solo entonces actualiza la relación. Una reasignación simultánea vuelve a comprobar la pertenencia tras adquirir el bloqueo. Se rechazan lotes vacíos, duplicados o de más de 200 alumnos.

## Interfaz

Las opciones muestran nombre y usuario para distinguir nombres repetidos. Un instructor asignado que haya dejado de ser elegible sigue visible como «no disponible», sin poder seleccionarlo de nuevo. Durante el guardado se bloquea el selector de esa fila. Un error mantiene la selección anterior y muestra el mensaje junto al control.

Después del commit se publica un evento `asignacion` por el canal de conexiones existente, sin identificadores personales. Ambos paneles refrescan su listado y sus contadores, con el polling existente como respaldo. Al transferir un alumno desaparece del ámbito del instructor anterior y aparece en el del receptor. Se mantienen búsqueda, filtros, paginación del servicio y desplazamiento horizontal de la tabla en móvil.

## Validación

- Rust: 79 pruebas; formato, `cargo check` y Clippy sin advertencias.
- Frontend: comprobación de tipos, lint y 9 pruebas unitarias.
- API y PostgreSQL reales en `uasspain-e2e`: 24 comprobaciones de asignación y 29 de permisos y multirrol. Incluyen datos mínimos, estados no asignables, atomicidad, concurrencia y recuperación de la relación desde el perfil del alumno.
- Playwright: dos instructores con nombres iguales; error de guardado, bloqueo de la fila, persistencia, actualización de ambos listados y contadores, recarga, búsqueda, filtros y anchos de 320, 768 y 1440 píxeles.

`scripts/e2e/run-e2e.ps1` integra las comprobaciones API y el test de navegador. Las pruebas utilizan cuentas temporales y una clave efímera en el proyecto Docker aislado; no modifican las asignaciones de la instalación habitual.
