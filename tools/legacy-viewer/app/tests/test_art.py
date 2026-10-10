"""Artwork contracts: art URLs present/null, safe static /art route, offline fallbacks."""
import http.client
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api_service import Service
from server import ViewerServer

DB = Path(os.environ['LEGACY_TEST_DB']) if os.environ.get('LEGACY_TEST_DB') else None
ART = Path(os.environ['LEGACY_TEST_ART']) if os.environ.get('LEGACY_TEST_ART') else None
JPEG = b'\xff\xd8\xff\xe0' + b'0' * 40


@unittest.skipUnless(DB is not None and DB.is_file(), 'requires LEGACY_TEST_DB archive data')
class ArtworkContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        base = Path(cls.temp.name)
        (base / 'art' / 'tracks').mkdir(parents=True)
        (base / 'art' / 'artists').mkdir()
        (base / 'ui').mkdir()
        (base / 'ui' / 'index.html').write_text('<html></html>', encoding='utf-8')
        (base / 'art' / 'tracks' / 'ABC123.jpg').write_bytes(JPEG)
        (base / 'art' / 'tracks' / 'notes.txt').write_text('not an image', encoding='utf-8')
        (base / 'secret.jpg').write_bytes(JPEG)  # sibling of the art folder: must stay unreachable
        cls.base = base
        cls.service = Service(DB)
        cls.server = ViewerServer(('127.0.0.1', 0), cls.service, base / 'ui', art=base / 'art')
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.c = cls.service.con.cursor()

    @classmethod
    def tearDownClass(cls):
        cls.c.close(); cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
        cls.service.close(); cls.temp.cleanup()

    def get(self, path, method='GET'):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            conn.request(method, path)
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally: conn.close()

    def api(self, path, **p): return self.service.dispatch(self.c, path, p)

    def test_static_route_serves_jpeg_with_long_cache(self):
        status, headers, body = self.get('/art/tracks/ABC123.jpg')
        self.assertEqual((status, headers['Content-Type'], body), (200, 'image/jpeg', JPEG))
        self.assertIn('max-age=31536000', headers['Cache-Control'])
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        status, headers, body = self.get('/art/tracks/ABC123.jpg', 'HEAD')
        self.assertEqual((status, body), (200, b''))
        self.assertEqual(int(headers['Content-Length']), len(JPEG))

    def test_static_route_rejects_traversal_and_other_files(self):
        for path in ('/art/../secret.jpg', '/art/tracks/../../secret.jpg', '/art/%2e%2e/secret.jpg',
                     '/art/tracks/%2e%2e%2f%2e%2e%2fsecret.jpg', '/art/..%2fsecret.jpg',
                     '/art/tracks/..%5c..%5csecret.jpg', '/art/tracks/ABC123.jpg%00.png',
                     '/art//secret.jpg', '/art/C:/Windows/win.ini'):
            status, _, body = self.get(path)
            self.assertIn(status, (400, 403, 404), path)
            self.assertNotEqual(body, JPEG, path)
        self.assertEqual(self.get('/art/tracks/notes.txt')[0], 404)      # only .jpg is served
        self.assertEqual(self.get('/art/tracks/MISSING.jpg')[0], 404)
        self.assertEqual(self.get('/art/tracks')[0], 404)                # no directory listing

    def test_server_without_art_folder_returns_404(self):
        server = ViewerServer(('127.0.0.1', 0), self.service, self.base / 'ui')
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            conn.request('GET', '/art/tracks/ABC123.jpg')
            self.assertEqual(conn.getresponse().status, 404); conn.close()
        finally: server.shutdown(); server.server_close(); thread.join()

    def test_art_urls_present_in_every_track_and_artist_payload(self):
        if not self.service.art.tracks: self.skipTest('database has no art tables (run build/fetch_artwork.py)')
        isrc = next(iter(self.service.art.tracks))
        url = self.service.art.tracks[isrc]
        self.assertEqual(url, f'art/tracks/{isrc}.jpg')
        credit = self.c.execute('select artist from isrc_identity where isrc=?', [isrc]).fetchone()[0]
        first_artist = credit.split(',')[0].strip()
        monthly = self.api('/api/lookup/monthly', isrc=isrc)
        self.assertEqual(monthly['track']['art'], url)
        self.assertEqual([a['name'] for a in monthly['track']['artists']], [n.strip() for n in credit.split(',') if n.strip()])
        tracks = self.api('/api/lookup/tracks', artist=first_artist)['rows']
        self.assertEqual({t['isrc']: t['art'] for t in tracks}[isrc], url)
        artists = {a['name']: a['art'] for a in self.api('/api/lookup/artists', q=first_artist)['rows']}
        self.assertEqual(artists[first_artist], self.service.art.artists.get(first_artist))
        self.assertEqual(self.api('/api/tracks', q=isrc)['rows'][0]['art'], url)
        self.assertEqual(self.api('/api/explorer/tracks', q=isrc)['rows'][0]['art'], url)
        self.assertEqual(self.api('/api/track/' + isrc)['identity']['art'], url)
        detail = self.api('/api/artist/' + first_artist)
        self.assertEqual(detail['art'], self.service.art.artists.get(first_artist))
        self.assertEqual({t['isrc']: t['art'] for t in detail['tracks']}[isrc], url)
        listed = {r['artist']: r['art'] for r in self.api('/api/artists', q=first_artist)['rows']}
        self.assertEqual(listed[first_artist], self.service.art.artists.get(first_artist))
        playlist = self.api('/api/playlist/0OwqBeZIh0JNJcIVobdtOz')
        self.assertTrue(all('art' in t for t in playlist['tracks']))
        for row in tracks:  # URLs exist on disk when the art folder is present
            if row['art'] and ART is not None and ART.is_dir(): self.assertTrue((ART / row['art'][len('art/'):]).is_file())

    def test_art_is_null_without_files_or_tables(self):
        empty = Path(self.temp.name) / 'empty-art'
        empty.mkdir()
        bare = Service(DB, art_dir=empty)   # tables may exist, but no file does -> initials tiles
        try:
            cursor = bare.con.cursor()
            tracks = bare.dispatch(cursor, '/api/lookup/tracks', {'artist': 'Joongle'})['rows']
            self.assertTrue(tracks and all(t['art'] is None for t in tracks))
            monthly = bare.dispatch(cursor, '/api/lookup/monthly', {'isrc': 'SE6QE2204745'})
            self.assertIsNone(monthly['track']['art'])
            self.assertTrue(all(a['art'] is None for a in monthly['track']['artists']))
            self.assertTrue(all(r['art'] is None for r in bare.dispatch(cursor, '/api/lookup/artists', {'q': 'Joongle'})['rows']))
            cursor.close()
        finally: bare.close()
        self.assertEqual(self.api('/api/lookup/tracks', artist='No such artist')['rows'], [])
        self.assertIsNone(self.service.art.track('NOT-AN-ISRC'))
        self.assertIsNone(self.service.art.artist('No such artist'))


if __name__ == '__main__': unittest.main()
