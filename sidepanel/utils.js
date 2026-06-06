(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    root.VP = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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
  // count = floor(usable / interval)，点位置 start + i*step
  function computePlan(duration, interval, skipIntro, skipOutro) {
    const start = Math.max(0, skipIntro);
    const end = Math.max(start, duration - Math.max(0, skipOutro));
    const step = interval;
    if (step <= 0 || end <= start) {
      return { count: 0, times: [] };
    }
    const usable = end - start;
    const count = Math.floor(usable / step);
    if (count <= 0) return { count: 0, times: [] };
    const times = [];
    for (let i = 0; i < count; i++) {
      times.push(start + i * step);
    }
    return { count, times };
  }
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
  return { formatTime, computePlan, validateInputs };
}));