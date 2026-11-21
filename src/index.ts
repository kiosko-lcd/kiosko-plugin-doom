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
import { drawHud, sides } from './hud.ts';
import { SharedGame } from './shared.ts';
import { freedoom, hasMapLumps, ownWad } from './wad.ts';
import { PAD_TO_DOOM } from './protocol.ts';

/** The game's pixels are not square: 320×200 is shown at 4:3. */
export const ASPECT = 4 / 3;

/** Where the game goes on a `width × height` canvas: as big as fits at 4:3, centred. */
export function viewport(width: number, height: number, aspect = ASPECT): { x: number; y: number; w: number; h: number } {
  const w = Math.min(width, Math.round(height * aspect));
  const h = Math.min(height, Math.round(w / aspect));
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h };
}

/**
 * The Play page's buttons (Kiosko 0.2.7 and later): typed here, so the
 * plugin builds and runs against older Kiosko too, which never sends them.
 */
type PlayInput = { on(listener: (e: { key: string; pressed: boolean }) => void): () => void };

/** The engine's arguments for a game of one's own: skill 3 (Hurt me plenty), from the first level. */
export async function playArgs(wad: string): Promise<string[]> {
  return ['-skill', '3', '-warp', ...((await hasMapLumps(wad)) ? ['1'] : ['1', '1'])];
}

