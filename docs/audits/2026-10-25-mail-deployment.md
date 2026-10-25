# Actualización del correo UASSpain — 25 de octubre de 2026

## Alcance autorizado y resultado

Desplegadas las incidencias **02–07** y la limpieza exclusivamente visual de
«Últimos envíos». Este informe continúa la preparación local descrita en
[2026-10-25-mail-repair.md](2026-10-25-mail-repair.md); la autorización posterior
permite reconstruir, actualizar Docker, crear commits y subirlos al GitHub existente.

**Incidencia 01: BLOCKED.** El usuario confirma que el dominio de producción está
pendiente de adquisición/verificación, que los remitentes corporativos aún no
están confirmados en Postmark y que no existe un remitente de pruebas autorizado.
Solicita conservar el bloqueo. No se habilitan campos de identidad editables ni
se eliminan restricciones: permanecen `no-reply@uasspain.com`, `UASSpain` e
`info@uasspain.com` como valores corporativos previstos. La API Key administrativa
mantiene su flujo cifrado existente. No se inventan identidades ni credenciales.

## Validación previa reutilizada

El código preparado no cambió entre las pruebas locales anteriores y el build
Docker: la comparación SHA-256 de los archivos revisados no encontró diferencias.
Se conserva su evidencia sin presentarla como una nueva ejecución:

- Frontend: typecheck, lint, build y **227 pruebas unitarias PASS**.
- Rust: fmt/check/clippy, **160 pruebas PASS** y **3 integraciones aisladas PASS**.
- UI local con mocks: **5 pruebas PASS**.

## Despliegue y comprobaciones nuevas

Se ejecutó el procedimiento oficial:

```powershell
powershell.exe -NoProfile -Command "& ./scripts/start-encrypted-stack.ps1 -Build -Services @('backend','frontend')"
```

Se reconstruyeron y recrearon exclusivamente backend y frontend. PostgreSQL,
Redis y Nginx conservan sus contenedores, volúmenes y configuración. Se verificó
de nuevo PostgreSQL cifrado. No se modificaron Compose, Dockerfiles, migraciones,
DNS, certificados, router ni acceso externo.

| Servicio | Imagen desplegada | Estado |
| --- | --- | --- |
| backend | `sha256:972b9a20fd3568f6cea3c4901ac95162f0325b3098a3ff0282ed6e37080ac00c` | healthy |
| frontend | `sha256:e742f97652a8de7c28f0fd2b3059a8444577e721e0cd87b221dcf9294ecae4f8` | healthy |
| nginx | Sin cambios | healthy |
| postgres | Sin cambios | healthy |
| redis | Sin cambios | healthy |

Build ID servido: `102d68ee-bea4-4a2b-ab5f-794251686393`, diferente del anterior.

- **PASS:** `/healthz`, `/readyz`, `/api/health/live/` y `/api/health/ready/`: HTTP 200.
- **PASS:** cinco pruebas UI ejecutadas sobre la imagen Docker nueva, con todas
  las escrituras de API interceptadas: datos guardados, cambios locales bloqueados,
  limpieza visual, error de aprobación y borrador SMTP.
- **PASS:** siete E2E por HTTPS contra backend/frontend aislados con las mismas
  imágenes desplegadas: estados de contacto, petición única, `Reply-To`, cifrado,
  persistencia, radios API/SMTP, validaciones y reversión. El circuito de la
  consulta sintética permanece abierto para impedir cualquier petición de entrega.
- **PASS:** navegador real y API de la instancia principal: estados coincidentes
  entre paneles, canal guardado, bloqueo de pruebas sin guardar, identidad protegida,
  confirmación de limpieza, cancelación y recuperación de los 17 registros.
  No hubo PUT/POST/DELETE de configuración o envío de correo.
- **PASS:** hashes de configuración, perfiles, secretos cifrados, certificados y
  referencias de volúmenes iguales antes y después. Se mantienen SMTP seleccionado,
  17 mensajes FAILED, migración API_CONFIGURED y circuito Postmark OPEN.

Las pruebas nuevas identifican su alcance: frontend con mocks, API aislada con
fixtures o instancia principal de solo lectura. No acreditan entrega externa.

## Advertencias y límites

La resolución pública habitual del dominio desde este equipo devolvió
`ERR_CONNECTION_REFUSED` antes de establecer HTTPS. Se verificó Docker local usando
resolución exclusivamente del proceso de navegador a loopback, manteniendo hostname,
SNI y validación del certificado público. No se modificó DNS del sistema o externo
ni se desactivaron controles TLS. Esto no acredita acceso desde Internet; el
contenedor y configuración de Nginx no cambiaron y el acceso local funcionó.

Postmark **no se declara operativo**. La aprobación de la cuenta y la verificación
del dominio/remitente siguen pendientes. El SMTP guardado tampoco se declara
disponible: la API informa `channel_ready=false`. Se conservaron el canal y el
circuito; no se enviaron correos reales ni se borró el historial.

Las imágenes anteriores están identificadas en un perfil local de reversión,
sin copiar/restaurar bases ni crear backups. No fue necesario ejecutarlo porque
las comprobaciones locales de la aplicación actualizada pasaron.

El informe final con commits, SHA local/remoto y comprobaciones posteriores al push
se conserva en `.run/mail-final-20261025/RESULTADO.md`; los artefactos y secretos
locales no se incluyen en Git.
