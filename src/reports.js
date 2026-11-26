// Weekly reports: Sunday build + review request to Joe, review page, approval,
// one email per owner once all of their reports for the week are approved,
// owners, and CSV exports for analytics.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { pool } = require('./db');
const auth = require('./auth');
const views = require('./views');
const config = require('./config');
const Q = require('./quantities');
const R = require('./report');
const mail = require('./mail');
const Sch = require('./schedule');

const router = express.Router();
const esc = views.esc;
const canView = auth.requireRole('owner', 'admin', 'reviewer');
const canApprove = auth.requireRole('reviewer');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nice = (d) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const reportDir = () => { const d = config.reportDir || path.join(config.uploadDir, 'reports'); fs.mkdirSync(d, { recursive: true }); return d; };
const dstr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// The week to report on Sunday evening is the one that just ended (Mon–Sat).
function lastWeekStart(today = todayStr()) {
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  return dow === 0 ? R.mondayOf(today) : R.addDays(R.mondayOf(today), -7);
}
const weekEndOf = (ws) => R.addDays(ws, 5);
const weekStartOf = (we) => R.addDays(we, -5);

// ---------- summaries ----------
function weekSummary(data, c, ws, sched) {
  const we = weekEndOf(ws);
  const { week, toDate } = Q.summarize(c, ws, we);
  const out = [];
  const pct = (k) => (c.design[k] ? ` (${Math.min(100, Math.round(100 * (toDate[k] || 0) / c.design[k]))}% complete)` : '');
  const lf = (k, name) => { if (week[k]) out.push(`${name}: ${Math.round(week[k]).toLocaleString('en-US')} LF${pct(k)}`); };
  lf('wl', 'Waterline'); lf('ss', 'Sanitary sewer'); lf('sd', 'Storm sewer'); lf('sg', 'Subgrade'); lf('cb', 'Curb and gutter'); lf('pv', 'Paving');
  const ea = [['mh', 'manhole'], ['st', 'storm structure'], ['fh', 'fire hydrant'], ['vv', 'water valve']]
    .filter(([k]) => week[k]).map(([k, n]) => `${week[k]} ${n}${week[k] > 1 ? 's' : ''}`);
  if (ea.length) out.push(`Structures: ${ea.join(', ')}`);
  if (week.clear) out.push(`Clearing: ${week.clear.toFixed(2)} ac${c.design.clear ? ` (${Math.min(100, Math.round(100 * (toDate.clear || 0) / c.design.clear))}% of limits)` : ''}`);
  const logs = data.logs.filter((l) => l.date >= ws && l.date <= we);
  const earthDays = c.days.filter((x) => x.date >= ws && x.date <= we && x.q.earth).length;
  if (earthDays) out.push(`Earthwork: active ${earthDays} day${earthDays > 1 ? 's' : ''}`);
  const work = logs.filter((l) => !l.no_crew).length;
  const rain = logs.reduce((s, l) => s + (l.rain_in == null ? 0 : Number(l.rain_in)), 0);
  out.push(`Crew on site ${work} of ${logs.length} logged day${logs.length === 1 ? '' : 's'}${rain >= 0.01 ? `; ${rain.toFixed(2)} in of rain recorded` : ''}`);
  if (sched && (sched.st.ntp || sched.st.hasPlan)) out.push(`Schedule: ${require('./schedulePages').statusLine(sched.st)}`);
  return out;
}

async function weekReports(we) {
  const [rows] = await pool.query(
    `SELECT r.*, DATE_FORMAT(r.week_ending, '%Y-%m-%d') we, p.name, p.job_no, p.wo_no, p.owner_id, o.name owner_name, o.company owner_company, o.emails owner_emails, u.name approver
       FROM weekly_reports r JOIN projects p ON p.id = r.project_id LEFT JOIN owners o ON o.id = p.owner_id LEFT JOIN users u ON u.id = r.approved_by
      WHERE r.week_ending = ? ORDER BY o.name IS NULL, o.name, p.job_no`, [we]);
  return rows;
}

