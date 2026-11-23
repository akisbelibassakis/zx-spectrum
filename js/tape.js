// Tape images (TAP / TZX) converted to an EAR pulse stream, plus the list of
// standard ROM-format data blocks so the loader can be trapped for instant loading.
'use strict';

const PILOT = 2168, SYNC1 = 667, SYNC2 = 735, BIT0 = 855, BIT1 = 1710;
const PILOT_HEADER = 8063, PILOT_DATA = 3223;
const MS = 3500; // T-states per millisecond
const STOP = -1, STOP48 = -2; // markers in the pulse list: TZX "stop the tape", and "stop the tape if in 48K mode"

class Tape {
  constructor() {
    this.pulses = [];    // >0: hold level for n T-states then toggle; <0 (pause): hold -n T-states then set level low; STOP, STOP48: markers
    this.blocks = [];    // { data: Uint8Array|null, pulseStart, pulseEnd, std: bool, desc }
    this.blockIdx = 0;
    this.pos = 0;        // index into pulses
    this.remain = 0;     // T-states left in the current pulse
    this.ear = 0;
    this.playing = false;
    this.name = '';
    this.parts = [];     // separately loadable parts (48K / 128K versions, sides): { name, block }
    this.is48 = false;   // the machine is in 48K mode: STOP48 markers stop the tape
  }

  get loaded() { return this.blocks.length > 0; }
  get atEnd() { return this.pos >= this.pulses.length; }

  rewind() {
    this.ear = 0; this.playing = false; this.held = false; this.autoStarted = false; this.stopAtBlockEnd = false;
    this.windTo(0);
  }
  // wind to the start of a block (the tape stops)
  windTo(block) {
    const b = this.blocks[block];
    this.blockIdx = b ? block : this.blocks.length;
    this.pos = b ? b.pulseStart : this.pulses.length;
    this.playing = false;
    this.settle();
  }
  // the part a block belongs to
  partAt(block) {
    let p = -1;
    this.parts.forEach((x, i) => { if (x.block <= block) p = i; });
    return p;
  }

