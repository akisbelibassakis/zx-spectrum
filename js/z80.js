// Z80 CPU core. Documented + undocumented opcodes and flags (incl. bits 3/5).
// The bus object supplies read(addr), write(addr, v), input(port), output(port, v).
'use strict';

const FC = 0x01, FN = 0x02, FP = 0x04, F3 = 0x08, FH = 0x10, F5 = 0x20, FZ = 0x40, FS = 0x80;

const sz53 = new Uint8Array(256), parity = new Uint8Array(256), sz53p = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  sz53[i] = i & (F3 | F5 | FS);
  let p = 0;
  for (let j = i; j; j >>= 1) p ^= j & 1;
  parity[i] = p ? 0 : FP;
  sz53p[i] = sz53[i] | parity[i];
}
sz53[0] |= FZ;
sz53p[0] |= FZ;

const hcAdd = [0, FH, FH, FH, 0, 0, 0, FH];
const hcSub = [0, 0, FH, 0, FH, 0, FH, FH];
const ovAdd = [0, 0, 0, FP, FP, 0, 0, 0];
const ovSub = [0, FP, 0, 0, 0, 0, FP, 0];

const IM_TABLE = [0, 0, 1, 2, 0, 0, 1, 2];

class Z80 {
  constructor(bus) {
    this.bus = bus;
    this.trap = null; // optional (cpu) => boolean, called before each instruction fetch
    this.reset();
  }

  reset() {
    this.a = 0xff; this.f = 0xff;
    this.b = 0; this.c = 0; this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.a_ = 0; this.f_ = 0; this.b_ = 0; this.c_ = 0; this.d_ = 0; this.e_ = 0; this.h_ = 0; this.l_ = 0;
    this.ix = 0xffff; this.iy = 0xffff; this.sp = 0xffff; this.pc = 0;
    this.i = 0; this.r = 0;
    this.iff1 = 0; this.iff2 = 0; this.im = 0;
    this.halted = false;
    this.eiDelay = false;
    this.tstates = 0;
  }

