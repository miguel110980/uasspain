#!/usr/bin/env bash
# Estado operativo del stack Docker canónico.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
case "${1:-}" in
  --json|-j) docker compose ps --format json ;;
  --compact|-c) docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}' ;;
  --help|-h) echo "Usage: $0 [--json|--compact]" ;;
  *)
    docker compose ps
    echo
    curl --fail --silent --show-error --insecure https://127.0.0.1/readyz
    echo
    ;;
esac
