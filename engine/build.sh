#!/bin/sh
# Builds engine/build/doom.mjs (the engine, WASM inlined) from the vendored
# doomgeneric sources and engine/kiosko.c, with Emscripten in Docker: nothing
# to install. The result is committed, so `npm run build` needs no Docker.
#
#   engine/build.sh            (EMSDK_IMAGE=emscripten/emsdk:<version> to change it)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
image=${EMSDK_IMAGE:-emscripten/emsdk:4.0.20}

# The engine's own sources, as its Makefile lists them (minus the platform files).
SRC="dummy am_map doomdef doomstat dstrings d_event d_items d_iwad d_loop d_main d_mode d_net f_finale f_wipe g_game hu_lib hu_stuff info i_cdmus i_endoom i_joystick i_scale i_sound i_system i_timer memio m_argv m_bbox m_cheat m_config m_controls m_fixed m_menu m_misc m_random p_ceilng p_doors p_enemy p_floor p_inter p_lights p_map p_maputl p_mobj p_plats p_pspr p_saveg p_setup p_sight p_spec p_switch p_telept p_tick p_user r_bsp r_data r_draw r_main r_plane r_segs r_sky r_things sha1 sounds statdump st_lib st_stuff s_sound tables v_video wi_stuff w_checksum w_file w_main w_wad z_zone w_file_stdc i_input i_video doomgeneric"
files=""
for s in $SRC; do files="$files doomgeneric/$s.c"; done

mkdir -p "$here/build"
docker run --rm --network none -v "$here:/src" -w /src "$image" \
  emcc -O2 -w \
    -DNORMALUNIX -DLINUX -D_DEFAULT_SOURCE -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200 \
    -Idoomgeneric $files kiosko.c \
    --no-entry -lnodefs.js \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node -sSINGLE_FILE=1 \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=1048576 \
    -sEXIT_RUNTIME=0 \
    -sEXPORTED_FUNCTIONS=_kiosko_start,_kiosko_set_time,_kiosko_time,_kiosko_frames,_kiosko_key,_kiosko_screen,_kiosko_width,_kiosko_height,_kiosko_state,_doomgeneric_Tick,_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=FS,NODEFS,HEAPU8,HEAP32,stringToNewUTF8 \
    -o build/doom.mjs
ls -l "$here/build/doom.mjs"
