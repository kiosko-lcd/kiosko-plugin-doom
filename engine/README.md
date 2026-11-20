# The engine

- `doomgeneric/`: the sources of [doomgeneric](https://github.com/ozkl/doomgeneric)
  at commit `e257a09527062bfb986b6e5e0780839b6cbd5b71` (see `doomgeneric/UPSTREAM`),
  GPL-2.0 (`doomgeneric/LICENSE`). Only the engine and its portable files;
  the platform files (SDL, X11, Windows, Allegro…), the icon and the
  SDL/GUS music are left out.
- `kiosko.c`: the platform layer for Kiosko. No window, no sound, no real
  clock: the host sets the time (`kiosko_set_time`), runs `doomgeneric_Tick`
  and reads `DG_ScreenBuffer` (`kiosko_screen`). Sleeping only moves that
  clock forward, so a tick never blocks. `kiosko_state` gives what a side
  panel may show (health, ammo, kills…).
- `build.sh`: compiles both with Emscripten in Docker (`emscripten/emsdk:4.0.20`,
  no network) into `build/doom.mjs`, an ES module for Node with the WASM
  inlined. Committed, so building the plugin needs no Docker:
  `npm run build:engine` only after changing anything here.

## Changes to doomgeneric

1. `i_system.c`, `I_Error`: under Emscripten, no Zenity error box. It ran
   `system("zenity --help")` to find out whether Zenity was there and never
   came back, so an engine with a bad WAD hung instead of ending with its
   error.
