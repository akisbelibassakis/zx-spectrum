// Browser front end: canvas, keyboard, audio, file loading, controls.
'use strict';

const $ = id => document.getElementById(id);
const canvas = $('screen'), ctx2d = canvas.getContext('2d');
canvas.width = SCREEN_W; canvas.height = SCREEN_H;
const image = ctx2d.createImageData(SCREEN_W, SCREEN_H);
const imageU32 = new Uint32Array(image.data.buffer);

let audioCtx = null, nextAudioTime = 0, soundOn = true;
// Models: the Spectrum+ is a 48K in the Spectrum+ case, with the 128's keyboard layout
const MODELS = { 48: { name: 'ZX Spectrum 48K', hw: 48 }, plus: { name: 'ZX Spectrum+', hw: 48 }, 128: { name: 'ZX Spectrum 128K', hw: 128 } };
let model = savedModel();
const zx = new Spectrum(44100, MODELS[model].hw);
let paused = false, turbo = false, lastTime = 0, frameDebt = 0, lastName = '';
// recorder and joystick settings, remembered in this browser
const settings = Object.assign({ speed: 2, autoLoad: true, joy: false, volume: 0.7, colour: 0.5, picture: 'colour' }, (() => {
  try { return JSON.parse(localStorage.getItem('zxSettings')) || {}; } catch (e) { return {}; }
})());
function saveSettings() { try { localStorage.setItem('zxSettings', JSON.stringify(settings)); } catch (e) { /* storage unavailable */ } }

// the model from the address (?machine=48, plus or 128) or the one used last time
function savedModel() {
  const asked = new URLSearchParams(location.search).get('machine');
  if (MODELS[asked]) return asked;
  try {
    const m = localStorage.getItem('zxModel') || localStorage.getItem('zxMachine');
    if (MODELS[m]) return m;
  } catch (e) { /* storage unavailable */ }
  return '48';
}
const modelName = () => MODELS[model].name;
const MODEL_CHANNELS = ['48', 'plus', '128']; // TV channels 1-3

// ---------- keyboard ----------
const K = {
  CAPS: [0, 0], Z: [0, 1], X: [0, 2], C: [0, 3], V: [0, 4],
  A: [1, 0], S: [1, 1], D: [1, 2], F: [1, 3], G: [1, 4],
  Q: [2, 0], W: [2, 1], E: [2, 2], R: [2, 3], T: [2, 4],
  1: [3, 0], 2: [3, 1], 3: [3, 2], 4: [3, 3], 5: [3, 4],
  0: [4, 0], 9: [4, 1], 8: [4, 2], 7: [4, 3], 6: [4, 4],
  P: [5, 0], O: [5, 1], I: [5, 2], U: [5, 3], Y: [5, 4],
  ENTER: [6, 0], L: [6, 1], K: [6, 2], J: [6, 3], H: [6, 4],
  SPACE: [7, 0], SYM: [7, 1], M: [7, 2], N: [7, 3], B: [7, 4],
};
const keyMap = {
  ShiftLeft: [K.CAPS], ShiftRight: [K.SYM], ControlLeft: [K.SYM], ControlRight: [K.SYM], AltRight: [K.SYM],
  Enter: [K.ENTER], NumpadEnter: [K.ENTER], Space: [K.SPACE],
  Backspace: [K.CAPS, K[0]], Escape: [K.CAPS, K.SPACE], Tab: [K.CAPS, K.SYM], CapsLock: [K.CAPS, K[2]],
  ArrowLeft: [K.CAPS, K[5]], ArrowDown: [K.CAPS, K[6]], ArrowUp: [K.CAPS, K[7]], ArrowRight: [K.CAPS, K[8]],
  Comma: [K.SYM, K.N], Period: [K.SYM, K.M], Semicolon: [K.SYM, K.O], Quote: [K.SYM, K.P],
  Minus: [K.SYM, K.J], Equal: [K.SYM, K.L], Slash: [K.SYM, K.V],
};
for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') keyMap['Key' + ch] = [K[ch]];
// the 128's extra keys: each presses two keys of the 48K matrix
const COMBOS = {
  TRUEVID: ['CAPS', 3], INVVID: ['CAPS', 4], BREAK: ['CAPS', 'SPACE'], DELETE: ['CAPS', 0], GRAPH: ['CAPS', 9],
  EXTEND: ['CAPS', 'SYM'], EDIT: ['CAPS', 1], CAPSLOCK: ['CAPS', 2],
  LEFT: ['CAPS', 5], DOWN: ['CAPS', 6], UP: ['CAPS', 7], RIGHT: ['CAPS', 8],
  SEMI: ['SYM', 'O'], QUOTE: ['SYM', 'P'], DOT: ['SYM', 'M'], COMMA: ['SYM', 'N'],
};
for (const d of '0123456789') { keyMap['Digit' + d] = [K[d]]; keyMap['Numpad' + d] = [K[d]]; }

const kempstonMap = { ArrowRight: 1, ArrowLeft: 2, ArrowDown: 4, ArrowUp: 8, AltLeft: 16 }; // PC key -> joystick bit (right, left, down, up, fire)
// Key events are applied in order, at most as fast as the ROM's 50 Hz keyboard scan can see them:
// a key stays down for at least MIN_HOLD_FRAMES, and after such a short press the next key waits
// GAP_FRAMES, so fast typing (or pasted/automated input) is not lost or merged into a 2-key chord.
const pressed = new Map(); // event.code -> { keys, since: frame number } currently on the key matrix
const keyEvents = [];      // pending { code, down, blocked }
const MIN_HOLD_FRAMES = 3, GAP_FRAMES = 2;
let shortReleaseFrame = -100;

