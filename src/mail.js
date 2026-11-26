// Email with attachments, no packages to install. Two ways to send:
//  1. Microsoft 365 through Microsoft Graph (preferred; Microsoft is switching
//     off password SMTP sign-in): GRAPH_TENANT_ID, GRAPH_CLIENT_ID,
//     GRAPH_CLIENT_SECRET, MAIL_FROM (the mailbox, e.g. reports@aabeng.com).
//  2. Plain SMTP:
//   SMTP_HOST, SMTP_PORT (587 = STARTTLS, 465 = TLS), SMTP_USER, SMTP_PASS,
//   MAIL_FROM (defaults to SMTP_USER), MAIL_FROM_NAME (defaults to "AAB Engineering Reports")
// With MAIL_DIR set instead (used in testing), messages are written there as .eml files.
const net = require('net');
const tls = require('tls');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cfg = () => ({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM || process.env.SMTP_USER, fromName: process.env.MAIL_FROM_NAME || 'AAB Engineering Reports', dir: process.env.MAIL_DIR,
});
const graphCfg = () => ({ tenant: process.env.GRAPH_TENANT_ID, id: process.env.GRAPH_CLIENT_ID, secret: process.env.GRAPH_CLIENT_SECRET, from: process.env.MAIL_FROM });
const useGraph = () => { const g = graphCfg(); return !!(g.tenant && g.id && g.secret && g.from); };
const configured = () => { const c = cfg(); return !!(c.dir || useGraph() || (c.host && c.user && c.pass && c.from)); };

const b64 = (s) => Buffer.from(s).toString('base64');
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addr = (list) => list.map((a) => a.trim()).filter(Boolean);

function message({ from, fromName, to, cc, replyTo, subject, text, html, attachments = [] }) {
  const mixed = 'mix_' + crypto.randomBytes(8).toString('hex'), alt = 'alt_' + crypto.randomBytes(8).toString('hex');
  const h = [
    `From: ${encWord(fromName)} <${from}>`, `To: ${to.join(', ')}`, cc && cc.length ? `Cc: ${cc.join(', ')}` : null,
    replyTo ? `Reply-To: ${replyTo}` : null, `Subject: ${encWord(subject)}`, `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${(from.split('@')[1] || 'aabeng.com')}>`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ].filter(Boolean).join('\r\n');
  let body = `--${mixed}\r\nContent-Type: multipart/alternative; boundary="${alt}"\r\n\r\n`
    + `--${alt}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(text))}`
    + (html ? `--${alt}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(html))}` : '')
    + `--${alt}--\r\n`;
  for (const a of attachments) {
    body += `--${mixed}\r\nContent-Type: ${a.type || 'application/pdf'}; name="${a.name}"\r\nContent-Disposition: attachment; filename="${a.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(a.data.toString('base64'))}`;
  }
  body += `--${mixed}--\r\n`;
  return `${h}\r\n\r\n${body}`;
}

function smtp(c, rcpts, data) {
  return new Promise((resolve, reject) => {
    let sock = c.port === 465 ? tls.connect(c.port, c.host, { servername: c.host }) : net.connect(c.port, c.host);
    let buf = '', step = 0, done = false;
    const timer = setTimeout(() => fail(new Error('Mail server timed out')), 60000);
    const fail = (e) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (x) { /* */ } reject(e); };
    const send = (s) => sock.write(s + '\r\n');
    const queue = [];
    const plan = () => {
      queue.push(['EHLO ' + os.hostname(), 250]);
      if (c.port !== 465 && !sock.encrypted) queue.push(['STARTTLS', 220, 'tls']);
    };
    const afterTls = () => {
      queue.push(['EHLO ' + os.hostname(), 250], ['AUTH LOGIN', 334], [b64(c.user), 334], [b64(c.pass), 235], [`MAIL FROM:<${c.from}>`, 250]);
      rcpts.forEach((r) => queue.push([`RCPT TO:<${r}>`, 250]));
      queue.push(['DATA', 354], [data.replace(/\r\n\./g, '\r\n..') + '\r\n.', 250], ['QUIT', 221]);
    };
    plan(); if (c.port === 465) afterTls();
    let expect = 220, action = null;
    const onData = (chunk) => {
      buf += chunk.toString('latin1');
      let m;
      while ((m = buf.match(/^(\d{3})([ -])(.*)\r?\n/m))) {
        const idx = buf.indexOf(m[0]); buf = buf.slice(idx + m[0].length);
        if (m[2] === '-') continue; // multi-line reply
        const code = Number(m[1]);
        if (code !== expect && !(expect === 250 && code === 251)) {
          if (expect === 221) { done = true; clearTimeout(timer); sock.end(); return resolve(); }
          return fail(new Error(`Mail server said ${code} ${m[3]}`));
        }
        if (action === 'tls') {
          sock.removeListener('data', onData);
          sock = tls.connect({ socket: sock, servername: c.host }, () => { afterTls(); next(); });
          sock.on('data', onData); sock.on('error', fail); action = null; return;
        }
        if (expect === 221) { done = true; clearTimeout(timer); sock.end(); return resolve(); }
        next();
      }
    };
    const next = () => { const s = queue.shift(); if (!s) return; step++; expect = s[1]; action = s[2] || null; send(s[0]); };
    sock.on('data', onData); sock.on('error', fail);
  });
}

