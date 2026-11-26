// Whole-site schedule: dollar-weighted percent complete, planned curve from each
// item's planned start/finish, schedule variance in calendar days, a forecast
// completion from recent progress, and proposed schedules built from contractor
// production history. Contracts run in calendar days from notice to proceed.
const { pool } = require('./db');
const Q = require('./quantities');

const ITEMS = [
  ['clear', 'Clearing', 'grading'], ['earth', 'Earthwork', 'grading'],
  ['ss', 'Sanitary sewer', 'utility'], ['sd', 'Storm sewer', 'utility'], ['wl', 'Waterline', 'utility'],
  ['sg', 'Subgrade', 'paving'], ['cb', 'Curb and gutter', 'paving'], ['pv', 'Paving', 'paving'],
];
const NAME = Object.fromEntries(ITEMS.map(([k, n]) => [k, n]));
// Structures follow the schedule of the line they sit on.
const SCHED_OF = { mh: 'ss', st: 'sd', fh: 'wl', vv: 'wl' };
// Default dollars per design unit, from The Grove Phase 1 low bids (Oct 2025) divided
// by its design quantities: Timber Wolf grading, MSB utilities, Ira M. Green paving.
// Clearing and earthwork are per acre inside the limits of clearing (33 AC site).
const GROVE_PRICE = { wl: 88.63, fh: 6400, vv: 2289, ss: 81.12, mh: 6500, sd: 121.5, st: 12045, sg: 52.09, cb: 41.28, pv: 139.84, clear: 2182, earth: 19886 };
const WEIGHT_ITEMS = ['clear', 'earth', 'ss', 'mh', 'sd', 'st', 'wl', 'fh', 'vv', 'sg', 'cb', 'pv'];
// With no history at all: calendar days per unit and lags (rough starting points).
const DEFAULT = {
  rate: { ss: 150, sd: 90, wl: 200, sg: 250, cb: 400, pv: 400 },  // design LF per calendar day
  days: { clear: 14, earth: 45 },                                     // durations
  lag: { earth: ['clear', 5], ss: ['earth', 21], sd: ['earth', 21], wl: ['ss', 14], sg: ['wl', 14], cb: ['sg', 7], pv: ['cb', 10] },
};
const PRED = (hasCurb) => ({ earth: ['clear'], ss: ['earth'], sd: ['earth'], wl: ['ss'], sg: ['wl'], cb: ['sg'], pv: [hasCurb ? 'cb' : 'sg'] });
const FIN_AFTER = (hasCurb) => ({ sg: [['ss', 7], ['sd', 7], ['wl', 7]], cb: [['sg', 3]], pv: [[hasCurb ? 'cb' : 'sg', 5]] });

const DAY = 864e5;
const d2n = (d) => Math.floor(Date.parse(String(d).slice(0, 10) + 'T12:00:00Z') / DAY);
const n2d = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const addDays = (d, k) => n2d(d2n(d) + k);
const ymd = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function defaultWeights(c) {
  const w = {};
  for (const k of WEIGHT_ITEMS) {
    const qty = k === 'earth' ? c.design.clear : c.design[k];
    if (qty) w[k] = Math.round(qty * GROVE_PRICE[k]);
  }
  return w;
}

async function load(projectId) {
  const data = await Q.load(projectId);
  if (!data) return null;
  const c = Q.compute(data);
  const [wrows] = await pool.query('SELECT item, amount FROM project_weights WHERE project_id = ?', [projectId]);
  const [srows] = await pool.query("SELECT item, DATE_FORMAT(start_date, '%Y-%m-%d') start, DATE_FORMAT(finish_date, '%Y-%m-%d') finish, source FROM project_schedule WHERE project_id = ?", [projectId]);
  const [erows] = await pool.query("SELECT id, DATE_FORMAT(as_of, '%Y-%m-%d') as_of, pct, note FROM earthwork_progress WHERE project_id = ? ORDER BY as_of", [projectId]);
  const weights = wrows.length ? Object.fromEntries(wrows.map((r) => [r.item, Number(r.amount)])) : defaultWeights(c);
  return { data, c, p: data.project, weights, weightsCustom: !!wrows.length, sched: Object.fromEntries(srows.map((r) => [r.item, r])),
    earth: erows.map((r) => ({ ...r, pct: Number(r.pct) })) };
}

