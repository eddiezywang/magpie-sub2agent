#!/usr/bin/env python3
"""
OmaPix renderer — pure Python stdlib, no PIL, no Inkscape.

Turns the palette-indexed pixel data (data/icons.json) into a freedesktop
icon theme, colouring it with either the house palette or the palette of an
Omarchy theme (colors.toml) — a real 16-bit-console style palette swap.

  render.py --out ~/.local/share/icons/OmaPixIcon               # house palette
  render.py --out DIR --colors ~/.local/state/omarchy/current/theme/colors.toml
  render.py --out DIR --palette dmg                             # 4-shade handheld
  render.py --png icon-id out.png --scale 8                     # single preview
"""
import argparse, hashlib, json, os, re, struct, sys, zlib
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
THEME_NAME = 'OmaPixIcon'

# ------------------------------------------------------------------ palettes
# "OmaPix Vintage": warm paper, soft ink, SNES-era saturated-but-dusty hues.
HOUSE = {
    'K': '#1c1a24', 'k': '#33303f', 's': '#57536a', 'S': '#8d88a0', 'w': '#cdc7d6', 'W': '#f6f1e4',
    '1': '#8c2a3c', 'R': '#d9454f', 'r': '#f58a7e',
    '2': '#9c4a1f', 'O': '#ea8434', 'o': '#f8b86e',
    '3': '#a97f12', 'Y': '#f3c640', 'y': '#fde89c',
    '4': '#2b6a46', 'G': '#4da760', 'g': '#a3d77e',
    '5': '#1b6672', 'C': '#2eb1ad', 'c': '#94e6d4',
    '6': '#2a3f8c', 'B': '#4673d8', 'b': '#90b6f6',
    '7': '#5e2a78', 'M': '#a256c4', 'm': '#d8a2ea',
    '8': '#583421', 'N': '#8f5a34', 'n': '#c99063',
    '9': '#9c3466', 'P': '#e46b9e', 'p': '#f8b6cf',
    '0': '#1f6b5c', 'A': '#3fb58f', 'a': '#9fe3c4',
}
SHADOW_RGBA = (10, 8, 18, 92)


def hex2rgb(h):
    h = h.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def rgb2hex(c):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(v))) for v in c)


def mix(a, b, t):
    a, b = hex2rgb(a), hex2rgb(b)
    return rgb2hex([a[i] + (b[i] - a[i]) * t for i in range(3)])


def lum(h):
    r, g, b = (v / 255 for v in hex2rgb(h))
    return .2126 * r + .7152 * g + .0722 * b


def read_colors_toml(path):
    d = {}
    for line in open(path, encoding='utf-8'):
        m = re.match(r'\s*([\w-]+)\s*=\s*"([^"]*)"', line)
        if m:
            d[m[1]] = m[2]
    return d


def theme_palette(d):
    """Map an Omarchy colors.toml onto the 36 OmaPix slots."""
    g = lambda k, dflt=None: d.get(k) or dflt
    fg = g('foreground', '#d0d0d0')
    bg = g('background', '#1a1a1a')
    tones = [x for x in (fg, g('bright_foreground'), bg, g('dark_background'),
                         g('darker_background'), g('light_foreground')) if x]
    light_end = max(tones, key=lum)
    dark_end = min(tones, key=lum)
    light_end = mix(light_end, '#ffffff', .25)
    ink = mix(dark_end, '#000000', .55)
    if lum(ink) > .12:
        ink = mix(ink, '#000000', .5)
    p = {
        'W': light_end, 'w': mix(light_end, dark_end, .28), 'S': mix(light_end, dark_end, .52),
        's': mix(light_end, dark_end, .74), 'k': mix(dark_end, ink, .35), 'K': ink,
    }
    red, yel = g('red', '#d9454f'), g('yellow', '#f3c640')
    mag = g('magenta', '#a256c4')
    bases = {
        'red': red, 'orange': g('orange', mix(red, yel, .5)), 'yellow': yel,
        'green': g('green', '#4da760'), 'cyan': g('cyan', '#2eb1ad'), 'blue': g('blue', '#4673d8'),
        'magenta': mag, 'brown': g('brown', mix(g('orange', mix(red, yel, .5)), '#000', .45)),
        'pink': mix(mix(red, mag, .35), '#ffffff', .25), 'accent': g('accent', g('blue', '#4673d8')),
    }
    slots = {'red': '1Rr', 'orange': '2Oo', 'yellow': '3Yy', 'green': '4Gg', 'cyan': '5Cc',
             'blue': '6Bb', 'magenta': '7Mm', 'brown': '8Nn', 'pink': '9Pp', 'accent': '0Aa'}
    for hue, (dk, base, lt) in slots.items():
        b = bases[hue]
        br = g('bright_' + hue)
        light = br if br and abs(lum(br) - lum(b)) > .04 else mix(b, '#ffffff', .4)
        p[base], p[lt], p[dk] = b, light, mix(b, '#000000', .42)
    return p


