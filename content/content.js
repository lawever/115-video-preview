// Content Script（isolated world）
// 唯一职责：找页面的 <video>，按指令截图，通过 runtime 发给 Side Panel。
// 不读 cookie/localStorage，不发网络请求。

(() => {
  'use strict';

  const THUMB_W = 320;
  const THUMB_H = 180;
  const QUALITY = 0.85;
  const SEEK_TIMEOUT_MS = 5000;

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

  // ===== Blob \u2192 dataURL \u8f85\u52a9 =====
  // \u56e0\u4e3a chrome.runtime.sendMessage \u7528 JSON \u5e8f\u5217\u5316\u6d88\u606f\uff0cBlob \u4f1a\u88ab\u5265\u6210\u7a7a\u5bf9\u8c61\u3002
  // \u5728\u53d1\u9001\u524d\u628a Blob \u8f6c\u6210 base64 dataURL \u5b57\u7b26\u4e32\uff0csidepanel \u76f4\u63a5\u5f53 img.src \u7528\u3002
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader \u5931\u8d25'));
      reader.readAsDataURL(blob);
    });
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
      // interval/skipIntro/skipOutro 由 Side Panel 端校验并预算好 times，本端只消费 times
      if (!Array.isArray(msg.times)) {
        sendResponse({ ok: false, error: 'missing-times' });
        return false;
      }
      resetCancel();
      sendResponse({ ok: true, total: msg.times.length });

      runCapture(video, msg.times, async (p) => {
        try {
          // \u65e0\u8bba\u6210\u8d25\u90fd\u5148\u53d1 progress\uff08\u66f4\u65b0\u8fdb\u5ea6\u6570\u5b57+\u5f53\u524d\u65f6\u95f4\uff09
          chrome.runtime.sendMessage({
            cmd: 'progress', done: p.done, total: p.total, time: p.time, error: p.error || null
          });
          // \u6210\u529f\u65f6\u518d\u53d1 thumb\uff1a\u5148\u628a blob \u8f6c dataURL\uff08chrome.runtime.sendMessage \u662f JSON \u5e8f\u5217\u5316\uff0cblob \u4f1a\u4e22\uff09
          if (p.ok) {
            const dataURL = await blobToDataURL(p.blob);
            chrome.runtime.sendMessage({ cmd: 'thumb', time: p.time, dataURL });
          }
        } catch (_) { /* Side Panel \u5173\u4e86 */ }
      }).then((result) => {
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