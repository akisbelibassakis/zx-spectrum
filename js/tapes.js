// My tapes: the cassette rack on the desk holds up to 6 tapes kept in the browser (IndexedDB), so they work offline.
// Games downloaded from the catalogue, files opened from the device and Multiface saves go into it; when it is full
// a page on the TV asks which tape makes room. The whole rack can be saved to a backup file and loaded elsewhere.
'use strict';

const RACK_SIZE = 6;
const SPINE_COLOURS = ['#d70000', '#1f5fbf', '#e8b100', '#2c8a3a', '#7b2fa8', '#d45a00'];
const SOURCES = { archive: 'downloaded', file: 'your file', multiface: 'Multiface save', backup: 'from a backup' };
let tapes = new Array(RACK_SIZE).fill(null); // { slot, title, name, bytes, source, added, played }
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
    for (const t of await dbDo('readonly', s => s.getAll())) if (t.slot < RACK_SIZE) tapes[t.slot] = t;
  } catch (e) { /* no storage (private window): the rack still works until the page is closed */ }
  renderRack();
}

// ---------- the rack on the desk ----------
const rackEl = document.getElementById('rack'), rackSlots = rackEl.querySelector('.slots');
function renderRack() {
  rackSlots.innerHTML = '';
  tapes.forEach((t, i) => {
    const b = document.createElement('button');
    if (t) {
      b.className = 'spine';
      b.style.setProperty('--c', SPINE_COLOURS[i]);
      b.textContent = t.title.toUpperCase();
      b.dataset.tip = t.title + ': load it';
      b.onclick = () => playTape(i);
    } else {
      b.className = 'spine empty';
      b.dataset.tip = 'Empty: find a game (F2)';
      b.onclick = () => openCatalogue();
    }
    rackSlots.appendChild(b);
  });
}
rackEl.querySelector('.racklabel').onclick = () => openTapesMenu();

function playTape(i) {
  const t = tapes[i];
  if (!t || screenMenuOpen()) return;
  lastTitle = t.title;
  t.played = Date.now();
  saveSlot(t);
  loadFile(t.name, t.bytes);
}

// a new tape: into a free place, or (rack full) the TV asks which one makes room
function rackOffer(t) {
  t = { title: t.title || t.name.replace(/\.[^.]+$/, ''), name: t.name, bytes: t.bytes, source: t.source, added: Date.now(), played: Date.now() };
  lastTitle = t.title;
  const same = tapes.findIndex(x => x && x.name === t.name && x.bytes.length === t.bytes.length);
  if (same >= 0) { tapes[same].played = Date.now(); saveSlot(tapes[same]); return; } // already on the rack
  const free = tapes.indexOf(null);
  if (free >= 0) { putTape(free, t); status('On the rack: ' + t.title); return; }
  replaceMenu.offer = t; replaceMenu.sel = 0;
  openScreenMenu(replaceMenu);
}
function putTape(slot, t) {
  t.slot = slot;
  tapes[slot] = t;
  saveSlot(t);
  renderRack();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); // keep it when space is short
}
function removeTape(slot) { tapes[slot] = null; clearSlot(slot); renderRack(); }

// ---------- on the TV: which tape makes room ----------
const replaceMenu = {
  full: true, offer: null, sel: 0,
  draw(s) {
    s.bar(0, 0); s.print(1, 0, 'My Tapes', 7, 0); s.stripes(27, 0);
    s.print(1, 2, 'The rack is full. Which tape', 0);
    s.print(1, 3, 'makes room for:', 0);
    s.print(1, 5, fit(this.offer.title, 30), 4);
    tapes.forEach((t, i) => {
      const on = i === this.sel, paper = on ? 5 + 8 : 7;
      s.bar(7 + i, paper);
      s.print(1, 7 + i, (i + 1) + ' ' + fit(t.title, 28), 0, paper);
    });
    const on = this.sel === RACK_SIZE, paper = on ? 5 + 8 : 7;
    s.bar(14, paper); s.print(1, 14, 'Keep it off the rack', 1, paper);
    s.bar(23, 0); s.print(0, 23, 'ENTER replace     BREAK keep off', 7, 0);
  },
  key(k) {
    if (k === 'UP') this.sel = (this.sel + RACK_SIZE) % (RACK_SIZE + 1);
    else if (k === 'DOWN') this.sel = (this.sel + 1) % (RACK_SIZE + 1);
    else if (k === 'ENTER') this.choose(this.sel);
    else if (k === 'BREAK') this.choose(RACK_SIZE);
    else if (/^CHAR:[1-6]$/.test(k)) this.choose(+k.slice(5) - 1);
  },
  click(col, row) {
    if (row >= 7 && row < 7 + RACK_SIZE) this.choose(row - 7);
    else if (row === 14) this.choose(RACK_SIZE);
  },
  choose(i) {
    closeScreenMenu();
    if (i < RACK_SIZE) { putTape(i, this.offer); status('On the rack: ' + this.offer.title); }
    this.offer = null;
  },
};

