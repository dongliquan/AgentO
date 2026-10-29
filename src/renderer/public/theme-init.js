// Theme before the first paint (shared theme spec ch. 3). Same rule as src/lib/theme.ts — keep them in step.
// A plain script, not a module, so it runs while <body> is parsed (the CSP allows 'self' scripts only).
(function () {
  function ok(v) {
    return v === 'light' || v === 'dark' || v === 'system';
  }
  var pref = null;
  try {
    pref = window.desktop && window.desktop.getTheme ? window.desktop.getTheme() : null;
  } catch (e) {
    pref = null;
  }
  if (!ok(pref)) {
    try {
      pref = localStorage.getItem('xo.theme') || localStorage.getItem('asm.theme');
    } catch (e) {
      pref = null;
    }
  }
  if (!ok(pref)) pref = 'system';
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var t = dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  document.body.classList.add('theme-' + t);
})();
