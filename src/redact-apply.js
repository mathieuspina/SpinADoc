// Caviardage : application (UMD ; renderer et Node). MÉTHODE : chaque page qui a au moins une zone est rendue en image (pdf.js, par bandes,
// 300 dpi par défaut, plafonné sur les grands formats), les blocs sont peints dans les pixels, puis la page est REMPLACÉE dans la liste des pages
// par une nouvelle source d'une seule page qui ne contient que cette image ('rd1', 'rd2'…). Texte, tracés, images, annotations et champs de la page
// d'origine n'existent plus dans le fichier enregistré (pdf-edit reconstruit un nouveau document page à page, puis redact-pdf.scrub nettoie).
// Avant le rendu, les objets de l'application posés sur la page (et les valeurs saisies dans le formulaire) sont écrits dans un PDF temporaire :
// ils font partie de l'image, et ceux qui touchent une zone disparaissent sous le bloc. Les pages sans zone ne sont pas touchées.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./redact.js'), require('./redact-raster.js'), require('./redact-pdf.js'), require('./pdf-edit.js'), require('./page-ops.js'));
  else root.RedactApply = factory(root.Redact, root.RedactRaster, root.RedactPdf, root.PdfEdit, root.PageOps);
})(typeof self !== 'undefined' ? self : this, function (Redact, RedactRaster, RedactPdf, PdfEdit, PageOps) {
  'use strict';

  const DEFAULTS = { dpi: 300, maxPixels: 80e6, color: [0, 0, 0], label: '' };

  async function srcBytes(PDFLib, doc, src) {
    if (src === '0') return doc.bytes;
    const b = PageOps.parseBlank(src);
    if (b) { const d = await PDFLib.PDFDocument.create(); d.addPage([b.w, b.h]); return d.save(); }
    const s = doc.sources && doc.sources[src];
    if (!s) throw new Error('Source de pages introuvable : ' + src);
    return s.bytes;
  }

  // Mesures non incluses dans le PDF (réglage de l'onglet Mesure) : elles restent des objets modifiables si elles ne touchent aucune zone.
  const keptMeasure = (doc, p, e) => doc.measure && doc.measure.include === false && /^m-/.test(e.type) && !p.touchIds.includes(e.id);

  // doc : document (voir doc-model.js) ; deps : { PDFLib, loadPdf(bytes) → document pdf.js (les octets ne doivent pas être consommés), createCanvas(w, h),
  //   renderCanvasFactory?, measure (Shapes.makeMeasure), job?, onProgress?(fraction, pageIndex) } ; opts : { dpi, maxPixels, color, label }.
  // Renvoie null s'il n'y a aucune zone, sinon { pages, edits, sources, dropOcr: [uid], report: [...] } (rien n'est modifié : voir commit).
  async function apply(doc, deps, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const { PDFLib } = deps;
    const plan = Redact.plan(doc.pages, doc.edits, deps.measure);
    if (!plan.length) return null;
    // Une source (fichier ouvert, PDF inséré, page déjà caviardée…) → un PDF temporaire pour toutes ses pages concernées ; une page source utilisée
    // deux fois (duplication) avec des objets différents a son propre PDF temporaire.
    const groups = [];
    for (const p of plan) {
      const d = doc.pages[p.index];
      let g = groups.find((x) => x.src === d.src && !x.items.some((y) => doc.pages[y.index].i === d.i));
      if (!g) { g = { src: d.src, items: [] }; groups.push(g); }
      g.items.push(p);
    }
    let seq = 1;
    for (const k of Object.keys(doc.sources || {})) { const m = /^rd(\d+)$/.exec(k); if (m) seq = Math.max(seq, Number(m[1]) + 1); }
    const pages = doc.pages.slice();
    const sources = {};
    const report = [];
    let done = 0;
    for (const g of groups) {
      const base = await srcBytes(PDFLib, doc, g.src);
      const burn = [];
      const scales = {};
      for (const p of g.items) {
        const d = doc.pages[p.index];
        for (const e of p.burn) if (!keptMeasure(doc, p, e)) burn.push(Object.assign({}, e, { page: d.i }));
        if (doc.measure && doc.measure.scales && doc.measure.scales[p.index] !== undefined) scales[d.i] = doc.measure.scales[p.index];
      }
      const values = g.src === '0' && doc.form && doc.form.values && Object.keys(doc.form.values).length ? doc.form.values : null;
      const bytes = burn.length || values
        ? await PdfEdit.applyEdits(PDFLib, base.slice(), burn, { images: (doc.assets && doc.assets.images) || {}, measure: Object.assign({}, doc.measure, { scales }), form: values ? { values, flatten: true } : null, useObjectStreams: false })
        : base;
      const pdf = await deps.loadPdf(bytes);
      try {
        for (const p of g.items) {
          const d = doc.pages[p.index];
          const page = await pdf.getPage(d.i + 1);
          const ras = await RedactRaster.rasterize(page, {
            dpi: o.dpi, maxPixels: o.maxPixels, zones: p.zones, color: o.color, label: o.label, createCanvas: deps.createCanvas,
            renderCanvasFactory: deps.renderCanvasFactory === 'auto' ? pdf.canvasFactory : deps.renderCanvasFactory, job: deps.job, onProgress: (f) => deps.onProgress && deps.onProgress((done + f) / plan.length, p.index),
          });
          page.cleanup();
          const out = await RedactPdf.imagePagePdf(PDFLib, ras);
          const id = 'rd' + seq++;
          sources[id] = { bytes: out, name: 'Page caviardée' };
          pages[p.index] = Object.assign({}, d, { src: id, i: 0 });
          report.push({ index: p.index, uid: p.uid, zones: p.zones.length, dpi: ras.dpi, width: ras.width, height: ras.height, gray: ras.gray, bytes: out.length, burned: p.burn.length, touching: p.touching });
          done++;
        }
      } finally {
        try { await pdf.destroy(); } catch { /* déjà fermé */ }
      }
    }
    const redacted = new Map(plan.map((p) => [p.index, p]));
    // restent des objets : ceux des autres pages, les mesures non incluses hors zone, les champs de formulaire hors zone (vrais champs, pas des pixels)
    const edits = doc.edits.filter((e) => { const p = redacted.get(e.page); return !p || (e.type !== 'redact' && (keptMeasure(doc, p, e) || (e.type === 'field' && !p.touchIds.includes(e.id)))); });
    return { pages, edits, sources, dropOcr: plan.map((p) => p.uid), report };
  }

  // Inscrit le résultat dans le document : sources ajoutées (hors historique, jamais retirées), puis pages, objets et texte reconnu en UNE étape
  // d'historique (Annuler rétablit les pages d'origine, les zones et l'OCR tant que rien n'est enregistré).
  function commit(DocModel, doc, res) {
    for (const [id, s] of Object.entries(res.sources)) DocModel.addSource(doc, id, s);
    DocModel.commit(doc, (d) => {
      d.pages = res.pages;
      d.edits = res.edits;
      const ocr = Object.assign({}, d.ocr);
      for (const u of res.dropOcr) delete ocr[u];
      d.ocr = ocr;
      d.selection = [];
    });
  }

  return { apply, commit, DEFAULTS };
});
