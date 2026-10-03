FROM rust:1.98.1-slim-bookworm@sha256:ff521445a372125ed4f76e1453a1f8098f2d05332d1601d30db1c1f62757e730 AS builder

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY migrations ./migrations
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo build --locked --release && cp target/release/uasspain-backend /build/uasspain-backend

FROM builder AS test
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo test --locked --release --workspace --all-features

FROM test AS audit
RUN rustup component add rustfmt clippy
RUN cargo fmt --all -- --check
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo check --locked --workspace --all-targets --all-features
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    cargo clippy --locked --workspace --all-targets --all-features -- -D warnings

FROM postgres:18.6-trixie@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722 AS pgtools

FROM ubuntu:26.04@sha256:3595d7fc4286a33fad0fd853a4063e654287a9c3787437d7937c94ca3f7a804e AS production

RUN apt-get update \
    && apt-get upgrade --yes \
    && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends --yes ca-certificates tzdata openssh-client libpq5 liblz4-1 libzstd1 libreadline8t64 zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 uasspain \
    && useradd --system --uid 10001 --gid uasspain --home-dir /nonexistent --shell /usr/sbin/nologin uasspain \
    && mkdir -p /app/media /app/backups /app/backup_keys \
    && chown -R 10001:10001 /app

COPY --from=builder /build/uasspain-backend /usr/local/bin/uasspain-backend
COPY --from=pgtools /usr/lib/x86_64-linux-gnu/libpq.so.5.18 /usr/lib/x86_64-linux-gnu/libpq.so.5.18
COPY --from=pgtools /usr/lib/x86_64-linux-gnu/libpq.so.5 /usr/lib/x86_64-linux-gnu/libpq.so.5
COPY --from=pgtools /usr/lib/postgresql/18/bin/pg_dump /usr/bin/pg_dump
COPY --from=pgtools /usr/lib/postgresql/18/bin/pg_restore /usr/bin/pg_restore
COPY --from=pgtools /usr/lib/postgresql/18/bin/psql /usr/bin/psql
COPY --from=pgtools /usr/lib/postgresql/18/bin/createdb /usr/bin/createdb
COPY --from=pgtools /usr/lib/postgresql/18/bin/dropdb /usr/bin/dropdb

USER 10001:10001
EXPOSE 8000
ENV BIND_ADDRESS=0.0.0.0:8000 \
    RUST_LOG=info
ENTRYPOINT ["/usr/local/bin/uasspain-backend"]

