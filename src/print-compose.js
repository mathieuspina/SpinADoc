// Impression : assemble le PDF « à imprimer » (une page = une feuille, à la taille exacte du papier). Les pages source sont intégrées en
// vectoriel (embedPage) avec échelle, rotation et position imposées par src/print-layout.js : le lecteur PDF de Chromium n'a alors plus
// rien à mettre à l'échelle (vérifié sur imprimante virtuelle : A4, A3 et A1 exacts à 0,1 mm près).
// Fonctionne dans le renderer (PDFLib global) et dans Node (tests) : PDFLib est passé en argument.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrintCompose = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Zone visible d'une page source : CropBox si présente, sinon MediaBox.
  function boxOf(page) {
    let b = null;
    try { b = page.getCropBox(); } catch { /* absente */ }
    if (!b || !(b.width > 0 && b.height > 0)) b = page.getMediaBox();
    return b;
  }

  // Taille affichée (après /Rotate) de chaque page : [{ w, h, rotate, box }] en points.
  async function pageInfos(PDFLib, bytes) {
    const doc = await PDFLib.PDFDocument.load(bytes);
    return doc.getPages().map((p) => {
      const box = boxOf(p);
      const rot = ((p.getRotation().angle % 360) + 360) % 360;
      const swap = rot === 90 || rot === 270;
      return { w: swap ? box.height : box.width, h: swap ? box.width : box.height, rotate: rot, box: { x: box.x, y: box.y, w: box.width, h: box.height } };
    });
  }

  // sheets : [{ w, h, items: [{ page (index source), scale, rotate (0|90 anti-horaire, en plus du /Rotate), x, y, w, h (boîte placée, pt),
  //            clip?: { x, y, w, h } }] }] → octets du PDF d'impression.
  //   opts.title : titre du PDF (/Title) = nom du travail d'impression vu par le spouleur.
  async function compose(PDFLib, srcBytes, sheets, opts) {
    const { PDFDocument, degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = PDFLib;
    const src = await PDFDocument.load(srcBytes);
    const out = await PDFDocument.create();
    if (opts && opts.title) out.setTitle(opts.title);
    const srcPages = src.getPages();
    const embedded = new Map();
    for (const sh of sheets) {
      const page = out.addPage([sh.w, sh.h]);
      for (const it of sh.items) {
        const sp = srcPages[it.page];
        let emb = embedded.get(it.page);
        if (!emb) {
          const b = boxOf(sp);
          emb = await out.embedPage(sp, { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height });
          embedded.set(it.page, emb);
        }
        const rot = ((sp.getRotation().angle % 360) + 360) % 360;
        const theta = (((-rot + (it.rotate || 0)) % 360) + 360) % 360; // anti-horaire
        const bw = emb.width * it.scale, bh = emb.height * it.scale;
        const origin = theta === 0 ? [it.x, it.y] : theta === 90 ? [it.x + bh, it.y] : theta === 180 ? [it.x + bw, it.y + bh] : [it.x, it.y + bw];
        const c = it.clip || null;
        if (c) page.pushOperators(pushGraphicsState(), rectangle(c.x, c.y, c.w, c.h), clip(), endPath());
        page.drawPage(emb, { x: origin[0], y: origin[1], xScale: it.scale, yScale: it.scale, rotate: degrees(theta) });
        if (c) page.pushOperators(popGraphicsState());
      }
    }
    return out.save();
  }

  return { pageInfos, compose, boxOf };
});
