// The software catalogue: search ZXDB (through the ZXInfo API) and load a game straight from the
// World of Spectrum mirror on archive.org. Only titles ZXDB marks as available can be downloaded.
'use strict';

const ZXINFO = 'https://api.zxinfo.dk/v5/search/';
const WOS_MIRROR = 'https://archive.org/download/World_of_Spectrum_June_2017_Mirror/' +
  'World%20of%20Spectrum%20June%202017%20Mirror.zip/World%20of%20Spectrum%20June%202017%20Mirror/';
const LOADABLE = /\.(tap|tzx|z80|sna)\.zip$/i;

// a file path from ZXDB ("/pub/sinclair/games/m/ManicMiner.tap.zip") on the archive.org mirror;
// files added to ZXDB after 2017 live elsewhere and cannot be fetched by a web page
const mirrorUrl = path => path.startsWith('/pub/') ? WOS_MIRROR + encodeURIComponent(path.slice(5)) : null;

// a download with time limits (for the first answer, then between pieces), progress and cancelling;
// its error messages fit the catalogue's status line, and say that ENTER tries again
async function fetchBytes(url, { signal, onProgress, firstWait = 30000, stallWait = 20000 } = {}) {
  const ctl = new AbortController(), stop = () => ctl.abort();
  if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop); }
  let timer = 0, timedOut = false;
  const arm = ms => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctl.abort(); }, ms); };
  try {
    arm(firstWait);
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 404) throw new Error('Not found - try another tape');
    if (!r.ok) throw new Error('Error ' + r.status + ' - ENTER tries again');
    const total = +r.headers.get('Content-Length') || 0, parts = [];
    let got = 0;
    if (onProgress) onProgress(0, total);
    const reader = r.body.getReader();
    for (;;) {
      arm(stallWait);
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (onProgress) onProgress(got, total);
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  } catch (e) {
    if (signal && signal.aborted) { const c = new Error('Cancelled'); c.cancelled = true; throw c; }
    if (timedOut) throw new Error('No answer - ENTER tries again');
    if (e instanceof TypeError) throw new Error('No connection - ENTER again');
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', stop);
  }
}

async function searchZXDB(text, signal) {
  const url = ZXINFO + encodeURIComponent(text) + '?mode=compact&size=30&contenttype=SOFTWARE&machinetype=ZXSPECTRUM';
  const data = JSON.parse(new TextDecoder().decode(await fetchBytes(url, { signal, firstWait: 20000 })));
  return data.hits.hits.map(h => {
    const s = h._source;
    const files = [];
    for (const rel of s.releases || []) for (const f of rel.files || []) {
      if (LOADABLE.test(f.path) && !files.some(x => x.path === f.path)) files.push({ path: f.path, format: f.format, size: f.size, url: mirrorUrl(f.path) });
    }
    return {
      id: h._id, title: s.title, year: s.originalYearOfRelease, machine: s.machineType,
      publisher: (s.publishers && s.publishers[0] && s.publishers[0].name) || '',
      genre: s.genreSubType || s.genreType || '', available: s.availability === 'Available', availability: s.availability || 'Unknown', files,
    };
  });
}

