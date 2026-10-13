#!/usr/bin/env bash
set -euo pipefail
port='' peer='' apply=false
while (( $# )); do
    case "$1" in --port) port="${2:?}"; shift 2;; --peer) peer="${2:?}"; shift 2;; --apply-confirmed) apply=true; shift;; *) printf 'Unknown argument\n' >&2; exit 2;; esac
done
[[ "$port" =~ ^[0-9]+$ ]] && ((port>=1 && port<=65535)) || { printf 'Invalid port\n' >&2; exit 2; }
python3 -c 'import ipaddress,sys; ipaddress.ip_address(sys.argv[1])' "$peer"
if ! $apply; then printf 'NOT_APPLIED: inbound UDP %s only from %s; no reset or policy changes.\n' "$port" "$peer"; exit 0; fi
(( EUID==0 )) || { printf 'Explicit technical privileges required\n' >&2; exit 2; }
if command -v ufw >/dev/null 2>&1 && ufw status | head -n1 | grep -q 'Status: active'; then
    ufw allow from "$peer" to any port "$port" proto udp comment 'UASSpain WireGuard restricted peer'
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    rule="rule family=\"$( [[ "$peer" == *:* ]] && printf ipv6 || printf ipv4 )\" source address=\"$peer\" port port=\"$port\" protocol=\"udp\" accept"
    firewall-cmd --permanent --query-rich-rule="$rule" >/dev/null 2>&1 || firewall-cmd --permanent --add-rich-rule="$rule"
    firewall-cmd --query-rich-rule="$rule" >/dev/null 2>&1 || firewall-cmd --add-rich-rule="$rule"
else printf 'BLOCKED: supported active firewall not detected; review nftables manually.\n' >&2; exit 2; fi
