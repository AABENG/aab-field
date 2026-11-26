const { test } = require('node:test');
const assert = require('node:assert');
const D = require('../public/js/dxf.js');

const dxf = (entities) => ['0', 'SECTION', '2', 'ENTITIES', ...entities.flat(), '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
const line = (layer, x0, y0, x1, y1) => ['0', 'LINE', '8', layer, '10', x0, '20', y0, '11', x1, '21', y1];
const lw = (layer, pts, closed) => ['0', 'LWPOLYLINE', '8', layer, '90', pts.length, '70', closed ? 1 : 0, ...pts.flatMap(([x, y]) => ['10', x, '20', y])];
const ins = (layer, name, x, y) => ['0', 'INSERT', '8', layer, '2', name, '10', x, '20', y];

function read(text, chunk = 7) {
  const r = D.createReader();
  for (let i = 0; i < text.length; i += chunk) r.push(text.slice(i, i + chunk)); // tiny chunks: split mid-line
  return r.finish();
}

test('reads lines, polylines and blocks; skips profile and contour layers', () => {
  const out = read(dxf([
    line('PR-WL-LINE', 0, 0, 100, 0),
    lw('PR-SS-LINE', [[0, 10], [50, 10], [50, 60]], false),
    lw('PR-BNDY', [[0, 0], [10, 0], [10, 10], [0, 10]], true),
    ins('PR-SS-STRUCTURE', 'MH', 50, 10),
    line('ZZ-PROFILE-GRID', 0, 0, 1, 1),
    line('EX-CONT-MAJOR', 0, 0, 1, 1),
    ins('PR-WL-FITTINGS', 'WL-VALV', 0, 0),
  ]));
  const by = (l) => out.entities.filter((e) => e.layer === l);
  assert.equal(D.plen(by('PR-WL-LINE')[0].pts), 100);
  assert.equal(D.plen(by('PR-SS-LINE')[0].pts), 100);
  assert.equal(by('PR-BNDY')[0].closed, true);
  assert.equal(by('PR-SS-STRUCTURE')[0].block, 'MH');
  assert.equal(by('PR-WL-FITTINGS').length, 1, 'FITTINGS must not be mistaken for a TIN layer');
  assert.equal(by('ZZ-PROFILE-GRID').length, 0);
  assert.equal(by('EX-CONT-MAJOR').length, 0);
});

test('area clipping keeps the inside part of a line that crosses the boundary', () => {
  const ring = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
  const A = D.makeArea([ring], 0);
  const parts = A.clip([[-50, 50], [150, 50]]);
  assert.equal(parts.length, 1);
  assert.ok(Math.abs(D.plen(parts[0]) - 100) < 0.01);
  // a curve survives clipping without being straightened
  const arc = D.bulgePoints([[20, 50, 1], [80, 50, 0]], false);
  const kept = A.clip(arc)[0];
  assert.ok(Math.abs(D.plen(kept) - D.plen(arc)) < 0.5);
});

test('double-line pipe collapses to one line down the middle', () => {
  const walls = [[[0, 0], [200, 0]], [[0, 3], [200, 3]], [[0, 0], [200, 0]]];
  const one = D.collapseDouble(walls, 8);
  assert.equal(one.length, 1);
  assert.ok(Math.abs(one[0][0][1] - 1.5) < 0.01);
});

test('centerlines are the stretches midway between curbs', () => {
  const curbs = [[[0, -12], [400, -12]], [[0, 12], [400, 12]]];
  const cand = [[[0, 0], [400, 0]], [[0, 30], [400, 30]]]; // second is a sidewalk-like line
  const cl = D.centerlineParts(cand, curbs);
  assert.equal(cl.length, 1);
  assert.ok(Math.abs(cl[0][0][1]) < 0.01);
  assert.ok(D.plen(cl[0]) > 390);
});

test('structures snap to their line and get a station', () => {
  const [s] = D.snapPoints([[60, 4]], [[[0, 0], [100, 0]]], 10);
  assert.equal(s.line, 0);
  assert.ok(Math.abs(s.station - 60) < 0.01);
  assert.equal(D.snapPoints([[60, 40]], [[[0, 0], [100, 0]]], 10)[0], null);
});
