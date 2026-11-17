"""Persist strict HTTPS verification evidence without changing trust or PKI."""
import json
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[2]
context = ssl.create_default_context(cafile=str(root / ".secrets/tls/ca.crt"))
context.verify_flags |= ssl.VERIFY_X509_STRICT
report = {
    "observed_at": datetime.now(timezone.utc).isoformat(),
    "scope": "ORIGINAL strict HTTPS verification only; no PKI, trust, network or service changes",
    "target": "https://localhost/healthz",
    "strict": True,
    "tls_bypass": False,
}
try:
    with urllib.request.urlopen(report["target"], context=context, timeout=10) as response:
        report.update(status="PASS" if response.status == 200 else "FAIL", http=response.status)
except urllib.error.URLError as error:
    reason = error.reason
    if isinstance(reason, ssl.SSLCertVerificationError):
        report.update(status="FAIL", verification_code=reason.verify_code,
                      reason=reason.verify_message)
    else:
        report.update(status="BLOCKED", reason=type(reason).__name__)
(root / "docs/audits/evidence/2026-11-16-strict-tls.json").write_text(
    json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
sys.exit(0 if report["status"] == "PASS" else 1)