/** Panels in the stack (1–3) and this screen's row in it (1 = top), whatever the options say. */
export function stackOf(o: { panels?: number; row?: number }): { panels: number; row: number } {
  const panels = Math.max(1, Math.min(3, Math.round(o.panels ?? 1)));
  return { panels, row: Math.max(1, Math.min(panels, Math.round(o.row ?? 1))) };
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
  // It can be played: the editor's Play page offers it (Kiosko 0.2.7 and later).
  ...({ input: true } as object),
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
    panels: t.integer({
      default: 1,
      min: 1,
      max: 3,
      label: { en: 'Panels in the stack', es: 'Paneles de la pila', de: 'Panels im Stapel', 'zh-Hans': '堆叠的面板数', 'zh-Hant': '堆疊的面板數' },
      help: {
        en: 'Panels stacked one on top of the other that show one game between them (three 1920×462 bars are nearly 4:3). Give each screen this interlude, at the same times, with its row.',
        es: 'Paneles apilados uno encima de otro que muestran una sola partida entre todos (tres barras de 1920×462 son casi 4:3). Pon este interludio en cada pantalla, a las mismas horas, con su fila.',
        de: 'Übereinander gestapelte Panels, die gemeinsam ein Spiel zeigen (drei 1920×462-Leisten sind fast 4:3). Gib jedem Bildschirm dieses Zwischenspiel zu denselben Zeiten, mit seiner Reihe.',
        'zh-Hans': '上下堆叠、共同显示同一局游戏的面板数（三块 1920×462 长条屏接近 4:3）。在每块屏幕上设置这个插曲，时间相同，并选择各自的行。',
        'zh-Hant': '上下堆疊、共同顯示同一局遊戲的面板數（三塊 1920×462 長條螢幕接近 4:3）。在每塊螢幕上設定這個插曲，時間相同，並選擇各自的列。',
      },
    }),
    row: t.integer({
      default: 1,
      min: 1,
      max: 3,
      label: { en: 'Row in the stack', es: 'Fila en la pila', de: 'Reihe im Stapel', 'zh-Hans': '在堆叠中的行', 'zh-Hant': '在堆疊中的列' },
      help: {
        en: 'Which of the stacked panels this screen is: 1 is the top one.',
        es: 'Cuál de los paneles apilados es esta pantalla: 1 es el de arriba.',
        de: 'Welches der gestapelten Panels dieser Bildschirm ist: 1 ist das oberste.',
        'zh-Hans': '这块屏幕是堆叠中的哪一块：1 为最上面。',
        'zh-Hant': '這塊螢幕是堆疊中的哪一塊：1 為最上面。',
      },
    }),
    showStats: t.boolean({
      default: true,
      label: { en: 'Show the game’s numbers beside it', es: 'Mostrar los datos de la partida a los lados', de: 'Spielwerte daneben zeigen', 'zh-Hans': '在两侧显示游戏数据', 'zh-Hant': '在兩側顯示遊戲資料' },
      help: {
        en: 'On a wide panel: the map, time, kills, items and secrets on the left; health, armour and ammo on the right.',
        es: 'En un panel ancho: el mapa, el tiempo, los enemigos, objetos y secretos a la izquierda; la salud, la armadura y la munición a la derecha.',
        de: 'Auf einem breiten Panel: Karte, Zeit, Gegner, Gegenstände und Geheimnisse links; Gesundheit, Rüstung und Munition rechts.',
        'zh-Hans': '在宽屏面板上：左侧显示地图、时间、击杀、物品和秘密；右侧显示生命、护甲和弹药。',
        'zh-Hant': '在寬螢幕面板上：左側顯示地圖、時間、擊殺、物品與秘密；右側顯示生命、護甲與彈藥。',
      },
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
    // Someone playing it from the Play page: a game of their own, on this whole screen.
    const input = (ctx as { input?: PlayInput }).input;
    // Every screen showing this WAD's demos now shares one game (a stack shows one picture).
    const game = input
      ? await SharedGame.join(`${wad.path}#play`, async () => Engine.start({ wad: wad.path, args: await playArgs(wad.path) }))
      : await SharedGame.join(wad.path, () => Engine.start({ wad: wad.path }));
    const { panels, row: rowOption } = input ? { panels: 1, row: 1 } : stackOf(ctx.options);
    if (input) {
      input.on((e) => {
        const key = PAD_TO_DOOM[e.key];
        if (key !== undefined) game.key(e.pressed, key);
      });
      say(`${wad.name}: a game being played from the Play page`);
    } else say(panels > 1 ? `playing the demos of ${wad.name}, row ${rowOption} of a stack of ${panels}` : `playing the demos of ${wad.name}`);
    const small = ctx.canvas.createCanvas(game.engine.width, game.engine.height);
    const sg = small.getContext('2d');
    const image = sg.createImageData(game.engine.width, game.engine.height);
    // The game at 4:3 on the whole stack; this screen paints its own strip of it.
    const view = viewport(ctx.width, ctx.height * panels);
    const shift = (rowOption - 1) * ctx.height;
    const hud = ctx.options.showStats && panels === 1 ? sides(ctx.width, ctx.height, view) : null;
    let left = false;
    return {
      // Played: for as long as someone presses buttons (Kiosko ends it after a minute without).
      frames: input ? Infinity : MAX_FRAMES,
      async draw(g, i) {
        // Game time is wall time: when the panel can't keep up, the game
        // skips frames rather than going slow.
        const f = await game.frame(Date.now());
        image.data.set(f.pixels);
        sg.putImageData(image, 0, 0);
        g.fillStyle = hud ? ctx.theme.colors.bg : '#000';
        g.fillRect(0, 0, ctx.width, ctx.height);
        g.imageSmoothingEnabled = false;
        g.drawImage(small, view.x, view.y - shift, view.w, view.h);
        if (hud) drawHud(g, ctx.theme, ctx.t, f.state, hud, wad.name);
        if (i >= MAX_FRAMES - 1 && !left) {
          left = true;
          game.leave();
        }
      },
    };
  },
});

export default definePlugin({
  id: 'doom',
  name: { en: 'Doom', es: 'Doom', de: 'Doom', 'zh-Hans': 'Doom', 'zh-Hant': 'Doom' },
  version: '0.2.0',
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
  languages: ['en', 'es', 'de', 'zh-Hant', 'zh-Hans'],
  permissions: {
    network: ['github.com', 'release-assets.githubusercontent.com'],
    exec: ['node'],
    files: ['user'],
  },
  interludes: [attract],
});
