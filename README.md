# UASSpain

UASSpain combina una web pública de formación y servicios UAS con un entorno
privado para administración, instructores y alumnos. El centro publica su oferta,
gestiona usuarios y materiales, realiza exámenes y mantiene comunicaciones e
históricos. Este repositorio contiene la aplicación existente; no acredita
certificaciones empresariales ni servicios externos por el texto de su web.

La arquitectura utiliza **React 19, TypeScript, Vite, Rust/Axum, PostgreSQL 18,
Redis 8 y Nginx**, con exactamente cinco servicios permanentes Docker Compose.
Python sólo aparece en herramientas de pruebas/operación, no como backend web.
Separar interfaz, autorización y persistencia permite aplicar permisos en el
servidor y actualizar contenedores conservando datos y claves.

## Cómo leer los estados

- **IMPLEMENTADO:** respaldado por código/configuración. No implica despliegue.
- **VERIFICADO:** prueba identificada por fecha, entorno, imagen y alcance.
- **PENDIENTE:** falta configuración, autorización o una comprobación concreta.
- **NO DISPONIBLE:** capacidad ausente; no debe sustituirse por datos simulados.

La evidencia vigente se centraliza en [validación local](docs/LOCAL_VALIDATION.md).
Los informes fechados conservan resultados históricos; no acreditan un build
posterior. La entrega no se considera completa hasta validar Docker y GitHub.

## Inventario funcional

| Función implementada | Uso, usuarios y dependencias | Evidencia y límites |
|---|---|---|
| Web pública, servicios y formación | Visitante: navegación, categorías, plantillas dinámicas, imágenes y blog. Administración publica y ordena contenidos. | `App.tsx`, `content.rs`, `services.rs`, `seo.rs`; [páginas de curso](docs/COURSE_PUBLIC_PAGES.md). Catálogo no equivale a compra/matrícula automática. |
| Acceso y sesiones | Registro, contraseña, OTP, recuperación, sesiones por ventana, roles y 900 s de inactividad. | `auth.rs`, `registration.rs`; [sesiones](docs/audits/2026-10-11-independent-sessions.md). La entrega corporativa de códigos sigue pendiente. |
| Google OAuth | Configuración administrativa, secreto cifrado, PKCE, verificación, vínculo por sub y desvinculación. Requiere cliente Google autorizado. | [Operación](docs/google-oauth-operations.md), [pruebas aisladas](docs/audits/2026-10-13-google-oauth.md). Autenticación real externa pendiente; no conceder roles por email. |
| Gestión de usuarios | ADMIN gestiona perfiles, asignaciones, permisos, activos/bajas y CSV autorizado; instructor opera su alcance. | `users.rs`, `student_directory.rs`, `instructor_access.rs`; [manual](ADMIN.md). Datos persistidos, sin contadores ficticios. |
| Baja y reactivación | Los tres roles pueden solicitar baja propia reforzada; ADMIN reactiva según permisos. | [Operación](docs/account-lifecycle-operations.md). Baja lógica, revocación y protección del último administrador; retención corporativa pendiente. |
| Material y exámenes | Instructor gestiona PDF, preguntas y asignaciones; alumno consulta material, realiza intentos y revisa resultados. | `materials.rs`, `exams.rs`, `exam_import.rs`; [auditoría alumno](docs/audits/2026-10-10-student-panel.md). No se generan preguntas con IA; OCR no acreditado. |
| Chat, presencia y videollamada | Canales autorizados, WSS, persistencia de mensajes, PDF/moderación y medios WebRTC. | `chat.rs`, `video.rs`; [comunicaciones](docs/COMMUNICATIONS_VALIDATION.md). Medios locales no acreditan TURN entre redes externas. |
| Seguridad y supervisión | ADMIN revisa sesiones, conexiones, auditoría, alertas y disponibilidad. Protección de todas las cuentas ADMIN frente a bloqueo/cierre forzoso. | `connections.rs`, `security.rs`, [seguridad](SECURITY.md). Visibilidad de detalles y logout voluntario se conservan. |
| Correo centralizado | API Postmark o SMTP, cola persistente, reintentos seguros, circuito y monitor. Contacto usa From técnico, To corporativo y Reply-To visitante. | [API/SMTP](docs/mail-api-smtp-operations.md). Aceptación no equivale a entrega; sin fallback SMTP en API exclusiva. |
| Copias de seguridad | ADMIN configura tres destinos independientes, programación, FULL/delta, inventario y recuperación auditada. | [Backup/recovery](docs/BACKUP_RESTORE.md). Sólo destinos activados; restaurar exige procedimiento y autorización. |
| Infraestructura y VPN | Asistente, adaptadores, observación autenticada del anfitrión y editores únicos de VPN/destinos. | [Infraestructura](docs/infrastructure-operations.md). No instala ni activa VPN; plataformas no probadas no se declaran compatibles. |
| Instaladores externos | Scripts de servidor Windows/Linux, OpenSSH/SFTP/WireGuard, rutas y puertos parametrizados. | [Inventario y pruebas](scripts/backup-external/README.md). Integrados; instalación real pendiente. No necesitan ZIP ni clientes personalizados ausentes. |

