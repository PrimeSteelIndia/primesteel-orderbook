"""Generate the app icon (SVG + PNG) without any third-party imaging library.

Run once:  python tools/make_icons.py
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

NAVY = (27, 53, 84)
NAVY_DARK = (18, 38, 60)
WHITE = (255, 255, 255)
GREEN = (12, 107, 71)
PAPER = (246, 249, 252)


def rounded_rect(x, y, w, h, r, fill, bg):
    def inside(px, py):
        if x + r <= px <= x + w - r or y + r <= py <= y + h - r:
            return x <= px <= x + w and y <= py <= y + h
        cx = min(max(px, x + r), x + w - r)
        cy = min(max(py, y + r), y + h - r)
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
    return lambda px, py: fill if inside(px, py) else bg


def make_layer(size):
    """Return a pixel sampler for a `size` x `size` icon."""
    s = size
    # proportions relative to 192
    k = s / 192.0
    page = (54 * k, 38 * k, 84 * k, 118 * k)      # x, y, w, h
    page_r = 12 * k
    lines = [
        (68 * k, 64 * k, 56 * k, 8 * k),
        (68 * k, 84 * k, 56 * k, 8 * k),
        (68 * k, 104 * k, 36 * k, 8 * k),
    ]
    dot_r = 15 * k
    dot_c = (126 * k, 132 * k)

    def sample(px, py):
        # page
        if page[0] <= px <= page[0] + page[2] and page[1] <= py <= page[1] + page[3]:
            cx = min(max(px, page[0] + page_r), page[0] + page[2] - page_r)
            cy = min(max(py, page[1] + page_r), page[1] + page[3] - page_r)
            if (px - cx) ** 2 + (py - cy) ** 2 <= page_r ** 2 or (
                page[0] + page_r <= px <= page[0] + page[2] - page_r or
                page[1] + page_r <= py <= page[1] + page[3] - page_r
            ):
                for lx, ly, lw, lh in lines:
                    if lx <= px <= lx + lw and ly <= py <= ly + lh:
                        return NAVY
                if (px - dot_c[0]) ** 2 + (py - dot_c[1]) ** 2 <= dot_r ** 2:
                    return GREEN
                if (px - dot_c[0]) ** 2 + (py - dot_c[1]) ** 2 <= (dot_r - 6 * k) ** 2:
                    return WHITE
                return PAPER
        return NAVY

    return sample


def write_png(path: Path, size: int):
    sample = make_layer(size)
    ss = 3  # supersample for smooth edges
    rows = []
    for y in range(size):
        row = bytearray()
        row.append(0)  # filter type 0
        for x in range(size):
            r = g = b = 0
            for sy in range(ss):
                for sx in range(ss):
                    px = x + (sx + 0.5) / ss
                    py = y + (sy + 0.5) / ss
                    c = sample(px, py)
                    r += c[0]; g += c[1]; b += c[2]
            n = ss * ss
            row += bytes((r // n, g // n, b // n, 255))
        rows.append(bytes(row))

    raw = b"".join(rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n" +
           chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) +
           chunk(b"IDAT", zlib.compress(raw, 9)) +
           chunk(b"IEND", b""))
    path.write_bytes(png)
    print("wrote", path, len(png), "bytes")


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" fill="#1b3554"/>
  <rect x="54" y="38" width="84" height="118" rx="12" fill="#f6f9fc"/>
  <rect x="68" y="64" width="56" height="8" rx="4" fill="#1b3554"/>
  <rect x="68" y="84" width="56" height="8" rx="4" fill="#1b3554"/>
  <rect x="68" y="104" width="36" height="8" rx="4" fill="#1b3554"/>
  <circle cx="126" cy="132" r="15" fill="#0c6b47"/>
  <path d="M119 132l5 5 9-10" fill="none" stroke="#fff" stroke-width="4"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""


def write_ico(path: Path, png_path: Path):
    """Wrap a 256px PNG in an .ico so Windows shortcuts can use it."""
    png = png_path.read_bytes()
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 22)
    path.write_bytes(header + entry + png)
    print("wrote", path, len(header + entry + png), "bytes")


def main():
    (WEB / "icon.svg").write_text(SVG, encoding="utf-8")
    write_png(WEB / "icon-192.png", 192)
    write_png(WEB / "icon-512.png", 512)
    write_png(WEB / "icon-256.png", 256)
    write_ico(WEB / "prime-steel.ico", WEB / "icon-256.png")


if __name__ == "__main__":
    main()
