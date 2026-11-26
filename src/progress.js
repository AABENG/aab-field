// Highlighted progress: station ranges [from, to] (feet) on a design line,
// recorded per daily log. Totals always come from unions, so the same
// stretch logged twice is never counted twice.

const TRACKS = ['line', 'sg', 'cb', 'pv'];

function union(iv) {
  const a = iv.filter((v) => v[1] - v[0] > 0.01).map((v) => [Math.min(v[0], v[1]), Math.max(v[0], v[1])]).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const v of a) {
    const l = out[out.length - 1];
    if (l && v[0] <= l[1] + 0.01) l[1] = Math.max(l[1], v[1]); else out.push([...v]);
  }
  return out;
}
function subtract(iv, cut) {
  const out = [];
  for (const [a, b] of iv) {
    if (cut[1] <= a || cut[0] >= b) out.push([a, b]);
    else { if (cut[0] > a) out.push([a, cut[0]]); if (cut[1] < b) out.push([cut[1], b]); }
  }
  return out.filter((v) => v[1] - v[0] > 0.01);
}
const minus = (iv, others) => others.reduce((r, c) => subtract(r, c), iv);
const len = (iv) => iv.reduce((s, v) => s + v[1] - v[0], 0);

// Which item has to be done before which, along the street centerline.
function prereqs(hasCurb) { return hasCurb ? { cb: 'sg', pv: 'cb' } : { pv: 'sg' }; }

// rows: [{date:'YYYY-MM-DD', line_id, track, from, to}]
// Returns problems where curb/paving sits on stretches whose prerequisite
// wasn't done by that day (more than tolFt of it).
function orderProblems(rows, hasCurb, tolFt = 1) {
  const pre = prereqs(hasCurb);
  const problems = [];
  for (const r of rows) {
    const need = pre[r.track];
    if (!need) continue;
    const done = union(rows.filter((q) => q.line_id === r.line_id && q.track === need && q.date <= r.date).map((q) => [q.from, q.to]));
    const missing = len(minus([[Math.min(r.from, r.to), Math.max(r.from, r.to)]], done));
    if (missing > tolFt) problems.push({ date: r.date, line_id: r.line_id, track: r.track, needs: need, ft: Math.round(missing) });
  }
  return problems;
}

module.exports = { TRACKS, union, subtract, minus, len, prereqs, orderProblems };
