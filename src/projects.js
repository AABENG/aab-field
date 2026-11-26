const express = require('express');
const { pool } = require('./db');
const auth = require('./auth');
const views = require('./views');
const geo = require('../public/js/dxf.js');
const ll = require('../public/js/geo.js');
const config = require('./config');
const A = require('../public/js/areas');

const ITEMS = ['wl', 'ss', 'sd', 'cl'];
const KINDS = { mh: 'ss', st: 'sd', fh: 'wl', vv: 'wl' };
const r2 = (v) => Math.round(v * 100) / 100;

const router = express.Router();
const canSetup = auth.requireRole('owner', 'admin', 'reviewer');

async function getProject(id) {
  const [[p]] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
  return p;
}

async function designTotals(projectId) {
  const [lines] = await pool.query('SELECT item, COUNT(*) n, SUM(length_ft) ft FROM project_lines WHERE project_id = ? GROUP BY item', [projectId]);
  const [sts] = await pool.query('SELECT kind, COUNT(*) n FROM project_structures WHERE project_id = ? GROUP BY kind', [projectId]);
  return { lines, structures: sts };
}

// ---- pages ----
router.get('/projects/new', auth.requireLogin, canSetup, (req, res) => {
  res.send(views.projectFormPage({ user: req.session.user, mapsKey: config.mapsKey }));
});

router.post('/projects', auth.requireLogin, canSetup, async (req, res) => {
  const b = req.body;
  const form = { job_no: String(b.job_no || '').trim(), wo_no: String(b.wo_no || '').trim(), name: String(b.name || '').trim(), client: String(b.client || '').trim(),
    client_emails: String(b.client_emails || '').trim(), latitude: b.latitude, longitude: b.longitude };
  try {
    if (!/^\d{4}-\d{2}$/.test(form.job_no)) throw new Error('Job number looks like 1714-12.');
    if (form.wo_no && !/^\d{2}-\d{3}(\.\d+)?$/.test(form.wo_no)) throw new Error('WO number looks like 26-243.0.');
    if (!form.name) throw new Error('Enter the project name.');
    const lat = form.latitude === '' || form.latitude == null ? null : Number(form.latitude);
    const lon = form.longitude === '' || form.longitude == null ? null : Number(form.longitude);
    if (lat !== null && !(lat > 33 && lat < 38)) throw new Error('Latitude should be in Oklahoma (about 34 to 37).');
    if (lon !== null && !(lon > -104 && lon < -94)) throw new Error('Longitude should be in Oklahoma (about -103 to -94, negative).');
    const [r] = await pool.query('INSERT INTO projects (job_no, wo_no, name, client, client_emails, latitude, longitude) VALUES (?,?,?,?,?,?,?)',
      [form.job_no, form.wo_no || null, form.name, form.client || null, form.client_emails || null, lat, lon]);
    res.redirect(`/projects/${r.insertId}/setup`);
  } catch (e) {
    const msg = e.code === 'ER_DUP_ENTRY' ? 'A project with that job number already exists.' : e.message;
    res.status(400).send(views.projectFormPage({ user: req.session.user, error: msg, form, mapsKey: config.mapsKey }));
  }
});

router.get('/projects/:id', auth.requireLogin, async (req, res, next) => {
  const p = await getProject(req.params.id);
  if (!p) return next();
  res.send(views.projectPage({ user: req.session.user, project: p, totals: await designTotals(p.id), mapsKey: config.mapsKey }));
});

router.get('/projects/:id/setup', auth.requireLogin, canSetup, async (req, res, next) => {
  const p = await getProject(req.params.id);
  if (!p) return next();
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) n FROM log_progress lp JOIN daily_logs d ON d.id = lp.log_id WHERE d.project_id = ?', [p.id]);
  res.send(views.setupDesignPage({ user: req.session.user, project: p, locked: n > 0, mapsKey: config.mapsKey }));
});

// ---- design API ----
router.get('/api/projects/:id/design', auth.requireLogin, async (req, res) => {
  const p = await getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such project' });
  const [lines] = await pool.query('SELECT id, item, source_layer, length_ft, points_json FROM project_lines WHERE project_id = ? ORDER BY id', [p.id]);
  const [sts] = await pool.query('SELECT id, kind, line_id, station_ft, x, y FROM project_structures WHERE project_id = ? ORDER BY id', [p.id]);
  res.json({
    project: { id: p.id, job_no: p.job_no, wo_no: p.wo_no, name: p.name, has_curb: !!p.has_curb, crs: p.crs,
      lat: p.latitude == null ? null : Number(p.latitude), lng: p.longitude == null ? null : Number(p.longitude) },
    mapsKey: config.mapsKey ? true : false,
    viewBox: p.view_box ? JSON.parse(p.view_box) : null,
    background: p.background_json ? JSON.parse(p.background_json) : null,
    lines: lines.map((l) => ({ id: l.id, item: l.item, layer: l.source_layer, ft: Number(l.length_ft), pts: JSON.parse(l.points_json) })),
    structures: sts.map((s) => ({ id: s.id, kind: s.kind, line: s.line_id, station: Number(s.station_ft), x: Number(s.x), y: Number(s.y) })),
    clearing: p.clearing_json ? JSON.parse(p.clearing_json) : [],
  });
});

