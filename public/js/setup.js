// Design setup: read a DXF in the browser, tag layers, preview, save.
(function (root) {
  'use strict';
  const G = root.AABDXF;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const LINE_USES = [
    ['', 'Ignore'], ['wl', 'Waterline'], ['ss', 'Sanitary sewer'], ['sd', 'Storm sewer'], ['cl', 'Street centerline'],
    ['bg:lots', 'Background: lots'], ['bg:row', 'Background: ROW'], ['bg:curb', 'Background: curb / edge'], ['bg:other', 'Background: other'],
  ];
  const SYM_USES = [['', 'Ignore'], ['mh', 'Sanitary manhole'], ['st', 'Storm structure'], ['fh', 'Fire hydrant'], ['vv', 'Water valve']];
  const STUB_FT = 45;

  let projectId, all = null, box = null;
  const layers = new Map();   // layer -> {lines:[pts], syms: Map(block -> [[x,y]]), texts:[]}
  const tags = new Map();     // layer -> {use, double, clOnly, stubs}
  const symTags = new Map();  // layer|block -> kind
  let design = null;          // {lines:[{item, layer, pts, excluded}], structures, background, labels}
  const excluded = new Set(); // keys item|layer|index

  // ---------- reading ----------
  async function readFile(file) {
    const status = $('readStatus');
    const reader = G.createReader();
    const stream = file.stream().pipeThrough(new TextDecoderStream());
    const rd = stream.getReader();
    let bytes = 0, lastPct = -1;
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      reader.push(value);
      bytes += value.length;
      const pct = Math.min(99, Math.floor(100 * bytes / file.size));
      if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; status.textContent = `Reading ${file.name}… ${pct}%`; await new Promise((r) => setTimeout(r, 0)); }
    }
    const out = reader.finish();
    status.textContent = `Read ${file.name}: ${out.entities.length.toLocaleString()} items kept` +
      (out.skippedLayers.length ? `; skipped ${out.skippedLayers.length} profile/contour/grid layers` : '') + '.';
    return out;
  }

  // ---------- guesses from layer names ----------
  function guessLine(layer) {
    const L = layer.toUpperCase();
    if (/PH(ASE)?\s*-?\s*(2|II|3|III|4)\b|FUTURE|^EX[-_ ]|EXIST|ADJACENT/.test(L)) return { use: '' };
    if (/SERVICE|TEE|LABEL|TEXT|STRUCT|FITTING|PROFILE|SPACING|STATION|DIM|HATCH|MATCH/.test(L)) return { use: '' };
    if (/^ZZ[-_ ]|ALIGN/.test(L) && /WATER|SEWER|STORM|(^|[-_ ])(WL|SS|SD)([-_ ]|$)/.test(L)) return { use: '' };
    if (/(^|[-_ ])WL([-_ ]|$)|WATER/.test(L)) return { use: 'wl' };
    if (/(^|[-_ ])SS([-_ ]|$)|SEWER|SANIT/.test(L)) return { use: 'ss', stubs: true };
    if (/(^|[-_ ])SD([-_ ]|$)|STORM/.test(L)) return { use: 'sd' };
    if (/(PAV|PV|ROAD|STREET)[-_ ]?CL|CNTR|CENTERLINE|(^|[-_ ])CL($|[-_ ])/.test(L)) return { use: 'cl' };
    if (/ALIGN/.test(L) && !/STATION|LABEL/.test(L)) return { use: 'cl' };
    if (/(^|[-_ ])(PV|PAV)[-_ ]LINE/.test(L)) return { use: 'cl', clOnly: true };
    if (/(^|[-_ ])ROW([-_ ]|$)/.test(L)) return { use: 'bg:row' };
    if (/LOT[-_ ]?LINE/.test(L)) return { use: 'bg:lots' };
    if (/BOC|EOP|FOC|CURB|EDGE/.test(L)) return { use: 'bg:curb' };
    if (/BNDY|BOUNDARY|PLAT/.test(L)) return { use: 'bg:other' };
    return { use: '' };
  }
  function guessSym(layer, block) {
    const L = layer.toUpperCase(), B = block.toUpperCase();
    if (/PH(ASE)?\s*-?\s*(2|II|3|III)\b|FUTURE|^EX[-_ ]|EXIST|LABEL|TEXT|DAMAP/.test(L)) return '';
    if (/(^|[-_ ])SS([-_ ]|$)|SEWER|SANIT/.test(L) && /STRUCT|MH|MANHOLE/.test(L + ' ' + B)) return 'mh';
    if (/(^|[-_ ])SD([-_ ]|$)|STORM/.test(L) && /STRUCT|INLET|BOX|MH/.test(L + ' ' + B)) return 'st';
    if (/(^|[-_ ])WL([-_ ]|$)|WATER/.test(L)) {
      if (/FH|HYD/.test(B)) return 'fh';
      if (/VALV|GV\b|VLV/.test(B)) return 'vv';
    }
    return '';
  }
  function guessBoundary(names) {
    const order = [/BNDY.*PLAT|PLAT.*BNDY/i, /BNDY|BOUNDARY/i, /PLAT/i];
    for (const re of order) { const f = names.find((n) => re.test(n)); if (f) return f; }
    return '';
  }

  // Parallel lines 1–6 ft apart on much of their length → drawn as double-line pipe.
  function looksDouble(lines) {
    if (lines.length < 4) return false;
    let hits = 0, n = 0;
    lines.forEach((pts, i) => {
      const mid = G.samples(pts, Math.max(5, G.plen(pts) / 2))[1];
      if (!mid) return;
      n++;
      const q = G.segIndex(lines.filter((_, j) => j !== i), 30).nearest(mid[0], mid[1], 6, 0.75);
      if (q) hits++;
    });
    return n > 0 && hits / n > 0.6;
  }

  // ---------- area ----------
  let area = null;
  function makeArea() {
    const name = $('boundary').value, m = Number($('margin').value) || 0;
    if (name) return G.makeArea(all.entities.filter((e) => e.layer === name && e.type === 'line').map((e) => e.pts), m);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of all.entities) if (e.type === 'line') for (const [x, y] of e.pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    const b = [x0, y0, x1, y1];
    return { box: b, clip: (p) => G.inBox(p, b), contains: (x, y) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] };
  }

  function collect() {
    area = makeArea(); box = area.box;
    layers.clear();
    for (const e of all.entities) {
      let L = layers.get(e.layer);
      if (!L) layers.set(e.layer, L = { lines: [], syms: new Map(), texts: [] });
      if (e.type === 'line') for (const part of area.clip(e.pts)) L.lines.push(part);
      else if (area.contains(e.x, e.y)) {
        if (e.type === 'point') { let a = L.syms.get(e.block); if (!a) L.syms.set(e.block, a = []); a.push([e.x, e.y]); }
        else L.texts.push(e);
      }
    }
    for (const [name, L] of layers) {
      if (!tags.has(name)) {
        const g = guessLine(name);
        if (['wl', 'ss', 'sd'].includes(g.use) && L.lines.length) g.double = looksDouble(L.lines);
        tags.set(name, { use: g.use, double: !!g.double, clOnly: !!g.clOnly, stubs: !!g.stubs });
      }
      for (const block of L.syms.keys()) {
        const k = name + '|' + block;
        if (!symTags.has(k)) symTags.set(k, guessSym(name, block));
      }
    }
  }

  // ---------- layer table ----------
  function renderTable() {
    const rows = [];
    const names = [...layers.keys()].filter((n) => layers.get(n).lines.length || layers.get(n).syms.size)
      .sort((a, b) => (tags.get(b).use ? 1 : 0) - (tags.get(a).use ? 1 : 0) || a.localeCompare(b));
    for (const name of names) {
      const L = layers.get(name), t = tags.get(name);
      const len = L.lines.reduce((s, p) => s + G.plen(p), 0);
      const nSym = [...L.syms.values()].reduce((s, a) => s + a.length, 0);
      const util = ['wl', 'ss', 'sd'].includes(t.use);
      const lineSel = L.lines.length ? `<select data-layer="${esc(name)}" data-f="use">${LINE_USES.map(([v, l]) => `<option value="${v}" ${v === t.use ? 'selected' : ''}>${l}</option>`).join('')}</select>` : '';
      const optsHtml = [
        util ? `<label class="chk"><input type="checkbox" data-layer="${esc(name)}" data-f="double" ${t.double ? 'checked' : ''}> double-line pipe</label>` : '',
        t.use === 'ss' || t.use === 'wl' ? `<label class="chk"><input type="checkbox" data-layer="${esc(name)}" data-f="stubs" ${t.stubs ? 'checked' : ''}> skip service stubs (&lt;${STUB_FT} ft)</label>` : '',
        t.use === 'cl' ? `<label class="chk"><input type="checkbox" data-layer="${esc(name)}" data-f="clOnly" ${t.clOnly ? 'checked' : ''}> only lines midway between curbs</label>` : '',
      ].join(' ');
      const symHtml = [...L.syms.entries()].map(([block, pts]) => {
        const k = name + '|' + block, v = symTags.get(k);
        return `<div>${esc(block)} (${pts.length}) <select data-sym="${esc(k)}">${SYM_USES.map(([sv, sl]) => `<option value="${sv}" ${sv === v ? 'selected' : ''}>${sl}</option>`).join('')}</select></div>`;
      }).join('');
      rows.push(`<tr><td>${esc(name)}</td><td class="n">${L.lines.length || ''}</td><td class="n">${L.lines.length ? Math.round(len).toLocaleString() : ''}</td><td class="n">${nSym || ''}</td><td>${lineSel}</td><td>${optsHtml}</td><td>${symHtml}</td></tr>`);
    }
    $('layerTable').tBodies[0].innerHTML = rows.join('');
  }

  // ---------- build design from tags ----------
  function build() {
    const out = { lines: [], structures: [], background: { lots: [], row: [], curb: [], other: [], labels: [] } };
    const curbs = [];
    for (const [name, L] of layers) {
      const t = tags.get(name);
      if (t && t.use.startsWith('bg:')) { const k = t.use.slice(3); out.background[k].push(...L.lines); if (k === 'curb') curbs.push(...L.lines); }
    }
    const perItem = { wl: [], ss: [], sd: [], cl: [] };
    for (const [name, L] of layers) {
      const t = tags.get(name);
      if (!t || !perItem[t.use]) continue;
      let lines = L.lines.filter((p) => G.plen(p) > 1);
      if (t.stubs) lines = lines.filter((p) => G.plen(p) >= STUB_FT);
      if (t.double) lines = G.collapseDouble(lines, 8);
      if (t.use === 'cl' && t.clOnly) lines = G.centerlineParts(lines, curbs);
      perItem[t.use].push(...lines.map((pts) => ({ layer: name, pts })));
    }
    for (const item of Object.keys(perItem)) {
      const arr = perItem[item];
      const keep = G.dedupe(arr.map((l) => l.pts), 3.0); // same line drawn twice, or on two layers
      keep.forEach((i, n) => {
        const key = item + '|' + arr[i].layer + '|' + n;
        out.lines.push({ item, layer: arr[i].layer, pts: arr[i].pts, key, excluded: excluded.has(key) });
      });
    }
    for (const [k, kind] of symTags) {
      if (!kind) continue;
      const [layer, block] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
      for (const [x, y] of (layers.get(layer) && layers.get(layer).syms.get(block)) || []) out.structures.push({ kind, x, y });
    }
    // street names and lot numbers as light labels
    for (const [name, L] of layers) {
      if (!/STREET|LOT[-_ ]?(NO|NUM)|LOT[-_ ]?TXT/i.test(name)) continue;
      for (const t of L.texts.slice(0, 1500)) out.background.labels.push({ t: t.text, x: t.x, y: t.y, s: /STREET/i.test(name) ? 14 : 9 });
    }
    return out;
  }

  const ITEM_NAMES = { wl: 'Waterline', ss: 'Sanitary sewer', sd: 'Storm sewer', cl: 'Street centerline' };
  const KIND = { mh: ['ss', 'Sanitary manholes'], st: ['sd', 'Storm structures'], fh: ['wl', 'Fire hydrants'], vv: ['wl', 'Water valves'] };

  function totals() {
    const rows = [];
    for (const item of ['wl', 'ss', 'sd']) {
      const ls = design.lines.filter((l) => l.item === item && !l.excluded);
      if (ls.length) rows.push(`<tr><td>${ITEM_NAMES[item]}</td><td class="n">${Math.round(ls.reduce((s, l) => s + G.plen(l.pts), 0)).toLocaleString()} LF</td><td class="n mute">${ls.length} lines</td></tr>`);
    }
    const cl = design.lines.filter((l) => l.item === 'cl' && !l.excluded);
    if (cl.length) {
      const ft = Math.round(cl.reduce((s, l) => s + G.plen(l.pts), 0)).toLocaleString();
      for (const [k, name] of [['sg', 'Subgrade'], ['cb', 'Curb and gutter'], ['pv', 'Paving']]) {
        if (k === 'cb' && !$('hasCurb').checked) continue;
        rows.push(`<tr><td>${name}</td><td class="n">${ft} LF</td><td class="n mute">of street centerline (${cl.length} lines)</td></tr>`);
      }
    }
    for (const [kind, [item, label]] of Object.entries(KIND)) {
      const pts = G.dedupePoints(design.structures.filter((s) => s.kind === kind).map((s) => [s.x, s.y]));
      if (!pts.length) continue;
      const ls = design.lines.filter((l) => l.item === item && !l.excluded).map((l) => l.pts);
      const on = ls.length ? G.snapPoints(pts, ls, 10).filter(Boolean).length : 0;
      rows.push(`<tr><td>${label}</td><td class="n">${on} EA</td><td class="n mute">${pts.length - on ? (pts.length - on) + ' not on a line, left out' : ''}</td></tr>`);
    }
    $('previewTotals').innerHTML = rows.length ? `<table><thead><tr><th>Item</th><th class="n">Design (100%)</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="mute">Tag at least one utility or centerline layer.</p>';
  }

  function showLocation() {
    const el = $('siteLoc'); if (!el || !box || !root.AABGeo) return;
    const c = root.AABGeo.toLatLng($('crs').value, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
    el.innerHTML = root.AABGeo.looksOklahoma(c)
      ? `Drawing center: <a href="https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(6)},${c.lng.toFixed(6)}" target="_blank" rel="noopener">${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</a> — open it to check it's the site.`
      : '<span style="color:var(--err)">With this coordinate system the drawing lands outside Oklahoma. Check the coordinate system, or the drawing may not be in state plane; the satellite map and auto location won’t work.</span>';
  }

  function preview() {
    design = build();
    showLocation();
    root.AABPlan.render($('preview'), {
      viewBox: box, background: design.background, labels: design.background.labels, lines: design.lines, structures: design.structures, crs: $('crs').value,
    }, {
      onLineClick: (i) => {
        const l = design.lines[i];
        if (excluded.has(l.key)) excluded.delete(l.key); else excluded.add(l.key);
        l.excluded = !l.excluded;
        rerenderPreviewOnly();
      },
    });
    totals();
  }
  function rerenderPreviewOnly() {
    // keep current zoom by re-rendering with same data
    root.AABPlan.render($('preview'), { viewBox: box, background: design.background, labels: design.background.labels, lines: design.lines, structures: design.structures, crs: $('crs').value }, {
      onLineClick: (i) => { const l = design.lines[i]; if (excluded.has(l.key)) excluded.delete(l.key); else excluded.add(l.key); l.excluded = !l.excluded; rerenderPreviewOnly(); },
    });
    totals();
  }

  let timer;
  const later = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 150); };

  // thin background lines so the saved design stays small
  function thin(pts, tol = 0.5) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) { const a = out[out.length - 1], p = pts[i]; if (Math.hypot(p[0] - a[0], p[1] - a[1]) >= tol) out.push(p); }
    out.push(pts[pts.length - 1]);
    return out.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }

  async function save() {
    const btn = $('saveDesign'), st = $('saveStatus');
    const lines = design.lines.filter((l) => !l.excluded).map((l) => ({ item: l.item, layer: l.layer, pts: l.pts }));
    if (!lines.length) { st.textContent = 'Nothing tagged to save.'; return; }
    const bg = {};
    for (const k of ['lots', 'row', 'curb', 'other']) bg[k] = design.background[k].filter((p) => p.length > 1).map((p) => thin(p));
    bg.labels = design.background.labels;
    btn.disabled = true; st.textContent = 'Saving…';
    try {
      const r = await fetch(`/api/projects/${projectId}/design`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ viewBox: box, background: bg, lines, structures: design.structures, hasCurb: $('hasCurb').checked,
          crs: $('crs').value, useDrawingLocation: !!($('useDrawingLocation') && $('useDrawingLocation').checked) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Save failed');
      st.textContent = `Saved ${j.lines} lines and ${j.structures} structures.`;
      location.href = `/projects/${projectId}`;
    } catch (e) {
      st.textContent = e.message; btn.disabled = false;
    }
  }

  function init(id) {
    projectId = id;
    const f = $('dxfFile');
    if (!f) return;
    f.addEventListener('change', async () => {
      if (!f.files[0]) return;
      all = await readFile(f.files[0]);
      const closedLayers = [...new Set(all.entities.filter((e) => e.type === 'line').map((e) => e.layer))].sort();
      const g = guessBoundary(closedLayers);
      $('boundary').innerHTML = `<option value="">(whole drawing)</option>` + closedLayers.map((n) => `<option ${n === g ? 'selected' : ''}>${esc(n)}</option>`).join('');
      tags.clear(); symTags.clear(); excluded.clear();
      collect(); renderTable();
      // default the curb box from whether any curb layer exists in the drawing
      $('hasCurb').checked = [...layers.keys()].some((n) => /BOC|CURB|FOC|GUTTER/i.test(n) && layers.get(n).lines.length);
      $('setupUI').classList.remove('hide'); preview();
    });
    $('boundary').addEventListener('change', () => { tags.clear(); symTags.clear(); excluded.clear(); collect(); renderTable(); preview(); });
    $('margin').addEventListener('change', () => { excluded.clear(); collect(); renderTable(); preview(); });
    $('layerTable').addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.sym) symTags.set(t.dataset.sym, t.value);
      else if (t.dataset.layer) {
        const tag = tags.get(t.dataset.layer);
        if (t.dataset.f === 'use') { tag.use = t.value; if (['wl', 'ss', 'sd'].includes(tag.use) && !('doubleChecked' in tag)) tag.double = looksDouble(layers.get(t.dataset.layer).lines); }
        else tag[t.dataset.f] = t.checked;
        renderTable();
      }
      excluded.clear();
      later(preview);
    });
    $('saveDesign').addEventListener('click', save);
    $('hasCurb').addEventListener('change', totals);
    $('crs').addEventListener('change', preview);
  }

  root.AABSetup = { init, _guessLine: guessLine, _guessSym: guessSym };
})(window);
