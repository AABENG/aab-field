const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const ROLES = ['owner', 'reviewer', 'admin', 'co', 'contractor'];
const ROLE_LABELS = {
  owner: 'Owner', reviewer: 'Reviewer (approves reports)', admin: 'Admin',
  co: 'Construction observation', contractor: 'Contractor',
};

async function userCount() {
  const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM users');
  return row.n;
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 10;
}

async function createUser({ email, name, role, password }) {
  email = String(email || '').trim().toLowerCase();
  name = String(name || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (!name) throw new Error('Enter a name.');
  if (!ROLES.includes(role)) throw new Error('Pick a role.');
  if (!validPassword(password)) throw new Error('Password must be at least 10 characters.');
  const hash = await bcrypt.hash(password, 12);
  try {
    const [r] = await pool.query(
      'INSERT INTO users (email, name, role, password_hash) VALUES (?,?,?,?)',
      [email, name, role, hash]);
    return r.insertId;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new Error('A user with that email already exists.');
    throw e;
  }
}

async function verify(email, password) {
  const [[u]] = await pool.query(
    'SELECT * FROM users WHERE email = ? AND active = 1', [String(email || '').trim().toLowerCase()]);
  // Compare even when no user, so timing doesn't reveal which emails exist.
  const ok = await bcrypt.compare(String(password || ''), u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) return null;
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [u.id]);
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  if (req.accepts(['html', 'json']) === 'json') return res.status(401).json({ error: 'Sign in required' });
  res.redirect('/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    const u = req.session.user;
    if (u && roles.includes(u.role)) return next();
    res.status(403).json({ error: 'Not allowed for your role' });
  };
}

module.exports = { ROLES, ROLE_LABELS, userCount, createUser, verify, requireLogin, requireRole, validPassword };
