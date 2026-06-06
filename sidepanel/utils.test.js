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