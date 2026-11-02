// ZX Spectrum 48K: memory, ULA (video, keyboard, beeper, EAR), tape traps and snapshots.
'use strict';

if (typeof module !== 'undefined') {
  global.Z80 = require('./z80.js').Z80;
  global.Tape = require('./tape.js').Tape;
}

const CPU_HZ = 3500000;
const FRAME_T = 69888;
const LINE_T = 224;
const PAPER_T = 14336;           // T-state at which the first paper pixel is drawn
const BORDER_X = 32, BORDER_Y = 24;
const SCREEN_W = 256 + 2 * BORDER_X, SCREEN_H = 192 + 2 * BORDER_Y;
const LD_BYTES = 0x0556;

// ABGR (little-endian ImageData) palette: 0-7 normal, 8-15 bright
const PALETTE = new Uint32Array(16);
for (let i = 0; i < 16; i++) {
  const v = i & 8 ? 0xff : 0xd7;
  const r = i & 2 ? v : 0, g = i & 4 ? v : 0, b = i & 1 ? v : 0;
  PALETTE[i] = 0xff000000 | (b << 16) | (g << 8) | r;
}

class Spectrum {
  constructor(sampleRate) {
    this.mem = new Uint8Array(65536);
    this.romLoaded = false;
    this.keys = new Uint8Array(8).fill(0xff); // 8 half-rows, active low
    this.kempston = 0;
    this.cpu = new Z80(this);
    this.cpu.trap = cpu => this.trapHandler(cpu);
    this.screen = new Uint32Array(SCREEN_W * SCREEN_H);
    this.tape = null;
    this.fastLoad = true;
    this.frames = 0;
    this.setSampleRate(sampleRate || 44100);
    this.reset();
  }

  setSampleRate(rate) {
    this.sampleRate = rate;
    this.tPerSample = CPU_HZ / rate;
    this.audio = new Float32Array(Math.ceil(FRAME_T / this.tPerSample) + 2);
    this.nextSampleT = this.tPerSample;
  }

  loadROM(bytes) {
    if (bytes.length !== 16384) throw new Error('48K ROM must be exactly 16384 bytes (got ' + bytes.length + ')');
    this.mem.set(bytes, 0);
    this.romLoaded = true;
  }

  reset() {
    this.cpu.reset();
    this.mem.fill(0, 0x4000);
    this.border = 7;
    this.borderAtStart = 7;
    this.borderEvents = [];
    this.beeper = 0;
    this.tapeT = 0;
    this.audioAcc = 0;
    this.audioLastT = 0;
    this.audioLevel = 0;
    this.keyQueue = [];
    if (this.tape) this.tape.rewind();
  }

  // ---- bus ----
  read(a) { return this.mem[a]; }
  write(a, v) { if (a >= 0x4000) this.mem[a] = v; }

  input(port) {
    if ((port & 0xff) === 0x1f) return this.kempston;
    if (port & 1) return 0xff;
    let v = 0x1f;
    const hi = port >> 8;
    for (let r = 0; r < 8; r++) if (!(hi & (1 << r))) v &= this.keys[r];
    let ear;
    if (this.tape && this.tape.playing) {
      this.syncTape();
      ear = this.tape.ear;
    } else {
      ear = this.beeper; // issue 3 behaviour: EAR input follows the EAR output bit
    }
    return v | 0xa0 | (ear ? 0x40 : 0);
  }

  output(port, v) {
    if (port & 1) return;
    const t = this.cpu.tstates;
    const border = v & 7;
    if (border !== this.border) {
      this.border = border;
      this.borderEvents.push(t, border);
    }
    const beep = (v >> 4) & 1;
    if (beep !== this.beeper) {
      this.integrateAudio(t);
      this.beeper = beep;
    }
  }

  syncTape() {
    const t = this.cpu.tstates;
    if (t > this.tapeT) { this.tape.advance(t - this.tapeT); this.tapeT = t; }
  }

  // ---- audio: average the speaker level over each output sample ----
  currentLevel() {
    const tapeLevel = this.tape && this.tape.playing ? this.tape.ear * 0.25 : 0;
    return this.beeper * 0.5 + tapeLevel;
  }
  integrateAudio(t) {
    this.audioAcc += this.currentLevel() * (t - this.audioLastT);
    this.audioLastT = t;
  }