  get bc() { return (this.b << 8) | this.c; }
  set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
  get de() { return (this.d << 8) | this.e; }
  set de(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
  get hl() { return (this.h << 8) | this.l; }
  set hl(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
  get af() { return (this.a << 8) | this.f; }
  set af(v) { this.a = (v >> 8) & 0xff; this.f = v & 0xff; }

  // ---- memory helpers ----
  rd(a) { return this.bus.read(a & 0xffff); }
  wr(a, v) { this.bus.write(a & 0xffff, v & 0xff); }
  fetch() { const v = this.bus.read(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetch16() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
  fetchDisp() { const d = this.fetch(); return d < 128 ? d : d - 256; }
  rd16(a) { return this.rd(a) | (this.rd(a + 1) << 8); }
  wr16(a, v) { this.wr(a, v); this.wr(a + 1, v >> 8); }
  push(v) { this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v >> 8); this.sp = (this.sp - 1) & 0xffff; this.wr(this.sp, v); }
  pop() { const v = this.rd16(this.sp); this.sp = (this.sp + 2) & 0xffff; return v; }
  incR() { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f); }

  // ---- register access by 3-bit code (6 = memory, handled by caller) ----
  getR(r) {
    switch (r) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return this.h; case 5: return this.l; case 7: return this.a;
    }
    return 0;
  }
  setR(r, v) {
    switch (r) {
      case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: this.h = v; break; case 5: this.l = v; break; case 7: this.a = v; break;
    }
  }
  // same, but H/L become IXh/IXl or IYh/IYl under a DD/FD prefix
  getRX(r, idx) {
    if (idx && (r === 4 || r === 5)) {
      const x = idx === 1 ? this.ix : this.iy;
      return r === 4 ? x >> 8 : x & 0xff;
    }
    return this.getR(r);
  }
  setRX(r, v, idx) {
    if (idx && (r === 4 || r === 5)) {
      let x = idx === 1 ? this.ix : this.iy;
      x = r === 4 ? (x & 0x00ff) | (v << 8) : (x & 0xff00) | v;
      if (idx === 1) this.ix = x; else this.iy = x;
      return;
    }
    this.setR(r, v);
  }
  getHL(idx) { return idx === 0 ? this.hl : idx === 1 ? this.ix : this.iy; }
  setHL(idx, v) { v &= 0xffff; if (idx === 0) this.hl = v; else if (idx === 1) this.ix = v; else this.iy = v; }
  getRP(p, idx) {
    switch (p) { case 0: return this.bc; case 1: return this.de; case 2: return this.getHL(idx); default: return this.sp; }
  }
  setRP(p, v, idx) {
    v &= 0xffff;
    switch (p) { case 0: this.bc = v; break; case 1: this.de = v; break; case 2: this.setHL(idx, v); break; default: this.sp = v; }
  }
  getRP2(p, idx) { return p === 3 ? this.af : this.getRP(p, idx); }
  setRP2(p, v, idx) { if (p === 3) this.af = v & 0xffff; else this.setRP(p, v, idx); }

  cond(y) {
    switch (y) {
      case 0: return !(this.f & FZ); case 1: return !!(this.f & FZ);
      case 2: return !(this.f & FC); case 3: return !!(this.f & FC);
      case 4: return !(this.f & FP); case 5: return !!(this.f & FP);
      case 6: return !(this.f & FS); default: return !!(this.f & FS);
    }
  }

  // ---- ALU ----
  add8(v, carry) {
    const t = this.a + v + carry;
    const lk = ((this.a & 0x88) >> 3) | ((v & 0x88) >> 2) | ((t & 0x88) >> 1);
    this.a = t & 0xff;
    this.f = (t & 0x100 ? FC : 0) | hcAdd[lk & 7] | ovAdd[lk >> 4] | sz53[this.a];
  }
  sub8(v, carry) {
    const t = this.a - v - carry;
    const lk = ((this.a & 0x88) >> 3) | ((v & 0x88) >> 2) | ((t & 0x88) >> 1);
    this.a = t & 0xff;
    this.f = (t & 0x100 ? FC : 0) | FN | hcSub[lk & 7] | ovSub[lk >> 4] | sz53[this.a];
  }
  cp8(v) {
    const t = this.a - v;
    const lk = ((this.a & 0x88) >> 3) | ((v & 0x88) >> 2) | ((t & 0x88) >> 1);
    this.f = (t & 0x100 ? FC : (t ? 0 : FZ)) | FN | hcSub[lk & 7] | ovSub[lk >> 4] | (v & (F3 | F5)) | (t & FS);
  }
  alu(op, v) {
    switch (op) {
      case 0: this.add8(v, 0); break;
      case 1: this.add8(v, this.f & FC); break;
      case 2: this.sub8(v, 0); break;
      case 3: this.sub8(v, this.f & FC); break;
      case 4: this.a &= v; this.f = FH | sz53p[this.a]; break;
      case 5: this.a ^= v; this.f = sz53p[this.a]; break;
      case 6: this.a |= v; this.f = sz53p[this.a]; break;
      case 7: this.cp8(v); break;
    }
  }
  inc8(v) {
    v = (v + 1) & 0xff;
    this.f = (this.f & FC) | (v === 0x80 ? FP : 0) | ((v & 0x0f) ? 0 : FH) | sz53[v];
    return v;
  }
  dec8(v) {
    this.f = (this.f & FC) | ((v & 0x0f) ? 0 : FH) | FN;
    v = (v - 1) & 0xff;
    this.f |= (v === 0x7f ? FP : 0) | sz53[v];
    return v;
  }
  add16(a, v) {
    const t = a + v;
    const lk = ((a & 0x0800) >> 11) | ((v & 0x0800) >> 10) | ((t & 0x0800) >> 9);
    this.f = (this.f & (FP | FZ | FS)) | (t & 0x10000 ? FC : 0) | ((t >> 8) & (F3 | F5)) | hcAdd[lk];
    return t & 0xffff;
  }
  adc16(v) {
    const hl = this.hl, t = hl + v + (this.f & FC);
    const lk = ((hl & 0x8800) >> 11) | ((v & 0x8800) >> 10) | ((t & 0x8800) >> 9);
    this.hl = t & 0xffff;
    this.f = (t & 0x10000 ? FC : 0) | ovAdd[lk >> 4] | (this.h & (F3 | F5 | FS)) | hcAdd[lk & 7] | (this.hl ? 0 : FZ);
  }
  sbc16(v) {
    const hl = this.hl, t = hl - v - (this.f & FC);
    const lk = ((hl & 0x8800) >> 11) | ((v & 0x8800) >> 10) | ((t & 0x8800) >> 9);
    this.hl = t & 0xffff;
    this.f = (t & 0x10000 ? FC : 0) | FN | ovSub[lk >> 4] | (this.h & (F3 | F5 | FS)) | hcSub[lk & 7] | (this.hl ? 0 : FZ);
  }
  // CB rotate/shift group
  rot(op, v) {
    let c;
    switch (op) {
      case 0: c = v >> 7; v = ((v << 1) | c) & 0xff; break;               // RLC
      case 1: c = v & 1; v = (v >> 1) | (c << 7); break;                   // RRC
      case 2: c = v >> 7; v = ((v << 1) | (this.f & FC)) & 0xff; break;    // RL
      case 3: c = v & 1; v = (v >> 1) | ((this.f & FC) << 7); break;       // RR
      case 4: c = v >> 7; v = (v << 1) & 0xff; break;                      // SLA
      case 5: c = v & 1; v = (v & 0x80) | (v >> 1); break;                 // SRA
      case 6: c = v >> 7; v = ((v << 1) | 1) & 0xff; break;                // SLL (undocumented)
      default: c = v & 1; v >>= 1; break;                                  // SRL
    }
    this.f = c | sz53p[v];
    return v;
  }
  bit(n, v, xy) {
    this.f = (this.f & FC) | FH | (xy & (F3 | F5));
    if (!(v & (1 << n))) this.f |= FP | FZ;
    if (n === 7 && (v & 0x80)) this.f |= FS;
  }
  daa() {
    let add = 0, carry = this.f & FC;
    if ((this.f & FH) || (this.a & 0x0f) > 9) add = 6;
    if (carry || this.a > 0x99) add |= 0x60;
    if (this.a > 0x99) carry = FC;
    if (this.f & FN) this.sub8(add, 0); else this.add8(add, 0);
    this.f = (this.f & ~(FC | FP)) | carry | parity[this.a];
  }

  // ---- interrupts ----
  interrupt() {
    if (!this.iff1 || this.eiDelay) return 0;
    if (this.halted) { this.halted = false; this.pc = (this.pc + 1) & 0xffff; }
    this.iff1 = this.iff2 = 0;
    this.incR();
    this.push(this.pc);
    if (this.im === 2) {
      this.pc = this.rd16((this.i << 8) | 0xff);
      this.tstates += 19;
      return 19;
    }
    this.pc = 0x38; // IM 0 with 0xFF on the bus behaves as RST 38
    this.tstates += 13;
    return 13;
  }
  nmi() {
    if (this.halted) { this.halted = false; this.pc = (this.pc + 1) & 0xffff; }
    this.iff2 = this.iff1; this.iff1 = 0;
    this.incR();
    this.push(this.pc);
    this.pc = 0x66;
    this.tstates += 11;
  }

  // ---- execution ----
  step() {
    if (this.trap && this.trap(this)) return;
    this.eiDelay = false;
    let op = this.fetch();
    this.incR();
    let idx = 0, t = 0;
    while (op === 0xdd || op === 0xfd) {
      idx = op === 0xdd ? 1 : 2;
      t += 4;
      op = this.fetch();
      this.incR();
    }
    if (op === 0xcb) t += idx ? this.execIndexCB(idx) : this.execCB();
    else if (op === 0xed) t += this.execED();
    else t += this.execMain(op, idx);
    this.tstates += t;
  }

  execMain(op, idx) {
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    switch (x) {
      case 0:
        switch (z) {
          case 0:
            switch (y) {
              case 0: return 4;
              case 1: {
                let t = this.a; this.a = this.a_; this.a_ = t;
                t = this.f; this.f = this.f_; this.f_ = t;
                return 4;
              }
              case 2: {
                const d = this.fetchDisp();
                this.b = (this.b - 1) & 0xff;
                if (this.b) { this.pc = (this.pc + d) & 0xffff; return 13; }
                return 8;
              }
              case 3: { const d = this.fetchDisp(); this.pc = (this.pc + d) & 0xffff; return 12; }
              default: {
                const d = this.fetchDisp();
                if (this.cond(y - 4)) { this.pc = (this.pc + d) & 0xffff; return 12; }
                return 7;
              }
            }
          case 1:
            if (q === 0) { this.setRP(p, this.fetch16(), idx); return 10; }
            this.setHL(idx, this.add16(this.getHL(idx), this.getRP(p, idx)));
            return 11;
          case 2:
            switch (y) {
              case 0: this.wr(this.bc, this.a); return 7;
              case 1: this.a = this.rd(this.bc); return 7;
              case 2: this.wr(this.de, this.a); return 7;
              case 3: this.a = this.rd(this.de); return 7;
              case 4: this.wr16(this.fetch16(), this.getHL(idx)); return 16;
              case 5: this.setHL(idx, this.rd16(this.fetch16())); return 16;
              case 6: this.wr(this.fetch16(), this.a); return 13;
              default: this.a = this.rd(this.fetch16()); return 13;
            }
          case 3:
            this.setRP(p, this.getRP(p, idx) + (q ? -1 : 1), idx);
            return 6;
          case 4:
          case 5: {
            const inc = z === 4;
            if (y === 6) {
              const a = idx ? (this.getHL(idx) + this.fetchDisp()) & 0xffff : this.hl;
              const v = this.rd(a);
              this.wr(a, inc ? this.inc8(v) : this.dec8(v));
              return idx ? 19 : 11;
            }
            const v = this.getRX(y, idx);
            this.setRX(y, inc ? this.inc8(v) : this.dec8(v), idx);
            return 4;
          }
          case 6:
            if (y === 6) {
              const a = idx ? (this.getHL(idx) + this.fetchDisp()) & 0xffff : this.hl;
              this.wr(a, this.fetch());
              return idx ? 15 : 10;
            }
            this.setRX(y, this.fetch(), idx);
            return 7;
          default:
            switch (y) {
              case 0: this.a = ((this.a << 1) | (this.a >> 7)) & 0xff; this.f = (this.f & (FP | FZ | FS)) | (this.a & (FC | F3 | F5)); break;
              case 1: this.f = (this.f & (FP | FZ | FS)) | (this.a & FC); this.a = ((this.a >> 1) | (this.a << 7)) & 0xff; this.f |= this.a & (F3 | F5); break;
              case 2: { const t = this.a; this.a = ((this.a << 1) | (this.f & FC)) & 0xff; this.f = (this.f & (FP | FZ | FS)) | (this.a & (F3 | F5)) | (t >> 7); break; }
              case 3: { const t = this.a; this.a = (this.a >> 1) | ((this.f & FC) << 7); this.f = (this.f & (FP | FZ | FS)) | (this.a & (F3 | F5)) | (t & FC); break; }
              case 4: this.daa(); break;
              case 5: this.a ^= 0xff; this.f = (this.f & (FC | FP | FZ | FS)) | (this.a & (F3 | F5)) | FN | FH; break;
              case 6: this.f = (this.f & (FP | FZ | FS)) | (this.a & (F3 | F5)) | FC; break;
              default: this.f = (this.f & (FP | FZ | FS)) | ((this.f & FC) ? FH : FC) | (this.a & (F3 | F5)); break;
            }
            return 4;
        }
      case 1:
        if (op === 0x76) { this.halted = true; this.pc = (this.pc - 1) & 0xffff; return 4; }
        if (z === 6) {
          const a = idx ? (this.getHL(idx) + this.fetchDisp()) & 0xffff : this.hl;
          this.setR(y, this.rd(a));
          return idx ? 15 : 7;
        }
        if (y === 6) {
          const a = idx ? (this.getHL(idx) + this.fetchDisp()) & 0xffff : this.hl;
          this.wr(a, this.getR(z));
          return idx ? 15 : 7;
        }
        this.setRX(y, this.getRX(z, idx), idx);
        return 4;
      case 2:
        if (z === 6) {
          const a = idx ? (this.getHL(idx) + this.fetchDisp()) & 0xffff : this.hl;
          this.alu(y, this.rd(a));
          return idx ? 15 : 7;
        }
        this.alu(y, this.getRX(z, idx));
        return 4;
      default:
        switch (z) {
          case 0:
            if (this.cond(y)) { this.pc = this.pop(); return 11; }
            return 5;
          case 1:
            if (q === 0) { this.setRP2(p, this.pop(), idx); return 10; }
            switch (p) {
              case 0: this.pc = this.pop(); return 10;
              case 1: {
                let t;
                t = this.b; this.b = this.b_; this.b_ = t; t = this.c; this.c = this.c_; this.c_ = t;
                t = this.d; this.d = this.d_; this.d_ = t; t = this.e; this.e = this.e_; this.e_ = t;
                t = this.h; this.h = this.h_; this.h_ = t; t = this.l; this.l = this.l_; this.l_ = t;
                return 4;
              }
              case 2: this.pc = this.getHL(idx); return 4;
              default: this.sp = this.getHL(idx); return 6;
            }
          case 2: {
            const nn = this.fetch16();
            if (this.cond(y)) this.pc = nn;
            return 10;
          }
          case 3:
            switch (y) {
              case 0: this.pc = this.fetch16(); return 10;
              case 2: this.bus.output((this.a << 8) | this.fetch(), this.a); return 11;
              case 3: this.a = this.bus.input((this.a << 8) | this.fetch()); return 11;
              case 4: {
                const v = this.rd16(this.sp);
                this.wr16(this.sp, this.getHL(idx));
                this.setHL(idx, v);
                return 19;
              }
              case 5: {
                let t = this.d; this.d = this.h; this.h = t;
                t = this.e; this.e = this.l; this.l = t;
                return 4;
              }
              case 6: this.iff1 = this.iff2 = 0; return 4;
              case 7: this.iff1 = this.iff2 = 1; this.eiDelay = true; return 4;
            }
            return 4; // CB handled in step()
          case 4: {
            const nn = this.fetch16();
            if (this.cond(y)) { this.push(this.pc); this.pc = nn; return 17; }
            return 10;
          }
          case 5:
            if (q === 0) { this.push(this.getRP2(p, idx)); return 11; }
            if (p === 0) { const nn = this.fetch16(); this.push(this.pc); this.pc = nn; return 17; }
            return 4; // prefixes handled in step()
          case 6:
            this.alu(y, this.fetch());
            return 7;
          default:
            this.push(this.pc);
            this.pc = y << 3;
            return 11;
        }
    }
  }

  execCB() {
    const op = this.fetch();
    this.incR();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    if (z === 6) {
      const a = this.hl, v = this.rd(a);
      if (x === 1) { this.bit(y, v, a >> 8); return 12; }
      this.wr(a, x === 0 ? this.rot(y, v) : x === 2 ? v & ~(1 << y) : v | (1 << y));
      return 15;
    }
    const v = this.getR(z);
    if (x === 0) this.setR(z, this.rot(y, v));
    else if (x === 1) this.bit(y, v, v);
    else if (x === 2) this.setR(z, v & ~(1 << y));
    else this.setR(z, v | (1 << y));
    return 8;
  }

  // DD CB d op / FD CB d op. Non-(HL) forms also copy the result into a register (undocumented).
  execIndexCB(idx) {
    const a = (this.getHL(idx) + this.fetchDisp()) & 0xffff;
    const op = this.fetch();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    const v = this.rd(a);
    if (x === 1) { this.bit(y, v, a >> 8); return 16; }
    const r = x === 0 ? this.rot(y, v) : x === 2 ? v & ~(1 << y) : v | (1 << y);
    this.wr(a, r);
    if (z !== 6) this.setR(z, r);
    return 19;
  }

  execED() {
    const op = this.fetch();
    this.incR();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    if (x === 1) {
      switch (z) {
        case 0: {
          const v = this.bus.input(this.bc);
          if (y !== 6) this.setR(y, v);
          this.f = (this.f & FC) | sz53p[v];
          return 12;
        }
        case 1: this.bus.output(this.bc, y === 6 ? 0 : this.getR(y)); return 12;
        case 2: if (q) this.adc16(this.getRP(p, 0)); else this.sbc16(this.getRP(p, 0)); return 15;
        case 3: {
          const nn = this.fetch16();
          if (q) this.setRP(p, this.rd16(nn), 0); else this.wr16(nn, this.getRP(p, 0));
          return 20;
        }
        case 4: { const v = this.a; this.a = 0; this.sub8(v, 0); return 8; }
        case 5: this.iff1 = this.iff2; this.pc = this.pop(); return 14;
        case 6: this.im = IM_TABLE[y]; return 8;
        default:
          switch (y) {
            case 0: this.i = this.a; return 9;
            case 1: this.r = this.a; return 9;
            case 2: this.a = this.i; this.f = (this.f & FC) | sz53[this.a] | (this.iff2 ? FP : 0); return 9;
            case 3: this.a = this.r; this.f = (this.f & FC) | sz53[this.a] | (this.iff2 ? FP : 0); return 9;
            case 4: {
              const v = this.rd(this.hl);
              this.wr(this.hl, (this.a << 4) | (v >> 4));
              this.a = (this.a & 0xf0) | (v & 0x0f);
              this.f = (this.f & FC) | sz53p[this.a];
              return 18;
            }
            case 5: {
              const v = this.rd(this.hl);
              this.wr(this.hl, (v << 4) | (this.a & 0x0f));
              this.a = (this.a & 0xf0) | (v >> 4);
              this.f = (this.f & FC) | sz53p[this.a];
              return 18;
            }
            default: return 8;
          }
      }
    }
    if (x === 2 && z <= 3 && y >= 4) return this.blockOp(y, z);
    return 8; // invalid ED opcodes act as 2 NOPs
  }

  blockOp(y, z) {
    const dir = (y & 1) ? -1 : 1, repeat = y >= 6;
    switch (z) {
      case 0: { // LDI/LDD/LDIR/LDDR
        let v = this.rd(this.hl);
        this.wr(this.de, v);
        this.hl = (this.hl + dir) & 0xffff;
        this.de = (this.de + dir) & 0xffff;
        this.bc = (this.bc - 1) & 0xffff;
        v = (v + this.a) & 0xff;
        this.f = (this.f & (FC | FZ | FS)) | (this.bc ? FP : 0) | (v & F3) | ((v & 0x02) ? F5 : 0);
        if (repeat && this.bc) { this.pc = (this.pc - 2) & 0xffff; return 21; }
        return 16;
      }
      case 1: { // CPI/CPD/CPIR/CPDR
        const v = this.rd(this.hl);
        let t = (this.a - v) & 0xff;
        const lk = ((this.a & 0x08) >> 3) | ((v & 0x08) >> 2) | ((t & 0x08) >> 1);
        this.hl = (this.hl + dir) & 0xffff;
        this.bc = (this.bc - 1) & 0xffff;
        this.f = (this.f & FC) | (this.bc ? (FP | FN) : FN) | hcSub[lk] | (t ? 0 : FZ) | (t & FS);
        if (this.f & FH) t = (t - 1) & 0xff;
        this.f |= (t & F3) | ((t & 0x02) ? F5 : 0);
        if (repeat && this.bc && !(this.f & FZ)) { this.pc = (this.pc - 2) & 0xffff; return 21; }
        return 16;
      }
      case 2: { // INI/IND/INIR/INDR
        const v = this.bus.input(this.bc);
        this.wr(this.hl, v);
        this.b = (this.b - 1) & 0xff;
        this.hl = (this.hl + dir) & 0xffff;
        const t2 = (v + ((this.c + dir) & 0xff)) & 0xff;
        this.f = (v & 0x80 ? FN : 0) | (t2 < v ? FH | FC : 0) | (parity[(t2 & 7) ^ this.b] ? FP : 0) | sz53[this.b];
        if (repeat && this.b) { this.pc = (this.pc - 2) & 0xffff; return 21; }
        return 16;
      }
      default: { // OUTI/OUTD/OTIR/OTDR
        const v = this.rd(this.hl);
        this.b = (this.b - 1) & 0xff;
        this.bus.output(this.bc, v);
        this.hl = (this.hl + dir) & 0xffff;
        const t2 = (v + this.l) & 0xff;
        this.f = (v & 0x80 ? FN : 0) | (t2 < v ? FH | FC : 0) | (parity[(t2 & 7) ^ this.b] ? FP : 0) | sz53[this.b];
        if (repeat && this.b) { this.pc = (this.pc - 2) & 0xffff; return 21; }
        return 16;
      }
    }
  }
}

if (typeof module !== 'undefined') module.exports = { Z80 };
