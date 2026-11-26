const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 5,
  dateStrings: true,
  multipleStatements: false,
});
// Store and read every timestamp as UTC, whatever the server's own time zone is.
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));
const utc = (s) => (s ? new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z')) : null);

// Runs every .sql file in /migrations once, in name order, and records it in
// schema_migrations. Safe to run on every start.
async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(190) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [rows] = await pool.query('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Statements are separated by a line holding only ";" -- keeps it simple
    // without allowing multi-statement queries on the pool.
    const statements = sql.split(/^\s*;\s*$/m).map((s) => s.trim()).filter(Boolean);
    const conn = await pool.getConnection();
    try {
      for (const stmt of statements) await conn.query(stmt);
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      console.log('Applied migration', file);
    } finally {
      conn.release();
    }
  }
}

module.exports = { utc, pool, migrate };
