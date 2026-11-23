// Menus drawn on the Spectrum's own screen, 32 x 24 characters in the ROM font and the Spectrum's colours,
// over the (frozen) picture: the Multiface menu and the software catalogue.
// Keys come from the PC keyboard, the on-screen Spectrum keys or the mouse.
'use strict';

const osd = document.getElementById('osdScreen');
osd.width = SCREEN_W; osd.height = SCREEN_H;
const osdCtx = osd.getContext('2d');
const osdImg = osdCtx.createImageData(SCREEN_W, SCREEN_H), osd32 = new Uint32Array(osdImg.data.buffer);
const COLS = 32, ROWS = 24;
// Spectrum colours: 0 black, 1 blue, 2 red, 3 magenta, 4 green, 5 cyan, 6 yellow, 7 white; +8 bright
const INK = { black: 0, blue: 1, red: 2, magenta: 3, green: 4, cyan: 5, yellow: 6, white: 7, bright: 8 };
let cells = new Array(COLS * ROWS).fill(null), screenFull = false, stripes = null;
let screenMenu = null, blink = false;

// the character set of the 48 BASIC ROM (0x3D00: characters 32-127, 8 bytes each)
const romFont = () => (zx.roms[48] && zx.roms[48][0]) || (zx.roms[128] && zx.roms[128][1]) || null;

const scr = {
  clear(full) { cells.fill(full ? { ch: ' ', ink: 0, paper: 7 } : null); screenFull = !!full; stripes = null; },
  print(col, row, text, ink = 0, paper = 7) {
    text = String(text);
    for (let i = 0; i < text.length; i++) {
      const c = col + i;
      if (c >= 0 && c < COLS && row >= 0 && row < ROWS) cells[row * COLS + c] = { ch: text[i], ink, paper };
    }
  },
  bar(row, paper, col = 0, width = COLS) { scr.print(col, row, ' '.repeat(width), 0, paper); },
  stripes(col, row) { stripes = { col, row }; }, // the 128's rainbow, 4 cells wide
};

function renderScreen() {
  osd32.fill(0);
  if (screenMenu) {
    const font = romFont();
    if (screenFull) { // white border round the paper, like the 128's menu
      const white = PALETTE[7];
      for (let i = 0; i < osd32.length; i++) osd32[i] = white;
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = cells[r * COLS + c];
      if (!cell) continue;
      const code = Math.max(32, Math.min(127, cell.ch.charCodeAt(0)));
      const ink = PALETTE[cell.ink], paper = PALETTE[cell.paper];
      for (let y = 0; y < 8; y++) {
        let bits = font ? font[0x3d00 + (code - 32) * 8 + y] : 0;
        let o = (BORDER_Y + r * 8 + y) * SCREEN_W + BORDER_X + c * 8;
        for (let x = 0; x < 8; x++, bits <<= 1) osd32[o++] = bits & 0x80 ? ink : paper;
      }
    }
    if (stripes) { // red, yellow, green and cyan bands slanting up to the right
      const colours = [10, 14, 12, 13].map(i => PALETTE[i]);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 32; x++) {
        const band = Math.floor((x - (7 - y)) / 8);
        osd32[(BORDER_Y + stripes.row * 8 + y) * SCREEN_W + BORDER_X + stripes.col * 8 + x] = band >= 0 && band < 4 ? colours[band] : PALETTE[0];
      }
    }
  }
  osdCtx.putImageData(osdImg, 0, 0);
}

function redrawScreen() {
  if (!screenMenu) return;
  scr.clear(screenMenu.full);
  screenMenu.draw(scr, blink);
  renderScreen();
}
function openScreenMenu(menu) {
  screenMenu = menu;
  frozen = true; // the computer stops while a menu is on the screen
  osd.classList.add('on');
  redrawScreen();
}
function closeScreenMenu() {
  screenMenu = null;
  frozen = false;
  osd.classList.remove('on');
  renderScreen();
}
const screenMenuOpen = () => !!screenMenu;
setInterval(() => { blink = !blink; if (screenMenu && screenMenu.blinks) redrawScreen(); }, 320);

// ---------- input: one vocabulary for the PC keyboard, the on-screen keys and the mouse ----------
function menuKey(k) { if (screenMenu) { screenMenu.key(k); redrawScreen(); } }

