# 115 视频预览 Chrome 扩展 — 设计 spec

- 日期：2026-06-06
- 状态：待评审
- 范围：v1，仅在 115 网盘视频页生效

## 1. 目标与边界

### 1.1 一句话

在 115 网盘视频页打开视频后，用户通过浏览器 Side Panel 点一次「生成预览」即可获得按时间均匀分布的 JPEG 缩略图网格，用于快速扫一眼长视频的内容分布。

### 1.2 用户故事

- 我打开 2 小时的电影，按 10 分钟一张生成 12 张预览，在 Side Panel 里用 30 秒决定值不值得看。
- 综艺 / 连续剧开头有片头曲、结尾有字幕滚动，我配「跳过片头 3 分钟 / 跳过片尾 5 分钟」，缩略图集中在正片。

### 1.3 v1 范围内

- 115 网盘视频页（含 115.com / 115pan.com 域名）
- Side Panel 中手动触发生成
- 3 个用户参数：间隔（分钟）、跳过片头（分钟）、跳过片尾（分钟）
- 2 列、320×180、JPEG 质量 0.85 的缩略图网格
- 缩略图下方显示对应时间戳
- 设置在本地 Side Panel 中持久化（localStorage）

### 1.4 v1 范围外（明确不做）

- 点击缩略图跳到对应时间点
- 导出 / 下载图片
- 缩略图尺寸 / 质量 / 列数可调
- 多语言（仅中文）
- 设置页 / 选项页
- 历史记录 / 缓存 / 跨页面持久化
- 适配 115 之外的视频网站
- 自动识别片头片尾

## 2. 架构

### 2.1 组件

```
┌─────────────┐  tab.sendMessage   ┌──────────────┐
│  Side Panel │ ─────────────────► │ Content Script│
│  (sidepanel)│  生成命令 / 取消   │  (content.js) │
│             │ ◄───────────────── │  注入到 115 页 │
│  显示缩略图 │  sendMessage 推图  │  找 <video>   │
└─────────────┘                    │  seek+截图    │
                                   └──────────────┘
                                   不需要 service worker
```

- **Content Script**（注入到 115 页面，isolated world）：唯一干活的，负责找 `<video>`、seek、canvas 截图、把每张图推到 Side Panel。
- **Side Panel**（HTML+JS+CSS）：纯 UI，3 个设置输入 + 生成按钮 + 进度条 + 2 列网格。收图就加进 DOM。
- **Service Worker**：极简，只做 `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`，让点工具栏图标直接开 Side Panel。**不参与消息路由**——Side Panel ↔ Content Script 直接 `chrome.tabs.sendMessage` 通信。

### 2.2 关键设计决策（用户已确认）

| 决策点 | 选定 |
|---|---|
| 核心用途 | A. 网格墙扫一眼就够 |
| 展示位置 | A. 浏览器侧边栏 |
| 生效范围 | A. 只在 115 网盘视频页 |
| 触发方式 | A. 手动点「生成」按钮 |
| 缩略图样式 | B. 中等 320×180 / 2 列 / JPEG 0.85 |
| 持久化 | A. 内存流式，不缓存 |

## 3. Manifest（MV3）

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

权限最小化：
- 只声明 `sidePanel` 权限
- `host_permissions` 限定 115 域名
- **不**声明 `storage` 权限（用 Side Panel 内的 `localStorage`）
- **不**声明 `tabs` / `activeTab` 权限

> 落地时若发现 115 用了其他域名（如 `anxia.com`、视频 CDN），再追加到 `host_permissions` 和 `content_scripts.matches`。

## 4. 内容脚本：帧采集流水线

### 4.1 视频元素挑选

- 主策略：`document.querySelector('video')`
- 兜底：取所有 `<video>`，选 `videoWidth × videoHeight` 最大的（主播放器）
- 用 `MutationObserver` 监听 DOM 变化，视频元素被替换时重新挑选
- 通过 `{cmd: 'video-status', hasVideo, duration, videoCount}` 通知 Side Panel

### 4.2 采集循环

收到 `{cmd: 'generate', interval, skipIntro, skipOutro}` 后：

