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
    pdf.text(M, 28, sub || (opt.final ? 'FINAL REPORT – Construction Observation' : 'Weekly Construction Observation Report'), { size: 15, bold: true, color: '#ffffff' });
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
  if (opt.final) {
    pdf.rect(M, y - 4, CW, 18, { fill: '#e8f0ff' });
    pdf.text(M + 8, y, `FINAL REPORT  ·  Substantial completion ${nice(opt.final.completion)}, ${opt.final.completion.slice(0, 4)}  ·  As-built exhibit and schedule summary attached`, { size: 8.5, bold: true, color: ACCENT });
    y += 22;
  }

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
  // Earthwork percent comes from the latest LiDAR flight on or before this week's end.
  const flight = opt.schedule && opt.schedule.S ? (opt.schedule.S.earth || []).filter((e) => e.as_of <= weekEnd).pop() : null;
  if (earthDays || flight || data.areas.some((a) => a.kind === 'earth')) {
    if (shade) pdf.rect(M - 4, y - 3, CW + 8, 15, { fill: '#f3f5f9' });
    pdf.text(cols[0], y, 'Earthwork', { size: 9, color: INK });
    pdf.text(cols[2] + 70, y, earthDays ? `${earthDays} day${earthDays > 1 ? 's' : ''}` : '—', { size: 9, bold: !!earthDays, color: earthDays ? INK : MUTE, align: 'right' });
    if (flight) {
      const pct = Math.round(flight.pct);
      pdf.text(cols[3] + 70, y, `LiDAR ${md(flight.as_of)}`, { size: 9, color: INK, align: 'right' });
      pdf.rect(cols[4] + 6, y + 1.5, 44, 6, { fill: '#e6eaf2' });
      if (pct) pdf.rect(cols[4] + 6, y + 1.5, 44 * pct / 100, 6, { fill: COLOR.earth });
      pdf.text(cols[4] + 76, y, pct + '%', { size: 9, color: INK, align: 'right' });
    } else pdf.text(M + CW, y, 'Active areas each day are on the exhibit', { size: 8, color: MUTE, align: 'right' });
    y += 15;
  }
  pdf.text(M, y + 2, 'Design quantities are taken from the design drawing. Structures are counted when the line through them is recorded.', { size: 7.5, color: MUTE });
  y += 20;

  const sc = opt.schedule && (opt.schedule.st.ntp || opt.schedule.st.hasPlan) ? opt.schedule : null;
  if (sc) {
    const st = sc.st, nd = (d) => (d ? `${nice(d)}, ${d.slice(0, 4)}` : '—');
    section('Schedule');
    const { itemStatus } = require('./schedulePages');
    const stalled = st.items.filter((i) => i.state === 'stalled').map((i) => i.name);
    const fcTxt = st.forecast ? `${nd(st.forecast)}${st.contractEnd ? ` (${Math.abs(R_d2n(st.forecast) - R_d2n(st.contractEnd))} days ${st.forecast > st.contractEnd ? 'after' : 'before'} contract)` : ''}`
      : stalled.length ? `none yet: no progress on ${stalled.join(', ').toLowerCase()} in 4 weeks` : 'not enough progress yet';
    const late = st.forecast && st.contractEnd && st.forecast > st.contractEnd;
    const rowsS = [
      ['Notice to proceed', nd(st.ntp), 'Contract completion', st.contractEnd ? `${nd(st.contractEnd)} (${st.days} calendar days)` : '—'],
      ['Contract time used', st.days && st.elapsed != null ? `${st.elapsed} of ${st.days} days (${Math.round(100 * st.elapsed / st.days)}%)` : '—', 'Forecast completion', fcTxt],
    ];
    for (const [a, b, c2, d] of rowsS) {
      pdf.text(M, y, a, { size: 8.5, color: MUTE }); pdf.text(M + 110, y, b, { size: 9, color: INK });
      pdf.text(M + 280, y, c2, { size: 8.5, color: MUTE }); pdf.text(M + 390, y, d, { size: 9, bold: c2 === 'Forecast completion', color: c2 === 'Forecast completion' && late ? '#b42318' : INK });
      y += 14;
    }
    y += 4;
    const sc0 = [M, M + 120, M + 245, M + 330, M + 455];
    ['Item', 'Planned', 'Done / planned', 'Status', 'Forecast finish'].forEach((h, i) => pdf.text(sc0[i], y, h, { size: 8, bold: true, color: MUTE }));
    y += 13;
    let sh = false;
    for (const it of st.items.filter((i) => i.plan || i.firstWork)) {
      if (sh) pdf.rect(M - 4, y - 3, CW + 8, 14, { fill: '#f3f5f9' });
      sh = !sh;
      const bad = (it.state === 'late' || it.state === 'stalled' || (it.state === 'working' && it.varianceDays < 0));
      pdf.rect(sc0[0], y + 1, 6, 6, { fill: COLOR[it.item] || ACCENT });
      pdf.text(sc0[0] + 11, y, it.name, { size: 9, color: INK });
      pdf.text(sc0[1], y, it.plan ? `${md(it.plan.start)} – ${md(it.plan.finish)}` : 'not scheduled', { size: 9, color: it.plan ? INK : MUTE });
      pdf.text(sc0[2], y, `${Math.round((it.actual || 0) * 100)}%${it.planned != null ? ` / ${Math.round(it.planned * 100)}%` : ''}`, { size: 9, color: INK });
      pdf.text(sc0[3], y, itemStatus(it), { size: 9, bold: bad, color: bad ? '#b42318' : it.state === 'not started' ? MUTE : INK });
      pdf.text(sc0[4], y, it.forecast ? (it.state === 'done' ? `finished ${md(it.forecast)}` : nd(it.forecast)) : '—', { size: 9, color: it.state === 'not started' ? MUTE : INK });
      y += 14;
    }
    y += pdf.para(M, y + 1, 'Behind/ahead is measured against each item’s own planned line. Forecasts use each item’s last four weeks’ pace; items not started carry the delay of the work before them.', CW, { size: 7.5, color: MUTE }) + 10;
  }

  if (opt.final && opt.final.note) {
    newPageIfNeeded(60);
    section('Close-out note');
    y += pdf.para(M, y, opt.final.note, CW, { size: 9.5, color: INK }) + 10;
  }
  if (opt.notes) {
    newPageIfNeeded(60);
    section("Engineer's notes");
    y += pdf.para(M, y, opt.notes, CW, { size: 9.5, color: INK }) + 10;
  }

  // daily log: always starts page 2, so page 1 is the summary
  pdf.addPage(); y = header() + 4;
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
  if (sc) schedulePage(pdf, data, sc, weekStart, weekEnd, header);
  if (opt.final) {
    asBuiltPage(pdf, data, c, header, opt.final.asBuilt);
    scheduleSummaryPage(pdf, header, opt.final.summary);
  }

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

