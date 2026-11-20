import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createBaseContext, themeById } from '@kiosko/sdk';
import { Engine } from './engine.ts';
import plugin, { attract, viewport } from './index.ts';
import { STATE } from './protocol.ts';
import { FREEDOOM, downloadDone, freedoom, freedoomDir, ownWad, unzip } from './wad.ts';

/** A real IWAD to run the engine with (freedoom1.wad, doom1.wad…); the engine tests skip without one. */
const WAD = process.env.KIOSKO_DOOM_WAD;
const tmp = () => mkdtempSync(join(tmpdir(), 'kiosko-doom-'));

/** A zip with these files, the first stored and the rest deflated. */
function zipOf(files: [string, Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  files.forEach(([name, data], i) => {
    const method = i === 0 ? 0 : 8;
    const body = method ? deflateRawSync(data) : data;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    central.push(c, n);
    offset += local.length + n.length + body.length;
  });
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test('viewport: the game at 4:3, as big as fits, centred', () => {
  assert.deepEqual(viewport(1920, 462), { x: 652, y: 0, w: 616, h: 462 });
  assert.deepEqual(viewport(480, 1920), { x: 0, y: 780, w: 480, h: 360 });
  assert.deepEqual(viewport(640, 480), { x: 0, y: 0, w: 640, h: 480 });
});

test('unzip reads stored and deflated entries, only the ones asked for', () => {
  const zip = zipOf([
    ['a/COPYING.txt', Buffer.from('BSD')],
    ['a/freedoom1.wad', Buffer.from('IWAD'.repeat(1000))],
    ['a/manual.pdf', Buffer.from('%PDF')],
  ]);
  const out = unzip(zip, (n) => !n.endsWith('.pdf'));
  assert.deepEqual([...out.keys()], ['a/COPYING.txt', 'a/freedoom1.wad']);
  assert.equal(out.get('a/COPYING.txt')!.toString(), 'BSD');
  assert.equal(out.get('a/freedoom1.wad')!.toString(), 'IWAD'.repeat(1000));
  assert.throws(() => unzip(Buffer.from('not a zip at all, not even close to it'), () => true), /not a zip/);
});

test('Freedoom: a download that does not match its SHA-256 is refused and nothing is kept', async () => {
  const dir = tmp();
  const logs: string[] = [];
  const zip = zipOf([[`freedoom-${FREEDOOM.version}/${FREEDOOM.wad}`, Buffer.from('IWAD-but-not-the-real-one')]]);
  const fake = (async () => new Response(zip)) as unknown as typeof fetch;
  const first = freedoom(dir, (m) => logs.push(m), fake);
  assert.equal(first.ready, false);
  assert.equal(first.ready === false && first.downloading, true);
  await downloadDone();
  assert.match(logs.join('\n'), /does not match its published SHA-256/);
  const again = freedoom(dir, () => {}, (async () => new Response('', { status: 503 })) as unknown as typeof fetch);
  assert.equal(again.ready, false);
  await downloadDone();
});

test('Freedoom already downloaded: ready, no network', () => {
  const dir = tmp();
  const folder = freedoomDir(dir);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, FREEDOOM.wad), 'IWAD');
  const state = freedoom(dir, () => {}, (() => assert.fail('no download')) as unknown as typeof fetch);
  assert.deepEqual(state, { ready: true, path: join(folder, FREEDOOM.wad), name: `Freedoom ${FREEDOOM.version}` });
});

test('own WAD: missing, or not an IWAD, is said so', async () => {
  const dir = tmp();
  assert.match((await ownWad(join(dir, 'nope.wad')) as { reason: string }).reason, /not found/);
  writeFileSync(join(dir, 'pwad.wad'), 'PWAD....');
  assert.match((await ownWad(join(dir, 'pwad.wad')) as { reason: string }).reason, /not an IWAD/);
  writeFileSync(join(dir, 'ok.wad'), 'IWAD....');
  assert.deepEqual(await ownWad(join(dir, 'ok.wad')), { ready: true, path: join(dir, 'ok.wad'), name: 'ok.wad' });
});

test('the engine process: a WAD it cannot use ends it, and start says why', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'broken.wad'), 'IWAD\0\0\0\0\0\0\0\0');
  await assert.rejects(Engine.start({ wad: join(dir, 'broken.wad'), timeoutMs: 20_000 }), /engine|exited|process/);
});

test('the engine plays the demos: frames move, the state says a demo is on', { skip: !WAD && 'set KIOSKO_DOOM_WAD to an IWAD' }, async () => {
  const e = await Engine.start({ wad: WAD! });
  try {
    assert.deepEqual([e.width, e.height], [320, 200]);
    const title = await e.frame(0);
    assert.equal(title.pixels.length, 320 * 200 * 4);
    // The title page stays ~5 s; then DEMO1. A panel asks every 33-100 ms;
    // here, every second (gaps over 100 ms are walked in steps).
    for (let ms = 1_000; ms < 15_000; ms += 1_000) await e.frame(ms);
    const later = await e.frame(15_000);
    assert.equal(later.state[STATE.demoplayback], 1);
    assert.ok(later.state[STATE.leveltime]! > 0);
    const digest = (p: Uint8Array) => createHash('sha1').update(p).digest('hex');
    const next = await e.frame(15_500);
    assert.notEqual(digest(next.pixels), digest(later.pixels));
    // Time never goes back: an older time just repaints the same moment.
    const back = await e.frame(1_000);
    assert.ok(back.state[STATE.leveltime]! >= next.state[STATE.leveltime]!);
    // A jump longer than the catch-up (a suspend) costs at most a few ms per frame.
    const t = Date.now();
    await e.frame(600_000);
    assert.ok(Date.now() - t < 2_000, `a 10 min jump took ${Date.now() - t} ms`);
  } finally {
    e.close();
  }
});

test('the interlude paints the game in the middle of a wide panel, black around it', { skip: !WAD && 'set KIOSKO_DOOM_WAD to an IWAD' }, async () => {
  const width = 1920;
  const height = 462;
  const logs: string[] = [];
  const base = createBaseContext({ now: Date.now(), log: (m) => logs.push(m), dataDir: tmp() });
  const player = await attract.prepare({ ...base, options: { wad: WAD! }, width, height, seed: 1, theme: themeById(undefined), canvas: { createCanvas, loadImage } as never, sources: {} });
  assert.ok(player, logs.join('\n'));
  const canvas = createCanvas(width, height);
  const g = canvas.getContext('2d');
  for (let i = 0; i < 3; i++) await player.draw(g, i);
  const px = (x: number, y: number) => [...g.getImageData(x, y, 1, 1).data];
  assert.deepEqual(px(10, 230), [0, 0, 0, 255]);
  assert.deepEqual(px(1910, 230), [0, 0, 0, 255]);
  const middle = g.getImageData(652, 0, 616, 462).data;
  assert.ok(middle.some((v, i) => i % 4 !== 3 && v > 40), 'the game is painted');
});

test('the plugin: one interlude, GPL, honest about what it does', () => {
  assert.equal(plugin.id, 'doom');
  assert.deepEqual(plugin.interludes!.map((i) => i.id), ['attract']);
  assert.equal(plugin.license, 'GPL-2.0-or-later');
  assert.ok(plugin.permissions!.network!.includes('github.com'));
  assert.ok(plugin.permissions!.exec!.includes('node'));
});
