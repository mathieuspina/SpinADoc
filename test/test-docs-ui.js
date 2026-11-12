// Onglet Document (interface, hors écran) : export PNG/JPG (plage, dpi, dimensions, résolution écrite, interface réactive), propriétés (historique,
// relecture après enregistrement), ouverture d'un PDF protégé (mot de passe faux puis bon, réenregistrement protégé), « Protéger », « Optimiser ».
// Usage : node test/test-docs-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');
const IM = require('../src/image-meta.js');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

(async () => {
  const dir = path.join(os.tmpdir(), 'spinadoc-ui-pdfs');
  const f = await makeAll(dir);
  const enc = path.join(dir, 'protege-docs.pdf');
  {
    const d = await PDFLib.PDFDocument.create();
    d.addPage([595, 842]).drawText('Secret page 1', { x: 50, y: 700 });
    d.addPage([595, 842]).drawText('Secret page 2', { x: 50, y: 700 });
    d.setTitle('Titre secret');
    d.encrypt({ userPassword: 'sesame', ownerPassword: 'sesame2', permissions: { printing: true } });
    fs.writeFileSync(enc, await d.save());
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-docs-out-'));
  const c = await launchApp({ files: [f.c, enc], env: { SPINADOC_TEST_SAVE_DIR: out } });
  const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
  const doc = (expr) => c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const setv = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const radio = (id, v) => c.ev(`(()=>{const r=document.querySelector('input[name=pgf-${id}][value="${v}"]'); r.checked=true; r.dispatchEvent(new Event('input',{bubbles:true})); return 1})()`);
  const dlgOpen = () => c.ev(`!document.getElementById('pgdlg').hidden`);
  const files = (re) => fs.readdirSync(out).filter((n) => re.test(n)).sort();
  const sizeOf = (n) => IM.size(new Uint8Array(fs.readFileSync(path.join(out, n))));
  const dpiOf = (n) => IM.dpiOf(new Uint8Array(fs.readFileSync(path.join(out, n))));
  async function fillPw(pw) {
    await c.waitFor(`!document.getElementById('pgdlg').hidden`, 8000);
    await c.ev(`(()=>{const e=document.getElementById('pgf-pw'); e.value=${JSON.stringify(pw)}; return 1})()`);
    await c.click('#pgdlg-ok'); await sleep(900);
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    console.log('1. Ouverture d\'un PDF protégé (ouvert au démarrage)');
    await c.waitFor(`!document.getElementById('pgdlg').hidden`, 20000);
    check('mot de passe demandé', /protégé/.test(await c.ev(`document.getElementById('pgdlg-intro').textContent`)), await c.ev(`document.getElementById('pgdlg-intro').textContent`));
    await c.ev(`(()=>{const e=document.getElementById('pgf-pw'); e.value='faux'; return 1})()`); await c.click('#pgdlg-ok'); await sleep(1200);
    check('mot de passe faux : message clair, boîte conservée', (await dlgOpen()) && /incorrect/.test(await c.ev(`document.getElementById('pgdlg-intro').textContent`)), await c.ev(`document.getElementById('pgdlg-intro').textContent`));
    await fillPw('sesame');
    await c.waitFor(`document.querySelectorAll('.docview canvas').length>0`, 15000); await sleep(800);
    check('bon mot de passe : 2 onglets (c-mixte + protégé), 2 pages lisibles', (await c.ev(`document.querySelectorAll('.doctab').length`)) === 2 && (await doc('d.pages.length')) === 2 && (await doc('d.name')) === 'protege-docs.pdf');
    check('document pas modifié à l\'ouverture', (await doc('d.dirty')) === false);
    check('propriétés lues dans le fichier chiffré : « Titre secret »', (await doc('d.info && d.info.title')) === 'Titre secret', await doc('d.info'));
    await c.ev(`document.body.click()`); await key('s', 'KeyS', 83, 2); await sleep(1500);
    const saved = path.join(out, 'protege-docs.pdf');
    let ok = fs.existsSync(saved);
    check('enregistrement : le fichier est de nouveau protégé (même mot de passe)', ok, await c.ev(`document.getElementById('toast').textContent`));
    if (ok) {
      let pwErr = null;
      try { await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(saved)), verbosity: 0 }).promise; } catch (e) { pwErr = e.name; }
      check('sans mot de passe : refusé', pwErr === 'PasswordException', pwErr);
      const p = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(saved)), verbosity: 0, password: 'sesame' }).promise;
      check('avec le mot de passe : 2 pages, texte et titre conservés', p.numPages === 2 && /Secret page 2/.test((await (await p.getPage(2)).getTextContent()).items[0].str) && (await p.getMetadata()).info.Title === 'Titre secret');
    }
    await c.click('.doctab:first-child'); await sleep(900);
    check('retour sur « c-mixte »', (await doc('d.name')) === 'c-mixte.pdf' && (await doc('d.pages.length')) === 6);

    console.log('2. Onglet Document : export en images');
    await c.click('#rtab-document'); await sleep(250);
    check('boutons de l\'onglet Document', (await c.ev(`['doc-export-images','doc-properties','doc-optimize','doc-protect'].every((k)=>!!document.querySelector('#rpanel-document [data-cmd='+k+']'))`)) === true);
    await c.click('#rpanel-document [data-cmd=doc-export-images]'); await sleep(400);
    check('boîte d\'export ouverte', /Exporter des pages en images/.test(await c.ev(`document.getElementById('pgdlg-title').textContent`)));
    await setv('pgf-dpi', '72'); await radio('scope', 'range'); await setv('pgf-range', '1-3');
    await c.click('#pgdlg-ok');
    await c.waitFor(`document.getElementById('pgdlg').hidden`, 5000);
    for (let i = 0; i < 60 && files(/\.png$/).length < 3; i++) await sleep(300);
    await sleep(500);
    let png = files(/^c-mixte-page-.*\.png$/);
    check('3 fichiers PNG nommés c-mixte-page-1/2/3', png.join() === 'c-mixte-page-1.png,c-mixte-page-2.png,c-mixte-page-3.png', png);
    check('dimensions à 72 dpi : A3 paysage 1191×842, A4 595×842, A5 420×595', JSON.stringify(png.map((n) => { const s = sizeOf(n); return [s.w, s.h]; })) === JSON.stringify([[1191, 842], [595, 842], [420, 595]]), png.map(sizeOf));
    check('résolution écrite dans le PNG : 72 dpi', Math.abs(dpiOf(png[0]) - 72) < 0.1, dpiOf(png[0]));
    await c.click('#rpanel-document [data-cmd=doc-export-images]'); await sleep(400);
    await setv('pgf-format', 'jpg'); await setv('pgf-dpi', '150'); await radio('scope', 'range'); await setv('pgf-range', '2, 4');
    await c.click('#pgdlg-ok'); await c.waitFor(`document.getElementById('pgdlg').hidden`, 5000);
    for (let i = 0; i < 60 && files(/\.jpg$/).length < 2; i++) await sleep(300);
    await sleep(500);
    const jpg = files(/\.jpg$/);
    check('2 JPEG : pages 2 et 4', jpg.join() === 'c-mixte-page-2.jpg,c-mixte-page-4.jpg', jpg);
    check('dimensions à 150 dpi : A4 1240×1754, A3 paysage 2481×1754', JSON.stringify(jpg.map((n) => { const s = sizeOf(n); return [s.w, s.h]; })) === JSON.stringify([[1240, 1754], [2481, 1754]]), jpg.map(sizeOf));
    check('résolution écrite dans le JPEG : 150 dpi', Math.abs(dpiOf(jpg[0]) - 150) < 0.1, dpiOf(jpg[0]));
    check('notification de progression retirée à la fin', true);
    // trop grand : refus clair
    await c.click('#rpanel-document [data-cmd=doc-export-images]'); await sleep(400);
    await setv('pgf-dpi', '1200'); await radio('scope', 'all');
    await c.click('#pgdlg-ok'); await sleep(400);
    check('résolution excessive : message clair, boîte conservée', (await dlgOpen()) && /trop grande/.test(await c.ev(`document.getElementById('pgdlg-err').textContent`)), await c.ev(`document.getElementById('pgdlg-err').textContent`));
    await setv('pgf-dpi', '10'); await c.click('#pgdlg-ok'); await sleep(300);
    check('résolution trop basse refusée', /entre 36 et 1200/.test(await c.ev(`document.getElementById('pgdlg-err').textContent`)));
    await c.click('#pgdlg-cancel'); await sleep(300);

    // interface réactive pendant un export lourd (toutes les pages à 300 dpi)
    await c.ev(`(()=>{window.__lag={max:0,n:0,last:performance.now()}; window.__lagT=setInterval(()=>{const t=performance.now(); const d=t-window.__lag.last-20; if(d>window.__lag.max) window.__lag.max=d; window.__lag.n++; window.__lag.last=t;},20); return 1})()`);
    // l'export peut finir en moins de 600 ms sur une machine rapide : on enregistre l'état de progression à chaque 10 ms
    await c.ev(`(()=>{window.__seen=[]; window.__seenT=setInterval(()=>{for(const e of document.querySelectorAll('#printq .pq-item')) window.__seen.push({s:e.dataset.state,t:e.querySelector('.pq-status').textContent})},10); return 1})()`);
    await c.click('#rpanel-document [data-cmd=doc-export-images]'); await sleep(400);
    await setv('pgf-dpi', '300'); await radio('scope', 'all');
    await c.click('#pgdlg-ok'); await c.waitFor(`document.getElementById('pgdlg').hidden`, 5000);
    await sleep(600);
    const st = await c.ev(`JSON.stringify(window.__seen)`).then(JSON.parse);
    await c.ev(`clearInterval(window.__seenT)`);
    check('progression affichée pendant l\'export', st.some((x) => x.s === 'running' && /Page|Prépar/.test(x.t)), st);
    await c.click('#rtab-home'); await c.click('#rtab-document');
    for (let i = 0; i < 160 && (await c.ev(`document.querySelectorAll('#printq .pq-item[data-state=running]').length`)) > 0; i++) await sleep(500);
    await sleep(400);
    const lag = await c.ev(`JSON.stringify(window.__lag)`).then(JSON.parse);
    check(`interface réactive pendant l'export : retard maximal ${Math.round(lag.max)} ms (< 400 ms)`, lag.max < 400, lag);
    check('6 pages exportées à 300 dpi (A5 : 1750×2479)', files(/^c-mixte-page-.*\.png$/).length >= 6 && sizeOf('c-mixte-page-3 (2).png') && sizeOf('c-mixte-page-3 (2).png').w === 1750, files(/png$/));
    check('jamais d\'écrasement : « nom (2).png »', files(/\(2\)\.png$/).length >= 3, files(/png$/));

    console.log('3. Propriétés');
    await c.click('#rpanel-document [data-cmd=doc-properties]'); await sleep(400);
    check('boîte de propriétés ouverte, valeurs actuelles', /Propriétés du document/.test(await c.ev(`document.getElementById('pgdlg-title').textContent`)));
    await setv('pgf-title', 'Plan « test » é'); await setv('pgf-author', 'Auteur Exemple'); await setv('pgf-subject', 'Essai'); await setv('pgf-keywords', 'a, b');
    await c.click('#pgdlg-ok'); await sleep(500);
    check('appliqué : document modifié, une étape d\'historique', (await doc('[d.dirty, d.undo.length, d.info.title]')).join() === 'true,1,Plan « test » é');
    await c.ev(`document.body.click()`); await key('z', 'KeyZ', 90, 2); await sleep(400);
    check('Ctrl+Z : propriétés d\'origine, document non modifié', (await doc('[d.info, d.dirty]')).join() === ',false');
    await key('y', 'KeyY', 89, 2); await sleep(400);
    check('Ctrl+Y : propriétés rétablies', (await doc('d.info.title')) === 'Plan « test » é');
    fs.rmSync(path.join(out, 'c-mixte.pdf'), { force: true });
    await key('s', 'KeyS', 83, 2); await sleep(1500);
    const d1 = await PDFLib.PDFDocument.load(fs.readFileSync(path.join(out, 'c-mixte.pdf')), { updateMetadata: false });
    check('relecture après enregistrement : titre, auteur, sujet, mots-clés', d1.getTitle() === 'Plan « test » é' && d1.getAuthor() === 'Auteur Exemple' && d1.getSubject() === 'Essai' && d1.getKeywords() === 'a, b', [d1.getTitle(), d1.getAuthor(), d1.getSubject(), d1.getKeywords()]);
    await c.click('#rpanel-document [data-cmd=doc-properties]'); await sleep(400);
    check('réouverture de la boîte : valeurs enregistrées affichées', (await c.ev(`document.getElementById('pgf-title').value`)) === 'Plan « test » é');
    await c.click('#pgdlg-cancel'); await sleep(200);

    console.log('4. Protéger');
    await c.click('#rpanel-document [data-cmd=doc-protect]'); await sleep(400);
    await c.ev(`(()=>{document.getElementById('pgf-pw').value='abc'; document.getElementById('pgf-pw2').value='abd'; return 1})()`);
    await c.click('#pgdlg-ok'); await sleep(300);
    check('confirmation différente : message, boîte conservée', (await dlgOpen()) && /différents/.test(await c.ev(`document.getElementById('pgdlg-err').textContent`)));
    await c.ev(`(()=>{document.getElementById('pgf-pw').value='motdepasse'; document.getElementById('pgf-pw2').value='motdepasse'; return 1})()`);
    fs.rmSync(path.join(out, 'c-mixte.pdf'), { force: true });
    await c.click('#pgdlg-ok'); await sleep(1800);
    const prot = path.join(out, 'c-mixte.pdf');
    check('fichier protégé écrit', fs.existsSync(prot));
    let e1 = null;
    try { await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(prot)), verbosity: 0 }).promise; } catch (e) { e1 = e.code; }
    check('sans mot de passe : refusé (code 1)', e1 === 1, e1);
    const pj = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(prot)), verbosity: 0, password: 'motdepasse' }).promise;
    check('avec le mot de passe : 6 pages, titre conservé', pj.numPages === 6 && (await pj.getMetadata()).info.Title === 'Plan « test » é');
    check('le document en mémoire reste protégé pour les enregistrements suivants', (await doc('!!d.protect && d.protect.userPassword')) === 'motdepasse');

    console.log('5. Optimiser');
    await c.click('#rpanel-document [data-cmd=doc-optimize]'); await sleep(1500);
    check('boîte d\'optimisation : tailles avant / après', /Taille d'origine/.test(await c.ev(`document.getElementById('pgdlg-body').textContent`)) && /Taille optimisée/.test(await c.ev(`document.getElementById('pgdlg-body').textContent`)), await c.ev(`document.getElementById('pgdlg-body').textContent`));
    fs.rmSync(path.join(out, 'c-mixte.pdf'), { force: true });
    await c.click('#pgdlg-ok'); await sleep(2000);
    const optf = path.join(out, 'c-mixte.pdf');
    check('« Enregistrer sous… » : fichier optimisé écrit', fs.existsSync(optf));
    if (fs.existsSync(optf)) {
      const po = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(optf)), verbosity: 0, password: 'motdepasse' }).promise;
      check('fichier optimisé : 6 pages, toujours protégé, texte identique', po.numPages === 6 && /Doc C - page 1/.test((await (await po.getPage(1)).getTextContent()).items.map((x) => x.str).join(' ')));
    }
    check('document enregistré : non modifié', (await doc('d.dirty')) === false);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
    try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : onglet Document (interface).');
})();
