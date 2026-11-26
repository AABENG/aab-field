// Day-by-day quantities for a project, worked out from the daily logs:
// new footage per item, structures first reached, acres newly cleared (inside
// the limits of clearing) and acres of dirt work. Used by the weekly report and
// the CSV exports, so both always agree.
const { pool } = require('./db');
const P = require('./progress');
const A = require('../public/js/areas');

const ITEMS = [
  ['wl', 'Waterline', 'LF'], ['ss', 'Sanitary sewer', 'LF'], ['sd', 'Storm sewer', 'LF'],
  ['sg', 'Subgrade', 'LF'], ['cb', 'Curb and gutter', 'LF'], ['pv', 'Paving', 'LF'],
  ['mh', 'Sanitary manholes', 'EA'], ['st', 'Storm structures', 'EA'], ['fh', 'Fire hydrants', 'EA'], ['vv', 'Water valves', 'EA'],
  ['clear', 'Clearing', 'AC'], ['earth', 'Earthwork (area worked)', 'AC'],
];
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };

async function load(projectId) {
  const [[p]] = await pool.query('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!p) return null;
  const [lines] = await pool.query('SELECT id, item, length_ft, points_json FROM project_lines WHERE project_id = ?', [p.id]);
  const [structures] = await pool.query('SELECT id, kind, line_id, station_ft, x, y FROM project_structures WHERE project_id = ?', [p.id]);
  const [logs] = await pool.query(
    `SELECT d.*, DATE_FORMAT(d.log_date, '%Y-%m-%d') date, u.name author FROM daily_logs d JOIN users u ON u.id = d.author_id
      WHERE d.project_id = ? ORDER BY d.log_date`, [p.id]);
  const [progress] = await pool.query(
    `SELECT DATE_FORMAT(d.log_date, '%Y-%m-%d') date, lp.line_id, lp.track, lp.from_ft, lp.to_ft
       FROM log_progress lp JOIN daily_logs d ON d.id = lp.log_id WHERE d.project_id = ?`, [p.id]);
  const [areas] = await pool.query(
    `SELECT DATE_FORMAT(d.log_date, '%Y-%m-%d') date, a.kind, a.pts_json FROM log_areas a JOIN daily_logs d ON d.id = a.log_id
      WHERE d.project_id = ? ORDER BY a.id`, [p.id]);
  const ids = logs.map((l) => l.id);
  const [photos] = ids.length ? await pool.query('SELECT id, log_id, file_name, caption, taken_at FROM photos WHERE log_id IN (?) ORDER BY taken_at, id', [ids]) : [[]];
  return {
    project: p,
    lines: lines.map((l) => ({ id: l.id, item: l.item, ft: Number(l.length_ft), pts: json(l.points_json, []) })),
    structures: structures.map((s) => ({ id: s.id, kind: s.kind, line: s.line_id, station: Number(s.station_ft), x: Number(s.x), y: Number(s.y) })),
    logs: logs.map((l) => ({ ...l, equipment: json(l.equipment_json, []), work: json(l.work_json, []),
      photos: photos.filter((ph) => ph.log_id === l.id) })),
    progress: progress.map((r) => ({ date: r.date, line_id: r.line_id, track: r.track, from: Number(r.from_ft), to: Number(r.to_ft) })),
    areas: areas.map((a) => ({ date: a.date, kind: a.kind, pts: json(a.pts_json, []) })),
    limits: json(p.clearing_json, []),
  };
}

// Returns { design: {key: qty}, days: [{date, q: {key: qty}}], firstDate: {line|track: Map(...)} }
function compute(data) {
  const p = data.project, hasCurb = !!p.has_curb;
  const lineById = new Map(data.lines.map((l) => [l.id, l]));
  const design = {};
  for (const l of data.lines) {
    if (l.item === 'cl') for (const t of hasCurb ? ['sg', 'cb', 'pv'] : ['sg', 'pv']) design[t] = (design[t] || 0) + l.ft;
    else design[l.item] = (design[l.item] || 0) + l.ft;
  }
  for (const s of data.structures) design[s.kind] = (design[s.kind] || 0) + 1;
  const lim = data.limits && data.limits.length ? data.limits : null;
  if (lim) design.clear = A.unionSqft(lim) / A.SQFT_PER_ACRE;

  const dates = [...new Set(data.logs.map((l) => l.date).concat(data.progress.map((r) => r.date), data.areas.map((a) => a.date)))].sort();
  const byKey = new Map(); // "line|track" -> rows
  for (const r of data.progress) { const k = r.line_id + '|' + r.track; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
  const coveredThrough = (lineId, track, d) => P.union((byKey.get(lineId + '|' + track) || []).filter((r) => r.date <= d).map((r) => [r.from, r.to]));

  const structDay = new Map(); // structure id -> first date reached
  const days = [];
  let prevClear = 0;
  const prevCover = new Map();
  for (const d of dates) {
    const q = {};
    for (const k of byKey.keys()) {
      const [lineId, track] = k.split('|'); const l = lineById.get(Number(lineId));
      if (!l) continue;
      const cov = coveredThrough(Number(lineId), track, d);
      const before = prevCover.get(k) || 0, now = P.len(cov);
      prevCover.set(k, now);
      const key = track === 'line' ? l.item : track;
      if (now - before > 0.01) q[key] = (q[key] || 0) + (now - before);
      if (track === 'line') {
        for (const s of data.structures) {
          if (s.line !== l.id || structDay.has(s.id)) continue;
          if (cov.some(([a, b]) => s.station >= a - 3 && s.station <= b + 3)) { structDay.set(s.id, d); q[s.kind] = (q[s.kind] || 0) + 1; }
        }
      }
    }
    const thruClear = A.unionSqft(data.areas.filter((a) => a.kind === 'clear' && a.date <= d).map((a) => a.pts), null, lim);
    if (thruClear - prevClear > 1) q.clear = (thruClear - prevClear) / A.SQFT_PER_ACRE;
    prevClear = thruClear;
    const earth = A.unionSqft(data.areas.filter((a) => a.kind === 'earth' && a.date === d).map((a) => a.pts));
    if (earth > 1) q.earth = earth / A.SQFT_PER_ACRE;
    days.push({ date: d, q });
  }
  return { design, days, structDay };
}

// Sums for dates in [from, to] and everything up to `to`.
function summarize(c, from, to) {
  const week = {}, toDate = {};
  for (const { date, q } of c.days) {
    if (date > to) continue;
    for (const [k, v] of Object.entries(q)) {
      if (k !== 'earth') toDate[k] = (toDate[k] || 0) + v;
      if (date >= from) week[k] = (week[k] || 0) + v;
    }
  }
  return { week, toDate };
}

module.exports = { ITEMS, load, compute, summarize };
