// My library: zip files of your own games, kept in this browser (IndexedDB) and searched by the catalogue together with
// ZXDB. Only a zip's index is read when it is added or the page opens; a game is unpacked when it is loaded, so even a
// large zip stays quick. A zip may hold tapes and snapshots, folders (shown as categories) and zips of single games.
'use strict';

let library = []; // { id, name, size, blob, games: [{ lib, path, title, year, publisher, folder, file }] }

// ---------- storage: a database of its own, so the rack's is not touched ----------
let libDbPromise = null;
function libDb() {
  if (!libDbPromise) libDbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open('zx-library', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('zips', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return libDbPromise;
}
async function libDo(mode, fn) {
  const d = await libDb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('zips', mode), req = fn(tx.objectStore('zips'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- zips read in pieces from a Blob (the whole file is never in memory) ----------
async function blobZipEntries(blob) {
  const tailLen = Math.min(blob.size, 65557), tailStart = blob.size - tailLen;
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  if (cdOff === 0xFFFFFFFF || count === 0xFFFF) throw new Error('Zip too large (over 4 GB)');
  const d = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer()), dec = new TextDecoder();
  const entries = [];
  for (let k = 0, p = 0; k < count && p + 46 <= d.byteLength; k++) {
    const nameLen = d.getUint16(p + 28, true), extraLen = d.getUint16(p + 30, true), commentLen = d.getUint16(p + 32, true);
    entries.push({ name: dec.decode(new Uint8Array(d.buffer, p + 46, nameLen)), method: d.getUint16(p + 10, true),
      size: d.getUint32(p + 20, true), offset: d.getUint32(p + 42, true) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
async function blobUnzipEntry(blob, e) {
  const h = new DataView(await blob.slice(e.offset, e.offset + 30).arrayBuffer());
  const start = e.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const data = new Uint8Array(await blob.slice(start, start + e.size).arrayBuffer());
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error('Unsupported zip compression');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- what is in a zip ----------
const GAME_FILE = /\.(tap|tzx|z80|sna|zip)$/i; // a zip inside the library holds one game
const skipEntry = n => n.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(n);
// "Atic Atac (1983)(Ultimate Play the Game)[a].tzx" -> title, year, publisher (the TOSEC way of naming files)
function describeFile(path) {
  const file = path.split('/').pop(), base = file.replace(/\.zip$/i, '').replace(/\.(tap|tzx|z80|sna)$/i, '');
  const brackets = [...base.matchAll(/\(([^)]*)\)/g)].map(m => m[1]);
  const year = (brackets.find(b => /^(19|20)\d\d/.test(b)) || '').slice(0, 4);
  const yi = brackets.findIndex(b => /^(19|20)\d\d/.test(b));
  const publisher = yi >= 0 && brackets[yi + 1] && !/^(19|20)\d\d/.test(brackets[yi + 1]) ? brackets[yi + 1] : '';
  const tags = [...base.matchAll(/\[([^\]]*)\]/g)].map(m => '[' + m[1] + ']').join(''); // [a] another version, [cr] cracked...
  const title = (base.replace(/\s*[([].*$/, '').trim() || base) + (tags ? ' ' + tags : '');
  const folder = path.split('/').slice(0, -1).filter(Boolean).pop() || '';
  return { path, title, year, publisher, folder, file };
}
// a small zip of one game (its sides, levels, or 48K and 128K versions) loads as that game; anything else is a library
function isSingleGame(entries) {
  const games = entries.filter(e => !skipEntry(e.name) && GAME_FILE.test(e.name));
  return games.length > 0 && games.length <= 4 && games.every(e => !e.name.includes('/') && !/\.zip$/i.test(e.name));
}

// ---------- adding, opening, removing ----------
function indexZip(z, entries) {
  const lib = { ...z };
  lib.games = entries.filter(e => !skipEntry(e.name) && GAME_FILE.test(e.name)).map(e => ({ ...describeFile(e.name), entry: e, lib }));
  lib.games.sort((a, b) => naturally(a.title, b.title));
  return lib;
}
async function openLibrary() {
  try {
    const zips = await libDo('readonly', s => s.getAll());
    const out = [];
    for (const z of zips) { try { out.push(indexZip(z, await blobZipEntries(z.blob))); } catch (e) { /* a damaged zip: left out */ } }
    library = out;
  } catch (e) { library = []; /* no storage (private window) */ }
}
const libraryCount = () => library.reduce((n, z) => n + z.games.length, 0);

// a zip from a file picker or a drop: one game loads at once, a collection becomes a library (returns true if handled)
async function addZip(file) {
  const blob = file instanceof Blob ? file : new Blob([file]);
  let entries;
  try { entries = await blobZipEntries(blob); } catch (e) { status(e.message, true); return true; }
  if (isSingleGame(entries)) { // load it like a catalogue download, and onto the rack
    const { name, bytes } = await gameFromZip(await blob.arrayBuffer(), file.name || 'game.zip');
    if (loadFile(name, bytes)) rackOffer({ title: describeFile(file.name || name).title, name, bytes, source: 'file' });
    return true;
  }
  const z = { name: (file.name || 'Library').replace(/\.zip$/i, ''), size: blob.size, added: Date.now(), blob };
  const lib = indexZip(z, entries);
  if (!lib.games.length) { status('No tapes or snapshots in that zip', true); return true; }
  const same = library.find(l => l.name === z.name && l.size === z.size);
  if (same) { status('Already in your library: ' + z.name); return true; }
  try {
    lib.id = await libDo('readwrite', s => s.add(z));
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    status('Too big to keep in this browser - for this visit only', true);
    lib.id = -Date.now();
  }
  library.push(lib);
  status('Library: ' + lib.games.length + ' games from ' + z.name);
  if (screenMenu === catalogue) redrawScreen();
  return true;
}
async function removeLibrary(lib) {
  library = library.filter(l => l !== lib);
  if (lib.id > 0) await libDo('readwrite', s => s.delete(lib.id)).catch(() => {});
}

// titles whose name (or folder) holds every word typed
function searchLibrary(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const z of library) for (const g of z.games) {
    const hay = (g.title + ' ' + g.file + ' ' + g.folder + ' ' + g.publisher).toLowerCase();
    if (words.every(w => hay.includes(w))) hits.push(g);
  }
  return hits;
}
// a game's bytes: a tape or snapshot as it is, a zip inside the library unpacked as one game
async function libraryGame(g) {
  const bytes = await blobUnzipEntry(g.lib.blob, g.entry);
  if (/\.zip$/i.test(g.file)) return gameFromZip(bytes.buffer, g.file);
  return { name: g.file, bytes };
}

openLibrary().then(() => { if (screenMenu === catalogue) redrawScreen(); });
