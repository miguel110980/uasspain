# Manual de uso y administración de UASSpain

Esta guía describe las pantallas React y sus servicios Rust. **IMPLEMENTADO**
significa que existe la función; **VERIFICADO** requiere una prueba con fecha y
entorno. Consulte [validación](docs/LOCAL_VALIDATION.md) para el alcance probado
y los requisitos externos pendientes. Una tarjeta de estado no acredita por sí
sola que un servicio externo funcione.

## Acceso y normas comunes

**Objetivo:** acceder con los permisos de la cuenta existente. Requisitos:
cuenta activa, verificada y con el rol correspondiente; correo operativo cuando
la política exija OTP. Abra **Acceso**, introduzca correo y contraseña y complete
el código si se solicita. Los paneles reales son `/admin`, `/instructor` y
`/alumno`; las secciones se seleccionan en su menú lateral, no mediante rutas
inventadas como `/admin/usuarios`. Las cuentas con varios roles sólo pueden
seleccionar los roles asignados por el servidor.

Compruebe su nombre y panel después de entrar. Cada ventana mantiene su sesión;
recargar no debe exigir otro login mientras siga vigente. A los **900 segundos
sin actividad** caduca el acceso. «Acceda desde esta ventana» requiere iniciar
sesión en esa ventana: no copie cookies ni cambie sesiones de otras personas.
Un 401 indica falta de autenticación; 403, permisos; 409, edición concurrente;
429 exige esperar; 502/503 requiere comprobar el servicio. Un fallo de conexión
no demuestra una contraseña incorrecta. **Salir** cierra voluntariamente la
sesión actual; no equivale a dar de baja la cuenta.

El registro público verifica el correo por OTP y aplica la aprobación prevista
por el centro; no concede roles administrativos. El código de registro y el de
login caducan a los 15 minutos, tienen cinco intentos como máximo y consumo
único. El reenvío de registro tiene una espera mínima de un minuto. Los fixtures
no acreditan entrega corporativa. Si no llega, revise el canal y su monitor;
no desactive OTP para completar una prueba.

Para recuperar acceso, use **¿Ha olvidado su contraseña?**, siga el enlace del
correo y establezca una nueva contraseña. El enlace caduca a la hora y no se
devuelve por API. Requiere un canal API/SMTP operativo y acceso al buzón. Un
administrador puede solicitar el envío desde la gestión de usuarios, sin leer
contraseñas ni sustituirlas por SQL. Véase [correo](docs/mail-api-smtp-operations.md).

## Panel de administración

Requisito común: sesión `admin` validada por el backend. Las lecturas pueden
incluir datos personales: limite consultas y exportaciones a su finalidad.

| Menú real | Finalidad, uso y datos | Comprobación y límites |
|---|---|---|
| Supervisión → Dashboard | Resumen de usuarios y actividad. Consulte los listados de origen. | Contadores de API/PostgreSQL; no son métricas comerciales ni prueba de disponibilidad externa. |
| Actividad en tiempo real / Estadísticas | Consultar eventos y agregados, refrescar y revisar el período disponible. | Sin actividad registrada puede no haber datos; no se inventan resultados. |
| Seguridad → Conexiones en vivo | Consultar sesiones y detalles. Para instructor/alumno, revocar sesión o bloquear según permisos. | **Ningún ADMIN muestra cierre forzoso ni bloqueo**, incluido uno mismo; API 403. Detalles y logout voluntario disponibles. |
| Registro de Conexiones | Consultar conexiones y metadatos guardados. | Un registro histórico no significa conexión abierta. |
| Seguridad / Auditoría | Revisar políticas, incidentes y eventos administrativos. | No muestra claves ni autoriza modificar evidencia protegida. |
| Gestión → Gestión de Usuarios → Usuarios | Buscar perfiles, revisar solicitudes, gestionar roles/estados y asignaciones autorizadas. | Bloqueo, baja y verificación pendiente son estados distintos. Revise usuario y alcance antes de confirmar. |
| Gestión de Usuarios → Alumnos | Tablas de activos y bajas, filtros, detalle, contadores, historial, CSV y reactivación confirmada. | Paginación/filtros y contadores en servidor. CSV limitado y auditado; baja conserva historial. |
| Instructores | Consultar instructores y alumnos/asignaciones; revisar dependencias sin instructor operativo. | No hay reasignación automática por una baja. |
| Blog / Publicaciones | Crear/editar publicaciones, imágenes, estado y orden; revisar antes de publicar. | Comprobar `/blog`; guardar borrador no lo publica. |
| Formación / Cursos | Editar nombre, categoría, modalidad, portada y temas; publicar o anunciar próximamente. | Comprobar `/formacion` y URL del curso. [Publicación](docs/COURSE_PUBLIC_PAGES.md). |
| Servicios | Administrar servicios, iconos, cabeceras, imágenes, contenido y orden mediante las plantillas existentes. | Slugs/rutas y revisiones en Rust; ante conflicto, recargue y revise sin sobrescribir a otro editor. |
| Comunicación → Chat | Conversaciones del personal y canales privados; mensajes, PDF y moderación según permisos. | Visibilidad por canal y participante. No pruebe limpieza sobre mensajes reales. |
| Videollamada | Comunicaciones WebRTC de participantes autorizados. Conceda cámara/micrófono y cuelgue al terminar. | Señalización WSS no prueba medios: compruebe audio/vídeo. Internet puede necesitar TURN. |
| Sistema → Monitorización | Revisar backend, base y Redis. | Desconocido no equivale a saludable; confirme los endpoints. |
| Notificaciones | Avisos derivados de usuarios, actividad y configuración. | Hay textos SMTP heredados: el canal efectivo se consulta en **SMTP / Correo**, no se deduce del aviso. |
| Copias de seguridad | Tres servidores, activación, programación, inventario, historial y operaciones auditadas. | Guardar no verifica. Crear/restaurar/eliminar no son comprobaciones inocuas. [Recuperación](docs/BACKUP_RESTORE.md). |
| Conexiones VPN | Observación del anfitrión y único editor público WireGuard. | No instala/activa túnel. Sin supervisión, desconocido/no disponible; nunca conectado. |
| Configuración | Políticas de acceso, correo y Google. Guardar/comprobar cada integración. | Secreto vacío conserva el anterior; no se devuelve al navegador. Pruebas externas requieren autorización. |
| Infraestructura → Configuración inicial | Equipo, instalación, directorios, red, seguridad y validación; guardar progreso. | VPN y copias son resúmenes de sólo lectura con enlaces a sus únicos editores. |
| Cuenta → Mi cuenta | Consultar/actualizar perfil y contraseña; solicitar baja propia. | Procedimiento reforzado de baja más abajo. |

