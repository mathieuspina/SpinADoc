// Formulaires (interface, hors écran) : champs détectés et affichés sur la page, surbrillance, Tab / Maj+Tab, saisie de chaque type de champ,
// annuler / rétablir, lecture seule, obligatoire, enregistrement (valeurs relues), aplatissement, avertissement avant une opération de pages.
// Usage : node test/test-forms-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');
const { launchApp, sleep } = require('./lib/app.js');
const { makeForm } = require('./lib/make-form.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

(async () => {
  const file = await makeForm(path.join(os.tmpdir(), 'spinadoc-form-ui.pdf'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-forms-out-'));
  const c = await launchApp({ files: [file], env: { SPINADOC_TEST_SAVE_DIR: out } });
  const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
  const doc = (expr) => c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const sel = (n, extra) => `.docview.active .form-layer .ff[data-field="${n}"]${extra || ''}`;
  const focusEl = async (s) => { await c.ev(`document.querySelector(${JSON.stringify(s)}).scrollIntoView({block:'center'})`); await sleep(150); await c.click(s); };
  const active = () => c.ev(`document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.field || '' : ''`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active .form-layer .ff').length>0`, 20000);
    await sleep(800);
    console.log('1. Détection et affichage');
    const n0 = await c.ev(`document.querySelectorAll('.docview.active .form-layer .ff').length`);
    check('11 champs affichés par-dessus les pages (9 sur la page 1, 2 sur la page 2)', n0 === 11, n0);
    check('un calque par page concernée', (await c.ev(`document.querySelectorAll('.docview.active .form-layer').length`)) === 2);
    check('types : texte, multiligne, case, radios, liste déroulante, liste multiple', (await c.ev(`JSON.stringify([...document.querySelectorAll('.docview.active .form-layer .ff')].slice(0,8).map(e=>e.tagName.toLowerCase()+(e.type?':'+e.type:'')))`)) === JSON.stringify(['input:text', 'textarea:textarea', 'input:checkbox', 'input:radio', 'input:radio', 'select:select-one', 'select:select-multiple', 'input:text']));
    check('champ en lecture seule : marqué, non modifiable, valeur d\'origine', (await c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel('reference'))}); return e.readOnly && e.dataset.ro==='1' && e.value==='REF-001'})()`)) === true);
    check('champ obligatoire : marqué visuellement et pour l\'accessibilité', (await c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel('obligatoire'))}); return e.dataset.required==='1' && e.getAttribute('aria-required')==='true' && getComputedStyle(e).outlineStyle==='dashed'})()`)) === true);
    check('champ « date » : valeur d\'origine intacte', (await c.ev(`document.querySelector(${JSON.stringify(sel('date'))}).value`)) === '01/02/2026');
    check('document non modifié à l\'ouverture', (await doc('d.dirty')) === false);
    check('surbrillance active par défaut', (await c.ev(`document.querySelector('.docview.active .form-layer').classList.contains('hl')`)) === true);
    await c.click('#rtab-forms'); await sleep(250);
    check('boutons Surbrillance / Aplatir actifs', (await c.ev(`['form-highlight','form-flatten','form-flatten-now'].every((k)=>!document.querySelector('#rpanel-forms [data-cmd='+k+']').disabled)`)) === true);
    await c.click('#rpanel-forms [data-cmd=form-highlight]'); await sleep(250);
    check('bouton Surbrillance : surbrillance masquée', (await c.ev(`!document.querySelector('.docview.active .form-layer').classList.contains('hl')`)) === true);
    await c.click('#rpanel-forms [data-cmd=form-highlight]'); await sleep(250);
    check('et réaffichée', (await c.ev(`document.querySelector('.docview.active .form-layer').classList.contains('hl')`)) === true);

    console.log('2. Saisie, Tab, historique');
    await focusEl(sel('nom'));
    check('clic dans le champ : il prend le focus', (await active()) === 'nom');
    await c.type('Léa → Dupont');
    await key('Tab', 'Tab', 9); await sleep(300);
    check('Tab : champ suivant (« commentaire »)', (await active()) === 'commentaire', await active());
    check('saisie validée au changement de champ : une étape d\'historique, document modifié', (await doc('[d.form && d.form.values.nom, d.undo.length, d.dirty]')).join() === 'Léa → Dupont,1,true');
    check('caractère hors WinAnsi : avertissement', /remplacés par/.test(await c.ev(`document.getElementById('toast').textContent`)), await c.ev(`document.getElementById('toast').textContent`));
    await key('Tab', 'Tab', 9, 8); await sleep(200); // Maj+Tab
    check('Maj+Tab : retour au champ « nom »', (await active()) === 'nom', await active());
    await key('Tab', 'Tab', 9); await key('Tab', 'Tab', 9); await sleep(200);
    check('Tab Tab : « accepte »', (await active()) === 'accepte', await active());
    await c.ev(`document.body.click()`);
    await key('z', 'KeyZ', 90, 2); await sleep(500);
    check('Ctrl+Z : saisie annulée, champ vidé, document non modifié', (await doc('[d.form, d.dirty]')).join() === ',false' && (await c.ev(`document.querySelector(${JSON.stringify(sel('nom'))}).value`)) === '');
    await key('y', 'KeyY', 89, 2); await sleep(500);
    check('Ctrl+Y : saisie rétablie dans le champ', (await c.ev(`document.querySelector(${JSON.stringify(sel('nom'))}).value`)) === 'Léa → Dupont' && (await doc('d.form.values.nom')) === 'Léa → Dupont');

    console.log('3. Autres types de champs');
    await focusEl(sel('accepte')); await sleep(200);
    check('case à cocher cochée', (await doc('d.form.values.accepte')) === true);
    await c.ev(`document.querySelector(${JSON.stringify(sel('civilite', '[data-export="1"]'))}).scrollIntoView({block:'center'})`); await sleep(150);
    await c.click(sel('civilite', '[data-export="1"]')); await sleep(250);
    check('bouton radio : valeur d\'export du bouton choisi', (await doc('d.form.values.civilite')) === '1', await doc('d.form'));
    check('radios exclusifs : le premier est décoché', (await c.ev(`document.querySelector(${JSON.stringify(sel('civilite', '[data-export="0"]'))}).checked`)) === false);
    await c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel('pays'))}); e.value='Suisse'; e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(200);
    check('liste déroulante : « Suisse »', (await doc('d.form.values.pays')) === 'Suisse');
    await c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel('materiaux'))}); for(const o of e.options) o.selected = (o.value==='Acier'||o.value==='Bois'); e.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(200);
    check('liste à choix multiple : Acier et Bois', (await doc('d.form.values.materiaux')).join() === 'Acier,Bois');
    await focusEl(sel('reference')); await c.type('X'); await key('Tab', 'Tab', 9); await sleep(200);
    check('champ en lecture seule : aucune modification possible', (await c.ev(`document.querySelector(${JSON.stringify(sel('reference'))}).value`)) === 'REF-001' && !(await doc('d.form.values.reference')));
    await focusEl(sel('montant')); await c.type('1 234,50'); await key('Tab', 'Tab', 9); await sleep(250);
    check('champ « nombre » : valeur saisie telle quelle', (await doc('d.form.values.montant')) === '1 234,50');
    check('Tab passe d\'une page à l\'autre dans l\'ordre du document', true);
    check('une étape d\'historique par champ modifié (6)', (await doc('d.undo.length')) === 6, await doc('d.undo.length'));

    console.log('4. Enregistrement : valeurs conservées');
    await c.ev(`document.body.click()`); await key('s', 'KeyS', 83, 2); await sleep(1800);
    const saved = path.join(out, 'spinadoc-form-ui.pdf');
    check('fichier enregistré', fs.existsSync(saved));
    const f1 = (await PDFLib.PDFDocument.load(fs.readFileSync(saved))).getForm();
    check('valeurs relues : nom (« ? » à la place du caractère non pris en charge), case, radio, liste, liste multiple, nombre', f1.getTextField('nom').getText() === 'Léa ? Dupont' && f1.getCheckBox('accepte').isChecked() && f1.getRadioGroup('civilite').getSelected() === 'M' && f1.getDropdown('pays').getSelected()[0] === 'Suisse' && f1.getOptionList('materiaux').getSelected().sort().join() === 'Acier,Bois' && f1.getTextField('montant').getText() === '1 234,50', [f1.getTextField('nom').getText()]);
    check('champ en lecture seule conservé', f1.getTextField('reference').getText() === 'REF-001' && f1.getTextField('reference').isReadOnly());
    check('document enregistré : non modifié', (await doc('d.dirty')) === false);
    // rendu pdf.js : apparences régénérées
    const pj = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(saved)), verbosity: 0 }).promise;
    const anns = await (await pj.getPage(1)).getAnnotations();
    check('rendu pdf.js : champs lisibles avec leurs valeurs', anns.find((a) => a.fieldName === 'nom').fieldValue === 'Léa ? Dupont' && anns.filter((a) => a.hasAppearance === false).length === 0);

    console.log('5. Aplatir le formulaire');
    await c.click('#rpanel-forms [data-cmd=form-flatten]'); await sleep(300);
    check('option « Aplatir à l\'enregistrement » activée', (await c.ev(`document.querySelector('#rpanel-forms [data-cmd=form-flatten]').getAttribute('aria-pressed')`)) === 'true');
    fs.rmSync(saved, { force: true });
    await c.ev(`document.body.click()`); await key('s', 'KeyS', 83, 2); await sleep(1800);
    const pf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(saved)), verbosity: 0 }).promise;
    const fl = (await (await pf.getPage(1)).getAnnotations()).filter((a) => a.subtype === 'Widget');
    const ft = (await (await pf.getPage(1)).getTextContent()).items.map((x) => x.str).join(' ');
    check('fichier aplati : plus de champs, valeurs figées dans la page', fl.length === 0 && /Dupont/.test(ft) && /REF-001/.test(ft), { w: fl.length, ft: ft.slice(0, 200) });
    await c.click('#rpanel-forms [data-cmd=form-flatten]'); await sleep(200);

    console.log('6. Opération de pages : avertissement avant la perte des champs');
    await c.click('#rtab-pages'); await sleep(250);
    const nPages0 = await doc('d.pages.length');
    await c.click('#rpanel-pages [data-cmd=pg-rot-right]'); await sleep(500);
    check('pivoter une page : avertissement « Champs de formulaire »', (await c.ev(`!document.getElementById('choice').hidden && document.getElementById('choice-title').textContent`)) === 'Champs de formulaire');
    check('trois choix : Annuler, Aplatir d\'abord, Continuer sans les champs', (await c.ev(`[...document.querySelectorAll('#choice-actions button')].map(b=>b.textContent).join('|')`)) === 'Annuler|Aplatir d\'abord|Continuer sans les champs');
    await c.ev(`[...document.querySelectorAll('#choice-actions button')].find(b=>b.textContent==='Annuler').click()`); await sleep(400);
    check('Annuler : rien n\'a changé, champs toujours affichés', (await doc('d.pages[0].rot')) === 0 && (await c.ev(`document.querySelectorAll('.docview.active .form-layer .ff').length`)) === 11);
    await c.click('#rpanel-pages [data-cmd=pg-rot-right]'); await sleep(400);
    await c.ev(`[...document.querySelectorAll('#choice-actions button')].find(b=>b.textContent==='Aplatir d\\'abord').click()`); await sleep(2500);
    check('Aplatir d\'abord : exemplaire aplati ouvert dans un nouvel onglet, sans champs', (await c.ev(`document.querySelectorAll('.doctab').length`)) === 2 && /aplati/.test(await doc('d.name')) && (await doc('d.pages.length')) === nPages0 && (await c.ev(`document.querySelectorAll('.docview.active .form-layer .ff').length`)) === 0);
    check('le texte des champs est dans la page de l\'exemplaire aplati', /Dupont/.test(await c.ev(`import('./js/ui.js').then(async m=>{const r=m.store.active.runtime.pages[0]; const t=await r.page.getTextContent(); return t.items.map(i=>i.str).join(' ')})`)));
    await c.click('.doctab:first-child'); await sleep(800);
    await c.click('#rpanel-pages [data-cmd=pg-rot-right]'); await sleep(400);
    await c.ev(`[...document.querySelectorAll('#choice-actions button')].find(b=>b.textContent==='Continuer sans les champs').click()`); await sleep(1500);
    check('Continuer : page pivotée, plus de champs interactifs', (await doc('d.pages.some((p)=>p.rot===90)')) === true && (await c.ev(`document.querySelectorAll('.docview.active .form-layer .ff').length`)) === 0, [await doc('d.name'), await doc('d.pages[0].rot'), await c.ev(`document.querySelectorAll('.docview.active .form-layer .ff').length`), await c.ev(`document.getElementById('choice').hidden`)]);
    await c.ev(`document.body.click()`); await key('z', 'KeyZ', 90, 2); await sleep(1200);
    check('Ctrl+Z : champs de nouveau affichés avec les valeurs saisies', (await c.ev(`document.querySelectorAll('.docview.active .form-layer .ff').length`)) === 11 && (await c.ev(`document.querySelector(${JSON.stringify(sel('nom'))}).value`)) === 'Léa → Dupont');
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
    try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : formulaires (interface).');
})();
