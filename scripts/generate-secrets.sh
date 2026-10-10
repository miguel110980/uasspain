#!/bin/bash
# Generate Docker secrets for UASSPAIN. Existing values are never overwritten.
set -euo pipefail

SECRETS_DIR=".secrets"
mkdir -p "$SECRETS_DIR"

generate_secret() {
    local name=$1
    local length=${2:-64}
    if [ ! -f "$SECRETS_DIR/$name" ]; then
        openssl rand -base64 "$length" | tr -d '\n' > "$SECRETS_DIR/$name"
        chmod 600 "$SECRETS_DIR/$name"
        echo "Generated: $SECRETS_DIR/$name"
    else
        echo "Exists:    $SECRETS_DIR/$name (skipped)"
    fi
}

echo "=== Generating UASSPAIN Docker Secrets ==="
generate_secret "secret_key" 64
generate_secret "db_password" 32
generate_secret "db_app_password" 32
generate_secret "db_migration_password" 32
generate_secret "db_backup_password" 32
generate_secret "db_restore_password" 32
generate_secret "db_monitor_password" 32
generate_secret "smtp_password" 32
if [ ! -f "$SECRETS_DIR/contact_smtp_password" ]; then
    (umask 077; touch "$SECRETS_DIR/contact_smtp_password")
fi
if [ ! -f "$SECRETS_DIR/postmark_server_token" ]; then
    (umask 077; touch "$SECRETS_DIR/postmark_server_token")
fi
generate_secret "field_encryption_key" 44
generate_secret "bootstrap_admin_password" 32
generate_secret "redis_password" 32

echo "=== Secrets ready in $SECRETS_DIR/ ==="
echo "WARNING: Never commit .secrets/ to Git!"
