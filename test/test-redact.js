// Caviardage (logique, sans interface) : PDF piège (secret en texte vectoriel 3 polices, XObject de formulaire, image, annotation, champ de formulaire,
// texte OCR, objet de l'application, métadonnées, XMP, ressources partagées avec une page publique, lien vers la page caviardée).
// Témoin positif : le fichier d'origine DOIT être détecté par chaque méthode de recherche. Après application et enregistrement :
//  (a) l'extraction de texte pdf.js ne contient pas le secret ; (b) les octets du fichier (bruts, flux décompressés, UTF-16, hexadécimal) non plus ;
//  (c) la page sans zone est identique (texte natif, rendu pixel à pixel) ; (d) les blocs sont peints, le reste de la page est intact ; (e) métadonnées
//  nettoyées. Plus : recherche (texte, e-mail, téléphone, IBAN), annulation / rétablissement, page pivotée + recadrée, mesure sur un A0.
// Usage : node test/test-redact.js   (REDACT_BENCH=0 : sans la mesure A0)
const PDFLib = require('@cantoo/pdf-lib');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const Shapes = require('../src/shapes.js');
const DocModel = require('../src/doc-model.js');
const PageOps = require('../src/page-ops.js');
const PdfEdit = require('../src/pdf-edit.js');
const TextInfo = require('../src/text-info.js');
const Redact = require('../src/redact.js');
const RedactApply = require('../src/redact-apply.js');
const RedactPdf = require('../src/redact-pdf.js');
const { makeRedactPdf, SECRET, PUBLIC1, PUBLIC2, ZONE, IMG_W } = require('./lib/make-redact-pdf.js');
const { scan } = require('./lib/secret-scan.js');

