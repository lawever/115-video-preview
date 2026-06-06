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

  // count-based: 用户指定想生成 N 张图，函数算出 interval 和 times
  // 语义：interval = floor(active / count)，点位置 start + i*interval（i 从 0 到 count-1）
  // 例：2h 视频，count=12，skip=0/0 → interval=600s，点 0:00, 10:00, ..., 1:50:00
  function computePlanByCount(duration, count, skipIntro, skipOutro) {
    const start = Math.max(0, skipIntro);
    const end = Math.max(start, duration - Math.max(0, skipOutro));
    const active = end - start;
    if (count <= 0 || active <= 0) {
      return { count: 0, times: [], interval: 0 };
    }
    // 实际能放下的点数：active 秒最多 active 张（每张 1 秒间隔）
    const actualCount = Math.min(count, active);
    const interval = Math.floor(active / actualCount);
    if (interval <= 0) {
      return { count: 0, times: [], interval: 0 };
    }
    const times = [];
    for (let i = 0; i < actualCount; i++) {
      times.push(start + i * interval);
    }
    return { count: actualCount, times, interval };
  }

  // 校验用户输入
  function validateInputs(count, skipIntro, skipOutro, duration) {
    if (!Number.isFinite(duration) || duration <= 0) {
      return { ok: false, message: '视频时长无效' };
    }
    if (!Number.isFinite(count) || count <= 0) {
      return { ok: false, message: '生成数量必须大于 0' };
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

  return { formatTime, computePlanByCount, validateInputs };
}));