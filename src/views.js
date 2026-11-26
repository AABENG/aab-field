// Small server-rendered pages. No template engine: escape everything that
// comes from a user or the database with esc().
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ title, user, body, wide = false }) {
  const nav = user ? `
    <nav class="top">
      <a href="/">Projects</a>
      ${['owner', 'admin'].includes(user.role) ? '<a href="/users">Users</a>' : ''}
      <span class="who">${esc(user.name)}</span>
      <form method="post" action="/logout"><button class="link">Sign out</button></form>
    </nav>` : '';
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AAB Field</title>
<link rel="stylesheet" href="/static/app.css">
</head><body>
<header class="bar"><div class="in ${wide ? 'wide' : ''}"><a class="brand" href="/">AAB Field</a>${nav}</div></header>
<main class="${wide ? 'wide' : ''}">${body}</main>
</body></html>`;
}

const errBox = (msg) => (msg ? `<p class="err">${esc(msg)}</p>` : '');

function loginPage({ error, email }) {
  return layout({ title: 'Sign in', body: `
    <div class="card narrow">
      <h1>Sign in</h1>
      ${errBox(error)}
      <form method="post" action="/login">
        <label>Email<input type="email" name="email" value="${esc(email)}" autocomplete="username" required autofocus></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn">Sign in</button>
      </form>
    </div>` });
}

function setupPage({ error, form = {} }) {
  return layout({ title: 'First-time setup', body: `
    <div class="card narrow">
      <h1>First-time setup</h1>
      <p class="mute">No one has an account yet. Create the owner account. This page turns itself off once it's used.</p>
      ${errBox(error)}
      <form method="post" action="/setup">
        <label>Your name<input name="name" value="${esc(form.name)}" required></label>
        <label>Email<input type="email" name="email" value="${esc(form.email)}" required></label>
        <label>Password <span class="mute">(10+ characters)</span><input type="password" name="password" minlength="10" required></label>
        <button class="btn">Create owner account</button>
      </form>
    </div>` });
}

const canSetup = (u) => ['owner', 'admin', 'reviewer'].includes(u.role);

function homePage({ user, projects }) {
  const rows = projects.length ? projects.map((p) => `
      <tr><td>${esc(p.job_no)}</td><td><a href="/projects/${p.id}">${esc(p.name)}</a></td><td>${esc(p.client || '')}</td><td><span class="tag ${esc(p.status)}">${esc(p.status)}</span></td></tr>`).join('')
    : '<tr><td colspan="4" class="mute">No projects yet.</td></tr>';
  return layout({ title: 'Projects', user, body: `
    <div class="card">
      <div class="head"><h1>Projects</h1>${canSetup(user) ? '<a class="btn sm" href="/projects/new">New project</a>' : ''}</div>
      <table><thead><tr><th>Job</th><th>Name</th><th>Client</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    </div>` });
}

function usersPage({ user, users, roles, roleLabels, error, notice }) {
  const opts = (sel) => roles.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${esc(roleLabels[r])}</option>`).join('');
  const rows = users.map((u) => `
    <tr class="${u.active ? '' : 'off'}">
      <td>${esc(u.name)}<div class="mute">${esc(u.email)}</div></td>
      <td>
        <form method="post" action="/users/${u.id}" class="inline">
          <select name="role" ${u.id === user.id ? 'disabled' : ''}>${opts(u.role)}</select>
          <label class="chk"><input type="checkbox" name="active" value="1" ${u.active ? 'checked' : ''} ${u.id === user.id ? 'disabled' : ''}> Active</label>
          <input type="password" name="password" placeholder="New password (optional)" minlength="10">
          <button class="btn sm">Save</button>
        </form>
      </td>
      <td class="mute">${u.last_login_at ? esc(u.last_login_at) : 'Never'}</td>
    </tr>`).join('');
  return layout({ title: 'Users', user, wide: true, body: `
    <div class="card">
      <h1>Users</h1>
      ${errBox(error)}${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
      <table><thead><tr><th>Person</th><th>Role, status, password</th><th>Last sign-in</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="card">
      <h2>Add a user</h2>
      <form method="post" action="/users" class="grid">
        <label>Name<input name="name" required></label>
        <label>Email<input type="email" name="email" required></label>
        <label>Role<select name="role">${opts('co')}</select></label>
        <label>Temporary password <span class="mute">(10+ characters)</span><input type="password" name="password" minlength="10" required></label>
        <div><button class="btn">Add user</button></div>
      </form>
    </div>` });
}

const ITEM_NAMES = { wl: 'Waterline', ss: 'Sanitary sewer', sd: 'Storm sewer', cl: 'Street centerline' };
// Paving is tracked as three items measured along the street centerline.
const PAVING_ITEMS = [['sg', 'Subgrade'], ['cb', 'Curb and gutter'], ['pv', 'Paving']];
const KIND_NAMES = { mh: 'Sanitary manholes', st: 'Storm structures', fh: 'Fire hydrants', vv: 'Water valves' };

