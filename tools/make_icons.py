#!/usr/bin/env python3
"""Иконки для домашнего экрана: тёмный фон и три столбика, как на полосе получек."""
import zlib, struct
from pathlib import Path

BG = (14, 20, 19)
BAR = (87, 195, 166)
DIM = (32, 58, 51)
OUT = Path(__file__).resolve().parent.parent / 'public'


def png(size, path):
    px = [[BG for _ in range(size)] for _ in range(size)]
    u = size / 100.0
    bars = [(20, 44, DIM), (41, 26, BAR), (62, 58, BAR), (83, 38, DIM)]
    for cx, h, color in bars:
        x0, x1 = int((cx - 7) * u), int((cx + 7) * u)
        y1 = int(78 * u)
        y0 = int((78 - h) * u)
        for y in range(y0, y1):
            for x in range(x0, x1):
                if 0 <= x < size and 0 <= y < size:
                    px[y][x] = color

    raw = b''.join(b'\x00' + b''.join(bytes(p) for p in row) for row in px)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    out = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    path.write_bytes(out)
    print(path.name, len(out), 'байт')


png(180, OUT / 'icon-180.png')
png(512, OUT / 'icon-512.png')