// ---------- zip: read the central directory, inflate with the browser's own DecompressionStream ----------
function zipEntries(buf) {
  const d = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (d.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const entries = [];
  let p = d.getUint32(eocd + 16, true);
  for (let k = d.getUint16(eocd + 10, true); k > 0; k--) {
    const nameLen = d.getUint16(p + 28, true), extraLen = d.getUint16(p + 30, true), commentLen = d.getUint16(p + 32, true);
    entries.push({ name: new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen)), method: d.getUint16(p + 10, true),
      size: d.getUint32(p + 20, true), offset: d.getUint32(p + 42, true) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
async function unzipEntry(buf, e) {
  const d = new DataView(buf);
  const start = e.offset + 30 + d.getUint16(e.offset + 26, true) + d.getUint16(e.offset + 28, true);
  const data = new Uint8Array(buf, start, e.size);
  if (e.method === 0) return data.slice();
  if (e.method !== 8) throw new Error('Unsupported zip compression');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// A download can hold several tapes: two sides, a levels tape, or the 48K and 128K versions. They become one tape
// whose parts are named after what tells the files apart ("48k", "Side 2", "Levels"); the tape stops between parts.
const baseName = n => n.split('/').pop().replace(/\.[^.]+$/, '');
const naturally = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
function partLabels(names) {
  const bases = names.map(baseName), low = bases.map(b => b.toLowerCase());
  const same = (f, n) => low.every(b => f(b, n) === f(low[0], n));
  let head = 0, tail = 0;
  while (head < low[0].length && same((b, n) => b[n], head)) head++;
  while (tail < low[0].length - head && same((b, n) => b[b.length - 1 - n], tail)) tail++;
  while (head > 0 && /\w/.test(low[0][head - 1])) head--;  // whole words: "Side 1", not "1"
  while (tail > 0 && /\w/.test(low[0][low[0].length - tail])) tail--;
  const cut = () => bases.map(b => b.slice(head, b.length - tail).replace(/^[\s\-_.,()]+|[\s\-_.,()]+$/g, ''));
  if (cut().every(x => x.length <= 2)) { // only "1" and "2", or "A" and "B": with the word before ("Side 1")
    while (head > 0 && !/\w/.test(low[0][head - 1])) head--;
    while (head > 0 && /\w/.test(low[0][head - 1])) head--;
  }
  return cut().map((x, i) => x || 'Part ' + (i + 1));
}
async function downloadGame(file, signal, onProgress) {
  const buf = (await fetchBytes(file.url, { signal, onProgress })).buffer;
  return gameFromZip(buf, decodeURIComponent(file.path.split('/').pop()));
}
// the game in a zip (a download, or a zip in your library): one tape or snapshot, or several tapes as one in parts
async function gameFromZip(buf, zipFile) {
  const entries = zipEntries(buf).filter(e => /\.(tap|tzx|z80|sna)$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name));
  if (!entries.length) throw new Error('No tape or snapshot in the zip');
  const tapeEntries = entries.filter(e => /\.(tap|tzx)$/i.test(e.name)).sort((a, b) => naturally(baseName(a.name), baseName(b.name)));
  if (tapeEntries.length < 2) return { name: entries[0].name.split('/').pop(), bytes: await unzipEntry(buf, entries[0]) };
  const files = [];
  for (const e of tapeEntries) files.push({ name: e.name, bytes: await unzipEntry(buf, e) });
  return { name: baseName(zipFile.replace(/\.zip$/i, '')) + '.tzx', bytes: combineTapes(files, partLabels(files.map(f => f.name))) };
}
// the model a ZXDB title is for: 48 (16K or 48K only), 128 (128K only) or 0 (both, or not said)
const titleMachine = m => /^ZX-Spectrum (16K|48K)$/.test(m || '') ? 48 : /128/.test(m || '') && !/48/.test(m || '') ? 128 : 0;

// ---------- the catalogue, on the Spectrum's screen in the style of the 128's menu ----------
// rows: 0 title bar, 2 search line, 3 status, 5-16 list, 18-21 details of the chosen title, 23 keys
const LIST_TOP = 5, LIST_ROWS = 12;
// words wrapped to lines of at most n characters
const wrap = (text, n) => {
  const lines = [];
  let line = '';
  for (const w of String(text).split(' ')) {
    if (line && (line + ' ' + w).length > n) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines;
};
const fit = (t, n) => { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n - 1) + '~' : t.padEnd(n); };
const HOME_TOP = 8, HOME_ROWS = 12; // the first page: your libraries and what can be added, rows 8-19
// a game in your libraries (all its versions), as a line of the list
const libEntry = gr => ({ title: gr.base, year: gr.best.year, publisher: gr.best.publisher, genre: gr.best.folder, machine: '', files: [], local: gr.versions, loadable: true, why: '', own: true });
// a version of your game in the list of tapes: its TOSEC tags (or "original") and publisher
const versionLabel = g => { const t = g.title.slice(g.base.length).trim(); return (t || 'original') + ' ' + (g.publisher || g.folder); };
const catalogue = {
  full: true, blinks: true,
  // mode: 'search' (typing the title), 'home' (the first page's list), 'results', 'files' (a title's tapes)
  // scope: a library being looked through; ask: loading from a library that is not connected
  mode: 'search', query: '', status: 'Type a title, then ENTER', games: [], sel: 0, top: 0, files: [], fsel: 0,
  hsel: 0, scope: null, ask: null, confirm: null, busy: false, ctl: null, progress: 0,

  draw(s, blink) {
    s.bar(0, 0); s.print(1, 0, 'Software Catalogue', 7, 0); s.stripes(27, 0);
    s.print(0, 1, fit(this.where(), 32), 1); // where you are
    s.print(0, 2, this.scope ? 'Find:' : 'Title:', 1);
    const at = this.scope ? 6 : 7;
    s.print(at, 2, fit(this.query, 31 - at));
    if (this.mode === 'search' && !this.busy) s.print(at + this.query.length, 2, 'L', blink ? 7 : 0, blink ? 0 : 7); // the flashing cursor
    s.print(0, 3, fit(this.status.replace(/^!/, ''), 32), this.status.startsWith('!') ? 2 : 1);
    if (this.mode === 'files') this.drawFiles(s);
    else if (!this.games.length && !this.busy && !this.scope) this.drawHome(s);
    else this.drawGames(s);
    if (this.ask) this.drawAsk(s);
    if (!this.progress && !this.busy) s.print(0, 22, fit(this.hintLine(), 32), 1); // what the arrows and letters do here
    if (this.progress) { // the download: a bar along row 22
      s.bar(22, 7);
      s.print(0, 22, ' '.repeat(Math.max(1, Math.round(32 * this.progress))), 4 + 8, 4 + 8);
    }
    s.bar(23, 0);
    s.print(0, 23, fit(this.keysLine(), 32), 7, 0);
  },
  where() {
    let w = 'Catalogue';
    if (this.scope) w += ' > ' + this.scope.name;
    else if (this.games.length) w += ' > "' + this.query.trim() + '"';
    if (this.mode === 'files' && this.games[this.sel]) w += ' > ' + this.games[this.sel].title;
    return w;
  },
  keysLine() {
    if (this.busy) return 'BREAK cancels';
    if (this.ask) return this.ask.archive ? 'R reconnect ENTER archive BREAK' : 'R reconnect it   BREAK back';
    if (this.mode === 'home') return 'ENTER pick  UP title  BREAK exit';
    if (this.mode === 'results' || this.mode === 'files') return 'ENTER pick DEL back BREAK start';
    if (this.scope) return 'Type to narrow  BREAK start';
    return this.games.length ? 'ENTER find  BREAK first page' : 'ENTER find DOWN list BREAK exit';
  },

  // the line above the keys: the arrows, and the letters of the first page
  hintLine() {
    if (this.ask) return '';
    if (this.mode === 'home') return 'UP/DOWN move  F Z O R: as listed';
    if (this.mode === 'results') return 'UP/DOWN move  LEFT/RIGHT a page';
    if (this.mode === 'files') return 'UP/DOWN choose a version or tape';
    if (this.scope || this.games.length) return 'DOWN: to the list';
    return 'DOWN: your libraries (F Z O R)';
  },
  // ---- the first page: your libraries, and what can be added ----
  homeItems() {
    const list = [];
    if (libraries.some(l => !l.conn)) list.push({ act: 'reconnect', label: 'R Reconnect to my library', ink: 2 });
    for (const lib of libraries) list.push({ lib, label: '  ' + lib.name, right: (lib.kind === 'zip' ? 'zip ' : 'dir ') + lib.games.length, ink: lib.conn ? 0 : 1 });
    if (canPickFolder) list.push({ act: 'folder', label: '+ Add a folder', key: 'F', ink: 0 });
    list.push({ act: 'zip', label: '+ Add a zip', key: 'Z', ink: 0 });
    list.push({ act: 'file', label: '+ Open one file', key: 'O', ink: 0 });
    return list;
  },
  homeTop: 0,
  drawHome(s) {
    s.print(1, 5, libraries.length ? 'Search ZXDB and your libraries.' : 'Search ZXDB: everything made', 0);
    s.print(1, 6, libraries.length ? 'Red: cannot be loaded.' : 'for the Spectrum. Red: no file.', libraries.length ? 2 : 0);
    const items = this.homeItems(), off = libraries.filter(l => !l.conn).length;
    s.print(1, HOME_TOP - 1, libraries.length ? 'YOUR LIBRARIES' + (off ? ' (' + (off === libraries.length ? 'not' : off + ' not') + ' connected)' : '') : 'YOUR LIBRARIES (none yet)', 1);
    this.hsel = Math.min(this.hsel, items.length - 1);
    if (this.hsel < this.homeTop) this.homeTop = this.hsel;
    if (this.hsel >= this.homeTop + HOME_ROWS) this.homeTop = this.hsel - HOME_ROWS + 1;
    items.slice(this.homeTop, this.homeTop + HOME_ROWS).forEach((it, i) => {
      const n = this.homeTop + i, on = this.mode === 'home' && n === this.hsel, paper = on ? 5 + 8 : 7, row = HOME_TOP + i;
      s.bar(row, paper);
      s.print(1, row, fit(it.label, it.right ? 30 - it.right.length : 26), it.ink, paper);
      if (it.right) s.print(31 - it.right.length, row, it.right, 1, paper);
      if (it.key) s.print(30, row, it.key, 1, paper);
    });
    if (this.mode === 'home') { // what the chosen line is
      const it = items[this.hsel];
      if (it && it.lib) this.status = this.confirm === it.lib ? '!DELETE again removes it' : (it.lib.conn ? it.lib.games.length + (it.lib.games.length > 1 ? ' games' : ' game') : 'Not connected') + ' - ENTER looks in';
    }
    s.print(1, 20, 'Data: ZXDB via ZXInfo; files:', 1);
    s.print(1, 21, 'World of Spectrum archive', 1);
  },
  homeAct(it) {
    if (!it) return;
    this.confirm = null;
    if (it.act === 'reconnect') reconnectAll().then(() => redrawScreen());
    else if (it.act === 'folder') addFolderLibrary().then(() => redrawScreen());
    else if (it.act === 'zip') addZipLibrary().then(() => redrawScreen());
    else if (it.act === 'file') { closeCatalogue(); openFile(); }
    else if (it.lib) this.openLibrary(it.lib);
  },
  // look through one library: all its games, narrowed as you type
  openLibrary(lib) {
    this.scope = lib; this.query = ''; this.filter();
    this.mode = 'results';
  },
  filter(keep) {
    const lib = this.scope, title = keep && this.games[this.sel] && this.games[this.sel].title;
    this.games = groupGames(this.query.trim() ? searchLibraries(this.query.trim(), lib) : lib.games).map(libEntry);
    this.sel = 0; this.top = 0;
    if (title) { const i = this.games.findIndex(g => g.title === title); if (i > 0) this.move(i); }
    this.checkShown();
    this.status = this.games.length ? this.games.length + (this.games.length > 1 ? ' games' : ' game') + (lib.conn ? '' : ' (not connected)') : '!None with that name';
  },

  drawGames(s) {
    this.games.slice(this.top, this.top + LIST_ROWS).forEach((g, i) => {
      const n = this.top + i, on = this.mode === 'results' && n === this.sel, paper = on ? 5 + 8 : 7;
      s.bar(LIST_TOP + i, paper);
      // yours from ZXDB: black; only in your library: green; cannot be loaded: red
      s.print(1, LIST_TOP + i, fit(g.title, 24), !g.loadable ? 2 : g.own && !g.id ? 4 : 0, paper);
      s.print(27, LIST_TOP + i, g.year || '', 1, paper);
      if (g.id && g.own) s.print(26, LIST_TOP + i, '*', 4, paper); // a ZXDB title you have
    });
    if (this.games.length > LIST_ROWS) s.print(0, LIST_TOP + LIST_ROWS - 1, this.top + LIST_ROWS < this.games.length ? '+' : ' ', 1); // more below
    const g = this.games[this.sel];
    if (g && !this.ask) this.drawDetails(s, g);
  },
  // the panel under the list: what the chosen title is, and whether it can be loaded
  drawDetails(s, g) {
    s.bar(17, 1); // a blue rule
    s.print(0, 18, fit(g.title, 32), 0);
    s.print(0, 19, fit([g.publisher, g.year].filter(Boolean).join(', '), 32), 1);
    s.print(0, 20, fit([g.genre, (g.machine || '').replace('ZX-Spectrum ', 'Spectrum ')].filter(Boolean).join(' - '), 32), 1);
    const own = g.local || [], n = own.length + g.files.length;
    if (own.length) {
      const lib = own[0].lib;
      s.print(0, 21, fit((own.length > 1 ? 'Yours (' + own.length + ' versions)' : 'Yours') + ', in ' + lib.name + (lib.conn ? '' : ' - off'), 32), 4);
    } else if (g.loadable) s.print(0, 21, fit(g.files.length === 1 ? '1 tape - ENTER loads it' : g.files.length + ' tapes - ENTER to choose', 32), 4);
    else s.print(0, 21, fit(g.why, 32), 2);
  },
  // a title's tapes: yours first (marked MINE), then the archive's
  drawFiles(s) {
    const g = this.games[this.sel];
    s.print(1, LIST_TOP, fit(g.title, 30), 0);
    this.files.forEach((f, i) => {
      const on = i === this.fsel, paper = on ? 5 + 8 : 7, row = LIST_TOP + 2 + i;
      const name = f.local ? f.local.file : f.path.split('/').pop().replace(/\.zip$/i, ''); // archive files are all zipped
      const ext = name.split('.').pop().toUpperCase().slice(0, 3);
      s.bar(row, paper);
      s.print(2, row, fit(f.local ? versionLabel(f.local) : name.replace(/\.(tap|tzx|z80|sna|zip)$/i, ''), 20), f.local ? 4 : 0, paper);
      if (f.local) s.print(23, row, 'MINE', 4, paper);
      s.print(31 - ext.length, row, ext, 1, paper);
    });
    const f = this.files[this.fsel];
    if (f && f.local && !this.ask) {
      s.bar(17, 1);
      s.print(0, 18, fit('In ' + f.local.lib.name + (f.local.lib.conn ? '' : ' (not connected)'), 32), 4);
      wrap(f.local.path, 32).slice(0, 3).forEach((line, k) => s.print(0, 19 + k, line, 1));
    }
  },
  // loading from a library that is not connected: reconnect it, or take the archive's copy
  drawAsk(s) {
    const a = this.ask;
    for (let r = 17; r <= 21; r++) s.bar(r, 7);
    s.bar(17, 2);
    s.print(0, 18, fit(a.g.lib.name + ' is not connected.', 32), 2);
    s.print(0, 19, 'R      reconnect it, then load', 0);
    if (a.archive) s.print(0, 20, 'ENTER  load the archive copy', 0);
    s.print(0, 21, 'BREAK  never mind', 0);
  },

  key(k) {
    if (this.busy) { if (k === 'BREAK' && this.ctl) this.ctl.abort(); return; } // a search or download: BREAK cancels it
    const ch = k.startsWith('CHAR:') ? k.slice(5) : null;
    if (this.ask) { // not connected: R, ENTER (the archive's copy) or BREAK
      const a = this.ask;
      if (ch === 'r' || ch === 'R') { this.ask = null; reconnectLibrary(a.g.lib).then(ok => { if (ok) this.loadLocal(a.g, a.game); else redrawScreen(); }); }
      else if (k === 'ENTER' && a.archive) { this.ask = null; this.load(a.archive); }
      else if (k === 'BREAK' || k === 'DELETE') { this.ask = null; this.status = 'Not loaded'; }
      return;
    }
    if (k === 'BREAK') { // from a list or a library: back to the first page; from the first page: back to the Spectrum
      if (this.games.length || this.scope || this.mode === 'results' || this.mode === 'files') this.home(); else closeCatalogue();
      return;
    }
    if (k === 'EDIT' && !this.scope) { this.home(); this.mode = 'home'; this.hsel = this.homeItems().findIndex(it => it.act); return; }
    if (this.mode === 'home') {
      const items = this.homeItems(), it = items[this.hsel];
      if (k !== 'DELETE') this.confirm = null;
      if (k === 'UP') { if (this.hsel > 0) this.hsel--; else { this.mode = 'search'; this.status = 'Type a title, then ENTER'; } }
      else if (k === 'DOWN') this.hsel = Math.min(items.length - 1, this.hsel + 1);
      else if (k === 'ENTER') this.homeAct(it);
      else if (k === 'DELETE' && it && it.lib) {
        if (this.confirm === it.lib) { removeLibrary(it.lib).then(() => redrawScreen()); this.status = 'Removed ' + it.lib.name; this.confirm = null; }
        else this.confirm = it.lib;
      } else if (ch) {
        const act = { r: 'reconnect', f: 'folder', z: 'zip', o: 'file' }[ch.toLowerCase()];
        const hit = act && items.find(x => x.act === act);
        if (hit) { this.hsel = items.indexOf(hit); this.homeAct(hit); }
        else { this.mode = 'search'; this.status = 'Type a title, then ENTER'; if (this.query.length < 24) this.query += ch; }
      }
      return;
    }
    if (this.mode === 'search') {
      if (ch && this.query.length < 24) {
        this.query += ch;
        if (this.scope) this.filter();
        else if (!this.games.length && this.query.length === 1) { // F, Z, O, R work in the list below
          const what = { f: 'add a folder', z: 'add a zip', o: 'open a file', r: 'reconnect' }[ch.toLowerCase()];
          if (what) this.status = '!To ' + what + ': DOWN, then ' + ch.toUpperCase();
        } else if (this.status.startsWith('!To ')) this.status = 'Type a title, then ENTER';
      }
      else if (k === 'DELETE') {
        this.query = this.query.slice(0, -1);
        if (this.status.startsWith('!To ')) this.status = 'Type a title, then ENTER';
        if (this.scope) this.filter(); else if (!this.query.trim()) this.home();
      } else if (k === 'ENTER') { if (this.scope) { if (this.games.length) this.mode = 'results'; } else if (this.query.trim()) this.search(); else this.home(); }
      else if (k === 'DOWN') { if (this.games.length) this.mode = 'results'; else if (!this.scope) { this.mode = 'home'; this.hsel = 0; } }
    } else if (this.mode === 'results') {
      if (ch) { this.mode = 'search'; if (this.query.length < 24) this.query += ch; if (this.scope) this.filter(); }
      else if (k === 'DELETE' || (k === 'UP' && this.sel === 0)) this.mode = 'search';
      else if (['UP', 'DOWN', 'PGUP', 'PGDN', 'LEFT', 'RIGHT'].includes(k)) this.move({ UP: -1, DOWN: 1, PGUP: -LIST_ROWS, PGDN: LIST_ROWS, LEFT: -LIST_ROWS, RIGHT: LIST_ROWS }[k]);
      else if (k === 'ENTER') this.choose();
    } else if (this.mode === 'files') {
      if (k === 'UP') this.fsel = Math.max(0, this.fsel - 1);
      else if (k === 'DOWN') this.fsel = Math.min(this.files.length - 1, this.fsel + 1);
      else if (k === 'DELETE' || k === 'LEFT') { this.mode = 'results'; this.status = ''; }
      else if (k === 'ENTER') this.loadOption(this.files[this.fsel]);
    }
  },
  click(col, row) {
    if (this.busy) { if ((row === 0 && col >= 31) || row === 23) this.ctl && this.ctl.abort(); return; }
    if (row === 0 && col >= 31) { closeCatalogue(); return; }
    if (this.ask) { if (row === 19) this.key('CHAR:r'); else if (row === 20 && this.ask.archive) this.key('ENTER'); else if (row === 21) this.key('BREAK'); return; }
    if (row === 1) { this.home(); return; } // "Catalogue >": back to the start
    if (row === 2) { this.mode = 'search'; return; }
    if (this.mode === 'files') {
      const i = row - LIST_TOP - 2;
      if (i >= 0 && i < this.files.length) { this.fsel = i; this.loadOption(this.files[i]); } else if (row === LIST_TOP) this.mode = 'results';
      return;
    }
    if (!this.games.length && !this.scope) { // the first page
      const i = this.homeTop + row - HOME_TOP, items = this.homeItems();
      if (row >= HOME_TOP && row < HOME_TOP + HOME_ROWS && i < items.length) { this.mode = 'home'; this.hsel = i; this.homeAct(items[i]); }
      return;
    }
    const n = this.top + row - LIST_TOP;
    if (row >= LIST_TOP && row < LIST_TOP + LIST_ROWS && n < this.games.length) { this.mode = 'results'; this.sel = n; this.choose(); }
  },
  move(d) {
    this.sel = Math.max(0, Math.min(this.games.length - 1, this.sel + d));
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + LIST_ROWS) this.top = this.sel - LIST_ROWS + 1;
    if (this.scope) this.checkShown();
  },
  // looking through a library: the zips on show (and the next page) are checked, and the list redrawn without
  // the ones that hold no tape or snapshot
  checkShown() {
    const shown = this.games.slice(this.top, this.top + 2 * LIST_ROWS).flatMap(g => g.local || []), scope = this.scope;
    if (!shown.some(needsCheck)) return;
    checkGames(shown).then(dropped => { if (dropped && this.scope === scope && screenMenu === this) { this.filter(true); redrawScreen(); } });
  },

  // back to the first page (the instructions): the title is empty again
  home() {
    this.query = ''; this.games = []; this.sel = 0; this.top = 0; this.mode = 'search'; this.scope = null; this.ask = null; this.confirm = null;
    this.status = 'Type a title, then ENTER';
  },
  // your libraries at once, then ZXDB: a ZXDB title you have is loadable (and loads your file); yours come first
  async search() {
    const text = this.query.trim();
    if (!text) return;
    this.busy = true; this.status = 'Looking in your libraries...'; this.ctl = new AbortController(); redrawScreen();
    const found = searchLibraries(text);
    await checkGames(found); // zips with no tape or snapshot in them are left out
    const mine = groupGames(found); // one line per game of yours
    this.games = mine.slice(0, 300).map(libEntry); this.sel = 0; this.top = 0;
    this.status = (mine.length ? mine.length + ' yours - ' : '') + 'Searching ZXDB...'; redrawScreen();
    try {
      const fromZXDB = await searchZXDB(text, this.ctl.signal), used = new Set();
      const zxdb = fromZXDB.map(g => {
        const files = g.files.filter(f => f.url), key = titleKey(g.title);
        const groups = key ? mine.filter(m => m.best.key === key) : [];
        groups.forEach(m => used.add(m));
        const local = groups.flatMap(m => m.versions).sort((a, b) => a.rank - b.rank);
        const why = local.length ? '' : !g.available ? g.availability : !g.files.length ? 'No tape or snapshot' : !files.length ? 'Not in the archive (after 2017)' : '';
        return { ...g, files: g.available ? files : [], local, own: local.length > 0, loadable: !why, why };
      });
      const others = mine.filter(m => !used.has(m)).slice(0, 300).map(libEntry);
      this.games = [...zxdb.filter(g => g.own), ...others, ...zxdb.filter(g => !g.own)];
      this.sel = 0; this.top = 0;
      const yours = this.games.filter(g => g.own).length;
      this.status = this.games.length ? this.games.length + ' found' + (yours ? ', ' + yours + ' yours' : '') : '!Nothing found';
    } catch (err) {
      if (err.cancelled) this.status = this.games.length ? this.games.length + ' yours (ZXDB cancelled)' : 'Type a title, then ENTER';
      else this.status = this.games.length ? '!' + this.games.length + ' yours; ZXDB: ' + err.message : '!' + err.message;
    }
    if (this.games.length) this.mode = 'results';
    this.busy = false; this.ctl = null; redrawScreen();
  },
  choose() {
    const g = this.games[this.sel];
    if (!g || !g.loadable) { if (g) this.status = '!' + g.why; return; }
    const options = [...(g.local || []).map(local => ({ local })), ...g.files];
    if (options.length === 1 || (g.local && g.local.length === 1)) { this.loadOption(options[0]); return; } // yours, when you have it
    this.files = options.slice(0, 10); this.fsel = 0; this.mode = 'files'; // 10 fit above the panel
    this.status = g.local && g.local.length ? 'Your versions, best first' : 'Choose a tape';
  },
  loadOption(o) { if (o.local) this.loadLocal(o.local, this.games[this.sel]); else this.load(o); },
  // a game from your library: read from your folder or zip; not connected, the screen asks first
  async loadLocal(g, game) {
    if (!g.lib.conn) { this.ask = { g, game, archive: game && game.files && game.files[0] }; this.status = '!Not connected'; redrawScreen(); return; }
    this.busy = true; this.status = 'Reading ' + g.file + '...'; redrawScreen();
    try {
      const { name, bytes } = await libraryGame(g), machine = titleMachine(game && game.machine) || 0;
      this.busy = false;
      closeCatalogue();
      if (loadFile(name, bytes, { machine })) rackOffer({ title: game && game.id ? game.title : g.title.replace(/\s*\[.*$/, ''), name, bytes, source: 'library', machine });
    } catch (err) {
      this.busy = false;
      if (/No tape or snapshot/.test(err.message)) { // marked, and the next version of the game instead
        g.ok = false; saveLibrary(g.lib);
        const next = game && game.local && game.local.find(v => v !== g && v.ok !== false);
        if (game && game.local) game.local = game.local.filter(v => v !== g);
        if (next) { this.status = 'Not a game: trying another version'; redrawScreen(); return this.loadLocal(next, game); }
      }
      if (err.name === 'NotAllowedError' || err.name === 'NotFoundError' || err.name === 'NotReadableError') { g.lib.conn = null; this.ask = { g, game, archive: game && game.files && game.files[0] }; }
      this.status = '!' + (err.name === 'NotFoundError' ? 'Not there any more' : err.message);
    }
    redrawScreen();
  },
  // download a tape: the status line counts the seconds until the archive answers, then the kilobytes, with a bar
  async load(f) {
    const t0 = Date.now(), ctl = new AbortController();
    let started = false;
    this.busy = true; this.ctl = ctl; this.progress = 0; this.status = 'Asking the archive...'; redrawScreen();
    const tick = setInterval(() => { if (!started) { this.status = 'Waiting for the archive ' + Math.round((Date.now() - t0) / 1000) + 's'; redrawScreen(); } }, 1000);
    const kb = n => Math.max(1, Math.round(n / 1024));
    const onProgress = (got, total) => {
      started = true;
      this.status = total ? 'Downloading ' + kb(Math.min(got, total)) + ' of ' + kb(total) + ' KB' : 'Downloading ' + kb(got) + ' KB';
      this.progress = total ? Math.min(1, got / total) : 0;
      redrawScreen();
    };
    try {
      const { name, bytes } = await downloadGame(f, ctl.signal, onProgress);
      const g = this.games[this.sel], machine = titleMachine(g.machine);
      this.busy = false;
      closeCatalogue();
      if (loadFile(name, bytes, { machine })) rackOffer({ title: g.title, name, bytes, source: 'archive', machine }); // and onto the rack
    } catch (err) {
      this.busy = false;
      this.status = err.cancelled ? 'Cancelled' : '!' + err.message; // ENTER on the same title tries again
    } finally {
      clearInterval(tick);
      this.ctl = null; this.progress = 0;
      redrawScreen();
    }
  },
};

// a reset (the button, F8, the Multiface, a channel, AUTO LOAD) is a fresh start: the catalogue opens on its
// first page again. Not while it is on the screen or busy (a ?find= search at start-up, a download)
zx.onReset = () => { if (screenMenu !== catalogue && !catalogue.busy) catalogue.home(); };
function openCatalogue(text) {
  if (screenMenuOpen()) return;
  catalogue.mode = 'search'; catalogue.busy = false;
  if (text) catalogue.query = text;
  openScreenMenu(catalogue);
  if (text) catalogue.search();
}
function closeCatalogue() {
  if (catalogue.ctl) catalogue.ctl.abort(); // a search or download still going: stop it
  if (screenMenu === catalogue) closeScreenMenu();
}

// ?find=<title> in the address opens the catalogue with that search (?find alone just opens it)
{
  const find = new URLSearchParams(location.search).get('find');
  if (find !== null) setTimeout(() => openCatalogue(find || undefined), 600); // ?find alone: the first page. After the ROM (its font) has loaded
}
