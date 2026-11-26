const { test } = require('node:test');
const assert = require('node:assert');
const { siteTime } = require('../src/logs');

test('check-in times are read as Oklahoma time', () => {
  assert.equal(siteTime('2026-11-17', '8:30 AM').toISOString(), '2026-11-17T14:30:00.000Z'); // CST
  assert.equal(siteTime('2026-07-01', '1:15 pm').toISOString(), '2026-07-01T18:15:00.000Z'); // CDT
  assert.equal(siteTime('2026-11-17', '').toISOString(), '2026-11-17T15:00:00.000Z'); // default 9 AM
});
