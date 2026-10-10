"""The committed app icon is a valid multi-size ICO built from the StreamBase logo."""
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'packaging'))
import make_icon


class IconBuild(unittest.TestCase):
    def test_committed_icon_has_every_size_as_png_entries(self):
        ico = (ROOT / 'packaging' / 'app.ico').read_bytes()
        self.assertEqual(struct.unpack('<HHH', ico[:6]), (0, 1, len(make_icon.SIZES)))
        self.assertEqual(make_icon.ico_sizes(ico), list(make_icon.SIZES))
        for i in range(len(make_icon.SIZES)):
            length, offset = struct.unpack('<II', ico[6 + 16 * i + 8:6 + 16 * i + 16])
            self.assertEqual(ico[offset:offset + 8], b'\x89PNG\r\n\x1a\n')
            self.assertLessEqual(offset + length, len(ico))
        self.assertEqual((ROOT / 'ui' / 'public' / 'favicon.ico').read_bytes(), ico)

    def test_rebuild_is_deterministic_and_resamples_to_the_requested_size(self):
        source = make_icon.SOURCE.read_bytes()
        self.assertEqual(make_icon.build_ico(source), make_icon.build_ico(source))
        width, height, rows = make_icon.read_png(source)
        small = make_icon.resample(width, height, rows, 32)
        self.assertEqual((len(small), len(small[0])), (32, 32 * 4))
        self.assertTrue(any(row[3::4].count(255) for row in small))  # the mark is opaque somewhere


if __name__ == '__main__': unittest.main()
