# Baja de cuentas, reactivación e histórico de alumnos

Cuenta → Dar de baja mi cuenta abre una confirmación sin modificar la cuenta. La operación exige escribir `DARME DE BAJA` y comprobar la contraseña actual sobre TLS. La cancelación conserva el estado; la baja efectiva deshabilita el acceso y revoca todas las sesiones y credenciales revocables de ese perfil.

## Estados y administradores

`baja` es un estado distinto de bloqueo, rechazo y verificación pendiente. La expansión no convierte registros anteriores ni infiere bajas antiguas. Los identificadores, roles, asignaciones y registros académicos se conservan.

No puede darse de baja el último administrador operativo: la comprobación se realiza en PostgreSQL dentro de la transacción, coordinada con modificaciones de estado/roles y retirada de administradores. Se reutiliza la definición de cuenta operativa del sistema: estado activo, usuario habilitado, identidad verificada y rol administrativo real. La restricción administrativa anterior de bloqueo/cierre forzoso de cuentas ADMIN se conserva; la baja propia es otra operación.

Las cuentas técnicas esenciales deben identificarse explícitamente por sus UUID en `ESSENTIAL_ACCOUNT_PROFILE_IDS`, en configuración de runtime. Se admiten varios IDs separados por comas. Un formato incorrecto impide ejecutar bajas; no se ignoran entradas inválidas. No se clasifican cuentas personales por su nombre o por haber sido creadas mediante bootstrap. Bootstrap no reactiva una cuenta de baja al reiniciar.

## Registro administrativo

Administración → Gestión de Usuarios → Alumnos presenta dos tablas independientes. «Alumnos activos» significa registro de alumno vigente sin baja; los estados pendiente, bloqueado y acceso suspendido se muestran por separado. «Alumnos dados de baja» conserva los datos de la baja. Los contadores y resultados proceden de consultas consistentes a PostgreSQL.

El histórico completo permite consultar alumnos que cambiaron de rol. Su pertenencia anterior no concede permisos de alumno: se conserva como evidencia, mientras la pertenencia vigente sigue los roles reales. Por ello el total histórico puede superar la suma de alumnos actualmente vigentes y dados de baja. Se conserva el alta original de la cuenta y se distingue de la fecha en que se observó evidencia de pertenencia.

Las tablas tienen búsqueda por nombre, apellidos, email e ID, filtros de fechas/curso/instructor/estado, ordenación, paginación de backend y CSV manual auditado. Los datos personales permanecen cifrados. La búsqueda utiliza índices de fragmentos con HMAC y comprobación final de coincidencia; no almacena nombres ni emails en claro. La búsqueda requiere entre 2 y 100 caracteres. Para ordenar por nombre o comprobar candidatos de búsqueda se aplica un límite de 10.000 candidatos; si se supera, el servidor pide acotar filtros en vez de devolver un resultado incompleto. La exportación está limitada a 5.000 filas y neutraliza fórmulas de hojas de cálculo.

No había una relación de matrículas en el esquema anterior. La tabla nueva empieza vacía. El administrador puede confirmar una asociación con un curso existente desde los detalles del alumno; se registra la fecha real de esa operación. Ni una categoría de examen ni la publicación de un curso acreditan una matrícula. No se reconstruyen fechas o cursos antiguos sin evidencia.

El instructor ve alumnos vigentes por defecto y puede abrir «Alumnos históricos dados de baja». Las asignaciones anteriores se conservan. La baja de un instructor produce una revisión administrativa con el número real de alumnos dependientes, sin reasignarlos automáticamente.

## Reactivación y sesiones

«Reactivar alumno» requiere confirmación y rol administrativo, comprueba la revisión del registro y rechaza cuentas sujetas a restricción de seguridad, sin verificar o sin pertenencia vigente como alumno. La API exige siempre el rol real y una sesión válida. Cambiar `status` con el PATCH genérico no reactiva cuentas de baja.

