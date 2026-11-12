// Impression : boîte de dialogue, aperçu, plages de pages, tâches produites (l'envoi réel est remplacé par SPINADOC_TEST_PRINT_DIR :
// aucune impression). Fenêtre hors écran. Usage : node test/test-print-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}
async function pdfInfo(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const sizes = [];
  let text = '', images = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    sizes.push([Math.round(p.view[2] * 25.4 / 72), Math.round(p.view[3] * 25.4 / 72)]);
    text += (await p.getTextContent()).items.map((x) => x.str).join(' ');
    const ol = await p.getOperatorList();
    images += ol.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject).length;
  }
  return { pages: doc.numPages, sizes, text, images };
}

(async () => {
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-print-out-'));
  const c = await launchApp({ files: [f.c], env: { SPINADOC_TEST_PRINT_DIR: out } }); // f.c : A3 paysage, A4, A5, A3 paysage, Letter, A4
  const J = async (e) => JSON.parse(await c.ev(e));
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(800);
    const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
    const setv = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const setchk = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.checked=${v};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const txt = (id) => c.ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
    const settle = () => sleep(900);
    const clearOut = () => { for (const x of fs.readdirSync(out)) fs.unlinkSync(path.join(out, x)); };
    const jobs = () => JSON.parse(fs.readFileSync(path.join(out, 'jobs.json'), 'utf8'));

    // objet « texte » sur la page 1 (pour vérifier « Inclure les annotations »)
    await c.ev(`Promise.all([import('./js/ui.js')]).then(([u])=>{const d=u.store.active;window.DocModel.addEdit(d,Object.assign(window.Shapes.defaultsFor('add'),{type:'add',page:0,x:100,y:500,text:'ANNOTATION-TEST',font:'Helvetica',size:20,rot:0}));})`);
    await sleep(300);

    // ------------------------------------------------------------ 1. ouverture, imprimante, aperçu
    console.log('1. Boîte de dialogue');
    await c.ev(`document.body.click()`);
    await key('p', 'KeyP', 80, 2); await sleep(1500);
    check('Ctrl+P ouvre la boîte d\'impression', await c.ev(`!document.getElementById('printdlg').hidden`) === true);
    check('imprimante de test listée', (await c.ev(`document.getElementById('pr-printer').textContent`)).includes('Imprimante de test'));
    check('papier : liste de formats', (await c.ev(`document.getElementById('pr-paper').options.length`)) >= 5);
    check('aperçu dessiné', (await c.ev(`document.getElementById('pr-canvas').width`)) > 50 && /Papier/.test(await txt('pr-info')), await txt('pr-info'));
    check('bouton Imprimer actif', await c.ev(`!document.getElementById('pr-ok').disabled`) === true);
    check('mention « vectorielle »', /vectorielle/.test(await txt('pr-rnote')), await txt('pr-rnote'));

    // ------------------------------------------------------------ 2. plages de pages
    console.log('2. Pages');
    await setv('pr-paper', '210x297'); await settle();
    check('toutes les pages : 6 feuilles', /\/ 6/.test(await txt('pr-sheet')), await txt('pr-sheet'));
    await c.ev(`document.querySelector('input[name=pr-pages][value=range]').click()`); await sleep(200);
    await setv('pr-range', '1-2, 4'); await settle();
    check('plage « 1-2, 4 » : 3 feuilles', /\/ 3/.test(await txt('pr-sheet')), await txt('pr-sheet'));
    await setv('pr-range', '9'); await settle();
    check('plage invalide : message et impression bloquée', /1 à 6/.test(await txt('pr-warn')) && await c.ev(`document.getElementById('pr-ok').disabled`) === true, await txt('pr-warn'));
    await c.ev(`document.querySelector('input[name=pr-pages][value=current]').click()`); await settle();
    check('page courante : 1 feuille', /\/ 1/.test(await txt('pr-sheet')), await txt('pr-sheet'));
    await c.ev(`document.querySelector('input[name=pr-pages][value=all]').click()`); await settle();

    // ------------------------------------------------------------ 3. échelle et avertissements
    console.log('3. Échelle');
    await setv('pr-scale', 'actual'); await settle();
    check('taille réelle d\'un A3 sur A4 : avertissement « coupée »', /coupée/.test(await txt('pr-warn')), await txt('pr-warn'));
    check('échelle affichée 100 %', /100,0 %/.test(await txt('pr-info')), await txt('pr-info'));
    await setv('pr-scale', 'fit'); await settle();
    check('ajusté : avertissement « réduite »', /réduite/.test(await txt('pr-warn')), await txt('pr-warn'));
    await setv('pr-scale', 'percent'); await setv('pr-percent', '50'); await settle();
    check('50 % : échelle affichée', /50,0 %/.test(await txt('pr-info')), await txt('pr-info'));
    await setv('pr-scale', 'fit');

    // ------------------------------------------------------------ 4. tâches produites (papier A4, orientation automatique)
    console.log('4. Tâches d\'impression');
    clearOut();
    await c.click('#pr-ok'); await sleep(3500);
    check('boîte fermée après impression', await c.ev(`document.getElementById('printdlg').hidden`) === true);
    let j = jobs();
    check('A4 automatique : les feuilles de même format sont groupées (A3L,A4,A5,A3L,Letter,A4 → paysage/portrait)', j.jobs.length === 4 && j.jobs.map((x) => Math.round(x.wMm) + 'x' + Math.round(x.hMm)).join(',') === '297x210,210x297,297x210,210x297', j.jobs);
    check('plusieurs formats = plusieurs tâches nommées « nom (1/4).pdf »…', j.jobs.map((x) => x.title).join('|') === 'c-mixte (1/4).pdf|c-mixte (2/4).pdf|c-mixte (3/4).pdf|c-mixte (4/4).pdf' && j.jobs[0].fileName === 'c-mixte (1-4).pdf', j.jobs.map((x) => [x.title, x.fileName]));
    let info = await pdfInfo(path.join(out, 'job-1.pdf'));
    check('job 1 : feuille A4 paysage exacte', info.pages === 1 && info.sizes[0][0] === 297 && info.sizes[0][1] === 210, info.sizes);
    check('annotation incluse dans la tâche (texte vectoriel présent)', info.text.includes('ANNOTATION-TEST'), info.text.slice(0, 80));

    // annotations exclues
    await c.ev(`document.body.click()`); await key('p', 'KeyP', 80, 2); await sleep(1500);
    await setv('pr-paper', '297x420'); await setv('pr-nup', '2'); await setchk('pr-annots', false); await settle();
    check('2 pages par feuille : 3 feuilles pour 6 pages', /\/ 3/.test(await txt('pr-sheet')), await txt('pr-sheet'));
    clearOut();
    await c.click('#pr-ok'); await sleep(3500);
    j = jobs();
    info = await pdfInfo(path.join(out, 'job-1.pdf'));
    check('planche de 2 : feuille A3', info.sizes[0][0] === 297 || info.sizes[0][0] === 420, info.sizes);
    check('annotations exclues : texte absent de la tâche', !info.text.includes('ANNOTATION-TEST'), info.text.slice(0, 80));

    // ------------------------------------------------------------ 5. rasterisation (noir et blanc, traits fins)
    console.log('5. Rasterisation');
    await c.ev(`document.body.click()`); await key('p', 'KeyP', 80, 2); await sleep(1500);
    await setv('pr-nup', '1'); await setchk('pr-annots', true); await setv('pr-color', 'bw'); await setv('pr-dpi', '150'); await setv('pr-thin', '0.2'); await setv('pr-paper', '210x297');
    await c.ev(`document.querySelector('input[name=pr-pages][value=range]').click()`); await setv('pr-range', '1'); await settle();
    check('mention de rasterisation', /rasterise/.test(await txt('pr-rnote')), await txt('pr-rnote'));
    clearOut();
    await c.click('#pr-ok'); await sleep(6000);
    info = await pdfInfo(path.join(out, 'job-1.pdf'));
    check('noir et blanc : tâche en images (pas de texte vectoriel), taille de feuille conservée', info.images >= 1 && info.text.trim() === '' && info.sizes[0][0] === 297 && info.sizes[0][1] === 210, info);
    j = jobs();
    check('options transmises : couleur désactivée', j.opts.color === false && j.opts.device === 'Imprimante de test', j.opts);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : impression (interface).');
})();
