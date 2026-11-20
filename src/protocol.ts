/**
 * What Kiosko (the parent) and the engine (a child process) say to each other
 * over the IPC channel. The engine is GPL and runs in its own process, so the
 * two programs only exchange these messages.
 */

/** Parent → child. */
export type ToEngine =
  /** Load the IWAD (absolute path on this machine) and run the first tick. */
  | { type: 'start'; wad: string; args?: string[] }
  /** Advance the game to `ms` (milliseconds since start) and send the frame. */
  | { type: 'frame'; ms: number }
  /** A key, as Doom's key codes (see KEYS). */
  | { type: 'key'; pressed: boolean; key: number };

/** Child → parent. */
export type FromEngine =
  | { type: 'ready'; width: number; height: number }
  /** RGBA pixels, `width × height × 4`; `state` as STATE says. */
  | { type: 'frame'; ms: number; pixels: Uint8Array; state: number[] }
  /** The engine stopped by itself (it quit, or I_Error), with its last words. */
  | { type: 'exit'; message: string };

/** Index of each value in `state` (engine/kiosko.c, kiosko_state). */
export const STATE = {
  gamestate: 0,
  demoplayback: 1,
  episode: 2,
  map: 3,
  leveltime: 4,
  health: 5,
  armor: 6,
  weapon: 7,
  ammo: 8,
  kills: 9,
  totalKills: 10,
  items: 11,
  totalItems: 12,
  secrets: 13,
  totalSecrets: 14,
  gamemode: 15,
} as const;

/** Doom's own key codes (engine/doomgeneric/doomkeys.h), for the keys a pad needs. */
export const KEYS = {
  right: 0xae,
  left: 0xac,
  up: 0xad,
  down: 0xaf,
  strafeLeft: 0xa0,
  strafeRight: 0xa1,
  use: 0xa2,
  fire: 0xa3,
  escape: 27,
  enter: 13,
  tab: 9,
  shift: 0x80 + 0x36,
} as const;
