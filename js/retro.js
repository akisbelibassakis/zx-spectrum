// The 80s television (power, channels, knobs, CRT static), the rubber-key 48K keyboard and the 128's keyboard.
'use strict';

// ---------- keyboard ----------
// Layout measured from the 48K: positions in key pitches (--p) from the keyboard plate's top-left.
// [key, legend, keyword on key, red symbol on key, label above (green), label below (red)]
const KB_ROWS = [
  {
    x: 0.42, y: 0.63, keys: [
      ['1', '1', '', '!', 'EDIT', 'DEF FN'], ['2', '2', '', '@', 'CAPS LOCK', 'FN'],
      ['3', '3', '', '#', 'TRUE VIDEO', 'LINE'], ['4', '4', '', '$', 'INV. VIDEO', 'OPEN #'],
      ['5', '5', '', '%', '⇦', 'CLOSE #'], ['6', '6', '', '&', '⇩', 'MOVE'],
      ['7', '7', '', "'", '⇧', 'ERASE'], ['8', '8', '', '(', '⇨', 'POINT'],
      ['9', '9', '', ')', 'GRAPHICS', 'CAT'], ['0', '0', '', '_', 'DELETE', 'FORMAT'],
    ],
  },
  {
    x: 0.915, y: 1.63, keys: [
      ['Q', 'Q', 'PLOT', '≤', 'SIN', 'ASN'], ['W', 'W', 'DRAW', '<>', 'COS', 'ACS'],
      ['E', 'E', 'REM', '≥', 'TAN', 'ATN'], ['R', 'R', 'RUN', '<', 'INT', 'VERIFY'],
      ['T', 'T', 'RAND', '>', 'RND', 'MERGE'], ['Y', 'Y', 'RETURN', 'AND', 'STR $', '['],
      ['U', 'U', 'IF', 'OR', 'CHR $', ']'], ['I', 'I', 'INPUT', 'AT', 'CODE', 'IN'],
      ['O', 'O', 'POKE', ';', 'PEEK', 'OUT'], ['P', 'P', 'PRINT', '"', 'TAB', '©'],
    ],
  },
  {
    x: 1.16, y: 2.61, keys: [
      ['A', 'A', 'NEW', 'STOP', 'READ', '~'], ['S', 'S', 'SAVE', 'NOT', 'RESTORE', '|'],
      ['D', 'D', 'DIM', 'STEP', 'DATA', '\\'], ['F', 'F', 'FOR', 'TO', 'SGN', '{'],
      ['G', 'G', 'GOTO', 'THEN', 'ABS', '}'], ['H', 'H', 'GOSUB', '↑', 'SQR', 'CIRCLE'],
      ['J', 'J', 'LOAD', '-', 'VAL', 'VAL $'], ['K', 'K', 'LIST', '+', 'LEN', 'SCREEN $'],
      ['L', 'L', 'LET', '=', 'USR', 'ATTR'], ['ENTER', 'ENTER', '', '', '', ''],
    ],
  },
  {
    x: 1.63, y: 3.61, keys: [
      ['CAPS', 'CAPS SHIFT', '', '', '', '', 0.37, 1.02], ['Z', 'Z', 'COPY', ':', 'LN', 'BEEP'],
      ['X', 'X', 'CLEAR', '£', 'EXP', 'INK'], ['C', 'C', 'CONT', '?', 'L PRINT', 'PAPER'],
      ['V', 'V', 'CLS', '/', 'L LIST', 'FLASH'], ['B', 'B', 'BORDER', '*', 'BIN', 'BRIGHT'],
      ['N', 'N', 'NEXT', ',', 'INKEY $', 'OVER'], ['M', 'M', 'PAUSE', '.', 'PI', 'INVERSE'],
      ['SYM', 'SYMBOL SHIFT', '', '', '', ''], ['SPACE', 'BREAK SPACE', '', '', '', '', 9.58, 1.27],
    ],
  },
];
// colour names printed above the number row, in their own colour
const KEY_COLOURS = { 1: ['BLUE', '#4a78d8'], 2: ['RED', '#e2442f'], 3: ['MAGENTA', '#da4f9e'], 4: ['GREEN', '#86b43c'],
  5: ['CYAN', '#57a8dc'], 6: ['YELLOW', '#f2d21d'], 7: ['WHITE', '#f2f2f2'], 0: ['BLACK', ''] };
