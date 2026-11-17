# Google OAuth auténtico en el ORIGINAL

## Resultado vigente

`OAUTH_STATUS=VALIDATED_LOCAL_ADMIN`. Completados con el proveedor Google auténtico: verificación, activación expresamente autorizada, vinculación expresamente autorizada y nuevo acceso desde el botón público sin introducir la contraseña UAS Spain. El retorno llegó a `/admin`, con la identidad habitual de Miguel y rol administrador. El dashboard muestra Google listo y ocho cuentas. Esto cierra el acceso local de ese administrador, no todos los casos de OAuth ni la auditoría integral.

El cliente existente `uasspain` del proyecto indicado conserva el dominio anterior y añade el origen local y su callback. El titular retiró del formulario los dos orígenes de laboratorio y la redirección de laboratorio identificados, y pulsó Guardar. Se reabrió la ficha desde la lista de credenciales: persisten exactamente dos orígenes y dos redirecciones. No se creó otro cliente ni se regeneró el secreto.

La consola del navegador lateral estaba inicialmente autenticada con otra cuenta sin acceso al proyecto. Cambiar por la UI normal a la cuenta habitual de Miguel permitió consultar y editar el cliente existente. No se solicitaron permisos, no se modificó IAM y no se transfirieron cookies entre navegadores. La verificación final se ejecutó en el navegador integrado mediante sesión normal de UAS Spain y Google; no acredita una prueba completa en Firefox o Chrome instalados.

Comprobación posterior de PostgreSQL, en transacción de sólo lectura: `enabled=true`, origen verificado local, fecha e identificador de verificación presentes, revisión 4, ocho perfiles y un perfil vinculado. Endpoint público: `configured=true` y Client ID disponible. Los cinco contenedores continúan saludables y las cuatro rutas de salud responden 200 con TLS Windows normal. Evidencia: `.run/f15-live-20261112-fdf84891/google-real-completed.json` y capturas `google-client-local-saved.jpg`, `google-real-verified-disabled.jpg`, `google-real-linked.jpg`, `google-real-login-admin.jpg`. No se guardan contraseñas, códigos de autorización, cookies ni tokens en estos entregables.

Quedan fuera de este PASS: alta nueva, cancelación, cuentas pendientes/bloqueadas, todos los roles con Google real y compatibilidad completa de navegadores. Modo Producción, cierre integral y publicación Git siguen pendientes de sus gates. No se declara PRODUCTION_READY.

## Diagnóstico previo

El botón público desactivado tiene una causa confirmada: el endpoint público sólo publica el Client ID cuando la configuración está habilitada y cuenta con verificación real vigente y secreto disponible. El registro tiene Client ID y secreto cifrado, pero está desactivado y sin verificación. No se ha observado todavía un rechazo del proveedor Google.

El backend previo usa `https://www.uasspain-prueba.duckdns.org` como origen de Google, mientras la aplicación se utiliza en `https://localhost`. La corrección preparada afecta únicamente a `GOOGLE_OAUTH_PUBLIC_ORIGIN`; no cambia correo corporativo, SMTP ni `FRONTEND_URL`.

Destino requerido: origen `https://localhost` y callback `https://localhost/auth/google/callback`. La autorización real debe iniciarse desde el módulo administrativo, con reautenticación del titular, y completar el retorno del proveedor. La verificación no concede vínculo ni habilita por sí sola el acceso. No se escribirán manualmente `verified_at`, el identificador del flujo o un estado de éxito.

## Secuencia inicial, conservada como histórico

