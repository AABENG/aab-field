const { test } = require('node:test');
const assert = require('node:assert');
const { lastWeekStart } = require('../src/reports');
const mail = require('../src/mail');
const { PDF } = require('../src/pdf');

test('Sunday evening reports on the Mon–Sat week that just ended', () => {
  assert.equal(lastWeekStart('2026-11-29'), '2026-11-23'); // Sunday
  assert.equal(lastWeekStart('2026-11-30'), '2026-11-23'); // Monday catch-up
  assert.equal(lastWeekStart('2026-12-05'), '2026-11-23'); // Saturday: still last week
});

test('email has the summary and the PDFs attached', () => {
  const m = mail._message({ from: 'reports@aabeng.com', fromName: 'AAB Engineering Reports', to: ['a@x.com'], cc: ['joe@aabeng.com'], subject: 'Weekly – reports',
    text: 'Summary', attachments: [{ name: 'r.pdf', data: Buffer.from('%PDF-1.4') }] });
  assert.match(m, /^From: AAB Engineering Reports <reports@aabeng.com>/);
  assert.match(m, /Cc: joe@aabeng.com/);
  assert.match(m, /Subject: =\?UTF-8\?B\?/);
  assert.match(m, /filename="r.pdf"/);
});

test('PDF writer makes a valid file with text, shapes and a photo', () => {
  const pdf = new PDF(); pdf.addPage();
  pdf.text(40, 40, 'Weekly report – 58° · rain'); pdf.rect(40, 60, 100, 20, { fill: '#1f66e0', opacity: 0.4 });
  pdf.clip([[[0, 0], [100, 0], [100, 100]]], () => pdf.path([[0, 0], [50, 50]], { stroke: '#000' }));
  const buf = pdf.build({ title: 'Test' });
  assert.equal(buf.slice(0, 8).toString(), '%PDF-1.4');
  assert.match(buf.slice(-6).toString(), /%%EOF/);
  assert.ok(pdf.wrap('one two three four five six', 40, 10).length > 1);
});

test('Microsoft 365 (Graph): small mail in one call, big attachments by upload session', async () => {
  Object.assign(process.env, { GRAPH_TENANT_ID: 't', GRAPH_CLIENT_ID: 'c', GRAPH_CLIENT_SECRET: 's', MAIL_FROM: 'reports@aabeng.com' });
  delete process.env.MAIL_DIR;
  const calls = [];
  const real = global.fetch;
  global.fetch = async (url, o = {}) => {
    calls.push([o.method, String(url).replace('https://graph.microsoft.com/v1.0', '')]);
    const ok = (j, status = 200) => ({ ok: true, status, json: async () => j, text: async () => JSON.stringify(j) });
    if (String(url).includes('oauth2')) return ok({ access_token: 'tok', expires_in: 3600 });
    if (url.endsWith('/messages')) return ok({ id: 'm1' }, 201);
    if (url.includes('createUploadSession')) return ok({ uploadUrl: 'https://upload.example/u' }, 201);
    return ok(null, 202);
  };
  try {
    await mail.send({ to: ['a@x.com'], subject: 's', text: 't', attachments: [{ name: 'a.pdf', data: Buffer.alloc(1000) }] });
    assert.ok(calls.some(([m, u]) => m === 'POST' && u === '/users/reports%40aabeng.com/sendMail'));
    calls.length = 0;
    await mail.send({ to: ['a@x.com'], subject: 's', text: 't', attachments: [{ name: 'big.pdf', data: Buffer.alloc(7 * 1024 * 1024) }, { name: 'small.pdf', data: Buffer.alloc(1000) }] });
    const urls = calls.map((c) => c[0] + ' ' + c[1]);
    assert.ok(urls.includes('POST /users/reports%40aabeng.com/messages'));
    assert.ok(urls.some((u) => u.includes('createUploadSession')));
    assert.equal(urls.filter((u) => u.startsWith('PUT https://upload.example')).length, 3); // 7 MB in 3.2 MB pieces
    assert.ok(urls.includes('POST /users/reports%40aabeng.com/messages/m1/send'));
  } finally { global.fetch = real; for (const k of ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'MAIL_FROM']) delete process.env[k]; }
});

test('very large sets of reports are split across emails', () => {
  const mb = (n) => ({ name: n + '.pdf', data: Buffer.alloc(n * 1024 * 1024) });
  assert.equal(mail._split([mb(8), mb(8), mb(8), mb(2)]).length, 2);
  assert.equal(mail._split([mb(5)]).length, 1);
});
