// Theme before the first paint (shared theme spec ch. 3: light or dark, default light). Same rule as
// src/lib/theme.ts — keep them in step. A plain script, not a module, so it runs while <body> is parsed
// (the CSP allows 'self' scripts only).
(function () {
  // an old saved "system" shows what the OS shows now
  function fromSaved(v) {
    if (v === 'light' || v === 'dark') return v;
    if (v === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return null;
  }
  var t = null;
  try {
    t = fromSaved(window.desktop && window.desktop.getTheme ? window.desktop.getTheme() : null);
  } catch (e) {
    t = null;
  }
  if (!t) {
    try {
      t = fromSaved(localStorage.getItem('xo.theme') || localStorage.getItem('asm.theme'));
    } catch (e) {
      t = null;
    }
  }
  if (!t) t = 'light';
  document.documentElement.dataset.theme = t;
  document.body.classList.add('theme-' + t);
})();
