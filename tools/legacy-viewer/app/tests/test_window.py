"""Window sizing for the Edge app window: wanted size, clamped to the screen's work area, centred."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import WINDOW_SIZE, window_geometry


class WindowGeometry(unittest.TestCase):
    def test_large_screen_gets_the_wanted_size_centred(self):
        w, h, x, y = window_geometry((0, 0, 2560, 1400))
        self.assertEqual((w, h), WINDOW_SIZE)
        self.assertEqual((x, y), ((2560 - 1600) // 2, (1400 - 1000) // 2))

    def test_small_screen_is_clamped_inside_the_work_area(self):
        w, h, x, y = window_geometry((0, 0, 1366, 728))
        self.assertLessEqual(w, 1366); self.assertLessEqual(h, 728)
        self.assertGreaterEqual(x, 0); self.assertGreaterEqual(y, 0)
        self.assertLessEqual(x + w, 1366); self.assertLessEqual(y + h, 728)

    def test_work_area_offset_is_respected(self):
        _, _, x, y = window_geometry((1920, 40, 1920, 1000))
        self.assertGreaterEqual(x, 1920); self.assertGreaterEqual(y, 40)

    def test_unknown_screen_keeps_the_wanted_size_without_position(self):
        self.assertEqual(window_geometry(None), (*WINDOW_SIZE, None, None))


if __name__ == '__main__': unittest.main()
