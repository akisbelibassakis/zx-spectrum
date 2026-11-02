// Minimal CP/M environment for running Z80 test programs such as zexdoc.com / zexall.com.
// Usage: node test/cpm.js <program.com>
'use strict';
const fs = require('fs');
const { Z80 } = require('../js/z80.js');

const mem = new Uint8Array(65536);
const bus = {
  read: a => mem[a], write: (a, v) => { mem[a] = v; },
  input: () => 0xff, output: () => {},
};
const cpu = new Z80(bus);
mem.set(fs.readFileSync(process.argv[2]), 0x100);
mem[0x0005] = 0xc9;          // BDOS entry: RET (calls are intercepted below)
mem[0x0006] = 0x00; mem[0x0007] = 0xf0; // top of TPA for programs that read it
cpu.pc = 0x100; cpu.sp = 0xf000;

let out = '';
const flush = () => { if (out) { process.stdout.write(out); out = ''; } };
const t0 = Date.now();
for (;;) {
  if (cpu.pc === 0x0000) break;
  if (cpu.pc === 0x0005) {
    if (cpu.c === 2) out += String.fromCharCode(cpu.e);
    else if (cpu.c === 9) { for (let a = cpu.de; mem[a] !== 0x24; a = (a + 1) & 0xffff) out += String.fromCharCode(mem[a]); }
    if (out.includes('\n')) flush();
  }
  cpu.step();
}
flush();
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${cpu.tstates} T-states`);
