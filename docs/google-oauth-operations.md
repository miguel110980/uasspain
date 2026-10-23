# Google OAuth 2.0 — configuración y operación

El módulo utiliza el backend Rust existente y Authorization Code Flow con PKCE S256. No cambia SMTP, Postmark ni el destinatario de Contacto. El correo corporativo de este módulo es un dato de configuración, no una regla de autorización. No se crean usuarios, no se asignan roles y no se vincula por coincidencia de email.

## Origen y cliente en Google Cloud

### Instalación de pruebas con www (23 de octubre de 2026)

El origen solicitado para Google OAuth es `https://www.uasspain-prueba.duckdns.org` y el callback exacto es `https://www.uasspain-prueba.duckdns.org/auth/google/callback`, sin barra final. El usuario confirma que Google Cloud utiliza `www`; no se ha modificado ni inspeccionado su consola. El dominio sin `www` es otro origen y no se sustituye automáticamente.

`FRONTEND_URL=https://uasspain-prueba.duckdns.org` configura ahora la URL pública general. `GOOGLE_OAUTH_PUBLIC_ORIGIN=https://www.uasspain-prueba.duckdns.org` conserva el callback con www solicitado para Google Cloud; si está vacío se utiliza FRONTEND_URL. CORS conserva los accesos locales/LAN y añade ambos orígenes exactos. SITE_URL/VITE_SITE_URL corresponden al dominio público general. Las cookies host-only y sessionStorage requieren iniciar y terminar Google en el mismo origen; el acceso convencional desde localhost/LAN se conserva.

Ambos nombres figuran en la allowlist compartida. `nginx/tls_pending_hosts.conf` mantiene bloqueado su enrutamiento de aplicación con HTTP 503 mientras falte un certificado público válido. El backend muestra esa misma lista en la configuración efectiva, sin afirmar que un host permitido ya está validado. El preparador TLS sólo retira del bloqueo el hostname cuyo certificado ha comprobado; otros alias y el gate OAuth conservan su estado pendiente.

Para un hostname público, `GOOGLE_OAUTH_VERIFIED_PUBLIC_ORIGIN` queda vacío hasta verificar realmente HTTPS con confianza pública, nombre y cadena válidos. Sólo después puede el operador configurarlo con el mismo origen exacto que `FRONTEND_URL`. No es un mecanismo de emisión de certificados ni prueba de registro en Google Cloud. Un cambio de origen deja sin validez la evidencia anterior; no se modifica ni borra el secreto cifrado para corregir las URL.

El panel distingue secreto disponible, transporte validado y verificación real del proveedor. `verified_at` por sí solo no permite habilitar Google: deben coincidir origen y evidencia de flujo. Si falla TLS se muestra `BLOCKED_PUBLIC_TLS`, y el backend rechaza el inicio antes de crear el flujo. No se desactivan state, nonce, PKCE, cookie, vínculo explícito, permisos ni reautenticación.

El arranque local admite seleccionar los servicios afectados: `-Build -Services backend,frontend,nginx` para esta incorporación del dominio, con las dependencias existentes saludables y sin recrear PostgreSQL o Redis. Si Nginx no cambia, basta seleccionar backend/frontend. Conservar los dominios/certificados activos hasta disponer de TLS válido para el hostname exacto con `www`.

