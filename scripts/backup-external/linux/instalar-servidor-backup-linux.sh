#!/usr/bin/env bash
# UASSpain - Servidor de backups WireGuard + SFTP (Linux, systemd).
# Adaptadores previstos: Debian/Ubuntu (apt) y Fedora/RHEL/Rocky/AlmaLinux (dnf).
# La instalacion real en esas distribuciones NO ha sido validada en esta entrega.
# Instala OpenSSH si falta; no altera la instancia SSH principal.
set -Eeuo pipefail
umask 077
trap 'printf "\nBLOCKED: fase interrumpida (linea %s). Inspeccionar estado parcial antes de reejecutar.\n" "$LINENO" >&2' ERR

fail() { printf 'BLOCKED: %s\n' "$*" >&2; exit 1; }
info() { printf '\n=== %s ===\n' "$*"; }
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
CLIENT_PACKAGE_DIR=$SCRIPT_DIR
BACKUP_IP= UAS_IP= WG_PORT= SFTP_PORT= TARGET=
VPN_SERVER_IP=10.203.77.1 VPN_CLIENT_IP=10.203.77.2 MINIMUM_FREE_GB=20
SFTP_USER=uasbackup_sftp
while (($#)); do
  case "$1" in
    --backup-ip|--uas-ip|--wg-port|--sftp-port|--directory|--vpn-server-ip|--vpn-client-ip|--client-package-dir|--minimum-free-gb|--sftp-user)
      (($# >= 2)) || fail "Falta valor para $1"
      case "$1" in
        --backup-ip) BACKUP_IP=$2 ;; --uas-ip) UAS_IP=$2 ;;
        --wg-port) WG_PORT=$2 ;; --sftp-port) SFTP_PORT=$2 ;;
        --directory) TARGET=$2 ;; --vpn-server-ip) VPN_SERVER_IP=$2 ;;
        --vpn-client-ip) VPN_CLIENT_IP=$2 ;; --client-package-dir) CLIENT_PACKAGE_DIR=$2 ;;
        --minimum-free-gb) MINIMUM_FREE_GB=$2 ;;
        --sftp-user) SFTP_USER=$2 ;;
      esac
      shift 2 ;;
    *) fail "Parametro desconocido: $1" ;;
  esac
done
[[ $(id -u) == 0 ]] || fail 'Ejecuta con sudo/root.'
command -v systemctl >/dev/null || fail 'Se requiere systemd.'
[[ -f /etc/os-release ]] || fail 'Linux no identificado.'
. /etc/os-release
case "${ID:-}:${ID_LIKE:-}" in
  debian:*|ubuntu:*|linuxmint:*|pop:*|*:debian*) installer=apt ;;
  fedora:*|rhel:*|rocky:*|almalinux:*|centos:*|*:rhel*|*:fedora*) installer=dnf ;;
  *) fail "Distribucion no validada: ${ID:-desconocida}. Sistemas soportados: Debian/Ubuntu y Fedora/RHEL/Rocky/AlmaLinux." ;;
esac
if [[ $installer == apt ]]; then command -v apt-get >/dev/null || fail 'Falta apt-get.';
else command -v dnf >/dev/null || fail 'Falta dnf.'; fi
[[ $SFTP_USER =~ ^[a-z][a-z0-9_]{2,31}$ ]] || fail 'Usuario SFTP no valido.'
for tool in ip ss realpath stat df awk grep cut dirname; do
  command -v "$tool" >/dev/null || fail "Falta dependencia previa: $tool"
done
if command -v getenforce >/dev/null && [[ $(getenforce) == Enforcing ]]; then
  fail 'SELinux enforcing requiere adaptacion autorizada de etiquetas y puertos SFTP. No se deshabilita SELinux.'
