/**
 * FinLeg shared header — auto-injects a consistent top bar with logo + version.
 *
 * Usage: <script src="/finleg-header.js"></script>
 *   Place anywhere in <body>. The bar is prepended to document.body.
 *   If a .finleg-bar or .top-bar already exists, it is replaced.
 */
(function () {
  var STYLE_ID = 'finleg-header-style';
  if (!document.getElementById(STYLE_ID)) {
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.finleg-bar{background:linear-gradient(135deg,#0f2419,#1B6B3A);display:flex;align-items:center;gap:0.5rem;padding:0.4rem 1rem;position:relative;z-index:1000;}' +
      '.finleg-bar img{height:24px;width:auto;}' +
      '.finleg-bar .finleg-ver{font-size:10px;color:rgba(134,239,172,0.6);font-family:monospace;margin-left:auto;}' +
      '@media print{.finleg-bar{background:#0f3d1e !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;height:36px;padding:0 0.5rem;}.finleg-bar img{height:18px;}}';
    document.head.appendChild(s);
  }

  // Remove any existing header so we don't double up
  var old = document.querySelector('.finleg-bar') || document.querySelector('.top-bar');
  if (old) old.remove();

  var bar = document.createElement('div');
  bar.className = 'finleg-bar';
  bar.innerHTML =
    '<img src="/finleg-logo-transparent.png" alt="FinLeg">' +
    '<img src="/finleg-wordmark-white.png" alt="FinLeg" style="height:22px;">' +
    '<span class="finleg-ver" id="finleg-version">loading...</span>';

  // Insert at the very top of the visible content
  var main = document.getElementById('main-content');
  if (main) {
    main.insertBefore(bar, main.firstChild);
  } else {
    document.body.insertBefore(bar, document.body.firstChild);
  }

  // Fetch version
  fetch('/version.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var el = document.getElementById('finleg-version');
      if (el) el.textContent = d.version || '';
    })
    .catch(function () {
      var el = document.getElementById('finleg-version');
      if (el) el.textContent = '';
    });
})();
