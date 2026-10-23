# Preparación de infraestructura UASSpain

La aplicación conserva cinco servicios: Nginx, frontend, backend Rust, PostgreSQL cifrado y Redis. La sección Configuración inicial se ha retirado; sus datos guardados se conservan. WireGuard mantiene su editor público en **Conexiones VPN**; los tres destinos mantienen su editor en **Copias de seguridad → Servidores de copias de seguridad**. El despliegue se registra en [validación local](LOCAL_VALIDATION.md).

La configuración guardada no instala software, activa WireGuard, abre puertos, crea montajes ni aplica rutas. `CONFIGURED` y `VERIFIED` tienen significados distintos. Las comprobaciones pendientes muestran BLOCKED/NOT_RUN; no se convierten en PASS mediante confirmación manual.

## Plataformas

- Windows 11: comprobar motor Linux y Compose, requisitos de virtualización y disponibilidad de FUSE en el motor que aloja PostgreSQL cifrado. El arranque local existente sigue siendo `powershell.exe -NoProfile -File scripts/start-encrypted-stack.ps1 -Build`.
- Windows Server: preparar un motor compatible con los cinco contenedores Linux o una VM Linux validada. Docker Desktop no está soportado en Windows Server, según [Docker](https://docs.docker.com/desktop/setup/install/windows-install/). No extrapolar una prueba de Windows 11 a Windows Server.
- Ubuntu/Debian/Linux: usar los scripts de preparación sin asumir apt ni systemd. La ejecución en un contenedor Linux sólo acredita ese runtime; no acredita el sistema operativo físico, una distribución o un NAS.
- NAS: validar SFTP con OpenSSH compatible o un montaje local autorizado, identidad del servidor, permisos, capacidad y recuperación. SMB requiere montaje privado y permisos corporativos: no se expone a Internet ni se presenta un UNC como una carpeta accesible desde Linux.

Consultar el informe de auditoría para distinguir pruebas realizadas, contratos sintéticos y plataformas NOT_RUN. No hay una declaración universal de compatibilidad.

## Requisitos y preparación

1. Docker con contenedores Linux y Compose compatible con las opciones del proyecto. Preparar virtualización, FUSE, recursos y red; preservar los volúmenes existentes.
2. Provisionar los secretos y certificados del despliegue fuera de Git con identidades de servicio y permisos mínimos. Conservar la clave actual del volumen y las claves de cifrado del backend: una reinstalación no autoriza regenerarlas.
3. Preparar almacenamiento persistente para PostgreSQL, Redis, medios, copias, claves y assets. Verificar capacidad y acceso del UID del servicio, incluidos los mounts.
4. Si se requiere VPN, instalar WireGuard mediante el procedimiento corporativo autorizado y la [documentación oficial](https://www.wireguard.com/install/). Los scripts `scripts/infrastructure/` sólo preparan/inspeccionan; los instaladores externos descritos más abajo sí contemplan instalación en un host dedicado, con confirmación técnica y paquete completo. No se han ejecutado durante esta integración.
5. Ejecutar `scripts/infrastructure/prepare.ps1` en Windows o `scripts/infrastructure/prepare.sh` en Linux. Por defecto inspeccionan requisitos, sin instalaciones ni modificaciones.

El script PowerShell admite `-AllowedRoot`, `-Directories` y `-PrepareDirectories`. Sólo prepara rutas bajo la raíz expresamente autorizada, rechaza reparse points y solicita confirmación mediante ShouldProcess. No cambia recursivamente permisos ni sobrescribe directorios. Preparar ACL y montajes siguiendo la política corporativa, con el usuario responsable.

Los scripts antiguos bajo `infra/wireguard/`, `infra/firewall/` y `infra/config.*` contienen supuestos de una infraestructura anterior, incluidos direcciones y operaciones amplias. Se conservan por compatibilidad, pero **no son el procedimiento de esta entrega y no deben ejecutarse para este despliegue sin una revisión independiente**.

## Agente de lectura del anfitrión

El backend no consulta WireGuard dentro del contenedor ni recibe comandos desde el navegador. El colector se ejecuta en el anfitrión real y escribe una observación firmada en una carpeta privada. Esa carpeta se monta **read-only** en el backend. No se incorpora otro servicio Docker, socket de administración, agente público ni contenedor privilegiado.

Los colectores usan `wg show interfaces` y campos públicos concretos: public-key, listen-port, peers, endpoints, allowed-ips, latest-handshakes, transfer y persistent-keepalive. No usan dump, showconf, private-key ni preshared-keys: el formato dump incluye claves privadas/preshared, según el [manual de WireGuard](https://man7.org/linux/man-pages/man8/wg.8.html). Windows consulta también los servicios del túnel; Linux obtiene interfaces y redes mediante `ip -j`. La ausencia de herramientas/permisos se registra explícitamente.

Preparar una clave HMAC **independiente**, aleatoria y de al menos 32 bytes, compartida únicamente entre el colector y backend. No utilizar la clave maestra de cifrado del backend. Provisionar la clave en `.secrets/backup-sftp/infrastructure_agent.key` para el Compose actual y preparar la carpeta de observaciones indicada por `INFRASTRUCTURE_AGENT_DIRECTORY` (por defecto `.run/infrastructure-agent`). Se puede cambiar esa carpeta desde el entorno sin editar código.

Windows, tras preparar las carpetas protegidas:

```powershell
scripts/infrastructure/host-agent.ps1 -InspectOnly
scripts/infrastructure/host-agent.ps1 -KeyFile .secrets/backup-sftp/infrastructure_agent.key -OutputDirectory .run/infrastructure-agent -PrepareKey
```

`-PrepareKey` crea una clave sólo si no existe, mediante creación exclusiva y ACL del propietario/SYSTEM. Nunca reemplaza la anterior ni muestra su valor. Cada ejecución de recolección es puntual. El técnico podrá programarla cada 30 segundos con el Programador de tareas, usando una identidad autorizada; no se instala automáticamente esa tarea.

Linux, con carpetas y permisos preparados:

```sh
python3 scripts/infrastructure/host-agent.py --inspect-only
python3 scripts/infrastructure/host-agent.py --key-file /ruta/protegida/infrastructure_agent.key --output-directory /ruta/observaciones --prepare-key
```

El colector rechaza ejecución dentro de contenedores para evitar identificar Linux como anfitrión de un Docker Desktop Windows. Preparar lectura limitada de los comandos de consulta: las herramientas WireGuard pueden necesitar privilegios del anfitrión. No conceder administración al contenedor ni acceso innecesario a claves. Para Linux usar cron/systemd timer sólo si están disponibles y autorizados; no asumir uno concreto.

El backend verifica HMAC, formato y fecha (máximo 120 segundos; tolerancia futura 15 segundos). Datos ausentes/caducados/inválidos producen BLOCKED; las identidades y rutas de peers deben coincidir, y los handshakes deben ser recientes (180 segundos) para acreditar conexión. El agente identifica también los mounts del backend mediante la identidad real de su proyecto/servicio: una declaración de mapeo sin origen firmado coincidente no acredita acceso al anfitrión. El historial de validaciones persiste en PostgreSQL, pero no sustituye una observación actual.

Los errores de origen son códigos permitidos, sin stderr ni secretos. No se guardan snapshots completos, claves HMAC ni claves privadas en PostgreSQL ni se entregan al navegador.

## VPN y red

### Interpretar estados y errores

| Resultado | Significado y diagnóstico |
|---|---|
| Pendiente de configuración | Faltan parámetros; no demuestra túnel caído ni instalado. Completar sólo datos públicos conocidos. |
| Servicio de supervisión no disponible | Falta observación legible/autenticada o el colector no funciona. Revisar montaje read-only, permisos y ejecución autorizada. |
| `STALE_OR_INVALID_AGENT_MESSAGE` | Observación fuera de frescura, formato o autenticidad admitidos. Revisar relojes UTC, firma HMAC y frecuencia; no mostrar ni reemplazar la clave para silenciarlo. |
| WireGuard pendiente/no verificado | No se acreditan herramienta, interfaz, identidad/configuración o handshake. Revisar el túnel en el host sin activar rutas desde el panel. |
| Desconectada | Sólo usar cuando existe observación válida que acredita pérdida de conexión. No deducirlo de ausencia de agente. |
| Conectada | Requiere evidencia actual y coincidencia de interfaz/peers. No acredita SFTP ni última copia correcta. |
| Destino inaccesible o error de autenticación | Revisar independientemente peer/red, pin SSH, identidad, ruta, permisos y espacio. No basta ping ni handshake. |

Los códigos internos se conservan para auditoría; la interfaz presenta mensajes
comprensibles sin convertir desconocido en PASS. Actualizar una pantalla no
instala el colector ni modifica servicios del anfitrión.

En **Conexiones VPN → Configuración de conexión VPN**, introducir adaptador real, IP/prefijo privado, puerto UDP, clave pública local, claves públicas de equipos autorizados, endpoints, redes permitidas y keepalive. Las observaciones verificadas sólo completan campos vacíos y no reemplazan configuración existente; varios adaptadores requieren selección. Revise y guarde. La descarga pública representa lo guardado, no cambios pendientes ni claves privadas. No instala ni activa un túnel ni constituye una importación automática.

No se asume `wg0` ni una dirección de empresa. No se admiten rutas `/0`, claves privadas, rutas relativas ni peers con redes solapadas incompatibles. Añadir las redes corporativas no detectables al inventario de redes reservadas. La comprobación compara el rango de la VPN con redes locales/Docker observadas y con esas reservas. Si el inventario no es completo, la comprobación no se acredita.

Preparar la configuración WireGuard de cada equipo conforme a la [guía oficial](https://www.wireguard.com/quickstart/), sin activar un túnel ni alterar el enrutamiento desde el panel. El endpoint de cada peer y su puerto se configuran por separado; un handshake no prueba acceso al almacenamiento.

Firewall: `scripts/infrastructure/wireguard-firewall.ps1 -Port <puerto> -PeerAddress <IP>` y la variante `.sh --port <puerto> --peer <IP>` muestran la regla prevista sin aplicarla. PowerShell necesita `-Apply` y confirmación técnica; Linux necesita `--apply-confirmed` y privilegios expresos. Añaden exclusivamente UDP para esa IP, sin reset ni cambios de política. Linux soporta UFW activo o firewalld activo; nftables/otros requieren revisión manual. No ejecutar estas acciones como parte de pruebas locales.

## Destinos y credenciales de backup

Tres slots independientes: local, externo 1 y externo 2. Nombre, dirección/dominio, puerto, identidad SFTP, ruta, peer privado y activación se editan en administración. No se sustituyen destinos anteriores ni se crean nuevos por una migración. Las claves SSH y known_hosts se provisionan en el almacén protegido del sistema, no en campos públicos, imágenes o logs. Sus referencias se restringen a `BACKUP_CREDENTIAL_ROOTS`; por defecto `/run/backup-secrets`. Conservar secretos al editar otros campos.

Para rutas locales preparar mounts y `BACKUP_LOCAL_ALLOWED_ROOTS` usando el separador de rutas del sistema del **servicio** (en Linux `:`). La ruta del anfitrión Windows/UNC y la del servicio Linux son distintas. Declarar el mapeo en el asistente no crea un mount ni autoriza una ruta arbitraria. El backend valida contención en raíces autorizadas y rechaza enlaces peligrosos, también al transferir o recuperar.

«Comprobar conexión» verifica resolución/conexión, autenticación, identidad SSH, carpeta, escritura, lectura idéntica, eliminación de su archivo único y capacidad. La capacidad SFTP requiere statvfs; si no está disponible no se presenta como conexión completamente validada, de acuerdo con el [manual de OpenSSH SFTP](https://man.openbsd.org/sftp.1). No basta ping. El archivo remoto se elimina después de verificar sus bytes; fallos o identidad incierta no autorizan borrar otros archivos.

Los destinos externos de producción requieren IP privada coincidente, known_hosts y una observación autenticada con handshake reciente para la red del destino. La excepción sin VPN se utiliza exclusivamente en la red sintética de E2E, donde se verifica SFTP real. No copiar esa configuración a producción.

Sólo destinos activados reciben réplicas. Todos OFF impide crear la copia. Los completos y deltas mantienen manifiestos, dependencia de cadena, cifrado e integridad. Una réplica se descarga y verifica antes de registrar éxito; fallos parciales no son éxito global. No se eliminan backups por desactivar un destino. La publicación local evita sobrescribir un archivo existente.

## Servidores externos: WireGuard y SFTP

El [inventario de instaladores](../scripts/backup-external/README.md) contiene las
rutas reales, parámetros y dependencias. Se integraron el servidor Windows y
el servidor Linux. Por indicación del usuario, su integración no depende del
ZIP ni incluye clientes personalizados/lanzadores no disponibles. Ambos
servidores generan el archivo WireGuard del peer y las claves SSH/known_hosts
para configurar el cliente oficial; pueden incluir scripts cliente revisados
si el técnico los aporta, pero su ausencia no bloquea preparar el servidor.
Los prechecks de privilegios, red, rutas, servicios y confirmación se conservan.

Cada servidor requiere autorización del técnico y una revisión previa de red,
almacenamiento, SSH y firewall. Los ejemplos `51820/UDP`, `22222/TCP`,
`10.203.77.1/30` y `10.203.77.2/30` son valores iniciales modificables.
El instalador comprueba solapamientos con rutas IPv4 del host de backups;
el técnico debe comprobar también Docker, LAN, otras VPN y redes corporativas
en el host UASSpain. Para el segundo servidor elegir **otra subred /30** y
distintos nombres de interfaz/archivos del cliente; no activar dos clientes
con el mismo nombre o dirección. La configuración del cliente oficial se
realiza siguiendo los pasos de entrega; no se presenta como una instalación
automática del peer ni como una conexión ya validada.

Windows exige un destino nuevo en disco local, sin reparse points ni rutas
del sistema/usuarios. Reutiliza binarios oficiales OpenSSH cuando es seguro;
**no reemplaza un `sshd_config` preexistente, aunque el servicio esté parado**.
Un SSH existente requiere host dedicado o adaptación supervisada fuera del
instalador. Genera una cuenta local exclusiva, ACL por SID, claves Ed25519 y
known_hosts a partir de la clave pública local. SFTP utiliza `internal-sftp`,
chroot no escribible y `/incoming` escribible sólo por la cuenta de backup,
según la [configuración de OpenSSH Windows](https://learn.microsoft.com/en-us/windows-server/administration/OpenSSH/openssh-server-configuration).
Se valida la configuración con `sshd -t` antes de arrancar. El puerto SFTP
se liga a la IP VPN y su regla a la interfaz VPN detectada y al peer concreto.
El puerto UDP sólo permite la IP física UASSpain. No se abren puertos del router.

Linux requiere systemd, apt-get o dnf según la distribución, iproute2,
herramientas POSIX y soporte WireGuard del kernel. Instala sólo dependencias
ausentes, usa un servicio SFTP independiente y su propia clave de host,
conservando el SSH principal existente. Antes de instalar un SSH ausente,
comprueba que sus unidades también estén ausentes y las enmascara temporalmente
para impedir autoarranque TCP/22 desde el gestor de paquetes. Tras instalar,
deshabilita únicamente esos servicios/sockets generales nuevos y retira sus
masks runtime, sin arrancarlos, antes de activar SFTP dedicado. Si falla esa
fase se conservan los masks protectores para revisión técnica. El directorio
nuevo se limita a `/srv` o `/mnt`, con
padres root no escribibles por otros y sin symlinks. No se declara compatible
con todas las distribuciones: SELinux/AppArmor, soporte del kernel y versiones
del sistema deben revisarse en el equipo real; SELinux enforcing bloquea
este instalador hasta una adaptación autorizada, sin deshabilitar protección.

La tabla nftables propia se valida y aplica como un lote atómico, sin reset del
ruleset global. UFW/firewalld activos reciben sólo permisos para los pares
IP/puerto; firewalld añade reglas runtime y persistentes sin recargar reglas
ajenas. Una tabla propia existente se reemplaza únicamente desde el servicio
ya provisionado, evitando que un arranque acepte una tabla parcial. Una
política externa de firewall puede seguir impidiendo conectividad: el
arranque del servicio no acredita una transferencia remota.

El usuario SFTP usa autenticación exclusivamente por clave, sin shell, TTY ni
forwarding. El servidor genera un **paquete privado** de aprovisionamiento
para el cliente: incluye claves privadas SSH/WireGuard protegidas por ACL o
permisos 0600. Transportarlo por un medio cifrado aprobado, fuera de Git,
OneDrive, correo y logs; instalarlo con permisos mínimos en el host UASSpain.
La copia fuente de los instaladores contiene código, no claves generadas.
Verificar fuera de banda la huella de la clave SSH: no usar `ssh-keyscan`
como sustituto de esa comprobación ni desactivar `StrictHostKeyChecking`.

Para configurar el cliente oficial en el host UASSpain, el técnico autorizado
instala WireGuard conforme a la [guía oficial](https://www.wireguard.com/install/)
y traslada el paquete privado mediante el canal cifrado aprobado. En Windows,
importar `UASSpainBackupCliente.conf` desde la aplicación oficial y verificar
que IP, peer público, endpoint y redes permitidas corresponden al servidor.
En Linux, preparar la configuración bajo `/etc/wireguard` con propietario root
y permisos 0600; usar un nombre de interfaz único de hasta 15 caracteres,
por ejemplo `uas-backup1.conf` y `uas-backup2.conf`, conforme al
[parser oficial de wg-quick](https://git.zx2c4.com/wireguard-tools/tree/src/wg-quick/linux.bash).
No sobrescribir una
configuración previa. El nombre generado `UASSpainBackupCliente.conf` debe
renombrarse para ese uso Linux. Activar y programar el túnel mediante el
mecanismo disponible y autorizado en el anfitrión, sin ejecutarlo desde el
backend ni ampliar rutas a `/0`. Consultar la [guía WireGuard](https://www.wireguard.com/quickstart/).
Estas operaciones de cliente quedan pendientes de realizar y probar en el
equipo real; no se crean scripts de cliente ficticios.

Tras comprobar el cliente y el handshake, configurar cada destino
desde **Backups → Destinos** y la VPN desde **Infraestructura → Configuración
inicial**. Introducir nombre, host VPN, puerto SFTP, identidad técnica, ruta
remota `/incoming`, peer y activación independiente. La ruta física del
servidor Windows/Linux no es la ruta remota del chroot. Provisionar las claves
de externo 1/2 y known_hosts en el almacén ya montado de sólo lectura;
comprobar acceso del UID del backend y mantener `BACKUP_REQUIRE_VPN=true`.
La dirección VPN del host puede necesitar un montaje/enrutamiento Docker
autorizado y una observación firmada actual del agente: no basta rellenar el
panel ni recibir ping.

Aceptar el destino sólo tras handshake, autenticación y pin SSH correctos,
capacidad, escritura/lectura/borrado de su archivo temporal y transferencia
cifrada con integridad. Probar local, externo 1 y externo 2, y la selección
independiente de destinos. Verificar un FULL y un delta con toda su cadena y
realizar recuperación aislada de PostgreSQL y media antes de producción.
Consultar [programación/retención](BACKUPS_SIMPLIFIED.md) y
[recuperación](BACKUP_RESTORE.md); no eliminar backups previos ni inventar
plazos/RPO/RTO. Un fallo parcial detiene aceptación; una segunda ejecución
del instalador bloquea ante recursos previos en lugar de sobrescribirlos.
Guardar la fase/error y revisar el estado parcial sin borrar claves, datos,
usuarios ni configuración para intentar forzar una instalación.

## Arranque, migración y recuperación

Windows utiliza el procedimiento oficial ya indicado. Linux dispone de `scripts/start-encrypted-stack.sh --build --key-file <clave-protegida-existente>` para **instalaciones cifradas existentes**. Exige `POSTGRES_CIPHERTEXT_VOLUME_NAME` explícito y volumen presente; verifica gocryptfs.conf y sólo entrega la clave por stdin a tmpfs si el volumen está bloqueado. No regenera claves ni inicializa un volumen en esta modalidad.

Para una instalación Linux nueva se prepara una clave protegida con `new-linux-storage-key.py --output <ruta-absoluta> --confirm-new-installation`, que usa creación exclusiva y nunca sobrescribe. El arranque requiere además `--initialize-new --confirm-new-installation`; rechaza **cualquier volumen existente**, crea únicamente el volumen nuevo nombrado explícitamente y verifica que esté vacío antes de entregar la clave. La entrega de claves usa stdin/tmpfs, sin mostrarlas ni ponerlas en argv. Configurar secretos, certificados y FUSE previamente. Esta vía de primera instalación no se ha ejecutado sobre un anfitrión Linux corporativo y no se presenta como validación real de plataforma.

No copiar una clave DPAPI Windows a Linux esperando descifrarla. Una migración entre anfitriones exige backup cifrado recuperable, gestión autorizada de claves, restauración **aislada**, comparación de datos y un plan de corte aprobado. Nunca restaurar automáticamente un backup antiguo sobre datos actuales.

La migración `0029_infrastructure_preparation.sql` es aditiva: configuración versionada y evidencias, sin cambiar destinos ni claves. Antes de aplicarla: snapshot cifrado, checksum, descifrado y restauración aislada comprobados. La reversión conservadora utiliza la misma imagen consciente del esquema: `INFRASTRUCTURE_ENABLED=false` bloquea PUT, validación y exportación con HTTP 503 y muestra la preparación deshabilitada. La lectura administrativa, autenticación y backups mantienen sus controles; configuración, destinos y evidencias permanecen. Para reactivar, establecer `true` y verificar de nuevo. Cada cambio de runtime local se aplica por el arranque oficial; no se aplica automáticamente ni desde una petición manipulada del navegador.

La prueba de reversión se limita a E2E: deshabilitar → comprobar rechazo de escrituras y conservación exacta de configuración/destinos/esquema → reactivar → comprobar disponibilidad. También se restaura la configuración anterior de los fixtures por IDs comprobados. No es una restauración de producción ni una prueba de downgrade de imágenes. Un paquete de reversión de código debe conservar la migración 0029 y sus permisos: SQLx puede rechazar una imagen anterior que desconozca una migración aplicada. No borrar filas de SQLx ni restaurar datos antiguos para forzarlo. No editar migraciones aplicadas ni ejecutar down -v/prunes.

Consultar programación/inventario existentes para frecuencia, completos/deltas, checksums, resultados por réplica y restauración aislada. Una copia válida exige recuperar toda su cadena y verificar PostgreSQL y medios. Conservar copias anteriores y políticas aprobadas.

## Diagnóstico y mantenimiento

- Agente BLOCKED: comprobar archivo/clave/mount, ACL, firma y recolección periódica. No cambiar la clave para arreglar un error de acceso sin investigar.
- VPN DISCONNECTED: comprobar interfaz seleccionada, identidad pública, dirección/puerto, redes de peer y fecha del handshake. No confundir tráfico antiguo con conexión activa.
- Destino inaccesible: comprobar DNS, red VPN, autenticación, known_hosts, ruta chroot/mount, cuota y espacio. Un cambio de configuración invalida la activación previa.
- Capacidad desconocida: validar df/statvfs con el proveedor; no inventar espacio libre.
- Backup parcial/fallido: consultar cada réplica y mantener la copia anterior. No declarar éxito mientras falle un destino habilitado.
- Rotación: sustituir credenciales sólo mediante procedimiento autorizado y verificar conexión/recuperación; no eliminar una clave de recuperación todavía necesaria para backups.
- Actualización: gates de código → backup/restauración → rebuild oficial → cinco servicios saludables → HTTP/API → E2E con imágenes actuales → regresión. Commit/push necesitan autorización específica en esta tarea.

## Checklist corporativo pendiente

Confirmar plataforma/motor, FUSE y protección de claves; identidades/ACL; rutas y mounts; DNS/IP y puertos; peers e inventario de redes; WireGuard/firewall revisados; colector autenticado programado; destinos SFTP/known_hosts/cuotas; matriz de activación; copia completa y delta; recuperación aislada; reinicios; salud y regresión. Documentar por separado Windows Server, distribuciones Linux y NAS que realmente se prueben. No declarar PRODUCTION_READY mientras falten esas comprobaciones externas.

## Guía de configuración y puesta en producción

1. Registrar responsable, plataforma real, motor compatible y recursos. El
   inventario de instaladores externos tiene validación estática, **no una
   instalación Windows/Linux certificada**. Los dos servidores generan el
   paquete necesario para el cliente oficial; no se exige un ZIP. Si se usan
   scripts cliente personalizados opcionales, revisarlos antes de ejecutarlos.
2. Planificar dominio, origen público confiable, HTTPS y certificados internos
   y externos conforme a [despliegue](DEPLOYMENT.md). `uasspain.com` mantiene
   una web anterior: esta preparación no autoriza cambios DNS, MX, A, AAAA,
   CNAME, DKIM, Return-Path o nameservers. Sólo el corte corporativo autorizado
   podrá aplicar los registros reales y verificar resolución/TLS.
3. Introducir datos corporativos y preparar secretos fuera de Git e imágenes.
   Conservar DPAPI, claves de recuperación, PostgreSQL cifrado y volúmenes;
   no trasladar claves DPAPI como si fueran claves Linux en claro.
4. Completar [SMTP, OTP y Postmark](mail-api-smtp-operations.md#errores-conocidos-y-validación-corporativa):
   seleccionar un transporte, remitente verificado y destinatario autorizado;
   comprobar recepción, cabeceras, Reply-To y los flujos reales de verificación
   y login. API exclusiva prohíbe SMTP/fallback. No habilitar OTP obligatorio
   para nuevas cuentas/roles antes de acreditar la entrega, ni desactivar
   controles existentes para intentar superar las pruebas.
5. Autorizar y preparar los servidores externos y sus clientes VPN. Elegir
   subredes sin conflictos, IP, puertos, usuarios y rutas; registrar huellas
   SSH y revisar permisos, firewall, servicios automáticos y conectividad
   después de reiniciar. No ejecutar el instalador en el PC de desarrollo.
6. Configurar ambos destinos y el local desde administración, agente firmado,
   activación independiente, programación y retención aprobadas. Generar
   copias cifradas, comprobar todas sus réplicas y efectuar una restauración
   aislada con validación de PostgreSQL, media e integridad histórica.
7. Aplicar cambios runtime sólo con autorización, backup verificado y arranque
   oficial; comprobar cinco servicios saludables, los cuatro endpoints de
   salud HTTPS, sesiones, WSS, permisos, persistencia y regresión Docker.
8. Entregar inventario de versiones/parámetros públicos, responsables y custodia
   separada de secretos; evidencias de cada servidor y transporte, trabajos
   de mantenimiento y recuperación, incidencias y límites. Marcar pendientes
   como BLOCKED/NOT_RUN. La configuración local y pruebas simuladas no permiten
   declarar `PRODUCTION_READY` sin estas comprobaciones corporativas.