fi
valid_ip() {
  local input=$1 a b c d n
  [[ $input =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS=. read -r a b c d <<< "$input"
  for n in "$a" "$b" "$c" "$d"; do
    [[ $n == 0 || $n != 0* ]] || return 1
    (( 10#$n <= 255 )) || return 1
  done
  (( 10#$a > 0 && 10#$a != 127 && 10#$a < 224 ))
}
ip_number() {
  local a b c d
  IFS=. read -r a b c d <<< "$1"
  printf '%s' "$(( (10#$a << 24) + (10#$b << 16) + (10#$c << 8) + 10#$d ))"
}
validate_port() {
  [[ $1 =~ ^[0-9]{4,5}$ ]] && ((10#$1 >= 1024 && 10#$1 <= 65535)) || fail "Puerto invalido: $1"
  printf '%s' "$((10#$1))"
}
ask_port() {
  local prompt=$1 default=$2 answer
  read -r -p "$prompt [${default}]: " answer
  answer=${answer:-$default}
  validate_port "$answer"
}
info 'INSTALADOR SERVIDOR BACKUP LINUX - UASSpain'
echo 'El PC UASSpain no se modificara a distancia. Se generara un paquete cliente seguro.'
if [[ -z $BACKUP_IP ]]; then read -r -p 'IP de ESTE servidor de backups: ' BACKUP_IP; fi
if [[ -z $UAS_IP ]]; then read -r -p 'IP del equipo UASSpain: ' UAS_IP; fi
valid_ip "$BACKUP_IP" && valid_ip "$UAS_IP" || fail 'Una IP no es IPv4 valida.'
[[ $BACKUP_IP != "$UAS_IP" ]] || fail 'Las direcciones LAN deben ser diferentes.'
if [[ -z $WG_PORT ]]; then WG_PORT=$(ask_port 'Puerto WireGuard UDP' 51820); else WG_PORT=$(validate_port "$WG_PORT"); fi
if [[ -z $SFTP_PORT ]]; then SFTP_PORT=$(ask_port 'Puerto SFTP TCP interno a VPN' 22222); else SFTP_PORT=$(validate_port "$SFTP_PORT"); fi
valid_ip "$VPN_SERVER_IP" && valid_ip "$VPN_CLIENT_IP" || fail 'IP VPN no valida.'
for vpn_ip in "$VPN_SERVER_IP" "$VPN_CLIENT_IP"; do
  [[ $vpn_ip =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]] || fail 'La VPN requiere IPv4 privada RFC1918.'
  (( $(ip_number "$vpn_ip") % 4 == 1 || $(ip_number "$vpn_ip") % 4 == 2 )) || fail 'La VPN requiere dos direcciones de host /30.'
done
[[ $VPN_SERVER_IP != "$VPN_CLIENT_IP" ]] && (( ($(ip_number "$VPN_SERVER_IP") >> 2) == ($(ip_number "$VPN_CLIENT_IP") >> 2) )) || fail 'IP VPN distintas de la misma subred /30 requeridas.'
while read -r subnet _; do
  if [[ $subnet =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then subnet=$subnet/32; fi
  [[ $subnet =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/([0-9]|[12][0-9]|3[0-2])$ ]] || continue
  prefix=${subnet##*/}
  ((prefix > 0)) || continue
  ((prefix > 30)) && prefix=30
  (( ($(ip_number "$VPN_SERVER_IP") >> (32-prefix)) != ($(ip_number "${subnet%/*}") >> (32-prefix)) )) || fail "La VPN solapa una ruta local: $subnet"
done < <(ip -4 route show table all | awk '/^(local|broadcast|unreachable|blackhole|prohibit|throw) / {print $2; next} {print $1}')
if [[ -z $TARGET ]]; then read -r -p 'Directorio local NUEVO de backups [/srv/uasspain-backup]: ' TARGET; fi
TARGET=${TARGET:-/srv/uasspain-backup}
[[ $TARGET =~ ^/(srv|mnt)/[a-zA-Z0-9_./-]+$ ]] || fail 'Selecciona una ruta nueva bajo /srv o /mnt, sin espacios ni caracteres de configuracion.'
walker=$TARGET
while [[ $walker != / ]]; do
  [[ ! -L $walker ]] || fail "Enlace simbolico no permitido: $walker"
  walker=$(dirname -- "$walker")
done
TARGET=$(realpath -m -- "$TARGET")
[[ $TARGET =~ ^/(srv|mnt)/[a-zA-Z0-9_./-]+$ ]] || fail 'Ruta canonica no permitida.'
[[ $MINIMUM_FREE_GB =~ ^[1-9][0-9]{0,5}$ ]] || fail 'Capacidad minima en GB no valida.'
[[ ! -e "$TARGET" ]] || fail "La carpeta ya existe; no se alteraran datos: $TARGET"
[[ ! -L "$TARGET" ]] || fail 'No se admiten symlinks como destino.'
real_parent=$(realpath -m -- "$(dirname -- "$TARGET")")
[[ -d "$real_parent" ]] || fail "La carpeta padre debe existir: $real_parent"
# Chroot SSH: todos los componentes padre deben ser administrados por root y no escribibles por otros.
walker=$real_parent
while :; do
  owner=$(stat -c '%u' -- "$walker")
  [[ $owner == 0 ]] || fail "La carpeta padre $walker no pertenece a root: no es apta para ChrootDirectory."
  if [[ $(stat -c '%A' -- "$walker" | cut -c6,9) =~ w ]]; then fail "Permisos de escritura indebidos en padre: $walker"; fi
  [[ $walker == / ]] && break
  walker=$(dirname -- "$walker")
done
[[ ! -e /etc/uasspain-backup ]] || fail 'Ya existe /etc/uasspain-backup, no se sobrescribe.'
[[ ! -e /var/lib/uasspain-backup-provision ]] || fail 'Existe aprovisionamiento previo; inspeccionar antes de reejecutar.'
[[ ! -e /etc/wireguard/wg-uasbackup.conf ]] || fail 'WireGuard de backups ya configurado.'
[[ ! -e /etc/systemd/system/uasspain-backup-sftp.service ]] || fail 'Existe servicio SFTP de backup.'
[[ ! -e /etc/systemd/system/uasspain-backup-firewall.service ]] || fail 'Existe servicio firewall backup.'
[[ ! -e /etc/nftables-uasspain-backup.sh ]] || fail 'Existen reglas nftables UASSpain previas.'
[[ ! -e /etc/systemd/system/wg-quick@wg-uasbackup.service.d/override.conf ]] || fail 'Override WG previo.'
command -v ip >/dev/null || fail 'Falta iproute2: instala y revisa antes de continuar.'
ip -4 -o addr show | awk '{print $4}' | cut -d/ -f1 | grep -Fxq "$BACKUP_IP" || fail "IP $BACKUP_IP no existe en este servidor."
if id -u "$SFTP_USER" >/dev/null 2>&1; then fail 'Usuario SFTP preexistente; no se modifica.'; fi
if command -v ss >/dev/null; then
  [[ -z $(ss -H -lun "( sport = :$WG_PORT )") ]] || fail "UDP $WG_PORT ocupado."
  [[ -z $(ss -H -ltn "( sport = :$SFTP_PORT )") ]] || fail "TCP $SFTP_PORT ocupado."
fi
if command -v nft >/dev/null && nft list table inet uasspain_backup >/dev/null 2>&1; then fail 'Tabla nft de UASSpain ya presente.'; fi
# Clientes personalizados opcionales; rechazar enlaces, pero no exigir el ZIP.
for client in Instalar-Cliente-WireGuard-UASSpain.ps1 EJECUTAR-Cliente-UASSpain.cmd instalar-cliente-uasspain-linux.sh; do
  [[ ! -L $CLIENT_PACKAGE_DIR/$client ]] || fail "Cliente opcional es un enlace: $client"
done
available_kib=$(df -Pk -- "$real_parent" | awk 'NR==2 {print $4}')
[[ $available_kib =~ ^[0-9]+$ ]] && ((available_kib >= MINIMUM_FREE_GB*1024*1024)) || fail "Se requieren $MINIMUM_FREE_GB GB libres."
read -r -p 'Se instalaran componentes, usuario, tunel y firewall restringido en ESTE servidor. Escriba INSTALAR: ' consent
[[ $consent == INSTALAR ]] || fail 'Instalacion no confirmada; no se han aplicado cambios.'

SSH_PREEXISTING=true
if [[ ! -x /usr/sbin/sshd ]]; then SSH_PREEXISTING=false; fi
if [[ $SSH_PREEXISTING == false && -e /etc/ssh/sshd_config ]]; then fail 'Existe configuracion SSH sin binario sshd; requiere revision, no se instala encima.'; fi
NEW_SSH_UNITS=(ssh.service sshd.service ssh.socket sshd.socket)
if [[ $SSH_PREEXISTING == false ]]; then
  for svc in "${NEW_SSH_UNITS[@]}"; do
    [[ ! -e /run/systemd/system/$svc && ! -L /run/systemd/system/$svc ]] || fail "Unidad runtime SSH previa: $svc"
    [[ $(systemctl show -p LoadState --value "$svc") == not-found ]] || fail "Unidad SSH previa sin binario: $svc"
  done
  # Impedir que el gestor de paquetes exponga TCP/22 al iniciar SSH automaticamente.
  # Solo se enmascaran nombres comprobados como ausentes; nunca servicios previos.
  systemctl mask --runtime "${NEW_SSH_UNITS[@]}" || fail 'No se pudo impedir el autoarranque SSH nuevo.'
fi
info 'Instalando solo componentes ausentes (OpenSSH, WireGuard, nftables)'
if [[ $installer == apt ]]; then
  packages=()
  command -v sshd >/dev/null || [[ -x /usr/sbin/sshd ]] || packages+=(openssh-server)
  command -v wg >/dev/null || packages+=(wireguard-tools)
  command -v nft >/dev/null || packages+=(nftables)
  command -v openssl >/dev/null || packages+=(openssl)
  command -v ssh-keygen >/dev/null || packages+=(openssh-client)
  if ((${#packages[@]})); then apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}" || fail 'Fallo apt/OpenSSH/WireGuard/nftables.'; fi
else
  packages=()
  [[ -x /usr/sbin/sshd ]] || packages+=(openssh-server)
  command -v wg >/dev/null || packages+=(wireguard-tools)
  command -v nft >/dev/null || packages+=(nftables)
  command -v openssl >/dev/null || packages+=(openssl)
  command -v ssh-keygen >/dev/null || packages+=(openssh-clients)
  if ((${#packages[@]})); then dnf install -y "${packages[@]}" || fail 'Fallo dnf/OpenSSH/WireGuard/nftables.'; fi
fi
SSHD=$(command -v sshd || true); SSHD=${SSHD:-/usr/sbin/sshd}
[[ -x "$SSHD" ]] && command -v wg >/dev/null && command -v nft >/dev/null && command -v ssh-keygen >/dev/null || fail 'Dependencias incompletas.'
# Si se acaba de instalar OpenSSH, la distribucion puede habilitar TCP/22 automaticamente.
# Detener solo el SSH recien instalado; NUNCA alterar el servicio SSH preexistente.
if [[ $SSH_PREEXISTING == false ]]; then
  for svc in "${NEW_SSH_UNITS[@]}"; do
    if systemctl list-unit-files --no-legend "$svc" 2>/dev/null | grep -q .; then
      systemctl disable --now "$svc" || fail "No se pudo desactivar SSH general instalado ahora: $svc"
    fi
  done
  systemctl unmask --runtime "${NEW_SSH_UNITS[@]}" || fail 'Revisar masks temporales SSH propios antes de continuar.'
fi

info 'Creando usuario aislado y claves autenticadas'
mkdir -p /etc/uasspain-backup /var/lib/uasspain-backup-provision /etc/wireguard
chmod 700 /etc/uasspain-backup /var/lib/uasspain-backup-provision
mkdir -m 0755 "$TARGET"
mkdir -m 0700 "$TARGET/incoming"
# Contrasena aleatoria no expuesta; solo se aceptara autenticacion SSH mediante clave.
pw_hash=$(openssl rand -base64 42 | openssl passwd -6 -stdin)
useradd -M -U -d /incoming -s /usr/sbin/nologin -p "$pw_hash" "$SFTP_USER" || fail 'No se pudo crear cuenta SFTP.'
unset pw_hash
chown root:root "$TARGET"
chmod 0755 "$TARGET"
chown "$SFTP_USER:$SFTP_USER" "$TARGET/incoming"
chmod 0700 "$TARGET/incoming"

wg genkey > /etc/uasspain-backup/wg_server_private
wg pubkey < /etc/uasspain-backup/wg_server_private > /etc/uasspain-backup/wg_server_public
wg genkey > /etc/uasspain-backup/wg_client_private
wg pubkey < /etc/uasspain-backup/wg_client_private > /etc/uasspain-backup/wg_client_public
S_PRIV=$(cat /etc/uasspain-backup/wg_server_private)
S_PUB=$(cat /etc/uasspain-backup/wg_server_public)
C_PRIV=$(cat /etc/uasspain-backup/wg_client_private)
C_PUB=$(cat /etc/uasspain-backup/wg_client_public)
cat > /etc/wireguard/wg-uasbackup.conf <<EOF
[Interface]
Address = $VPN_SERVER_IP/30
ListenPort = $WG_PORT
PrivateKey = $S_PRIV

[Peer]
PublicKey = $C_PUB
AllowedIPs = $VPN_CLIENT_IP/32
EOF
chmod 600 /etc/wireguard/wg-uasbackup.conf
PROV=/var/lib/uasspain-backup-provision
cat > "$PROV/UASSpainBackupCliente.conf" <<EOF
[Interface]
Address = $VPN_CLIENT_IP/30
PrivateKey = $C_PRIV

[Peer]
PublicKey = $S_PUB
Endpoint = ${BACKUP_IP}:${WG_PORT}
AllowedIPs = $VPN_SERVER_IP/32
PersistentKeepalive = 25
EOF
chmod 600 "$PROV/UASSpainBackupCliente.conf"
unset S_PRIV C_PRIV
ssh-keygen -q -t ed25519 -N '' -C uasspain-backup-client -f "$PROV/id_ed25519_uasspain_backup"
cp "$PROV/id_ed25519_uasspain_backup.pub" /etc/uasspain-backup/authorized_keys
chmod 600 /etc/uasspain-backup/authorized_keys "$PROV/id_ed25519_uasspain_backup"
ssh-keygen -q -t ed25519 -N '' -C uasspain-backup-server -f /etc/uasspain-backup/ssh_host_ed25519_key
read -r host_algo host_key _ < /etc/uasspain-backup/ssh_host_ed25519_key.pub
[[ $host_algo == ssh-ed25519 && -n $host_key ]] || fail 'Clave SSH host ED25519 invalida.'
printf '[%s]:%s %s %s\n' "$VPN_SERVER_IP" "$SFTP_PORT" "$host_algo" "$host_key" > "$PROV/known_hosts_uasspain_backup"
cat > "$PROV/peer-info.txt" <<EOF
ExpectedClientIP=$UAS_IP
BackupServerIP=$BACKUP_IP
WireGuardPort=$WG_PORT
SftpPort=$SFTP_PORT
EOF
for client in Instalar-Cliente-WireGuard-UASSpain.ps1 EJECUTAR-Cliente-UASSpain.cmd instalar-cliente-uasspain-linux.sh; do
  [[ ! -L $CLIENT_PACKAGE_DIR/$client ]] || fail "Cliente opcional cambio a un enlace: $client"
  if [[ -f $CLIENT_PACKAGE_DIR/$client ]]; then cp -- "$CLIENT_PACKAGE_DIR/$client" "$PROV/"; fi
done
chmod 600 "$PROV"/*

info 'Configurando SFTP separado: SSH principal intacto'
cat > /etc/uasspain-backup/sshd_config <<EOF
Port $SFTP_PORT
AddressFamily inet
ListenAddress $VPN_SERVER_IP
HostKey /etc/uasspain-backup/ssh_host_ed25519_key
PidFile /run/uasspain-backup-sshd.pid
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
AuthenticationMethods publickey
PermitEmptyPasswords no
PermitRootLogin no
AllowUsers $SFTP_USER
AllowTcpForwarding no
AllowAgentForwarding no
X11Forwarding no
PermitTTY no
Subsystem sftp internal-sftp
ChrootDirectory $TARGET
ForceCommand internal-sftp -d /incoming
AuthorizedKeysFile /etc/uasspain-backup/authorized_keys
LogLevel VERBOSE
EOF
chmod 600 /etc/uasspain-backup/sshd_config
mkdir -p /run/sshd
"$SSHD" -t -f /etc/uasspain-backup/sshd_config || fail 'sshd_config no valido.'

info 'Firewall: restringiendo puertos y abriendo accesos necesarios'
# nftables añade solamente una tabla propia. No modifica reglas ajenas ni el servicio SSH principal.
cat > /etc/nftables-uasspain-backup.sh <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
rules=\$(mktemp /run/uasspain-backup-nft.XXXXXX)
trap 'rm -f -- "\$rules"' EXIT
if nft list table inet uasspain_backup >/dev/null 2>&1; then
  printf 'delete table inet uasspain_backup\n' > "\$rules"
fi
cat >> "\$rules" <<'RULES'
table inet uasspain_backup {
  chain input {
    type filter hook input priority -110; policy accept;
    meta nfproto ipv6 udp dport $WG_PORT drop
    ip protocol udp udp dport $WG_PORT ip saddr != $UAS_IP drop
    ip protocol udp udp dport $WG_PORT ip daddr != $BACKUP_IP drop
    meta nfproto ipv6 tcp dport $SFTP_PORT drop
    tcp dport $SFTP_PORT iifname != "wg-uasbackup" drop
    ip protocol tcp tcp dport $SFTP_PORT ip saddr != $VPN_CLIENT_IP drop
    ip protocol tcp tcp dport $SFTP_PORT ip daddr != $VPN_SERVER_IP drop
  }
}
RULES
nft --check --file "\$rules"
nft --file "\$rules"
EOF
chmod 700 /etc/nftables-uasspain-backup.sh
cat > /etc/systemd/system/uasspain-backup-firewall.service <<'EOF'
[Unit]
Description=UASSpain backup VPN restrict ingress
After=network-pre.target nftables.service ufw.service firewalld.service
Before=wg-quick@wg-uasbackup.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/etc/nftables-uasspain-backup.sh
[Install]
WantedBy=multi-user.target
EOF
mkdir -p /etc/systemd/system/wg-quick@wg-uasbackup.service.d
cat > /etc/systemd/system/wg-quick@wg-uasbackup.service.d/override.conf <<'EOF'
[Unit]
Requires=uasspain-backup-firewall.service
After=uasspain-backup-firewall.service
EOF
# Si UFW/firewalld ya gestionan el host, añadir permisos MINIMOS sin deshabilitarlos.
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow from "$UAS_IP" to "$BACKUP_IP" port "$WG_PORT" proto udp
  ufw allow in on wg-uasbackup from "$VPN_CLIENT_IP" to "$VPN_SERVER_IP" port "$SFTP_PORT" proto tcp
elif command -v firewall-cmd >/dev/null && firewall-cmd --state 2>/dev/null | grep -q running; then
  firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=$UAS_IP destination address=$BACKUP_IP port port=$WG_PORT protocol=udp accept" || fail 'FirewallD rechazó regla WG.'
  firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=$VPN_CLIENT_IP destination address=$VPN_SERVER_IP port port=$SFTP_PORT protocol=tcp accept" || fail 'FirewallD rechazó regla SFTP.'
  firewall-cmd --add-rich-rule="rule family=ipv4 source address=$UAS_IP destination address=$BACKUP_IP port port=$WG_PORT protocol=udp accept" || fail 'FirewallD rechazó regla WG runtime.'
  firewall-cmd --add-rich-rule="rule family=ipv4 source address=$VPN_CLIENT_IP destination address=$VPN_SERVER_IP port port=$SFTP_PORT protocol=tcp accept" || fail 'FirewallD rechazó regla SFTP runtime.'
fi
cat > /etc/systemd/system/uasspain-backup-sftp.service <<EOF
[Unit]
Description=UASSpain dedicated VPN-only SFTP server
Requires=wg-quick@wg-uasbackup.service
After=wg-quick@wg-uasbackup.service
[Service]
Type=simple
ExecStartPre=/usr/bin/install -d -m 0755 /run/sshd
ExecStartPre=$SSHD -t -f /etc/uasspain-backup/sshd_config
ExecStart=$SSHD -D -e -f /etc/uasspain-backup/sshd_config
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now uasspain-backup-firewall.service || fail 'Firewall no pudo arrancar.'
systemctl enable --now wg-quick@wg-uasbackup.service || fail 'WireGuard no pudo arrancar.'
systemctl enable --now uasspain-backup-sftp.service || fail 'SFTP dedicado no arranco.'
systemctl is-active --quiet wg-quick@wg-uasbackup.service || fail 'WireGuard no activo.'
systemctl is-active --quiet uasspain-backup-sftp.service || fail 'SFTP no activo.'
ip -4 -o addr show dev wg-uasbackup | awk '{print $4}' | grep -Fxq "$VPN_SERVER_IP/30" || fail 'IP VPN no presente.'
ss -H -ltn | awk '{print $4}' | grep -Fxq "$VPN_SERVER_IP:$SFTP_PORT" || fail 'SFTP no escucha en IP VPN.'
if ss -H -ltn | awk '{print $4}' | grep -vFx "$VPN_SERVER_IP:$SFTP_PORT" | grep -Eq ":$SFTP_PORT$"; then fail 'SFTP escucha fuera de la VPN.'; fi

cat > /etc/uasspain-backup/INSTRUCCIONES_UASSPAIN.txt <<EOF
UASSpain - servidor backups Linux preparado, cliente pendiente
VPN servidor LAN: $BACKUP_IP
VPN cliente LAN: $UAS_IP
WireGuard UDP (solo origen UASSpain): $WG_PORT
SFTP host VPN: $VPN_SERVER_IP
SFTP puerto TCP: $SFTP_PORT
Usuario: $SFTP_USER
Ruta remota: /incoming
Directorio fisico Linux: $TARGET/incoming
Clave cliente en paquete: id_ed25519_uasspain_backup
Archivo known_hosts (host SSH fijado): known_hosts_uasspain_backup
Paquete CLIENTE PRIVADO (copiar por USB cifrado, NO nube): $PROV
Estado: pendiente configuracion de cliente, conexion Docker, backup cifrado y restauracion.
Sin instalador cliente personalizado: importar UASSpainBackupCliente.conf en WireGuard oficial.
En Linux usar un nombre de interfaz propio de hasta 15 caracteres, por ejemplo uas-backup1.conf.
EOF
chmod 600 /etc/uasspain-backup/INSTRUCCIONES_UASSPAIN.txt
info 'SERVIDOR LINUX PREPARADO - PENDIENTE ACTIVACION EN UASSPAIN'
printf 'Paquete privado cliente: %s\nHost SFTP: %s:%s\nUsuario: %s\nRuta SFTP: /incoming\n' "$PROV" "$VPN_SERVER_IP" "$SFTP_PORT" "$SFTP_USER"
echo 'No declarar validado hasta que UASSpain pruebe SFTP, copia cifrada y restauracion.'
