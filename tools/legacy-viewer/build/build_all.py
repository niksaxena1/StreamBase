#!/usr/bin/env python
"""Run the whole pipeline: restore_sources -> export_raw -> derive; verify; write build_report.json.

Exit code is non-zero if any stage fails or any recorded check has passed=False.

Usage: python build_all.py [--skip-restore] [--skip-export] [--skip-artwork]
(skip-export reuses the existing raw tables; skip-artwork leaves out the optional, network-using thumbnail step)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common as C  # noqa: E402


def run_stage(name: str, script: str) -> tuple[int, float]:
    print(f"\n######## {name} ########", flush=True)
    t0 = time.time()
    r = subprocess.run([sys.executable, "-u", str(HERE / script)])
    return r.returncode, time.time() - t0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-restore", action="store_true")
    ap.add_argument("--skip-export", action="store_true")
    ap.add_argument("--skip-artwork", action="store_true", help="skip the optional artwork download (needs network + web/.env.local)")
    a = ap.parse_args()
    t_all = time.time()
    C.BUILD_DIR.mkdir(parents=True, exist_ok=True)
    if C.CHECKS_FILE.exists():
        C.CHECKS_FILE.unlink()

    stages = []
    if not a.skip_restore:
        stages.append(("restore_sources", "restore_sources.py"))
    if not a.skip_export:
        stages.append(("export_raw", "export_raw.py"))
    stages.append(("derive", "derive.py"))
    stages.append(("archive_inventory", "archive_inventory.py"))
    if not a.skip_artwork:
        # Optional: needs network and web/.env.local. A failure here never fails the archive build;
        # the viewer simply shows its initials tiles instead of artwork.
        stages.append(("artwork", "fetch_artwork.py"))

    timings, rcs = {}, {}
    for name, script in stages:
        rc, secs = run_stage(name, script)
        timings[name] = round(secs, 1)
        rcs[name] = rc
        if rc != 0 and name == "artwork":
            print(f"!! optional stage artwork exited with {rc}; the viewer will use initials tiles (rerun fetch_artwork.py later)", flush=True)
            rcs[name] = 0
            continue
        if rc != 0:
            print(f"!! stage {name} exited with {rc}; continuing only to report", flush=True)
            if not C.OUT_DB.exists() or name != "derive":
                break

    checks = []
    if C.CHECKS_FILE.exists():
        checks = [json.loads(l) for l in C.CHECKS_FILE.read_text(encoding="utf-8").splitlines() if l.strip()]
    failed = [c for c in checks if not c["passed"]]
    total_secs = time.time() - t_all

    counts, size = {}, None
    if C.OUT_DB.exists():
        try:
            con = C.duck_connect(C.OUT_DB)
            for (t,) in con.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main' AND table_type='BASE TABLE' ORDER BY 1").fetchall():
                counts[t] = con.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
            C.meta_set(con, "verification", checks)
            C.meta_set(con, "build_timings_seconds", {**timings, "total": round(total_secs, 1)})
            C.meta_set(con, "build_failed_checks", [c["name"] for c in failed])
            con.execute("CHECKPOINT")
            con.close()
        except Exception as e:  # report even if the db is unreadable
            print("could not annotate meta:", e, flush=True)
        size = C.OUT_DB.stat().st_size

    report = {"built_at": C.now_iso(), "script_version": C.SCRIPT_VERSION, "ok": not failed and all(v == 0 for v in rcs.values()),
              "stage_exit_codes": rcs, "stage_seconds": timings, "total_seconds": round(total_secs, 1),
              "output": str(C.OUT_DB), "output_bytes": size, "table_row_counts": counts,
              "checks_total": len(checks), "checks_failed": len(failed), "failed": failed, "checks": checks}
    C.REPORT.write_text(json.dumps(report, indent=1, default=str), encoding="utf-8")

    print("\n================ BUILD SUMMARY ================")
    for t, n in counts.items():
        print(f"  {t:<24}{n:>14,}")
    print(f"  stages: {timings}   total {total_secs:.0f}s")
    print(f"  output: {C.OUT_DB}  ({(size or 0) / 1e6:,.0f} MB)")
    print(f"  checks: {len(checks)} recorded, {len(failed)} failed")
    for c in failed:
        print(f"   FAILED [{c['stage']}] {c['name']}: expected={c['expected']} actual={c['actual']} {c.get('note', '')}")
    print(f"  report: {C.REPORT}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
