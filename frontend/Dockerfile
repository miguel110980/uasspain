# ─── Stage 1: Build ───────────────────────────────────────────────
FROM node:22.23.2-alpine3.24@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --prefer-offline --maxsockets=5 \
    --fetch-retries=4 --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=10000

COPY frontend/ ./
COPY backend-rust/src/contact-defaults.json /backend-rust/src/contact-defaults.json
ARG VITE_SITE_URL=https://uas-spain.com
ARG VITE_CONTACT_EMAIL=
ENV VITE_SITE_URL=${VITE_SITE_URL}
ENV VITE_CONTACT_EMAIL=${VITE_CONTACT_EMAIL}
RUN npm run build

# ─── Stage 2: Production (nginx) ─────────────────────────────────
FROM nginx:1.30.6-alpine3.24@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951 AS production

# Actualiza paquetes del sistema dentro de la tag inmutable (CVEs de alpine/openssl)
RUN apk upgrade --no-cache \
    && apk add --no-cache --upgrade tiff=4.7.2-r0 \
    && apk add --no-cache su-exec=0.3-r0

RUN addgroup -g 1001 -S frontend && \
    adduser -u 1001 -S frontend -G frontend

COPY frontend/nginx.conf /etc/nginx/nginx.conf
COPY frontend/security-headers.conf /etc/nginx/security-headers.conf
COPY frontend/docker-entrypoint-tls.sh /usr/local/bin/frontend-tls-entrypoint
COPY frontend/publish-assets.sh /usr/local/bin/publish-assets
COPY --from=builder /app/dist /usr/share/nginx/html

RUN chown -R frontend:frontend /usr/share/nginx/html \
    && chown -R frontend:frontend /var/cache/nginx \
    && chown -R frontend:frontend /var/log/nginx \
    && chown -R frontend:frontend /etc/nginx/conf.d \
    && touch /var/run/nginx.pid \
    && chown frontend:frontend /var/run/nginx.pid \
    && chmod 755 /usr/local/bin/frontend-tls-entrypoint

USER root

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent --show-error --cacert /run/frontend-tls/ca.crt https://frontend:8443/ -o /dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/frontend-tls-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
