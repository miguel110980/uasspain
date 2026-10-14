# Instaladores de servidores externos de backup

La entrega documental del 14/10 autoriza publicar estos archivos y actualizar
Docker local después de los gates. Los resultados del 13/10 que siguen son
históricos y no implican una instalación externa nueva. Consulte el cierre
actual en [validación local](../../docs/LOCAL_VALIDATION.md). No se autoriza
ejecutar estos instaladores sobre equipos reales, cambiar firewall o activar VPN.

Integración del 13 de octubre de 2026. Estos archivos son **copias revisadas**
de los dos instaladores disponibles en el Escritorio de OneDrive; los originales
no se modifican. Sólo preparan el servidor externo cuando el técnico los ejecuta
expresamente con privilegios y confirma `INSTALAR`. No forman parte del runtime
Docker ni se ejecutan al arrancar UASSpain.

## Inventario y alcance de entrega

| Componente | Archivo/estado |
|---|---|
| Servidor Windows | [windows/Instalar-Servidor-Backup-UASSpain.ps1](windows/Instalar-Servidor-Backup-UASSpain.ps1) |
| Servidor Linux | [linux/instalar-servidor-backup-linux.sh](linux/instalar-servidor-backup-linux.sh) |
| Cliente WireGuard Windows personalizado | `Instalar-Cliente-WireGuard-UASSpain.ps1`: opcional, no incorporado |
| Lanzador cliente Windows | `EJECUTAR-Cliente-UASSpain.cmd`: opcional, no incorporado |
| Cliente Linux personalizado | `instalar-cliente-uasspain-linux.sh`: opcional, no incorporado |
| ZIP original | No necesario para esta integración, por instrucción expresa del usuario |

Se comprobaron `%USERPROFILE%\Desktop` (no existe en el equipo revisado) y
`%USERPROFILE%\OneDrive\Desktop`. La búsqueda del paquete en las carpetas
ajenas al código/corpus del proyecto no encontró clientes ni ZIP de backup.
No se considera una prueba de ausencia en todo el ordenador. El usuario
precisó: «si ya tienes los dos ejecutables, no necesitas el zip». Se cierra
el alcance de integración con los dos scripts de servidor disponibles.

Ambos servidores generan el paquete privado de conexión: configuración
WireGuard importable con el cliente oficial, identidad SSH y known_hosts.
Los instaladores cliente personalizados sólo se copian si el técnico aporta
sus originales revisados; no se necesitan para preparar el servidor y no
se crean sustitutos ficticios. Se conservan las comprobaciones obligatorias
de red, seguridad y confirmación. No reutilizar scripts antiguos de `infra/`
sin una auditoría independiente. El peer, la conexión Docker y las copias
reales siguen pendientes de configurar y validar por el técnico.

## Parámetros Windows