const R_d2n = (d) => Math.floor(Date.parse(String(d).slice(0, 10) + 'T12:00:00Z') / 864e5);
const R_n2d = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const SNAME = { clear: 'Clearing', earth: 'Earthwork', ss: 'Sanitary sewer', sd: 'Storm sewer', wl: 'Waterline', sg: 'Subgrade', cb: 'Curb and gutter', pv: 'Paving' };

// One row per item: planned span, days worked, and a dashed run on to its forecast finish.
function schedulePage(pdf, data, sc, weekStart, weekEnd, header) {
  const { S, st } = sc, { itemStatus } = require('./schedulePages');
  pdf.addPage(792, 612);
  const top = header('Schedule');
  const sched = Object.values(S.sched);
  const rows = st.items.filter((it) => it.plan || it.firstWork);
  const from = [st.ntp, sched.map((x) => x.start).sort()[0], rows.map((r) => r.firstWork).filter(Boolean).sort()[0]].filter(Boolean).sort()[0];
  const to = [st.contractEnd, st.plannedEnd, st.forecast, ...rows.map((r) => r.forecast), weekEnd].filter(Boolean).sort().pop();
  const a = R_d2n(from), b = R_d2n(to) + 3;
  const L = 175, R = 792 - 190, X = (d) => L + (R_d2n(d) - a) / Math.max(1, b - a) * (R - L);
  const SX = R + 14; // status column
  let y = top + 8;
  pdf.text(40, y, 'BY ITEM', { size: 8, bold: true, color: ACCENT });
  pdf.text(L - 6, y, 'Done / planned', { size: 7.5, bold: true, color: MUTE, align: 'right' });
  pdf.text(SX, y, 'Status · forecast finish', { size: 7.5, bold: true, color: MUTE });
  y += 16;
  const y0 = y, bottom = 612 - 78;
  for (let n = a; n <= b; n++) { const d = R_n2d(n); if (d.endsWith('-01') || n === a) { pdf.line(X(d), y0 + 10, X(d), bottom, { stroke: '#eef1f6', width: 0.6 }); pdf.text(X(d) + 2, y0, `${MON[+d.slice(5, 7) - 1]} \u2019${d.slice(2, 4)}`, { size: 6.5, color: MUTE }); } }
  y += 14;
  const rh = Math.min(46, (bottom - y) / Math.max(1, rows.length));
  for (const it of rows) {
    const col = COLOR[it.item] || ACCENT, mid = y + rh / 2;
    const bad = it.state === 'late' || it.state === 'stalled' || (it.state === 'working' && it.varianceDays < 0);
    pdf.text(40, mid - 5, SNAME[it.item] || it.item, { size: 9.5, bold: true, color: INK });
    pdf.text(L - 6, mid - 5, `${Math.round((it.actual || 0) * 100)}%${it.planned != null ? ' / ' + Math.round(it.planned * 100) + '%' : ''}`, { size: 8.5, color: INK, align: 'right' });
    const bh = Math.min(9, rh * 0.28);
    if (it.plan) pdf.rect(X(it.plan.start), mid - bh - 1, Math.max(1.5, X(R_n2d(R_d2n(it.plan.finish) + 1)) - X(it.plan.start)), bh, { fill: '#dfe4ee' });
    if (it.firstWork) {
      const end = it.state === 'done' ? it.lastWork : weekEnd;
      pdf.rect(X(it.firstWork), mid + 1, Math.max(1.5, X(R_n2d(R_d2n(end) + 1)) - X(it.firstWork)), bh, { fill: col });
    }
    if (it.forecast && it.state !== 'done') {
      const s0 = it.firstWork && it.state !== 'not started' && it.state !== 'late' ? R_n2d(R_d2n(weekEnd) + 1) : (it.state === 'late' ? R_n2d(R_d2n(weekEnd) + 1) : it.plan.start);
      const x0 = X(s0), x1 = X(R_n2d(R_d2n(it.forecast) + 1));
      if (x1 > x0) pdf.path([[x0, mid + 1], [x1, mid + 1], [x1, mid + 1 + bh], [x0, mid + 1 + bh]], { stroke: col, width: 0.9, dash: [3, 2], close: true });
    }
    pdf.text(SX, mid - 10, itemStatus(it), { size: 8.5, bold: bad, color: bad ? '#b42318' : it.state === 'not started' ? MUTE : INK });
    pdf.text(SX, mid + 2, it.forecast ? (it.state === 'done' ? `finished ${nice(it.forecast)}, ${it.forecast.slice(0, 4)}` : `forecast ${nice(it.forecast)}, ${it.forecast.slice(0, 4)}`) : it.state === 'stalled' ? 'no forecast' : '', { size: 8, color: MUTE });
    pdf.line(40, y + rh, 792 - 40, y + rh, { stroke: '#eef1f6', width: 0.6 });
    y += rh;
  }
  const vline = (d, col, label, ly) => {
    if (!d) return; pdf.line(X(d), y0 + 10, X(d), y, { stroke: col, width: 0.9, dash: [3, 2] });
    const left = X(d) + 3 + pdf.width(label, 7) > R; pdf.text(left ? X(d) - 3 : X(d) + 3, ly, label, { size: 7, color: col, align: left ? 'right' : 'left' });
  };
  vline(weekEnd, '#3b4660', `Week ending ${md(weekEnd)}`, y + 4);
  vline(st.contractEnd, '#b42318', `Contract completion ${md(st.contractEnd)}`, y + 14);
  // legend
  const ly = 612 - 64;
  pdf.rect(40, ly + 2, 20, 6, { fill: '#dfe4ee' }); pdf.text(64, ly, 'Planned', { size: 7.5, color: INK });
  pdf.rect(115, ly + 2, 20, 6, { fill: '#3b4660' }); pdf.text(139, ly, 'Worked (first day to this week, or to the last day when finished)', { size: 7.5, color: INK });
  pdf.path([[400, ly + 2], [420, ly + 2], [420, ly + 8], [400, ly + 8]], { stroke: '#3b4660', width: 0.9, dash: [3, 2], close: true }); pdf.text(424, ly, 'Forecast at the item’s last four weeks’ pace', { size: 7.5, color: INK });
}

