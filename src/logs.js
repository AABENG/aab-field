const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { pool } = require('./db');
const auth = require('./auth');
const views = require('./views');
const config = require('./config');
const P = require('./progress');
const A = require('../public/js/areas');
const lockMsg = (st) => `This week’s report has been ${st === 'sent' ? 'approved and sent' : 'approved'}, so its logs are locked. Ask Joe to reopen it to make changes.`;
const { weatherAt } = require('./weather');

const router = express.Router();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fieldRoles = auth.requireRole('owner', 'reviewer', 'admin', 'co');
const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } };

async function project(id) {
  const [[p]] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
  return p;
}

// ---- site time (Oklahoma) ----
function chicagoOffsetMin(at) {
  const s = at.toLocaleString('en-US', { timeZone: 'America/Chicago', hour12: false });
  const local = new Date(s + ' UTC');
  return Math.round((local - new Date(at.toISOString().slice(0, 19) + 'Z')) / 60000);
}
function siteTime(dateStr, timeStr) {
  let h = 9, m = 0;
  const t = String(timeStr || '').trim().match(/^(\d{1,2}):?(\d{2})?\s*([ap])?/i);
  if (t) { h = +t[1] % 24; m = +(t[2] || 0); if (t[3]) { const pm = /p/i.test(t[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; } }
  const guess = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  return new Date(guess.getTime() - chicagoOffsetMin(guess) * 60000);
}

// ---- pages ----
router.get('/projects/:id/log', auth.requireLogin, fieldRoles, async (req, res, next) => {
  const p = await project(req.params.id);
  if (!p) return next();
  res.send(views.fieldPage({ user: req.session.user, project: p, mapsKey: config.mapsKey }));
});

// ---- data ----
// Everything the field page needs for one project: all progress (with the
// log date), logs for a date range, photos (ids only).
router.get('/api/projects/:id/field', auth.requireLogin, fieldRoles, async (req, res) => {
  const p = await project(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such project' });
  const from = DATE.test(req.query.from) ? req.query.from : '1900-01-01';
  const to = DATE.test(req.query.to) ? req.query.to : '2999-12-31';
  const [prog] = await pool.query(
    `SELECT DATE_FORMAT(d.log_date, '%Y-%m-%d') date, lp.line_id, lp.track, lp.from_ft, lp.to_ft
       FROM log_progress lp JOIN daily_logs d ON d.id = lp.log_id WHERE d.project_id = ?`, [p.id]);
  const [logs] = await pool.query(
    `SELECT d.*, DATE_FORMAT(d.log_date, '%Y-%m-%d') date, u.name author FROM daily_logs d JOIN users u ON u.id = d.author_id
      WHERE d.project_id = ? AND d.log_date BETWEEN ? AND ? ORDER BY d.log_date`, [p.id, from, to]);
  const ids = logs.map((l) => l.id);
  const [photos] = ids.length ? await pool.query('SELECT id, log_id, caption, taken_at FROM photos WHERE log_id IN (?) ORDER BY id', [ids]) : [[]];
  const [areas] = await pool.query(
    `SELECT DATE_FORMAT(d.log_date, '%Y-%m-%d') date, a.kind, a.pts_json FROM log_areas a JOIN daily_logs d ON d.id = a.log_id
      WHERE d.project_id = ? ORDER BY a.id`, [p.id]);
  res.json({
    hasCurb: !!p.has_curb,
    areas: areas.map((a) => ({ date: a.date, kind: a.kind, pts: json(a.pts_json, []) })),
    progress: prog.map((r) => ({ date: r.date, line_id: r.line_id, track: r.track, from: Number(r.from_ft), to: Number(r.to_ft) })),
    logs: logs.map((l) => ({
      date: l.date, author: l.author, check_in: l.check_in, crew: l.crew_count, no_crew: !!l.no_crew, weather: l.weather,
      rain_in: l.rain_in == null ? null : Number(l.rain_in), weather_edited: !!l.weather_edited,
      equipment: json(l.equipment_json, []), work: json(l.work_json, []), notes: l.notes || '', updated_at: l.updated_at,
      photos: photos.filter((ph) => ph.log_id === l.id).map((ph) => ({ id: ph.id, caption: ph.caption })),
    })),
  });
});

// Save one day's log. Progress for that day is replaced as a whole; the
// paving order is checked against every day, so an edit can't strand curb
// or paving that was logged later on top of it.
router.put('/api/projects/:id/logs/:date', auth.requireLogin, fieldRoles, async (req, res) => {
  const p = await project(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such project' });
  const date = req.params.date;
  if (!DATE.test(date)) return res.status(400).json({ error: 'Bad date' });
  const locked = await require('./reports').weekLocked(p.id, date);
  if (locked) return res.status(409).json({ error: lockMsg(locked) });
  const b = req.body || {};
  const [lines] = await pool.query('SELECT id, item, length_ft FROM project_lines WHERE project_id = ?', [p.id]);
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const rows = [];
  for (const r of Array.isArray(b.progress) ? b.progress : []) {
    const L = lineById.get(Number(r.line_id));
    if (!L || !P.TRACKS.includes(r.track)) return res.status(400).json({ error: 'Progress on a line that isn’t in this design' });
    if ((L.item === 'cl') !== (r.track !== 'line')) return res.status(400).json({ error: 'Wrong item for that line' });
    const a = Math.max(0, Math.min(Number(r.from), Number(r.to))), z = Math.min(Number(L.length_ft) + 0.5, Math.max(Number(r.from), Number(r.to)));
    if (!(Number.isFinite(a) && Number.isFinite(z)) || z - a < 0.05) continue;
    rows.push({ date, line_id: L.id, track: r.track, from: a, to: z });
  }
  const areas = [];
  for (const a of Array.isArray(b.areas) ? b.areas.slice(0, 50) : []) {
    if (!['clear', 'earth'].includes(a.kind) || !Array.isArray(a.pts)) return res.status(400).json({ error: 'Bad area' });
    const pts = a.pts.slice(0, 400).map((q) => [Number(q[0]), Number(q[1])]).filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
    if (pts.length < 3 || A.sqft(pts) < 1) continue;
    areas.push({ kind: a.kind, pts: pts.map((q) => [+q[0].toFixed(2), +q[1].toFixed(2)]) });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [others] = await conn.query(
      `SELECT DATE_FORMAT(d.log_date, '%Y-%m-%d') date, lp.line_id, lp.track, lp.from_ft, lp.to_ft
         FROM log_progress lp JOIN daily_logs d ON d.id = lp.log_id WHERE d.project_id = ? AND d.log_date <> ? FOR UPDATE`, [p.id, date]);
    const all = others.map((r) => ({ date: r.date, line_id: r.line_id, track: r.track, from: Number(r.from_ft), to: Number(r.to_ft) })).concat(rows);
    const problems = P.orderProblems(all, !!p.has_curb);
    if (problems.length) {
      await conn.rollback();
      const names = { sg: 'subgrade', cb: 'curb', pv: 'paving' };
      const f = problems[0];
      return res.status(409).json({ error: `${names[f.track][0].toUpperCase() + names[f.track].slice(1)} on ${f.date} would sit on ${f.ft} ft without ${names[f.needs]}. Paving goes subgrade, then curb, then paving.`, problems });
    }
    const crew = b.crew === '' || b.crew == null ? null : Math.max(0, Math.min(999, parseInt(b.crew, 10) || 0));
    const rain = b.rain_in === '' || b.rain_in == null || !Number.isFinite(Number(b.rain_in)) ? null : Number(b.rain_in);
    const vals = [String(b.check_in || '').slice(0, 20), crew, b.no_crew ? 1 : 0, String(b.weather || '').slice(0, 160), rain, b.weather_edited ? 1 : 0,
      JSON.stringify((b.equipment || []).map(String).slice(0, 40)), JSON.stringify((b.work || []).map(String).slice(0, 40)), String(b.notes || '').slice(0, 8000)];
    const [[existing]] = await conn.query('SELECT id FROM daily_logs WHERE project_id = ? AND log_date = ?', [p.id, date]);
    let logId;
    if (existing) {
      logId = existing.id;
      await conn.query(`UPDATE daily_logs SET check_in=?, crew_count=?, no_crew=?, weather=?, rain_in=?, weather_edited=?, equipment_json=?, work_json=?, notes=? WHERE id=?`, [...vals, logId]);
    } else {
      const [r] = await conn.query(`INSERT INTO daily_logs (project_id, log_date, author_id, check_in, crew_count, no_crew, weather, rain_in, weather_edited, equipment_json, work_json, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [p.id, date, req.session.user.id, ...vals]);
      logId = r.insertId;
    }
    await conn.query('DELETE FROM log_progress WHERE log_id = ?', [logId]);
    for (const r of rows) {
      await conn.query('INSERT INTO log_progress (log_id, line_id, track, from_ft, to_ft) VALUES (?,?,?,?,?)', [logId, r.line_id, r.track, r.from.toFixed(2), r.to.toFixed(2)]);
    }
    await conn.query('DELETE FROM log_areas WHERE log_id = ?', [logId]);
    for (const a of areas) {
      await conn.query('INSERT INTO log_areas (log_id, kind, pts_json, sqft) VALUES (?,?,?,?)', [logId, a.kind, JSON.stringify(a.pts), A.sqft(a.pts).toFixed(1)]);
    }
    await conn.commit();
    res.json({ ok: true, logId });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// ---- photos (sent as compressed JPEG data URLs from the phone) ----
const uploadDir = () => { const d = config.uploadDir; fs.mkdirSync(d, { recursive: true }); return d; };

router.post('/api/projects/:id/logs/:date/photos', auth.requireLogin, fieldRoles, express.json({ limit: '4mb' }), async (req, res) => {
  const p = await project(req.params.id);
  if (!p || !DATE.test(req.params.date)) return res.status(404).json({ error: 'Not found' });
  const [[log]] = await pool.query('SELECT id FROM daily_logs WHERE project_id = ? AND log_date = ?', [p.id, req.params.date]);
  if (!log) return res.status(409).json({ error: 'Save the day’s log before adding photos' });
  const locked = await require('./reports').weekLocked(p.id, req.params.date);
  if (locked) return res.status(409).json({ error: lockMsg(locked) });
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body || {}).data || ''));
  if (!m) return res.status(400).json({ error: 'Photo must be a JPEG' });
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'Photo too large' });
  // same photo sent twice (offline retry) → same row
  const name = `${p.id}-${req.params.date}-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.jpg`;
  const [[dup]] = await pool.query('SELECT id FROM photos WHERE log_id = ? AND file_name = ?', [log.id, name]);
  if (dup) return res.json({ ok: true, id: dup.id });
  fs.writeFileSync(path.join(uploadDir(), name), buf);
  const b = req.body;
  const takenAt = typeof b.taken_at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(b.taken_at) ? b.taken_at.slice(0, 19).replace('T', ' ') : null;
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const [r] = await pool.query('INSERT INTO photos (log_id, file_name, taken_at, latitude, longitude, caption) VALUES (?,?,?,?,?,?)',
    [log.id, name, takenAt, num(b.lat), num(b.lng), String(b.caption || '').slice(0, 255) || null]);
  res.json({ ok: true, id: r.insertId });
});

router.get('/photos/:id', auth.requireLogin, async (req, res, next) => {
  const [[ph]] = await pool.query('SELECT file_name FROM photos WHERE id = ?', [req.params.id]);
  if (!ph) return next();
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(uploadDir(), path.basename(ph.file_name)));
});

router.delete('/api/photos/:id', auth.requireLogin, fieldRoles, async (req, res) => {
  const [[ph]] = await pool.query(`SELECT ph.file_name, d.project_id, DATE_FORMAT(d.log_date, '%Y-%m-%d') date FROM photos ph JOIN daily_logs d ON d.id = ph.log_id WHERE ph.id = ?`, [req.params.id]);
  if (!ph) return res.status(404).json({ error: 'Not found' });
  const locked = await require('./reports').weekLocked(ph.project_id, ph.date);
  if (locked) return res.status(409).json({ error: lockMsg(locked) });
  await pool.query('DELETE FROM photos WHERE id = ?', [req.params.id]);
  fs.rm(path.join(uploadDir(), path.basename(ph.file_name)), { force: true }, () => {});
  res.json({ ok: true });
});

// ---- weather ----
router.get('/api/projects/:id/weather', auth.requireLogin, fieldRoles, async (req, res) => {
  const p = await project(req.params.id);
  if (!p || p.latitude == null) return res.status(404).json({ error: 'Project has no site location' });
  if (!DATE.test(req.query.date)) return res.status(400).json({ error: 'Bad date' });
  try {
    const at = siteTime(req.query.date, req.query.time);
    if (at > new Date(Date.now() + 3600 * 1000)) return res.status(400).json({ error: 'That time hasn’t happened yet' });
    res.json(await weatherAt(Number(p.latitude), Number(p.longitude), at));
  } catch (e) {
    res.status(502).json({ error: 'Weather service unavailable; enter it by hand' });
  }
});

module.exports = { router, siteTime };
