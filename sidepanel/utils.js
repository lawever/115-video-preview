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
  // count = floor(usable / interval)，点位置 start + i*step（i 从 0 到 count-1）
  // 语义：active 范围内能放下多少个"完整 interval 间隔"的点，floor 避免最后一点紧贴视频末尾
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
  function validateInputs(interval, skipIntro, skipOutro, duration) { throw new Error('not implemented'); }
  return { formatTime, computePlan, validateInputs };
}));