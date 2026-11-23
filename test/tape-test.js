// Builds a small TAP (auto-running BASIC program) and loads it with the ROM trap and in real time.
// node test/tape-test.js [outdir]
'use strict';
const fs = require('fs');
const path = require('path');
const { Spectrum, SCREEN_W, SCREEN_H } = require('../js/spectrum.js');
const { Tape, combineTapes } = require('../js/tape.js');

const outDir = process.argv[2] || '.';

// 10 BORDER 2: PRINT "HELLO FROM TAPE"
const num = n => [...Buffer.from(String(n))].concat([0x0e, 0, 0, n, 0, 0]);
const body = [0xe7, ...num(2), 0x3a, 0xf5, 0x22, ...Buffer.from('HELLO FROM TAPE'), 0x22, 0x0d];
const prog = [0, 10, body.length & 0xff, body.length >> 8, ...body];

function block(bytes) {
  let x = 0;
  for (const b of bytes) x ^= b;
  const full = [...bytes, x];
  return [full.length & 0xff, full.length >> 8, ...full];
}
const header = [0, 0, ...Buffer.from('hello     '), prog.length & 0xff, prog.length >> 8, 10, 0, prog.length & 0xff, prog.length >> 8];
const tap = Uint8Array.from([...block(header), ...block([0xff, ...prog])]);
fs.writeFileSync(path.join(outDir, 'hello.tap'), tap);

const rom = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'roms', '48.rom')));
let failures = 0;
// instant (ROM trap), real time, and "own loader": INSTANT with the blocks marked non-standard, so the ROM's
// loader reads the pulses as a custom loader would, with its edge loops skipped
for (const mode of ['instant', 'realtime', 'own loader']) {
  const fast = mode !== 'realtime';
  const zx = new Spectrum(44100);
  zx.loadROM(rom); zx.reset();
  zx.fastLoad = fast;
  const tape = Tape.fromTAP(tap, 'hello.tap');
  if (mode === 'own loader') for (const b of tape.blocks) b.std = false;
  zx.insertTape(tape);
  for (let i = 0; i < 120; i++) zx.runFrame();
  zx.typeKeys([{ keys: [[6, 3]] }, { keys: [[7, 1], [5, 0]] }, { keys: [[7, 1], [5, 0]] }, { keys: [[6, 0]] }]);
  let f = 0, borders = new Set();
  for (; f < 50 * 30; f++) {
    zx.runFrame();
    for (let i = 1; i < zx.borderEvents.length; i += 2) borders.add(zx.borderEvents[i]);
    if (zx.border === 2 && !zx.tape.playing && zx.tape.atEnd) { for (let k = 0; k < 25; k++) zx.runFrame(); break; }
  }
  // the text is on the third line (row 2), under "Program: hello": read the character cells back from screen memory
  const rom8 = { length: 65536 }; for (let a = 0; a < 65536; a++) rom8[a] = zx.read(a);
  let text = '';
  for (let col = 0; col < 15; col++) {
    let best = '?';
    for (let ch = 32; ch < 128; ch++) {
      let match = true;
      for (let line = 0; line < 8 && match; line++) {
        if (rom8[0x4040 + (line << 8) + col] !== rom8[0x3d00 + (ch - 32) * 8 + line]) match = false;
      }
      if (match) { best = String.fromCharCode(ch); break; }
    }
    text += best;
  }
  const ok = text === 'HELLO FROM TAPE' && zx.border === 2;
  if (!ok) failures++;
  console.log(`${mode.padEnd(10)} load: ${ok ? 'ok' : 'FAIL'} after ${(f / 50).toFixed(1)} s emulated, ` +
    `screen="${text}", border=${zx.border}, border colours seen while loading=${[...borders].sort().join(',')}`);

  const out = path.join(outDir, `tape-${mode.replace(' ', '-')}.bmp`);
  const rowBytes = SCREEN_W * 3, size = 54 + rowBytes * SCREEN_H, bmp = Buffer.alloc(size);
  bmp.write('BM'); bmp.writeUInt32LE(size, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(SCREEN_W, 18); bmp.writeInt32LE(-SCREEN_H, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  for (let i = 0; i < SCREEN_W * SCREEN_H; i++) {
    const c = zx.screen[i];
    bmp[54 + i * 3] = (c >> 16) & 0xff; bmp[55 + i * 3] = (c >> 8) & 0xff; bmp[56 + i * 3] = c & 0xff;
  }
  fs.writeFileSync(out, bmp);
}
// tapes in parts: two files joined, with a select block naming the parts and a stop between them
const check = (what, ok) => { if (!ok) failures++; console.log(`${what}: ${ok ? 'ok' : 'FAIL'}`); };
{
  const joined = Tape.fromTZX(combineTapes([{ name: 'a.tap', bytes: tap }, { name: 'b.tap', bytes: tap }], ['48k', '128k']), 'joined.tzx');
  check('parts', JSON.stringify(joined.parts) === JSON.stringify([{ name: '48k', block: 0 }, { name: '128k', block: 3 }]) && joined.blocks.length === 6);
  joined.playing = true;
  joined.advance(1e9);
  check('the tape stops between parts', !joined.playing && joined.blockIdx === 3);
}
// a stop block keeps the level: the last edge before it still counts (TZX: 3 pulses of pure data, then "stop the tape")
{
  const tzx = Uint8Array.from([...Buffer.from('ZXTape!'), 0x1a, 1, 20, 0x14, 100, 0, 200, 0, 3, 0, 0, 1, 0, 0, 0xa0, 0x20, 0, 0]);
  const t = Tape.fromTZX(tzx, 'stop.tzx');
  t.playing = true;
  t.advance(1e6);
  check('stop block keeps the last edge', !t.playing && t.ear === 0 && t.atEnd);
  const t2 = Tape.fromTZX(Uint8Array.from([...Buffer.from('ZXTape!'), 0x1a, 1, 20, 0x13, 3, 100, 0, 100, 0, 100, 0, 0x20, 0, 0]), 'stop2.tzx');
  t2.playing = true;
  t2.advance(1e6);
  check('stop block after an odd number of pulses', !t2.playing && t2.ear === 1);
}
process.exitCode = failures ? 1 : 0;
