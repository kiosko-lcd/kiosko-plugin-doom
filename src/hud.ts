/**
 * What the game is doing, beside it: on a bar-shaped panel the game takes the
 * middle third and the sides were black. Left, where it is (the map, the
 * level's time, kills, items and secrets found); right, how it goes (health,
 * armour, the weapon and its ammo). In the panel's theme, from the engine's
 * own numbers (STATE). Outside a level (title, intermission, finale) only
 * the game's name.
 */
import type { Graphics, Theme } from '@kiosko/sdk';
import { STATE } from './protocol.ts';

type Box = { x: number; y: number; w: number; h: number };
type Say = (texts: { en: string } & Record<string, string>) => string;

/** gamestate_t (doomdef.h). */
const GS_LEVEL = 0;
/** GameMode_t (d_mode.h): commercial (Doom II and Freedoom Phase 2) names maps MAPxx. */
const COMMERCIAL = 2;

/** Narrower sides than this get nothing: the game alone. */
export const MIN_SIDE = 220;

/** The two boxes beside the game on a `width × height` canvas, or null when there's no room. */
export function sides(width: number, height: number, game: Box): { left: Box; right: Box } | null {
  const pad = Math.round(Math.min(height * 0.08, game.x * 0.08));
  const w = game.x - pad * 2;
  if (w < MIN_SIDE) return null;
  return {
    left: { x: pad, y: pad, w, h: height - pad * 2 },
    right: { x: game.x + game.w + pad, y: pad, w, h: height - pad * 2 },
  };
}

export const mapName = (s: number[]) =>
  s[STATE.gamemode] === COMMERCIAL ? `MAP${String(s[STATE.map]).padStart(2, '0')}` : `E${s[STATE.episode]}M${s[STATE.map]}`;

