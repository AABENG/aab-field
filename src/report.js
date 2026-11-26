// Weekly construction observation report as a PDF:
//   page 1+  project, approval, progress table, engineer's notes, daily log
//   exhibit  plan with this week's work against earlier work and what's left
//   photos   the week's photos, six to a page
const fs = require('fs');
const path = require('path');
const { PDF } = require('./pdf');
const Q = require('./quantities');
const A = require('../public/js/areas');
const P = require('./progress');
const R_addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const NAVY = '#0b1424', INK = '#111827', MUTE = '#5a6684', LINE = '#d6dce8', ACCENT = '#1f66e0';
const COLOR = { wl: '#1f6fd1', ss: '#1f9a4a', sd: '#d1491f', sg: '#b07a43', cb: '#7e8aa3', pv: '#2b3446', clear: '#d4b106', earth: '#7a4fd6' };
const KIND_ITEM = { mh: 'ss', st: 'sd', fh: 'wl', vv: 'wl' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d) => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7));
const nice = (d) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const fmt = (unit, v) => (v == null ? '—' : unit === 'AC' ? v.toFixed(2) : Math.round(v).toLocaleString('en-US'));

function build(data, c, weekStart, opt = {}) {
  const p = data.project, weekEnd = addDays(weekStart, 5);
  const pdf = new PDF();
  const { week, toDate } = Q.summarize(c, weekStart, weekEnd);
  const days = DOW.map((n, i) => ({ n, date: addDays(weekStart, i) }));
  const weekLogs = data.logs.filter((l) => l.date >= weekStart && l.date <= weekEnd);
  const firstLog = data.logs.length ? data.logs[0].date : weekStart;
  const reportNo = Math.floor((Date.parse(weekStart) - Date.parse(mondayOf(firstLog))) / (7 * 864e5)) + 1;
  const authors = [...new Set(weekLogs.map((l) => l.author))];
  const M = 40, CW = 612 - 2 * M;

  // ---------- page 1 ----------
  let y;
  const header = (sub) => {
    pdf.rect(0, 0, pdf.W, 64, { fill: NAVY });
    pdf.text(M, 14, 'AAB ENGINEERING, LLC', { size: 8, bold: true, color: '#8fb4ff' });
    pdf.text(M, 28, sub || 'Weekly Construction Observation Report', { size: 15, bold: true, color: '#ffffff' });
    pdf.text(pdf.W - M, 16, `Week of ${nice(weekStart)} – ${nice(weekEnd)}, ${weekEnd.slice(0, 4)}`, { size: 10, color: '#ffffff', align: 'right' });
    pdf.text(pdf.W - M, 32, `Report No. ${reportNo}`, { size: 9, color: '#b9c6e4', align: 'right' });
    if (opt.status !== 'approved' && opt.status !== 'sent') {
      pdf.rect(0, 64, pdf.W, 16, { fill: '#fde8e8' });
      pdf.text(pdf.W / 2, 67, 'DRAFT – NOT YET REVIEWED AND APPROVED', { size: 8, bold: true, color: '#b42318', align: 'center' });
      return 92;
    }
    return 80;
  };
  pdf.addPage(); y = header();
  pdf.text(M, y, p.name, { size: 15, bold: true, color: INK }); y += 20;
  pdf.text(M, y, `Project ${p.job_no}${p.wo_no ? '  ·  WO ' + p.wo_no : ''}${p.client ? '  ·  ' + p.client : ''}`, { size: 9.5, color: MUTE }); y += 14;
  pdf.text(M, y, `Construction observation: ${authors.length ? authors.join(', ') : '—'}`, { size: 9.5, color: MUTE }); y += 14;
  if (opt.status === 'approved' || opt.status === 'sent') {
    const bx = pdf.W - M - 170;
    pdf.rect(bx, y - 44, 170, 38, { stroke: '#14804a', width: 1.2 });
    pdf.text(bx + 85, y - 39, 'REVIEWED AND APPROVED', { size: 8.5, bold: true, color: '#14804a', align: 'center' });
    pdf.text(bx + 85, y - 26, `${opt.approvedBy || ''}  ·  ${opt.approvedAt ? nice(opt.approvedAt) + ', ' + opt.approvedAt.slice(0, 4) : ''}`, { size: 8.5, color: INK, align: 'center' });
  }
  y += 8;

  const section = (title) => {
    pdf.text(M, y, title.toUpperCase(), { size: 8.5, bold: true, color: ACCENT }); y += 13;
    pdf.line(M, y, M + CW, y, { stroke: LINE, width: 0.8 }); y += 6;
  };
  const newPageIfNeeded = (need) => { if (y + need > 792 - 50) { pdf.addPage(); y = header() + 4; return true; } return false; };

  // progress table
  section('Progress');
  const cols = [M, M + 200, M + 285, M + 370, M + 455];
  const head = ['Item', 'Design (100%)', 'This week', 'To date', 'Complete'];
  head.forEach((h, i) => pdf.text(i ? cols[i] + 70 : cols[i], y, h, { size: 8, bold: true, color: MUTE, align: i ? 'right' : 'left' }));
  y += 14;
  let shade = false;
  for (const [k, name, unit] of Q.ITEMS) {
    if (k === 'earth') continue;
    const d = c.design[k], t = toDate[k] || 0, w = week[k] || 0;
    if (!d && !t) continue;
    if (shade) pdf.rect(M - 4, y - 3, CW + 8, 15, { fill: '#f3f5f9' });
    shade = !shade;
    const label = k === 'clear' && !d ? 'Clearing (no limits of clearing set)' : name;
    pdf.text(cols[0], y, label, { size: 9, color: INK });
    pdf.text(cols[1] + 70, y, d ? `${fmt(unit, d)} ${unit}` : '—', { size: 9, color: INK, align: 'right' });
    pdf.text(cols[2] + 70, y, w ? `${fmt(unit, w)} ${unit}` : '—', { size: 9, bold: !!w, color: w ? INK : MUTE, align: 'right' });
    pdf.text(cols[3] + 70, y, `${fmt(unit, t)} ${unit}`, { size: 9, color: INK, align: 'right' });
    const pct = d ? Math.min(100, Math.round(100 * t / d)) : null;
    if (pct != null) {
      pdf.rect(cols[4] + 6, y + 1.5, 44, 6, { fill: '#e6eaf2' });
      if (pct) pdf.rect(cols[4] + 6, y + 1.5, 44 * pct / 100, 6, { fill: COLOR[k] || COLOR[KIND_ITEM[k]] || ACCENT });
      pdf.text(cols[4] + 76, y, pct + '%', { size: 9, color: INK, align: 'right' });
    } else pdf.text(cols[4] + 76, y, '—', { size: 9, color: MUTE, align: 'right' });
    y += 15;
  }
  const earthDays = c.days.filter((x) => x.date >= weekStart && x.date <= weekEnd && x.q.earth).length;
  if (earthDays || data.areas.some((a) => a.kind === 'earth')) {
    pdf.text(cols[0], y, 'Earthwork', { size: 9, color: INK });
    pdf.text(cols[2] + 70, y, earthDays ? `${earthDays} day${earthDays > 1 ? 's' : ''}` : '—', { size: 9, bold: !!earthDays, color: INK, align: 'right' });
    pdf.text(M + CW, y, 'Active areas each day are on the exhibit', { size: 8, color: MUTE, align: 'right' });
    y += 15;
  }
  pdf.text(M, y + 2, 'Design quantities are taken from the design drawing. Structures are counted when the line through them is recorded.', { size: 7.5, color: MUTE });
  y += 20;

  if (opt.notes) {
    section("Engineer's notes");
    y += pdf.para(M, y, opt.notes, CW, { size: 9.5, color: INK }) + 10;
  }

  // daily log
  section('Daily log');
  const dc = [M, M + 58, M + 200, M + 236, M + 380], dw = [54, 136, 32, 140, M + CW - (M + 380)];
  const dayHead = () => {
    ['Day', 'Conditions', 'Crew', 'Equipment / work', 'Notes'].forEach((h, i) => pdf.text(dc[i], y, h, { size: 8, bold: true, color: MUTE }));
    y += 13;
  };
  dayHead();
  for (const d of days) {
    const L = data.logs.find((l) => l.date === d.date);
    const cells = L ? [
      [`${d.n} ${md(d.date)}`],
      pdf.wrap([L.weather || '', L.rain_in != null ? `Rain (24 hr): ${Number(L.rain_in).toFixed(2)} in` : '', L.check_in ? `Check-in ${L.check_in}` : ''].filter(Boolean).join('\n'), dw[1], 8.5),
      [L.no_crew ? 'None' : L.crew_count == null ? '—' : String(L.crew_count)],
      pdf.wrap([L.equipment.join(', '), L.work.length ? 'Work: ' + L.work.join(', ') : ''].filter(Boolean).join('\n') || '—', dw[3], 8.5),
      pdf.wrap(L.notes || '—', dw[4], 8.5),
    ] : [[`${d.n} ${md(d.date)}`], ['No log'], [''], [''], ['']];
    const h = Math.max(...cells.map((x) => x.length)) * 11 + 8;
    if (newPageIfNeeded(h)) { section('Daily log (continued)'); dayHead(); }
    pdf.line(M, y - 3, M + CW, y - 3, { stroke: LINE, width: 0.5 });
    cells.forEach((lines, i) => lines.forEach((t, j) => pdf.text(dc[i], y + 1 + j * 11, t, { size: 8.5, bold: i === 0, color: L ? INK : MUTE })));
    y += h;
  }

  // ---------- exhibit ----------
  exhibit(pdf, data, c, weekStart, weekEnd, header);

  // ---------- photos ----------
  const photos = weekLogs.flatMap((l) => l.photos.map((ph) => ({ ...ph, date: l.date })));
  if (photos.length) {
    const cw = (CW - 14) / 2, ch = 190;
    let i = 0;
    for (const ph of photos) {
      let buf; try { buf = fs.readFileSync(path.join(opt.uploadDir || '.', path.basename(ph.file_name))); } catch (e) { continue; }
      if (i % 6 === 0) { pdf.addPage(); y = header('Site photos'); }
      const col = i % 2, row = Math.floor((i % 6) / 2);
      const x = M + col * (cw + 14), yy = y + 4 + row * (ch + 34);
      pdf.image(buf, x, yy, cw, ch);
      pdf.rect(x, yy, cw, ch, { stroke: LINE, width: 0.6 });
      const when = ph.taken_at ? require('./db').utc(ph.taken_at).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : `${md(ph.date)}`;
      pdf.text(x, yy + ch + 5, when + (ph.caption ? '  ·  ' + ph.caption : ''), { size: 8, color: MUTE });
      i++;
    }
  }

  // ---------- footers ----------
  pdf.pages.forEach((pg, i) => {
    pdf.page = pg;
    pdf.text(M, pg.h - 28, `${p.name}  ·  Project ${p.job_no}${p.wo_no ? '  ·  WO ' + p.wo_no : ''}  ·  Week ending ${md(weekEnd)}/${weekEnd.slice(0, 4)}`, { size: 7.5, color: MUTE });
    pdf.text(pg.w - M, pg.h - 28, `Page ${i + 1} of ${pdf.pages.length}`, { size: 7.5, color: MUTE, align: 'right' });
  });
  return pdf.build({ title: `${p.name} – Weekly report – week of ${nice(weekStart)}, ${weekStart.slice(0, 4)}` });
}

