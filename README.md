# ZX Spectrum 48K / + / 128K emulator

A ZX Spectrum 48K, Spectrum+ and 128K emulator in plain JavaScript that runs in the browser, with no build step and no dependencies.

## Run

```bash
node serve.js
```

Then open http://localhost:8048 (add `?machine=plus` or `?machine=128` to start on another model). Opening `index.html` directly also works: the ROMs then come from `js/rom48.js` and `js/rom128.js`.

**ROMs:** the original ROMs are in `roms/48.rom` (16,384 bytes) and `roms/128.rom` (32,768 bytes: the 128 editor ROM followed by its 48 BASIC ROM); Amstrad allows them to be distributed with emulators. They are kept in the browser's local storage once loaded.

**The desk:** there are no ordinary buttons; every control is a piece of 80s hardware. Hover over one for a label.

- TV channels 1-3 pick the ZX Spectrum 48K, the Spectrum+ (a 48K in the Spectrum+ case) or the 128K; the choice is remembered. Loading a 128K snapshot switches to the 128K by itself. ZOOM (or a double-click on the picture) is full screen; POWER pauses.
- The Datacorder: STOP/EJECT opens a tape, snapshot or ROM; PLAY, REW, FF (next block), PAUSE; the counter and the tape on the reels follow the tape. The SPEED switch is NORMAL (real time), FAST (full speed while the tape plays) or INSTANT (ROM trap). AUTO LOAD resets and starts the tape on insert. Click the cassette to see its blocks.
- The reset button is on the side of the computer.
- Multiface One: the red button freezes the machine and shows its menu on the TV screen, in the Spectrum's font: SAVE (.SNA download), LOAD, TURBO, RESET, RETURN.
- The joystick: click it to plug it in on the arrow keys (Left Alt = fire); each click (or F10) changes the kind, shown on its base: Kempston, Sinclair (Interface 2, keys 6-0), Cursor (keys 5-8, fire 0), then unplugged.
- The manual: instructions, the PC keys and the settings.
- Shortcuts on the function keys: F1 manual, F2 software catalogue, F3 open a file, F4 Multiface, F6 tape play/stop, F7 rewind, F8 reset, F9 tape speed, F10 joystick, F11 full screen, Pause pauses. Volume and picture: PgUp/PgDn (or Num + -) volume, Home (or Num *) sound off/on, End (or Num /) picture: colour, black & white, green screen. The mouse wheel over the TV sets the volume (with Shift, the colour); clicking the words VOLUME and COLOUR mutes and changes the picture. The TV remembers these settings.
- On a phone or tablet, plugging in the joystick shows a touch stick (left thumb) and FIRE (right thumb). A real joystick or gamepad (USB or Bluetooth, through the Gamepad API) works as the chosen kind and hides the touch stick: press one of its buttons first so the browser sees it.
- Saving, as in 1982: press REC (F5), then SAVE from BASIC or a game's save option; it records onto a tape of your own on the rack ("<game> saves", or "My programs" after a reset). If REC is not pressed the screen asks; when a LOAD finds nothing in the recorder, the screen offers the rack's tapes. Works in full screen too.
- The cassette rack holds your 8 tapes, kept in the browser so they work offline: catalogue downloads, files you open and Multiface saves go onto it (when it is full the TV asks which tape makes room); MY TAPES lists them and saves or loads a `.zxtapes` backup of the whole rack. An empty place on the rack (or F2, or the empty cassette window) opens a software catalogue on the TV, drawn in the Spectrum's own font like the 128's menu (type, arrows or CAPS SHIFT+5-8, ENTER, DELETE, BREAK, or click): it searches ZXDB through the [ZXInfo API](https://api.zxinfo.dk/v5/) and loads titles whose makers allow distribution straight from the World of Spectrum mirror on archive.org. `?find=<title>` in the address opens it with a search. Titles added after 2017 are listed but cannot be downloaded from a web page yet.

On a PC the TV stands on the computer with the gadgets and recorder beside it; on a phone in landscape the TV sits beside the keyboard; in portrait everything is stacked.

## Look and feel

The picture runs inside an 80s wood-cabinet colour TV with a CRT look: scanlines, a curved and vignetted glass, power on/off animation, static on channels 2-6, and VOLUME and COLOUR knobs (drag or scroll; COLOUR at minimum gives a black-and-white set).
Below it sits the original rubber-key 48K keyboard with all its legends, or the Spectrum+ keyboard in either the black Spectrum+ case or the Spectrum 128's case with its heatsink and 128K badge (its extra keys such as DELETE, EDIT and the arrows press the two 48K keys they stand for). The keys can be clicked or tapped and light up when pressed from the PC keyboard; a click on CAPS SHIFT or SYMBOL SHIFT holds it for the next key.
Tapes go in the cassette recorder beside it, whose reels turn while the tape plays.

## Features

- Z80 core: all documented and undocumented opcodes (IXh/IXl, SLL, DDCB register copies), undocumented flag bits 3/5, IM 0/1/2, HALT, EI delay, per-instruction T-state counts.
- 128K: memory paging through port 0x7FFD (eight RAM banks, two ROMs, shadow screen, paging lock), 70,908 T-states per frame, AY-3-8912 sound chip (three tones, noise, envelopes).
- ULA: 69,888 T-states per frame (48K), 50 Hz interrupt, border changes drawn at their T-state (loading stripes), FLASH, BRIGHT.
- Keyboard with PC mappings (see the manual), cursor keys or Kempston joystick on the arrows.
- Beeper sound through Web Audio, plus tape noise while loading.
- Tapes: `.TAP` and `.TZX` (standard, turbo, pure tone, pulses, pure data, direct recording, pauses, loops).
  Standard blocks load instantly through a ROM trap at `LD-BYTES`; turbo and custom loaders play the tape in real time, run at full speed by default.
  On insert, the machine resets and types `LOAD ""` (on the 128K it picks Tape Loader from the start-up menu).
- Snapshots: load `.SNA` and `.Z80` (v1/v2/v3) for the 48K and 128K, save `.SNA` of either.

Not yet: 128K models and AY sound, memory/IO contention (some timing-critical demos and multicolour effects are off), and beam-racing paper rendering (the paper is drawn once per frame).

## Files

| File | Purpose |
|---|---|
| `index.html` | The page: the desk, the TV, the gadgets, the recorder and the manual's text |
| `js/z80.js` | Z80 CPU: all documented and undocumented opcodes and flags |
| `js/spectrum.js` | The 48K and 128K machines: memory paging, ULA (video, keyboard, beeper, EAR), tape trap, snapshots |
| `js/ay.js` | AY-3-8912 sound chip of the 128K: three tones, noise and envelopes |
| `js/tape.js` | TAP/TZX parsing into an EAR pulse stream, plus the standard blocks for instant loading |
| `js/main.js` | Browser front end: picture, PC keyboard, audio output, joysticks and gamepads, file loading, tape controls, function keys |
| `js/retro.js` | The TV (power, channels, knobs, static), the on-screen 48K, Spectrum+ and 128 keyboards, and the manual (fixed-shape pages, one or two at a time, longer chapters flowed onto more pages) |
| `js/screenmenu.js` | Menus drawn on the Spectrum's own screen in the ROM font: the Multiface menu and the catalogue |
| `js/catalogue.js` | Software catalogue: searches ZXDB through the ZXInfo API and loads games from the World of Spectrum mirror on archive.org |
| `js/tapes.js` | The cassette rack: up to 8 tapes kept in the browser (IndexedDB), recording SAVEs, `.zxtapes` backups |
| `js/textfix.js` | Undoes the text enlargement of in-app browsers (Messenger and others) |
| `js/rom48.js`, `js/rom128.js` | The ROMs as scripts, so `index.html` also works opened straight from disk |
| `roms/48.rom`, `roms/128.rom` | The original ROMs |
| `css/retro.css` | TV, keyboard and cassette recorder styling |
| `css/room.css` | The room's layout for PC, phone in landscape and phone in portrait; the gadgets, the manual, the rack, the touch joystick |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app: offline cache, app details and icons |
| `serve.js` | Tiny static file server: `node serve.js [port]` |
| `installer/` | Windows installer: `build.ps1` makes `dist\ZX-Spectrum-Setup.exe` with IExpress; `install.ps1` / `uninstall.ps1` install for the current user without admin rights |
| `tools/list-basic.js` | Lists the blocks of a TAP/TZX file and prints any BASIC program in it as text |
| `test/sanity.js` | Quick CPU checks: `node test/sanity.js` |
| `test/cpm.js` | CP/M harness for the ZEX exercisers: `node test/cpm.js test/zex/zexall.com` (about 5 minutes) |
| `test/tape-test.js` | Builds `hello.tap` and loads it both instantly and in real time: `node test/tape-test.js` |
| `test/shot.html` | Screenshot helper: shows the page with a tape in (`?state=tape`), the Multiface menu (`menu`), the manual (`manual`) or the catalogue (`catalogue`); `&w=390&h=844` sets the frame size |
| `test/headless.js` | Run a game without a browser and save the screen as BMP |

## Test status

- ZEXDOC and ZEXALL: all 67 groups pass (documented and undocumented flags).
- ROM boots to the copyright screen; BASIC accepts typed input.
- `hello.tap` loads and auto-runs both through the instant ROM trap and through real-time pulse loading (about 10 s emulated, with loading stripes).

## Install it

On https://akisbelibassakis.github.io/zx-spectrum/ Edge and Chrome offer **Install** (the icon at the end of the address bar, or the menu); phones offer **Add to Home screen**. The installed app has its own window and icon, works offline (except the catalogue), and updates itself.

## Disclaimer

A fan project, not made, endorsed or supported by Sky, Sinclair Research or Amstrad; ZX Spectrum and Sinclair are trademarks of their owners. The ROMs are copyright Amstrad, who allow them to be distributed for use with emulators. Games come from the World of Spectrum archive and only titles whose makers allow distribution are offered. Catalogue searches go to [ZXInfo](https://zxinfo.dk); there is no tracking.
