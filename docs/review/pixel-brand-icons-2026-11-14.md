# Internal pixel brand icons

Review: http://124.220.199.224:8805/pixel-brand-icons.html

- All 211 bundled brand filenames have internal pixel replacements. Of these,
  46 use pinned MIT OmaPixIcon artwork, 163 derive from existing silhouettes,
  and TIG/CIB are original vector pixel drawings using the same palette/engine.
- The review includes 16/20/24/32px light/dark comparisons and screenshots of the
  actual .20 providers page and Add Provider panel. Navigation symbols and
  user-uploaded images retain their previous rendering.
- GUI asset coverage tests and JavaScript syntax checks pass. Playwright checked
  Agents, Sessions, Providers, Routing, Groups, Gateway, Usage, Plugins and
  Settings on the rebuilt app: no page exceptions or failed icon responses.
  Review HTML loaded all 160 comparison images successfully.
- Single-file build .20 succeeded without embedding Bun. EXE: 79,509,504 bytes;
  ZIP: 32,085,999 bytes; ZIP SHA-256:
  `d77e8566ee344f038ae83213b486bc8550730a0c096e213cdec17a1e35d36714`.
  The existing local runtime was gracefully stopped, its EXE replaced, and
  restarted with the same data directory; boot preferences confirm .20.
- Receipt rendering supports the same pixel palette through
  `USAGE_SERVER_ICON_DIR`; all 12 usage-server tests pass. The live internal
  billing service has not been redeployed with these new assets in this step.

Source attribution and artwork provenance:
`build/pixel-icons/README.md`, `build/intranet/pixel-icons/manifest.json` and
`build/pixel-icons/vendor/LICENSE`. Original GUI assets remain available for
upstream builds; the internal release packs the pixel overlay.
