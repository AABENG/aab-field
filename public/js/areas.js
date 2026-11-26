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

  // Merged x-spans of row y covered by any of the polygons.
  function rowSpans(polys, y) {
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
    const out = [];
    for (const s of spans) { const l = out[out.length - 1]; if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else out.push([s[0], s[1]]); }
    return out;
  }

  // Area covered by any polygon, counted once. With `within`, only the part
  // inside those polygons counts (e.g. clearing cut to the limits of clearing).
  function unionSqft(polys, step, within) {
    polys = (polys || []).filter((p) => p && p.length >= 3);
    const lim = within && within.length ? within.filter((p) => p && p.length >= 3) : null;
    if (!polys.length) return 0;
    let y0 = Infinity, y1 = -Infinity;
    polys.forEach((p) => p.forEach(([, y]) => { if (y < y0) y0 = y; if (y > y1) y1 = y; }));
    step = step || Math.max(0.5, Math.min(2, (y1 - y0) / 4000));
    let total = 0;
    for (let y = y0 + step / 2; y < y1; y += step) {
      const a = rowSpans(polys, y);
      if (!lim) { for (const [s, e] of a) total += e - s; continue; }
      const b = rowSpans(lim, y);
      let i = 0, j = 0;
      while (i < a.length && j < b.length) {
        const s = Math.max(a[i][0], b[j][0]), e = Math.min(a[i][1], b[j][1]);
        if (e > s) total += e - s;
        if (a[i][1] < b[j][1]) i++; else j++;
      }
    }
    return total * step;
  }

  // Join open pieces drawn end to end (within `tol` ft) into closed rings.
  // Pieces that never close are dropped.
  function stitchRings(pieces, tol) {
    tol = tol || 1;
    const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
    const left = pieces.filter((p) => p && p.length >= 2).map((p) => p.slice());
    const rings = [];
    while (left.length) {
      let r = left.shift();
      let grew = true;
      while (!near(r[0], r[r.length - 1]) && grew) {
        grew = false;
        for (let k = 0; k < left.length; k++) {
          const q = left[k], end = r[r.length - 1];
          if (near(end, q[0])) r = r.concat(q.slice(1));
          else if (near(end, q[q.length - 1])) r = r.concat(q.slice(0, -1).reverse());
          else if (near(r[0], q[q.length - 1])) r = q.slice(0, -1).concat(r);
          else if (near(r[0], q[0])) r = q.slice(1).reverse().concat(r);
          else continue;
          left.splice(k, 1); grew = true; break;
        }
      }
      if (r.length >= 4 && near(r[0], r[r.length - 1]) && sqft(r) > 100) rings.push(r.slice(0, -1));
    }
    return rings;
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
  return { sqft, unionSqft, stitchRings, inside, acres, SQFT_PER_ACRE };
});
