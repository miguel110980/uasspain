"""Genera la PKI interna para TLS del stack UASSpain.

Uso (desde la raíz del repo, con la imagen backend ya construida):

    docker run --rm --entrypoint python \
        -v "%cd%/scripts:/gen:ro" -v "%cd%/.secrets/tls:/out" \
        uasspain-backend:e2e-local /gen/generate_tls_certs.py

Salida (en .secrets/tls/, NUNCA en git):
    ca.crt ca.key                 CA interna (la clave queda solo en host)
    edge.crt edge.key             cert del nginx edge (localhost, IPs de loopback, dominios)
    backend.crt backend.key       cert del backend Rust (CN=backend)
    frontend.crt frontend.key     cert del nginx estatico (CN=frontend)
    postgres.crt postgres.key     cert del servidor PostgreSQL (CN=postgres)
    redis.crt redis.key           cert del servidor Redis (CN=redis)

Regenerar con:  --force   (borra y recrea; posteriormente re-desplegar
                contenedores para que tomen los nuevos certificados).
"""

from __future__ import annotations

import datetime
import ipaddress
import os
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

OUT_DIR = os.environ.get("TLS_OUT", "/out")
KEY_SIZE = 4096
CA_DAYS = 3650
LEAF_DAYS = 825

EDGE_SANS = [
    x509.DNSName("localhost"),
    x509.DNSName("tudominio.com"),
    x509.DNSName("www.tudominio.com"),
    x509.DNSName("uasspain.example.com"),
    x509.DNSName("www.uasspain.example.com"),
    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
    x509.IPAddress(ipaddress.ip_address("::1")),
]
POSTGRES_SANS = [
    x509.DNSName("postgres"),
    x509.DNSName("localhost"),
    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
]
REDIS_SANS = [
    x509.DNSName("redis"),
    x509.DNSName("localhost"),
    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
]
BACKEND_SANS = [
    x509.DNSName("backend"),
    x509.DNSName("localhost"),
    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
]
FRONTEND_SANS = [
    x509.DNSName("frontend"),
    x509.DNSName("localhost"),
    x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
]


def _key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=KEY_SIZE)


def _write_key(path: str, key) -> None:
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    with open(path, "wb") as fh:
        fh.write(pem)
    os.chmod(path, 0o600)


def _write_cert(path: str, cert: x509.Certificate) -> None:
    with open(path, "wb") as fh:
        fh.write(cert.public_bytes(serialization.Encoding.PEM))
    os.chmod(path, 0o644)


def _make_ca(now: datetime.datetime):
    key = _key()
    subject = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "UASSpain Internal CA"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "UASSpain"),
        ]
    )
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=CA_DAYS))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
        )
        .sign(key, hashes.SHA256())
    )
    return key, cert


def _make_leaf(ca_key, ca_cert, common_name: str, sans, now: datetime.datetime):
    key = _key()
    subject = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "UASSpain"),
        ]
    )
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=LEAF_DAYS))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.SubjectAlternativeName(sans), critical=False)
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    return key, cert


def main() -> int:
    force = "--force" in sys.argv
    os.makedirs(OUT_DIR, exist_ok=True)

    ca_crt_path = os.path.join(OUT_DIR, "ca.crt")
    now = datetime.datetime.now(datetime.timezone.utc)
    leaves = (
        ("edge", "nginx", EDGE_SANS),
        ("backend", "backend", BACKEND_SANS),
        ("frontend", "frontend", FRONTEND_SANS),
        ("postgres", "postgres", POSTGRES_SANS),
        ("redis", "redis", REDIS_SANS),
    )
    ca_key_path = os.path.join(OUT_DIR, "ca.key")
    missing = [
        fname
        for fname, _cn, _sans in leaves
        if not os.path.exists(os.path.join(OUT_DIR, f"{fname}.crt"))
        or not os.path.exists(os.path.join(OUT_DIR, f"{fname}.key"))
    ]

    if os.path.exists(ca_crt_path) and not force:
        if not missing:
            print(f"Ya existe una PKI completa en {OUT_DIR}. Nada que hacer.")
            return 0
        if not os.path.exists(ca_key_path):
            print(
                "ERROR: faltan certificados, pero ca.key no está disponible para "
                "firmarlos. Restaura la CA o usa --force para crear una PKI nueva.",
                file=sys.stderr,
            )
            return 2
        with open(ca_key_path, "rb") as fh:
            ca_key = serialization.load_pem_private_key(fh.read(), password=None)
        with open(ca_crt_path, "rb") as fh:
            ca_cert = x509.load_pem_x509_certificate(fh.read())
    else:
        ca_key, ca_cert = _make_ca(now)
        _write_key(ca_key_path, ca_key)
        _write_cert(ca_crt_path, ca_cert)

    for fname, cn, sans in leaves:
        if not force and fname not in missing:
            continue
        key, cert = _make_leaf(ca_key, ca_cert, cn, sans, now)
        _write_key(os.path.join(OUT_DIR, f"{fname}.key"), key)
        _write_cert(os.path.join(OUT_DIR, f"{fname}.crt"), cert)
        print(f"  - {fname}.crt (CN={cn}, {LEAF_DAYS} días)")

    print(
        f"PKI generada en {OUT_DIR}: "
        "ca.crt + edge/backend/frontend/postgres/redis (crt,key)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
