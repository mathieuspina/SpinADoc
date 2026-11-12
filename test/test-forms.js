// Formulaires AcroForm : détection des champs (pdf.js → Forms.fromAnnotations), remplissage et relecture (pdf-lib), aplatissement et rendu pdf.js,
// champ en lecture seule / obligatoire, texte hors WinAnsi, historique des valeurs. Usage : node test/test-forms.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');
const Forms = require('../src/forms.js');
const DM = require('../src/doc-model.js');
const PO = require('../src/page-ops.js');
const { applyEdits } = require('../src/pdf-edit.js');
const { makeForm } = require('./lib/make-form.js');

(async () => {
  const file = await makeForm(path.join(os.tmpdir(), 'spinadoc-form-test.pdf'));
  const bytes = fs.readFileSync(file);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const open = (b) => pdfjs.getDocument({ data: new Uint8Array(b), verbosity: 0 }).promise;
  const scan = async (b) => { const d = await open(b); const per = []; for (let i = 1; i <= d.numPages; i++) per.push(await (await d.getPage(i)).getAnnotations()); return Forms.fromAnnotations(per); };

  // ---- détection
  const fields = await scan(bytes);
  const byName = (n) => fields.filter((f) => f.name === n);
  assert.deepStrictEqual(Forms.names(fields).sort(), ['accepte', 'civilite', 'commentaire', 'date', 'materiaux', 'montant', 'nom', 'obligatoire', 'pays', 'reference']);
  assert.strictEqual(byName('nom')[0].type, 'text');
  assert(byName('commentaire')[0].multiline);
  assert.strictEqual(byName('accepte')[0].type, 'check');
  assert.deepStrictEqual(byName('civilite').map((f) => [f.type, f.exportValue]), [['radio', '0'], ['radio', '1']]);
  assert.strictEqual(byName('pays')[0].type, 'combo');
  assert.deepStrictEqual(byName('pays')[0].options.map((o) => o.v), ['France', 'Belgique', 'Suisse']);
  assert.strictEqual(byName('materiaux')[0].type, 'list');
  assert(byName('materiaux')[0].multiSelect);
  assert(byName('reference')[0].readOnly && !byName('nom')[0].readOnly, 'lecture seule');
  assert(byName('obligatoire')[0].required && !byName('nom')[0].required, 'obligatoire');
  assert.strictEqual(Forms.initialValue(fields, 'reference'), 'REF-001');
  assert.strictEqual(Forms.initialValue(fields, 'date'), '01/02/2026', 'valeur de date conservée telle quelle');
  assert.strictEqual(Forms.initialValue(fields, 'accepte'), false);
  assert.strictEqual(Forms.initialValue(fields, 'civilite'), '');
  // ordre de tabulation : haut en bas, page par page
  assert.deepStrictEqual(fields.filter((f) => f.page === 0).map((f) => f.name).slice(0, 3), ['nom', 'commentaire', 'accepte']);
  assert(fields.slice(-2).every((f) => f.page === 1));

  // ---- remplissage, enregistrement, relecture
  const id = PO.identity(2);
  const run = (b, form, warn) => applyEdits(PDFLib, b, [], { images: {}, measure: { scales: {} }, pages: { list: id.pages, sources: {} }, numbering: [], form, warn });
  const values = { nom: 'Léa Dupont → é', commentaire: 'ligne 1\nligne 2', accepte: true, civilite: '1', pays: 'Belgique', materiaux: ['Acier', 'Verre'], date: '15/03/2026', montant: '1 234,50' };
  const warns = [];
  const out = await run(bytes, { values, flatten: false }, (m) => warns.push(m));
  const f1 = (await PDFLib.PDFDocument.load(out)).getForm();
  assert.strictEqual(f1.getTextField('nom').getText(), 'Léa Dupont ? é');
  assert.strictEqual(f1.getTextField('commentaire').getText(), 'ligne 1\nligne 2');
  assert(f1.getCheckBox('accepte').isChecked());
  assert.strictEqual(f1.getRadioGroup('civilite').getSelected(), 'M');
  assert.strictEqual(f1.getDropdown('pays').getSelected()[0], 'Belgique');
  assert.deepStrictEqual(f1.getOptionList('materiaux').getSelected().sort(), ['Acier', 'Verre']);
  assert.strictEqual(f1.getTextField('date').getText(), '15/03/2026');
  assert.strictEqual(f1.getTextField('montant').getText(), '1 234,50', 'nombre formaté : valeur intacte');
  assert.strictEqual(f1.getTextField('reference').getText(), 'REF-001', 'champ non touché conservé');
  assert(warns.some((m) => /caractères non pris en charge/.test(m) && /nom/.test(m)), 'avertissement « → » hors WinAnsi : ' + warns.join('|'));
  // relu par pdf.js : valeurs de champs et apparences régénérées (texte visible dans le contenu de la page)
  const back = await scan(out);
  assert.strictEqual(Forms.initialValue(back, 'nom'), 'Léa Dupont ? é');
  assert.strictEqual(Forms.initialValue(back, 'accepte'), true);
  assert.strictEqual(Forms.initialValue(back, 'civilite'), '1');
  assert.deepStrictEqual(Forms.initialValue(back, 'materiaux').sort(), ['Acier', 'Verre']);
  assert.strictEqual(Forms.initialValue(back, 'pays'), 'Belgique');
  const apps = await (await (await open(out)).getPage(1)).getAnnotations();
  assert(apps.every((a) => a.hasAppearance !== false), 'toutes les apparences présentes');

  // ---- aplatissement : plus de champs, contenu figé et visible
  const flat = await run(bytes, { values, flatten: true });
  assert.strictEqual((await scan(flat)).length, 0, 'plus aucun champ après aplatissement');
  const jd = await open(flat);
  const txt = (await (await jd.getPage(1)).getTextContent()).items.map((x) => x.str).join(' ');
  assert(/Léa Dupont/.test(txt) && /ligne 1/.test(txt) && /REF-001/.test(txt), 'texte des champs figé dans la page : ' + txt);
  const txt2 = (await (await jd.getPage(2)).getTextContent()).items.map((x) => x.str).join(' ');
  assert(/15\/03\/2026/.test(txt2) && /1 234,50/.test(txt2), txt2);
  // l'aplatissement seul (sans valeur saisie) fige aussi les valeurs d'origine
  const flat0 = await run(bytes, { values: {}, flatten: true });
  assert.strictEqual((await scan(flat0)).length, 0);
  assert(/REF-001/.test((await (await (await open(flat0)).getPage(1)).getTextContent()).items.map((x) => x.str).join(' ')));
  // sans formulaire demandé : fichier inchangé quant aux champs
  assert.strictEqual((await scan(await run(bytes, null))).length, fields.length);
  // un PDF sans AcroForm n'en reçoit jamais
  const plain = await PDFLib.PDFDocument.create(); plain.addPage([200, 200]);
  const pb = await plain.save();
  const po = await applyEdits(PDFLib, pb, [], { images: {}, measure: { scales: {} }, pages: { list: PO.identity(1).pages, sources: {} }, form: { values: { x: 'y' }, flatten: true } });
  assert(!Buffer.from(po).toString('latin1').includes('AcroForm'), 'aucun AcroForm créé');
  // champ inconnu : avertissement, pas d'erreur
  const w2 = []; await run(bytes, { values: { fantome: 'x' } }, (m) => w2.push(m));
  assert(w2.length === 1 && /introuvable/.test(w2[0]));
  // valeur trop longue pour la liste déroulante : ajoutée comme option, pas de plantage
  const o3 = await run(bytes, { values: { pays: 'Luxembourg' } });
  assert.strictEqual((await PDFLib.PDFDocument.load(o3)).getForm().getDropdown('pays').getSelected()[0], 'Luxembourg');
  // pages reconstruites (opération de pages) : champs d'origine perdus, aucune erreur d'écriture
  const rot = PO.rotate({ pages: id.pages, edits: [], scales: {}, nextId: 1, nextUid: id.nextUid }, [0], 90);
  const o4 = await applyEdits(PDFLib, bytes, [], { images: {}, measure: { scales: {} }, pages: { list: rot.pages, sources: {} }, form: { values, flatten: false } });
  assert(!Buffer.from(o4).toString('latin1').includes('/AcroForm') && !Forms.initialValue(await scan(o4), 'nom'), 'limite connue : plus de formulaire interactif après une opération de pages, valeurs saisies non écrites');

  // ---- historique des valeurs
  const doc = DM.createDoc({}); DM.initPages(doc, PO.identity(2).pages, 3);
  DM.setFormValues(doc, { nom: 'A' });
  DM.setFormValues(doc, { nom: 'AB', accepte: true });
  assert.deepStrictEqual(doc.form.values, { nom: 'AB', accepte: true });
  assert(doc.dirty && doc.undo.length === 2);
  DM.undo(doc); assert.deepStrictEqual(doc.form.values, { nom: 'A' });
  DM.undo(doc); assert.strictEqual(doc.form, null); assert(!doc.dirty);
  DM.redo(doc); DM.redo(doc); assert.strictEqual(doc.form.values.nom, 'AB');
  DM.setFormValues(doc, { nom: undefined, accepte: undefined }); assert.strictEqual(doc.form, null, 'toutes les saisies retirées');
  console.log(`OK : formulaires (${Forms.names(fields).length} champs détectés, remplissage, relecture, aplatissement, lecture seule, obligatoire, WinAnsi, historique).`);
})().catch((e) => { console.error('ECHEC', e); process.exit(1); });
