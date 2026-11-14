"""
OmaPix drawing engine — a tiny, deterministic pixel-art toolkit.

Every icon is a 32x32 grid of *palette slots* (single characters), never RGB.
Colour is applied later by engine/render.py, which is what makes palette-swap
(16-bit console style) against any Omarchy theme possible.

Palette slots
-------------
  .  transparent
  K  ink (outline)            k  deep shade (inner dark detail)
  s  dark grey                S  mid grey
  w  light grey               W  paper white
  %  drop shadow (auto, translucent — never draw it by hand)

  hue      dark  base  light
  red       1     R     r
  orange    2     O     o
  yellow    3     Y     y
  green     4     G     g
  cyan      5     C     c
  blue      6     B     b
  magenta   7     M     m
  brown     8     N     n
  pink      9     P     p
  accent    0     A     a      (follows the Omarchy theme accent)

Coordinates: x right, y down, 0..31. Rect bounds are inclusive.
"""

import math

SIZE = 32
T = '.'
SHADOW = '%'
INK = 'K'

HUES = {  # name: (dark, base, light)
    'red': ('1', 'R', 'r'), 'orange': ('2', 'O', 'o'), 'yellow': ('3', 'Y', 'y'),
    'green': ('4', 'G', 'g'), 'cyan': ('5', 'C', 'c'), 'blue': ('6', 'B', 'b'),
    'magenta': ('7', 'M', 'm'), 'brown': ('8', 'N', 'n'), 'pink': ('9', 'P', 'p'),
    'accent': ('0', 'A', 'a'), 'grey': ('s', 'S', 'w'), 'paper': ('S', 'w', 'W'),
}
DARK, LIGHT = {}, {}
for _d, _b, _l in HUES.values():
    DARK.setdefault(_b, _d)
    LIGHT.setdefault(_b, _l)
DARK.update({'W': 'w', 'w': 'S', 'S': 's', 's': 'k', 'k': 'K'})
LIGHT.update({'K': 'k', 'k': 's', 's': 'S', 'S': 'w', 'w': 'W'})
for _d, _b, _l in HUES.values():
    LIGHT.setdefault(_d, _b)
    DARK.setdefault(_l, _b)
VALID = set('.KksSwW%') | {c for t in HUES.values() for c in t}

