const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../public/js/geo.js');

test('Oklahoma North state plane converts to the right place and back', () => {
  // The Grove Phase 1 (south Broken Arrow) drawing coordinates
  const p = G.toLatLng('EPSG:2267', 2629500, 359500);
  assert.ok(Math.abs(p.lat - 35.96670) < 1e-5 && Math.abs(p.lng + 95.76611) < 1e-5);
  assert.ok(G.looksOklahoma(p));
  const [x, y] = G.fromLatLng('EPSG:2267', p.lat, p.lng);
  assert.ok(Math.abs(x - 2629500) < 0.01 && Math.abs(y - 359500) < 0.01);
});

test('local drawing coordinates are flagged as not in Oklahoma', () => {
  assert.equal(G.looksOklahoma(G.toLatLng('EPSG:2267', 5000, 5000)), false);
});
