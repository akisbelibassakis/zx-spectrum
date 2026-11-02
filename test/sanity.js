// Small hand-assembled checks of common instruction groups. node test/sanity.js
'use strict';
const { Z80 } = require('../js/z80.js');

function run(code, setup, maxSteps = 100000) {
  const mem = new Uint8Array(65536);
  mem.set(code, 0);
  const cpu = new Z80({ read: a => mem[a], write: (a, v) => { mem[a] = v; }, input: () => 0xff, output: () => {} });
  cpu.sp = 0xff00;
  if (setup) setup(cpu, mem);
  for (let i = 0; i < maxSteps && !cpu.halted; i++) cpu.step();
  return { cpu, mem };
}

let fails = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got.toString(16)}${ok ? '' : ' (want ' + want.toString(16) + ')'}`);
}

// sum 1..10 with DJNZ -> 55
let r = run([0x06, 10, 0xaf, 0x80, 0x10, 0xfd, 0x76]);
check('DJNZ sum', r.cpu.a, 55);

// LDIR copy 4 bytes from 0x20 to 0x40
r = run([0x21, 0x20, 0, 0x11, 0x40, 0, 0x01, 4, 0, 0xed, 0xb0, 0x76], (c, m) => m.set([1, 2, 3, 4], 0x20));
check('LDIR', (r.mem[0x40] << 24 | r.mem[0x41] << 16 | r.mem[0x42] << 8 | r.mem[0x43]) >>> 0, 0x01020304);
check('LDIR BC', r.cpu.bc, 0);

// CALL/RET and PUSH/POP
r = run([0xcd, 0x10, 0, 0x76, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01, 0x34, 0x12, 0xc5, 0xd1, 0xc9]);
check('CALL/PUSH/POP', r.cpu.de, 0x1234);

// ADD/SUB flags: 0x7f + 1 -> 0x80, overflow + sign + half carry
r = run([0x3e, 0x7f, 0xc6, 0x01, 0x76]);
check('ADD 7F+1', r.cpu.a, 0x80);
check('ADD flags', r.cpu.f, 0x94);
r = run([0x3e, 0x10, 0xd6, 0x20, 0x76]);
check('SUB 10-20', r.cpu.a, 0xf0);
check('SUB flags', r.cpu.f, 0xa3);

// DAA: 0x15 + 0x27 = 0x42 BCD
r = run([0x3e, 0x15, 0xc6, 0x27, 0x27, 0x76]);
check('DAA', r.cpu.a, 0x42);

// IX indexed: LD (IX+5),0x99; LD B,(IX+5); INC (IX+5)
r = run([0xdd, 0x21, 0x00, 0x80, 0xdd, 0x36, 5, 0x99, 0xdd, 0x46, 5, 0xdd, 0x34, 5, 0x76]);
check('LD B,(IX+d)', r.cpu.b, 0x99);
check('INC (IX+d)', r.mem[0x8005], 0x9a);

// IXh/IXl undocumented: LD IXH,0x12 ; LD IXL,0x34
r = run([0xdd, 0x26, 0x12, 0xdd, 0x2e, 0x34, 0x76]);
check('LD IXH/IXL', r.cpu.ix, 0x1234);

// CB: SET 3,(HL); RL C; BIT 7,A
r = run([0x21, 0x00, 0x90, 0xcb, 0xde, 0x0e, 0x81, 0xb7, 0xcb, 0x11, 0x76]);
check('SET 3,(HL)', r.mem[0x9000], 0x08);
check('RL C', r.cpu.c, 0x02);
check('RL C carry', r.cpu.f & 1, 1);

// SBC HL / ADC HL
r = run([0x21, 0x00, 0x10, 0x11, 0x01, 0x00, 0x37, 0xed, 0x52, 0x76]);
check('SBC HL,DE', r.cpu.hl, 0x0ffe);

// IM 1 interrupt
r = run([0xed, 0x56, 0xfb, 0x00, 0x18, 0xfe], null, 10);
r.cpu.interrupt();
check('IM1 interrupt PC', r.cpu.pc, 0x38);

// cycle counts: NOP 4, LD BC,nn 10, LD A,(IX+d) 19
r = run([0x00, 0x01, 0, 0, 0xdd, 0x7e, 0, 0x76], null, 3);
check('T-states', r.cpu.tstates, 33);

console.log(fails ? `${fails} FAILED` : 'All passed');
process.exitCode = fails ? 1 : 0;
