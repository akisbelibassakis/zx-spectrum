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
  document.getElementById('powerLed').classList.toggle('lit', on);
}

// channels 1-3 are the 48K, Spectrum+ and 128K; 4-6 only show static
function tuneTo(n) {
  channel = n;
  tv.classList.toggle('static', n > 3);
  document.querySelectorAll('.chan').forEach(b => b.classList.toggle('on', +b.dataset.ch === n));
}
function setChannel(n) {
  if (n <= 3 && MODEL_CHANNELS[n - 1] !== model) { setModel(MODEL_CHANNELS[n - 1]); renderTapeBlocks(); startAudio(); }
  else tuneTo(n);
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
  el.knob = { set, get: () => value };
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

// the picture: colour (its strength from the COLOUR knob), black and white, or a green-screen monitor
const PICTURES = { colour: 'Colour', mono: 'Black & white', green: 'Green screen' };
function applyPicture() {
  const mode = settings.picture;
  canvas.style.filter = mode === 'mono' ? 'grayscale(1) contrast(1.15) brightness(1.08)'
    : mode === 'green' ? 'grayscale(1) sepia(1) hue-rotate(65deg) saturate(5) contrast(1.1) brightness(.95)'
    : `saturate(${colourLevel * 1.15}) contrast(1.08) brightness(1.06)`;
}

function retroLoop() {
  requestAnimationFrame(retroLoop);
  syncKeyboard();
  if (powered && channel > 3) drawNoise();
}

buildKeyboard();
buildKeyboard128();
showKeyboard(model);
document.getElementById('btnPower').onclick = () => setPower(!powered);
document.querySelectorAll('.chan').forEach(b => { b.onclick = () => setChannel(+b.dataset.ch); });
const volKnob = document.getElementById('knobVolume'), colKnob = document.getElementById('knobColour');
knob(volKnob, settings.volume, v => { setVolume(v); settings.volume = v; saveSettings(); });
knob(colKnob, settings.colour, v => { colourLevel = v * 2; settings.colour = v; saveSettings(); applyPicture(); });
tuneTo(MODEL_CHANNELS.indexOf(model) + 1);
setPower(true);
retroLoop();

// ---------- the manual: two pages side by side on wide screens, one on phones ----------
// Every page is the same height (room.css). A chapter is written as one <article>; when it is longer than a page,
// paginate() flows the rest onto continuation pages, splitting tables and lists between rows, and numbers the pages.
const manual = document.getElementById('manual');
const pagesBox = manual.querySelector('.pages');
const chapters = [...manual.querySelectorAll('.page:not(.blank)')];
const endBlank = pagesBox.lastElementChild; // the inside of the back cover
const pageParts = n => n.matches('.pn, .stripes'); // fixed parts of a page, not part of the text
// the text of each chapter, in order; tables and lists remember their rows so they can be split and put back
for (const ch of chapters) {
  ch.dataset.ch = ch.id.slice(3);
  ch.flow = [...ch.children].filter(n => !pageParts(n));
  for (const n of ch.flow) {
    const box = n.tagName === 'TABLE' ? n.tBodies[0] : n.tagName === 'OL' || n.tagName === 'UL' ? n : null;
    if (box) { n.box = box; n.items = [...box.children]; }
  }
}
const allPages = () => [...pagesBox.querySelectorAll('.page')];
let pageNo = 0, shownPage = document.getElementById('ch-contents'), paginatedFor = '';
const spreadSize = () => (innerWidth > innerHeight ? 2 : 1); // landscape: two pages side by side; portrait: one
// the size of the open book: pages of one shape (11:14) as large as fit, up to 550 x 700; the text scales with them
// down to 85%, below that a page holds less and the chapter takes more pages
const PAGE_W = 550, PAGE_H = 700;
function layoutBook() {
  const k = spreadSize(), W = innerWidth, H = innerHeight;
  const tabtop = k === 1 && W < 700; // phones held upright: the tabs go above the page
  const tabslim = !tabtop && H < 520; // phones held sideways: slim tabs with only the chapter number
  const availW = tabtop ? W - 40 : tabslim ? W - 112 : W - 236; // room for the tabs and the close button on the right
  const availH = tabtop ? H - 56 - 34 - 12 : H - 24;
  const ph = Math.floor(Math.min(PAGE_H, availH, availW / k * PAGE_H / PAGE_W)), pw = Math.floor(ph * PAGE_W / PAGE_H);
  const z = Math.min(1, Math.max(0.85, ph / PAGE_H));
  manual.style.setProperty('--pw', pw + 'px');
  manual.style.setProperty('--ph', ph + 'px');
  manual.style.setProperty('--z', z);
  manual.style.setProperty('--bw', k * pw + 'px');
  manual.classList.toggle('tabtop', tabtop);
  manual.classList.toggle('tabslim', tabslim);
  manual.classList.toggle('compact', pw / z < 480);
  manual.classList.toggle('single', k === 1); // one page at a time: the binding down its left edge
  return k + ':' + pw + 'x' + ph;
}
// two pages side by side include the blank insides of the covers (the back one only to fill the last spread);
// one at a time skips them
function bookPages() {
  const all = allPages();
  if (spreadSize() === 1) return all.filter(p => !p.classList.contains('blank'));
  return all.length % 2 ? all.filter(p => p !== endBlank) : all;
}
function paginate() {
  const key = layoutBook();
  if (key === paginatedFor) return;
  paginatedFor = key;
  // put every chapter back together on its first page
  pagesBox.querySelectorAll('.page.cont, [data-piece]').forEach(p => p.remove());
  for (const ch of chapters) {
    for (const n of ch.flow) { if (n.items) n.box.append(...n.items); ch.insertBefore(n, ch.querySelector(':scope > .pn')); }
  }
  // measure one page at a time, at the width it has in the book
  allPages().forEach(p => { p.hidden = true; });
  for (const ch of chapters) {
    let page = ch;
    const show = p => { p.hidden = false; };
    const fits = () => page.scrollHeight <= page.clientHeight;
    const add = n => page.insertBefore(n, page.querySelector(':scope > .pn'));
    const text = () => [...page.children].filter(n => !pageParts(n) && n.tagName !== 'H1');
    const turn = () => { // a new page; a heading left at the foot of the old one comes along
      const p = document.createElement('article');
      p.className = 'page cont';
      p.dataset.ch = ch.dataset.ch;
      p.innerHTML = '<div class="pn"></div>';
      const last = text().pop(), keep = last && last.tagName === 'H2' && text().length > 1 ? last : null;
      page.hidden = true;
      page.after(p);
      page = p;
      show(page);
      if (keep) add(keep);
    };
    // the first words of a paragraph that fit on this page, and the rest of it
    const splitToFit = n => {
      const gaps = [], walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
      for (let t; (t = walk.nextNode());) for (const m of t.data.matchAll(/\s+/g)) if (m.index) gaps.push([t, m.index]);
      const part = (from, to) => {
        const r = document.createRange(), p = n.cloneNode(false);
        if (from) r.setStart(...from); else r.setStart(n, 0);
        if (to) r.setEnd(...to); else r.setEnd(n, n.childNodes.length);
        p.append(r.cloneContents());
        p.dataset.piece = '';
        return p;
      };
      let lo = -1, hi = gaps.length - 1;
      while (lo < hi) { // binary search for the most words that fit
        const mid = (lo + hi + 1) >> 1, head = part(null, gaps[mid]);
        add(head);
        const ok = fits();
        head.remove();
        if (ok) lo = mid; else hi = mid - 1;
      }
      if (lo < 0) return null;
      const tail = part(gaps[lo], null);
      tail.classList.add('cont');
      return [part(null, gaps[lo]), tail];
    };
    show(page);
    ch.flow.forEach(n => n.remove());
    const queue = [...ch.flow];
    while (queue.length) {
      const n = queue.shift();
      add(n);
      if (fits()) continue;
      n.remove();
      if (!n.items) { // a paragraph is split between pages; a picture goes to the next page whole
        const parts = n.tagName === 'P' ? splitToFit(n) : null;
        if (parts) { add(parts[0]); turn(); queue.unshift(parts[1]); continue; }
        if (text().length) turn();
        add(n); // longer than a whole page: it scrolls
        continue;
      }
      // a table or a list: as many rows as fit, the rest in a copy of it on the next page
      let piece = n, box = n.box;
      box.replaceChildren();
      add(piece);
      for (const item of n.items) {
        box.append(item);
        if (fits() || (box.children.length === 1 && !text().some(t => t !== piece))) continue;
        item.remove();
        if (!box.children.length) piece.remove();
        turn();
        piece = n.cloneNode(false);
        box = piece;
        if (n.box !== n) { box = n.box.cloneNode(false); piece.append(box); }
        add(piece);
        box.append(item);
      }
    }
    page.hidden = true;
  }
  // page numbers, in the corners and on the contents page
  bookPages().filter(p => !p.classList.contains('blank')).forEach((p, i) => { p.querySelector('.pn').textContent = i + 1; });
  manual.querySelectorAll('.toc button').forEach(b => { b.querySelector('b').textContent = chapter(b.dataset.ch).querySelector('.pn').textContent; });
}
// show a page (an element, or a number in the current list) with its facing page
function showPage(target) {
  paginate();
  if (!shownPage.isConnected) shownPage = chapter(shownPage.dataset.ch); // its page went away in a new layout
  const list = bookPages(), k = spreadSize();
  let i = typeof target === 'number' ? target : Math.max(0, list.indexOf(target && target.isConnected ? target : shownPage));
  i = Math.max(0, Math.min(list.length - 1, i));
  i -= i % k;
  pageNo = i;
  const shown = list.slice(i, i + k);
  shownPage = shown.find(p => !p.classList.contains('blank')) || shown[0];
  allPages().forEach(p => { p.hidden = !shown.includes(p); });
  manual.querySelectorAll('.tabs button').forEach(t => t.classList.toggle('on', shown.some(p => p.dataset.ch === t.dataset.ch)));
  manual.querySelector('.prev').hidden = i === 0;
  manual.querySelector('.next').hidden = i + k >= list.length;
}
const chapter = id => document.getElementById('ch-' + id);
document.getElementById('manualBook').onclick = () => { manual.showModal(); showPage(shownPage); };
manual.querySelectorAll('.tabs button, .toc button').forEach(b => { b.onclick = () => showPage(chapter(b.dataset.ch)); });
manual.querySelector('.prev').onclick = () => showPage(pageNo - spreadSize());
manual.querySelector('.next').onclick = () => showPage(pageNo + spreadSize());
manual.querySelector('.bclose').onclick = () => manual.close();
manual.addEventListener('click', e => { if (e.target === manual) manual.close(); });
addEventListener('resize', () => { if (manual.open) showPage(shownPage); });

// while the manual or the Multiface menu is open, keys work them instead of the Spectrum
function overlayKey(e, down) {
  if (manual.open) {
    if (down && e.code === 'ArrowLeft') showPage(pageNo - spreadSize());
    if (down && e.code === 'ArrowRight') showPage(pageNo + spreadSize());
    return true;
  }
  if (typeof screenMenuPCKey === 'function' && screenMenuPCKey(e, down)) return true; // Multiface menu or catalogue on the screen
  return false;
}

// ---------- hover labels, embossed on Dymo tape (mouse only) ----------
const dymo = document.getElementById('dymo');
let dymoTimer = 0;
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  document.addEventListener('pointerover', e => {
    const el = e.target.closest('[data-tip]');
    clearTimeout(dymoTimer);
    dymo.hidden = true;
    if (!el) return;
    dymoTimer = setTimeout(() => {
      dymo.textContent = el.dataset.tip;
      dymo.hidden = false;
      const r = el.getBoundingClientRect(), w = dymo.offsetWidth;
      dymo.style.left = Math.max(4, Math.min(innerWidth - w - 4, r.left + r.width / 2 - w / 2)) + 'px';
      dymo.style.top = (r.bottom + 8 + dymo.offsetHeight > innerHeight ? r.top - dymo.offsetHeight - 8 : r.bottom + 8) + 'px';
    }, 500);
  });
  document.addEventListener('pointerdown', () => { clearTimeout(dymoTimer); dymo.hidden = true; });
}

