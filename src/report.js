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

function exhibit(pdf, data, c, weekStart, weekEnd, header) {
  pdf.addPage(792, 612);
  const top = header('Progress Exhibit');
  const p = data.project, hasCurb = !!p.has_curb;
  const box = { x: 40, y: top + 6, w: 792 - 80, h: 612 - top - 6 - 96 };
  // extent: design lines, limits of clearing and logged areas
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (pts) => pts.forEach(([x, yy]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; });
  data.lines.forEach((l) => grow(l.pts)); (data.limits || []).forEach(grow);
  if (!Number.isFinite(x0)) return;
  const pad = 0.04 * Math.max(x1 - x0, y1 - y0); x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const s = Math.min(box.w / (x1 - x0), box.h / (y1 - y0));
  const ox = box.x + (box.w - (x1 - x0) * s) / 2, oy = box.y + (box.h - (y1 - y0) * s) / 2;
  const T = (pts) => pts.map(([x, yy]) => [ox + (x - x0) * s, oy + (y1 - yy) * s]);
  pdf.rect(box.x, box.y, box.w, box.h, { stroke: LINE, width: 0.8 });

  pdf.clipRect(box.x, box.y, box.w, box.h, () => {
    let bg = {}; try { bg = JSON.parse(p.background_json || '{}'); } catch (e) { /* none */ }
    const bgStyle = { other: ['#e8ebf1', 0.3], lots: ['#cfd6e2', 0.4], row: ['#aeb8ca', 0.55], curb: ['#97a2b6', 0.5] };
    for (const [k, [col, w]] of Object.entries(bgStyle)) for (const pts of bg[k] || []) if (Array.isArray(pts) && pts.length > 1 && Array.isArray(pts[0])) pdf.path(T(pts), { stroke: col, width: w });

    // clearing
    const lim = data.limits && data.limits.length ? data.limits.map(T) : null;
    const inLim = (fn) => (lim ? pdf.clip(lim, fn) : fn());
    inLim(() => {
      data.areas.filter((a) => a.kind === 'clear' && a.date < weekStart).forEach((a) => pdf.path(T(a.pts), { fill: '#9aa3b2', opacity: 0.22 }));
      data.areas.filter((a) => a.kind === 'clear' && a.date >= weekStart && a.date <= weekEnd).forEach((a) => pdf.path(T(a.pts), { fill: COLOR.clear, opacity: 0.32 }));
    });
    if (lim) lim.forEach((r) => pdf.path(r, { stroke: '#a88a00', width: 1, dash: [6, 3], close: true }));
    // earthwork this week
    data.areas.filter((a) => a.kind === 'earth' && a.date >= weekStart && a.date <= weekEnd)
      .forEach((a) => pdf.path(T(a.pts), { fill: COLOR.earth, stroke: COLOR.earth, width: 0.8, opacity: 0.25 }));
    data.areas.filter((a) => a.kind === 'earth' && a.date >= weekStart && a.date <= weekEnd)
      .forEach((a) => pdf.path(T(a.pts), { stroke: COLOR.earth, width: 0.9, close: true }));

    // lines: remaining gray, earlier faded, this week solid
    const segs = (l, iv) => iv.map(([a, b]) => sub(l, a, b));
    const covered = (lineId, track, to, from) => {
      const rows = data.progress.filter((r) => r.line_id === lineId && r.track === track && r.date <= to && (!from || r.date >= from));
      return P.union(rows.map((r) => [r.from, r.to]));
    };
    for (const l of data.lines) prep(l);
    for (const l of data.lines) pdf.path(T(l.pts), { stroke: '#c2c9d6', width: l.item === 'cl' ? 0.6 : 0.9 });
    const tracks = (l) => (l.item === 'cl' ? (hasCurb ? [['sg', 5.5], ['cb', 3.2], ['pv', 1.5]] : [['sg', 5.5], ['pv', 1.8]]) : [['line', 2.4]]);
    for (const l of data.lines) {
      for (const [t, w] of tracks(l)) {
        const col = COLOR[t === 'line' ? l.item : t];
        const before = covered(l.id, t, addDays(weekStart, -1));
        const thru = covered(l.id, t, weekEnd);
        const thisWeek = P.minus(thru, before);
        segs(l, before).forEach((pts) => pdf.path(T(pts), { stroke: col, width: w, opacity: 0.35 }));
        segs(l, thisWeek).forEach((pts) => pdf.path(T(pts), { stroke: col, width: w }));
      }
    }
    // structures
    const r = 2.3;
    for (const st of data.structures) {
      const [[x, yy]] = T([[st.x, st.y]]);
      const d = c.structDay.get(st.id), col = COLOR[KIND_ITEM[st.kind]];
      if (d && d >= weekStart && d <= weekEnd) pdf.circle(x, yy, r, { fill: col, stroke: '#ffffff', width: 0.5 });
      else if (d && d < weekStart) pdf.circle(x, yy, r, { fill: lighten(col), stroke: col, width: 0.4 });
      else pdf.circle(x, yy, r, { fill: '#ffffff', stroke: '#9aa3b2', width: 0.5 });
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

  // legend
  let lx = 40; const ly = box.y + box.h + 12;
  const sw = (label, draw) => { draw(lx, ly + 4); pdf.text(lx + 26, ly, label, { size: 8, color: INK }); lx += 26 + pdf.width(label, 8) + 16; };
  const present = new Set(data.lines.map((l) => l.item));
  if (present.has('wl')) sw('Waterline', (x, yy) => pdf.line(x, yy, x + 20, yy, { stroke: COLOR.wl, width: 2.4 }));
  if (present.has('ss')) sw('Sanitary sewer', (x, yy) => pdf.line(x, yy, x + 20, yy, { stroke: COLOR.ss, width: 2.4 }));
  if (present.has('sd')) sw('Storm sewer', (x, yy) => pdf.line(x, yy, x + 20, yy, { stroke: COLOR.sd, width: 2.4 }));
  if (present.has('cl')) {
    sw('Subgrade', (x, yy) => pdf.line(x, yy, x + 20, yy, { stroke: COLOR.sg, width: 5.5 }));
    if (hasCurb) sw('Curb and gutter', (x, yy) => pdf.line(x, yy, x + 20, yy, { stroke: COLOR.cb, width: 3.2 }));
    sw('Paving', (x, yy) => pdf.line(x, yy, x + 20, yy, { stroke: COLOR.pv, width: 1.5 }));
  }
  lx = 40; const ly2 = ly + 18;
  const sw2 = (label, draw) => { draw(lx, ly2 + 4); pdf.text(lx + 26, ly2, label, { size: 8, color: INK }); lx += 26 + pdf.width(label, 8) + 16; };
  sw2('Done this week', (x, yy) => pdf.line(x, yy, x + 20, yy, { stroke: '#3b4660', width: 2.4 }));
  sw2('Done before this week', (x, yy) => pdf.line(x, yy, x + 20, yy, { stroke: '#3b4660', width: 2.4, opacity: 0.35 }));
  sw2('Not yet done', (x, yy) => pdf.line(x, yy, x + 20, yy, { stroke: '#c2c9d6', width: 0.9 }));
  if (data.areas.some((a) => a.kind === 'clear') || (data.limits || []).length) {
    sw2('Cleared this week', (x, yy) => pdf.rect(x, yy - 4, 20, 8, { fill: COLOR.clear, opacity: 0.32 }));
    sw2('Cleared before', (x, yy) => pdf.rect(x, yy - 4, 20, 8, { fill: '#9aa3b2', opacity: 0.22 }));
    if ((data.limits || []).length) sw2('Limits of clearing', (x, yy) => pdf.line(x, yy, x + 20, yy, { stroke: '#a88a00', width: 1, dash: [6, 3] }));
  }
  if (data.areas.some((a) => a.kind === 'earth' && a.date >= weekStart && a.date <= weekEnd)) sw2('Earthwork this week', (x, yy) => pdf.rect(x, yy - 4, 20, 8, { fill: COLOR.earth, opacity: 0.25, stroke: COLOR.earth }));
  lx = 40;
  pdf.text(40, ly2 + 18, 'Circles: structures and fittings (filled = reached this week, light = earlier, open = not yet). Plan north is up.', { size: 7.5, color: MUTE });
}

function prep(l) { if (l.cum) return; l.cum = [0]; for (let i = 1; i < l.pts.length; i++) l.cum.push(l.cum[i - 1] + Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1])); l.len = l.cum[l.cum.length - 1]; }
function at(l, s) { s = Math.max(0, Math.min(l.len, s)); let i = 1; while (i < l.cum.length - 1 && l.cum[i] < s) i++; const t = (s - l.cum[i - 1]) / ((l.cum[i] - l.cum[i - 1]) || 1); return [l.pts[i - 1][0] + t * (l.pts[i][0] - l.pts[i - 1][0]), l.pts[i - 1][1] + t * (l.pts[i][1] - l.pts[i - 1][1])]; }
function sub(l, a, b) { prep(l); const o = [at(l, a)]; for (let i = 0; i < l.cum.length; i++) if (l.cum[i] > a && l.cum[i] < b) o.push(l.pts[i]); o.push(at(l, b)); return o; }
function lighten(hex) { const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return '#' + n.map((v) => Math.round(v + (255 - v) * 0.6).toString(16).padStart(2, '0')).join(''); }

module.exports = { build, mondayOf, addDays };
