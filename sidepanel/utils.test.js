const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTime } = require('./utils.js');

test('formatTime: 0 秒 → "0:00"', () => {
  assert.equal(formatTime(0), '0:00');
});

test('formatTime: 45 秒 → "0:45"', () => {
  assert.equal(formatTime(45), '0:45');
});

test('formatTime: 125 秒 → "2:05"', () => {
  assert.equal(formatTime(125), '2:05');
});

test('formatTime: 3599 秒 → "59:59"（不到 1 小时用 mm:ss）', () => {
  assert.equal(formatTime(3599), '59:59');
});

test('formatTime: 3600 秒 → "1:00:00"（满 1 小时切 h:mm:ss）', () => {
  assert.equal(formatTime(3600), '1:00:00');
});

test('formatTime: 3661 秒 → "1:01:01"', () => {
  assert.equal(formatTime(3661), '1:01:01');
});

test('formatTime: 7322 秒 → "2:02:02"', () => {
  assert.equal(formatTime(7322), '2:02:02');
});

test('formatTime: 负数 → "0:00"（健壮性）', () => {
  assert.equal(formatTime(-5), '0:00');
});

test('formatTime: NaN → "0:00"', () => {
  assert.equal(formatTime(NaN), '0:00');
});

const { computePlan } = require('./utils.js');

test('computePlan: 120 分钟视频，间隔 10，跳过 0/0 → 12 张', () => {
  const r = computePlan(120 * 60, 10, 0, 0);
  assert.equal(r.count, 12);
  assert.deepEqual(r.times, [0, 600, 1200, 1800, 2400, 3000, 3600, 4200, 4800, 5400, 6000, 6600]);
});

test('computePlan: 跳过片头 5 分钟 → 第一张从 300 开始', () => {
  const r = computePlan(120 * 60, 10, 5, 0);
  assert.equal(r.count, 11);
  assert.equal(r.times[0], 300);
});

test('computePlan: 跳过片尾 5 分钟 → 最后一张 ≤ duration - 300', () => {
  const r = computePlan(120 * 60, 10, 0, 5);
  assert.equal(r.count, 12);
  assert.ok(r.times[r.times.length - 1] <= 120 * 60 - 5 * 60);
});

test('computePlan: 跳过片头 3 + 跳过片尾 7，间隔 10 → 算 110 分钟 / 10 = 11 张', () => {
  const r = computePlan(120 * 60, 10, 3, 7);
  assert.equal(r.count, 11);
});

test('computePlan: 间隔大于可用区间 → count = 0，times = []', () => {
  const r = computePlan(100, 200, 0, 0);
  assert.equal(r.count, 0);
  assert.deepEqual(r.times, []);
});

test('computePlan: 恰好整除，最后一张等于 duration - skipOutro', () => {
  const r = computePlan(100, 10, 0, 0);
  assert.equal(r.count, 10);
  assert.equal(r.times[9], 90);
});

test('computePlan: 浮点时长同样正确（如 119.5 秒）', () => {
  const r = computePlan(119.5, 10, 0, 0);
  assert.equal(r.count, 12);
  assert.equal(r.times[11], 110);
});