// Make sure every active project with logs that week has a report row.
async function prepareWeek(ws) {
  const we = weekEndOf(ws);
  const [ps] = await pool.query(
    `SELECT DISTINCT d.project_id FROM daily_logs d JOIN projects p ON p.id = d.project_id WHERE p.status <> 'closed' AND d.log_date BETWEEN ? AND ?`, [ws, we]);
  for (const { project_id: id } of ps) await pool.query('INSERT IGNORE INTO weekly_reports (project_id, week_ending, status) VALUES (?, ?, "review")', [id, we]);
  return weekReports(we);
}

async function pdfFor(r) {
  if ((r.status === 'approved' || r.status === 'sent') && r.pdf_file) {
    try { return fs.readFileSync(path.join(reportDir(), path.basename(r.pdf_file))); } catch (e) { /* rebuild below */ }
  }
  const data = await Q.load(r.project_id), c = Q.compute(data);
  const ws = weekStartOf(r.we || dstr(r.week_ending));
  const S = await Sch.load(r.project_id);
  return R.build(data, c, ws, {
    status: r.status, notes: r.notes, approvedBy: r.approver, approvedAt: r.approved_at ? dstr(r.approved_at) : null, uploadDir: config.uploadDir,
    schedule: S ? { S, st: Sch.status(S, weekEndOf(ws)) } : null,
  });
}
const pdfName = (r) => `${r.job_no} ${r.name.replace(/[^\w .-]+/g, '')} - week ending ${r.we}.pdf`;

// ---------- emails ----------
async function reviewers() {
  const [u] = await pool.query("SELECT name, email FROM users WHERE role = 'reviewer' AND active = 1");
  return u;
}

