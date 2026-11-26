// Runs against a real MySQL/MariaDB database named by DB_* env vars.
// Usage: DB_PASSWORD=... SESSION_SECRET=... npm test   (uses a throwaway DB)
const { test, before, after } = require('node:test');
const assert = require('node:assert');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(40);
const { pool, migrate } = require('../src/db');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { buildApp } = require('../src/server');

let server, base, store;
const jar = {};
async function req(method, path, { form, who = 'a' } = {}) {
  const headers = { origin: base };
  if (jar[who]) headers.cookie = jar[who];
  let body;
  if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  const r = await fetch(base + path, { method, headers, body, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc) jar[who] = sc.split(';')[0];
  return { status: r.status, location: r.headers.get('location'), text: await r.text() };
}

before(async () => {
  for (const t of ['weekly_reports', 'photos', 'log_areas', 'log_progress', 'daily_logs', 'project_members', 'project_structures', 'history_items', 'history_jobs', 'earthwork_progress', 'project_schedule', 'project_weights', 'project_lines', 'projects', 'contractors', 'owners', 'users', 'sessions', 'schema_migrations']) {
    await pool.query(`DROP TABLE IF EXISTS ${t}`);
  }
  await migrate();
  await migrate(); // second run must be a no-op
  store = new MySQLStore({ createDatabaseTable: true, clearExpired: false }, pool);
  const app = buildApp(store);
  await new Promise((ok) => { server = app.listen(0, ok); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await store.close(); await pool.end(); });

test('health reports database ok', async () => {
  const r = await req('GET', '/health');
  assert.equal(r.status, 200);
  assert.match(r.text, /"db":"ok"/);
});

test('with no users, sign-in redirects to first-time setup', async () => {
  const r = await req('GET', '/login');
  assert.equal(r.location, '/setup');
});

test('setup creates the owner and signs in; setup then turns off', async () => {
  const bad = await req('POST', '/setup', { form: { name: 'Alan', email: 'alan@aabeng.com', password: 'short' } });
  assert.equal(bad.status, 400);
  const r = await req('POST', '/setup', { form: { name: 'Alan Betchan', email: 'Alan@AABENG.com', password: 'correct horse battery' } });
  assert.equal(r.location, '/');
  const home = await req('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Projects/);
  const again = await req('GET', '/setup', { who: 'b' });
  assert.equal(again.location, '/login');
});

test('owner adds a CO; CO can sign in but cannot manage users', async () => {
  const add = await req('POST', '/users', { form: { name: 'Field Tech', email: 'co@aabeng.com', role: 'co', password: 'tempPassword1' } });
  assert.equal(add.status, 200);
  assert.match(add.text, /Added Field Tech/);
  const wrong = await req('POST', '/login', { who: 'c', form: { email: 'co@aabeng.com', password: 'nope-nope-nope' } });
  assert.equal(wrong.status, 401);
  const ok = await req('POST', '/login', { who: 'c', form: { email: 'co@aabeng.com', password: 'tempPassword1' } });
  assert.equal(ok.location, '/');
  const users = await req('GET', '/users', { who: 'c' });
  assert.equal(users.status, 302); assert.equal(users.location, '/'); // COs only get the daily log
});

test('signed-out visitors are sent to sign in', async () => {
  const r = await req('GET', '/', { who: 'nobody' });
  assert.equal(r.location, '/login');
});

test('cross-site posts are blocked', async () => {
  const r = await fetch(base + '/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=a&password=b' });
  assert.equal(r.status, 403);
});
