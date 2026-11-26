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
