// Side Panel 主脚本
// 依赖：window.VP（utils.js 提供）

(() => {
  'use strict';

  const { formatTime, computePlanByCount, validateInputs } = window.VP;
  const STORAGE_KEY = 'vp.settings';

  // ===== DOM =====
  const $status       = document.getElementById('vp-status');
  const $count        = document.getElementById('vp-count');
  const $skipIntro    = document.getElementById('vp-skip-intro');
  const $skipOutro    = document.getElementById('vp-skip-outro');
  const $hint         = document.getElementById('vp-hint');
  const $generate     = document.getElementById('vp-generate');
  const $progress     = document.getElementById('vp-progress');
  const $progressFill = document.getElementById('vp-progress-fill');
  const $progressText = document.getElementById('vp-progress-text');
  const $cancel       = document.getElementById('vp-cancel');
  const $grid         = document.getElementById('vp-grid');
  const $lightbox     = document.getElementById('vp-lightbox');
  const $lightboxImg  = document.getElementById('vp-lightbox-img');
  const $lightboxTime = document.getElementById('vp-lightbox-time');

  // ===== 状态 =====
  const state = {
    hasVideo: false,
    duration: 0,
    videoCount: 0,
    busy: false,
    settings: { count: 12, skipIntro: 0, skipOutro: 0 }
  };

  // ===== 持久化 =====
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      // 只接受新 schema（count + skipIntro + skipOutro），旧 interval 字段被忽略
      if (Number.isFinite(obj.count)) state.settings.count = obj.count;
      if (Number.isFinite(obj.skipIntro)) state.settings.skipIntro = obj.skipIntro;
      if (Number.isFinite(obj.skipOutro)) state.settings.skipOutro = obj.skipOutro;
    } catch (_) { /* ignore */ }
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings)); } catch (_) {}
  }
  function applySettingsToInputs() {
    $count.value     = state.settings.count;
    $skipIntro.value = state.settings.skipIntro;
    $skipOutro.value = state.settings.skipOutro;
  }
  function readSettingsFromInputs() {
    state.settings.count     = parseFloat($count.value)     || 0;
    state.settings.skipIntro = parseFloat($skipIntro.value) || 0;
    state.settings.skipOutro = parseFloat($skipOutro.value) || 0;
  }

  // ===== 校验 + 计划 =====
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
      // 用户要的太多，实际只能放 plan.count 张
      $hint.textContent = '预计生成 ' + plan.count + ' 张预览（每 ~' +
        formatTime(plan.interval) + ' 一张，已按视频长度收紧）';
    } else {
      $hint.textContent = '预计生成 ' + plan.count + ' 张预览（每 ~' +
        formatTime(plan.interval) + ' 一张）';
    }
    $hint.dataset.state = '';
  }

  // ===== 进度更新 =====
  function updateProgress(done, total, time) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    $progressFill.style.width = pct + '%';
    const timeLabel = (typeof time === 'number') ? ' · ' + formatTime(time) : '';
    $progressText.textContent = done + ' / ' + total + timeLabel;
  }

  // ===== 状态机 =====
  function setBusy(busy) {
    state.busy = busy;
    $progress.hidden = !busy;
    $generate.textContent = busy ? '生成中…' : '开始生成预览';
    refreshValidate();
  }
  function setStatus(text, kind) {
    $status.textContent = text;
    $status.dataset.state = kind || '';
  }
  function clearGrid() {
    while ($grid.firstChild) $grid.removeChild($grid.firstChild);
  }

  // ===== 网格渲染 =====
  function renderThumb(dataURL, time) {
    const wrap = document.createElement('div');
    wrap.className = 'vp-thumb';
    const img = document.createElement('img');
    img.src = dataURL;
    img.alt = formatTime(time);
    img.title = '点击查看大图 · ' + formatTime(time);
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', () => openLightbox(dataURL, time));
    img.addEventListener('error', () => {
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

  // ===== Lightbox =====
  function openLightbox(dataURL, time) {
    $lightboxImg.src = dataURL;
    $lightboxTime.textContent = formatTime(time);
    $lightbox.hidden = false;
  }
  function closeLightbox() {
    $lightbox.hidden = true;
    $lightboxImg.src = '';
  }
  $lightbox.addEventListener('click', (e) => {
    // 点 img 本身不关（让用户能拖动看大图），点 backdrop 才关
    if (e.target === $lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$lightbox.hidden) closeLightbox();
  });

  // ===== 工具 =====
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // ===== 输入联动 =====
  [$count, $skipIntro, $skipOutro].forEach($el => {
    $el.addEventListener('input', () => {
      readSettingsFromInputs();
      saveSettings();
      refreshValidate();
    });
  });

  // ===== 取消 =====
  $cancel.addEventListener('click', async () => {
    if (!state.busy) return;
    setStatus('正在取消…', '');
    try {
      const tab = await getActiveTab();
      await chrome.tabs.sendMessage(tab.id, { cmd: 'cancel' });
    } catch (_) { /* ignore */ }
  });

  // ===== 生成 =====
  $generate.addEventListener('click', async () => {
    if (state.busy || !state.hasVideo) return;
    readSettingsFromInputs();
    saveSettings();
    const { count, skipIntro, skipOutro } = state.settings;
    const v = validateInputs(count, skipIntro, skipOutro, state.duration);
    if (!v.ok) return;

    const plan = computePlanByCount(state.duration, count, skipIntro * 60, skipOutro * 60);
    if (plan.count === 0) return;

    clearGrid();
    setBusy(true);
    setStatus('正在生成 ' + plan.count + ' 张预览…', '');
    $progressFill.style.width = '0%';
    $progressText.textContent = '0 / ' + plan.count;

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

  // ===== 接收 content 推送 =====
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.cmd) return;
    if (msg.cmd === 'video-status') {
      state.hasVideo = !!msg.hasVideo;
      state.duration = Number.isFinite(msg.duration) ? msg.duration : 0;
      state.videoCount = msg.videoCount || 0;
      if (state.hasVideo) {
        const dur = formatTime(state.duration);
        const extra = state.videoCount > 1 ? '（共 ' + state.videoCount + ' 个 video，已选主播放器）' : '';
        setStatus('已检测到视频 · 时长 ' + dur + extra, 'ok');
      } else {
        setStatus('未检测到视频，请先打开 115 视频页的视频', 'error');
      }
      refreshValidate();
    } else if (msg.cmd === 'progress') {
      updateProgress(msg.done, msg.total, msg.time);
    } else if (msg.cmd === 'thumb') {
      renderThumb(msg.dataURL, msg.time);
    } else if (msg.cmd === 'done') {
      setBusy(false);
      $progressFill.style.width = '100%';
      $progressText.textContent = msg.success + ' / ' + (msg.success + msg.failed);
      const note = msg.failed > 0 ? '（' + msg.failed + ' 张失败）' : '';
      setStatus('完成 · 成功 ' + msg.success + note, msg.failed > 0 ? 'error' : 'ok');
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

  // ===== 启动 =====
  loadSettings();
  applySettingsToInputs();
  refreshValidate();

  (async () => {
    try {
      const tab = await getActiveTab();
      await chrome.tabs.sendMessage(tab.id, { cmd: 'ping' });
    } catch (_) { /* 还没注入，忽略 */ }
  })();
})();