function applyMatrix() {
  zx.keys.fill(0xff);
  for (const p of pressed.values()) for (const [r, b] of p.keys) zx.setKey(r, b, true);
}
function processKeyEvents() {
  let changed = false;
  while (keyEvents.length) {
    const ev = keyEvents[0];
    if (ev.down) {
      if (!pressed.has(ev.code)) {
        if (zx.frames < shortReleaseFrame + GAP_FRAMES) break;
        pressed.set(ev.code, { keys: keyMap[ev.code], since: zx.frames });
        changed = true;
      }
    } else {
      const p = pressed.get(ev.code);
      if (p) {
        if (zx.frames < p.since + MIN_HOLD_FRAMES) { ev.blocked = true; break; }
        if (ev.blocked) shortReleaseFrame = zx.frames;
        pressed.delete(ev.code);
        changed = true;
      }
    }
    keyEvents.shift();
  }
  if (changed) applyMatrix();
}

// on-screen keyboard: name is a key of K, e.g. 'J' or 'CAPS', or of COMBOS, e.g. 'DELETE'
function virtualKey(name, down) {
  if (typeof screenMenuSpectrumKey === 'function' && screenMenuSpectrumKey(name, down)) return; // a menu is on the screen
  const code = 'vk:' + name;
  keyMap[code] = COMBOS[name] ? COMBOS[name].map(n => K[n]) : [K[name]];
  keyEvents.push({ code, down, blocked: false });
  processKeyEvents();
  if (down) startAudio();
}

function onKey(e, down) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (SHORTCUTS[e.code] && !e.ctrlKey && !e.altKey) { // emulator shortcuts on the function keys
    e.preventDefault();
    if (down && !e.repeat) SHORTCUTS[e.code][1]();
    return;
  }
  if (typeof overlayKey === 'function' && overlayKey(e, down)) return; // the manual or a menu on the screen is open
  if (settings.joy && kempstonMap[e.code] !== undefined) {
    setJoyBits(down ? joyBits | kempstonMap[e.code] : joyBits & ~kempstonMap[e.code]);
    e.preventDefault();
    return;
  }
  if (!keyMap[e.code]) return;
  e.preventDefault();
  if (down && e.repeat) return; // the ROM does its own auto-repeat
  keyEvents.push({ code: e.code, down, blocked: false });
  processKeyEvents();
  if (down) startAudio();
}
window.addEventListener('keydown', e => onKey(e, true));
window.addEventListener('keyup', e => onKey(e, false));
window.addEventListener('blur', () => { pressed.clear(); keyEvents.length = 0; zx.keys.fill(0xff); zx.kempston = 0; joyBits = 0; });

// ---------- audio ----------
function startAudio() {
  if (audioCtx || !soundOn) { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); return; }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    zx.setSampleRate(audioCtx.sampleRate);
    audioGain = audioCtx.createGain();
    audioGain.gain.value = volume;
    audioGain.connect(audioCtx.destination);
    nextAudioTime = 0;
  } catch (e) { audioCtx = null; }
}
let audioGain = null, volume = 0.7;
function setVolume(v) {
  volume = v;
  if (audioGain) audioGain.gain.value = v;
}
function playAudio(samples) {
  if (!audioCtx || !soundOn || audioCtx.state !== 'running' || !samples.length) return;
  const now = audioCtx.currentTime;
  if (nextAudioTime < now + 0.02 || nextAudioTime > now + 0.3) nextAudioTime = now + 0.06;
  const buf = audioCtx.createBuffer(1, samples.length, audioCtx.sampleRate);
  buf.getChannelData(0).set(samples);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioGain);
  src.start(nextAudioTime);
  nextAudioTime += buf.duration;
}

// ---------- main loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  if (!lastTime) lastTime = now;
  const dt = Math.min(now - lastTime, 100);
  lastTime = now;
  updateTapeStatus();
  if (paused || frozen || !zx.romLoaded) return;
  const FPS = zx.cpuHz / zx.frameT;

  const fast = turbo || (settings.speed >= 1 && ((zx.tape && zx.tape.playing) || zx.saving));
  if (fast && settings.speed === 2 && !turbo && zx.tape && zx.tape.playing) {
    // INSTANT with a loader of its own (the ROM's are trapped): as many frames as fit, without sound
    // or pictures, until the tape stops; then one picture
    const end = performance.now() + 30;
    do { processKeyEvents(); zx.runFrame(true); } while (performance.now() < end && zx.tape && zx.tape.playing && !frozen);
    zx.renderScreen();
  } else if (fast) {
    const end = performance.now() + 12;
    do { processKeyEvents(); zx.runFrame(); } while (performance.now() < end);
  } else {
    frameDebt += dt * FPS / 1000;
    let n = Math.min(Math.floor(frameDebt), 4);
    frameDebt -= n;
    if (frameDebt > 4) frameDebt = 0;
    while (n-- > 0) { processKeyEvents(); playAudio(zx.runFrame()); }
  }
  imageU32.set(zx.screen);
  ctx2d.putImageData(image, 0, 0);
}
requestAnimationFrame(frame);

