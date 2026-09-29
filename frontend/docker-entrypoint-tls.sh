#!/bin/sh
set -eu

tls_dir=/run/frontend-tls
for secret in frontend_tls_ca frontend_tls_cert frontend_tls_key; do
    if [ ! -f "/run/secrets/$secret" ]; then
        echo "FATAL: falta el secreto TLS $secret" >&2
        exit 1
    fi
done

mkdir -p "$tls_dir"
cp /run/secrets/frontend_tls_ca "$tls_dir/ca.crt"
cp /run/secrets/frontend_tls_cert "$tls_dir/server.crt"
cp /run/secrets/frontend_tls_key "$tls_dir/server.key"
chmod 644 "$tls_dir/ca.crt" "$tls_dir/server.crt"
chmod 600 "$tls_dir/server.key"
chown -R frontend:frontend "$tls_dir"
# El healthcheck se ejecuta con el usuario configurado de la imagen (root sin
# DAC_OVERRIDE por cap_drop). Necesita atravesar el directorio para leer la CA;
# la clave permanece 0600 y solo pertenece a frontend.
chmod 755 "$tls_dir"

# Docker Desktop crea los pipes de logging 0600/root. El worker no privilegiado
# solo necesita escribir en ellos para conservar access/error logs en `docker logs`.
chmod 0622 /proc/self/fd/1 /proc/self/fd/2

exec /sbin/su-exec frontend "$@"
