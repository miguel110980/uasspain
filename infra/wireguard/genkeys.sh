#!/bin/sh
# Generate WireGuard keys for UASSPAIN containers
set -e
DIR=/keys
mkdir -p "$DIR"
for name in server1 server2 backup; do
  if [ ! -f "$DIR/${name}_priv" ]; then
    wg genkey > "$DIR/${name}_priv"
    wg pubkey < "$DIR/${name}_priv" > "$DIR/${name}_pub"
  fi
  echo "${name}_PUB=$(cat "$DIR/${name}_pub")"
done