async function sendReviewRequest(ws, rows) {
  const rv = await reviewers();
  if (!rv.length) throw new Error('No active reviewer account (Joe) to send to');
  const we = weekEndOf(ws), link = `${config.publicUrl}/reviews/${we}`;
  const groups = groupByOwner(rows);
  let text = `Weekly construction reports for ${nice(ws)} – ${nice(we)} are ready for your review.\n\nReview and approve: ${link}\n`;
  let html = `<p>Weekly construction reports for <b>${nice(ws)} – ${nice(we)}</b> are ready for your review.</p><p><a href="${link}">Open the review page</a></p>`;
  const attachments = [];
  for (const g of groups) {
    text += `\n${g.label}\n`; html += `<h3 style="margin:18px 0 6px">${esc(g.label)}</h3>`;
    for (const r of g.rows) {
      const data = await Q.load(r.project_id), c = Q.compute(data), S = await Sch.load(r.project_id), lines = weekSummary(data, c, ws, S && { S, st: Sch.status(S, weekEndOf(ws)) });
      text += `  ${r.name} (${r.job_no})\n` + lines.map((l) => `    - ${l}\n`).join('');
      html += `<p style="margin:6px 0 2px"><b>${esc(r.name)}</b> <span style="color:#667">${esc(r.job_no)}${r.wo_no ? ' · WO ' + esc(r.wo_no) : ''}</span></p><ul style="margin:0 0 8px">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
      attachments.push({ name: pdfName(r), data: await pdfFor(r) });
    }
  }
  html += '<p style="color:#667">When every report for an owner is approved, that owner gets one email with all of their reports.</p>';
  await mail.send({ to: rv.map((u) => u.email), subject: `Weekly reports ready for review – week of ${nice(ws)}`, text, html, attachments });
  await pool.query('UPDATE weekly_reports SET review_sent_at = NOW() WHERE week_ending = ? AND review_sent_at IS NULL', [we]);
  return rv.map((u) => u.email);
}

function groupByOwner(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.owner_id || 0;
    if (!m.has(k)) m.set(k, { ownerId: r.owner_id, label: r.owner_id ? `${r.owner_name}${r.owner_company ? ' – ' + r.owner_company : ''}` : 'No owner set (can’t be emailed)', emails: r.owner_emails, rows: [] });
    m.get(k).rows.push(r);
  }
  return [...m.values()];
}

// Send one owner every approved report for the week, in one email.
async function sendOwner(ownerId, we) {
  const rows = (await weekReports(we)).filter((r) => r.owner_id === ownerId);
  if (!rows.length) throw new Error('No reports for that owner this week');
  if (rows.some((r) => r.status !== 'approved' && r.status !== 'sent')) throw new Error('Not every report for this owner is approved yet');
  const ws = weekStartOf(we), to = String(rows[0].owner_emails || '').split(/[,;\s]+/).filter((e) => /@/.test(e));
  if (!to.length) throw new Error('That owner has no email address');
  const rv = await reviewers();
  const owner = rows[0].owner_name.split(' ')[0];
  let text = `${owner},\n\nAttached are AAB Engineering's construction observation reports for the week of ${nice(ws)} – ${nice(we)}. Here's a quick summary of the work:\n`;
  let html = `<p>${esc(owner)},</p><p>Attached are AAB Engineering's construction observation reports for the week of <b>${nice(ws)} – ${nice(we)}</b>. Here's a quick summary of the work:</p>`;
  const attachments = [];
  for (const r of rows) {
    const data = await Q.load(r.project_id), c = Q.compute(data), S = await Sch.load(r.project_id), lines = weekSummary(data, c, ws, S && { S, st: Sch.status(S, weekEndOf(ws)) });
    text += `\n${r.name} (Project ${r.job_no}${r.wo_no ? ', WO ' + r.wo_no : ''})\n` + lines.map((l) => `  - ${l}\n`).join('') + (r.notes ? `  Notes: ${r.notes}\n` : '');
    html += `<p style="margin:14px 0 2px"><b>${esc(r.name)}</b> <span style="color:#667">Project ${esc(r.job_no)}${r.wo_no ? ' · WO ' + esc(r.wo_no) : ''}</span></p><ul style="margin:0 0 6px">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>${r.notes ? `<p style="margin:0 0 8px"><i>${esc(r.notes)}</i></p>` : ''}`;
    attachments.push({ name: pdfName(r), data: await pdfFor(r) });
  }
  const sig = rv[0] ? rv[0].name : 'AAB Engineering';
  text += `\nPlease let us know if you have any questions.\n\n${sig}\nAAB Engineering, LLC\n`;
  html += `<p>Please let us know if you have any questions.</p><p>${esc(sig)}<br>AAB Engineering, LLC</p>`;
  await mail.send({ to, cc: rv.map((u) => u.email), replyTo: rv[0] && rv[0].email, subject: `AAB Engineering – weekly construction reports – week of ${nice(ws)}`, text, html, attachments });
  await pool.query(`UPDATE weekly_reports SET status = 'sent', sent_at = NOW(), sent_to = ? WHERE id IN (?)`, [to.join(', '), rows.map((r) => r.id)]);
  return to;
}

// ---------- cron (cPanel, Sunday evening) ----------
router.get('/cron/weekly', async (req, res) => {
  const key = String(req.query.key || '');
  if (!config.cronKey || key.length !== config.cronKey.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.cronKey))) return res.status(403).send('no');
  // cPanel runs this hourly on the server's clock. Act from Sunday 6 PM Central on
  // (or any later day, to catch up if a run was missed); ?week=YYYY-MM-DD forces a week.
  const now = new Date(), ct = (o) => now.toLocaleString('en-US', { timeZone: 'America/Chicago', ...o });
  if (!req.query.week && ct({ weekday: 'short' }) === 'Sun' && Number(ct({ hour: 'numeric', hour12: false })) < 18) return res.json({ waiting: 'until Sunday 6 PM Central' });
  const ws = DATE.test(req.query.week || '') ? R.mondayOf(req.query.week) : lastWeekStart();
  const rows = await prepareWeek(ws);
  if (!rows.length) return res.json({ week: ws, reports: 0 });
  const pending = rows.filter((r) => !r.review_sent_at);
  let sentTo = [];
  if (pending.length || req.query.resend) sentTo = await sendReviewRequest(ws, rows);
  res.json({ week: ws, reports: rows.length, reviewRequestTo: sentTo });
});

// ---------- review pages ----------
router.get('/reviews', auth.requireLogin, canView, async (req, res) => {
  const [[r]] = await pool.query("SELECT DATE_FORMAT(MAX(week_ending), '%Y-%m-%d') we FROM weekly_reports");
  const q = req.query.msg ? `?msg=${encodeURIComponent(req.query.msg)}` : '';
  res.redirect(`/reviews/${r && r.we ? r.we : weekEndOf(lastWeekStart())}${q}`);
});

router.get('/reviews/:we', auth.requireLogin, canView, async (req, res, next) => {
  if (!DATE.test(req.params.we)) return next();
  const we = weekEndOf(R.mondayOf(req.params.we));
  if (we !== req.params.we) return res.redirect(`/reviews/${we}`);
  const ws = weekStartOf(we);
  const rows = await prepareWeek(ws);
  const user = req.session.user, approver = user.role === 'reviewer';
  const groups = groupByOwner(rows);
  const [weeks] = await pool.query("SELECT DATE_FORMAT(week_ending, '%Y-%m-%d') we, COUNT(*) n, SUM(status IN ('approved','sent')) ok FROM weekly_reports GROUP BY week_ending ORDER BY week_ending DESC LIMIT 12");
  const sum = new Map();
  for (const r of rows) { const data = await Q.load(r.project_id), S = await Sch.load(r.project_id); sum.set(r.id, weekSummary(data, Q.compute(data), ws, S && { S, st: Sch.status(S, we) })); }
  const tag = (s) => `<span class="tag ${s === 'sent' ? 'active' : s === 'approved' ? 'active' : 'setup'}">${s === 'review' || s === 'draft' ? 'to review' : s}</span>`;
  const body = `
    <div class="card"><div class="head"><div><h1>Weekly reports</h1><div class="mute">Week of ${nice(ws)} – ${nice(we)}, ${we.slice(0, 4)}</div></div>
      <div style="display:flex;gap:8px"><a class="btn sm sec" href="/reviews/${R.addDays(we, -7)}">‹ Earlier week</a>${we < weekEndOf(lastWeekStart()) ? `<a class="btn sm sec" href="/reviews/${R.addDays(we, 7)}">Later week ›</a>` : ''}</div></div>
      ${req.query.msg ? `<p class="notice">${esc(req.query.msg)}</p>` : ''}
      ${!mail.configured() ? '<p class="err">Email isn’t set up yet, so approved reports can’t be sent. See the setup notes.</p>'
        : '<form method="post" action="/mail/test" class="inline"><button class="btn sm sec">Send test email to me</button></form>'}
      ${approver ? '<p class="mute">Open each report, add any notes for the owner, and approve it. When every report for an owner is approved, that owner gets one email with a summary of the week and all of their reports attached (you’re copied).</p>'
        : '<p class="mute">Joe (reviewer) approves these. You can preview them here.</p>'}
    </div>
    ${groups.length ? groups.map((g) => {
      const allOk = g.rows.every((r) => r.status === 'approved' || r.status === 'sent'), sent = g.rows.every((r) => r.status === 'sent');
      return `<div class="card"><div class="head"><div><h2 style="margin:0">${esc(g.label)}</h2>${g.emails ? `<div class="mute">${esc(g.emails)}</div>` : ''}</div>
        <div>${sent ? `<span class="tag active">sent ${esc(g.rows[0].sent_at ? require('./db').utc(g.rows[0].sent_at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')}</span>`
          : g.ownerId ? `<span class="mute">${g.rows.filter((r) => r.status === 'approved' || r.status === 'sent').length} of ${g.rows.length} approved</span>` : ''}
        ${approver && g.ownerId && allOk ? `<form method="post" action="/reviews/${we}/owners/${g.ownerId}/send" class="inline" style="margin-left:8px"><button class="btn sm sec">${sent ? 'Send again' : 'Send now'}</button></form>` : ''}</div></div>
        ${g.rows.map((r) => `<div class="rrow">
          <div class="rhead"><b>${esc(r.name)}</b> <span class="mute">${esc(r.job_no)}${r.wo_no ? ' · WO ' + esc(r.wo_no) : ''}</span> ${tag(r.status)}
            <a class="btn sm sec" href="/reports/${r.id}.pdf" target="_blank" rel="noopener">${r.status === 'approved' || r.status === 'sent' ? 'Report PDF' : 'Preview PDF'}</a></div>
          <ul class="sumlist">${sum.get(r.id).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          ${approver && (r.status === 'review' || r.status === 'draft') ? `<form method="post" action="/reports/${r.id}/approve">
              <label>Notes for the owner <span class="mute">(optional; printed on the report and in the email)</span><textarea name="notes" rows="2">${esc(r.notes || '')}</textarea></label>
              <button class="btn sm">Approve</button></form>`
            : r.notes ? `<p class="mute">Notes: ${esc(r.notes)}</p>` : ''}
          ${approver && r.status === 'approved' ? `<form method="post" action="/reports/${r.id}/reopen" class="inline"><button class="btn sm sec">Reopen</button></form> <span class="mute">Approved by ${esc(r.approver || '')}</span>` : ''}
          ${r.status === 'sent' ? `<span class="mute">Approved by ${esc(r.approver || '')} · sent to ${esc(r.sent_to || '')}</span>` : ''}
        </div>`).join('')}
        ${!g.ownerId ? '<p class="err">Set an owner on these projects (project page) so their reports can be emailed.</p>' : ''}
      </div>`;
    }).join('') : '<div class="card"><p class="mute">No daily logs that week, so no reports.</p></div>'}
    <div class="card"><h2>Recent weeks</h2><table><tbody>${weeks.map((w) => `<tr><td><a href="/reviews/${w.we}">Week ending ${nice(w.we)}, ${w.we.slice(0, 4)}</a></td><td class="n mute">${w.ok} of ${w.n} approved</td></tr>`).join('')}</tbody></table></div>`;
  res.send(views.layout({ title: 'Weekly reports', user, body }));
});

router.get('/reports/:id.pdf', auth.requireLogin, canView, async (req, res, next) => {
  const [[r]] = await pool.query(`SELECT r.*, DATE_FORMAT(r.week_ending, '%Y-%m-%d') we, p.name, p.job_no, u.name approver FROM weekly_reports r
    JOIN projects p ON p.id = r.project_id LEFT JOIN users u ON u.id = r.approved_by WHERE r.id = ?`, [req.params.id]);
  if (!r) return next();
  const buf = await pdfFor(r);
  res.set('Content-Type', 'application/pdf').set('Content-Disposition', `inline; filename="${pdfName(r)}"`).send(buf);
});

router.post('/reports/:id/approve', auth.requireLogin, canApprove, async (req, res, next) => {
  const [[r0]] = await pool.query('SELECT * FROM weekly_reports WHERE id = ?', [req.params.id]);
  if (!r0) return next();
  const we = dstr(r0.week_ending);
  if (r0.status === 'sent') return res.redirect(`/reviews/${we}?msg=${encodeURIComponent('That report was already sent.')}`);
  await pool.query("UPDATE weekly_reports SET notes = ?, status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?",
    [String((req.body || {}).notes || '').slice(0, 4000) || null, req.session.user.id, r0.id]);
  // freeze the approved PDF
  const [[r]] = await pool.query(`SELECT r.*, DATE_FORMAT(r.week_ending, '%Y-%m-%d') we, p.name, p.job_no, p.owner_id, u.name approver FROM weekly_reports r
    JOIN projects p ON p.id = r.project_id LEFT JOIN users u ON u.id = r.approved_by WHERE r.id = ?`, [r0.id]);
  r.pdf_file = null;
  const buf = await pdfFor(r), file = `report-${r.project_id}-${we}-${Date.now()}.pdf`;
  fs.writeFileSync(path.join(reportDir(), file), buf);
  await pool.query('UPDATE weekly_reports SET pdf_file = ? WHERE id = ?', [file, r.id]);
  let msg = `Approved ${r.name}.`;
  if (r.owner_id) {
    const group = (await weekReports(we)).filter((x) => x.owner_id === r.owner_id);
    if (group.every((x) => x.status === 'approved' || x.status === 'sent') && group.some((x) => x.status === 'approved')) {
      try { const to = await sendOwner(r.owner_id, we); msg += ` All of this owner’s reports are approved, so they were emailed to ${to.join(', ')}.`; } catch (e) { msg += ` Couldn’t email the owner: ${e.message}`; }
    }
  } else msg += ' This project has no owner set, so it can’t be emailed.';
  res.redirect(`/reviews/${we}?msg=${encodeURIComponent(msg)}`);
});

router.post('/reports/:id/reopen', auth.requireLogin, canApprove, async (req, res, next) => {
  const [[r]] = await pool.query('SELECT * FROM weekly_reports WHERE id = ?', [req.params.id]);
  if (!r) return next();
  if (r.status === 'approved') await pool.query("UPDATE weekly_reports SET status = 'review', approved_by = NULL, approved_at = NULL, pdf_file = NULL WHERE id = ?", [r.id]);
  res.redirect(`/reviews/${dstr(r.week_ending)}`);
});

router.post('/reviews/:we/owners/:oid/send', auth.requireLogin, canApprove, async (req, res) => {
  let msg;
  try { msg = `Emailed to ${(await sendOwner(Number(req.params.oid), req.params.we)).join(', ')}.`; } catch (e) { msg = e.message; }
  res.redirect(`/reviews/${req.params.we}?msg=${encodeURIComponent(msg)}`);
});

// Owner/admin/reviewer: send a test email to yourself to check the email setup.
router.post('/mail/test', auth.requireLogin, canView, async (req, res) => {
  let msg;
  try {
    await mail.send({ to: [req.session.user.email], subject: 'AAB Field – test email', text: 'Email from the field app is working. Weekly reports will go out from this address.',
      attachments: [{ name: 'test.pdf', data: (() => { const { PDF } = require('./pdf'); const p = new PDF(); p.addPage(); p.text(40, 40, 'Test attachment from AAB Field', { size: 14 }); return p.build({ title: 'Test' }); })() }] });
    msg = `Test email sent to ${req.session.user.email}.`;
  } catch (e) { msg = `Test email failed: ${e.message}`; }
  res.redirect(`/reviews?msg=${encodeURIComponent(msg)}`);
});

// Logs in a week whose report is approved or sent are locked.
async function weekLocked(projectId, date) {
  const we = weekEndOf(R.mondayOf(date));
  const [[r]] = await pool.query("SELECT status FROM weekly_reports WHERE project_id = ? AND week_ending = ? AND status IN ('approved','sent')", [projectId, we]);
  return r ? r.status : null;
}

// ---------- owners ----------
const canManageOwners = auth.requireRole('owner', 'admin', 'reviewer');
router.get('/owners', auth.requireLogin, canManageOwners, async (req, res) => {
  const [owners] = await pool.query('SELECT o.*, COUNT(p.id) n FROM owners o LEFT JOIN projects p ON p.owner_id = o.id GROUP BY o.id ORDER BY o.name');
  const body = `<div class="card"><h1>Owners</h1><p class="mute">Each owner gets one weekly email covering all of their projects, once Joe has approved every one of that week’s reports.</p>
    ${req.query.msg ? `<p class="notice">${esc(req.query.msg)}</p>` : ''}
    <table><thead><tr><th>Owner</th><th>Emails</th><th class="n">Projects</th><th></th></tr></thead><tbody>
    ${owners.map((o) => `<tr><form method="post" action="/owners/${o.id}"><td><input name="name" value="${esc(o.name)}" required><input name="company" value="${esc(o.company || '')}" placeholder="Company"></td>
      <td><input name="emails" value="${esc(o.emails)}" required></td><td class="n">${o.n}</td><td><button class="btn sm sec">Save</button></td></form></tr>`).join('')}
    </tbody></table></div>
    <div class="card"><h2>Add an owner</h2><form method="post" action="/owners" class="grid2">
      <label>Contact name<input name="name" required></label><label>Company<input name="company"></label>
      <label style="grid-column:1/-1">Emails <span class="mute">(separate with commas)</span><input name="emails" required></label>
      <div><button class="btn sm">Add owner</button></div></form></div>`;
  res.send(views.layout({ title: 'Owners', user: req.session.user, body }));
});
const cleanEmails = (s) => String(s || '').split(/[,;\s]+/).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).join(', ');
router.post('/owners', auth.requireLogin, canManageOwners, async (req, res) => {
  const b = req.body || {}, emails = cleanEmails(b.emails);
  if (!String(b.name || '').trim() || !emails) return res.redirect('/owners?msg=' + encodeURIComponent('Enter a name and at least one email.'));
  await pool.query('INSERT INTO owners (name, company, emails) VALUES (?,?,?)', [String(b.name).trim().slice(0, 160), String(b.company || '').trim().slice(0, 160) || null, emails]);
  res.redirect('/owners?msg=' + encodeURIComponent('Owner added. Set it on their projects from each project page.'));
});
router.post('/owners/:id', auth.requireLogin, canManageOwners, async (req, res) => {
  const b = req.body || {}, emails = cleanEmails(b.emails);
  if (!String(b.name || '').trim() || !emails) return res.redirect('/owners?msg=' + encodeURIComponent('Enter a name and at least one email.'));
  await pool.query('UPDATE owners SET name = ?, company = ?, emails = ? WHERE id = ?', [String(b.name).trim().slice(0, 160), String(b.company || '').trim().slice(0, 160) || null, emails, req.params.id]);
  res.redirect('/owners?msg=Saved.');
});
router.post('/projects/:id/owner', auth.requireLogin, canManageOwners, async (req, res) => {
  const oid = Number((req.body || {}).owner_id) || null;
  await pool.query('UPDATE projects SET owner_id = ? WHERE id = ?', [oid, req.params.id]);
  res.redirect(`/projects/${req.params.id}`);
});

// ---------- CSV exports (for Excel / Power BI) ----------
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
async function exportProjects(req) {
  const id = Number(req.query.project) || null;
  const [ps] = await pool.query(`SELECT p.id, p.job_no, p.wo_no, p.name, o.name owner FROM projects p LEFT JOIN owners o ON o.id = p.owner_id ${id ? 'WHERE p.id = ?' : ''} ORDER BY p.job_no`, id ? [id] : []);
  return ps;
}
router.get('/export/daily-logs.csv', auth.requireLogin, canView, async (req, res) => {
  const out = [['project_no', 'wo_no', 'project', 'owner', 'date', 'week_ending', 'co', 'check_in', 'crew', 'no_crew', 'weather', 'rain_in', 'weather_edited', 'equipment', 'work', 'notes', 'photos']];
  for (const p of await exportProjects(req)) {
    const data = await Q.load(p.id);
    for (const l of data.logs) out.push([p.job_no, p.wo_no, p.name, p.owner, l.date, weekEndOf(R.mondayOf(l.date)), l.author, l.check_in, l.crew_count, l.no_crew ? 1 : 0, l.weather,
      l.rain_in == null ? '' : Number(l.rain_in).toFixed(2), l.weather_edited ? 1 : 0, l.equipment.join('; '), l.work.join('; '), l.notes, l.photos.length]);
  }
  res.set('Content-Type', 'text/csv').set('Content-Disposition', `attachment; filename="aab-daily-logs-${todayStr()}.csv"`).send(csv(out));
});
router.get('/export/quantities.csv', auth.requireLogin, canView, async (req, res) => {
  const out = [['project_no', 'wo_no', 'project', 'owner', 'date', 'week_ending', 'item', 'item_name', 'unit', 'quantity', 'design_quantity']];
  const names = new Map(Q.ITEMS.map(([k, n, u]) => [k, [n, u]]));
  for (const p of await exportProjects(req)) {
    const data = await Q.load(p.id), c = Q.compute(data);
    for (const d of c.days) {
      for (const [k, v] of Object.entries(d.q)) {
        const [n, u] = names.get(k) || [k, ''];
        out.push([p.job_no, p.wo_no, p.name, p.owner, d.date, weekEndOf(R.mondayOf(d.date)), k, n, u, u === 'AC' ? v.toFixed(3) : u === 'EA' ? v : v.toFixed(1), c.design[k] == null ? '' : u === 'AC' ? c.design[k].toFixed(3) : Math.round(c.design[k])]);
      }
    }
  }
  res.set('Content-Type', 'text/csv').set('Content-Disposition', `attachment; filename="aab-quantities-${todayStr()}.csv"`).send(csv(out));
});

module.exports = { router, weekLocked, lastWeekStart, weekSummary, prepareWeek };