1. 校验入参：`interval > 0` 且 `skipIntro ≥ 0` 且 `skipOutro ≥ 0` 且 `skipIntro + skipOutro < duration`
2. 校验失败 → 回 `{cmd: 'error', message}`，结束
3. 保存原始 `video.currentTime` 与 `video.paused` 状态
4. `video.pause()`
5. 计算目标时间数组：
   ```
   times = []
   for t = skipIntro; t <= duration - skipOutro; t += interval:
       times.push(t)
   ```
6. 回 `{cmd: 'plan', total: times.length}` 给 Side Panel
7. 遍历 `times`：
   - `video.currentTime = t`
   - 等 `seeked` 事件（超时 5s）
   - 超时则记一次失败，跳过该点
   - 新建 Canvas（320×180）
   - `ctx.drawImage(video, 0, 0, 320, 180)`
   - `canvas.toBlob(blob => sendThumb(blob, t), 'image/jpeg', 0.85)`
   - 回 `{cmd: 'progress', done, total, time: t}`
8. 全部完成：恢复 `currentTime` 与 `paused`，回 `{cmd: 'done', success, failed}`
9. 中途收到 `{cmd: 'cancel'}`：跳出循环，恢复 `currentTime` 与 `paused`，回 `{cmd: 'cancelled'}`

### 4.3 消息协议

Side Panel → Content Script：

| cmd | payload | 说明 |
|---|---|---|
| `ping` | — | 健康检查 |
| `generate` | `{interval, skipIntro, skipOutro, times}` | 开始生成（times 由 Side Panel 用 utils.computePlan 预算好传入，content script 不重复实现） |
| `cancel` | — | 取消生成 |

Content Script → Side Panel：

| cmd | payload | 说明 |
|---|---|---|
| `video-status` | `{hasVideo, duration, videoCount}` | 视频就绪状态变化 |
| `plan` | `{total}` | 即将生成 N 张 |
| `progress` | `{done, total, time}` | 单张完成 |
| `thumb` | `{blob, time}` | 一张缩略图二进制 |
| `done` | `{success, failed}` | 全部完成 |
| `cancelled` | — | 被取消 |
| `aborted` | — | 视频页面被卸载 |
| `error` | `{message}` | 入参错误等 |


> **设计决策**：`times` 由 Side Panel 端用 `utils.computePlan` 算好后随 `generate` 一起传入。Content Script 不引入 `utils.js`（避免双份实现与构建复杂度）。Content Script 信任 Side Panel 的校验结果。

`thumb` 消息直接传 `Blob`，由 `chrome.runtime` 序列化；Side Panel 用 `URL.createObjectURL` 渲染，`img.onload` 后 `revokeObjectURL`。

## 5. Side Panel UI

### 5.1 布局

```
┌─────────────────────────────────────┐
│ ● 115 视频预览    v0.1.0           │ ← 顶栏
├─────────────────────────────────────┤
│ 状态：已检测到视频 · 时长 1:58:32    │ ← 状态行（绿/红）
├─────────────────────────────────────┤
│  间隔（分钟）  [  10  ]              │
│  跳过片头（分钟）[   0  ]            │
│  跳过片尾（分钟）[   0  ]            │ ← 3 个数字输入
│                                      │
│  预计生成 12 张预览                 │ ← 实时计算结果数
│                                      │
│  [    开始生成预览    ]              │ ← 主按钮
├─────────────────────────────────────┤
│ ███████░░░░░░░░  3 / 12  [取消]     │ ← 生成中：进度条
├─────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐            │
│  │  缩略图  │  │  缩略图  │            │
│  │ 12:35   │  │ 22:35   │  ← 2 列网格│
│  └─────────┘  └─────────┘            │
│  ┌─────────┐  ┌─────────┐            │
│  │  缩略图  │  │  缩略图  │            │
│  │ 32:35   │  │ 42:35   │            │
│  └─────────┘  └─────────┘            │
└─────────────────────────────────────┘
```

### 5.2 交互细节

