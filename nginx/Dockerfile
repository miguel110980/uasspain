# ─── Nginx edge: único punto de entrada público (HTTP/HTTPS) ───
FROM nginx:1.30.5-alpine3.24@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94

# Actualiza paquetes del sistema dentro de la tag inmutable (CVEs de alpine/openssl)
RUN apk upgrade --no-cache

COPY nginx.conf /etc/nginx/nginx.conf
COPY proxy_params /etc/nginx/proxy_params
COPY allowed_hosts.conf /etc/nginx/allowed_hosts.conf

RUN chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx/conf.d \
    && touch /var/run/nginx.pid \
    && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 8080 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null --no-check-certificate https://127.0.0.1:8443/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