// One exhibit page per utility (and one for streets, one for clearing and
// earthwork), each showing only that work in three unmistakable styles:
//   earlier weeks = solid color; this week = color on a yellow highlighter band;
//   still to install = thin dashed line. The legend carries the quantities.
const HILITE = '#ffd23f';
const UTIL = [['wl', 'Waterline', ['fh', 'vv']], ['ss', 'Sanitary sewer', ['mh']], ['sd', 'Storm sewer', ['st']]];
const KIND_LABEL = { mh: 'manholes', st: 'storm structures', fh: 'fire hydrants', vv: 'water valves' };

function exhibit(pdf, data, c, weekStart, weekEnd, header) {
  const p = data.project, hasCurb = !!p.has_curb;
  const { week, toDate } = Q.summarize(c, weekStart, weekEnd);
  const has = (item) => data.lines.some((l) => l.item === item);
  const pages = [];
  // Every item in the design gets its page, even before any of it is installed,
  // so the report always shows everything still to be built.
  for (const [k, name, kinds] of UTIL) if (has(k)) pages.push({ kind: 'util', item: k, name, kinds });
  if (has('cl')) pages.push({ kind: 'streets', name: 'Streets (subgrade, curb, paving)' });
  if (data.areas.some((a) => a.date <= weekEnd) || (data.limits || []).length) pages.push({ kind: 'site', name: 'Clearing and earthwork' });
  if (!pages.length) pages.push({ kind: 'overview', name: 'Site plan (no work recorded yet)' });
  for (const pg of pages) exhibitPage(pdf, data, c, weekStart, weekEnd, header, pg, { week, toDate, hasCurb });
}

