"""Exercise the retry workflow's shell steps without network or real credentials."""
import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import yaml


WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/sot_own_daily_pipeline.yml"
STEPS = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]["sync_export"]["steps"]


@unittest.skipUnless(shutil.which("bash"), "Workflow shell checks require bash")
class RetryWorkflowTests(unittest.TestCase):
    def run_step(self, name, variables=None, expressions=None, python_stub="return 0"):
        step = next(step for step in STEPS if step.get("name") == name)
        script = step["run"]
        for expression, value in (expressions or {}).items():
            script = script.replace("${{ " + expression + " }}", value)
        self.assertNotIn("${{", script)
        with tempfile.TemporaryDirectory() as td:
            output = Path(td) / "output"
            calls = Path(td) / "calls"
            env = {"GITHUB_OUTPUT": output.as_posix(), "CALL_LOG": calls.as_posix(),
                   "RUN_DATE": datetime.now(timezone.utc).date().isoformat(),
                   "SUPABASE_URL": "https://example.invalid", "SUPABASE_SERVICE_ROLE_KEY": "test-key"}
            env.update(variables or {})
            stub = 'python() { printf "%s\\n" "$*" >> "$CALL_LOG"; ' + python_stub + '; }\n'
            with patch.dict(os.environ, env):
                result = subprocess.run([shutil.which("bash"), "-e", "-o", "pipefail", "-c", stub + script],
                                        cwd=td, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return output.read_text() if output.exists() else "", calls.read_text() if calls.exists() else ""

    def test_restore_historical_date_or_missing_secrets_falls_back_without_download(self):
        for env in ({"RUN_DATE": "2000-01-01"}, {"SUPABASE_URL": ""}, {"SUPABASE_SERVICE_ROLE_KEY": ""}):
            with self.subTest(env=env):
                output, calls = self.run_step("Restore today's exports from earlier attempts", env)
                self.assertEqual(output, "restored=0\n")
                self.assertEqual(calls, "")

    def test_restore_script_failure_does_not_fail_step(self):
        output, calls = self.run_step("Restore today's exports from earlier attempts", python_stub="return 1")
        self.assertEqual(output, "restored=0\n")
        self.assertIn("download_exports_from_storage.py", calls)

    def test_export_uses_skip_existing_only_when_restored(self):
        for restored in ("", "0", "2"):
            with self.subTest(restored=restored):
                _, calls = self.run_step("Export dashboards", {"RESTORED": restored})
                self.assertEqual("--skip-existing" in calls, restored == "2")

    def test_skipped_sync_reports_reuse_without_false_failure(self):
        output, calls = self.run_step("Check sync results for notification", expressions={
            "steps.sync_dashboards.outcome": "skipped", "steps.restore_exports.outputs.restored": "2",
            "job.status": "failure", "github.server_url": "https://example.invalid",
            "github.repository": "test/repo", "github.run_id": "1",
        })
        self.assertIn("should_notify=false\n", output)
        self.assertIn("Dashboard sync skipped", output)
        self.assertNotIn("No sync summary", output)
        self.assertEqual(calls, "")
