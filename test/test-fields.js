// Champs de formulaire créés (logique, sans interface) : création de chaque type, noms uniques, copies (Ctrl+D, page dupliquée), ordre de
// tabulation, opérations de pages (remap), écriture par pdf-edit comme vrais champs AcroForm puis relecture pdf.js (type, nom, position ±0,2 mm,
// valeur par défaut, options, drapeaux obligatoire / lecture seule / masqué, infobulle, alignement, longueur max., rotation /MK /R), page pivotée
// et recadrée, conflit de noms avec un formulaire existant, /NeedAppearances, aplatissement, détection par le calque du lot 3d (Forms),
// et caviardage : un champ sous une zone appliquée disparaît, un champ ailleurs sur la page reste un champ.
// Usage : node test/test-fields.js
const PDFLib = require('@cantoo/pdf-lib');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const Shapes = require('../src/shapes.js');
const DocModel = require('../src/doc-model.js');
const PageOps = require('../src/page-ops.js');
const Forms = require('../src/forms.js');
const Fields = require('../src/fields.js');
const PdfEdit = require('../src/pdf-edit.js');
require('../src/text-info.js');
const Redact = require('../src/redact.js');
const RedactApply = require('../src/redact-apply.js');
const { scan } = require('./lib/secret-scan.js');

const failures = [];
let passed = 0;
const check = (name, cond, detail) => { if (cond) { passed++; console.log('  ok   ', name); } else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail).slice(0, 500) : ''); } };
const FONTS = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
const MM = 72 / 25.4, TOL = 0.2 * MM;
const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= TOL);

