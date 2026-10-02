import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class SecretBaselineTests(unittest.TestCase):
    def compare(self, findings):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline = {"filename": "src\\config.py", "line_number": 10,
                        "type": "Secret Keyword", "hashed_secret": "fixture-hash"}  # pragma: allowlist secret - synthetic hash
            (root / ".secrets.baseline").write_text(json.dumps({"results": {"src/config.py": [baseline]}}))
            (root / ".secrets-results.json").write_text(json.dumps({"results": {"findings": findings}}))
            return subprocess.run([sys.executable, str(Path(__file__).with_name("compare_secrets.py"))],
                                  cwd=root, capture_output=True, text=True).returncode

    def finding(self, **updates):
        return {"filename": "src/config.py", "line_number": 40,
                "type": "Secret Keyword", "hashed_secret": "fixture-hash", **updates}  # pragma: allowlist secret - synthetic hash

    def test_relocation_and_path_separators_pass(self):
        self.assertEqual(self.compare([self.finding()]), 0)

    def test_additional_copy_fails(self):
        self.assertEqual(self.compare([self.finding(), self.finding(line_number=41)]), 1)

    def test_new_value_fails(self):
        self.assertEqual(self.compare([self.finding(hashed_secret="new-fixture-hash")]), 1)  # pragma: allowlist secret - synthetic hash

    def test_copy_to_another_file_fails(self):
        self.assertEqual(self.compare([self.finding(filename="src/new.py")]), 1)
