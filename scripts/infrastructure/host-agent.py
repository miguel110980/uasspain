#!/usr/bin/env python3
"""Read-only Linux collector. Never call wg dump/showconf/private-key."""
import argparse, base64, datetime, hashlib, hmac, json, os, pathlib, platform, re, shutil, subprocess, tempfile

def read(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=5, check=True)
    return result.stdout.strip()

def keepalive(value):
    return 0 if value == 'off' else int(value)

def collect():
    errors, interfaces, networks, mounts = [], [], [], []
    installed = shutil.which('wg') is not None
    if installed:
        try:
            for name in read(['wg', 'show', 'interfaces']).split():
                if not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', name):
                    raise ValueError('invalid interface')
                data = {field: dict(line.split('\t', 1) for line in read(['wg','show',name,field]).splitlines() if '\t' in line)
                        for field in ('endpoints','allowed-ips','latest-handshakes','transfer','persistent-keepalive')}
                peers = []
                for key in read(['wg','show',name,'peers']).splitlines():
                    rx, tx = map(int, data['transfer'][key].split())
                    endpoint = data['endpoints'][key]
                    peers.append(dict(public_key=key, endpoint='' if endpoint == '(none)' else endpoint,
                                      allowed_ips=data['allowed-ips'][key].split(), latest_handshake=int(data['latest-handshakes'][key]),
                                      rx_bytes=rx, tx_bytes=tx, keepalive=keepalive(data['persistent-keepalive'][key])))
                addresses = json.loads(read(['ip','-j','address','show','dev',name]))
                interfaces.append(dict(name=name, public_key=read(['wg','show',name,'public-key']), listen_port=int(read(['wg','show',name,'listen-port'])),
                                       addresses=[f"{a['local']}/{a['prefixlen']}" for i in addresses for a in i['addr_info'] if a.get('scope') != 'link'], peers=peers))
        except (OSError, subprocess.SubprocessError, ValueError, KeyError):
            errors.append('WG_QUERY_DENIED')
            interfaces = []
    else:
        errors.append('WG_UNAVAILABLE')
    complete = True
    try:
        vpn_names = {i['name'] for i in interfaces}
        for interface in json.loads(read(['ip','-j','address','show'])):
            if interface['ifname'] not in vpn_names and interface['ifname'] != 'lo':
                networks.extend(f"{a['local']}/{a['prefixlen']}" for a in interface['addr_info'] if a.get('scope') != 'link')
        if shutil.which('docker'):
            backend=json.loads(read(['docker','inspect','uasspain-backend']))[0]
            if backend['Config']['Labels'].get('com.docker.compose.project')!='uasspain' or backend['Config']['Labels'].get('com.docker.compose.service')!='backend':
                raise ValueError('backend identity mismatch')
            mounts=[dict(source=m['Source'],destination=m['Destination'],read_only=not m['RW']) for m in backend['Mounts']]
            ids = read(['docker','network','ls','-q']).splitlines()
            if ids:
                networks.extend(c['Subnet'] for n in json.loads(read(['docker','network','inspect',*ids])) for c in n['IPAM'].get('Config') or [] if c.get('Subnet'))
        else:
            complete = False
    except (OSError, subprocess.SubprocessError, ValueError, KeyError):
        complete = False
    if not complete:
        errors.append('NETWORK_INVENTORY_INCOMPLETE')
    return dict(schema=1, observed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), host_platform='linux', installation='unknown',
                wireguard_installed=installed, service_state='interfaces_available' if interfaces else 'unavailable', interfaces=interfaces,
                networks=sorted(set(networks)), network_inventory_complete=complete, mounts=mounts, errors=errors)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspect-only', action='store_true')
    parser.add_argument('--key-file')
    parser.add_argument('--output-directory')
    parser.add_argument('--prepare-key', action='store_true')
    args = parser.parse_args()
    if platform.system() != 'Linux':
        parser.error('Use host-agent.ps1 on Windows.')
    if pathlib.Path('/.dockerenv').exists() or pathlib.Path('/run/.containerenv').exists():
        parser.error('Run the collector on the actual host, not inside a container; container Linux does not identify the host.')
    observation = collect()
    if args.inspect_only:
        print(json.dumps(observation))
        return
    if not args.key_file or not args.output_directory:
        parser.error('key-file and output-directory are required')
    key_path, directory = pathlib.Path(args.key_file), pathlib.Path(args.output_directory)
    if key_path.is_symlink() or directory.is_symlink() or not directory.is_dir():
        parser.error('Prepared non-symlink directories and key files are required')
    if args.prepare_key and not key_path.exists():
        with os.fdopen(os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as file:
            file.write(os.urandom(32))
    if key_path.stat().st_mode & 0o007:
        parser.error('Collector key must not be accessible to other users')
    key = key_path.read_bytes()
    if len(key) < 32:
        parser.error('Invalid collector key')
    payload = json.dumps(observation, separators=(',',':')).encode()
    envelope = dict(payload=base64.b64encode(payload).decode(), signature=base64.b64encode(hmac.new(key, payload, hashlib.sha256).digest()).decode())
    target = directory / 'status.json'
    if target.is_symlink():
        parser.error('Snapshot symlinks are forbidden')
    fd, temporary = tempfile.mkstemp(dir=directory, suffix='.tmp')
    with os.fdopen(fd, 'w') as file:
        json.dump(envelope, file)
        file.flush()
        os.fsync(file.fileno())
    os.chmod(temporary, 0o640)
    os.replace(temporary, target)
    print('HOST_OBSERVATION=WRITTEN_AUTHENTICATED; no VPN/firewall/routing changes.')

if __name__ == '__main__':
    main()
