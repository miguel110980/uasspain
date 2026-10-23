# ─── Nginx edge: único punto de entrada público (HTTP/HTTPS) ───
FROM nginx:1.30.6-alpine3.24@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951

# Actualiza paquetes del sistema dentro de la tag inmutable (CVEs de alpine/openssl)
RUN apk upgrade --no-cache \
    && apk add --no-cache --upgrade tiff=4.7.2-r0

COPY nginx.conf /etc/nginx/nginx.conf
COPY proxy_params /etc/nginx/proxy_params
COPY allowed_hosts.conf /etc/nginx/allowed_hosts.conf
COPY tls_pending_hosts.conf /etc/nginx/tls_pending_hosts.conf

RUN chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx/conf.d \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 8080 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl --fail --silent --show-error --cacert /run/secrets/backend_tls_ca https://127.0.0.1:8443/healthz -o /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
