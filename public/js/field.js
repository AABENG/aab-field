// Daily log on the phone: conditions, equipment, work, notes, highlighted
// progress on the design (with structures counted automatically), photos.
// Works offline: edits are kept on the phone and uploaded when signal returns.
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const f0 = (x) => Math.round(x).toLocaleString();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EQUIP = ['Skid steer', 'Mini excavator', 'Excavator', 'Front end loader', 'Dozer', 'Backhoe', 'Trencher', 'Compactor', 'Motor grader', 'Paver', 'Roller', 'Water truck'];
  const WORK = ['Tree clearing', 'Burning', 'Earthwork', 'Waterline', 'Sanitary', 'Storm', 'Subgrade', 'Curb', 'Paving', 'Erosion control'];
  const KIND_ITEM = { mh: 'ss', st: 'sd', fh: 'wl', vv: 'wl' };

  // ---------- small IndexedDB key/value store (drafts + outbox) ----------
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((ok, fail) => {
      const r = indexedDB.open('aabfield', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error);
    }));
    const tx = (mode, fn) => open().then((db) => new Promise((ok, fail) => {
      const t = db.transaction('kv', mode); const s = t.objectStore('kv'); const req = fn(s);
      t.oncomplete = () => ok(req && req.result); t.onerror = () => fail(t.error);
    }));
    return { get: (k) => tx('readonly', (s) => s.get(k)), set: (k, v) => tx('readwrite', (s) => s.put(v, k)), del: (k) => tx('readwrite', (s) => s.delete(k)) };
  })();

  // ---------- intervals ----------
  function union(iv) {
    const a = iv.filter((v) => v[1] - v[0] > 0.3).map((v) => [...v]).sort((p, q) => p[0] - q[0]); const out = [];
    a.forEach((v) => { const l = out[out.length - 1]; if (l && v[0] <= l[1] + 0.3) l[1] = Math.max(l[1], v[1]); else out.push(v); });
    return out;
  }
  function subtract(iv, c) { const out = []; iv.forEach(([a, b]) => { if (c[1] <= a || c[0] >= b) out.push([a, b]); else { if (c[0] > a) out.push([a, c[0]]); if (c[1] < b) out.push([c[1], b]); } }); return out.filter((v) => v[1] - v[0] > 0.3); }
  const minus = (iv, o) => o.reduce((r, c) => subtract(r, c), iv);
  const intersect = (iv, v) => iv.map(([a, b]) => [Math.max(a, v[0]), Math.min(b, v[1])]).filter((x) => x[1] - x[0] > 0.3);
  const len = (iv) => iv.reduce((s, v) => s + v[1] - v[0], 0);

  // ---------- dates (site is in Oklahoma) ----------
  const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const monday = (d) => { const x = new Date(d + 'T12:00:00Z'); const wd = (x.getUTCDay() + 6) % 7; return addDays(d, -wd); };
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

  // ---------- state ----------
  let P, D, lines, lineById, items, plan;
  const S = { date: todayStr(), week: null, item: 'ss', erase: false, online: navigator.onLine, outbox: [], drag: null, preview: null, draft: null };
  const logs = new Map();   // date -> log object
  const prog = new Map();   // date -> Map("line|track" -> intervals)
  const areaMap = new Map(); // date -> [{kind, pts}] (clearing and earthwork areas)
  const AreaJS = root.AABAreas;
  const acN = (sf) => (sf / AreaJS.SQFT_PER_ACRE).toFixed(2);
  const ac = (sf) => acN(sf) + ' ac';
  function dayAreas(date) { let a = areaMap.get(date); if (!a) areaMap.set(date, a = []); return a; }
  function areasWhere(kind, test) { const out = []; for (const [d, a] of areaMap) if (test(d)) a.forEach((x) => { if (x.kind === kind) out.push(x.pts); }); return out; }
  const snapshot = () => JSON.stringify({ p: [...dayMap(S.date)], a: dayAreas(S.date) });
  function restore(j) { const o = JSON.parse(j); prog.set(S.date, new Map(o.p)); areaMap.set(S.date, o.a); }

  const key = (lineId, track) => lineId + '|' + track;
  function dayMap(date) { let m = prog.get(date); if (!m) prog.set(date, m = new Map()); return m; }
  const ivDay = (date, lineId, track) => dayMap(date).get(key(lineId, track)) || [];
  function before(date, lineId, track) { let iv = []; for (const [d, m] of prog) if (d < date) iv = iv.concat(m.get(key(lineId, track)) || []); return union(iv); }
  const through = (date, lineId, track) => union(before(date, lineId, track).concat(ivDay(date, lineId, track)));
  function allDates(lineId, track) { let iv = []; for (const m of prog.values()) iv = iv.concat(m.get(key(lineId, track)) || []); return union(iv); }

  function blankLog(date) {
    return { date, check_in: '', crew: '', no_crew: false, weather: '', rain_in: '', weather_edited: false, equipment: [], work: [], notes: '', photos: [], saved: false, dirty: false, pending: false, hist: [] };
  }
  const log = (date) => logs.get(date) || (logs.set(date, blankLog(date)), logs.get(date));

  // ---------- geometry on a design line ----------
  function prep(l) { l.cum = [0]; for (let i = 1; i < l.pts.length; i++) l.cum.push(l.cum[i - 1] + Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1])); l.len = l.cum[l.cum.length - 1]; }
  function pointAt(l, s) { s = Math.max(0, Math.min(l.len, s)); let i = 1; while (i < l.cum.length - 1 && l.cum[i] < s) i++; const t = (s - l.cum[i - 1]) / ((l.cum[i] - l.cum[i - 1]) || 1); return [l.pts[i - 1][0] + t * (l.pts[i][0] - l.pts[i - 1][0]), l.pts[i - 1][1] + t * (l.pts[i][1] - l.pts[i - 1][1])]; }
  function subPts(l, a, b) { const o = [pointAt(l, a)]; for (let i = 0; i < l.cum.length; i++) if (l.cum[i] > a && l.cum[i] < b) o.push(l.pts[i]); o.push(pointAt(l, b)); return o; }
  function project(l, x, y) {
    let best = { d: Infinity, s: 0 };
    for (let i = 1; i < l.pts.length; i++) {
      const [ax, ay] = l.pts[i - 1], [bx, by] = l.pts[i]; const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); const dd = Math.hypot(x - ax - t * dx, y - ay - t * dy);
      if (dd < best.d) best = { d: dd, s: l.cum[i - 1] + t * (l.cum[i] - l.cum[i - 1]) };
    }
    return best;
  }
  const pathD = (pts) => 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + (-p[1]).toFixed(1)).join(' L');
  const itemLines = (it) => lines.filter((l) => l.item === it.item);

  // ---------- paving order ----------
  const PREREQ = () => (P.has_curb ? { cb: 'sg', pv: 'cb' } : { pv: 'sg' });
  const DEPS = () => (P.has_curb ? { sg: ['cb', 'pv'], cb: ['pv'] } : { sg: ['pv'] });
  const NAMEOF = { sg: 'Subgrade', cb: 'Curb', pv: 'Paving' };

  // ---------- plan layers ----------
  function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  const polyD = (pts) => pathD(pts) + ' Z';
  function drawAreas(g, ftPerPx, it) {
    const ink = { 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' };
    const before = areasWhere(it.area, (d) => d < S.date);
    if (it.area === 'clear') before.forEach((pts) => el('path', { ...ink, d: polyD(pts), fill: 'var(--prior)', 'fill-opacity': 0.16, stroke: 'var(--prior)', 'stroke-opacity': 0.5, 'stroke-width': 1 }, g));
    else areasWhere('earth', (d) => d < S.date && d >= addDays(S.date, -6)).forEach((pts) => el('path', { ...ink, d: polyD(pts), fill: 'none', stroke: it.color, 'stroke-opacity': 0.45, 'stroke-width': 1, 'stroke-dasharray': '4 4' }, g));
    dayAreas(S.date).filter((a) => a.kind === it.area).forEach((a) => el('path', { ...ink, d: polyD(a.pts), fill: it.color, 'fill-opacity': 0.35, stroke: it.color, 'stroke-width': 2.5 }, g));
    const dr = S.draft;
    if (dr && dr.pts.length) {
      el('path', { ...ink, d: pathD(dr.pts), fill: dr.pts.length > 2 ? it.color : 'none', 'fill-opacity': 0.15, stroke: 'var(--today)', 'stroke-width': 2.5, 'stroke-dasharray': '6 4' }, g);
      dr.pts.forEach((q, i) => el('circle', { cx: q[0], cy: -q[1], r: (i ? 4 : 7) * ftPerPx, fill: i ? 'var(--today)' : 'var(--map)', stroke: 'var(--today)', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke' }, g));
    }
  }
  function drawLayers(g, ftPerPx) {
    const it = items[S.item];
    if (it.area) { drawAreas(g, ftPerPx, it); return; }
    const line = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' };
    for (const l of itemLines(it)) {
      const pr = before(S.date, l.id, it.track), td = ivDay(S.date, l.id, it.track);
      pr.forEach((v) => el('path', { ...line, d: pathD(subPts(l, v[0], v[1])), stroke: 'var(--prior)', 'stroke-width': 6 }, g));
      td.forEach((v) => el('path', { ...line, d: pathD(subPts(l, v[0], v[1])), stroke: 'var(--today)', 'stroke-width': 7, style: 'filter:drop-shadow(0 0 5px var(--today))' }, g));
      td.forEach((v) => [v[0], v[1]].forEach((s) => { const [x, y] = pointAt(l, s); el('circle', { cx: x, cy: -y, r: 4.5 * ftPerPx, fill: 'var(--map)', stroke: 'var(--today)', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke' }, g); }));
    }
    if (S.preview) {
      const l = lineById.get(S.preview.line);
      el('path', { ...line, d: pathD(subPts(l, S.preview.a, S.preview.b)), stroke: S.erase ? 'rgba(255,90,90,.7)' : 'rgba(255,176,32,.7)', 'stroke-width': 12 }, g);
    }
  }
  function structureState(s) {
    const item = KIND_ITEM[s.kind];
    const covered = (iv) => iv.some((v) => s.station >= v[0] - 3 && s.station <= v[1] + 3);
    if (covered(before(S.date, s.line, 'line'))) return 'prior';
    if (covered(ivDay(S.date, s.line, 'line'))) return 'today';
    void item; return null;
  }
  function lineStyle(l) {
    const it = items[S.item];
    if (it.area) return { width: 2, opacity: 0.3 };
    return l.item === it.item ? { width: 5, opacity: 0.45 } : { width: 2, opacity: 0.25 };
  }

  // ---------- highlighting ----------
  function snap(lineId, track, s, tol) {
    const l = lineById.get(lineId); const ends = [0, l.len];
    union(before(S.date, lineId, track).concat(ivDay(S.date, lineId, track))).forEach((v) => ends.push(v[0], v[1]));
    let best = s, bd = tol; ends.forEach((e) => { if (Math.abs(e - s) < bd) { bd = Math.abs(e - s); best = e; } }); return best;
  }
  const pointer = {
    down(pt, ftPerPx) {
      const L = log(S.date);
      const it = items[S.item];
      if (L.no_crew || it.area) return false; // areas are drawn by tapping corners
      let best = null;
      for (const l of itemLines(it)) { const q = project(l, pt.x, pt.y); if (!best || q.d < best.d) best = { ...q, line: l.id }; }
      if (!best || best.d > 18 * ftPerPx) return false;
      const s0 = snap(best.line, it.track, best.s, Math.min(12 * ftPerPx, 10));
      S.drag = { line: best.line, s0, s1: s0, moved: false, ftPerPx };
      return true;
    },
    move(pt) {
      const d = S.drag; if (!d) return;
      const l = lineById.get(d.line), it = items[S.item];
      d.s1 = snap(d.line, it.track, project(l, pt.x, pt.y).s, Math.min(12 * d.ftPerPx, 10));
      if (Math.abs(d.s1 - d.s0) > 2) d.moved = true;
      S.preview = { line: d.line, a: Math.min(d.s0, d.s1), b: Math.max(d.s0, d.s1) };
      $('todayFt').textContent = (S.erase ? '− ' : '+ ') + f0(S.preview.b - S.preview.a) + ' LF';
      plan.refresh();
    },
    up() {
      const d = S.drag; S.drag = null; S.preview = null;
      if (!d) return;
      if (!d.moved) { toast(S.erase ? 'Drag along the highlighted line to erase' : 'Drag along the line to highlight'); render(); return; }
      apply(d.line, [Math.min(d.s0, d.s1), Math.max(d.s0, d.s1)]);
    },
  };
  // Areas: tap the corners; tap the first corner (or Finish) to close it.
  // In erase mode a tap inside one of today's areas removes it.
  function tap(pt, ftPerPx) {
    const it = items[S.item]; if (!it.area) return;
    const L = log(S.date);
    if (L.no_crew) { toast('This day is marked no crew on site'); return; }
    if (S.erase) {
      const list = dayAreas(S.date), i = list.findIndex((a) => a.kind === it.area && AreaJS.inside(a.pts, pt.x, pt.y));
      if (i < 0) { toast('Tap inside one of today’s areas to remove it'); return; }
      L.hist.push(snapshot()); list.splice(i, 1); changed(); return;
    }
    if (!S.draft) S.draft = { kind: it.area, pts: [] };
    const f = S.draft.pts[0];
    if (S.draft.pts.length >= 3 && Math.hypot(pt.x - f[0], pt.y - f[1]) < 16 * ftPerPx) { finishArea(); return; }
    S.draft.pts.push([pt.x, pt.y]);
    render();
  }
  function finishArea() {
    const d = S.draft; if (!d) return;
    if (d.pts.length < 3) { toast('Tap at least three corners'); return; }
    const L = log(S.date), it = items[S.item];
    L.hist.push(snapshot());
    dayAreas(S.date).push({ kind: d.kind, pts: d.pts.map((q) => [+q[0].toFixed(2), +q[1].toFixed(2)]) });
    S.draft = null;
    if (!L.work.includes(it.work)) L.work.push(it.work);
    toast(`${it.name} area added · ${ac(AreaJS.sqft(d.pts))}`);
    changed();
  }
  function dropDraft() { if (S.draft && S.draft.pts.length) toast('Unfinished area dropped'); S.draft = null; }

  function apply(lineId, v) {
    const it = items[S.item], L = log(S.date), track = it.track;
    let pieces = [v];
    if (!S.erase && PREREQ()[track]) {
      const need = PREREQ()[track];
      pieces = intersect(through(S.date, lineId, need), v);
      if (!len(pieces)) { toast(NAMEOF[need] + ' has to be done there first'); render(); return; }
      if (v[1] - v[0] - len(pieces) > 2) toast(`Recorded ${f0(len(pieces))} LF — the rest needs ${NAMEOF[need].toLowerCase()} first`);
    }
    if (S.erase && DEPS()[track]) {
      const blocked = union(DEPS()[track].flatMap((x) => allDates(lineId, x)));
      pieces = minus([v], blocked);
      if (!len(pieces)) { toast(`Can’t erase: ${DEPS()[track].map((x) => NAMEOF[x].toLowerCase()).join(' / ')} is recorded on top of it`); render(); return; }
      if (v[1] - v[0] - len(pieces) > 2) toast(`Kept the part with ${DEPS()[track].map((x) => NAMEOF[x].toLowerCase()).join(' / ')} on top`);
    }
    L.hist.push(snapshot());
    let cur = ivDay(S.date, lineId, track);
    pieces.forEach((pc) => { cur = S.erase ? subtract(cur, pc) : union(cur.concat([pc])); });
    dayMap(S.date).set(key(lineId, track), minus(cur, before(S.date, lineId, track)));
    if (!S.erase && !L.work.includes(it.work)) L.work.push(it.work);
    changed();
  }

  // ---------- rendering ----------
  function render() {
    const L = log(S.date), it = items[S.item];
    // week
    const wk = S.week, today = todayStr();
    $('wkLabel').textContent = `Week of ${md(wk)}`;
    $('nextWk').disabled = addDays(wk, 7) > today;
    $('days').innerHTML = DOW.map((n, i) => {
      const d = addDays(wk, i), X = logs.get(d);
      const tag = X && X.pending ? '<i class="pend">waiting</i>' : X && X.dirty ? '<i class="pend">not saved</i>' : X && X.saved ? '<i>✓ saved</i>' : '<i></i>';
      return `<button type="button" class="day ${d === S.date ? 'on' : ''}" data-d="${d}" ${d > today ? 'disabled' : ''}><b>${n}</b><span>${md(d)}</span>${tag}</button>`;
    }).join('');
    // form
    ['check_in', 'crew', 'weather', 'rain_in', 'notes'].forEach((id) => { if (document.activeElement !== $(id)) $(id).value = L[id] ?? ''; });
    $('wxsrc').textContent = L.weather_edited ? '● Edited by CO' : L.weather ? '● From National Weather Service' : '';
    $('wxsrc').className = 'auto' + (L.weather_edited ? ' edit' : '');
    [...$('equip').children].forEach((b) => b.classList.toggle('on', L.equipment.includes(b.textContent)));
    [...$('work').children].forEach((b) => b.classList.toggle('on', L.work.includes(b.textContent)));
    $('no_crew').classList.toggle('on', L.no_crew); $('no_crew').textContent = L.no_crew ? 'No crew on site ✓' : 'Mark no crew on site';
    // items + stats
    $('items').innerHTML = Object.entries(items).map(([k, x]) => `<button type="button" class="chip ${k === S.item ? 'on' : ''}" data-i="${k}"><i style="background:${x.color}"></i>${x.name}</button>`).join('');
    $('remSw').style.background = it.color;
    $('finishBtn').hidden = !(it.area && S.draft);
    $('finishBtn').disabled = !(S.draft && S.draft.pts.length >= 3);
    $('hint').textContent = it.area
      ? (S.erase ? 'Tap inside one of today’s areas to remove it.' : `Tap the corners of the ${it.area === 'clear' ? 'ground cleared' : 'area where dirt work went on'} today, then tap the first corner or Finish. Drag to move the plan.`)
      : 'Drag your finger along the selected line over what went in today; structures and fittings on that stretch are counted. Drag off the line to move the plan. Paving goes in order: subgrade, then curb, then paving.';
    $('undoBtn').disabled = !L.hist.length && !S.draft;
    if (it.area) {
      const today = dayAreas(S.date).filter((a) => a.kind === it.area).map((a) => a.pts);
      if (it.area === 'clear') {
        const prior = AreaJS.unionSqft(areasWhere('clear', (d) => d < S.date)), thru = AreaJS.unionSqft(areasWhere('clear', (d) => d <= S.date));
        $('todayFt').textContent = acN(Math.max(0, thru - prior)); $('todayLbl').textContent = 'Acres cleared today';
        $('toDate').textContent = acN(thru); $('toDateLbl').textContent = 'Acres to date';
      } else {
        $('todayFt').textContent = acN(AreaJS.unionSqft(today)); $('todayLbl').textContent = 'Acres worked today';
        $('toDate').textContent = acN(AreaJS.unionSqft(areasWhere('earth', (d) => d <= S.date))); $('toDateLbl').textContent = 'Acres to date';
      }
      $('todayEa').textContent = String(today.length); $('todayEaLbl').textContent = 'Areas today';
      $('photos').innerHTML = L.photos.map((ph, i) => `<div class="ph"><img src="${ph.id ? '/photos/' + ph.id : ph.data}" alt="">${ph.id ? '' : '<em>waiting</em>'}<button type="button" data-ph="${i}" title="Remove">×</button></div>`).join('');
      renderBar(); if (plan) plan.refresh();
      return;
    }
    $('todayEaLbl').textContent = 'Structures today'; $('toDateLbl').textContent = 'Complete';
    const ils = itemLines(it);
    const today_ft = ils.reduce((s, l) => s + len(ivDay(S.date, l.id, it.track)), 0);
    const total = ils.reduce((s, l) => s + l.len, 0), done = ils.reduce((s, l) => s + len(through(S.date, l.id, it.track)), 0);
    $('todayFt').textContent = f0(today_ft) + ' LF'; $('todayLbl').textContent = it.name + ' today';
    $('toDate').textContent = total ? Math.round(100 * done / total) + '%' : '—';
    const sts = it.track === 'line' ? D.structures.filter((s) => KIND_ITEM[s.kind] === it.item) : [];
    $('todayEa').textContent = it.track === 'line' ? String(sts.filter((s) => structureState(s) === 'today').length) : '—';
    // photos
    $('photos').innerHTML = L.photos.map((ph, i) => `<div class="ph"><img src="${ph.id ? '/photos/' + ph.id : ph.data}" alt="">${ph.id ? '' : '<em>waiting</em>'}<button type="button" data-ph="${i}" title="Remove">×</button></div>`).join('');
    renderBar();
    if (plan) plan.refresh();
  }
  function renderBar() {
    const L = log(S.date);
    const n = S.outbox.length;
    $('syncBtn').innerHTML = S.online ? `<span class="dot" style="background:var(--ok);color:var(--ok)"></span>Online${n ? ' · ' + n + ' waiting' : ''}` : `<span class="dot" style="background:var(--warn);color:var(--warn)"></span>Offline${n ? ' · ' + n + ' waiting' : ''}`;
    $('saveBtn').disabled = L.saved && !L.dirty && !L.pending;
    $('saveBtn').textContent = L.saved && !L.dirty ? (L.pending ? 'Waiting for signal' : 'Saved ✓') : `Save ${DOW[(new Date(S.date + 'T12:00:00Z').getUTCDay() + 6) % 7] || ''} log`;
    $('saveState').textContent = L.dirty ? 'Changes not saved' : L.pending ? 'Saved on phone' : '';
  }

  let draftTimer;
  function changed() {
    const L = log(S.date); L.dirty = true;
    clearTimeout(draftTimer); draftTimer = setTimeout(saveDrafts, 400);
    render();
  }
  // Unsaved or not-yet-uploaded days are kept on the phone across reloads.
  function saveDrafts() {
    const out = {};
    for (const [d, L] of logs) if (L.dirty || L.pending) out[d] = { log: { ...L, hist: [] }, prog: [...dayMap(d)], areas: dayAreas(d) };
    return idb.set('draft:' + P.id, out).catch(() => {});
  }

  // ---------- weather ----------
  async function autoWeather(force) {
    const L = log(S.date), date = S.date;
    if (L.weather_edited || (!force && L.weather) || P.lat == null || !S.online) return;
    try {
      const r = await fetch(`/api/projects/${P.id}/weather?date=${date}&time=${encodeURIComponent(L.check_in || '')}`);
      if (!r.ok) return;
      const w = await r.json();
      const X = log(date); if (X.weather_edited) return;
      X.weather = w.text; X.rain_in = w.rain_in.toFixed(2);
      if (X.saved && !X.dirty) X.dirty = true;
      if (date === S.date) render();
    } catch (e) { /* stays blank; CO can type it */ }
  }

  // ---------- saving + outbox ----------
  function body(date) {
    const L = log(date), rows = [];
    for (const [k, iv] of dayMap(date)) { const [line_id, track] = k.split('|'); iv.forEach(([a, b]) => rows.push({ line_id: +line_id, track, from: +a.toFixed(2), to: +b.toFixed(2) })); }
    return { check_in: L.check_in, crew: L.crew, no_crew: L.no_crew, weather: L.weather, rain_in: L.rain_in, weather_edited: L.weather_edited,
      equipment: L.equipment, work: L.work, notes: L.notes, progress: rows, areas: dayAreas(date) };
  }
  async function save() {
    const date = S.date, L = log(date);
    if (!L.check_in) L.check_in = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
    S.outbox = S.outbox.filter((o) => !(o.kind === 'log' && o.date === date));
    S.outbox.unshift({ kind: 'log', date, body: body(date) });
    L.photos.forEach((ph, i) => { if (!ph.id && !S.outbox.some((o) => o.kind === 'photo' && o.ref === ph.ref)) S.outbox.push({ kind: 'photo', date, ref: ph.ref, photo: ph, idx: i }); });
    L.dirty = false; L.pending = true; L.saved = true; L.hist = [];
    await persistOutbox(); await saveDrafts();
    render();
    await flush(true);
  }
  async function persistOutbox() { return idb.set('outbox:' + P.id, S.outbox).catch(() => {}); }
  let flushing = false;
  async function flush(announce) {
    if (flushing || !S.outbox.length) return;
    flushing = true;
    try {
      // logs first (photos need their day's log to exist)
      S.outbox.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'log' ? -1 : 1));
      while (S.outbox.length) {
        const o = S.outbox[0];
        let r;
        try {
          r = o.kind === 'log'
            ? await fetch(`/api/projects/${P.id}/logs/${o.date}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o.body) })
            : await fetch(`/api/projects/${P.id}/logs/${o.date}/photos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: o.photo.data, taken_at: o.photo.taken_at, lat: o.photo.lat, lng: o.photo.lng }) });
        } catch (e) { setOnline(false); if (announce) toast('No signal — saved on the phone, will upload when signal returns'); break; }
        setOnline(true);
        if (r.status === 401) { toast('Signed out — sign in again to upload'); break; }
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          S.outbox.shift();
          if (o.kind === 'log') { const L = log(o.date); L.pending = false; L.dirty = true; L.saved = false; }
          toast(j.error || 'The server refused that change');
          continue;
        }
        const j = await r.json().catch(() => ({}));
        S.outbox.shift();
        if (o.kind === 'photo') { const L = log(o.date); const ph = L.photos.find((p) => p.ref === o.ref); if (ph) { ph.id = j.id; delete ph.data; } }
        const L = log(o.date);
        if (!S.outbox.some((x) => x.date === o.date)) { L.pending = false; if (announce && o.date === S.date) toast('Saved and uploaded'); }
        await persistOutbox();
      }
    } finally {
      flushing = false;
      await persistOutbox(); await saveDrafts(); render();
    }
  }
  function setOnline(v) { if (S.online !== v) { S.online = v; renderBar(); } }

  // ---------- photos ----------
  function addPhotos(files) {
    const L = log(S.date);
    const here = new Promise((ok) => { if (!navigator.geolocation) return ok(null); navigator.geolocation.getCurrentPosition((p) => ok(p.coords), () => ok(null), { timeout: 4000, maximumAge: 60000 }); });
    [...files].forEach((file) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = async () => {
        const c = document.createElement('canvas'), s = Math.min(1, 1600 / Math.max(img.width, img.height));
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const pos = await here;
        L.photos.push({ ref: Date.now() + '-' + Math.random().toString(36).slice(2), data: c.toDataURL('image/jpeg', 0.72),
          taken_at: new Date(file.lastModified || Date.now()).toISOString(), lat: pos && pos.latitude, lng: pos && pos.longitude });
        changed();
      };
      img.src = url;
    });
  }
  async function removePhoto(i) {
    const L = log(S.date), ph = L.photos[i];
    if (ph.id) {
      if (!S.online) { toast('Photos already uploaded can only be removed with signal'); return; }
      const r = await fetch('/api/photos/' + ph.id, { method: 'DELETE' }).catch(() => null);
      if (!r || !r.ok) { toast('Could not remove the photo'); return; }
    }
    S.outbox = S.outbox.filter((o) => !(o.kind === 'photo' && o.ref === ph.ref));
    L.photos.splice(i, 1); await persistOutbox(); if (!ph.id) changed(); else render();
  }

  // ---------- misc ----------
  let tt; function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 3200); }
  function selectDay(d) { dropDraft(); S.date = d; render(); autoWeather(false); }

  function bind() {
    $('days').addEventListener('click', (e) => { const b = e.target.closest('.day'); if (b && !b.disabled) selectDay(b.dataset.d); });
    $('prevWk').onclick = () => { S.week = addDays(S.week, -7); selectDay(addDays(S.week, 4)); };
    $('nextWk').onclick = () => { S.week = addDays(S.week, 7); const t = todayStr(); selectDay(addDays(S.week, 4) > t ? t : addDays(S.week, 4)); };
    const chipBox = (id, list, field) => {
      $(id).innerHTML = list.map((n) => `<button type="button" class="chip">${esc(n)}</button>`).join('');
      $(id).onclick = (e) => { const b = e.target.closest('.chip'); if (!b) return; const a = log(S.date)[field]; const i = a.indexOf(b.textContent); if (i < 0) a.push(b.textContent); else a.splice(i, 1); changed(); };
    };
    chipBox('equip', EQUIP, 'equipment'); chipBox('work', WORK.filter((w) => w !== 'Curb' || P.has_curb), 'work');
    ['check_in', 'crew', 'weather', 'rain_in', 'notes'].forEach((id) => $(id).addEventListener('input', (e) => {
      const L = log(S.date); L[id] = e.target.value; if (id === 'weather' || id === 'rain_in') L.weather_edited = true; changed();
    }));
    $('check_in').addEventListener('change', () => autoWeather(true));
    $('no_crew').onclick = () => { const L = log(S.date); L.no_crew = !L.no_crew; if (L.no_crew) { L.crew = '0'; if (!L.notes) L.notes = 'No crew on site.'; } changed(); };
    $('items').onclick = (e) => { const b = e.target.closest('.chip'); if (b && b.dataset.i !== S.item) { dropDraft(); S.item = b.dataset.i; render(); } };
    document.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { S.erase = b.dataset.mode === 'erase'; if (S.erase) dropDraft(); document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b)); render(); });
    $('undoBtn').onclick = () => {
      if (S.draft) { S.draft.pts.pop(); if (!S.draft.pts.length) S.draft = null; render(); return; }
      const L = log(S.date); if (L.hist.length) { restore(L.hist.pop()); changed(); }
    };
    $('finishBtn').onclick = finishArea;
    $('photoIn').onchange = (e) => { addPhotos(e.target.files); e.target.value = ''; };
    $('photos').onclick = (e) => { const b = e.target.closest('[data-ph]'); if (b) removePhoto(+b.dataset.ph); };
    $('saveBtn').onclick = save;
    $('syncBtn').onclick = () => flush(true);
    window.addEventListener('online', () => { setOnline(true); flush(false); });
    window.addEventListener('offline', () => setOnline(false));
    setInterval(() => { if (S.outbox.length) flush(false); }, 30000);
    window.addEventListener('beforeunload', (e) => { if ([...logs.values()].some((L) => L.dirty)) { e.preventDefault(); e.returnValue = ''; } });
  }

  async function init(projectId) {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      // keep a copy of this page and its data so it opens with no signal next time
      navigator.serviceWorker.ready.then(() => caches.open('aabfield-v2')).then((c) =>
        c.addAll([location.pathname, `/api/projects/${projectId}/design`, `/api/projects/${projectId}/field`])).catch(() => {});
    }
    S.week = monday(S.date);
    let field;
    try {
      [D, field] = await Promise.all([fetch(`/api/projects/${projectId}/design`).then((r) => r.json()), fetch(`/api/projects/${projectId}/field`).then((r) => r.json())]);
    } catch (e) { toast('Couldn’t load the project — check signal and reload'); return; }
    P = { id: projectId, ...D.project };
    lines = D.lines; lines.forEach(prep); lineById = new Map(lines.map((l) => [l.id, l]));
    items = {
      clear: { name: 'Clearing', area: 'clear', color: 'var(--clear)', work: 'Tree clearing' },
      earth: { name: 'Earthwork', area: 'earth', color: 'var(--earth)', work: 'Earthwork' },
    };
    const hasItem = (i) => lines.some((l) => l.item === i);
    if (hasItem('wl')) items.wl = { name: 'Waterline', item: 'wl', track: 'line', color: 'var(--wl)', work: 'Waterline' };
    if (hasItem('ss')) items.ss = { name: 'Sanitary', item: 'ss', track: 'line', color: 'var(--ss)', work: 'Sanitary' };
    if (hasItem('sd')) items.sd = { name: 'Storm', item: 'sd', track: 'line', color: 'var(--sd)', work: 'Storm' };
    if (hasItem('cl')) {
      items.sg = { name: 'Subgrade', item: 'cl', track: 'sg', color: 'var(--sg)', work: 'Subgrade' };
      if (P.has_curb) items.cb = { name: 'Curb', item: 'cl', track: 'cb', color: 'var(--cb)', work: 'Curb' };
      items.pv = { name: 'Paving', item: 'cl', track: 'pv', color: 'var(--pv)', work: 'Paving' };
    }
    S.item = items.ss ? 'ss' : Object.keys(items).find((k) => !items[k].area) || 'clear';
    // server data
    for (const r of field.progress) { const m = dayMap(r.date), k = key(r.line_id, r.track); m.set(k, union((m.get(k) || []).concat([[r.from, r.to]]))); }
    for (const a of field.areas || []) dayAreas(a.date).push({ kind: a.kind, pts: a.pts });
    for (const l of field.logs) logs.set(l.date, { ...blankLog(l.date), ...l, crew: l.crew ?? '', rain_in: l.rain_in == null ? '' : Number(l.rain_in).toFixed(2), saved: true });
    // phone-side drafts and waiting uploads override the server copy
    const drafts = (await idb.get('draft:' + projectId).catch(() => null)) || {};
    for (const [d, x] of Object.entries(drafts)) { logs.set(d, { ...blankLog(d), ...x.log, hist: [] }); prog.set(d, new Map(x.prog)); areaMap.set(d, x.areas || []); }
    S.outbox = (await idb.get('outbox:' + projectId).catch(() => null)) || [];
    bind();
    plan = root.AABPlan.render($('plan'), { viewBox: D.viewBox, background: D.background || {}, labels: (D.background || {}).labels, lines, structures: D.structures, crs: P.crs },
      { legend: false, layers: drawLayers, structureState, lineStyle, pointer, tap, toast });
    render();
    autoWeather(false);
    flush(false);
  }

  root.AABField = { init, _test: { union, minus, intersect } };
})(window);