# ---------------------------------------------------------------- fonts
# 5x7 caps/digits, 3x5 micro font. '#' = on.
_F5 = """
A .###. #...# #...# ##### #...# #...# #...#
B ####. #...# #...# ####. #...# #...# ####.
C .###. #...# #.... #.... #.... #...# .###.
D ####. #...# #...# #...# #...# #...# ####.
E ##### #.... #.... ####. #.... #.... #####
F ##### #.... #.... ####. #.... #.... #....
G .###. #...# #.... #.### #...# #...# .####
H #...# #...# #...# ##### #...# #...# #...#
I .###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.
J ..### ...#. ...#. ...#. #..#. #..#. .##..
K #...# #..#. #.#.. ##... #.#.. #..#. #...#
L #.... #.... #.... #.... #.... #.... #####
M #...# ##.## #.#.# #.#.# #...# #...# #...#
N #...# ##..# #.#.# #..## #...# #...# #...#
O .###. #...# #...# #...# #...# #...# .###.
P ####. #...# #...# ####. #.... #.... #....
Q .###. #...# #...# #...# #.#.# #..#. .##.#
R ####. #...# #...# ####. #.#.. #..#. #...#
S .#### #.... #.... .###. ....# ....# ####.
T ##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..
U #...# #...# #...# #...# #...# #...# .###.
V #...# #...# #...# #...# #...# .#.#. ..#..
W #...# #...# #...# #.#.# #.#.# ##.## #...#
X #...# #...# .#.#. ..#.. .#.#. #...# #...#
Y #...# #...# .#.#. ..#.. ..#.. ..#.. ..#..
Z ##### ....# ...#. ..#.. .#... #.... #####
0 .###. #...# #..## #.#.# ##..# #...# .###.
1 ..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.
2 .###. #...# ....# ...#. ..#.. .#... #####
3 ####. ....# ....# .###. ....# ....# ####.
4 ...#. ..##. .#.#. #..#. ##### ...#. ...#.
5 ##### #.... ####. ....# ....# #...# .###.
6 .###. #.... #.... ####. #...# #...# .###.
7 ##### ....# ...#. ..#.. .#... .#... .#...
8 .###. #...# #...# .###. #...# #...# .###.
9 .###. #...# #...# .#### ....# ....# .###.
+ ..... ..#.. ..#.. ##### ..#.. ..#.. .....
- ..... ..... ..... ##### ..... ..... .....
> #.... .#... ..#.. ...#. ..#.. .#... #....
< ....# ...#. ..#.. .#... ..#.. ...#. ....#
_ ..... ..... ..... ..... ..... ..... #####
/ ....# ....# ...#. ..#.. .#... #.... #....
. ..... ..... ..... ..... ..... ..... ..#..
? .###. #...# ....# ...#. ..#.. ..... ..#..
! ..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..
$ ..#.. .#### #.#.. .###. ..#.# ####. ..#..
# .#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.
"""
_F3 = """
A ### #.# ### #.# #.#
B ##. #.# ##. #.# ##.
C ### #.. #.. #.. ###
D ##. #.# #.# #.# ##.
E ### #.. ##. #.. ###
F ### #.. ##. #.. #..
G ### #.. #.# #.# ###
H #.# #.# ### #.# #.#
I ### .#. .#. .#. ###
J ..# ..# ..# #.# ###
K #.# #.# ##. #.# #.#
L #.. #.. #.. #.. ###
M #.# ### ### #.# #.#
N ##. #.# #.# #.# #.#
O ### #.# #.# #.# ###
P ### #.# ### #.. #..
Q ### #.# #.# ### ..#
R ### #.# ##. #.# #.#
S ### #.. ### ..# ###
T ### .#. .#. .#. .#.
U #.# #.# #.# #.# ###
V #.# #.# #.# #.# .#.
W #.# #.# ### ### #.#
X #.# #.# .#. #.# #.#
Y #.# #.# .#. .#. .#.
Z ### ..# .#. #.. ###
0 ### #.# #.# #.# ###
1 .#. ##. .#. .#. ###
2 ##. ..# .#. #.. ###
3 ##. ..# .#. ..# ##.
4 #.# #.# ### ..# ..#
5 ### #.. ##. ..# ##.
6 .## #.. ### #.# ###
7 ### ..# .#. .#. .#.
8 ### #.# ### #.# ###
9 ### #.# ### ..# ##.
+ ... .#. ### .#. ...
- ... ... ### ... ...
> #.. .#. ..# .#. #..
_ ... ... ... ... ###
. ... ... ... ... .#.
/ ..# ..# .#. #.. #..
"""


def _parse_font(src):
    f = {}
    for line in src.strip('\n').split('\n'):
        ch, *rows = line.split(' ')
        f[ch] = rows
    return f


FONT5 = _parse_font(_F5)
FONT3 = _parse_font(_F3)