- Código: comprobaciones Rust existentes superadas; `fmt --check` y finalización de Clippy confirmados en esta continuación.
- Docker: reconstrucción oficial únicamente del backend finalizada, contenedor recreado y cinco servicios saludables. Imagen activa `sha256:2af5204f212cd5495d50c3fd234d9ac9899dd21a7d4145cf84ad4d6a92ff55f3`, contenedor `0d668060244da72ffa329eca9bb9750cd2846be570545968d6a5671047386999`, creado `2026-11-12T21:14:33.130960717Z`.
- Configuración activa: `GOOGLE_OAUTH_PUBLIC_ORIGIN=https://localhost`, verificada en el contenedor y mediante API administrativa autenticada. Las cuatro rutas de salud responden 200 con TLS Windows normal, sin excepciones. El procedimiento oficial también ha confirmado el almacenamiento PostgreSQL cifrado y el rechazo de clave incorrecta.
- Navegador: sesión actual de Miguel confirmada en el panel administrador real de Edge. Abierto `https://localhost/admin?section=configuracion&tab=integraciones`, con identidad de Miguel visible. La caducidad anterior ya no es el bloqueo actual. Se utilizó el formulario de acceso ya preparado, sin leer, extraer ni mostrar su contraseña.
- Google auténtico: flujo administrativo `verify` iniciado después de la reautenticación autorizada del titular. Google ha respondido `Error 400: redirect_uri_mismatch`. Los detalles oficiales identifican `redirect_uri=https://localhost/auth/google/callback`. No se ha completado la verificación ni se ha habilitado o vinculado una identidad mediante cambios manuales de datos.
- Consola Google: se continúa con el cliente existente cuyo Client ID coincide con el configurado. Antes de inspeccionar y editar sus entradas, Google está solicitando la verificación en dos pasos del titular. Esa comprobación se completa directamente en su teléfono, sin códigos o contraseñas en el informe. No se ha guardado todavía ningún ajuste en Google Cloud.
- Producción, commit y push: `NOT_RUN`, posteriores a la validación real.

Regresión complementaria ejecutada en esta continuación: `header-browser-e2e.json`, `PASS`, Edge real con validación TLS estricta, cuentas existentes de instructor y alumno. Se comprueban acceso al panel, ausencia de buscador, menú de cuenta, navegación y menú móvil. Se corrigieron únicamente las expectativas del runner: estos paneles usan estado interno para cambiar de sección y tienen dos elementos `aside`, por lo que esperar una URL nueva o un `aside` único era incorrecto. No se modificó la aplicación para satisfacer esas expectativas. Este resultado no acredita Google OAuth.

Después de reconstruir, `google-oauth-admin-readiness.json` acredita siete comprobaciones PASS con la cuenta de ensayo existente que ya tenía rol administrador: acceso legítimo a ese panel, origen activo, callback exacto, transporte listo, credenciales existentes conservadas, bloqueo de activación no verificada e interfaz administrativa real con reautenticación obligatoria. Sólo lecturas de configuración; no se ha verificado ni vinculado la cuenta de ensayo con Google. Resultado efectivo: `CONFIGURED_PENDING_VERIFICATION`, `verified=false`, `enabled=false`. La identidad real del titular no se sustituye por esta prueba.

## Informe vigente de la fase OAuth local

```text
CODE=PASS_RUST_CHECKS
TESTS=PASS_REAL_GOOGLE_VERIFY_LINK_LOGIN_AND_AFFECTED_REGRESSION
DOCKER_BUILD=PASS_BACKEND_OFFICIAL
DOCKER_DEPLOY=PASS_BACKEND_RECREATED
POSTGRES=HEALTHY
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5
HEALTHZ=200
READYZ=200
API_LIVE=200
API_READY=200
E2E_DOCKER=PASS_REAL_GOOGLE_LOCAL_ADMIN
FUNCTIONAL_TEST=PASS_PUBLIC_GOOGLE_LOGIN_RETURNED_ADMIN
SECURITY=PASS_SCOPED_STRICT_TLS_NORMAL_PROVIDER_AND_EXPLICIT_LINK
SECRETS_IN_GIT=NOT_RUN_FINAL_REVIEW
COMMIT=NOT_RUN_GATE_PENDING
PUSH=NOT_RUN_GATE_PENDING
LOCAL_HEAD=3db68f34e62f382ee60a21ec4e2d035957c70282
ORIGIN_MAIN=16d1f208acf3dc881cfb272728b57a2ae00d4779
CRITICAL=NOT_REASSESSED
HIGH=NOT_REASSESSED
ERRORS=NONE_OBSERVED_IN_COMPLETED_OAUTH_ACCEPTANCE_FLOW
```

Evidencia de partida: `.run/f15-live-20261112-fdf84891/google-oauth-before-origin-deploy.json`. El valor observado `configured=false` y la ausencia de Client ID público son coherentes con el control de activación; HTTP 200 no acredita un login funcional.

`SEQUENCE=PASS_OAUTH_LOCAL_ADMIN`, `CURRENT=OAUTH_ACCEPTANCE_COMPLETE`, `CHANGE_STATUS=COMPLETE_OAUTH_CONFIGURATION_ONLY`, `AUDIT_STATUS=INCOMPLETE`, `RELEASE_GATE=BLOCKED_PENDING_INTEGRAL_CHECKS`. Ubuntu queda fuera de esta fase por instrucción del titular y su apagado deliberado no es regresión de OAuth.
