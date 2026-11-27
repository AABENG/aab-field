// Project close-out (spec: project doc "CM Portal: Project Close-Out Spec").
//   1. Joe or Alan starts close-out with the substantial completion date; items
//      short of the design quantity need a note.
//   2. The week holding that date becomes the FINAL REPORT and goes to Joe for
//      approval like any other week.
//   3/4. The final report carries the as-built exhibit (on the aerial) and the
//      schedule summary; both are also saved as their own PDFs when it's approved.
//   5. The QNAP sync copies everything and reports back; only then is the project
//      marked Archived.
//   6. Approval closes the project: off the CO list, out of the Sunday run, and
//      read-only for everyone until Joe or Alan reopens it (logged).
//   7. The project's dates and quantities become contractor history.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { pool } = require('./db');
const auth = require('./auth');
const views = require('./views');
const config = require('./config');
const Q = require('./quantities');
const R = require('./report');
const Sch = require('./schedule');
const { jpegInfo } = require('./pdf');

const router = express.Router();
const esc = views.esc;
const canClose = auth.requireRole('owner', 'reviewer'); // Alan and Joe
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nice = (d) => (d ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}` : '—');
const dstr = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const reportDir = () => { const d = config.reportDir || path.join(config.uploadDir, 'reports'); fs.mkdirSync(d, { recursive: true }); return d; };

async function logEvent(projectId, userId, action, note) {
  await pool.query('INSERT INTO project_events (project_id, user_id, action, note) VALUES (?,?,?,?)', [projectId, userId || null, action, note || null]);
}

// Each tracked item: design vs. installed through `asOf`.
const TRACKED = [['wl', 'Waterline', 'LF'], ['ss', 'Sanitary sewer', 'LF'], ['sd', 'Storm sewer', 'LF'], ['sg', 'Subgrade', 'LF'], ['cb', 'Curb and gutter', 'LF'],
  ['pv', 'Paving', 'LF'], ['mh', 'Sanitary manholes', 'EA'], ['st', 'Storm structures', 'EA'], ['fh', 'Fire hydrants', 'EA'], ['vv', 'Water valves', 'EA'], ['clear', 'Clearing', 'AC']];
function completeness(data, c, asOf) {
  const { toDate } = Q.summarize(c, '1900-01-01', asOf);
  return TRACKED.filter(([k]) => c.design[k] && (k !== 'cb' || data.project.has_curb)).map(([k, name, unit]) => {
    const design = c.design[k], done = Math.min(design, toDate[k] || 0);
    return { k, name, unit, design, done, pct: design ? done / design : 1 };
  });
}
const fq = (v, unit) => (unit === 'AC' ? v.toFixed(2) : Math.round(v).toLocaleString('en-US'));

// ---------- what the final report and close-out PDFs need ----------
async function contractorNames(p) {
  const ids = [p.grading_contractor_id, p.utility_contractor_id, p.paving_contractor_id].filter(Boolean);
  if (!ids.length) return {};
  const [rows] = await pool.query('SELECT id, name FROM contractors WHERE id IN (?)', [ids]);
  const n = Object.fromEntries(rows.map((r) => [r.id, r.name]));
  return { grading: n[p.grading_contractor_id], utility: n[p.utility_contractor_id], paving: n[p.paving_contractor_id] };
}
async function scheduleSummary(S, completion, note) {
  const st = Sch.status(S, completion), names = await contractorNames(S.p);
  const trade = Object.fromEntries(Sch.ITEMS.map(([k, , t]) => [k, t]));
  const { toDate } = Q.summarize(S.c, '1900-01-01', completion);
  const qty = (k) => {
    if (k === 'earth') { const f = S.earth.filter((e) => e.as_of <= completion).pop(); return f ? `${Math.round(f.pct)}% (LiDAR ${f.as_of.slice(5).replace('-', '/')})` : '—'; }
    const unit = k === 'clear' ? 'AC' : 'LF', d = S.c.design[k];
    return d ? `${fq(Math.min(d, toDate[k] || 0), unit)} / ${fq(d, unit)} ${unit}` : '—';
  };
  return {
    ntp: st.ntp, contractEnd: st.contractEnd, days: st.days, completion, note,
    items: st.items.filter((i) => i.plan || i.firstWork).map((i) => ({
      item: i.item, name: i.name, contractor: names[trade[i.item]] || null, plan: i.plan, start: i.firstWork, finish: i.actual >= 0.999 || i.lastWork ? i.lastWork : null, qty: qty(i.item),
    })),
  };
}
async function finalOpt(projectId, data, c) {
  const p = data.project, completion = dstr(p.substantial_completion);
  const S = await Sch.load(projectId);
  return { completion, note: p.closeout_note, asBuilt: { asOf: completion, ortho: loadOrtho(p) }, summary: await scheduleSummary(S, completion, p.closeout_note) };
}

// Joe approved the final report: save the close-out PDFs, close the project,
// and add it to contractor history.
async function finalize(reportId, userId) {
  const [[r]] = await pool.query('SELECT * FROM weekly_reports WHERE id = ?', [reportId]);
  if (!r || !r.is_final) return null;
  const data = await Q.load(r.project_id), c = Q.compute(data), fo = await finalOpt(r.project_id, data, c);
  const stamp = Date.now();
  const ab = `asbuilt-${r.project_id}-${stamp}.pdf`, su = `schedule-summary-${r.project_id}-${stamp}.pdf`;
  fs.writeFileSync(path.join(reportDir(), ab), R.buildAsBuilt(data, c, fo.asBuilt));
  fs.writeFileSync(path.join(reportDir(), su), R.buildSummary(data, fo.summary));
  await pool.query('UPDATE weekly_reports SET asbuilt_file = ?, summary_file = ? WHERE id = ?', [ab, su, r.id]);
  await pool.query("UPDATE projects SET status = 'closed', closed_at = NOW(), archived_at = NULL WHERE id = ?", [r.project_id]);
  await logEvent(r.project_id, userId, 'closed', 'Final report approved');
  try { await Sch.addHistoryFromProject(r.project_id); } catch (e) { console.error('history from closed project', e.message); }
  return { aerial: !!fo.asBuilt.ortho };
}

// ---------- as-built flight ortho ----------
// The browser crops the ortho to the site and shrinks it (public/js/ortho.js),
// then sends the JPEG and where it sits in drawing feet.
function loadOrtho(p) {
  if (!p.ortho_file || !p.ortho_json) return null;
  try {
    const jpeg = fs.readFileSync(path.join(config.uploadDir, path.basename(p.ortho_file)));
    return { jpeg, place: JSON.parse(p.ortho_json), flown: dstr(p.ortho_flown) };
  } catch (e) { return null; }
}
router.post('/api/projects/:id/ortho', auth.requireLogin, canClose, express.json({ limit: '25mb' }), async (req, res) => {
  const p = await getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'No such project' });
  const b = req.body || {}, q = b.place || {};
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(b.image || ''));
  const buf = m ? Buffer.from(m[1], 'base64') : null, info = buf && jpegInfo(buf);
  if (!info) return res.status(400).json({ error: 'The image didn’t come through as a JPEG.' });
  if (!['x0', 'y0', 'px', 'py'].every((k) => Number.isFinite(q[k])) || !(q.px > 0) || !(q.py < 0)) return res.status(400).json({ error: 'Missing the image placement.' });
  if (b.flown && !DATE.test(b.flown)) return res.status(400).json({ error: 'Flight date should be a date.' });
  const file = `ortho-${p.id}-${Date.now()}.jpg`;
  fs.writeFileSync(path.join(config.uploadDir, file), buf);
  if (p.ortho_file) fs.rm(path.join(config.uploadDir, path.basename(p.ortho_file)), () => {});
  const place = { x0: q.x0, y0: q.y0, px: q.px, py: q.py, w: info.w, h: info.h };
  await pool.query('UPDATE projects SET ortho_file = ?, ortho_json = ?, ortho_flown = ? WHERE id = ?', [file, JSON.stringify(place), b.flown || null, p.id]);
  res.json({ ok: true, w: info.w, h: info.h, kb: Math.round(buf.length / 1024) });
});
router.get('/projects/:id/ortho.jpg', auth.requireLogin, auth.requireRole('owner', 'admin', 'reviewer'), async (req, res, next) => {
  const p = await getProject(req.params.id);
  if (!p || !p.ortho_file) return next();
  res.sendFile(path.join(config.uploadDir, path.basename(p.ortho_file)));
});

// The upload card (project page and close page).
function orthoCard(p, user) {
  const can = ['owner', 'reviewer'].includes(user.role) && p.status !== 'closed';
  const have = p.ortho_file ? `<p>Uploaded${p.ortho_flown ? `: flown ${esc(nice(dstr(p.ortho_flown)))}` : ''}. <a href="/projects/${p.id}/ortho.jpg" target="_blank">View</a></p>` : '<p class="mute">None yet. Without it the as-built exhibit is drawn on the plain plan base.</p>';
  return `<div class="card" id="orthoCard"><h2>As-built flight (aerial for the as-built exhibit)</h2>${have}
    ${can ? `<p class="mute">From the final flight, export the orthomosaic as a <b>JPEG with its world file</b> (.jgw), north-up, in the same coordinates as the plans (Oklahoma state plane, US feet). Your browser crops it to the site and shrinks it before uploading.</p>
    <div class="grid"><label>Ortho image (JPEG or PNG)<input type="file" id="orthoImg" accept=".jpg,.jpeg,.png"></label>
      <label>World file (.jgw / .pgw / .wld)<input type="file" id="orthoWld" accept=".jgw,.jpw,.pgw,.wld,.tfw,.txt"></label>
      <label>Flight date<input type="date" id="orthoFlown" max="${todayStr()}"></label></div>
    <button type="button" class="btn sm" id="orthoGo">Upload as-built flight</button> <span id="orthoMsg" class="mute"></span>
    <script src="/static/js/ortho.js"></script>
    <script>(function(){
      const $=(i)=>document.getElementById(i), msg=(t,bad)=>{ $('orthoMsg').textContent=t; $('orthoMsg').className=bad?'err':'mute'; };
      $('orthoGo').onclick = async () => {
        try {
          const f=$('orthoImg').files[0], w=$('orthoWld').files[0];
          if(!f||!w) return msg('Pick the image and its world file.', true);
          msg('Reading…');
          const world = AABOrtho.parseWorld(await w.text());
          const D = await (await fetch('/api/projects/${p.id}/design')).json();
          let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
          for (const l of D.lines) for (const [x,y] of l.pts) { x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y); }
          const pad=0.08*Math.max(x1-x0,y1-y0);
          const full = await createImageBitmap(f); const W=full.width, H=full.height; full.close();
          const c = AABOrtho.crop(world, W, H, [x0-pad,y0-pad,x1+pad,y1+pad]);
          msg('Cropping to the site…');
          const bmp = await createImageBitmap(f, c.sx, c.sy, c.sw, c.sh, { resizeWidth: c.w, resizeHeight: c.h, resizeQuality: 'high' });
          const cv = document.createElement('canvas'); cv.width=c.w; cv.height=c.h; cv.getContext('2d').drawImage(bmp,0,0);
          const image = cv.toDataURL('image/jpeg', 0.82);
          msg('Uploading…');
          const r = await fetch('/api/projects/${p.id}/ortho', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ image, place: c.place, flown: $('orthoFlown').value || null }) });
          const j = await r.json(); if(!r.ok) throw new Error(j.error||'Upload failed');
          msg('Saved ('+j.w+' × '+j.h+' px, '+j.kb+' KB).'); setTimeout(()=>location.reload(), 900);
        } catch (e) { msg(e.message, true); }
      };
    })();</script>` : ''}</div>`;
}

// ---------- read-only once closed ----------
// Blocks every change to a closed project except reopening it. Runs before the
// project, log, schedule and owner routes.
async function blockClosed(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  let pid = null;
  const m = req.path.match(/^\/(?:api\/)?projects\/(\d+)(?:\/|$)/);
  if (m) pid = +m[1];
  else {
    const ph = req.path.match(/^\/api\/photos\/(\d+)$/);
    if (ph) { const [[x]] = await pool.query('SELECT d.project_id FROM photos p JOIN daily_logs d ON d.id = p.log_id WHERE p.id = ?', [ph[1]]); pid = x && x.project_id; }
  }
  if (!pid || /\/(reopen|close)$/.test(req.path)) return next();
  const [[p]] = await pool.query('SELECT status FROM projects WHERE id = ?', [pid]);
  if (!p || p.status !== 'closed') return next();
  const msg = 'This project is closed and read-only. Joe or Alan can reopen it from the project page.';
  if (req.path.startsWith('/api/')) return res.status(409).json({ error: msg });
  res.redirect(`/projects/${pid}?msg=${encodeURIComponent(msg)}`);
}

// ---------- pages ----------
async function getProject(id) {
  const [[p]] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
  return p || null;
}
function closePage({ user, p, items, error, form = {} }) {
  const short = items.filter((i) => i.pct < 0.9995);
  const rows = items.map((i) => `<tr class="${i.pct < 0.9995 ? 'warnrow' : ''}"><td>${esc(i.name)}</td><td class="n">${fq(i.design, i.unit)} ${i.unit}</td><td class="n">${fq(i.done, i.unit)} ${i.unit}</td>
    <td class="n" style="color:${i.pct < 0.9995 ? '#e5484d' : 'inherit'}">${Math.floor(i.pct * 1000) / 10}%</td></tr>`).join('');
  return views.layout({ title: 'Close project · ' + p.name, user, body: `
    <div class="card">
      <div class="head"><div><h1>Close project</h1><div class="mute">${esc(p.name)} · Project ${esc(p.job_no)} · WO ${esc(p.wo_no || '—')}</div></div><a class="btn sm sec" href="/projects/${p.id}">Back</a></div>
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      <p>Closing builds a <b>FINAL REPORT</b> for the week of the substantial completion date, with the as-built exhibit and the schedule summary attached, and sends it to Joe for approval. When Joe approves it, the owner gets it in their weekly email and the project is closed: COs can't see it, it's left out of the Sunday run, and it's read-only until Joe or Alan reopens it. Once the QNAP confirms it has copied everything, the project is marked Archived.</p>
      <h2>Installed vs. design (through today)</h2>
      <table><thead><tr><th>Item</th><th class="n">Design</th><th class="n">Installed</th><th class="n">Complete</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="mute">No design loaded.</td></tr>'}</tbody></table>
      ${short.length ? `<p class="err" style="margin-top:12px">${short.length} item${short.length > 1 ? 's are' : ' is'} below 100% of the design quantity: ${short.map((i) => esc(i.name)).join(', ')}. Say why in the close-out note to go ahead.</p>` : '<p class="ok" style="margin-top:12px">Every tracked item is at 100% of the design quantity.</p>'}
      ${p.ortho_file ? `<p class="ok">As-built flight uploaded${p.ortho_flown ? ` (flown ${esc(nice(dstr(p.ortho_flown)))})` : ''}: it will be the aerial on the as-built exhibit.</p>` : `<p class="err">No as-built flight uploaded yet. Upload it on the <a href="/projects/${p.id}#orthoCard">project page</a> before Joe approves, or the as-built exhibit is drawn without an aerial.</p>`}
      <form method="post" action="/projects/${p.id}/close" class="grid" style="margin-top:12px">
        <label>Substantial completion date<input type="date" name="completion" required max="${todayStr()}" value="${esc(form.completion || '')}"></label>
        <label>Close-out note ${short.length ? '<span class="mute">(required: why items are short of design)</span>' : '<span class="mute">(optional; printed on the final report)</span>'}
          <textarea name="note" rows="4" ${short.length ? 'required' : ''} placeholder="e.g. 113 LF of waterline under 131st St. deleted by City of Broken Arrow change; as-built per city direction.">${esc(form.note || '')}</textarea></label>
        <div><button class="btn">Start close-out and send the final report to Joe</button></div>
      </form>
    </div>` });
}

router.get('/projects/:id/close', auth.requireLogin, canClose, async (req, res, next) => {
  const p = await getProject(req.params.id);
  if (!p) return next();
  if (p.status === 'closed' || p.status === 'closing') return res.redirect(`/projects/${p.id}`);
  const data = await Q.load(p.id), c = Q.compute(data);
  res.send(closePage({ user: req.session.user, p, items: completeness(data, c, todayStr()) }));
});

router.post('/projects/:id/close', auth.requireLogin, canClose, async (req, res, next) => {
  const p = await getProject(req.params.id);
  if (!p) return next();
  if (p.status === 'closed' || p.status === 'closing') return res.redirect(`/projects/${p.id}`);
  const b = req.body || {}, completion = String(b.completion || ''), note = String(b.note || '').trim().slice(0, 4000);
  const data = await Q.load(p.id), c = Q.compute(data);
  const again = (error) => res.status(400).send(closePage({ user: req.session.user, p, items: completeness(data, c, DATE.test(completion) ? completion : todayStr()), error, form: { completion, note } }));
  if (!DATE.test(completion)) return again('Enter the substantial completion date.');
  if (completion > todayStr()) return again('Substantial completion can’t be in the future.');
  const short = completeness(data, c, completion).filter((i) => i.pct < 0.9995);
  if (short.length && !note) return again(`${short.map((i) => i.name).join(', ')} ${short.length > 1 ? 'are' : 'is'} below the design quantity through ${nice(completion)}. Add a close-out note saying why.`);
  const ws = R.mondayOf(completion), we = R.addDays(ws, 5);
  const [[existing]] = await pool.query('SELECT id, status FROM weekly_reports WHERE project_id = ? AND week_ending = ?', [p.id, we]);
  if (existing && (existing.status === 'approved' || existing.status === 'sent')) return again(`The report for the week ending ${nice(we)} is already ${existing.status === 'sent' ? 'approved and sent' : 'approved'}. Reopen it on the review page first so it can become the final report.`);
  await pool.query('UPDATE weekly_reports SET is_final = 0 WHERE project_id = ? AND status IN ("draft","review")', [p.id]);
  await pool.query(`INSERT INTO weekly_reports (project_id, week_ending, status, is_final) VALUES (?, ?, 'review', 1)
    ON DUPLICATE KEY UPDATE is_final = 1, status = 'review', review_sent_at = NULL, pdf_file = NULL`, [p.id, we]);
  await pool.query("UPDATE projects SET status = 'closing', substantial_completion = ?, closeout_note = ? WHERE id = ?", [completion, note || null, p.id]);
  await logEvent(p.id, req.session.user.id, 'close_started', `Substantial completion ${completion}${note ? ` — ${note}` : ''}`);
  let msg = `Close-out started. The final report (week ending ${nice(we)}) is on the review page for Joe.`;
  try {
    const rep = require('./reports');
    const rows = (await rep.weekReports(we)).filter((r) => r.project_id === p.id);
    const to = await rep.sendReviewRequest(ws, rows, { final: true });
    msg += ` Review request emailed to ${to.join(', ')}.`;
  } catch (e) { msg += ` The review email didn't go out (${e.message}); Joe can still find it on the review page.`; }
  res.redirect(`/projects/${p.id}?msg=${encodeURIComponent(msg)}`);
});

