# kiosko-plugin-doom

Doom on your panel. For now, one interlude: the game's own attract loop (title
screens and recorded demos), with no one at the controls.

A plugin for [Kiosko](https://github.com/kiosko-lcd/kiosko), the widget mosaic
for small USB LCD panels. **Optional:** Kiosko doesn't install it; it offers it
on the Plugins page.

![Doom demos on a 1920×462 panel](docs/attract.jpg)

## Install

In Kiosko, **Plugins → Official plugins not installed → kiosko-plugin-doom → Add**.
Or from a terminal:

```sh
npm install --prefix ~/.config/kiosko/plugins kiosko-plugin-doom
```

(macOS: `~/Library/Application Support/Kiosko/plugins`, Windows: `%APPDATA%\Kiosko\plugins`.)

Then add the interlude to a screen: **Screens → Interludes → Doom demos**. Like
any interlude it plays at a time slot (every 15 min = at :00, :15, :30, :45)
for up to `maxSeconds`, or right away from the editor or Home Assistant.

## The game's data

- **Freedoom by default.** [Freedoom](https://freedoom.github.io) Phase 1 is
  free content (new levels, art and demos, under the BSD licence). The first
  time the interlude is due it downloads `freedoom-0.13.0.zip` (24 MB) from
  GitHub into the plugin's data folder, checks it against the release's
  published SHA-256 and keeps `freedoom1.wad` and its licence. That time it
  doesn't play; from the next one on it does.
- **Your own IWAD.** Point the `wad` option at a file you own (`doom1.wad`
  from the shareware, `DOOM.WAD`, `DOOM2.WAD`…). It is read where it is;
  nothing is copied, and nothing from id Software is shipped or downloaded.

## What it does on your machine

- **Runs** `node`: the engine runs in a process of its own, started with the
  same Node as Kiosko, one per interlude playing. It stops when the interlude
  ends (or 10 s after the last frame, when an interlude is cut short).
- **Contacts** `github.com` and `release-assets.githubusercontent.com`, once,
  to download Freedoom (only when `wad` is empty).
- **Reads** the IWAD you name in `wad`.

About 5 % of one core while it plays at 15 fps, besides what Kiosko spends
sending the frames.

## Interludes

### Doom demos — `doom/attract`

The game plays its own recorded demos between title screens, with no one at
the controls. The game (320×200, shown at 4:3) is centred on the panel. On a
wide one, the game's numbers go beside it in the panel's theme: the map, the
level's time, kills, items and secrets on the left; health, armour, the
weapon and its ammo on the right.

| Option | Type | Default | |
|---|---|---|---|
| `wad` | path | `""` | IWAD. A game data file of your own (doom1.wad, DOOM.WAD, DOOM2.WAD…). Empty: Freedoom. |
| `showStats` | boolean | `true` | The game's numbers beside it, when each side has at least 220 px. |

## How it works

- `engine/`: [doomgeneric](https://github.com/ozkl/doomgeneric) (the Doom
  source, made portable) and `kiosko.c`, the platform layer for Kiosko,
  compiled to WebAssembly with Emscripten (`npm run build:engine`, in Docker;
  the result, `engine/build/doom.mjs`, is committed). See
  [engine/README.md](engine/README.md).
- `src/engine-child.ts`: the engine's process. It owns no clock: Kiosko says
  what time it is and asks for a frame.
- `src/engine.ts`: Kiosko's side. Forks the process and speaks
  `src/protocol.ts` with it, nothing else.
- `src/index.ts`: the interlude. Game time is wall time, so when the panel
  can't keep up the game skips frames rather than going slow.

## Licence

GPL-2.0-or-later, like the engine it is built on (see [LICENSE](LICENSE)).
Kiosko itself is MIT; this plugin is a separate program, installed only if you
choose to, and its engine runs in its own process.

Freedoom is © the Freedoom contributors, BSD licence (downloaded with its
`COPYING.txt`). DOOM is a trademark of id Software / ZeniMax Media; this
project is not affiliated with or endorsed by them.