// ---------- on the TV: my tapes ----------
const tapesMenu = {
  full: true, sel: 0, status: '', confirm: -1,
  draw(s) {
    s.bar(0, 0); s.print(1, 0, 'My Tapes', 7, 0); s.stripes(27, 0);
    s.print(1, 2, 'Your rack (' + RACK_SIZE + ' places), kept on', 1);
    s.print(1, 3, 'this device: they work offline.', 1);
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
    if (this.status) s.print(0, 18, fit(this.status.replace(/^!/, ''), 32), this.status.startsWith('!') ? 2 : 4);
    s.bar(23, 0); s.print(0, 23, 'ENTER pick DELETE remove BREAK', 7, 0);
  },
  // the six places, then the actions
  items() {
    const list = tapes.map((t, i) => t
      ? { slot: i, row: 5 + i, label: (i + 1) + ' ' + fit(t.title, 22), ink: 0, right: t.name.split('.').pop().toUpperCase() }
      : { slot: i, row: 5 + i, label: (i + 1) + ' - empty -', ink: 1 });
    list.push({ act: 'find', row: 12, label: 'F  Find a game (catalogue)', ink: 0 });
    list.push({ act: 'save', row: 13, label: 'S  Save a backup file', ink: 0 });
    list.push({ act: 'load', row: 14, label: 'L  Load a backup file', ink: 0 });
    return list;
  },
  key(k) {
    const items = this.items(), it = items[this.sel];
    if (k !== 'DELETE') this.confirm = -1;
    if (k === 'UP') this.sel = (this.sel + items.length - 1) % items.length;
    else if (k === 'DOWN') this.sel = (this.sel + 1) % items.length;
    else if (k === 'BREAK') closeScreenMenu();
    else if (k === 'ENTER') this.pick(it);
    else if (k === 'DELETE' && it.slot !== undefined && tapes[it.slot]) {
      if (this.confirm === it.slot) { removeTape(it.slot); this.status = 'Tape removed'; this.confirm = -1; }
      else { this.confirm = it.slot; this.status = '!DELETE again to remove it'; }
    } else if (k.startsWith('CHAR:')) {
      const c = k.slice(5).toLowerCase();
      const act = { f: 'find', s: 'save', l: 'load' }[c];
      if (act) this.pick(items.find(x => x.act === act));
      else if (/[1-6]/.test(c)) { this.sel = +c - 1; this.pick(items[this.sel]); }
    }
  },
  click(col, row) {
    const items = this.items(), i = items.findIndex(x => x.row === row);
    if (i >= 0) { this.sel = i; this.pick(items[i]); }
  },
  pick(it) {
    if (!it) return;
    if (it.slot !== undefined) {
      if (tapes[it.slot]) { closeScreenMenu(); playTape(it.slot); } else { closeScreenMenu(); openCatalogue(); }
    } else if (it.act === 'find') { closeScreenMenu(); openCatalogue(); }
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
  const data = { format: 'zx-spectrum-tapes', version: 1, tapes: list.map(t => ({ title: t.title, name: t.name, source: t.source, added: t.added, data: toBase64(t.bytes) })) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = 'my-zx-tapes.zxtapes';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'Backup saved: ' + list.length + ' tape' + (list.length > 1 ? 's' : '');
}
// a backup replaces the rack (its first 6 tapes)
function loadBackup(bytes) {
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (data.format !== 'zx-spectrum-tapes') throw new Error();
    for (let i = 0; i < RACK_SIZE; i++) if (tapes[i]) removeTape(i);
    data.tapes.slice(0, RACK_SIZE).forEach((t, i) => putTape(i, { title: t.title, name: t.name, source: t.source === 'backup' ? 'backup' : t.source,
      added: t.added || Date.now(), played: 0, bytes: Uint8Array.from(atob(t.data), c => c.charCodeAt(0)) }));
    const n = Math.min(RACK_SIZE, data.tapes.length);
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
