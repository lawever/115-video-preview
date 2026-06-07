# 115 Thumbnailer

115 浏览器扩展。在 115 网盘视频页打开视频后，页面内自动弹出浮窗，点一次「开始生成预览」即可按指定数量在视频时间轴均匀生成缩略图，用于快速扫一眼长视频内容。

## 功能

- 在 115 网盘视频页（`115.com` / `115vod.com` / `115pan.com`）内嵌浮窗
- 自定义生成数量（张数）
- 跳过片头 / 片尾（分钟）
- 2 列网格、320×180 JPEG 缩略图，带时间戳
- 点缩略图全屏放大查看
- 浮窗可拖拽到任意位置、可折叠、× 关闭（工具栏图标再开）
- 设置与位置持久化（chrome.storage.local）

## 安装

1. 打开 Chrome / 115 浏览器，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择本仓库根目录
4. 工具栏出现「115 视频预览」图标

## 使用

1. 访问 115 网盘，打开任意视频
2. 浮窗自动出现在右上角；如果之前关过，点工具栏图标重新显示
3. 调整「数量 / 跳过片头 / 跳过片尾」（默认 12 / 0 / 0）
4. 提示行会显示「预计生成 N 张预览（每 ~X:XX 一张）」
5. 点「开始生成预览」→ 缩略图边生成边出现在网格
6. 拖头部可移动面板；− 折叠到只剩标题；× 关闭
7. 点任意缩略图全屏放大，再点空白或按 Esc 关闭

## 浮窗操作

- 拖动标题栏 = 移动位置
- 标题栏 [−] = 折叠/展开
- 标题栏 [×] = 关闭（再点工具栏图标重开）
- 点击缩略图 = 全屏放大
- 空白处 / Esc = 关闭放大图

## 开发

- 无构建步骤，所有 JS 直接 `<script>` 引入
- 纯函数单测：`node --test sidepanel/utils.test.js`
- 设计 spec：`docs/superpowers/specs/`
- 实现计划：`docs/superpowers/plans/`

## 文件结构

```
manifest.json
background.js              # 工具栏图标点击 → 切浮窗
content/
  content.js               # 注入浮窗（Shadow DOM）+ 视频检测 + 截图
  panel.css                # 浮窗样式
sidepanel/
  utils.js                 # 纯函数（formatTime / computePlanByCount / validateInputs）
  utils.test.js            # 27 个单测
icons/
  icon-{16,48,128}.png     # 蓝紫渐变 + 4 宫格 + 播放三角
```

## 限制

- 仅在 115 网盘视频页生效（含 115.com / 115vod.com / 115pan.com / anxia.com 域名）
- 浮窗位置 / 折叠 / 关闭状态独立持久化在 chrome.storage.local
- 115 旧版播放器用 `<video>` 时可正常截取；自定义 canvas 播放器需另写探测逻辑