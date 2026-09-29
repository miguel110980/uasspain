#!/bin/sh
set -eu

if ! command -v gitleaks >/dev/null 2>&1; then
    echo "gitleaks no esta instalado" >&2
    exit 2
fi

# La salida siempre se redacta. La configuracion excluye solo secretos locales,
# artefactos y el baseline de hashes; los ejemplos distribuibles si se revisan.
mode="${1:-tree}"

case "$mode" in
    tree)
        exec gitleaks dir . \
            --config .gitleaks.toml \
            --redact \
            --no-banner \
            --no-color
        ;;
    history)
        exec gitleaks git . \
            --config .gitleaks.toml \
            --redact \
            --no-banner \
            --no-color
        ;;
    staged)
        exec gitleaks protect --staged \
            --config .gitleaks.toml \
            --redact \
            --no-banner \
            --no-color
        ;;
    *)
        echo "uso: $0 [tree|history|staged]" >&2
        exit 2
        ;;
esac
