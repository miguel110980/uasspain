#!/bin/sh
# PostgreSQL + TLS: copia los certs (docker secrets) a una tmpfs con permisos
# mínimos y arranca el entrypoint oficial con ssl=on forzado (§6/§10).
# Orden crítico (cap_drop ALL ⇒ sin DAC_OVERRIDE): chmod de los archivos MIENTRAS
# son root-owned y el dir es traversable; chown -R al final; chmod 700 del dir
# al final (FOWNER sí cubre chmod del dir, pero NO el traversing hacia dentro).
set -e

TLS_DIR=/run/pgtls

if [ ! -f /run/secrets/pg_tls_key ] || [ ! -f /run/secrets/pg_tls_cert ] || [ ! -f /run/secrets/pg_tls_ca ]; then
    echo "FATAL: secrets pg_tls_key/pg_tls_cert/pg_tls_ca ausentes — TLS es obligatorio." >&2
    exit 1
fi

mkdir -p "$TLS_DIR"
cp /run/secrets/pg_tls_ca "$TLS_DIR/ca.crt"
cp /run/secrets/pg_tls_cert "$TLS_DIR/server.crt"
cp /run/secrets/pg_tls_key "$TLS_DIR/server.key"
if [ -f /etc/postgresql/pg_hba.conf ]; then
    cp /etc/postgresql/pg_hba.conf "$TLS_DIR/pg_hba.conf"
    chmod 600 "$TLS_DIR/pg_hba.conf"
fi
chmod 644 "$TLS_DIR/ca.crt" "$TLS_DIR/server.crt"
chmod 600 "$TLS_DIR/server.key"
chown -R postgres:postgres "$TLS_DIR"
chmod 700 "$TLS_DIR"

exec docker-entrypoint.sh "$@"
