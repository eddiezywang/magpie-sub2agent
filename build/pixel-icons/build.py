"""Build the internal brand overlay; no runtime network or imaging dependency.

Usage: python build/pixel-icons/build.py --upstream ../.build-tools/OmaPixIcon
       --raster ../.build-tools/brand-rgba.json
Raster input is a map of asset filenames to 32x32 RGBA samples of the originals.
"""
import argparse
import collections
import json
from pathlib import Path
from vendor import render
from vendor.pix import Canvas
import custom

ROOT = Path(__file__).resolve().parents[2]
ALIASES = {
    'openai': 'chatgpt', 'claudecode': 'claude', 'codex': 'codex',
    'geminicli': 'gemini-cli', 'githubcopilot': 'copilot',
    'cherrystudio': 'cherry-studio', 'lmstudio': 'lm-studio',
    'zhipu': 'chatglm', 'moonshot': 'kimi',
}


def double(rows):
    return [''.join(ch * 2 for ch in row) for row in rows for _ in range(2)]


def sampled(rgba):
    palette = {k: render.hex2rgb(v) for k, v in render.HOUSE.items()}
    cells = []
    for i in range(0, len(rgba), 4):
        rgb = rgba[i:i+3]
        cells.append('.' if rgba[i+3] < 128 else min(palette, key=lambda k: sum((a-b)**2 for a, b in zip(rgb, palette[k]))))
    # Bound the palette, preserving the original silhouette and negative space.
    used = [k for k, _ in collections.Counter(cells).most_common() if k != '.'][:10]
    c = Canvas()
    for y in range(32):
        for x in range(32):
            k = cells[y*32+x]
            if k != '.':
                if k not in used:
                    k = min(used, key=lambda a: sum((v-w)**2 for v,w in zip(palette[k],palette[a])))
                c.px(x, y, k)
    c.outline().finalize()
    return double(c.rows())


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--upstream', type=Path, required=True)
    p.add_argument('--raster', type=Path, required=True)
    a = p.parse_args()
    upstream = json.loads((a.upstream/'data/icons.json').read_text(encoding='utf-8'))
    raster = json.loads(a.raster.read_text(encoding='utf-8'))
    out = ROOT/'build/intranet/pixel-icons'
    out.mkdir(exist_ok=True)
    manifest = {}
    product = sampled(raster['sub2agent.svg'])
    # Retain the S silhouette, with a blue face and the same dark outline.
    mark = Canvas()
    for y in range(32):
        for x in range(32):
            if product[y*2][x*2] not in '.%':
                mark.px(x, y, 'b' if y < 8 else ('6' if y > 23 else 'B'))
    mark.outline().finalize()
    product = double(mark.rows())
    for original in sorted((ROOT/'internal/gui/assets/icons').iterdir()):
        name = original.stem.removesuffix('-color')
        key = ALIASES.get(name, name)
        source = 'derived: '+original.name
        if name in ('sub2agent', 'magpie', 'favicon', 'icon-512', 'apple-touch-icon'):
            rows = product
            source = 'derived: sub2agent.svg'
        elif name in ('tig', 'cib-zht'):
            rows = double(custom.tig() if name == 'tig' else custom.cib())
            source = 'original: custom.py/'+name
        elif key in upstream:
            rows = upstream[key]['rows']
            source = 'OmaPixIcon: '+key
        else:
            rows = sampled(raster[original.name])
        svg = render.svg(rows, render.HOUSE)
        (out/(original.stem+'.svg')).write_text(svg, encoding='utf-8')
        if original.suffix == '.png':
            size = {'icon-512': 512, 'apple-touch-icon': 180}.get(original.stem, 64)
            (out/original.name).write_bytes(render.render_png(rows, render.HOUSE, size))
        manifest[original.name] = source
    (out/'manifest.json').write_text(json.dumps({
        'upstream': 'https://github.com/Raiden-MeixElysia/OmaPixIcon',
        'commit': '4f42b9d10a4dbac16407cab6d83c24461241a9fe',
        'assets': manifest,
    }, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(collections.Counter(v.split(':')[0] for v in manifest.values()))


if __name__ == '__main__':
    main()
