// Headless runner: node test/headless.js <file.z80|.sna|.tap|.tzx|-> [frames] [rom] [out.bmp]
// A 32K ROM (roms/128.rom) runs the 128K; '-' as the file just boots the machine.
// Runs the emulator without a browser and writes the final screen as a BMP.
'use strict';
const fs = require('fs');
const path = require('path');
const { Spectrum, SCREEN_W, SCREEN_H } = require('../js/spectrum.js');
const { Tape } = require('../js/tape.js');

const [file, framesArg, romArg, outArg] = process.argv.slice(2);
const frames = +(framesArg || 100);
const zx = new Spectrum(44100);
const rom = romArg || path.join(__dirname, '..', 'roms', '48.rom');
if (fs.existsSync(rom)) zx.setMachine(zx.loadROM(new Uint8Array(fs.readFileSync(rom))));
else console.log('No ROM found - running with empty ROM area');

if (file && file !== '-') {
  const data = new Uint8Array(fs.readFileSync(file));
  const ext = path.extname(file).toLowerCase();
  if (ext === '.z80') zx.loadZ80(data);
  else if (ext === '.sna') zx.loadSNA(data);
  else if (ext === '.tap' || ext === '.tzx') {
    zx.insertTape(ext === '.tap' ? Tape.fromTAP(data) : Tape.fromTZX(data));
    for (let i = 0; i < 120; i++) zx.runFrame();
    // 48K: LOAD "" ENTER; 128K: ENTER on the menu's Tape Loader
    if (zx.is128) zx.typeKeys([{ keys: [[6, 0]] }]);
    else zx.typeKeys([{ keys: [[6, 3]] }, { keys: [[7, 1], [5, 0]] }, { keys: [[7, 1], [5, 0]] }, { keys: [[6, 0]] }]);
    console.log('Tape blocks:', zx.tape.blocks.map(b => b.desc).join(' | '));
  }
}

const t0 = Date.now();
for (let i = 0; i < frames; i++) zx.runFrame();
const ms = Date.now() - t0;
console.log(`${frames} frames in ${ms} ms (${(frames / 50 / (ms / 1000)).toFixed(1)}x real time), PC=${zx.cpu.pc.toString(16)}`);

// 24-bit BMP
const out = outArg || 'screen.bmp';
const rowBytes = SCREEN_W * 3, size = 54 + rowBytes * SCREEN_H;
const bmp = Buffer.alloc(size);
bmp.write('BM'); bmp.writeUInt32LE(size, 2); bmp.writeUInt32LE(54, 10);
bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(SCREEN_W, 18); bmp.writeInt32LE(-SCREEN_H, 22);
bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(rowBytes * SCREEN_H, 34);
for (let i = 0; i < SCREEN_W * SCREEN_H; i++) {
  const c = zx.screen[i];
  bmp[54 + i * 3] = (c >> 16) & 0xff; bmp[55 + i * 3] = (c >> 8) & 0xff; bmp[56 + i * 3] = c & 0xff;
}
fs.writeFileSync(out, bmp);
console.log('Wrote', out);