class Canvas:
    def __init__(self, size=SIZE):
        self.n = size
        self.g = [[T] * size for _ in range(size)]

    # ---------------------------------------------------------- basics
    def inb(self, x, y):
        return 0 <= x < self.n and 0 <= y < self.n

    def get(self, x, y):
        return self.g[y][x] if self.inb(x, y) else T

    def px(self, x, y, c):
        x, y = int(x), int(y)
        if self.inb(x, y):
            self.g[y][x] = c
        return self

    def pixels(self, pts, c):
        for x, y in pts:
            self.px(x, y, c)
        return self

    def rect(self, x0, y0, x1, y1, c):
        """Filled rectangle, inclusive bounds."""
        for y in range(min(y0, y1), max(y0, y1) + 1):
            for x in range(min(x0, x1), max(x0, x1) + 1):
                self.px(x, y, c)
        return self

    def frame(self, x0, y0, x1, y1, c):
        """1px rectangle border."""
        self.hline(x0, x1, y0, c).hline(x0, x1, y1, c)
        self.vline(x0, y0, y1, c).vline(x1, y0, y1, c)
        return self

    def hline(self, x0, x1, y, c):
        for x in range(min(x0, x1), max(x0, x1) + 1):
            self.px(x, y, c)
        return self

    def vline(self, x, y0, y1, c):
        for y in range(min(y0, y1), max(y0, y1) + 1):
            self.px(x, y, c)
        return self

    def rrect(self, x0, y0, x1, y1, c, r=2):
        """Filled rectangle with pixel-stepped round corners (r = 0..6)."""
        steps = {0: [], 1: [1], 2: [2, 1], 3: [3, 1, 1], 4: [4, 2, 1, 1],
                 5: [5, 3, 2, 1, 1], 6: [6, 4, 3, 2, 1, 1]}[r]
        for y in range(y0, y1 + 1):
            i = min(y - y0, y1 - y)
            cut = steps[i] if i < len(steps) else 0
            self.hline(x0 + cut, x1 - cut, y, c)
        return self

    def ellipse(self, cx, cy, rx, ry, c):
        """Filled ellipse. Centre is in pixel-edge coords: cx=16 is the seam
        between columns 15 and 16, giving perfect left/right symmetry."""
        for y in range(self.n):
            for x in range(self.n):
                dx, dy = (x + .5 - cx) / rx, (y + .5 - cy) / ry
                if dx * dx + dy * dy <= 1.0 + 1e-9:
                    self.px(x, y, c)
        return self

    def circle(self, cx, cy, r, c):
        return self.ellipse(cx, cy, r, r, c)

    def ring(self, cx, cy, r_out, r_in, c):
        for y in range(self.n):
            for x in range(self.n):
                d = math.hypot(x + .5 - cx, y + .5 - cy)
                if r_in < d <= r_out + 1e-9:
                    self.px(x, y, c)
        return self

    def arc(self, cx, cy, r_out, r_in, a0, a1, c):
        """Ring segment between angles a0..a1 degrees (0 = right, 90 = down)."""
        for y in range(self.n):
            for x in range(self.n):
                dx, dy = x + .5 - cx, y + .5 - cy
                d = math.hypot(dx, dy)
                if r_in < d <= r_out + 1e-9:
                    a = math.degrees(math.atan2(dy, dx)) % 360
                    lo, hi = a0 % 360, a1 % 360
                    if (lo <= hi and lo <= a <= hi) or (lo > hi and (a >= lo or a <= hi)):
                        self.px(x, y, c)
        return self

    def line(self, x0, y0, x1, y1, c, w=1):
        """Bresenham line; w>1 stamps a w x w square (top-left anchored)."""
        x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.rect(x0, y0, x0 + w - 1, y0 + w - 1, c) if w > 1 else self.px(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy; x0 += sx
            if e2 <= dx:
                err += dx; y0 += sy
        return self

    def poly(self, pts, c):
        """Filled polygon (pixel-centre sampling). pts in pixel-edge coords."""
        n = len(pts)
        for y in range(self.n):
            yc = y + .5
            xs = []
            for i in range(n):
                (xa, ya), (xb, yb) = pts[i], pts[(i + 1) % n]
                if (ya <= yc < yb) or (yb <= yc < ya):
                    xs.append(xa + (yc - ya) * (xb - xa) / (yb - ya))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(self.n):
                    if xs[i] <= x + .5 <= xs[i + 1]:
                        self.px(x, y, c)
        return self

    def tri(self, a, b, c_, c):
        return self.poly([a, b, c_], c)

    def flood(self, x, y, c):
        src = self.get(x, y)
        if src == c:
            return self
        st = [(x, y)]
        while st:
            x, y = st.pop()
            if self.inb(x, y) and self.g[y][x] == src:
                self.g[y][x] = c
                st += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        return self

    # ---------------------------------------------------------- sprites / text
    def sprite(self, x, y, art, cmap=None):
        """Blit multi-line ASCII art. '.' and ' ' are transparent.
        cmap remaps characters, e.g. {'#': 'W', 'x': 'R'}."""
        lines = [l for l in art.strip('\n').split('\n')]
        # strip common indentation
        ind = min((len(l) - len(l.lstrip())) for l in lines if l.strip())
        for j, line in enumerate(lines):
            for i, ch in enumerate(line[ind:]):
                if ch in '. ':
                    continue
                self.px(x + i, y + j, (cmap or {}).get(ch, ch))
        return self

    def text(self, x, y, s, c, font=5, scale=1, gap=1):
        """Pixel text. font=5 (5x7) or 3 (3x5). Returns width drawn."""
        f = FONT5 if font == 5 else FONT3
        cx = x
        for ch in s.upper():
            if ch == ' ':
                cx += (3 if font == 3 else 4) * scale
                continue
            rows = f[ch]
            for j, row in enumerate(rows):
                for i, b in enumerate(row):
                    if b == '#':
                        self.rect(cx + i * scale, y + j * scale,
                                  cx + i * scale + scale - 1, y + j * scale + scale - 1, c)
            cx += (len(rows[0]) + gap) * scale
        return self

    @staticmethod
    def text_width(s, font=5, scale=1, gap=1):
        w = 0
        for ch in s.upper():
            w += ((3 if font == 3 else 4) if ch == ' ' else ((5 if font == 5 else 3) + gap)) * scale
        return w - gap * scale

    # ---------------------------------------------------------- transforms
    def replace(self, old, new, region=None):
        x0, y0, x1, y1 = region or (0, 0, self.n - 1, self.n - 1)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if self.g[y][x] in old:
                    self.g[y][x] = new
        return self

    def mirror_x(self, axis=16):
        """Copy left half onto right half (axis = pixel-edge column)."""
        for y in range(self.n):
            for x in range(axis):
                xr = 2 * axis - 1 - x
                if 0 <= xr < self.n:
                    self.g[y][xr] = self.g[y][x]
        return self

    def flip_x(self):
        self.g = [row[::-1] for row in self.g]
        return self

    def shift(self, dx, dy):
        g = [[T] * self.n for _ in range(self.n)]
        for y in range(self.n):
            for x in range(self.n):
                if self.inb(x + dx, y + dy):
                    g[y + dy][x + dx] = self.g[y][x]
        self.g = g
        return self

    def paste(self, other, dx=0, dy=0):
        for y in range(other.n):
            for x in range(other.n):
                if other.g[y][x] != T:
                    self.px(x + dx, y + dy, other.g[y][x])
        return self

    # ---------------------------------------------------------- pixel-art passes
    def outline(self, c=INK, diag=False, only_outer=True):
        """Wrap every opaque shape with a 1px outline of colour c.
        4-neighbour (diag=False) gives the classic stepped 16-bit corners."""
        add = []
        nb = [(1, 0), (-1, 0), (0, 1), (0, -1)]
        if diag:
            nb += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
        for y in range(self.n):
            for x in range(self.n):
                if self.g[y][x] != T:
                    continue
                if any(self.get(x + a, y + b) not in (T, SHADOW) for a, b in nb):
                    add.append((x, y))
        for x, y in add:
            self.g[y][x] = c
        return self

    def bevel(self, colors=None, light=True, dark=True, edge=(T, INK, SHADOW)):
        """16-bit lighting from the top-left: pixels of the given colours that
        touch an edge (outline/transparent) above or left get their light tone,
        below or right get their dark tone. colors=None -> every hue base."""
        todo = []
        for y in range(self.n):
            for x in range(self.n):
                c = self.g[y][x]
                if colors is not None and c not in colors:
                    continue
                if colors is None and c not in LIGHT:
                    continue
                up, lf = self.get(x, y - 1), self.get(x - 1, y)
                dn, rt = self.get(x, y + 1), self.get(x + 1, y)
                if dark and (dn in edge or rt in edge):
                    todo.append((x, y, DARK.get(c, c)))
                elif light and (up in edge or lf in edge):
                    todo.append((x, y, LIGHT.get(c, c)))
        for x, y, c in todo:
            self.g[y][x] = c
        return self

    def dither(self, x0, y0, x1, y1, c1, c2, only=None):
        """Checkerboard two colours over a rect (classic 16-bit gradient band).
        only: restrict to pixels currently in this set of colours."""
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if only is None or self.get(x, y) in only:
                    self.px(x, y, c1 if (x + y) % 2 else c2)
        return self

    def shade_below(self, colors, c=None):
        """Darken the bottom-most pixel row of each column for the given colours."""
        for x in range(self.n):
            for y in range(self.n - 1, -1, -1):
                if self.g[y][x] in colors:
                    if self.get(x, y + 1) not in colors:
                        self.g[y][x] = c or DARK[self.g[y][x]]
        return self

    # ---------------------------------------------------------- finishing
    def bbox(self):
        xs = [x for y in range(self.n) for x in range(self.n) if self.g[y][x] not in (T, SHADOW)]
        ys = [y for y in range(self.n) for x in range(self.n) if self.g[y][x] not in (T, SHADOW)]
        if not xs:
            return (0, 0, -1, -1)
        return min(xs), min(ys), max(xs), max(ys)

    def finalize(self, shadow=True):
        """Centre the artwork (optical: shadow included) and add the
        signature 1px translucent drop shadow to the lower-right."""
        self.replace(SHADOW, T)
        x0, y0, x1, y1 = self.bbox()
        w, h = x1 - x0 + 1, y1 - y0 + 1
        tw, th = (w + 1, h + 1) if shadow else (w, h)
        dx = (self.n - tw) // 2 - x0
        dy = (self.n - th) // 2 - y0
        self.shift(dx, dy)
        if shadow:
            add = [(x + 1, y + 1) for y in range(self.n) for x in range(self.n)
                   if self.g[y][x] != T and self.get(x + 1, y + 1) == T]
            for x, y in add:
                if self.inb(x, y):
                    self.g[y][x] = SHADOW
        return self

    def rows(self):
        return [''.join(r) for r in self.g]


# ---------------------------------------------------------------- registry
REGISTRY = {}


def icon(id, names=(), cat='apps', label=None):
    """Decorator: @icon('firefox', ['firefox', 'org.mozilla.firefox'], 'web', 'Firefox')
    The function receives a fresh Canvas and draws on it (no need to return)."""
    def deco(fn):
        if id in REGISTRY:
            raise ValueError('duplicate icon id ' + id)
        REGISTRY[id] = dict(fn=fn, names=list(dict.fromkeys([id, *names])), cat=cat,
                            label=label or id)
        return fn
    return deco


def build_one(id):
    meta = REGISTRY[id]
    c = Canvas()
    r = meta['fn'](c)
    if isinstance(r, Canvas):
        c = r
    c.finalize()
    return c


def check(c):
    """Return list of style warnings for a finished canvas."""
    warn = []
    x0, y0, x1, y1 = c.bbox()
    w, h = x1 - x0 + 1, y1 - y0 + 1
    if max(w, h) < 26 or max(w, h) > 28:
        warn.append(f'size {w}x{h}: long side must be 26..28')
    if min(w, h) < 14:
        warn.append(f'size {w}x{h}: too thin (short side < 14)')
    bad = {ch for r in c.g for ch in r} - VALID
    if bad:
        warn.append('invalid slots ' + ''.join(sorted(bad)))
    used = {ch for r in c.g for ch in r} - {T, SHADOW}
    if len(used) > 12:
        warn.append(f'{len(used)} colours (keep it <= 12)')
    # outline must be closed: no opaque pixel may touch transparency directly
    for y in range(c.n):
        for x in range(c.n):
            if c.g[y][x] not in (T, SHADOW, INK):
                for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if c.get(x + a, y + b) in (T, SHADOW):
                        warn.append(f'unclosed outline at {x},{y}')
                        return warn
    return warn


# ---------------------------------------------------------------- hi-res pass
def hires(rows):
    """32px sprite -> 64px high-resolution pixel art.

    1. Scale2x/EPX doubles the grid and rebuilds diagonals at the finer
       resolution, so curves step in 1px instead of 2px.
    2. The silhouette outline is thinned back to a crisp 1px ink line; inner
       ink detail keeps its weight.
    3. The drop shadow is re-cast at 2px.
    """
    n = len(rows)
    g = [[(T if ch == SHADOW else ch) for ch in r] for r in rows]
    at = lambda x, y: g[y][x] if 0 <= x < n and 0 <= y < n else T
    N = n * 2
    o = [[T] * N for _ in range(N)]
    outer = set()
    for y in range(n):
        for x in range(n):
            p = g[y][x]
            A, B, C, D = at(x, y - 1), at(x + 1, y), at(x - 1, y), at(x, y + 1)
            e0 = A if (C == A and C != D and A != B) else p
            e1 = B if (A == B and A != C and B != D) else p
            e2 = C if (D == C and D != B and C != A) else p
            e3 = D if (B == D and B != A and D != C) else p
            o[2 * y][2 * x], o[2 * y][2 * x + 1] = e0, e1
            o[2 * y + 1][2 * x], o[2 * y + 1][2 * x + 1] = e2, e3
            if p == INK and T in (A, B, C, D):
                outer.add((x, y))
    # EPX can leave ink-free gaps on the silhouette; close them first.
    oa = lambda x, y: o[y][x] if 0 <= x < N and 0 <= y < N else T
    for y in range(N):
        for x in range(N):
            if o[y][x] not in (T, INK) and any(oa(x + a, y + b) == T for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                o[y][x] = INK
    # thin the outer outline to 1px
    todo = []
    for (sx, sy) in outer:
        for y in (2 * sy, 2 * sy + 1):
            for x in (2 * sx, 2 * sx + 1):
                if o[y][x] != INK:
                    continue
                nb = [oa(x + a, y + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))]
                if T in nb:
                    continue
                fills = [c for c in nb if c not in (INK, T)]
                if fills:
                    todo.append((x, y, max(set(fills), key=fills.count)))
    for x, y, c in todo:
        o[y][x] = c
    # drop shadow, 2px down-right
    for y in range(N):
        for x in range(N):
            if o[y][x] == T and any(oa(x - d, y - d) not in (T, SHADOW) for d in (1, 2)):
                o[y][x] = SHADOW
    return [''.join(r) for r in o]
