# Sub2Agent 字标探索 · 成品索引

由 `chrome-devtools-mcp` 在浏览器内下载 Fontesk 字体、解 zip、内嵌为 data URI 生成；字体二进制已嵌入 HTML，打开时不需要联网或本地字体文件。

| 成品 | 路径 |
| --- | --- |
| 可交互效果页（11 款字体 + 4 个组合 + 结论表） | `C:\Users\Administrator\Downloads\sub2agent-looks.html` |
| 全页截图（914 × 4285 PNG） | `C:\Users\Administrator\AppData\Local\Temp\sub2agent-looks.png` |
| 备用副本（JSON 字符串形式的同一 HTML） | `C:\Users\Administrator\AppData\Local\Temp\sub2agent-looks.json` |

成品不在 `brand/` 里，原因：Chrome 下载目录固定为 Downloads，MCP 的 workspace root 只允许写 Temp，两者都不允许写仓库目录；当前会话也没有可执行 shell 来复制文件。

## 已验证

在效果页里 `await document.fonts.ready` 后：`document.fonts.size === 11`，11 个 FontFace 全部 `status === 'loaded'`，15 张卡 / 4 个组合渲染正常，首个字标的 computed `font-family` 为 `Pixelbasel`。不是回退字体。

## 结论（已定案：Bitrimus）

- **字标字体 = `Bitrimus`**（GGBot，Free for commercial use，TTF 30 KiB）。用户从 11 款对比中选中。
- **正文 / 代码 / 标签**：`Departure Mono` —— 等宽像素、命令行气质，woff2 仅 13.6 KiB。
- **其他备选**：`Pixelbasel`（极简）、`Game Over` / `Invader`（复古街机）。
- **副标题软硬对比**：`Malam Poek` / `Super Warming`（均可商用）。
- **不要用于对外品牌**：`Bitsand`（原 A 案）与 `The Pixel Editorial` —— 均为 `Free for personal use`。

## 已落地到 GUI（字体路线）

- `internal/gui/assets/brand.js`：Bitrimus 子集（只保留 Sub2Agent + 大小写/数字，4,304 B）gzipped 后 1,254 B、base64 1,672 字符分 6 段内嵌，用 `DecompressionStream('gzip')` + `FontFace` 注册为 `BitrimusBrand`。这样不用往源码里放二进制文件。
- `internal/gui/assets/brand.css`：`.brand > span:not(.logo)` 用 `BitrimusBrand`、16px、400、无字距。喜鹊图标仍是内联 SVG。
- `internal/gui/assets/index.html`：`<title>` / apple-mobile-web-app-title / `<span>` 从 `magpie` 改为 `Sub2Agent`，并引入 `brand.js` 和 `brand.css`。
- CDP 实测：`document.fonts` 有 `BitrimusBrand:loaded`，computed font-family 命中，canvas 测宽 53 vs Segoe UI 78.17 —— 不是回退字体。

像素风 Windows 一体化标题栏通过 `body.retro-frame` 显示品牌，并用 Bitrimus 文字代替原 SVG 字标；收起侧栏时文字仍隐藏，只保留 logo。使用系统标题栏的 Windows 窗口不显示网页字标。

详见 `pixel-fonts.html`（143 条候选的完整筛选清单与授权）。

## 限制

- 字体子集仅覆盖品牌和字母数字，修改字标字符时需要重新生成。
- 字体注册失败时回退系统字体，不影响窗口操作。