function prep(l) { if (l.cum) return; l.cum = [0]; for (let i = 1; i < l.pts.length; i++) l.cum.push(l.cum[i - 1] + Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1])); l.len = l.cum[l.cum.length - 1]; }
function at(l, s) { s = Math.max(0, Math.min(l.len, s)); let i = 1; while (i < l.cum.length - 1 && l.cum[i] < s) i++; const t = (s - l.cum[i - 1]) / ((l.cum[i] - l.cum[i - 1]) || 1); return [l.pts[i - 1][0] + t * (l.pts[i][0] - l.pts[i - 1][0]), l.pts[i - 1][1] + t * (l.pts[i][1] - l.pts[i - 1][1])]; }
function sub(l, a, b) { prep(l); const o = [at(l, a)]; for (let i = 0; i < l.cum.length; i++) if (l.cum[i] > a && l.cum[i] < b) o.push(l.pts[i]); o.push(at(l, b)); return o; }
function lighten(hex) { const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return '#' + n.map((v) => Math.round(v + (255 - v) * 0.6).toString(16).padStart(2, '0')).join(''); }


// ---------- close-out pages ----------
// The design's extent in drawing feet (lines + clearing limits), padded.
function frame(data) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (pts) => pts.forEach(([x, yy]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; });
  data.lines.forEach((l) => grow(l.pts)); (data.limits || []).forEach(grow);
  if (!Number.isFinite(x0)) return null;
  const pad = 0.05 * Math.max(x1 - x0, y1 - y0);
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
// Box the as-built map fills on a landscape page under a header of height `top`.
const AB_LEGEND = 98;
const asBuiltBox = (top) => ({ x: 40, y: top + 6, w: 792 - 80, h: 612 - top - 6 - AB_LEGEND });

