# Ventana propuesta de validación local del ORIGINAL

Estado: BLOCKED, pendiente de autorización específica. Documento revisable; no se
ha ejecutado. No autoriza publicación pública, Google, red, borrado o restauración.

## Alcance concreto propuesto

1. Comprobar identidad de los cinco servicios uasspain y del volumen cifrado actual.
2. Crear un backup nuevo cifrado por el mecanismo existente, sin sobrescribir ni
   borrar copias previas, claves o datos. Verificar integridad y dejar constancia
   de que una comprobación de integridad no demuestra restauración funcional.
3. Resolver la disponibilidad de las imágenes de reversión. Los metadatos locales
   de las antiguas imágenes nginx y redis faltan. No exportar/copiar el sistema de
   archivos de la aplicación ni reconstruir una réplica para sortear este límite.
   Si no existe una reversión verificable, detenerse antes de recrear servicios y
   explicar la dependencia. Una restauración requerirá permiso independiente.
4. Solo tras esos controles y la autorización: ejecutar el arranque oficial
   powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build.
   Puede reconstruir/recrear los cinco servicios y causar una interrupción local.
   No usar InitializeKey; conservar volumen PostgreSQL cifrado, DPAPI y secretos.
5. El inicio del backend aplicaría 0032, 0033 y 0034. 0032 añade duración/umbral y
   revisión; ajusta A2 existentes a 1800 s y conserva plazo de intentos anteriores.
   0033/0034 crean propiedad de subidas y tickets/cuotas de avatares. No recalcular
   notas históricas, editar migraciones anteriores ni borrar información.
6. Verificar identidad de nuevas imágenes, cinco healthy, cuatro HTTP 200 con TLS,
   montaje gocryptfs y versiones SQLx. No presentar el estado anterior como prueba.
7. Las pruebas de escritura necesitan identificar previamente cuentas y registros
   sintéticos. No usar usuarios reales ni alterar contraseñas, sesiones, historial,
   correo, configuración o permisos operativos. Los casos todavía sin autorización
   o sin fixture inequívoca permanecen BLOCKED.
8. Ante cualquier fallo, detener avance y commit/push. No ejecutar restauración,
   downgrade de esquema, eliminación ni reversión destructiva de forma automática.

## Exclusiones

Sin cambio de Cloud/OAuth, secretos, certificados, DNS, firewall, dominio, indicador
APP_PRODUCTION, backups previos, visibilidad GitHub ni instalaciones externas.
Sin down -v, prune, borrados globales, réplicas de base o nuevas instalaciones.
El paso público y el RELEASE GATE siguen pendientes de sus pruebas y permisos.

## Estado de las fuentes y artefactos

Ver informe 2026-11-09-original.md y recibos de imágenes en .run. Los artefactos
preparados aún no ejecutan la aplicación. GitHub continúa BLOCKED por el gate.

## Actualización tras consentimiento

**Actualización vigente:** el titular autorizó conservar dos imágenes de reversión
Nginx/Redis sin pausa. Sus controles de secretos y contenido pasaron; quedaron
disponibles los recursos de reversión, sin ensayar restauración. Se completó la
ventana ya autorizada, el arranque oficial con -Build y las migraciones 0032–0034.
Cinco servicios healthy, volumen cifrado preservado y cuatro HTTP 200. Ver
[verificacion-anterior.md](2026-11-09-verificacion-anterior.md).
El párrafo siguiente es el resultado histórico previo a resolver ese control.

Autorizado por el titular con los controles previos descritos. Backup completo e
integridad PASS; reversión BLOCKED por imágenes exactas nginx/redis ausentes.
No reconstrucción ni migraciones ejecutadas. No hace falta repetir la autorización
de esta ventana al resolver esa dependencia; se mantiene su condición de seguridad.
