#!/usr/bin/env python3
"""Explicit first-installation key preparation only. Never replace a key."""
import argparse, os, pathlib, platform, secrets
parser=argparse.ArgumentParser()
parser.add_argument('--output',required=True)
parser.add_argument('--confirm-new-installation',action='store_true')
args=parser.parse_args()
if platform.system()!='Linux':
    parser.error('Use the existing DPAPI preparation on Windows; this adapter is Linux-only.')
if not args.confirm_new_installation:
    parser.error('Explicit confirmation is required; never use for an existing encrypted installation.')
target=pathlib.Path(args.output)
if not target.is_absolute() or not target.parent.is_dir() or any(p.is_symlink() for p in [target,*target.parents]):
    parser.error('Use a prepared absolute protected path without symlinks.')
with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as file:
    file.write((secrets.token_hex(32)+'\n').encode())
    file.flush();os.fsync(file.fileno())
print('NEW_INSTALLATION_KEY=CREATED_PROTECTED; value not displayed. Preserve its recovery copy separately.')
