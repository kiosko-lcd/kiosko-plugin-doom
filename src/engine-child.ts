/**
 * The engine's process: doomgeneric compiled to WASM (engine/build/doom.mjs),
 * driven by the messages of protocol.ts. Kiosko forks it (engine.ts) and
 * never loads the engine in its own process.
 *
 * The WAD's folder is mounted read through NODEFS at /wad; the engine's own
 * files (default.cfg, saves) stay in memory.
 */
import { basename, dirname } from 'node:path';
// @ts-expect-error: Emscripten output, no types.
import createDoom from '../engine/build/doom.mjs';
import type { FromEngine, ToEngine } from './protocol.ts';

interface Doom {
  FS: { mkdir(p: string): void; mount(fs: unknown, opts: { root: string }, at: string): void };
  NODEFS: unknown;
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  stringToNewUTF8(s: string): number;
  _malloc(n: number): number;
  _kiosko_start(args: number): void;
  _kiosko_set_time(ms: number): void;
  _kiosko_screen(): number;
  _kiosko_width(): number;
  _kiosko_height(): number;
  _kiosko_state(out: number): void;
  _kiosko_key(pressed: number, key: number): void;
  _doomgeneric_Tick(): void;
}

const said: string[] = [];
const remember = (s: string) => {
  said.push(s);
  if (said.length > 20) said.shift();
};

let doom: Doom | null = null;
let stateAt = 0;
let lastMs = 0;
/** Longest step the engine runs whole (measured: at 100 ms it still runs every tic, at 250 it drops some). */
const STEP_MS = 100;
const CATCH_UP_MS = 5_000;
let width = 0;
let height = 0;

function send(m: FromEngine): void {
  process.send?.(m);
}

function bye(message: string): never {
  send({ type: 'exit', message });
  process.exit(1);
}

/** The engine quits through exit(): Emscripten throws for it. */
function guarded(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    const status = (err as { status?: number })?.status;
    bye(status !== undefined ? `engine exited (${status}): ${said.slice(-3).join(' | ')}` : String((err as Error)?.stack ?? err));
  }
}

async function start(wad: string, args: string[] = []): Promise<void> {
  doom = (await createDoom({ print: remember, printErr: remember })) as Doom;
  doom.FS.mkdir('/wad');
  doom.FS.mount(doom.NODEFS, { root: dirname(wad) }, '/wad');
  const argv = ['-iwad', `/wad/${basename(wad)}`, ...args].join('\n');
  guarded(() => doom!._kiosko_start(doom!.stringToNewUTF8(argv)));
  width = doom._kiosko_width();
  height = doom._kiosko_height();
  stateAt = doom._malloc(16 * 4);
  send({ type: 'ready', width, height });
}

function frame(ms: number): void {
  const d = doom!;
  guarded(() => {
    // One tick runs the tics due, but the engine drops what is more than a
    // few behind: a gap over STEP_MS (a slow panel, a busy machine) is walked
    // in steps, up to CATCH_UP_MS of game; beyond that the game jumps.
    const to = Math.max(0, Math.round(ms));
    for (let t = Math.max(lastMs, to - CATCH_UP_MS) + STEP_MS; t < to; t += STEP_MS) {
      d._kiosko_set_time(t);
      d._doomgeneric_Tick();
    }
    d._kiosko_set_time(to);
    d._doomgeneric_Tick();
    lastMs = Math.max(lastMs, to);
  });
  // The engine paints 0x00RRGGBB words, little-endian: B, G, R, 0.
  const at = d._kiosko_screen() >>> 0;
  const src = d.HEAPU8.subarray(at, at + width * height * 4);
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = src[i + 2]!;
    pixels[i + 1] = src[i + 1]!;
    pixels[i + 2] = src[i]!;
    pixels[i + 3] = 255;
  }
  d._kiosko_state(stateAt);
  const state = Array.from(d.HEAP32.subarray(stateAt >> 2, (stateAt >> 2) + 16));
  send({ type: 'frame', ms, pixels, state });
}

process.on('message', (m: ToEngine) => {
  if (m.type === 'start') start(m.wad, m.args).catch((err) => bye(String(err?.stack ?? err)));
  else if (!doom) bye(`${m.type} before start`);
  else if (m.type === 'frame') frame(m.ms);
  else if (m.type === 'key') doom._kiosko_key(m.pressed ? 1 : 0, m.key);
});
// Kiosko went away: so do we.
process.on('disconnect', () => process.exit(0));
