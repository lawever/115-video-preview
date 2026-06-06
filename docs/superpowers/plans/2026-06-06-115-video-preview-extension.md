# 115 视频预览 Chrome 扩展 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 115 网盘视频页打开视频后，用户在浏览器 Side Panel 点一次「生成预览」即可获得按时间均匀分布的 320×180 / 2 列 / JPEG 0.85 缩略图网格，用于快速扫一眼长视频。

**Architecture:** MV3 扩展；Content Script（isolated world，注入到 115 页面）负责找 `<video>`、seek+canvas 截图、推图到 Side Panel；Side Panel（HTML+原生 CSS+JS）负责 UI 渲染、设置持久化、消息路由；Service Worker 仅做 Side Panel 点击行为注册。无构建步骤，无第三方依赖。

**Tech Stack:** Manifest V3、Chrome Side Panel API、HTML5 Video / Canvas、ES2020+、Node.js 内置 `node:test` 用于纯函数单测。

---

## 文件结构（前置共识）

```
视频预览插件/
├── manifest.json
├── background.js
├── content/
│   └── content.js
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.js
│   ├── sidepanel.css
│   ├── utils.js           # 纯函数：formatTime / computePlan / validateInputs
│   └── utils.test.js      # node:test 单测
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── docs/superpowers/
│   ├── specs/2026-06-06-115-video-preview-extension-design.md
│   └── plans/2026-06-06-115-video-preview-extension.md  # 本文件
├── README.md
└── .gitignore
```

**命名约定：**
- 纯函数放在 `sidepanel/utils.js`，用 IIFE 暴露到 `window.VP`（浏览器）和 `module.exports`（Node 测试）
- Content Script 与 Side Panel 之间的消息协议见 Spec §4.3
- 提交粒度：每个 Task 一次 commit，message 用 `feat:` / `test:` / `chore:` / `docs:` / `style:` 前缀

---

## 任务总览

| # | 任务 | 类型 |
|---|---|---|
| 1 | 仓库初始化（.gitignore） | chore |
| 2 | manifest.json | feat |
| 3 | 占位图标 | chore |
| 4 | background.js | feat |
| 5 | utils.js: formatTime 测试 | test |
| 6 | utils.js: formatTime 实现 | feat |
| 7 | utils.js: computePlan 测试 | test |
| 8 | utils.js: computePlan 实现 | feat |
| 9 | utils.js: validateInputs 测试 | test |
| 10 | utils.js: validateInputs 实现 | feat |
| 11 | content.js: 视频元素挑选 + 状态上报 | feat |
| 12 | content.js: 单帧截图函数 | feat |
| 13 | content.js: 采集循环 + 取消 | feat |
| 14 | content.js: 消息路由 | feat |
| 15 | sidepanel.html 骨架 | feat |
| 16 | sidepanel.css（深浅色） | style |
| 17 | sidepanel.js: 设置持久化 + 输入校验 | feat |
| 18 | sidepanel.js: 状态机 + 按钮启停 | feat |
| 19 | sidepanel.js: 网格渲染 | feat |
| 20 | sidepanel.js: 消息路由 + 进度条 | feat |
| 21 | README | docs |
| 22 | 端到端手动验证 | test |

---


### Task 1: 仓库初始化

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: 创建 `.gitignore`**

写入 `D:\work\aiProjects\视频预览插件\.gitignore`：

```gitignore
# OS
.DS_Store
Thumbs.db
desktop.ini

# Editor
.vscode/
.idea/
*.swp
*~

# Node（未来用 node --test 跑 utils 单测）
node_modules/
npm-debug.log*

# 浏览器扩展打包产物（未来如需）
*.zip
*.crx
```

- [ ] **Step 2: 提交**

```bash
cd "D:\work\aiProjects\视频预览插件"
git add .gitignore
git commit -m "chore: 初始化仓库 .gitignore"
```

---

### Task 2: manifest.json

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: 写入 manifest.json**

写入 `D:\work\aiProjects\视频预览插件\manifest.json`（UTF-8 无 BOM）：

```json
{
  "manifest_version": 3,
  "name": "115 视频预览",
  "version": "0.1.0",
  "description": "在 115 网盘视频页生成按时间均匀分布的预览缩略图",
  "permissions": ["sidePanel"],
  "host_permissions": [
    "*://*.115.com/*",
    "*://*.115pan.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_title": "打开 115 视频预览"
  },
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "content_scripts": [{
    "matches": ["*://*.115.com/*", "*://*.115pan.com/*"],
    "js": ["content/content.js"],
    "run_at": "document_idle"
  }],
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add manifest.json
git commit -m "feat(manifest): MV3 基础配置 + side panel + 115 域名 host"
```

---

### Task 3: 占位图标

**Files:**
- Create: `icons/icon-16.png`
- Create: `icons/icon-48.png`
- Create: `icons/icon-128.png`

> 实际是 PNG 文件，必须用二进制写入。PowerShell 生成纯色占位 PNG 的方法如下。

- [ ] **Step 1: 创建 icons 目录并生成占位 PNG**

在 PowerShell 中执行：

```powershell
Add-Type -AssemblyName System.Drawing
$dir = "D:\work\aiProjects\视频预览插件\icons"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
foreach ($size in 16, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(33, 150, 243))  # 蓝色
  $g.Dispose()
  $bmp.Save("$dir/icon-$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
```

预期：三个 PNG 文件生成，无报错。

- [ ] **Step 2: 提交**

```bash
git add icons/icon-16.png icons/icon-48.png icons/icon-128.png
git commit -m "chore(icons): 占位蓝色方块 PNG（v1 临时，正式图标后续替换）"
```

> 工程师注：这是占位图，目的是让 manifest 引用通过、不出现缺图警告。正式图标是 v1 之外的事。

---

### Task 4: background.js

**Files:**
- Create: `background.js`

- [ ] **Step 1: 写入 background.js**

写入 `D:\work\aiProjects\视频预览插件\background.js`：

```javascript
// 让点工具栏图标直接打开 Side Panel。
// 不参与消息路由——Side Panel 与 Content Script 直接通信。
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
```

- [ ] **Step 2: 提交**

```bash
git add background.js
git commit -m "feat(background): 点击工具栏图标直接打开 Side Panel"
```

---

