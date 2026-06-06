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
  function validateInputs(interval, skipIntro, skipOutro, duration) { throw new Error('not implemented'); }
  return { formatTime, computePlan, validateInputs };
}));