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
  const entries = zipEntries(buf).filter(e => /\.(tap|tzx|z80|sna)$/i.test(e.name));
  if (!entries.length) throw new Error('No tape or snapshot in the download');
  const tapeEntries = entries.filter(e => /\.(tap|tzx)$/i.test(e.name)).sort((a, b) => naturally(baseName(a.name), baseName(b.name)));
  if (tapeEntries.length < 2) return { name: entries[0].name.split('/').pop(), bytes: await unzipEntry(buf, entries[0]) };
  const files = [];
  for (const e of tapeEntries) files.push({ name: e.name, bytes: await unzipEntry(buf, e) });
  const zipName = baseName(zipFile.replace(/\.zip$/i, ''));
  return { name: zipName + '.tzx', bytes: combineTapes(files, partLabels(files.map(f => f.name))) };
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
// the first page, before any search
const INTRO = [
  ['Search ZXDB, the database of everything made for the ZX Spectrum, and your own games.', 0],
  ['', 0],
  ['Type a title and press ENTER.', 0],
  ['Titles in red cannot be downloaded.', 2],
  ['', 0],
  ['Your own file: touch here.', 1],
  ['LIBRARY', 0],
  ['', 0],
  ['ZXDB via ZXInfo; files from the World of Spectrum archive', 1],
];
const fit = (t, n) => { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n - 1) + '~' : t.padEnd(n); };
const catalogue = {
  full: true, blinks: true,
  ownRows: [0, 0], mode: 'search', query: '', status: 'Type a title, then ENTER', games: [], sel: 0, top: 0, files: [], fsel: 0, busy: false, ctl: null, progress: 0,

  draw(s, blink) {
    s.bar(0, 0); s.print(1, 0, 'Software Catalogue', 7, 0); s.stripes(27, 0);
    s.print(0, 2, 'Title:', 1);
    s.print(7, 2, fit(this.query, 24));
    if (this.mode === 'search' && !this.busy) s.print(7 + this.query.length, 2, 'L', blink ? 7 : 0, blink ? 0 : 7); // the flashing cursor
    s.print(0, 3, fit(this.status.replace(/^!/, ''), 32), this.status.startsWith('!') ? 2 : 1);
    if (this.mode === 'files') this.drawFiles(s);
    else if (!this.games.length && !this.busy) this.drawIntro(s);
    else this.drawGames(s);
    if (this.progress) { // the download: a bar along row 22
      s.bar(22, 7);
      s.print(0, 22, ' '.repeat(Math.max(1, Math.round(32 * this.progress))), 4 + 8, 4 + 8);
    }
    s.bar(23, 0);
    s.print(0, 23, this.busy ? 'BREAK cancels' : this.mode === 'search' ? 'ENTER find  BREAK exit' : 'ENTER pick DELETE back BREAK out', 7, 0);
  },
  drawIntro(s) {
    let row = LIST_TOP;
    for (const [text, ink] of INTRO) {
      if (!text) { row++; continue; }
      const first = row;
      if (text === 'LIBRARY') { row = this.drawLibrary(s, row); continue; }
      for (const line of wrap(text, 30)) s.print(1, row++, line, ink);
      if (text.startsWith('Your own file')) this.ownRows = [first, row]; // touching it opens a file
    }
  },
  // your zips of games (library.js): touching the first line adds one, touching a zip twice removes it
  drawLibrary(s, row) {
    this.libRows = { add: row, zips: [] };
    s.print(1, row++, 'Add your games (zip): touch', 4);
    library.slice(0, 3).forEach(z => {
      const armed = this.removeArmed === z;
      this.libRows.zips.push({ row, z });
      s.print(2, row++, fit(armed ? 'Touch again to remove ' + z.name : z.name + ' (' + z.games.length + ')', 29), armed ? 2 : 1);
    });
    return row;
  },
  drawGames(s) {
    this.games.slice(this.top, this.top + LIST_ROWS).forEach((g, i) => {
      const n = this.top + i, on = this.mode === 'results' && n === this.sel, paper = on ? 5 + 8 : 7;
      s.bar(LIST_TOP + i, paper);
      s.print(1, LIST_TOP + i, fit(g.title, 25), g.local ? 4 : g.loadable ? 0 : 2, paper); // green: your library
      s.print(27, LIST_TOP + i, g.year || '', 1, paper);
    });
    if (this.games.length > LIST_ROWS) s.print(0, LIST_TOP + LIST_ROWS - 1, this.top + LIST_ROWS < this.games.length ? '+' : ' ', 1); // more below
    const g = this.games[this.sel];
    if (g) this.drawDetails(s, g);
  },
  // the panel under the list: what the chosen title is, and whether it can be loaded
  drawDetails(s, g) {
    s.bar(17, 1); // a blue rule
    s.print(0, 18, fit(g.title, 32), 0);
    s.print(0, 19, fit([g.publisher, g.year].filter(Boolean).join(', '), 32), 1);
    if (g.local) {
      s.print(0, 20, fit('Your library: ' + g.lib.name + (g.folder && g.folder !== g.lib.name ? ' / ' + g.folder : ''), 32), 1);
      s.print(0, 21, fit('ENTER loads it', 32), 4);
      return;
    }
    s.print(0, 20, fit([g.genre, (g.machine || '').replace('ZX-Spectrum ', 'Spectrum ')].filter(Boolean).join(' - '), 32), 1);
    if (g.loadable) s.print(0, 21, fit(g.files.length === 1 ? '1 tape - ENTER loads it' : g.files.length + ' tapes - ENTER to choose', 32), 4);
    else s.print(0, 21, fit(g.why, 32), 2);
  },
  drawFiles(s) {
    const g = this.games[this.sel];
    s.print(1, LIST_TOP, fit(g.title, 30), 0);
    this.files.forEach((f, i) => {
      const on = i === this.fsel, paper = on ? 5 + 8 : 7, row = LIST_TOP + 2 + i;
      const name = f.path.split('/').pop().replace(/\.zip$/i, '');
      s.bar(row, paper);
      s.print(2, row, fit(name.replace(/\.(tap|tzx|z80|sna)$/i, ''), 24), 0, paper);
      s.print(27, row, name.split('.').pop().toUpperCase(), 1, paper);
    });
  },

  key(k) {
    if (this.busy) { if (k === 'BREAK' && this.ctl) this.ctl.abort(); return; } // a search or download: BREAK cancels it
    if (k === 'BREAK') { closeCatalogue(); return; }
    const ch = k.startsWith('CHAR:') ? k.slice(5) : null;
    if (this.mode === 'search') {
      if (ch && this.query.length < 24) this.query += ch;
      else if (k === 'DELETE') this.query = this.query.slice(0, -1);
      else if (k === 'ENTER') this.search();
      else if (k === 'DOWN' && this.games.length) this.mode = 'results';
    } else if (this.mode === 'results') {
      if (ch) { this.mode = 'search'; if (this.query.length < 24) this.query += ch; }
      else if (k === 'DELETE' || (k === 'UP' && this.sel === 0)) this.mode = 'search';
      else if (k === 'UP' || k === 'DOWN' || k === 'PGUP' || k === 'PGDN') this.move({ UP: -1, DOWN: 1, PGUP: -LIST_ROWS, PGDN: LIST_ROWS }[k]);
      else if (k === 'ENTER') this.choose();
    } else if (this.mode === 'files') {
      if (k === 'UP') this.fsel = Math.max(0, this.fsel - 1);
      else if (k === 'DOWN') this.fsel = Math.min(this.files.length - 1, this.fsel + 1);
      else if (k === 'DELETE' || k === 'LEFT') this.mode = 'results';
      else if (k === 'ENTER') this.load(this.files[this.fsel]);
    }
  },
  click(col, row) {
    if (this.busy) { if ((row === 0 && col >= 31) || row === 23) this.ctl.abort(); return; }
    if (row === 0 && col >= 31) { closeCatalogue(); return; }
    if (row === 2) { this.mode = 'search'; return; }
    if (this.mode === 'search' && !this.games.length && row >= this.ownRows[0] && row < this.ownRows[1]) { closeCatalogue(); openFile(); return; }
    if (this.mode === 'search' && !this.games.length && this.libRows) { // the library lines on the first page
      if (row === this.libRows.add) { this.removeArmed = null; closeCatalogue(); openFile(); return; }
      const hit = this.libRows.zips.find(r => r.row === row);
      if (hit) {
        if (this.removeArmed === hit.z) { removeLibrary(hit.z); this.removeArmed = null; this.status = 'Removed ' + hit.z.name; }
        else this.removeArmed = hit.z;
        redrawScreen(); return;
      }
    }
    if (this.mode === 'files') {
      const i = row - LIST_TOP - 2;
      if (i >= 0 && i < this.files.length) { this.fsel = i; this.load(this.files[i]); } else if (row === LIST_TOP) this.mode = 'results';
      return;
    }
    const n = this.top + row - LIST_TOP;
    if (row >= LIST_TOP && row < LIST_TOP + LIST_ROWS && n < this.games.length) { this.mode = 'results'; this.sel = n; this.choose(); }
  },
  move(d) {
    this.sel = Math.max(0, Math.min(this.games.length - 1, this.sel + d));
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + LIST_ROWS) this.top = this.sel - LIST_ROWS + 1;
  },

  async search() {
    const text = this.query.trim();
    if (!text) return;
    this.removeArmed = null;
    // your library first (at once, offline too), then ZXDB
    const mine = searchLibrary(text).slice(0, 200).map(g => ({ ...g, local: true, loadable: true, files: [], why: '' }));
    this.games = mine; this.sel = 0; this.top = 0;
    this.busy = true; this.status = 'Searching ZXDB...'; this.ctl = new AbortController();
    if (mine.length) this.mode = 'results';
    redrawScreen();
    try {
      const found = (await searchZXDB(text, this.ctl.signal)).map(g => {
        const files = g.files.filter(f => f.url);
        const why = !g.available ? g.availability : !g.files.length ? 'No tape or snapshot' : !files.length ? 'Not in the archive (after 2017)' : '';
        return { ...g, files, loadable: !why, why };
      });
      this.games = mine.concat(found);
      this.status = !this.games.length ? '!Nothing found' : mine.length ? mine.length + ' yours, ' + found.length + ' in ZXDB' : this.games.length + ' found - choose one';
      if (this.games.length) this.mode = 'results';
    } catch (err) {
      this.status = err.cancelled ? (mine.length ? mine.length + ' in your library' : 'Type a title, then ENTER')
        : mine.length ? '!ZXDB: ' + err.message.replace(/ - .*/, '') + ' - yours below' : '!' + err.message;
    }
    this.busy = false; this.ctl = null; redrawScreen();
  },
  choose() {
    const g = this.games[this.sel];
    if (g && g.local) { this.loadLocal(g); return; }
    if (!g || !g.loadable) { if (g) this.status = '!' + g.why; return; }
    if (g.files.length === 1) { this.load(g.files[0]); return; }
    this.files = g.files.slice(0, 12); this.fsel = 0; this.mode = 'files';
    this.status = 'Choose a tape';
  },
  // a game from your library: unpacked from the zip kept in the browser, into the recorder and onto the rack
  async loadLocal(g) {
    this.busy = true; this.status = 'Unpacking ' + g.title + '...'; redrawScreen();
    try {
      const { name, bytes } = await libraryGame(g);
      this.busy = false;
      closeCatalogue();
      if (loadFile(name, bytes)) rackOffer({ title: g.title, name, bytes, source: 'library' });
    } catch (err) {
      this.busy = false; this.status = '!' + err.message; redrawScreen();
    }
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
