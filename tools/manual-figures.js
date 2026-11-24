// The TV screens drawn in the manual (manual/fig-*.png), taken from the emulator itself: a 48K is switched on, keys
// are typed as the manual tells you, and the screen is saved in black and white, with flashing cursors shown
// inverted (white on black) as the 1982 booklet prints them.  node tools/manual-figures.js
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { Spectrum } = require('../js/spectrum.js');

const OUT = path.join(__dirname, '..', 'manual');
const K = { CAPS: [0, 0], Z: [0, 1], X: [0, 2], C: [0, 3], V: [0, 4], A: [1, 0], S: [1, 1], D: [1, 2], F: [1, 3], G: [1, 4], Q: [2, 0], W: [2, 1], E: [2, 2], R: [2, 3], T: [2, 4],
  1: [3, 0], 2: [3, 1], 3: [3, 2], 4: [3, 3], 5: [3, 4], 0: [4, 0], 9: [4, 1], 8: [4, 2], 7: [4, 3], 6: [4, 4], P: [5, 0], O: [5, 1], I: [5, 2], U: [5, 3], Y: [5, 4],
  ENTER: [6, 0], L: [6, 1], K: [6, 2], J: [6, 3], H: [6, 4], SPACE: [7, 0], SYM: [7, 1], M: [7, 2], N: [7, 3], B: [7, 4] };
// keys as the manual writes them: "SYM+P" with SYMBOL SHIFT, "CAPS+H" a capital, "EXT" extended mode, "_" a space
const press = spec => spec.split(' ').filter(Boolean).map(k => ({ keys: k === 'EXT' ? [K.CAPS, K.SYM] : k === '_' ? [K.SPACE] : k.split('+').map(x => K[x]) }));

function machine() {
  const zx = new Spectrum(44100);
  zx.setMachine(zx.loadROM(new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'roms', '48.rom')))));
  for (let i = 0; i < 120; i++) zx.runFrame();
  return zx;
}
function type(zx, spec, settle = 60) {
  zx.typeKeys(press(spec));
  while (zx.keyQueue.length) zx.runFrame();
  for (let i = 0; i < settle; i++) zx.runFrame();
}

// the 256 x 192 picture as a 1-bit PNG: dark colours black, light ones white; FLASH cells inverted
function save(zx, name) {
  const v = zx.screenBank, w = 256, h = 192, rowBytes = w / 8, raw = Buffer.alloc((rowBytes + 1) * h);
  const dark = c => c < 4; // black, blue, red, magenta
  for (let y = 0; y < h; y++) {
    const pix = ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2), att = 0x1800 + ((y >> 3) << 5);
    raw[y * (rowBytes + 1)] = 0;
    for (let xb = 0; xb < 32; xb++) {
      const a = v[att + xb];
      let bits = v[pix + xb];
      if (a & 0x80) bits ^= 0xff; // a flashing cursor, shown inverted
      let out = 0;
      for (let k = 0; k < 8; k++) {
        const on = (bits >> (7 - k)) & 1, colour = on ? a & 7 : (a >> 3) & 7;
        if (!dark(colour)) out |= 0x80 >> k; // 1 = white in a 1-bit greyscale PNG
      }
      raw[y * (rowBytes + 1) + 1 + xb] = out;
    }
  }
  const crcT = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 1; ih[9] = 0; // 1 bit, greyscale
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
  console.log('manual/' + name + '.png');
}

const HELLO = ['1 0 P SYM+P CAPS+H CAPS+E CAPS+L CAPS+L CAPS+O SYM+P ENTER', '2 0 G 1 0 ENTER'];
fs.mkdirSync(OUT, { recursive: true });
let zx;
zx = machine(); save(zx, 'fig-copyright');                                            // switched on
zx = machine(); type(zx, 'J SYM+P SYM+P'); save(zx, 'fig-load');                      // LOAD "" typed
zx = machine(); type(zx, 'P'); save(zx, 'fig-print');                                 // the P key: PRINT
zx = machine(); HELLO.forEach(l => type(zx, l)); type(zx, 'S SYM+P H E L L O SYM+P ENTER'); save(zx, 'fig-save'); // SAVE "hello"
zx = machine();
type(zx, '1 0 EXT SYM+H 1 2 8 SYM+N 8 8 SYM+N 6 0 ENTER');                             // CIRCLE 128,88,60
type(zx, '2 0 Q 0 SYM+N 0 SYM+Z W 2 5 5 SYM+N 1 7 5 ENTER');                           // PLOT 0,0: DRAW 255,175
type(zx, 'R ENTER', 100); save(zx, 'fig-circle');
