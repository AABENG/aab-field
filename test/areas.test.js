const { test } = require('node:test');
const assert = require('node:assert');
const A = require('../public/js/areas');
const sq = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

test('polygon area', () => {
  assert.equal(A.sqft(sq(0, 0, 100)), 10000);
  assert.equal(A.sqft([[0, 0], [100, 0], [0, 100]]), 5000);
});

test('overlapping areas are only counted once', () => {
  const u = A.unionSqft([sq(0, 0, 100), sq(50, 50, 100)]); // 10000 + 10000 - 2500
  assert.ok(Math.abs(u - 17500) < 50, u);
  assert.ok(Math.abs(A.unionSqft([sq(0, 0, 100), sq(10, 10, 20)]) - 10000) < 30);
  assert.ok(Math.abs(A.unionSqft([[[0, 0], [400, 0], [0, 300]]]) - 60000) < 200);
  assert.ok(Math.abs(A.acres(A.unionSqft([sq(0, 0, 208.71)])) - 1) < 0.01);
});

test('point inside', () => {
  assert.ok(A.inside(sq(0, 0, 10), 5, 5));
  assert.ok(!A.inside(sq(0, 0, 10), 15, 5));
});