const roundPts = (pts) => pts.map(([x, y]) => [r2(x), r2(y)]);
// Limits of clearing: up to 200 closed areas. Returns rounded rings, or null if invalid.
function cleanRings(rings) {
  if (!Array.isArray(rings) || rings.length > 200) return null;
  const out = [];
  for (const r of rings) {
    if (!Array.isArray(r) || r.length < 3 || r.length > 20000) return null;
    if (!r.every((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]))) return null;
    out.push(roundPts(r));
  }
  return out;
}

// Saved on its own so it can be added or fixed after field logging has started.
router.post('/api/projects/:id/clearing-limits', auth.requireLogin, canSetup, express.json({ limit: '10mb' }), async (req, res) => {
  const p = await getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such project' });
  const rings = cleanRings((req.body || {}).rings);
  if (!rings) return res.status(400).json({ error: 'Those limits of clearing could not be read' });
  await pool.query('UPDATE projects SET clearing_json = ? WHERE id = ?', [rings.length ? JSON.stringify(rings) : null, p.id]);
  res.json({ ok: true, areas: rings.length, acres: Math.round(A.unionSqft(rings) / A.SQFT_PER_ACRE * 100) / 100 });
});
const validPts = (pts) => Array.isArray(pts) && pts.length >= 2 && pts.length < 50000 &&
  pts.every((q) => Array.isArray(q) && q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]));

router.post('/api/projects/:id/design', auth.requireLogin, canSetup, express.json({ limit: '25mb' }), async (req, res) => {
  const p = await getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such project' });
  const b = req.body || {};
  const lines = (b.lines || []).filter((l) => ITEMS.includes(l.item) && validPts(l.pts));
  if (!lines.length) return res.status(400).json({ error: 'No tagged lines to save.' });
  const structures = (b.structures || []).filter((s) => KINDS[s.kind] && Number.isFinite(s.x) && Number.isFinite(s.y));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) n FROM log_progress lp JOIN daily_logs d ON d.id = lp.log_id WHERE d.project_id = ?', [p.id]);
    if (n > 0) { await conn.rollback(); return res.status(409).json({ error: 'Field progress has already been logged on this design, so it can’t be replaced.' }); }
    await conn.query('DELETE FROM project_structures WHERE project_id = ?', [p.id]);
    await conn.query('DELETE FROM project_lines WHERE project_id = ?', [p.id]);

    const saved = { wl: [], ss: [], sd: [], cl: [] }; // per item: [{id, pts}]
    for (const l of lines) {
      const pts = roundPts(l.pts);
      const [r] = await conn.query('INSERT INTO project_lines (project_id, item, source_layer, length_ft, points_json) VALUES (?,?,?,?,?)',
        [p.id, l.item, String(l.layer || '').slice(0, 120), r2(geo.plen(pts)), JSON.stringify(pts)]);
      saved[l.item].push({ id: r.insertId, pts });
    }
    // Structures go on the nearest line of their utility (within 10 ft);
    // ones that aren't on a tagged line are dropped and counted.
    let dropped = 0, kept = 0;
    for (const kind of Object.keys(KINDS)) {
      const mine = geo.dedupePoints(structures.filter((s) => s.kind === kind).map((s) => [s.x, s.y]));
      const ls = saved[KINDS[kind]];
      if (!ls.length) { dropped += mine.length; continue; }
      const snaps = geo.snapPoints(mine, ls.map((l) => l.pts), 10);
      for (let i = 0; i < mine.length; i++) {
        const s = snaps[i];
        if (!s) { dropped++; continue; }
        await conn.query('INSERT INTO project_structures (project_id, kind, line_id, station_ft, x, y) VALUES (?,?,?,?,?,?)',
          [p.id, kind, ls[s.line].id, r2(s.station), r2(mine[i][0]), r2(mine[i][1])]);
        kept++;
      }
    }
    const bg = b.background && typeof b.background === 'object' ? b.background : {};
    const vb = Array.isArray(b.viewBox) && b.viewBox.length === 4 && b.viewBox.every(Number.isFinite) ? b.viewBox.map(r2) : null;
    const hasCurb = b.hasCurb === false ? 0 : 1;
    const crs = ll.CRS[b.crs] ? b.crs : 'EPSG:2267';
    // Site location: from the drawing's center, unless one was already picked.
    let lat = p.latitude, lng = p.longitude;
    if (vb && (lat == null || lng == null || b.useDrawingLocation)) {
      const c = ll.toLatLng(crs, (vb[0] + vb[2]) / 2, (vb[1] + vb[3]) / 2);
      if (ll.looksOklahoma(c)) { lat = Math.round(c.lat * 1e6) / 1e6; lng = Math.round(c.lng * 1e6) / 1e6; }
    }
    await conn.query('UPDATE projects SET view_box = ?, background_json = ?, has_curb = ?, crs = ?, latitude = ?, longitude = ?, status = IF(status = "setup", "active", status) WHERE id = ?',
      [vb ? JSON.stringify(vb) : null, JSON.stringify(bg), hasCurb, crs, lat, lng, p.id]);
    const limits = b.clearingLimits === undefined ? undefined : cleanRings(b.clearingLimits);
    if (limits) await conn.query('UPDATE projects SET clearing_json = ? WHERE id = ?', [limits.length ? JSON.stringify(limits) : null, p.id]);
    await conn.commit();
    res.json({ ok: true, lines: lines.length, structures: kept, structuresDropped: dropped, totals: await designTotals(p.id) });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

module.exports = router;