1. El operador configura `FRONTEND_URL` con el origen público de esta instalación, por ejemplo `https://localhost` en desarrollo o el dominio HTTPS autorizado de la empresa. No incluya usuario, contraseña, ruta distinta de `/`, query ni fragmento. No se toma de Host, X-Forwarded-Host ni del formulario. HTTP sólo se admite para loopback en desarrollo.
2. Abra Google Cloud Console, seleccione el proyecto de la empresa y entre en **Google Auth Platform**. Complete **Branding** (nombre y correos de soporte/contacto), **Audience** (Internal únicamente si procede para la organización; External en los demás casos) y **Data Access** con OpenID, email y perfil básico. Si el proyecto externo está en Testing, añada las cuentas de prueba autorizadas. No se solicita acceso a Gmail, Drive ni al correo corporativo.
3. En **Clients → Create client** seleccione **Web application**. Copie desde UASSpain el **Origen autorizado de JavaScript** y la **URL de redirección autorizada**. La redirección es exactamente `<FRONTEND_URL>/auth/google/callback`, sin barra final. Protocolo, dominio y puerto deben coincidir. Google puede exigir verificación del dominio y de Branding/Audience según la configuración de la empresa.
4. En **Administrador → Configuración → Integraciones**, guarde correo corporativo, Client ID y Client Secret con Google desactivado. El secreto se cifra en `core_systemsecret`; dejar el campo vacío conserva el anterior. Cambiar cliente, secreto o correo invalida la verificación anterior. Cambiar el origen del despliegue también invalida su evidencia.
5. Introduzca su contraseña actual y pulse **Verificar con Google**. Complete la autenticación real en esta misma ventana. Se comprueban la firma RS256/JWKS, issuer, audience, expiración, nonce, email verificado, state, cookie del flujo y PKCE. Generar una URL no acredita verificación.
6. Para vincular su cuenta UASSpain, use **Vincular cuenta Google**, reautentíquese y complete otra autenticación real. El vínculo queda en el índice único existente por `sub` de Google; nunca se elige una cuenta por su email. Una identidad ya vinculada a otra cuenta se rechaza sin moverla. La verificación por sí sola no crea un vínculo ni habilita Google.
7. Active **Habilitar acceso Google verificado** y guarde cuando la verificación haya pasado. El login convencional conserva sus comprobaciones de contraseña/OTP. OAuth tampoco omite una política de OTP adicional que requiera acceso convencional.

El Client ID es público; el Client Secret no se devuelve en ninguna lectura. El intercambio de código y todos los tokens Google permanecen en backend. El código de autorización sólo transita por el callback y su POST de finalización, se retira de la URL antes de iniciar la aplicación y no se almacena en sessionStorage. Las respuestas de callback tienen `no-store`, `no-referrer` y `noindex`; no se registra su query. El state/cookie expira en cinco minutos y se consume en PostgreSQL antes del intercambio, evitando replay incluso después de reiniciar.

## Desvinculación y acceso

Desvincular exige la contraseña actual y escribir `DESVINCULAR`. Se elimina exclusivamente el vínculo del administrador autenticado y se revocan sus sesiones; no se borran usuarios ni historiales. Una nueva autenticación convencional vuelve a dar acceso. El login Google comprueba el vínculo también dentro de la transacción que crea la sesión, evitando que un login concurrente recupere una identidad retirada.

No se confunden correo corporativo configurado, email de Google y permisos UASSpain. Ninguno de esos correos concede ADMIN. Sólo se conservan los roles que PostgreSQL ya asignaba a la cuenta vinculada.

## Pruebas y entrega

`docker-compose.google-e2e.yml` añade exclusivamente un proveedor OIDC sintético temporal a `uasspain-e2e`. El adaptador sólo se acepta con `GOOGLE_OIDC_SYNTHETIC_TESTS=true`, fuera de producción y sobre la base/host de pruebas aislados. Sus claves se generan en memoria; sus resultados no acreditan autenticación real con Google. No añada esa capa a la pila principal ni a producción.

Antes de migrar MAIN: backup cifrado, checksum y recuperación aislada verificables; después, migración expand 0030 sin cambiar usuarios ni vínculos anteriores, reconstrucción oficial y aceptación sobre las nuevas imágenes. La entrega documental del 14 de octubre autoriza actualización local y publicación normal, condicionadas a seguridad y regresión. La autorización no acredita su ejecución; consulte [validación local](LOCAL_VALIDATION.md). No se autoriza desplegar a producción ni modificar Google Cloud o DNS.

La aceptación real requiere el cliente web autorizado de Google Cloud, el secreto guardado por un administrador y su interacción con Google. No facilite secretos por chat ni los incluya en `.env.example`, Dockerfiles, informes o commits.

Referencias oficiales: [Authorization Code para aplicaciones web](https://developers.google.com/identity/protocols/oauth2/web-server), [OpenID Connect y validación de identidad](https://developers.google.com/identity/openid-connect/openid-connect), [Administración de clientes OAuth](https://support.google.com/cloud/answer/15549257).
