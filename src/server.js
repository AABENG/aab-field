const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const config = require('./config');
const { pool, migrate } = require('./db');
const auth = require('./auth');
const views = require('./views');
const projects = require('./projects');
const logs = require('./logs');

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
  const smallJson = express.json({ limit: '2mb' });
  app.use((req, res, next) => (req.path.endsWith('/design') || req.path.endsWith('/photos') || req.path.endsWith('/clearing-limits') ? next() : smallJson(req, res, next)));
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
  app.use(auth.fieldOnly);

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
    const co = req.session.user.role === 'co';
    if (co) {
      const [list] = await pool.query("SELECT id, job_no, wo_no, name, client, status FROM projects WHERE status IN ('active','closing') ORDER BY job_no");
      return res.send(views.coHomePage({ user: req.session.user, projects: list }));
    }
    // Office: Active tab, or the Closed tab filtered by owner, contractor and year.
    const q = req.query || {}, closedTab = q.tab === 'closed';
    const where = [closedTab ? "p.status = 'closed'" : "p.status <> 'closed'"], args = [];
    if (closedTab && /^\d+$/.test(q.owner || '')) { where.push('p.owner_id = ?'); args.push(+q.owner); }
    if (closedTab && /^\d+$/.test(q.contractor || '')) { where.push('? IN (p.grading_contractor_id, p.utility_contractor_id, p.paving_contractor_id)'); args.push(+q.contractor); }
    if (closedTab && /^\d{4}$/.test(q.year || '')) { where.push('YEAR(p.substantial_completion) = ?'); args.push(+q.year); }
    const [list] = await pool.query(`SELECT p.id, p.job_no, p.wo_no, p.name, p.client, p.status, o.name owner,
        DATE_FORMAT(p.substantial_completion, '%Y-%m-%d') completion, p.archived_at IS NOT NULL archived,
        CONCAT_WS(', ', NULLIF(cg.name, ''), IF(cu.id <=> cg.id, NULL, cu.name), IF(cp.id <=> cu.id OR cp.id <=> cg.id, NULL, cp.name)) contractors
      FROM projects p LEFT JOIN owners o ON o.id = p.owner_id LEFT JOIN contractors cg ON cg.id = p.grading_contractor_id
      LEFT JOIN contractors cu ON cu.id = p.utility_contractor_id LEFT JOIN contractors cp ON cp.id = p.paving_contractor_id
      WHERE ${where.join(' AND ')} ORDER BY ${closedTab ? 'p.substantial_completion DESC,' : 'p.status,'} p.job_no`, args);
    const [owners] = await pool.query('SELECT id, name FROM owners ORDER BY name');
    const [contractors] = await pool.query('SELECT id, name FROM contractors ORDER BY name');
    const [years] = await pool.query("SELECT DISTINCT YEAR(substantial_completion) y FROM projects WHERE status = 'closed' AND substantial_completion IS NOT NULL ORDER BY y DESC");
    res.send(views.homePage({ user: req.session.user, projects: list, tab: closedTab ? 'closed' : 'active', filters: { owner: q.owner, contractor: q.contractor, year: q.year }, owners, contractors, years: years.map((r) => r.y) }));
  });
  app.get('/api/me', auth.requireLogin, (req, res) => res.json(req.session.user));
  const closeout = require('./closeout');
  app.use(closeout.blockClosed); // closed projects are read-only
  app.use(closeout.router);
  app.use(projects);
  app.use(logs.router);
  app.use(require('./reports').router);
  app.use(require('./archive').router);
  app.use(require('./schedulePages').router);
  // service worker must be served from the site root to control field pages
  app.get('/sw.js', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, '..', 'public', 'sw.js')); });

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
