// Some in-app browsers (Messenger's on Android, for one) enlarge all text by the phone's font-size setting,
// which CSS cannot switch off. The desk's labels are sized to fit their keys, so measure the enlargement
// and shrink our own font sizes back by the same factor. Ordinary browsers enlarge nothing: no change.
'use strict';
(function () {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:100px;line-height:1';
  document.body.appendChild(probe);
  const factor = parseFloat(getComputedStyle(probe).fontSize) / 100;
  probe.remove();
  if (!(factor > 1.02)) return;
  // absolute sizes only: sizes in em or % follow their (already corrected) parent
  const fix = rules => {
    for (const r of rules) {
      if (r.cssRules) fix(r.cssRules);
      const fs = r.style && r.style.fontSize;
      if (fs && !/em\b|%|inherit|initial/.test(fs)) r.style.fontSize = `calc(${fs} / ${factor})`;
    }
  };
  for (const sheet of document.styleSheets) {
    try { fix(sheet.cssRules); } catch (e) { /* a stylesheet from another site: not ours */ }
  }
  document.documentElement.dataset.textScale = factor.toFixed(2);
})();

// A minimum font size (Android WebViews such as Messenger's draw no text below about 8px) also enlarges the
// labels, and does not show in the computed style either: measure how tall a 1px letter is really drawn.
// If it is drawn bigger, lay the desk out k times larger and shrink it back (room.css: html.upscale).
const minFontSize = (() => {
  const probe = document.createElement('span');
  probe.textContent = 'H';
  probe.style.cssText = 'position:absolute;visibility:hidden;font:1px/1 Arial,sans-serif;white-space:nowrap';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
})();
if (minFontSize >= 3 || /[?&]upscale\b/.test(location.search)) { // ?upscale forces it, for testing
  const k = Math.min(4, Math.max(2, Math.ceil(Math.max(minFontSize, 8) / 3.5)));
  document.documentElement.style.setProperty('--k', k);
  document.documentElement.classList.add('upscale');
  document.documentElement.dataset.minFont = minFontSize.toFixed(1);
}

// Messenger, Facebook and Instagram open links in their own small browser: offer the phone's browser
const inappShown = () => { try { return sessionStorage.getItem('zxInappShown'); } catch (e) { return null; } };
if (/FBAN|FBAV|FB_IAB|Messenger|Instagram/i.test(navigator.userAgent) && !inappShown()) {
  try { sessionStorage.setItem('zxInappShown', '1'); } catch (e) { /* storage blocked */ }
  const android = /Android/i.test(navigator.userAgent);
  const box = document.createElement('div');
  box.className = 'inapp';
  box.innerHTML = android
    ? '<p>For the best picture, open the emulator in your phone\'s browser.</p><a>Open in browser</a><button aria-label="Close">&#10005;</button>'
    : '<p>For the best picture, tap <b>&middot;&middot;&middot;</b> and choose <b>Open in browser</b>.</p><button aria-label="Close">&#10005;</button>';
  if (android) box.querySelector('a').href = 'intent://' + location.host + location.pathname + '#Intent;scheme=https;action=android.intent.action.VIEW;end';
  box.querySelector('button').onclick = () => box.remove();
  document.body.appendChild(box);
}

// ?debug in the address: a report of how this browser sizes text, to diagnose in-app browsers
if (/[?&]debug\b/.test(location.search)) {
  addEventListener('load', () => setTimeout(() => {
    const css = el => el ? getComputedStyle(el).fontSize : '-';
    const box = el => el ? Math.round(el.getBoundingClientRect().height * 10) / 10 : '-';
    const legend = document.querySelector('.key .legend'), cap = document.querySelector('.cap');
    const p = document.createElement('span'); p.textContent = 'Hg'; p.style.cssText = 'font-size:20px;line-height:1;position:absolute;visibility:hidden';
    document.querySelector('.keys').appendChild(p);
    const q = document.createElement('span'); q.textContent = 'Hg'; q.style.cssText = 'font-size:20px;line-height:1;white-space:nowrap';
    const panel = document.createElement('pre');
    panel.style.cssText = 'position:fixed;left:4px;right:4px;top:4px;z-index:99;margin:0;padding:6px;background:#fff;color:#000;font:11px/1.3 monospace;white-space:pre-wrap;border:2px solid red';
    panel.appendChild(q);
    document.body.appendChild(panel);
    const v = window.visualViewport;
    panel.append('\n' + [
      'textScale(measured)=' + (document.documentElement.dataset.textScale || 'none') + ' minFont=' + minFontSize.toFixed(1) + ' upscale=' + (document.documentElement.style.getPropertyValue('--k') || 'no'),
      'probe 20px in keys: css=' + css(p) + ' box=' + box(p),
      'probe 20px in panel: css=' + css(q) + ' box=' + box(q),
      'key legend: css=' + css(legend) + ' box=' + box(legend),
      'recorder cap: css=' + css(cap),
      'window ' + innerWidth + 'x' + innerHeight + ' dpr=' + devicePixelRatio + (v ? ' visual ' + Math.round(v.width) + 'x' + Math.round(v.height) + ' scale=' + v.scale : ''),
      'svh=' + CSS.supports('height', '100svh') + ' text-size-adjust=' + (getComputedStyle(document.documentElement).webkitTextSizeAdjust || getComputedStyle(document.documentElement).textSizeAdjust),
      'sw=' + !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      navigator.userAgent,
    ].join('\n'));
  }, 1500));
}
