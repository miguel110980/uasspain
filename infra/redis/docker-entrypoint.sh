#!/bin/sh
# Redis endurecido (§16): TLS obligatorio + ACL (usuario dedicado "app",
# default deshabilitado) + comandos peligrosos renombrados + no-root.
# Orden crítico (cap_drop ALL ⇒ sin DAC_OVERRIDE): chmod de los archivos MIENTRAS
# son root-owned y los dirs son traversables; chown -R después; chmod 700 de los
# dirs al final (FOWNER cubre chmod del dir, pero NO el traversing hacia dentro).
set -e

REDIS_PASSWORD=""
if [ -f /run/secrets/redis_password ]; then
    REDIS_PASSWORD=$(cat /run/secrets/redis_password)
fi

TLS_DIR=/run/redistls
ACL_DIR=/run/redisacl
TLS_ARGS=""
ACL_ARGS=""

if [ -f /run/secrets/redis_tls_key ] && [ -f /run/secrets/redis_tls_cert ] && [ -f /run/secrets/redis_tls_ca ]; then
    mkdir -p "$TLS_DIR"
    cp /run/secrets/redis_tls_ca "$TLS_DIR/ca.crt"
    cp /run/secrets/redis_tls_cert "$TLS_DIR/server.crt"
    cp /run/secrets/redis_tls_key "$TLS_DIR/server.key"
    chmod 644 "$TLS_DIR/ca.crt" "$TLS_DIR/server.crt"
    chmod 600 "$TLS_DIR/server.key"
    chown -R redis:redis "$TLS_DIR"
    chmod 700 "$TLS_DIR"
    TLS_ARGS="--port 0 --tls-port 6379 --tls-cert-file $TLS_DIR/server.crt --tls-key-file $TLS_DIR/server.key --tls-ca-cert-file $TLS_DIR/ca.crt --tls-auth-clients no"
else
    echo "FATAL: secrets redis_tls_* ausentes — TLS es obligatorio." >&2
    exit 1
fi

if [ -n "$REDIS_PASSWORD" ]; then
    mkdir -p "$ACL_DIR"
    printf 'user default off\nuser app on >%s ~* &* +@all -@dangerous\n' "$REDIS_PASSWORD" > "$ACL_DIR/users.acl"
    chmod 600 "$ACL_DIR/users.acl"
    chown -R redis:redis "$ACL_DIR"
    chmod 700 "$ACL_DIR"
    ACL_ARGS="--aclfile $ACL_DIR/users.acl"
else
    echo "FATAL: redis_password ausente — autenticación obligatoria." >&2
    exit 1
fi

# El entrypoint oficial (docker-entrypoint.sh) hace chown recursivo de /data.
# Bajamos privilegios con el setpriv incluido por la imagen oficial antes de
# invocarlo. Este contenedor va
# cap_drop ALL sin DAC_OVERRIDE, así que `find` sufre EACCES al traversar
# /data/appendonlydir (700, propiedad de redis) y el contenedor sale con 1
# (crash-loop tras un arranque con el AOF ya creado). Bajamos privilegios
# ANTES de invocarlo: root solo asegura la propiedad del raíz /data con
# CAP_CHOWN; los hijos ya pertenecen a redis.
chown redis:redis /data
exec /bin/setpriv --reuid redis --regid redis --clear-groups redis-server \
    --appendonly yes \
    --maxclients 1000 \
    --maxmemory 256mb \
    --maxmemory-policy noeviction \
    --protected-mode yes \
    $TLS_ARGS \
    $ACL_ARGS
