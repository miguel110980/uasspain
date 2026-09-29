#!/usr/bin/env bash
# Alerta local para el stack Docker. El webhook es opcional.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/alerts.log"
mkdir -p "$LOG_DIR"

severity="info"
message=""
check_health=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --severity|-s) severity="$2"; shift 2 ;;
    --message|-m) message="$2"; shift 2 ;;
    --check-health) check_health=true; shift ;;
    --status) tail -n 20 "$LOG_FILE" 2>/dev/null || true; exit 0 ;;
    --help|-h) echo "Usage: $0 [--check-health] [--severity LEVEL --message TEXT]"; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

if $check_health; then
  if (cd "$ROOT_DIR" && docker compose ps --status running --services | grep -qx nginx) \
    && curl --fail --silent --insecure https://127.0.0.1/readyz >/dev/null; then
    severity="info"; message="Stack Docker healthy y ready"
  else
    severity="critical"; message="Stack Docker no disponible o no ready"
  fi
fi

[[ -n "$message" ]] || { echo "Falta --message o --check-health" >&2; exit 2; }
entry="$(date -u +%Y-%m-%dT%H:%M:%SZ) [$severity] $message"
echo "$entry" | tee -a "$LOG_FILE"
if [[ -n "${ALERT_WEBHOOK:-}" ]]; then
  curl --fail --silent --show-error -X POST "$ALERT_WEBHOOK" \
    -H 'Content-Type: application/json' \
    --data "{\"severity\":\"$severity\",\"message\":\"$message\"}" >/dev/null || true
fi
[[ "$severity" != "critical" ]]
