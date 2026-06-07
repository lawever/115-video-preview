// Content Script（isolated world）
// 115 网盘视频页内嵌浮窗：检测 <video>，按指定数量在时间轴均匀生成缩略图。
// 完全自包含：utils 函数和 CSS 都内联，不依赖 fetch/eval，绕过页面 CSP 限制。
// utils.js 在 lib/ 下作为单测源；这里内联的版本与之保持同步。

(() => {
  'use strict';

  if (window.__vpInjected || document.getElementById('vp-host-root')) return;
  window.__vpInjected = true;

  // ============================================================
  // 内联工具函数（与 lib/utils.js 保持同步）
  // ============================================================
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function computePlanByCount(duration, count, skipIntro, skipOutro) {
    const start = Math.max(0, skipIntro);
    const end = Math.max(start, duration - Math.max(0, skipOutro));
    const active = end - start;
    if (count <= 0 || active <= 0) return { count: 0, times: [], interval: 0 };
    const actualCount = Math.min(count, active);
    const interval = Math.floor(active / actualCount);
    if (interval <= 0) return { count: 0, times: [], interval: 0 };
    const times = [];
    for (let i = 0; i < actualCount; i++) times.push(start + i * interval);
    return { count: actualCount, times, interval };
  }
  function validateInputs(count, skipIntro, skipOutro, duration) {
    if (!Number.isFinite(duration) || duration <= 0) return { ok: false, message: '视频时长无效' };
    if (!Number.isFinite(count) || count <= 0) return { ok: false, message: '生成数量必须大于 0' };
    if (!Number.isFinite(skipIntro) || skipIntro < 0) return { ok: false, message: '跳过片头不能为负' };
    if (!Number.isFinite(skipOutro) || skipOutro < 0) return { ok: false, message: '跳过片尾不能为负' };
    if (skipIntro + skipOutro >= duration) return { ok: false, message: '跳过时长超过视频总长' };
    return { ok: true, message: '' };
  }

  // ============================================================
  // 错误兜底：万一初始化失败，在页面右上角显示红色错误条
  // ============================================================
  function showFatal(msg) {
    try {
      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:#c62828;color:#fff;padding:12px 16px;border-radius:6px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3);max-width:400px;';
      div.textContent = '115 视频预览 初始化失败: ' + msg;
      (document.body || document.documentElement).appendChild(div);
    } catch (_) { /* ignore */ }
  }

  try {
    init();
  } catch (e) {
    console.error('[115VP] init failed', e);
    showFatal(e.message || String(e));
  }

  function init() {
    // ============================================================
    // 常量
    // ============================================================
    const THUMB_W = 320;
    const THUMB_H = 180;
    const QUALITY = 0.85;
    const SEEK_TIMEOUT_MS = 30000;

    // ============================================================
    // 状态
    // ============================================================
    const state = {
      hasVideo: false,
      duration: 0,
      videoCount: 0,
      busy: false,
      cancelRequested: false,
      capturing: false,
      settings: { count: 10, skipIntro: 0, skipOutro: 0 },
      panelVisible: true,
      panelCollapsed: false,
      panelPosition: null,
      miniHidden: false,
      shouldShow: false,
    };

    function loadStorage() {
      return new Promise(resolve => {
        chrome.storage.local.get([
          'vp.settings', 'vp.panelVisible', 'vp.panelCollapsed', 'vp.panelPosition', 'vp.miniHidden'
        ], items => {
          const s = items['vp.settings'];
          if (s) {
            if (Number.isFinite(s.count)) state.settings.count = s.count;
            if (Number.isFinite(s.skipIntro)) state.settings.skipIntro = s.skipIntro;
            if (Number.isFinite(s.skipOutro)) state.settings.skipOutro = s.skipOutro;
          }
          if (typeof items['vp.panelVisible'] === 'boolean') state.panelVisible = items['vp.panelVisible'];
          if (typeof items['vp.panelCollapsed'] === 'boolean') state.panelCollapsed = items['vp.panelCollapsed'];
          if (items['vp.panelPosition'] && typeof items['vp.panelPosition'].left === 'number') {
            state.panelPosition = items['vp.panelPosition'];
          }
          if (typeof items['vp.miniHidden'] === 'boolean') state.miniHidden = items['vp.miniHidden'];
          resolve();
        });
      });
    }
    function saveSettings() { chrome.storage.local.set({ 'vp.settings': state.settings }); }
    function savePanelState() {
      chrome.storage.local.set({
        'vp.panelVisible': state.panelVisible,
        'vp.panelCollapsed': state.panelCollapsed,
        'vp.panelPosition': state.panelPosition,
        'vp.miniHidden': state.miniHidden,
      });
    }

    // ============================================================
    // 创建 Shadow DOM
    // ============================================================
    const PANEL_HTML = `<div class="vp-panel" id="vp-panel">
  <div class="vp-header" id="vp-header">
    <span class="vp-title">● 115 视频预览</span>
    <span class="vp-version">v0.4.0</span>
    <span class="vp-spacer"></span>
    <button class="vp-icon-btn" id="vp-collapse" title="折叠/展开" type="button">−</button>
    <button class="vp-icon-btn" id="vp-close" title="关闭（工具栏图标再开）" type="button">×</button>
  </div>
  <div class="vp-body" id="vp-body">
    <div class="vp-status" id="vp-status" data-state="loading">正在检测视频…</div>
    <div class="vp-fields">
      <label class="vp-field"><span>数量 <em id="vp-count-display">10</em></span><input type="range" id="vp-count" min="10" max="100" step="1" value="10"></label>
      <label class="vp-field"><span>片头（分） <em id="vp-skip-intro-display">0</em></span><input type="range" id="vp-skip-intro" min="0" max="60" step="1" value="0"></label>
      <label class="vp-field"><span>片尾（分） <em id="vp-skip-outro-display">0</em></span><input type="range" id="vp-skip-outro" min="0" max="60" step="1" value="0"></label>
    </div>
    <div class="vp-hint" id="vp-hint">预计生成 0 张预览</div>
    <button class="vp-btn-primary" id="vp-generate" disabled type="button">开始生成预览</button>
    <div class="vp-progress" id="vp-progress" hidden>
      <div class="vp-progress-bar"><div class="vp-progress-fill" id="vp-progress-fill"></div></div>
      <span class="vp-progress-text" id="vp-progress-text">0 / 0</span>
      <button class="vp-btn-secondary" id="vp-cancel" type="button">取消</button>
    </div>
    <div class="vp-grid" id="vp-grid"></div>
  </div>
  <div class="vp-resize-bl" id="vp-resize-bl" title="拖动调整大小"></div>
</div>

<div class="vp-mini" id="vp-mini" hidden><button class="vp-mini-icon" id="vp-mini-icon" title="点击展开 115 视频预览" type="button">▶</button><button class="vp-mini-close" id="vp-mini-close" title="完全关闭（点工具栏图标再开）" type="button">×</button></div>
`;

    const PANEL_CSS = `:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
:host {
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
  --vp-progress-fill: #1976d2;
  --vp-overlay: rgba(0, 0, 0, 0.85);
}
@media (prefers-color-scheme: dark) {
  :host {
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
@media (prefers-color-scheme: dark) {
  .vp-panel { background-color: #1e1e1e !important; color: #e8e8e8 !important; }
  .vp-body { background-color: #1e1e1e !important; }
}
.vp-mini {
  position: fixed; bottom: 20px; right: 20px;
  background: transparent; border: none; padding: 0;
  font: inherit; user-select: none; pointer-events: auto;
  z-index: 2;
}
.vp-mini-icon {
  position: relative;
  width: 40px; height: 40px; border-radius: 50%;
  background: #1f1f1f;
  color: #e8e8e8; border: none; cursor: pointer; padding: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.25);
  transition: transform .15s ease;
}
.vp-mini-icon:hover { transform: scale(1.08); }
.vp-mini-close {
  position: absolute; left: -6px; bottom: -2px;
  width: 20px; height: 20px; border-radius: 50%;
  background: #c62828; color: #fff; border: 2px solid #ffffff;
  cursor: pointer; display: none; font-size: 13px; line-height: 1;
  align-items: center; justify-content: center;
  box-shadow: 0 1px 4px rgba(0,0,0,.3);
  padding: 0;
}
.vp-mini:hover .vp-mini-close { display: flex; }
.vp-mini-close:hover { background: #b71c1c; }
.vp-resize-bl {
  position: absolute;
  left: 0; bottom: 0;
  width: 20px; height: 20px;
  cursor: sw-resize;
  z-index: 2;
  background: transparent;
}

.vp-panel {
  position: fixed; top: 20px; right: 20px;
  width: 380px; max-width: calc(100vw - 40px); max-height: calc(100vh - 40px);
  min-width: 360px; min-height: 220px;
  background-color: #ffffff;
  color: #1a1a1a;
  border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,.25);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  pointer-events: auto; display: flex; flex-direction: column;
  overflow: hidden; z-index: 1;
  resize: both;
  transition: width .3s cubic-bezier(.4,0,.2,1),
              height .3s cubic-bezier(.4,0,.2,1),
              border-radius .3s cubic-bezier(.4,0,.2,1),
              box-shadow .3s ease;
}

.vp-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: #1f1f1f; color: #e8e8e8;
  border-bottom: 1px solid #333;
  cursor: move; user-select: none; flex-shrink: 0;
}
.vp-title { font-weight: 600; font-size: 13px; }
.vp-version { font-size: 11px; opacity: .75; }
.vp-spacer { flex: 1; }
.vp-icon-btn {
  background: transparent; color: inherit; border: none;
  width: 24px; height: 24px; font-size: 18px; line-height: 1;
  cursor: pointer; border-radius: 4px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: inherit;
}
.vp-icon-btn:hover { background: rgba(255,255,255,.2); }
.vp-body { background-color: #ffffff; padding: 10px 12px; overflow-y: auto; max-height: calc(80vh - 40px); }
.vp-status { font-size: 12px; color: var(--vp-muted); margin-bottom: 8px; word-break: break-all; }
.vp-status[data-state="ok"] { color: var(--vp-success); }
.vp-status[data-state="error"] { color: var(--vp-error); }
.vp-fields { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.vp-field { display: flex; flex-direction: column; gap: 3px; }
.vp-field span { font-size: 11px; color: var(--vp-muted); }
.vp-field input {
  background: var(--vp-input-bg); color: var(--vp-fg);
  border: 1px solid var(--vp-border); border-radius: 4px;
  padding: 4px 6px; font: inherit; width: 100%;
  text-align: center; -moz-appearance: textfield;
}
.vp-field input::-webkit-outer-spin-button,
.vp-field input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.vp-field input:focus { outline: 2px solid var(--vp-primary); outline-offset: -1px; }
.vp-field input[type="range"] {
  background: transparent; border: none; padding: 0; margin: 0;
  width: 100%; height: 20px;
  -webkit-appearance: none; appearance: none;
  cursor: pointer;
}
.vp-field input[type="range"]::-webkit-slider-runnable-track {
  height: 4px;
  background: var(--vp-input-bg, #e0e0e0);
  border-radius: 2px;
}
.vp-field input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px; height: 14px;
  background: var(--vp-primary, #1976d2);
  border-radius: 50%;
  margin-top: -5px;
  cursor: pointer;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0,0,0,.25);
}
.vp-field input[type="range"]::-moz-range-track {
  height: 4px;
  background: var(--vp-input-bg, #e0e0e0);
  border-radius: 2px;
  border: none;
}
.vp-field input[type="range"]::-moz-range-thumb {
  width: 14px; height: 14px;
  background: var(--vp-primary, #1976d2);
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0,0,0,.25);
}
.vp-field input[type="range"]:focus { outline: none; }
.vp-field em { font-style: normal; color: var(--vp-fg, #1a1a1a); font-weight: 600; font-size: 12px; }
.vp-hint { font-size: 12px; color: var(--vp-muted); margin: 6px 0; }
.vp-hint[data-state="error"] { color: var(--vp-error); }
.vp-btn-primary, .vp-btn-secondary {
  font: inherit; border-radius: 4px; padding: 6px 12px;
  cursor: pointer; border: 1px solid transparent; font-size: 13px;
}
.vp-btn-primary { width: 100%; background: var(--vp-primary); color: var(--vp-primary-fg); border-color: var(--vp-primary); }
.vp-btn-primary:disabled { background: var(--vp-primary-disabled); border-color: var(--vp-primary-disabled); cursor: not-allowed; }
.vp-btn-secondary { background: transparent; color: var(--vp-fg); border-color: var(--vp-border); }
.vp-btn-secondary:hover { background: var(--vp-input-bg); }
.vp-progress { display: flex; align-items: center; gap: 6px; margin: 8px 0; }
.vp-progress-bar { flex: 1; height: 6px; background: var(--vp-progress-track); border-radius: 3px; overflow: hidden; }
.vp-progress-fill { height: 100%; width: 0%; background: var(--vp-progress-fill); transition: width .2s ease; }
.vp-progress-text { font-size: 11px; color: var(--vp-muted); min-width: 50px; text-align: right; white-space: nowrap; }
.vp-grid { display: grid; grid-template-columns: repeat(auto-fill, 160px); gap: 6px; margin-top: 8px; justify-content: start; }
.vp-thumb { display: flex; flex-direction: column; gap: 3px; }
.vp-thumb img, .vp-thumb-failed {
  display: block; width: 100%; aspect-ratio: 16/9;
  background: var(--vp-thumb-failed-bg);
  border-radius: 4px; object-fit: cover;
}
.vp-thumb img { cursor: pointer; }
.vp-thumb-failed {
  display: flex; align-items: center; justify-content: center;
  color: var(--vp-thumb-failed-fg); font-size: 11px;
}
.vp-thumb-time { font-size: 11px; color: var(--vp-muted); text-align: center; }
`;

    const host = document.createElement('div');
    host.id = 'vp-host-root';
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; pointer-events: none; top: 0; left: 0; width: 0; height: 0;';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = PANEL_CSS;
    shadow.appendChild(styleEl);

    const tmpl = document.createElement('template');
    tmpl.innerHTML = PANEL_HTML;
    shadow.appendChild(tmpl.content);

    const $ = id => shadow.getElementById(id);
    const $panel      = $('vp-panel');
    const $resizeBL   = $('vp-resize-bl');
    const $header     = $('vp-header');
    const $body       = $('vp-body');
    const $status     = $('vp-status');
    const $count      = $('vp-count');
    const $skipIntro  = $('vp-skip-intro');
    const $skipOutro  = $('vp-skip-outro');
    const $countDisplay     = $('vp-count-display');
    const $skipIntroDisplay = $('vp-skip-intro-display');
    const $skipOutroDisplay = $('vp-skip-outro-display');
    const $hint       = $('vp-hint');
    const $generate   = $('vp-generate');
    const $progress   = $('vp-progress');
    const $progressFill = $('vp-progress-fill');
    const $progressText = $('vp-progress-text');
    const $cancel     = $('vp-cancel');
    const $grid       = $('vp-grid');
    const $collapse   = $('vp-collapse');
    const $close      = $('vp-close');
    const $mini       = $('vp-mini');
    const $miniIcon   = $('vp-mini-icon');
    const $miniClose  = $('vp-mini-close');


    // ============================================================
    // UI 行为
    // ============================================================
    function applyPanelPosition() {
      if (state.panelPosition) {
        $panel.style.top = state.panelPosition.top + 'px';
        $panel.style.left = state.panelPosition.left + 'px';
        $panel.style.right = 'auto';
      } else {
        $panel.style.top = '20px';
        $panel.style.right = '20px';
        $panel.style.left = 'auto';
      }
    }
    function applyVisibility() {
      if (state.miniHidden || !state.shouldShow) { host.style.display = 'none'; return; }
      host.style.display = '';
      $panel.hidden = !state.panelVisible;
      $mini.hidden = state.panelVisible;
    }
    function applyCollapsed() {
      if (state.panelCollapsed) {
        $body.hidden = true;
        $panel.style.minHeight = '0';
        $panel.style.height = 'auto';
        $collapse.textContent = '+';
      } else {
        $body.hidden = false;
        $panel.style.minHeight = '';
        $panel.style.height = '';
        $collapse.textContent = '−';
      }
    }
    function togglePanel() {
      if (!state.shouldShow) return;
      state.miniHidden = false;
      state.panelVisible = !state.panelVisible;
      applyVisibility();
      savePanelState();
    }
    function setStatus(text, kind) {
      $status.textContent = text;
      $status.dataset.state = kind || '';
    }
    function readSettingsFromInputs() {
      state.settings.count     = parseFloat($count.value)     || 0;
      state.settings.skipIntro = parseFloat($skipIntro.value) || 0;
      state.settings.skipOutro = parseFloat($skipOutro.value) || 0;
    }
    function applySettingsToInputs() {
      $count.value     = state.settings.count;
      $skipIntro.value = state.settings.skipIntro;
      $skipOutro.value = state.settings.skipOutro;
      updateSliderDisplay($count);
      updateSliderDisplay($skipIntro);
      updateSliderDisplay($skipOutro);
    }
    function updateSliderDisplay($el) {
      const $d = $($el.id + '-display');
      if ($d) $d.textContent = $el.value;
    }
    function updateSliderMax() {
      const dur = state.duration;
      if (Number.isFinite(dur) && dur > 0) {
        const durMin = Math.max(1, Math.ceil(dur / 60));
        if ($skipIntro.max != durMin) $skipIntro.max = durMin;
        if ($skipOutro.max != durMin) $skipOutro.max = durMin;
      }
    }
    function refreshValidate() {
      readSettingsFromInputs();
      const { count, skipIntro, skipOutro } = state.settings;
      if (!state.hasVideo) {
        const ok = count > 0;
        $generate.disabled = !ok || state.busy;
        $hint.textContent = state.busy ? '正在生成…' : '请先打开 115 视频页的视频';
        $hint.dataset.state = '';
        return;
      }
      const v = validateInputs(count, skipIntro, skipOutro, state.duration);
      if (!v.ok) {
        $generate.disabled = true;
        $hint.textContent = v.message;
        $hint.dataset.state = 'error';
        return;
      }
      const plan = computePlanByCount(state.duration, count, skipIntro * 60, skipOutro * 60);
      $generate.disabled = state.busy;
      if (plan.count === 0) {
        $hint.textContent = '当前参数下没有可生成的时间点';
      } else if (plan.count < count) {
        $hint.textContent = '预计生成 ' + plan.count + ' 张预览（每隔 ~' + formatTime(plan.interval) + ' 生成 1 张，已按视频长度收紧）';
      } else {
        $hint.textContent = '预计生成 ' + plan.count + ' 张预览（每隔 ~' + formatTime(plan.interval) + ' 生成 1 张）';
      }
      $hint.dataset.state = '';
    }
    function updateProgress(done, total, time) {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      $progressFill.style.width = pct + '%';
      const timeLabel = (typeof time === 'number') ? ' · ' + formatTime(time) : '';
      $progressText.textContent = done + ' / ' + total + timeLabel;
    }
    function setBusy(busy) {
      state.busy = busy;
      $progress.hidden = !busy;
      $generate.textContent = busy ? '生成中…' : '开始生成预览';
      refreshValidate();
    }
    function clearGrid() {
      while ($grid.firstChild) $grid.removeChild($grid.firstChild);
    }

    // ============================================================
    // 视频挑选
    // ============================================================
    function pickMainVideo() {
      const list = Array.from(document.querySelectorAll('video'));
      if (list.length === 0) return null;
      if (list.length === 1) return list[0];
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
      state.hasVideo = !!v;
      state.duration = (v && Number.isFinite(v.duration)) ? v.duration : 0;
      updateSliderMax();
      state.videoCount = document.querySelectorAll('video').length;
      // Freeze shouldShow during capture: the 115 player briefly swaps
      // the <video> element during seeks, which would otherwise make
      // the panel flash on/off as reportStatus() flips shouldShow.
      if (!state.capturing) {
        state.shouldShow = state.hasVideo && state.duration > 0;
      }
      if (state.hasVideo) {
        const dur = formatTime(state.duration);
        const extra = state.videoCount > 1 ? '（共 ' + state.videoCount + ' 个 video，已选主播放器）' : '';
        setStatus('已检测到视频 · 时长 ' + dur + extra, 'ok');
      } else {
        setStatus('未检测到视频，请先打开 115 视频页的视频', 'error');
      }
      refreshValidate();
      applyVisibility();
      if (v && state.duration === 0) armDurationListeners(v);
    }
    function armDurationListeners(v) {
      if (v._vpArmed) return;
      v._vpArmed = true;
      const retry = () => {
        v.removeEventListener('durationchange', retry);
        v.removeEventListener('loadedmetadata', retry);
        v.removeEventListener('canplay', retry);
        v._vpArmed = false;
        reportStatus();
      };
      v.addEventListener('durationchange', retry, { once: true });
      v.addEventListener('loadedmetadata', retry, { once: true });
      v.addEventListener('canplay', retry, { once: true });
      if (!v._vpPoll) {
        let ticks = 0;
        const tick = () => {
          ticks++;
          if (!document.contains(v)) { v._vpPoll = null; return; }
          if (Number.isFinite(v.duration) && v.duration > 0) {
            v._vpPoll = null;
            reportStatus();
            return;
          }
          if (ticks >= 60) { v._vpPoll = null; return; }
          v._vpPoll = setTimeout(tick, 2000);
        };
        v._vpPoll = setTimeout(tick, 1000);
      }
    }

    // ============================================================
    // 单帧截图
    // ============================================================
    function captureFrame(video) {
      return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = THUMB_W;
        canvas.height = THUMB_H;
        const ctx = canvas.getContext('2d');
        try { ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H); }
        catch (e) { reject(new Error('drawImage 失败（可能跨域）: ' + e.message)); return; }
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('toBlob 返回 null')); return; }
          resolve(blob);
        }, 'image/jpeg', QUALITY);
      });
    }
    function seekTo(video, t) {
      return new Promise((resolve, reject) => {
        // Same-position shortcut: browser won't fire 'seeked' for a no-op.
        if (Math.abs(video.currentTime - t) < 0.05 && video.readyState >= 2) {
          waitForRightFrame(video, t, null, () => resolve(), 5);
          return;
        }

        // Epoch token: stale 'seeked' from a previous seekTo can still
        // fire on this listener and resolve us prematurely.
        const epoch = (video._vpSeekEpoch = (video._vpSeekEpoch || 0) + 1);
        let settled = false;
        let backstop = null;
        let timer = null;

        const finish = () => {
          if (settled || epoch !== video._vpSeekEpoch) return;
          settled = true;
          if (backstop) clearTimeout(backstop);
          if (timer) clearTimeout(timer);
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        const fail = (msg) => {
          if (settled) return;
          settled = true;
          if (backstop) clearTimeout(backstop);
          if (timer) clearTimeout(timer);
          video.removeEventListener('seeked', onSeeked);
          reject(new Error(msg));
        };
        function onSeeked() {
          if (epoch !== video._vpSeekEpoch) return; // stale
          waitForRightFrame(video, t, epoch, () => finish(), 5);
          backstop = setTimeout(() => finish(), 800);
        }
        video.addEventListener('seeked', onSeeked, { once: true });
        timer = setTimeout(() => fail('seeked 超时（' + SEEK_TIMEOUT_MS + 'ms）'), SEEK_TIMEOUT_MS);
        try {
          // fastSeek (Chrome) snaps to the nearest keyframe — much faster
          // for far jumps. Fall back to currentTime for older browsers.
          if (typeof video.fastSeek === 'function') {
            video.fastSeek(t);
          } else {
            video.currentTime = t;
          }
        } catch (e) { fail(e.message || String(e)); }
      });
    }

    // Wait for a presented frame whose mediaTime is close to t. Re-arms
    // rVFC up to `attempts` times (~16ms each) to skip past stale frames
    // (e.g. the pre-seek frame still painted on the element). 2x rAF
    // fallback if rVFC is missing. epoch=null disables epoch check (used
    // by the no-op shortcut).
    function waitForRightFrame(video, t, epoch, done, attempts) {
      if (epoch !== null && epoch !== video._vpSeekEpoch) return done();
      if (attempts <= 0) return done();
      if ('requestVideoFrameCallback' in video) {
        try {
          video.requestVideoFrameCallback((_now, metadata) => {
            if (!metadata || Math.abs(metadata.mediaTime - t) < 0.5) {
              done();
            } else {
              waitForRightFrame(video, t, epoch, done, attempts - 1);
            }
          });
          return;
        } catch (_) { /* fall through */ }
      }
      requestAnimationFrame(() => requestAnimationFrame(() => done()));
    }
    function waitIfHidden() {
      if (document.visibilityState !== 'hidden') return Promise.resolve();
      setStatus('已切到其他标签页，切回此页继续…', '');
      return new Promise(resolve => {
        const onVis = () => {
          if (document.visibilityState === 'visible') {
            document.removeEventListener('visibilitychange', onVis);
            setTimeout(() => {
              setStatus('已切回，继续生成…', '');
              resolve();
            }, 300);
          }
        };
        document.addEventListener('visibilitychange', onVis);
      });
    }
    async function runCapture(initialVideo, times) {
      const total = times.length;
      let success = 0, failed = 0;
      // Re-pick the live <video> each iteration. 115's player aggressively
      // mutates the DOM and may replace the element mid-run; a stale ref
      // gives silent no-op seeks and capture failures.
      const v0 = pickMainVideo() || initialVideo;
      const origTime = v0.currentTime;
      const origPaused = v0.paused;

      // Keep the decoder warm. Pausing here cold-starts the decoder and
      // makes the first few far seeks time out (15s+ on the 115 CDN). If
      // the video is paused, briefly play (muted to bypass autoplay) to
      // wake the decoder; otherwise leave it alone.
      if (v0.paused && !v0.ended) {
        const wasMuted = v0.muted;
        v0.muted = true;
        const p = v0.play();
        if (p && typeof p.then === 'function') {
          try { await p; } catch (_) { /* autoplay blocked, ignore */ }
        }
        v0.muted = wasMuted;
      }

      // Freeze panel visibility while we run; the 115 player briefly
      // swaps the <video> element during seeks, which would otherwise
      // cause the panel to flash on/off as reportStatus() flips shouldShow.
      state.capturing = true;
      try {
        for (let i = 0; i < total; i++) {
          if (state.cancelRequested) return { success, failed, cancelled: true };
          await waitIfHidden();
          if (state.cancelRequested) return { success, failed, cancelled: true };
          const t = times[i];
          const video = pickMainVideo();
          if (!video) {
            renderFailedThumb(t);
            failed++;
            updateProgress(i + 1, total, t);
            continue;
          }
          let captured = false;
          for (let attempt = 1; attempt <= 2 && !captured; attempt++) {
            try {
              await seekTo(video, t);
              const blob = await captureFrame(video);
              const url = URL.createObjectURL(blob);
              renderThumb(url, t);
              const probe = new Image();
              probe.onload = () => URL.revokeObjectURL(url);
              probe.src = url;
              success++;
              updateProgress(i + 1, total, t);
              captured = true;
            } catch (e) {
              if (attempt < 2) {
                await new Promise(r => setTimeout(r, 200));
              } else {
                renderFailedThumb(t);
                failed++;
                updateProgress(i + 1, total, t);
              }
            }
          }
        }
      } finally {
        state.capturing = false;
        // Refresh visibility against the current DOM state (in case the
        // <video> was permanently removed during capture).
        reportStatus();
        const vEnd = pickMainVideo() || v0;
        // Pause first for a stable final seek, then restore position
        try { vEnd.pause(); } catch (_) { /* ignore */ }
        try { vEnd.currentTime = origTime; } catch (_) { /* ignore */ }
        if (!origPaused) { try { await vEnd.play(); } catch (_) { /* ignore */ } }
      }
      return { success, failed, cancelled: false };
    }

    // ============================================================
    // 网格渲染
    // ============================================================
    function renderThumb(url, time) {
      const wrap = document.createElement('div');
      wrap.className = 'vp-thumb';
      const img = document.createElement('img');
      img.src = url;
      img.alt = formatTime(time);
      img.title = '点击跳到 ' + formatTime(time) + ' 播放';
      img.addEventListener('click', e => {
        e.stopPropagation();
        const v = pickMainVideo();
        if (!v) return;
        try { v.currentTime = time; } catch (_) { /* ignore */ }
        v.play().catch(() => { /* ignore */ });
      });
      const cap = document.createElement('div');
      cap.className = 'vp-thumb-time';
      cap.textContent = formatTime(time);
      wrap.appendChild(img);
      wrap.appendChild(cap);
      $grid.appendChild(wrap);
    }
    function renderFailedThumb(time) {
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
      $grid.appendChild(wrap);
    }

    // ============================================================

    // ============================================================
    // 拖拽
    // ============================================================
    let dragState = null;
    $header.addEventListener('pointerdown', e => {
      if (e.target.closest('.vp-icon-btn')) return;
      e.preventDefault();
      const rect = $panel.getBoundingClientRect();
      dragState = {
        startX: e.clientX, startY: e.clientY,
        origLeft: rect.left, origTop: rect.top,
        pointerId: e.pointerId,
      };
      $header.setPointerCapture(e.pointerId);
    });
    $header.addEventListener('pointermove', e => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const newLeft = dragState.origLeft + dx;
      const newTop = dragState.origTop + dy;
      const w = $panel.offsetWidth, h = $panel.offsetHeight;
      const maxL = window.innerWidth - w, maxT = window.innerHeight - h;
      $panel.style.left = Math.max(0, Math.min(newLeft, maxL)) + 'px';
      $panel.style.top  = Math.max(0, Math.min(newTop, maxT)) + 'px';
      $panel.style.right = 'auto';
    });
    $header.addEventListener('pointerup', e => {
      if (!dragState) return;
      $header.releasePointerCapture(dragState.pointerId);
      dragState = null;
      state.panelPosition = { left: $panel.offsetLeft, top: $panel.offsetTop };
      savePanelState();
    });

    // ============================================================
    // 左下角 resize（自定义，浏览器原生 resize: both 只支持右下）
    // ============================================================
    $resizeBL.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const rect = $panel.getBoundingClientRect();
      const startLeft = rect.left, startTop = rect.top;
      const startW = rect.width, startH = rect.height;
      $resizeBL.setPointerCapture(e.pointerId);
      const onMove = ev => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let newW = Math.max(360, startW - dx);
        let newLeft = startLeft + (startW - newW);
        let newH = Math.max(36, startH + dy);
        const maxLeft = window.innerWidth - newW;
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        const maxTop = window.innerHeight - newH;
        let newTop = Math.max(0, Math.min(startTop, maxTop));
        newH = Math.min(newH, window.innerHeight - newTop);
        $panel.style.left = newLeft + 'px';
        $panel.style.top = newTop + 'px';
        $panel.style.width = newW + 'px';
        $panel.style.height = newH + 'px';
        $panel.style.right = 'auto';
      };
      const onUp = ev => {
        try { $resizeBL.releasePointerCapture(ev.pointerId); } catch (_) {}
        $resizeBL.removeEventListener('pointermove', onMove);
        $resizeBL.removeEventListener('pointerup', onUp);
        state.panelPosition = { left: $panel.offsetLeft, top: $panel.offsetTop };
        savePanelState();
      };
      $resizeBL.addEventListener('pointermove', onMove);
      $resizeBL.addEventListener('pointerup', onUp);
    });

    // ============================================================
    // 折叠 / 关闭
    // ============================================================
    $collapse.addEventListener('click', e => {
      e.stopPropagation();
      state.panelCollapsed = !state.panelCollapsed;
      applyCollapsed();
      savePanelState();
    });
    $close.addEventListener('click', e => {
      e.stopPropagation();
      state.panelVisible = false;
      clearGrid();
      applyVisibility();
      savePanelState();
    });

    $miniIcon.addEventListener('click', e => {
      e.stopPropagation();
      togglePanel();
    });
    $miniClose.addEventListener('click', e => {
      e.stopPropagation();
      state.miniHidden = true;
      applyVisibility();
      savePanelState();
    });

    // ============================================================
    // 输入联动
    // ============================================================
    [$count, $skipIntro, $skipOutro].forEach($el => {
      $el.addEventListener('input', () => {
        readSettingsFromInputs();
        saveSettings();
        refreshValidate();
        updateSliderDisplay($el);
      });
    });

    // ============================================================
    // 生成按钮
    // ============================================================
    $generate.addEventListener('click', async e => {
      e.stopPropagation();
      if (state.busy || !state.hasVideo) return;
      readSettingsFromInputs();
      saveSettings();
      const { count, skipIntro, skipOutro } = state.settings;
      const v = validateInputs(count, skipIntro, skipOutro, state.duration);
      if (!v.ok) return;
      const plan = computePlanByCount(state.duration, count, skipIntro * 60, skipOutro * 60);
      if (plan.count === 0) return;
      clearGrid();
      state.cancelRequested = false;
      setBusy(true);
      setStatus('正在生成 ' + plan.count + ' 张预览…', '');
      $progressFill.style.width = '0%';
      $progressText.textContent = '0 / ' + plan.count;
      const video = pickMainVideo();
      if (!video) { setBusy(false); setStatus('视频已消失', 'error'); return; }
      try {
        const result = await runCapture(video, plan.times);
        const note = result.failed > 0 ? '（' + result.failed + ' 张失败）' : '';
        setBusy(false);
        if (result.cancelled) {
          setStatus('已取消（已生成 ' + result.success + ' 张）', '');
        } else {
          setStatus('完成 · 成功 ' + result.success + note, result.failed > 0 ? 'error' : 'ok');
        }
      } catch (e) {
        setBusy(false);
        setStatus('生成出错：' + e.message, 'error');
      }
    });

    $cancel.addEventListener('click', e => {
      e.stopPropagation();
      state.cancelRequested = true;
      setStatus('正在取消…', '');
    });

    // ============================================================
    // 启动
    // ============================================================
    loadStorage().then(() => {
      applySettingsToInputs();
      applyPanelPosition();
      applyCollapsed();
      applyVisibility();
      refreshValidate();
    });

    const mo = new MutationObserver(() => {
      if (mo._pending) return;
      mo._pending = true;
      requestAnimationFrame(() => { mo._pending = false; reportStatus(); });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('loadedmetadata', reportStatus, true);

    reportStatus();

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.cmd) return false;
      if (msg.cmd === 'toggle-panel') {
        togglePanel();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });
  }
})();