// block graphic on keys 1-8 (CHR$ 129-135, and the solid block on 8): bit 1 = top right, 2 = top left, 4 = bottom right
const KEY_GRAPHICS = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 15 };

const keyEls = []; // { el, keys: [[row, bit], ...] }: lit while all its matrix keys are down
const latched = new Set(); // CAPS / SYM clicked once: held for the next key, like a sticky shift

function keyFace(name, legend, word, sym) {
  if (name === 'CAPS') return '<span class="mid">CAPS<br>SHIFT</span>';
  if (name === 'SYM') return '<span class="mid red">SYMBOL<br>SHIFT</span>';
  if (name === 'ENTER') return '<span class="mid small">ENTER</span>';
  if (name === 'SPACE') return '<span class="mid"><small>BREAK</small>SPACE</span>';
  let html = `<span class="legend">${esc(legend)}</span>`;
  if (KEY_GRAPHICS[name] !== undefined) {
    const g = KEY_GRAPHICS[name];
    html += `<span class="gfx">${[2, 1, 8, 4].map(bit => `<i${g & bit ? ' class="on"' : ''}></i>`).join('')}</span>` +
      `<span class="sym numsym">${esc(sym)}</span>`;
  } else {
    html += `<span class="sym${sym.length > 2 ? ' word' : ''}">${esc(sym)}</span><span class="kw">${esc(word)}</span>`;
  }
  return html;
}

function buildKeyboard() {
  const kb = document.getElementById('keys');
  for (const row of KB_ROWS) {
    row.keys.forEach(([name, legend, word, sym, above, below, x, w], i) => {
      const isShift = name === 'CAPS' || name === 'SYM';
      // keys after CAPS SHIFT on the bottom row start at the row's x
      const col = row.keys[0][6] !== undefined ? i - 1 : i;
      const cell = document.createElement('div');
      cell.className = 'kcell';
      cell.style.cssText = `--x:${x !== undefined ? x : row.x + col};--y:${row.y};--w:${w || 0.76}`;
      let top = esc(above);
      if (KEY_COLOURS[name]) {
        const [cname, colour] = KEY_COLOURS[name];
        top = (colour ? `<span style="color:${colour}">${cname}</span>` : `<span class="black">${cname}</span>`) + '<br>' + top;
      } else if (row === KB_ROWS[0]) {
        top = '<br>' + top;
      }
      cell.innerHTML =
        `<div class="above${row === KB_ROWS[0] ? ' fn' : ''}">${top}</div>` +
        `<button class="key${isShift ? ' shift' : ''}" aria-label="${esc(legend)}">${keyFace(name, legend, word, sym)}</button>` +
        `<div class="below">${esc(below)}</div>`;
      const key = cell.querySelector('.key');
      keyEls.push({ el: key, keys: [K[name]] });
      attachKey(key, name, isShift);
      kb.appendChild(cell);
    });
  }
}

