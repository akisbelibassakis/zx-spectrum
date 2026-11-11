// AY-3-8912 sound chip of the Spectrum 128: three square-wave tones, a noise generator and the envelope.
// The chip runs at half the CPU clock; its tone counters step every 8 chip clocks = 16 CPU T-states.
'use strict';

const AY_TICK_T = 16;
// output level for each of the 16 volume steps (measured, roughly logarithmic), normalised to 0..1
const AY_LEVELS = [0, .0137, .0205, .0291, .0423, .0618, .0847, .1369, .1691, .2647, .3527, .4499, .5704, .6873, .8482, 1];

// envelope shapes as 64 steps: steps 0-31 play once, then 32-63 repeat
const AY_ENVELOPES = [];
for (let shape = 0; shape < 16; shape++) {
  const down = [...Array(16).keys()].reverse(), up = [...Array(16).keys()];
  const fill = v => Array(16).fill(v);
  let first, loop;
  if (shape < 4 || shape === 9) { first = down.concat(fill(0)); loop = fill(0).concat(fill(0)); }
  else if (shape < 8 || shape === 15) { first = up.concat(fill(0)); loop = fill(0).concat(fill(0)); }
  else if (shape === 8) { first = loop = down.concat(down); }
  else if (shape === 10) { first = loop = down.concat(up); }
  else if (shape === 11) { first = down.concat(fill(15)); loop = fill(15).concat(fill(15)); }
  else if (shape === 12) { first = loop = up.concat(up); }
  else if (shape === 13) { first = up.concat(fill(15)); loop = fill(15).concat(fill(15)); }
  else { first = loop = up.concat(down); } // 14
  AY_ENVELOPES.push(Uint8Array.from(first.concat(loop)));
}

class AY {
  constructor() { this.reset(); }

  reset() {
    this.regs = new Uint8Array(16);
    this.selected = 0;
    this.toneCount = [0, 0, 0];
    this.toneOut = [0, 0, 0];
    this.noiseCount = 0;
    this.rng = 1;
    this.noiseOut = 0;
    this.envCount = 0;
    this.envPos = 0;
    this.level = 0;
    this.acc = 0;     // output level integrated over T-states since the last audio sample
    this.lastT = 0;
    this.nextTickT = AY_TICK_T;
  }

  select(v) { this.selected = v & 15; }
  read() { return this.regs[this.selected]; }
  write(v, t) {
    this.run(t);
    const r = this.selected;
    const masks = [255, 15, 255, 15, 255, 15, 31, 255, 31, 31, 31, 255, 255, 15, 255, 255];
    this.regs[r] = v & masks[r];
    if (r === 13) { this.envPos = 0; this.envCount = 0; }
    this.mix();
  }

  // advance the chip to CPU time t, integrating its output level
  run(t) {
    while (this.nextTickT <= t) {
      this.acc += this.level * (this.nextTickT - this.lastT);
      this.lastT = this.nextTickT;
      this.tick();
      this.nextTickT += AY_TICK_T;
    }
    if (t > this.lastT) { this.acc += this.level * (t - this.lastT); this.lastT = t; }
  }
  endFrame(frameT) { this.lastT -= frameT; this.nextTickT -= frameT; }

  tick() {
    const r = this.regs;
    for (let c = 0; c < 3; c++) {
      const period = (r[c * 2] | (r[c * 2 + 1] << 8)) || 1;
      if (++this.toneCount[c] >= period) { this.toneCount[c] = 0; this.toneOut[c] ^= 1; }
    }
    if (++this.noiseCount >= 2 * (r[6] || 1)) {
      this.noiseCount = 0;
      const bit = (this.rng ^ (this.rng >> 3)) & 1;
      this.rng = (this.rng >> 1) | (bit << 16);
      this.noiseOut = this.rng & 1;
    }
    if (++this.envCount >= 2 * ((r[11] | (r[12] << 8)) || 1)) {
      this.envCount = 0;
      if (++this.envPos >= 64) this.envPos = 32;
    }
    this.mix();
  }

  mix() {
    const r = this.regs, env = AY_ENVELOPES[r[13]][this.envPos];
    let out = 0;
    for (let c = 0; c < 3; c++) {
      const on = (this.toneOut[c] | ((r[7] >> c) & 1)) & (this.noiseOut | ((r[7] >> (c + 3)) & 1));
      if (on) out += AY_LEVELS[r[8 + c] & 16 ? env : r[8 + c] & 15];
    }
    this.level = out / 3;
  }
}

if (typeof module !== 'undefined') module.exports = { AY };
