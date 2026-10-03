#!/bin/sh
set -eu

source_dir=${1:-/usr/share/nginx/html/assets}
store_dir=${2:-/var/lib/frontend-static/assets}
mkdir -p "$store_dir"
# Vite writes content-hashed files in this flat directory. Never overwrite a
# published URL with different bytes or delete files used by an existing tab.
for source_file in "$source_dir"/*; do
    [ -f "$source_file" ] || { echo "Invalid asset: $source_file" >&2; exit 1; }
    asset_name=${source_file##*/}
    target_file="$store_dir/$asset_name"
    if [ -f "$target_file" ]; then
        cmp -s "$source_file" "$target_file" || { echo "Asset collision: $asset_name" >&2; exit 1; }
    else
        temporary_file="$store_dir/.$asset_name.$$"
        cp "$source_file" "$temporary_file"
        chmod 644 "$temporary_file"
        mv "$temporary_file" "$target_file"
    fi
done
