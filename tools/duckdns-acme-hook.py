"""DNS-01 only. Never log credentials, URLs, or provider responses."""
import json
import os
from pathlib import Path
import secrets
import socket
import struct
import sys
import time
import urllib.parse
import urllib.request

BASE = 'uasspain-prueba.duckdns.org'
HOSTS = (BASE, 'www.' + BASE)
NAMES = (BASE, 'www.' + BASE, '_acme-challenge.' + BASE, '_acme-challenge.www.' + BASE)
STATE = Path('/etc/letsencrypt/duckdns-owned-txt.json')
TOKEN = Path('/run/secrets/duckdns-token.txt')


def authoritative_servers():
    request = urllib.request.Request('https://dns.google/resolve?name=duckdns.org&type=NS')
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.load(response)
    names = [a['data'].rstrip('.') for a in result.get('Answer', []) if a.get('type') == 2]
    if result.get('Status') != 0 or not names:
        raise RuntimeError('DNS_QUERY_FAILED')
    return [socket.gethostbyname(name) for name in names[:4]]


def authoritative_txt(server, name):
    identifier = secrets.randbelow(65536)
    question = b''.join(bytes([len(part)]) + part.encode('ascii') for part in name.split('.')) + b'\0' + struct.pack('!HH', 16, 1)
    packet = struct.pack('!HHHHHH', identifier, 0, 1, 0, 0, 0) + question
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
        connection.settimeout(6)
        connection.connect((server, 53))
        connection.send(packet)
        response = connection.recv(65535)
    rid, flags, questions, answers, _, _ = struct.unpack('!HHHHHH', response[:12])
    if rid != identifier or flags & 0x0200 or not flags & 0x0400 or flags & 15 not in (0, 3):
        raise RuntimeError('DNS_QUERY_FAILED')
    def skip_name(position):
        while response[position]:
            if response[position] & 0xC0 == 0xC0:
                return position + 2
            position += response[position] + 1
        return position + 1
    position = 12
    for _ in range(questions):
        position = skip_name(position) + 4
    values = set()
    for _ in range(answers):
        position = skip_name(position)
        kind, cls, ttl, length = struct.unpack('!HHIH', response[position:position + 10])
        position += 10
        data = response[position:position + length]
        position += length
        if kind == 5:
            raise RuntimeError('DNS_ALIAS_REQUIRES_REVIEW')
        if kind == 16:
            parts = []
            index = 0
            while index < len(data):
                size = data[index]
                parts.append(data[index + 1:index + 1 + size])
                index += 1 + size
            value = b''.join(parts).decode('utf-8')
            if value:
                values.add(value)
    return values


def authority_values():
    return [authoritative_txt(server, name) for server in authoritative_servers() for name in NAMES]


def query(provider, name, record='TXT'):
    endpoint = 'https://dns.google/resolve' if provider == 'Google' else 'https://cloudflare-dns.com/dns-query'
    req = urllib.request.Request(endpoint + '?' + urllib.parse.urlencode({'name': name, 'type': record}), headers={'Accept': 'application/dns-json'})
    with urllib.request.urlopen(req, timeout=15) as response:
        result = json.load(response)
    if result.get('Status') != 0:
        raise RuntimeError('DNS_QUERY_FAILED')
    answers = result.get('Answer', [])
    if any(a.get('type') == 5 for a in answers):
        raise RuntimeError('DNS_ALIAS_REQUIRES_REVIEW')
    return {a['data'].strip('"') for a in answers if a.get('type') == 16 and a['data'].strip('"')}


def all_values():
    return [query(provider, name) for provider in ('Google', 'Cloudflare') for name in NAMES]


def update(value, clear=False):
    token = TOKEN.read_text(encoding='utf-8').strip()
    params = {'domains': BASE, 'token': token, 'txt': value}
    if clear:
        params['clear'] = 'true'
    request = urllib.request.Request('https://www.duckdns.org/update?' + urllib.parse.urlencode(params))
    with urllib.request.urlopen(request, timeout=25) as response:
        result = response.read().decode('utf-8').strip()
    if result != 'OK':
        raise RuntimeError('DUCKDNS_REJECTED_TXT_UPDATE')


def cleanup():
    if not STATE.exists():
        print('ACME_TXT_CLEANUP=NO_OWNED_RECORD')
        return
    owned = json.loads(STATE.read_text())
    values = authority_values()
    if any(v - {owned['validation']} for v in values):
        raise RuntimeError('FOREIGN_TXT_PRESERVED_CLEANUP_BLOCKED')
    if any(values):
        update('', clear=True)
    for _ in range(12):
        try:
            if all(not v for v in authority_values()):
                STATE.unlink()
                print('ACME_TXT_CLEANUP=PASS; FOREIGN_RECORDS_MODIFIED=0')
                return
        except Exception:
            pass
        time.sleep(5)
    raise RuntimeError('TXT_CLEANUP_PROPAGATION_UNCONFIRMED')


def main():
    os.umask(0o077)
    if sys.argv[1] == 'cleanup':
        cleanup()
        return
    domain = os.environ.get('CERTBOT_DOMAIN')
    validation = os.environ.get('CERTBOT_VALIDATION', '')
    if domain not in HOSTS or not validation or STATE.exists():
        raise RuntimeError('INVALID_OR_OVERLAPPING_ACME_REQUEST')
    if any(authority_values()) or any(all_values()):
        raise RuntimeError('PREEXISTING_TXT_PRESERVED_AUTH_BLOCKED')
    with STATE.open('x') as file:
        json.dump({'domain': domain, 'validation': validation}, file)
    update(validation)
    print('ACME_TXT_CREATED; IP_RECORD_UPDATES=0', flush=True)
    for _ in range(36):
        try:
            values = authority_values() + all_values()
            if any(v - {validation} for v in values):
                raise RuntimeError('FOREIGN_TXT_DETECTED')
            if all(v == {validation} for v in values):
                print('ACME_TXT_PROPAGATION=PASS', flush=True)
                return
        except RuntimeError as error:
            if str(error) == 'FOREIGN_TXT_DETECTED':
                raise
        except Exception:
            pass
        time.sleep(5)
    raise RuntimeError('TXT_PROPAGATION_UNCONFIRMED')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        allowed = {'DNS_QUERY_FAILED', 'DNS_ALIAS_REQUIRES_REVIEW', 'DUCKDNS_REJECTED_TXT_UPDATE', 'FOREIGN_TXT_PRESERVED_CLEANUP_BLOCKED', 'TXT_CLEANUP_PROPAGATION_UNCONFIRMED', 'INVALID_OR_OVERLAPPING_ACME_REQUEST', 'PREEXISTING_TXT_PRESERVED_AUTH_BLOCKED', 'FOREIGN_TXT_DETECTED', 'TXT_PROPAGATION_UNCONFIRMED'}
        reason = str(error) if str(error) in allowed else 'NETWORK_OR_IO_FAILURE_DETAILS_SUPPRESSED'
        print('ACME_HOOK=BLOCKED; REASON=' + reason, file=sys.stderr)
        sys.exit(1)
