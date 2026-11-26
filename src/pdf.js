// A small PDF writer: Helvetica text, lines, filled shapes with transparency,
// clipping and JPEG photos. Enough for the weekly report, with nothing to
// install on the server. Coordinates are points from the top-left corner.
const zlib = require('zlib');

// Helvetica advance widths (1/1000 em) for characters 32–126.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
// WinAnsi codes for common characters outside Latin-1's 32–126 range.
const WIN = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80, '™': 0x99 };

function encode(str) {
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (WIN[ch]) out.push(WIN[ch]);
    else if (c >= 32 && c <= 126) out.push(c);
    else if (c >= 160 && c <= 255) out.push(c); // Latin-1 matches WinAnsi here (°, ·, ½ …)
    else if (c === 10 || c === 13 || c === 9) out.push(32);
    else out.push(63); // ?
  }
  return Buffer.from(out);
}
function charWidth(code) {
  if (code >= 32 && code <= 126) return HELV[code - 32];
  if (code === 0x96) return 556; if (code === 0x97) return 1000; if (code === 0x95) return 350;
  return 556;
}
const hex = (buf) => '<' + buf.toString('hex') + '>';
function rgb(c) {
  const h = c.replace('#', '');
  const n = h.length === 3 ? h.split('').map((x) => parseInt(x + x, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return n.map((v) => (v / 255).toFixed(3)).join(' ');
}
const f = (n) => (Math.round(n * 100) / 100).toString();

function jpegInfo(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comps: buf[i + 9] };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

class PDF {
  constructor() { this.pages = []; this.images = []; this.alphas = new Map(); }

  addPage(w = 612, h = 792) { this.page = { w, h, ops: [], imgs: new Set(), gs: new Set() }; this.pages.push(this.page); return this.page; }
  get W() { return this.page.w; }
  get H() { return this.page.h; }
  op(s) { this.page.ops.push(s); }
  Y(y) { return this.page.h - y; }

  width(str, size, bold) { let w = 0; for (const c of encode(str)) w += charWidth(c); return w * size / 1000 * (bold ? 1.06 : 1); }

  text(x, y, str, o = {}) {
    const size = o.size || 10, font = o.bold ? 'F2' : 'F1';
    let tx = x;
    if (o.align === 'right') tx = x - this.width(str, size, o.bold);
    else if (o.align === 'center') tx = x - this.width(str, size, o.bold) / 2;
    this.op(`BT /${font} ${f(size)} Tf ${rgb(o.color || '#111827')} rg ${f(tx)} ${f(this.Y(y + size * 0.8))} Td ${hex(encode(str))} Tj ET`);
  }
  // Wrap to a width; returns lines.
  wrap(str, width, size, bold) {
    const out = [];
    for (const para of String(str || '').split(/\r?\n/)) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const t = line ? line + ' ' + word : word;
        if (this.width(t, size, bold) <= width || !line) line = t; else { out.push(line); line = word; }
        while (this.width(line, size, bold) > width && line.length > 1) { // a single very long word
          let k = line.length; while (k > 1 && this.width(line.slice(0, k), size, bold) > width) k--;
          out.push(line.slice(0, k)); line = line.slice(k);
        }
      }
      out.push(line);
    }
    return out;
  }
  // Draws wrapped text; returns height used.
  para(x, y, str, width, o = {}) {
    const size = o.size || 10, lead = o.lead || size * 1.3;
    const lines = this.wrap(str, width, size, o.bold).slice(0, o.maxLines || 1e9);
    lines.forEach((l, i) => this.text(x, y + i * lead, l, o));
    return lines.length * lead;
  }

  alpha(a) {
    if (a == null || a >= 1) return '';
    const k = Math.round(a * 100);
    const name = 'GA' + k; this.alphas.set(name, k / 100); this.page.gs.add(name);
    return `/${name} gs `;
  }
  rect(x, y, w, h, o = {}) {
    const p = `${f(x)} ${f(this.Y(y + h))} ${f(w)} ${f(h)} re`;
    this.op(`q ${this.alpha(o.opacity)}${o.fill ? rgb(o.fill) + ' rg ' : ''}${o.stroke ? rgb(o.stroke) + ' RG ' + f(o.width || 0.5) + ' w ' : ''}${p} ${o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S'} Q`);
  }
  line(x1, y1, x2, y2, o = {}) { this.path([[x1, y1], [x2, y2]], o); }
  // pts in page coordinates (top-left origin)
  pathData(pts, close) { return pts.map((p, i) => `${f(p[0])} ${f(this.Y(p[1]))} ${i ? 'l' : 'm'}`).join(' ') + (close ? ' h' : ''); }
  path(pts, o = {}) {
    if (!pts || pts.length < 2) return;
    const dash = o.dash ? `[${o.dash.join(' ')}] 0 d ` : '';
    const paint = o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S';
    this.op(`q ${this.alpha(o.opacity)}${o.fill ? rgb(o.fill) + ' rg ' : ''}${o.stroke || !o.fill ? rgb(o.stroke || '#000') + ' RG ' : ''}${f(o.width || 1)} w 1 J 1 j ${dash}${this.pathData(pts, o.close || !!o.fill)} ${paint} Q`);
  }
  circle(cx, cy, r, o = {}) {
    const k = 0.5523 * r, y = this.Y(cy);
    const d = `${f(cx + r)} ${f(y)} m ${f(cx + r)} ${f(y + k)} ${f(cx + k)} ${f(y + r)} ${f(cx)} ${f(y + r)} c ${f(cx - k)} ${f(y + r)} ${f(cx - r)} ${f(y + k)} ${f(cx - r)} ${f(y)} c `
      + `${f(cx - r)} ${f(y - k)} ${f(cx - k)} ${f(y - r)} ${f(cx)} ${f(y - r)} c ${f(cx + k)} ${f(y - r)} ${f(cx + r)} ${f(y - k)} ${f(cx + r)} ${f(y)} c h`;
    this.op(`q ${o.fill ? rgb(o.fill) + ' rg ' : ''}${rgb(o.stroke || '#000')} RG ${f(o.width || 0.6)} w ${d} ${o.fill ? 'B' : 'S'} Q`);
  }
  // Everything drawn inside fn is clipped to the polygons (page coordinates).
  clip(polys, fn) {
    this.op('q ' + polys.map((p) => this.pathData(p, true)).join(' ') + ' W n');
    fn(); this.op('Q');
  }
  // Clip to a rectangle.
  clipRect(x, y, w, h, fn) { this.op(`q ${f(x)} ${f(this.Y(y + h))} ${f(w)} ${f(h)} re W n`); fn(); this.op('Q'); }

  image(buf, x, y, w, h, fit = 'cover') {
    const info = jpegInfo(buf);
    if (!info) return false;
    let img = this.images.find((i) => i.buf === buf);
    if (!img) { img = { buf, ...info, name: 'Im' + (this.images.length + 1) }; this.images.push(img); }
    this.page.imgs.add(img.name);
    const s = fit === 'cover' ? Math.max(w / info.w, h / info.h) : Math.min(w / info.w, h / info.h);
    const dw = info.w * s, dh = info.h * s, dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
    this.clipRect(x, y, w, h, () => this.op(`q ${f(dw)} 0 0 ${f(dh)} ${f(dx)} ${f(this.Y(dy + dh))} cm /${img.name} Do Q`));
    return true;
  }

  build(meta = {}) {
    const objs = []; // [num] = Buffer
    const add = (b) => { objs.push(b); return objs.length; };
    const str = (s) => Buffer.from(s, 'latin1');
    const catalog = add(null), pagesObj = add(null);
    const f1 = add(str('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    const f2 = add(str('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
    const gsNums = {};
    for (const [name, a] of this.alphas) gsNums[name] = add(str(`<< /Type /ExtGState /ca ${a} /CA ${a} >>`));
    const imgNums = {};
    for (const im of this.images) {
      const cs = im.comps === 1 ? '/DeviceGray' : im.comps === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
      imgNums[im.name] = add(Buffer.concat([str(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.buf.length} >>\nstream\n`), im.buf, str('\nendstream')]));
    }
    const kids = [];
    for (const pg of this.pages) {
      const content = zlib.deflateSync(Buffer.from(pg.ops.join('\n'), 'latin1'));
      const c = add(Buffer.concat([str(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`), content, str('\nendstream')]));
      const xo = [...pg.imgs].map((n) => `/${n} ${imgNums[n]} 0 R`).join(' ');
      const gs = [...pg.gs].map((n) => `/${n} ${gsNums[n]} 0 R`).join(' ');
      kids.push(add(str(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pg.w} ${pg.h}] /Contents ${c} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''}${gs ? ` /ExtGState << ${gs} >>` : ''} >> >>`)));
    }
    objs[catalog - 1] = str(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
    objs[pagesObj - 1] = str(`<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
    const info = add(str(`<< /Title ${hex(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(String(meta.title || 'Report'), 'utf16le').swap16()]))} /Producer (AAB Field) >>`));
    const parts = [str('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
    let off = parts[0].length; const xref = [];
    objs.forEach((b, i) => { xref.push(off); const chunk = Buffer.concat([str(`${i + 1} 0 obj\n`), b, str('\nendobj\n')]); parts.push(chunk); off += chunk.length; });
    const xr = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + xref.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    parts.push(str(xr + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${off}\n%%EOF\n`));
    return Buffer.concat(parts);
  }
}

module.exports = { PDF, jpegInfo };
