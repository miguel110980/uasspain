#!/usr/bin/env python3
"""Compare detect-secrets results against .secrets.baseline. Exit 1 on new secrets."""
import json
import sys
from collections import Counter


def norm(p):
    return (p or "").replace("\\", "/")


def key(s):
    # Moving an existing finding within the same file must not invalidate the
    # baseline. Keep occurrence counts so copying it still fails the gate.
    return (norm(s.get("filename")), s.get("type"), s.get("hashed_secret"))


def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return {}
    return {f: secrets for f, secrets in data.get("results", {}).items()}


def main():
    new = load(".secrets-results.json")
    base = load(".secrets.baseline")
    remaining = Counter(key(s) for secrets in base.values() for s in secrets)
    found = []
    for f, secrets in new.items():
        for s in secrets:
            identity = key(s)
            if remaining[identity] > 0:
                remaining[identity] -= 1
            else:
                found.append((f, s))
    if found:
        print(f"Found {len(found)} NEW potential secrets")
        for f, s in found:
            print(f"  {f}:{s['line_number']} [{s['type']}]")
        sys.exit(1)
    print("No new secrets detected (baseline match)")


if __name__ == "__main__":
    main()
