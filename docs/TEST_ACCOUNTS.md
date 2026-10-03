# Cuentas de prueba locales

Se mantienen cuatro cuentas solicitadas por el usuario en la instalación Docker
local. Son datos ficticios; no representan personas ni reciben correo.

| Rol | Email de acceso | Usuario | Estado |
| --- | --- | --- | --- |
| Instructor | instructor.prueba@example.invalid | instructor_prueba | Activo |
| Alumno | alumno.prueba@example.invalid | alumno_prueba | Activo |
| Alumno | alumno.prueba2@example.invalid | alumno_prueba_2 | Activo |
| Alumno | alumno.prueba3@example.invalid | alumno_prueba_3 | Activo |

Los tres alumnos están asignados al instructor de prueba. Cada cuenta tiene únicamente
su rol; ninguna tiene permisos de administrador. Las dos cuentas originales se crearon mediante el backend
autenticado como administrador y se asignaron mediante su API. El alumno se
configuró con el cambio de rol administrativo existente. No hay un seed de
arranque que las vuelva a crear o restablezca sus contraseñas. Los alumnos 2 y 3
se dieron de alta en una transacción de PostgreSQL mediante una utilidad temporal
que reutiliza FieldCipher y Argon2id del backend; sus accesos se comprobaron por
la API HTTPS y el panel real en Chromium, conservando las sesiones existentes.

Las contraseñas son aleatorias, diferentes y se almacenan en PostgreSQL con el
hasher Argon2id del backend. Los campos personales se cifran con el mecanismo
existente. La copia local necesaria para acceder se conserva exclusivamente en
`.secrets/test-accounts.dpapi`, protegida por DPAPI para el usuario Windows que
la creó y excluida de Git. Para consultarlas desde la raíz del proyecto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/show-test-accounts.ps1
```

El comando muestra las contraseñas en la consola del usuario. No copie su salida
a documentación, capturas ni commits. Si cambia una contraseña desde la
aplicación, esa copia local no se actualiza automáticamente.

El [acceso con Google](GOOGLE_AUTH.md) está restaurado y requiere configurar un
Client ID autorizado. Estas cuatro cuentas ficticias usan contraseña; sus emails
no son cuentas Google. Se conserva sin cambios la migración histórica
`0007_google_subject.sql` para mantener la compatibilidad del esquema y sus
checksums SQLx.
