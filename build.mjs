// Bundles the plugin into dist/index.js and the engine's process into
// dist/engine.js (with the WASM inlined, from engine/build/doom.mjs: rebuild
// that with `npm run build:engine`). What Kiosko itself provides to every
// plugin (the SDK, the drawing kit, the canvas) stays external.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  conditions: ['source'],
  legalComments: 'linked',
  banner: { js: "import { createRequire as __pluginRequire } from 'node:module'; const require = __pluginRequire(import.meta.url);" },
  logLevel: 'warning',
};

await build({
  ...common,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  external: ['@kiosko/sdk', '@loksly/lcd-canvas-kit', '@loksly/weather-astro', '@napi-rs/canvas'],
});
// The engine's process loads nothing from Kiosko.
await build({ ...common, charset: 'utf8', entryPoints: ['src/engine-child.ts'], outfile: 'dist/engine.js' });
console.log('dist/index.js, dist/engine.js');
