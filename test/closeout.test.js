const { test } = require('node:test');
const assert = require('node:assert');
const O = require('../public/js/ortho');

test('as-built flight: world file read, cropped to the site, placed in drawing feet', () => {
  // 10,000 x 8,000 px ortho at 0.25 ft/px; upper-left pixel center at (2,619,000.125, 402,999.875)
  const w = O.parseWorld('0.25\n0\n0\n-0.25\n2619000.125\n402999.875\n');
  const site = [2620000, 401000, 2621000, 402000]; // 1,000 x 1,000 ft
  const c = O.crop(w, 10000, 8000, site, 3000);
  assert.deepEqual([c.sx, c.sy, c.sw, c.sh], [4000, 4000, 4000, 4000], 'pixel window covering the site');
  assert.equal(c.w, 3000); assert.equal(c.h, 3000);
  assert.ok(Math.abs(c.place.x0 - 2620000) < 1e-6 && Math.abs(c.place.y0 - 402000) < 1e-6, 'top-left of the saved image at the site corner');
  assert.ok(Math.abs(c.place.px - 1000 / 3000) < 1e-9 && Math.abs(c.place.py + 1000 / 3000) < 1e-9, 'pixel size after shrinking');
  assert.throws(() => O.crop(w, 10000, 8000, [100, 100, 200, 200]), /doesn’t cover this site/);
  assert.throws(() => O.parseWorld('0.25\n0.01\n0\n-0.25\n1\n1'), /rotated/);
  assert.throws(() => O.parseWorld('0.25\n0\n0'), /six numbers/);
});