// PC keyboard (called from overlayKey); returns true when the key was for the menu
function screenMenuPCKey(e, down) {
  if (!screenMenu) return false;
  if (!down) return true;
  const named = { ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', Enter: 'ENTER', NumpadEnter: 'ENTER',
    Backspace: 'DELETE', Escape: 'BREAK', PageUp: 'PGUP', PageDown: 'PGDN', Tab: 'EDIT' }[e.code];
  if (named) menuKey(named);
  else if (e.key.length === 1 && !e.ctrlKey && !e.altKey) menuKey('CHAR:' + e.key);
  e.preventDefault();
  return true;
}
// on-screen Spectrum keys (called from virtualKey); CAPS SHIFT with 5-8 / 0 / SPACE / 1 gives the arrows, DELETE, BREAK and EDIT
function screenMenuSpectrumKey(name, down) {
  if (!screenMenu) return false;
  if (!down || name === 'CAPS' || name === 'SYM') return true;
  const caps = typeof latched !== 'undefined' && latched.has('CAPS');
  const capsKeys = { 5: 'LEFT', 6: 'DOWN', 7: 'UP', 8: 'RIGHT', 0: 'DELETE', SPACE: 'BREAK', 1: 'EDIT' };
  const named = { ENTER: 'ENTER', DELETE: 'DELETE', BREAK: 'BREAK', UP: 'UP', DOWN: 'DOWN', LEFT: 'LEFT', RIGHT: 'RIGHT', EDIT: 'EDIT', SPACE: 'CHAR: ' };
  if (caps && capsKeys[name]) menuKey(capsKeys[name]);
  else if (named[name]) menuKey(named[name]);
  else if (/^[A-Z0-9]$/.test(name)) menuKey('CHAR:' + name.toLowerCase());
  return true;
}
function cellAt(e) {
  const r = osd.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * SCREEN_W, y = (e.clientY - r.top) / r.height * SCREEN_H;
  return { col: Math.floor((x - BORDER_X) / 8), row: Math.floor((y - BORDER_Y) / 8) };
}
osd.addEventListener('click', e => { if (screenMenu && screenMenu.click) { const { col, row } = cellAt(e); screenMenu.click(col, row); redrawScreen(); } });
osd.addEventListener('wheel', e => { if (screenMenu) { e.preventDefault(); menuKey(e.deltaY > 0 ? 'DOWN' : 'UP'); } }, { passive: false });

// ---------- the Multiface One menu, over the frozen game ----------
const MF_ITEMS = [['SAVE', 'save'], ['LOAD', 'load'], ['TURBO', 'turbo'], ['RESET', 'reset'], ['RETURN', 'return']];
const multifaceMenu = {
  sel: 0,
  draw(s) {
    const c = 9, w = 14, top = 7;
    s.bar(top, 2 + 8, c, w); s.print(c + 1, top, 'multiface one', 7 + 8, 2 + 8);
    s.bar(top + 1, 7, c, w);
    MF_ITEMS.forEach(([label, act], i) => {
      const on = i === this.sel, paper = on ? 5 + 8 : 7;
      s.bar(top + 2 + i, paper, c, w);
      s.print(c + 1, top + 2 + i, label + (act === 'turbo' ? (turbo ? ' ON' : ' OFF') : ''), 0, paper);
    });
    s.bar(top + 7, 7, c, w);
    s.bar(top + 8, 0, c, w); s.print(c + 1, top + 8, 'BREAK=return', 7, 0);
  },
  key(k) {
    if (k === 'UP') this.sel = (this.sel + MF_ITEMS.length - 1) % MF_ITEMS.length;
    else if (k === 'DOWN') this.sel = (this.sel + 1) % MF_ITEMS.length;
    else if (k === 'ENTER') mfAction(MF_ITEMS[this.sel][1]);
    else if (k === 'BREAK') mfAction('return');
    else if (k.startsWith('CHAR:')) { // first letters: S L T R(eturn) and X for reset
      const i = { s: 0, l: 1, t: 2, x: 3, r: 4 }[k.slice(5).toLowerCase()];
      if (i !== undefined) { this.sel = i; mfAction(MF_ITEMS[i][1]); }
    }
  },
  click(col, row) {
    const i = row - 9;
    if (col >= 9 && col < 23 && i >= 0 && i < MF_ITEMS.length) { this.sel = i; mfAction(MF_ITEMS[i][1]); }
  },
};