function projectFormPage({ user, error, form = {} }) {
  return layout({ title: 'New project', user, body: `
    <div class="card">
      <h1>New project</h1>
      ${errBox(error)}
      <form method="post" action="/projects" class="grid">
        <label>Job number<input name="job_no" placeholder="1714-12" value="${esc(form.job_no)}" required></label>
        <label>Project name<input name="name" placeholder="The Grove Phase 1" value="${esc(form.name)}" required></label>
        <label>Client<input name="client" placeholder="Executive Homes" value="${esc(form.client)}"></label>
        <label>Client report emails <span class="mute">(comma separated)</span><input name="client_emails" value="${esc(form.client_emails)}"></label>
        <label>Site latitude <span class="mute">(for weather)</span><input name="latitude" inputmode="decimal" placeholder="36.06" value="${esc(form.latitude)}"></label>
        <label>Site longitude<input name="longitude" inputmode="decimal" placeholder="-95.79" value="${esc(form.longitude)}"></label>
        <div><button class="btn">Create and set up design</button></div>
      </form>
    </div>` });
}

function totalsTable(totals, hasCurb = true) {
  const rows = [];
  for (const k of ['wl', 'ss', 'sd']) {
    const r = totals.lines.find((x) => x.item === k);
    if (r) rows.push(`<tr><td>${ITEM_NAMES[k]}</td><td class="n">${Math.round(Number(r.ft)).toLocaleString()} LF</td><td class="n mute">${r.n} line${r.n > 1 ? 's' : ''}</td></tr>`);
  }
  const cl = totals.lines.find((x) => x.item === 'cl');
  if (cl) {
    for (const [k, name] of PAVING_ITEMS) {
      if (k === 'cb' && !hasCurb) continue;
      rows.push(`<tr><td>${name}</td><td class="n">${Math.round(Number(cl.ft)).toLocaleString()} LF</td><td class="n mute">of street centerline</td></tr>`);
    }
  }
  for (const k of Object.keys(KIND_NAMES)) {
    const r = totals.structures.find((x) => x.kind === k);
    if (r) rows.push(`<tr><td>${KIND_NAMES[k]}</td><td class="n">${r.n} EA</td><td></td></tr>`);
  }
  return rows.length ? `<table><thead><tr><th>Item</th><th class="n">Design (100%)</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<p class="mute">No design loaded yet.</p>';
}

function projectPage({ user, project: p, totals }) {
  return layout({ title: p.name, user, wide: true, body: `
    <div class="card">
      <div class="head"><div><h1>${esc(p.name)}</h1><div class="mute">${esc(p.job_no)}${p.client ? ' · ' + esc(p.client) : ''}</div></div>
      ${canSetup(user) ? `<a class="btn sm sec" href="/projects/${p.id}/setup">${totals.lines.length ? 'Replace design' : 'Load design from DXF'}</a>` : ''}</div>
    </div>
    <div class="cols">
      <div class="card"><h2>Design quantities</h2>${totalsTable(totals, !!p.has_curb)}</div>
      <div class="card grow"><h2>Plan</h2><div id="plan" class="planbox" data-project="${p.id}"></div></div>
    </div>
    <script src="/static/js/plan.js"></script>
    <script>AABPlan.mount(document.getElementById('plan'));</script>` });
}

function setupDesignPage({ user, project: p, locked }) {
  return layout({ title: 'Design setup · ' + p.name, user, wide: true, body: `
    <div class="card">
      <h1>Design setup: ${esc(p.name)}</h1>
      ${locked ? '<p class="err">Field progress has been logged on this design, so it can’t be replaced.</p>' : `
      <p class="mute">Pick the project's plan DXF. It's read here in your browser; only the linework you tag is sent to the server. Profiles, contours, grids and drainage-area layers are skipped automatically.</p>
      <input type="file" id="dxfFile" accept=".dxf">
      <div id="readStatus" class="mute" style="margin-top:8px"></div>`}
    </div>
    <div id="setupUI" class="hide">
      <div class="card">
        <h2>1. Limit to the project area</h2>
        <label>Boundary layer <span class="mute">(lines outside it, plus a margin, are ignored; keeps profile views out)</span>
          <select id="boundary"></select></label>
        <label>Margin around boundary (ft)<input id="margin" type="number" value="150" min="0" step="10"></label>
      </div>
      <div class="card">
        <h2>2. Tag the layers</h2>
        <p class="mute">Guesses are filled in from layer names; check them. Lengths are inside the project area.</p>
        <div class="tablewrap"><table id="layerTable"><thead><tr><th>Layer</th><th class="n">Lines</th><th class="n">Length (ft)</th><th class="n">Symbols</th><th>Use lines as</th><th>Options</th><th>Symbols as</th></tr></thead><tbody></tbody></table></div>
      </div>
      <div class="card">
        <h2>3. Check the plan</h2>
        <p class="mute">Click a colored line to leave it out (it turns gray and dashed); click again to bring it back.</p>
        <div id="preview" class="planbox tall"></div>
        <label class="chk" style="margin-top:10px"><input type="checkbox" id="hasCurb" checked> This project has curb and gutter <span class="mute">(paving is tracked as subgrade, curb and gutter, and paving along the street centerline; uncheck for streets without curb)</span></label>
        <div id="previewTotals" style="margin-top:10px"></div>
        <div style="margin-top:12px"><button class="btn" id="saveDesign">Save design</button> <span id="saveStatus" class="mute"></span></div>
      </div>
    </div>
    <script src="/static/js/dxf.js"></script>
    <script src="/static/js/plan.js"></script>
    <script src="/static/js/setup.js"></script>
    <script>AABSetup.init(${p.id});</script>` });
}

module.exports = { esc, layout, loginPage, setupPage, homePage, usersPage, projectFormPage, projectPage, setupDesignPage, ITEM_NAMES, KIND_NAMES, PAVING_ITEMS };
