// Content Script（isolated world）
// 唯一职责：找页面的 <video>，按指令截图，通过 runtime 发给 Side Panel。
// 不读 cookie/localStorage，不发网络请求。

(() => {
  'use strict';

  const THUMB_W = 320;
  const THUMB_H = 180;
  const QUALITY = 0.85;
  const SEEK_TIMEOUT_MS = 5000;

  // ===== Blob → dataURL 辅助 =====
  // 因为 chrome.runtime.sendMessage 用 JSON 序列化消息，Blob 会被剥成空对象。
  // 在发送前把 Blob 转成 base64 dataURL 字符串，sidepanel 直接当 img.src 用。
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader 失败'));
      reader.readAsDataURL(blob);
    });
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
    const hasVideo = !!v;
    const duration = (v && Number.isFinite(v.duration)) ? v.duration : 0;
    const count = document.querySelectorAll('video').length;
    try {
      chrome.runtime.sendMessage({
        cmd: 'video-status',
        hasVideo, duration, videoCount: count
      });
    } catch (_) { /* Side Panel 未开时静默 */ }
    // 找到了 video 但 duration 还没就绪（MSE 加密流常见）
    if (v && duration === 0) {
      armDurationListeners(v);
    }
  }

  // duration 一旦有值就重报一次
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
    // 兜底：老版播放器可能不发这些事件，每 2 秒轮询一次
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
        if (ticks >= 60) { v._vpPoll = null; return; }  // 最多 2 分钟
        v._vpPoll = setTimeout(tick, 2000);
      };
      v._vpPoll = setTimeout(tick, 1000);
    }
  }

  // ===== DOM 监听 =====
  const mo = new MutationObserver(() => {
    if (mo._pending) return;
    mo._pending = true;
    requestAnimationFrame(() => {
      mo._pending = false;
      reportStatus();
    });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  reportStatus();
  document.addEventListener('loadedmetadata', reportStatus, true);

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
        if (!blob) {
          reject(new Error('toBlob 返回 null'));
          return;
        }
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

  // ===== 采集循环 =====
  let cancelRequested = false;
  function resetCancel() { cancelRequested = false; }
  function requestCancel() { cancelRequested = true; }

  async function runCapture(video, times, onProgress) {
    const total = times.length;
    let success = 0;
    let failed = 0;
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
      try { video.currentTime = origTime; } catch (_) { /* ignore */ }
      if (!origPaused) {
        try { await video.play(); } catch (_) { /* ignore */ }
      }
    }
    return { success, failed, cancelled: false };
  }

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
      // times 由 Side Panel 用 utils.computePlanByCount 算好传入，content script 不重复计算
      if (!Array.isArray(msg.times)) {
        sendResponse({ ok: false, error: 'missing-times' });
        return false;
      }
      resetCancel();
      sendResponse({ ok: true, total: msg.times.length });

      runCapture(video, msg.times, async (p) => {
        try {
          // 无论成败都先发 progress（更新进度数字+当前时间）
          chrome.runtime.sendMessage({
            cmd: 'progress', done: p.done, total: p.total, time: p.time, error: p.error || null
          });
          // 成功时再发 thumb：先把 blob 转 dataURL
          if (p.ok) {
            const dataURL = await blobToDataURL(p.blob);
            chrome.runtime.sendMessage({ cmd: 'thumb', time: p.time, dataURL });
          }
        } catch (_) { /* Side Panel 关了 */ }
      }).then((result) => {
        try {
          if (result.cancelled) {
            chrome.runtime.sendMessage({ cmd: 'cancelled' });
          } else {
            chrome.runtime.sendMessage({
              cmd: 'done', success: result.success, failed: result.failed
            });
          }
        } catch (_) { /* ignore */ }
      }).catch((e) => {
        try { chrome.runtime.sendMessage({ cmd: 'error', message: e.message }); } catch (_) {}
      });
      return false;
    }

    if (msg.cmd === 'cancel') {
      requestCancel();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  window.addEventListener('pagehide', () => {
    try { chrome.runtime.sendMessage({ cmd: 'aborted' }); } catch (_) { /* ignore */ }
  });
})();