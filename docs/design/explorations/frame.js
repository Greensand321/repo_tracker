/* The exploration switcher. Not part of any design — it only exists so all of them
   can be flipped through side by side. */
const XS = [
  ['d1.html', 'D1 Register'], ['d2.html', 'D2 Day Book'], ['d3.html', 'D3 Split Ledger'],
  ['d4.html', 'D4 Broadsheet'], ['d5.html', 'D5 Console'], ['d6.html', 'D6 The Ledger ★'],
];
(function () {
  const here = location.pathname.split('/').pop() || 'index.html';
  const bar = document.getElementById('xbar');
  if (!bar) return;
  bar.innerHTML = `<span class="lbl">EXPLORATION</span>` +
    XS.map(([h, n]) => `<a href="${h}" class="${h === here ? 'on' : ''}">${n}</a>`).join('') +
    `<a href="index.html" style="opacity:.6">index</a>`;
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const i = XS.findIndex(([h]) => h === here);
    if (e.key === 'ArrowRight' && i > -1) location.href = XS[(i + 1) % XS.length][0];
    if (e.key === 'ArrowLeft' && i > -1) location.href = XS[(i - 1 + XS.length) % XS.length][0];
  });
})();