// ---------- files ----------
function extOf(name) { const m = /\.([^.]+)$/.exec(name); return m ? m[1].toLowerCase() : ''; }

// messages appear briefly on the TV picture
let osdTimer = 0;
function status(msg, isError) {
  const el = $('osd');
  el.textContent = msg.toUpperCase();
  el.classList.toggle('error', !!isError);
  el.classList.add('show');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => el.classList.remove('show'), isError ? 5000 : 2500);
}

function bootFast(in48) {
  // run the ROM start-up instantly so the auto-typed command is not lost; in48: a 128K in 48 BASIC
  if (in48) zx.boot48(); else zx.reset();
  for (let i = 0; i < (zx.is128 && !in48 ? 150 : 120); i++) zx.runFrame();
}
// AUTO LOAD: reset and load the tape. A tape in parts starts at the part for this model (48K or 128K version);
// on the 128K a tape for the 48K loads in 48 BASIC, as many 48K games need. machine: what the tape is for, if known
function autoLoad(tape, machine) {
  let part = -1;
  if (tape.parts.length) {
    part = tape.parts.findIndex(p => partMachine(p.name) === zx.machine);
    if (part < 0) part = tape.parts.findIndex(p => partMachine(p.name) !== (zx.is128 ? 48 : 128));
    if (part < 0) part = 0;
  }
  const forModel = (part >= 0 && partMachine(tape.parts[part].name)) || machine || partMachine(tape.name);
  const in48 = zx.is128 && forModel === 48;
  bootFast(in48);
  if (part > 0) tape.windTo(tape.parts[part].block);
  // 128K: ENTER picks "Tape Loader" on the start-up menu; 48K (and 48 BASIC): LOAD "" ENTER (J, then SYMBOL SHIFT+P twice)
  if (zx.is128 && !in48) zx.typeKeys([{ keys: [K.ENTER] }]);
  else zx.typeKeys([{ keys: [K.J] }, { keys: [K.SYM, K.P] }, { keys: [K.SYM, K.P] }, { keys: [K.ENTER] }]);
  renderTapeBlocks();
  if (!zx.is128 && forModel === 128) status('This tape is for the 128K (channel 3)', true);
  else status(part >= 0 ? 'Loading: ' + tape.parts[part].name : in48 ? 'Loading in 48 BASIC' : 'Tape inserted');
}

// switch model: resets the machine and shows its case and keyboard
function setModel(m) {
  model = MODELS[m] ? String(m) : '48';
  if (zx.machine !== MODELS[model].hw) zx.setMachine(MODELS[model].hw); else zx.reset();
  showMachine();
  try { localStorage.setItem('zxModel', model); } catch (e) { /* storage unavailable */ }
}
// after a ROM or snapshot changed the hardware: the model follows it (a Spectrum+ stays a Spectrum+ on 48K hardware)
function followHardware() {
  if (MODELS[model].hw === zx.machine) return;
  model = zx.machine === 128 ? '128' : '48';
  try { localStorage.setItem('zxModel', model); } catch (e) { /* storage unavailable */ }
}
function showMachine() {
  document.title = modelName();
  if (typeof showKeyboard === 'function') showKeyboard(model);
  if (typeof tuneTo === 'function') tuneTo(MODEL_CHANNELS.indexOf(model) + 1);
  if (!zx.romLoaded) { $('romNote').hidden = false; status('No ' + zx.name + ' ROM yet - open or drop it.', true); }
  else { $('romNote').hidden = true; status(modelName()); }
}

// opts.machine: the model the file is for, when the catalogue or the rack knows it (48, 128 or 0)
function loadFile(name, bytes, opts = {}) {
  const ext = extOf(name);
  try {
    if (ext === 'rom' || ((bytes.length === 16384 || bytes.length === 32768) && !['tap', 'tzx', 'sna', 'z80'].includes(ext))) {
      const m = zx.loadROM(bytes);
      saveROM(m, bytes);
      if (zx.machine !== m) { zx.setMachine(m); followHardware(); } else zx.reset();
      showMachine();
      status('ROM loaded: ' + name);
      return;
    }
    if (ext === 'zxtapes') { const msg = loadBackup(bytes); status(msg.replace(/^!/, ''), msg.startsWith('!')); return false; } // a backup of the rack
    if (!zx.romLoaded) { status('Load the ' + zx.name + ' ROM first.', true); return; }
    if (ext === 'tap' || ext === 'tzx') {
      const tape = ext === 'tap' ? Tape.fromTAP(bytes, name) : Tape.fromTZX(bytes, name);
      zx.insertTape(tape);
      renderTapeBlocks();
      if (settings.autoLoad) autoLoad(tape, opts.machine || 0);
      else status(tape.parts.length ? 'Tape inserted: ' + tape.parts.length + ' parts' : 'Tape inserted');
    } else if (ext === 'sna' || ext === 'z80') {
      const before = zx.machine;
      if (ext === 'sna') zx.loadSNA(bytes); else zx.loadZ80(bytes);
      if (zx.machine !== before) { followHardware(); showMachine(); }
      status('Snapshot loaded: ' + name + (zx.machine !== before ? ' (switched to the ' + modelName() + ')' : ''));
    } else {
      status('Unknown file type: ' + name, true);
      return;
    }
    lastName = name;
  } catch (e) {
    status(e.message, true);
    return false;
  }
  startAudio();
  return true;
}

