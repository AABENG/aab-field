// Google Maps: loaded only when the server has a key (window.AAB_MAPS_KEY).
(function (root) {
  'use strict';
  let loading = null;
  function available() { return !!root.AAB_MAPS_KEY; }
  function load() {
    if (!available()) return Promise.reject(new Error('No Google Maps key'));
    if (root.google && root.google.maps && root.google.maps.Map) return Promise.resolve(root.google.maps);
    if (!loading) {
      loading = new Promise((ok, fail) => {
        root.__aabMapsReady = () => ok(root.google.maps);
        const s = document.createElement('script');
        s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(root.AAB_MAPS_KEY) + '&v=weekly&loading=async&callback=__aabMapsReady';
        s.async = true; s.onerror = () => fail(new Error('Google Maps did not load'));
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  // Location picker: click or drag the pin; writes into the two inputs.
  async function picker(el, latInput, lngInput) {
    const g = await load();
    const start = latInput.value && lngInput.value ? { lat: +latInput.value, lng: +lngInput.value } : null;
    const map = new g.Map(el, { center: start || { lat: 36.12, lng: -95.9 }, zoom: start ? 17 : 10, mapTypeId: 'hybrid',
      streetViewControl: false, fullscreenControl: false, mapTypeControl: false, tilt: 0, gestureHandling: 'greedy' });
    let marker = null;
    function set(pos) {
      const p = { lat: typeof pos.lat === 'function' ? pos.lat() : pos.lat, lng: typeof pos.lng === 'function' ? pos.lng() : pos.lng };
      latInput.value = p.lat.toFixed(6); lngInput.value = p.lng.toFixed(6);
      if (!marker) {
        marker = new g.Marker({ map, position: p, draggable: true });
        marker.addListener('dragend', (e) => set(e.latLng));
      } else marker.setPosition(p);
      latInput.dispatchEvent(new Event('change'));
    }
    if (start) set(start);
    map.addListener('click', (e) => set(e.latLng));
    return { map, set };
  }

  root.AABMaps = { available, load, picker };
})(window);
