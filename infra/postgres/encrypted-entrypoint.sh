#!/bin/sh
set -eu
umask 077

if [ "$(awk 'NR > 1 && NF { n++ } END { print n+0 }' /proc/swaps)" -ne 0 ]; then
    echo 'FATAL: WSL swap must be disabled before handling PostgreSQL encryption keys.' >&2
    exit 1
fi

CIPHER=/encrypted-postgres
PLAIN=/var/lib/postgresql/data
CONTROL=/run/postgres-storage
mkdir -p "$CONTROL" "$PLAIN"
chmod 711 /var/lib/postgresql

# No key in environment, image, command line or persistent Docker secret.
# The Windows owner supplies it through stdin; this path is tmpfs only.
echo 'PostgreSQL encrypted storage: LOCKED; awaiting protected key.'
while [ ! -f "$CONTROL/unlock.key" ]; do sleep 1; done
trap 'rm -f "$CONTROL/unlock.key"' EXIT
if [ "$(wc -c < "$CONTROL/unlock.key")" -ne 65 ]; then
    echo 'FATAL: invalid storage key delivery.' >&2
    exit 1
fi
if [ ! -f "$CIPHER/gocryptfs.conf" ]; then
    if [ -n "$(find "$CIPHER" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
        echo 'FATAL: refusing to initialize non-empty ciphertext directory.' >&2
        exit 1
    fi
    # gocryptfs init may print a recovery key: keep all output in tmpfs.
    gocryptfs -q -init -passfile "$CONTROL/unlock.key" "$CIPHER" > "$CONTROL/init.log" 2>&1 || {
        echo 'FATAL: encrypted filesystem initialization failed.' >&2; exit 1;
    }
fi
gocryptfs -q -nosyslog -allow_other -passfile "$CONTROL/unlock.key" "$CIPHER" "$PLAIN" > "$CONTROL/mount.log" 2>&1 || {
    echo 'FATAL: cannot unlock encrypted filesystem; no plaintext fallback.' >&2; exit 1;
}
rm -f "$CONTROL/unlock.key" "$CONTROL/init.log"
if [ "$(findmnt -n -o FSTYPE --mountpoint "$PLAIN")" != 'fuse.gocryptfs' ]; then
    echo 'FATAL: PGDATA is not an encrypted FUSE mount.' >&2
    exit 1
fi
printf '%s\n' 'gocryptfs-AES-256-GCM' > "$CONTROL/mounted"
echo 'PostgreSQL encrypted storage: unlocked; persistent data uses ciphertext only.'
# Mount administration is unnecessary for PostgreSQL. Remove SYS_ADMIN from
# its bounding set before the official entrypoint drops to the postgres UID.
exec setpriv --bounding-set=-sys_admin sh /tls-entrypoint.sh "$@"
