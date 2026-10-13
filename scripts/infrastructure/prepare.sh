#!/usr/bin/env bash
set -euo pipefail
# Inspection only; no package installation, permissions, routing or firewall changes.
printf 'PLATFORM=%s\n' "$(uname -s)"
if command -v docker >/dev/null 2>&1; then
    if docker info --format '{{.OSType}}' 2>/dev/null; then printf 'DOCKER=PASS\n'; else printf 'DOCKER=BLOCKED\n'; fi
    if docker compose version --short >/dev/null 2>&1; then printf 'COMPOSE=PASS\n'; else printf 'COMPOSE=BLOCKED\n'; fi
else printf 'DOCKER=BLOCKED\n'; fi
if command -v wg >/dev/null 2>&1; then printf 'WIREGUARD=CONFIGURED\n'; else printf 'WIREGUARD=NOT_CONFIGURED\n'; fi
if command -v python3 >/dev/null 2>&1; then printf 'COLLECTOR_RUNTIME=PASS\n'; else printf 'COLLECTOR_RUNTIME=BLOCKED\n'; fi
for manager in apt-get dnf yum zypper apk pacman; do
    if command -v "$manager" >/dev/null 2>&1; then printf 'PACKAGE_MANAGER=%s\n' "$manager"; break; fi
done
for service_manager in systemctl rc-service service; do
    if command -v "$service_manager" >/dev/null 2>&1; then printf 'SERVICE_MANAGER=%s\n' "$service_manager"; break; fi
done
for firewall in ufw firewall-cmd nft; do
    if command -v "$firewall" >/dev/null 2>&1; then printf 'FIREWALL_TOOL=%s\n' "$firewall"; break; fi
done
printf 'CHANGES_APPLIED=0\n'