function attachKey(el, name, isShift) {
  let down = false;
  const press = e => {
    e.preventDefault();
    if (down) return;
    if (isShift && !e.shiftKey && !e.ctrlKey) {
      // a click/tap on a shift key latches it for the next key press
      if (latched.has(name)) { latched.delete(name); virtualKey(name, false); }
      else { latched.add(name); virtualKey(name, true); }
      el.classList.toggle('latched', latched.has(name));
      return;
    }
    down = true;
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
    virtualKey(name, true);
  };
  const release = () => {
    if (!down) return;
    down = false;
    virtualKey(name, false);
    if (!isShift && latched.size) {
      for (const s of latched) virtualKey(s, false);
      latched.clear();
      document.querySelectorAll('.latched').forEach(k => k.classList.remove('latched'));
    }
  };
  el.addEventListener('pointerdown', press);
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

// ---------- Spectrum+ / 128 keyboard (hard black keys) ----------
// Positions in key pitches (--q) from the top-left of the key area, measured from photos of the 128.
// The extra keys press two matrix keys at once (see COMBOS in main.js).
// [name, x, y, width, face]
const KB128 = [
  ['TRUEVID', 0, 0, 1, 'TRUE<br>VIDEO'], ['INVVID', 1, 0, 1, 'INV.<br>VIDEO'],
  ...'1234567890'.split('').map((k, i) => [k, 2 + i, 0, 1]), ['BREAK', 12, 0, 1.5, 'BREAK'],
  ['DELETE', 0, 1, 1.5, 'DELETE'], ['GRAPH', 1.5, 1, 1, 'GRAPH'],
  ...'QWERTYUIOP'.split('').map((k, i) => [k, 2.5 + i, 1, 1]),
  ['EXTEND', 0, 2, 1.75, 'EXTEND<br>MODE'], ['EDIT', 1.75, 2, 1, 'EDIT'],
  ...'ASDFGHJKL'.split('').map((k, i) => [k, 2.75 + i, 2, 1]), ['ENTER', 11.75, 2, 1.75, 'ENTER'],
  ['CAPS', 0, 3, 2.25, 'CAPS SHIFT'], ['CAPSLOCK', 2.25, 3, 1, 'CAPS<br>LOCK'],
  ...'ZXCVBNM'.split('').map((k, i) => [k, 3.25 + i, 3, 1]), ['DOT', 10.25, 3, 1, '<b>.</b>'], ['CAPS', 11.25, 3, 2.25, 'CAPS SHIFT'],
  ['SYM', 0, 4, 1, 'SYMBOL<br>SHIFT'], ['SEMI', 1, 4, 1, '<b>;</b>'], ['QUOTE', 2, 4, 1, '<b>"</b>'],
  ['LEFT', 3, 4, 1, '<b>⇦</b>'], ['RIGHT', 4, 4, 1, '<b>⇨</b>'], ['SPACE', 5, 4, 4.5, ''],
  ['UP', 9.5, 4, 1, '<b>⇧</b>'], ['DOWN', 10.5, 4, 1, '<b>⇩</b>'], ['COMMA', 11.5, 4, 1, '<b>,</b>'], ['SYM', 12.5, 4, 1, 'SYMBOL<br>SHIFT'],
];
// colour names printed on the 128's digit keys (8 and 9 have none)
const COLOUR_NAMES = { 1: 'BLUE', 2: 'RED', 3: 'MAGENTA', 4: 'GREEN', 5: 'CYAN', 6: 'YELLOW', 7: 'WHITE', 0: 'BLACK' };

// all the legends of a 48K key, stacked on one 128 key: E mode, E + shift, keyword and symbol, then the key itself
function keyFace128(name) {
  const k = KB_ROWS.flatMap(r => r.keys).find(key => key[0] === name);
  const [, legend, word, sym, above, below] = k;
  let lines;
  if (KEY_GRAPHICS[name] !== undefined) {
    const g = KEY_GRAPHICS[name];
    const gfx = `<span class="gfx">${[2, 1, 8, 4].map(bit => `<i${g & bit ? ' class="on"' : ''}></i>`).join('')}</span>`;
    lines = [esc(COLOUR_NAMES[name] || ''), esc(below), gfx + ' ' + esc(sym)];
  } else if (/^\d$/.test(name)) {
    lines = [esc(COLOUR_NAMES[name] || ''), esc(below), esc(sym)];
  } else {
    lines = [esc(above), esc(below), esc(word) + ' ' + esc(sym)];
  }
  return `<span class="small">${lines.map(l => l || '&nbsp;').join('<br>')}</span><span class="main">${esc(legend)}</span>`;
}

function buildKeyboard128() {
  const kb = document.getElementById('keysPlus');
  for (const [name, x, y, w, face] of KB128) {
    const key = document.createElement('button');
    key.className = 'key128' + (name === 'ENTER' ? ' enter' : '') + (name === 'SPACE' ? ' space' : '');
    key.style.cssText = `--x:${x};--y:${y};--w:${w}`;
    key.setAttribute('aria-label', name);
    key.innerHTML = face !== undefined ? `<span class="label">${face}</span>` : keyFace128(name);
    const combo = COMBOS[name] || [name];
    keyEls.push({ el: key, keys: combo.map(n => K[n]) });
    attachKey(key, name, name === 'CAPS' || name === 'SYM');
    kb.appendChild(key);
  }
}

// show the case and keyboard of the chosen model: '48', 'plus' or '128'
function showKeyboard(model) {
  const plusKeys = model !== '48';
  document.querySelector('.desk').classList.toggle('mplus', plusKeys);
  document.getElementById('spectrum48').hidden = plusKeys;
  const caseEl = document.getElementById('spectrumPlus');
  caseEl.hidden = !plusKeys;
  caseEl.classList.toggle('is128', model === '128');
  latched.clear();
  document.querySelectorAll('.latched').forEach(k => k.classList.remove('latched'));
}

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// light up keys from the emulated key matrix, whatever pressed them
const shownKeys = new Uint8Array(8).fill(0xff);
function syncKeyboard() {
  let same = true;
  for (let i = 0; i < 8; i++) if (shownKeys[i] !== zx.keys[i]) { same = false; break; }
  if (same) return;
  shownKeys.set(zx.keys);
  for (const k of keyEls) k.el.classList.toggle('down', k.keys.every(([r, b]) => !(zx.keys[r] & (1 << b))));
}

// ---------- television ----------
const tv = document.getElementById('tv');
const noise = document.getElementById('noise'), noiseCtx = noise.getContext('2d');
const noiseImg = noiseCtx.createImageData(noise.width, noise.height), noise32 = new Uint32Array(noiseImg.data.buffer);
let channel = 1, powered = true, colourLevel = 1;

function drawNoise() {
  for (let i = 0; i < noise32.length; i++) {
    const v = Math.random() * 255 | 0;
    noise32[i] = 0xff000000 | (v << 16) | (v << 8) | v;
  }
  noiseCtx.putImageData(noiseImg, 0, 0);
}

function setPower(on) {
  powered = on;
  tv.classList.toggle('off', !on);
  tv.classList.remove('warming');
  if (on) { void tv.offsetWidth; tv.classList.add('warming'); }
  paused = !on;
  $('btnPause').classList.remove('on');
  document.getElementById('powerLed').classList.toggle('lit', on);
}

function setChannel(n) {
  channel = n;
  tv.classList.toggle('static', n !== 1);
  document.querySelectorAll('.chan').forEach(b => b.classList.toggle('on', +b.dataset.ch === n));
}

// rotary knob: drag up/down or use the wheel; value 0..1 maps to -135..135 degrees
function knob(el, value, onChange) {
  const set = v => {
    value = Math.max(0, Math.min(1, v));
    el.style.setProperty('--angle', (value * 270 - 135) + 'deg');
    el.setAttribute('aria-valuenow', Math.round(value * 100));
    onChange(value);
  };
  let startY = 0, startV = 0;
  el.addEventListener('pointerdown', e => {
    startY = e.clientY; startV = value;
    el.setPointerCapture(e.pointerId);
    const move = ev => set(startV + (startY - ev.clientY) / 150);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('wheel', e => { e.preventDefault(); set(value - Math.sign(e.deltaY) * 0.05); }, { passive: false });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(value + 0.05); e.preventDefault(); e.stopPropagation(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(value - 0.05); e.preventDefault(); e.stopPropagation(); }
  });
  set(value);
}

function applyPicture() {
  canvas.style.filter = `saturate(${colourLevel * 1.15}) contrast(1.08) brightness(1.06)`;
}

function retroLoop() {
  requestAnimationFrame(retroLoop);
  syncKeyboard();
  if (powered && channel !== 1) drawNoise();
}

buildKeyboard();
buildKeyboard128();
showKeyboard(model);
document.getElementById('btnPower').onclick = () => setPower(!powered);
document.querySelectorAll('.chan').forEach(b => { b.onclick = () => setChannel(+b.dataset.ch); });
knob(document.getElementById('knobVolume'), 0.7, v => setVolume(v));
knob(document.getElementById('knobColour'), 0.5, v => { colourLevel = v * 2; applyPicture(); });
setChannel(1);
setPower(true);
retroLoop();
