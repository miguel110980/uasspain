# Seguridad de UASSpain

## Arquitectura y controles

- Solo Nginx publica `127.0.0.1:80/443`; backend, frontend, PostgreSQL y Redis permanecen en redes Docker.
- Edge a backend/frontend, backend a PostgreSQL y backend a Redis usan TLS verificado.
- Cookies seguras, sesiones rotadas, RBAC deny-by-default, autorizacion por recurso y validacion Origin protegen HTTP/WS.
- Contenedores usan rootfs de solo lectura, `no-new-privileges`, capacidades minimas y usuarios no root cuando el entrypoint lo permite.
- Secrets se montan desde `.secrets/`; Gitleaks y detect-secrets protegen el pre-commit y las comprobaciones locales.
- Backups se cifran, verifican y auditan. Consulte [backup y recovery](docs/BACKUP_RESTORE.md).

## Riesgos abiertos

Al 2026-10-02:

- Baseline publica: Gitleaks 0 en el arbol y 0 en su unico commit raiz.
- El historial local anterior, conservado solo en el rollback externo, contenia 14 senales y no se importo en la baseline publica.
- Credenciales operativas pendientes de demostrar como rotadas o revocadas: PostgreSQL migracion, PostgreSQL aplicacion, Redis aplicacion y bootstrap de administrador legado.
- Trivy 0.75.0: las cinco imágenes validadas tienen 0 HIGH/CRITICAL, incluyendo vulnerabilidades sin parche. El runtime del backend se ha trasladado a Ubuntu 26.04 actualizado, conservando SFTP y herramientas PostgreSQL 18; el antiguo hallazgo de OpenSSH en Debian no describe la imagen actual. La evidencia y límites locales figuran en [validación](docs/LOCAL_VALIDATION.md). Reescanee cada build.
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

## Baseline publica y preservacion local

La baseline publica se crea como un nuevo commit raiz y no importa objetos del historial local anterior. El bundle Git, el parche del worktree y el snapshot completo se conservan fuera del repositorio como rollback verificable. Antes de publicar, ejecute:

```powershell
git fsck --full
gitleaks dir . --config .gitleaks.toml --redact
gitleaks git . --config .gitleaks.toml --redact
```

Revalide Rust, frontend, Compose, E2E y recovery. La publicacion inicial usa un `push` normal a un remoto vacio; no requiere ni autoriza `--force`.

## Respuesta y divulgacion

Para incidentes use el [runbook](infra/monitoring/INCIDENT-RUNBOOK.md). Preserve evidencia, limite alcance y notifique por un canal privado; nunca abra un issue publico con una vulnerabilidad o credencial.