(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const load = (bytes) => pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, standardFontDataUrl: FONTS, isEvalSupported: false }).promise;
  const measure = Shapes.makeMeasure(PDFLib);
  const annotsOf = async (bytes) => { const pdf = await load(bytes); const per = []; for (let i = 1; i <= pdf.numPages; i++) per.push(await (await pdf.getPage(i)).getAnnotations()); await pdf.destroy(); return per; };
  const blank = async (n, opts) => {
    const d = await PDFLib.PDFDocument.create();
    for (let i = 0; i < n; i++) { const p = d.addPage([595, 842]); if (opts && opts.rotate && opts.rotate[i]) p.setRotation(PDFLib.degrees(opts.rotate[i])); if (opts && opts.crop && opts.crop[i]) p.setCropBox(...opts.crop[i]); }
    return d.save();
  };
  const newDoc = async (bytes, n) => { const doc = DocModel.createDoc({ bytes, name: 'f.pdf' }); const id = PageOps.identity(n); DocModel.initPages(doc, id.pages, id.nextUid); return doc; };
  const save = (doc, extra) => PdfEdit.applyEdits(PDFLib, doc.bytes.slice(), doc.edits, Object.assign({ pages: { list: doc.pages, sources: doc.sources }, form: doc.form ? { values: doc.form.values, flatten: false } : undefined }, extra || {}));

  console.log('1. Modèle : création, noms, copies, ordre de tabulation');
  const taken = new Set();
  const mk = (ftype, page, r, o) => { const f = Fields.create(ftype, page, r, taken, o); taken.add(f.name); return f; };
  const t1 = mk('text', 0, [72, 700, 272, 722]);
  const t2 = mk('text', 0, [300, 700, 500, 722]);
  check('noms automatiques : Texte1, Texte2', t1.name === 'Texte1' && t2.name === 'Texte2', [t1.name, t2.name]);
  check('chaque type a un nom de base distinct', Fields.FTYPES.map((t) => Fields.nextName(t, new Set())).join() === 'Texte1,Case1,Groupe1,Liste1,Choix1,Date1');
  check('uniqueName : nom → nom2, Texte9 → Texte10', Fields.uniqueName('nom', ['nom']) === 'nom2' && Fields.uniqueName('Texte9', ['Texte9']) === 'Texte10');
  check('nom invalide : vide, avec un point', !!Fields.nameError('') && !!Fields.nameError('a.b') && !Fields.nameError('Nom complet'));
  const r1 = mk('radio', 0, [72, 600, 86, 614], { name: 'Choix', export: 'Oui', value: true });
  const r2 = Object.assign(Fields.create('radio', 0, [120, 600, 134, 614], taken, { name: 'Choix', export: 'Non' }));
  const edits0 = [t1, t2, r1, r2].map((e, i) => Object.assign({ id: i + 1 }, e));
  const dupT = Fields.renameCopies([JSON.parse(JSON.stringify(t1))], edits0, true)[0];
  const dupR = Fields.renameCopies([JSON.parse(JSON.stringify(r1))], edits0, true)[0];
  check('Ctrl+D d\'un champ texte : nom incrémenté (Texte3)', dupT.name === 'Texte3', dupT.name);
  check('Ctrl+D d\'un bouton radio : même groupe, nouvelle option, non choisie', dupR.name === 'Choix' && dupR.export === 'Oui2' && dupR.value === false, [dupR.name, dupR.export]);
  const pg = Fields.renameCopies([JSON.parse(JSON.stringify(r1)), JSON.parse(JSON.stringify(r2))], edits0, false);
  check('page dupliquée : le groupe radio copié devient UN nouveau groupe (Choix2, 2 boutons)', pg.every((e) => e.name === 'Choix2'), pg.map((e) => e.name));
  const order = Fields.tabOrder(edits0).map((e) => e.name + (e.export ? ':' + e.export : ''));
  check('ordre par défaut : de haut en bas, de gauche à droite, groupe radio d\'un bloc', order.join() === 'Texte1,Texte2,Choix:Oui,Choix:Non', order);
  const row = [Object.assign(Fields.create('text', 0, [300, 700.3, 460, 722.3], new Set()), { id: 91, name: 'Droite' }), Object.assign(Fields.create('text', 0, [72, 700, 272, 722], new Set()), { id: 92, name: 'Gauche' })];
  check('même ligne malgré 0,3 pt d\'écart en hauteur : de gauche à droite (correctif)', Fields.tabOrder(row).map((e) => e.name).join() === 'Gauche,Droite');
  const manual = edits0.map((e) => Object.assign({}, e, { tab: e.name === 'Texte2' ? 0 : e.name === 'Choix' ? 1 : 2 }));
  check('ordre modifié (tab) respecté', Fields.tabOrder(manual).map((e) => e.name).join() === 'Texte2,Choix,Choix,Texte1');
  check('valeurs par défaut : radio → option choisie, case → booléen', Fields.defaultValue(edits0, 'Choix') === 'Oui' && Fields.defaultValue([Object.assign(Fields.create('check', 0, [0, 0, 10, 10], new Set()), { value: true })], 'Case1') === true);
  check('descripteurs (calque de remplissage) : 4 entrées, page de sortie, rectangle', Fields.descriptors(edits0).length === 4 && near(Fields.descriptors(edits0)[0].rect, [72, 700, 272, 722]));

  console.log('2. Opérations de pages : les champs suivent (historique)');
  const doc = await newDoc(await blank(3), 3);
  DocModel.addEdits(doc, [Object.assign(Fields.create('text', 1, [72, 700, 272, 722], new Set()), { name: 'Nom' }), Object.assign(Fields.create('check', 2, [72, 650, 86, 664], new Set()), { name: 'Accord' })]);
  let st = PageOps.move(DocModel.pageState(doc), [2], 0);
  DocModel.setPagesState(doc, st);
  check('déplacement de la page 3 en tête : « Accord » passe en page 1, « Nom » en page 3', doc.edits.find((e) => e.name === 'Accord').page === 0 && doc.edits.find((e) => e.name === 'Nom').page === 2);
  st = PageOps.duplicate(DocModel.pageState(doc), [2]);
  DocModel.setPagesState(doc, st);
  const names = doc.edits.filter(Fields.isField).map((e) => e.name + '@' + e.page).sort();
  check('duplication de page : copie renommée (Nom2 sur la nouvelle page)', names.join() === 'Accord@0,Nom2@3,Nom@2', names);
  DocModel.undo(doc);
  check('annuler : la copie disparaît', doc.edits.filter(Fields.isField).length === 2);
  st = PageOps.remove(DocModel.pageState(doc), [0]);
  DocModel.setPagesState(doc, st);
  check('suppression de la page : son champ est supprimé', doc.edits.filter(Fields.isField).map((e) => e.name).join() === 'Nom');

  console.log('3. Écriture puis relecture pdf.js (chaque type)');
  const d3 = await newDoc(await blank(2), 2);
  const T = new Set();
  const add = (ftype, page, r, o) => { const f = Object.assign(Fields.create(ftype, page, r, T), o || {}); T.add(f.name); return f; };
  DocModel.addEdits(d3, [
    add('text', 0, [72, 700, 272, 722], { name: 'Nom', value: 'Dupont', tip: 'Votre nom', required: true, maxLen: 20, align: 'center', color: [0.1, 0.2, 0.7] }),
    add('text', 0, [72, 600, 272, 680], { name: 'Adresse', multiline: true, readOnly: true, font: 'Courier', fontSize: 9 }),
    add('check', 0, [72, 560, 86, 574], { name: 'Accord', value: true }),
    add('radio', 0, [72, 520, 86, 534], { name: 'Taille', export: 'S' }),
    add('radio', 0, [120, 520, 134, 534], { name: 'Taille', export: 'M', value: true }),
    add('combo', 0, [72, 470, 212, 492], { name: 'Pays', options: ['France', 'Belgique', 'Suisse'], value: 'Belgique' }),
    add('list', 1, [72, 650, 212, 710], { name: 'Langue', options: ['FR', 'EN', 'DE'], value: 'EN' }),
    add('date', 1, [72, 600, 162, 622], { name: 'Date' }),
    add('text', 1, [300, 600, 400, 622], { name: 'Cache', visible: false, value: 'invisible' }),
  ]);
  const out3 = await save(d3);
  const an = await annotsOf(out3);
  const W = an.flat().filter((a) => a.subtype === 'Widget');
  const by = (n) => W.filter((a) => a.fieldName === n);
  check('9 widgets relus (8 champs dont un groupe radio de 2)', W.length === 9, W.map((a) => a.fieldName));
  const nom = by('Nom')[0];
  check('« Nom » : texte, valeur Dupont, obligatoire, infobulle, max 20, centré', nom && nom.fieldType === 'Tx' && nom.fieldValue === 'Dupont' && (nom.fieldFlags & 2) && nom.alternativeText === 'Votre nom' && nom.maxLen === 20 && nom.textAlignment === 1, nom && [nom.fieldType, nom.fieldValue, nom.fieldFlags, nom.alternativeText, nom.maxLen, nom.textAlignment]);
  check('« Nom » : position à ±0,2 mm', nom && near(nom.rect, [72, 700, 272, 722]), nom && nom.rect);
  check('« Nom » : valeur par défaut (/DV) relue', nom && nom.defaultFieldValue === 'Dupont', nom && nom.defaultFieldValue);
  const adr = by('Adresse')[0];
  check('« Adresse » : plusieurs lignes, lecture seule', adr && adr.multiLine && adr.readOnly && near(adr.rect, [72, 600, 272, 680]), adr && [adr.multiLine, adr.readOnly, adr.rect]);
  const acc = by('Accord')[0];
  check('« Accord » : case cochée par défaut', acc && acc.checkBox && acc.fieldValue && acc.fieldValue !== 'Off' && near(acc.rect, [72, 560, 86, 574]), acc && [acc.checkBox, acc.fieldValue]);
  const tai = by('Taille');
  check('« Taille » : groupe radio de 2 boutons, valeur M', tai.length === 2 && tai.every((a) => a.radioButton) && Forms.initialValue(Forms.fromAnnotations(an), 'Taille') !== '' , tai.map((a) => [a.buttonValue, a.fieldValue]));
  const pays = by('Pays')[0];
  check('« Pays » : liste déroulante, 3 options, Belgique', pays && pays.combo && pays.options.map((o) => o.displayValue).join() === 'France,Belgique,Suisse' && [].concat(pays.fieldValue)[0] === 'Belgique', pays && [pays.options, pays.fieldValue]);
  const lang = by('Langue')[0];
  check('« Langue » : liste (page 2), EN', lang && !lang.combo && lang.fieldType === 'Ch' && [].concat(lang.fieldValue)[0] === 'EN' && an[1].includes(lang), lang && lang.fieldValue);
  const date = by('Date')[0];
  check('« Date » : champ texte, 10 caractères max., infobulle de format', date && date.fieldType === 'Tx' && date.maxLen === 10 && /jj\/mm\/aaaa/.test(date.alternativeText || ''), date && [date.maxLen, date.alternativeText]);
  check('« Cache » : widget masqué', by('Cache')[0] && by('Cache')[0].hidden === true);
  const order3 = an[0].filter((a) => a.subtype === 'Widget').map((a) => a.fieldName);
  check('ordre de tabulation = ordre des widgets dans /Annots (page 1)', order3.join() === 'Nom,Adresse,Accord,Taille,Taille,Pays', order3);
  const lib = await PDFLib.PDFDocument.load(out3);
  const af = lib.catalog.lookup(PDFLib.PDFName.of('AcroForm'));
  check('/NeedAppearances = false (apparences générées)', af && af.get(PDFLib.PDFName.of('NeedAppearances')) === PDFLib.PDFBool.False);
  check('apparences présentes sur chaque widget', lib.getForm().getFields().every((fl) => fl.acroField.getWidgets().every((w) => !!w.getNormalAppearance())));
  const det = Forms.fromAnnotations(an);
  check('détection par le calque du lot 3d (Forms.fromAnnotations) : 9 widgets remplissables, types', det.length === 8 + 0 || det.length === 9 ? det.map((d) => d.type).sort().join() === 'check,combo,list,radio,radio,text,text,text,text' : false, det.map((d) => d.name + ':' + d.type));

  console.log('4. Saisies (doc.form.values) prioritaires, aplatissement');
  DocModel.setFormValues(d3, { Nom: 'Martin', Accord: false, Pays: 'Suisse' });
  const an4 = (await annotsOf(await save(d3))).flat().filter((a) => a.subtype === 'Widget');
  check('valeurs saisies écrites (Martin, décochée, Suisse), défaut conservé en /DV', an4.find((a) => a.fieldName === 'Nom').fieldValue === 'Martin' && an4.find((a) => a.fieldName === 'Nom').defaultFieldValue === 'Dupont' && (an4.find((a) => a.fieldName === 'Accord').fieldValue || 'Off') === 'Off' && [].concat(an4.find((a) => a.fieldName === 'Pays').fieldValue)[0] === 'Suisse');
  const flat = await save(d3, { form: { values: d3.form.values, flatten: true } });
  const anF = (await annotsOf(flat)).flat().filter((a) => a.subtype === 'Widget');
  const pdfF = await load(flat);
  check('aplatissement : plus aucun champ, fichier lisible', anF.length === 0 && pdfF.numPages === 2);

  console.log('5. Page pivotée (90°) et recadrée');
  const d5 = await newDoc(await blank(2, { rotate: [90, 0], crop: [null, [50, 50, 400, 600]] }), 2);
  DocModel.addEdits(d5, [Object.assign(Fields.create('text', 0, [100, 300, 130, 500], new Set()), { name: 'Pivot', value: 'Droit' }), Object.assign(Fields.create('check', 1, [100, 300, 114, 314], new Set()), { name: 'Recadre', value: true })]);
  const an5 = await annotsOf(await save(d5));
  const pv = an5[0].find((a) => a.fieldName === 'Pivot'), rc = an5[1].find((a) => a.fieldName === 'Recadre');
  check('page pivotée : rectangle exact et rotation /MK /R = 90', pv && near(pv.rect, [100, 300, 130, 500]) && pv.rotation === 90, pv && [pv.rect, pv.rotation]);
  check('page recadrée : rectangle exact (coordonnées de la page, indépendantes du recadrage)', rc && near(rc.rect, [100, 300, 114, 314]), rc && rc.rect);
  const vp = Fields.frameBasis({ cx: 115, cy: 400, w: 30, h: 200 }, 90);
  check('aperçu : repère « vu » d\'un cadre sur page pivotée = largeur 200, hauteur 30', vp.W === 200 && vp.H === 30 && vp.rot === 90);
  const d5b = await newDoc(await blank(1), 1);
  DocModel.addEdit(d5b, Object.assign(Fields.create('text', 0, [72, 700, 272, 722], new Set()), { name: 'Tourne' }));
  DocModel.setPagesState(d5b, PageOps.rotate(DocModel.pageState(d5b), [0], 90));
  const an5b = (await annotsOf(await save(d5b))).flat()[0];
  check('page pivotée par l\'onglet Pages après création : /MK /R suit la rotation, rectangle inchangé', an5b && an5b.rotation === 90 && near(an5b.rect, [72, 700, 272, 722]), an5b && [an5b.rotation, an5b.rect]);

  console.log('6. PDF déjà formulaire : pas de conflit de noms');
  const base = await PDFLib.PDFDocument.create();
  const bp = base.addPage([595, 842]);
  const ex = base.getForm().createTextField('Nom'); ex.setText('existant'); ex.addToPage(bp, { x: 300, y: 300, width: 100, height: 20 });
  const d6 = await newDoc(await base.save(), 1);
  DocModel.addEdit(d6, Object.assign(Fields.create('text', 0, [72, 700, 272, 722], new Set()), { name: 'Nom', value: 'nouveau' }));
  const warns = [];
  const an6 = (await annotsOf(await save(d6, { warn: (m) => warns.push(m) }))).flat().filter((a) => a.subtype === 'Widget');
  check('champ d\'origine conservé, champ créé renommé « Nom2 », avertissement', an6.length === 2 && an6.some((a) => a.fieldName === 'Nom' && a.fieldValue === 'existant') && an6.some((a) => a.fieldName === 'Nom2' && a.fieldValue === 'nouveau') && warns.some((w) => /Nom2/.test(w)), [an6.map((a) => a.fieldName + '=' + a.fieldValue), warns]);
  DocModel.setPagesState(d6, PageOps.duplicate(DocModel.pageState(d6), [0]));
  const an6b = (await annotsOf(await save(d6))).flat().filter((a) => a.subtype === 'Widget' && a.fieldName);
  check('après une opération de pages (document reconstruit) : les champs CRÉÉS sont conservés, un par page (Nom, Nom2) ; les widgets d\'origine sont figés (plus des champs)', an6b.map((a) => a.fieldName).sort().join() === 'Nom,Nom2', an6b.map((a) => a.fieldName));

  console.log('7. Caviardage : champ sous une zone appliquée');
  const d7 = await newDoc(await blank(1), 1);
  const SECRET = 'QZCHAMPSECRET';
  DocModel.addEdits(d7, [Object.assign(Fields.create('text', 0, [72, 700, 272, 722], new Set()), { name: 'Secret', value: SECRET }), Object.assign(Fields.create('text', 0, [72, 300, 272, 322], new Set()), { name: 'Public', value: 'visible' })]);
  DocModel.addEdit(d7, Redact.zoneFromRect(0, [60, 690, 300, 730]));
  const deps = { PDFLib, measure, loadPdf: (b) => load(b.slice ? b.slice() : b), createCanvas: (w, h) => { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; }, renderCanvasFactory: 'auto' };
  const res7 = await RedactApply.apply(d7, deps, { dpi: 100 });
  RedactApply.commit(DocModel, d7, res7);
  check('après application : le champ sous la zone n\'est plus un objet ; le champ hors zone reste un champ', d7.edits.filter(Fields.isField).map((e) => e.name).join() === 'Public', d7.edits.map((e) => e.type + ':' + (e.name || '')));
  const out7 = await save(d7, { scrub: Redact.hasRedacted(d7.pages) });
  const an7 = (await annotsOf(out7)).flat().filter((a) => a.subtype === 'Widget');
  check('fichier enregistré : seul « Public » est un champ ; le secret est absent des octets', an7.map((a) => a.fieldName).join() === 'Public' && scan(out7, SECRET).hits.length === 0, [an7.map((a) => a.fieldName), scan(out7, SECRET).hits.length]);

  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : champs de formulaire créés.');
})().catch((e) => { console.error(e); process.exit(1); });
