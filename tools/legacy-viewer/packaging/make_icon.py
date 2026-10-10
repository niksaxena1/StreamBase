"""Build the multi-size Windows icon from the StreamBase logo using only the standard library.

    python packaging/make_icon.py

Reads `ui/src/assets/logo-dark.png` (the lime mark: readable on light and dark taskbars/tabs),
resamples it to 16..256 px (area average on premultiplied alpha) and writes an ICO container with
PNG entries to `packaging/app.ico` (EXE icon, see legacy_viewer.spec) and `ui/public/favicon.ico`
(browser/app-window favicon). Re-run only if the logo changes; the .ico files are committed.
"""
import argparse
from pathlib import Path
import struct
import zlib

SIZES = (16, 24, 32, 48, 64, 128, 256)
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'ui' / 'src' / 'assets' / 'logo-dark.png'


def read_png(data):
    """Decode a non-interlaced 8-bit RGBA/RGB PNG into (width, height, rows of bytearray RGBA)."""
    if data[:8] != b'\x89PNG\r\n\x1a\n': raise ValueError('not a PNG')
    pos, idat, header = 8, [], None
    while pos < len(data):
        length, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b'IHDR': header = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT': idat.append(body)
        elif kind == b'IEND': break
    width, height, depth, color, _, _, interlace = header
    if depth != 8 or color not in (2, 6) or interlace: raise ValueError('only 8-bit non-interlaced RGB/RGBA PNGs are supported')
    bpp = 4 if color == 6 else 3
    raw, stride = zlib.decompress(b''.join(idat)), width * bpp
    rows, previous = [], bytearray(stride)
    for y in range(height):
        offset = y * (stride + 1)
        method, line = raw[offset], bytearray(raw[offset + 1:offset + 1 + stride])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b, c = previous[i], (previous[i - bpp] if i >= bpp else 0)
            if method == 1: line[i] = (line[i] + a) & 255
            elif method == 2: line[i] = (line[i] + b) & 255
            elif method == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif method == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        previous = line
        if bpp == 3:
            rgba = bytearray(width * 4)
            for x in range(width): rgba[x * 4:x * 4 + 3], rgba[x * 4 + 3] = line[x * 3:x * 3 + 3], 255
            line = rgba
        rows.append(line)
    return width, height, rows


def resample(width, height, rows, size):
    """Area-average downscale on premultiplied alpha (no external imaging library)."""
    if size == width == height: return rows
    out = []
    for oy in range(size):
        y0, y1 = oy * height / size, (oy + 1) * height / size
        line = bytearray(size * 4)
        for ox in range(size):
            x0, x1 = ox * width / size, (ox + 1) * width / size
            r = g = b = a = weight = 0.0
            for y in range(int(y0), min(height, int(y1) + 1)):
                wy = min(y + 1, y1) - max(y, y0)
                if wy <= 0: continue
                row = rows[y]
                for x in range(int(x0), min(width, int(x1) + 1)):
                    w = wy * (min(x + 1, x1) - max(x, x0))
                    if w <= 0: continue
                    alpha = row[x * 4 + 3] * w
                    r += row[x * 4] * alpha; g += row[x * 4 + 1] * alpha; b += row[x * 4 + 2] * alpha
                    a += alpha; weight += w
            if a:
                line[ox * 4:ox * 4 + 4] = bytes((round(r / a), round(g / a), round(b / a), round(a / weight)))
        out.append(line)
    return out


def write_png(size, rows):
    raw = b''.join(b'\x00' + bytes(row) for row in rows)
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def build_ico(source_png, sizes=SIZES):
    width, height, rows = read_png(source_png)
    if width != height: raise ValueError('the logo must be square')
    images = [(size, write_png(size, resample(width, height, rows, size))) for size in sizes]
    header = struct.pack('<HHH', 0, 1, len(images))
    offset, directory, payload = 6 + 16 * len(images), b'', b''
    for size, png in images:
        directory += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(png), offset + len(payload))
        payload += png
    return header + directory + payload


def ico_sizes(ico):
    """Sizes stored in an ICO (0 in the directory means 256)."""
    count = struct.unpack('<H', ico[4:6])[0]
    return [(ico[6 + 16 * i] or 256) for i in range(count)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--out', type=Path, default=ROOT / 'packaging' / 'app.ico')
    parser.add_argument('--favicon', type=Path, default=ROOT / 'ui' / 'public' / 'favicon.ico')
    args = parser.parse_args()
    ico = build_ico(args.source.read_bytes())
    for target in (args.out, args.favicon):
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(ico)
        print('wrote', target, len(ico), 'bytes, sizes', ico_sizes(ico))


if __name__ == '__main__':
    main()
