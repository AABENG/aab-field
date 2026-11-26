const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../src/progress');

const row = (date, track, from, to, line_id = 1) => ({ date, line_id, track, from, to });

test('curb must sit on subgrade done by that day', () => {
  assert.deepEqual(P.orderProblems([row('2026-11-16', 'sg', 0, 100), row('2026-11-17', 'cb', 0, 100)], true), []);
  const p = P.orderProblems([row('2026-11-16', 'sg', 0, 100), row('2026-11-17', 'cb', 0, 150)], true);
  assert.equal(p.length, 1); assert.equal(p[0].needs, 'sg'); assert.equal(p[0].ft, 50);
  // subgrade logged on a later day doesn't count for earlier curb
  assert.equal(P.orderProblems([row('2026-11-18', 'sg', 0, 100), row('2026-11-17', 'cb', 0, 100)], true).length, 1);
});

test('paving needs curb, or subgrade when the project has no curb', () => {
  const rows = [row('2026-11-16', 'sg', 0, 100), row('2026-11-17', 'pv', 0, 100)];
  assert.equal(P.orderProblems(rows, true).length, 1);
  assert.equal(P.orderProblems(rows, false).length, 0);
});

test('utility lines have no order rules; other lines are separate', () => {
  assert.deepEqual(P.orderProblems([row('2026-11-16', 'line', 0, 500)], true), []);
  assert.equal(P.orderProblems([row('2026-11-16', 'sg', 0, 100, 1), row('2026-11-17', 'cb', 0, 100, 2)], true).length, 1);
});

test('unions never double count', () => {
  assert.equal(P.len(P.union([[0, 50], [40, 100], [100, 120]])), 120);
});
