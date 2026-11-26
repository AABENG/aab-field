// Plan view: draws design linework (drawing coordinates, feet, y up) as SVG
// with pan (drag), zoom (wheel, +/- buttons) and optional line clicks.
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = { wl: 'var(--wl)', ss: 'var(--ss)', sd: 'var(--sd)', cl: 'var(--cl)' };
  const NAMES = { wl: 'Waterline', ss: 'Sanitary', sd: 'Storm', cl: 'Street centerline' };
  const BG = { lots: ['var(--lots)', 0.8], row: ['var(--row)', 1], curb: ['var(--curb)', 0.8], other: ['var(--plat)', 0.8] };
  const ST = { mh: ['ss', 'circle'], st: ['sd', 'diamond'], fh: ['wl', 'square'], vv: ['wl', 'small'] };

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const d = (pts) => 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + (-p[1]).toFixed(1)).join(' L');

  function bounds(data) {
    if (data.viewBox) return data.viewBox;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of data.lines) for (const p of l.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const m = 50; return [x0 - m, y0 - m, x1 + m, y1 + m];
  }

  function render(container, data, opts = {}) {
    container.innerHTML = '';
    const b = bounds(data);
    const home = [b[0], -b[3], b[2] - b[0], b[3] - b[1]];
    let vb = home.slice();
    const svg = el('svg', { xmlns: NS }, container);
    const setVB = () => svg.setAttribute('viewBox', vb.map((v) => v.toFixed(1)).join(' '));
    setVB();
    const ns = { 'vector-effect': 'non-scaling-stroke', fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };

    const bg = el('g', {}, svg);
    for (const [k, [color, w]] of Object.entries(BG)) {
      const parts = (data.background && data.background[k]) || [];
      if (parts.length) el('path', { ...ns, d: parts.map(d).join(' '), stroke: color, 'stroke-width': w }, bg);
    }
    if (data.labels && data.labels.length) {
      const lg = el('g', { fill: 'var(--label)', 'font-family': 'JetBrains Mono, monospace', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, svg);
      for (const t of data.labels) { const x = el('text', { x: t.x, y: -t.y, 'font-size': t.s || 8 }, lg); x.textContent = t.t; }
    }
    const lg = el('g', {}, svg);
    data.lines.forEach((l, i) => {
      const off = l.excluded;
      const p = el('path', { ...ns, d: d(l.pts), stroke: off ? 'var(--mute)' : COLORS[l.item] || 'var(--ink)', 'stroke-width': off ? 1.5 : 3,
        'stroke-dasharray': off ? '6 5' : 'none', opacity: off ? 0.8 : 0.9 }, lg);
      if (opts.onLineClick) {
        // wide invisible hit target so lines are easy to click
        const hit = el('path', { ...ns, d: d(l.pts), stroke: 'transparent', 'stroke-width': 14, style: 'cursor:pointer;pointer-events:stroke' }, lg);
        hit.addEventListener('click', (e) => { if (!moved) opts.onLineClick(i, e); });
        hit.addEventListener('mouseenter', () => p.setAttribute('stroke-width', 6));
        hit.addEventListener('mouseleave', () => p.setAttribute('stroke-width', off ? 1.5 : 3));
      }
    });
    const sg = el('g', {}, svg);
    const scale = () => vb[2] / (svg.clientWidth || 800); // feet per pixel
    function drawStructures() {
      sg.innerHTML = '';
      const r0 = 4.5 * scale();
      for (const s of data.structures || []) {
        const [item, shape] = ST[s.kind] || ['ss', 'circle'];
        const c = COLORS[item], r = shape === 'small' ? r0 * 0.7 : r0, x = s.x, y = -s.y;
        const a = { fill: 'var(--map)', stroke: c, 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' };
        if (shape === 'circle') el('circle', { ...a, cx: x, cy: y, r }, sg);
        else if (shape === 'diamond') el('rect', { ...a, x: x - r, y: y - r, width: 2 * r, height: 2 * r, transform: `rotate(45 ${x} ${y})` }, sg);
        else el('rect', { ...a, x: x - r, y: y - r, width: 2 * r, height: 2 * r }, sg);
      }
    }
    drawStructures();

    // zoom buttons
    const z = document.createElement('div'); z.className = 'zoom'; container.appendChild(z);
    const zoomBy = (f, cx, cy) => {
      cx = cx ?? vb[0] + vb[2] / 2; cy = cy ?? vb[1] + vb[3] / 2;
      vb = [cx - (cx - vb[0]) * f, cy - (cy - vb[1]) * f, vb[2] * f, vb[3] * f]; setVB(); drawStructures();
    };
    [['+', () => zoomBy(0.7)], ['−', () => zoomBy(1 / 0.7)], ['⤢', () => { vb = home.slice(); setVB(); drawStructures(); }]].forEach(([t, f]) => {
      const bt = document.createElement('button'); bt.type = 'button'; bt.textContent = t; bt.onclick = f; z.appendChild(bt);
    });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const q = pt.matrixTransform(svg.getScreenCTM().inverse());
      zoomBy(e.deltaY < 0 ? 0.85 : 1 / 0.85, q.x, q.y);
    }, { passive: false });
    let drag = null, moved = false;
    svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; moved = false; });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      const f = scale(); vb[0] -= dx * f; vb[1] -= dy * f; drag = { x: e.clientX, y: e.clientY }; setVB();
    });
    window.addEventListener('pointerup', () => { drag = null; setTimeout(() => { moved = false; }, 0); });

    if (opts.legend !== false) {
      const items = [...new Set(data.lines.map((l) => l.item))];
      const lgd = document.createElement('div'); lgd.className = 'legend';
      lgd.innerHTML = items.map((k) => `<span><i style="background:${COLORS[k]}"></i>${NAMES[k] || k}</span>`).join('') +
        (data.lines.some((l) => l.excluded) ? '<span><i style="background:var(--mute)"></i>Left out</span>' : '');
      container.after(lgd);
      if (container._legend) container._legend.remove();
      container._legend = lgd;
    }
  }

  async function mount(container) {
    const r = await fetch(`/api/projects/${container.dataset.project}/design`);
    const data = await r.json();
    if (!data.lines || !data.lines.length) { container.innerHTML = '<p class="mute" style="padding:16px">No design loaded yet.</p>'; return; }
    const bgData = data.background || {};
    render(container, { viewBox: data.viewBox, background: bgData, labels: bgData.labels, lines: data.lines, structures: data.structures });
  }

  root.AABPlan = { render, mount, COLORS, NAMES };
})(window);