// Everything installed through `asOf`, on the aerial when there is one.
function asBuiltPage(pdf, data, c, header, ab) {
  pdf.addPage(792, 612);
  const top = header('As-built exhibit');
  const p = data.project, hasCurb = !!p.has_curb, asOf = ab.asOf;
  const bb = frame(data);
  if (!bb) return;
  const box = asBuiltBox(top);
  const air = ab.ortho; // the as-built flight: { jpeg, place: { x0, y0, px, py, w, h }, flown }
  for (const l of data.lines) prep(l);
  const [x0, y0, x1, y1] = bb, sc = Math.min(box.w / (x1 - x0), box.h / (y1 - y0));
  const ox = box.x + (box.w - (x1 - x0) * sc) / 2, oy = box.y + (box.h - (y1 - y0) * sc) / 2;
  const T = (pts) => pts.map(([x, yy]) => [ox + (x - x0) * sc, oy + (y1 - yy) * sc]);
  const s = sc; // page units per foot
  const covered = (id, track) => P.union(data.progress.filter((r) => r.line_id === id && r.track === track && r.date <= asOf).map((r) => [r.from, r.to]));
  const cased = (pts, col, w) => { if (air) pdf.path(pts, { stroke: '#ffffff', width: w + 2.4, opacity: 0.9 }); pdf.path(pts, { stroke: col, width: w }); };
  pdf.clipRect(box.x, box.y, box.w, box.h, () => {
    if (air) {
      pdf.rect(box.x, box.y, box.w, box.h, { fill: '#e9ecf1' });
      const q = air.place, [[ix, iy], [jx, jy]] = T([[q.x0, q.y0], [q.x0 + q.w * q.px, q.y0 + q.h * q.py]]);
      pdf.image(air.jpeg, ix, iy, jx - ix, jy - iy, 'stretch');
    } else {
      let bg = {}; try { bg = JSON.parse(p.background_json || '{}'); } catch (e) { /* none */ }
      for (const [k, col, w] of [['other', '#eceff4', 0.3], ['lots', '#d7dde7', 0.4], ['row', '#b9c2d2', 0.5], ['curb', '#a6b0c2', 0.45]]) for (const pts of bg[k] || []) if (Array.isArray(pts) && pts.length > 1 && Array.isArray(pts[0])) pdf.path(T(pts), { stroke: col, width: w });
    }
    if (data.limits && data.limits.length) data.limits.forEach((r) => pdf.path(T(r), { stroke: air ? '#ffe680' : '#8a7000', width: 1, dash: [6, 3], close: true }));
    // streets: subgrade, curb, paving installed along the centerlines
    const tracks = hasCurb ? [['sg', 6], ['cb', 3.6], ['pv', 1.8]] : [['sg', 6], ['pv', 2.2]];
    for (const [t, w] of tracks) for (const l of data.lines) if (l.item === 'cl') covered(l.id, t).forEach(([a, b]) => cased(T(sub(l, a, b)), COLOR[t], w));
    // utilities: installed solid, anything not installed dashed
    for (const k of ['sd', 'ss', 'wl']) for (const l of data.lines) if (l.item === k) {
      const done = covered(l.id, 'line');
      P.minus([[0, l.len]], done).forEach(([a, b]) => pdf.path(T(sub(l, a, b)), { stroke: air ? '#ffffff' : COLOR[k], width: 1, dash: [3, 2.5] }));
      done.forEach(([a, b]) => cased(T(sub(l, a, b)), COLOR[k], 2.4));
    }
    for (const st of data.structures) {
      const col = COLOR[KIND_ITEM[st.kind]] || INK, [[x, yy]] = T([[st.x, st.y]]), d = c.structDay.get(st.id);
      if (d && d <= asOf) pdf.circle(x, yy, 3, { fill: col, stroke: '#ffffff', width: 0.8 });
      else pdf.circle(x, yy, 2.8, { fill: '#ffffff', stroke: col, width: 1 });
    }
  });
  pdf.rect(box.x, box.y, box.w, box.h, { stroke: LINE, width: 0.8 });
  // north arrow + scale bar (on a white chip so they read over imagery)
  const nx = box.x + box.w - 22, ny = box.y + 10;
  pdf.rect(nx - 10, ny - 4, 20, 40, { fill: '#ffffff', opacity: 0.85 });
  pdf.path([[nx, ny + 22], [nx, ny]], { stroke: INK, width: 1 });
  pdf.path([[nx - 4, ny + 7], [nx, ny], [nx + 4, ny + 7]], { stroke: INK, width: 1 });
  pdf.text(nx, ny + 24, 'N', { size: 8, bold: true, align: 'center' });
  const target = 120 / s, mag = Math.pow(10, Math.floor(Math.log10(target)));
  const ft = [1, 2, 5, 10].map((m) => m * mag).filter((v) => v <= target).pop() || mag;
  const sx = box.x + 12, sy = box.y + box.h - 18;
  pdf.rect(sx - 6, sy - 15, ft * s + 30, 26, { fill: '#ffffff', opacity: 0.85 });
  pdf.rect(sx, sy, ft * s / 2, 4, { fill: INK }); pdf.rect(sx + ft * s / 2, sy, ft * s / 2, 4, { fill: '#ffffff', stroke: INK, width: 0.6 });
  pdf.rect(sx, sy, ft * s, 4, { stroke: INK, width: 0.6 });
  pdf.text(sx, sy - 11, '0', { size: 7 }); pdf.text(sx + ft * s, sy - 11, `${Math.round(ft).toLocaleString('en-US')} ft`, { size: 7, align: 'center' });
  if (air) {
    const t = `Aerial: AAB Engineering as-built flight${air.flown ? ', ' + nice(air.flown) + ', ' + air.flown.slice(0, 4) : ''}`;
    pdf.rect(box.x + box.w - pdf.width(t, 6.5) - 10, box.y + box.h - 13, pdf.width(t, 6.5) + 10, 13, { fill: '#ffffff', opacity: 0.8 });
    pdf.text(box.x + box.w - 5, box.y + box.h - 10, t, { size: 6.5, color: INK, align: 'right' });
  }

  // legend: what's installed vs. the design
  const { toDate } = Q.summarize(c, '1900-01-01', asOf);
  const f0 = (v) => Math.round(v || 0).toLocaleString('en-US');
  const rows = [];
  for (const [k, name, kinds] of UTIL) if (c.design[k]) {
    rows.push({ col: COLOR[k], w: 2.4, label: name, q: `${f0(toDate[k])} of ${f0(c.design[k])} LF` });
    for (const kd of kinds) if (c.design[kd]) rows.push({ col: COLOR[k], dot: true, label: KIND_LABEL[kd][0].toUpperCase() + KIND_LABEL[kd].slice(1), q: `${f0(toDate[kd])} of ${f0(c.design[kd])} EA` });
  }
  for (const [t] of hasCurb ? [['sg'], ['cb'], ['pv']] : [['sg'], ['pv']]) if (c.design[t]) rows.push({ col: COLOR[t], w: t === 'sg' ? 6 : t === 'cb' ? 3.6 : 2, label: SNAME[t], q: `${f0(toDate[t])} of ${f0(c.design[t])} LF` });
  let ly = box.y + box.h + 12;
  pdf.text(40, ly, `INSTALLED THROUGH ${nice(asOf).toUpperCase()}, ${asOf.slice(0, 4)}`, { size: 8, bold: true, color: ACCENT });
  pdf.text(792 - 40, ly, 'Solid = installed   ·   Dashed / open circle = not installed', { size: 7.5, color: MUTE, align: 'right' });
  ly += 14;
  const per = Math.max(3, Math.ceil(rows.length / 4));
  rows.forEach((r, i) => {
    const x = 40 + Math.floor(i / per) * 180, yy = ly + (i % per) * 12;
    if (r.dot) pdf.circle(x + 12, yy + 3.5, 2.8, { fill: r.col, stroke: '#ffffff', width: 0.6 });
    else pdf.line(x, yy + 3.5, x + 24, yy + 3.5, { stroke: r.col, width: Math.min(r.w, 5) });
    pdf.text(x + 32, yy, r.label, { size: 8, color: INK });
    pdf.text(x + 170, yy, r.q, { size: 8, color: INK, align: 'right' });
  });
}

