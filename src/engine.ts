/**
 * Kiosko's side of the engine: forks engine-child (one process per game),
 * asks it for frames and stops it. The engine is GPL and lives only in that
 * process; this side speaks protocol.ts and nothing else.
 */
import { type ChildProcess, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { FromEngine, ToEngine } from './protocol.ts';

export interface Frame {
  ms: number;
  width: number;
  height: number;
  /** RGBA. */
  pixels: Uint8Array;
  state: number[];
}

export interface EngineOptions {
  /** Absolute path of the IWAD. */
  wad: string;
  /** More command-line arguments for the engine (`-warp`, `-skill`…). */
  args?: string[];
  /** Stop the process after this long without a frame asked (the interlude was cut short). */
  idleMs?: number;
  /** How long `start` and each frame may take. */
  timeoutMs?: number;
}

/** Built: dist/engine.js next to dist/index.js. From source (tests): engine-child.ts. */
function childPath(): string {
  const here = import.meta.url;
  return fileURLToPath(new URL(here.endsWith('.ts') ? './engine-child.ts' : './engine.js', here));
}

export class Engine {
  private child: ChildProcess;
  private waiting: { resolve: (m: FromEngine) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  private idle: NodeJS.Timeout | null = null;
  private exitMessage: string | null = null;
  width = 0;
  height = 0;

  private readonly o: Required<Omit<EngineOptions, 'args'>> & { args: string[] };

  private constructor(o: Required<Omit<EngineOptions, 'args'>> & { args: string[] }) {
    this.o = o;
    this.child = fork(childPath(), [], {
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    // The engine never keeps Kiosko (or a test) alive: only a question waiting for its answer does.
    this.child.unref();
    this.child.channel?.unref();
    (this.child.stderr as unknown as { unref?: () => void } | null)?.unref?.();
    let stderr = '';
    this.child.stderr?.on('data', (b: Buffer) => (stderr = (stderr + b.toString()).slice(-2000)));
    this.child.on('message', (m: FromEngine) => {
      if (m.type === 'exit') this.exitMessage = m.message;
      const w = this.waiting;
      if (!w) return;
      this.waiting = null;
      this.child.channel?.unref();
      clearTimeout(w.timer);
      if (m.type === 'exit') w.reject(new Error(m.message));
      else w.resolve(m);
    });
    this.child.on('exit', (code, signal) => {
      this.exitMessage ??= `engine process ended (${signal ?? code})${stderr ? `: ${stderr.trim().split('\n').slice(-3).join(' | ')}` : ''}`;
      const w = this.waiting;
      this.waiting = null;
      if (w) {
        clearTimeout(w.timer);
        w.reject(new Error(this.exitMessage));
      }
      if (this.idle) clearTimeout(this.idle);
    });
  }

  /** Forks the engine and loads the WAD. */
  static async start(o: EngineOptions): Promise<Engine> {
    const e = new Engine({ wad: o.wad, args: o.args ?? [], idleMs: o.idleMs ?? 10_000, timeoutMs: o.timeoutMs ?? 15_000 });
    try {
      const ready = await e.ask({ type: 'start', wad: o.wad, args: o.args ?? [] });
      if (ready.type !== 'ready') throw new Error(`unexpected ${ready.type}`);
      e.width = ready.width;
      e.height = ready.height;
      e.touch();
      return e;
    } catch (err) {
      e.close();
      throw err;
    }
  }

  get alive(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null && this.exitMessage === null;
  }

  /** Runs the game up to `ms` since it started and returns that frame. */
  async frame(ms: number): Promise<Frame> {
    this.touch();
    const m = await this.ask({ type: 'frame', ms });
    if (m.type !== 'frame') throw new Error(`unexpected ${m.type}`);
    return { ms: m.ms, width: this.width, height: this.height, pixels: m.pixels, state: m.state };
  }

  key(pressed: boolean, key: number): void {
    if (this.alive) this.child.send({ type: 'key', pressed, key } satisfies ToEngine);
  }

  close(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill();
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), this.o.idleMs);
    this.idle.unref();
  }

  private ask(m: ToEngine): Promise<FromEngine> {
    if (!this.alive) return Promise.reject(new Error(this.exitMessage ?? 'engine stopped'));
    if (this.waiting) return Promise.reject(new Error('engine busy'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        this.child.channel?.unref();
        reject(new Error(`engine did not answer ${m.type} in ${this.o.timeoutMs} ms`));
        this.close();
      }, this.o.timeoutMs);
      this.waiting = { resolve, reject, timer };
      this.child.channel?.ref();
      this.child.send(m);
    });
  }
}