### Configurar VPN y servidores sin duplicación

**Objetivo:** guardar parámetros y comprobar evidencias reales. Requisitos:
infraestructura provisionada y agente de lectura autenticado para monitorizar
el anfitrión. Abra **Conexiones VPN**, pulse **Actualizar estado** y revise
adaptador, clave pública, puerto, equipos e intercambio de claves. Los campos
vacíos sólo se completan con observaciones verificadas; varios adaptadores o
información ausente requieren selección manual. Los valores guardados prevalecen.
Guarde y compruebe el resultado tras recargar.

La descarga contiene configuración pública **ya guardada**, no claves privadas
ni cambios pendientes. El asistente inicial sólo enlaza a esta pantalla.
Abra **Copias de seguridad → Servidores de copias de seguridad** para configurar
**Copias de seguridad locales**, **Servidor externo de copias 1** y **2**.
Habilite sólo los previstos. «Verificar conexión con el servidor» puede crear y
retirar su archivo sintético: requiere permiso de escritura. Una VPN conectada
no acredita autenticación SFTP, ruta, capacidad ni copia.

Ante `STALE_OR_INVALID_AGENT_MESSAGE`, revise fecha UTC, firma HMAC, permisos y
frecuencia del colector. No marque manualmente VERIFIED ni exponga su clave.
[Diagnóstico de infraestructura](docs/infrastructure-operations.md).

### Correo y Google

En **Configuración → SMTP / Correo**, seleccione transporte y guarde los campos.
Use destinatario de prueba autorizado. API exclusiva impide fallback SMTP;
aceptación del proveedor no confirma recepción. [Manual API/SMTP](docs/mail-api-smtp-operations.md).

En **Configuración → Integraciones**, prepare Google desactivado, copie origen y
callback a Google Cloud y complete **Verificar con Google** con reautenticación.
Después vincule su identidad y habilite el acceso verificado. No se conceden
roles ni se vincula por email. Desvincular exige contraseña y `DESVINCULAR`,
revoca sesiones propias y conserva login convencional. [OAuth](docs/google-oauth-operations.md).
La interacción real con Google sigue siendo un requisito externo, no un mock.

## Panel de instructor

Requisito: rol `instructor`, cuenta activa y asignaciones autorizadas. El servidor
aplica el alcance aunque se manipule un identificador en el navegador.

