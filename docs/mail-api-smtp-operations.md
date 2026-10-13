# Correo API / SMTP: preparación y operación

UASSpain utiliza la outbox cifrada de PostgreSQL y un trabajador dentro del backend Rust existente. Se conservan los cinco servicios permanentes. Registro, OTP, recuperación, invitaciones, notificaciones y Contacto comparten el transporte centralizado.

## Configuración y activación

En Administración → Configuración → SMTP / Correo se prepara Postmark, se conserva SMTP y se consulta la cola. Guardar una API Key nueva crea un candidato cifrado; no sustituye la activa hasta comprobar ese candidato. Un campo vacío conserva el secreto existente. El navegador recibe únicamente su disponibilidad.

El secreto puede proporcionarse mediante `POSTMARK_SERVER_TOKEN_FILE` montado en runtime o `POSTMARK_SERVER_TOKEN` en el entorno del servicio. No se incorpora al frontend ni a imágenes Docker. Se reutiliza `core_systemsecret` para los secretos guardados desde administración.

Para verificar y activar:

1. Completar auditoría, backup cifrado con restauración aislada, migración compatible, conservación y regresión. `scripts/register-mail-preparation.mjs` registra exclusivamente estas fases iniciales a partir de informes locales comprobados; no activa ningún transporte.
2. Confirmar el remitente autorizado en el panel de Postmark. El valor inicial `no-reply@uasspain.com` es una propuesta de configuración, no evidencia de autorización. El Server Token no permite consultar dominios o remitentes de cuenta.
3. Guardar el proveedor, remitente, destinatario corporativo y candidato de credencial. Sólo está implementado Postmark.
4. Autorizar expresamente el destinatario de prueba y enviar la prueba desde el panel. El backend comprueba el servidor Live y el envío. La promoción del candidato es atómica y comprueba que la configuración no cambió durante la prueba. La aceptación real queda en la outbox.
5. Seleccionar «Utilizar API de correo exclusivamente» y guardar. La activación exige una verificación reciente. Se bloquean modificaciones SMTP y no existe fallback automático.
6. Comprobar registro, OTP, recuperación y Contacto en el entorno autorizado. Conservar las evidencias antes de registrar validación posterior o completar el release gate.

La API oficial exige un remitente confirmado y admite `ReplyTo` independiente del remitente; Contacto conserva el destinatario corporativo y usa el email del visitante para responder. [Postmark Email API](https://postmarkapp.com/developer/api/email-api).

La comprobación de credenciales utiliza la API del servidor y exige `DeliveryType=Live`; su respuesta contiene información sensible que no se serializa ni registra. [Postmark Server API](https://postmarkapp.com/developer/api/server-api).

## Cola, estados y fallos

`PENDING` y `RETRY_SCHEDULED` son trabajo pendiente; `PROCESSING` tiene una reserva temporal. `ACCEPTED` acredita aceptación del transporte. `DELIVERED` requiere un evento auténtico de entrega del proveedor. `FAILED`, `EXPIRED` y `UNKNOWN` conservan el resultado real. El buzón corporativo requiere comprobación independiente incluso cuando el servidor receptor aceptó el mensaje.

Contenido, destinatario y enlaces/códigos están cifrados. Los tokens se emiten junto con su trabajo de correo en la misma transacción; antes de enviar se comprueba que siguen vigentes. El login mantiene el fallo seguro cuando no puede acreditarse aceptación del OTP.

Los errores transitorios con rechazo conocido tienen backoff, jitter, Retry-After cuando procede y límite de cinco intentos. Un timeout o un trabajador abandonado produce `UNKNOWN`; no se reenvía automáticamente. Los envíos se reclaman mediante bloqueos de PostgreSQL. La idempotencia de Contacto conserva un ID por solicitud y rechaza reutilizarlo con contenido distinto.

El circuito abre ante fallos repetidos del proveedor y permite una comprobación limitada después de la espera. Sólo una aceptación real lo cierra. Los rechazos particulares de destinatarios no abren el circuito. Las alertas internas y los estados sobreviven al reinicio.

«Comprobar resultado» consulta Postmark sin reenviar. Para un resultado incierto busca el identificador propio en metadata, exige una coincidencia única y verifica remitente, destinatario y asunto. La entrega exige un evento de ese destinatario y excluye respuestas Sandbox. [Postmark Messages API](https://postmarkapp.com/developer/api/messages-api).

## Reversión sin restaurar la base

La reversión requiere una petición administrativa expresa y una prueba SMTP reciente satisfactoria. Desde el modo API se permite comprobar SMTP exclusivamente para esta preparación autorizada. El cambio de canal es atómico, conserva secretos e historial y registra los estados de reversión. No revoca claves externas ni restaura automáticamente una base anterior.

Al conmutar, sólo se reasignan mensajes `PENDING` o `RETRY_SCHEDULED` cuyo envío aún no se aceptó. Se conservan sus IDs, contenido, destinatarios, caducidad e idempotencia. `PROCESSING` bloquea temporalmente la conmutación; `UNKNOWN`, `ACCEPTED` y `DELIVERED` no se convierten en nuevos envíos. Así se mantiene la exclusividad del canal sin recrear mensajes ya aceptados.

## Pendientes externos de esta instalación

La empresa mantiene una web anterior en `uasspain.com`. Durante esta fase no se modifican DNS, DKIM, Return-Path, MX, A, AAAA, CNAME ni nameservers. No se ha confirmado un remitente autorizado en Postmark y no hay acceso autorizado al buzón `info@uasspain.com` para comprobar recepción y Responder. La validación corporativa real está aplazada hasta producción por autorización del usuario.

```text
VERIFIED_SENDER=UNCONFIRMED
POSTMARK_ACCOUNT_API=NOT_PROVIDED
REAL_INBOX_RECEPTION=BLOCKED_EXTERNAL (aplazada hasta producción)
REAL_REPLY_TO_VALIDATION=BLOCKED_EXTERNAL (aplazada hasta producción)
PHASE_05=NOT_COMPLETE
PRODUCTION_READY=NOT_COMPLETE
```

El responsable con acceso deberá confirmar el remitente, autorizar la prueba, comprobar recepción y cabeceras y pulsar Responder sin enviar la respuesta para verificar el destinatario. Los valores DKIM o Return-Path deben obtenerse del panel autorizado; esta documentación no inventa registros DNS.

No hay commit, push, envío real corporativo ni despliegue remoto autorizados para esta implementación.
