// Aerial base for the as-built exhibit: one Google Static Maps satellite image
// covering the design, and a function that places drawing coordinates on it.
// Needs a server-side key (STATIC_MAPS_KEY, or GOOGLE_MAPS_KEY if that key isn't
// limited to browser referrers) with the Maps Static API enabled.
// Returns null, and the exhibit falls back to a plain base, if anything is missing.
const ll = require('../public/js/geo.js');
const config = require('./config');

const TILE = 256;
const world = (lat, lng, z) => {
  const s = Math.sin(lat * Math.PI / 180), n = TILE * 2 ** z;
  return [(lng + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

// bbox: [x0, y0, x1, y1] in drawing feet; aspect: width/height of the box it fills.
function plan(crs, bbox, aspect) {
  if (!crs) return null;
  const [x0, y0, x1, y1] = bbox;
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ll.toLatLng(crs, x, y));
  if (!corners.every(ll.looksOklahoma)) return null;
  const c = ll.toLatLng(crs, (x0 + x1) / 2, (y0 + y1) / 2);
  // Image size in map pixels (Google allows up to 640 a side; scale=2 doubles the detail).
  const W = aspect >= 1 ? 640 : Math.round(640 * aspect), H = aspect >= 1 ? Math.round(640 / aspect) : 640;
  let z = 20;
  for (; z > 10; z--) {
    const px = corners.map((p) => world(p.lat, p.lng, z));
    const w = Math.max(...px.map((p) => p[0])) - Math.min(...px.map((p) => p[0]));
    const h = Math.max(...px.map((p) => p[1])) - Math.min(...px.map((p) => p[1]));
    if (w <= W * 0.94 && h <= H * 0.94) break;
  }
  const [cx, cy] = world(c.lat, c.lng, z);
  // drawing (x, y) -> fraction across/down the image
  const toFrac = (x, y) => { const p = ll.toLatLng(crs, x, y), [wx, wy] = world(p.lat, p.lng, z); return [0.5 + (wx - cx) / W, 0.5 + (wy - cy) / H]; };
  return { center: c, zoom: z, W, H, toFrac };
}

async function fetchAerial(crs, bbox, aspect) {
  const key = config.staticMapsKey;
  const pl = plan(crs, bbox, aspect);
  if (!key || !pl) return null;
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${pl.center.lat.toFixed(6)},${pl.center.lng.toFixed(6)}&zoom=${pl.zoom}&size=${pl.W}x${pl.H}&scale=2&maptype=satellite&format=jpg&key=${encodeURIComponent(key)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok || !/image\/jpe?g/.test(r.headers.get('content-type') || '')) return null;
    return { ...pl, jpeg: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { return null; }
}

module.exports = { fetchAerial, plan, world };
