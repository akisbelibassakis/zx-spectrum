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
