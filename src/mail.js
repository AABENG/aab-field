// Minimal SMTP sender with attachments (no packages to install).
// Settings (cPanel environment variables):
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
const configured = () => { const c = cfg(); return !!(c.dir || (c.host && c.user && c.pass && c.from)); };

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

// opts: {to:[], cc:[], replyTo, subject, text, html, attachments:[{name, data, type}]}
async function send(opts) {
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
  if (!configured()) throw new Error('Email isn’t set up yet (SMTP settings missing)');
  await smtp(c, to.concat(cc), data);
  return { sent: true };
}

module.exports = { send, configured, _message: message };
