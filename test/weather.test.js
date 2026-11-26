const { test } = require('node:test');
const assert = require('node:assert');
const { rain24 } = require('../src/weather');

const hours = (startUtc, n, f) => Array.from({ length: n }, (_, i) => ({
  valid_utc: new Date(Date.parse(startUtc) + i * 3600e3).toISOString().slice(0, 16) + 'Z', hourly_precip_in: f(i) }));

test('24-hour rain sums only the hours before check-in', () => {
  const recs = hours('2026-11-19T06:00Z', 48, (i) => (i === 10 || i === 30 ? 0.25 : i === 40 ? 1 : 0));
  // check-in 8:00 AM CST Nov 20 = 14:00Z; window 14:00Z Nov 19 .. 14:00Z Nov 20 -> hours i=9..32
  assert.equal(rain24(recs, new Date('2026-11-20T14:00:00Z')), 0.5);
});

test('not posted yet gives no number rather than zero', () => {
  const recs = hours('2026-11-19T06:00Z', 30, () => null);
  assert.equal(rain24(recs, new Date('2026-11-20T14:00:00Z')), null);
});
