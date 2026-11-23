// The Tape Browser and the tape's contents, on the TV in the Spectrum's font and driven by its keys.
// The Tape Browser replaces the browser's file dialog: its first page leads to the cassette rack, your library, the
// software catalogue and a folder of this computer (linked once, then browsed here with its folders and zips, like a
// disk drive); a file picked from the device, through the browser's own dialog, is the last way in.
// Keys: up/down (CAPS SHIFT+7/6) choose, left/right (CAPS SHIFT+5/8) turn the page, ENTER opens, DELETE
// (CAPS SHIFT+0) goes back, BREAK (CAPS SHIFT+SPACE) leaves.
'use strict';

const OPENABLE = /\.(tap|tzx|z80|sna|zip|rom)$/i;
const canLinkFolder = typeof window.showDirectoryPicker === 'function';
let linkedFolder = null; // { id: 1, name, handle }
libDo('readonly', s => s.get(1), 'folders').then(f => { linkedFolder = f || null; }).catch(() => {});

const kb = n => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const byName = (a, b) => (b.dir === true) - (a.dir === true) || naturally(a.name, b.name);

// a list on the TV with a title, a path line, rows of items, a details panel and the keys at the bottom
const LIST_FROM = 4, LIST_N = 16;
function drawList(s, menu, title, path, items, help, keys) {
  s.bar(0, 0); s.print(1, 0, title, 7, 0); s.stripes(27, 0);
  s.print(0, 1, fit(path, 32), 1);
  if (menu.status) s.print(0, 2, fit(menu.status.replace(/^!/, ''), 32), menu.status.startsWith('!') ? 2 : 4);
  items.slice(menu.top, menu.top + LIST_N).forEach((it, i) => {
    const n = menu.top + i, on = n === menu.sel, paper = on ? 5 + 8 : 7, row = LIST_FROM + i;
    s.bar(row, paper);
    s.print(1, row, fit(it.label, it.right ? 30 - it.right.length : 30), it.ink || 0, paper);
    if (it.right) s.print(31 - it.right.length, row, it.right, 1, paper);
  });
  const it = items[menu.sel];
  if (it && it.about) it.about.slice(0, 2).forEach((line, i) => s.print(0, 20 + i, fit(line, 32), i ? 1 : 0));
  const pages = Math.ceil(items.length / LIST_N);
  s.print(0, 22, help, 1);
  if (pages > 1) { const p = (Math.floor(menu.top / LIST_N) + 1) + '/' + pages; s.print(32 - p.length, 22, p, 1); }
  s.bar(23, 0); s.print(0, 23, keys, 7, 0);
}
// choosing in a list: up/down, left/right a page; keeps the chosen line on show
function listMove(menu, n, k) {
  if (!n) return;
  if (k === 'UP') menu.sel = (menu.sel + n - 1) % n;
  else if (k === 'DOWN') menu.sel = (menu.sel + 1) % n;
  else { const d = k === 'LEFT' || k === 'PGUP' ? -LIST_N : LIST_N; menu.sel = Math.max(0, Math.min(n - 1, menu.sel + d)); }
  if (k === 'LEFT' || k === 'RIGHT' || k === 'PGUP' || k === 'PGDN') menu.top = Math.floor(menu.sel / LIST_N) * LIST_N;
  if (menu.sel < menu.top) menu.top = menu.sel;
  if (menu.sel >= menu.top + LIST_N) menu.top = menu.sel - LIST_N + 1;
}

