# Seguridad de UASSpain

## Arquitectura y controles

- Solo Nginx publica `127.0.0.1:80/443`; backend, frontend, PostgreSQL y Redis permanecen en redes Docker.
- Edge a backend/frontend, backend a PostgreSQL y backend a Redis usan TLS verificado.
- Cookies seguras, sesiones rotadas, RBAC deny-by-default, autorizacion por recurso y validacion Origin protegen HTTP/WS.
- Contenedores usan rootfs de solo lectura, `no-new-privileges`, capacidades minimas y usuarios no root cuando el entrypoint lo permite.
- Secrets se montan desde `.secrets/`; Gitleaks y detect-secrets protegen el pre-commit y las comprobaciones locales.
- Backups se cifran, verifican y auditan. Consulte [backup y recovery](docs/BACKUP_RESTORE.md).
- PostgreSQL exige cifrado completo de archivos y nombres con gocryptfs
  AES-256-GCM, incluidos WAL, temporales y logs. Su clave aleatoria se protege
  con DPAPI CurrentUser y se entrega solo a tmpfs; el arranque sin clave queda
  bloqueado. No depende de BitLocker. WSL debe tener swap desactivado y el
  postmaster funciona sin capacidades Linux efectivas. Consulte el
  [procedimiento cifrado](docs/DEPLOYMENT.md#reconstruccion-postgresql-desde-migraciones).

## Estado de controles y límites de evidencia

La revisión documental del 14 de octubre distingue código, pruebas y producción.
Los resultados actuales se enlazan desde [validación](docs/LOCAL_VALIDATION.md);
los recuentos fechados más abajo no sustituyen un nuevo scan.

| Control implementado | Evidencia / comprobación | Pendiente o límite |
|---|---|---|
| Contraseñas Argon2id, OTP con hash/expiración/intentos y recuperación de un uso | `auth.rs`, `registration.rs`, suites aisladas. | Entrega corporativa no verificada. No registrar códigos ni credenciales. |
| Sesiones por ventana, cookies Secure/HttpOnly/SameSite, cuenta/rol y caducidad 900 s | `auth.rs`, `windowSession.ts`; pruebas de logout, refresh y permisos. | No confiar en roles del navegador ni restaurar tokens revocados. |
| ADMIN protegido frente a bloqueo/cierre forzoso; baja protege último administrador | `connections.rs`, `account_lifecycle.rs`; transacciones y pruebas negativas. | Baja propia reforzada y logout normal tienen reglas distintas. |
| OAuth PKCE/state/nonce, RS256/JWKS/claims, sub único y reautenticación | `google_oauth.rs`, `google_oidc.rs`; proveedor sintético aislado, replay y concurrencia. | Google real pendiente; email coincidente no vincula ni concede roles. |
| RBAC y autorización de recursos, archivos, canales y llamadas | `academic_scope.rs`, `uploads.rs`, `chat.rs`, `video.rs`; E2E de IDOR/aislamiento. | Ocultar botones no protege una API. |
| Consultas parametrizadas, validación y límites de carga | SQLx, validadores Rust y límites Nginx por ruta. | SQL dinámico necesita allowlist/citado; prueba local no acredita resistencia DDoS ni ausencia absoluta de inyección. |
| XSS y errores seguros | React escapa texto; SEO escapa HTML/JSON; CSP y `error.rs` con correlación. | Revisar cualquier uso de HTML; CSP no sustituye validación. |
| CSRF, CORS y WSS | Cookies restringidas, origen/ventana y autorización de sockets, allowlists Rust/Nginx. | No relajar orígenes/TLS para obtener PASS; revisar origen real tras proxy. |
| SSRF y rutas | Endpoint de proveedor controlado, SFTP validado contra peer, raíces permitidas y rechazo de traversal/enlaces. | Red/VPN/DNS corporativos por verificar; no aceptar rutas a secretos. |
| TLS entre servicios | CA/hostname, PostgreSQL verify-full, Redis TLS/ACL y proxy TLS. | Certificado público y redes empresariales por configurar sin versionar claves. |
| Cifrado persistente | gocryptfs PostgreSQL, AES-GCM de campos/secretos/backups y DPAPI en Windows actual. | No cifra todo el host ni prueba borrado forense; recuperación de claves independiente. |
| Docker segmentado y permisos limitados | Cinco servicios, edge/data, read-only, tmpfs, límites y no-new-privileges. | FUSE/SYS_ADMIN sólo para montar; postmaster sin capacidades. No todo entrypoint es no root. |
| Supervisión WireGuard autenticada | HMAC, frescura e identidad; sin comandos arbitrarios ni claves privadas. | Sin observación válida: BLOCKED/desconocido; no equivale a túnel conectado. |
| Correo persistente | Outbox cifrada, reservas transaccionales, reintentos clasificados y UNKNOWN tras resultado incierto. | Sin promesa de exactamente una vez ni DELIVERED sin evidencia; sin fallback SMTP en API exclusiva. |
| Auditoría y datos personales | Eventos protegidos, CSV autorizado/limitado, secretos no devueltos y errores redactados. | Retención/supresión empresarial por aprobar; no certifica RGPD/ISO/OWASP. |

**NO APLICABLES a esta entrega local:** cambios de DNS, apertura de firewall
externo y revocación remota automática; se excluyen por alcance, no se marcan
verificados. VPN real, SFTP corporativo, TURN, Google y entrega de correo siguen
**PENDIENTES** donde falte evidencia externa.

## Riesgos y resultados históricos

Al 2026-10-02:

- Baseline publica: Gitleaks 0 en el arbol y 0 en su unico commit raiz.
- El historial local anterior, conservado solo en el rollback externo, contenia 14 senales y no se importo en la baseline publica.
- Credenciales operativas pendientes de demostrar como rotadas o revocadas: PostgreSQL migracion, PostgreSQL aplicacion, Redis aplicacion y bootstrap de administrador legado.
- Trivy 0.75.0: las cinco imágenes validadas tienen 0 HIGH/CRITICAL, incluyendo vulnerabilidades sin parche. El runtime del backend se ha trasladado a Ubuntu 26.04 actualizado, conservando SFTP y herramientas PostgreSQL 18; el antiguo hallazgo de OpenSSH en Debian no describe la imagen actual. La evidencia y límites locales figuran en [validación](docs/LOCAL_VALIDATION.md). Reescanee cada build.
- El 2026-10-03 se escanea la nueva imagen PostgreSQL con gocryptfs: 0
  HIGH/CRITICAL, incluidos hallazgos sin parche. El cifrado del volumen activo
  no cifra todo Windows ni acredita borrado forense del VHDX; conserve el perfil
  DPAPI y una recuperacion de claves independiente antes de reinstalar el equipo.
- `RUSTSEC-2023-0071` permanece solo en lockfile; condiciones y fecha de revision en [excepciones Rust](backend-rust/SECURITY_ADVISORY_EXCEPTIONS.md).

El gate de publicacion Git de la baseline limpia es independiente. El gate de despliegue con credenciales operativas permanece `FAIL` hasta demostrar su rotacion o revocacion; no se debe convertir un bloqueo externo en PASS.

## Rotacion de secretos

1. Cree backup verificado de PostgreSQL y media.
2. Genere el reemplazo fuera del repositorio.
3. Sustituya el archivo exacto en `.secrets/`.
4. Recree solo los consumidores afectados.
5. Compruebe readiness, login, PII y backup/restore.
6. Demuestre que el valor antiguo falla y el nuevo funciona antes de retirar compatibilidad anterior.

No muestre valores en documentacion, commits, argumentos, logs ni tickets.

## Historial público y preservación local

La baseline de octubre se creó sin importar el historial local anterior. Ese
hecho histórico **no autoriza crear otra raíz ni reescribir Git ahora**.
Conserve bundles y snapshots existentes. Antes de publicar, ejecute:

```powershell
git fsck --full
gitleaks dir . --config .gitleaks.toml --redact
gitleaks git . --config .gitleaks.toml --redact
```

Revalide Rust, frontend, Compose, E2E y recovery. La publicación actual usa
fetch y push normal a la rama existente, sin force; compruebe SHA, salud y
función después de publicar.

## Respuesta y divulgacion

Para incidentes use el [runbook](infra/monitoring/INCIDENT-RUNBOOK.md). Preserve evidencia, limite alcance y notifique por un canal privado; nunca abra un issue publico con una vulnerabilidad o credencial.
