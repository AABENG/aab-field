const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const config = require('./config');
const { pool, migrate } = require('./db');
const auth = require('./auth');
const views = require('./views');

function sameOrigin(req, res, next) {
  // Basic CSRF guard: state-changing requests must come from our own pages.
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const src = req.get('origin') || req.get('referer');
  if (!src) return next(); // some phones omit both on same-site form posts
  try {
    if (new URL(src).host === req.get('host')) return next();
  } catch (_) { /* fall through */ }
  res.status(403).send('Request blocked (cross-site).');
}

// Slow down password guessing: 10 failed tries per email+IP per 15 minutes.
const failures = new Map();
function tooManyFailures(key) {
  const f = failures.get(key);
  return f && f.count >= 10 && Date.now() - f.first < 15 * 60 * 1000;
}
function recordFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}

function buildApp(store) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(session({
    name: 'aabfield.sid',
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 30 * 24 * 3600 * 1000 },
  }));
  app.use(sameOrigin);

  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, app: 'aab-field', db: 'ok' });
    } catch (e) {
      res.status(500).json({ ok: false, db: 'error' });
    }
  });

  // ---- first-run owner setup (only while there are no users) ----
  app.get('/setup', async (req, res) => {
    if (await auth.userCount()) return res.redirect('/login');
    res.send(views.setupPage({}));
  });
  app.post('/setup', async (req, res) => {
    if (await auth.userCount()) return res.redirect('/login');
    const form = req.body;
    try {
      const id = await auth.createUser({ ...form, role: 'owner' });
      req.session.user = { id, email: form.email.trim().toLowerCase(), name: form.name.trim(), role: 'owner' };
      res.redirect('/');
    } catch (e) {
      res.status(400).send(views.setupPage({ error: e.message, form }));
    }
  });

  // ---- sign in / out ----
  app.get('/login', async (req, res) => {
    if (!(await auth.userCount())) return res.redirect('/setup');
    if (req.session.user) return res.redirect('/');
    res.send(views.loginPage({}));
  });
  app.post('/login', async (req, res) => {
    const email = String(req.body.email || '');
    const key = email.toLowerCase() + '|' + req.ip;
    if (tooManyFailures(key)) {
      return res.status(429).send(views.loginPage({ error: 'Too many tries. Wait 15 minutes and try again.', email }));
    }
    const user = await auth.verify(email, req.body.password);
    if (!user) {
      recordFailure(key);
      return res.status(401).send(views.loginPage({ error: 'Email or password is wrong.', email }));
    }
    failures.delete(key);
    req.session.regenerate((err) => {
      if (err) return res.status(500).send('Could not start a session.');
      req.session.user = user;
      res.redirect('/');
    });
  });
  app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

  // ---- signed-in pages ----
  app.get('/', auth.requireLogin, async (req, res) => {
    const [projects] = await pool.query('SELECT job_no, name, client, status FROM projects ORDER BY status, job_no');
    res.send(views.homePage({ user: req.session.user, projects }));
  });
  app.get('/api/me', auth.requireLogin, (req, res) => res.json(req.session.user));

  // ---- user admin (owner and admin) ----
  const canManage = auth.requireRole('owner', 'admin');
  async function renderUsers(req, res, extra = {}) {
    const [users] = await pool.query('SELECT id, email, name, role, active, last_login_at FROM users ORDER BY active DESC, name');
    res.status(extra.error ? 400 : 200).send(views.usersPage({
      user: req.session.user, users, roles: auth.ROLES, roleLabels: auth.ROLE_LABELS, ...extra }));
  }
  app.get('/users', auth.requireLogin, canManage, (req, res) => renderUsers(req, res));
  app.post('/users', auth.requireLogin, canManage, async (req, res) => {
    try {
      // Only the owner can create another owner.
      if (req.body.role === 'owner' && req.session.user.role !== 'owner') throw new Error('Only the owner can add another owner.');
      await auth.createUser(req.body);
      await renderUsers(req, res, { notice: `Added ${req.body.name}. Give them their email and temporary password.` });
    } catch (e) {
      await renderUsers(req, res, { error: e.message });
    }
  });
  app.post('/users/:id', auth.requireLogin, canManage, async (req, res) => {
    const id = Number(req.params.id);
    const me = req.session.user;
    try {
      const [[target]] = await pool.query('SELECT id, role FROM users WHERE id = ?', [id]);
      if (!target) throw new Error('No such user.');
      if (target.role === 'owner' && me.role !== 'owner') throw new Error('Only the owner can change an owner.');
      if (id !== me.id) {
        const role = req.body.role;
        if (!auth.ROLES.includes(role)) throw new Error('Pick a role.');
        if (role === 'owner' && me.role !== 'owner') throw new Error('Only the owner can make someone an owner.');
        await pool.query('UPDATE users SET role = ?, active = ? WHERE id = ?', [role, req.body.active ? 1 : 0, id]);
      }
      if (req.body.password) {
        if (!auth.validPassword(req.body.password)) throw new Error('Password must be at least 10 characters.');
        const bcrypt = require('bcryptjs');
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(req.body.password, 12), id]);
      }
      await renderUsers(req, res, { notice: 'Saved.' });
    } catch (e) {
      await renderUsers(req, res, { error: e.message });
    }
  });

  app.use((req, res) => res.status(404).send(views.layout({ title: 'Not found', user: req.session.user, body: '<div class="card"><h1>Not found</h1></div>' })));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    res.status(500).send(views.layout({ title: 'Error', user: req.session && req.session.user, body: '<div class="card"><h1>Something went wrong</h1><p class="mute">The error was logged.</p></div>' }));
  });
  return app;
}

async function start() {
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw new Error('Set SESSION_SECRET (32+ random characters) in the cPanel Node.js app environment variables.');
  }
  await migrate();
  const store = new MySQLStore({ createDatabaseTable: true, clearExpired: true }, pool);
  const app = buildApp(store);
  app.listen(config.port, () => console.log(`AAB Field listening on ${config.port}`));
  return app;
}

module.exports = { start, buildApp };