| Sección | Procedimiento, resultado esperado y límites |
|---|---|
| Dashboard | Consultar resumen de sus alumnos y actividad; contrastar cifras en listados. No incluye alumnos ajenos. |
| Alumnos | Buscar, abrir detalle y gestionar sólo asignados y solicitudes permitidas. Una baja conserva historial y no se presenta como activo. |
| Material | Subir PDF admitido, elegir alcance/permisos y consultar/descargar. Comprobar visibilidad del alumno autorizado y rechazo del ajeno. Un PDF escaneado puede carecer de texto extraíble; no se acredita OCR ni generación automática de preguntas. |
| Exámenes | Crear/editar exámenes, preguntas y asignaciones o importar archivo compatible. Revisar antes de publicar. No se generan preguntas con IA desde apuntes. |
| Resultados | Consultar intentos, respuestas y notas persistidas por alumno/examen. Los históricos no desaparecen por una baja. |
| Estadísticas | Seguimiento académico del conjunto autorizado. Sin intentos no se estiman notas. |
| Chat | Elegir alumno o conversación del personal y enviar/comprobar respuesta. PDF/moderación según permisos. No abre conversaciones de otros. |
| Videollamada | Invitar participantes autorizados, comprobar cámara/audio y finalizar. Las llamadas de grupo autorizan cada participante. |
| Conexiones activas | Consultar actividad de su alcance; no concede administración sobre otras cuentas. |
| Cuenta | Editar perfil/contraseña y solicitar baja mediante el procedimiento común. |

Ante 403 compruebe rol/asignación con administración. No cambie IDs para eludirlo.
Si falta PDF o resultado, revise publicación, permisos y matrícula antes de
duplicar contenido. Referencias: [instructor](docs/audits/2026-10-10-instructor-access.md)
y [alumno](docs/audits/2026-10-10-student-panel.md), con fecha y alcance propios.

## Panel de alumno

Requisito: rol `alumno`, cuenta activa/verificada y permisos académicos vigentes.

| Sección | Uso, verificación y problemas habituales |
|---|---|
| Dashboard | Revisar resumen personal y avisos; contrastar notas en Resultados. No incluye estadísticas ajenas. |
| Exámenes | Iniciar/recuperar examen autorizado; comprobar guardado y envío. El servidor determina plazo, prerrequisitos y nota. |
| Resultados | Consultar calificaciones e intentos propios y detalle de corrección disponible. Corregir respuestas no permite editar preguntas. |
| Material | Abrir/descargar PDF autorizado y registrar progreso cuando esté disponible. Revisar sesión/permisos si falla; enlaces privados no son públicos. |
| Evolución | Gráficas de resultados propios. Sin actividad no hay evolución calculable. |
| Chat | Comunicarse con instructor/canales autorizados y revisar no leídos. Conversaciones aisladas. |
| Videollamada | Aceptar invitación, conceder cámara/micrófono y colgar. El técnico debe validar TURN/redes fuera de localhost. |
| Mi cuenta | Actualizar datos permitidos, cambiar contraseña o solicitar baja. |

El catálogo público describe la oferta; **no equivale a matricularse ni comprar**.
No se documenta pasarela de pago ni certificación automática no implementada.
Tras pérdida de red, recupere el intento y revise lo guardado antes de reenviar;
el backend aplica envío idempotente y los plazos del examen.

## Baja propia y reactivación

**Objetivo:** deshabilitar acceso conservando identificador e históricos. Desde
**Cuenta**, pulse **Dar de baja mi cuenta**, lea consecuencias, reautentíquese
según formulario y escriba `DARME DE BAJA`. **Cancelar** no causa baja;
**Confirmar baja** sólo se habilita con los requisitos satisfechos. Se revocan
sesiones y se redirige a la web pública. Un nuevo login se rechaza hasta la
reactivación autorizada.

El último administrador operativo y las cuentas técnicas protegidas no pueden
causar baja por este mecanismo. Administración abre **Usuarios → Alumnos →
Alumnos dados de baja**, revisa historial y confirma **Reactivar alumno**.
Se conservan bloqueos independientes; las sesiones anteriores no se recuperan.
Verifique tablas/contadores y solicite nueva autenticación al titular.

Baja y supresión son procedimientos distintos. No elimine cursos, exámenes,
conversaciones o archivos para simular una baja. La retención aprobada sigue
pendiente donde no exista; no se inventan plazos ni cumplimiento normativo.
[Operación y controles](docs/account-lifecycle-operations.md).

## Responsable informático

Siga [despliegue](docs/DEPLOYMENT.md), [seguridad](SECURITY.md),
[infraestructura](docs/infrastructure-operations.md),
[instaladores](scripts/backup-external/README.md),
[recuperación](docs/BACKUP_RESTORE.md), [correo](docs/mail-api-smtp-operations.md)
y [respuesta a incidentes](infra/monitoring/INCIDENT-RUNBOOK.md).

El bootstrap sólo se utiliza en instalación nueva autorizada. Con
`BOOTSTRAP_ADMIN_ENABLED=true` puede crear o actualizar permisos/estado de la
cuenta de arranque: **no lo active para recuperar cuentas reales durante una
auditoría**. No publique credenciales ni use fixtures como cuentas empresariales.
No instale VPN, cambie firewall, restaure datos o rote claves sin autorización.
