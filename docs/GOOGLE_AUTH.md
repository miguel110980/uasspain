# Acceso con Google

El login muestra «Continuar con Google» junto al acceso con correo y contraseña.
Con un Client ID configurado utiliza el botón oficial visible de Google Identity
Services. Sin configuración muestra su disponibilidad real y permite volver a
comprobarla; no simula un acceso correcto.

## Activación en la instalación local

1. En [Google Cloud Console](https://console.cloud.google.com/auth/clients),
   cree o seleccione un cliente OAuth de tipo **Aplicación web** y configure la
   pantalla de consentimiento/audiencia. En modo de pruebas, autorice la cuenta
   Google que utilizará cuando Google lo requiera.
2. Añada **`https://localhost`** a los orígenes JavaScript autorizados si accede
   mediante esa URL. Para otra URL, añada su origen exacto, incluido el puerto,
   sin rutas. El esquema y host deben coincidir con el navegador.
3. Copie el **Client ID** público terminado en `.apps.googleusercontent.com` y
   ejecute desde el proyecto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/configure-google-auth.ps1 -ClientId '<CLIENT_ID_PUBLICO>'
```

El script actualiza únicamente `GOOGLE_CLIENT_ID` en el `.env` local y arranca la
pila cifrada con su configuración actualizada. No necesita reconstruir el
frontend. Este flujo de ID token con popup no necesita Client Secret ni una ruta
de callback/redirect OAuth en la aplicación.

La configuración del cliente y los orígenes está descrita en la
[documentación oficial de Google](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
La consola requiere una sesión del propietario del proyecto Google Cloud; el
repositorio no incluye ni inventa una credencial de proveedor.

## Comportamiento y seguridad

El backend entrega el Client ID público mediante
`GET /api/public/oauth/google/`. El navegador obtiene un nonce mediante
`POST /api/auth/google/challenge/`, carga el widget oficial y envía el ID token a
`POST /api/auth/google/`. El backend valida la firma RS256 contra JWKS de Google,
issuer, audience, azp, expiración, nbf, correo verificado y nonce firmado en una
cookie HttpOnly de cinco minutos y un único uso. El botón renueva el intento
antes de que caduque y permite reintentar si falla su preparación.

La CSP permite las rutas oficiales del script, estilos, conexiones e iframes
de GIS. La cabecera `Cross-Origin-Opener-Policy: same-origin-allow-popups`
permite la comunicación con el popup. Se mantienen las demás protecciones y
los permisos del mapa. Los indicadores administrativos reciben el estado real
de configuración mediante `/api/system/status/`.

Solo pueden acceder cuentas UASSpain existentes, activas y verificadas cuyo
correo sea Gmail o de Google Workspace. Se vincula el sujeto estable mediante
un índice HMAC y se conservan los roles existentes. No se registra automáticamente
una cuenta ni se conceden permisos administrativos por usar Google. Si la
política exige OTP local, se debe utilizar correo, contraseña y código temporal.

El administrador existente puede usar su Gmail una vez activado el cliente.
Los emails ficticios `@example.invalid` de las dos cuentas de prueba se usan
para el acceso con contraseña y no son cuentas Google.

La caché de JWKS y el registro de nonces usados corresponden a una instancia
del backend. Deben compartirse antes de escalar el servicio a varias instancias.
No cambie la migración histórica `0007_google_subject.sql` ni sus checksums.

## Alcance de la validación

Los tests locales pueden verificar el flujo del frontend con respuestas
simuladas del proveedor y comprobar que los tokens inválidos se rechazan. Eso
no acredita un inicio de sesión real contra Google: requiere el Client ID
autorizado y la intervención del titular de una cuenta Google.
