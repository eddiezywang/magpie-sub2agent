"""Generate every native internal app icon from the canonical pixel S.

No raster resampling dependencies: nearest-neighbour keeps the palette intact,
including the small PNG frames Windows loads from an EXE or tray ICO.
Run: python build/pixel-icons/native.py
"""
import json
import struct
from pathlib import Path
import custom
from vendor import render

ROOT = Path(__file__).resolve().parents[2]
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)


def png(size, mono=False):
    grid = render.rgba_grid(custom.sub2agent(), render.HOUSE)
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            margin = 2 if mono else 0
            scale = size-2*margin
            if x < margin or y < margin or x >= size-margin or y >= size-margin:
                color = (0, 0, 0, 0)
            else:
                color = grid[min(31, int((y-margin+.5)*32/scale))][min(31, int((x-margin+.5)*32/scale))]
            row.extend((0, 0, 0, color[3]) if mono else color)
        rows.append(bytes(row))
    return render.png_bytes(size, size, rows)


def main():
    out = ROOT/'internal/gui/pixelbrand'
    out.mkdir(exist_ok=True)
    frames = [(s, png(s)) for s in SIZES]
    header = bytearray(struct.pack('<HHH', 0, 1, len(frames)))
    offset = 6+16*len(frames)
    for size, data in frames:
        header.extend(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
        (out/f'icon-{size}.png').write_bytes(data)
    (out/'app.ico').write_bytes(header+b''.join(data for _, data in frames))
    (out/'app-1024.png').write_bytes(png(1024))
    (out/'tray-44.png').write_bytes(png(44, mono=True))
    config = json.loads((ROOT/'build/windows/winres.json').read_text(encoding='utf-8'))
    config['RT_GROUP_ICON']['#3']['0000'] = [f'../../internal/gui/pixelbrand/icon-{s}.png' for s in reversed(SIZES)]
    (ROOT/'build/windows/winres-intranet.json').write_text(json.dumps(config, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    print('Generated native pixel S: EXE, taskbar/window, tray and large app icon')


if __name__ == '__main__':
    main()
