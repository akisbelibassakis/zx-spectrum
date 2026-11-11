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
let paused = false, turbo = false, lastTime = 0, frameDebt = 0;

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
  const code = 'vk:' + name;
  keyMap[code] = COMBOS[name] ? COMBOS[name].map(n => K[n]) : [K[name]];
  keyEvents.push({ code, down, blocked: false });
  processKeyEvents();
  if (down) startAudio();
}

function onKey(e, down) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if ($('joystick').value === 'kempston' && kempstonMap[e.code] !== undefined) {
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
  if (paused || !zx.romLoaded) return;
  const FPS = zx.cpuHz / zx.frameT;

  const fast = turbo || ($('tapeTurbo').checked && zx.tape && zx.tape.playing);
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
  updateTapeStatus();
}
requestAnimationFrame(frame);

// ---------- files ----------
function extOf(name) { const m = /\.([^.]+)$/.exec(name); return m ? m[1].toLowerCase() : ''; }

function status(msg, isError) {
  const el = $('status');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
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
  $('machine').value = model;
  document.title = modelName();
  if (typeof showKeyboard === 'function') showKeyboard(model);
  if (!zx.romLoaded) { $('romNote').hidden = false; status('No ' + zx.name + ' ROM yet - open or drop it.', true); }
  else { $('romNote').hidden = true; status(modelName() + ' ready.'); }
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
    if (!zx.romLoaded) { status('Load the ' + zx.name + ' ROM first.', true); return; }
    if (ext === 'tap' || ext === 'tzx') {
      const tape = ext === 'tap' ? Tape.fromTAP(bytes, name) : Tape.fromTZX(bytes, name);
      zx.insertTape(tape);
      renderTapeBlocks();
      if ($('autoLoad').checked) {
        bootFast();
        // 128K: ENTER picks "Tape Loader" on the start-up menu; 48K: LOAD "" ENTER (J, then SYMBOL SHIFT+P twice)
        if (zx.is128) zx.typeKeys([{ keys: [K.ENTER] }]);
        else zx.typeKeys([{ keys: [K.J] }, { keys: [K.SYM, K.P] }, { keys: [K.SYM, K.P] }, { keys: [K.ENTER] }]);
      }
      status('Tape inserted: ' + name + ' (' + tape.blocks.length + ' blocks)');
    } else if (ext === 'sna' || ext === 'z80') {
      const before = zx.machine;
      if (ext === 'sna') zx.loadSNA(bytes); else zx.loadZ80(bytes);
      if (zx.machine !== before) { followHardware(); showMachine(); }
      status('Snapshot loaded: ' + name + (zx.machine !== before ? ' (switched to the ' + modelName() + ')' : ''));
    } else {
      status('Unknown file type: ' + name, true);
      return;
    }
    $('fileName').textContent = name;
  } catch (e) {
    status(e.message, true);
  }
  startAudio();
}

function readFile(file) {
  const fr = new FileReader();
  fr.onload = () => loadFile(file.name, new Uint8Array(fr.result));
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

// ---------- controls ----------
$('btnReset').onclick = () => { zx.reset(); renderTapeBlocks(); startAudio(); };
$('btnPause').onclick = () => {
  paused = !paused;
  $('btnPause').classList.toggle('on', paused);
};
$('btnTurbo').onclick = () => {
  turbo = !turbo;
  $('btnTurbo').classList.toggle('on', turbo);
};
$('btnSave').onclick = () => {
  if (!zx.romLoaded) return;
  const blob = new Blob([zx.saveSNA()], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ($('fileName').textContent.replace(/\.[^.]+$/, '') || 'snapshot') + '.sna';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('machine').onchange = e => { setModel(e.target.value); renderTapeBlocks(); startAudio(); };
$('btnKeys').onclick = () => $('keysHelp').showModal();
$('keysClose').onclick = () => $('keysHelp').close();
$('keysHelp').addEventListener('click', e => { if (e.target === $('keysHelp')) $('keysHelp').close(); });
$('btnFull').onclick = () => { const s = $('crt'); s.requestFullscreen && s.requestFullscreen(); };
$('fastLoad').onchange = e => { zx.fastLoad = e.target.checked; };

$('btnPlay').onclick = () => { if (zx.tape) { zx.tape.playing = true; zx.tapeT = zx.cpu.tstates; } };
$('btnStop').onclick = () => { if (zx.tape) zx.tape.playing = false; };
$('btnRewind').onclick = () => { if (zx.tape) { zx.tape.rewind(); renderTapeBlocks(); } };
$('btnEject').onclick = () => { zx.tape = null; renderTapeBlocks(); };

let shownBlock = -1, shownPlaying = null;
function renderTapeBlocks() {
  const list = $('tapeBlocks');
  list.innerHTML = '';
  shownBlock = -1; shownPlaying = null;
  if (!zx.tape) {
    $('tapeState').textContent = 'No tape';
    $('deck').classList.remove('loaded', 'playing');
    $('btnPlay').classList.remove('on');
    return;
  }
  $('deck').classList.add('loaded');
  zx.tape.blocks.forEach((b, i) => {
    const li = document.createElement('li');
    li.textContent = b.desc;
    li.title = 'Click to position the tape here';
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
  const t = zx.tape;
  if (!t) return;
  if (t.blockIdx === shownBlock && t.playing === shownPlaying) return;
  shownBlock = t.blockIdx; shownPlaying = t.playing;
  const items = $('tapeBlocks').children;
  for (let i = 0; i < items.length; i++) items[i].classList.toggle('current', i === t.blockIdx);
  $('tapeState').textContent = (t.playing ? 'PLAY' : t.atEnd ? 'END' : 'STOP') + '  ' + t.name;
  $('btnPlay').classList.toggle('on', t.playing);
  $('deck').classList.toggle('playing', t.playing);
}

canvas.addEventListener('click', startAudio);
document.addEventListener('pointerdown', startAudio, { once: true });
