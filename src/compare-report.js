// Rapport de comparaison en PDF (UMD) : une page par page comparée = image de superposition colorée + cadres numérotés + légende.
// Les cadres, numéros et légende passent par les primitives d'écriture existantes (PdfEdit.applyEdits : objets 'rect' et 'add'), pas par une géométrie propre.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CompareReport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const hexToRgb01 = (h) => { const n = parseInt(String(h).replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const ZONE = [1, 0.55, 0];
  const fmt = (n, d) => Number(n).toFixed(d === undefined ? 1 : d).replace('.', ',');

  // Dimensions de la page de rapport (points) et hauteur de la légende.
  function layout(W, H, k) {
    const w = W / k, h = H / k;
    const u = Math.max(9, w / 110);
    return { w, h, u, leg: u * 5.2, pageW: w, pageH: h + u * 5.2 };
  }

  // Objets d'écriture d'une page de rapport. page : { W, H, k, regions, title, pal: { old, nu, same }, mmPerPx, tolMm, stats, shiftMm, note }.
  function pageEdits(pageIndex, p) {
    const L = layout(p.W, p.H, p.k);
    const pal = p.pal;
    const edits = [];
    const text = (x, y, s, size, color) => edits.push({ page: pageIndex, type: 'add', x, y, text: s, size, color });
    const top = L.pageH - L.u * 1.4;
    text(L.u * 0.6, top, p.title, L.u * 1.1, [0.1, 0.1, 0.1]);
    // légende : trois pastilles de couleur
    const ly = L.pageH - L.u * 3.1;
    let x = L.u * 0.6;
    for (const [lab, hex] of [['Ancien seulement', pal.old], ['Nouveau seulement', pal.nu], ['Inchangé', pal.same]]) {
      const col = hexToRgb01(hex);
      edits.push({ page: pageIndex, type: 'rect', cx: x + L.u * 0.5, cy: ly + L.u * 0.3, w: L.u, h: L.u * 0.7, rot: 0, color: col, fill: col, width: 0.5, opacity: 1, radius: 0 });
      text(x + L.u * 1.3, ly, lab, L.u * 0.9, [0.15, 0.15, 0.15]);
      x += L.u * (1.6 + lab.length * 0.5);
    }
    const info = [];
    if (p.stats) info.push(`${p.stats.regions} différence${p.stats.regions > 1 ? 's' : ''} · ${fmt(p.stats.percent)} % de changement`);
    info.push(`tolérance ${fmt(p.tolMm)} mm · résolution ${fmt(p.mmPerPx, 2)} mm/px`);
    if (p.shiftMm && (p.shiftMm[0] || p.shiftMm[1])) info.push(`décalage ${fmt(p.shiftMm[0])} ; ${fmt(p.shiftMm[1])} mm`);
    if (p.note) info.push(p.note);
    text(L.u * 0.6, L.pageH - L.u * 4.5, info.join(' · '), L.u * 0.8, [0.3, 0.3, 0.3]);
    // zones numérotées (le cadre dépasse un peu la zone)
    const pad = Math.max(2, 1.5 / (p.mmPerPx || 0.3)) / p.k;
    for (const g of p.regions || []) {
      const x0 = g.x0 / p.k - pad, x1 = g.x1 / p.k + pad;
      const yb = (p.H - g.y1) / p.k - pad, yt = (p.H - g.y0) / p.k + pad;
      edits.push({ page: pageIndex, type: 'rect', cx: (x0 + x1) / 2, cy: (yb + yt) / 2, w: x1 - x0, h: yt - yb, rot: 0, color: ZONE, fill: null, width: Math.max(0.8, L.u / 9), opacity: 1, radius: 0 });
      text(x0, yt + L.u * 0.25, String(g.id), L.u * 0.9, ZONE);
    }
    return edits;
  }

  // PDFLib, PdfEdit : bibliothèques ; pages : [{ png, ...voir pageEdits }]. Renvoie les octets du PDF.
  async function buildReport(PDFLib, PdfEdit, pages) {
    const doc = await PDFLib.PDFDocument.create();
    doc.setTitle('Comparaison de documents');
    doc.setProducer('Spin A Doc');
    const edits = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const L = layout(p.W, p.H, p.k);
      const page = doc.addPage([L.pageW, L.pageH]);
      page.drawImage(await doc.embedPng(p.png), { x: 0, y: 0, width: L.w, height: L.h });
      edits.push(...pageEdits(i, p));
    }
    const base = await doc.save();
    return PdfEdit.applyEdits(PDFLib, base, edits, { images: {}, measure: {}, pages: null, numbering: [], form: null, warn: null, info: undefined, encrypt: null });
  }

  return { layout, pageEdits, buildReport };
});
