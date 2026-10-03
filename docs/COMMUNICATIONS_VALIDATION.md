# Chat, presencia y videollamadas

El menú del instructor y la pestaña de conversaciones con estudiantes se llaman
**Alumnos**. Los perfiles del propio instructor no aparecen como destinatarios
de videollamada; solo se admiten alumnos activos asignados a ese instructor.

## Presencia y conexiones

`GET /api/registros-conexion/activas/` reutiliza los registros de sesión existentes.
Comprueba que la sesión coincide con la sesión vigente del perfil, que el usuario
está activo y verificado y que ha tenido actividad en los últimos 90 segundos.
El WebSocket de conexiones actualiza la actividad cada 25 segundos. Los paneles
refrescan la presencia cada 15 segundos y reciben avisos de login/logout.
Si el navegador se cierra sin logout, la presencia caduca tras el margen anterior.

Administrador e instructor ven las conexiones de los tres roles. El alumno solo
ve su presencia y la de su instructor asignado. La vista compartida incluye nombre,
rol y fechas; no devuelve claves de sesión, email, IP ni información del dispositivo.
El instructor conserva el acceso limitado a sus registros históricos y no recibe
permisos para finalizar o modificar sesiones del administrador.

## Salas y moderación

La migración `0013_video_channels_and_moderators.sql` amplía la tabla existente
`conexiones_videollamada`. Conserva las llamadas de alumnos y añade el canal
`administracion`, las referencias al administrador, iniciador y moderador, con
claves foráneas, comprobaciones de participantes e índices. No modifica ninguna
migración ya aplicada. Las llamadas se eliminan cuando se elimina un participante
que es obligatorio para esa llamada.

El instructor dispone de las partes **Alumnos** y **Administradores**. El
administrador dispone de **Videollamada** para llamar a instructores y recibe
avisos de llamadas entrantes. Ambos canales usan la misma API y motor WebRTC,
pero nunca comparten sala. Los alumnos no pueden consultar ni entrar por
WebSocket en una llamada de administración. Cada llamada exige participantes
explícitos: ser administrador no permite entrar en cualquier sala.

El servidor determina el moderador: administrador o instructor que inicia la
llamada; si llama un alumno, modera su instructor. El cliente no puede elegir
ni suplantar el moderador. El moderador cierra toda su sala al colgar; al salir
un alumno, las demás invitaciones de la clase permanecen activas. Los nombres
guardados en nuevas llamadas se obtienen del perfil y se cifran con la clave
de campos existente.

## Validación local

- Rust: 76 pruebas; formato, comprobación de compilación y Clippy sin warnings.
- Frontend: TypeScript, ESLint y 8 pruebas unitarias.
- `frontend/e2e/staff-presence-video.spec.ts`: tres contextos Chromium y usuarios
  reales de la pila aislada. Verifica presencia de los tres roles, entrega del
  chat, vídeo entre participantes en ambos sentidos, moderación según iniciador,
  rechazo de llamadas a uno mismo, aislamiento API/WebSocket y cierre de sesión.
  Los dispositivos de cámara/micrófono son simulados; el intercambio WebRTC es real.
- Docker activo: cinco servicios saludables; migración 13 aplicada; se conservan
  las tres cuentas, los quince cursos y las huellas de sesión anteriores.
- PostgreSQL mantiene gocryptfs en PGDATA y TLS 1.3 desde el backend. No se
  recrean sus volúmenes, sus claves ni el servicio Redis.
- El sitio activo pasa la verificación HTTPS, rutas públicas, cursos y sitemap.
- Gitleaks no encuentra secretos en el árbol distribuible.

La prueba cubre la instalación local. No valida un relay TURN externo ni llamadas
entre redes remotas, para las que sigue pendiente configurar y probar TURN.
