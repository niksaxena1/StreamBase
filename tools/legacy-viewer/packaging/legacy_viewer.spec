# Build from any cwd; app imports are discovered without external runtime deps.
from pathlib import Path
root = Path(SPECPATH).parent
app = root / 'app'
registry = app / 'grafana_registry.json'
datas = [(str(registry), '.'), (str(app / 'panel_validation_summary.json'), '.')]
a = Analysis([str(app / 'server.py')], pathex=[str(app)], binaries=[], datas=datas,
             hiddenimports=['duckdb', 'uuid', 'fractions', 'ipaddress'] + (['grafana_compat'] if (app/'grafana_compat.py').is_file() else []),
             hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=['numpy', 'pandas', 'pytest', 'tzdata'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='StreamBase Legacy Viewer',
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=False, disable_windowed_traceback=False,
          icon=str(root / 'packaging' / 'app.ico'))