### Task 5: formatTime — 写失败测试

**Files:**
- Create: `sidepanel/utils.js`（占位，先放空 IIFE）
- Create: `sidepanel/utils.test.js`

- [ ] **Step 1: 创建 utils.js 骨架**

写入 `D:\work\aiProjects\视频预览插件\sidepanel\utils.js`：

```javascript
// 纯函数工具集，浏览器和 Node 共用。
// 浏览器：通过 window.VP 暴露
// Node：通过 module.exports 暴露（用于 node --test）
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    root.VP = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 函数占位，下一个 Task 实现
  function formatTime(seconds) { throw new Error('not implemented'); }
  function computePlan(duration, interval, skipIntro, skipOutro) { throw new Error('not implemented'); }
  function validateInputs(interval, skipIntro, skipOutro, duration) { throw new Error('not implemented'); }
  return { formatTime, computePlan, validateInputs };
}));
```

- [ ] **Step 2: 写测试**

写入 `D:\work\aiProjects\视频预览插件\sidepanel\utils.test.js`：

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTime } = require('./utils.js');

test('formatTime: 0 秒 → "0:00"', () => {
  assert.equal(formatTime(0), '0:00');
});

test('formatTime: 45 秒 → "0:45"', () => {
  assert.equal(formatTime(45), '0:45');
});

test('formatTime: 125 秒 → "2:05"', () => {
  assert.equal(formatTime(125), '2:05');
});

test('formatTime: 3599 秒 → "59:59"（不到 1 小时用 mm:ss）', () => {
  assert.equal(formatTime(3599), '59:59');
});

test('formatTime: 3600 秒 → "1:00:00"（满 1 小时切 h:mm:ss）', () => {
  assert.equal(formatTime(3600), '1:00:00');
});

test('formatTime: 3661 秒 → "1:01:01"', () => {
  assert.equal(formatTime(3661), '1:01:01');
});

test('formatTime: 7322 秒 → "2:02:02"', () => {
  assert.equal(formatTime(7322), '2:02:02');
});

test('formatTime: 负数 → "0:00"（健壮性）', () => {
  assert.equal(formatTime(-5), '0:00');
});

test('formatTime: NaN → "0:00"', () => {
  assert.equal(formatTime(NaN), '0:00');
});
```

- [ ] **Step 3: 跑测试，确认失败**

```bash
cd "D:\work\aiProjects\视频预览插件"
node --test sidepanel/utils.test.js
```

预期：所有 `formatTime` 用例 FAIL，错误信息包含 `not implemented`。`computePlan` / `validateInputs` 的用例还没写，应输出 `test count: 0` 或仅有 `formatTime` 的失败。

---

### Task 6: formatTime — 实现

**Files:**
- Modify: `sidepanel/utils.js`

- [ ] **Step 1: 实现 formatTime**

在 `sidepanel/utils.js` 中，把 `function formatTime` 替换为：

```javascript
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }
```

- [ ] **Step 2: 跑测试，确认全部通过**

```bash
node --test sidepanel/utils.test.js
```

预期：所有 `formatTime` 用例 PASS（`tests 9 pass 9 fail 0`）。

- [ ] **Step 3: 提交**

```bash
git add sidepanel/utils.js sidepanel/utils.test.js
git commit -m "feat(utils): formatTime 纯函数 + 9 个单测"
```

---

### Task 7: computePlan — 写失败测试

**Files:**
- Modify: `sidepanel/utils.test.js`

- [ ] **Step 1: 在 utils.test.js 末尾追加 computePlan 用例**

在 `sidepanel/utils.test.js` 末尾追加：

```javascript
const { computePlan } = require('./utils.js');

test('computePlan: 120 分钟视频，间隔 10，跳过 0/0 → 12 张', () => {
  const r = computePlan(120 * 60, 10, 0, 0);
  assert.equal(r.count, 12);
  assert.deepEqual(r.times, [0, 600, 1200, 1800, 2400, 3000, 3600, 4200, 4800, 5400, 6000, 6600]);
});

test('computePlan: 跳过片头 5 分钟 → 第一张从 300 开始', () => {
  const r = computePlan(120 * 60, 10, 5, 0);
  assert.equal(r.count, 11);
  assert.equal(r.times[0], 300);
});

test('computePlan: 跳过片尾 5 分钟 → 最后一张 ≤ duration - 300', () => {
  const r = computePlan(120 * 60, 10, 0, 5);
  assert.equal(r.count, 12);
  assert.ok(r.times[r.times.length - 1] <= 120 * 60 - 5 * 60);
});

test('computePlan: 跳过片头 3 + 跳过片尾 7，间隔 10 → 算 110 分钟 / 10 = 11 张', () => {
  const r = computePlan(120 * 60, 10, 3, 7);
  assert.equal(r.count, 11);
});

test('computePlan: 间隔大于可用区间 → count = 0，times = []', () => {
  const r = computePlan(100, 200, 0, 0);
  assert.equal(r.count, 0);
  assert.deepEqual(r.times, []);
});

test('computePlan: 恰好整除，最后一张等于 duration - skipOutro', () => {
  // 时长 100, 间隔 10, 无跳过 → [0,10,...,90] 共 10 张
  const r = computePlan(100, 10, 0, 0);
  assert.equal(r.count, 10);
  assert.equal(r.times[9], 90);
});

test('computePlan: 浮点时长同样正确（如 119.5 秒）', () => {
  const r = computePlan(119.5, 10, 0, 0);
  // [0,10,20,...,110] 共 12 张
  assert.equal(r.count, 12);
  assert.equal(r.times[11], 110);
});
```

- [ ] **Step 2: 跑测试，确认新增用例失败**

```bash
node --test sidepanel/utils.test.js
```

预期：7 个 `computePlan` 用例 FAIL（`not implemented`）；9 个 `formatTime` 仍 PASS。

---

### Task 8: computePlan — 实现

**Files:**
- Modify: `sidepanel/utils.js`

- [ ] **Step 1: 实现 computePlan**

把 `sidepanel/utils.js` 中的 `function computePlan` 替换为：

```javascript
  function computePlan(duration, interval, skipIntro, skipOutro) {
    const start = Math.max(0, skipIntro);
    const end = Math.max(start, duration - Math.max(0, skipOutro));
    const step = interval;
    const times = [];
    if (step <= 0 || end <= start) {
      return { count: 0, times };
    }
    for (let t = start; t <= end; t += step) {
      times.push(t);
    }
    return { count: times.length, times };
  }
