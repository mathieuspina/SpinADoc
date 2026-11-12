// Contrôle de « cliquabilité réelle » d'une vue (à évaluer dans la page). Pour chaque élément interactif visible de la portée :
//  1. document.elementFromPoint au centre renvoie l'élément lui-même ou un de ses descendants (aucun calque ne l'intercepte) ;
//  2. le centre n'est pas dans une région de déplacement de la fenêtre (-webkit-app-region: drag) sans que l'élément ou un de ses
//     ancêtres soit no-drag : dans ce cas Electron n'envoie AUCUN clic (les clics synthétiques de CDP, eux, passent : défaut invisible).
// Retourne { n, bad: [{ el, why }] }.
const SCRIPT = (scopeSel) => `(() => {
  const scope = ${scopeSel ? `document.querySelector(${JSON.stringify(scopeSel)})` : 'document.body'};
  if (!scope) return JSON.stringify({ n: 0, bad: [{ el: ${JSON.stringify(scopeSel)}, why: 'portée introuvable' }] });
  const SEL = 'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=button], [role=menuitem], [role=checkbox], [role=switch], summary, [tabindex]:not([tabindex="-1"])';
  const region = (e) => getComputedStyle(e).webkitAppRegion || getComputedStyle(e).getPropertyValue('-webkit-app-region') || 'none';
  const drags = [...document.querySelectorAll('*')].filter((e) => region(e) === 'drag' && e.getBoundingClientRect().width > 0);
  const name = (e) => (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '') + ' <' + e.tagName.toLowerCase() + '> « ' + (e.getAttribute('aria-label') || e.title || e.textContent || e.value || '').trim().slice(0, 30) + ' »';
  const visible = (e) => {
    for (let p = e; p && p !== document.documentElement; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || (p.hidden === true)) return false;
    }
    const r = e.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  const bad = []; let n = 0;
  for (const e of scope.querySelectorAll(SEL)) {
    if (!visible(e) || e.disabled && false) continue;
    if (e.type === 'checkbox' || e.type === 'radio') { const lab = e.closest('label') || (e.id && document.querySelector('label[for="' + e.id + '"]')); if (getComputedStyle(e).opacity === '0' && lab) continue; }
    if (e.closest('[inert]')) continue;
    e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = e.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) { n++; bad.push({ el: name(e), why: 'hors de la fenêtre (' + Math.round(x) + ',' + Math.round(y) + ')' }); continue; }
    n++;
    const top = document.elementFromPoint(x, y);
    if (!top || !(top === e || e.contains(top) || (top.closest && top.closest('label') && top.closest('label').contains(e)))) { bad.push({ el: name(e), why: 'intercepté par ' + (top ? name(top) : 'rien') }); continue; }
    const inDrag = drags.some((d) => { const q = d.getBoundingClientRect(); return x >= q.left && x <= q.right && y >= q.top && y <= q.bottom; });
    if (inDrag) {
      let free = false;
      for (let p = e; p; p = p.parentElement) if (region(p) === 'no-drag') { free = true; break; }
      if (!free) bad.push({ el: name(e), why: 'dans une région de déplacement (app-region: drag) : clic perdu' });
    }
  }
  return JSON.stringify({ n, bad });
})()`;
module.exports = { SCRIPT };