// ---------- the Tape Browser ----------
const tapeBrowser = {
  full: true, sel: 0, top: 0, status: '', stack: [], busy: false, unlinkArmed: false,
  here() { return this.stack[this.stack.length - 1]; },
  homeItems() {
    const items = [
      { act: 'rack', label: '1 Cassette rack', right: tapes.filter(Boolean).length + ' tapes', about: ['Your tapes on the desk (A-D)'] },
      { act: 'mine', label: '2 Your library', right: libraryCount() + ' games', about: ['Your zips of games, kept here', 'ENTER lists them (MINE)'] },
      { act: 'zxdb', label: '3 Software catalogue', right: 'ZXDB', about: ['Everything made for the Spectrum', 'searched on the internet'] },
    ];
    if (canLinkFolder) {
      if (linkedFolder) items.push({ act: 'folder', label: '4 Folder: ' + linkedFolder.name, ink: 1, about: ['A folder of this computer', 'browsed here, folders and zips'] });
      items.push({ act: 'link', label: (linkedFolder ? '5 Link another folder' : '4 Link a folder of this PC'), about: ['Once: the browser asks which folder', 'then it opens here, every visit'] });
    }
    items.push({ act: 'pick', label: (canLinkFolder ? (linkedFolder ? '6' : '5') : '4') + ' A file from this device', about: ['The browser\'s own window, to pick', 'a tape, snapshot, zip or ROM'] });
    if (linkedFolder) items.push({ act: 'unlink', label: this.unlinkArmed ? 'ENTER again to unlink the folder' : 'Unlink the folder', ink: 2, about: ['The folder is not touched, only', 'forgotten by the emulator'] });
    return items;
  },
  items() { const h = this.here(); return h.kind === 'home' ? this.homeItems() : h.items; },
  draw(s) {
    const h = this.here(), items = this.items();
    const help = h.kind === 'home' ? 'Where is the tape?' : '<- -> page  DELETE back';
    drawList(s, this, 'Tape Browser', h.path, items, help, h.kind === 'home' ? 'ENTER open  BREAK out' : 'ENTER open DELETE back BREAK out');
  },
  key(k) {
    if (this.busy) return;
    const items = this.items(), it = items[this.sel];
    if (k !== 'ENTER') this.unlinkArmed = false;
    if (k === 'BREAK') closeScreenMenu();
    else if (k === 'DELETE') this.back();
    else if (['UP', 'DOWN', 'LEFT', 'RIGHT', 'PGUP', 'PGDN'].includes(k)) listMove(this, items.length, k);
    else if (k === 'ENTER') this.open(it);
    else if (this.here().kind === 'home' && /^CHAR:[1-6]$/.test(k)) { const i = items.findIndex(x => x.label.startsWith(k.slice(5) + ' ')); if (i >= 0) { this.sel = i; this.open(items[i]); } }
  },
  click(col, row) {
    if (this.busy) return;
    if (row === 23) { if (col >= 26) closeScreenMenu(); else if (col >= 11 && this.here().kind !== 'home') this.back(); return; }
    const n = this.top + row - LIST_FROM, items = this.items();
    if (row >= LIST_FROM && row < LIST_FROM + LIST_N && n < items.length) { this.sel = n; this.open(items[n]); }
  },
  go(loc) { // the first folder or file chosen, not '..'
    this.here().sel = this.sel; this.here().top = this.top;
    this.stack.push(loc);
    this.sel = Math.max(0, loc.items.findIndex(x => x.dir || x.handle || x.entry)); this.top = 0; this.status = '';
  },
  back() {
    if (this.stack.length < 2) return;
    this.stack.pop();
    const h = this.here();
    this.sel = h.sel || 0; this.top = h.top || 0; this.status = '';
  },
  async open(it) {
    if (!it) return;
    if (it.act === 'rack') { closeScreenMenu(); openTapesMenu(); return; }
    if (it.act === 'mine') { closeScreenMenu(); openCatalogue(); catalogue.scope = 'mine'; catalogue.libOnly = null; catalogue.query = ''; catalogue.search(); return; }
    if (it.act === 'zxdb') { closeScreenMenu(); openCatalogue(); if (catalogue.scope === 'mine') catalogue.toggleScope(); return; }
    if (it.act === 'pick') { closeScreenMenu(); document.getElementById('fileInput').click(); return; } // the browser's window: needs this key press or touch
    if (it.act === 'unlink') {
      if (!this.unlinkArmed) { this.unlinkArmed = true; return; }
      this.unlinkArmed = false; linkedFolder = null; this.sel = 0;
      libDo('readwrite', s => s.delete(1), 'folders').catch(() => {});
      this.status = 'Folder unlinked'; return;
    }
    if (it.act === 'link') return this.link();
    if (it.act === 'folder') return this.openDir(linkedFolder.handle, linkedFolder.name);
    if (it.act === 'up') return this.back();
    if (it.dir && it.handle) return this.openDir(it.handle, this.here().path + '/' + it.name);
    if (it.dir && it.zip) return this.go(this.zipLoc(it.zip, it.prefix));
    if (it.addLib) { this.busy = true; await addZip(it.addLib); this.busy = false; this.status = 'In your library: EDIT in the catalogue'; return; }
    if (it.handle) return this.openFile(await it.handle.getFile());
    if (it.entry) return this.openZipEntry(it);
  },
  // the folder: asked for once (the browser's window), kept for later visits
  async link() {
    try {
      const handle = await window.showDirectoryPicker({ id: 'zx-games', mode: 'read' });
      linkedFolder = { id: 1, name: handle.name, handle };
      libDo('readwrite', s => s.put(linkedFolder), 'folders').catch(() => {});
      this.sel = 0;
      await this.openDir(handle, handle.name);
    } catch (e) { if (e.name !== 'AbortError') this.status = '!' + e.message; }
    redrawScreen();
  },
  async openDir(handle, path) {
    this.busy = true; this.status = 'Reading ' + path + '...'; redrawScreen();
    try {
      // the browser asks again on a new visit; this key press or touch lets it
      if ((await handle.queryPermission({ mode: 'read' })) !== 'granted' && (await handle.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('The browser did not allow it');
      const list = [];
      for await (const [name, h] of handle.entries()) {
        if (name.startsWith('.')) continue;
        if (h.kind === 'directory') list.push({ dir: true, name, handle: h, label: name + '/', ink: 1 });
        else if (OPENABLE.test(name)) list.push({ name, handle: h, label: describeFile(name).title, right: name.split('.').pop().toUpperCase() });
      }
      list.sort(byName);
      for (const x of list) if (!x.dir) x.about = [x.name, ''];
      this.busy = false;
      this.go({ kind: 'dir', path, items: [{ act: 'up', label: '..', ink: 1 }].concat(list) });
      this.status = list.length ? '' : '!No tapes, snapshots or zips here';
      // sizes, a little later (each file has to be asked)
      for (const x of list) if (!x.dir) x.handle.getFile().then(f => { x.about = [x.name, kb(f.size)]; }).catch(() => {});
    } catch (e) {
      this.busy = false; this.status = '!' + e.message;
    }
    redrawScreen();
  },
  // a file of the folder: a zip is opened like a folder (one game in it loads at once); anything else loads
  async openFile(file) {
    if (/\.zip$/i.test(file.name)) {
      this.busy = true; this.status = 'Reading ' + file.name + '...'; redrawScreen();
      try {
        const entries = await blobZipEntries(file);
        this.busy = false;
        if (isSingleGame(entries)) { closeScreenMenu(); addZip(file); return; }
        this.go(this.zipLoc({ file, entries, base: this.here().path }, ''));
      } catch (e) { this.busy = false; this.status = '!' + e.message; }
      redrawScreen();
      return;
    }
    closeScreenMenu();
    readFile(file);
  },
  // inside a zip: its folders and games, as if it were a folder
  zipLoc(zip, prefix) {
    const dirs = new Map(), files = [];
    for (const e of zip.entries) {
      if (skipEntry(e.name) || !e.name.startsWith(prefix)) continue;
      const rest = e.name.slice(prefix.length), slash = rest.indexOf('/');
      if (slash >= 0) { const d = rest.slice(0, slash); dirs.set(d, (dirs.get(d) || 0) + (OPENABLE.test(rest) ? 1 : 0)); }
      else if (OPENABLE.test(rest)) { const d = describeFile(rest); files.push({ name: rest, entry: e, zip, label: d.title, right: rest.split('.').pop().toUpperCase(), about: [[d.publisher, d.year].filter(Boolean).join(', ') || rest, kb(e.size) + ' packed'] }); }
    }
    const list = [...dirs].filter(([, n]) => n > 0).map(([name, n]) => ({ dir: true, name, zip, prefix: prefix + name + '/', label: name + '/', right: String(n), ink: 1 })).concat(files).sort(byName);
    const head = [{ act: 'up', label: '..', ink: 1 }];
    if (!prefix) head.push({ addLib: zip.file, label: '+ Keep this zip in your library', ink: 4, about: ['Then the catalogue finds its games', '(EDIT: MINE), offline too'] });
    return { kind: 'zip', path: zip.base + '/' + zip.file.name + (prefix ? '/' + prefix.slice(0, -1) : ''), items: head.concat(list) };
  },
  async openZipEntry(it) {
    this.busy = true; this.status = 'Unpacking ' + it.label + '...'; redrawScreen();
    try {
      let bytes = await blobUnzipEntry(it.zip.file, it.entry), name = it.name;
      if (/\.zip$/i.test(name)) ({ name, bytes } = await gameFromZip(bytes.buffer, name));
      this.busy = false;
      closeScreenMenu();
      if (loadFile(name, bytes) && /\.(tap|tzx|sna|z80)$/i.test(name)) rackOffer({ title: describeFile(it.name).title, name, bytes, source: 'file' });
    } catch (e) { this.busy = false; this.status = '!' + e.message; redrawScreen(); }
  },
};
function openTapeBrowser() {
  if (screenMenuOpen()) closeScreenMenu();
  tapeBrowser.stack = [{ kind: 'home', path: 'Where is the tape?' }];
  tapeBrowser.sel = 0; tapeBrowser.top = 0; tapeBrowser.status = ''; tapeBrowser.busy = false; tapeBrowser.unlinkArmed = false;
  tapeBrowser.stack[0].path = canLinkFolder ? 'Rack, library, ZXDB or a folder' : 'Rack, library, ZXDB or a file';
  openScreenMenu(tapeBrowser);
}

// ---------- the tape in the recorder: its parts and blocks ----------
const tapeContents = {
  full: true, sel: 0, top: 0, status: '',
  items() {
    const t = zx.tape, list = [];
    if (!t) return list;
    t.blocks.forEach((b, i) => {
      const part = t.parts.find(p => p.block === i);
      if (part) list.push({ block: i, label: part.name, ink: 1 + 8, part: true, about: ['A part of the tape: ENTER winds to it', ''] });
      list.push({ block: i, label: '  ' + b.desc, ink: 0, about: [b.desc, 'ENTER winds the tape here'] });
    });
    return list;
  },
  draw(s) {
    const t = zx.tape, items = this.items();
    items.forEach(it => { it.right = !it.part && it.block === t.blockIdx ? '<' : ''; });
    drawList(s, this, 'Tape', t ? t.name : 'No tape', items, '<- -> page   ENTER winds', 'ENTER wind  E eject  BREAK out');
  },
  key(k) {
    const items = this.items(), it = items[this.sel];
    if (k === 'BREAK') closeScreenMenu();
    else if (['UP', 'DOWN', 'LEFT', 'RIGHT', 'PGUP', 'PGDN'].includes(k)) listMove(this, items.length, k);
    else if (k === 'ENTER' && it) this.wind(it);
    else if (k === 'CHAR:e') { closeScreenMenu(); zx.tape = null; renderTapeBlocks(); openTapeBrowser(); }
  },
  click(col, row) {
    if (row === 23) { if (col >= 23) closeScreenMenu(); return; }
    const n = this.top + row - LIST_FROM, items = this.items();
    if (row >= LIST_FROM && row < LIST_FROM + LIST_N && n < items.length) { this.sel = n; this.wind(items[n]); }
  },
  wind(it) {
    zx.tape.windTo(it.block);
    updateTapeStatus();
    closeScreenMenu();
    status('Wound to: ' + it.label.trim());
  },
};
function openTapeContents() {
  if (!zx.tape) return;
  if (screenMenuOpen()) closeScreenMenu();
  const items = tapeContents.items();
  tapeContents.sel = Math.max(0, items.findIndex(x => !x.part && x.block === zx.tape.blockIdx));
  tapeContents.top = Math.floor(tapeContents.sel / LIST_N) * LIST_N;
  tapeContents.status = (zx.tape.blocks.length) + ' blocks' + (zx.tape.parts.length ? ', ' + zx.tape.parts.length + ' parts' : '');
  openScreenMenu(tapeContents);
}
