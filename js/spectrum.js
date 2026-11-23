// ZX Spectrum 48K and 128K: memory paging, ULA (video, keyboard, beeper, EAR), AY sound, tape traps and snapshots.
'use strict';

if (typeof module !== 'undefined') {
  global.Z80 = require('./z80.js').Z80;
  global.Tape = require('./tape.js').Tape;
  global.AY = require('./ay.js').AY;
}

// timing per model: paperT = T-state at which the first paper pixel is drawn, intT = length of the interrupt
const MACHINES = {
  48: { name: 'ZX Spectrum 48K', cpuHz: 3500000, frameT: 69888, lineT: 224, paperT: 14336, intT: 32 },
  128: { name: 'ZX Spectrum 128K', cpuHz: 3546900, frameT: 70908, lineT: 228, paperT: 14364, intT: 36 },
};
const CPU_HZ = MACHINES[48].cpuHz, FRAME_T = MACHINES[48].frameT;
const BORDER_X = 32, BORDER_Y = 24;
const SCREEN_W = 256 + 2 * BORDER_X, SCREEN_H = 192 + 2 * BORDER_Y;
const LD_BYTES = 0x0556, SA_BYTES = 0x04C2, SA_LD_RET = 0x053F;

// ABGR (little-endian ImageData) palette: 0-7 normal, 8-15 bright
const PALETTE = new Uint32Array(16);
for (let i = 0; i < 16; i++) {
  const v = i & 8 ? 0xff : 0xd7;
  const r = i & 2 ? v : 0, g = i & 4 ? v : 0, b = i & 1 ? v : 0;
  PALETTE[i] = 0xff000000 | (b << 16) | (g << 8) | r;
}

class Spectrum {
  constructor(sampleRate, machine) {
    this.ram = Array.from({ length: 8 }, () => new Uint8Array(16384)); // the 48K uses banks 5, 2 and 0
    this.roms = {};                 // 48: [rom], 128: [editor ROM 0, 48 BASIC ROM 1]
    this.slots = [null, this.ram[5], this.ram[2], this.ram[0]];
    this.ay = new AY();
    this.dcIn = 0; this.dcOut = 0;  // DC-blocking filter on the audio output
    this.keys = new Uint8Array(8).fill(0xff); // 8 half-rows, active low
    this.kempston = 0;
    this.cpu = new Z80(this);
    this.cpu.trap = cpu => this.trapHandler(cpu);
    this.screen = new Uint32Array(SCREEN_W * SCREEN_H);
    this.tape = null;
    this.fastLoad = true;
    this.autoTape = true;           // loader detection starts and stops the tape
    this.lastReadT = 0; this.lastReadB = 0; this.loaderReads = 0; this.loaderStreak = 0; this.sameB = 0; this.waitSince = 0;
    this.edgeLoop = { pc: -1, t: 0, b: 0, r: 0, len: 0, db: 0, dr: 0, writes: 0 };
    this.writes = 0;                // memory writes so far: an edge loop writes nothing
    this.frames = 0;
    this.sampleRate = sampleRate || 44100;
    this.setMachine(machine || 48);
  }

  // switch model; resets the machine
  setMachine(m) {
    this.machine = +m;
    this.is128 = this.machine === 128;
    Object.assign(this, MACHINES[this.machine]);
    this.setSampleRate(this.sampleRate);
    this.reset();
  }
  get romLoaded() { return !!this.roms[this.machine]; }

  setSampleRate(rate) {
    this.sampleRate = rate;
    this.tPerSample = this.cpuHz / rate;
    this.audio = new Float32Array(Math.ceil(this.frameT / this.tPerSample) + 2);
    this.nextSampleT = this.tPerSample;
  }

  // 16K = 48K ROM, 32K = 128K ROM (editor ROM followed by the 48 BASIC ROM); returns the model it is for
  loadROM(bytes) {
    if (bytes.length === 16384) this.roms[48] = [bytes.slice()];
    else if (bytes.length === 32768) this.roms[128] = [bytes.slice(0, 16384), bytes.slice(16384)];
    else throw new Error('A ROM must be 16384 bytes (48K) or 32768 bytes (128K), not ' + bytes.length);
    this.page();
    return bytes.length === 16384 ? 48 : 128;
  }

