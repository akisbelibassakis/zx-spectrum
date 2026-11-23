// My tapes: the cassette rack on the desk holds 4 banks of 8 tapes kept in the browser (IndexedDB), so they work offline.
// Games downloaded from the catalogue, files opened from the device and Multiface saves go into it; when it is full
// a page on the TV asks which tape makes room. The whole rack can be saved to a backup file and loaded elsewhere.
'use strict';

const RACK_SIZE = 8, BANKS = 4, ALL_SLOTS = RACK_SIZE * BANKS; // the rack shows one bank (A-D) of 8 places at a time
const BANK_NAMES = 'ABCD';
let rackBank = (() => { try { return Math.min(BANKS - 1, +localStorage.getItem('zxRackBank') || 0); } catch (e) { return 0; } })();
const slotName = i => BANK_NAMES[Math.floor(i / RACK_SIZE)] + (i % RACK_SIZE + 1);
// all places, the shown bank first
const rackOrder = () => Array.from({ length: ALL_SLOTS }, (_, k) => (rackBank * RACK_SIZE + k) % ALL_SLOTS);
const bankSlots = (b = rackBank) => Array.from({ length: RACK_SIZE }, (_, k) => b * RACK_SIZE + k);
function showBank(b) {
  rackBank = (b + BANKS) % BANKS;
  try { localStorage.setItem('zxRackBank', rackBank); } catch (e) { /* storage unavailable */ }
  renderRack();
}
const SPINE_COLOURS = ['#d70000', '#1f5fbf', '#e8b100', '#2c8a3a', '#7b2fa8', '#d45a00', '#0096a8', '#c2185b'];
const SOURCES = { archive: 'downloaded', file: 'your file', multiface: 'Multiface save', backup: 'from a backup', recorded: 'recorded here' };
let tapes = new Array(ALL_SLOTS).fill(null); // { slot, title, name, bytes, source, added, played, machine }
let lastTitle = '';                           // what is playing: Multiface saves are named after it

