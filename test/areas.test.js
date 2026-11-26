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

test('clearing is cut to the limits of clearing', () => {
  const limits = [sq(0, 0, 100)];
  assert.ok(Math.abs(A.unionSqft([sq(50, 50, 100)], null, limits) - 2500) < 30);   // only the overlap counts
  assert.ok(Math.abs(A.unionSqft([sq(-50, -50, 300)], null, limits) - 10000) < 50); // can't exceed the limits
  assert.ok(Math.abs(A.unionSqft([sq(10, 10, 20)], null, [sq(0, 0, 100), sq(500, 0, 50)]) - 400) < 10);
});

test('limits drawn in pieces are joined into a closed area', () => {
  const pieces = [[[0, 0], [100, 0]], [[100, 100], [100, 0]], [[100, 100], [0, 100], [0, 0.4]], [[500, 500], [600, 500]]];
  const rings = A.stitchRings(pieces);
  assert.equal(rings.length, 1);
  assert.ok(Math.abs(A.sqft(rings[0]) - 10000) < 50);
});
