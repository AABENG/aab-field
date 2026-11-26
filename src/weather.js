// Weather for a site and day. Conditions (temperature, sky, wind) come from the
// nearest National Weather Service station. Rainfall comes from the Iowa
// Environmental Mesonet's gridded service: NOAA radar estimates corrected by
// rain gauges, read at the site itself rather than at a distant gauge.
const UA = 'AAB Field (cm.aabeng.com, admin@aabeng.com)';
const cache = new Map(); // key -> {at, value}

async function nws(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } });
  if (!r.ok) throw new Error(`NWS ${r.status} for ${url}`);
  return r.json();
}

async function stationFor(lat, lng) {
  const key = `st:${lat.toFixed(3)},${lng.toFixed(3)}`;
  const c = cache.get(key);
  if (c) return c.value;
  const pt = await nws(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`);
  const st = await nws(pt.properties.observationStations);
  const id = st.features && st.features[0] && st.features[0].properties.stationIdentifier;
  if (!id) throw new Error('No NWS station near this site');
  cache.set(key, { at: Date.now(), value: id });
  return id;
}

const cToF = (c) => (c == null ? null : Math.round(c * 9 / 5 + 32));
const kmhToMph = (k) => (k == null ? null : Math.round(k * 0.621371));

// ---- rainfall (Iowa Environmental Mesonet) ----
const IEM = 'https://mesonet.agron.iastate.edu/iemre/hourly';
async function iemHours(lat, lng, day) {
  const key = `iem:${lat.toFixed(3)},${lng.toFixed(3)}:${day}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < 20 * 60 * 1000) return c.value;
  const r = await fetch(`${IEM}/${day}/${lat.toFixed(4)}/${lng.toFixed(4)}/json`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`IEM ${r.status}`);
  const value = ((await r.json()).data || []);
  cache.set(key, { at: Date.now(), value });
  return value;
}
// Inches in the 24 hours before `at`, from hourly records {valid_utc, hourly_precip_in}.
// null when the hours aren't posted yet.
function rain24(records, at) {
  const t1 = at.getTime(), t0 = t1 - 24 * 3600 * 1000;
  const hrs = records.filter((h) => { const t = Date.parse(h.valid_utc); return t > t0 && t <= t1; });
  const known = hrs.filter((h) => h.hourly_precip_in != null && Number.isFinite(Number(h.hourly_precip_in)));
  if (known.length < 20) return null;
  return Math.round(known.reduce((s, h) => s + Number(h.hourly_precip_in), 0) * 100) / 100;
}
async function rainAt(lat, lng, at) {
  const day = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const days = [...new Set([day(at.getTime() - 24 * 3600 * 1000), day(at.getTime())])];
  const recs = (await Promise.all(days.map((d) => iemHours(lat, lng, d)))).flat();
  return rain24(recs, at);
}

// at: Date of check-in (local time on site). Returns
// {text:'58° Partly cloudy · Wind 8 mph', rain_in: 0.18 | null, station, observedAt}
async function weatherAt(lat, lng, at) {
  const [wx, rain] = await Promise.allSettled([conditionsAt(lat, lng, at), rainAt(lat, lng, at)]);
  if (wx.status === 'rejected' && rain.status === 'rejected') throw wx.reason;
  return {
    ...(wx.status === 'fulfilled' ? wx.value : { text: '' }),
    rain_in: rain.status === 'fulfilled' ? rain.value : null,
  };
}

async function conditionsAt(lat, lng, at) {
  const station = await stationFor(lat, lng);
  const hourKey = `wx:${station}:${at.toISOString().slice(0, 13)}`;
  const c = cache.get(hourKey);
  if (c && Date.now() - c.at < 30 * 60 * 1000) return c.value;
  const start = new Date(at.getTime() - 24 * 3600 * 1000).toISOString();
  const end = new Date(at.getTime() + 30 * 60 * 1000).toISOString();
  const obs = await nws(`https://api.weather.gov/stations/${station}/observations?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  const list = (obs.features || []).map((f) => f.properties).filter((p) => p && p.timestamp);
  if (!list.length) throw new Error('No observations for that time');
  // conditions: the observation closest to check-in
  const near = list.reduce((best, p) => (Math.abs(new Date(p.timestamp) - at) < Math.abs(new Date(best.timestamp) - at) ? p : best));
  const t = cToF(near.temperature && near.temperature.value);
  const w = kmhToMph(near.windSpeed && near.windSpeed.value);
  const parts = [];
  if (t != null) parts.push(`${t}°`);
  if (near.textDescription) parts.push(near.textDescription);
  const text = parts.join(' ') + (w != null ? ` · Wind ${w} mph` : '');
  const value = { text: text.trim(), station, observedAt: near.timestamp };
  cache.set(hourKey, { at: Date.now(), value });
  return value;
}

module.exports = { weatherAt, rain24 };