router.post('/projects/:id/reopen', auth.requireLogin, canClose, async (req, res, next) => {
  const p = await getProject(req.params.id);
  if (!p) return next();
  const note = String((req.body || {}).note || '').trim().slice(0, 2000);
  if (p.status !== 'closed' && p.status !== 'closing') return res.redirect(`/projects/${p.id}`);
  if (!note) return res.redirect(`/projects/${p.id}?msg=${encodeURIComponent('Say why the project is being reopened.')}`);
  await pool.query("UPDATE projects SET status = 'active', closed_at = NULL, archived_at = NULL WHERE id = ?", [p.id]);
  // a final report that hasn't been approved yet goes back to being a normal week
  await pool.query("UPDATE weekly_reports SET is_final = 0 WHERE project_id = ? AND status IN ('draft','review')", [p.id]);
  await logEvent(p.id, req.session.user.id, 'reopened', note);
  res.redirect(`/projects/${p.id}?msg=${encodeURIComponent('Project reopened. The reopen is in the project history.')}`);
});

// Close-out PDFs saved at approval
router.get('/projects/:id/closeout/:file', auth.requireLogin, auth.requireRole('owner', 'admin', 'reviewer'), async (req, res, next) => {
  const kind = { 'asbuilt.pdf': 'asbuilt', 'summary.pdf': 'summary' }[req.params.file];
  if (!kind) return next();
  const [[r]] = await pool.query('SELECT r.asbuilt_file, r.summary_file, p.job_no, p.name FROM weekly_reports r JOIN projects p ON p.id = r.project_id WHERE r.project_id = ? AND r.is_final = 1 AND r.status IN ("approved","sent") ORDER BY r.week_ending DESC LIMIT 1', [req.params.id]);
  const f = r && (kind === 'asbuilt' ? r.asbuilt_file : r.summary_file);
  if (!f) return next();
  res.set('Content-Type', 'application/pdf').set('Content-Disposition', `inline; filename="${r.job_no} ${r.name.replace(/[^\w .-]+/g, '')} - ${kind === 'asbuilt' ? 'As-built exhibit' : 'Schedule summary'}.pdf"`);
  res.sendFile(path.join(reportDir(), path.basename(f)));
});

