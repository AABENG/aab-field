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

function homePage({ user, projects }) {
  const rows = projects.length ? projects.map((p) => `
      <tr><td>${esc(p.job_no)}</td><td>${esc(p.name)}</td><td>${esc(p.client || '')}</td><td><span class="tag ${esc(p.status)}">${esc(p.status)}</span></td></tr>`).join('')
    : '<tr><td colspan="4" class="mute">No projects yet. Project setup from a DXF comes in the next step.</td></tr>';
  return layout({ title: 'Projects', user, body: `
    <div class="card">
      <h1>Projects</h1>
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

module.exports = { esc, layout, loginPage, setupPage, homePage, usersPage };
