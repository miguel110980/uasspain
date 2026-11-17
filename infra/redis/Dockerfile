FROM redis:8.2.10-alpine@sha256:b51665e66f00759be7c3152ad5ac3c66fb2f619c13ef62dea7cc1f9914524635

ARG SECURITY_REFRESH=2026-11-09

# Keep the supported Extended Redis branch while applying patched Alpine
# packages available for the immutable base image.
RUN apk upgrade --no-cache

WORKDIR /data