/** Level time, from tics (35 a second): "1:05". */
export const levelTime = (tics: number) => {
  const s = Math.floor(Math.max(0, tics) / 35);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const WEAPONS: ({ en: string } & Record<string, string>)[] = [
  { en: 'Fist', es: 'Puño', de: 'Faust', 'zh-Hans': '拳头', 'zh-Hant': '拳頭' },
  { en: 'Pistol', es: 'Pistola', de: 'Pistole', 'zh-Hans': '手枪', 'zh-Hant': '手槍' },
  { en: 'Shotgun', es: 'Escopeta', de: 'Schrotflinte', 'zh-Hans': '霰弹枪', 'zh-Hant': '霰彈槍' },
  { en: 'Chaingun', es: 'Ametralladora', de: 'Maschinengewehr', 'zh-Hans': '机枪', 'zh-Hant': '機槍' },
  { en: 'Rocket launcher', es: 'Lanzacohetes', de: 'Raketenwerfer', 'zh-Hans': '火箭筒', 'zh-Hant': '火箭筒' },
  { en: 'Plasma rifle', es: 'Rifle de plasma', de: 'Plasmagewehr', 'zh-Hans': '等离子枪', 'zh-Hant': '電漿槍' },
  { en: 'BFG', es: 'BFG', de: 'BFG', 'zh-Hans': 'BFG', 'zh-Hant': 'BFG' },
  { en: 'Chainsaw', es: 'Motosierra', de: 'Kettensäge', 'zh-Hans': '电锯', 'zh-Hant': '電鋸' },
  { en: 'Super shotgun', es: 'Escopeta doble', de: 'Doppelflinte', 'zh-Hans': '双管霰弹枪', 'zh-Hant': '雙管霰彈槍' },
];

const font = (size: number, family: string) => `${Math.round(size)}px "${family}"`;

function label(g: Graphics, theme: Theme, text: string, x: number, y: number, size: number, align: 'left' | 'right' | 'center' = 'left'): void {
  g.font = font(size, theme.fonts.sansBold);
  g.fillStyle = theme.colors.inkFaint;
  g.textAlign = align;
  g.fillText(text.toUpperCase(), x, y);
}

/** A row: name, "n / total" and a bar that fills as they are found. */
function progress(g: Graphics, theme: Theme, name: string, n: number, total: number, b: Box): void {
  const c = theme.colors;
  const size = b.h * 0.42;
  g.textBaseline = 'alphabetic';
  g.font = font(size, theme.fonts.sans);
  g.fillStyle = c.inkDim;
  g.textAlign = 'left';
  g.fillText(name, b.x, b.y + size);
  g.font = font(size, theme.fonts.monoBold);
  g.fillStyle = c.ink;
  g.textAlign = 'right';
  g.fillText(total > 0 ? `${n} / ${total}` : `${n}`, b.x + b.w, b.y + size);
  const barY = b.y + size * 1.45;
  const barH = Math.max(3, b.h * 0.12);
  g.fillStyle = c.surfaceEdge;
  g.fillRect(b.x, barY, b.w, barH);
  if (total > 0) {
    g.fillStyle = n >= total ? c.ok : c.accent;
    g.fillRect(b.x, barY, (b.w * Math.min(n, total)) / total, barH);
  }
}

/** Paints both sides. `wad` names the game outside a level. */
export function drawHud(g: Graphics, theme: Theme, say: Say, state: number[], box: { left: Box; right: Box }, wad: string): void {
  const c = theme.colors;
  const { left: L, right: R } = box;
  g.save();
  g.textBaseline = 'alphabetic';
  if (state[STATE.gamestate] !== GS_LEVEL) {
    // Title screens, intermission, finale: just what is playing.
    const size = L.h * 0.09;
    label(g, theme, say({ en: 'Now playing', es: 'En pantalla', de: 'Läuft gerade', 'zh-Hans': '正在播放', 'zh-Hant': '正在播放' }), L.x, L.y + L.h / 2 - size * 0.6, size * 0.6);
    g.font = font(size, theme.fonts.sansBold);
    g.fillStyle = c.inkDim;
    g.textAlign = 'left';
    g.fillText(wad, L.x, L.y + L.h / 2 + size * 0.7, L.w);
    g.restore();
    return;
  }

  // Left: where.
  const big = L.h * 0.3;
  label(g, theme, say({ en: 'Map', es: 'Mapa', de: 'Karte', 'zh-Hans': '地图', 'zh-Hant': '地圖' }), L.x, L.y + big * 0.32, big * 0.22);
  g.font = font(big, theme.fonts.monoBold);
  g.fillStyle = c.ink;
  g.textAlign = 'left';
  g.fillText(mapName(state), L.x, L.y + big * 1.2);
  g.font = font(big * 0.42, theme.fonts.mono);
  g.fillStyle = c.inkDim;
  g.textAlign = 'right';
  g.fillText(levelTime(state[STATE.leveltime]!), L.x + L.w, L.y + big * 1.2);
  const rows: [string, number, number][] = [
    [say({ en: 'Kills', es: 'Enemigos', de: 'Gegner', 'zh-Hans': '击杀', 'zh-Hant': '擊殺' }), state[STATE.kills]!, state[STATE.totalKills]!],
    [say({ en: 'Items', es: 'Objetos', de: 'Gegenstände', 'zh-Hans': '物品', 'zh-Hant': '物品' }), state[STATE.items]!, state[STATE.totalItems]!],
    [say({ en: 'Secrets', es: 'Secretos', de: 'Geheimnisse', 'zh-Hans': '秘密', 'zh-Hant': '秘密' }), state[STATE.secrets]!, state[STATE.totalSecrets]!],
  ];
  const top = L.y + big * 1.55;
  const rowH = (L.y + L.h - top) / rows.length;
  rows.forEach(([name, n, total], i) => progress(g, theme, name, n, total, { x: L.x, y: top + rowH * i, w: L.w, h: rowH * 0.92 }));

  // Right: how it goes.
  const health = state[STATE.health]!;
  const healthColor = health <= 25 ? c.alert : health <= 50 ? c.warn : c.ink;
  const hs = R.h * 0.44;
  label(g, theme, say({ en: 'Health', es: 'Salud', de: 'Gesundheit', 'zh-Hans': '生命', 'zh-Hant': '生命' }), R.x + R.w, R.y + hs * 0.22, hs * 0.16, 'right');
  g.font = font(hs, theme.fonts.monoBold);
  g.fillStyle = healthColor;
  g.textAlign = 'right';
  g.fillText(`${health}%`, R.x + R.w, R.y + hs * 1.12);
  const small = R.h * 0.2;
  const y2 = R.y + R.h - small * 0.25;
  // Armour, bottom left; the weapon and its ammo, bottom right.
  label(g, theme, say({ en: 'Armour', es: 'Armadura', de: 'Rüstung', 'zh-Hans': '护甲', 'zh-Hant': '護甲' }), R.x, y2 - small * 1.05, small * 0.36);
  g.font = font(small, theme.fonts.monoBold);
  g.fillStyle = c.ink;
  g.textAlign = 'left';
  g.fillText(`${state[STATE.armor]}%`, R.x, y2);
  const weapon = WEAPONS[state[STATE.weapon]!];
  const ammo = state[STATE.ammo]!;
  if (weapon) label(g, theme, say(weapon), R.x + R.w, y2 - small * 1.05, small * 0.36, 'right');
  g.font = font(small, theme.fonts.monoBold);
  g.fillStyle = ammo >= 0 && ammo <= 10 ? c.warn : c.ink;
  g.textAlign = 'right';
  g.fillText(ammo >= 0 ? String(ammo) : '∞', R.x + R.w, y2);
  g.restore();
}