El [manual de los tres paneles](ADMIN.md) explica finalidad, pasos, permisos,
datos, verificación y errores habituales. El [mapa técnico](docs/DEPLOYMENT.md#mapa-técnico-de-la-aplicación)
relaciona módulos, APIs, entidades y herramientas.

## Web pública

`/` contiene Hero, radar/dron y accesos a servicios y contacto. La navegación
enlaza `/nosotros`, `/tecnologia`, `/blog`, `/contacto` y `/formacion`.
`/servicios/:slug` y `/formacion/*` utilizan registros publicados del backend;
los cambios se notifican por el canal público de contenido. Las páginas legales
explican las políticas publicadas, que requieren revisión empresarial y no
certifican cumplimiento legal por existir.

Contacto valida campos y controles antispam/rate limiting y utiliza el backend
Rust y el canal de correo configurado. Registro, acceso y recuperación son
formularios reales; necesitan los servicios indicados en el manual. Temas claro
y oscuro, navegación por teclado y responsive se comprueban por escenarios y
tamaños concretos, no como garantía universal de accesibilidad.

Vite genera assets con hash y HTML público prerenderizado; Nginx integra las
páginas dinámicas y sus sitemaps. Privados y callbacks llevan noindex. Los
metadatos se generan desde la configuración del sitio. No se atribuyen aquí
puntuaciones Lighthouse actuales ni un posicionamiento garantizado.

## Arquitectura e instalación local

| Servicio | Función y exposición |
|---|---|
| `nginx` | Entrada HTTPS y proxy; único publicado en `127.0.0.1:80/443`. |
| `frontend` | SPA React compilada y Nginx interno TLS; red `edge`. |
| `backend` | API Rust, autorización y WSS con TLS; redes `edge`/`data`. |
| `postgres` | Persistencia PostgreSQL, TLS, roles separados y volumen cifrado; red interna `data`. |
| `redis` | Bus de eventos/caché, TLS y ACL; red interna `data`. |

Requisitos: motor de contenedores Linux y Compose compatibles, FUSE, recursos
verificados por el técnico, certificados/secretos locales y acceso al perfil
propietario de DPAPI en el despliegue Windows actual. No asuma Docker Desktop
en Windows Server ni que probar un contenedor Linux acredita otro anfitrión.
Véanse [plataformas](docs/infrastructure-operations.md#plataformas).

Con los secretos ya provisionados y **preservando la clave existente**:

```powershell
powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build
docker compose -p uasspain -f docker-compose.yml -f docker-compose.encrypted.yml ps
```

Abra `https://localhost`. Compruebe los cinco servicios y los cuatro endpoints
de salud del [procedimiento obligatorio](docs/REPAIR_WORKFLOW.md). Sin clave,
PostgreSQL queda bloqueado. **Nunca use `-InitializeKey` sobre una base existente**,
ni `down -v`, prune de volúmenes o recreación de base para resolver un fallo.
El [despliegue](docs/DEPLOYMENT.md) explica primer arranque, recuperación, traslado,
TLS y persistencia. El script no sustituye la preparación segura de secretos.

## CONFIGURACIONES PENDIENTES ANTES DE PRODUCCIÓN

| Servicio | Estado y trabajo pendiente |
|---|---|
| **SMTP** | **PENDIENTE DE CONFIGURACIÓN Y VALIDACIÓN.** Proveedor, host, puerto, TLS/STARTTLS, identidad, secreto, remitente y destinatarios autorizados; comprobar envío y recepción. |
| **OTP** | **PENDIENTE DE VALIDACIÓN FINAL.** Generación, hash, 15 minutos de caducidad, cinco intentos y consumo único implementados; falta entrega corporativa y completar acceso/registro con el código recibido. |
| **Postmark** | **PENDIENTE DE CONFIGURACIÓN FINAL Y ENTREGA REAL.** Server Token protegido, remitente/dominio autorizado y verificaciones del proveedor; comprobar recepción y destinatario al pulsar Responder. |
| **Google** | Cliente web, correo corporativo informativo, origen/callback, secreto protegido e interacción real de verificación/vinculación. Mantener desactivado hasta verificar. No cambia correo API/SMTP. |
| **WireGuard/SFTP** | Equipos, redes, claves, agente, destinos y conectividad reales por verificar. Los scripts no se han instalado en servidores corporativos. |
| **TURN y retención** | Relay de medios entre redes externas y política empresarial de conservación/supresión pendientes de validación/aprobación. |

Postmark es un servicio en la nube especializado en correo transaccional por
API o SMTP. Su adaptador está implementado; **no se declara operativo** aquí.
Se observaron HTTP 400 en `PUT /api/system/mail/` y HTTP 503 en
`POST /api/system/mail/test/`. El [diagnóstico](docs/mail-api-smtp-operations.md#errores-conocidos-y-validación-corporativa)
separa esos resultados históricos de una reproducción nueva; no se envía correo
ni se cambia configuración real sólo para actualizar un informe.

**API exclusiva conserva SMTP y prohíbe su fallback.** Un token configurado o
una aceptación del proveedor no acreditan el buzón. No modificar DNS, DKIM,
Return-Path, MX, A, AAAA, CNAME o nameservers de la web corporativa antigua.

## Índice de documentación y mantenimiento

| Necesidad | Documento de referencia |
|---|---|
| Utilizar los tres paneles | [Manual de usuario y administración](ADMIN.md) |
| Instalar, entender arquitectura y actualizar | [Despliegue y mapa técnico](docs/DEPLOYMENT.md) |
| Controles, secretos y riesgos | [Seguridad](SECURITY.md) y [excepciones Rust](backend-rust/SECURITY_ADVISORY_EXCEPTIONS.md) |
| Gates Docker/Git y cierre obligatorio | [REPAIR_WORKFLOW](docs/REPAIR_WORKFLOW.md), [AGENTS](AGENTS.md) |
| Configurar empresa y anfitrión | [Infraestructura y puesta en producción](docs/infrastructure-operations.md) |
| Preparar servidores externos | [Instaladores Windows/Linux](scripts/backup-external/README.md) |
| Copias, cadenas, restauración | [Backup y recovery](docs/BACKUP_RESTORE.md), [operación simplificada](docs/BACKUPS_SIMPLIFIED.md) |
| Correo transaccional y diagnóstico | [API/SMTP](docs/mail-api-smtp-operations.md) |
| Google Cloud y OAuth | [Google OAuth](docs/google-oauth-operations.md) |
| Bajas e históricos | [Ciclo de cuenta](docs/account-lifecycle-operations.md) |
| Incidentes y continuidad | [Runbook](infra/monitoring/INCIDENT-RUNBOOK.md) |
| Pruebas y documentos históricos | [Validación e índice de evidencias](docs/LOCAL_VALIDATION.md) |

Las guías operativas son la referencia actual; los informes fechados conservan
contexto y no deben copiarse como instrucciones de despliegue. Revalide después
de cada build, mantenga backups y recuperación de claves independientes y
publique únicamente después de los gates. No ejecute herramientas históricas
de reconstrucción o instaladores externos en la instancia real por rutina.
