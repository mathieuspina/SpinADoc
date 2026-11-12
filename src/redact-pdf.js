// Caviardage : écriture (pdf-lib). UMD, sans DOM.
//  - imagePagePdf : PDF d'une page qui ne contient QU'UNE image (flux zlib produit par redact-raster.js), dans le même repère que la page d'origine
//    (MediaBox = zone visible d'origine, même /Rotate) : objets, recadrage, échelles et numérotation restent valables.
//  - scrub : après reconstruction du document (pdf-edit.buildPages), supprime ce qui pourrait encore porter le contenu des pages remplacées :
//      1. ressources inutilisées des pages conservées (XObject / Pattern / Shading absents du flux de contenu), récursivement dans les XObject de
//         formulaire et les apparences d'annotations (cas des dictionnaires de ressources partagés entre pages : une image ou un formulaire qui
//         n'était dessiné que sur la page caviardée disparaît) ;
//      2. références vers des pages qui ne sont pas dans l'arbre des pages (destinations de liens copiées avec leur page d'origine) et vers des
//         annotations qui ne sont sur aucune page (widgets de champs, fenêtres) : remplacées par null ;
//      0. structures hors contenu (redact-active.js) : catalogue, actions, pièces jointes, formulaire, annotations masquées ;
//  - collect : supprime tous les objets inaccessibles depuis la fin de fichier (anciennes révisions, orphelins) : pdf-lib écrit sinon TOUT ce qu'il a lu.
//  - cleanMeta : titre, auteur, sujet, mots-clés, créateur, producteur, dates, XMP.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./redact-active.js'));
  else root.RedactPdf = factory(root.RedactActive);
})(typeof self !== 'undefined' ? self : this, function (RedactActive) {
  'use strict';

  const num = (v) => String(Math.round(v * 10000) / 10000);

  async function imagePagePdf(PDFLib, r) {
    const { PDFDocument, PDFName, degrees } = PDFLib;
    const doc = await PDFDocument.create({ updateMetadata: false });
    const [x0, y0, x1, y1] = r.view;
    const w = x1 - x0, h = y1 - y0;
    const page = doc.addPage([w, h]);
    page.setMediaBox(x0, y0, w, h);
    const ctx = doc.context;
    const img = ctx.stream(r.data, {
      Type: 'XObject', Subtype: 'Image', Width: r.width, Height: r.height, ColorSpace: r.gray ? 'DeviceGray' : 'DeviceRGB', BitsPerComponent: 8,
      Filter: 'FlateDecode', DecodeParms: { Predictor: 15, Colors: r.gray ? 1 : 3, BitsPerComponent: 8, Columns: r.width },
    });
    page.node.setXObject(PDFName.of('Im0'), ctx.register(img));
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(`q\n${num(w)} 0 0 ${num(h)} ${num(x0)} ${num(y0)} cm\n/Im0 Do\nQ\n`)));
    if (r.rotate) page.setRotation(degrees(r.rotate));
    return doc.save({ useObjectStreams: false });
  }

  // ----------------------------------------------------------------------------- lecture des flux
  function latin1(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return s;
  }
  // Texte décodé d'un flux (null si son filtre n'est pas décodable : on ne retire alors rien des ressources qu'il utilise).
  function streamText(PDFLib, s) {
    try {
      if (s instanceof PDFLib.PDFRawStream) return latin1(PDFLib.decodePDFRawStream(s).decode());
      if (s && typeof s.getUnencodedContents === 'function') return latin1(s.getUnencodedContents());
    } catch { return null; }
    return null;
  }
  // Noms utilisés dans un flux de contenu (tout « /Nom », décodage #xx) : une sur-approximation, qui ne retire jamais une ressource utilisée.
  function namesIn(text) {
    const out = new Set();
    const re = /\/([^\s/[\]()<>{}%]+)/g;
    let m;
    while ((m = re.exec(text))) out.add(m[1].replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
    return out;
  }

  // ----------------------------------------------------------------------------- 1. ressources inutilisées
  const PRUNED = ['XObject', 'Pattern', 'Shading'];
  function pruneResources(PDFLib, ctx, holder, used, state) {
    const { PDFDict, PDFName, PDFRef, PDFRawStream } = PDFLib;
    const RES = PDFName.of('Resources');
    const raw = holder.get(RES);
    const R = raw instanceof PDFRef ? ctx.lookup(raw) : raw;
    if (!(R instanceof PDFDict)) return;
    const R2 = R.clone(ctx); // copie propre au porteur : un dictionnaire partagé n'est jamais modifié pour les autres
    for (const cat of PRUNED) {
      const sub = R2.lookup(PDFName.of(cat));
      if (!(sub instanceof PDFDict)) continue;
      const sub2 = sub.clone(ctx);
      for (const k of sub2.keys()) if (!used.has(k.decodeText())) { sub2.delete(k); state.removed++; }
      R2.set(PDFName.of(cat), sub2);
      if (cat !== 'XObject') continue;
      for (const k of sub2.keys()) {
        const v = sub2.get(k);
        const t = v instanceof PDFRef ? ctx.lookup(v) : v;
        if (t instanceof PDFRawStream && t.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')) pruneForm(PDFLib, ctx, t, state);
      }
    }
    holder.set(RES, R2);
  }
  function pruneForm(PDFLib, ctx, stream, state) {
    if (state.forms.has(stream)) return;
    state.forms.add(stream);
    const text = streamText(PDFLib, stream);
    if (text === null) { state.undecodable++; return; }
    pruneResources(PDFLib, ctx, stream.dict, namesIn(text), state);
  }
  // Apparences d'une annotation (/AP /N /R /D : flux, ou dictionnaire d'états de flux).
  function pruneAppearances(PDFLib, ctx, annot, state) {
    const { PDFDict, PDFName, PDFStream } = PDFLib;
    const ap = annot.lookup(PDFName.of('AP'));
    if (!(ap instanceof PDFDict)) return;
    for (const k of ['N', 'R', 'D']) {
      const v = ap.lookup(PDFName.of(k));
      if (v instanceof PDFStream) pruneForm(PDFLib, ctx, v, state);
      else if (v instanceof PDFDict) for (const s of v.keys()) { const st = v.lookup(s); if (st instanceof PDFStream) pruneForm(PDFLib, ctx, st, state); }
    }
  }
  function prunePages(PDFLib, doc, state) {
    const { PDFArray, PDFDict, PDFName, PDFStream } = PDFLib;
    const ctx = doc.context;
    for (const page of doc.getPages()) {
      const node = page.node;
      const c = node.lookup(PDFName.of('Contents'));
      const parts = c instanceof PDFArray ? c.asArray().map((x) => ctx.lookup(x)) : c ? [c] : [];
      let text = '';
      let ok = true;
      for (const s of parts) { const t = s instanceof PDFStream ? streamText(PDFLib, s) : null; if (t === null) { ok = false; break; } text += t + '\n'; }
      if (ok) pruneResources(PDFLib, ctx, node, namesIn(text), state);
      else state.undecodable++;
      const annots = node.lookup(PDFName.of('Annots'));
      if (annots instanceof PDFArray) for (const a of annots.asArray()) { const d = ctx.lookup(a); if (d instanceof PDFDict) pruneAppearances(PDFLib, ctx, d, state); }
    }
  }

  // ----------------------------------------------------------------------------- 2. coupure + 3. objets inaccessibles
  function collect(PDFLib, doc, opts) {
    const { PDFArray, PDFDict, PDFName, PDFNull, PDFRef, PDFStream } = PDFLib;
    const ctx = doc.context;
    const cut = !!(opts && opts.cut);
    const TYPE = PDFName.of('Type'), SUBTYPE = PDFName.of('Subtype'), RECT = PDFName.of('Rect');
    const PAGE = PDFName.of('Page'), PAGES = PDFName.of('Pages'), ANNOT = PDFName.of('Annot');
    const legit = new Set(), annots = new Set();
    if (cut) {
      const walk = (ref, depth) => {
        if (!(ref instanceof PDFRef) || legit.has(ref) || depth > 64) return;
        legit.add(ref);
        const n = ctx.lookup(ref);
        const kids = n instanceof PDFDict ? n.lookup(PDFName.of('Kids')) : null;
        if (kids instanceof PDFArray) for (const k of kids.asArray()) walk(k, depth + 1);
      };
      walk(doc.catalog.get(PDFName.of('Pages')), 0);
      for (const p of doc.getPages()) {
        legit.add(p.ref);
        const a = p.node.lookup(PDFName.of('Annots'));
        if (a instanceof PDFArray) for (const x of a.asArray()) if (x instanceof PDFRef) annots.add(x);
      }
    }
    const isPage = (d) => d instanceof PDFDict && (d.get(TYPE) === PAGE || d.get(TYPE) === PAGES);
    const isAnnot = (d) => d instanceof PDFDict && d.get(SUBTYPE) instanceof PDFName && d.has(RECT) && (!d.has(TYPE) || d.get(TYPE) === ANNOT);
    const reach = new Set();
    const stack = [];
    let cuts = 0;
    const onRef = (ref, doCut) => {
      const t = ctx.lookup(ref);
      if (t === undefined) { reach.add(ref); return; }
      const d = t instanceof PDFStream ? t.dict : t;
      if (cut && doCut && ((isPage(d) && !legit.has(ref)) || (isAnnot(d) && !annots.has(ref)))) { doCut(); cuts++; return; }
      if (reach.has(ref)) return;
      reach.add(ref);
      stack.push(t);
    };
    const scan = (o) => {
      if (o instanceof PDFStream) o = o.dict;
      if (o instanceof PDFDict) {
        for (const [k, v] of o.entries()) {
          if (v instanceof PDFRef) onRef(v, () => o.set(k, PDFNull));
          else if (v instanceof PDFDict || v instanceof PDFArray) scan(v);
        }
      } else if (o instanceof PDFArray) {
        for (let i = 0; i < o.size(); i++) {
          const v = o.get(i);
          if (v instanceof PDFRef) onRef(v, () => o.set(i, PDFNull));
          else if (v instanceof PDFDict || v instanceof PDFArray) scan(v);
        }
      }
    };
    const ti = ctx.trailerInfo;
    for (const k of ['Root', 'Info', 'Encrypt']) if (ti[k] instanceof PDFRef) onRef(ti[k], null);
    while (stack.length) scan(stack.pop());
    let deleted = 0;
    for (const [ref] of ctx.enumerateIndirectObjects()) if (!reach.has(ref)) { ctx.delete(ref); deleted++; }
    return { cuts, deleted, kept: reach.size };
  }

  // Nettoyage complet après reconstruction d'un document caviardé.
  async function scrub(PDFLib, doc) {
    await doc.flush(); // polices et images en attente : écrites maintenant pour que leurs objets soient vus
    const state = { removed: 0, undecodable: 0, forms: new Set() };
    const active = RedactActive.strip(PDFLib, doc); // signets, pièces jointes, JavaScript, actions, formulaire, masqué (voir redact-active.js)
    prunePages(PDFLib, doc, state);
    const c = collect(PDFLib, doc, { cut: true });
    return { removedResources: state.removed, undecodable: state.undecodable, cuts: c.cuts, deleted: c.deleted, active };
  }

  // ----------------------------------------------------------------------------- métadonnées
  const META_KEYS = { title: ['Title'], author: ['Author'], subject: ['Subject'], keywords: ['Keywords'], creator: ['Creator'], producer: ['Producer'], dates: ['CreationDate', 'ModDate'] };
  function cleanMeta(PDFLib, doc, flags) {
    const { PDFName, PDFDict } = PDFLib;
    const info = doc.getInfoDict();
    for (const [k, keys] of Object.entries(META_KEYS)) if (flags[k]) for (const n of keys) info.delete(PDFName.of(n));
    if (flags.xmp) {
      doc.catalog.delete(PDFName.of('Metadata'));
      doc.catalog.delete(PDFName.of('PieceInfo'));
      for (const p of doc.getPages()) { p.node.delete(PDFName.of('Metadata')); p.node.delete(PDFName.of('PieceInfo')); }
    }
    void PDFDict;
  }
  const META_LABELS = { title: 'Titre', author: 'Auteur', subject: 'Sujet', keywords: 'Mots-clés', creator: 'Application d\'origine (créateur)', producer: 'Producteur PDF', dates: 'Dates de création et de modification', xmp: 'Métadonnées XMP (bloc XML du document et des pages)' };

  return { imagePagePdf, streamText, namesIn, scrub, collect, cleanMeta, META_KEYS, META_LABELS };
});
