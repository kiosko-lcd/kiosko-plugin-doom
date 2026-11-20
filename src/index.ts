/**
 * Doom on the panel. For now one interlude, `doom/attract`: the game's own
 * attract loop (title, recorded demos, credits), no controls needed.
 *
 * The engine (doomgeneric, GPL) runs in a child process, see engine.ts; the
 * game's data is Freedoom unless the user names an IWAD of their own, see
 * wad.ts.
 */
import { defineInterlude, definePlugin, t } from '@kiosko/sdk';
import { Engine } from './engine.ts';
import { freedoom, ownWad } from './wad.ts';

/** The game's pixels are not square: 320×200 is shown at 4:3. */
export const ASPECT = 4 / 3;

/** Where the game goes on a `width × height` canvas: as big as fits at 4:3, centred. */
export function viewport(width: number, height: number, aspect = ASPECT): { x: number; y: number; w: number; h: number } {
  const w = Math.min(width, Math.round(height * aspect));
  const h = Math.min(height, Math.round(w / aspect));
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h };
}

/** The runtime cuts it at the slot's `maxSeconds` (600 at most); this is only the ceiling. */
const MAX_FRAMES = 600 * 30;

export const attract = defineInterlude({
  id: 'attract',
  name: { en: 'Doom demos', es: 'Demos de Doom', de: 'Doom-Demos', 'zh-Hans': 'Doom 演示', 'zh-Hant': 'Doom 示範' },
  description: {
    en: 'The game plays its own recorded demos between title screens, with no one at the controls. Freedoom by default (free levels and art, downloaded once, 24 MB); your own IWAD if you have one.',
    es: 'El juego reproduce sus propias demos grabadas entre pantallas de título, sin nadie a los mandos. Freedoom por defecto (niveles y gráficos libres, se descarga una vez, 24 MB); tu propio IWAD si tienes uno.',
    de: 'Das Spiel zeigt seine eigenen aufgezeichneten Demos zwischen den Titelbildern, ganz ohne Steuerung. Standardmäßig Freedoom (freie Level und Grafiken, einmal heruntergeladen, 24 MB); dein eigenes IWAD, falls du eines hast.',
    'zh-Hans': '游戏在标题画面之间自动播放录制好的演示，无需操作。默认使用 Freedoom（免费关卡和美术，只下载一次，24 MB）；也可以用你自己的 IWAD。',
    'zh-Hant': '遊戲在標題畫面之間自動播放錄製好的示範，無需操作。預設使用 Freedoom（免費關卡和美術，只下載一次，24 MB）；也可以用你自己的 IWAD。',
  },
  icon: 'gamepad-2',
  fps: 30,
  options: t.object({
    wad: t.string({
      default: '',
      format: 'path',
      risk: 'path',
      label: { en: 'IWAD', es: 'IWAD', de: 'IWAD', 'zh-Hans': 'IWAD', 'zh-Hant': 'IWAD' },
      help: {
        en: 'A game data file of your own (doom1.wad, DOOM.WAD, DOOM2.WAD…). Empty: Freedoom.',
        es: 'Un archivo de datos del juego tuyo (doom1.wad, DOOM.WAD, DOOM2.WAD…). Vacío: Freedoom.',
        de: 'Eine eigene Spieldatendatei (doom1.wad, DOOM.WAD, DOOM2.WAD…). Leer: Freedoom.',
        'zh-Hans': '你自己的游戏数据文件（doom1.wad、DOOM.WAD、DOOM2.WAD…）。留空：Freedoom。',
        'zh-Hant': '你自己的遊戲資料檔（doom1.wad、DOOM.WAD、DOOM2.WAD…）。留空：Freedoom。',
      },
      placeholder: '~/games/doom1.wad',
    }),
  }),
  async prepare(ctx) {
    const say = (msg: string) => ctx.log(`doom: ${msg}`);
    const wadPath = ctx.options.wad.trim().replace(/^~(?=$|[\\/])/, process.env.HOME ?? process.env.USERPROFILE ?? '~');
    const wad = wadPath ? await ownWad(wadPath) : freedoom(ctx.dataDir, say);
    if (!wad.ready) {
      say(`not playing: ${wad.reason}`);
      return null;
    }
    const engine = await Engine.start({ wad: wad.path });
    say(`playing the demos of ${wad.name}`);
    const small = ctx.canvas.createCanvas(engine.width, engine.height);
    const sg = small.getContext('2d');
    const image = sg.createImageData(engine.width, engine.height);
    const view = viewport(ctx.width, ctx.height);
    let t0 = 0;
    return {
      frames: MAX_FRAMES,
      async draw(g, i) {
        if (i === 0) t0 = Date.now();
        // Game time is wall time: when the panel can't keep up, the game
        // skips frames rather than going slow.
        const f = await engine.frame(Date.now() - t0);
        image.data.set(f.pixels);
        sg.putImageData(image, 0, 0);
        g.fillStyle = '#000';
        g.fillRect(0, 0, ctx.width, ctx.height);
        g.imageSmoothingEnabled = false;
        g.drawImage(small, view.x, view.y, view.w, view.h);
        if (i >= MAX_FRAMES - 1) engine.close();
      },
    };
  },
});

export default definePlugin({
  id: 'doom',
  name: { en: 'Doom', es: 'Doom', de: 'Doom', 'zh-Hans': 'Doom', 'zh-Hant': 'Doom' },
  version: '0.1.0',
  description: {
    en: 'Doom on your panel: the game plays its own demos as an interlude. The engine (doomgeneric, GPL) runs in a process of its own; the levels are Freedoom unless you bring your own IWAD.',
    es: 'Doom en tu panel: el juego reproduce sus propias demos como interludio. El motor (doomgeneric, GPL) corre en un proceso propio; los niveles son de Freedoom salvo que pongas tu propio IWAD.',
    de: 'Doom auf deinem Panel: Das Spiel zeigt seine eigenen Demos als Zwischenspiel. Die Engine (doomgeneric, GPL) läuft in einem eigenen Prozess; die Level sind Freedoom, außer du bringst dein eigenes IWAD mit.',
    'zh-Hans': '在面板上运行 Doom：游戏把自己的演示作为插曲播放。引擎（doomgeneric，GPL）在独立进程中运行；关卡默认来自 Freedoom，也可使用你自己的 IWAD。',
    'zh-Hant': '在面板上執行 Doom：遊戲把自己的示範當作插曲播放。引擎（doomgeneric，GPL）在獨立行程中執行；關卡預設來自 Freedoom，也可使用你自己的 IWAD。',
  },
  author: 'Loksly',
  license: 'GPL-2.0-or-later',
  homepage: 'https://github.com/kiosko-lcd/kiosko-plugin-doom#readme',
  repository: 'https://github.com/kiosko-lcd/kiosko-plugin-doom',
  sdk: '^0.2.0',
  permissions: {
    network: ['github.com', 'release-assets.githubusercontent.com'],
    exec: ['node'],
    files: ['user'],
  },
  interludes: [attract],
});
