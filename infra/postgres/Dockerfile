FROM postgres:18.6-alpine3.24@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873 AS postgres-base

FROM golang:1.27.3-alpine3.24@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS gosu-builder

ARG GOSU_COMMIT=6456aaa0f3c854d199d0f037f068eb97515b7513
RUN apk add --no-cache git=2.54.0-r0 \
    && git init /src/gosu \
    && git -C /src/gosu remote add origin https://github.com/tianon/gosu.git \
    && git -C /src/gosu fetch --depth 1 origin "$GOSU_COMMIT" \
    && git -C /src/gosu checkout --detach FETCH_HEAD \
    && cd /src/gosu \
    && CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags='-s -w -X main.version=1.19' -o /go/bin/gosu .

FROM alpine:3.24.2@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS assembler

# Ensambla el rootfs y sustituye gosu dentro de la misma capa: el binario
# antiguo no queda recuperable en una capa inferior del artefacto final.
RUN --mount=from=postgres-base,source=/,target=/source,ro \
    --mount=from=gosu-builder,source=/go/bin/gosu,target=/gosu,ro \
    mkdir -p /assembled \
    && cp -a /source/. /assembled/ \
    && cp /gosu /assembled/usr/local/bin/gosu

FROM scratch AS postgres-runtime

COPY --from=assembler /assembled/ /

ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    GOSU_VERSION=1.19 \
    LANG=en_US.utf8 \
    PG_MAJOR=18 \
    PG_VERSION=18.6 \
    PG_SHA256=555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f \
    DOCKER_PG_LLVM_DEPS="llvm21-dev clang21" \
    PGDATA=/var/lib/postgresql/18/docker

VOLUME /var/lib/postgresql
EXPOSE 5432
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["postgres"]
STOPSIGNAL SIGINT

FROM postgres-runtime AS postgres-encrypted-build
RUN apk add --no-cache gocryptfs=2.6.1-r7 fuse3=3.18.3-r0 setpriv=2.42.3-r1 findmnt=2.42.3-r1 \
    && printf 'user_allow_other\n' > /etc/fuse.conf
COPY infra/postgres/encrypted-entrypoint.sh /usr/local/bin/encrypted-postgres-entrypoint.sh
RUN chmod 755 /usr/local/bin/encrypted-postgres-entrypoint.sh

# No inherited VOLUME: only the explicitly mounted ciphertext is persistent.
FROM scratch AS postgres-encrypted
COPY --from=postgres-encrypted-build / /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=en_US.utf8 PG_MAJOR=18 PG_VERSION=18.6 \
    PGDATA=/var/lib/postgresql/data/pgdata
ENTRYPOINT ["/usr/local/bin/encrypted-postgres-entrypoint.sh"]
CMD ["postgres"]
EXPOSE 5432
STOPSIGNAL SIGINT
