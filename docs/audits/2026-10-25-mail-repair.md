# Reparación local del correo — 25 de octubre de 2026

## Alcance y restricciones

Correcciones locales del sistema de correo. Sin envíos reales, cambios externos,
commits, push, reconstrucción de imágenes o actualización/despliegue de la aplicación.
Las pruebas usan mocks y una base de datos desechable independiente; no utilizan
credenciales ni registros de la base operativa. No se modifican migraciones existentes.

## Incidencia 01: identidad protegida y propuesta pendiente

Se conservan los campos de identidad de Postmark de solo lectura y las validaciones
corporativas del backend. No se habilitan remitentes o destinatarios arbitrarios.
Los campos muestran los valores recibidos, sin sustituirlos por los predeterminados.

Propuesta que requiere autorización antes de implementarse:

- **Producción:** mantener `UASSpain <no-reply@uasspain.com>` y
  `info@uasspain.com` como identidad/destino corporativos. Una futura edición debe
  limitarse a una lista corporativa autorizada expresamente, comprobar el remitente
  en Postmark y exigir una prueba nueva para la combinación de identidad y credencial.
- **Pruebas:** utilizar exclusivamente fixtures/mocks aislados, direcciones
  `example.invalid` y credenciales sintéticas. No ampliar las excepciones del backend
  de producción para que pasen los tests.
- Una identidad nueva o una credencial nueva se prepararía como borrador, sin
  sustituir una configuración activa ni reutilizar su evidencia de verificación.
  Tampoco debe activar automáticamente el canal ni saltarse la aprobación de la cuenta.

La edición de identidad queda pendiente de esa autorización de negocio. Esta
reparación implementa la conservación de datos recibidos y mantiene la protección.

## Cambios realizados

### 02 — Prioridad de los valores guardados

`mergeMailApiConfig` aplica primero los valores predeterminados y después los
guardados. La vista utiliza la configuración cargada, incluidos valores heredados,
sin sobrescribirla durante la carga. El backend mantiene sus restricciones de identidad.

### 03, 04 y 05 — Verificación y disponibilidad

Se distinguen confirmación administrativa, evidencia técnica histórica válida,
vigencia de 24 horas para una nueva activación y disponibilidad del canal activo.
Una fecha futura, evidencia incompleta o identidad inválida no acredita verificación.
Desmarcar la confirmación administrativa no devuelve `VERIFIED` ni habilita una
nueva activación; tampoco elimina la evidencia técnica de un canal ya activo.

La habilitación de 2FA sobre una API ya activa utiliza la evidencia histórica válida,
la credencial conservada y el estado del circuito, sin caducar el canal al cumplir
24 horas. Una nueva activación conserva los requisitos de confirmación, prueba
reciente, credencial disponible y circuito no bloqueado. Los dos endpoints de estado
administrativo utilizan el mismo cálculo; el panel general muestra disponibilidad,
no una mera presencia de `verified_at`.

La disponibilidad no acredita recepción en un buzón: una aceptación del proveedor
continúa siendo `ACCEPTED`, no `DELIVERED`.

### 06 — Configuración SMTP y 2FA

Los cambios de metadatos inocuos conservan la evidencia de prueba y el ciphertext
de la contraseña. Host, puerto, TLS, usuario, remitente, timeout, habilitación y
credencial se comparan como parámetros de transporte. Nunca se confía en las fechas
de prueba enviadas por el cliente.

Cuando hay 2FA o un transporte SMTP configurado que debe conservarse, los cambios
importantes se guardan como borrador y credencial candidata cifrada. Se mantienen
la configuración operativa, el 2FA y las credenciales anteriores. El borrador exige
una prueba autorizada y un guardado posterior explícito para aplicarse. Su prueba
utiliza la credencial candidata y sus fallos no abren el circuito del SMTP operativo.
Una cola SMTP pendiente o en procesamiento impide aplicar cambios de conexión o
credenciales que pudieran invalidar sus mensajes. No se reescriben ni borran mensajes.

La deshabilitación incompatible con 2FA sigue prohibida. La comprobación de permisos
de reversión SMTP se repite bajo el bloqueo compartido de configuración. No se
eliminan filas del borrador o de su credencial al aplicar: se marca el borrador como
no pendiente. Se conservan auditoría, pruebas y mensajes. La interfaz distingue el
borrador del transporte operativo y solicita guardar después de la prueba.

### 07 — Pruebas API y cambios sin guardar

El botón exige configuración guardada sin diferencias locales, confirmación
administrativa persistida, secreto disponible, destinatario y autorización expresa.
Una API Key nueva o una confirmación solo local mantienen el botón bloqueado.
La selección provisional de API no activa el canal: permite preparar/verificar el
borrador mientras SMTP sigue guardado. Las pruebas UI interceptan todas las solicitudes.

### Limpieza visual

«Limpiar últimos envíos» pide confirmación y vacía exclusivamente `monitor.messages`
en memoria de React. No envía DELETE/PUT/POST ni cambia estadísticas, circuitos,
estados, colas, reintentos o auditoría. «Actualizar correo» recupera la lista.

## Restricción externa de Postmark

No se intenta resolver por código la aprobación de la cuenta. Los resultados de
17 pruebas fallidas y el circuito abierto proceden del encargo; no se repiten esas
pruebas reales ni se modifica su estado operativo.

Se conserva la clasificación diferenciada de credencial, remitente, destinatario,
aprobación, límites y comunicación, con mensajes administrativos. Se prueba mediante
mocks la recuperación del circuito y la conservación de `UNKNOWN` sin reenvío.
Con API seleccionada no se utiliza SMTP como fallback. No se declara Postmark
operativo ni la recepción real comprobada.

## Validación

Resultados finales y cierre obligatorio: `.run/mail-repair-20261025/RESULTADO.md`.
Los logs y las bases desechables de prueba no se versionan. El despliegue y la
validación de estos cambios en la aplicación Docker quedan pendientes de autorización
expresa, conforme al encargo. Una prueba del build del host no se presenta como
validación de la versión Docker.