function exhibitPage(pdf, data, c, weekStart, weekEnd, header, pg, ctx) {
  pdf.addPage(792, 612);
  const top = header(`Exhibit: ${pg.name}`);
  const p = data.project;
  const rows = pg.kind === 'util' ? 1 + pg.kinds.filter((k) => c.design[k]).length : pg.kind === 'streets' ? (ctx.hasCurb ? 3 : 2) : pg.kind === 'site' ? 2 : 0;
  const box = { x: 40, y: top + 6, w: 792 - 80, h: 612 - top - 6 - (rows * 15 + 52) };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (pts) => pts.forEach(([x, yy]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; });
  data.lines.forEach((l) => grow(l.pts)); (data.limits || []).forEach(grow);
  if (!Number.isFinite(x0)) return;
  const pad = 0.04 * Math.max(x1 - x0, y1 - y0); x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const s = Math.min(box.w / (x1 - x0), box.h / (y1 - y0));
  const ox = box.x + (box.w - (x1 - x0) * s) / 2, oy = box.y + (box.h - (y1 - y0) * s) / 2;
  const T = (pts) => pts.map(([x, yy]) => [ox + (x - x0) * s, oy + (y1 - yy) * s]);
  pdf.rect(box.x, box.y, box.w, box.h, { stroke: LINE, width: 0.8 });
  for (const l of data.lines) prep(l);

  const covered = (lineId, track, to) => P.union(data.progress.filter((r) => r.line_id === lineId && r.track === track && r.date <= to).map((r) => [r.from, r.to]));
  const states = (l, track) => {
    const before = covered(l.id, track, R_addDays(weekStart, -1)), thru = covered(l.id, track, weekEnd);
    return { before, thisWeek: P.minus(thru, before), remaining: P.minus([[0, l.len]], thru) };
  };
  const draw3 = (l, track, col, w) => {
    const st = states(l, track);
    st.remaining.forEach(([a, b]) => pdf.path(T(sub(l, a, b)), { stroke: col, width: Math.max(0.8, w * 0.45), dash: [3, 2.5] }));
    st.thisWeek.forEach(([a, b]) => pdf.path(T(sub(l, a, b)), { stroke: HILITE, width: w + 6, opacity: 0.85 }));
    st.before.forEach(([a, b]) => pdf.path(T(sub(l, a, b)), { stroke: col, width: w }));
    st.thisWeek.forEach(([a, b]) => pdf.path(T(sub(l, a, b)), { stroke: col, width: w }));
  };

  const CLEAR_BEFORE = '#f1e7b8', CLEAR_WEEK = '#ffd84d', EARTH_FILL = '#e4dafb';
  pdf.clipRect(box.x, box.y, box.w, box.h, () => {
    if (pg.kind === 'site') {
      const lim = data.limits && data.limits.length ? data.limits.map(T) : null;
      const inLim = (fn) => (lim ? pdf.clip(lim, fn) : fn());
      inLim(() => {
        data.areas.filter((a) => a.kind === 'clear' && a.date < weekStart).forEach((a) => pdf.path(T(a.pts), { fill: CLEAR_BEFORE }));
        data.areas.filter((a) => a.kind === 'clear' && a.date >= weekStart && a.date <= weekEnd).forEach((a) => pdf.path(T(a.pts), { fill: CLEAR_WEEK }));
      });
      data.areas.filter((a) => a.kind === 'earth' && a.date >= weekStart && a.date <= weekEnd).forEach((a) => pdf.path(T(a.pts), { fill: EARTH_FILL }));
    }
    let bg = {}; try { bg = JSON.parse(p.background_json || '{}'); } catch (e) { /* none */ }
    const bgStyle = { other: ['#eceff4', 0.3], lots: ['#d7dde7', 0.4], row: ['#b9c2d2', 0.5], curb: ['#a6b0c2', 0.45] };
    for (const [k, [col, w]] of Object.entries(bgStyle)) for (const pts of bg[k] || []) if (Array.isArray(pts) && pts.length > 1 && Array.isArray(pts[0])) pdf.path(T(pts), { stroke: col, width: w });
    // other work in faint gray for orientation
    for (const l of data.lines) {
      const mine = (pg.kind === 'util' && l.item === pg.item) || (pg.kind === 'streets' && l.item === 'cl');
      if (!mine) pdf.path(T(l.pts), { stroke: '#d3d8e2', width: 0.6 });
    }
    if (pg.kind === 'util') {
      const col = COLOR[pg.item];
      for (const l of data.lines) if (l.item === pg.item) draw3(l, 'line', col, 2.6);
      for (const st of data.structures) {
        if (!pg.kinds.includes(st.kind)) continue;
        const [[x, yy]] = T([[st.x, st.y]]), d = c.structDay.get(st.id);
        if (d && d >= weekStart && d <= weekEnd) { pdf.circle(x, yy, 5.2, { fill: HILITE, stroke: HILITE, width: 0.1 }); pdf.circle(x, yy, 2.8, { fill: col, stroke: '#ffffff', width: 0.6 }); }
        else if (d) pdf.circle(x, yy, 2.8, { fill: col, stroke: '#ffffff', width: 0.6 });
        else pdf.circle(x, yy, 2.6, { fill: '#ffffff', stroke: col, width: 0.9 });
      }
    } else if (pg.kind === 'streets') {
      const tracks = ctx.hasCurb ? [['sg', 7], ['cb', 4], ['pv', 1.8]] : [['sg', 7], ['pv', 2.2]];
      for (const l of data.lines) if (l.item === 'cl') pdf.path(T(l.pts), { stroke: '#9aa3b2', width: 0.9, dash: [3, 2.5] });
      for (const [t, w] of tracks) for (const l of data.lines) if (l.item === 'cl') {
        const st = states(l, t);
        st.thisWeek.forEach(([a, b]) => pdf.path(T(sub(l, a, b)), { stroke: HILITE, width: w + 6, opacity: 0.85 }));
      }
      for (const [t, w] of tracks) for (const l of data.lines) if (l.item === 'cl') {
        const st = states(l, t);
        st.before.concat(st.thisWeek).forEach(([a, b]) => pdf.path(T(sub(l, a, b)), { stroke: COLOR[t], width: w }));
      }
    } else if (pg.kind === 'site') {
      const lim = data.limits && data.limits.length ? data.limits.map(T) : null;
      const inLim = (fn) => (lim ? pdf.clip(lim, fn) : fn());
      void inLim;
      if (lim) lim.forEach((r) => pdf.path(r, { stroke: '#8a7000', width: 1.1, dash: [6, 3], close: true }));
      const earth = data.areas.filter((a) => a.kind === 'earth' && a.date >= weekStart && a.date <= weekEnd);
      earth.forEach((a) => {
        const pts = T(a.pts); pdf.path(pts, { stroke: COLOR.earth, width: 1.2, close: true });
        const cx = pts.reduce((q, v) => q + v[0], 0) / pts.length, cy = pts.reduce((q, v) => q + v[1], 0) / pts.length;
        const d = new Date(a.date + 'T12:00:00Z'); pdf.text(cx, cy - 4, `${DOW[(d.getUTCDay() + 6) % 7]} ${md(a.date)}`, { size: 7, bold: true, color: '#4b2e9e', align: 'center' });
      });
    } else {
      for (const l of data.lines) pdf.path(T(l.pts), { stroke: COLOR[l.item] || '#9aa3b2', width: 1, dash: [3, 2.5] });
    }
  });

  // north arrow + scale bar
  const nx = box.x + box.w - 22, ny = box.y + 14;
  pdf.path([[nx, ny + 22], [nx, ny]], { stroke: INK, width: 1 });
  pdf.path([[nx - 4, ny + 7], [nx, ny], [nx + 4, ny + 7]], { stroke: INK, width: 1 });
  pdf.text(nx, ny + 24, 'N', { size: 8, bold: true, align: 'center' });
  const target = 120 / s, mag = Math.pow(10, Math.floor(Math.log10(target)));
  const ft = [1, 2, 5, 10].map((m) => m * mag).filter((v) => v <= target).pop() || mag;
  const sx = box.x + 12, sy = box.y + box.h - 18;
  pdf.rect(sx, sy, ft * s / 2, 4, { fill: INK }); pdf.rect(sx + ft * s / 2, sy, ft * s / 2, 4, { fill: '#ffffff', stroke: INK, width: 0.6 });
  pdf.rect(sx, sy, ft * s, 4, { stroke: INK, width: 0.6 });
  pdf.text(sx, sy - 11, '0', { size: 7 }); pdf.text(sx + ft * s, sy - 11, `${Math.round(ft).toLocaleString('en-US')} ft`, { size: 7, align: 'center' });

  // legend with quantities
  const { week, toDate } = ctx;
  const q = (k, unit) => {
    const d = c.design[k] || 0, t = toDate[k] || 0, w = week[k] || 0;
    const f2 = (v) => (unit === 'AC' ? v.toFixed(2) : Math.round(v).toLocaleString('en-US'));
    return { before: `${f2(t - w)} ${unit}`, week: `${f2(w)} ${unit}`, left: d ? `${f2(Math.max(0, d - t))} ${unit}` : '—' };
  };
  let ly = box.y + box.h + 10;
  const colX = [40, 300, 520];
  const swLine = (x, yy, col, w, kind) => {
    if (kind === 'week') pdf.line(x, yy, x + 24, yy, { stroke: HILITE, width: w + 6, opacity: 0.85 });
    if (kind === 'left' && pg.kind === 'streets') pdf.line(x, yy, x + 24, yy, { stroke: '#9aa3b2', width: 0.9, dash: [3, 2.5] });
    else if (kind === 'left') pdf.line(x, yy, x + 24, yy, { stroke: col, width: Math.max(0.8, w * 0.45), dash: [3, 2.5] });
    else pdf.line(x, yy, x + 24, yy, { stroke: col, width: w });
  };
  const row = (label, col, w, qq, symbol) => {
    [['before', 'Installed before this week'], ['week', 'Installed this week'], ['left', 'Still to install']].forEach(([k, t], i) => {
      symbol ? symbol(colX[i] + 12, ly + 4, k) : swLine(colX[i], ly + 4, col, w, k);
      pdf.text(colX[i] + 32, ly, `${t}${label ? ' (' + label + ')' : ''}: `, { size: 8.5, color: INK });
      pdf.text(colX[i] + 32 + pdf.width(`${t}${label ? ' (' + label + ')' : ''}: `, 8.5), ly, qq[k], { size: 8.5, bold: true, color: INK });
    });
    ly += 16;
  };
  if (pg.kind === 'util') {
    row('', COLOR[pg.item], 2.6, q(pg.item, 'LF'));
    for (const k of pg.kinds) if (c.design[k]) {
      const col = COLOR[pg.item];
      row(KIND_LABEL[k], col, 2.6, q(k, 'EA'), (x, yy, kind) => {
        if (kind === 'week') { pdf.circle(x, yy, 5.2, { fill: HILITE, stroke: HILITE, width: 0.1 }); pdf.circle(x, yy, 2.8, { fill: col, stroke: '#fff', width: 0.6 }); }
        else if (kind === 'before') pdf.circle(x, yy, 2.8, { fill: col, stroke: '#fff', width: 0.6 });
        else pdf.circle(x, yy, 2.6, { fill: '#fff', stroke: col, width: 0.9 });
      });
    }
  } else if (pg.kind === 'streets') {
    const tracks = ctx.hasCurb ? [['sg', 'subgrade', 7], ['cb', 'curb', 4], ['pv', 'paving', 1.8]] : [['sg', 'subgrade', 7], ['pv', 'paving', 2.2]];
    for (const [t, n, w] of tracks) row(n, COLOR[t], Math.min(w, 5), q(t, 'LF'));
  } else if (pg.kind === 'site') {
    const qq = q('clear', 'AC');
    [['before', 'Cleared before this week', CLEAR_BEFORE], ['week', 'Cleared this week', CLEAR_WEEK]].forEach(([k, t, col], i) => {
      pdf.rect(colX[i], ly, 24, 9, { fill: col });
      pdf.text(colX[i] + 32, ly, `${t}: `, { size: 8.5, color: INK }); pdf.text(colX[i] + 32 + pdf.width(`${t}: `, 8.5), ly, qq[k], { size: 8.5, bold: true, color: INK });
    });
    if ((data.limits || []).length) { pdf.line(colX[2], ly + 4, colX[2] + 24, ly + 4, { stroke: '#8a7000', width: 1.1, dash: [6, 3] }); pdf.text(colX[2] + 32, ly, 'Limits of clearing; left to clear: ', { size: 8.5, color: INK }); pdf.text(colX[2] + 32 + pdf.width('Limits of clearing; left to clear: ', 8.5), ly, qq.left, { size: 8.5, bold: true, color: INK }); }
    ly += 16;
    pdf.rect(colX[0], ly, 24, 9, { fill: EARTH_FILL, stroke: COLOR.earth, width: 1 });
    pdf.text(colX[0] + 32, ly, 'Earthwork this week (labeled by day)', { size: 8.5, color: INK });
    ly += 16;
  }
  pdf.text(40, ly + 2, 'Gray lines are other work, shown for orientation. Plan north is up.', { size: 7.5, color: MUTE });
}

function prep(l) { if (l.cum) return; l.cum = [0]; for (let i = 1; i < l.pts.length; i++) l.cum.push(l.cum[i - 1] + Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1])); l.len = l.cum[l.cum.length - 1]; }
function at(l, s) { s = Math.max(0, Math.min(l.len, s)); let i = 1; while (i < l.cum.length - 1 && l.cum[i] < s) i++; const t = (s - l.cum[i - 1]) / ((l.cum[i] - l.cum[i - 1]) || 1); return [l.pts[i - 1][0] + t * (l.pts[i][0] - l.pts[i - 1][0]), l.pts[i - 1][1] + t * (l.pts[i][1] - l.pts[i - 1][1])]; }
function sub(l, a, b) { prep(l); const o = [at(l, a)]; for (let i = 0; i < l.cum.length; i++) if (l.cum[i] > a && l.cum[i] < b) o.push(l.pts[i]); o.push(at(l, b)); return o; }
function lighten(hex) { const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return '#' + n.map((v) => Math.round(v + (255 - v) * 0.6).toString(16).padStart(2, '0')).join(''); }

module.exports = { build, mondayOf, addDays };
