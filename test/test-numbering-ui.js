// Numérotation des pages (interface, hors écran) : ajouter, modifier, dupliquer, supprimer, activer/désactiver une règle, annuler/rétablir,
// aperçu en direct (toutes les pages, masquable), suivi après suppression de page, enregistrement et impression avec numérotation.
// Usage : node test/test-numbering-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

(async () => {
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-num-'));
  const c = await launchApp({ files: [f.a], env: { SPINADOC_TEST_PRINT_DIR: out } });
  const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
  const setv = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const setc = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.checked=${v};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const doc = (expr) => c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const numTexts = () => c.ev(`JSON.stringify([...document.querySelectorAll('.docview.active .annot .num')].map((g)=>g.textContent).filter(Boolean))`).then(JSON.parse);
  const settle = () => sleep(400);
  async function pdfTexts(bytesB64) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const d = await pdfjs.getDocument({ data: new Uint8Array(Buffer.from(bytesB64, 'base64')), verbosity: 0 }).promise;
    const res = [];
    for (let i = 1; i <= d.numPages; i++) res.push((await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).filter(Boolean));
    return res;
  }
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(1200);
    const nPages = await doc('d.pages.length');
    check('document de test : 8 pages', nPages === 8, nPages);

    console.log('1. Boîte et première règle');
    await c.click('#rtab-pages'); await sleep(250);
    check('groupe « Numérotation » dans l\'onglet Pages', (await c.ev(`!!document.querySelector('#rpanel-pages [data-cmd=pg-number]') && !!document.querySelector('#rpanel-pages [data-cmd=pg-number-preview]')`)) === true);
    await c.click('#rpanel-pages [data-cmd=pg-number]'); await settle();
    check('boîte ouverte, une règle par défaut', (await c.ev(`!document.getElementById('numdlg').hidden && document.querySelectorAll('#num-list li').length`)) === 1);
    await setv('num-scope', 'from'); await setv('num-from', '2'); await setv('num-text', 'Page {n} / {total}'); await setv('num-pos', 'br'); await settle();
    let t = await numTexts();
    check('aperçu en direct sur toutes les pages : 7 pages numérotées', t.length === 7 && t[0] === 'Page 1 / 7' && t[6] === 'Page 7 / 7', t);
    check('page 1 non numérotée', (await c.ev(`document.querySelectorAll('.docview.active .annot')[0].querySelector('.num').children.length`)) === 0);
    check('aperçu de la boîte : texte de la page affichée', /Page 1 : « Page 1 \/ 7 »|Page 1 : aucune/.test(await c.ev(`document.getElementById('num-note').textContent`)), await c.ev(`document.getElementById('num-note').textContent`));
    await setv('num-ppage', '3'); await settle();
    check('aperçu de la boîte : page 3', /Page 3 : « Page 2 \/ 7 »/.test(await c.ev(`document.getElementById('num-note').textContent`)), await c.ev(`document.getElementById('num-note').textContent`));
    check('aperçu de la boîte : texte posé sur la page', (await c.ev(`document.querySelectorAll('#num-svg text').length`)) === 1);
    check('document pas encore modifié (règles en cours d\'édition)', (await doc('d.numbering.length')) === 0 && (await doc('d.dirty')) === false);
    await c.click('#num-ok'); await settle();
    check('« Appliquer » : une règle dans le document, une étape d\'historique, document modifié', (await doc('[d.numbering.length, d.undo.length, d.dirty]')).join() === '1,1,true');
    check('boîte fermée, aperçu conservé sur les pages', (await c.ev(`document.getElementById('numdlg').hidden`)) === true && (await numTexts()).length === 7);

    console.log('2. Annuler / rétablir');
    await c.ev(`document.body.click()`); await key('z', 'KeyZ', 90, 2); await settle();
    check('Ctrl+Z retire la règle et l\'aperçu', (await doc('d.numbering.length')) === 0 && (await numTexts()).filter(Boolean).length === 0, await numTexts());
    await key('y', 'KeyY', 89, 2); await settle();
    check('Ctrl+Y la rétablit', (await doc('d.numbering.length')) === 1 && (await numTexts()).length === 7);

    console.log('3. Deux règles : ajouter, modifier, dupliquer, supprimer, désactiver');
    await c.click('#rpanel-pages [data-cmd=pg-number]'); await settle();
    await c.click('#num-add'); await settle();
    await setv('num-scope', 'range'); await setv('num-from', '4'); await setv('num-to', '6'); await setv('num-text', 'A-{n}'); await setv('num-format', 'A'); await setv('num-pos', 'tl'); await setc('num-bold', true); await settle();
    check('liste : 2 règles', (await c.ev(`document.querySelectorAll('#num-list li').length`)) === 2);
    t = await numTexts();
    check('pages 4 à 6 portent les deux numérotations', t.filter((x) => /A-/.test(x)).length === 3 && /A-A/.test(t.join()) && /A-C/.test(t.join()), t);
    await c.click('#num-dup'); await settle();
    check('dupliquer : 3 règles, copie sélectionnée', (await c.ev(`document.querySelectorAll('#num-list li').length`)) === 3 && /copie/.test(await c.ev(`document.querySelector('#num-list li[aria-selected=true] .nl-name').textContent`)));
    await setv('num-start', '10'); await settle();
    check('modifier la copie : départ à 10', /A-J/.test((await numTexts()).join()));
    await c.ev(`document.querySelector('#num-list li[aria-selected=true] .num-en').click()`); await settle();
    check('désactiver la copie : plus de « A-J »', !/A-J/.test((await numTexts()).join()));
    await c.click('#num-del'); await settle();
    check('supprimer la copie : 2 règles', (await c.ev(`document.querySelectorAll('#num-list li').length`)) === 2);
    await c.click('#num-cancel'); await settle();
    check('« Annuler » : document inchangé (1 règle), aperçu revenu', (await doc('d.numbering.length')) === 1 && (await numTexts()).length === 7 && !/A-/.test((await numTexts()).join()));
    await c.click('#rpanel-pages [data-cmd=pg-number]'); await settle();
    await c.click('#num-add'); await setv('num-scope', 'range'); await setv('num-from', '4'); await setv('num-to', '6'); await setv('num-text', 'A-{n}'); await setv('num-format', 'A'); await setv('num-pos', 'tl'); await settle();
    await c.click('#num-ok'); await settle();
    check('deux règles appliquées en UNE étape d\'historique', (await doc('[d.numbering.length, d.undo.length]')).join() === '2,2');

    console.log('4. Aperçu masquable');
    await c.click('#rpanel-pages [data-cmd=pg-number-preview]'); await settle();
    check('bouton « Aperçu » : numérotation masquée à l\'écran', (await numTexts()).length === 0 && (await doc('d.numbering.length')) === 2);
    await c.click('#rpanel-pages [data-cmd=pg-number-preview]'); await settle();
    check('et réaffichée', (await numTexts()).length > 0);

    console.log('5. Enregistrement : contenu figé');
    const b64 = await c.ev(`import('./js/ui.js').then(async (m)=>{const V=await import('./js/viewer.js'); const b=await V.exportBytes(m.store.active); let s=''; for(let i=0;i<b.length;i+=8192) s+=String.fromCharCode(...b.subarray(i,i+8192)); return btoa(s)})`);
    let pt = await pdfTexts(b64);
    check('page 1 : aucun numéro ; page 2 : « Page 1 / 7 » ; page 8 : « Page 7 / 7 »', !pt[0].some((x) => /Page d|A-/.test(x)) && pt[1].includes('Page 1 / 7') && pt[7].includes('Page 7 / 7'), [pt[0], pt[1], pt[7]]);
    check('pages 4 à 6 : « A-A » « A-B » « A-C » en plus', pt[3].includes('A-A') && pt[4].includes('A-B') && pt[5].includes('A-C') && !pt[6].some((x) => /^A-/.test(x)), [pt[3], pt[5], pt[6]]);

    console.log('6. La règle suit les pages après une suppression');
    await c.ev(`import('./js/ui.js').then(async (m)=>{const P=await import('./js/pages-ui.js'); const d=m.store.active; P.setSelection(d,[1],1); await P.remove(d); return 1})`); await sleep(800);
    check('page 2 supprimée : 7 pages, la règle commence désormais à l\'ancienne page 3', (await doc('d.pages.length')) === 7 && (await doc('d.numbering[0].fromU')) === (await doc('d.pages[1].u')));
    t = await numTexts();
    check('numéros recalculés : « Page 1 / 6 » sur la nouvelle page 2', /Page 1 \/ 6/.test(t[0]) && t.length === 6, t);
    await c.ev(`document.body.click()`); await key('z', 'KeyZ', 90, 2); await sleep(800);
    check('Ctrl+Z : retour à 8 pages et 7 numéros', (await doc('d.pages.length')) === 8 && (await numTexts()).length === 7 && (await doc('d.numbering[0].fromU')) === (await doc('d.pages[1].u')));

    console.log('7. Impression avec numérotation');
    await c.ev(`document.body.click()`); await key('p', 'KeyP', 80, 2); await sleep(2000);
    await c.ev(`document.querySelector('input[name=pr-pages][value=all]').click()`); await sleep(1500);
    await c.click('#pr-ok');
    for (let i = 0; i < 80 && !fs.existsSync(path.join(out, 'jobs.json')); i++) await sleep(250);
    await sleep(500);
    pt = await pdfTexts(fs.readFileSync(path.join(out, 'job-1.pdf')).toString('base64'));
    check('PDF d\'impression : numéros présents (page 2 : « Page 1 / 7 »)', pt.length === 8 && pt[1].includes('Page 1 / 7') && pt[3].includes('A-A'), pt.map((p) => p.join('|')));
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
    try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : numérotation des pages (interface).');
})();
