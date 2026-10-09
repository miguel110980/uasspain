# Backups desde el panel de administración

El módulo reutiliza las tablas, rutas API, servicios y mecanismos de cifrado de
UASSpain. Ofrece cuatro bloques: estado, destinos, programación e historial con
restauración. Las operaciones y su autorización se comprueban en Rust.

## Uso

1. Configurar un destino desde su tarjeta. El asistente solicita nombre, tipo,
   dirección, usuario y carpeta; para almacenamiento local solicita tres pasos.
2. Guardar y pulsar **Probar conexión**. La prueba escribe, lee y elimina un
   archivo temporal. Un destino inválido permanece desactivado. Cambiar sus
   parámetros invalida la prueba y requiere probarlo otra vez.
3. Activarlo. El servidor vuelve a comprobar la conexión antes de aceptarlo.
4. Elegir frecuencia diaria, semanal o manual, hora, tipo de copia y conservación.
   Pulsar **Guardar programación**. La hora sigue `TZ` (Europe/Madrid por defecto),
   incluidos los cambios de horario. Los ajustes sin guardar sobreviven al refresco.
5. **Crear copia ahora** requiere confirmación y muestra el estado real del trabajo.
   Una réplica fallida nunca se presenta como una copia completa correcta.
6. En el historial, **Validar copia** comprueba hashes, descifrado y formato.
   **Comprobar recuperación** restaura realmente en una base temporal aislada.
   **Restaurar** requiere aceptar la sustitución de los datos y escribir RESTAURAR.

La estrategia automática crea una completa cuando no hay una base reciente y
conserva la lectura de manifiestos existentes. Las copias incrementales nuevas
usan deltas de base de datos y media; el selector de la copia inmediata es
independiente de la programación. Conserva los snapshots anteriores y el
formato de cifrado. La retención protege la última copia
válida, el último punto utilizable desde el panel y los antecesores necesarios
por las cadenas; registra sus eliminaciones.
Se mantiene el alcance existente de la limpieza del almacenamiento local; las
réplicas externas tienen que mantener también su política de conservación.

## Infraestructura y seguridad

- PostgreSQL conserva su volumen cifrado, TLS, roles y migraciones oficiales.
  Las copias de base de datos y multimedia usan el cifrado existente AES-256-GCM.
  No hay una opción para desactivar el cifrado desde la API o el panel.
- En Docker, los temporales descifrados y las pruebas de extracción de multimedia
  usan `/tmp`, montado como tmpfs. Conservar esa configuración al desplegar.
- Los destinos externos usan SFTP con autenticación por clave, comprobación
  obligatoria de identidad y conexión privada obligatoria en producción.
  La resolución DNS se comprueba frente al peer VPN y se conecta a su IP validada.
- Preparar `.secrets/backup-sftp/external_1.key`, `external_2.key` y `known_hosts`
  mediante la gestión de secretos del operador. El montaje es de solo lectura;
  el UID 10001 debe poder leer la clave con permisos aceptados por OpenSSH (0600).
  Obtener la identidad del servidor por un canal fiable. Para puertos diferentes
  de 22, la entrada de hosts verificados es `[nombre-del-servidor]:puerto`.
  El asistente no solicita ni devuelve claves privadas o sus rutas internas.
- Las rutas y peers se parametrizan en `.env.example`. Una carpeta local adicional
  debe estar montada y autorizada mediante `BACKUP_LOCAL_ALLOWED_ROOTS`; no basta
  con introducir una ruta en el panel. Los secretos permanecen fuera de Git.
- Un bloqueo PostgreSQL sobre la base de mantenimiento impide simultanear copias,
  restauraciones y limpieza. Permanece válido durante la sustitución de la base
  de la aplicación. La restauración comprueba integridad, espacio, versión del
  formato, PostgreSQL y esquema, y reaplica las migraciones oficiales cuando procede.
  Al recrear PostgreSQL conserva la propiedad del migrador y repone los permisos
  de runtime y backup; también lo hace al recuperar la copia de seguridad previa.
- Las respuestas muestran errores seguros. Se conservan los metadatos internos
  necesarios para recuperar las copias y la auditoría de usuario, fecha y resultado.

Sin credenciales, hosts verificados y conexión privada reales, los destinos
externos deben permanecer **No configurado** o desactivados.

## Migración y validación

`0016_backup_destination_validation.sql` añade fecha de configuración, fecha y
resultado de la prueba, un CHECK y un índice para el historial paginado.
No elimina destinos, trabajos ni cadenas. Añade el valor de conservación simple,
preservando políticas antiguas distintas hasta que se guarde una nueva programación.
Las migraciones ya aplicadas no se modifican.

`scripts/e2e/run-e2e.ps1` incorpora `e2e-backups.mjs` y Playwright
`frontend/e2e/backups.spec.ts`. La suite utiliza exclusivamente el proyecto Docker
`uasspain-e2e`: prueba permisos de administrador, dos servidores SFTP reales de
fixture, identidad SSH incorrecta, escritura fallida, cifrado, duplicados,
retención de cadenas, paginación y sustitución real de PostgreSQL.
PostgreSQL E2E usa los mismos cuatro roles separados sin superusuario que la
aplicación en producción. Se verifica que una nueva copia y futuras migraciones
funcionan después de restaurar, sin conceder escritura al rol de backup.
La prueba de navegador cubre asistente, programación persistida, creación,
historial, confirmación reforzada y anchos 320/768/1440 en ambos temas.
Estas pruebas no certifican servidores VPN externos que no estén configurados.

Validación local de la implementación: 81 pruebas Rust con formato, tipos y
Clippy; 9 pruebas unitarias frontend con TypeScript y ESLint; 72 comprobaciones
de backups; 134 comprobaciones de la API existente, incluidas restauraciones
locales y desde ambos destinos SFTP; dos pruebas de navegador del módulo.
Los recursos desplegados se comprobaron en ambos temas y tres tamaños, con
teclado y retorno del foco. La migración local conservó usuarios, cursos,
asignaciones, trabajos y política anterior, con PostgreSQL cifrado y TLS activo.