// Planned vs. actual for each tracked item, in calendar days.
function scheduleSummaryPage(pdf, header, sum) {
  pdf.addPage(792, 612);
  let y = header('Schedule summary') + 10;
  const nd = (d) => (d ? `${md(d)}/${d.slice(2, 4)}` : '—');
  const days = (a, b) => (a && b ? R_d2n(b) - R_d2n(a) + 1 : null);
  const v = (n) => (n == null ? '—' : n === 0 ? '0' : (n > 0 ? '+' : '-') + Math.abs(n));
  const kv = [
    ['Notice to proceed', nd(sum.ntp)], ['Contract completion', sum.contractEnd ? `${nd(sum.contractEnd)} (${sum.days} calendar days)` : '—'],
    ['Substantial completion', nd(sum.completion)],
    ['Contract time used', sum.ntp && sum.completion ? `${days(sum.ntp, sum.completion)}${sum.days ? ` of ${sum.days}` : ''} calendar days` : '—'],
    ['Finish vs. contract', sum.contractEnd && sum.completion ? (() => { const d = R_d2n(sum.completion) - R_d2n(sum.contractEnd); return d > 0 ? `${d} days late` : d < 0 ? `${-d} days early` : 'on the contract date'; })() : '—'],
  ];
  kv.forEach(([a, b], i) => { const x = 40 + (i % 3) * 240, yy = y + Math.floor(i / 3) * 15; pdf.text(x, yy, a, { size: 8.5, color: MUTE }); pdf.text(x + 108, yy, b, { size: 9, bold: a === 'Finish vs. contract', color: INK }); });
  y += 40;
  const cols = [40, 150, 262, 312, 362, 404, 456, 508, 552, 600, 646];
  const hd = ['Item', 'Contractor', 'Plan start', 'Plan finish', 'Plan days', 'Actual start', 'Actual finish', 'Actual days', 'Start var.', 'Finish var.', 'Installed / design'];
  pdf.rect(36, y - 4, 792 - 72, 16, { fill: '#eef2f8' });
  hd.forEach((h, i) => pdf.text(cols[i], y, h, { size: 7.5, bold: true, color: MUTE }));
  y += 18;
  for (const it of sum.items) {
    const pS = it.plan && it.plan.start, pF = it.plan && it.plan.finish, aS = it.start, aF = it.finish;
    const sv = pS && aS ? R_d2n(aS) - R_d2n(pS) : null, fv = pF && aF ? R_d2n(aF) - R_d2n(pF) : null;
    pdf.rect(cols[0], y + 1, 6, 6, { fill: COLOR[it.item] || ACCENT });
    pdf.text(cols[0] + 11, y, it.name, { size: 9, color: INK });
    pdf.text(cols[1], y, it.contractor || '—', { size: 8, color: INK });
    [nd(pS), nd(pF), days(pS, pF) ?? '—', nd(aS), nd(aF), days(aS, aF) ?? '—'].forEach((t, i) => pdf.text(cols[2 + i], y, String(t), { size: 9, color: INK }));
    pdf.text(cols[8], y, v(sv), { size: 9, color: sv > 0 ? '#b42318' : INK });
    pdf.text(cols[9], y, v(fv), { size: 9, bold: fv > 0, color: fv > 0 ? '#b42318' : INK });
    pdf.text(cols[10], y, it.qty || '—', { size: 8.5, color: INK });
    pdf.line(36, y + 13, 792 - 36, y + 13, { stroke: '#eef1f6', width: 0.6 });
    y += 19;
  }
  y += 8;
  y += pdf.para(40, y, 'Days are calendar days, counting the first and last day. Variance is actual minus planned: + is later than planned, - is earlier. Actual start and finish are the first and last days the work was logged (earthwork: the LiDAR flight that reached 100%).', 712, { size: 7.5, color: MUTE });
  if (sum.note) { y += 12; pdf.text(40, y, 'CLOSE-OUT NOTE', { size: 8, bold: true, color: ACCENT }); y += 13; pdf.para(40, y, sum.note, 712, { size: 9, color: INK }); }
}