def dmg_palette():
    """Handheld-1989 mode: every slot quantised by luminance to 4 greens."""
    shades = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f']
    p = {}
    for k, v in HOUSE.items():
        l = lum(v)
        p[k] = shades[0 if l < .2 else 1 if l < .45 else 2 if l < .72 else 3]
    return p


def resolve_palette(name=None, colors=None):
    if colors:
        return theme_palette(read_colors_toml(colors))
    if name in (None, 'house', 'omapix'):
        return dict(HOUSE)
    if name == 'dmg':
        return dmg_palette()
    themes = json.load(open(os.path.join(ROOT, 'data', 'omarchy-themes.json')))
    if name in themes:
        return theme_palette(themes[name])
    sys.exit(f'unknown palette {name}')


# ------------------------------------------------------------------ PNG
def png_bytes(w, h, rows):
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(t, data):
        c = struct.pack('>I', len(data)) + t + data
        return c + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def rgba_grid(rows, pal):
    lut = {k: hex2rgb(v) + (255,) for k, v in pal.items()}
    lut['.'] = (0, 0, 0, 0)
    lut['%'] = SHADOW_RGBA
    return [[lut[ch] for ch in r] for r in rows]


def scale_rows(grid, size):
    n = len(grid)
    if size >= n:  # nearest neighbour — keeps every pixel crisp
        idx = [i * n // size for i in range(size)]
        out, cache = [], {}
        for y in idx:
            if y not in cache:
                cache[y] = b''.join(bytes(grid[y][x]) for x in idx)
            out.append(cache[y])
        return out
    # box filter (premultiplied) for 16/22/24px
    out = []
    for oy in range(size):
        ya, yb = oy * n / size, (oy + 1) * n / size
        row = bytearray()
        for ox in range(size):
            xa, xb = ox * n / size, (ox + 1) * n / size
            acc = [0.0] * 4; tw = 0.0
            for y in range(int(ya), min(n, int(yb + .999))):
                wy = min(yb, y + 1) - max(ya, y)
                for x in range(int(xa), min(n, int(xb + .999))):
                    wx = min(xb, x + 1) - max(xa, x)
                    wgt = wx * wy
                    r, g, b, a = grid[y][x]
                    acc[0] += r * a * wgt; acc[1] += g * a * wgt; acc[2] += b * a * wgt
                    acc[3] += a * wgt; tw += wgt
            a = acc[3] / tw if tw else 0
            row += bytes([round(acc[0] / acc[3]) if acc[3] else 0, round(acc[1] / acc[3]) if acc[3] else 0,
                          round(acc[2] / acc[3]) if acc[3] else 0, round(a)])
        out.append(bytes(row))
    return out


def render_png(rows, pal, size):
    return png_bytes(size, size, scale_rows(rgba_grid(rows, pal), size))


def svg(rows, pal):
    """Crisp vector pixel art: one <path> per palette slot, each pixel run an
    'h' segment, so it stays razor sharp at any size the desktop asks for."""
    n = len(rows)
    runs = {}
    for y, r in enumerate(rows):
        x = 0
        while x < n:
            ch = r[x]; x2 = x
            while x2 + 1 < n and r[x2 + 1] == ch:
                x2 += 1
            if ch != '.':
                runs.setdefault(ch, []).append(f'M{x} {y}h{x2 - x + 1}v1h-{x2 - x + 1}z')
            x = x2 + 1
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{n}" height="{n}" viewBox="0 0 {n} {n}" '
           'shape-rendering="crispEdges">']
    for ch, segs in runs.items():
        if ch == '%':
            fill = 'fill="#%02x%02x%02x" fill-opacity="%.2f"' % (*SHADOW_RGBA[:3], SHADOW_RGBA[3] / 255)
        else:
            fill = f'fill="{pal[ch]}"'
        out.append(f'<path {fill} d="{"".join(segs)}"/>')
    out.append('</svg>')
    return ''.join(out)


