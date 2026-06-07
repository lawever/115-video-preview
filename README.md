# 115 Thumbnailer

> Generate evenly-spaced preview thumbnails for any video on 115 cloud disk — click a thumb to jump straight to that moment.

A Chrome / 115-browser MV3 extension that injects a floating panel into 115 video pages. Pick a count, hit **Start**, and the panel pulls a screenshot every few minutes so you can scan a 2-hour movie in 20 glances.

Supports both the new player (`115.com/players/video/...`) and the legacy one (`115vod.com/?pickcode=...`).

[![Chrome MV3](https://img.shields.io/badge/manifest-v3-4285F4?logo=googlechrome&logoColor=white)](#)
[![Version](https://img.shields.io/badge/version-0.4.0-blue)](#)
[![CSP Safe](https://img.shields.io/badge/CSP--safe-no%20fetch%2Feval-success)](#)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](#)

<img src="docs/screenshot.svg" width="900" alt="115 Thumbnailer screenshot" />

---

## ✨ Features

- **One-click preview** — pick a count, the panel walks the timeline and drops 320×180 thumbs in a grid.
- **Click to seek** — every thumb is a timestamp; click it and the video jumps there and resumes playback.
- **Configurable count** — slider `10`–`100`, default `10`. The "expected interval" hint updates live.
- **Skip intro / outro** — sliders in minutes, max auto-scales to `⌈duration/60⌉`. Great for skipping theme songs.
- **Resizable panel** — drag the bottom-right or bottom-left handle; per-thumb size stays the same, the grid just shows more.
- **Move / collapse / close** — drag the header to reposition, `−` to collapse, `×` to hide (toolbar icon brings it back).
- **Persists state** — count, sliders, position, size, visibility all live in `chrome.storage.local`.
- **Background-tab safe** — auto-pauses when the tab is hidden, resumes on focus.
- **CSP-safe** — zero `fetch`, zero `eval`. The content script is one self-contained file with CSS inlined as a string. This is the only way to survive 115's strict Content Security Policy.

## 📦 Installation (load unpacked)

1. Clone or download this repo.
2. Open `chrome://extensions/` (or `115://extensions/` in 115 Browser).
3. Toggle **Developer mode** in the top-right.
4. Click **Load unpacked** and pick the repository root.
5. The toolbar gets a `115 Thumbnailer` icon.

For a distributable build, see [Build & Release](#-build--release) below.

## 🚀 Usage

1. Open any video on `115.com`, `115vod.com`, `115pan.com`, or `anxia.com`.
2. The panel pops up in the top-right corner. If you closed it earlier, click the toolbar icon to bring it back.
3. Adjust the **Count / Skip intro / Skip outro** sliders (defaults: `10 / 0 / 0`).
4. The hint line shows e.g. *「预计生成 50 张预览（每隔 ~1:10 生成 1 张）」*.
5. Hit **开始生成预览** — thumbs appear as they are captured.
6. Drag the header to move the panel; use `−` / `×` to collapse or close.
7. Click any thumbnail to seek the video to that timestamp and resume playing.

> 💡 Stay on the tab during capture. The script auto-pauses on `visibilitychange` and resumes when you come back, but switching away mid-job will slow it down.

## ⚙️ Configuration

All settings live inside the panel and persist per-browser:

| Setting | Range | Default | What it does |
| --- | --- | --- | --- |
| Count (数量) | `10`–`100` | `10` | Number of thumbs to capture. The actual count is the lesser of this and the available time window. |
| Skip intro (跳过片头) | `0`–`⌈duration/60⌉` minutes | `0` | Skip this many minutes at the start. |
| Skip outro (跳过片尾) | `0`–`⌈duration/60⌉` minutes | `0` | Skip this many minutes at the end. |

The capture interval is computed as `active_duration / count` and shown live in the hint line.

## 🛠 Development

```bash
# install once
npm install

# run the unit tests (27/27 should pass)
npm test          # node --test lib/utils.test.js

# build a distributable zip (and .crx if key.pem exists)
npm run build
```

The build writes to `dist/`:

- `115-video-preview.zip` — load this into `chrome://extensions/` as a packaged build.
- `115-video-preview.crx` — only if you ran `npm run gen-key` first.

### Source layout

```
manifest.json                  # MV3 manifest: name / description / icon
background.js                  # service worker: toolbar click → toggle-panel
content/
  content.js                   # the whole extension: panel + capture + seek
                               # (CSS inlined as a string; Shadow DOM)
lib/
  utils.js                     # pure functions: formatTime / computePlanByCount / validateInputs
  utils.test.js                # 27 unit tests (node --test)
icons/
  icon-{16,48,128}.png         # the toolbar / store icon
build.js                       # terser → zip → optional crx
gen-key.js                     # generates key.pem (for signed .crx)
```

### How capture works

1. Pick the main `<video>` element on the page (with retries — the 115 player mutates the DOM aggressively).
2. Pause it, walk through the planned timestamps, `currentTime = t` + wait for `seeked` (15s timeout, `requestVideoFrameCallback` + `requestAnimationFrame` race).
3. `canvas.drawImage(video, ...)` → `canvas.toDataURL('image/jpeg', 0.7)` → inject as `<img src>` into the grid.
4. Retry each thumb up to 3 times on failure; auto-pause on `document.visibilityState === 'hidden'`.

### Constraints we don't fight

- 115 ships a strict CSP that blocks `fetch('chrome-extension://…')`, `eval`, and inline `<script>`. The content script must be a single self-contained JS file with CSS inlined.
- `content_scripts` does **not** use `all_frames: true` — multi-iframe pages spawn duplicate panels and break the toggle.
- The legacy 115 player injects its `<video>` late; the script polls the DOM for a few seconds after navigation.

## ⚠️ Limitations

- Only works on 115 cloud disk domains (`*.115.com`, `*.115vod.com`, `*.115pan.com`, `*.anxia.com`).
- Thumbnails are **not** cached across sessions — closing the panel discards them.
- The script needs the tab to be the active tab during capture (pauses automatically when hidden, but won't run while the tab is unloaded).
- Videos that use a custom canvas-renderer (instead of a real `<video>`) will fail to seek / capture — no fallback.

## 📝 License

MIT — see the source headers. Use it, fork it, ship it.

---

🌐 **Languages:** [English](README.md) · [简体中文](README.zh-CN.md)