PowerShell 5.1 de 64 bits elevado, Windows con capacidad oficial OpenSSH,
cmdlets de red/firewall y disco local. La instalación real no está probada.
WireGuard existente se reutiliza; si falta, se descarga el MSI oficial 1.1.1
de la arquitectura amd64/arm64 y se exige firma Authenticode válida de
WireGuard. Esa versión figura en las
[descargas oficiales](https://download.wireguard.com/windows-client/),
consultadas durante esta integración. No se ha descargado/instalado el MSI.

| Parámetro | Valor inicial / comportamiento |
|---|---|
| `-BackupAddress` | IP física del servidor externo; se solicita si falta y debe pertenecer al host |
| `-UasAddress` | IP física autorizada del host UASSpain; se solicita si falta |
| `-WireGuardPort` | `51820/UDP`; pregunta interactiva o parámetro, rango 1024–65535 |
| `-SftpPort` | `22222/TCP`; pregunta interactiva o parámetro, rango 1024–65535 |
| `-BackupDirectory` | Carpeta nueva `C:\UASSpainBackups` por defecto; se solicita, sin UNC/reparse points ni rutas de sistema/usuarios |
| `-VpnBackupAddress` / `-VpnUasAddress` | `10.203.77.1` / `10.203.77.2`; dos hosts RFC1918 de la misma subred /30 |
| `-SftpUser` | `uasbackup_sftp`; nombre local exclusivo en minúsculas |
| `-ClientPackageDirectory` | Carpeta opcional de clientes Windows originales revisados; si no existen, no se copian |
| `-MinimumFreeGB` | `20`, modificable; capacidad mínima previa a instalar |

Ejemplo **para el técnico en el servidor externo, tras revisión y autorización**;
sustituir todas las direcciones/rutas según su entorno:

```powershell
powershell.exe -NoProfile -File .\scripts\backup-external\windows\Instalar-Servidor-Backup-UASSpain.ps1 -BackupAddress 192.168.1.39 -UasAddress 192.168.1.38 -VpnBackupAddress 10.203.77.1 -VpnUasAddress 10.203.77.2
```

No cambiar políticas de ejecución del equipo para evitar una revisión o una
firma requerida. Los prechecks bloquean ante almacenamiento, cuenta, túnel,
reglas propias, configuración SSH o dependencias de sshd preexistentes.
No se reemplaza un SSH parado que ya tenga configuración. Tampoco se
deshabilita una regla genérica SSH ajena: sólo la creada al instalar ahora
OpenSSH si no existía antes. Un fallo deja estado parcial protegido para
revisión; no existe rollback destructivo ni reanudación automática.

Tras una instalación autorizada genera instrucciones en
`%ProgramData%\UASSpainBackupSetup\INSTRUCCIONES_UASSPAIN.txt` y el paquete
**privado** `PARA_LLEVAR_AL_PC_UASSPAIN` bajo esa carpeta. No guardar ese
paquete con secretos dentro del repositorio ni en una carpeta sincronizada.

## Parámetros Linux

Bash, root/sudo, systemd, iproute2 (`ip`, `ss`), realpath/stat/df/awk/grep/cut,
apt-get o dnf. El adaptador contempla Debian/Ubuntu y Fedora/RHEL/Rocky/Alma;
**ninguna instalación real en esas distribuciones se ha probado en esta tarea**.
No es un instalador universal, de NAS ni de sistemas sin systemd. SELinux
enforcing bloquea hasta una adaptación técnica autorizada; no se deshabilita.

| Parámetro | Valor inicial / comportamiento |
|---|---|
| `--backup-ip` / `--uas-ip` | IP física del backup / UASSpain; se solicitan si faltan |
| `--wg-port` / `--sftp-port` | `51820/UDP` / `22222/TCP`; rango 1024–65535 |
| `--directory` | Carpeta nueva `/srv/uasspain-backup`; bajo `/srv` o `/mnt`, sin espacios, symlinks ni padres escribibles por otros |
| `--vpn-server-ip` / `--vpn-client-ip` | `10.203.77.1` / `10.203.77.2`, hosts RFC1918 de una misma /30 |
| `--sftp-user` | `uasbackup_sftp`; cuenta exclusiva no privilegiada |
| `--client-package-dir` | Carpeta opcional de clientes originales revisados; si no existen, no se copian |
| `--minimum-free-gb` | `20`, modificable; límite mínimo previo a instalar |

Ejemplo pendiente de revisión y autorización en el host externo:

```bash
sudo bash scripts/backup-external/linux/instalar-servidor-backup-linux.sh \
  --backup-ip 192.168.1.39 --uas-ip 192.168.1.38 \
  --vpn-server-ip 10.203.77.1 --vpn-client-ip 10.203.77.2
```

Instala sólo paquetes ausentes, configura `/etc/uasspain-backup/`, el túnel
`wg-uasbackup` y servicios systemd dedicados para firewall y SFTP. El SSH
principal existente conserva su configuración y clave. Cuenta sin shell,
chroot root y carpeta `/incoming` con escritura sólo del usuario de backup.
El paquete **privado** queda en `/var/lib/uasspain-backup-provision`, protegido
por permisos; las instrucciones quedan en
`/etc/uasspain-backup/INSTRUCCIONES_UASSPAIN.txt`.

Las reglas nftables propias se aplican de forma atómica con validación previa;
restringen IP físicas para UDP, interfaz/IP VPN para SFTP e impiden esos
puertos por IPv6. UFW/firewalld activos reciben reglas limitadas sin reset ni
reload global. Repetir el instalador con recursos previos **bloquea sin
sobrescribirlos**; no se presenta como instalación/reanudación idempotente
certificada. Repetir el servicio firewall provisionado recompone únicamente
su tabla propia. Revisar estado parcial y políticas existentes antes de
reanudar mediante un procedimiento técnico aprobado.

## Integración con los tres destinos

La [guía de infraestructura](../../docs/infrastructure-operations.md#servidores-externos-wireguard-y-sftp)
explica VPN, clientes, firewall, claves, montaje seguro de credenciales,
configuración desde administración y segundo servidor con otra subred.
Los destinos local, externo 1 y externo 2 se activan independientemente;
sólo los activados reciben copias. Una VPN activa no acredita un destino
SFTP funcional. Mantener cifrado de origen, autenticación por clave y pin
de host; verificar capacidad, integridad, FULL/delta y recuperación aislada.
Consultar [backups](../../docs/BACKUP_RESTORE.md) y
[programación/retención](../../docs/BACKUPS_SIMPLIFIED.md).

## Revisión y resultados verificables

Defectos corregidos únicamente en las copias integradas:

- Ubicación del paquete cliente opcional explícita; Linux ya no depende de `$PWD`
  y ninguno de los servidores exige archivos cliente externos para preparar el host.
- Parámetros para IP, red privada /30, puertos, usuario y capacidad; rechazo
  de valores peligrosos, solapamientos locales, enlaces y rutas de sistema.
- Confirmación expresa antes de instalar componentes o modificar servicios.
- Windows conserva SSH preexistente, restringe SFTP a la interfaz VPN,
  elimina `X11Forwarding` no soportado por el OpenSSH Windows documentado y
  cita la ruta chroot/authorized_keys correctamente si contiene espacios.
- Descarga MSI a una carpeta temporal única con ACL restringida y verificación
  de firma; sin sobrescribir un archivo previo del directorio temporal.
- Linux usa clave SSH propia, comprueba capacidad, mantiene SSH previo,
  bloquea el autoarranque SSH durante la instalación de paquetes nuevos,
  trata sockets SSH nuevos y corrige instalación parcial del ruleset propio.
- Texto final usa las direcciones elegidas, sin IP física fija engañosa.

Las comprobaciones estáticas verifican sintaxis y estructura, **no el
funcionamiento de servicios ni compatibilidad real de plataforma**. Los
resultados ejecutados y hashes de preservación se registran en
`.run/backup-installers-20261013/` fuera de Git. SMTP, OTP y Postmark siguen
[pendientes de producción](../../README.md#configuraciones-pendientes-antes-de-producción).
No se ejecutan instaladores, abren puertos, configuran secretos reales ni
modifican PostgreSQL/Docker durante esta tarea. No hay commit ni push.

## Estado de entrega de esta integración

| Verificación | Resultado observado |
|---|---|
| Copias servidor Windows/Linux | IMPLEMENTED: dos archivos disponibles integrados; ZIP y clientes personalizados opcionales |
| Parser PowerShell | PASS, sintaxis del archivo completo; diez parámetros documentados |
| Validadores puros PowerShell | PASS, 18 casos IPv4, /30 y conflictos de rutas con datos sintéticos; sin ejecutar el instalador |
| `bash -n` | PASS, instalador completo y script firewall generado; sin ejecutar esos scripts |
| Validadores puros Linux | PASS, 20 casos IPv4/puertos, en contenedor aislado sin red ni privilegios |
| Clientes personalizados opcionales | PASS, tres casos Windows y tres Linux: ausencia, presencia parcial y completa; sólo fixtures propios, sin ejecutar clientes ni instalar servicios |
| ShellCheck | NOT_RUN: no disponible en host ni en la imagen de comprobación; no se instala software para esta tarea |
| OpenSSH/WireGuard/SFTP/firewall | Revisión estática realizada; instalación, conectividad y servicios reales NOT_RUN por alcance autorizado |
| Referencias Markdown | PASS, enlaces internos y sus anclas comprobados; recuento en evidencia local |
| Secretos | Gitleaks worktree: 0 hallazgos; escaneo redactado en `.run/backup-installers-20261013/secrets.json` |
| Originales | SHA-256 previo/posterior idéntico en los dos archivos |
| Cambios anteriores | Hashes de 31 archivos pendientes, incluidos OAuth y el VBS ajeno, conservados |
| Git diff | `--check` y `--cached --check` PASS, índice sin cambios; cuatro Markdown modificados y tres archivos nuevos de esta integración |
| SMTP / OTP / Postmark | Documentados expresamente como pendientes; HTTP 400/503 históricos conservados; no envíos/configuración real |
| Docker actual | Consulta de sólo lectura: cinco servicios healthy y cuatro health endpoints HTTPS 200; no rebuild/despliegue |
| Integración autorizada | **PASS** para los dos scripts y documentación con comprobaciones estáticas; el ZIP no es un bloqueo |
| Instalación / conexión real / producción | **NOT_RUN**: no autorizadas en esta tarea; no se declaran verificadas |

La primera comprobación auxiliar Linux extrajo más código del previsto y se
detuvo por falta de privilegios dentro del contenedor aislado, antes de cambios.
Se corrigió para extraer exclusivamente funciones puras y su repetición pasó
20/20. El artefacto de pruebas no inicia servicios, instala paquetes ni consulta
el firewall. Las reparaciones y fallos no se presentan como pruebas omitidas.

Preservación de originales (no contienen claves privadas generadas):

| Archivo en Escritorio OneDrive | SHA-256, antes y después |
|---|---|
| `Instalar-Servidor-Backup-UASSpain.ps1` | `7cdccd2804d092fe4598bc362e83800f66d4e22166b50de670eb8f68e6d68a84` |
| `instalar-servidor-backup-linux.sh` | `4816e41058da36ae0df366cc27e5318d40a3269c8eaff5da1f8cfee23a6a8fc0` |

Informe obligatorio aplicado al alcance instaladores/documentación de esta tarea:

```text
CODE=PASS_AVAILABLE_FILES
TESTS=PASS_STATIC_AND_PURE_HELPERS
DOCKER_BUILD=NOT_RUN_USER_SCOPE
DOCKER_DEPLOY=NOT_RUN_USER_SCOPE
POSTGRES=HEALTHY
REDIS=HEALTHY
BACKEND=HEALTHY
FRONTEND=HEALTHY
NGINX=HEALTHY
CONTAINERS_HEALTHY=5/5_EXISTING_VERSION
HEALTHZ=PASS_HTTP_200
READYZ=PASS_HTTP_200
API_LIVE=PASS_HTTP_200
API_READY=PASS_HTTP_200
E2E_DOCKER=NOT_RUN_USER_SCOPE
FUNCTIONAL_TEST=NOT_RUN_INSTALLATION_PROHIBITED
SECURITY=PASS_STATIC_ONLY
SECRETS_IN_GIT=0_NEW_WORKTREE_FINDINGS; INDEX_UNCHANGED
COMMIT=NOT_RUN_USER_SCOPE
PUSH=NOT_RUN_USER_SCOPE
LOCAL_HEAD=96fe1733508df26fcfa6f0842c3f3e27bdf8db35
ORIGIN_MAIN=96fe1733508df26fcfa6f0842c3f3e27bdf8db35_LOCAL_REF_NOT_FETCHED
CRITICAL=0_IN_SCOPED_STATIC_REVIEW
HIGH=0_IN_SCOPED_STATIC_REVIEW
ERRORS=[]
INTEGRATION_STATUS=PASS_TWO_SERVER_INSTALLERS_AND_DOCUMENTATION
CHANGE_STATUS=NOT_COMPLETE_RUNTIME_NOT_VALIDATED
SEQUENCE=FINISHED_AUTHORIZED_STATIC_SCOPE
CURRENT=STATIC_DELIVERY
NEXT=NOT_RUN_USER_SCOPE
REASON=INSTALLATION_AND_DEPLOYMENT_NOT_AUTHORIZED
```

En el cierre del 13/10, OAuth no tenía autorización de despliegue y se conservó
sin sobrescribir. La nueva autorización del 14/10 permite actualización local
y publicación después de validar; no transforma aquellos resultados en pruebas
de instalación ni autoriza infraestructura externa.

Archivos incorporados: los dos servidores de la tabla de inventario y este
README (tres archivos). Documentación actualizada:
[README principal](../../README.md),
[backup/recuperación](../../docs/BACKUP_RESTORE.md),
[infraestructura](../../docs/infrastructure-operations.md) y
[correo API/SMTP](../../docs/mail-api-smtp-operations.md).
No se modificaron en esta tarea Compose, Dockerfiles, frontend, backend,
migraciones, configuración persistida, credenciales o scripts OAuth previos.