  startPulse(i) {
    const p = this.pulses[i];
    return p < 0 ? -p : p;
  }
  // at a new position: act on markers there, then start its pulse; false if the tape stopped
  settle() {
    let going = true;
    for (;;) {
      while (this.blockIdx < this.blocks.length && this.pos >= this.blocks[this.blockIdx].pulseEnd) {
        this.blockIdx++;
        if (this.stopAtBlockEnd) { this.stopAtBlockEnd = false; going = false; } // the loader asked for a stop
      }
      const p = this.pulses[this.pos];
      if (p === STOP || p === STOP48) {
        this.pos++;
        if (p === STOP || this.is48) going = false; // the level stays, so the last edge before it counts
        continue;
      }
      break;
    }
    this.remain = this.pos < this.pulses.length ? this.startPulse(this.pos) : 0;
    if (!going) this.playing = false;
    return going;
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
      if (!this.settle()) return;
    }
  }

  // Skip past the current block (used after a trapped load).
  skipBlock() {
    const b = this.blocks[this.blockIdx];
    if (!b) return;
    this.blockIdx++;
    this.pos = b.pulseEnd;
    const playing = this.playing;
    this.settle();
    this.playing = playing; // a trapped load goes on as it was
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
  addOther(start, desc, pause) {
    if (this.pulses.length > start) this.blocks.push({ data: null, pulseStart: start, pulseEnd: this.pulses.length, std: false, desc, pause: !!pause });
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
    let i = 10, loopStart = -1, loopCount = 0, n = 0;
    const firstBlock = [], selects = []; // per TZX block: the first of our blocks at or after it; select blocks
    while (i < buf.length) {
      const id = buf[i++];
      const start = t.pulses.length;
      firstBlock[n++] = t.blocks.length;
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
          if (pause) t.addPause(pause); else t.pulses.push(STOP);
          t.addOther(start, pause ? 'Pause' : 'Stop', pause > 0);
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
        case 0x28: {                                 // select block: the parts of the tape
          let p = i + 3;
          for (let k = 0; k < buf[i + 2]; k++) {
            const rel = (w(p) << 16) >> 16, len = buf[p + 2];
            selects.push({ name: String.fromCharCode.apply(null, buf.subarray(p + 3, p + 3 + len)).trim(), at: n - 1 + rel });
            p += 3 + len;
          }
          i += 2 + w(i);
          break;
        }
        case 0x2a: t.pulses.push(STOP48); i += 4; break; // stop the tape if in 48K mode
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
    firstBlock[n] = t.blocks.length;
    for (const s of selects) {
      const block = firstBlock[Math.max(0, Math.min(n, s.at))];
      if (block < t.blocks.length) t.parts.push({ name: s.name || 'Part ' + (t.parts.length + 1), block });
    }
    t.rewind();
    return t;
  }
}

// Several tape files (sides, or 48K and 128K versions) as one TZX: a select block names the parts,
// and the tape stops between them. files: [{ name, bytes }] in order; labels: the part names.
function combineTapes(files, labels) {
  const join = parts => { // Uint8Arrays and arrays of bytes into one Uint8Array
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const u16 = v => [v & 0xff, (v >> 8) & 0xff];
  const bodies = files.map(f => {
    if (/\.tzx$/i.test(f.name)) return f.bytes.subarray(10);
    const b = [];
    for (let i = 0; i + 2 <= f.bytes.length;) { // TAP blocks as TZX standard speed blocks
      const len = f.bytes[i] | (f.bytes[i + 1] << 8);
      if (!len || i + 2 + len > f.bytes.length) break;
      b.push([0x10, ...u16(1000), ...u16(len)], f.bytes.subarray(i + 2, i + 2 + len));
      i += 2 + len;
    }
    return join(b);
  });
  // the select block, then each part followed by a "stop the tape"; offsets count TZX blocks
  const count = body => { let k = 0; for (let i = 0; i < body.length; k++) i = tzxNext(body, i); return k; };
  const sel = [];
  let rel = 1;
  bodies.forEach((body, k) => {
    const text = Array.from(String(labels[k]).slice(0, 30), c => c.charCodeAt(0) & 0x7f);
    sel.push(...u16(rel), text.length, ...text);
    rel += count(body) + 1;
  });
  const parts = [[...'ZXTape!'].map(c => c.charCodeAt(0)).concat([0x1a, 1, 20, 0x28, ...u16(sel.length + 1), bodies.length], sel)];
  for (const body of bodies) parts.push(body, [0x20, 0, 0]);
  return join(parts);
}
// the position after the TZX block that starts at i (its ID byte)
function tzxNext(b, i) {
  const w = k => b[k] | (b[k + 1] << 8), w3 = k => w(k) | (b[k + 2] << 16), dw = k => w(k) + w(k + 2) * 65536;
  const id = b[i++];
  switch (id) {
    case 0x10: return i + 4 + w(i + 2);
    case 0x11: return i + 18 + w3(i + 15);
    case 0x12: return i + 4;
    case 0x13: return i + 1 + b[i] * 2;
    case 0x14: return i + 10 + w3(i + 7);
    case 0x15: return i + 8 + w3(i + 5);
    case 0x18: case 0x19: return i + 4 + dw(i);
    case 0x20: case 0x23: case 0x24: return i + 2;
    case 0x21: case 0x30: return i + 1 + b[i];
    case 0x22: case 0x25: case 0x27: return i;
    case 0x26: return i + 2 + w(i) * 2;
    case 0x28: case 0x32: return i + 2 + w(i);
    case 0x2a: return i + 4;
    case 0x2b: return i + 5;
    case 0x31: return i + 2 + b[i + 1];
    case 0x33: return i + 1 + b[i] * 3;
    case 0x35: return i + 0x14 + dw(i + 0x10);
    case 0x5a: return i + 9;
    default: return b.length; // unknown: the rest is one block
  }
}
// the model a part is for, from its name: 128, 48 or 0 (not said)
const partMachine = name => /128/.test(name) ? 128 : /48/.test(name) ? 48 : 0;

function describeBlock(d) {
  if (d[0] === 0 && d.length === 19) {
    const types = ['Program', 'Number array', 'Character array', 'Bytes'];
    const name = String.fromCharCode.apply(null, d.subarray(2, 12)).trimEnd();
    return (types[d[1]] || 'Header') + ': ' + name;
  }
  return 'Data (' + (d.length - 2) + ' bytes)';
}

if (typeof module !== 'undefined') module.exports = { Tape, combineTapes, partMachine };
