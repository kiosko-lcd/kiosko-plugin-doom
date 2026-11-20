// doomgeneric for Kiosko: no window, no sound and no real clock.
//
// The host (src/engine-child.ts) owns time: it says what the time is with
// kiosko_set_time() and then calls doomgeneric_Tick(), which runs every game
// tic due by then (35 per second) and paints the frame. When no tic is due
// yet, the engine "sleeps", and sleeping only moves this clock forward, so a
// tick never blocks. The frame is read straight from DG_ScreenBuffer.
//
// Copyright (C) 2026 Loksly. GPL-2.0-or-later, like the engine around it.

#include <emscripten.h>
#include <string.h>

#include "doomgeneric.h"
#include "doomkeys.h"
#include "doomstat.h"
#include "d_player.h"

static uint32_t now_ms = 0;
static uint32_t frames = 0;

#define KEYQUEUE_SIZE 64
static unsigned short key_queue[KEYQUEUE_SIZE];
static unsigned int key_read = 0, key_write = 0;

void DG_Init(void) {}

void DG_DrawFrame(void) { frames++; }

void DG_SleepMs(uint32_t ms) { now_ms += ms; }

uint32_t DG_GetTicksMs(void) { return now_ms; }

int DG_GetKey(int *pressed, unsigned char *key)
{
    if (key_read == key_write) return 0;
    unsigned short data = key_queue[key_read];
    key_read = (key_read + 1) % KEYQUEUE_SIZE;
    *pressed = data >> 8;
    *key = data & 0xff;
    return 1;
}

void DG_SetWindowTitle(const char *title) { (void)title; }

// Starts the engine with these arguments ("-iwad /wad/freedoom1.wad" …),
// separated by '\n'. Runs the first tick.
EMSCRIPTEN_KEEPALIVE void kiosko_start(char *args)
{
    static char *argv[32];
    int argc = 0;
    argv[argc++] = "doom";
    for (char *p = args; p && *p && argc < 31;) {
        argv[argc++] = p;
        char *nl = strchr(p, '\n');
        if (!nl) break;
        *nl = 0;
        p = nl + 1;
    }
    argv[argc] = NULL;
    doomgeneric_Create(argc, argv);
}

// The clock never goes back: a time behind the engine's own (it slept past
// it) is ignored.
EMSCRIPTEN_KEEPALIVE void kiosko_set_time(uint32_t ms)
{
    if (ms > now_ms) now_ms = ms;
}

EMSCRIPTEN_KEEPALIVE uint32_t kiosko_time(void) { return now_ms; }

EMSCRIPTEN_KEEPALIVE uint32_t kiosko_frames(void) { return frames; }

EMSCRIPTEN_KEEPALIVE void kiosko_key(int pressed, int key)
{
    unsigned int next = (key_write + 1) % KEYQUEUE_SIZE;
    if (next == key_read) return;  // full: drop it
    key_queue[key_write] = (unsigned short)(((pressed ? 1 : 0) << 8) | (key & 0xff));
    key_write = next;
}

EMSCRIPTEN_KEEPALIVE pixel_t *kiosko_screen(void) { return DG_ScreenBuffer; }

EMSCRIPTEN_KEEPALIVE int kiosko_width(void) { return DOOMGENERIC_RESX; }

EMSCRIPTEN_KEEPALIVE int kiosko_height(void) { return DOOMGENERIC_RESY; }

// What a side panel may show, as 16 ints (see STATE in src/protocol.ts).
EMSCRIPTEN_KEEPALIVE void kiosko_state(int *out)
{
    player_t *p = &players[consoleplayer];
    out[0] = gamestate;
    out[1] = demoplayback;
    out[2] = gameepisode;
    out[3] = gamemap;
    out[4] = leveltime;
    out[5] = p->health;
    out[6] = p->armorpoints;
    out[7] = p->readyweapon;
    out[8] = p->readyweapon < NUMWEAPONS && weaponinfo[p->readyweapon].ammo < NUMAMMO ? p->ammo[weaponinfo[p->readyweapon].ammo] : -1;
    out[9] = p->killcount;
    out[10] = totalkills;
    out[11] = p->itemcount;
    out[12] = totalitems;
    out[13] = p->secretcount;
    out[14] = totalsecret;
    out[15] = gamemode;
}