# ------------------------------------------------------------------ theme
def _job(args):
    out, sub, ctx, rows, names, pal = args
    d = os.path.join(out, sub, ctx)
    first = names[0] + '.svg'
    with open(os.path.join(d, first), 'w') as f:
        f.write(svg(rows, pal))
    for nm in names[1:]:
        p = os.path.join(d, nm + '.svg')
        if os.path.lexists(p):
            os.remove(p)
        os.symlink(first, p)
    return len(names)


def build_theme(out, pal, inherits='Yaru-blue,Yaru,Adwaita,hicolor', jobs=None, label='house'):
    raw = open(os.path.join(ROOT, 'data', 'icons.json'), 'rb').read()
    icons = json.loads(raw)
    # The folder is named after the palette and the icon data, so every re-colour
    # lands at new file paths. The Omarchy shell keeps an icon on screen (the dock)
    # cached by its path; a new path is what makes it load the new colours.
    tag = hashlib.sha256(json.dumps(pal, sort_keys=True).encode() + raw).hexdigest()[:8]
    sub = f'scalable-{tag}'
    ctxs = sorted({v.get('context', 'apps') for v in icons.values()})
    for ctx in ctxs:
        os.makedirs(os.path.join(out, sub, ctx), exist_ok=True)
    work = [(out, sub, v.get('context', 'apps'), v['rows'], v['names'], pal) for v in icons.values()]
    with ProcessPoolExecutor(max_workers=jobs) as ex:
        total = sum(ex.map(_job, work, chunksize=16))
    ctxname = {'apps': 'Applications', 'places': 'Places'}
    dirs = [f'{sub}/{c}' for c in ctxs]
    sect = [f'[{sub}/{c}]\nSize=64\nMinSize=8\nMaxSize=1024\nContext={ctxname.get(c, c)}\nType=Scalable\n'
            for c in ctxs]
    with open(os.path.join(out, 'index.theme'), 'w') as f:
        f.write('[Icon Theme]\nName=OmaPixIcon\nComment=High-resolution 64px pixel icons for Omarchy '
                f'(palette: {label})\nInherits={inherits}\nExample=org.gnome.Nautilus\n\n'
                'Directories=' + ','.join(dirs) + '\n\n' + '\n'.join(sect))
    with open(os.path.join(out, '.omapix-palette'), 'w') as f:
        f.write(label + '\n')
    return len(icons), total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out')
    ap.add_argument('--palette', default='house', help='house | dmg | <omarchy theme name>')
    ap.add_argument('--colors', help='path to an Omarchy colors.toml (overrides --palette)')
    ap.add_argument('--inherits', default='Yaru-blue,Yaru,Adwaita,hicolor')
    ap.add_argument('--png', nargs=2, metavar=('ID', 'FILE'))
    ap.add_argument('--svg', nargs=2, metavar=('ID', 'FILE'))
    ap.add_argument('--size', type=int, default=256)
    ap.add_argument('--jobs', type=int)
    ap.add_argument('--dump-palette', action='store_true')
    a = ap.parse_args()
    pal = resolve_palette(a.palette, a.colors)
    if a.dump_palette:
        print(json.dumps(pal, indent=1)); return
    if a.png or a.svg:
        icons = json.load(open(os.path.join(ROOT, 'data', 'icons.json')))
        iid, path = a.png or a.svg
        rows = icons[iid]['rows']
        if a.png:
            open(path, 'wb').write(render_png(rows, pal, a.size))
        else:
            open(path, 'w').write(svg(rows, pal))
        return
    if not a.out:
        ap.error('--out required')
    label = os.path.basename(os.path.dirname(a.colors)) if a.colors else a.palette
    n, total = build_theme(os.path.expanduser(a.out), pal, a.inherits, a.jobs, label)
    print(f'OmaPixIcon: {n} icons / {total} names rendered with palette "{label}"')


if __name__ == '__main__':
    main()