// Fraction complete of each weighted item through date d.
function actualOn(S, d) {
  const cum = {};
  for (const day of S.c.days) { if (day.date > d) break; for (const [k, v] of Object.entries(day.q)) if (k !== 'earth') cum[k] = (cum[k] || 0) + v; }
  const f = {};
  for (const k of WEIGHT_ITEMS) {
    if (k === 'earth') { const e = S.earth.filter((x) => x.as_of <= d).pop(); f.earth = e ? Math.min(1, e.pct / 100) : 0; continue; }
    const des = S.c.design[k];
    f[k] = des ? Math.min(1, (cum[k] || 0) / des) : 0;
  }
  return f;
}
function plannedOn(S, d) {
  const f = {}, n = d2n(d);
  for (const k of WEIGHT_ITEMS) {
    const s = S.sched[SCHED_OF[k] || k];
    if (!s) { f[k] = null; continue; }
    const a = d2n(s.start), b = d2n(s.finish);
    f[k] = n < a ? 0 : n >= b ? 1 : (n - a + 1) / (b - a + 1);
  }
  return f;
}
function site(S, f) {
  let num = 0, den = 0;
  for (const [k, w] of Object.entries(S.weights)) { if (!w || f[k] == null) continue; num += w * f[k]; den += w; }
  return den ? num / den : null;
}

// Everything the report and project page show, as of date `asOf`.
function status(S, asOf) {
  const ntp = ymd(S.p.ntp_date), days = S.p.contract_days ? Number(S.p.contract_days) : null;
  const contractEnd = ntp && days ? addDays(ntp, days) : null;
  const actual = site(S, actualOn(S, asOf));
  const hasPlan = Object.keys(S.sched).length > 0;
  const planned = hasPlan ? site(S, plannedOn(S, asOf)) : null;
  const plannedEnd = hasPlan ? Object.values(S.sched).map((s) => s.finish).sort().pop() : null;
  // Schedule variance: the date the plan expected today's actual percent.
  let varianceDays = null;
  if (hasPlan && actual != null) {
    const first = Object.values(S.sched).map((s) => s.start).sort()[0];
    let t = null;
    for (let n = d2n(first) - 1; n <= d2n(plannedEnd); n++) { if (site(S, plannedOn(S, n2d(n))) >= actual - 1e-6) { t = n; break; } }
    if (t != null) varianceDays = t - d2n(asOf); // negative = behind
  }
  // Forecast: recent whole-site progress per calendar day (last 28 days).
  let forecast = null, ratePerDay = null;
  const start = S.c.days.length ? S.c.days[0].date : null;
  if (start && actual != null && actual < 0.999) {
    const back = Math.min(28, d2n(asOf) - d2n(start));
    if (back >= 7) {
      const before = site(S, actualOn(S, addDays(asOf, -back)));
      ratePerDay = (actual - before) / back;
      if (ratePerDay > 1e-5) forecast = addDays(asOf, Math.ceil((1 - actual) / ratePerDay));
    }
  }
  const items = ITEMS.filter(([k]) => S.sched[k] || S.c.design[k] || (k === 'earth' && S.c.design.clear)).map(([k, name]) => {
    const fa = actualOn(S, asOf), fp = hasPlan ? plannedOn(S, asOf) : {};
    const logged = S.c.days.filter((d) => d.date <= asOf && (k === 'earth' ? d.q.earth : d.q[k])).map((d) => d.date);
    return { item: k, name, plan: S.sched[k] || null, actual: fa[k], planned: fp[k] ?? null, firstWork: logged[0] || null, lastWork: logged[logged.length - 1] || null };
  });
  return { ntp, days, contractEnd, asOf, elapsed: ntp ? Math.max(0, d2n(asOf) - d2n(ntp)) : null, actual, planned, plannedEnd, varianceDays, forecast, ratePerDay, items, hasPlan };
}

// Daily whole-site series (for the S-curve): [{date, planned, actual}]
function series(S, from, to) {
  const out = [];
  for (let n = d2n(from); n <= d2n(to); n++) {
    const d = n2d(n);
    out.push({ date: d, planned: Object.keys(S.sched).length ? site(S, plannedOn(S, d)) : null, actual: site(S, actualOn(S, d)) });
  }
  return out;
}

// ---------- proposals from contractor history ----------
async function historyRows() {
  const [rows] = await pool.query(
    `SELECT j.id job, j.job_no, j.name, DATE_FORMAT(j.ntp_date, '%Y-%m-%d') ntp, i.item, i.contractor_id, c.name contractor, i.quantity,
            DATE_FORMAT(i.start_date, '%Y-%m-%d') start, DATE_FORMAT(i.finish_date, '%Y-%m-%d') finish
       FROM history_items i JOIN history_jobs j ON j.id = i.job_id LEFT JOIN contractors c ON c.id = i.contractor_id`);
  return rows;
}