function readFile(file) {
  const fr = new FileReader();
  fr.onload = () => {
    const bytes = new Uint8Array(fr.result);
    if (loadFile(file.name, bytes) && /\.(tap|tzx|sna|z80)$/i.test(file.name)) rackOffer({ name: file.name, bytes, source: 'file' });
  };
  fr.readAsArrayBuffer(file);
}

$('fileInput').addEventListener('change', e => { for (const f of e.target.files) readFile(f); e.target.value = ''; });
document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drag'); });
document.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('drag');
  // ROMs first, so a ROM and a game can be dropped together
  const files = [...e.dataTransfer.files].sort((a, b) => (extOf(b.name) === 'rom') - (extOf(a.name) === 'rom'));
  for (const f of files) readFile(f);
});

// ROMs: remembered in this browser; otherwise from js/rom48.js / rom128.js (pages opened from disk can't fetch())
// or from roms/48.rom / roms/128.rom
const ROM_SOURCES = { 48: { key: 'zx48rom', script: 'ZX48_ROM', file: 'roms/48.rom' },
  128: { key: 'zx128rom', script: 'ZX128_ROM', file: 'roms/128.rom' } };
const fromBase64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function saveROM(m, bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  try { localStorage.setItem(ROM_SOURCES[m].key, btoa(s)); } catch (e) { /* storage unavailable */ }
}
async function findROM(m) {
  const src = ROM_SOURCES[m];
  try { const s = localStorage.getItem(src.key); if (s) return fromBase64(s); } catch (e) { /* ignore */ }
  if (window[src.script]) return fromBase64(window[src.script]);
  try {
    const r = await fetch(src.file);
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
  } catch (e) { /* file:// or missing */ }
  return null;
}
async function initROMs() {
  for (const m of [48, 128]) {
    const bytes = await findROM(m);
    if (bytes) { zx.loadROM(bytes); saveROM(m, bytes); }
  }
  zx.reset();
  showMachine();
}
initROMs();

