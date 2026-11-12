// Comparaison dans un Web Worker (l'interface ne gèle jamais). Garde en mémoire l'encre des deux pages (envoyée par bandes de rendu déjà assemblées) :
// un changement de tolérance ou de décalage ne relance donc que « diff ». L'annulation = terminate() côté interface.
// Entrées : { cmd: 'set', side: 'a'|'b', w, h, ink }  { cmd: 'align', id, thr }  { cmd: 'diff', id, dx, dy, k, opts }
// Sorties : { type: 'progress', id, label } puis { type: 'aligned', id, dx, dy, confident } / { type: 'diffed', id, frame, map, regions, stats, tolPx, mmPerPx } / { type: 'error', id, message }
/* eslint-env worker */
importScripts('../compare.js');
const pages = { a: null, b: null };
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.cmd === 'set') { pages[m.side] = { w: m.w, h: m.h, ink: new Uint8Array(m.ink) }; return; }
    const { a, b } = pages;
    if (!a || !b) throw new Error('Pages non chargées.');
    if (m.cmd === 'align') {
      self.postMessage({ type: 'progress', id: m.id, label: 'Alignement automatique…' });
      const r = self.Compare.align(a.ink, a.w, a.h, b.ink, b.w, b.h, { thr: m.thr });
      self.postMessage({ type: 'aligned', id: m.id, dx: r.dx, dy: r.dy, confident: r.confident });
    } else if (m.cmd === 'diff') {
      self.postMessage({ type: 'progress', id: m.id, label: 'Recherche des différences…' });
      const r = self.Compare.diffMaps(a.ink, a.w, a.h, b.ink, b.w, b.h, m.dx, m.dy, m.k, m.opts);
      self.postMessage({ type: 'diffed', id: m.id, frame: r.frame, map: r.map.buffer, regions: r.regions, stats: r.stats, tolPx: r.tolPx, mmPerPx: r.mmPerPx }, [r.map.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
