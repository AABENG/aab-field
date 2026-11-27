// As-built flight ortho: read a world file and work out the part of the image
// that covers the site. Shared by the browser (upload) and the server tests.
// World file (.jgw/.jpw/.tfw/.wld), six lines: A (ft per pixel across), D, B
// (rotation; must be 0), E (ft per pixel down, negative), C, F (center of the
// upper-left pixel), all in the drawing's coordinates (state plane US ft).
(function (root) {
  function parseWorld(text) {
    const v = String(text || '').trim().split(/\s+/).map(Number);
    if (v.length < 6 || v.slice(0, 6).some((n) => !Number.isFinite(n))) throw new Error('That world file should have six numbers, one per line.');
    const [A, D, B, E, C, F] = v;
    if (Math.abs(B) > 1e-9 || Math.abs(D) > 1e-9) throw new Error('The ortho is rotated. Export it north-up (no rotation).');
    if (!(A > 0) || !(E < 0)) throw new Error('The world file pixel sizes look wrong (expected positive across, negative down).');
    return { A, E, C, F };
  }
  // Pixel window of an (imgW x imgH) ortho covering bbox [x0,y0,x1,y1] (+ the
  // edges of each pixel), then the scale to keep it under maxPx a side.
  // Returns the window and the placement of the saved image in drawing feet:
  //   { sx, sy, sw, sh, w, h, place: { x0, y0, px, py } } (x0,y0 = top-left corner).
  function crop(world, imgW, imgH, bbox, maxPx = 3000) {
    const { A, E, C, F } = world;
    const left = C - A / 2, top = F - E / 2; // outer edge of the image
    let sx = Math.floor((bbox[0] - left) / A), ex = Math.ceil((bbox[2] - left) / A);
    let sy = Math.floor((bbox[3] - top) / E), ey = Math.ceil((bbox[1] - top) / E);
    sx = Math.max(0, sx); sy = Math.max(0, sy); ex = Math.min(imgW, ex); ey = Math.min(imgH, ey);
    if (ex - sx < 2 || ey - sy < 2) {
      throw new Error('The ortho doesn’t cover this site. Export it in the same coordinate system as the plans (Oklahoma state plane, US feet).');
    }
    const sw = ex - sx, sh = ey - sy, k = Math.min(1, maxPx / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    return { sx, sy, sw, sh, w, h, place: { x0: left + sx * A, y0: top + sy * E, px: A * sw / w, py: E * sh / h } };
  }
  const api = { parseWorld, crop };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AABOrtho = api;
})(typeof self !== 'undefined' ? self : this);