```

> 工程师注：循环用 `t <= end`（闭区间）确保整除时最后一张取到上界。`skipIntro` 和 `skipOutro` 用 `Math.max(0, ...)` 防止负数破坏区间。

- [ ] **Step 2: 跑测试，确认全部通过**

```bash
node --test sidepanel/utils.test.js
```

预期：所有用例 PASS（`formatTime` 9 + `computePlan` 7 = 16 个）。

- [ ] **Step 3: 提交**

```bash
git add sidepanel/utils.js sidepanel/utils.test.js
git commit -m "feat(utils): computePlan 纯函数 + 7 个单测"
```

---

### Task 9: validateInputs — 写失败测试

**Files:**
- Modify: `sidepanel/utils.test.js`

- [ ] **Step 1: 在 utils.test.js 末尾追加 validateInputs 用例**

在 `sidepanel/utils.test.js` 末尾追加：

```javascript
const { validateInputs } = require('./utils.js');

test('validateInputs: 合法输入 → ok=true', () => {
  const r = validateInputs(10, 0, 0, 7200);
  assert.equal(r.ok, true);
  assert.equal(r.message, '');
});

test('validateInputs: interval = 0 → ok=false', () => {
  const r = validateInputs(0, 0, 0, 7200);
  assert.equal(r.ok, false);
  assert.match(r.message, /间隔/);
});

test('validateInputs: interval 负数 → ok=false', () => {
  const r = validateInputs(-5, 0, 0, 7200);
  assert.equal(r.ok, false);
});

test('validateInputs: skipIntro 负数 → ok=false', () => {
  const r = validateInputs(10, -1, 0, 7200);
  assert.equal(r.ok, false);
});

test('validateInputs: skipOutro 负数 → ok=false', () => {
  const r = validateInputs(10, 0, -1, 7200);
  assert.equal(r.ok, false);
});

test('validateInputs: skipIntro + skipOutro ≥ duration → ok=false', () => {
  const r = validateInputs(10, 60, 60, 120);
  assert.equal(r.ok, false);
  assert.match(r.message, /跳过/);
});

test('validateInputs: skipIntro + skipOutro == duration → ok=false', () => {
  const r = validateInputs(10, 60, 60, 120);
  assert.equal(r.ok, false);
});

test('validateInputs: interval 非整数（如 10.5）也接受', () => {
  // 浮点 interval 合法（虽然不会真用）
  const r = validateInputs(10.5, 0, 0, 7200);
  assert.equal(r.ok, true);
});

