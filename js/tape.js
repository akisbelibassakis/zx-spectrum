// Tape images (TAP / TZX) converted to an EAR pulse stream, plus the list of
// standard ROM-format data blocks so the loader can be trapped for instant loading.
'use strict';

const PILOT = 2168, SYNC1 = 667, SYNC2 = 735, BIT0 = 855, BIT1 = 1710;
const PILOT_HEADER = 8063, PILOT_DATA = 3223;
const MS = 3500; // T-states per millisecond

class Tape {
  constructor() {
    this.pulses = [];    // >0: hold level for n T-states then toggle; <0 (pause): hold -n T-states then set level low
    this.blocks = [];    // { data: Uint8Array|null, pulseStart, pulseEnd, std: bool, desc }
    this.blockIdx = 0;
    this.pos = 0;        // index into pulses
    this.remain = 0;     // T-states left in the current pulse
    this.ear = 0;
    this.playing = false;
    this.name = '';
  }

  get loaded() { return this.blocks.length > 0; }
  get atEnd() { return this.pos >= this.pulses.length; }

  rewind() {
    this.blockIdx = 0; this.pos = 0; this.ear = 0; this.playing = false;
    this.remain = this.pulses.length ? this.startPulse(0) : 0;
  }

  startPulse(i) {
    const p = this.pulses[i];
    return p < 0 ? -p : p;
  }

  // Advance the tape by dt T-states.
  advance(dt) {
    if (!this.playing) return;
    while (dt > 0) {
      if (this.pos >= this.pulses.length) { this.playing = false; return; }
      if (dt < this.remain) { this.remain -= dt; return; }
      dt -= this.remain;
      if (this.pulses[this.pos] > 0) this.ear ^= 1; else this.ear = 0;
      this.pos++;
      while (this.blockIdx < this.blocks.length && this.pos >= this.blocks[this.blockIdx].pulseEnd) this.blockIdx++;
      if (this.pulses[this.pos] === -1) { // TZX "stop the tape"
        this.ear = 0; this.pos++; this.playing = false;
        while (this.blockIdx < this.blocks.length && this.pos >= this.blocks[this.blockIdx].pulseEnd) this.blockIdx++;
        if (this.pos < this.pulses.length) this.remain = this.startPulse(this.pos);
        return;
      }
      if (this.pos < this.pulses.length) this.remain = this.startPulse(this.pos);
    }
  }

  // Skip past the current block (used after a trapped load).
  skipBlock() {
    const b = this.blocks[this.blockIdx];
    if (!b) return;
    this.blockIdx++;
    this.pos = b.pulseEnd;
    this.remain = this.pos < this.pulses.length ? this.startPulse(this.pos) : 0;
  }

  currentBlock() { return this.blocks[this.blockIdx] || null; }

  // ---- pulse generation ----
  addPulse(n) { if (n > 0) this.pulses.push(n); }
  addPause(ms) { if (ms > 0) this.pulses.push(-ms * MS); }
  addData(data, start, len, zero, one, usedLast) {
    for (let i = 0; i < len; i++) {
      const byte = data[start + i];
      const bits = i === len - 1 ? usedLast : 8;
      for (let b = 0; b < bits; b++) {
        const p = (byte & (0x80 >> b)) ? one : zero;
        this.pulses.push(p, p);
      }
    }
  }
  addStandard(data, pauseMs, desc) {
    const start = this.pulses.length;
    const pilotCount = data[0] < 128 ? PILOT_HEADER : PILOT_DATA;
    for (let i = 0; i < pilotCount; i++) this.pulses.push(PILOT);
    this.pulses.push(SYNC1, SYNC2);
    this.addData(data, 0, data.length, BIT0, BIT1, 8);
    this.addPause(pauseMs);
    this.blocks.push({ data, pulseStart: start, pulseEnd: this.pulses.length, std: true, desc: desc || describeBlock(data) });
  }
  addOther(start, desc) {
    if (this.pulses.length > start) this.blocks.push({ data: null, pulseStart: start, pulseEnd: this.pulses.length, std: false, desc });
  }

  static fromTAP(buf, name) {
    const t = new Tape();
    t.name = name || '';
    let i = 0;
    while (i + 2 <= buf.length) {
      const len = buf[i] | (buf[i + 1] << 8);
      i += 2;
      if (len === 0 || i + len > buf.length) break;
      t.addStandard(buf.subarray(i, i + len), 1000);
      i += len;
    }
    t.rewind();
    return t;
  }

