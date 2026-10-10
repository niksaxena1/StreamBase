"""Inventory archive paths/stat metadata only; never read config or secret contents.

Run BEFORE readers: this is the sole viewer write, replacing archive_inventory only.
"""
import argparse
import json
import re
from pathlib import Path

import duckdb

import common as C

DEFAULT_ARCHIVE = C.ARCHIVE
DEFAULT_DB = C.OUT_DB

def classify(path):
    s = path.lower()
    if s.endswith('.dump'): return 'pg dump'
    if 'grafana' in s and s.endswith('.db'): return 'grafana db'
    if 'filesystem' in s or 'full-root' in s: return 'filesystem image'
    if 'extract' in s or s.endswith(('.csv', '.csv.gz', '.parquet')): return 'extract'
    if s.endswith('.json') and ('dashboard' in s or '/dash' in s): return 'dashboard json'
    if 'inventory' in s or 'system' in s: return 'system inventory'
    if s.endswith(('.ini', '.conf', '.env', '.pem', '.key', '.sql')) or 'config' in s: return 'config'
    return 'docs'


def build(archive, db):
    hashes = {}
    manifest = archive / 'checksums' / 'SHA256SUMS.local.txt'
    for line in manifest.read_text(encoding='utf-8-sig').splitlines():
        m = re.match(r'^([a-fA-F0-9]{64})\s+\*?(.+)$', line)
        if m:
            key = m[2].replace('\\', '/').removeprefix('./')
            hashes[key] = m[1].lower()
    con = duckdb.connect(str(db))
    try:
        meta = {k: json.loads(v) for k, v in con.execute('select key,value from meta').fetchall()}
        profiles = meta.get('raw_profiles', {})
        rows = []
        for p in sorted(archive.rglob('*')):
            if not p.is_file() or p.is_symlink(): continue
            rel = p.relative_to(archive).as_posix()
            server = rel.split('/')[0]
            # The packaged viewer itself is kept inside the backup folder; it is not source material.
            if server == 'StreamBase Legacy Archive Viewer': continue
            kind = classify(rel)
            visible = 'preserved only'
            toc = None
            if kind == 'pg dump':
                if p.resolve() == C.DUMPS['playlistfollowers'].resolve():
                    tables = {'spotify_followers': profiles.get('pf_followers', {}).get('rows')}
                    visible = 'Followers: raw readings and daily maxima'
                elif p.resolve() == C.DUMPS['stats2'].resolve():
                    tables = {t: profiles.get('src_' + t, {}).get('rows') for t in ('tracks', 'milestones', 'artists', 'songs_by_artist')}
                    tables['_ev'] = meta.get('stats2_ev_rows', {}).get('rows')
                    visible = 'stats2 streams, milestones, artist dictionary; _ev excluded'
                elif p.resolve() == C.DUMPS['stats_old'].resolve():
                    tables = {t: profiles.get('scratch.old_' + t, {}).get('rows') for t in ('tracks', 'milestones')}
                    visible = 'stats subset of streams and milestones'
                else: tables = {}
                toc = json.dumps({'tables': [{'table': t, 'rows': n} for t, n in tables.items()], 'source': 'verified dump metadata in meta; no dump/config contents read'}, ensure_ascii=False)
            elif kind in ('grafana db', 'dashboard json'):
                visible = 'Original dashboards: definitions and translated panels (no datasource credentials)'
            elif kind == 'extract': visible = 'ISRC identity mapping and build cross-checks; original extract preserved'
            description = {'config': 'Configuration/security material: path and checksum only; never displayed or packaged', 'filesystem image': 'Preserved server filesystem image; not opened by viewer'}.get(kind, kind + ' archive artifact')
            rows.append((rel, server, kind, p.stat().st_size, hashes.get(rel), description, visible, toc))
        con.execute('begin')
        con.execute('create or replace table archive_inventory(relative_path varchar, server varchar, kind varchar, size_bytes bigint, sha256 varchar, description varchar, in_viewer varchar, toc_summary json)')
        con.executemany('insert into archive_inventory values (?, ?, ?, ?, ?, ?, ?, ?)', rows)
        con.execute('commit')
        return len(rows), sum(r[4] is not None for r in rows)
    finally:
        con.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument('--db', type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    count, hashed = build(args.archive.resolve(), args.db.resolve())
    print(json.dumps({'files': count, 'with_manifest_sha256': hashed}))