  // ---- frame ----
  runFrame() {
    const cpu = this.cpu;
    this.borderAtStart = this.border;
    this.borderEvents.length = 0;
    this.processKeyQueue();
    let samples = 0, intDone = false;
    while (cpu.tstates < FRAME_T) {
      if (!intDone && cpu.tstates < 32 && cpu.iff1 && !cpu.eiDelay) { cpu.interrupt(); intDone = true; }
      cpu.step();
      while (cpu.tstates >= this.nextSampleT && this.nextSampleT < FRAME_T) {
        const st = this.nextSampleT;
        if (this.tape && this.tape.playing && st > this.tapeT) { this.tape.advance(st - this.tapeT); this.tapeT = st; }
        this.integrateAudio(st);
        this.audio[samples++] = this.audioAcc / this.tPerSample - 0.375;
        this.audioAcc = 0;
        this.nextSampleT += this.tPerSample;
      }
    }
    if (this.tape && this.tape.playing && FRAME_T > this.tapeT) this.tape.advance(FRAME_T - this.tapeT);
    this.integrateAudio(FRAME_T);
    cpu.tstates -= FRAME_T;
    this.tapeT = 0;
    this.audioLastT = 0;
    this.nextSampleT -= FRAME_T;
    this.renderScreen();
    this.frames++;
    return this.audio.subarray(0, samples);
  }

  // ---- video ----
  renderScreen() {
    const scr = this.screen, mem = this.mem, ev = this.borderEvents;
    // border, 8 pixels (4 T-states) at a time, following OUT timings
    let ei = 0, color = PALETTE[this.borderAtStart];
    for (let y = 0; y < SCREEN_H; y++) {
      const lineT = PAPER_T + (y - BORDER_Y) * LINE_T - BORDER_X / 2;
      const inPaperRow = y >= BORDER_Y && y < BORDER_Y + 192;
      for (let bx = 0; bx < SCREEN_W / 8; bx++) {
        const t = lineT + bx * 4;
        while (ei < ev.length && ev[ei] <= t) { color = PALETTE[ev[ei + 1]]; ei += 2; }
        if (inPaperRow && bx >= BORDER_X / 8 && bx < (BORDER_X + 256) / 8) continue;
        const o = y * SCREEN_W + bx * 8;
        for (let k = 0; k < 8; k++) scr[o + k] = color;
      }
    }
    // paper
    const flash = (this.frames & 16) !== 0;
    for (let y = 0; y < 192; y++) {
      const pixRow = 0x4000 | ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
      const attrRow = 0x5800 + ((y >> 3) << 5);
      let o = (y + BORDER_Y) * SCREEN_W + BORDER_X;
      for (let xb = 0; xb < 32; xb++) {
        let bits = mem[pixRow + xb];
        const attr = mem[attrRow + xb];
        const bright = (attr & 0x40) >> 3;
        let ink = PALETTE[(attr & 7) | bright], paper = PALETTE[((attr >> 3) & 7) | bright];
        if (flash && (attr & 0x80)) { const t = ink; ink = paper; paper = t; }
        for (let k = 0; k < 8; k++, bits <<= 1) scr[o++] = bits & 0x80 ? ink : paper;
      }
    }
  }

  // ---- keyboard ----
  setKey(row, bit, down) {
    if (down) this.keys[row] &= ~(1 << bit); else this.keys[row] |= 1 << bit;
  }
  // queue of [keys[], holdFrames] used to type commands automatically
  typeKeys(seq) { this.keyQueue.push(...seq); }
  processKeyQueue() {
    const q = this.keyQueue;
    if (!q.length) return;
    const item = q[0];
    if (item.wait > 0) { item.wait--; return; }
    if (!item.pressed) { for (const [r, b] of item.keys) this.setKey(r, b, true); item.pressed = true; item.hold = 4; return; }
    if (--item.hold > 0) return;
    for (const [r, b] of item.keys) this.setKey(r, b, false);
    q.shift();
    if (q.length) q[0].wait = Math.max(q[0].wait || 0, 3);
  }

  // ---- tape ----
  insertTape(tape) { this.tape = tape; this.tapeT = this.cpu.tstates; }

  trapHandler(cpu) {
    if (cpu.pc !== LD_BYTES || !this.tape || this.tape.playing) return false;
    const b = this.tape.currentBlock();
    if (!b) return false;
    if (!this.fastLoad || !b.std) {
      // custom/turbo block or real-time loading: just start the tape
      this.tape.playing = true;
      this.tapeT = cpu.tstates;
      return false;
    }
    const data = b.data;
    const verify = !(cpu.f & 1);
    let ok = false;
    if (data[0] === cpu.a) {
      const want = cpu.de, avail = data.length - 1;
      let ix = cpu.ix, par = data[0], k = 0;
      for (; k < want && k < avail; k++) {
        const byte = data[1 + k];
        if (!verify) this.write(ix, byte);
        ix = (ix + 1) & 0xffff;
        par ^= byte;
      }
      if (k === want) {
        if (want < avail) par ^= data[1 + want];
        ok = par === 0;
      }
      cpu.ix = ix;
      cpu.de = (want - k) & 0xffff;
    }
    cpu.f = ok ? (cpu.f | 1) : (cpu.f & ~1);
    cpu.iff1 = cpu.iff2 = 1; // SA/LD-RET re-enables interrupts
    cpu.pc = cpu.pop();
    cpu.tstates += 100;
    this.tape.skipBlock();
    return true;
  }

