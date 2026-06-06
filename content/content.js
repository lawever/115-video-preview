// Content Script（isolated world）
// 职责：在 115 视频页内注入浮窗面板（Shadow DOM 隔离样式），检测 <video>，按指定时间点截图并展示。
// 浮窗默认在右上角，可拖拽、折叠、关闭（工具栏图标再开）。

(async () => {
  'use strict';

  if (window.__vpInjected || document.getElementById('vp-host-root')) return;
  window.__vpInjected = true;

  // ===== 常量 =====
  const THUMB_W = 320;
  const THUMB_H = 180;
  const QUALITY = 0.85;
  const SEEK_TIMEOUT_MS = 5000;

  // ===== 加载 utils.js（fetch + eval，同源扩展 URL）=====
  let utils;
  try {
    const code = await fetch(chrome.runtime.getURL('sidepanel/utils.js')).then(r => r.text());
    (0, eval)(code);
    utils = window.VP;
    if (!utils) throw new Error('utils 未暴露 window.VP');
  } catch (e) {
    console.error('[115VP] 加载 utils 失败', e);
    return;
  }
  const { formatTime, computePlanByCount, validateInputs } = utils;

  // ===== 加载 CSS =====
  let cssText = '';
  try {
    cssText = await fetch(chrome.runtime.getURL('content/panel.css')).then(r => r.text());
  } catch (e) {
    console.error('[115VP] 加载 CSS 失败', e);
    return;
  }

  // ===== 状态 =====
  const state = {
    hasVideo: false,
    duration: 0,
    videoCount: 0,
    busy: false,
    cancelRequested: false,
    settings: { count: 12, skipIntro: 0, skipOutro: 0 },
    panelVisible: true,
    panelCollapsed: false,
    panelPosition: null,  // {left, top} | null（拖拽后才有）
  };

  // ===== 持久化 =====
  function loadStorage() {
    return new Promise(resolve => {
      chrome.storage.local.get([
        'vp.settings', 'vp.panelVisible', 'vp.panelCollapsed', 'vp.panelPosition'
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
    });
  }

  // ===== Shadow DOM 注入 =====
  const PANEL_HTML = `
<div class="vp-panel" id="vp-panel">
  <div class="vp-header" id="vp-header">
    <span class="vp-title">● 115 视频预览</span>
    <span class="vp-version">v0.3.0</span>
    <span class="vp-spacer"></span>
    <button class="vp-icon-btn" id="vp-collapse" title="折叠/展开" type="button">−</button>
    <button class="vp-icon-btn" id="vp-close" title="关闭（工具栏图标再开）" type="button">×</button>
  </div>
  <div class="vp-body" id="vp-body">
    <div class="vp-status" id="vp-status" data-state="loading">正在检测视频…</div>
    <div class="vp-fields">
      <label class="vp-field">
        <span>数量</span>
        <input type="number" id="vp-count" min="1" step="1" value="12">
      </label>
      <label class="vp-field">
        <span>片头（分）</span>
        <input type="number" id="vp-skip-intro" min="0" step="0.1" value="0">
      </label>
      <label class="vp-field">
        <span>片尾（分）</span>
        <input type="number" id="vp-skip-outro" min="0" step="0.1" value="0">
      </label>
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
</div>
<div class="vp-lightbox" id="vp-lightbox" hidden>
  <img class="vp-lightbox-img" id="vp-lightbox-img" alt="">
  <span class="vp-lightbox-time" id="vp-lightbox-time"></span>
  <span class="vp-lightbox-hint">点击空白处或按 Esc 关闭</span>
</div>
`;

  const host = document.createElement('div');
  host.id = 'vp-host-root';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; pointer-events: none; top: 0; left: 0; width: 0; height: 0;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = cssText;
  shadow.appendChild(styleEl);

  const tmpl = document.createElement('template');
  tmpl.innerHTML = PANEL_HTML;
  shadow.appendChild(tmpl.content);

  // 缓存 DOM
  const $ = id => shadow.getElementById(id);
  const $panel      = $('vp-panel');
  const $header     = $('vp-header');
  const $body       = $('vp-body');
  const $status     = $('vp-status');
  const $count      = $('vp-count');
  const $skipIntro  = $('vp-skip-intro');
  const $skipOutro  = $('vp-skip-outro');
  const $hint       = $('vp-hint');
  const $generate   = $('vp-generate');
  const $progress   = $('vp-progress');
  const $progressFill = $('vp-progress-fill');
  const $progressText = $('vp-progress-text');
  const $cancel     = $('vp-cancel');
  const $grid       = $('vp-grid');
  const $collapse   = $('vp-collapse');
  const $close      = $('vp-close');
  const $lightbox     = $('vp-lightbox');
  const $lightboxImg  = $('vp-lightbox-img');
  const $lightboxTime = $('vp-lightbox-time');

  // ===== UI 行为 =====
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
    host.style.display = state.panelVisible ? '' : 'none';
  }
  function applyCollapsed() {
    if (state.panelCollapsed) {
      $body.hidden = true;
      $collapse.textContent = '+';
    } else {
      $body.hidden = false;
      $collapse.textContent = '−';
    }
  }
  function togglePanel() {
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
      $hint.textContent = '预计生成 ' + plan.count + ' 张预览（每 ~' +
        formatTime(plan.interval) + ' 一张，已按视频长度收紧）';
    } else {
      $hint.textContent = '预计生成 ' + plan.count + ' 张预览（每 ~' +
        formatTime(plan.interval) + ' 一张）';
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

  // ===== 视频挑选 =====
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
    state.videoCount = document.querySelectorAll('video').length;
    if (state.hasVideo) {
      const dur = formatTime(state.duration);
      const extra = state.videoCount > 1 ? '（共 ' + state.videoCount + ' 个 video，已选主播放器）' : '';
      setStatus('已检测到视频 · 时长 ' + dur + extra, 'ok');
    } else {
      setStatus('未检测到视频，请先打开 115 视频页的视频', 'error');
    }
    refreshValidate();
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

  // ===== 单帧截图 =====
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
        if (!blob) { reject(new Error('toBlob 返回 null')); return; }
        resolve(blob);
      }, 'image/jpeg', QUALITY);
    });
  }
  function seekTo(video, t) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        reject(new Error('seeked 超时（' + SEEK_TIMEOUT_MS + 'ms）'));
      }, SEEK_TIMEOUT_MS);
      function onSeeked() {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
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
  async function runCapture(video, times) {
    const total = times.length;
    let success = 0;
    let failed = 0;
    const origTime = video.currentTime;
    const origPaused = video.paused;
    video.pause();
    try {
      for (let i = 0; i < total; i++) {
        if (state.cancelRequested) return { success, failed, cancelled: true };
        const t = times[i];
        try {
          await seekTo(video, t);
          const blob = await captureFrame(video);
          const url = URL.createObjectURL(blob);
          renderThumb(url, t);
          // 释放 URL：等 img onload 后再回收
          const tempImg = new Image();
          tempImg.onload = () => URL.revokeObjectURL(url);
          tempImg.src = url;
          success++;
          updateProgress(i + 1, total, t);
        } catch (e) {
          renderFailedThumb(t);
          failed++;
          updateProgress(i + 1, total, t);
        }
      }
    } finally {
      try { video.currentTime = origTime; } catch (_) { /* ignore */ }
      if (!origPaused) {
        try { await video.play(); } catch (_) { /* ignore */ }
      }
    }
    return { success, failed, cancelled: false };
  }

  // ===== 网格渲染 =====
  function renderThumb(url, time) {
    const wrap = document.createElement('div');
    wrap.className = 'vp-thumb';
    const img = document.createElement('img');
    img.src = url;
    img.alt = formatTime(time);
    img.title = '点击查看大图 · ' + formatTime(time);
    img.addEventListener('click', e => { e.stopPropagation(); openLightbox(url, time); });
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

  // ===== Lightbox =====
  function openLightbox(url, time) {
    $lightboxImg.src = url;
    $lightboxTime.textContent = formatTime(time);
    $lightbox.hidden = false;
  }
  function closeLightbox() {
    $lightbox.hidden = true;
    $lightboxImg.src = '';
  }
  $lightbox.addEventListener('click', e => {
    if (e.target === $lightbox) closeLightbox();
  });

  // ===== 拖拽 =====
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

  // ===== 折叠 / 关闭 =====
  $collapse.addEventListener('click', e => {
    e.stopPropagation();
    state.panelCollapsed = !state.panelCollapsed;
    applyCollapsed();
    savePanelState();
  });
  $close.addEventListener('click', e => {
    e.stopPropagation();
    state.panelVisible = false;
    applyVisibility();
    savePanelState();
  });

  // ===== 输入联动 =====
  [$count, $skipIntro, $skipOutro].forEach($el => {
    $el.addEventListener('input', () => {
      readSettingsFromInputs();
      saveSettings();
      refreshValidate();
    });
  });

  // ===== 生成按钮 =====
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
    if (!video) {
      setBusy(false);
      setStatus('视频已消失', 'error');
      return;
    }
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

  // ===== 取消按钮 =====
  $cancel.addEventListener('click', e => {
    e.stopPropagation();
    state.cancelRequested = true;
    setStatus('正在取消…', '');
  });

  // ===== 启动 =====
  await loadStorage();
  applySettingsToInputs();
  applyPanelPosition();
  applyCollapsed();
  applyVisibility();
  refreshValidate();

  // DOM 监听
  const mo = new MutationObserver(() => {
    if (mo._pending) return;
    mo._pending = true;
    requestAnimationFrame(() => { mo._pending = false; reportStatus(); });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('loadedmetadata', reportStatus, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$lightbox.hidden) closeLightbox();
  });
  reportStatus();

  // 接收后台工具栏图标点击
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.cmd) return false;
    if (msg.cmd === 'toggle-panel') {
      togglePanel();
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
})();