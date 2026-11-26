const { test } = require('node:test');
const assert = require('node:assert');
const { fieldOnly } = require('../src/auth');

function run(role, path) {
  let out = 'next';
  const res = { status(c) { out = c; return this; }, json() { return this; }, redirect(u) { out = 'redirect ' + u; } };
  fieldOnly({ path, session: { user: role && { role } } }, res, () => {});
  return out;
}

test('a CO only reaches the daily log and its data', () => {
  for (const p of ['/', '/projects/4/log', '/api/projects/4/field', '/api/projects/4/design', '/api/projects/4/weather',
    '/api/projects/4/logs/2026-11-25', '/api/projects/4/logs/2026-11-25/photos', '/photos/9', '/api/photos/9', '/static/app.css', '/sw.js'])
    assert.equal(run('co', p), 'next', p);
  for (const p of ['/projects/4', '/projects/4/setup', '/projects/new', '/users', '/users/3']) assert.equal(run('co', p), 'redirect /', p);
  assert.equal(run('co', '/api/projects/4/reports'), 403);
});

test('other roles are not affected', () => {
  assert.equal(run('owner', '/projects/4/setup'), 'next');
  assert.equal(run('reviewer', '/users'), 'next');
  assert.equal(run(null, '/projects/4'), 'next');
});
