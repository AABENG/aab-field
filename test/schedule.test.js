const { test } = require('node:test');
const assert = require('node:assert');
const Sch = require('../src/schedule');

const base = () => ({
  p: { ntp_date: '2026-01-05', contract_days: 180, has_curb: 1, utility_contractor_id: 2 },
  c: { design: { ss: 1000, sd: 500, wl: 800, sg: 600, cb: 600, pv: 600, clear: 10 }, days: [] },
  weights: { ss: 100, sd: 100, wl: 100, sg: 50, cb: 50, pv: 100 }, sched: {}, earth: [],
});

test('a proposal follows the order of work and uses contractor history', () => {
  const S = base();
  const hist = [
    { job: 1, item: 'ss', contractor_id: 2, contractor: 'MSB', quantity: 2000, start: '2025-03-01', finish: '2025-03-20', ntp: '2025-02-01' }, // 100 LF/day
    { job: 1, item: 'earth', contractor_id: 1, quantity: null, start: '2025-02-10', finish: '2025-03-10', ntp: '2025-02-01' },
    { job: 1, item: 'clear', contractor_id: 1, quantity: null, start: '2025-02-03', finish: '2025-02-12', ntp: '2025-02-01' },
  ];
  const P = Sch.propose(S, hist);
  assert.equal(Sch.d2n(P.ss.finish) - Sch.d2n(P.ss.start) + 1, 10, 'sanitary 1000 LF at 100 LF/day');
  assert.match(P.ss.basis, /MSB/);
  assert.equal(P.clear.start, '2026-01-07', 'clearing starts as long after NTP as it did before');
  assert.ok(P.earth.start > P.clear.start && P.ss.start > P.earth.start);
  assert.ok(P.sg.start > P.wl.start && P.cb.start > P.sg.start && P.pv.start > P.cb.start);
  assert.ok(P.pv.finish >= P.cb.finish && P.sg.finish >= P.wl.finish);
});

test('planned vs actual, variance in days, and forecast', () => {
  const S = base();
  S.sched = { ss: { start: '2026-02-01', finish: '2026-02-10' }, sd: { start: '2026-02-01', finish: '2026-02-10' }, wl: { start: '2026-02-01', finish: '2026-02-10' },
    sg: { start: '2026-02-11', finish: '2026-02-20' }, cb: { start: '2026-02-11', finish: '2026-02-20' }, pv: { start: '2026-02-11', finish: '2026-02-20' } };
  // 50 LF of each utility per day from Feb 1 to Feb 10
  for (let i = 0; i < 10; i++) S.c.days.push({ date: Sch.addDays('2026-02-01', i), q: { ss: 50, sd: 25, wl: 40 } });
  const st = Sch.status(S, '2026-02-10');
  assert.ok(Math.abs(st.actual - 150 / 500) < 1e-9, 'utilities half done: 300 of 500 weight * 0.5');
  assert.ok(Math.abs(st.planned - 300 / 500) < 1e-9, 'plan expects utilities finished');
  assert.ok(st.varianceDays < 0, 'behind schedule');
  assert.equal(st.contractEnd, '2026-07-04');
  assert.ok(st.forecast > '2026-02-10');
});

test('NAS folder paths are made safe for the QNAP share', () => {
  const { cleanPath } = require('../src/archive');
  assert.equal(cleanPath('1714\\1714-12 The Grove\\Construction'), '1714/1714-12 The Grove/Construction');
  assert.equal(cleanPath('../../etc/passwd'), 'etc/passwd');
  assert.equal(cleanPath('a:b*c?/ d. '), 'abc/d');
});