// Stand-alone close-out PDFs (saved alongside the final report and copied to the NAS).
function standalone(data, title, draw) {
  const p = data.project, pdf = new PDF();
  const header = (sub) => {
    pdf.rect(0, 0, pdf.W, 64, { fill: NAVY });
    pdf.text(40, 14, 'AAB ENGINEERING, LLC', { size: 8, bold: true, color: '#8fb4ff' });
    pdf.text(40, 28, sub, { size: 15, bold: true, color: '#ffffff' });
    pdf.text(pdf.W - 40, 16, p.name, { size: 10, color: '#ffffff', align: 'right' });
    pdf.text(pdf.W - 40, 32, `Project ${p.job_no}${p.wo_no ? '  ·  WO ' + p.wo_no : ''}  ·  FINAL`, { size: 9, color: '#b9c6e4', align: 'right' });
    return 80;
  };
  draw(pdf, header);
  pdf.pages.forEach((pg, i) => {
    pdf.page = pg;
    pdf.text(40, pg.h - 28, `${p.name}  ·  Project ${p.job_no}${p.wo_no ? '  ·  WO ' + p.wo_no : ''}  ·  ${title}`, { size: 7.5, color: MUTE });
    pdf.text(pg.w - 40, pg.h - 28, `Page ${i + 1} of ${pdf.pages.length}`, { size: 7.5, color: MUTE, align: 'right' });
  });
  return pdf.build({ title: `${p.name} – ${title}` });
}
const buildAsBuilt = (data, c, ab) => standalone(data, 'As-built exhibit', (pdf, header) => asBuiltPage(pdf, data, c, header, ab));
const buildSummary = (data, sum) => standalone(data, 'Schedule summary', (pdf, header) => scheduleSummaryPage(pdf, header, sum));

module.exports = { build, mondayOf, addDays, frame, asBuiltBox, buildAsBuilt, buildSummary };