La reactivación conserva el mismo perfil y sus relaciones. No recupera sesiones ni tokens antiguos; exige una nueva autenticación. Los enlaces de recuperación anteriores a una baja no vuelven a ser válidos después de reactivar.

Para recuperación autorizada de un instructor o administrador existe la misma lógica centralizada mediante `POST /api/admin/accounts/{id}/reactivate/`, con `confirm=true` y `expected_revision` de `account_lifecycle`. No se debe usar SQL manual para eludir sus condiciones. El endpoint de alumnos añade la comprobación de pertenencia vigente. Estas acciones se prueban sólo con fixtures aislados; nunca sobre cuentas reales para validar código.

API de esta implementación:

```text
GET  /api/account/deactivation/
POST /api/account/deactivate/
GET  /api/admin/students/
GET  /api/admin/students/{id}/
GET  /api/admin/students/export/
POST /api/admin/students/{id}/reactivate/
POST /api/admin/students/{id}/courses/
POST /api/admin/accounts/{id}/reactivate/
```

Chat, vídeo y presencia vuelven a comprobar autorización en conexiones abiertas. El acceso posterior a la baja se deniega; se cierran las conexiones WSS con el mecanismo existente de comprobación periódica. Las conversaciones e históricos no se eliminan por dar de baja la cuenta.

## Notificaciones y auditoría

La transición y la intención de notificación se guardan en una transacción. El trabajador prepara después el mensaje en la outbox centralizada cuando el canal está disponible. Si falta configuración o el proveedor falla, la baja sigue efectiva, se conserva el estado y se aplica la política existente de la cola. API exclusivo no activa SMTP como fallback. La aceptación del transporte no acredita recepción en el buzón.

Los eventos incluyen ID, perfil afectado, actor, operación, resultado, UTC, contexto permitido y correlación. El rol de runtime sólo puede insertar/consultar el historial de ciclo de cuenta: no puede actualizarlo ni borrarlo. Las consultas sensibles, exportaciones, rechazos, cambios de rol y reactivaciones se registran. No se guardan contraseñas, tokens ni contenido privado de mensajes en esos eventos.

## Conservación y solicitud de supresión

No hay una política de retención aprobada aportada al proyecto. Se registra `PENDING_APPROVED_POLICY`; no se inventan plazos y no se declara conformidad legal completa a partir de pruebas técnicas. El responsable debe aprobar conservación por categoría, acceso a históricos, tratamiento de backups y obligaciones aplicables. Este pendiente no bloquea la baja lógica segura ni autoriza conservación indefinida.

La supresión es un procedimiento independiente: usar el canal de Contacto existente, verificar identidad por el procedimiento corporativo autorizado, registrar la solicitud y su responsable, revisar categorías y obligaciones y evaluar impacto en referencias, certificaciones, auditoría y backups. Una baja no equivale a una autorización de borrado. No ejecutar supresión o anonimización irreversible sin autorización específica y comprobación de impacto. No se incorpora una tarea automática de borrado.

## Migración y validación

La migración `0028_account_lifecycle.sql` es aditiva. Antes de aplicarla a la instancia principal se exige snapshot cifrado, checksum, descifrado y restauración aislada verificadas. Conservar claves DPAPI, volúmenes, datos y backups; aplicar por el arranque oficial y verificar los cinco servicios.

Las pruebas de API y navegador están en `scripts/e2e/e2e-account-lifecycle.mjs`, `scripts/e2e/e2e-account-essential.mjs` y `frontend/e2e/account-lifecycle.spec.ts`. El helper de cambio de configuración técnica se limita al proyecto sintético `uasspain-e2e`; no es una herramienta para operar producción. Las evidencias de esta ejecución se guardan en `.run/account-lifecycle-20261012/`. La aceptación principal se verifica con imágenes exactas y consultas de lectura, mientras las bajas, restablecimientos y escrituras de prueba usan datos aislados.