  // ---- snapshots ----
  loadSNA(d) {
    if (d.length !== 49179) throw new Error('Only 48K .SNA snapshots are supported');
    const c = this.cpu;
    c.reset();
    c.i = d[0];
    c.l_ = d[1]; c.h_ = d[2]; c.e_ = d[3]; c.d_ = d[4]; c.c_ = d[5]; c.b_ = d[6]; c.f_ = d[7]; c.a_ = d[8];
    c.l = d[9]; c.h = d[10]; c.e = d[11]; c.d = d[12]; c.c = d[13]; c.b = d[14];
    c.iy = d[15] | (d[16] << 8); c.ix = d[17] | (d[18] << 8);
    c.iff1 = c.iff2 = (d[19] >> 2) & 1;
    c.r = d[20]; c.f = d[21]; c.a = d[22];
    c.sp = d[23] | (d[24] << 8);
    c.im = d[25] & 3;
    this.border = d[26] & 7;
    this.mem.set(d.subarray(27, 27 + 49152), 0x4000);
    c.pc = c.pop();
  }

  saveSNA() {
    const c = this.cpu, d = new Uint8Array(49179);
    const sp = (c.sp - 2) & 0xffff;
    // push PC onto a copy of memory, as the format requires
    const mem = this.mem.slice();
    mem[sp] = c.pc & 0xff; mem[(sp + 1) & 0xffff] = c.pc >> 8;
    d.set([c.i, c.l_, c.h_, c.e_, c.d_, c.c_, c.b_, c.f_, c.a_, c.l, c.h, c.e, c.d, c.c, c.b,
      c.iy & 0xff, c.iy >> 8, c.ix & 0xff, c.ix >> 8, c.iff2 ? 4 : 0, c.r, c.f, c.a,
      sp & 0xff, sp >> 8, c.im, this.border], 0);
    d.set(mem.subarray(0x4000), 27);
    return d;
  }

  loadZ80(d) {
    const c = this.cpu;
    let pc = d[6] | (d[7] << 8), flags = d[12] === 255 ? 1 : d[12];
    const regs = () => {
      c.reset();
      c.a = d[0]; c.f = d[1]; c.c = d[2]; c.b = d[3]; c.l = d[4]; c.h = d[5];
      c.sp = d[8] | (d[9] << 8); c.i = d[10];
      c.r = (d[11] & 0x7f) | ((flags & 1) << 7);
      this.border = (flags >> 1) & 7;
      c.e = d[13]; c.d = d[14]; c.c_ = d[15]; c.b_ = d[16]; c.e_ = d[17]; c.d_ = d[18]; c.l_ = d[19]; c.h_ = d[20];
      c.a_ = d[21]; c.f_ = d[22];
      c.iy = d[23] | (d[24] << 8); c.ix = d[25] | (d[26] << 8);
      c.iff1 = d[27] ? 1 : 0; c.iff2 = d[28] ? 1 : 0; c.im = d[29] & 3;
    };
    if (pc !== 0) { // version 1
      const ram = (flags & 0x20) ? unpackZ80(d, 30, d.length, 49152) : d.subarray(30, 30 + 49152);
      regs();
      c.pc = pc;
      this.mem.set(ram, 0x4000);
      return;
    }
    const extLen = d[30] | (d[31] << 8);
    pc = d[32] | (d[33] << 8);
    const hw = d[34];
    const is48 = extLen === 23 ? hw <= 1 : hw <= 1 || hw === 3;
    if (!is48) throw new Error('Only 48K .Z80 snapshots are supported (this one is for a 128K or other machine)');
    const pages = { 8: 0x4000, 4: 0x8000, 5: 0xc000 };
    let i = 32 + extLen;
    const ram = new Uint8Array(49152);
    while (i + 3 <= d.length) {
      const len = d[i] | (d[i + 1] << 8), page = d[i + 2];
      i += 3;
      const raw = len === 0xffff;
      const n = raw ? 16384 : len;
      const block = raw ? d.subarray(i, i + 16384) : unpackZ80(d, i, i + n, 16384);
      if (pages[page] !== undefined) ram.set(block, pages[page] - 0x4000);
      i += n;
    }
    regs();
    c.pc = pc;
    this.mem.set(ram, 0x4000);
  }
}

function unpackZ80(d, start, end, size) {
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = start; i < end && o < size;) {
    if (d[i] === 0xed && d[i + 1] === 0xed) {
      const n = d[i + 2], v = d[i + 3];
      for (let k = 0; k < n && o < size; k++) out[o++] = v;
      i += 4;
    } else if (d[i] === 0x00 && d[i + 1] === 0xed && d[i + 2] === 0xed && d[i + 3] === 0x00) {
      break; // v1 end marker
    } else {
      out[o++] = d[i++];
    }
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { Spectrum, SCREEN_W, SCREEN_H, FRAME_T, CPU_HZ };