// ?manual=<n> or ?manual=<chapter> (using, desk, keys, settings, about) opens the manual there
{
  const m = new URLSearchParams(location.search).get('manual');
  if (m) {
    manual.showModal();
    paginate();
    const numbered = allPages().filter(p => !p.classList.contains('blank'));
    showPage(/^\d+$/.test(m) ? numbered[parseInt(m, 10) - 1] || numbered[0] : chapter(m));
  }
}

// ---------- volume and picture: the knobs, the mouse wheel over the TV, the number pad, the knob labels ----------
let volumeBeforeMute = settings.volume || 0.7;
function tvVolume(step) {
  volKnob.knob.set(volKnob.knob.get() + step);
  status(volKnob.knob.get() ? 'Volume ' + Math.round(volKnob.knob.get() * 100) + '%' : 'Sound off');
}
function tvMute() {
  if (volKnob.knob.get() > 0) { volumeBeforeMute = volKnob.knob.get(); volKnob.knob.set(0); status('Sound off'); }
  else { volKnob.knob.set(volumeBeforeMute || 0.7); status('Sound on'); }
}
function tvPicture() {
  const modes = Object.keys(PICTURES);
  settings.picture = modes[(modes.indexOf(settings.picture) + 1) % modes.length];
  saveSettings(); applyPicture(); status(PICTURES[settings.picture]);
}
// the wheel anywhere over the TV: volume; with Shift, colour (the knobs' own wheel handling comes first)
tv.addEventListener('wheel', e => {
  if (e.target.closest('.knob')) return;
  e.preventDefault();
  const step = -Math.sign(e.deltaY || e.deltaX) * 0.05;
  if (e.shiftKey) { colKnob.knob.set(colKnob.knob.get() + step); status('Colour ' + Math.round(colKnob.knob.get() * 100) + '%'); }
  else tvVolume(step);
}, { passive: false });
const [volLabel, colLabel] = document.querySelectorAll('.knobwrap span');
volLabel.onclick = tvMute;
colLabel.onclick = tvPicture;
volLabel.dataset.tip = 'Sound off / on (Home or Num *)';
colLabel.dataset.tip = 'Colour, black & white, green screen (End or Num /)';
volKnob.dataset.tip = 'Volume: drag, or the wheel over the TV (PgUp PgDn or Num + -)';
colKnob.dataset.tip = 'Colour: drag, or Shift + wheel over the TV';
volKnob.removeAttribute('title'); colKnob.removeAttribute('title');
applyPicture();
