# ZX Spectrum 48K emulator

A ZX Spectrum 48K emulator in plain JavaScript that runs in the browser, with no build step and no dependencies.

## Run

```bash
node serve.js
```

Then open http://localhost:8048. Opening `index.html` directly also works, but then the ROM can't be fetched from `roms/`.

**ROM:** the original 48K ROM is in `roms/48.rom` (16,384 bytes; Amstrad allows it to be distributed with emulators) and is fetched when the folder is served over HTTP. When `index.html` is opened directly, open/drop the ROM once; it is kept in the browser's local storage after that.

## Look and feel

The picture runs inside an 80s wood-cabinet colour TV with a CRT look: scanlines, a curved and vignetted glass, power on/off animation, static on channels 2-6, and VOLUME and COLOUR knobs (drag or scroll; COLOUR at minimum gives a black-and-white set).
Below it sits the original rubber-key 48K keyboard with all its legends. The keys can be clicked or tapped and light up when pressed from the PC keyboard; a click on CAPS SHIFT or SYMBOL SHIFT holds it for the next key.
Tapes go in the cassette recorder beside it, whose reels turn while the tape plays.

## Features

- Z80 core: all documented and undocumented opcodes (IXh/IXl, SLL, DDCB register copies), undocumented flag bits 3/5, IM 0/1/2, HALT, EI delay, per-instruction T-state counts.
- ULA: 69,888 T-states per frame, 50 Hz interrupt, border changes drawn at their T-state (loading stripes), FLASH, BRIGHT.
- Keyboard with PC mappings (see the Controls panel), cursor keys or Kempston joystick on the arrows.
- Beeper sound through Web Audio, plus tape noise while loading.
- Tapes: `.TAP` and `.TZX` (standard, turbo, pure tone, pulses, pure data, direct recording, pauses, loops).
  Standard blocks load instantly through a ROM trap at `LD-BYTES`; turbo and custom loaders play the tape in real time, run at full speed by default.
  On insert, the machine resets and types `LOAD ""`.
- Snapshots: load `.SNA` and `.Z80` (v1/v2/v3, 48K), save `.SNA`.

Not yet: 128K models and AY sound, memory/IO contention (some timing-critical demos and multicolour effects are off), and beam-racing paper rendering (the paper is drawn once per frame).

## Files

| File | Purpose |
|---|---|
| `js/z80.js` | Z80 CPU |
| `js/spectrum.js` | 48K machine: memory, ULA, video, keyboard, audio, tape trap, snapshots |
| `js/tape.js` | TAP/TZX parsing into an EAR pulse stream |
| `js/main.js` | Browser front end: input, audio output, file loading, tape controls |
| `js/retro.js` | TV (power, channels, knobs) and the on-screen 48K keyboard |
| `css/retro.css` | TV, keyboard and cassette recorder styling |
| `test/sanity.js` | Quick CPU checks: `node test/sanity.js` |
| `test/cpm.js` | CP/M harness for the ZEX exercisers: `node test/cpm.js test/zex/zexall.com` (about 5 minutes) |
| `test/tape-test.js` | Builds `hello.tap` and loads it both instantly and in real time: `node test/tape-test.js` |
| `test/headless.js` | Run a game without a browser and save the screen as BMP |

## Test status

- ZEXDOC and ZEXALL: all 67 groups pass (documented and undocumented flags).
- ROM boots to the copyright screen; BASIC accepts typed input.
- `hello.tap` loads and auto-runs both through the instant ROM trap and through real-time pulse loading (about 10 s emulated, with loading stripes).
