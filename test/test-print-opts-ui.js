// Impression : marges par défaut sûres (jamais vides), réglages par imprimante, marge matérielle (zone hachurée + message chiffré),
// « Couleur » toujours sélectionnable (imprimante simulée sans couleur annoncée), imprimante PDF vectorielle, nom du travail.
// Imprimantes SIMULÉES (SPINADOC_TEST_PRINTERS) et tâches écrites dans un dossier (SPINADOC_TEST_PRINT_DIR) : aucune impression réelle.
// Usage : node test/test-print-opts-ui.js
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

(async () => {
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-print-opts-'));
  const papers = [{ name: 'A4', w: 210, h: 297 }, { name: 'A3', w: 297, h: 420 }];
  const printers = [
    { name: 'Imprimante Exemple', isDefault: true, caps: { duplex: true, color: true, maxCopies: 99, hardMarginMm: 4.2, papers } },
    { name: 'PDFCreator', caps: { duplex: false, color: false, maxCopies: 1, hardMarginMm: null, papers } },
    { name: 'Autre imprimante', caps: { duplex: true, color: true, maxCopies: 99, hardMarginMm: null, papers } },
  ];
  const c = await launchApp({ files: [f.a], env: { SPINADOC_TEST_PRINT_DIR: out, SPINADOC_TEST_PRINTERS: JSON.stringify(printers) } });
  const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
  const setv = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const val = (id) => c.ev(`document.getElementById(${JSON.stringify(id)}).value`);
  const txt = (id) => c.ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const settle = () => sleep(900);
  const pick = async (name) => { await setv('pr-printer', name); await sleep(1000); };
  const jobs = () => JSON.parse(fs.readFileSync(path.join(out, 'jobs.json'), 'utf8'));
  const waitJob = async () => { for (let i = 0; i < 60; i++) { await sleep(250); if (fs.existsSync(path.join(out, 'jobs.json'))) return; } };
  const clearOut = () => { for (const x of fs.readdirSync(out)) fs.unlinkSync(path.join(out, x)); };
  async function pdfInfo(file) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
    let images = 0, text = '';
    for (let i = 1; i <= doc.numPages; i++) { const p = await doc.getPage(i); const ol = await p.getOperatorList(); images += ol.fnArray.filter((x) => x === pdfjs.OPS.paintImageXObject || x === pdfjs.OPS.paintInlineImageXObject).length; text += (await p.getTextContent()).items.map((x) => x.str).join(' '); }
    return { pages: doc.numPages, images, text };
  }
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(800);
    await c.ev(`document.body.click()`);
    await key('p', 'KeyP', 80, 2); await sleep(1800);

    console.log('1. Marges par défaut sûres');
    check('imprimante par défaut : « Imprimante Exemple »', (await val('pr-printer')) === 'Imprimante Exemple');
    check('marge par défaut = marge matérielle annoncée (4,2 mm, jamais moins)', (await val('pr-margin')) === '4.2', await val('pr-margin'));
    await setv('pr-margin', '');
    await c.ev(`document.getElementById('pr-margin').dispatchEvent(new Event('blur'))`);
    check('champ vidé : valeur précédente rétablie (jamais vide)', (await val('pr-margin')) === '4.2', await val('pr-margin'));
    await setv('pr-margin', 'abc');
    await c.ev(`document.getElementById('pr-margin').dispatchEvent(new Event('blur'))`);
    check('valeur illisible : valeur précédente rétablie', (await val('pr-margin')) === '4.2', await val('pr-margin'));
    await pick('PDFCreator');
    check('changement d\'imprimante : champ de marge jamais vide, défaut 2 mm', (await val('pr-margin')) === '2', await val('pr-margin'));
    await pick('Autre imprimante');
    check('imprimante sans marge matérielle connue : 2 mm', (await val('pr-margin')) === '2', await val('pr-margin'));
    // même vidé pendant la frappe, l'aperçu et les tâches utilisent une marge valide
    await c.ev(`(()=>{const e=document.getElementById('pr-margin'); e.value=''; e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await settle();
    check('champ vide pendant la saisie : l\'aperçu reste calculé (pas d\'erreur)', !/Erreur|NaN/.test(await txt('pr-warn')) && /Papier/.test(await txt('pr-info')), await txt('pr-warn'));
    await setv('pr-margin', '2');

    console.log('2. Réglages par imprimante');
    await pick('Imprimante Exemple');
    await setv('pr-margin', '7'); await setv('pr-scale', 'actual'); await setv('pr-orient', 'landscape'); await settle();
    await pick('PDFCreator');
    check('autre imprimante : ses propres réglages par défaut (2 mm, ajusté, automatique)', (await val('pr-margin')) === '2' && (await val('pr-scale')) === 'fit' && (await val('pr-orient')) === 'auto', { m: await val('pr-margin'), s: await val('pr-scale'), o: await val('pr-orient') });
    await setv('pr-margin', '3');
    await pick('Imprimante Exemple');
    check('retour : marge, échelle et orientation mémorisées pour « Imprimante Exemple »', (await val('pr-margin')) === '7' && (await val('pr-scale')) === 'actual' && (await val('pr-orient')) === 'landscape', { m: await val('pr-margin'), s: await val('pr-scale'), o: await val('pr-orient') });
    await pick('PDFCreator');
    check('« PDFCreator » : 3 mm mémorisés', (await val('pr-margin')) === '3');

    console.log('3. Marge matérielle : zone hachurée et message chiffré');
    await pick('Imprimante Exemple');
    await setv('pr-scale', 'fit'); await setv('pr-orient', 'auto'); await setv('pr-paper', '210x297'); await setv('pr-margin', '1'); await settle();
    check('marge 1 mm < 4,2 mm : message chiffré', /1 mm/.test(await txt('pr-warn')) && /4,2 mm/.test(await txt('pr-warn')), await txt('pr-warn'));
    check('zone hachurée affichée (4 bandes)', (await c.ev(`(()=>{const h=document.getElementById('pr-hard'); return !h.hidden && h.children.length===4})()`)) === true);
    check('le message annonce la coupe en mm', /coupés/.test(await txt('pr-warn')) && /\d(,\d)? mm de contenu/.test(await txt('pr-warn')), await txt('pr-warn'));
    await setv('pr-margin', '6'); await settle();
    check('marge 6 mm ≥ 4,2 mm : plus d\'avertissement ni de zone hachurée', !/matérielle/.test(await txt('pr-warn')) && (await c.ev(`document.getElementById('pr-hard').hidden`)) === true, await txt('pr-warn'));

    console.log('4. Couleur : information, jamais un interdit');
    await pick('PDFCreator');
    check('« Couleur » reste sélectionnable pour une imprimante sans couleur annoncée', (await c.ev(`!document.querySelector('#pr-color option[value=color]').disabled`)) === true);
    check('aucune bascule automatique : « Couleur » reste choisi', (await val('pr-color')) === 'color', await val('pr-color'));
    check('note discrète : « Ce pilote n\'annonce pas la couleur »', /n'annonce pas la couleur/.test(await txt('pr-cnote')), await txt('pr-cnote'));
    check('imprimante PDF : « le résultat reste vectoriel »', /Imprimante PDF : le résultat reste vectoriel/.test(await txt('pr-cnote')), await txt('pr-cnote'));
    check('mention « Impression vectorielle »', /vectorielle/.test(await txt('pr-rnote')));
    await c.ev(`document.querySelector('input[name=pr-pages][value=current]').click()`); await settle();
    clearOut();
    await c.click('#pr-ok'); await waitJob(); await sleep(500);
    const j = jobs();
    const info = await pdfInfo(path.join(out, 'job-1.pdf'));
    check('tâche vers l\'imprimante sans couleur annoncée : couleur demandée, PDF vectoriel (texte, aucune image de page)', j.opts.color === true && info.images === 0 && /Doc A/.test(info.text), { opts: j.opts, info });

    console.log('5. Autre imprimante : couleur non grisée, note absente');
    await c.ev(`document.body.click()`); await key('p', 'KeyP', 80, 2); await sleep(1500);
    await pick('Autre imprimante');
    check('pas de note « n\'annonce pas la couleur »', !/n'annonce pas/.test(await txt('pr-cnote')) && !/Imprimante PDF/.test(await txt('pr-cnote')), await txt('pr-cnote'));
    await pick('PDFCreator');
    await setv('pr-color', 'gray'); await settle();
    check('niveaux de gris choisis par l\'utilisateur : mention de rasterisation, plus de « reste vectoriel »', /rasterise/.test(await txt('pr-rnote')) && !/reste vectoriel/.test(await txt('pr-cnote')), { r: await txt('pr-rnote'), c: await txt('pr-cnote') });
    await setv('pr-color', 'color');
    await pick('Autre imprimante'); await pick('PDFCreator');
    check('« Couleur » conservé après plusieurs changements d\'imprimante', (await val('pr-color')) === 'color');
    await c.click('#pr-cancel'); await sleep(300);

    console.log('6. Nom du travail d\'impression');
    clearOut();
    await c.ev(`document.body.click()`); await key('p', 'KeyP', 80, 2); await sleep(1500);
    await pick('Autre imprimante');
    await c.ev(`document.querySelector('input[name=pr-pages][value=all]').click()`); await setv('pr-paper', '210x297'); await settle();
    await c.click('#pr-ok'); await waitJob(); await sleep(800);
    const j1 = jobs();
    check('un seul format : titre = nom du document (avec .pdf, sans chemin)', j1.jobs.length === 1 && j1.jobs[0].title === 'a-huit-pages.pdf' && j1.jobs[0].fileName === 'a-huit-pages.pdf', j1.jobs[0]);
    const t1 = (await PDFLib.PDFDocument.load(fs.readFileSync(path.join(out, 'job-1.pdf')))).getTitle();
    check('métadonnée /Title du PDF d\'impression = nom du document', t1 === 'a-huit-pages.pdf', t1);
    check('nom du travail transmis (document sans chemin)', j1.name === 'a-huit-pages.pdf', j1.name);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
    try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : options d\'impression (interface).');
})();
