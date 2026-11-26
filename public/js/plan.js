// Plan view: design linework (drawing feet, y up) as SVG with pan/zoom,
// optional Google satellite underlay (design lined up on the aerial through
// the project's state plane system) and an optional GPS "you are here" dot.
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = { wl: 'var(--wl)', ss: 'var(--ss)', sd: 'var(--sd)', cl: 'var(--cl)' };
  const NAMES = { wl: 'Waterline', ss: 'Sanitary', sd: 'Storm', cl: 'Street centerline' };
  const BG = { lots: ['var(--lots)', 0.8], row: ['var(--row)', 1], curb: ['var(--curb)', 0.8], other: ['var(--plat)', 0.8] };
  const ST = { mh: ['ss', 'circle'], st: ['sd', 'diamond'], fh: ['wl', 'square'], vv: ['wl', 'small'] };
  const SAT_KEY = 'aabfield-sat';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const d = (pts) => 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + (-p[1]).toFixed(1)).join(' L');
  const ns = { 'vector-effect': 'non-scaling-stroke', fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };

  function bounds(data) {
    if (data.viewBox) return data.viewBox;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of data.lines) for (const p of l.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const m = 50; return [x0 - m, y0 - m, x1 + m, y1 + m];
  }

  // Draws the design into group g (coordinates x, -y). onSat: lighter
  // background so the aerial shows through.
  function drawDesign(g, data, opts, onSat) {
    const bg = el('g', {}, g);
    for (const [k, [color, w]] of Object.entries(BG)) {
      const parts = (data.background && data.background[k]) || [];
      if (parts.length) el('path', { ...ns, d: parts.map(d).join(' '), stroke: onSat ? 'rgba(255,255,255,.55)' : color, 'stroke-width': w }, bg);
    }
    if (!onSat && data.labels && data.labels.length) {
      const lg = el('g', { fill: 'var(--label)', 'font-family': 'JetBrains Mono, monospace', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
      for (const t of data.labels) { const x = el('text', { x: t.x, y: -t.y, 'font-size': t.s || 8 }, lg); x.textContent = t.t; }
    }
    const lg = el('g', onSat ? { style: 'filter:drop-shadow(0 0 2px rgba(0,0,0,.9))' } : {}, g);
    data.lines.forEach((l, i) => {
      const off = l.excluded;
      const p = el('path', { ...ns, d: d(l.pts), stroke: off ? 'var(--mute)' : COLORS[l.item] || 'var(--ink)', 'stroke-width': off ? 1.5 : 3,
        'stroke-dasharray': off ? '6 5' : 'none', opacity: off ? 0.8 : 0.95 }, lg);
      if (opts.onLineClick && !onSat) {
        const hit = el('path', { ...ns, d: d(l.pts), stroke: 'transparent', 'stroke-width': 14, style: 'cursor:pointer;pointer-events:stroke' }, lg);
        hit.addEventListener('click', (e) => { if (!opts._moved()) opts.onLineClick(i, e); });
        hit.addEventListener('mouseenter', () => p.setAttribute('stroke-width', 6));
        hit.addEventListener('mouseleave', () => p.setAttribute('stroke-width', off ? 1.5 : 3));
      }
    });
    const sg = el('g', {}, g);
    const gps = el('g', {}, g);
    return {
      // r0 = symbol radius in drawing feet for the current zoom
      structures(r0) {
        sg.innerHTML = '';
        for (const s of data.structures || []) {
          const [item, shape] = ST[s.kind] || ['ss', 'circle'];
          const c = COLORS[item], r = shape === 'small' ? r0 * 0.7 : r0, x = s.x, y = -s.y;
          const a = { fill: onSat ? '#0b1424' : 'var(--map)', stroke: c, 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' };
          if (shape === 'circle') el('circle', { ...a, cx: x, cy: y, r }, sg);
          else if (shape === 'diamond') el('rect', { ...a, x: x - r, y: y - r, width: 2 * r, height: 2 * r, transform: `rotate(45 ${x} ${y})` }, sg);
          else el('rect', { ...a, x: x - r, y: y - r, width: 2 * r, height: 2 * r }, sg);
        }
      },
      gps(pt, r0) { // pt: [x, y, accuracyFt] or null
        gps.innerHTML = '';
        if (!pt) return;
        const [x, y, acc] = pt;
        el('circle', { cx: x, cy: -y, r: Math.max(acc || 0, r0 * 2), fill: 'rgba(66,153,255,.15)', stroke: 'rgba(66,153,255,.5)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }, gps);
        el('circle', { cx: x, cy: -y, r: r0 * 1.2, fill: '#3b8cff', stroke: '#fff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', style: 'filter:drop-shadow(0 0 6px #3b8cff)' }, gps);
      },
    };
  }

  function render(container, data, opts = {}) {
    if (container._cleanup) container._cleanup();
    container.innerHTML = '';
    const b = bounds(data);
    const home = [b[0], -b[3], b[2] - b[0], b[3] - b[1]];
    let vb = home.slice();
    const geoOK = !!(root.AABGeo && data.crs && root.AABGeo.looksOklahoma(root.AABGeo.toLatLng(data.crs, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2)));
    const canSat = !!(root.AABMaps && root.AABMaps.available() && geoOK && !opts.noSatellite);
    let sat = canSat && store.get(SAT_KEY) === '1';
    let moved = false;
    opts._moved = () => moved;

    // ---- plain SVG view ----
    const svg = el('svg', { xmlns: NS }, container);
    const setVB = () => svg.setAttribute('viewBox', vb.map((v) => v.toFixed(1)).join(' '));
    setVB();
    const plain = drawDesign(el('g', {}, svg), data, opts, false);
    const scale = () => vb[2] / (svg.clientWidth || 800); // feet per pixel
    let gpsPt = null;
    const redrawPlain = () => { plain.structures(4.5 * scale()); plain.gps(gpsPt, 4.5 * scale()); };
    redrawPlain();

    const zoomBy = (f, cx, cy) => {
      cx = cx ?? vb[0] + vb[2] / 2; cy = cy ?? vb[1] + vb[3] / 2;
      vb = [cx - (cx - vb[0]) * f, cy - (cy - vb[1]) * f, vb[2] * f, vb[3] * f]; setVB(); redrawPlain();
    };
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const q = pt.matrixTransform(svg.getScreenCTM().inverse());
      zoomBy(e.deltaY < 0 ? 0.85 : 1 / 0.85, q.x, q.y);
    }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; moved = false; });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      const f = scale(); vb[0] -= dx * f; vb[1] -= dy * f; drag = { x: e.clientX, y: e.clientY }; setVB();
    });
    const up = () => { drag = null; setTimeout(() => { moved = false; }, 0); };
    window.addEventListener('pointerup', up);

    // ---- satellite view ----
    const mapDiv = document.createElement('div');
    mapDiv.className = 'satmap hide';
    container.appendChild(mapDiv);
    let gmap = null, gpsMarker = null, gpsCircle = null;
    const G = root.AABGeo;

    function siteBounds(g) {
      const bb = new g.LatLngBounds();
      [[b[0], b[1]], [b[2], b[3]]].forEach(([x, y]) => bb.extend(G.toLatLng(data.crs, x, y)));
      return bb;
    }
    async function showSat() {
      const g = await root.AABMaps.load();
      svg.classList.add('hide'); mapDiv.classList.remove('hide');
      if (gmap) return;
      const ll = (x, y) => { const p = G.toLatLng(data.crs, x, y); return new g.LatLng(p.lat, p.lng); };
      gmap = new g.Map(mapDiv, { mapTypeId: 'satellite', tilt: 0, streetViewControl: false, fullscreenControl: false, mapTypeControl: false,
        zoomControl: false, gestureHandling: 'greedy', clickableIcons: false, keyboardShortcuts: false, maxZoom: 21 });
      gmap.fitBounds(siteBounds(g), 10);
      class DesignOverlay extends g.OverlayView {
        onAdd() {
          this.svg = el('svg', { xmlns: NS, style: 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none' });
          this.g = el('g', {}, this.svg);
          this.view = drawDesign(this.g, data, opts, true);
          this.getPanes().overlayLayer.appendChild(this.svg);
        }
        draw() {
          // State plane is near-affine to the map over a site: fit an affine
          // transform from three corners of the drawing.
          const pr = this.getProjection();
          const P0 = pr.fromLatLngToDivPixel(ll(b[0], b[1]));
          const P1 = pr.fromLatLngToDivPixel(ll(b[2], b[1]));
          const P2 = pr.fromLatLngToDivPixel(ll(b[0], b[3]));
          const m = affine(b, P0, P1, P2);
          this.g.setAttribute('transform', `matrix(${m.join(' ')})`);
          this.view.structures(4.5 / Math.hypot(m[0], m[1]));
        }
        onRemove() { this.svg.remove(); }
      }
      new DesignOverlay().setMap(gmap);
      if (lastFix) placeGpsOnMap();
    }
    function showPlain() { mapDiv.classList.add('hide'); svg.classList.remove('hide'); redrawPlain(); }
    function placeGpsOnMap() {
      if (!gmap || !lastFix) return;
      const g = root.google.maps, pos = { lat: lastFix.lat, lng: lastFix.lng };
      if (!gpsMarker) {
        gpsMarker = new g.Marker({ map: gmap, position: pos, clickable: false, icon: { path: g.SymbolPath.CIRCLE, scale: 7, fillColor: '#3b8cff', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 } });
        gpsCircle = new g.Circle({ map: gmap, center: pos, radius: lastFix.acc, strokeColor: '#3b8cff', strokeOpacity: 0.5, strokeWeight: 1, fillColor: '#3b8cff', fillOpacity: 0.15, clickable: false });
      } else { gpsMarker.setPosition(pos); gpsCircle.setCenter(pos); gpsCircle.setRadius(lastFix.acc); }
    }

    // ---- GPS ----
    let watch = null, lastFix = null, centeredOnce = false;
    function toggleGps(btn) {
      if (watch !== null) {
        navigator.geolocation.clearWatch(watch); watch = null; lastFix = null; gpsPt = null; btn.classList.remove('on'); redrawPlain();
        if (gpsMarker) { gpsMarker.setMap(null); gpsCircle.setMap(null); gpsMarker = gpsCircle = null; }
        return;
      }
      btn.classList.add('on'); centeredOnce = false;
      watch = navigator.geolocation.watchPosition((pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        lastFix = { lat, lng, acc: accuracy };
        const [x, y] = G.fromLatLng(data.crs, lat, lng);
        gpsPt = [x, y, accuracy * 3.2808];
        const inside = x > b[0] - 2000 && x < b[2] + 2000 && y > b[1] - 2000 && y < b[3] + 2000;
        if (!centeredOnce && inside) { // bring the dot into view once
          vb = [x - vb[2] / 2, -y - vb[3] / 2, vb[2], vb[3]]; setVB();
          if (gmap) gmap.panTo({ lat, lng });
        }
        if (!centeredOnce && !inside && opts.toast) opts.toast('You are more than 2,000 ft from this site');
        centeredOnce = true;
        redrawPlain(); placeGpsOnMap();
      }, () => { btn.classList.remove('on'); watch = null; if (opts.toast) opts.toast('Location is off or not allowed on this device'); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    }
    container._cleanup = () => { if (watch !== null) navigator.geolocation.clearWatch(watch); window.removeEventListener('pointerup', up); };

    // ---- controls ----
    const z = document.createElement('div'); z.className = 'zoom'; container.appendChild(z);
    const btn = (label, title, fn) => { const bt = document.createElement('button'); bt.type = 'button'; bt.innerHTML = label; bt.title = title; bt.onclick = () => fn(bt); z.appendChild(bt); return bt; };
    btn('+', 'Zoom in', () => (sat && gmap ? gmap.setZoom(gmap.getZoom() + 1) : zoomBy(0.7)));
    btn('−', 'Zoom out', () => (sat && gmap ? gmap.setZoom(gmap.getZoom() - 1) : zoomBy(1 / 0.7)));
    btn('⤢', 'Whole site', () => { vb = home.slice(); setVB(); redrawPlain(); if (gmap) gmap.fitBounds(siteBounds(root.google.maps), 10); });
    if (canSat) {
      const sb = btn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>', 'Satellite on/off', async (bt) => {
        sat = !sat; store.set(SAT_KEY, sat ? '1' : '0'); bt.classList.toggle('on', sat);
        if (sat) { try { await showSat(); } catch (e) { sat = false; bt.classList.remove('on'); showPlain(); if (opts.toast) opts.toast('Satellite map could not load'); } } else showPlain();
      });
      sb.classList.toggle('on', sat);
      if (sat) showSat().catch(() => { sat = false; sb.classList.remove('on'); showPlain(); });
    }
    if (geoOK && navigator.geolocation) {
      btn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7.5"/></svg>', 'Show my location', toggleGps);
    }

    if (opts.legend !== false) {
      const items = [...new Set(data.lines.map((l) => l.item))];
      const lgd = document.createElement('div'); lgd.className = 'legend';
      lgd.innerHTML = items.map((k) => `<span><i style="background:${COLORS[k]}"></i>${NAMES[k] || k}</span>`).join('') +
        (data.lines.some((l) => l.excluded) ? '<span><i style="background:var(--mute)"></i>Left out</span>' : '');
      if (container._legend) container._legend.remove();
      container.after(lgd); container._legend = lgd;
    }
    return { zoomBy };
  }

  // Affine matrix [a b c d e f] taking drawing group coords (x, -y) to pixels,
  // from pixel positions of drawing corners (x0,y0), (x1,y0), (x0,y1).
  function affine(b, P0, P1, P2) {
    const ax = (P1.x - P0.x) / (b[2] - b[0]), ay = (P1.y - P0.y) / (b[2] - b[0]);
    const cx = (P2.x - P0.x) / (b[3] - b[1]), cy = (P2.y - P0.y) / (b[3] - b[1]);
    // pixel = A*x + C*y + T with y = -Y  =>  pixel = A*x + (-C)*Y + T
    const tx = P0.x - ax * b[0] - cx * b[1], ty = P0.y - ay * b[0] - cy * b[1];
    return [ax, ay, -cx, -cy, tx, ty];
  }

  async function mount(container, opts = {}) {
    const r = await fetch(`/api/projects/${container.dataset.project}/design`);
    const data = await r.json();
    if (!data.lines || !data.lines.length) { container.innerHTML = '<p class="mute" style="padding:16px">No design loaded yet.</p>'; return; }
    const bgData = data.background || {};
    render(container, { viewBox: data.viewBox, background: bgData, labels: bgData.labels, lines: data.lines, structures: data.structures, crs: data.project.crs }, opts);
  }

  root.AABPlan = { render, mount, affine, COLORS, NAMES };
})(window);