const measure = Shapes.makeMeasure(PDFLib);
const failures = [];
let passed = 0;
const check = (name, cond, detail) => { if (cond) { passed++; console.log('  ok   ', name); } else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail).slice(0, 400) : ''); } };
const FONTS = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const load = (bytes) => pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, standardFontDataUrl: FONTS, isEvalSupported: false }).promise;
  const deps = { PDFLib, measure, loadPdf: (b) => load(b.slice ? b.slice() : b), createCanvas: (w, h) => { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; }, renderCanvasFactory: 'auto' };
  const allText = async (bytes) => { const pdf = await load(bytes); const out = []; for (let i = 1; i <= pdf.numPages; i++) out.push((await (await pdf.getPage(i)).getTextContent()).items.map((t) => t.str).join(' ')); await pdf.destroy(); return out; };
  const render = async (bytes, n, scale) => {
    const pdf = await load(bytes);
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale });
    const cc = pdf.canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height));
    await page.render({ canvasContext: cc.context, viewport: vp, canvasFactory: pdf.canvasFactory, background: 'rgb(255,255,255)' }).promise;
    const img = cc.context.getImageData(0, 0, cc.canvas.width, cc.canvas.height);
    const at = (x, y) => { const q = vp.convertToViewportPoint(x, y); const i = (Math.round(q[1]) * img.width + Math.round(q[0])) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
    const res = { img, at, vp, page, pdf };
    return res;
  };
  const exportDoc = (doc) => PdfEdit.applyEdits(PDFLib, doc.bytes.slice(), doc.edits, {
    images: doc.assets.images, measure: doc.measure, pages: { list: doc.pages, sources: doc.sources }, numbering: [], ocr: doc.pages.map((p) => (doc.ocr && doc.ocr[p.u]) || null),
    info: doc.info, clean: doc.clean, scrub: Redact.hasRedacted(doc.pages), onScrub: (s) => { doc.lastScrub = s; },
  });
  const newDoc = async (bytes) => {
    const doc = DocModel.createDoc({ bytes, name: 'piege.pdf' });
    const pdf = await load(bytes);
    const id = PageOps.identity(pdf.numPages);
    await pdf.destroy();
    DocModel.initPages(doc, id.pages, id.nextUid);
    return doc;
  };
  const dark = (c) => c[0] < 60 && c[1] < 60 && c[2] < 60;
  const white = (c) => c.every((v) => v > 235);

  const orig = await makeRedactPdf();

  console.log('1. Témoin positif : le fichier d\'origine contient le secret, détecté par chaque méthode');
  const t0 = await allText(orig);
  check('pdf.js extrait le secret de la page 1 (texte, formulaire)', (t0[0].match(new RegExp(SECRET, 'g')) || []).length >= 4, t0[0]);
  const s0 = scan(orig, SECRET);
  check('octets : secret trouvé en clair après décompression des flux d\'objets', s0.hits.some((h) => h.startsWith('flux') && h.endsWith('latin1')), s0.hits);
  check('octets : secret trouvé en hexadécimal (contenu des pages)', s0.hits.some((h) => /:hex|:HEX/.test(h) && !/utf16/.test(h)), s0.hits);
  check('octets : secret trouvé en UTF-16 (annotation, métadonnées)', s0.hits.some((h) => /utf16/.test(h)), s0.hits);
  const pd0 = await PDFLib.PDFDocument.load(orig);
  check('métadonnées d\'origine : titre et créateur contiennent le secret', (pd0.getTitle() || '').includes(SECRET) && (pd0.getCreator() || '').includes(SECRET));

  console.log('2. Recherche et marquage (texte natif, modèles)');
  const pdfA = await load(orig);
  const items1 = TextInfo.itemsFromContent(await (await pdfA.getPage(1)).getTextContent());
  const items2 = TextInfo.itemsFromContent(await (await pdfA.getPage(2)).getTextContent());
  await pdfA.destroy();
  const found = Redact.find(items1, { query: SECRET.toLowerCase() });
  check('recherche sans casse : au moins 4 occurrences sur la page 1 (3 polices + formulaire)', found.length >= 4, found.length);
  const rects = found.flatMap((m) => Redact.matchRects(items1, m, measure));
  check('chaque occurrence a un rectangle dans la zone attendue', rects.length >= 4 && rects.every((r) => r[0] >= ZONE[0] - 2 && r[2] <= ZONE[2] + 2 && r[1] >= ZONE[1] - 2 && r[3] <= ZONE[3] + 2), rects);
  const hItem = items1.find((i) => i.str.includes('Nom : '));
  const r0 = Redact.matchRects(items1, found.find((m) => m.parts.some((p) => items1[p.idx] === hItem)), measure)[0];
  check('rectangle d\'une occurrence : commence après « Nom », hauteur ≥ corps', r0 && r0[0] > hItem.x + 20 && r0[3] - r0[1] >= 16 && r0[2] <= hItem.x + hItem.w + 3, [r0, hItem.x, hItem.w]);
  check('page 2 : aucune occurrence', Redact.find(items2, { query: SECRET }).length === 0);

  console.log('2b. Zones issues de la recherche SEULE : chaque pixel de chaque glyphe secret est peint (boîtes exactes des polices standard)');
  // Boîtes réelles du secret (métriques exactes) : [police, préfixe, corps, x, y]. Le préfixe a des lettres étroites (« Formulaire ») ou larges :
  // une estimation proportionnelle au nombre de caractères laissait dépasser la 1re lettre.
  const TRUE = [['Helvetica', 'Nom : ', 16, 72, 760], ['Times-Roman', 'Contrat ', 16, 72, 725], ['Courier', 'Ref ', 14, 72, 690], ['Helvetica', 'Formulaire ', 14, 77, 632]];
  const dS = await newDoc(orig);
  DocModel.addEdits(dS, found.flatMap((m) => Redact.matchRects(items1, m, measure).map((r) => Redact.zoneFromRect(0, r))));
  const resS = await RedactApply.apply(dS, deps, { dpi: 150 });
  RedactApply.commit(DocModel, dS, resS);
  const rS = await render(await exportDoc(dS), 1, 3);
  const leaks = [];
  for (const [font, pre, size, x, y] of TRUE) {
    const x0 = x + measure(font, pre, size), x1 = x0 + measure(font, SECRET, size);
    const box = [x0 + 0.2, y - 0.12 * size, x1 - 0.2, y + 0.74 * size]; // de la queue du Q au haut des capitales
    let bad = 0, n = 0;
    for (let px = box[0]; px <= box[2]; px += 0.25) for (let py = box[1]; py <= box[3]; py += 0.25) { n++; if (!dark(rS.at(px, py))) bad++; }
    if (bad) leaks.push({ font, pre, bad, n });
  }
  check('aucun pixel non peint dans la boîte réelle du secret (Helvetica, Times, Courier, formulaire)', leaks.length === 0, leaks);
  let inkNom = 0, whiteNom = 0;
  for (let px = 72; px <= 72 + measure('Helvetica', 'Nom', 16); px += 0.25) for (let py = 760; py <= 771; py += 0.25) { const c = rS.at(px, py); if (dark(c)) inkNom++; else if (white(c)) whiteNom++; }
  check('le mot voisin (« Nom ») reste lisible : encre ET fond blanc dans sa boîte (le bloc ne le recouvre pas)', inkNom > 50 && whiteNom > inkNom, [inkNom, whiteNom]);
  const mk = (strs) => strs.map((s, i) => ({ str: s, hasEOL: true, x: 10, y: 700 - i * 20, w: s.length * 6, size: 12, ang: 0, upright: true }));
  const pat = mk(['Écrire à jean.dupont@exemple.fr ou à contact@entreprise-exemple.fr', 'Tél. 06 12 34 56 78, +33 1 23 45 67 89, 01.23.45.67.89', 'IBAN FR76 3000 6000 0112 3456 7890 189 ; faux : FR76 3000 6000 0112 3456 7890 188', 'Montant 1234567890 € (pas un téléphone : 12345)']);
  const em = Redact.find(pat, { kind: 'email' }).map((m) => m.hit), ph = Redact.find(pat, { kind: 'phone' }).map((m) => m.hit), ib = Redact.find(pat, { kind: 'iban' }).map((m) => m.hit);
  check('modèle e-mail : 2 adresses', em.length === 2 && em[0] === 'jean.dupont@exemple.fr' && em[1] === 'contact@entreprise-exemple.fr', em);
  check('modèle téléphone : 3 numéros (06…, +33 1…, 01.23…), pas les montants', ph.length === 3 && ph[0] === '06 12 34 56 78' && ph[1].startsWith('+33 1') && ph[2] === '01.23.45.67.89', ph);
  check('modèle IBAN : le bon (clé valide) seulement', ib.length === 1 && ib[0] === 'FR76 3000 6000 0112 3456 7890 189', ib);
  check('IBAN : contrôle de clé', Redact.ibanValid('FR7630006000011234567890189') && !Redact.ibanValid('FR7630006000011234567890188') && Redact.ibanValid('DE89 3704 0044 0532 0130 00'));

  console.log('3. Application sur le PDF piège (zone + objets de l\'application + OCR + métadonnées)');
  const doc = await newDoc(orig);
  DocModel.addEdit(doc, Redact.zoneFromRect(0, ZONE));
  DocModel.addEdit(doc, Object.assign(Shapes.defaultsFor('add'), { type: 'add', page: 0, x: 250, y: 650, text: 'Note ' + SECRET, size: 12, font: 'Helvetica' })); // dans la zone
  DocModel.addEdit(doc, Object.assign(Shapes.defaultsFor('add'), { type: 'add', page: 0, x: 72, y: 120, text: 'VISA PUBLIC', size: 20, font: 'Helvetica', color: [0, 0, 0] })); // hors zone : intégré à l'image
  DocModel.addEdit(doc, Object.assign(Shapes.defaultsFor('add'), { type: 'add', page: 1, x: 72, y: 300, text: 'Annotation page 2', size: 12, font: 'Helvetica' })); // autre page : reste un objet
  DocModel.setOcr(doc, { p1: { words: [{ t: SECRET, x0: 72, y0: 755, x1: 200, y1: 772, c: 95, a: 0 }, { t: 'public', x0: 72, y0: 195, x1: 120, y1: 210, c: 95, a: 0 }], n: 2, conf: 95, lang: 'fra', quality: 'standard', mode: 'text', dpi: 300 } });
  DocModel.commit(doc, (d) => { d.clean = { title: true, author: true, subject: true, keywords: true, creator: true, producer: true, dates: true, xmp: true }; });
  const before = JSON.stringify({ pages: doc.pages, edits: doc.edits, ocr: Object.keys(doc.ocr) });
  const plan = Redact.plan(doc.pages, doc.edits, measure);
  check('plan : une page (la 1re), 1 zone, 2 objets de l\'application intégrés dont 1 touche la zone', plan.length === 1 && plan[0].index === 0 && plan[0].zones.length === 1 && plan[0].burn.length === 2 && plan[0].touching === 1, plan);
  const t1 = Date.now();
  const res = await RedactApply.apply(doc, deps, { dpi: 150, color: [0, 0, 0], label: 'CAVIARDÉ' });
  check('application : une page image (rd1), en niveaux de gris, 150 dpi', res && res.report.length === 1 && res.pages[0].src === 'rd1' && res.report[0].gray === true && res.report[0].dpi === 150, res && res.report);
  check('rien n\'est modifié avant commit (le document est intact)', JSON.stringify({ pages: doc.pages, edits: doc.edits, ocr: Object.keys(doc.ocr) }) === before);
  const undoDepth = doc.undo.length;
  RedactApply.commit(DocModel, doc, res);
  check('commit : UNE étape d\'historique ; zone et objets de la page 1 retirés, objet de la page 2 conservé ; OCR de la page 1 retiré', doc.undo.length === undoDepth + 1 && doc.edits.length === 1 && doc.edits[0].page === 1 && !doc.ocr.p1 && doc.pages[0].u === 'p1', { e: doc.edits, ocr: Object.keys(doc.ocr) });
  const out = await exportDoc(doc);
  console.log(`        (application + enregistrement : ${Date.now() - t1} ms ; ${(orig.length / 1024).toFixed(1)} Ko → ${(out.length / 1024).toFixed(1)} Ko)`);
  console.log('        nettoyage :', JSON.stringify(doc.lastScrub));

  console.log('4. (a) extraction de texte, (b) octets du fichier');
  const t2 = await allText(out);
  check('(a) pdf.js : le secret n\'apparaît dans le texte d\'aucune page', !t2.some((t) => t.toUpperCase().includes(SECRET)), t2);
  check('(a) page 1 caviardée : plus aucun texte extractible (image seule), y compris le texte OCR', t2[0].trim() === '', t2[0]);
  const s2 = scan(out, SECRET);
  check('(b) octets : secret introuvable (brut, flux décompressés, UTF-16, hexadécimal)', s2.hits.length === 0 && s2.inflated >= 3, s2);
  for (const part of ['QXSECRET', 'SECRET42']) check(`(b) octets : fragment « ${part} » introuvable aussi`, scan(out, part).hits.length === 0, scan(out, part).hits);
  const pdOut = await PDFLib.PDFDocument.load(out, { updateMetadata: false }); // sinon pdf-lib réécrit Producteur / Créateur / dates à la lecture
  const objs = pdOut.context.enumerateIndirectObjects();
  const imgs = objs.filter(([, o]) => o.dict && o.dict.get(PDFLib.PDFName.of('Subtype')) === PDFLib.PDFName.of('Image'));
  check('(b) l\'image secrète (largeur ' + IMG_W + ' px) n\'est plus dans le fichier ; une seule image (la page caviardée)', imgs.length === 1 && !imgs.some(([, o]) => o.dict.get(PDFLib.PDFName.of('Width')).asNumber() === IMG_W), imgs.map(([, o]) => o.dict.get(PDFLib.PDFName.of('Width')).asNumber()));
  const forms = objs.filter(([, o]) => o.dict && o.dict.get(PDFLib.PDFName.of('Subtype')) === PDFLib.PDFName.of('Form'));
  check('(b) aucun XObject de formulaire (celui du secret était dans les ressources partagées de la page 2)', forms.length === 0, forms.length);
  const annTypes = objs.filter(([, o]) => o instanceof PDFLib.PDFDict && o.get(PDFLib.PDFName.of('Subtype')) && o.has(PDFLib.PDFName.of('Rect'))).map(([, o]) => o.get(PDFLib.PDFName.of('Subtype')).decodeText());
  check('(b) annotations : plus de note ni de widget de champ ; le lien de la page 2 ne pointe plus vers l\'ancienne page', !annTypes.includes('Text') && !annTypes.includes('Widget'), annTypes);
  check('(b) aucun formulaire (AcroForm) ni arbre de pages orphelin', !pdOut.catalog.has(PDFLib.PDFName.of('AcroForm')) && objs.filter(([, o]) => o instanceof PDFLib.PDFDict && o.get(PDFLib.PDFName.of('Type')) === PDFLib.PDFName.of('Page')).length === 2);

  console.log('5. (c) page sans zone intacte, (d) rendu de la page caviardée, (e) métadonnées');
  check('(c) page 2 : texte natif conservé à l\'identique', t2[1].includes(PUBLIC2) && (await allText(orig))[1].trim() === t2[1].replace('Annotation page 2', '').trim(), [t2[1]]);
  const o2 = await render(orig, 2, 1), n2 = await render(out, 2, 1);
  let diff = 0;
  for (let i = 0; i < o2.img.data.length; i += 4) {
    const [x, y] = [(i / 4) % o2.img.width, Math.floor(i / 4 / o2.img.width)];
    const inEdit = y > 842 - 316 && y < 842 - 296 && x > 70 && x < 190; // objet « Annotation page 2 » ajouté
    if (!inEdit && Math.abs(o2.img.data[i] - n2.img.data[i]) > 8) diff++;
  }
  check('(c) page 2 : rendu identique pixel à pixel (hors objet ajouté sur cette page)', diff === 0, diff);
  const r1 = await render(out, 1, 2);
  const zc = [(ZONE[0] + ZONE[2]) / 2, (ZONE[1] + ZONE[3]) / 2];
  const pts = [[ZONE[0] + 3, ZONE[1] + 3], [ZONE[2] - 3, ZONE[3] - 3], zc, [100, 765], [300, 470]];
  check('(d) la zone est peinte en noir (coins, centre, lignes de texte, champ)', pts.every((p) => dark(r1.at(p[0], p[1])) || (p === zc)), pts.map((p) => r1.at(p[0], p[1])));
  const lab = []; for (let x = ZONE[0] + 5; x < ZONE[2] - 5; x += 2) lab.push(r1.at(x, zc[1]));
  check('(d) libellé « CAVIARDÉ » en blanc au centre du bloc', lab.some(white) && lab.filter(dark).length > lab.length / 3);
  check('(d) hors zone : page blanche, mention publique et objet de l\'application intégrés à l\'image', white(r1.at(500, 300)) && white(r1.at(300, 830)) && [...Array(40)].some((_, k) => dark(r1.at(74 + k * 2, 204))) && [...Array(40)].some((_, k) => dark(r1.at(74 + k * 3, 126))));
  const p1o = (await load(out).then((p) => p.getPage(1)));
  check('(d) la page caviardée garde son format (A4) et sa zone visible', Math.abs(p1o.view[2] - 595) < 0.01 && Math.abs(p1o.view[3] - 842) < 0.01, p1o.view);
  check('(e) titre, auteur, sujet, mots-clés, créateur, producteur, dates : retirés', ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate'].every((k) => !pdOut.getInfoDict().has(PDFLib.PDFName.of(k))), pdOut.getInfoDict().keys().map((k) => k.decodeText()));
  check('(e) XMP retiré', !pdOut.catalog.has(PDFLib.PDFName.of('Metadata')));

  console.log('6. Historique : Annuler / Rétablir');
  DocModel.undo(doc);
  check('Annuler : page d\'origine, zone, objets et OCR rétablis', doc.pages[0].src === '0' && doc.edits.some((e) => e.type === 'redact') && doc.edits.length === 4 && !!doc.ocr.p1);
  const outU = await exportDoc(doc);
  check('après Annuler, l\'enregistrement est le document normal (secret présent, rien de caviardé, zone non écrite)', (await allText(outU))[0].includes(SECRET) && !(await allText(outU))[0].includes('caviarder'));
  DocModel.redo(doc);
  check('Rétablir : page caviardée de nouveau', doc.pages[0].src === 'rd1' && !doc.ocr.p1);

  console.log('7. Zone non appliquée : jamais écrite, le texte reste (avertissement à l\'enregistrement)');
  const d3 = await newDoc(orig);
  DocModel.addEdit(d3, Redact.zoneFromRect(0, ZONE));
  const o3 = await PdfEdit.applyEdits(PDFLib, d3.bytes.slice(), d3.edits, { pages: { list: d3.pages, sources: d3.sources } });
  check('zone seule : le PDF écrit est le document d\'origine (pas de hachures, texte présent)', (await allText(o3))[0].includes(SECRET) && !Redact.hasRedacted(d3.pages));

  console.log('8. Page pivotée et recadrée par l\'onglet Pages, puis zone et application');
  const d4 = await newDoc(orig);
  let st = PageOps.rotate(DocModel.pageState(d4), [0], 90);
  st = PageOps.crop(st, [0], [40, 400, 560, 820]);
  DocModel.setPagesState(d4, st);
  st = PageOps.move(DocModel.pageState(d4), [1], 0); // la page caviardée devient la 2e : la zone suit
  DocModel.setPagesState(d4, st);
  DocModel.addEdit(d4, Redact.zoneFromRect(1, [70, 680, 330, 780]));
  const res4 = await RedactApply.apply(d4, deps, { dpi: 100 });
  RedactApply.commit(DocModel, d4, res4);
  check('la page caviardée garde sa rotation ajoutée, son recadrage et son rang', d4.pages[1].src.startsWith('rd') && d4.pages[1].rot === 90 && d4.pages[1].crop.join() === '40,400,560,820' && d4.pages[0].src === '0');
  const out4 = await exportDoc(d4);
  const r4 = await render(out4, 2, 1.5);
  check('rendu : page tournée (paysage) et recadrée', Math.round(r4.vp.width / 1.5) === 420 && Math.round(r4.vp.height / 1.5) === 520, [r4.vp.width / 1.5, r4.vp.height / 1.5]);
  check('rendu : bloc peint à l\'endroit de la zone malgré la rotation, texte hors zone intact', dark(r4.at(200, 760)) && dark(r4.at(320, 700)) && !dark(r4.at(380, 760)), [r4.at(200, 760), r4.at(380, 760)]);
  check('le secret visible dans la zone est introuvable ; la page 1 (publique) garde son texte', !(await allText(out4)).some((t) => t.includes('Nom : ' + SECRET)) && (await allText(out4))[0].includes(PUBLIC2));

  console.log('9. Réapplication sur une page déjà caviardée, et page vierge');
  const d5 = await newDoc(out);
  DocModel.addEdit(d5, Redact.zoneFromRect(0, [60, 150, 300, 230]));
  const res5 = await RedactApply.apply(d5, deps, { dpi: 100, color: [0.8, 0.1, 0.1] });
  RedactApply.commit(DocModel, d5, res5);
  const r5 = await render(await exportDoc(d5), 1, 1);
  const c5 = r5.at(180, 205);
  check('bloc de couleur réglable (rouge) sur une page déjà caviardée', c5[0] > 150 && c5[1] < 90 && c5[2] < 90 && res5.report[0].gray === false, c5);

  if (process.env.REDACT_BENCH !== '0') {
    console.log('10. Mesure : plan A0 vectoriel (2384 × 3370 pt), 300 dpi demandés');
    const a0 = await PDFLib.PDFDocument.create();
    const pg = a0.addPage([2384, 3370]);
    const f = await a0.embedFont(PDFLib.StandardFonts.Helvetica);
    for (let k = 0; k < 2000; k++) pg.drawLine({ start: { x: (k * 37) % 2384, y: (k * 53) % 3370 }, end: { x: (k * 91) % 2384, y: (k * 17) % 3370 }, thickness: 0.5 });
    for (let k = 0; k < 300; k++) pg.drawText('Cote ' + k + ' ' + (k === 150 ? SECRET : ''), { x: 50 + (k % 20) * 115, y: 100 + Math.floor(k / 20) * 200, size: 9, font: f });
    a0.addPage([595, 842]).drawText('page 2', { x: 50, y: 50, size: 12, font: f });
    const a0b = await a0.save();
    const dA = await newDoc(a0b);
    const sp = 50 + (150 % 20) * 115, sy = 100 + Math.floor(150 / 20) * 200;
    DocModel.addEdit(dA, Redact.zoneFromRect(0, [sp - 5, sy - 5, sp + 140, sy + 15]));
    const m0 = process.memoryUsage().rss;
    let peak = m0;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50);
    const ta = Date.now();
    const resA = await RedactApply.apply(dA, deps, { dpi: 300 });
    const tApply = Date.now() - ta;
    RedactApply.commit(DocModel, dA, resA);
    const outA = await exportDoc(dA);
    const tAll = Date.now() - ta;
    clearInterval(timer);
    const R = resA.report[0];
    console.log(`        A0 : ${R.width} × ${R.height} px à ${R.dpi} dpi (plafond 80 Mpx), ${R.gray ? 'gris' : 'couleur'} ; rastérisation ${tApply} ms, + enregistrement ${tAll - tApply} ms ; mémoire +${Math.round((peak - m0) / 1048576)} Mo en pointe ; fichier ${(a0b.length / 1024).toFixed(0)} Ko → ${(outA.length / 1024).toFixed(0)} Ko`);
    check('A0 : résolution réduite sous le plafond (≥ 200 dpi), en moins de 60 s', R.dpi >= 200 && R.dpi < 300 && R.width * R.height <= 80e6 && tAll < 60000, R);
    check('A0 : secret introuvable (texte et octets), page 2 intacte', !(await allText(outA)).some((t) => t.includes(SECRET)) && scan(outA, SECRET).hits.length === 0 && (await allText(outA))[1].includes('page 2'));
  }

  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : caviardage (logique et sécurité).');
  void RedactPdf;
})().catch((e) => { console.error(e); process.exit(1); });
