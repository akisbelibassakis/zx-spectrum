'use strict';
// Errors on the screen: an installed app has no address bar or console, so anything that goes wrong shows in a strip
// at the bottom that can be photographed (tap it to close). Loaded first, so it also catches the other scripts failing.
(function () {
  let strip = null;
  function show(msg) {
    if (!document.body) { addEventListener('DOMContentLoaded', () => show(msg)); return; }
    if (!strip) {
      strip = document.createElement('pre');
      strip.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;margin:0;padding:6px 8px;max-height:40%;overflow:auto;' +
        'background:#fff8c8;color:#900;font:12px/1.35 monospace;white-space:pre-wrap;border-top:2px solid #c00';
      strip.title = 'Tap to close';
      strip.onclick = () => { strip.remove(); strip = null; };
      document.body.appendChild(strip);
      strip.textContent = 'Something went wrong (' + navigator.userAgent.replace(/^.*?(Chrome\/[\d.]+|Firefox\/[\d.]+|Version\/[\d.]+ Safari).*$/, '$1') + '):';
    }
    strip.textContent += '\n' + msg;
  }
  addEventListener('error', e => {
    if (e.message) show(e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  });
  addEventListener('unhandledrejection', e => {
    const r = e.reason;
    show('Unhandled: ' + (r && r.stack ? String(r.stack).split('\n').slice(0, 3).join(' | ') : String(r)));
  });
  window.showError = show;
})();

// Raw deflate (the zip format's compression): the browser's own DecompressionStream when it knows 'deflate-raw'
// (Chrome 103+, Firefox 113+, Safari 16.4+), otherwise a small decoder of our own (RFC 1951).
async function inflateRaw(data) {
  let native = false;
  try { native = typeof DecompressionStream === 'function' && !!new DecompressionStream('deflate-raw'); } catch (e) { native = false; }
  if (native) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return inflateRawJS(data);
}

function inflateRawJS(src) {
  let pos = 0, bit = 0, out = new Uint8Array(Math.max(1024, src.length * 4)), n = 0;
  const need = k => { if (n + k > out.length) { const o = new Uint8Array(Math.max(out.length * 2, n + k)); o.set(out); out = o; } };
  const bits = k => {
    let v = 0;
    for (let i = 0; i < k; i++) {
      if (pos >= src.length) throw new Error('Damaged zip data');
      v |= ((src[pos] >> bit) & 1) << i;
      if (++bit === 8) { bit = 0; pos++; }
    }
    return v;
  };
  // a Huffman table: counts per length and the symbols in code order
  function table(lengths) {
    const count = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(lengths.length);
    for (const l of lengths) count[l]++;
    count[0] = 0;
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
    lengths.forEach((l, s) => { if (l) sym[offs[l]++] = s; });
    return { count, sym };
  }
  function decode(t) {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = t.count[len];
      if (code - first < c) return t.sym[index + code - first];
      index += c; first = (first + c) << 1; code <<= 1;
    }
    throw new Error('Damaged zip data');
  }
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  let fixedL = null, fixedD = null;
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      if (bit) { bit = 0; pos++; }
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      if (pos + len > src.length) throw new Error('Damaged zip data');
      need(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len;
      continue;
    }
    let lt, dt;
    if (type === 1) {
      if (!fixedL) {
        const l = new Array(288);
        for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
        fixedL = table(l); fixedD = table(new Array(30).fill(5));
      }
      lt = fixedL; dt = fixedD;
    } else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const cl = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) cl[order[i]] = bits(3);
      const ct = table(cl), lens = [];
      while (lens.length < hlit + hdist) {
        const s = decode(ct);
        if (s < 16) lens.push(s);
        else if (s === 16) { if (!lens.length) throw new Error('Damaged zip data'); const p = lens[lens.length - 1]; for (let r = 3 + bits(2); r > 0; r--) lens.push(p); }
        else if (s === 17) for (let r = 3 + bits(3); r > 0; r--) lens.push(0);
        else for (let r = 11 + bits(7); r > 0; r--) lens.push(0);
      }
      lt = table(lens.slice(0, hlit)); dt = table(lens.slice(hlit, hlit + hdist));
    } else throw new Error('Damaged zip data');
    for (;;) {
      const s = decode(lt);
      if (s < 256) { need(1); out[n++] = s; }
      else if (s === 256) break;
      else {
        const li = s - 257;
        if (li >= 29) throw new Error('Damaged zip data');
        const len = LBASE[li] + bits(LEXT[li]);
        const di = decode(dt);
        if (di >= 30) throw new Error('Damaged zip data');
        const dist = DBASE[di] + bits(DEXT[di]);
        if (dist > n) throw new Error('Damaged zip data');
        need(len);
        for (let i = 0; i < len; i++, n++) out[n] = out[n - dist];
      }
    }
  } while (!last);
  return out.slice(0, n);
}
