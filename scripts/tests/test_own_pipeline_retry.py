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
    def run_step(self, name, variables=None, expressions=None, python_stub="return 0", prepare=None):
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
            if prepare:
                prepare(Path(td))
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

    def _restore_with_files(self, restored_keys):
        """Run the restore step with three configured playlists and some already-restored CSVs."""
        def prepare(td):
            (td / "config").mkdir()
            (td / "config/playlists.csv").write_text("\n".join(["playlist_key,display_name", "a,A", "b,B", "c,C", ""]), encoding="utf-8")
            day = td / "exports" / datetime.now(timezone.utc).strftime("%Y/%m/%d")
            day.mkdir(parents=True)
            for key in restored_keys:
                (day / f"{key}.csv").write_text("\n".join(["h", "1", ""]), encoding="utf-8")

        stub = f'echo "restored={len(restored_keys)}" >> "$GITHUB_OUTPUT"; return 0'
        output, _ = self.run_step("Restore today's exports from earlier attempts", python_stub=stub, prepare=prepare)
        return output.strip().splitlines()[-1]

    def test_incomplete_restored_set_is_reused(self):
        self.assertEqual(self._restore_with_files(["a", "b"]), "restored=2")

    def test_complete_restored_set_is_discarded_for_full_run(self):
        # All exports present means the earlier attempt failed after export (e.g. ingestion
        # rejected a file), so the files must not be reused.
        self.assertEqual(self._restore_with_files(["a", "b", "c"]), "restored=0")

    def test_export_uses_skip_existing_only_when_restored(self):
        for restored in ("", "0", "2"):
            with self.subTest(restored=restored):
                _, calls = self.run_step("Export dashboards", {"RESTORED": restored})
                self.assertEqual("--skip-existing" in calls, restored == "2")

    def test_export_stops_when_utc_day_changed_after_restore(self):
        step = next(s for s in STEPS if s.get("name") == "Export dashboards")
        with tempfile.TemporaryDirectory() as td:
            old = Path(td) / "exports/2000/01/01"
            old.mkdir(parents=True)
            (old / "a.csv").write_text("h", encoding="utf-8")
            env = {"RESTORED": "2", "RUN_DATE": "2000-01-01"}
            with patch.dict(os.environ, env):
                result = subprocess.run([shutil.which("bash"), "-e", "-c", "python() { return 0; }\n" + step["run"]],
                                        cwd=td, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertFalse(old.exists())

    def test_restore_is_off_when_playlists_are_skipped(self):
        step = next(s for s in STEPS if s.get("name") == "Restore today's exports from earlier attempts")
        self.assertIn("inputs.skip_playlists == ''", step["if"])

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
