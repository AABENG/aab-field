// Streaming DXF reader + geometry helpers. Runs in the browser (setup page)
// and in Node (tests). Reads only model-space ENTITIES; keeps 2D geometry.
(function (root) {
  'use strict';

  // Layers that are almost always surfaces/profiles/sheets: skipped while
  // reading so a 300 MB drawing doesn't fill memory. Shown in the summary.
  // Matched against whole words of the layer name (split on - _ space .).
  const SKIP_WORDS = new Set(['CONT', 'CONTOUR', 'CONTOURS', 'SURFACE', 'SURF', 'TIN', 'TRIANGLES', 'TRIANGLE', 'GRID',
    'HATCH', 'VIEWPORT', 'VPORT', 'DEFPOINTS', 'TITLE', 'SHEET', 'BORDER', 'AERIAL', 'IMAGE', 'DA', 'CALC', 'PROFILEGRID']);
  const DEFAULT_SKIP = { test: (layer) => /PROFILE/i.test(layer) ||
    String(layer).toUpperCase().split(/[-_ .]+/).some((w) => SKIP_WORDS.has(w)) };

  function arcPoints(cx, cy, r, a0, a1, segLen = 2) {
    // angles in degrees, counter-clockwise from a0 to a1
    let sweep = (a1 - a0) % 360; if (sweep <= 0) sweep += 360;
    const n = Math.max(2, Math.ceil((Math.PI * r * sweep / 180) / segLen));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (a0 + sweep * i / n) * Math.PI / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  // Expand a polyline with bulges (arc segments) into points.
  function bulgePoints(verts, closed) {
    const out = [];
    const n = verts.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const [x0, y0, b] = verts[i];
      const [x1, y1] = verts[(i + 1) % n];
      out.push([x0, y0]);
      if (b && Math.abs(b) > 1e-9) {
        const theta = 4 * Math.atan(b);
        const chord = Math.hypot(x1 - x0, y1 - y0);
        if (chord > 1e-9) {
          const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          const d = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
          const ux = (x1 - x0) / chord, uy = (y1 - y0) / chord;
          const sgn = (b > 0) === (Math.abs(theta) < Math.PI) ? 1 : -1;
          const cx = mx - uy * d * sgn, cy = my + ux * d * sgn;
          const a0 = Math.atan2(y0 - cy, x0 - cx), steps = Math.max(2, Math.ceil(Math.abs(theta) * r / 2));
          for (let k = 1; k < steps; k++) {
            const a = a0 + theta * k / steps;
            out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
          }
        }
      }
    }
    if (n) out.push(closed ? [verts[0][0], verts[0][1]] : [verts[n - 1][0], verts[n - 1][1]]);
    return out;
  }

  const isRing = (pts) => pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.5;

  // Reader: feed text chunks, then finish(). Produces entities:
  // {type:'line', layer, pts, closed} | {type:'point', layer, block, x, y}
  // | {type:'text', layer, text, x, y}
  function createReader(opts = {}) {
    const skip = opts.skip === undefined ? DEFAULT_SKIP : opts.skip;
    const entities = [];
    const skippedLayers = new Map();
    let carry = '', code = null, section = null, expectSectionName = false;
    let ent = null;          // entity being built
    let poly = null;         // old-style POLYLINE awaiting VERTEX/SEQEND
    let pendingVertex = null;

    function layerSkipped(layer) {
      if (!skip || !layer || !skip.test(layer)) return false;
      skippedLayers.set(layer, (skippedLayers.get(layer) || 0) + 1);
      return true;
    }
    function finishEntity() {
      const e = ent; ent = null;
      if (!e) return;
      if (e.type === 'VERTEX') {
        if (poly) poly.verts.push([e.x || 0, e.y || 0, e.bulge || 0]);
        return;
      }
      if (e.type === 'SEQEND') {
        if (poly) {
          if (!poly.skipped && !poly.mesh && poly.verts.length > 1) {
            const pts = bulgePoints(poly.verts, poly.closed);
            entities.push({ type: 'line', layer: poly.layer, pts, closed: poly.closed || isRing(pts) });
          }
          poly = null;
        }
        return;
      }
      if (e.paper) return;
      if (e.type === 'POLYLINE') {
        poly = { layer: e.layer, closed: !!(e.flags & 1), mesh: !!(e.flags & (16 | 64)), verts: [], skipped: layerSkipped(e.layer) };
        return;
      }
      if (layerSkipped(e.layer)) return;
      switch (e.type) {
        case 'LINE':
          entities.push({ type: 'line', layer: e.layer, pts: [[e.x, e.y], [e.x1, e.y1]] }); break;
        case 'LWPOLYLINE':
          if (e.verts.length > 1) { const pts = bulgePoints(e.verts, !!(e.flags & 1)); entities.push({ type: 'line', layer: e.layer, pts, closed: !!(e.flags & 1) || isRing(pts) }); }
          break;
        case 'ARC':
          entities.push({ type: 'line', layer: e.layer, pts: arcPoints(e.x, e.y, e.r, e.a0 || 0, e.a1 || 0) }); break;
        case 'SPLINE': {
          const p = e.fit.length > 1 ? e.fit : e.ctrl;
          if (p.length > 1) entities.push({ type: 'line', layer: e.layer, pts: p });
          break;
        }
        case 'CIRCLE':
          entities.push({ type: 'point', layer: e.layer, block: '(circle)', x: e.x, y: e.y }); break;
        case 'INSERT':
          entities.push({ type: 'point', layer: e.layer, block: e.name || '', x: e.x, y: e.y }); break;
        case 'TEXT': case 'MTEXT': {
          let t = (e.text || '').replace(/\\P/g, ' ').replace(/\{\\[^;]*;|\}|\\[A-Za-z][^;]*;/g, '').trim();
          if (t) entities.push({ type: 'text', layer: e.layer, text: t.slice(0, 60), x: e.x, y: e.y });
          break;
        }
        default: break;
      }
    }
    const KNOWN = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'SEQEND', 'ARC', 'CIRCLE', 'INSERT', 'TEXT', 'MTEXT', 'SPLINE']);

    function pair(c, v) {
      if (c === 0) {
        finishEntity();
        if (v === 'SECTION') { expectSectionName = true; return; }
        if (v === 'ENDSEC') { section = null; return; }
        if (section === 'ENTITIES' && KNOWN.has(v)) {
          ent = { type: v, layer: '', verts: [], fit: [], ctrl: [] };
        }
        return;
      }
      if (expectSectionName && c === 2) { section = v; expectSectionName = false; return; }
      if (!ent) return;
      const t = ent.type;
      switch (c) {
        case 8: ent.layer = v; break;
        case 67: if (v.trim() === '1') ent.paper = true; break;
        case 2: if (t === 'INSERT') ent.name = v; break;
        case 1: if (t === 'TEXT' || t === 'MTEXT') ent.text = (t === 'MTEXT' ? (ent.text || '') : '') + v; break;
        case 3: if (t === 'MTEXT') ent.text = (ent.text || '') + v; break;
        case 70: ent.flags = parseInt(v, 10) || 0; break;
        case 40: if (t === 'ARC' || t === 'CIRCLE') ent.r = parseFloat(v); break;
        case 50: if (t === 'ARC') ent.a0 = parseFloat(v); break;
        case 51: if (t === 'ARC') ent.a1 = parseFloat(v); break;
        case 42: if (t === 'LWPOLYLINE' && ent.verts.length) ent.verts[ent.verts.length - 1][2] = parseFloat(v); else if (t === 'VERTEX') ent.bulge = parseFloat(v); break;
        case 10: {
          const x = parseFloat(v);
          if (t === 'LWPOLYLINE') ent.verts.push([x, 0, 0]);
          else if (t === 'SPLINE') ent.ctrl.push([x, 0]);
          else ent.x = x;
          break;
        }
        case 20: {
          const y = parseFloat(v);
          if (t === 'LWPOLYLINE') { if (ent.verts.length) ent.verts[ent.verts.length - 1][1] = y; }
          else if (t === 'SPLINE') { if (ent.ctrl.length) ent.ctrl[ent.ctrl.length - 1][1] = y; }
          else ent.y = y;
          break;
        }
        case 11: if (t === 'LINE') ent.x1 = parseFloat(v); else if (t === 'SPLINE') ent.fit.push([parseFloat(v), 0]); break;
        case 21: if (t === 'LINE') ent.y1 = parseFloat(v); else if (t === 'SPLINE' && ent.fit.length) ent.fit[ent.fit.length - 1][1] = parseFloat(v); break;
        default: break;
      }
    }

    return {
      push(text) {
        const s = carry + text;
        const lines = s.split(/\r?\n/);
        carry = lines.pop();
        for (const line of lines) {
          if (code === null) { code = parseInt(line, 10); }
          else { pair(code, line.trim()); code = null; }
        }
      },
      finish() {
        if (carry) this.push('\n');
        finishEntity();
        return { entities, skippedLayers: [...skippedLayers.entries()].map(([layer, n]) => ({ layer, n })) };
      },
    };
  }

  // ---------- geometry ----------
  const plen = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };

  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
    return { d: Math.hypot(px - ax - t * dx, py - ay - t * dy), t };
  }

  // Grid index of segments for fast "distance to nearest line" queries.
  function segIndex(lines, cell = 50) {
    const grid = new Map(), segs = [];
    lines.forEach((pts, li) => {
      for (let i = 1; i < pts.length; i++) {
        const s = { li, i, a: pts[i - 1], b: pts[i] };
        const si = segs.push(s) - 1;
        const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / cell), x1 = Math.floor(Math.max(s.a[0], s.b[0]) / cell);
        const y0 = Math.floor(Math.min(s.a[1], s.b[1]) / cell), y1 = Math.floor(Math.max(s.a[1], s.b[1]) / cell);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4000) continue; // absurdly long segment; skip indexing
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
          const k = gx + ',' + gy; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(si);
        }
      }
    });
    return {
      // nearest segment within maxD; returns {d, li, i, t} or null
      nearest(x, y, maxD, minD = -1) {
        const r = Math.ceil(maxD / cell), gx = Math.floor(x / cell), gy = Math.floor(y / cell);
        let best = null; const seen = new Set();
        for (let ix = gx - r; ix <= gx + r; ix++) for (let iy = gy - r; iy <= gy + r; iy++) {
          const a = grid.get(ix + ',' + iy); if (!a) continue;
          for (const si of a) {
            if (seen.has(si)) continue; seen.add(si);
            const s = segs[si]; const q = segDist(x, y, s.a[0], s.a[1], s.b[0], s.b[1]);
            if (q.d <= maxD && q.d > minD && (!best || q.d < best.d)) best = { d: q.d, li: s.li, i: s.i, t: q.t };
          }
        }
        return best;
      },
    };
  }

  function samples(pts, step) {
    const out = []; const L = plen(pts); const n = Math.max(2, Math.ceil(L / step));
    let cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    let j = 1;
    for (let k = 0; k <= n; k++) {
      const s = L * k / n; while (j < cum.length - 1 && cum[j] < s) j++;
      const t = (s - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1);
      out.push([pts[j - 1][0] + t * (pts[j][0] - pts[j - 1][0]), pts[j - 1][1] + t * (pts[j][1] - pts[j - 1][1])]);
    }
    return out;
  }

  // Drop lines that duplicate a longer line already kept (drawn twice, or the
  // second wall of a double-line pipe). Keeps the longest of each group.
  function dedupe(lines, tol) {
    const order = lines.map((p, i) => [plen(p), i]).sort((a, b) => b[0] - a[0]);
    const kept = []; const keptIdx = [];
    for (const [, i] of order) {
      const pts = lines[i];
      if (kept.length) {
        const idx = segIndex(kept, Math.max(tol * 4, 20));
        const sm = samples(pts, Math.max(2, tol));
        if (sm.every(([x, y]) => idx.nearest(x, y, tol))) continue;
      }
      kept.push(pts); keptIdx.push(i);
    }
    return keptIdx.sort((a, b) => a - b);
  }

  // Double-line pipe: walls sit ~1-6 ft apart. Keep one wall per pipe, then
  // shift it to the middle of the pair so stations run along the centerline.
  function collapseDouble(lines, maxGap = 8) {
    const keep = dedupe(lines, maxGap);
    return keep.map((i) => {
      const own = lines[i];
      const others = lines.filter((_, j) => j !== i);
      const idx = segIndex(others, 40);
      return own.map(([x, y]) => {
        const q = idx.nearest(x, y, maxGap, 0.75);
        if (!q) return [x, y];
        const s = others[q.li];
        const a = s[q.i - 1], b = s[q.i];
        const px = a[0] + q.t * (b[0] - a[0]), py = a[1] + q.t * (b[1] - a[1]);
        return [(x + px) / 2, (y + py) / 2];
      });
    });
  }

  // Street centerlines mixed in with other paving linework: keep the stretches
  // of each line that run a steady distance from the nearest curb/edge line
  // (a centerline sits the same distance from the edge all along). Stretches
  // with no tagged curb nearby (other phases) drop out. Returns new lines.
  function centerlineParts(lines, edges, { min = 6, max = 30, tol = 1.5, step = 5, gap = 80, minRun = 60 } = {}) {
    if (!edges.length) return lines;
    const idx = segIndex(edges, 50);
    const all = lines.map((pts) => samples(pts, step).map(([x, y]) => {
      const q = idx.nearest(x, y, max + 5); return [x, y, q ? q.d : Infinity];
    }));
    // typical half-width: most common distance (0.5 ft bins) across all samples
    const bins = new Map();
    for (const s of all) for (const [, , dd] of s) if (dd >= min && dd <= max) { const k = Math.round(dd * 2) / 2; bins.set(k, (bins.get(k) || 0) + 1); }
    if (!bins.size) return [];
    const half = [...bins.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const out = [];
    for (const s of all) {
      let run = [], miss = 0, pend = [];
      const flush = () => { if (run.length > 1 && plen(run) >= minRun) out.push(run); run = []; pend = []; miss = 0; };
      for (const [x, y, dd] of s) {
        const ok = Math.abs(dd - half) <= tol;
        if (ok) { if (pend.length) { run.push(...pend); pend = []; } run.push([x, y]); miss = 0; }
        else if (run.length) { pend.push([x, y]); miss += step; if (miss > gap) flush(); }
      }
      pend = []; flush();
    }
    return out;
  }

  // Boundary area: polygons from a layer's closed lines (or its bounding box),
  // grown by a margin. clip(pts) returns the pieces inside.
  function makeArea(boundLines, margin) {
    const rings = boundLines.filter((p) => isRing(p) || (p.length > 3 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of boundLines) for (const [x, y] of p) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const box = [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
    if (!rings.length) return { box, clip: (pts) => inBox(pts, box), contains: (x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] };
    const edgeIdx = segIndex(rings, 50);
    const inPoly = (x, y) => rings.some((r) => {
      let c = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi) c = !c;
      }
      return c;
    });
    const contains = (x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] && (inPoly(x, y) || !!edgeIdx.nearest(x, y, margin));
    const clip = (pts) => {
      const parts = []; let cur = null;
      for (const piece of inBox(pts, box)) {
        for (let i = 1; i < piece.length; i++) {
          const a = piece[i - 1], b = piece[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 10));
          for (let k = 0; k < n; k++) {
            const p0 = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
            const p1 = [a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n];
            if (contains((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)) { if (!cur) cur = [p0]; cur.push(p1); }
            else if (cur) { parts.push(cur); cur = null; }
          }
        }
        if (cur) { parts.push(cur); cur = null; }
      }
      // re-thin: drop the extra vertices added for testing on straight runs
      return parts.map((p) => p.filter((q, i) => i === 0 || i === p.length - 1 || !collinear(p[i - 1], q, p[i + 1])));
    };
    return { box, clip, contains };
  }
  const collinear = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6 * Math.hypot(c[0] - a[0], c[1] - a[1]) ** 2;

  // Put structures on their lines: returns {line, station} or null if not within tol.
  function snapPoints(points, lines, tol = 10) {
    const idx = segIndex(lines, 50);
    const cums = lines.map((pts) => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return c; });
    return points.map(([x, y]) => {
      const q = idx.nearest(x, y, tol); if (!q) return null;
      const c = cums[q.li], seg = c[q.i] - c[q.i - 1];
      return { line: q.li, station: c[q.i - 1] + q.t * seg };
    });
  }

  function dedupePoints(points, tol = 4) {
    const out = [];
    const grid = new Map();
    for (const p of points) {
      const gx = Math.floor(p[0] / tol), gy = Math.floor(p[1] / tol);
      let dup = false;
      for (let ix = gx - 1; ix <= gx + 1 && !dup; ix++) for (let iy = gy - 1; iy <= gy + 1 && !dup; iy++) {
        for (const q of grid.get(ix + ',' + iy) || []) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < tol) { dup = true; break; }
      }
      if (dup) continue;
      out.push(p); const k = gx + ',' + gy; (grid.get(k) || grid.set(k, []).get(k)).push(p);
    }
    return out;
  }

  // Clip a polyline to a rectangle (Liang-Barsky per segment); returns the
  // inside pieces.
  function clipSeg(a, b, box) {
    let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
    const p = [-dx, dx, -dy, dy], q = [a[0] - box[0], box[2] - a[0], a[1] - box[1], box[3] - a[1]];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy], t0, t1];
  }
  function inBox(pts, box) {
    const parts = []; let cur = null;
    for (let i = 1; i < pts.length; i++) {
      const c = clipSeg(pts[i - 1], pts[i], box);
      if (!c) { if (cur && cur.length > 1) parts.push(cur); cur = null; continue; }
      const [p0, p1, t0, t1] = c;
      if (!cur || t0 > 0) { if (cur && cur.length > 1) parts.push(cur); cur = [p0]; }
      cur.push(p1);
      if (t1 < 1) { parts.push(cur); cur = null; }
    }
    if (cur && cur.length > 1) parts.push(cur);
    return parts;
  }

  const api = { DEFAULT_SKIP, createReader, plen, segIndex, samples, dedupe, collapseDouble, centerlineParts, makeArea, isRing, snapPoints, dedupePoints, inBox, bulgePoints };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AABDXF = api;
})(typeof window !== 'undefined' ? window : globalThis);
