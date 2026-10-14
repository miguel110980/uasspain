# Acceso con Google

La guía vigente es [Google OAuth 2.0: configuración y operación](google-oauth-operations.md).
Centraliza Google Cloud, origen/callback, verificación, vinculación,
desvinculación y límites. Esta entrada conserva los enlaces existentes.

El flujo nuevo utiliza Authorization Code con PKCE S256 y Client Secret cifrado.
El procedimiento antiguo de activar sólo un Client ID y generar challenge **no
acredita ni habilita la integración segura**. No vincule por coincidencia de
email. El login convencional se conserva.

Estado de despliegue y aceptación: [validación local](LOCAL_VALIDATION.md).
La verificación real requiere cliente autorizado e interacción del titular;
no se acredita mediante proveedor sintético.
