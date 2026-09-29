# =============================================================================
# UASSPAIN — Centralized Infrastructure Configuration (Windows/PowerShell)
# =============================================================================
# This file defines ALL server parameters for the UASSPAIN infrastructure.
# Sourced by PowerShell scripts. Equivalent to config.sh for Linux.
#
# NO secrets are stored here. Use .secrets\ or environment variables for that.
# =============================================================================

# ─── Network ────────────────────────────────────────────────────────────────
$VPN_SUBNET = "10.50.0.0/24"
$VPN_PORT = "51820"
$VPN_INTERFACE_LINUX = "wg0"
$VPN_INTERFACE_WINDOWS = "UASSPAIN-VPN"

# ─── Server 1 — Application (ONLY internet-facing) ─────────────────────────
$SERVER1_NAME = "server1"
$SERVER1_ROLE = "application"
$SERVER1_PUBLIC_IP = "81.38.12.49"
$SERVER1_VPN_IP = "10.50.0.1"
$SERVER1_VPN_HOST = "10.50.0.1/24"
$SERVER1_SSH_PORT = "22"
$SERVER1_HTTP_PORT = "80"
$SERVER1_HTTPS_PORT = "443"

# ─── Server 2 — PostgreSQL 18 (NO internet) ────────────────────────────────
$SERVER2_NAME = "server2"
$SERVER2_ROLE = "postgres"
$SERVER2_PUBLIC_IP = "81.38.12.50"
$SERVER2_VPN_IP = "10.50.0.2"
$SERVER2_VPN_HOST = "10.50.0.2/24"
$SERVER2_SSH_PORT = "22"
$SERVER2_PG_PORT = "5432"

# ─── Backup 1 (NO internet) ────────────────────────────────────────────────
$BACKUP1_NAME = "backup1"
$BACKUP1_ROLE = "backup"
$BACKUP1_PUBLIC_IP = ""
$BACKUP1_VPN_IP = "10.50.0.101"
$BACKUP1_VPN_HOST = "10.50.0.101/24"
$BACKUP1_SSH_PORT = "22"

# ─── Backup 2 (NO internet) ────────────────────────────────────────────────
$BACKUP2_NAME = "backup2"
$BACKUP2_ROLE = "backup"
$BACKUP2_PUBLIC_IP = ""
$BACKUP2_VPN_IP = "10.50.0.102"
$BACKUP2_VPN_HOST = "10.50.0.102/24"
$BACKUP2_SSH_PORT = "22"

# ─── Backup 3 (NO internet) ────────────────────────────────────────────────
$BACKUP3_NAME = "backup3"
$BACKUP3_ROLE = "backup"
$BACKUP3_PUBLIC_IP = ""
$BACKUP3_VPN_IP = "10.50.0.103"
$BACKUP3_VPN_HOST = "10.50.0.103/24"
$BACKUP3_SSH_PORT = "22"

# ─── PostgreSQL ─────────────────────────────────────────────────────────────
$PG_VERSION = "18"
$PG_PORT = "5432"
$PG_DATABASE = "uasspain"
$PG_USER_APP = "uasspain_app"
$PG_USER_MIGRATE = "uasspain_migrate"
$PG_SHARED_BUFFERS = "256MB"
$PG_EFFECTIVE_CACHE_SIZE = "1GB"
$PG_WORK_MEM = "4MB"
$PG_MAINTENANCE_WORK_MEM = "128MB"
$PG_MAX_CONNECTIONS = "100"
$PG_STATEMENT_TIMEOUT_MS = "30000"

# ─── Backup ─────────────────────────────────────────────────────────────────
$BACKUP_SMB_SHARE = "UASSPAIN-Backups"
$BACKUP_SMB_USER = "uasspain-backup"
$BACKUP_RETENTION_FULL = "4"
$BACKUP_RETENTION_INCREMENTAL = "30"

# ─── WireGuard ──────────────────────────────────────────────────────────────
$WG_KEY_DIR = ".\wireguard-keys"
$WG_CONFIG_DIR = ".\wireguard-configs"

# ─── Firewall ───────────────────────────────────────────────────────────────
$FW_SSH_PORT = "22"
$FW_WG_PORT = "51820"
$FW_HTTP_PORT = "80"
$FW_HTTPS_PORT = "443"
$FW_PG_PORT = "5432"
$FW_SMB_PORT = "445"
$FW_NETBIOS_PORT = "139"

# ─── Docker ─────────────────────────────────────────────────────────────────
$DOCKER_COMPOSE_APP = ".\docker-compose.yml"
$DOCKER_COMPOSE_PG = ".\infra\postgresql\docker-compose.yml"
$DOCKER_COMPOSE_BACKUP = ".\infra\backup\docker-compose.yml"

# ─── Allowed VPN peers (IPs that can connect) ──────────────────────────────
$ALLOWED_PG_CLIENTS = "10.50.0.1"
$ALLOWED_BACKUP_CLIENTS = "10.50.0.2"