// Returns {item: {start, finish, basis}} for a project with an NTP date.
function propose(S, history) {
  const p = S.p, ntp = ymd(p.ntp_date), hasCurb = !!p.has_curb;
  if (!ntp) throw new Error('Set the notice to proceed date first');
  const trade = (k) => ITEMS.find((x) => x[0] === k)[2];
  const contractorFor = (k) => ({ grading: p.grading_contractor_id, utility: p.utility_contractor_id, paving: p.paving_contractor_id }[trade(k)]);
  const dated = history.filter((h) => h.start && h.finish);
  const byJob = new Map(); dated.forEach((h) => { if (!byJob.has(h.job)) byJob.set(h.job, {}); byJob.get(h.job)[h.item] = h; });
  const items = ITEMS.map(([k]) => k).filter((k) => k !== 'cb' || hasCurb).filter((k) =>
    k === 'clear' || k === 'earth' ? S.c.design.clear || S.sched[k] || true : S.c.design[k]);
  const out = {};
  const basis = {};
  const duration = (k) => {
    const mine = dated.filter((h) => h.item === k && contractorFor(k) && h.contractor_id === contractorFor(k));
    const pool_ = mine.length ? mine : dated.filter((h) => h.item === k);
    const who = mine.length ? mine[0].contractor : pool_.length ? 'all contractors' : null;
    const qty = S.c.design[k];
    const rates = pool_.filter((h) => Number(h.quantity) > 0).map((h) => Number(h.quantity) / (d2n(h.finish) - d2n(h.start) + 1));
    if (qty && rates.length) { basis[k] = `${rates.length} job${rates.length > 1 ? 's' : ''}, ${who}`; return Math.max(1, Math.round(qty / median(rates))); }
    const durs = pool_.map((h) => d2n(h.finish) - d2n(h.start) + 1);
    if (durs.length) { basis[k] = `${durs.length} job${durs.length > 1 ? 's' : ''}, ${who}`; return Math.round(median(durs)); }
    basis[k] = 'typical (no history yet)';
    return DEFAULT.days[k] || Math.max(1, Math.round((qty || 0) / DEFAULT.rate[k]));
  };
  const lag = (k, pre) => {
    const v = median([...byJob.values()].filter((j) => j[k] && j[pre]).map((j) => d2n(j[k].start) - d2n(j[pre].start)));
    return v != null ? Math.round(v) : (DEFAULT.lag[k] && DEFAULT.lag[k][0] === pre ? DEFAULT.lag[k][1] : 7);
  };
  const preds = PRED(hasCurb), fin = FIN_AFTER(hasCurb);
  for (const k of items) {
    const ps = (preds[k] || []).filter((x) => out[x]);
    let s = d2n(ntp);
    // history of how long after NTP the first item starts
    if (!ps.length) { const v = median(dated.filter((h) => h.item === k && h.ntp).map((h) => d2n(h.start) - d2n(h.ntp))); s += v != null ? Math.max(0, Math.round(v)) : 0; }
    for (const x of ps) s = Math.max(s, d2n(out[x].start) + lag(k, x));
    let f = s + duration(k) - 1;
    for (const [x, g] of fin[k] || []) if (out[x]) f = Math.max(f, d2n(out[x].finish) + g);
    out[k] = { start: n2d(s), finish: n2d(f), basis: basis[k] };
  }
  return out;
}

// Copy a finished app project into history (first and last day each item was worked).
async function addHistoryFromProject(projectId) {
  const S = await load(projectId);
  const [[existing]] = await pool.query('SELECT id FROM history_jobs WHERE project_id = ?', [projectId]);
  const jobId = existing ? existing.id : (await pool.query('INSERT INTO history_jobs (job_no, name, ntp_date, project_id) VALUES (?,?,?,?)',
    [S.p.job_no, S.p.name, ymd(S.p.ntp_date), projectId]))[0].insertId;
  for (const [k, , tr] of ITEMS) {
    const days = S.c.days.filter((d) => (k === 'earth' ? d.q.earth : d.q[k])).map((d) => d.date);
    if (!days.length) continue;
    const cid = { grading: S.p.grading_contractor_id, utility: S.p.utility_contractor_id, paving: S.p.paving_contractor_id }[tr] || null;
    await pool.query(`INSERT INTO history_items (job_id, item, contractor_id, quantity, start_date, finish_date) VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE contractor_id = VALUES(contractor_id), quantity = VALUES(quantity), start_date = VALUES(start_date), finish_date = VALUES(finish_date)`,
    [jobId, k, cid, k === 'earth' ? null : S.c.design[k] || null, days[0], days[days.length - 1]]);
  }
  return jobId;
}

module.exports = { ITEMS, NAME, WEIGHT_ITEMS, GROVE_PRICE, SCHED_OF, load, status, series, propose, historyRows, addHistoryFromProject, defaultWeights, addDays, d2n, n2d, ymd };