  // port 0x7FFD: bits 0-2 RAM bank at 0xC000, bit 3 shadow screen (bank 7), bit 4 ROM, bit 5 locks paging until reset
  page() {
    const p = this.port7ffd, rom = this.roms[this.machine];
    this.slots[0] = rom ? rom[this.is128 ? (p >> 4) & 1 : 0] : new Uint8Array(16384).fill(0xff);
    this.slots[3] = this.ram[this.is128 ? p & 7 : 0];
    this.screenBank = this.ram[this.is128 && (p & 8) ? 7 : 5];
  }
  // a 48K, or a 128K locked into 48K mode (48 BASIC, USR 0)
  get in48Mode() { return !this.is128 || (this.pagingLocked && (this.port7ffd & 0x10) !== 0); }
  // a 128K started in 48 BASIC: the 48 ROM paged in and the paging locked, as the start-up menu's 48 BASIC does
  boot48() {
    this.reset();
    if (this.is128) { this.port7ffd = 0x30; this.pagingLocked = true; this.page(); }
  }
  get basicROM() { return !this.is128 || (this.port7ffd & 0x10) !== 0; }

  reset() {
    this.cpu.reset();
    for (const b of this.ram) b.fill(0);
    this.port7ffd = 0;
    this.pagingLocked = false;
    this.page();
    this.ay.reset();
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
  read(a) { return this.slots[a >> 14][a & 0x3fff]; }
  write(a, v) { if (a >= 0x4000) this.slots[a >> 14][a & 0x3fff] = v; this.writes++; }

  input(port) {
    if ((port & 0xff) === 0x1f) return this.kempston;
    if (this.is128 && (port & 0xc002) === 0xc000) return this.ay.read(); // 0xFFFD
    if (port & 1) return 0xff;
    let v = 0x1f;
    const hi = port >> 8;
    for (let r = 0; r < 8; r++) if (!(hi & (1 << r))) v &= this.keys[r];
    let ear;
    if (this.tape) this.detectLoader();
    if (this.tape && this.tape.playing) {
      this.syncTape();
      if (this.fastLoad) this.accelerate();
      ear = this.tape.ear;
    } else {
      ear = this.beeper; // issue 3 behaviour: EAR input follows the EAR output bit
    }
    return v | 0xa0 | (ear ? 0x40 : 0);
  }

  output(port, v) {
    if (this.is128 && !(port & 0x8002)) { // 0x7FFD
      if (!this.pagingLocked) { this.port7ffd = v; this.pagingLocked = (v & 0x20) !== 0; this.page(); }
      return;
    }
    if (this.is128 && (port & 0xc002) === 0xc000) { this.ay.select(v); return; }                  // 0xFFFD
    if (this.is128 && (port & 0xc002) === 0x8000) { this.ay.write(v, this.cpu.tstates); return; } // 0xBFFD
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

  // A loader polling the EAR bit (reads of port 0xFE close together, counting with INC B or DEC B)
  // starts the tape; once it stops, a tape it started stops at the end of that block (so a multi-load waits
  // at the next part, while a pause in which the loader decrypts still plays out).
  // After Fuse's loader detection.
  detectLoader() {
    const cpu = this.cpu, t = cpu.tstates + this.frames * this.frameT, tape = this.tape;
    const dt = t - this.lastReadT, db = (cpu.b - this.lastReadB) & 0xff;
    this.lastReadT = t; this.lastReadB = cpu.b;
    if (!this.autoTape || tape.held) return; // held: PAUSE pressed on the recorder
    const looks = dt <= 500 && (db === 1 || db === 0xff);
    if (tape.playing) {
      if (!tape.autoStarted) return;
      this.sameB = db === 0 ? this.sameB + 1 : 0; // a loader counts on every pass; a keyboard loop does not
      if (dt > 1000 || (db !== 1 && db !== 0 && db !== 0xff) || this.sameB > 20) {
        this.loaderStreak = 0;
        if (++this.loaderReads >= 2) { tape.stopAtBlockEnd = true; this.loaderReads = 0; } // the pause after a block plays out
      } else {
        this.loaderReads = 0;
        if (!looks) this.loaderStreak = 0;
        else if (++this.loaderStreak >= 10) tape.stopAtBlockEnd = false; // a loader again: play on
      }
      return;
    }
    if (tape.atEnd) { // the tape has run out: a loader that keeps waiting for 1.5 s wants another part (a multi-load)
      if (dt > 5000) { this.waitSince = t; this.loaderReads = 0; } else if (looks) this.loaderReads++;
      if (this.loaderReads >= 10 && t - this.waitSince > this.cpuHz * 1.5) {
        this.waitSince = t; this.loaderReads = 0;
        if (this.onTapeEnd) this.onTapeEnd();
      }
    } else if (!looks) this.loaderReads = 0;
    else if (++this.loaderReads >= 10) { this.loaderReads = 0; this.playTape(true); }
  }
  // INSTANT, for loaders of their own: a loop that only waits for the next edge (each pass: the same
  // instruction, the same length, B up or down by one, no memory written, nothing else changed) skips the passes until just
  // before that edge, as if they had run. Only while the level is as on the last pass (this read sees no edge),
  // and with interrupts off.
  accelerate() {
    const cpu = this.cpu, a = this.edgeLoop, t = cpu.tstates;
    const len = t - a.t, db = (cpu.b - a.b) & 0xff, dr = (cpu.r - a.r) & 0x7f;
    const ear = this.tape.ear;
    if (a.pc === cpu.pc && a.ear === ear && this.writes === a.writes && len > 0 && len === a.len && db === a.db && (db === 1 || db === 0xff) && dr === a.dr && !cpu.iff1 &&
      a.c === cpu.c && a.de === cpu.de && a.hl === cpu.hl && a.ix === cpu.ix && a.iy === cpu.iy && a.sp === cpu.sp) {
      const n = Math.min(Math.floor(this.tape.remain / len) - 1,  // keep one pass before the edge
        db === 1 ? 0xff - cpu.b : cpu.b - 1,                     // B must not run out
        Math.floor((this.frameT - t) / len) - 1);                // stay in this frame
      if (n > 0) {
        const skip = n * len;
        cpu.tstates += skip;
        cpu.b = (cpu.b + n * db) & 0xff;
        cpu.r = (cpu.r & 0x80) | ((cpu.r + n * dr) & 0x7f);
        this.tape.advance(skip);
        this.tapeT = cpu.tstates;
        this.lastReadT += skip; this.lastReadB = cpu.b; // the loader detection sees the passes as run
      }
    }
    a.pc = cpu.pc; a.t = cpu.tstates; a.b = cpu.b; a.r = cpu.r; a.len = len; a.db = db; a.dr = dr;
    a.writes = this.writes; a.ear = ear;
    a.c = cpu.c; a.de = cpu.de; a.hl = cpu.hl; a.ix = cpu.ix; a.iy = cpu.iy; a.sp = cpu.sp;
  }
  // start the tape; auto: started by a loader (the trap or the detection), so it stops by itself too
  playTape(auto) {
    if (!this.tape) return;
    this.tape.playing = true; this.tape.autoStarted = !!auto; this.tape.stopAtBlockEnd = false;
    this.tape.is48 = this.in48Mode;
    this.tapeT = this.cpu.tstates;
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
    if (this.is128) this.ay.run(t);
  }
  // one output sample: the average level over the sample period, with the DC offset filtered out
  takeSample() {
    let x = this.audioAcc / this.tPerSample;
    if (this.is128) { x += this.ay.acc / this.tPerSample * 0.6; this.ay.acc = 0; }
    this.audioAcc = 0;
    this.dcOut = x - this.dcIn + 0.995 * this.dcOut;
    this.dcIn = x;
    return this.dcOut;
  }

  // ---- frame ----
  // quick: no sound samples and no picture (INSTANT loading runs many frames between two pictures)
  runFrame(quick) {
    const cpu = this.cpu;
    this.borderAtStart = this.border;
    this.borderEvents.length = 0;
    this.processKeyQueue();
    const frameT = this.frameT, intT = this.intT;
    let samples = 0, intDone = false;
    while (cpu.tstates < frameT) {
      if (!intDone && cpu.tstates < intT && cpu.iff1 && !cpu.eiDelay) { cpu.interrupt(); intDone = true; }
      cpu.step();
      if (quick) continue;
      while (cpu.tstates >= this.nextSampleT && this.nextSampleT < frameT) {
        const st = this.nextSampleT;
        if (this.tape && this.tape.playing && st > this.tapeT) { this.tape.advance(st - this.tapeT); this.tapeT = st; }
        this.integrateAudio(st);
        this.audio[samples++] = this.takeSample();
        this.nextSampleT += this.tPerSample;
      }
    }
    if (this.tape && this.tape.playing && frameT > this.tapeT) this.tape.advance(frameT - this.tapeT);
    this.integrateAudio(frameT);
    cpu.tstates -= frameT;
    this.tapeT = 0;
    this.audioLastT = 0;
    if (this.is128) this.ay.endFrame(frameT);
    if (quick) { this.nextSampleT = this.tPerSample; this.audioAcc = 0; this.ay.acc = 0; } else this.nextSampleT -= frameT;
    if (!quick) this.renderScreen();
    this.frames++;
    return this.audio.subarray(0, samples);
  }

  // ---- video ----
  renderScreen() {
    const scr = this.screen, vram = this.screenBank, ev = this.borderEvents;
    // border, 8 pixels (4 T-states) at a time, following OUT timings
    let ei = 0, color = PALETTE[this.borderAtStart];
    for (let y = 0; y < SCREEN_H; y++) {
      const lineT = this.paperT + (y - BORDER_Y) * this.lineT - BORDER_X / 2;
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
      const pixRow = ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
      const attrRow = 0x1800 + ((y >> 3) << 5);
      let o = (y + BORDER_Y) * SCREEN_W + BORDER_X;
      for (let xb = 0; xb < 32; xb++) {
        let bits = vram[pixRow + xb];
        const attr = vram[attrRow + xb];
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
  insertTape(tape) { this.tape = tape; this.tapeT = this.cpu.tstates; tape.is48 = this.in48Mode; }

  trapHandler(cpu) {
    if (cpu.pc === SA_LD_RET) { this.saving = false; return false; } // a save (or load) has finished
    if (cpu.pc === SA_BYTES && this.basicROM && this.onSave) return this.onSave(cpu);
    if (cpu.pc !== LD_BYTES || !this.basicROM) return false;
    if ((!this.tape || (!this.tape.playing && !this.tape.currentBlock())) && this.onNothingToLoad && this.onNothingToLoad(cpu)) return true;
    if (!this.tape || this.tape.playing || this.tape.held) return false; // held: stopped on the recorder, PLAY goes on
    const b = this.tape.currentBlock();
    if (!b) return false;
    if (!this.fastLoad || !b.std) {
      // custom/turbo block or real-time loading: just start the tape
      this.playTape(true);
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
    // a pause block next (in which the program decrypts what it loaded, say): a real tape plays on through it
    const next = this.tape.currentBlock();
    if (next && next.pause) { this.playTape(true); this.tape.stopAtBlockEnd = true; }
    return true;
  }

  // SAVE: the block the ROM is about to save (A = flag, IX = start, DE = length), as a TAP block with its parity byte
  saveBlock(cpu) {
    const len = cpu.de, out = new Uint8Array(len + 2);
    let par = out[0] = cpu.a;
    for (let k = 0; k < len; k++) { const b = this.read((cpu.ix + k) & 0xffff); out[1 + k] = b; par ^= b; }
    out[len + 1] = par;
    return out;
  }
  // return from SA-BYTES / LD-BYTES at once, as if it had run (carry set: success)
  skipTapeRoutine(cpu, ok) {
    cpu.f = ok ? (cpu.f | 1) : (cpu.f & ~1);
    cpu.iff1 = cpu.iff2 = 1;
    cpu.pc = cpu.pop();
    cpu.tstates += 100;
    return true;
  }
  // stay at this instruction (a question is on the screen): time still passes, so a frame can end
  holdHere(cpu) { cpu.tstates += 4; return true; }

  // ---- snapshots ----
  // Loading a snapshot switches to the model it was made on; the loaders return that model (48 or 128).
  needMachine(m) {
    if (!this.roms[m]) throw new Error('This snapshot is for the ' + MACHINES[m].name + '; load its ROM first.');
    if (this.machine !== m) this.setMachine(m);
    else this.reset();
  }

  loadSNA(d) {
    const is128 = d.length === 131103 || d.length === 147487;
    if (d.length !== 49179 && !is128) throw new Error('Not a 48K or 128K .SNA snapshot (' + d.length + ' bytes)');
    this.needMachine(is128 ? 128 : 48);
    const c = this.cpu;
    c.i = d[0];
    c.l_ = d[1]; c.h_ = d[2]; c.e_ = d[3]; c.d_ = d[4]; c.c_ = d[5]; c.b_ = d[6]; c.f_ = d[7]; c.a_ = d[8];
    c.l = d[9]; c.h = d[10]; c.e = d[11]; c.d = d[12]; c.c = d[13]; c.b = d[14];
    c.iy = d[15] | (d[16] << 8); c.ix = d[17] | (d[18] << 8);
    c.iff1 = c.iff2 = (d[19] >> 2) & 1;
    c.r = d[20]; c.f = d[21]; c.a = d[22];
    c.sp = d[23] | (d[24] << 8);
    c.im = d[25] & 3;
    this.border = d[26] & 7;
    if (!is128) {
      this.setRAM(d.subarray(27, 27 + 49152));
      c.pc = c.pop();
      return 48;
    }
    // 128K: banks 5, 2 and the paged bank, then PC, port 0x7FFD, TR-DOS flag and the other banks in order
    const p = d[27 + 49152 + 2], paged = p & 7;
    this.port7ffd = p; this.pagingLocked = (p & 0x20) !== 0; this.page();
    this.ram[5].set(d.subarray(27, 27 + 16384));
    this.ram[2].set(d.subarray(27 + 16384, 27 + 32768));
    this.ram[paged].set(d.subarray(27 + 32768, 27 + 49152));
    c.pc = d[27 + 49152] | (d[27 + 49152 + 1] << 8);
    let o = 27 + 49152 + 4;
    for (let b = 0; b < 8; b++) {
      if (b === 5 || b === 2 || b === paged) continue;
      this.ram[b].set(d.subarray(o, o + 16384));
      o += 16384;
    }
    return 128;
  }

  saveSNA() {
    const c = this.cpu, is128 = this.is128;
    const paged = this.port7ffd & 7, extra = paged === 5 || paged === 2 ? 6 : 5;
    const d = new Uint8Array(is128 ? 27 + 49152 + 4 + extra * 16384 : 49179);
    // a 48K snapshot keeps PC on the stack
    const sp = is128 ? c.sp : (c.sp - 2) & 0xffff;
    d.set([c.i, c.l_, c.h_, c.e_, c.d_, c.c_, c.b_, c.f_, c.a_, c.l, c.h, c.e, c.d, c.c, c.b,
      c.iy & 0xff, c.iy >> 8, c.ix & 0xff, c.ix >> 8, c.iff2 ? 4 : 0, c.r, c.f, c.a,
      sp & 0xff, sp >> 8, c.im, this.border], 0);
    d.set(this.ram[5], 27); d.set(this.ram[2], 27 + 16384); d.set(this.ram[is128 ? paged : 0], 27 + 32768);
    if (!is128) {
      const put = (a, v) => { if (a >= 0x4000) d[27 + a - 0x4000] = v; };
      put(sp, c.pc & 0xff); put((sp + 1) & 0xffff, c.pc >> 8);
      return d;
    }
    let o = 27 + 49152;
    d[o++] = c.pc & 0xff; d[o++] = c.pc >> 8; d[o++] = this.port7ffd; d[o++] = 0;
    for (let b = 0; b < 8; b++) {
      if (b === 5 || b === 2 || b === paged) continue;
      d.set(this.ram[b], o);
      o += 16384;
    }
    return d;
  }

  // the 48K RAM image (0x4000-0xFFFF) into banks 5, 2 and 0
  setRAM(img) {
    this.ram[5].set(img.subarray(0, 16384));
    this.ram[2].set(img.subarray(16384, 32768));
    this.ram[0].set(img.subarray(32768, 49152));
  }

  loadZ80(d) {
    let pc = d[6] | (d[7] << 8), flags = d[12] === 255 ? 1 : d[12];
    const regs = () => {
      const c = this.cpu;
      c.a = d[0]; c.f = d[1]; c.c = d[2]; c.b = d[3]; c.l = d[4]; c.h = d[5];
      c.sp = d[8] | (d[9] << 8); c.i = d[10];
      c.r = (d[11] & 0x7f) | ((flags & 1) << 7);
      this.border = (flags >> 1) & 7;
      c.e = d[13]; c.d = d[14]; c.c_ = d[15]; c.b_ = d[16]; c.e_ = d[17]; c.d_ = d[18]; c.l_ = d[19]; c.h_ = d[20];
      c.a_ = d[21]; c.f_ = d[22];
      c.iy = d[23] | (d[24] << 8); c.ix = d[25] | (d[26] << 8);
      c.iff1 = d[27] ? 1 : 0; c.iff2 = d[28] ? 1 : 0; c.im = d[29] & 3;
    };
    if (pc !== 0) { // version 1: always 48K
      this.needMachine(48);
      regs();
      this.cpu.pc = pc;
      this.setRAM((flags & 0x20) ? unpackZ80(d, 30, d.length, 49152) : d.subarray(30, 30 + 49152));
      return 48;
    }
    const extLen = d[30] | (d[31] << 8);
    pc = d[32] | (d[33] << 8);
    const hw = d[34];
    const is48 = extLen === 23 ? hw <= 1 : hw <= 1 || hw === 3;
    const is128 = extLen === 23 ? hw === 3 || hw === 4 : hw >= 4 && hw <= 6 || hw === 12;
    if (!is48 && !is128) throw new Error('This .Z80 snapshot is for a machine other than the 48K or 128K (hardware ' + hw + ')');
    const m = is48 ? 48 : 128;
    this.needMachine(m);
    regs();
    this.cpu.pc = pc;
    if (m === 128) {
      this.port7ffd = d[35]; this.pagingLocked = (d[35] & 0x20) !== 0; this.page();
      for (let r = 0; r < 16; r++) { this.ay.select(r); this.ay.write(d[39 + r], 0); }
      this.ay.select(d[38]);
    }
    // memory blocks: page 8/4/5 = 0x4000/0x8000/0xC000 on the 48K; pages 3-10 = banks 0-7 on the 128K
    const bank48 = { 8: 5, 4: 2, 5: 0 };
    let i = 32 + extLen;
    while (i + 3 <= d.length) {
      const len = d[i] | (d[i + 1] << 8), page = d[i + 2];
      i += 3;
      const raw = len === 0xffff;
      const n = raw ? 16384 : len;
      const block = raw ? d.subarray(i, i + 16384) : unpackZ80(d, i, i + n, 16384);
      const bank = m === 48 ? bank48[page] : page >= 3 && page <= 10 ? page - 3 : undefined;
      if (bank !== undefined) this.ram[bank].set(block);
      i += n;
    }
    return m;
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

if (typeof module !== 'undefined') module.exports = { Spectrum, MACHINES, SCREEN_W, SCREEN_H, FRAME_T, CPU_HZ };
