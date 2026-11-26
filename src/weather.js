// Weather for a site and day from the National Weather Service (free, no key).
// NWS keeps about a week of station observations, which covers a report week.
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
const mmToIn = (mm) => Math.round((mm / 25.4) * 100) / 100;

// at: Date of check-in (local time on site). Returns
// {text:'58° Partly cloudy · Wind 8 mph', rain_in: 0.18, station, observedAt}
async function weatherAt(lat, lng, at) {
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
  // 24-hour rain: sum of hourly amounts in the 24 h before check-in
  const hourly = list.filter((p) => new Date(p.timestamp) <= at && p.precipitationLastHour && p.precipitationLastHour.value != null);
  const rainMm = hourly.reduce((s, p) => s + p.precipitationLastHour.value, 0);
  const t = cToF(near.temperature && near.temperature.value);
  const w = kmhToMph(near.windSpeed && near.windSpeed.value);
  const parts = [];
  if (t != null) parts.push(`${t}°`);
  if (near.textDescription) parts.push(near.textDescription);
  const text = parts.join(' ') + (w != null ? ` · Wind ${w} mph` : '');
  const value = { text: text.trim(), rain_in: mmToIn(rainMm), station, observedAt: near.timestamp };
  cache.set(hourKey, { at: Date.now(), value });
  return value;
}

module.exports = { weatherAt };
