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

## Errores conocidos y validación corporativa

**SMTP — PENDIENTE DE CONFIGURACIÓN Y VALIDACIÓN.** La empresa debe aportar
proveedor, host, puerto, TLS/STARTTLS admitido, usuario/autenticación compatible,
secreto protegido, remitente autorizado y destinatario corporativo. Introducir
la configuración desde **Administración → Configuración → SMTP / Correo**,
manteniendo la contraseña cifrada y los secretos fuera de Git, imágenes y
logs. Un campo de secreto vacío conserva el anterior. Elegir SMTP expresamente
cuando proceda, autorizar el destinatario y verificar envío y recepción reales.
No cambiar a SMTP para ocultar un fallo del modo API exclusivo.

**OTP — PENDIENTE DE CONFIGURACIÓN Y VALIDACIÓN FUNCIONAL.** La lógica existe
en `registration.rs`, `auth.rs`, `mail_queue.rs` y `email.rs` del backend:

- Código aleatorio de seis dígitos, hash Argon2 en la cuenta y contenido del
  correo cifrado en outbox. No registrar ni exportar el código en texto claro.
- Registro y login OTP caducan a los 15 minutos, con máximo cinco intentos
  por código y consumo único mediante actualización condicional PostgreSQL.
- Reenvío/emisión respeta el intervalo de un minuto. Los endpoints aplican
  rate limiting de diez peticiones por clave IP/operación/email en cinco
  minutos; además conservar los controles del proxy y sesión.
- La política administrativa existente determina roles que requieren OTP.
  El login no emite sesión antes de completar los requisitos de la cuenta.
  Un fallo de entrega obligatoria invalida el OTP de login y devuelve error;
  no entrega sesiones para intentar compensar una caída del correo.
- Emisión y trabajo de correo comparten transacción; los trabajos caducados
  no se reenvían. La cola conserva errores/estado seguro, límites y resultados
  inciertos sin reenviar automáticamente ni cambiar de transporte.

Estos controles fueron probados con fixtures aislados en auditorías anteriores;
esta integración **inspecciona código y documenta**, no vuelve a ejecutar
registro, login ni envíos. Para cerrar OTP corporativo: confirmar el canal,
autorizar una cuenta de prueba aislada/destinatario, recibir el mensaje real,
verificar el código desde la interfaz, comprobar caducidad/consumo único y
errores sin afectar cuentas reales. No declarar entrega funcional porque un
proveedor haya aceptado el mensaje o porque exista un fichero de fixture.

**POSTMARK — PENDIENTE DE CONFIGURACIÓN FINAL Y VALIDACIÓN REAL.** Es un
servicio especializado de correo transaccional mediante API o SMTP. UASSpain
ha implementado su API HTTPS y conserva SMTP como alternativa seleccionable.
Preparar una cuenta/servidor Live autorizado y el Server API Token protegido;
no mostrar ni solicitar tokens por el chat. No confundir ese token con el
Account API Token para consultas de dominios/remitentes.

Confirmar la Sender Signature o dominio y el remitente corporativo desde el
panel autorizado, siguiendo el [inicio de Postmark](https://postmarkapp.com/support/article/1002-getting-started-with-postmark).
El servidor utiliza `no-reply@uasspain.com` como propuesta, no como prueba de
verificación. Conservar `info@uasspain.com` como destino corporativo acordado,
y verificar antes la configuración vigente. Contacto debe enviar From del
remitente autorizado, To corporativo y Reply-To del visitante.

Revisar DKIM, SPF y política DMARC corporativos sin modificar DNS en esta fase.
Postmark autentica SPF para su Return-Path; el alineamiento SPF requiere el
Return-Path corporativo apropiado, y DMARC acepta SPF o DKIM alineados.
No añadir un SPF inventado/duplicado: obtener los registros exactos del panel
y coordinar el corte de producción con el operador de la web anterior.
Consultar [SPF de Postmark](https://postmarkapp.com/support/article/how-do-i-set-up-spf-for-postmark)
y [Return-Path](https://postmarkapp.com/support/article/910-how-do-i-add-a-custom-return-path).

Incidencias observadas y pendientes de cierre:

| Operación | Resultado conocido | Diagnóstico y condición para cerrar |
|---|---|---|
| `PUT /api/system/mail/` | HTTP 400, `validation_error` | El backend impide activar API antes de guardar y verificar una credencial/remitente. Ese guard puede producir el 400; falta conservar el `detail`/payload redactado de la petición original para atribuir su causa exacta. No desactivar el guard ni declarar reparada la incidencia sólo al guardar configuración. |
| `POST /api/system/mail/test/` | HTTP 503, `service_unavailable` | La prueba histórica terminó `FAILED/provider_rejected`. El Server API respondió 200 en una consulta de diagnóstico, lo que acredita acceso al servidor, no remitente ni permiso de envío. El código de rechazo original de Postmark no se conservó, por lo que no se atribuye una causa específica ni se declara envío correcto. |

El diagnóstico es histórico. La revisión documental del 14/10 no reenvía correo
ni repite PUT sobre configuración corporativa para intentar reproducirlo:
ambas operaciones escribirían datos reales y el envío carece de remitente
confirmado. Las pruebas aisladas de errores/configuración no cierran esos dos
incidentes de la instancia principal; su reproducción real queda **BLOCKED_EXTERNAL**
hasta disponer de remitente y destinatario autorizados. No se declara que el
400/503 siga ocurriendo en una petición nueva. Registrar correlación,
estado de outbox y código redactado del proveedor cuando se autorice una
prueba nueva; distinguir rechazo permanente, circuito abierto, timeout y
entrega desconocida. Conservar credenciales antiguas y SMTP; no habilitar
fallback, resetear la cola ni reenviar estados UNKNOWN a ciegas.

La exclusividad se comprobó por lectura en `mail_queue::enqueue`,
`mail_config` y el servicio de entrega centralizado: cuando `api_exclusive`
está persistido, se selecciona Postmark y no se incluye transporte SMTP;
si falta verificación/clave se rechaza el envío. Esto aplica al OTP, Contacto,
recuperación y notificaciones. Las pruebas de candidato y de reversión SMTP
son operaciones administrativas explícitas, no fallback automático. No se
ha detectado un incumplimiento de esa política en la lectura; su prueba real
corporativa permanece pendiente.

Antes de producción, resolver los errores conocidos con una prueba autorizada,
comprobar recepción real y cabeceras, pulsar Responder para verificar destinatario
(sin necesidad de enviar la respuesta), revisar rechazos/rebotes, monitorización
y límites, y probar OTP completo. Guardar evidencias sin secretos. La
[guía de puesta en producción](infrastructure-operations.md#guía-de-configuración-y-puesta-en-producción)
integra estos pasos con HTTPS y backups. `PRODUCTION_READY=NOT_COMPLETE` mientras
falten las comprobaciones reales.
