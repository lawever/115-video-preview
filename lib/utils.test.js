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

const { computePlanByCount } = require('./utils.js');

// 参数全以**秒**为单位
const MIN = 60;

test('computePlanByCount: 2h 视频 count=12 → 12 张, interval=600s', () => {
  const r = computePlanByCount(120 * MIN, 12, 0, 0);
  assert.equal(r.count, 12);
  assert.equal(r.interval, 600);
  assert.deepEqual(r.times, [0, 600, 1200, 1800, 2400, 3000, 3600, 4200, 4800, 5400, 6000, 6600]);
});

test('computePlanByCount: 2h 视频 count=12, skip 5/0 → 12 张, interval=floor(6900/12)=575', () => {
  // 6900/12 = 575，floor=575
  const r = computePlanByCount(120 * MIN, 12, 5 * MIN, 0);
  assert.equal(r.count, 12);
  assert.equal(r.interval, 575);
  assert.equal(r.times[0], 300);
});

test('computePlanByCount: 2h 视频 count=12, skip 0/5 → 12 张, interval=575, 末位 300+11*575=6625', () => {
  const r = computePlanByCount(120 * MIN, 12, 0, 5 * MIN);
  assert.equal(r.count, 12);
  assert.equal(r.interval, 575);
  assert.equal(r.times[11], 0 + 11 * 575);
});

test('computePlanByCount: 2h 视频 count=12, skip 3/7 → 12 张, interval=floor(6600/12)=550', () => {
  const r = computePlanByCount(120 * MIN, 12, 3 * MIN, 7 * MIN);
  assert.equal(r.count, 12);
  assert.equal(r.interval, 550);
  assert.equal(r.times[0], 180);
});

test('computePlanByCount: count=0 → 空计划', () => {
  const r = computePlanByCount(120 * MIN, 0, 0, 0);
  assert.equal(r.count, 0);
  assert.deepEqual(r.times, []);
});

test('computePlanByCount: 100s 视频 count=10 → 10 张, interval=10', () => {
  const r = computePlanByCount(100, 10, 0, 0);
  assert.equal(r.count, 10);
  assert.equal(r.interval, 10);
  assert.equal(r.times[9], 90);
});

test('computePlanByCount: 100s 视频 count=200 → 实际只能放 100 张（active=100）', () => {
  const r = computePlanByCount(100, 200, 0, 0);
  assert.equal(r.count, 100);
  assert.equal(r.interval, 1);
  assert.equal(r.times[99], 99);
});

test('computePlanByCount: 30s 视频 count=12 → 实际 12 张, interval=floor(30/12)=2', () => {
  const r = computePlanByCount(30, 12, 0, 0);
  assert.equal(r.count, 12);
  assert.equal(r.interval, 2);
  assert.equal(r.times[0], 0);
  assert.equal(r.times[11], 22);
});

test('computePlanByCount: skipIntro+skipOutro ≥ duration → 空计划', () => {
  const r = computePlanByCount(100, 10, 60, 60);
  assert.equal(r.count, 0);
});

const { validateInputs } = require('./utils.js');

test('validateInputs: 合法输入 → ok=true', () => {
  const r = validateInputs(12, 0, 0, 7200);
  assert.equal(r.ok, true);
  assert.equal(r.message, '');
});

test('validateInputs: count=0 → ok=false', () => {
  const r = validateInputs(0, 0, 0, 7200);
  assert.equal(r.ok, false);
  assert.match(r.message, /生成数量/);
});

test('validateInputs: count 负数 → ok=false', () => {
  const r = validateInputs(-5, 0, 0, 7200);
  assert.equal(r.ok, false);
});

test('validateInputs: skipIntro 负数 → ok=false', () => {
  const r = validateInputs(12, -1, 0, 7200);
  assert.equal(r.ok, false);
});

test('validateInputs: skipOutro 负数 → ok=false', () => {
  const r = validateInputs(12, 0, -1, 7200);
  assert.equal(r.ok, false);
});

test('validateInputs: skipIntro + skipOutro ≥ duration → ok=false', () => {
  const r = validateInputs(12, 60, 60, 120);
  assert.equal(r.ok, false);
  assert.match(r.message, /跳过/);
});

test('validateInputs: skipIntro + skipOutro == duration → ok=false', () => {
  const r = validateInputs(12, 60, 60, 120);
  assert.equal(r.ok, false);
});

test('validateInputs: count 非整数（如 12.5）也接受', () => {
  const r = validateInputs(12.5, 0, 0, 7200);
  assert.equal(r.ok, true);
});

test('validateInputs: duration 0 → ok=false', () => {
  const r = validateInputs(12, 0, 0, 0);
  assert.equal(r.ok, false);
});