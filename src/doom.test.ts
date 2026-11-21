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
import plugin, { attract, playArgs, stackOf, viewport } from './index.ts';
import { SharedGame, type GameEngine } from './shared.ts';
import { STATE } from './protocol.ts';
import { drawHud, levelTime, mapName, sides } from './hud.ts';
import { FREEDOOM, downloadDone, freedoom, freedoomDir, hasMapLumps, ownWad, unzip } from './wad.ts';

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
  const player = await attract.prepare({ ...base, options: { wad: WAD!, panels: 1, row: 1, showStats: false }, width, height, seed: 1, theme: themeById(undefined), canvas: { createCanvas, loadImage } as never, sources: {} });
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

test('HUD: room beside the game on a bar, none on a square panel', () => {
  const bar = sides(1920, 462, viewport(1920, 462));
  assert.ok(bar && bar.left.w >= 220 && bar.left.x + bar.left.w < 652 && bar.right.x > 652 + 616);
  assert.equal(sides(480, 480, viewport(480, 480)), null);
  // 1280×480 (Trofeo Vision 6.86″): 320 px a side, 268 once padded: room enough.
  assert.equal(sides(1280, 480, viewport(1280, 480))?.left.w, 268);
  // 854×480 (Fan Bracket Vision-1): 107 px a side, no.
  assert.equal(sides(854, 480, viewport(854, 480)), null);
});

test('HUD: map names and level time as the game writes them', () => {
  const s = Array(16).fill(0);
  s[STATE.episode] = 1; s[STATE.map] = 6; s[STATE.gamemode] = 3;
  assert.equal(mapName(s), 'E1M6');
  s[STATE.gamemode] = 2; s[STATE.map] = 7;
  assert.equal(mapName(s), 'MAP07');
  assert.equal(levelTime(35 * 65), '1:05');
});

test('HUD: paints its numbers in the panel’s theme, inside its sides', () => {
  const s = Array(16).fill(0);
  Object.assign(s, { [STATE.gamestate]: 0, [STATE.episode]: 1, [STATE.map]: 6, [STATE.leveltime]: 35 * 83, [STATE.health]: 20, [STATE.armor]: 50, [STATE.weapon]: 2, [STATE.ammo]: 8, [STATE.kills]: 11, [STATE.totalKills]: 30, [STATE.items]: 5, [STATE.totalItems]: 60, [STATE.secrets]: 1, [STATE.totalSecrets]: 4 });
  const canvas = createCanvas(1920, 462);
  const g = canvas.getContext('2d');
  const texts: string[] = [];
  const fill = g.fillText.bind(g);
  (g as unknown as { fillText: typeof g.fillText }).fillText = (t: string, x: number, y: number, m?: number) => (texts.push(t), fill(t, x, y, m));
  const theme = themeById(undefined);
  const say = (x: { en: string } & Record<string, string>) => x.en;
  drawHud(g, theme, say, s, sides(1920, 462, viewport(1920, 462))!, 'Freedoom');
  for (const t of ['E1M6', '1:23', '11 / 30', '5 / 60', '1 / 4', '20%', '50%', '8', 'SHOTGUN']) assert.ok(texts.includes(t), `${t} in ${texts.join(' | ')}`);
  // Nothing on the game's third.
  const middle = g.getImageData(652, 0, 616, 462).data;
  assert.ok(middle.every((v, i) => i % 4 === 3 || v === 0), 'the game area is left alone');
  s[STATE.gamestate] = 3;
  texts.length = 0;
  drawHud(g, theme, say, s, sides(1920, 462, viewport(1920, 462))!, 'Freedoom 0.13.0');
  assert.ok(texts.includes('Freedoom 0.13.0') && !texts.includes('E1M6'));
});

test('stack options are kept in range: 1–3 panels, a row inside them', () => {
  assert.deepEqual(stackOf({}), { panels: 1, row: 1 });
  assert.deepEqual(stackOf({ panels: 3, row: 2 }), { panels: 3, row: 2 });
  assert.deepEqual(stackOf({ panels: 2, row: 3 }), { panels: 2, row: 2 });
  assert.deepEqual(stackOf({ panels: 9, row: 0 }), { panels: 3, row: 1 });
  // Three 1920×462 bars: the game at 4:3 nearly fills them.
  assert.deepEqual(viewport(1920, 3 * 462), { x: 36, y: 0, w: 1848, h: 1386 });
});

/** An engine that counts what it is asked: frame k at ms is grey k. */
function fakeEngine(log: string[]): GameEngine {
  let alive = true;
  let n = 0;
  return {
    width: 4, height: 2,
    get alive() { return alive; },
    async frame(ms) {
      log.push(`frame ${ms}`);
      await new Promise((r) => setTimeout(r, 5));
      n++;
      return { ms, width: 4, height: 2, pixels: new Uint8Array(32).fill(n), state: [] };
    },
    key(pressed, key) { log.push(`key ${key} ${pressed}`); },
    close() { log.push('close'); alive = false; },
  };
}

