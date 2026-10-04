// Images on notes: only real PNG, JPEG, GIF and WebP images, checked by their
// bytes; kept in the state directory by content hash; uploaded from the review
// page only, with its token and Origin; delivered to wait as local paths, and
// only on a note the reviewer sends. The event log counts them and no more.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { imageLimits, parseDraft, sniffImage } from '../dist/internal.js';
import { ELEMENT_NOTE, FIXTURE, api, makePng, makeWorld, sendNotes, uploadImage } from './helpers/harness.mjs';

let world;

before(() => {
  world = makeWorld();
  // Small limits, so the tests can pass them without large files.
  world.env.VIVAMARK_MAX_IMAGE_BYTES = String(64 * 1024);
  world.env.VIVAMARK_MAX_NOTE_IMAGE_BYTES = String(100 * 1024);
});

after(async () => {
  await world.cleanup();
});

async function openPage(name) {
  const file = path.join(world.pageDir, name);
  fs.writeFileSync(file, fs.readFileSync(FIXTURE, 'utf8'));
  const r = await world.cli(['open', file, '--no-browser', '--json']);
  if (r.code !== 0) throw new Error(`open failed (${r.code}): ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return { file, port: world.server().port, id: out.session.id, token: world.session(out.session.id).token };
}

// Headers only: enough for the sniffer, which reads the type and size from them.
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
function jpegHeader(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x01, 0x02]), Buffer.alloc(0x100)]);
  const sof = Buffer.from([0xff, 0xc2, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, exif, sof, Buffer.from([0xff, 0xd9])]);
}
function webpLossless(width, height) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(22, 4);
  b.write('WEBPVP8L', 8, 'latin1');
  b.writeUInt32LE(10, 16);
  b[20] = 0x2f;
  b.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return b;
}
function webpExtended(width, height) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBPVP8X', 8, 'latin1');
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

test('only PNG, JPEG, GIF and WebP pass, by their bytes and with a readable size', () => {
  assert.deepEqual(sniffImage(makePng(3, 2)), { mime: 'image/png', width: 3, height: 2 });
  assert.deepEqual(sniffImage(GIF), { mime: 'image/gif', width: 1, height: 1 });
  assert.deepEqual(sniffImage(jpegHeader(640, 480)), { mime: 'image/jpeg', width: 640, height: 480 }, 'past APP0 and EXIF to the frame');
  assert.deepEqual(sniffImage(webpLossless(300, 200)), { mime: 'image/webp', width: 300, height: 200 });
  assert.deepEqual(sniffImage(webpExtended(4000, 3000)), { mime: 'image/webp', width: 4000, height: 3000 });
  for (const [what, bytes] of [
    ['text', Buffer.from('just text, named shot.png')],
    ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['html', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['a PNG signature alone', makePng(3, 2).subarray(0, 12)],
    ['a PNG of zero width', (() => {
      const p = makePng(3, 2);
      p.writeUInt32BE(0, 16);
      return p;
    })()],
    ['a JPEG with no frame', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ['a RIFF that is not WebP', Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(20)])],
    ['empty', Buffer.alloc(0)],
  ]) {
    assert.equal(sniffImage(bytes), null, what);
  }
});

test('note.attachments takes a short list of ids and nothing else', () => {
  const id = 'a'.repeat(64);
  assert.deepEqual(parseDraft({ kind: 'page', comment: 'x', attachments: [id, id] }).attachments, [id], 'duplicates dropped');
  assert.equal(parseDraft({ kind: 'page', comment: 'x', attachments: [] }).attachments, undefined);
  assert.match(parseDraft({ kind: 'page', comment: 'x', attachments: ['../../etc/passwd'] }), /attachment ids/);
  assert.match(parseDraft({ kind: 'page', comment: 'x', attachments: [{ id, path: '/etc/passwd' }] }), /attachment ids/);
  assert.match(parseDraft({ kind: 'page', comment: 'x', attachments: 'nope' }), /attachment ids/);
  const many = Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(64, '0'));
  assert.match(parseDraft({ kind: 'page', comment: 'x', attachments: many }), /at most 20/);
});

test('the image limits come from the environment, then the config file, then the defaults', () => {
  const cfgHome = path.join(world.base, 'limits-config');
  fs.mkdirSync(path.join(cfgHome, 'vivamark'), { recursive: true });
  assert.deepEqual(imageLimits({ XDG_CONFIG_HOME: cfgHome }), { imageBytes: 10 * 1024 * 1024, noteBytes: 25 * 1024 * 1024 });
  fs.writeFileSync(path.join(cfgHome, 'vivamark', 'config.json'), JSON.stringify({ max_image_bytes: 2000, max_note_image_bytes: 5000 }));
  assert.deepEqual(imageLimits({ XDG_CONFIG_HOME: cfgHome }), { imageBytes: 2000, noteBytes: 5000 });
  assert.deepEqual(imageLimits({ XDG_CONFIG_HOME: cfgHome, VIVAMARK_MAX_IMAGE_BYTES: '3000' }), { imageBytes: 3000, noteBytes: 5000 });
});

test('an image is kept by content hash in the state directory, uploaded from the review page only', async () => {
  const s = await openPage('attach.html');
  const png = makePng(40, 30);
  const sha = createHash('sha256').update(png).digest('hex');

  // The review page's token and Origin, as for Send.
  assert.equal((await uploadImage(s, png, { token: null })).status, 401);
  assert.equal((await uploadImage(s, png, { token: 'f'.repeat(64) })).status, 401);
  assert.equal((await uploadImage(s, png, { origin: false })).status, 403, 'not from the CLI or any tool without the page Origin');
  assert.equal((await uploadImage(s, png, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await uploadImage(s, png, { origin: 'null' })).status, 403, 'not from the sandboxed page');

  const up = await uploadImage(s, png);
  assert.equal(up.status, 201, up.text);
  assert.deepEqual(up.json, { id: sha, mime: 'image/png', width: 40, height: 30, bytes: png.length });
  const dir = path.join(world.stateDir, 'attachments', s.id);
  const stored = path.join(dir, `${sha}.png`);
  assert.deepEqual(fs.readFileSync(stored), png);
  assert.equal(fs.statSync(stored).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(world.stateDir, 'attachments')).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(world.pageDir).sort(), ['attach.html', 'plan.html'], 'nothing written next to the reviewed file');
  assert.equal((await uploadImage(s, png)).json.id, sha, 'the same image twice is stored once');
  assert.equal(fs.readdirSync(dir).length, 1);

  // What it is decides, not what it is called or claims to be.
  const text = await uploadImage(s, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  assert.equal(text.status, 415);
  assert.match(text.json.error, /only PNG, JPEG, GIF and WebP images/);
  const big = await uploadImage(s, Buffer.concat([makePng(10, 10), Buffer.alloc(70 * 1024)]));
  assert.equal(big.status, 413);
  assert.match(big.json.error, /at most 0\.1 MB/);

  // The review page shows its own images back, with the token.
  const got = await api(s.port, 'GET', `/api/s/${s.id}/attachments/${sha}`, { token: s.token });
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'image/png');
  assert.equal((await api(s.port, 'GET', `/api/s/${s.id}/attachments/${sha}`)).status, 401);
  const view = await api(s.port, 'GET', `/api/s/${s.id}`, { token: s.token });
  assert.deepEqual(view.json.limits, { image_bytes: 64 * 1024, note_image_bytes: 100 * 1024 });
});

test('images reach wait only on a sent note, as paths, and the event log counts them', async () => {
  const s = await openPage('attach-send.html');
  const a = await uploadImage(s, makePng(40, 30));
  const b = await uploadImage(s, GIF);
  assert.equal(a.status, 201, a.text);
  assert.equal(b.status, 201, b.text);

  // Uploaded is not sent.
  const early = await world.cli(['wait', s.file, '--timeout', '800ms']);
  assert.equal(early.code, 5, early.stdout);

  // Not an image of this review: refused, and nothing is logged.
  const other = await openPage('attach-other.html');
  const foreign = await uploadImage(other, makePng(5, 5, [1, 2, 3]));
  const refused = await sendNotes(s, [{ ...ELEMENT_NOTE, attachments: [foreign.json.id] }]);
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /no attached image/);
  assert.equal((await sendNotes(s, [{ ...ELEMENT_NOTE, attachments: ['../x'] }])).status, 400);

  const sent = await sendNotes(s, [
    { ...ELEMENT_NOTE, attachments: [a.json.id, b.json.id] },
    { kind: 'page', comment: 'No images on this one.', anchor: null },
  ]);
  assert.equal(sent.status, 201, sent.text);

  const w = await world.cli(['wait', s.file, '--json']);
  assert.equal(w.code, 0, w.stderr);
  const [withImages, without] = JSON.parse(w.stdout).notes;
  assert.deepEqual(without.attachments, []);
  assert.equal(withImages.attachments.length, 2);
  const [pa, pb] = withImages.attachments;
  assert.deepEqual(Object.keys(pa), ['id', 'path', 'mime', 'width', 'height', 'bytes']);
  assert.deepEqual(
    { ...pa, path: undefined },
    { id: a.json.id, path: undefined, mime: 'image/png', width: 40, height: 30, bytes: a.json.bytes },
  );
  assert.ok(path.isAbsolute(pa.path) && pa.path.startsWith(path.join(world.stateDir, 'attachments', s.id) + path.sep), pa.path);
  assert.ok(fs.existsSync(pa.path), 'the agent can open it');
  assert.equal(pb.mime, 'image/gif');
  assert.ok(!w.stdout.includes(makePng(40, 30).toString('base64').slice(0, 24)), 'the bytes are never inlined');

  const text = await world.cli(['wait', s.file]);
  assert.match(text.stdout, /images: 2 attached; open them from these paths:/);
  assert.ok(text.stdout.includes(`      ${pa.path} (PNG, 40 x 30, 1 KB)`), text.stdout);
  assert.ok(text.stdout.includes(pb.path));

  // The event log: a count, never an id, a path or image data.
  const raw = fs.readFileSync(path.join(world.stateDir, 'events.jsonl'), 'utf8');
  const sentEvents = raw
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .filter((e) => e.session === s.id && e.type === 'feedback.sent');
  assert.deepEqual(sentEvents.map((e) => e.attachments), [2]);
  for (const word of [a.json.id, b.json.id, 'attachments/', '.png', '.gif']) assert.ok(!raw.includes(word), `the event log carries no ${word}`);

  // A note's images together may not pass the per-note limit.
  const c = await uploadImage(s, Buffer.concat([makePng(10, 10, [9, 9, 9]), Buffer.alloc(60 * 1024)]));
  const d = await uploadImage(s, Buffer.concat([makePng(10, 10, [8, 8, 8]), Buffer.alloc(60 * 1024)]));
  assert.equal(c.status, 201, c.text);
  const tooMuch = await sendNotes(s, [{ ...ELEMENT_NOTE, attachments: [c.json.id, d.json.id] }]);
  assert.equal(tooMuch.status, 413);
  assert.match(tooMuch.json.error, /images on one note come to more than 0\.1 MB/);

  // An ended review takes no more images.
  assert.equal((await world.cli(['end', s.file])).code, 0);
  assert.equal((await uploadImage(s, makePng(2, 2))).status, 409);
});
