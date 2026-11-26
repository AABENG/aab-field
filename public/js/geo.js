// Drawing coordinates <-> latitude/longitude. AAB drawings are in Oklahoma
// state plane, NAD83, US survey feet (North zone for Tulsa-area jobs).
(function (root) {
  'use strict';
  const proj4 = root.proj4 || (typeof require === 'function' ? require('proj4') : null);
  const CRS = {
    'EPSG:2267': { name: 'Oklahoma North (NAD83, US ft)', def: '+proj=lcc +lat_0=35 +lon_0=-98 +lat_1=36.7666666666667 +lat_2=35.5666666666667 +x_0=600000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs' },
    'EPSG:2268': { name: 'Oklahoma South (NAD83, US ft)', def: '+proj=lcc +lat_0=33.3333333333333 +lon_0=-98 +lat_1=35.2333333333333 +lat_2=33.9333333333333 +x_0=600000 +y_0=0 +datum=NAD83 +units=us-ft +no_defs' },
  };
  for (const [k, v] of Object.entries(CRS)) proj4.defs(k, v.def);
  const crsOf = (c) => (CRS[c] ? c : 'EPSG:2267');

  // [x, y] in drawing feet -> {lat, lng}
  function toLatLng(crs, x, y) { const [lng, lat] = proj4(crsOf(crs), 'EPSG:4326', [x, y]); return { lat, lng }; }
  // lat/lng -> [x, y] drawing feet
  function fromLatLng(crs, lat, lng) { return proj4('EPSG:4326', crsOf(crs), [lng, lat]); }
  // A drawing in the wrong zone (or not in state plane at all) lands far from Oklahoma.
  function looksOklahoma(ll) { return ll && ll.lat > 33.5 && ll.lat < 37.1 && ll.lng > -103.1 && ll.lng < -94.4; }

  const api = { CRS, toLatLng, fromLatLng, looksOklahoma };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AABGeo = api;
})(typeof window !== 'undefined' ? window : globalThis);