test('validateInputs: duration 0 → ok=false', () => {
  const r = validateInputs(10, 0, 0, 0);
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: 跑测试，确认新增用例失败**

```bash
node --test sidepanel/utils.test.js
```

预期：9 个 `validateInputs` 用例 FAIL；前 16 个 PASS。

---

### Task 10: validateInputs — 实现

**Files:**
- Modify: `sidepanel/utils.js`

- [ ] **Step 1: 实现 validateInputs**

把 `sidepanel/utils.js` 中的 `function validateInputs` 替换为：

```javascript
  function validateInputs(interval, skipIntro, skipOutro, duration) {
    if (!Number.isFinite(duration) || duration <= 0) {
      return { ok: false, message: '视频时长无效' };
    }
    if (!Number.isFinite(interval) || interval <= 0) {
      return { ok: false, message: '间隔必须大于 0 分钟' };
    }
    if (!Number.isFinite(skipIntro) || skipIntro < 0) {
      return { ok: false, message: '跳过片头不能为负' };
    }
    if (!Number.isFinite(skipOutro) || skipOutro < 0) {
      return { ok: false, message: '跳过片尾不能为负' };
    }
    if (skipIntro + skipOutro >= duration) {
      return { ok: false, message: '跳过时长超过视频总长' };
    }
    return { ok: true, message: '' };
  }
```

- [ ] **Step 2: 跑测试，确认全部通过**

```bash
node --test sidepanel/utils.test.js
```

预期：25 个用例全部 PASS（`formatTime` 9 + `computePlan` 7 + `validateInputs` 9）。

- [ ] **Step 3: 提交**

```bash
git add sidepanel/utils.js sidepanel/utils.test.js
git commit -m "feat(utils): validateInputs 纯函数 + 9 个单测"
```

---

### Task 11: content.js — 视频元素挑选 + 状态上报

**Files:**
- Create: `content/content.js`

- [ ] **Step 1: 写入 content.js 骨架（含视频挑选 + MutationObserver）**

写入 `D:\work\aiProjects\视频预览插件\content\content.js`：

```javascript
// Content Script（isolated world）
// 唯一职责：找页面的 <video>，按指令截图，通过 runtime 发给 Side Panel。
// 不读 cookie/localStorage，不发网络请求。

(() => {
  'use strict';

  // ===== 视频挑选 =====

  function pickMainVideo() {
    const list = Array.from(document.querySelectorAll('video'));
    if (list.length === 0) return null;
    if (list.length === 1) return list[0];
    // 多于一个：取 videoWidth*videoHeight 最大的（主播放器）
    let best = list[0];
    let bestArea = (best.videoWidth || 0) * (best.videoHeight || 0);
    for (let i = 1; i < list.length; i++) {
      const area = (list[i].videoWidth || 0) * (list[i].videoHeight || 0);
      if (area > bestArea) { best = list[i]; bestArea = area; }
    }
    return best;
  }

  function reportStatus() {
    const v = pickMainVideo();
    const hasVideo = !!v;
    const duration = (v && Number.isFinite(v.duration)) ? v.duration : 0;
    const count = document.querySelectorAll('video').length;
    try {
      chrome.runtime.sendMessage({
        cmd: 'video-status',
        hasVideo, duration, videoCount: count
      });
    } catch (_) { /* Side Panel 未开时静默 */ }
  }

  // ===== DOM 监听：视频被替换时重新上报 =====
  const mo = new MutationObserver(() => {
    // 节流：连续 DOM 变化合并为一次
    if (mo._pending) return;
    mo._pending = true;
    requestAnimationFrame(() => {
      mo._pending = false;
      reportStatus();
    });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // 初次上报 + 视频 metadata 加载完成后再次上报（duration 可能从 NaN/Infinity 变正常）
  reportStatus();
  document.addEventListener('loadedmetadata', reportStatus, true);
})();
```

> 工程师注：截图函数、采集循环、消息路由在 Task 12–14 里加进同一个 IIFE。当前文件已能加载并在 Side Panel 打开时上报一次 `video-status`。

- [ ] **Step 2: 提交**

```bash
git add content/content.js
git commit -m "feat(content): 视频元素挑选 + MutationObserver 状态上报"
```

> 工程师注：此时加载扩展、打开 Side Panel 不会看到任何变化（Side Panel 还没写）。继续 Task 15+。

---

### Task 12: content.js — 单帧截图函数

**Files:**
- Modify: `content/content.js`

- [ ] **Step 1: 在 IIFE 顶部加 THUMB_W / THUMB_H / QUALITY 常量**

在 `(() => {` 之后、`'use strict';` 之后插入：

```javascript
  const THUMB_W = 320;
  const THUMB_H = 180;
  const QUALITY = 0.85;
  const SEEK_TIMEOUT_MS = 5000;
```

- [ ] **Step 2: 加 captureFrame 函数**

紧跟 `function pickMainVideo()` 之后插入：

```javascript
  // ===== 单帧截图 =====
  // 把 video 当前帧画到 320x180 canvas，编码成 JPEG Blob 返回。
  function captureFrame(video) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_W;
      canvas.height = THUMB_H;
      const ctx = canvas.getContext('2d');
      try {
        ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
      } catch (e) {
        reject(new Error('drawImage 失败（可能跨域）: ' + e.message));
        return;
      }
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('toBlob 返回 null'));
          return;
        }
        resolve(blob);
      }, 'image/jpeg', QUALITY);
    });
  }

  // 把 video 跳到 t 秒并等待 seeked 事件，超时 5s 抛错。
  function seekTo(video, t) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        reject(new Error('seeked 超时（' + SEEK_TIMEOUT_MS + 'ms）'));
      }, SEEK_TIMEOUT_MS);
      function onSeeked() {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        // 等一帧确保画面已稳定
        requestAnimationFrame(() => resolve());
      }
      video.addEventListener('seeked', onSeeked, { once: true });
      try {
        video.currentTime = t;
      } catch (e) {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        reject(e);
      }
    });
  }
```

- [ ] **Step 3: 提交**

```bash
git add content/content.js
git commit -m "feat(content): captureFrame + seekTo 工具函数"
```

---

### Task 13: content.js — 采集循环 + 取消

**Files:**
- Modify: `content/content.js`

- [ ] **Step 1: 加 runCapture 函数**

在 `seekTo` 函数之后插入：

```javascript
  // ===== 采集循环 =====
  let cancelRequested = false;

  async function runCapture(video, times, onProgress) {
    const total = times.length;
    let success = 0;
    let failed = 0;
    // 保存原始状态，结束后恢复
    const origTime = video.currentTime;
    const origPaused = video.paused;
    video.pause();

    try {
      for (let i = 0; i < total; i++) {
        if (cancelRequested) return { success, failed, cancelled: true };
        const t = times[i];
        try {
          await seekTo(video, t);
          const blob = await captureFrame(video);
          onProgress({ done: i + 1, total, time: t, blob, ok: true });
          success++;
        } catch (e) {
          onProgress({ done: i + 1, total, time: t, ok: false, error: e.message });
          failed++;
        }
      }
    } finally {
      // 恢复视频状态
      try {
        video.currentTime = origTime;
      } catch (_) { /* ignore */ }
      if (!origPaused) {
        try { await video.play(); } catch (_) { /* 用户可能拒绝 play */ }
      }
    }
    return { success, failed, cancelled: false };
  }

  function requestCancel() {
    cancelRequested = true;
  }

  function resetCancel() {
    cancelRequested = false;
  }
```

- [ ] **Step 2: 提交**

```bash
git add content/content.js
git commit -m "feat(content): 采集循环 + 取消 + 视频状态恢复"
```

---

### Task 14: content.js — 消息路由

**Files:**
- Modify: `content/content.js`

- [ ] **Step 1: 加 onMessage 监听器**

在 `document.addEventListener('loadedmetadata', reportStatus, true);` 之后追加：

```javascript
  // ===== 消息路由 =====
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.cmd) return false;

    if (msg.cmd === 'ping') {
      sendResponse({ ok: true });
      return false;
    }

    if (msg.cmd === 'generate') {
      const video = pickMainVideo();
      if (!video) {
        sendResponse({ ok: false, error: 'no-video' });
        return false;
      }
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration <= 0) {
        sendResponse({ ok: false, error: 'duration-unknown' });
        return false;
      }
      // interval/skipIntro/skipOutro 由 Side Panel 端校验并预算好 times，本端只消费 times。
      // 走 utils 的纯函数：content script 通过注入 <script> 共享 utils
      // 简化方案：让 Side Panel 把算好的 times 一并传过来
      if (!Array.isArray(msg.times)) {
        sendResponse({ ok: false, error: 'missing-times' });
        return false;
      }
      resetCancel();
      sendResponse({ ok: true, total: msg.times.length });
      // 异步执行采集，过程中通过 sendMessage 推送进度与图片
      runCapture(video, msg.times, (p) => {
        try {
          if (p.ok) {
            chrome.runtime.sendMessage({
              cmd: 'thumb',
              time: p.time,
              blob: p.blob
            });
          } else {
            chrome.runtime.sendMessage({
              cmd: 'progress',
              done: p.done,
              total: p.total,
              time: p.time,
              error: p.error
            });
          }
        } catch (_) { /* Side Panel 关了 */ }
      }).then((result) => {
        try {
          if (result.cancelled) {
            chrome.runtime.sendMessage({ cmd: 'cancelled' });
          } else {
            chrome.runtime.sendMessage({
              cmd: 'done',
              success: result.success,
              failed: result.failed
            });
          }
        } catch (_) { /* ignore */ }
      }).catch((e) => {
        try {
          chrome.runtime.sendMessage({ cmd: 'error', message: e.message });
        } catch (_) { /* ignore */ }
      });
      return true; // 表示会异步 sendResponse（这里不需要，但保留）
    }

    if (msg.cmd === 'cancel') {
      requestCancel();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  // 页面即将卸载时通知 Side Panel
  window.addEventListener('pagehide', () => {
    try { chrome.runtime.sendMessage({ cmd: 'aborted' }); } catch (_) { /* ignore */ }
  });
```

> 工程师注：消息协议中 `generate` 由 Side Panel 把 `times` 数组算好传过来（Side Panel 有 `utils.js` 引用 `computePlan`），content script 不重复引入 utils，避免双份实现。这是 v1 的简化决策；将来若两边逻辑分叉，再考虑抽成共享脚本通过 `<script>` 注入。

- [ ] **Step 2: 提交**

```bash
git add content/content.js
git commit -m "feat(content): 消息路由（generate/cancel）+ pagehide 中止上报"
```

> 工程师注：此时 content script 已可工作，但 Side Panel 还是空文件，UI 不可见。继续 Task 15+。

---

### Task 15: sidepanel.html 骨架

**Files:**
- Create: `sidepanel/sidepanel.html`

- [ ] **Step 1: 写入 HTML**

写入 `D:\work\aiProjects\视频预览插件\sidepanel\sidepanel.html`：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>115 视频预览</title>
  <link rel="stylesheet" href="sidepanel.css">
</head>
<body>
  <header class="vp-header">
    <span class="vp-title">● 115 视频预览</span>
    <span class="vp-version">v0.1.0</span>
  </header>

  <section class="vp-status" id="vp-status" data-state="loading">
    状态：正在检测视频…
  </section>

  <section class="vp-settings">
    <label class="vp-field">
      <span>间隔（分钟）</span>
      <input type="number" id="vp-interval" min="0.1" step="0.1" value="10">
    </label>
    <label class="vp-field">
      <span>跳过片头（分钟）</span>
      <input type="number" id="vp-skip-intro" min="0" step="0.1" value="0">
    </label>
    <label class="vp-field">
      <span>跳过片尾（分钟）</span>
      <input type="number" id="vp-skip-outro" min="0" step="0.1" value="0">
    </label>

    <p class="vp-hint" id="vp-hint">预计生成 0 张预览</p>

    <button class="vp-btn-primary" id="vp-generate" disabled>开始生成预览</button>
  </section>

  <section class="vp-progress" id="vp-progress" hidden>
    <div class="vp-progress-bar">
      <div class="vp-progress-fill" id="vp-progress-fill"></div>
    </div>
    <span class="vp-progress-text" id="vp-progress-text">0 / 0</span>
    <button class="vp-btn-secondary" id="vp-cancel">取消</button>
  </section>

  <section class="vp-grid" id="vp-grid" aria-label="预览网格"></section>

  <script src="utils.js"></script>
  <script src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 2: 提交**

```bash
git add sidepanel/sidepanel.html
git commit -m "feat(sidepanel): HTML 骨架（设置/进度/网格三段式）"
```

---

### Task 16: sidepanel.css（深浅色）

**Files:**
- Create: `sidepanel/sidepanel.css`

- [ ] **Step 1: 写入 CSS**

写入 `D:\work\aiProjects\视频预览插件\sidepanel\sidepanel.css`：

```css
/* 基础变量 */
:root {
  --vp-bg: #ffffff;
  --vp-fg: #1a1a1a;
  --vp-muted: #666666;
  --vp-border: #e0e0e0;
  --vp-input-bg: #f5f5f5;
  --vp-primary: #1976d2;
  --vp-primary-fg: #ffffff;
  --vp-primary-disabled: #90caf9;
  --vp-success: #2e7d32;
  --vp-error: #c62828;
  --vp-thumb-failed-bg: #eeeeee;
  --vp-thumb-failed-fg: #999999;
  --vp-progress-track: #e0e0e0;
  --vp-progress-fill: var(--vp-primary);
}

@media (prefers-color-scheme: dark) {
  :root {
    --vp-bg: #1e1e1e;
    --vp-fg: #e8e8e8;
    --vp-muted: #999999;
    --vp-border: #333333;
    --vp-input-bg: #2a2a2a;
    --vp-primary: #42a5f5;
    --vp-primary-fg: #1e1e1e;
    --vp-primary-disabled: #555555;
    --vp-success: #66bb6a;
    --vp-error: #ef5350;
    --vp-thumb-failed-bg: #2a2a2a;
    --vp-thumb-failed-fg: #666666;
    --vp-progress-track: #333333;
  }
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--vp-bg);
  color: var(--vp-fg);
}

.vp-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 10px 14px;
  border-bottom: 1px solid var(--vp-border);
  font-weight: 600;
}
.vp-version { font-size: 11px; color: var(--vp-muted); font-weight: 400; }

.vp-status {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--vp-muted);
}
.vp-status[data-state="ok"]    { color: var(--vp-success); }
.vp-status[data-state="error"] { color: var(--vp-error); }

.vp-settings {
  padding: 12px 14px;
  border-bottom: 1px solid var(--vp-border);
}
.vp-field {
  display: grid;
  grid-template-columns: 1fr 100px;
  align-items: center;
  margin-bottom: 8px;
  gap: 8px;
}
.vp-field input {
  background: var(--vp-input-bg);
  color: var(--vp-fg);
  border: 1px solid var(--vp-border);
  border-radius: 4px;
  padding: 6px 8px;
  font: inherit;
  width: 100%;
  text-align: right;
}
.vp-field input:focus {
  outline: 2px solid var(--vp-primary);
  outline-offset: -1px;
}

.vp-hint {
  margin: 8px 0;
  font-size: 12px;
  color: var(--vp-muted);
}
.vp-hint[data-state="error"] { color: var(--vp-error); }

.vp-btn-primary, .vp-btn-secondary {
  font: inherit;
  border-radius: 4px;
  padding: 8px 14px;
  cursor: pointer;
  border: 1px solid transparent;
}
.vp-btn-primary {
  width: 100%;
  background: var(--vp-primary);
  color: var(--vp-primary-fg);
  border-color: var(--vp-primary);
}
.vp-btn-primary:disabled {
  background: var(--vp-primary-disabled);
  border-color: var(--vp-primary-disabled);
  cursor: not-allowed;
}
.vp-btn-secondary {
  background: transparent;
  color: var(--vp-fg);
  border-color: var(--vp-border);
}
.vp-btn-secondary:hover { background: var(--vp-input-bg); }

.vp-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--vp-border);
}
.vp-progress-bar {
  flex: 1;
  height: 6px;
  background: var(--vp-progress-track);
  border-radius: 3px;
  overflow: hidden;
}
.vp-progress-fill {
  height: 100%;
  width: 0%;
  background: var(--vp-progress-fill);
  transition: width 0.2s ease;
}
.vp-progress-text {
  font-size: 12px;
  color: var(--vp-muted);
  min-width: 60px;
  text-align: right;
}

.vp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 10px 14px;
}
.vp-thumb {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.vp-thumb img, .vp-thumb-failed {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--vp-thumb-failed-bg);
  border-radius: 4px;
  object-fit: cover;
}
.vp-thumb-failed {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vp-thumb-failed-fg);
  font-size: 12px;
}
.vp-thumb-time {
  font-size: 12px;
  color: var(--vp-muted);
  text-align: center;
}
```

- [ ] **Step 2: 提交**

```bash
git add sidepanel/sidepanel.css
git commit -m "style(sidepanel): 原生 CSS + 深浅色变量"
```

---

### Task 17: sidepanel.js — 设置持久化 + 输入校验

**Files:**
- Create: `sidepanel/sidepanel.js`

- [ ] **Step 1: 写入 sidepanel.js 前半段（持久化 + 校验）**

写入 `D:\work\aiProjects\视频预览插件\sidepanel\sidepanel.js`：

```javascript
// Side Panel 主脚本
// 依赖：window.VP（utils.js 提供）

(() => {
  'use strict';

  const { formatTime, computePlan, validateInputs } = window.VP;
  const STORAGE_KEY = 'vp.settings';

  // ===== DOM 引用 =====
  const $status     = document.getElementById('vp-status');
  const $interval   = document.getElementById('vp-interval');
  const $skipIntro  = document.getElementById('vp-skip-intro');
  const $skipOutro  = document.getElementById('vp-skip-outro');
  const $hint       = document.getElementById('vp-hint');
  const $generate   = document.getElementById('vp-generate');
  const $progress   = document.getElementById('vp-progress');
  const $progressFill = document.getElementById('vp-progress-fill');
  const $progressText = document.getElementById('vp-progress-text');
  const $cancel     = document.getElementById('vp-cancel');
  const $grid       = document.getElementById('vp-grid');

  // ===== 应用状态 =====
  const state = {
    hasVideo: false,
    duration: 0,        // 秒
    videoCount: 0,
    busy: false,        // 是否正在生成
    settings: { interval: 10, skipIntro: 0, skipOutro: 0 }
  };

  // ===== 持久化 =====
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (Number.isFinite(obj.interval)) state.settings.interval = obj.interval;
      if (Number.isFinite(obj.skipIntro)) state.settings.skipIntro = obj.skipIntro;
      if (Number.isFinite(obj.skipOutro)) state.settings.skipOutro = obj.skipOutro;
    } catch (_) { /* ignore */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch (_) { /* ignore */ }
  }

  function applySettingsToInputs() {
    $interval.value  = state.settings.interval;
    $skipIntro.value = state.settings.skipIntro;
    $skipOutro.value = state.settings.skipOutro;
  }

  function readSettingsFromInputs() {
    state.settings.interval  = parseFloat($interval.value)  || 0;
    state.settings.skipIntro = parseFloat($skipIntro.value) || 0;
    state.settings.skipOutro = parseFloat($skipOutro.value) || 0;
  }

  // ===== 校验 + 计划计算 =====
  function refreshValidate() {
    readSettingsFromInputs();
    const { interval, skipIntro, skipOutro } = state.settings;
    // 视频未就绪时只校验 interval > 0
    if (!state.hasVideo) {
      const ok = interval > 0;
      $generate.disabled = !ok || state.busy;
      $hint.textContent = state.busy ? '正在生成…' : '请先打开 115 视频页的视频';
      $hint.dataset.state = '';
      return;
    }
    // 视频就绪后跑完整校验
    const v = validateInputs(interval, skipIntro, skipOutro, state.duration);
    if (!v.ok) {
      $generate.disabled = true;
      $hint.textContent = v.message;
      $hint.dataset.state = 'error';
      return;
    }
    // 校验通过
    const intervalSec = interval * 60;
    const skipIntroSec = skipIntro * 60;
    const skipOutroSec = skipOutro * 60;
    const plan = computePlan(state.duration, intervalSec, skipIntroSec, skipOutroSec);
    $generate.disabled = state.busy;
    $hint.textContent = plan.count === 0
      ? '当前参数下没有可生成的时间点'
      : `预计生成 ${plan.count} 张预览`;
    $hint.dataset.state = '';
  }

  // ===== 输入联动 =====
  [$interval, $skipIntro, $skipOutro].forEach($el => {
    $el.addEventListener('input', () => {
      readSettingsFromInputs();
      saveSettings();
      refreshValidate();
    });
  });

  // 启动
  loadSettings();
  applySettingsToInputs();
  refreshValidate();

  // 后续 Task 会继续往这个 IIFE 里追加：renderThumb / message routing / generate handler
  // 把这些挂到 window 或继续用 module pattern 均可，下面用 module pattern
  const api = { state, refreshValidate, $status, $hint, $generate, $progress, $progressFill, $progressText, $cancel, $grid };
  if (typeof module !== 'undefined') module.exports = api;
  window.VPState = api;
})();
```

> 工程师注：此 Task 之后 Side Panel 打开会显示 UI 与设置项，但还没接入 content script 的消息。继续 Task 18+。

- [ ] **Step 2: 提交**

```bash
git add sidepanel/sidepanel.js
git commit -m "feat(sidepanel): 设置持久化 + 输入校验 + 启动加载"
```

---

### Task 18: sidepanel.js — 状态机 + 按钮启停

**Files:**
- Modify: `sidepanel/sidepanel.js`

- [ ] **Step 1: 在 IIFE 末尾添加 idle/busy 切换函数与事件**

把 `sidepanel.js` 中 `window.VPState = api;` 那一行替换为以下整块：

```javascript
  // ===== 状态机：idle / busy =====
  function setBusy(busy) {
    state.busy = busy;
    $progress.hidden = !busy;
    $generate.textContent = busy ? '生成中…' : '开始生成预览';
    refreshValidate();  // 会重算 disabled
  }

  function setStatus(text, kind) {
    $status.textContent = text;
    $status.dataset.state = kind || '';
  }

  function clearGrid() {
    while ($grid.firstChild) $grid.removeChild($grid.firstChild);
  }

  $cancel.addEventListener('click', async () => {
    if (!state.busy) return;
    setStatus('正在取消…', '');
    try {
      const tab = await getActiveTab();
      await chrome.tabs.sendMessage(tab.id, { cmd: 'cancel' });
    } catch (e) { /* ignore */ }
  });

  // 取得当前活动 Tab（Side Panel 一定有 activeTab 权限走 chrome.tabs API）
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  const api = { state, refreshValidate, setBusy, setStatus, clearGrid, $status, $hint, $generate, $progress, $progressFill, $progressText, $cancel, $grid, getActiveTab };
  if (typeof module !== 'undefined') module.exports = api;
  window.VPState = api;
})();
```

- [ ] **Step 2: 提交**

```bash
git add sidepanel/sidepanel.js
git commit -m "feat(sidepanel): idle/busy 状态机 + 取消按钮"
```

---

### Task 19: sidepanel.js — 网格渲染

**Files:**
- Modify: `sidepanel/sidepanel.js`

- [ ] **Step 1: 在 setBusy 之后、setStatus 之前插入 renderThumb 与 addFailedThumb**

```javascript
  // ===== 网格渲染 =====
  function renderThumb(blob, time) {
    const url = URL.createObjectURL(blob);
    const wrap = document.createElement('div');
    wrap.className = 'vp-thumb';

    const img = document.createElement('img');
    img.src = url;
    img.alt = formatTime(time);
    img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    img.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      wrap.replaceWith(addFailedThumb(time));
    }, { once: true });

    const cap = document.createElement('div');
    cap.className = 'vp-thumb-time';
    cap.textContent = formatTime(time);

    wrap.appendChild(img);
    wrap.appendChild(cap);
    $grid.appendChild(wrap);
    return wrap;
  }

  function addFailedThumb(time) {
    const wrap = document.createElement('div');
    wrap.className = 'vp-thumb';
    const ph = document.createElement('div');
    ph.className = 'vp-thumb-failed';
    ph.textContent = '× 失败';
    const cap = document.createElement('div');
    cap.className = 'vp-thumb-time';
    cap.textContent = formatTime(time);
    wrap.appendChild(ph);
    wrap.appendChild(cap);
    return wrap;
  }
```

- [ ] **Step 2: 提交**

```bash
git add sidepanel/sidepanel.js
git commit -m "feat(sidepanel): 网格渲染 + 失败占位 + blob 内存释放"
```

---

### Task 20: sidepanel.js — 消息路由 + 进度条

**Files:**
- Modify: `sidepanel/sidepanel.js`

- [ ] **Step 1: 在 addFailedThumb 函数之后、$cancel.addEventListener 之前插入 generate 处理器与 content 消息监听**

```javascript
  // ===== 生成流程 =====
  $generate.addEventListener('click', async () => {
    if (state.busy || !state.hasVideo) return;
    readSettingsFromInputs();
    saveSettings();
    const { interval, skipIntro, skipOutro } = state.settings;
    const v = validateInputs(interval, skipIntro, skipOutro, state.duration);
    if (!v.ok) return;

    const intervalSec = interval * 60;
    const skipIntroSec = skipIntro * 60;
    const skipOutroSec = skipOutro * 60;
    const plan = computePlan(state.duration, intervalSec, skipIntroSec, skipOutroSec);
    if (plan.count === 0) return;

    clearGrid();
    setBusy(true);
    setStatus(`正在生成 ${plan.count} 张预览…`, '');
    $progressFill.style.width = '0%';
    $progressText.textContent = `0 / ${plan.count}`;

    let tab;
    try {
      tab = await getActiveTab();
    } catch (e) {
      setBusy(false);
      setStatus('找不到活动标签页', 'error');
      return;
    }

    try {
      const resp = await chrome.tabs.sendMessage(tab.id, {
        cmd: 'generate',
        interval: intervalSec,
        skipIntro: skipIntroSec,
        skipOutro: skipOutroSec,
        times: plan.times
      });
      if (!resp || !resp.ok) {
        setBusy(false);
        setStatus('启动生成失败：' + (resp && resp.error ? resp.error : '未知错误'), 'error');
      }
    } catch (e) {
      setBusy(false);
      setStatus('无法连接到 115 视频页面：' + e.message, 'error');
    }
  });

  // ===== 接收 content script 的推送 =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.cmd) return;
    if (msg.cmd === 'video-status') {
      state.hasVideo = !!msg.hasVideo;
      state.duration = Number.isFinite(msg.duration) ? msg.duration : 0;
      state.videoCount = msg.videoCount || 0;
      if (state.hasVideo) {
        const dur = formatTime(state.duration);
        const extra = state.videoCount > 1 ? `（共 ${state.videoCount} 个 video，已选主播放器）` : '';
        setStatus(`已检测到视频 · 时长 ${dur}${extra}`, 'ok');
      } else {
        setStatus('未检测到视频，请先打开 115 视频页的视频', 'error');
      }
      refreshValidate();
    } else if (msg.cmd === 'thumb') {
      renderThumb(msg.blob, msg.time);
    } else if (msg.cmd === 'progress') {
      const pct = msg.total > 0 ? Math.round((msg.done / msg.total) * 100) : 0;
      $progressFill.style.width = pct + '%';
      $progressText.textContent = `${msg.done} / ${msg.total}`;
    } else if (msg.cmd === 'done') {
      setBusy(false);
      $progressFill.style.width = '100%';
      const note = msg.failed > 0 ? `（${msg.failed} 张失败）` : '';
      setStatus(`完成 · 成功 ${msg.success}${note}`, msg.failed > 0 ? 'error' : 'ok');
    } else if (msg.cmd === 'cancelled') {
      setBusy(false);
      setStatus('已取消', '');
    } else if (msg.cmd === 'aborted') {
      setBusy(false);
      setStatus('视频页面已关闭，生成中止', 'error');
    } else if (msg.cmd === 'error') {
      setBusy(false);
      setStatus('生成出错：' + (msg.message || '未知错误'), 'error');
    }
  });

  // 启动时主动 ping 一次，让 content script 立刻回报当前状态
  (async () => {
    try {
      const tab = await getActiveTab();
      await chrome.tabs.sendMessage(tab.id, { cmd: 'ping' });
    } catch (_) { /* 还没注入 content script，忽略 */ }
  })();
```

- [ ] **Step 2: 提交**

```bash
git add sidepanel/sidepanel.js
git commit -m "feat(sidepanel): 生成触发 + content 消息路由 + 进度更新"
```

> 工程师注：到这里 v1 所有代码都已写完。下一 Task 做端到端验证。

---

### Task 21: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写入 README.md**

写入 `D:\work\aiProjects\视频预览插件\README.md`：

````markdown
# 115 视频预览

Chrome/115 浏览器扩展。在 115 网盘视频页打开视频后，在 Side Panel 点一次「生成预览」即可获得按时间均匀分布的缩略图网格，快速扫一眼长视频内容。

## 功能

- 在 115 网盘视频页（`115.com` / `115pan.com`）注入，自动检测视频
- 自定义采样间隔（分钟）
- 跳过片头 / 片尾
- 2 列网格、320×180 JPEG 缩略图，带时间戳
- 设置在本地 Side Panel 内持久化

## 安装

1. 打开 Chrome / 115 浏览器，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本仓库根目录
4. 工具栏出现「115 视频预览」图标

## 使用

1. 访问 115 网盘，打开任意视频
2. 点工具栏图标打开 Side Panel
3. 调整「间隔 / 跳过片头 / 跳过片尾」（默认 10 / 0 / 0）
4. 点「开始生成预览」
5. 缩略图会逐张出现在网格中，完成后状态栏显示「完成 · 成功 N」

## 开发

- 无构建步骤，所有 JS 直接 `<script>` 引入
- 纯函数单测：`node --test sidepanel/utils.test.js`
- 设计 spec：`docs/superpowers/specs/`
- 实现计划：`docs/superpowers/plans/`

## 限制

- v1 不在 Side Panel 外保存缩略图，关掉面板需重新生成
- 仅支持 115 网盘视频页
- v1 图标为占位蓝色方块
````

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs: 安装/使用/开发说明"
```

---

### Task 22: 端到端手动验证

**目标：** 在真实 115 视频页上跑通整个流程。

- [ ] **Step 1: 加载扩展**

打开 `chrome://extensions/`，确认「115 视频预览」出现在列表中且无报错（红色错误条）。

- [ ] **Step 2: 跑单测**

```bash
cd "D:\work\aiProjects\视频预览插件"
node --test sidepanel/utils.test.js
```

预期：25 个用例全 PASS（`tests 25 pass 25 fail 0`）。

- [ ] **Step 3: 打开 115 视频页**

登录 `https://115.com/`，进入任一视频。点工具栏图标打开 Side Panel。

预期：状态行绿色「已检测到视频 · 时长 h:mm:ss」；设置区显示「预计生成 N 张预览」；「开始生成预览」按钮可点。

- [ ] **Step 4: 用默认参数（10/0/0）生成**

点「开始生成预览」。

预期：
- 按钮变「生成中…」禁用
- 进度条出现，「0 / N」开始累加
- 视频页面内的视频暂停
- 缩略图逐张出现在 2 列网格中
- 完成后状态行「完成 · 成功 N」，视频恢复原始状态（如果原本在播则恢复播放）

- [ ] **Step 5: 测跳过参数**

把「跳过片头」改 3、「跳过片尾」改 5，间隔 10，重新生成。

预期：缩略图从「3:00」开始，最后一张时间 ≤ 时长 - 5:00。

- [ ] **Step 6: 测取消**

点「开始生成预览」，立刻点「取消」。

预期：状态行「已取消」；视频恢复到原始状态；网格保留已生成的图（不自动清空）。

- [ ] **Step 7: 测刷新持久化**

改任意设置（例：间隔 15）→ 关 Side Panel → 重新打开。

预期：间隔输入框仍是 15。

- [ ] **Step 8: 测异常路径 a：无视频**

打开 115 首页（不是视频页）→ 打开 Side Panel。

预期：状态行红色「未检测到视频，请先打开 115 视频页的视频」；按钮禁用。

- [ ] **Step 9: 测异常路径 b：跳过超限**

把「跳过片头」设到等于或超过视频时长。

预期：hint 红字「跳过时长超过视频总长」；按钮禁用。

- [ ] **Step 10: 测异常路径 c：页面卸载**

点「开始生成预览」，立刻关掉 115 视频页（整页关闭）。

预期：状态行「视频页面已关闭，生成中止」；Side Panel 不报错。

- [ ] **Step 11: 检查 console**

Side Panel 右键「检查」打开 DevTools → Console 面板；Content Script 在 115 页 DevTools → Console 面板。

预期：均无红色错误。允许有 `sendMessage ...` 的 "Could not establish connection" 警告（Side Panel 未开时正常）。

- [ ] **Step 12: 完成验证后提交（如有微调）**

若 22.1–22.11 全通过且无代码改动，无须 commit。若有 micro-fix：

```bash
git add -A
git commit -m "fix: 端到端验证后的微调"
```

---

## 自审（plan vs spec）

- [x] Spec §1.3 范围内功能：5/5 全部覆盖（Task 11/13/17/18/19/20）
- [x] Spec §3 manifest：Task 2
- [x] Spec §4.1 视频挑选：Task 11
- [x] Spec §4.2 采集循环：Task 12/13
- [x] Spec §4.3 消息协议：Task 14 + Task 20
- [x] Spec §5 Side Panel UI：Task 15/16/17/18/19/20
- [x] Spec §5.3 持久化：Task 17
- [x] Spec §6 边界场景：Task 22.6/22.8/22.9/22.10
- [x] Spec §7 文件结构：Tasks 2/3/4/11/15/16/17/21
- [x] Spec §8 安全 & 权限：Task 2（最小权限）

无 placeholder、无类型不一致（generate 接口在 Task 14 与 Task 20 完全对齐；`times` 数组由 Side Panel 计算传入 content script）。
