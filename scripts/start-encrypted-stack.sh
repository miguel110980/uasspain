#!/usr/bin/env bash
# Linux adapter: existing encrypted installations by default. A brand-new volume
# requires both explicit initialization flags and a pre-provisioned protected key.
set -euo pipefail
set +x
[[ "$(uname -s)" == Linux ]] || { printf 'BLOCKED: use the Windows DPAPI adapter on Windows.\n' >&2; exit 2; }
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
key_file='' build=false initialize_new=false confirmed=false
while (( $# )); do case "$1" in --build) build=true;shift;; --key-file) key_file="${2:?}";shift 2;; --initialize-new) initialize_new=true;shift;; --confirm-new-installation) confirmed=true;shift;; *) printf 'Unknown argument\n' >&2;exit 2;; esac; done
command -v docker >/dev/null && command -v python3 >/dev/null
[[ -n "${POSTGRES_CIPHERTEXT_VOLUME_NAME:-}" ]] || { printf 'BLOCKED: explicitly name the existing ciphertext volume.\n' >&2; exit 2; }
[[ "$(docker info --format '{{.OSType}}')" == linux ]] || exit 2
if $initialize_new; then
    $confirmed || { printf 'BLOCKED: explicit new-installation confirmation required.\n' >&2; exit 2; }
    if docker volume inspect "$POSTGRES_CIPHERTEXT_VOLUME_NAME" >/dev/null 2>&1; then printf 'BLOCKED: initialization is forbidden for any existing volume.\n' >&2; exit 2; fi
    [[ -n "$key_file" && -f "$key_file" && ! -L "$key_file" ]] || exit 2
    python3 -c 'import os,re,sys; p=sys.argv[1]; s=os.stat(p); assert s.st_mode & 0o077 == 0; assert re.fullmatch(b"[a-fA-F0-9]{64}\\n",open(p,"rb").read())' "$key_file"
    docker volume create --label io.uasspain.storage=new-encrypted-installation "$POSTGRES_CIPHERTEXT_VOLUME_NAME" >/dev/null
else docker volume inspect "$POSTGRES_CIPHERTEXT_VOLUME_NAME" >/dev/null; fi
export COMPOSE_PROJECT_NAME=uasspain POSTGRES_CIPHERTEXT_EXTERNAL=true
compose=(docker compose -p uasspain -f docker-compose.yml -f docker-compose.encrypted.yml)
"${compose[@]}" config --quiet
assets=$("${compose[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["frontend_static"]["name"])')
if ! docker volume inspect "$assets" >/dev/null 2>&1; then
    $initialize_new || { printf 'BLOCKED: existing assets volume unavailable.\n' >&2; exit 2; }
    docker volume create --label uasspain.role=frontend-static "$assets" >/dev/null
fi
if $build; then "${compose[@]}" build; fi
# An existing volume is mandatory and its initialized encrypted header is checked
# inside postgres before delivering any key. Never print compose secrets or keys.
"${compose[@]}" up -d --no-build postgres
if $initialize_new; then
    docker exec uasspain-postgres sh -c 'test -z "$(find /encrypted-postgres -mindepth 1 -maxdepth 1 -print -quit)"'
else docker exec uasspain-postgres test -f /encrypted-postgres/gocryptfs.conf; fi
if ! docker exec uasspain-postgres test -f /run/postgres-storage/mounted; then
    [[ -n "$key_file" && -f "$key_file" && ! -L "$key_file" ]] || { printf 'BLOCKED: protected existing key file required.\n' >&2; exit 2; }
    python3 -c 'import os,re,sys; p=sys.argv[1]; s=os.stat(p); assert s.st_mode & 0o077 == 0; assert re.fullmatch(b"[a-fA-F0-9]{64}\\n",open(p,"rb").read())' "$key_file"
    cat -- "$key_file" | docker exec -i uasspain-postgres sh -c 'umask 077; cat > /run/postgres-storage/unlock.key'
fi
ready=false
for ((i=0;i<60;i++)); do
    if docker exec uasspain-postgres pg_isready -U "${DB_USER:-uasspain}" -d "${DB_NAME:-uasspain}" >/dev/null 2>&1; then ready=true; break; fi
    sleep 2
done
$ready || { printf 'BLOCKED: encrypted PostgreSQL not ready.\n' >&2; exit 2; }
"${compose[@]}" up -d --no-build backend frontend nginx redis
for service in nginx frontend backend postgres redis; do
    healthy=false
    for ((i=0;i<60;i++)); do
        [[ "$(docker inspect --format '{{.State.Health.Status}}' "uasspain-$service")" == healthy ]] && { healthy=true; break; }
        sleep 2
    done
    $healthy || { printf 'BLOCKED: %s not healthy.\n' "$service" >&2; exit 2; }
done
printf 'CONTAINERS_HEALTHY=5/5; preserve ciphertext volume and existing key.\n'
