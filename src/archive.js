// Read-only feed of approved weekly reports and their photos, for the QNAP's
// nightly copy (tools/qnap-sync.sh). Protected by ARCHIVE_KEY, sent as the
// X-Archive-Key header. The list is plain text, one file per line:
//   relative/path/on/the/NAS|/archive/file/report/12|482113
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { pool, utc } = require('./db');
const config = require('./config');

const router = express.Router();
const keyOk = (req) => {
  const k = String(req.get('x-archive-key') || req.query.key || '');
  return !!config.archiveKey && k.length === config.archiveKey.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(config.archiveKey));
};
// Names safe for Windows/QNAP shares.
const clean = (s) => String(s || '').replace(/[<>:"\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
const cleanPath = (p) => String(p || '').split(/[\\/]+/).map(clean).filter((x) => x && x !== '..' && x !== '.').join('/');
const baseFolder = (p) => cleanPath(p.nas_folder) || `CM Archive/${clean(`${p.job_no} ${p.name}`)}`;
const reportDir = () => config.reportDir || path.join(config.uploadDir, 'reports');
const size = (f) => { try { return fs.statSync(f).size; } catch (e) { return null; } };

async function manifest() {
  const lines = [];
  const [reports] = await pool.query(
    `SELECT r.id, r.pdf_file, r.is_final, r.summary_file, DATE_FORMAT(r.week_ending, '%Y-%m-%d') we, p.id pid, p.job_no, p.name, p.nas_folder
       FROM weekly_reports r JOIN projects p ON p.id = r.project_id
      WHERE r.status IN ('approved','sent') AND r.pdf_file IS NOT NULL ORDER BY r.week_ending, p.job_no`);
  for (const r of reports) {
    const n = size(path.join(reportDir(), path.basename(r.pdf_file)));
    if (n == null) continue;
    lines.push([`${baseFolder(r)}/Weekly Reports/${clean(r.job_no)} ${r.is_final ? 'FINAL Report' : 'Weekly Report'} - week ending ${r.we}.pdf`, `/archive/file/report/${r.id}`, n, r.pid]);
    // close-out files saved with the approved final report
    for (const [kind, f, label] of [['summary', r.summary_file, 'Schedule summary']]) {
      const m = f ? size(path.join(reportDir(), path.basename(f))) : null;
      if (m != null) lines.push([`${baseFolder(r)}/Close-out/${clean(r.job_no)} ${label}.pdf`, `/archive/file/${kind}/${r.id}`, m, r.pid]);
    }
  }
  // Photos from weeks whose report is approved.
  const [photos] = await pool.query(
    `SELECT ph.id, ph.file_name, ph.taken_at, DATE_FORMAT(d.log_date, '%Y-%m-%d') date, u.name author, p.id pid, p.job_no, p.name, p.nas_folder
       FROM photos ph JOIN daily_logs d ON d.id = ph.log_id JOIN projects p ON p.id = d.project_id JOIN users u ON u.id = d.author_id
       JOIN weekly_reports r ON r.project_id = p.id AND r.status IN ('approved','sent')
        AND d.log_date BETWEEN DATE_SUB(r.week_ending, INTERVAL 5 DAY) AND r.week_ending
      ORDER BY d.log_date, ph.taken_at, ph.id`);
  const used = new Set();
  for (const ph of photos) {
    const n = size(path.join(config.uploadDir, path.basename(ph.file_name)));
    if (n == null) continue;
    const t = ph.taken_at ? utc(ph.taken_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', '-') : '00-00';
    let name = `${baseFolder(ph)}/Photos/${ph.date}/${ph.date} ${t} ${clean(ph.author)}`, k = 1;
    while (used.has(name + (k > 1 ? ` (${k})` : ''))) k++;
    name += k > 1 ? ` (${k})` : ''; used.add(name);
    lines.push([`${name}.jpg`, `/archive/file/photo/${ph.id}`, n, ph.pid]);
  }
  return lines;
}

router.get('/archive/manifest.txt', async (req, res) => {
  if (!keyOk(req)) return res.status(403).send('no');
  const lines = await manifest();
  res.type('text/plain').send(lines.map((l) => l.slice(0, 3).join('|')).join('\n') + (lines.length ? '\n' : ''));
});

// After a run with no failures the QNAP posts back every file it holds that
// matches the manifest (path|size per line). A closed project whose files are
// all there is marked Archived.
router.post('/archive/confirm', express.text({ limit: '20mb', type: '*/*' }), async (req, res) => {
  if (!keyOk(req)) return res.status(403).send('no');
  const have = new Set(String(req.body || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const lines = await manifest(), byProject = new Map();
  for (const [p, , n, pid] of lines) { if (!byProject.has(pid)) byProject.set(pid, []); byProject.get(pid).push(`${p}|${n}`); }
  const [closed] = await pool.query("SELECT p.id FROM projects p WHERE p.status = 'closed' AND p.archived_at IS NULL AND EXISTS (SELECT 1 FROM weekly_reports r WHERE r.project_id = p.id AND r.is_final = 1 AND r.summary_file IS NOT NULL)");
  const archived = [];
  for (const { id } of closed) {
    const want = byProject.get(id) || [];
    if (want.length && want.every((w) => have.has(w))) {
      await pool.query('UPDATE projects SET archived_at = NOW() WHERE id = ?', [id]);
      await require('./closeout').logEvent(id, null, 'archived', `${want.length} files confirmed on the QNAP`);
      archived.push(id);
    }
  }
  res.json({ confirmed: have.size, archived });
});

router.get('/archive/file/:kind/:id', async (req, res) => {
  if (!keyOk(req)) return res.status(403).send('no');
  let file;
  if (req.params.kind === 'summary') {
    const [[r]] = await pool.query("SELECT summary_file FROM weekly_reports WHERE id = ? AND is_final = 1 AND status IN ('approved','sent')", [req.params.id]);
    const f = r && r.summary_file;
    if (f) file = path.join(reportDir(), path.basename(f));
  } else if (req.params.kind === 'report') {
    const [[r]] = await pool.query("SELECT pdf_file FROM weekly_reports WHERE id = ? AND status IN ('approved','sent')", [req.params.id]);
    if (r && r.pdf_file) file = path.join(reportDir(), path.basename(r.pdf_file));
  } else if (req.params.kind === 'photo') {
    const [[ph]] = await pool.query(
      `SELECT ph.file_name FROM photos ph JOIN daily_logs d ON d.id = ph.log_id
         JOIN weekly_reports r ON r.project_id = d.project_id AND r.status IN ('approved','sent') AND d.log_date BETWEEN DATE_SUB(r.week_ending, INTERVAL 5 DAY) AND r.week_ending
        WHERE ph.id = ?`, [req.params.id]);
    if (ph) file = path.join(config.uploadDir, path.basename(ph.file_name));
  }
  if (!file || size(file) == null) return res.status(404).send('not found');
  res.sendFile(file);
});

module.exports = { router, manifest, cleanPath };
