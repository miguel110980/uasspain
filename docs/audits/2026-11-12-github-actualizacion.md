# Publicación de la continuación verificada

## Alcance de publicación

Repositorio privado existente `miguel110980/uasspain`, rama de trabajo `codex/auditoria-20261110`. El titular ha solicitado expresamente la subida y conserva la autorización específica previa para publicar trabajo pendiente en esa rama con el gate integral abierto. No es una entrega definitiva, despliegue público ni autorización para integrar en `main` sin su gate.

Cambios incluidos: catálogo publicado común con autorización individual de descarga, eliminación del buscador del encabezado compartido sin alterar el resto de navegación, pruebas de regresión y actualización de evidencias. Se conserva como trabajo pendiente el canal backend de solicitud de aplicación VPN; el ejecutor y su integración no están terminados. En el ORIGINAL ese canal de escritura no está configurado y su API devuelve 503 al administrador y 401 al anónimo, sin publicar comandos ni modificar el túnel. No se presenta como funcionalidad completada.

Google fue verificado, activado y vinculado por los flujos auténticos y se comprobó el acceso público con rol administrador. La configuración y el secreto cifrado viven en la base local y en el entorno protegido: no se incluyen credenciales, contraseñas, cookies, tokens o claves privadas en Git. El cambio de origen local ya está aplicado al backend Docker.

## Comprobaciones

- Rust actual: fmt, check, Clippy sin advertencias y 171 pruebas PASS, cuatro casos de integración SMTP ignorados porque requieren su fixture dedicado.
- Frontend: se conserva la evidencia de typecheck, lint, build y 244 pruebas PASS para los mismos inputs de la imagen desplegada; no se presenta como una ejecución nueva.
- Docker: arranque oficial afectado ejecutado; cinco servicios saludables y cuatro rutas de salud con HTTP 200 y TLS validado. Imagen backend y frontend registradas en el JSON de evidencia saneada.
- Navegador/API: verificación Google real, vínculo y login administrador PASS; regresión posterior de encabezados y configuración actual registrada en artefactos locales.
- Materiales: se conservan las pruebas del catálogo de diez materiales en cinco alumnos y los permisos/descargas individuales de la versión corregida.
- Backups, VPN operativa y HTTPS local ya verificados se conservan; no se vuelven a tratar como fallos de conectividad.
- La auditoría integral, el caso separado de compatibilidad estricta de la CA y las comprobaciones restantes mantienen su estado documentado. Modo Producción no se cambia en esta operación de publicación de trabajo pendiente.

## Estado de publicación

Preparado para los controles finales del índice Git, secreto y sincronización. El commit y el push sólo se anotarán como realizados después de observar su éxito; el registro posterior local conservará los SHA y la salud tras la subida. La copia Nginx no relacionada, `.env`, `.secrets`, `.run` y los artefactos privados quedan fuera del índice.