// Status block for the project page.
async function projectPanel(p, user) {
  return (await statusPanel(p, user)) + (['owner', 'reviewer', 'admin'].includes(user.role) ? orthoCard(p, user) : '');
}
async function statusPanel(p, user) {
  const can = ['owner', 'reviewer'].includes(user.role);
  const [ev] = await pool.query(`SELECT e.action, e.note, DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i') at, u.name FROM project_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.project_id = ? ORDER BY e.id DESC LIMIT 12`, [p.id]);
  const label = { close_started: 'Close-out started', closed: 'Closed', archived: 'Archived on the NAS', reopened: 'Reopened' };
  const hist = ev.length ? `<details style="margin-top:10px"><summary class="mute">Close-out history</summary><table>${ev.map((e) => `<tr><td class="mute" style="white-space:nowrap">${esc(e.at)}</td><td>${esc(label[e.action] || e.action)}${e.name ? ' · ' + esc(e.name) : ''}</td><td>${esc(e.note || '')}</td></tr>`).join('')}</table></details>` : '';
  const reopen = can ? `<form method="post" action="/projects/${p.id}/reopen" class="inline" style="margin-top:10px"><input name="note" placeholder="Why it's being reopened" required style="min-width:260px"> <button class="btn sm sec">Reopen project</button></form>` : '';
  if (p.status === 'closing') {
    return `<div class="card"><h2>Closing</h2><p>Substantial completion ${esc(nice(dstr(p.substantial_completion)))}. The <b>final report</b> is waiting for Joe's approval on the <a href="/reviews/${R.addDays(R.mondayOf(dstr(p.substantial_completion)), 5)}">review page</a>; approving it closes the project.</p>${p.closeout_note ? `<p class="mute">Note: ${esc(p.closeout_note)}</p>` : ''}${can ? reopen.replace('Reopen project', 'Cancel close-out') : ''}${hist}</div>`;
  }
  if (p.status === 'closed') {
    return `<div class="card"><h2>Closed${p.archived_at ? ' · Archived' : ''}</h2><p>Substantial completion ${esc(nice(dstr(p.substantial_completion)))}. Closed ${esc(nice(dstr(p.closed_at)))}. ${p.archived_at ? `Copied to the NAS ${esc(nice(dstr(p.archived_at)))}.` : 'Waiting for the QNAP to confirm it has copied everything.'} This project is read-only.</p>
      <p><a class="btn sm sec" href="/projects/${p.id}/closeout/asbuilt.pdf" target="_blank">As-built exhibit (PDF)</a> <a class="btn sm sec" href="/projects/${p.id}/closeout/summary.pdf" target="_blank">Schedule summary (PDF)</a></p>${reopen}${hist}</div>`;
  }
  return (can && p.status === 'active' ? `<div class="card"><div class="head"><div><h2 style="margin:0">Close-out</h2><div class="mute">When the work is substantially complete.</div></div><a class="btn sm sec" href="/projects/${p.id}/close">Close project</a></div>${hist}</div>` : '') ;
}

module.exports = { router, finalize, finalOpt, blockClosed, projectPanel, completeness, logEvent, scheduleSummary };
