// Builds a small TAP (auto-running BASIC program) and loads it with the ROM trap and in real time.
// node test/tape-test.js [outdir]
'use strict';
const fs = require('fs');
const path = require('path');
const { Spectrum, SCREEN_W, SCREEN_H } = require('../js/spectrum.js');
const { Tape } = require('../js/tape.js');

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
for (const fast of [true, false]) {
  const zx = new Spectrum(44100);
  zx.loadROM(rom); zx.reset();
  zx.fastLoad = fast;
  zx.insertTape(Tape.fromTAP(tap, 'hello.tap'));
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
  console.log(`${fast ? 'instant ' : 'realtime'} load: ${ok ? 'ok' : 'FAIL'} after ${(f / 50).toFixed(1)} s emulated, ` +
    `screen="${text}", border=${zx.border}, border colours seen while loading=${[...borders].sort().join(',')}`);

  const out = path.join(outDir, `tape-${fast ? 'instant' : 'realtime'}.bmp`);
  const rowBytes = SCREEN_W * 3, size = 54 + rowBytes * SCREEN_H, bmp = Buffer.alloc(size);
  bmp.write('BM'); bmp.writeUInt32LE(size, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(SCREEN_W, 18); bmp.writeInt32LE(-SCREEN_H, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  for (let i = 0; i < SCREEN_W * SCREEN_H; i++) {
    const c = zx.screen[i];
    bmp[54 + i * 3] = (c >> 16) & 0xff; bmp[55 + i * 3] = (c >> 8) & 0xff; bmp[56 + i * 3] = c & 0xff;
  }
  fs.writeFileSync(out, bmp);
}
process.exitCode = failures ? 1 : 0;