// ---------- controls: everything is a piece of hardware on the desk ----------
function reset() { frozen && freeze(false); zx.reset(); renderTapeBlocks(); startAudio(); lastTitle = ''; } // a fresh start: what you SAVE now goes on My programs
$('btnReset').onclick = reset;
function saveSnapshot() {
  if (!zx.romLoaded) return;
  const blob = new Blob([zx.saveSNA()], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (lastName.replace(/\.[^.]+$/, '') || 'snapshot') + '.sna';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const openFile = () => $('fileInput').click();
function fullScreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if ($('crt').requestFullscreen) $('crt').requestFullscreen();
}
$('btnZoom').onclick = fullScreen;
// full screen shows only the TV picture: the touch joystick goes in with it, and comes back out after
document.addEventListener('fullscreenchange', () => {
  const tj = $('touchJoy');
  if (document.fullscreenElement === $('crt')) $('crt').appendChild(tj); else document.body.insertBefore(tj, document.body.querySelector('script'));
});
canvas.addEventListener('dblclick', fullScreen);

// recorder: SPEED switch (normal / fast / instant) and AUTO LOAD
function setSpeed(n) { settings.speed = n; zx.fastLoad = n === 2; $('speed').dataset.pos = n; saveSettings(); }
// a click on a word picks that speed; on the knob it moves one step along; on the slot it jumps to the nearest position
$('speed').addEventListener('click', e => {
  const mark = e.target.closest('.marks [data-pos]'); // not #speed itself, which also carries data-pos
  if (mark) { setSpeed(+mark.dataset.pos); return; }
  if (e.target.closest('.sknob')) { setSpeed((settings.speed + 1) % 3); return; }
  const r = $('speed').querySelector('.slot').getBoundingClientRect();
  if (!r.width || !r.height) { setSpeed((settings.speed + 1) % 3); return; }
  // the recorder may be turned 90 degrees (phones in portrait): then the slot runs downwards
  const t = r.height > r.width ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
  setSpeed(Math.max(0, Math.min(2, Math.round(t * 2))));
});
function setAutoLoad(on) { settings.autoLoad = on; $('autoLoad').setAttribute('aria-pressed', on); saveSettings(); }
$('autoLoad').onclick = () => setAutoLoad(!settings.autoLoad);
setSpeed(settings.speed);
setAutoLoad(settings.autoLoad);

let tapePaused = false;
function playTape() { if (zx.tape) { tapePaused = false; zx.tape.held = false; zx.playTape(false); } startAudio(); }
$('btnPlay').onclick = playTape;
$('btnTapePause').onclick = () => {
  if (!zx.tape) return;
  if (zx.tape.playing) { zx.tape.playing = false; zx.tape.held = tapePaused = true; } else if (tapePaused) playTape();
};
$('btnFF').onclick = () => { if (zx.tape) zx.tape.skipBlock(); };
$('btnRewind').onclick = () => { setRec(false); if (zx.tape) { zx.tape.rewind(); tapePaused = false; } };
// STOP/EJECT: stops a playing tape; pressed again it ejects the tape and opens another
$('btnEject').onclick = () => {
  if (recArmed) { setRec(false); status('Recording stopped'); return; }
  if (zx.tape && (zx.tape.playing || tapePaused)) { zx.tape.playing = false; zx.tape.held = true; tapePaused = false; return; } // stays stopped until PLAY
  if (zx.tape) { zx.tape = null; renderTapeBlocks(); }
  openFile();
};
// the cassette door: shows the tape's contents, or with no tape in opens the software catalogue
$('door').onclick = () => { if (zx.tape) $('tapeBlocks').hidden = !$('tapeBlocks').hidden; else openCatalogue(); };
document.addEventListener('pointerdown', e => { if (!e.target.closest('#door, #tapeBlocks')) $('tapeBlocks').hidden = true; });

// tape counter and the tape packs on the reels follow the tape position
let counterZero = 0, shownCount = -1, shownF = -1;
const tapeFraction = () => { const t = zx.tape; return t && t.pulses.length ? Math.min(1, t.pos / t.pulses.length) : 0; };
function updateCounter() {
  const f = tapeFraction();
  if (Math.abs(f - shownF) > .002) { $('deck').style.setProperty('--f', f.toFixed(3)); shownF = f; }
  const c = zx.tape ? (Math.floor(f * 999) - counterZero + 1000) % 1000 : 0;
  if (c === shownCount) return;
  shownCount = c;
  const d = String(c).padStart(3, '0');
  [...$('counter').children].forEach((el, i) => { el.textContent = d[i]; });
}
$('counterReset').onclick = () => { counterZero = Math.floor(tapeFraction() * 999); };

let shownBlock = -1, shownPlaying = null;
function renderTapeBlocks() {
  const list = $('tapeBlocks');
  list.innerHTML = '';
  list.hidden = true;
  shownBlock = -1; shownPlaying = null; counterZero = 0; tapePaused = false;
  if (!zx.tape) {
    $('tapeState').textContent = '';
    $('deck').classList.remove('loaded', 'playing');
    $('btnPlay').classList.remove('on');
    $('btnTapePause').classList.remove('on');
    return;
  }
  $('deck').classList.add('loaded');
  const head = document.createElement('li');
  head.className = 'head';
  head.textContent = zx.tape.name;
  list.appendChild(head);
  zx.tape.blocks.forEach((b, i) => {
    const part = zx.tape.parts.find(p => p.block === i);
    if (part) { // a part of the tape (48K or 128K version, a side): a heading that winds to it
      const h = document.createElement('li');
      h.className = 'part';
      h.textContent = part.name;
      h.onclick = () => { zx.tape.windTo(i); updateTapeStatus(); status('Wound to: ' + part.name); };
      list.appendChild(h);
    }
    const li = document.createElement('li');
    li.textContent = b.desc;
    li.dataset.block = i;
    li.onclick = () => { zx.tape.windTo(i); updateTapeStatus(); };
    list.appendChild(li);
  });
  updateTapeStatus();
}
function updateTapeStatus() {
  updateCounter();
  const t = zx.tape;
  if (!t) return;
  const state = t.playing + ':' + tapePaused + ':' + recArmed + ':' + !!zx.saving;
  if (t.blockIdx === shownBlock && state === shownPlaying) return;
  shownBlock = t.blockIdx; shownPlaying = state;
  const items = $('tapeBlocks').children;
  for (const li of items) if (li.dataset.block) li.classList.toggle('current', +li.dataset.block === t.blockIdx);
  const part = t.parts[t.partAt(t.blockIdx)];
  $('tapeState').textContent = (t.name.replace(/\.[^.]+$/, '') + (part ? ' - ' + part.name : '')).toUpperCase();
  $('btnPlay').classList.toggle('on', t.playing || tapePaused || recArmed);
  $('btnTapePause').classList.toggle('on', tapePaused);
  $('deck').classList.toggle('playing', t.playing || !!zx.saving);
}

// ---------- recording, as in 1982: press REC (REC and PLAY go down together), then let the computer SAVE ----------
// The recorder holds a tape of your own while it records: this game's saves tape, or My programs after a reset.
let recArmed = false, declineSaveUntil = 0, declineLoadUntil = 0;
function setRec(on) {
  recArmed = on;
  $('btnRec').classList.toggle('on', on);
  if (!on) $('btnPlay').classList.toggle('on', !!(zx.tape && (zx.tape.playing || tapePaused)));
  shownPlaying = null; // redraw the keys
}
function pressRec() {
  if (!zx.romLoaded) return;
  if (recArmed) { setRec(false); status('Recording stopped'); return; }
  const title = startRecording(); // tapes.js: puts the tape to record on into the recorder, wound to its end
  setRec(true);
  status('REC: ' + title);
  startAudio();
}
$('btnRec').onclick = pressRec;
const headerName = b => b.length === 19 && b[0] === 0 ? String.fromCharCode(...b.subarray(2, 12)).trim() : '';
zx.onSave = cpu => {
  if (frozen) return zx.holdHere(cpu);
  if (!recArmed) {
    if (zx.frames < declineSaveUntil) return zx.skipTapeRoutine(cpu, true); // "do not record": nothing goes on tape
    openScreenMenu(recordMenu); // REC is not pressed: ask, on the screen (works in full screen too)
    return zx.holdHere(cpu);
  }
  const block = zx.saveBlock(cpu);
  recordBlock(block); // tapes.js: onto the tape in the recorder, and the rack
  const name = headerName(block);
  status(name ? 'Recording: ' + name : 'Recorded ' + (block.length - 2) + ' bytes');
  if (zx.fastLoad) return zx.skipTapeRoutine(cpu, true); // INSTANT: done
  zx.saving = true; // NORMAL / FAST: the ROM saves in its own time, stripes and all
  return false;
};
// the computer wants to LOAD but there is nothing to load: the screen offers a tape (or to rewind this one)
const isTapeFile = t => t && /\.(tap|tzx)$/i.test(t.name);
zx.onNothingToLoad = cpu => {
  if (frozen) return zx.holdHere(cpu);
  if (zx.frames < declineLoadUntil || (!(zx.tape && zx.tape.blocks.length) && !tapes.some(isTapeFile))) return false;
  setRec(false);
  loadMenu.sel = 0;
  openScreenMenu(loadMenu);
  return zx.holdHere(cpu);
};
// a game's own loader waits at the end of the tape (a multi-load wanting a level, or the other side): the same offer,
// with the tape's parts; once declined it is not offered again until the tape moves
let endDeclined = null;
zx.onTapeEnd = () => {
  if (frozen || screenMenuOpen() || (zx.tape && endDeclined === zx.tape && zx.tape.atEnd)) return;
  setRec(false);
  loadMenu.sel = 0; loadMenu.atEnd = true;
  openScreenMenu(loadMenu);
};
const recordMenu = {
  sel: 0,
  draw(s) {
    const c = 3, w = 26, top = 7;
    s.bar(top, 2 + 8, c, w); s.print(c + 1, top, 'Datacorder', 7 + 8, 2 + 8);
    s.bar(top + 1, 7, c, w); s.print(c + 1, top + 1, 'The computer is saving,', 0);
    s.bar(top + 2, 7, c, w); s.print(c + 1, top + 2, 'but REC is not pressed.', 0);
    s.bar(top + 3, 7, c, w);
    ['REC   record it', 'BREAK do not record'].forEach((label, i) => {
      const paper = i === this.sel ? 5 + 8 : 7;
      s.bar(top + 4 + i, paper, c, w); s.print(c + 1, top + 4 + i, label, i ? 1 : 2, paper);
    });
    s.bar(top + 6, 7, c, w);
    s.bar(top + 7, 0, c, w); s.print(c + 1, top + 7, 'ENTER pick', 7, 0);
  },
  key(k) {
    if (k === 'UP' || k === 'DOWN') this.sel ^= 1;
    else if (k === 'ENTER') this.choose(this.sel);
    else if (k === 'BREAK' || k === 'CHAR:n' || k === 'CHAR:N') this.choose(1);
    else if (k === 'CHAR:r' || k === 'CHAR:R') this.choose(0);
  },
  click(col, row) { if (row === 11) this.choose(0); else if (row === 12) this.choose(1); },
  choose(i) {
    closeScreenMenu();
    if (i === 0) pressRec(); else { declineSaveUntil = zx.frames + 250; status('Not recorded'); }
    this.sel = 0;
  },
};
const loadMenu = {
  full: true, sel: 0, atEnd: false,
  // this tape: rewind, or wind to one of its parts; then the rack's tapes (this bank first), as many as fit
  items() {
    const list = [];
    if (zx.tape && zx.tape.blocks.length) {
      list.push({ act: 'rewind', label: 'Rewind: ' + zx.tape.name.replace(/\.[^.]+$/, '') });
      zx.tape.parts.forEach((p, i) => { if (p.block > 0) list.push({ act: 'part', part: i, label: 'Wind to: ' + p.name }); });
    }
    rackOrder().forEach(i => { if (isTapeFile(tapes[i]) && list.length < 16) list.push({ slot: i, label: slotName(i) + ' ' + tapes[i].title }); });
    return list;
  },
  draw(s) {
    s.bar(0, 0); s.print(1, 0, 'Datacorder', 7, 0); s.stripes(27, 0);
    s.print(1, 2, this.atEnd ? 'The tape has run out, but the' : 'The computer is waiting to', 0);
    s.print(1, 3, this.atEnd ? 'game wants more. Which part?' : 'LOAD. Which tape goes in?', 0);
    this.items().forEach((it, i) => {
      const paper = i === this.sel ? 5 + 8 : 7;
      s.bar(5 + i, paper); s.print(1, 5 + i, fit(it.label, 30), it.act ? 1 : 0, paper);
    });
    s.bar(23, 0); s.print(0, 23, 'ENTER put it in   BREAK wait', 7, 0);
  },
  key(k) {
    const n = this.items().length;
    if (k === 'UP') this.sel = (this.sel + n - 1) % n;
    else if (k === 'DOWN') this.sel = (this.sel + 1) % n;
    else if (k === 'ENTER') this.choose(this.sel);
    else if (k === 'BREAK') this.choose(-1);
    else if (/^CHAR:[1-8]$/.test(k)) { const i = this.items().findIndex(x => x.slot === rackBank * RACK_SIZE + +k.slice(5) - 1); if (i >= 0) this.choose(i); }
  },
  click(col, row) { const i = row - 5; if (i >= 0 && i < this.items().length) this.choose(i); },
  choose(i) {
    const it = this.items()[i];
    closeScreenMenu();
    if (!it) { // wait: the ROM listens for a tape, BREAK stops it; a game's loader just goes on waiting
      if (this.atEnd) endDeclined = zx.tape; else declineLoadUntil = zx.frames + 50;
      this.atEnd = false;
      return;
    }
    this.atEnd = false;
    if (it.act === 'rewind') { zx.tape.rewind(); renderTapeBlocks(); status('Rewound'); }
    else if (it.act === 'part') { const p = zx.tape.parts[it.part]; zx.tape.windTo(p.block); renderTapeBlocks(); status('Wound to: ' + p.name); }
    else insertRackTape(tapes[it.slot]); // tapes.js: in, rewound, without resetting the computer
  },
};

// Multiface One: the red button freezes the computer and shows its menu on the screen (screenmenu.js)
let frozen = false; // true while any menu is on the screen
function freeze(on) {
  if (on) { multifaceMenu.sel = 0; openScreenMenu(multifaceMenu); } else closeScreenMenu();
}
$('mfButton').onclick = () => { if (!frozen || screenMenu === multifaceMenu) freeze(!frozen); };
function mfAction(act) {
  if (act === 'turbo') { turbo = !turbo; return; }
  freeze(false);
  if (act === 'save') {
    saveSnapshot();
    if (zx.romLoaded) rackOffer({ title: (lastTitle || 'Snapshot') + ' (saved)', name: (lastName.replace(/\.[^.]+$/, '') || 'snapshot') + '-save.sna', bytes: zx.saveSNA(), source: 'multiface' });
  }
  else if (act === 'load') openFile();
  else if (act === 'reset') reset();
}

// joystick: plugged in, the arrow keys and Left Alt (or the touch stick and FIRE) work it. Three kinds, as games asked for them:
// Kempston has its own port (31); Sinclair (Interface 2, player 1) and Cursor (Protek/AGF) press number keys
const JOY_TYPES = ['kempston', 'sinclair', 'cursor'];
const JOY_NAMES = { kempston: 'KEMPSTON', sinclair: 'SINCLAIR', cursor: 'CURSOR' };
const JOY_KEYS = { // joystick bit -> Spectrum key
  sinclair: { 1: '7', 2: '6', 4: '8', 8: '9', 16: '0' },
  cursor:   { 1: '8', 2: '5', 4: '6', 8: '7', 16: '0' },
};
let joyBits = 0; // from the PC keys or the touch stick: right 1, left 2, down 4, up 8, fire 16
let padBits = 0; // from a real joystick or gamepad
function setJoyBits(bits) {
  joyBits = bits;
  bits |= padBits;
  const map = JOY_KEYS[settings.joy];
  if (!map) { zx.kempston = settings.joy ? bits : 0; return; }
  for (const bit in map) {
    const code = 'joy:' + bit;
    if (bits & bit) { if (!pressed.has(code)) pressed.set(code, { keys: [K[map[bit]]], since: zx.frames }); }
    else pressed.delete(code);
  }
  applyMatrix();
}
function setJoy(type) {
  if (type === true) type = 'kempston'; // settings saved before there were three kinds
  if (!JOY_TYPES.includes(type)) type = false;
  padBits = 0; setJoyBits(0); // let go of everything with the old kind
  settings.joy = type;
  const j = $('joystick'), next = JOY_TYPES[JOY_TYPES.indexOf(type) + 1];
  j.classList.toggle('on', !!type);
  j.setAttribute('aria-pressed', !!type);
  j.querySelector('.jtype').textContent = type ? JOY_NAMES[type] : '';
  j.dataset.tip = (type ? 'Joystick: ' + JOY_NAMES[type] + '. Click: ' + (next ? JOY_NAMES[next] : 'unplug') : 'Joystick: plug in (Kempston)') + ' (F10)';
  showTouchJoy();
  saveSettings();
}
// each click: Kempston, Sinclair, Cursor, unplugged
function nextJoy() {
  const next = settings.joy ? JOY_TYPES[JOY_TYPES.indexOf(settings.joy) + 1] || false : 'kempston';
  setJoy(next);
  status(next ? 'JOYSTICK: ' + JOY_NAMES[next] : 'JOYSTICK OFF');
}

// the touch joystick: drag the stick (8 directions), hold FIRE; both at once with two thumbs
const touchScreen = matchMedia('(pointer: coarse)');
function showTouchJoy() { $('touchJoy').hidden = !(settings.joy && touchScreen.matches && !gamepadOn()); } // not with a real one

// a real joystick or gamepad (USB or Bluetooth): d-pad or left stick, any of the main buttons fires.
// It works as the kind chosen on the desk; the first touch of it plugs in a Kempston if none is plugged in.
const gamepads = () => { try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []); } catch (e) { return []; } };
const gamepadOn = () => gamepads().some(Boolean);
let padLoop = 0;
function pollGamepads() {
  padLoop = 0;
  let bits = 0;
  for (const g of gamepads()) {
    if (!g) continue;
    const b = i => g.buttons[i] && g.buttons[i].pressed, x = g.axes[0] || 0, y = g.axes[1] || 0;
    if (b(15) || x > .5) bits |= 1;
    if (b(14) || x < -.5) bits |= 2;
    if (b(13) || y > .5) bits |= 4;
    if (b(12) || y < -.5) bits |= 8;
    if ([0, 1, 2, 3, 4, 5, 6, 7].some(b)) bits |= 16;
  }
  if (bits && !settings.joy) { setJoy('kempston'); status('JOYSTICK: KEMPSTON'); }
  if (bits !== padBits) { padBits = bits; setJoyBits(joyBits); }
  if (gamepadOn()) padLoop = requestAnimationFrame(pollGamepads);
}
window.addEventListener('gamepadconnected', e => {
  status('GAMEPAD: ' + (e.gamepad.id.replace(/\s*\(.*$/, '') || 'connected').slice(0, 30).toUpperCase());
  showTouchJoy();
  if (!padLoop) padLoop = requestAnimationFrame(pollGamepads);
});
window.addEventListener('gamepaddisconnected', () => {
  if (!gamepadOn()) { padBits = 0; setJoyBits(joyBits); status('GAMEPAD UNPLUGGED'); }
  showTouchJoy();
});
touchScreen.addEventListener && touchScreen.addEventListener('change', showTouchJoy);
{
  const stick = $('touchJoy').querySelector('.tjstick'), knob = stick.firstElementChild, fire = $('touchJoy').querySelector('.tjfire');
  const move = e => {
    const r = stick.getBoundingClientRect(), half = r.width / 2;
    let dx = e.clientX - r.left - half, dy = e.clientY - r.top - half;
    const d = Math.hypot(dx, dy);
    let bits = 0;
    if (d > half * .25) { // outside the dead centre: cos 67.5 degrees splits the circle into 8 directions
      const nx = dx / d, ny = dy / d;
      if (nx > .38) bits |= 1; if (nx < -.38) bits |= 2; if (ny > .38) bits |= 4; if (ny < -.38) bits |= 8;
    }
    if (d > half) { dx *= half / d; dy *= half / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    setJoyBits((joyBits & 16) | bits);
  };
  let finger = null; // the touch that holds the stick
  const release = e => { if (e.pointerId !== finger) return; finger = null; knob.style.transform = ''; setJoyBits(joyBits & 16); };
  stick.addEventListener('pointerdown', e => { finger = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch (_) {} move(e); e.preventDefault(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === finger) move(e); });
  stick.addEventListener('pointerup', release);
  stick.addEventListener('pointercancel', release);
  const fireOff = () => { setJoyBits(joyBits & ~16); fire.classList.remove('down'); };
  fire.addEventListener('pointerdown', e => { try { fire.setPointerCapture(e.pointerId); } catch (_) {} setJoyBits(joyBits | 16); fire.classList.add('down'); e.preventDefault(); });
  fire.addEventListener('pointerup', fireOff);
  fire.addEventListener('pointercancel', fireOff);
  for (const el of [stick, fire]) el.addEventListener('contextmenu', e => e.preventDefault());
  $('touchJoy').querySelector('.tjoff').onclick = () => { setJoy(false); status('JOYSTICK OFF'); }; // the desk's joystick may be under FIRE
}
$('joystick').onclick = nextJoy;
setJoy(settings.joy);

canvas.addEventListener('click', startAudio);
document.addEventListener('pointerdown', startAudio, { once: true });

// ---------- shortcuts: the function keys, which the Spectrum never had, work the desk ----------
// [label for the manual, action]
const SHORTCUTS = {
  F1: ['The manual', () => { const m = document.getElementById('manual'); if (m.open) m.close(); else $('manualBook').click(); }],
  F2: ['Software catalogue', () => { if (screenMenu === catalogue) closeCatalogue(); else openCatalogue(); }],
  F3: ['Open a tape, snapshot or ROM', () => openFile()],
  F4: ['Multiface menu', () => $('mfButton').click()],
  F5: ['Tape REC (record) / STOP', () => pressRec()],
  F6: ['Tape PLAY / STOP', () => {
    if (!zx.tape) { status('No tape', true); return; }
    if (zx.tape.playing) { zx.tape.playing = false; zx.tape.held = true; tapePaused = false; status('Tape stopped'); } else { playTape(); status('Tape playing'); }
  }],
  F7: ['Rewind the tape', () => { $('btnRewind').click(); if (zx.tape) status('Tape rewound'); }],
  F8: ['Reset the computer', () => { reset(); status('Reset'); }],
  F9: ['Tape SPEED: normal, fast, instant', () => { setSpeed((settings.speed + 1) % 3); status('Speed: ' + ['normal', 'fast', 'instant'][settings.speed]); }],
  F10: ['Joystick: Kempston, Sinclair, Cursor, unplugged', () => $('joystick').click()],
  F11: ['Full screen', () => fullScreen()],
  Pause: ['Pause (the POWER button)', () => $('btnPower').click()],
  NumpadAdd: ['Volume up', () => tvVolume(0.1)],
  NumpadSubtract: ['Volume down', () => tvVolume(-0.1)],
  NumpadMultiply: ['Sound off / on', () => tvMute()],
  NumpadDivide: ['Picture: colour, black & white, green screen', () => tvPicture()],
  // the same on keys every keyboard has (laptops without a number pad); in the catalogue PgUp/PgDn page the list
  PageUp: ['Volume up', () => (screenMenuOpen() ? menuKey('PGUP') : tvVolume(0.1))],
  PageDown: ['Volume down', () => (screenMenuOpen() ? menuKey('PGDN') : tvVolume(-0.1))],
  Home: ['Sound off / on', () => tvMute()],
  End: ['Picture: colour, black & white, green screen', () => tvPicture()],
};
// hover labels show the key, e.g. "Software catalogue (F2)"
for (const [id, key] of [['manualBook', 'F1'], ['rack', 'F2'], ['mfButton', 'F4'], ['btnEject', 'F3'], ['btnPlay', 'F6'], ['btnRec', 'F5'], ['btnRewind', 'F7'], ['btnReset', 'F8'], ['speed', 'F9'], ['btnZoom', 'F11'], ['btnPower', 'Pause']]) {
  const el = $(id);
  if (el && el.dataset.tip) el.dataset.tip += ' (' + key + ')';
}

// the installed app (and offline use): register the cache when served over http(s), not from disk
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
