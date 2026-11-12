// Contrôle de débordement horizontal d'un panneau ou d'une boîte (à évaluer dans la page). Pour la portée donnée :
//  (a) la portée et chacun de ses conteneurs à défilement : scrollWidth <= clientWidth (aucune barre horizontale) ;
//  (b) chaque contrôle visible (champ, liste, bouton, case, libellé) est entièrement entre les bords gauche et droit de la portée ;
//  (c) aucune unité (%, mm, cm, m, m², pt, px, dpi, °) séparée de son nombre par un retour à la ligne (« 100 % » reste en un bloc) ;
//  (d) aucun libellé rogné : scrollWidth <= clientWidth sur chaque libellé (sauf points de suspension voulus, comptés à part)
//      et le texte de chaque libellé entièrement visible horizontalement.
// Retourne { n, bad: [{ el, why }], ellipsis }.
const SCRIPT = (scopeSel) => `(() => {
  const scope = document.querySelector(${JSON.stringify(scopeSel)});
  if (!scope) return JSON.stringify({ n: 0, bad: [{ el: ${JSON.stringify(scopeSel)}, why: 'portée introuvable' }] });
  const name = (e) => (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).join('.') : '') + ' <' + e.tagName.toLowerCase() + '> « ' + (e.getAttribute('aria-label') || e.textContent || e.value || '').trim().slice(0, 30) + ' »';
  const shown = (e) => {
    for (let p = e; p && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || p.hidden === true) return false;
    }
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1; // les textes réservés aux lecteurs d'écran (.sr, 1 × 1 px, rognés exprès) sont ignorés
  };
  const sr = scope.getBoundingClientRect();
  const L = sr.left + scope.clientLeft - 0.5, R = sr.left + scope.clientLeft + scope.clientWidth + 0.5;
  const bad = []; let n = 0, ellipsis = 0;
  const ell = (e) => getComputedStyle(e).textOverflow === 'ellipsis';
  // (a) débordement de la portée et des conteneurs à défilement internes
  for (const e of [scope, ...scope.querySelectorAll('*')]) {
    if (!shown(e)) continue;
    const ox = getComputedStyle(e).overflowX;
    if (e !== scope && ox === 'visible') continue;
    if (e.tagName === 'SELECT' || e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'OPTION') continue;
    if (e.scrollWidth > e.clientWidth + 1) {
      if (ell(e)) { ellipsis++; continue; }
      bad.push({ el: name(e), why: 'débordement horizontal (scrollWidth ' + e.scrollWidth + ' > clientWidth ' + e.clientWidth + ')' });
    }
  }
  // (b) contrôles entièrement à l'intérieur (horizontalement)
  const CTL = 'input:not([type=hidden]), select, textarea, button, label, .chk, .prop-ctl, output, .muted, h2, h3, table, th, td, li, p';
  for (const e of scope.querySelectorAll(CTL)) {
    if (!shown(e)) continue;
    n++;
    const r = e.getBoundingClientRect();
    if (r.left < L || r.right > R) bad.push({ el: name(e), why: 'hors du panneau (' + Math.round(r.left) + '…' + Math.round(r.right) + ' pour ' + Math.round(L) + '…' + Math.round(R) + ')' });
  }
  // (c) unités jamais seules sur une ligne ; (d) texte des libellés visible
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const UNIT = /\\d[\\d,.]*[\\s\\u00a0\\u202f]?(%|mm|cm|m²|m|pt|px|dpi|°)(?![a-zà-ÿ²])/gi;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const p = t.parentElement;
    if (!p || !shown(p) || !t.data.trim()) continue;
    if (p.closest('select, option, textarea, script, style')) continue;
    let m;
    UNIT.lastIndex = 0;
    while ((m = UNIT.exec(t.data))) {
      const rg = document.createRange(); rg.setStart(t, m.index); rg.setEnd(t, m.index + m[0].length);
      const tops = [...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top));
      if (new Set(tops).size > 1) bad.push({ el: name(p), why: 'unité séparée de son nombre : « ' + m[0] + ' » sur ' + new Set(tops).size + ' lignes' });
    }
    const only = t.data.trim();
    if (/^(%|mm|pt|px|dpi)$/i.test(only) && p.previousElementSibling) {
      const a = p.getBoundingClientRect(), b = p.previousElementSibling.getBoundingClientRect();
      if (Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) > Math.max(a.height, b.height) / 2) bad.push({ el: name(p), why: 'unité seule sur sa ligne' });
    }
    const lab = p.closest('label, .chk, h3, .muted');
    if (lab && scope.contains(lab)) {
      const rg = document.createRange(); rg.selectNodeContents(t);
      for (const q of rg.getClientRects()) {
        if (q.width > 0 && (q.left < L || q.right > R) && !ell(p)) { bad.push({ el: name(lab), why: 'texte du libellé coupé par le bord du panneau' }); break; }
      }
    }
  }
  for (const e of scope.querySelectorAll('label, .chk, h3')) {
    if (!shown(e) || getComputedStyle(e).display === 'inline') continue;
    if (e.scrollWidth > e.clientWidth + 1) { if (ell(e)) ellipsis++; else bad.push({ el: name(e), why: 'libellé rogné (scrollWidth ' + e.scrollWidth + ' > ' + e.clientWidth + ')' }); }
  }
  return JSON.stringify({ n, bad, ellipsis });
})()`;
module.exports = { SCRIPT };
