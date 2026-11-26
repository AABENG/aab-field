// Area math for clearing and earthwork polygons, shared by the phone and the
// server. Coordinates are drawing feet (state plane), so areas come out in
// square feet. The union is measured with horizontal scan lines: exact across
// each line, 1 ft between lines, which is far finer than a hand-drawn area.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AABAreas = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SQFT_PER_ACRE = 43560;

  function sqft(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return Math.abs(a) / 2;
  }

  // Spans of each row covered by any polygon, merged, summed.
  function unionSqft(polys, step) {
    polys = polys.filter((p) => p && p.length >= 3);
    if (!polys.length) return 0;
    let y0 = Infinity, y1 = -Infinity;
    polys.forEach((p) => p.forEach(([, y]) => { if (y < y0) y0 = y; if (y > y1) y1 = y; }));
    step = step || Math.max(0.5, Math.min(2, (y1 - y0) / 4000));
    let total = 0;
    for (let y = y0 + step / 2; y < y1; y += step) {
      const spans = [];
      for (const p of polys) {
        const xs = [];
        for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          const [xa, ya] = p[j], [xb, yb] = p[i];
          if ((ya <= y) !== (yb <= y)) xs.push(xa + (y - ya) * (xb - xa) / (yb - ya));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) spans.push([xs[k], xs[k + 1]]);
      }
      spans.sort((a, b) => a[0] - b[0]);
      let cs = -Infinity, ce = -Infinity;
      for (const [s, e] of spans) {
        if (s > ce) { if (ce > cs) total += ce - cs; cs = s; ce = e; } else if (e > ce) ce = e;
      }
      if (ce > cs) total += ce - cs;
    }
    return total * step;
  }

  function inside(pts, x, y) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xa, ya] = pts[j], [xb, yb] = pts[i];
      if ((ya > y) !== (yb > y) && x < xa + (y - ya) * (xb - xa) / (yb - ya)) c = !c;
    }
    return c;
  }

  const acres = (sf) => sf / SQFT_PER_ACRE;
  return { sqft, unionSqft, inside, acres, SQFT_PER_ACRE };
});
