const { test } = require('node:test');
const assert = require('node:assert');
const { plan } = require('../src/aerial');

test('aerial image: the design sits centered and inside the picture, north up', () => {
  // ~1,800 x 1,200 ft site in Oklahoma North state plane (Broken Arrow area)
  const bb = [2620000, 400000, 2621800, 401200];
  const pl = plan('EPSG:2267', bb, 712 / 428);
  assert.ok(pl && pl.zoom >= 15 && pl.zoom <= 19, 'reasonable zoom');
  const [cx, cy] = pl.toFrac((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2);
  assert.ok(Math.abs(cx - 0.5) < 1e-6 && Math.abs(cy - 0.5) < 1e-6, 'center of the design at the center of the image');
  for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[3]]]) { const [fx, fy] = pl.toFrac(x, y); assert.ok(fx > 0 && fx < 1 && fy > 0 && fy < 1, 'corner inside'); }
  const [, yS] = pl.toFrac(bb[0], bb[1]), [, yN] = pl.toFrac(bb[0], bb[3]);
  assert.ok(yN < yS, 'north is up');
  assert.equal(plan('EPSG:2267', [0, 0, 10, 10], 1), null, 'not in Oklahoma: no aerial');
});
