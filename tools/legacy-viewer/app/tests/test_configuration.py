"""Portable configuration contracts; no archive input is needed."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'app'))
from api_original import Original
import server


class PortableConfiguration(unittest.TestCase):
    def test_source_startup_requires_explicit_database(self):
        with patch.object(sys, 'frozen', False, create=True):
            with patch('sys.stderr'), self.assertRaises(SystemExit) as error:
                server.main([])
        self.assertEqual(error.exception.code, 2)

    def test_private_registry_preserves_supplied_defaults(self):
        registry = Original().registry
        variable = registry['dashboards'][0]['variables']['artist_name']
        variable['current'] = {'text': 'Fixture Artist', 'value': 'Fixture Artist'}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'grafana_registry.json'
            path.write_text(json.dumps(registry), encoding='utf-8')
            private = Original(path)
        current = private.list_dashboards()['dashboards'][0]['variables']['artist_name']['current']
        self.assertEqual(current, variable['current'])

    def test_public_registry_contains_no_cached_query_results(self):
        registry = Original().registry

        def check(value):
            if isinstance(value, dict):
                self.assertNotIn('options_resolved_at', value)
                self.assertNotIn('first_reading', value)
                self.assertNotIn('last_reading', value)
                if value.get('type') == 'query':
                    self.assertNotIn('options', value)
                    self.assertEqual(value.get('current'), {'text': '', 'value': ''})
                for child in value.values():
                    check(child)
            elif isinstance(value, list):
                for child in value:
                    check(child)

        check(registry)
        self.assertEqual(len(Original().list_dashboards()['dashboards']), 7)

    def test_build_inputs_have_no_private_defaults(self):
        spec = importlib.util.spec_from_file_location('legacy_build_config_test', ROOT / 'build/common.py')
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {spec.name: module}), patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'Set LEGACY_ARCHIVE'):
                spec.loader.exec_module(module)
            names = ('ARCHIVE', 'PG_BIN', 'PG_DATA', 'BUILD_DIR', 'STATS2_DUMP', 'STATS_DUMP',
                     'FOLLOWERS_DUMP', 'STATS2_GRAFANA', 'STATS_GRAFANA', 'FOLLOWERS_GRAFANA', 'EXTRACT_DIR')
            with tempfile.TemporaryDirectory() as folder:
                os.environ.update({'LEGACY_' + name: str(Path(folder) / name) for name in names})
                os.environ['LEGACY_PG_USER'] = 'fixture_role'
                spec.loader.exec_module(module)
                self.assertEqual(module.DUMPS['stats2'], Path(folder) / 'STATS2_DUMP')
                self.assertEqual(module.PG_USER, 'fixture_role')
                self.assertEqual(module.OUT_DB, Path(folder) / 'BUILD_DIR/legacy_archive.duckdb')


if __name__ == '__main__':
    unittest.main()