// ---------- storage ----------
let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open('zx-spectrum', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('tapes', { keyPath: 'slot' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}
async function dbDo(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('tapes', mode), req = fn(tx.objectStore('tapes'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
const saveSlot = t => dbDo('readwrite', s => s.put(t)).catch(() => status('Could not keep the tape in this browser', true));
const clearSlot = slot => dbDo('readwrite', s => s.delete(slot)).catch(() => {});

async function loadRack() {
  try {
    for (const t of await dbDo('readonly', s => s.getAll())) if (t.slot < ALL_SLOTS) tapes[t.slot] = t;
  } catch (e) { /* no storage (private window): the rack still works until the page is closed */ }
  renderRack();
}

// ---------- the rack on the desk ----------
const rackEl = document.getElementById('rack'), rackSlots = rackEl.querySelector('.slots'), rackBanks = rackEl.querySelector('.banks');
function renderRack() {
  rackSlots.innerHTML = '';
  bankSlots().forEach(i => {
    const t = tapes[i], b = document.createElement('button');
    if (t) {
      b.className = 'spine';
      b.style.setProperty('--c', SPINE_COLOURS[i % RACK_SIZE]);
      b.textContent = t.title.toUpperCase();
      b.dataset.tip = t.title + ': load it';
      b.onclick = () => playRackTape(i);
    } else {
      b.className = 'spine empty';
      b.dataset.tip = 'Empty: find a game (F2)';
      b.onclick = () => openCatalogue();
    }
    rackSlots.appendChild(b);
  });
  // the bank switch: A-D, a dot for each bank with tapes in it
  rackBanks.innerHTML = '';
  for (let k = 0; k < BANKS; k++) {
    const b = document.createElement('button'), n = bankSlots(k).filter(i => tapes[i]).length;
    b.textContent = BANK_NAMES[k];
    b.className = (k === rackBank ? 'on' : '') + (n ? ' full' : '');
    b.dataset.tip = 'Bank ' + BANK_NAMES[k] + ': ' + (n ? n + ' tape' + (n > 1 ? 's' : '') : 'empty');
    b.onclick = () => showBank(k);
    rackBanks.appendChild(b);
  }
}
rackEl.querySelector('.racklabel').onclick = () => openTapesMenu();

function playRackTape(i) {
  const t = tapes[i];
  if (!t || screenMenuOpen()) return;
  if (t.source === 'recorded') { insertRackTape(t); return; } // your recordings go in without resetting the computer: LOAD "" (or the game) loads them
  lastTitle = t.title;
  t.played = Date.now();
  saveSlot(t);
  loadFile(t.name, t.bytes, { machine: t.machine || 0 });
}
// a free place: in the bank on show, else the first free one (the rack then shows its bank)
function freeSlot() {
  const i = rackOrder().find(k => !tapes[k]);
  return i === undefined ? -1 : i;
}

// a new tape: into a free place, or (rack full) the TV asks which one makes room
function rackOffer(t) {
  t = { title: t.title || t.name.replace(/\.[^.]+$/, ''), name: t.name, bytes: t.bytes, source: t.source, machine: t.machine || 0, added: Date.now(), played: Date.now() };
  lastTitle = t.title;
  const same = tapes.findIndex(x => x && x.name === t.name && x.bytes.length === t.bytes.length);
  if (same >= 0) { tapes[same].played = Date.now(); saveSlot(tapes[same]); return; } // already on the rack
  const free = freeSlot();
  if (free >= 0) { putTape(free, t); status('On the rack: ' + slotName(free) + ' ' + t.title); return; }
  replaceMenu.offer = t; replaceMenu.sel = 0;
  openScreenMenu(replaceMenu);
}
function putTape(slot, t) {
  t.slot = slot;
  tapes[slot] = t;
  saveSlot(t);
  if (Math.floor(slot / RACK_SIZE) !== rackBank) showBank(Math.floor(slot / RACK_SIZE)); else renderRack();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); // keep it when space is short
}
function removeTape(slot) { tapes[slot] = null; clearSlot(slot); renderRack(); }

// ---------- recording: a tape of your own in the recorder ----------
let recTape = null; // the rack entry being recorded onto (not on the rack until its first block)
// a rack tape into the recorder, without resetting the computer: rewound, or wound on to the end to record after it
function insertRackTape(t, atEnd) {
  const tape = /\.tzx$/i.test(t.name) ? Tape.fromTZX(t.bytes, t.name) : Tape.fromTAP(t.bytes, t.name);
  tape.rackTape = t;
  if (atEnd) { tape.blockIdx = tape.blocks.length; tape.pos = tape.pulses.length; tape.remain = 0; }
  zx.insertTape(tape);
  renderTapeBlocks();
  if (!atEnd) status('Tape in: ' + t.title);
}
// REC: record onto the tape of your own in the recorder, or this game's saves tape, or My programs
function startRecording() {
  let t = zx.tape && zx.tape.rackTape && zx.tape.rackTape.source === 'recorded' ? zx.tape.rackTape : null;
  if (!t) {
    const title = !lastTitle ? 'My programs' : / saves$/.test(lastTitle) ? lastTitle : lastTitle.replace(/ \(saved\)$/, '') + ' saves';
    t = tapes.find(x => x && x.source === 'recorded' && x.title === title)
      || { title, name: title + '.tap', bytes: new Uint8Array(0), source: 'recorded', added: Date.now(), played: Date.now() };
  }
  recTape = t;
  insertRackTape(t, true);
  return t.title;
}
// one saved block onto the end of the tape (TAP: 2 length bytes, then the block)
function recordBlock(block) {
  const t = recTape;
  if (!t) return;
  const n = new Uint8Array(t.bytes.length + 2 + block.length);
  n.set(t.bytes);
  n[t.bytes.length] = block.length & 0xff; n[t.bytes.length + 1] = block.length >> 8;
  n.set(block, t.bytes.length + 2);
  t.bytes = n; t.played = Date.now();
  insertRackTape(t, true); // the recorder's tape grows, still at its end
  if (t.slot !== undefined && tapes[t.slot] === t) { saveSlot(t); renderRack(); return; }
  if (t.offRack) return;
  const free = freeSlot();
  if (free >= 0) putTape(free, t);
  else { t.offRack = true; replaceMenu.offer = t; replaceMenu.sel = 0; openScreenMenu(replaceMenu); } // asked once; kept off, it stays in the recorder
}

// ---------- on the TV: which tape makes room ----------
const replaceMenu = {
  full: true, offer: null, sel: 0,
  draw(s) {
    s.bar(0, 0); s.print(1, 0, 'My Tapes', 7, 0); s.stripes(27, 0);
    s.print(1, 2, 'The rack is full. Which tape', 0);
    s.print(1, 3, 'makes room for:', 0);
    s.print(1, 5, fit(this.offer.title, 30), 4);
    bankSlots().forEach((slot, i) => {
      const t = tapes[slot], on = i === this.sel, paper = on ? 5 + 8 : 7;
      s.bar(7 + i, paper);
      s.print(1, 7 + i, slotName(slot) + ' ' + fit(t ? t.title : '- empty -', 27), 0, paper);
    });
    s.print(1, 18, 'LEFT/RIGHT: bank ' + BANK_NAMES[rackBank] + ' of A-' + BANK_NAMES[BANKS - 1], 1);
    const on = this.sel === RACK_SIZE, paper = on ? 5 + 8 : 7;
    s.bar(16, paper); s.print(1, 16, 'Keep it off the rack', 1, paper);
    s.bar(23, 0); s.print(0, 23, 'ENTER replace     BREAK keep off', 7, 0);
  },
  key(k) {
    if (k === 'UP') this.sel = (this.sel + RACK_SIZE) % (RACK_SIZE + 1);
    else if (k === 'DOWN') this.sel = (this.sel + 1) % (RACK_SIZE + 1);
    else if (k === 'LEFT' || k === 'RIGHT') showBank(rackBank + (k === 'LEFT' ? -1 : 1));
    else if (k === 'ENTER') this.choose(this.sel);
    else if (k === 'BREAK') this.choose(RACK_SIZE);
    else if (/^CHAR:[1-8]$/.test(k)) this.choose(+k.slice(5) - 1);
  },
  click(col, row) {
    if (row >= 7 && row < 7 + RACK_SIZE) this.choose(row - 7);
    else if (row === 16) this.choose(RACK_SIZE);
    else if (row === 18) showBank(rackBank + 1);
  },
  choose(i) {
    closeScreenMenu();
    if (i < RACK_SIZE) { const slot = rackBank * RACK_SIZE + i; delete this.offer.offRack; putTape(slot, this.offer); status('On the rack: ' + slotName(slot) + ' ' + this.offer.title); }
    this.offer = null;
  },
};

// ---------- on the TV: my tapes ----------
const tapesMenu = {
  full: true, sel: 0, status: '', confirm: -1,
  draw(s) {
    s.bar(0, 0); s.print(1, 0, 'My Tapes', 7, 0); s.stripes(27, 0);
    s.print(1, 2, 'Bank ' + BANK_NAMES[rackBank] + ' of A-' + BANK_NAMES[BANKS - 1] + ' (LEFT/RIGHT). Kept', 1);
    s.print(1, 3, 'on this device: they work offline', 1);
    const items = this.items();
    items.forEach((it, i) => {
      const row = it.row, on = i === this.sel, paper = on ? 5 + 8 : 7;
      s.bar(row, paper);
      s.print(1, row, it.label, it.ink, paper);
      if (it.right) s.print(31 - it.right.length, row, it.right, 1, paper);
    });
    const it = items[this.sel], t = it && it.slot !== undefined ? tapes[it.slot] : null;
    if (t) {
      s.print(0, 20, fit(t.title, 32), 0);
      s.print(0, 21, fit(SOURCES[t.source] + ', ' + new Date(t.added).toLocaleDateString(), 32), 1);
    }
    if (this.status) s.print(0, 19, fit(this.status.replace(/^!/, ''), 32), this.status.startsWith('!') ? 2 : 4);
    s.bar(23, 0); s.print(0, 23, 'ENTER pick DELETE remove BREAK', 7, 0);
  },
  // the eight places of the bank on show, then the actions
  items() {
    const list = bankSlots().map((i, k) => tapes[i]
      ? { slot: i, row: 5 + k, label: slotName(i) + ' ' + fit(tapes[i].title, 21), ink: 0, right: tapes[i].name.split('.').pop().toUpperCase() }
      : { slot: i, row: 5 + k, label: slotName(i) + ' - empty -', ink: 1 });
    list.push({ act: 'find', row: 14, label: 'F  Find a game (catalogue)', ink: 0 });
    list.push({ act: 'open', row: 15, label: 'O  Open a file of your own', ink: 0 });
    list.push({ act: 'save', row: 16, label: 'S  Save a backup file', ink: 0 });
    list.push({ act: 'load', row: 17, label: 'L  Load a backup file', ink: 0 });
    return list;
  },
  key(k) {
    const items = this.items(), it = items[this.sel];
    if (k !== 'DELETE') this.confirm = -1;
    if (k === 'UP') this.sel = (this.sel + items.length - 1) % items.length;
    else if (k === 'DOWN') this.sel = (this.sel + 1) % items.length;
    else if (k === 'BREAK') closeScreenMenu();
    else if (k === 'LEFT' || k === 'RIGHT') { showBank(rackBank + (k === 'LEFT' ? -1 : 1)); this.status = ''; }
    else if (k === 'ENTER') this.pick(it);
    else if (k === 'DELETE' && it.slot !== undefined && tapes[it.slot]) {
      if (this.confirm === it.slot) { removeTape(it.slot); this.status = 'Tape removed'; this.confirm = -1; }
      else { this.confirm = it.slot; this.status = '!DELETE again to remove it'; }
    } else if (k.startsWith('CHAR:')) {
      const c = k.slice(5).toLowerCase();
      const act = { f: 'find', o: 'open', s: 'save', l: 'load' }[c];
      if (act) this.pick(items.find(x => x.act === act));
      else if (/[1-8]/.test(c)) { this.sel = +c - 1; this.pick(items[this.sel]); }
      else if (/[a-d]/.test(c)) { showBank(BANK_NAMES.indexOf(c.toUpperCase())); this.status = ''; } // A-D: that bank
    }
  },
  click(col, row) {
    const items = this.items(), i = items.findIndex(x => x.row === row);
    if (i >= 0) { this.sel = i; this.pick(items[i]); }
  },
  pick(it) {
    if (!it) return;
    if (it.slot !== undefined) {
      if (tapes[it.slot]) { closeScreenMenu(); playRackTape(it.slot); } else { closeScreenMenu(); openCatalogue(); }
    } else if (it.act === 'find') { closeScreenMenu(); openCatalogue(); }
    else if (it.act === 'open') { closeScreenMenu(); openFile(); }
    else if (it.act === 'save') this.status = saveBackup();
    else if (it.act === 'load') document.getElementById('backupInput').click();
  },
};
function openTapesMenu() {
  if (screenMenuOpen()) return;
  tapesMenu.sel = 0; tapesMenu.status = ''; tapesMenu.confirm = -1;
  openScreenMenu(tapesMenu);
}

// ---------- backup file: the whole rack in one file (.zxtapes, JSON with the files in base64) ----------
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(s);
}
function saveBackup() {
  const list = tapes.filter(Boolean);
  if (!list.length) return '!The rack is empty';
  const data = { format: 'zx-spectrum-tapes', version: 1, tapes: list.map(t => ({ title: t.title, name: t.name, source: t.source, machine: t.machine || 0, added: t.added, slot: t.slot, data: toBase64(t.bytes) })) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = 'my-zx-tapes.zxtapes';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'Backup saved: ' + list.length + ' tape' + (list.length > 1 ? 's' : '');
}
// a backup replaces the rack (up to its 32 places; each tape back in its place when the backup says which)
function loadBackup(bytes) {
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data.format !== 'zx-spectrum-tapes') throw new Error();
    for (let i = 0; i < ALL_SLOTS; i++) if (tapes[i]) removeTape(i);
    const list = data.tapes.slice(0, ALL_SLOTS), used = new Set(list.map(t => t.slot).filter(k => k >= 0 && k < ALL_SLOTS));
    let next = 0;
    list.forEach(t => {
      let slot = t.slot;
      if (!(slot >= 0 && slot < ALL_SLOTS) || tapes[slot]) { while (used.has(next) || tapes[next]) next++; slot = next++; }
      putTape(slot, { title: t.title, name: t.name, source: t.source === 'backup' ? 'backup' : t.source, machine: t.machine || 0,
        added: t.added || Date.now(), played: 0, bytes: Uint8Array.from(atob(t.data), c => c.charCodeAt(0)) });
    });
    showBank(0);
    const n = list.length;
    return 'Backup loaded: ' + n + ' tape' + (n > 1 ? 's' : '');
  } catch (e) {
    return '!Not a tapes backup file';
  }
}
document.getElementById('backupInput').addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  f.arrayBuffer().then(buf => {
    const msg = loadBackup(new Uint8Array(buf));
    if (screenMenu === tapesMenu) { tapesMenu.status = msg; redrawScreen(); } else status(msg.replace(/^!/, ''), msg.startsWith('!'));
  });
});

renderRack(); // empty places at once; the stored tapes follow when the browser's storage answers
loadRack();