test('screens playing at once share one game: one engine, one clock, the same frames', async () => {
  const log: string[] = [];
  const start = async () => (log.push('start'), fakeEngine(log));
  const [a, b, c] = await Promise.all([SharedGame.join('w', start), SharedGame.join('w', start), SharedGame.join('w', start)]);
  assert.ok(a === b && b === c);
  assert.equal(log.filter((l) => l === 'start').length, 1);
  assert.equal(a.playing, 3);
  // Asked together (three panels painting the same moment): one frame for all.
  const [f1, f2, f3] = await Promise.all([a.frame(1000), b.frame(1001), c.frame(1002)]);
  assert.ok(f1 === f2 && f2 === f3);
  assert.equal(log.filter((l) => l.startsWith('frame')).length, 1);
  // Within a tic, still the same picture; later, a new one, on the shared clock.
  assert.equal(await a.frame(1010), f1);
  const later = await b.frame(1100);
  assert.notEqual(later, f1);
  assert.equal(later.ms, 100);
  a.leave(); b.leave();
  assert.ok(!log.includes('close'), 'still one screen on it');
  c.leave();
  assert.equal(log.filter((l) => l === 'close').length, 1);
  // The next slot starts another game.
  const d = await SharedGame.join('w', start);
  assert.notEqual(d, a);
  assert.equal(log.filter((l) => l === 'start').length, 2);
  d.leave();
});

test('a stack of three paints one picture: the rows put together are the whole game', { skip: !WAD && 'set KIOSKO_DOOM_WAD to an IWAD' }, async () => {
  const width = 1920, height = 462;
  const base = createBaseContext({ now: Date.now(), log: () => {}, dataDir: tmp() });
  const rows = await Promise.all([1, 2, 3].map((row) => attract.prepare({ ...base, options: { wad: WAD!, panels: 3, row, showStats: true }, width, height, seed: 1, theme: themeById(undefined), canvas: { createCanvas, loadImage } as never, sources: {} })));
  const canvases = rows.map(() => createCanvas(width, height));
  // Painted as the runtime would: frame by frame, the three screens at the same moment.
  for (let i = 0; i < 3; i++) await Promise.all(rows.map((p, k) => p!.draw(canvases[k]!.getContext('2d'), i)));
  const strip = (k: number, y: number) => [...canvases[k]!.getContext('2d').getImageData(0, y, width, 1).data];
  // Black at the edges (36 px each side), the game everywhere between, and no seam: the last
  // row of one panel and the first of the next are neighbouring lines of the same picture.
  for (const k of [0, 1, 2]) assert.deepEqual([...canvases[k]!.getContext('2d').getImageData(10, 230, 1, 1).data], [0, 0, 0, 255]);
  const differs = (a: number[], b: number[]) => a.reduce((n, v, i) => n + Math.abs(v - b[i]!), 0) / a.length;
  assert.ok(differs(strip(0, height - 1), strip(1, 0)) < 40, 'top and middle meet');
  assert.ok(differs(strip(1, height - 1), strip(2, 0)) < 40, 'middle and bottom meet');
  for (const p of rows) await p!.draw(createCanvas(width, height).getContext('2d'), 600 * 30 - 1);
});

test('a game of one’s own starts at the first level: E1M1 for Doom 1, MAP01 for Doom II-style WADs', { skip: !WAD && 'set KIOSKO_DOOM_WAD to an IWAD' }, async () => {
  assert.equal(await hasMapLumps(WAD!), false);
  assert.deepEqual(await playArgs(WAD!), ['-skill', '3', '-warp', '1', '1']);
  // A Doom II-style directory: one MAP01 lump is enough to tell.
  const dir = tmp();
  const wad = Buffer.alloc(12 + 16);
  wad.write('IWAD', 0, 'latin1');
  wad.writeInt32LE(1, 4);
  wad.writeInt32LE(12, 8);
  wad.write('MAP01', 12 + 8, 'latin1');
  writeFileSync(join(dir, 'd2.wad'), wad);
  assert.deepEqual(await playArgs(join(dir, 'd2.wad')), ['-skill', '3', '-warp', '1']);
});

test('played from the Play page: a game, not the demos, and the buttons reach it', { skip: !WAD && 'set KIOSKO_DOOM_WAD to an IWAD' }, async () => {
  const listeners: ((e: { key: string; pressed: boolean }) => void)[] = [];
  const input = { on: (l: (e: { key: string; pressed: boolean }) => void) => (listeners.push(l), () => {}) };
  const logs: string[] = [];
  const base = createBaseContext({ now: Date.now(), log: (m) => logs.push(m), dataDir: tmp() });
  // On a screen set as the top row of a stack: played, it takes the whole screen.
  const player = await attract.prepare({ ...base, input, options: { wad: WAD!, panels: 3, row: 1, showStats: true }, width: 1920, height: 462, seed: 1, theme: themeById(undefined), canvas: { createCanvas, loadImage } as never, sources: {} } as never);
  assert.ok(player, logs.join('\n'));
  assert.equal(player.frames, Infinity);
  assert.match(logs.join('\n'), /being played from the Play page/);
  const g = createCanvas(1920, 462).getContext('2d');
  const texts: string[] = [];
  const fill = g.fillText.bind(g);
  (g as unknown as { fillText: typeof g.fillText }).fillText = (t: string, x: number, y: number, m?: number) => (texts.push(t), fill(t, x, y, m));
  const ammo = () => Number(texts[texts.lastIndexOf('E1M1') >= 0 ? texts.length - 1 : -1]);
  for (let i = 0; i < 20; i++) {
    await player.draw(g, i);
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.ok(texts.includes('E1M1'), `the first level, not a demo: ${texts.slice(-8).join(' | ')}`);
  const before = ammo();
  texts.length = 0;
  for (const l of listeners) l({ key: 'a', pressed: true });
  for (let i = 20; i < 60; i++) {
    texts.length = 0;
    await player.draw(g, i);
    await new Promise((r) => setTimeout(r, 30));
  }
  for (const l of listeners) l({ key: 'a', pressed: false });
  assert.ok(ammo() < before, `firing uses ammo: ${before} → ${ammo()}`);
  void ammo;
});