  static fromTZX(buf, name) {
    const sig = String.fromCharCode.apply(null, buf.subarray(0, 7));
    if (sig !== 'ZXTape!') throw new Error('Not a TZX file');
    const t = new Tape();
    t.name = name || '';
    const w = i => buf[i] | (buf[i + 1] << 8);
    const w3 = i => buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16);
    const dw = i => (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0;
    let i = 10, loopStart = -1, loopCount = 0;
    while (i < buf.length) {
      const id = buf[i++];
      const start = t.pulses.length;
      switch (id) {
        case 0x10: { // standard speed data
          const pause = w(i), len = w(i + 2);
          t.addStandard(buf.subarray(i + 4, i + 4 + len), pause);
          i += 4 + len;
          break;
        }
        case 0x11: { // turbo speed data
          const pilot = w(i), s1 = w(i + 2), s2 = w(i + 4), zero = w(i + 6), one = w(i + 8);
          const pilotLen = w(i + 10), used = buf[i + 12], pause = w(i + 13), len = w3(i + 15);
          for (let k = 0; k < pilotLen; k++) t.pulses.push(pilot);
          t.pulses.push(s1, s2);
          t.addData(buf, i + 18, len, zero, one, used || 8);
          t.addPause(pause);
          t.addOther(start, 'Turbo data');
          i += 18 + len;
          break;
        }
        case 0x12: { // pure tone
          const len = w(i), n = w(i + 2);
          for (let k = 0; k < n; k++) t.pulses.push(len);
          t.addOther(start, 'Pure tone');
          i += 4;
          break;
        }
        case 0x13: { // pulse sequence
          const n = buf[i];
          for (let k = 0; k < n; k++) t.pulses.push(w(i + 1 + k * 2));
          t.addOther(start, 'Pulses');
          i += 1 + n * 2;
          break;
        }
        case 0x14: { // pure data
          const zero = w(i), one = w(i + 2), used = buf[i + 4], pause = w(i + 5), len = w3(i + 7);
          t.addData(buf, i + 10, len, zero, one, used || 8);
          t.addPause(pause);
          t.addOther(start, 'Pure data');
          i += 10 + len;
          break;
        }
        case 0x15: { // direct recording
          const tps = w(i), pause = w(i + 2), used = buf[i + 4], len = w3(i + 5);
          let level = -1, run = 0;
          for (let k = 0; k < len; k++) {
            const bits = k === len - 1 ? (used || 8) : 8;
            for (let b = 0; b < bits; b++) {
              const v = (buf[i + 8 + k] >> (7 - b)) & 1;
              if (v !== level && run) { t.pulses.push(run * tps); run = 0; }
              level = v; run++;
            }
          }
          if (run) t.pulses.push(run * tps);
          t.addPause(pause);
          t.addOther(start, 'Direct recording');
          i += 8 + len;
          break;
        }
        case 0x18: case 0x19: i += 4 + dw(i); break; // CSW / generalized data: not supported
        case 0x20: { // pause / stop the tape
          const pause = w(i);
          if (pause) t.addPause(pause); else t.pulses.push(-1);
          t.addOther(start, pause ? 'Pause' : 'Stop');
          i += 2;
          break;
        }
        case 0x21: i += 1 + buf[i]; break;          // group start
        case 0x22: break;                            // group end
        case 0x23: i += 2; break;                    // jump (ignored)
        case 0x24: loopCount = w(i); i += 2; loopStart = i; break;
        case 0x25:                                   // loop end
          if (loopStart >= 0 && --loopCount > 0) i = loopStart; else loopStart = -1;
          break;
        case 0x26: i += 2 + w(i) * 2; break;        // call sequence (ignored)
        case 0x27: break;                            // return
        case 0x28: i += 2 + w(i); break;            // select block
        case 0x2a: i += 4; break;                    // stop if 48K
        case 0x2b: i += 5; break;                    // signal level
        case 0x30: i += 1 + buf[i]; break;          // text description
        case 0x31: i += 2 + buf[i + 1]; break;      // message
        case 0x32: i += 2 + w(i); break;            // archive info
        case 0x33: i += 1 + buf[i] * 3; break;      // hardware type
        case 0x35: i += 0x14 + dw(i + 0x10); break; // custom info
        case 0x5a: i += 9; break;                    // glue
        default:
          throw new Error('Unsupported TZX block 0x' + id.toString(16));
      }
    }
    t.rewind();
    return t;
  }
}

function describeBlock(d) {
  if (d[0] === 0 && d.length === 19) {
    const types = ['Program', 'Number array', 'Character array', 'Bytes'];
    const name = String.fromCharCode.apply(null, d.subarray(2, 12)).trimEnd();
    return (types[d[1]] || 'Header') + ': ' + name;
  }
  return 'Data (' + (d.length - 2) + ' bytes)';
}

if (typeof module !== 'undefined') module.exports = { Tape };