- 三个输入值合法（`interval > 0` 且 `skipIntro ≥ 0` 且 `skipOutro ≥ 0` 且 `skipIntro + skipOutro < duration`）时，按钮才可点
- 数字输入实时算「预计生成 N 张」，`N = floor((duration - skipIntro - skipOutro) / interval)`
- 时间戳格式：`< 1h` 显示 `mm:ss`，`≥ 1h` 显示 `h:mm:ss`
- 网格里**每张图下方**显示对应时间戳，不悬停、不角标
- 生成中：按钮变「生成中…」禁用，进度条显示 `已生成 N / 总数`，旁边有「取消」按钮
- 生成中再开 Side Panel：旧内容清空（不持久化），按钮变可点
- 图片懒加载：使用 `URL.createObjectURL(blob)`，`img.onload` 后 `URL.revokeObjectURL` 释放
- 视觉：跟随系统 `prefers-color-scheme` 切深浅色；纯原生 CSS，**不引第三方 UI 库**

### 5.3 设置持久化

- 键：`vp.settings`
- 存：`{interval: 10, skipIntro: 0, skipOutro: 0}`
- 启动时读，没有则用默认值
- 任一输入 change 即写
- 不用 `chrome.storage`（减少权限），用 Side Panel 自己的 `localStorage`

## 6. 边界场景

| 场景 | 行为 |
|---|---|
| 页面没有 `<video>` | 状态行红色「未检测到视频，请先打开 115 视频页面」；按钮禁用 |
| 视频 `duration = Infinity`（MSE 直播态） | 同上，未就绪则禁用 |
| `skipIntro + skipOutro ≥ duration` | 按钮禁用 + 红字提示「跳过时长超过视频总长」 |
| `interval = 0` 或负数 | 按钮禁用 + 红字提示「间隔必须大于 0」 |
| 用户切到别的 Tab / 关 Side Panel | Content Script 继续跑完；下次开 Side Panel 拿不到图（符合 A 决策） |
| 用户关掉 115 视频页 / 导航走 | Content Script 自动卸载，回 `{cmd: "aborted"}`，Side Panel 显示「视频页面已关闭，生成中止」 |
| 115 视频加密流 seek 慢 | 单点 `seeked` 超时 5s，跳过该点记一次错误，继续下一张；最终汇总「成功 N / 失败 M」 |
| 同一页面有多个 `<video>` | 取 `videoWidth × videoHeight` 最大的（主播放器），并标在状态行「已检测到视频」 |
| 用户重复点「开始生成」 | 第二次点击忽略（按钮已禁用）；进行中按钮不可点 |
| 生成中点「取消」 | Content Script 收到 `{cmd: "cancel"}` 后退出循环，恢复 `currentTime/paused` |
| 缩略图渲染失败（blob 损坏） | Side Panel 占位「× 失败」灰色块，计入 `failed` |

## 7. 文件结构

```
视频预览插件/
├── manifest.json
├── background.js              # 极简：注册 side panel 点击行为
├── content/
│   └── content.js             # 帧采集主逻辑（消息收发 + 截图循环）
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.js           # UI 状态机、网格渲染、消息路由
│   └── sidepanel.css          # 原生 CSS，含深浅色变量
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   └── 2026-06-06-115-video-preview-extension-design.md  # 本文件
│       └── plans/             # writing-plans 阶段产出
└── README.md                  # 安装/使用说明
```

- 无构建步骤：所有 JS 直接 `<script>` 引入
- 无第三方依赖
- 无 node_modules
- 图标先用占位 1×1 PNG，落地时换正式图标（v1 不阻塞）

## 8. 安全 & 权限

- **最小权限原则**：只声明 `sidePanel` + 115 域名 `host_permissions`
- Content Script 只读 `<video>` 和创建 Canvas，**不**读 cookie / localStorage / sessionStorage
- Content Script **不**发起任何网络请求
- Side Panel 与 Content Script 之间只传 Blob / 简单 JSON
- 不收集任何用户数据
- 图全部 `URL.createObjectURL(blob)` 后立即可显示，blob 生命周期跟 tab

## 9. 后续可能的扩展（v1 不做，列出供后续 brainstorm）

- 点击缩略图 seek 视频
- 一键下载全部图片（zip）
- 缩略图尺寸 / 质量 / 列数可配
- 多语言
- 历史记录 / 收藏夹
- 自动识别片头片尾（基于画面变化检测）
- 适配其他视频网站
- 短视频专用模式（< 10 分钟按秒级采样）
