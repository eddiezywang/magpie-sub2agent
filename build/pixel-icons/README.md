# Internal pixel brand icons

The internal asset pack overlays all 211 bundled brand assets with pixel art.
Navigation symbols and user-uploaded icons keep their existing rendering.
The original asset tree remains available to upstream builds.

46 marks use OmaPixIcon artwork (MIT), pinned to commit
`4f42b9d10a4dbac16407cab6d83c24461241a9fe` of
https://github.com/Raiden-MeixElysia/OmaPixIcon.
158 are palette-limited conversions of existing brand silhouettes. The product S, TIG and CIB
are original drawings in `custom.py`. Brand names and marks remain their
respective owners' trademarks. The MIT notice is embedded in internal releases.
`../intranet/pixel-icons/manifest.json` records the source of every replacement.

Regenerate with Python's standard library:

```
python build/pixel-icons/build.py --upstream PATH_TO_OMAPIX --raster brand-rgba.json
```

The raster input maps original filenames to 32×32 RGBA arrays: render each source
in a browser on a transparent 256×256 canvas, crop its alpha bounds, then fit it
into a centered 25×25 area on a transparent 32×32 canvas. No remote assets or
image conversion dependencies are needed at build time: generated SVG/PNG
files are checked in. Every original filename is required by the coverage test.

The product S also generates native Windows EXE resources, the window/app PNG,
and the tray ICO with `python build/pixel-icons/native.py`. Internal build tags
select these resources; upstream builds retain their original native artwork.
The menu-bar template uses the same silhouette in monochrome.
