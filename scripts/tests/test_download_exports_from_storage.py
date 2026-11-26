import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

from scripts.download_exports_from_storage import main


class DownloadExportsTests(unittest.TestCase):
    def test_partial_download_reports_only_saved_files_and_uses_auth(self):
        with tempfile.TemporaryDirectory() as td:
            output = Path(td) / "output"
            ok = Mock(status_code=200, content=b"isrc,name\nA,Track\n")
            missing = Mock(status_code=404)
            argv = ["download", "--date", "2026-11-26", "--exports-dir", td,
                    "--playlist-keys", "good,missing,error", "--github-output", str(output), "--authenticated"]
            with patch("sys.argv", argv), patch.dict(os.environ, {
                "SUPABASE_URL": "https://example.invalid", "SUPABASE_SERVICE_ROLE_KEY": "test-key",
                "SUPABASE_STORAGE_BUCKET": "private-exports", "SUPABASE_STORAGE_PREFIX": "own",
            }), patch("scripts.download_exports_from_storage.requests.get", side_effect=[ok, missing, requests.ConnectionError("offline")]) as get:
                main()
            self.assertEqual(output.read_text(), "restored=1\n")
            self.assertEqual((Path(td) / "2026/11/26/good.csv").read_bytes(), ok.content)
            self.assertFalse((Path(td) / "2026/11/26/missing.csv").exists())
            self.assertFalse((Path(td) / "2026/11/26/error.csv").exists())
            self.assertEqual(get.call_args_list[0].args[0], "https://example.invalid/storage/v1/object/private-exports/own/2026/11/26/good.csv")
            self.assertEqual(get.call_args_list[0].kwargs["headers"]["Authorization"], "Bearer test-key")

    def test_default_keeps_public_download_behavior(self):
        with tempfile.TemporaryDirectory() as td:
            argv = ["download", "--date", "2026-11-26", "--exports-dir", td, "--playlist-keys", "good"]
            with patch("sys.argv", argv), patch.dict(os.environ, {
                "SUPABASE_URL": "https://example.invalid", "SUPABASE_SERVICE_ROLE_KEY": "test-key",
            }), patch("scripts.download_exports_from_storage.requests.get", return_value=Mock(status_code=200, content=b"header\n")) as get:
                main()
            self.assertIn("/object/public/", get.call_args.args[0])
            self.assertNotIn("headers", get.call_args.kwargs)

    def test_no_files_reports_zero(self):
        with tempfile.TemporaryDirectory() as td:
            output = Path(td) / "output"
            argv = ["download", "--date", "2026-11-26", "--exports-dir", td,
                    "--playlist-keys", "missing", "--github-output", str(output)]
            with patch("sys.argv", argv), patch.dict(os.environ, {
                "SUPABASE_URL": "https://example.invalid", "SUPABASE_SERVICE_ROLE_KEY": "test-key",
            }), patch("scripts.download_exports_from_storage.requests.get", return_value=Mock(status_code=404)):
                main()
            self.assertEqual(output.read_text(), "restored=0\n")
