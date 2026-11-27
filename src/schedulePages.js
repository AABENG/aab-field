// Schedule page for each project and the contractor history page.
const express = require('express');
const { pool } = require('./db');
const auth = require('./auth');
const views = require('./views');
const Sch = require('./schedule');

const router = express.Router();
const esc = views.esc;
const canEdit = auth.requireRole('owner', 'admin', 'reviewer');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nice = (d) => (d ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}` : '—');
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const pct = (f) => (f == null ? '—' : `${Math.round(f * 100)}%`);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

const dayTxt = (v) => (v == null ? '' : v === 0 ? 'on schedule' : `${Math.abs(v)} day${Math.abs(v) === 1 ? '' : 's'} ${v < 0 ? 'behind' : 'ahead'}`);
// One item's status in words: "9 days behind", "done 3 days early", "should have started 4 days ago".
function itemStatus(it) {
  if (it.state === 'done') return it.varianceDays == null ? 'done' : it.varianceDays === 0 ? 'done on time' : `done ${Math.abs(it.varianceDays)} day${Math.abs(it.varianceDays) === 1 ? '' : 's'} ${it.varianceDays > 0 ? 'early' : 'late'}`;
  if (it.state === 'stalled') return `no progress in 4 weeks${it.varianceDays != null ? ` · ${dayTxt(it.varianceDays)}` : ''}`;
  if (it.state === 'late') return `not started · ${-it.varianceDays} day${it.varianceDays === -1 ? '' : 's'} late starting`;
  if (it.state === 'working') return it.varianceDays == null ? 'under way' : dayTxt(it.varianceDays);
  return 'not started';
}
// Email / page summary: items under way (or late to start), then the completion forecast.
function statusLine(st) {
  if (!st.ntp && !st.hasPlan) return 'Set the notice to proceed date and contract days, then propose a schedule.';
  const parts = st.items.filter((i) => ['working', 'stalled', 'late'].includes(i.state)).map((i) => `${i.name} ${itemStatus(i)}`);
  if (st.forecast) parts.push(`forecast completion ${nice(st.forecast)}${st.contractEnd ? ` (contract ${nice(st.contractEnd)})` : ''}`);
  else if (st.contractEnd) parts.push(`contract completion ${nice(st.contractEnd)}`);
  return parts.join(' · ') || 'No work under way.';
}

router.get('/projects/:id/schedule', auth.requireLogin, canEdit, async (req, res, next) => {
  const S = await Sch.load(req.params.id);
  if (!S) return next();
  const p = S.p, asOf = today(), st = Sch.status(S, asOf);
  const [contractors] = await pool.query('SELECT id, name FROM contractors ORDER BY name');
  const csel = (field) => `<select name="${field}"><option value="">—</option>${contractors.map((c) => `<option value="${c.id}" ${c.id === p[field] ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
  const items = Sch.ITEMS.filter(([k]) => (k === 'cb' ? p.has_curb : true)).filter(([k]) => k === 'clear' || k === 'earth' || S.c.design[k] || S.sched[k]);
  const body = `
  <div class="card"><div class="head"><div><h1>Schedule</h1><div class="mute">${esc(p.name)} · Project ${esc(p.job_no)}${p.wo_no ? ' · WO ' + esc(p.wo_no) : ''}</div></div>
    <a class="btn sm sec" href="/projects/${p.id}">Back to project</a></div>
    ${req.query.msg ? `<p class="notice">${esc(req.query.msg)}</p>` : ''}
    <p><b>${esc(statusLine(st))}</b></p>
  </div>

  <div class="card"><h2>Contract</h2>
    <form method="post" action="/projects/${p.id}/schedule/settings" class="grid2">
      <label>Notice to proceed<input type="date" name="ntp_date" value="${esc(Sch.ymd(p.ntp_date) || '')}"></label>
      <label>Contract time (calendar days)<input type="number" min="1" name="contract_days" value="${esc(p.contract_days || '')}"></label>
      <label>Grading contractor ${csel('grading_contractor_id')}</label>
      <label>Utility contractor ${csel('utility_contractor_id')}</label>
      <label>Paving contractor ${csel('paving_contractor_id')}</label>
      <label>Add a contractor <span class="mute">(then pick them above)</span><input name="new_contractor" placeholder="Company name"></label>
      <label style="grid-column:1/-1">NAS folder <span class="mute">(where approved reports and photos are copied, relative to the QNAP projects share; blank = CM Archive/${esc(p.job_no)} ${esc(p.name)})</span>
        <input name="nas_folder" value="${esc(p.nas_folder || '')}" placeholder="e.g. 1714/1714-12 The Grove/Construction"></label>
      <div><button class="btn sm">Save</button></div>
    </form></div>

  <div class="card"><div class="head"><h2 style="margin:0">Planned dates by item</h2>
    <form method="post" action="/projects/${p.id}/schedule/propose" class="inline"><button class="btn sm sec" ${st.ntp ? '' : 'disabled title="Set the notice to proceed date first"'}>Propose from contractor history</button></form></div>
    <p class="mute">A proposal uses the contractors' production rates and the usual gaps between items from <a href="/history">contractor history</a>. It replaces rows marked "proposed". Rows marked "contractor's schedule" are kept, so enter the contractor's dates there when you get them.</p>
    <form method="post" action="/projects/${p.id}/schedule/items"><table><thead><tr><th>Item</th><th>Start</th><th>Finish</th><th class="n">Days</th><th>Source</th><th class="n">Done / planned today</th><th>Status</th><th>Forecast finish</th><th>Worked</th></tr></thead><tbody>
    ${items.map(([k, n]) => { const s = S.sched[k] || {}; const it = st.items.find((x) => x.item === k) || {};
      return `<tr><td>${n}</td><td><input type="date" name="start_${k}" value="${esc(s.start || '')}" style="width:140px"></td><td><input type="date" name="finish_${k}" value="${esc(s.finish || '')}" style="width:140px"></td>
      <td class="n">${s.start && s.finish ? Sch.d2n(s.finish) - Sch.d2n(s.start) + 1 : ''}</td>
      <td><select name="source_${k}" style="min-width:150px">${[['proposed', 'proposed'], ['contractor', "contractor's schedule"], ['manual', 'set by AAB']].map(([v, l]) => `<option value="${v}" ${s.source === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td class="n" style="white-space:nowrap">${pct(it.actual)} / ${pct(it.planned)}</td>
      <td style="white-space:nowrap;color:${it.varianceDays != null && it.varianceDays < 0 && it.state !== 'done' ? '#e5484d' : 'inherit'}">${it.state ? esc(itemStatus(it)) : ''}</td>
      <td style="white-space:nowrap">${it.forecast ? nice(it.forecast) : ''}</td><td class="mute" style="white-space:nowrap">${it.firstWork ? `${md(it.firstWork)} – ${md(it.lastWork)}` : ''}</td></tr>`; }).join('')}
    </tbody></table><button class="btn sm">Save dates</button></form></div>

  <div class="card"><h2>Earthwork percent (from LiDAR volumes)</h2>
    <p class="mute">After each volume flight, enter the earthwork percent complete. Reports use the latest entry on or before the week's end.</p>
    <table><tbody>${S.earth.map((e) => `<tr><td>${nice(e.as_of)}</td><td class="n">${e.pct}%</td><td class="mute">${esc(e.note || '')}</td>
      <td><form method="post" action="/projects/${p.id}/schedule/earth/${e.id}/delete" class="inline"><button class="btn sm sec">Remove</button></form></td></tr>`).join('') || '<tr><td class="mute">No entries yet.</td></tr>'}</tbody></table>
    <form method="post" action="/projects/${p.id}/schedule/earth" class="grid2" style="margin-top:10px">
      <label>Flight date<input type="date" name="as_of" required></label><label>Percent complete<input type="number" step="0.1" min="0" max="100" name="pct" required></label>
      <label style="grid-column:1/-1">Note<input name="note" placeholder="e.g. 41,200 of 96,500 CY moved"></label><div><button class="btn sm">Add</button></div></form></div>`;
  res.send(views.layout({ title: 'Schedule', user: req.session.user, body, wide: true }));
});

const back = (res, id, msg) => res.redirect(`/projects/${id}/schedule${msg ? '?msg=' + encodeURIComponent(msg) : ''}`);
const intOrNull = (v) => (Number(v) > 0 ? Math.floor(Number(v)) : null);

router.post('/projects/:id/schedule/settings', auth.requireLogin, canEdit, async (req, res) => {
  const b = req.body || {};
  if (String(b.new_contractor || '').trim()) await pool.query('INSERT IGNORE INTO contractors (name) VALUES (?)', [String(b.new_contractor).trim().slice(0, 160)]);
  await pool.query(`UPDATE projects SET ntp_date = ?, contract_days = ?, grading_contractor_id = ?, utility_contractor_id = ?, paving_contractor_id = ?, nas_folder = ? WHERE id = ?`,
    [DATE.test(b.ntp_date || '') ? b.ntp_date : null, intOrNull(b.contract_days), intOrNull(b.grading_contractor_id), intOrNull(b.utility_contractor_id), intOrNull(b.paving_contractor_id),
      require('./archive').cleanPath(b.nas_folder) || null, req.params.id]);
  back(res, req.params.id, 'Saved.');
});

router.post('/projects/:id/schedule/items', auth.requireLogin, canEdit, async (req, res) => {
  const b = req.body || {};
  for (const [k] of Sch.ITEMS) {
    const s = b['start_' + k], f = b['finish_' + k];
    if (DATE.test(s || '') && DATE.test(f || '') && f >= s) {
      const src = ['proposed', 'contractor', 'manual'].includes(b['source_' + k]) ? b['source_' + k] : 'manual';
      await pool.query(`INSERT INTO project_schedule (project_id, item, start_date, finish_date, source) VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE start_date = VALUES(start_date), finish_date = VALUES(finish_date), source = VALUES(source)`, [req.params.id, k, s, f, src]);
    } else if (!s && !f) await pool.query('DELETE FROM project_schedule WHERE project_id = ? AND item = ?', [req.params.id, k]);
  }
  back(res, req.params.id, 'Dates saved.');
});

router.post('/projects/:id/schedule/propose', auth.requireLogin, canEdit, async (req, res) => {
  const S = await Sch.load(req.params.id);
  let msg;
  try {
    const prop = Sch.propose(S, await Sch.historyRows());
    let kept = 0;
    for (const [k, v] of Object.entries(prop)) {
      if (S.sched[k] && S.sched[k].source !== 'proposed') { kept++; continue; }
      await pool.query(`INSERT INTO project_schedule (project_id, item, start_date, finish_date, source) VALUES (?,?,?,?,'proposed')
        ON DUPLICATE KEY UPDATE start_date = VALUES(start_date), finish_date = VALUES(finish_date), source = 'proposed'`, [req.params.id, k, v.start, v.finish]);
    }
    const end = Object.values(prop).map((v) => v.finish).sort().pop();
    const basis = Object.entries(prop).map(([k, v]) => `${Sch.NAME[k]}: ${v.basis}`).join('; ');
    msg = `Proposed schedule finishes ${nice(end)}${S.p.contract_days && S.p.ntp_date ? ` (contract completion ${nice(Sch.addDays(Sch.ymd(S.p.ntp_date), Number(S.p.contract_days)))})` : ''}. ${kept ? `Kept ${kept} row(s) from the contractor's schedule. ` : ''}Based on ${basis}.`;
  } catch (e) { msg = e.message; }
  back(res, req.params.id, msg);
});

router.post('/projects/:id/schedule/weights', auth.requireLogin, canEdit, async (req, res) => {
  const b = req.body || {};
  await pool.query('DELETE FROM project_weights WHERE project_id = ?', [req.params.id]);
  for (const k of Sch.WEIGHT_ITEMS) {
    const v = Number(String(b['w_' + k] || '').replace(/[$,\s]/g, ''));
    if (v > 0) await pool.query('INSERT INTO project_weights (project_id, item, amount) VALUES (?,?,?)', [req.params.id, k, v]);
  }
  back(res, req.params.id, 'Amounts saved.');
});
router.post('/projects/:id/schedule/weights/reset', auth.requireLogin, canEdit, async (req, res) => {
  await pool.query('DELETE FROM project_weights WHERE project_id = ?', [req.params.id]);
  back(res, req.params.id, 'Back to the Grove-based defaults.');
});
router.post('/projects/:id/schedule/earth', auth.requireLogin, canEdit, async (req, res) => {
  const b = req.body || {}, v = Number(b.pct);
  if (DATE.test(b.as_of || '') && v >= 0 && v <= 100) await pool.query('INSERT INTO earthwork_progress (project_id, as_of, pct, note) VALUES (?,?,?,?)', [req.params.id, b.as_of, v, String(b.note || '').slice(0, 255) || null]);
  back(res, req.params.id, 'Earthwork entry added.');
});
router.post('/projects/:id/schedule/earth/:eid/delete', auth.requireLogin, canEdit, async (req, res) => {
  await pool.query('DELETE FROM earthwork_progress WHERE id = ? AND project_id = ?', [req.params.eid, req.params.id]);
  back(res, req.params.id, 'Removed.');
});

// ---------- contractor history ----------
router.get('/history', auth.requireLogin, canEdit, async (req, res) => {
  const rows = await Sch.historyRows();
  const [jobs] = await pool.query("SELECT id, job_no, name, DATE_FORMAT(ntp_date, '%Y-%m-%d') ntp, project_id FROM history_jobs ORDER BY job_no");
  const [contractors] = await pool.query('SELECT id, name FROM contractors ORDER BY name');
  const [projects] = await pool.query("SELECT id, job_no, name FROM projects WHERE status <> 'setup' ORDER BY job_no");
  const body = `<div class="card"><h1>Contractor history</h1>
    <p class="mute">Finished jobs that proposed schedules are built from: who did each item, how much, and when it started and finished. Production rates come from quantity ÷ calendar days; the gaps between items come from the start dates. Fill in The Grove and Pines III from their old weekly reports.</p>
    ${req.query.msg ? `<p class="notice">${esc(req.query.msg)}</p>` : ''}</div>
    ${jobs.map((j) => `<div class="card"><form method="post" action="/history/${j.id}">
      <div class="head"><h2 style="margin:0">${esc(j.job_no)} ${esc(j.name)}</h2><label class="inline">Notice to proceed <input type="date" name="ntp_date" value="${esc(j.ntp || '')}"></label></div>
      <table><thead><tr><th>Item</th><th>Contractor</th><th class="n">Quantity</th><th>Start</th><th>Finish</th><th class="n">Rate</th></tr></thead><tbody>
      ${Sch.ITEMS.map(([k, n]) => { const r = rows.find((x) => x.job === j.id && x.item === k) || {};
        const rate = r.quantity && r.start && r.finish ? Number(r.quantity) / (Sch.d2n(r.finish) - Sch.d2n(r.start) + 1) : null;
        return `<tr><td>${n}</td><td><select name="c_${k}"><option value="">—</option>${contractors.map((c) => `<option value="${c.id}" ${c.id === r.contractor_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></td>
          <td class="n"><input name="q_${k}" value="${r.quantity != null ? Number(r.quantity) : ''}" style="width:90px;text-align:right" placeholder="${k === 'clear' || k === 'earth' ? 'n/a' : 'LF'}"></td>
          <td><input type="date" name="s_${k}" value="${esc(r.start || '')}"></td><td><input type="date" name="f_${k}" value="${esc(r.finish || '')}"></td>
          <td class="n mute">${rate ? Math.round(rate) + ' LF/day' : r.start && r.finish ? Sch.d2n(r.finish) - Sch.d2n(r.start) + 1 + ' days' : ''}</td></tr>`; }).join('')}
      </tbody></table><button class="btn sm">Save</button></form></div>`).join('')}
    <div class="card"><h2>Add a job</h2>
      <form method="post" action="/history/from-project" class="inline" style="margin-bottom:12px"><span class="mute">From a finished job logged in this app:</span>
        <select name="project_id">${projects.map((p) => `<option value="${p.id}">${esc(p.job_no)} ${esc(p.name)}</option>`).join('')}</select> <button class="btn sm sec">Add with its logged dates</button></form>
      <form method="post" action="/history" class="grid2"><label>Project number<input name="job_no" required></label><label>Name<input name="name" required></label><div><button class="btn sm">Add an older job</button></div></form></div>`;
  res.send(views.layout({ title: 'Contractor history', user: req.session.user, body, wide: true }));
});
router.post('/history', auth.requireLogin, canEdit, async (req, res) => {
  const b = req.body || {};
  if (String(b.job_no || '').trim() && String(b.name || '').trim()) await pool.query('INSERT INTO history_jobs (job_no, name) VALUES (?,?)', [String(b.job_no).trim().slice(0, 20), String(b.name).trim().slice(0, 160)]);
  res.redirect('/history');
});
router.post('/history/from-project', auth.requireLogin, canEdit, async (req, res) => {
  await Sch.addHistoryFromProject(Number((req.body || {}).project_id));
  res.redirect('/history?msg=' + encodeURIComponent('Added with the first and last day each item was worked. Check the dates and contractors.'));
});
router.post('/history/:id', auth.requireLogin, canEdit, async (req, res) => {
  const b = req.body || {}, id = req.params.id;
  await pool.query('UPDATE history_jobs SET ntp_date = ? WHERE id = ?', [DATE.test(b.ntp_date || '') ? b.ntp_date : null, id]);
  for (const [k] of Sch.ITEMS) {
    const q = Number(String(b['q_' + k] || '').replace(/,/g, '')) || null, s = DATE.test(b['s_' + k] || '') ? b['s_' + k] : null, f = DATE.test(b['f_' + k] || '') ? b['f_' + k] : null;
    const c = Number(b['c_' + k]) || null;
    if (!q && !s && !f && !c) { await pool.query('DELETE FROM history_items WHERE job_id = ? AND item = ?', [id, k]); continue; }
    await pool.query(`INSERT INTO history_items (job_id, item, contractor_id, quantity, start_date, finish_date) VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE contractor_id = VALUES(contractor_id), quantity = VALUES(quantity), start_date = VALUES(start_date), finish_date = VALUES(finish_date)`, [id, k, c, q, s, f]);
  }
  res.redirect('/history?msg=Saved.');
});

module.exports = { router, statusLine, itemStatus };
