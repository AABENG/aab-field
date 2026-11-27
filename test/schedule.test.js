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

test('each item: done vs planned, days behind, forecast; later items carry the delay', () => {
  const S = base();
  S.sched = { ss: { start: '2026-02-01', finish: '2026-02-10' }, sd: { start: '2026-02-01', finish: '2026-02-10' }, wl: { start: '2026-02-01', finish: '2026-02-10' },
    sg: { start: '2026-02-11', finish: '2026-02-20' }, cb: { start: '2026-02-11', finish: '2026-02-20' }, pv: { start: '2026-02-11', finish: '2026-02-20' } };
  // sanitary 50 LF/day (half its planned pace), storm 50/day (on pace), water not started
  for (let i = 0; i < 10; i++) S.c.days.push({ date: Sch.addDays('2026-02-01', i), q: { ss: 50, sd: 50 } });
  const st = Sch.status(S, '2026-02-10');
  const it = Object.fromEntries(st.items.map((i) => [i.item, i]));
  assert.equal(it.ss.state, 'working'); assert.equal(it.ss.actual, 0.5); assert.equal(it.ss.planned, 1);
  assert.equal(it.ss.varianceDays, -5, 'half done on the last planned day = 5 days behind');
  assert.equal(it.ss.forecast, '2026-02-20', '500 LF left at 50 LF/day');
  assert.equal(it.sd.state, 'done'); assert.equal(it.sd.varianceDays, 0);
  assert.equal(it.wl.state, 'late'); assert.equal(it.wl.varianceDays, -9);
  assert.equal(it.sg.state, 'not started');
  assert.equal(it.wl.forecast, '2026-02-20', 'waterline follows sanitary, so it carries its 10-day slip');
  assert.equal(it.sg.forecast, '2026-03-02', 'subgrade carries the waterline slip');
  assert.equal(it.pv.forecast, '2026-03-10', 'curb 3 days after subgrade, paving 5 after curb');
  assert.equal(st.forecast, '2026-03-10'); assert.equal(st.contractEnd, '2026-07-04');
  const P = require('../src/schedulePages');
  assert.match(P.statusLine(st), /Sanitary sewer 5 days behind/);
  assert.match(P.statusLine(st), /Waterline not started · 9 days late starting/);
});

test('NAS folder paths are made safe for the QNAP share', () => {
  const { cleanPath } = require('../src/archive');
  assert.equal(cleanPath('1714\\1714-12 The Grove\\Construction'), '1714/1714-12 The Grove/Construction');
  assert.equal(cleanPath('../../etc/passwd'), 'etc/passwd');
  assert.equal(cleanPath('a:b*c?/ d. '), 'abc/d');
});
