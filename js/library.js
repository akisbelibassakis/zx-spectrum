// Your libraries: folders or zips of your own games, on this device. Only their index (the games' names and places)
// is kept in the browser, so a library can be as big as you like: the games stay in your folder or zip and are read
// when one is loaded. Between visits the browser forgets your files, so a library stays listed and searchable but
// "not connected" until you choose Reconnect (R), which asks for it again (permission, or picking it once more).
// Chrome and Edge on a PC remember the folder or zip itself (File System Access); elsewhere the file is picked again.
'use strict';

const LIB_GAME = /\.(tap|tzx|z80|sna|zip)$/i; // a zip inside a library holds one game
const skipEntry = n => n.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(n);
// folders can be picked on a PC (Chrome/Edge: remembered; Firefox: picked again); phones and tablets have zips only
const canPickFolder = !!window.showDirectoryPicker ||
  (!matchMedia('(pointer: coarse)').matches && 'webkitdirectory' in document.createElement('input'));
let libraries = []; // { id, name, kind: 'zip'|'folder', size, added, games, handle } and, while connected, conn

// ---------- storage: the index only (and, on Chrome/Edge, the handle to the folder or zip) ----------
let libDbPromise = null;
function libDb() {
  if (!libDbPromise) libDbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open('zx-libraries', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('libraries', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return libDbPromise;
}
async function libDo(mode, fn) {
  const d = await libDb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('libraries', mode), req = fn(tx.objectStore('libraries'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
const libRecord = lib => ({ id: lib.id, name: lib.name, kind: lib.kind, size: lib.size, added: lib.added, games: lib.games, handle: lib.handle || null });
try { indexedDB.deleteDatabase('zx-library'); } catch (e) { /* an earlier try that kept whole zips: its space back */ }

// ---------- zips, read in pieces from a File (the whole file is never in memory) ----------
async function blobZipIndex(blob) {
  const tailLen = Math.min(blob.size, 65557 + 20), tailStart = blob.size - tailLen;
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  let count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  if (cdOff === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) { // ZIP64 (big zips)
    const loc = eocd - 20;
    if (loc < 0 || tail.getUint32(loc, true) !== 0x07064b50) throw new Error('Damaged zip file');
    const at = Number(tail.getBigUint64(loc + 8, true));
    const z = new DataView(await blob.slice(at, at + 56).arrayBuffer());
    count = Number(z.getBigUint64(32, true)); cdSize = Number(z.getBigUint64(40, true)); cdOff = Number(z.getBigUint64(48, true));
  }
  const d = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()), dec = new TextDecoder();
  const entries = [];
  for (let k = 0, p = 0; k < count && p + 46 <= d.byteLength; k++) {
    const nameLen = d.getUint16(p + 28, true), extraLen = d.getUint16(p + 30, true), commentLen = d.getUint16(p + 32, true);
    let size = d.getUint32(p + 20, true), usize = d.getUint32(p + 24, true), offset = d.getUint32(p + 42, true);
    if (size === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff) { // ZIP64 sizes in the extra field
      for (let x = p + 46 + nameLen; x + 4 <= p + 46 + nameLen + extraLen;) {
        const id = d.getUint16(x, true), len = d.getUint16(x + 2, true);
        if (id === 1) {
          let y = x + 4;
          if (usize === 0xffffffff) { usize = Number(d.getBigUint64(y, true)); y += 8; }
          if (size === 0xffffffff) { size = Number(d.getBigUint64(y, true)); y += 8; }
          if (offset === 0xffffffff) offset = Number(d.getBigUint64(y, true));
        }
        x += 4 + len;
      }
    }
    entries.push({ name: dec.decode(new Uint8Array(d.buffer, p + 46, nameLen)), method: d.getUint16(p + 10, true), size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
async function blobUnzipEntry(blob, e) {
  const h = new DataView(await blob.slice(e.offset, e.offset + 30).arrayBuffer());
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error('The zip has changed - reconnect it');
  const start = e.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const data = new Uint8Array(await blob.slice(start, start + e.size).arrayBuffer());
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error('Unsupported zip compression');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- what a game is, from its file name ----------
// "Atic Atac (1983)(Ultimate Play the Game)[a].tzx" -> title, year, publisher, tags (the TOSEC way of naming files)
function describeFile(path) {
  const file = path.split('/').pop(), base = file.replace(/\.zip$/i, '').replace(/\.(tap|tzx|z80|sna)$/i, '');
  const brackets = [...base.matchAll(/\(([^)]*)\)/g)].map(m => m[1]);
  const yi = brackets.findIndex(b => /^(19|20)\d\d/.test(b));
  const year = yi >= 0 ? brackets[yi].slice(0, 4) : '';
  const publisher = yi >= 0 && brackets[yi + 1] && !/^(19|20)\d\d/.test(brackets[yi + 1]) ? brackets[yi + 1] : '';
  const tags = [...base.matchAll(/\[([^\]]*)\]/g)].map(m => '[' + m[1] + ']').join(''); // [a] another version, [cr] cracked...
  const title = (base.replace(/\s*[([].*$/, '').trim() || base) + (tags ? ' ' + tags : '');
  const folder = path.split('/').slice(0, -1).filter(Boolean).pop() || '';
  return { path, file, title, year, publisher, folder };
}
// titles reduced for matching: no case, punctuation or "The"; a file name also loses its TOSEC brackets and words
// such as 48k, 128k or side 2 ("Renegade - 128k (1987)(Imagine)[a]" matches ZXDB's "Renegade")
const titleKey = t => String(t).toLowerCase().replace(/^\s*the\s+|,\s*the\s*$/g, ' ').replace(/[^a-z0-9]/g, '');
const fileKey = t => titleKey(String(t).toLowerCase()
  .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
  .replace(/\b(16k|48k|128k|side \w|part \d+|tape \d+|disk \d+)\b/g, ' '));
function prepareLibrary(lib) {
  for (const g of lib.games) { g.lib = lib; g.key = fileKey(g.title); g.hay = (g.title + ' ' + g.file + ' ' + g.folder + ' ' + g.publisher).toLowerCase(); }
  lib.games.sort((a, b) => naturally(a.title, b.title));
  return lib;
}
const gamesOfZip = entries => entries.filter(e => !skipEntry(e.name) && LIB_GAME.test(e.name))
  .map(e => ({ ...describeFile(e.name), entry: { offset: e.offset, size: e.size, method: e.method } }));
const gamesOfPaths = paths => paths.filter(p => !skipEntry(p) && LIB_GAME.test(p)).map(describeFile);
// the stored form of a game: without the fields worked out again on loading
const storedGames = games => games.map(({ lib, key, hay, ...g }) => g);

// ---------- picking files: the File System Access pickers where there are some, a file input elsewhere ----------
// Must be called straight from a key press or a click (the browser asks for that).
const libInput = document.getElementById('libInput');
let libPick = null; // the picker's answer, while one is open
function pickFiles({ accept, folder }) {
  if (libPick) libPick(null);
  return new Promise(resolve => {
    libPick = resolve;
    libInput.value = '';
    libInput.accept = accept || '';
    libInput.webkitdirectory = !!folder;
    libInput.click();
  });
}
libInput.addEventListener('change', () => { const r = libPick; libPick = null; if (r) r(libInput.files.length ? [...libInput.files] : null); });
libInput.addEventListener('cancel', () => { const r = libPick; libPick = null; if (r) r(null); });
// all games in a folder picked with showDirectoryPicker, with a count as it goes
async function walkFolder(dir, onCount, prefix = '', out = []) {
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.') || name === '__MACOSX') continue;
    if (h.kind === 'directory') await walkFolder(h, onCount, prefix + name + '/', out);
    else if (LIB_GAME.test(name)) { out.push(prefix + name); if (out.length % 250 === 0) onCount(out.length); }
  }
  return out;
}
// files from a folder input: "Folder/sub/game.tap" -> "sub/game.tap"
const folderPaths = files => new Map(files.map(f => [(f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name, f]));

function libSay(msg) { // on the catalogue's status line when it is open, else on the TV
  if (screenMenu === catalogue) { catalogue.status = msg; redrawScreen(); } else status(msg.replace(/^!/, ''), msg.startsWith('!'));
}

// ---------- adding ----------
async function addLibrary(rec, conn) {
  const same = libraries.find(l => l.name === rec.name && l.kind === rec.kind);
  if (same) { // the same library again: it is reconnected (and its index renewed)
    Object.assign(same, { games: rec.games, size: rec.size, handle: rec.handle || same.handle, conn });
    prepareLibrary(same);
    libDo('readwrite', s => s.put(libRecord({ ...same, games: storedGames(same.games) }))).catch(() => {});
    libSay(same.name + ': ' + same.games.length + ' games, connected');
    return same;
  }
  const lib = prepareLibrary({ ...rec, conn });
  try {
    lib.id = await libDo('readwrite', s => s.add({ name: rec.name, kind: rec.kind, size: rec.size, added: rec.added, games: storedGames(lib.games), handle: rec.handle || null }));
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    lib.id = -Date.now(); // no storage (a private window): for this visit only
  }
  libraries.push(lib);
  libSay('Added ' + lib.name + ': ' + lib.games.length + ' games');
  return lib;
}
async function addZipLibrary() {
  let file, handle = null;
  if (window.showOpenFilePicker) {
    try { [handle] = await showOpenFilePicker({ types: [{ description: 'Zip of games', accept: { 'application/zip': ['.zip'] } }] }); } catch (e) { return; }
    file = await handle.getFile();
  } else {
    const files = await pickFiles({ accept: '.zip,application/zip' });
    if (!files) return;
    file = files[0];
  }
  libSay('Reading ' + file.name + '...');
  try {
    const games = gamesOfZip(await blobZipIndex(file));
    if (!games.length) { libSay('!No tapes or snapshots in that zip'); return; }
    await addLibrary({ name: file.name, kind: 'zip', size: file.size, added: Date.now(), games, handle }, file);
  } catch (e) { libSay('!' + e.message); }
}
async function addFolderLibrary() {
  if (window.showDirectoryPicker) {
    let dir;
    try { dir = await showDirectoryPicker({ mode: 'read' }); } catch (e) { return; }
    libSay('Reading ' + dir.name + '...');
    try {
      const paths = await walkFolder(dir, n => libSay('Reading ' + dir.name + ': ' + n + ' games'));
      if (!paths.length) { libSay('!No tapes or snapshots in that folder'); return; }
      await addLibrary({ name: dir.name, kind: 'folder', size: paths.length, added: Date.now(), games: gamesOfPaths(paths), handle: dir }, dir);
    } catch (e) { libSay('!' + e.message); }
    return;
  }
  const files = await pickFiles({ folder: true });
  if (!files) return;
  const map = folderPaths(files), name = (files[0].webkitRelativePath || '').split('/')[0] || 'Folder';
  const games = gamesOfPaths([...map.keys()]);
  if (!games.length) { libSay('!No tapes or snapshots in that folder'); return; }
  await addLibrary({ name, kind: 'folder', size: games.length, added: Date.now(), games }, map);
}

// ---------- connecting ----------
// Ask for one library again; returns true when connected. Called straight from a key press or a click: the
// permission request or the file picker is made before anything is awaited.
async function reconnectLibrary(lib) {
  try {
    if (lib.handle) {
      if (await lib.handle.requestPermission({ mode: 'read' }) !== 'granted') return false;
      lib.conn = lib.kind === 'zip' ? await lib.handle.getFile() : lib.handle;
      if (lib.kind === 'zip' && lib.conn.size !== lib.size) await reindexZip(lib); // the zip has changed
      return true;
    }
    const files = await pickFiles(lib.kind === 'zip' ? { accept: '.zip,application/zip' } : { folder: true });
    if (!files) return false;
    if (lib.kind === 'zip') {
      lib.conn = files[0];
      if (files[0].size !== lib.size || files[0].name !== lib.name) await reindexZip(lib);
    } else {
      lib.conn = folderPaths(files);
      const games = gamesOfPaths([...lib.conn.keys()]);
      if (games.length !== lib.games.length) { lib.games = games; lib.size = games.length; prepareLibrary(lib); saveLibrary(lib); }
    }
    return true;
  } catch (e) {
    lib.conn = null;
    libSay('!' + (e.message || 'Could not reconnect'));
    return false;
  }
}
async function reindexZip(lib) {
  libSay('Reading ' + lib.conn.name + '...');
  lib.games = gamesOfZip(await blobZipIndex(lib.conn));
  lib.size = lib.conn.size; lib.name = lib.conn.name;
  prepareLibrary(lib);
  saveLibrary(lib);
}
function saveLibrary(lib) { if (lib.id > 0) libDo('readwrite', s => s.put(libRecord({ ...lib, games: storedGames(lib.games) }))).catch(() => {}); }
// R: every library not connected. Permissions can all be asked at once; a file picker only once per key press
async function reconnectAll() {
  const off = libraries.filter(l => !l.conn);
  if (!off.length) { libSay('All your libraries are connected'); return; }
  const asks = off.filter(l => l.handle).map(reconnectLibrary);
  const pick = off.find(l => !l.handle);
  if (pick) { libSay('Choose ' + pick.name + ' (' + (pick.kind === 'zip' ? 'the zip' : 'the folder') + ')'); asks.push(reconnectLibrary(pick)); }
  await Promise.all(asks);
  const left = libraries.filter(l => !l.conn);
  libSay(!left.length ? 'Connected: ' + libraries.length + (libraries.length > 1 ? ' libraries' : ' library')
    : left.some(l => !l.handle) && left.length < off.length ? 'R again for ' + left.find(l => !l.handle).name : '!' + left[0].name + ' is not connected');
}
async function removeLibrary(lib) {
  libraries = libraries.filter(l => l !== lib);
  if (lib.id > 0) await libDo('readwrite', s => s.delete(lib.id)).catch(() => {});
}

// ---------- searching and loading ----------
// games whose name (or folder, or publisher) holds every word typed; in all libraries, or in one
function searchLibraries(text, only) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean), hits = [];
  for (const lib of only ? [only] : libraries) for (const g of lib.games) if (words.every(w => g.hay.includes(w))) hits.push(g);
  return hits;
}
async function libraryBytes(g) {
  const lib = g.lib, c = lib.conn;
  if (lib.kind === 'zip') return blobUnzipEntry(c, g.entry);
  if (c instanceof Map) {
    const f = c.get(g.path);
    if (!f) throw new Error('Not in the folder any more');
    return new Uint8Array(await f.arrayBuffer());
  }
  const parts = g.path.split('/');
  let dir = c;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
  return new Uint8Array(await (await (await dir.getFileHandle(parts[parts.length - 1])).getFile()).arrayBuffer());
}
// a game's tape or snapshot: as it is, or a zip in the library unpacked as one game (in parts if it holds several tapes)
async function libraryGame(g) {
  const bytes = await libraryBytes(g);
  return /\.zip$/i.test(g.file) ? gameFromZip(bytes.buffer, g.file) : { name: g.file, bytes };
}

// ---------- at start: the index of each library; Chrome and Edge reconnect by themselves if still allowed ----------
(async () => {
  try {
    for (const rec of await libDo('readonly', s => s.getAll())) {
      const lib = prepareLibrary({ ...rec, conn: null });
      libraries.push(lib);
      if (lib.handle && lib.handle.queryPermission) {
        try {
          if (await lib.handle.queryPermission({ mode: 'read' }) === 'granted') lib.conn = lib.kind === 'zip' ? await lib.handle.getFile() : lib.handle;
        } catch (e) { /* moved or deleted: stays not connected */ }
      }
    }
  } catch (e) { /* no storage (a private window) */ }
  if (screenMenu === catalogue) redrawScreen();
})();