// ---------- Microsoft Graph ----------
let tokenCache = null;
async function graphToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const g = graphCfg();
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(g.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: g.id, client_secret: g.secret, scope: 'https://graph.microsoft.com/.default' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Microsoft sign-in failed: ${j.error_description || j.error || r.status}`);
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}
async function graph(method, url, body, headers = {}) {
  const r = await fetch(url.startsWith('http') ? url : `https://graph.microsoft.com/v1.0${url}`, {
    method, headers: { authorization: `Bearer ${await graphToken()}`, ...(body && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body == null ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text(); let m = t; try { m = JSON.parse(t).error.message; } catch (e) { /* raw */ } throw new Error(`Microsoft 365 refused (${r.status}): ${m}`); }
  return r.status === 204 || r.status === 202 ? null : r.json().catch(() => null);
}
const SMALL = 3 * 1024 * 1024; // Graph takes attachments under 3 MB inline
async function sendGraph(o) {
  const from = encodeURIComponent(graphCfg().from);
  const rc = (list) => list.map((a) => ({ emailAddress: { address: a } }));
  const message = { subject: o.subject, body: { contentType: o.html ? 'HTML' : 'Text', content: o.html || o.text }, toRecipients: rc(o.to), ccRecipients: rc(o.cc),
    ...(o.replyTo ? { replyTo: rc([o.replyTo]) } : {}) };
  const att = (a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.name, contentType: a.type || 'application/pdf', contentBytes: a.data.toString('base64') });
  const total = o.attachments.reduce((s, a) => s + a.data.length, 0);
  if (total < SMALL) {
    await graph('POST', `/users/${from}/sendMail`, { message: { ...message, attachments: o.attachments.map(att) }, saveToSentItems: true });
    return;
  }
  // Larger: draft, attach (upload sessions for big files), then send.
  const draft = await graph('POST', `/users/${from}/messages`, message);
  for (const a of o.attachments) {
    if (a.data.length < SMALL) { await graph('POST', `/users/${from}/messages/${draft.id}/attachments`, att(a)); continue; }
    const up = await graph('POST', `/users/${from}/messages/${draft.id}/attachments/createUploadSession`,
      { AttachmentItem: { attachmentType: 'file', name: a.name, size: a.data.length, contentType: a.type || 'application/pdf' } });
    const CH = 320 * 1024 * 10; // 3.2 MB, a multiple of 320 KB
    for (let i = 0; i < a.data.length; i += CH) {
      const part = a.data.subarray(i, Math.min(a.data.length, i + CH));
      const r = await fetch(up.uploadUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'content-length': String(part.length), 'content-range': `bytes ${i}-${i + part.length - 1}/${a.data.length}` }, body: part });
      if (!r.ok && r.status !== 201) throw new Error(`Attachment upload failed (${r.status})`);
    }
  }
  await graph('POST', `/users/${from}/messages/${draft.id}/send`);
}

// Microsoft 365 rejects messages over ~35 MB, so big sets of reports go out in parts.
const PART = 20 * 1024 * 1024;
function split(attachments) {
  const parts = [[]]; let size = 0;
  for (const a of attachments) {
    if (size + a.data.length > PART && parts[parts.length - 1].length) { parts.push([]); size = 0; }
    parts[parts.length - 1].push(a); size += a.data.length;
  }
  return parts;
}

// opts: {to:[], cc:[], replyTo, subject, text, html, attachments:[{name, data, type}]}
async function send(opts) {
  const parts = split(opts.attachments || []);
  if (parts.length === 1) return sendOne(opts);
  let r;
  for (let i = 0; i < parts.length; i++) {
    const tag = ` (part ${i + 1} of ${parts.length})`, note = `Reports continued: part ${i + 1} of ${parts.length}.`;
    r = await sendOne({ ...opts, subject: opts.subject + tag, attachments: parts[i],
      text: i ? note : `${opts.text}\n(The reports are attached across ${parts.length} emails because of their size.)\n`,
      html: opts.html && (i ? `<p>${note}</p>` : `${opts.html}<p style="color:#667">The reports are attached across ${parts.length} emails because of their size.</p>`) });
  }
  return r;
}
async function sendOne(opts) {
  const c = cfg();
  const to = addr(opts.to || []), cc = addr(opts.cc || []);
  if (!to.length) throw new Error('No recipients');
  const data = message({ ...opts, to, cc, from: c.from || 'reports@aabeng.com', fromName: c.fromName });
  if (c.dir) {
    fs.mkdirSync(c.dir, { recursive: true });
    const f = path.join(c.dir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.eml`);
    fs.writeFileSync(f, data);
    return { saved: f };
  }
  if (useGraph()) { await sendGraph({ ...opts, to, cc, attachments: opts.attachments || [] }); return { sent: true, via: 'graph' }; }
  if (!configured()) throw new Error('Email isn’t set up yet (email settings missing)');
  await smtp(c, to.concat(cc), data);
  return { sent: true };
}

module.exports = { send, configured, _message: message, _split: split };
