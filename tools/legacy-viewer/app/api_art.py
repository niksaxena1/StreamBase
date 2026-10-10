"""Artwork lookups: relative URLs for the small cached thumbnails (stdlib + DuckDB only).

`art_tracks(isrc, file)` and `art_artists(artist_name, spotify_artist_id, file)` are written by
build/fetch_artwork.py. A build without artwork has no such tables: every `art` is then null and the
UI shows initials tiles. Files are served by the HTTP server under /art/.
"""
from pathlib import Path


class Art:
    def __init__(self, con, art_dir=None):
        self.tracks, self.artists = {}, {}
        present = {r[0] for r in con.execute(
            "select table_name from information_schema.tables where table_name in ('art_tracks','art_artists')").fetchall()}
        # With a known art folder only files that exist are linked (a package built without
        # the folder must show initials tiles instead of broken images).
        usable = (lambda f: True) if art_dir is None else (lambda f, base=Path(art_dir): (base / f).is_file())
        if 'art_tracks' in present:
            self.tracks = {i: 'art/' + f for i, f in con.execute('select isrc,file from art_tracks').fetchall() if usable(f)}
        if 'art_artists' in present:
            self.artists = {n: 'art/' + f for n, f in con.execute('select artist_name,file from art_artists').fetchall() if usable(f)}

    def track(self, isrc):
        return self.tracks.get(isrc)

    def artist(self, name):
        return self.artists.get(name)

    def credits(self, credit):
        """Comma-split artist credit with the exact-name photo of each credited artist."""
        names = []
        for part in (credit or '').split(','):
            part = part.strip()
            if part and part not in names: names.append(part)
        return [{'name': n, 'art': self.artist(n)} for n in names]

    def with_tracks(self, rows, key='isrc'):
        return [{**r, 'art': self.track(r.get(key))} for r in rows]

    def with_artists(self, rows, key='artist'):
        return [{**r, 'art': self.artist(r.get(key))} for r in rows]
