/**
 * One game for every screen playing it at once. Each screen prepares its own
 * interlude, but a stack of panels showing one game (or two screens on the
 * same slot) must show the same moment: they share one engine, one clock
 * and its frames. The engine stops when the last of them is done (or, cut
 * short, by its own idle timer; the next one to come starts another).
 */
import type { Frame } from './engine.ts';

export interface GameEngine {
  readonly width: number;
  readonly height: number;
  readonly alive: boolean;
  frame(ms: number): Promise<Frame>;
  key(pressed: boolean, key: number): void;
  close(): void;
}

/** One game tic: a frame newer than this is still the same picture. */
const TIC_MS = 1000 / 35;

const games = new Map<string, Promise<SharedGame>>();

export class SharedGame {
  private users = 0;
  private t0 = 0;
  private last: Frame | null = null;
  private inflight: Promise<Frame> | null = null;
  readonly engine: GameEngine;
  private readonly id: string;

  private constructor(engine: GameEngine, id: string) {
    this.engine = engine;
    this.id = id;
  }

  /** The game for `key` (the WAD), started with `start` if there is none running. */
  static async join(key: string, start: () => Promise<GameEngine>): Promise<SharedGame> {
    let pending = games.get(key);
    if (pending) {
      const game = await pending.catch(() => null);
      if (!game || !game.engine.alive) pending = undefined;
    }
    if (!pending) {
      pending = start().then((e) => new SharedGame(e, key));
      games.set(key, pending);
      pending.catch(() => games.delete(key));
    }
    const game = await pending;
    game.users++;
    return game;
  }

  /** The frame for `now` (wall time): the clock starts with the first screen to ask. */
  async frame(now: number): Promise<Frame> {
    if (!this.t0) this.t0 = now;
    const ms = now - this.t0;
    if (this.last && ms >= this.last.ms && ms - this.last.ms < TIC_MS) return this.last;
    // Another screen is asking already: the same answer serves both.
    if (this.inflight) return this.inflight;
    this.inflight = this.engine.frame(ms).finally(() => (this.inflight = null));
    this.last = await this.inflight;
    return this.last;
  }

  /** A key to the game (someone playing it from the Play page). */
  key(pressed: boolean, key: number): void {
    this.engine.key(pressed, key);
  }

  /** A screen is done with it; the last one stops the engine. */
  leave(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users > 0) return;
    this.engine.close();
    void games.get(this.id)?.then((g) => g === this && games.delete(this.id));
  }

  get playing(): number {
    return this.users;
  }
}
