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
    </nav>` : '<nav class="top"></nav>';
  return `<!DOCTYPE html>
<html lang="en" data-theme="night"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AAB Field</title>
<script>try{document.documentElement.dataset.theme=localStorage.getItem('aabfield-theme')||'night'}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Saira+Condensed:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/app.css">
</head><body>
<header class="bar"><div class="in ${wide ? 'wide' : ''}"><a class="brand" href="/"><svg class="logo" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="29" stroke="var(--line2)" stroke-width="1.5"/><circle cx="32" cy="32" r="22" stroke="var(--line2)" stroke-width="1"/><path d="M32 1v6M32 57v6M1 32h6M57 32h6" stroke="var(--accent2)" stroke-width="1.5"/><path d="M14 40l7-15 7 15M24 40l7-15 7 15M38 25h6a4 4 0 010 7.5 4 4 0 010 7.5h-6zM13 25h20M13 40h31" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round" style="filter:drop-shadow(0 0 4px var(--glow))"/></svg> AAB Field</a>${nav}
<button class="iconbtn" id="themeBtn" type="button" title="Night / day (sunlight) display"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button></div></header>
<main class="${wide ? 'wide' : ''}">${body}</main>
<script>document.getElementById('themeBtn').onclick=function(){var d=document.documentElement,t=d.dataset.theme==='day'?'night':'day';d.dataset.theme=t;try{localStorage.setItem('aabfield-theme',t)}catch(e){}};</script>
</body></html>`;
}

// Scripts for map pages. The Google key is restricted to cm.aabeng.com in
// Google Cloud, so it is safe in the page (that is how Maps keys work).
const mapScripts = (mapsKey) => `<script>window.AAB_MAPS_KEY=${JSON.stringify(mapsKey || '')};</script>
<script src="/static/js/proj4.js"></script><script src="/static/js/geo.js"></script><script src="/static/js/maps.js"></script>`;

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
      <tr><td>${esc(p.job_no)}</td><td>${esc(p.wo_no || '')}</td><td><a href="/projects/${p.id}">${esc(p.name)}</a></td><td>${esc(p.client || '')}</td><td><span class="tag ${esc(p.status)}">${esc(p.status)}</span></td></tr>`).join('')
    : '<tr><td colspan="5" class="mute">No projects yet.</td></tr>';
  return layout({ title: 'Projects', user, body: `
    <div class="card">
      <div class="head"><h1>Projects</h1>${canSetup(user) ? '<a class="btn sm" href="/projects/new">New project</a>' : ''}</div>
      <table><thead><tr><th>Project</th><th>WO</th><th>Name</th><th>Client</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
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

function projectFormPage({ user, error, form = {}, mapsKey }) {
  return layout({ title: 'New project', user, body: `
    <div class="card">
      <h1>New project</h1>
      ${errBox(error)}
      <form method="post" action="/projects" class="grid">
        <label>Project (file) number<input name="job_no" placeholder="1714-12" value="${esc(form.job_no)}" required></label>
        <label>WO number<input name="wo_no" placeholder="26-243.0" value="${esc(form.wo_no)}"></label>
        <label>Project name<input name="name" placeholder="The Grove Phase 1" value="${esc(form.name)}" required></label>
        <label>Client<input name="client" placeholder="Executive Homes" value="${esc(form.client)}"></label>
        <label>Client report emails <span class="mute">(comma separated)</span><input name="client_emails" value="${esc(form.client_emails)}"></label>
        <div style="grid-column:1/-1">
          <label style="margin-bottom:6px">Site location <span class="mute">(for weather; filled in from the DXF automatically if you skip it)</span></label>
          ${mapsKey ? '<div id="picker" class="pickmap"></div><p class="mute" style="margin:6px 0 12px">Tap the site on the map to drop a pin; drag the pin to adjust.</p>' : ''}
          <div class="grid" ${mapsKey ? 'style="display:none"' : ''}>
            <label>Latitude<input name="latitude" id="lat" inputmode="decimal" placeholder="36.06" value="${esc(form.latitude)}"></label>
            <label>Longitude<input name="longitude" id="lng" inputmode="decimal" placeholder="-95.79" value="${esc(form.longitude)}"></label>
          </div>
        </div>
        <div><button class="btn">Create and set up design</button></div>
      </form>
    </div>
    ${mapsKey ? mapScripts(mapsKey) + `<script>AABMaps.picker(document.getElementById('picker'), document.getElementById('lat'), document.getElementById('lng')).catch(function(){document.getElementById('picker').outerHTML='<p class="err">The map didn\u2019t load. Enter latitude and longitude instead.</p>';document.querySelector('.grid[style]').style.display='';});</script>` : ''}` });
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

function projectPage({ user, project: p, totals, mapsKey }) {
  return layout({ title: p.name, user, wide: true, body: `
    <div class="card">
      <div class="head"><div><h1>${esc(p.name)}</h1><div class="mute">Project ${esc(p.job_no)} · WO ${esc(p.wo_no || '—')}${p.client ? ' · ' + esc(p.client) : ''}${p.latitude != null ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${Number(p.latitude)},${Number(p.longitude)}" target="_blank" rel="noopener">${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}</a>` : ''}</div></div>
      ${canSetup(user) ? `<a class="btn sm sec" href="/projects/${p.id}/setup">${totals.lines.length ? 'Replace design' : 'Load design from DXF'}</a>` : ''}</div>
    </div>
    <div class="cols">
      <div class="card"><h2>Design quantities</h2>${totalsTable(totals, !!p.has_curb)}</div>
      <div class="card grow"><h2>Plan</h2><div id="plan" class="planbox" data-project="${p.id}"></div></div>
    </div>
    ${mapScripts(mapsKey)}<script src="/static/js/plan.js"></script>
    <script>AABPlan.mount(document.getElementById('plan'));</script>` });
}

function setupDesignPage({ user, project: p, locked, mapsKey }) {
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
        <label>Drawing coordinate system<select id="crs"><option value="EPSG:2267" ${p.crs === 'EPSG:2268' ? '' : 'selected'}>Oklahoma North state plane (NAD83, US ft)</option><option value="EPSG:2268" ${p.crs === 'EPSG:2268' ? 'selected' : ''}>Oklahoma South state plane (NAD83, US ft)</option></select></label>
        <p class="mute" id="siteLoc"></p>
        ${p.latitude != null ? '<label class="chk"><input type="checkbox" id="useDrawingLocation"> Replace the picked site location with the drawing’s center</label>' : ''}
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
    ${mapScripts(mapsKey)}<script src="/static/js/plan.js"></script>
    <script src="/static/js/setup.js"></script>
    <script>AABSetup.init(${p.id});</script>` });
}

module.exports = { esc, layout, loginPage, setupPage, homePage, usersPage, projectFormPage, projectPage, setupDesignPage, ITEM_NAMES, KIND_NAMES, PAVING_ITEMS };
