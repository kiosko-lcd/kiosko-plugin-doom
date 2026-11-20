/**
 * Where the game's data (the IWAD) comes from: a file the user names, or
 * Freedoom Phase 1, downloaded once from its GitHub release into the plugin's
 * dataDir and checked against the release's SHA-256.
 *
 * Freedoom (https://freedoom.github.io) is free content under the BSD
 * licence. id Software's WADs are never downloaded nor shipped: a user who
 * owns one points `wad` at it.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const FREEDOOM = {
  version: '0.13.0',
  url: 'https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip',
  /** From the release's signed freedoom-0.13.0-CHECKSUM. */
  zipSha256: '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59',
  wad: 'freedoom1.wad',
  wadSha256: '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d',
  /** Files taken from the zip (its licence goes with the WAD). */
  keep: ['freedoom1.wad', 'COPYING.txt'],
} as const;

export type WadState =
  | { ready: true; path: string; name: string }
  | { ready: false; reason: string; downloading?: boolean };

/** The folder Freedoom is kept in, inside the plugin's dataDir. */
export const freedoomDir = (dataDir: string) => join(dataDir, `freedoom-${FREEDOOM.version}`);

/** Reads the files named in `want` out of a zip (stored or deflated, no zip64). */
export function unzip(zip: Uint8Array, want: (name: string) => boolean): Map<string, Buffer> {
  const b = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  // End of central directory: the last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const entries = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < entries; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip directory');
    const method = b.readUInt16LE(p + 10);
    const size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    if (b.readUInt32LE(local) !== 0x04034b50) throw new Error(`broken zip entry ${name}`);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const data = b.subarray(start, start + size);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`zip method ${method} not supported (${name})`);
  }
  return out;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

let downloading: Promise<void> | null = null;
let lastError: string | null = null;

/**
 * Freedoom's IWAD if it is there; otherwise starts downloading it (once, in
 * the background) and says so. Never waits for the download: an interlude
 * must not hold its screen for a 24 MB transfer.
 */
export function freedoom(dataDir: string, log: (msg: string) => void, get: typeof fetch = fetch): WadState {
  const dir = freedoomDir(dataDir);
  const path = join(dir, FREEDOOM.wad);
  if (existsSync(path)) return { ready: true, path, name: `Freedoom ${FREEDOOM.version}` };
  if (!downloading) {
    lastError = null;
    log(`downloading Freedoom ${FREEDOOM.version} (24 MB) from GitHub`);
    downloading = downloadFreedoom(dir, get)
      .then(() => log(`Freedoom ${FREEDOOM.version} ready in ${dir}`))
      .catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        log(`Freedoom download failed: ${lastError}`);
      })
      .finally(() => (downloading = null));
  }
  return { ready: false, downloading: true, reason: lastError ?? `downloading Freedoom ${FREEDOOM.version}` };
}

/** Waits for a download in progress (tests, the CLI). */
export const downloadDone = () => downloading ?? Promise.resolve();

export async function downloadFreedoom(dir: string, get: typeof fetch = fetch): Promise<void> {
  const res = await get(FREEDOOM.url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${FREEDOOM.url}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  if (sha256(zip) !== FREEDOOM.zipSha256) throw new Error('the Freedoom zip does not match its published SHA-256');
  const files = unzip(zip, (name) => (FREEDOOM.keep as readonly string[]).includes(name.split('/').pop()!));
  const wad = [...files].find(([n]) => n.endsWith(`/${FREEDOOM.wad}`) || n === FREEDOOM.wad)?.[1];
  if (!wad || sha256(wad) !== FREEDOOM.wadSha256) throw new Error(`${FREEDOOM.wad} missing or not the expected one`);
  // Written beside and renamed: a half-written folder is never taken for a ready one.
  const tmp = `${dir}.part`;
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  for (const [name, data] of files) await writeFile(join(tmp, name.split('/').pop()!), data);
  await rm(dir, { recursive: true, force: true });
  await rename(tmp, dir);
}

/** The user's own IWAD: it has to exist and look like one. */
export async function ownWad(path: string): Promise<WadState> {
  if (!existsSync(path)) return { ready: false, reason: `${path} not found` };
  const f = await open(path, 'r');
  const head = Buffer.alloc(4);
  try {
    await f.read(head, 0, 4, 0);
  } finally {
    await f.close();
  }
  if (head.toString('latin1') !== 'IWAD') return { ready: false, reason: `${path} is not an IWAD (${JSON.stringify(head.toString('latin1'))})` };
  return { ready: true, path, name: path.split(/[\\/]/).pop()! };
}
