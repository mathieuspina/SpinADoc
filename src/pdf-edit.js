// Tout le code qui écrit dans le PDF est ici.
// Fonctionne dans le renderer (PDFLib et Shapes globaux) et dans Node (require).
//
// PRINCIPE « FIGÉ »
// -----------------
// Pendant l'édition, les modifications sont des objets affichés en calque (SVG) par-dessus la page et restent
// modifiables. À « Enregistrer sous », applyEdits() les incorpore dans le contenu de chaque page (visibles dans
// tous les lecteurs, mais plus déplaçables après réouverture). L'aperçu et l'enregistrement parcourent les
// mêmes « primitives » (Shapes.primitives) : le résultat enregistré est identique à l'aperçu.
// Le surlignage utilise le mode de fusion « Multiply » (BlendMode.Multiply de pdf-lib) : le texte reste lisible.
//
// FORMAT D'UNE MODIFICATION (extensible grâce au champ `type`)
// -----------------------------------------------------------
// Champs communs : id (entier unique dans le document), type, page (index à partir de 0).
// Coordonnées en points PDF, origine en bas à gauche. Le détail des champs de chaque type est dans src/shapes.js :
//   'add'      texte (x, y = ligne de base ; font, bold, italic, size, color, align, width, fill, border, rot)
//   'note'     comme 'add' avec fond jaune, bordure et ombre optionnelle (cartouche)
//   'stamp'    tampon vectoriel : label, color, frame, date, user, cx, cy, w, h, rot, opacity
//   'sig'      signature tracée (vectorielle) : strokes, lw, w0, cx, cy, w, h, rot, color, opacity
//   'image'    image PNG/JPEG : imgId (+ assets.images passé à applyEdits), cx, cy, w, h, rot, opacity
//   'replace'  texte qui recouvre un texte existant : comme 'add' (font, bold, italic, size, color, rot) +
//              cover:{x,y,w,h,rot,ox,oy} (rectangle de recouvrement tourné avec le texte, dessiné d'abord),
//              bgMode 'auto'|'white'|'custom', bgAuto (couleur détectée), bgColor ; origFont/origEmbedded (information)
//   'rect' 'ellipse' 'hlrect'                        cadre : cx, cy, w, h, rot (+ radius)
//   'line' 'arrow' 'polygon' 'polyline' 'cloud' 'pen'  points:[[x,y],…]
//   'highlight' 'underline' 'strike'                 rects:[[x,y,w,h],…]
//
// Ajouter un type (lot 2b : note, tampon, image, signature, mesures…) :
//   PdfEdit.registerType('image', { cover(ctx, e) {}, draw(ctx, e) {} });
//   ctx = { doc, page, fonts, measure, PDFLib, rgb } ; `page` est la PDFPage de e.page.
// Une modification de type inconnu fait échouer l'enregistrement (jamais de perte silencieuse).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shapes.js'), require('./page-ops.js'), require('./numbering.js'), require('./forms.js'), require('./ocr.js'), require('./redact-pdf.js'), require('./fields-pdf.js'), require('./outline.js'));
  else root.PdfEdit = factory(root.Shapes, root.PageOps, root.Numbering, root.Forms, root.Ocr, root.RedactPdf, root.FieldsPdf, root.Outline);
})(typeof self !== 'undefined' ? self : this, function (Shapes, PageOps, Numbering, Forms, Ocr, RedactPdf, FieldsPdf, Outline) {
  'use strict';

  const sanitizeWinAnsi = Shapes.sanitize;

  // ---- registre des types ----
  const types = {};
  function registerType(name, handler) { types[name] = handler; }

  // Dessine une liste de primitives (voir Shapes.primitives) sur la page.
  function drawPrimitives(ctx, prims) {
    const { page, PDFLib, rgb } = ctx;
    for (const p of prims) {
      if (p.kind === 'image') {
        const img = ctx.images[p.imgId];
        if (!img) throw new Error('Image introuvable dans le document : ' + p.imgId);
        const a = (p.rot || 0) * Math.PI / 180;
        // pdf-lib tourne autour du coin bas-gauche : on y amène le coin bas-gauche du cadre tourné.
        const x = p.cx + (-p.w / 2) * Math.cos(a) - (-p.h / 2) * Math.sin(a);
        const y = p.cy + (-p.w / 2) * Math.sin(a) + (-p.h / 2) * Math.cos(a);
        page.drawImage(img, { x, y, width: p.w, height: p.h, rotate: PDFLib.degrees(p.rot || 0), opacity: p.opacity });
        continue;
      }
      if (p.kind === 'text') {
        page.drawText(p.text, {
          x: p.x, y: p.y, size: p.size, font: ctx.fonts[p.fontName],
          color: rgb(p.color[0], p.color[1], p.color[2]), rotate: PDFLib.degrees(p.rot || 0), opacity: p.opacity,
        });
        continue;
      }
      // Chemin : on le passe en coordonnées « SVG » (y inversé) avec x = y = 0, pdf-lib rétablit y vers le haut.
      const d = Shapes.pathD(p.segs, (x, y) => [x, -y]);
      const o = { x: 0, y: 0, scale: 1 };
      if (p.fill) { o.color = rgb(p.fill.color[0], p.fill.color[1], p.fill.color[2]); o.opacity = p.fill.opacity; }
      if (p.stroke) {
        o.borderColor = rgb(p.stroke.color[0], p.stroke.color[1], p.stroke.color[2]);
        o.borderWidth = p.stroke.width;
        o.borderOpacity = p.stroke.opacity;
        o.borderLineCap = PDFLib.LineCapStyle.Round;
        if (p.stroke.dash) o.borderDashArray = p.stroke.dash;
      }
      if (p.blend === 'multiply') o.blendMode = PDFLib.BlendMode.Multiply;
      page.drawSvgPath(d, o);
    }
  }

  // Texte reconnu (OCR) : couche INVISIBLE (mode de rendu 3) alignée sur chaque mot, police standard dont l'échelle horizontale est ajustée à la largeur
  // du mot. Les caractères hors jeu WinAnsi sont remplacés par « ? » (comme le texte ajouté) ; un mot vide après nettoyage est ignoré.
  function drawInvisibleText(PDFLib, page, font, words) {
    const { pushGraphicsState, popGraphicsState, beginText, endText, setTextRenderingMode, TextRenderingMode, setFontAndSize, setTextMatrix, showText, setCharacterSqueeze } = PDFLib;
    const clean = [];
    for (const w of words) { const t = sanitizeWinAnsi(w.t).replace(/[\u0000-\u001f]/g, ''); if (t.trim()) clean.push(Object.assign({}, w, { t })); }
    const runs = Ocr.invisibleRuns(clean, (t, size) => font.widthOfTextAtSize(t, size));
    if (!runs.length) return 0;
    page.setFont(font);
    const key = page.fontKey;
    const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const r of runs) ops.push(setFontAndSize(key, r.size), setCharacterSqueeze(r.squeeze), setTextMatrix(r.m[0], r.m[1], r.m[2], r.m[3], r.m[4], r.m[5]), showText(font.encodeText(r.text)));
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
    return runs.length;
  }

  const drawShape = (ctx, e) => drawPrimitives(ctx, Shapes.primitives(e, ctx.measure, ctx.mctx));

  registerType('add', { draw: drawShape });
  registerType('replace', {
    // Le recouvrement suit le texte (tourné) et prend la couleur du fond (Auto / Blanc / personnalisée).
    cover(ctx, e) { if (e.cover) drawPrimitives(ctx, [Shapes.coverPrimitive(e)]); },
    draw: drawShape,
  });
  for (const t of ['m-dist', 'm-poly', 'm-area', 'm-angle', 'm-dim', 'm-circle', 'note', 'callout', 'stamp', 'image', 'sig', 'rect', 'ellipse', 'hlrect', 'line', 'arrow', 'polygon', 'polyline', 'cloud', 'pen', 'highlight', 'underline', 'strike']) {
    registerType(t, { draw: drawShape });
  }
  // Zones « à caviarder » : repères d'édition, JAMAIS écrits (seul « Appliquer le caviardage » détruit l'information, voir src/redact-apply.js).
  registerType('redact', {});
  registerType('field', {}); // champs créés : écrits comme vrais champs AcroForm après les objets (fields-pdf.js)

  // Reconstruit le document selon la liste de pages (voir src/page-ops.js) : spec = { list: [{ src, i, rot, crop }], sources: { [id]: { bytes } } }.
  // Un NOUVEAU document est construit page par page (copyPages) : les pages supprimées ne laissent rien dans le fichier. Rotation (/Rotate) et
  // recadrage (CropBox) sont écrits dans les pages. Les pages utilisées plusieurs fois (duplication) partagent leur contenu (dictionnaire de page cloné).
  async function buildPages(PDFLib, doc0, spec) {
    const { PDFDocument, PDFPage, PDFName, PDFArray, PDFDict, degrees } = PDFLib;
    const out = await PDFDocument.create();
    try { // informations du document
      const t = doc0.getTitle(), a = doc0.getAuthor(), su = doc0.getSubject(), k = doc0.getKeywords();
      if (t) out.setTitle(t); if (a) out.setAuthor(a); if (su) out.setSubject(su); if (k) out.setKeywords(k.split(/\s+/));
    } catch { /* informations absentes ou illisibles */ }
    const loaded = { '0': doc0 };
    const srcDoc = async (id) => {
      if (loaded[id]) return loaded[id];
      const b = PageOps.parseBlank(id);
      let d;
      if (b) { d = await PDFDocument.create(); d.addPage([b.w, b.h]); }
      else {
        const src = spec.sources && spec.sources[id];
        if (!src) throw new Error('Source de pages introuvable : ' + id);
        d = await PDFDocument.load(src.bytes);
      }
      loaded[id] = d;
      return d;
    };
    // 1. première occurrence de chaque page source : copiée en bloc par source (les ressources communes ne sont copiées qu'une fois)
    const want = {}; // src → [i…]
    const seen = new Set();
    for (const d of spec.list) { const key = d.src + '|' + d.i; if (!seen.has(key)) { seen.add(key); (want[d.src] = want[d.src] || []).push(d.i); } }
    const base = new Map();
    for (const src of Object.keys(want)) {
      const sd = await srcDoc(src);
      const pages = sd.getPages();
      for (const i of want[src]) { if (!pages[i]) throw new Error(`Page ${i + 1} introuvable dans la source ${src}.`); pages[i].node.normalize(); }
      const copies = await out.copyPages(sd, want[src]);
      want[src].forEach((i, k) => base.set(src + '|' + i, copies[k]));
    }
    // 2. pages dans l'ordre ; les répétitions sont des clones du dictionnaire de page (même contenu)
    const used = new Set();
    for (const d of spec.list) {
      const key = d.src + '|' + d.i;
      let page = base.get(key);
      if (used.has(key)) {
        // Clone : dictionnaire de page propre, avec son propre tableau /Contents (les objets ajoutés à une copie ne doivent pas apparaître sur l'autre)
        // et sa propre table /Resources (polices et fonds ajoutés) ; les flux de contenu eux-mêmes restent partagés.
        const node = page.node.clone();
        const c = node.get(PDFName.of('Contents'));
        if (c) node.set(PDFName.of('Contents'), out.context.obj(c instanceof PDFArray ? c.asArray() : [c]));
        const res = node.get(PDFName.of('Resources'));
        if (res instanceof PDFDict) node.set(PDFName.of('Resources'), res.clone());
        // tableau /Annots propre à la copie (les annotations elles-mêmes restent partagées) : un champ ajouté ensuite sur une page n'apparaît pas sur l'autre
        const an = node.lookup(PDFName.of('Annots'));
        if (an instanceof PDFArray) node.set(PDFName.of('Annots'), out.context.obj(an.asArray()));
        page = PDFPage.of(node, out.context.register(node), out);
      }
      used.add(key);
      out.addPage(page);
      if (d.rot) page.setRotation(degrees((((page.getRotation().angle + d.rot) % 360) + 360) % 360));
      if (d.crop) page.setCropBox(d.crop[0], d.crop[1], d.crop[2] - d.crop[0], d.crop[3] - d.crop[1]);
    }
    // Signets du fichier ouvert : ils suivent les pages (première occurrence d'une page dupliquée) ; ceux des pages supprimées sont abandonnés.
    try {
      const tree = Outline.read(PDFLib, doc0);
      if (tree.length) {
        const outPages = out.getPages();
        const firstRef = new Map();
        spec.list.forEach((d, k) => { if (d.src === '0' && !firstRef.has(d.i)) firstRef.set(d.i, outPages[k].ref); });
        Outline.write(PDFLib, out, Outline.prune(tree, (i) => firstRef.get(i)), { pageMode: false });
      }
    } catch { /* signets illisibles : ignorés */ }
    return out;
  }

  // assets : { images: { [imgId]: { mime: 'image/png' | 'image/jpeg', bytes: Uint8Array } }, measure: { scales, unit, precision } }
  //   (images des objets 'image' ; contexte d'affichage des mesures 'm-*'), pages: { list, sources } (structure des pages, voir buildPages ; ignorée si elle est
  //   l'identité). Les modifications désignent les pages par leur indice DANS cette liste.
  async function applyEdits(PDFLib, bytes, edits, assets) {
    const { PDFDocument, rgb } = PDFLib;
    let doc = await PDFDocument.load(bytes, { password: (assets && assets.password) || undefined });
    const spec = assets && assets.pages;
    let rebuilt = false;
    if (spec && !PageOps.isIdentity(spec.list, doc.getPageCount())) { doc = await buildPages(PDFLib, doc, spec); rebuilt = true; }
    // Formulaire : valeurs saisies puis aplatissement éventuel (avant les annotations, qui restent au-dessus). Un document dont les pages ont été
    // reconstruites a perdu ses champs d'origine (limite connue) : rien à écrire.
    let formWarn = null;
    const created = edits.filter((e) => e.type === 'field');
    const createdNames = new Set(created.map((e) => e.name));
    if (assets && assets.form && !rebuilt) {
      formWarn = assets.warn || null;
      // valeurs des champs créés : écrites avec ces champs ; aplatissement après leur écriture
      const vals = {};
      for (const [k, v] of Object.entries(assets.form.values || {})) if (!createdNames.has(k)) vals[k] = v;
      Forms.apply(PDFLib, doc, created.length ? { values: vals, flatten: false } : assets.form, formWarn);
    }
    // Mesures : « inclure dans le PDF » désactivé → elles restent à l'écran mais ne sont pas écrites.
    if (assets && assets.measure && assets.measure.include === false) edits = edits.filter((e) => !/^m-/.test(e.type));
    const pages = doc.getPages();

    for (const e of edits) {
      if (!types[e.type]) throw new Error(`Type de modification inconnu : « ${e.type} »`);
    }
    const measure = Shapes.makeMeasure(PDFLib);
    const mctx = { measure: assets && assets.measure }; // échelle des pages pour les mesures (voir measure.js)
    // Polices standard nécessaires (intégrées une seule fois chacune) : celles des primitives de texte.
    const fonts = {};
    const images = {};
    for (const e of edits) {
      for (const p of Shapes.primitives(e, measure, mctx)) {
        if (p.kind === 'text' && !fonts[p.fontName]) fonts[p.fontName] = await doc.embedFont(p.fontName);
        // Une même image posée plusieurs fois n'est intégrée qu'une fois.
        if (p.kind === 'image' && !images[p.imgId]) {
          const a = assets && assets.images && assets.images[p.imgId];
          if (!a) throw new Error('Image introuvable dans le document : ' + p.imgId);
          images[p.imgId] = a.mime === 'image/png' ? await doc.embedPng(a.bytes) : await doc.embedJpg(a.bytes);
        }
      }
    }
    // Numérotation : étiquettes résolues par page de SORTIE (assets.numbering[i] = [{ text, rule }]), posées selon la géométrie réelle de la page
    // (zone visible, /Rotate) : texte droit dans l'orientation affichée. Dessinées après les objets.
    const numbering = (assets && assets.numbering) || [];
    const numPrims = [];
    numbering.forEach((items, i) => {
      if (!items || !items.length || !pages[i]) return;
      const pg = pages[i];
      const mb = pg.getMediaBox(), cb = pg.getCropBox();
      const box = [Math.max(cb.x, mb.x), Math.max(cb.y, mb.y), Math.min(cb.x + cb.width, mb.x + mb.width), Math.min(cb.y + cb.height, mb.y + mb.height)];
      numPrims.push([i, Numbering.primitives(items, { box, rot: pg.getRotation().angle, index: i }, measure)]);
    });
    for (const [, prims] of numPrims) for (const p of prims) if (!fonts[p.fontName]) fonts[p.fontName] = await doc.embedFont(p.fontName);
    const ctxFor = (e) => ({ doc, page: pages[e.page], fonts, images, measure, mctx, PDFLib, rgb });

    // 1re passe : fonds / recouvrements (ils ne masquent ainsi jamais un contenu ajouté).
    for (const e of edits) {
      if (pages[e.page] && types[e.type].cover) types[e.type].cover(ctxFor(e), e);
    }
    // 2e passe : contenu, dans l'ordre des objets (= ordre d'empilement).
    for (const e of edits) {
      if (pages[e.page] && types[e.type].draw) types[e.type].draw(ctxFor(e), e);
    }
    // Texte reconnu : assets.ocr[i] = enregistrement OCR de la page de SORTIE i (ou null).
    const ocrPages = (assets && assets.ocr) || [];
    if (ocrPages.some((r) => r && r.words && r.words.length)) {
      const ocrFont = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      ocrPages.forEach((rec, i) => { if (rec && rec.words && pages[i]) drawInvisibleText(PDFLib, pages[i], ocrFont, rec.words); });
    }
    for (const [i, prims] of numPrims) drawPrimitives({ doc, page: pages[i], fonts, images, measure, mctx, PDFLib, rgb }, prims);
    // Informations du document (titre, auteur, sujet, mots-clés) : une valeur vide retire l'entrée.
    const info = assets && assets.info;
    if (info) {
      const dict = doc.getInfoDict();
      for (const [k, v] of [['Title', info.title], ['Author', info.author], ['Subject', info.subject], ['Keywords', info.keywords]]) {
        if (v === undefined || v === null) continue;
        if (String(v).trim() === '') dict.delete(PDFLib.PDFName.of(k)); else dict.set(PDFLib.PDFName.of(k), PDFLib.PDFHexString.fromText(String(v)));
      }
    }
    // Caviardage et métadonnées : clean = { title, author, subject, keywords, creator, producer, dates, xmp } (cases cochées) ; scrub = le document
    // contient des pages caviardées (rastérisées) : ressources orphelines, références vers les anciennes pages et objets inaccessibles supprimés.
    if (assets && assets.clean) RedactPdf.cleanMeta(PDFLib, doc, assets.clean);
    if (assets && assets.scrub) { const st = await RedactPdf.scrub(PDFLib, doc); if (assets.onScrub) assets.onScrub(st); }
    else if (assets && assets.clean) { await doc.flush(); RedactPdf.collect(PDFLib, doc, { cut: false }); }
    // Champs de formulaire créés : vrais champs AcroForm, écrits APRÈS le nettoyage du caviardage (qui retire le formulaire d'origine des pages
    // conservées) ; ils suivent la reconstruction des pages. Aplatissement éventuel après leur écriture.
    if (created.length) {
      if (rebuilt) FieldsPdf.freezeOrphans(PDFLib, doc);
      await FieldsPdf.write(PDFLib, doc, created, assets && assets.form ? assets.form.values : null, (assets && assets.warn) || null);
      if (assets && assets.form && assets.form.flatten) doc.getForm().flatten();
    }
    // Protection par mot de passe (chiffrement du fichier enregistré) : { userPassword, ownerPassword?, permissions? }.
    const enc = assets && assets.encrypt;
    if (enc && enc.userPassword) doc.encrypt({ userPassword: enc.userPassword, ownerPassword: enc.ownerPassword || enc.userPassword, permissions: enc.permissions || { printing: true, copying: true } });
    const saveOpts = { useObjectStreams: !(assets && assets.useObjectStreams === false) };
    try { return await doc.save(saveOpts); } catch (err) {
      // Apparences de champs impossibles à régénérer (police d'origine non WinAnsi…) : on laisse le lecteur les recalculer (NeedAppearances).
      if (!(assets && assets.form) || rebuilt || !doc.catalog.lookup(PDFLib.PDFName.of('AcroForm'))) throw err;
      doc.catalog.lookup(PDFLib.PDFName.of('AcroForm')).set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.True);
      if (formWarn) formWarn('Certaines apparences de champs n\'ont pas pu être régénérées : le lecteur PDF les recalculera à l\'ouverture.');
      return doc.save(Object.assign({ updateFieldAppearances: false }, saveOpts));
    }
  }

  // Rectangle de recouvrement pour un « replace » (spécification du projet).
  function coverFor(x, y, itemWidth, size) {
    return { x, y: y - 0.25 * size, w: itemWidth + 1, h: 1.15 * size };
  }

  return { applyEdits, registerType, sanitizeWinAnsi, coverFor, drawPrimitives };
});
