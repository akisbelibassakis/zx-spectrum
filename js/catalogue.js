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

async function searchZXDB(text) {
  const url = ZXINFO + encodeURIComponent(text) + '?mode=compact&size=30&contenttype=SOFTWARE&machinetype=ZXSPECTRUM';
  const r = await fetch(url);
  if (!r.ok) throw new Error('The catalogue did not answer (' + r.status + ')');
  const data = await r.json();
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

async function downloadGame(file) {
  const r = await fetch(file.url);
  if (!r.ok) throw new Error('Download failed (' + r.status + ')');
  const buf = await r.arrayBuffer();
  const entry = zipEntries(buf).find(e => /\.(tap|tzx|z80|sna)$/i.test(e.name));
  if (!entry) throw new Error('No tape or snapshot in the download');
  return { name: entry.name.split('/').pop(), bytes: await unzipEntry(buf, entry) };
}

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
  ['Search ZXDB, the database of everything ever made for the ZX Spectrum.', 0],
  ['', 0],
  ['Type a title and press ENTER. Games whose makers allow it load straight into the recorder.', 0],
  ['', 0],
  ['Titles in red cannot be downloaded.', 2],
  ['', 0],
  ['Your own file: touch here.', 1],
  ['', 0],
  ['Data: ZXDB via ZXInfo', 1],
  ['Files: World of Spectrum archive', 1],
];
const fit = (t, n) => { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n - 1) + '~' : t.padEnd(n); };
const catalogue = {
  full: true, blinks: true,
  ownRows: [0, 0], mode: 'search', query: '', status: 'Type a title, then ENTER', games: [], sel: 0, top: 0, files: [], fsel: 0, busy: false,

  draw(s, blink) {
    s.bar(0, 0); s.print(1, 0, 'Software Catalogue', 7, 0); s.stripes(27, 0);
    s.print(0, 2, 'Title:', 1);
    s.print(7, 2, fit(this.query, 24));
    if (this.mode === 'search' && !this.busy) s.print(7 + this.query.length, 2, 'L', blink ? 7 : 0, blink ? 0 : 7); // the flashing cursor
    s.print(0, 3, fit(this.status.replace(/^!/, ''), 32), this.status.startsWith('!') ? 2 : 1);
    if (this.mode === 'files') this.drawFiles(s);
    else if (!this.games.length && !this.busy) this.drawIntro(s);
    else this.drawGames(s);
    s.bar(23, 0);
    s.print(0, 23, this.mode === 'search' ? 'ENTER find  BREAK exit' : 'ENTER pick DELETE back BREAK out', 7, 0);
  },
  drawIntro(s) {
    let row = LIST_TOP;
    for (const [text, ink] of INTRO) {
      if (!text) { row++; continue; }
      const first = row;
      for (const line of wrap(text, 30)) s.print(1, row++, line, ink);
      if (text.startsWith('Your own file')) this.ownRows = [first, row]; // touching it opens a file
    }
  },
  drawGames(s) {
    this.games.slice(this.top, this.top + LIST_ROWS).forEach((g, i) => {
      const n = this.top + i, on = this.mode === 'results' && n === this.sel, paper = on ? 5 + 8 : 7;
      s.bar(LIST_TOP + i, paper);
      s.print(1, LIST_TOP + i, fit(g.title, 25), g.loadable ? 0 : 2, paper);
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
    if (this.busy) return;
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
    if (this.busy) return;
    if (row === 0 && col >= 31) { closeCatalogue(); return; }
    if (row === 2) { this.mode = 'search'; return; }
    if (this.mode === 'search' && !this.games.length && row >= this.ownRows[0] && row < this.ownRows[1]) { closeCatalogue(); openFile(); return; }
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
    this.busy = true; this.status = 'Searching ZXDB...'; this.games = []; redrawScreen();
    try {
      this.games = (await searchZXDB(text)).map(g => {
        const files = g.files.filter(f => f.url);
        const why = !g.available ? g.availability : !g.files.length ? 'No tape or snapshot' : !files.length ? 'Not in the archive (after 2017)' : '';
        return { ...g, files, loadable: !why, why };
      });
      this.sel = 0; this.top = 0;
      this.status = this.games.length ? this.games.length + ' found - choose one' : '!Nothing found';
      if (this.games.length) this.mode = 'results';
    } catch (err) {
      this.status = '!' + err.message;
    }
    this.busy = false; redrawScreen();
  },
  choose() {
    const g = this.games[this.sel];
    if (!g || !g.loadable) { if (g) this.status = '!' + g.why; return; }
    if (g.files.length === 1) { this.load(g.files[0]); return; }
    this.files = g.files.slice(0, 12); this.fsel = 0; this.mode = 'files';
    this.status = 'Choose a tape';
  },
  async load(f) {
    this.busy = true; this.status = 'Loading from the archive...'; redrawScreen();
    try {
      const { name, bytes } = await downloadGame(f);
      const g = this.games[this.sel];
      this.busy = false;
      closeCatalogue();
      if (loadFile(name, bytes)) rackOffer({ title: g.title, name, bytes, source: 'archive' }); // and onto the rack
    } catch (err) {
      this.busy = false; this.status = '!' + err.message; redrawScreen();
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
function closeCatalogue() { if (screenMenu === catalogue) closeScreenMenu(); }

// ?find=<title> in the address opens the catalogue with that search (?find alone just opens it)
{
  const find = new URLSearchParams(location.search).get('find');
  if (find !== null) setTimeout(() => openCatalogue(find || undefined), 600); // ?find alone: the first page. After the ROM (its font) has loaded
}
