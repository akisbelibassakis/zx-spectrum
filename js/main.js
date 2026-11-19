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

const kempstonMap = { ArrowRight: 1, ArrowLeft: 2, ArrowDown: 4, ArrowUp: 8, AltLeft: 16 };
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
    if (down) zx.kempston |= kempstonMap[e.code]; else zx.kempston &= ~kempstonMap[e.code];
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
window.addEventListener('blur', () => { pressed.clear(); keyEvents.length = 0; zx.keys.fill(0xff); zx.kempston = 0; });

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

  const fast = turbo || (settings.speed >= 1 && zx.tape && zx.tape.playing);
  if (fast) {
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

function bootFast() {
  // run the ROM start-up instantly so the auto-typed command is not lost
  zx.reset();
  for (let i = 0; i < (zx.is128 ? 150 : 120); i++) zx.runFrame();
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

function loadFile(name, bytes) {
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
      if (settings.autoLoad) {
        bootFast();
        // 128K: ENTER picks "Tape Loader" on the start-up menu; 48K: LOAD "" ENTER (J, then SYMBOL SHIFT+P twice)
        if (zx.is128) zx.typeKeys([{ keys: [K.ENTER] }]);
        else zx.typeKeys([{ keys: [K.J] }, { keys: [K.SYM, K.P] }, { keys: [K.SYM, K.P] }, { keys: [K.ENTER] }]);
      }
      status('Tape inserted');
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
function reset() { frozen && freeze(false); zx.reset(); renderTapeBlocks(); startAudio(); }
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
function playTape() { if (zx.tape) { tapePaused = false; zx.tape.playing = true; zx.tapeT = zx.cpu.tstates; } startAudio(); }
$('btnPlay').onclick = playTape;
$('btnTapePause').onclick = () => {
  if (!zx.tape) return;
  if (zx.tape.playing) { zx.tape.playing = false; tapePaused = true; } else if (tapePaused) playTape();
};
$('btnFF').onclick = () => { if (zx.tape) zx.tape.skipBlock(); };
$('btnRewind').onclick = () => { if (zx.tape) { zx.tape.rewind(); tapePaused = false; } };
// STOP/EJECT: stops a playing tape; pressed again it ejects the tape and opens another
$('btnEject').onclick = () => {
  if (zx.tape && (zx.tape.playing || tapePaused)) { zx.tape.playing = false; tapePaused = false; return; }
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
    const li = document.createElement('li');
    li.textContent = b.desc;
    li.onclick = () => {
      const t = zx.tape;
      t.blockIdx = i; t.pos = b.pulseStart; t.remain = t.startPulse(t.pos);
      updateTapeStatus();
    };
    list.appendChild(li);
  });
  updateTapeStatus();
}
function updateTapeStatus() {
  updateCounter();
  const t = zx.tape;
  if (!t) return;
  const state = t.playing + ':' + tapePaused;
  if (t.blockIdx === shownBlock && state === shownPlaying) return;
  shownBlock = t.blockIdx; shownPlaying = state;
  const items = $('tapeBlocks').children;
  for (let i = 1; i < items.length; i++) items[i].classList.toggle('current', i - 1 === t.blockIdx);
  $('tapeState').textContent = t.name.replace(/\.[^.]+$/, '').toUpperCase();
  $('btnPlay').classList.toggle('on', t.playing || tapePaused);
  $('btnTapePause').classList.toggle('on', tapePaused);
  $('deck').classList.toggle('playing', t.playing);
}

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

// joystick: plugged in, the arrow keys and Left Alt are a Kempston joystick
function setJoy(on) {
  settings.joy = on; zx.kempston = 0;
  $('joystick').classList.toggle('on', on);
  $('joystick').setAttribute('aria-pressed', on);
  $('joystick').dataset.tip = (on ? 'Joystick: unplug' : 'Joystick: plug in') + ' (F10)';
  showTouchJoy();
  saveSettings();
}

// the touch joystick: drag the stick (8 directions), hold FIRE; both at once with two thumbs
const touchScreen = matchMedia('(pointer: coarse)');
function showTouchJoy() { $('touchJoy').hidden = !(settings.joy && touchScreen.matches); }
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
    zx.kempston = (zx.kempston & 16) | bits;
  };
  let finger = null; // the touch that holds the stick
  const release = e => { if (e.pointerId !== finger) return; finger = null; knob.style.transform = ''; zx.kempston &= 16; };
  stick.addEventListener('pointerdown', e => { finger = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch (_) {} move(e); e.preventDefault(); });
  stick.addEventListener('pointermove', e => { if (e.pointerId === finger) move(e); });
  stick.addEventListener('pointerup', release);
  stick.addEventListener('pointercancel', release);
  const fireOff = () => { zx.kempston &= ~16; fire.classList.remove('down'); };
  fire.addEventListener('pointerdown', e => { try { fire.setPointerCapture(e.pointerId); } catch (_) {} zx.kempston |= 16; fire.classList.add('down'); e.preventDefault(); });
  fire.addEventListener('pointerup', fireOff);
  fire.addEventListener('pointercancel', fireOff);
  for (const el of [stick, fire]) el.addEventListener('contextmenu', e => e.preventDefault());
  $('touchJoy').querySelector('.tjoff').onclick = () => { setJoy(false); status('JOYSTICK OFF'); }; // the desk's joystick may be under FIRE
}
$('joystick').onclick = () => { setJoy(!settings.joy); status(settings.joy ? 'JOYSTICK ON' : 'JOYSTICK OFF'); };
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
  F6: ['Tape PLAY / STOP', () => {
    if (!zx.tape) { status('No tape', true); return; }
    if (zx.tape.playing) { zx.tape.playing = false; tapePaused = false; status('Tape stopped'); } else { playTape(); status('Tape playing'); }
  }],
  F7: ['Rewind the tape', () => { $('btnRewind').click(); if (zx.tape) status('Tape rewound'); }],
  F8: ['Reset the computer', () => { reset(); status('Reset'); }],
  F9: ['Tape SPEED: normal, fast, instant', () => { setSpeed((settings.speed + 1) % 3); status('Speed: ' + ['normal', 'fast', 'instant'][settings.speed]); }],
  F10: ['Plug the joystick in or out', () => $('joystick').click()],
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
for (const [id, key] of [['manualBook', 'F1'], ['rack', 'F2'], ['mfButton', 'F4'], ['btnEject', 'F3'], ['btnPlay', 'F6'], ['btnRewind', 'F7'], ['btnReset', 'F8'], ['speed', 'F9'], ['btnZoom', 'F11'], ['btnPower', 'Pause']]) {
  const el = $(id);
  if (el && el.dataset.tip) el.dataset.tip += ' (' + key + ')';
}

// the installed app (and offline use): register the cache when served over http(s), not from disk
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
