// Tests d'interface de l'onglet Mesure (lot 2b-2) : échelle, aimantation, outils, unités, verrouillage, panneau, CSV, PDF, persistance.
// Fenêtre hors écran (SPIN_TEST_HEADLESS=1 par défaut). Usage : node test/test-measure-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');
const { launchApp, sleep } = require('./lib/app.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

async function pdfTexts(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fontDir = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts').split('\\').join('/') + '/';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), standardFontDataUrl: fontDir, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  return (await page.getTextContent()).items.map((i) => i.str).filter((s) => s.trim());
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-measure-ui-'));
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-measure-save-'));
  // Plan de test : deux lignes qui se croisent, un rectangle (pour l'aimantation). Coordonnées PDF (origine en bas à gauche).
  const d = await PDFLib.PDFDocument.create();
  const pg = d.addPage([595, 842]);
  pg.drawLine({ start: { x: 100, y: 780 }, end: { x: 300, y: 780 }, thickness: 1 });
  pg.drawLine({ start: { x: 150, y: 730 }, end: { x: 250, y: 830 }, thickness: 1 });
  pg.drawRectangle({ x: 100, y: 600, width: 200, height: 100, borderWidth: 1, borderColor: PDFLib.rgb(0, 0, 0) });
  const planPath = path.join(dir, 'plan-mesures.pdf');
  fs.writeFileSync(planPath, await d.save());

  const c = await launchApp({ files: [planPath], env: { SPINADOC_TEST_SAVE_DIR: saveDir } });
  const J = async (e) => JSON.parse(await c.ev(e));
  const userData = c.userData;
  let scalesJson = null; // le dossier utilisateur est supprimé à la fermeture : on garde le fichier des échelles
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(800);
    const SC = 4 / 3;
    const P = async (x, yPdf) => { const [l, t] = await c.rect('.docview.active .page'); return [l + x * SC, t + (842 - yPdf) * SC]; }; // point PDF → écran
    const move = async (x, y) => c.mouse('mouseMoved', ...(await P(x, y)));
    const click = async (x, y, clickCount = 1) => {
      const [sx, sy] = await P(x, y);
      await c.mouse('mouseMoved', sx, sy);
      await c.mouse('mousePressed', sx, sy, { clickCount });
      await c.mouse('mouseReleased', sx, sy, { clickCount });
      await sleep(120);
    };
    const dbl = async (x, y) => { await click(x, y); await click(x, y, 2); }; // dernier sommet puis double-clic : termine le tracé
    const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
    const texts = () => J(`JSON.stringify([...document.querySelectorAll('.docview.active .page:nth-child(1) .objs text')].map(t=>t.textContent))`);
    const edits = () => J(`import('./js/ui.js').then(m=>JSON.stringify(m.store.active.edits.map(e=>({id:e.id,type:e.type,points:e.points,lockedText:e.lockedText,holes:e.holes}))))`);
    const label = () => c.ev(`document.getElementById('scale-label').textContent`);
    const setSelect = (id, v) => c.ev(`(()=>{const s=document.getElementById(${JSON.stringify(id)});s.value=${JSON.stringify(v)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

    // ------------------------------------------------------------ 1. échelle
    console.log('1. Échelle');
    await c.click('#rtab-measure'); await sleep(200);
    check('onglet Mesure affiché', await c.ev(`!document.getElementById('rpanel-measure').hidden`) === true);
    check('échelle non définie au départ', (await label()).includes('non définie'), await label());
    await c.click('#scale-label'); await sleep(200);
    check('boîte d\'échelle ouverte', await c.ev(`!document.getElementById('mcdlg').hidden`) === true);
    await setSelect('mc-preset', '50');
    await c.click('#mc-ok'); await sleep(300);
    check('échelle 1:50 appliquée', (await label()).includes('1:50'), await label());

    // ------------------------------------------------------------ 2. distance avec aimantation
    console.log('2. Distance (aimantation)');
    await c.click('#rpanel-measure [data-cmd=tool-m-dist]'); await sleep(200);
    await move(120, 780); await sleep(500); // le premier survol calcule l'index d'aimantation de la page
    await move(103, 783); await sleep(150);
    const mark = await c.ev(`document.querySelectorAll('.docview.active .snap-mark').length`);
    check('indicateur d\'accroche visible près d\'une extrémité', mark === 1, mark);
    await click(103, 783);
    await click(297, 777);
    await sleep(200);
    let t = await texts();
    check('distance accrochée aux extrémités : 200 pt à 1:50 = 3,53 m', t.includes('3,53 m'), t);
    let e = await edits();
    check('points exacts (100,780) et (300,780)', e.length === 1 && near(e[0].points[0][0], 100, 1e-6) && near(e[0].points[1][0], 300, 1e-6) && near(e[0].points[1][1], 780, 1e-6), e);

    // intersection des deux lignes (200,780)
    await click(203, 783);
    await click(260, 820);
    e = await edits();
    check('accrochage à l\'intersection des lignes (200,780)', e.length === 2 && near(e[1].points[0][0], 200, 1e-6) && near(e[1].points[0][1], 780, 1e-6), e[1] && e[1].points);

    // Échap annule un tracé en cours
    await c.click('#rpanel-measure [data-cmd=tool-m-poly]'); await sleep(150);
    await click(400, 500); await click(450, 500);
    await key('Escape', 'Escape', 27); await sleep(150);
    check('Échap annule la polyligne en cours', (await edits()).length === 2);

    // ------------------------------------------------------------ 3. surface, trou, angle, cote, cercle
    console.log('3. Surface, trou, angle, cote, cercle');
    await c.click('#rpanel-measure [data-cmd=tool-m-area]'); await sleep(150);
    await click(103, 697); await click(297, 697); await click(297, 603); await dbl(103, 603); // double-clic final
    await sleep(200);
    t = await texts();
    const A_m2 = (200 * 0.352777778 * 50 / 1000) * (100 * 0.352777778 * 50 / 1000);
    check(`surface du rectangle accrochée (${A_m2.toFixed(2).replace('.', ',')} m²)`, t.some((s) => s.startsWith('S = ' + A_m2.toFixed(2).replace('.', ',') + ' m²')), t);
    await c.click('#rpanel-measure [data-cmd=tool-m-hole]'); await sleep(150);
    await click(150, 670); await click(200, 670); await click(200, 630); await dbl(150, 630);
    await sleep(200);
    e = await edits();
    const area = e.find((x) => x.type === 'm-area');
    check('trou ajouté à la surface', area && area.holes && area.holes.length === 1, area);
    t = await texts();
    const holeM2 = (50 * 0.352777778 * 50 / 1000) * (40 * 0.352777778 * 50 / 1000);
    check('surface nette = surface − trou', t.some((s) => s.startsWith('S = ' + (A_m2 - holeM2).toFixed(2).replace('.', ',') + ' m²')), t);

    await c.click('#rpanel-measure [data-cmd=tool-m-angle]'); await sleep(150);
    await click(400, 700); await click(350, 700); await click(350, 750);
    t = await texts();
    check('angle droit : 90,00°', t.includes('90,00°'), t);
    await c.click('#rpanel-measure [data-cmd=tool-m-dim]'); await sleep(150);
    await click(400, 650); await click(500, 650);
    t = await texts();
    check('cote : valeur 100 pt à 1:50 = 1,76 m', t.includes('1,76 m'), t);
    await c.click('#rpanel-measure [data-cmd=tool-m-circle]'); await sleep(150);
    await click(500, 560); await click(450, 610); await click(400, 560);
    t = await texts();
    check('cercle : diamètre 100 pt à 1:50 = 1,76 m', t.some((s) => s.startsWith('Ø 1,76 m')), t);
    await key('Escape', 'Escape', 27); await sleep(150);

    // ------------------------------------------------------------ 4. unité, décimales, échelle, verrouillage
    console.log('4. Unité, décimales, échelle, verrouillage');
    await setSelect('m-unit', 'cm'); await sleep(250);
    t = await texts();
    check('unité cm : 352,78 cm', t.includes('352,78 cm'), t);
    await setSelect('m-prec', '0'); await sleep(250);
    t = await texts();
    check('0 décimale : 353 cm', t.includes('353 cm'), t);
    await setSelect('m-unit', 'm'); await setSelect('m-prec', '2'); await sleep(250);

    // verrouille la 1re distance (via le panneau Mesures), puis change l'échelle
    await c.click('#rpanel-measure [data-cmd=m-panel]'); await sleep(400);
    const rows = await c.ev(`document.querySelectorAll('#sb-measures tr.m-row').length`);
    check('panneau Mesures : une ligne par mesure (6)', rows === 6, rows);
    const tot = await c.ev(`document.querySelectorAll('#sb-measures .m-tot li').length`);
    check('panneau Mesures : totaux par type', tot >= 5, tot);
    await c.click('#sb-measures tr.m-row'); await sleep(250);
    const sel = await J(`import('./js/ui.js').then(m=>JSON.stringify(m.store.active.selection))`);
    check('clic sur une ligne : mesure sélectionnée', sel.length === 1, sel);
    await c.click('#rpanel-measure [data-cmd=m-lock]'); await sleep(250);
    e = await edits();
    check('valeur verrouillée', e.filter((x) => x.lockedText).length === 1 && e.find((x) => x.lockedText).lockedText === '3,53 m', e.map((x) => x.lockedText));
    await c.click('#scale-label'); await sleep(200);
    await setSelect('mc-preset', '100');
    await c.click('#mc-ok'); await sleep(300);
    t = await texts();
    check('échelle 1:100 : la valeur verrouillée reste 3,53 m', t.includes('3,53 m'), t);
    check('échelle 1:100 : la cote (100 pt) est recalculée : 3,52 ou 3,53 m', t.some((s) => /^3,5[23] m$/.test(s)), t);

    // calibrage par deux points : 200 pt ↔ 10 m
    await c.click('#rpanel-measure [data-cmd=tool-m-calib]'); await sleep(150);
    await click(103, 783); await click(297, 777);
    await sleep(300);
    check('calibrage : la boîte s\'ouvre en mode « deux points »', await c.ev(`!document.getElementById('mcdlg').hidden && !document.getElementById('mc-pts').hidden`) === true);
    await c.ev(`(()=>{const i=document.getElementById('mc-len');i.value='10';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await c.click('#mc-ok'); await sleep(300);
    check('calibrage : 200 pt ↔ 10 m donne ≈ 1:141,7', (await label()).includes('≈ 1:141,7'), await label());
    t = await texts();
    check('calibrage : la cote de 100 pt vaut maintenant 5 m (4,99 à 5,01)', t.some((s) => /^(4,9[89]|5,0[01]) m$/.test(s)), t);

    // ------------------------------------------------------------ 5. export CSV et PDF
    console.log('5. Export CSV et PDF');
    await c.click('#rpanel-measure [data-cmd=m-csv]'); await sleep(600);
    const csvFile = fs.readdirSync(saveDir).find((f) => f.endsWith('-mesures.csv'));
    check('CSV écrit', !!csvFile, fs.readdirSync(saveDir));
    if (csvFile) {
      const raw = fs.readFileSync(path.join(saveDir, csvFile), 'utf8');
      check('CSV : BOM UTF-8, séparateur « ; », virgule décimale', raw.charCodeAt(0) === 0xfeff && raw.includes('Page;Type;Libellé;Valeur;Unité') && /Distance;;\d+,\d\d;m/.test(raw), raw.slice(0, 200));
    }
    await c.ev(`document.body.click()`);
    await key('s', 'KeyS', 83, 2); await sleep(2500);
    let pdf = fs.readdirSync(saveDir).find((f) => f.endsWith('.pdf'));
    check('PDF enregistré', !!pdf, fs.readdirSync(saveDir));
    if (pdf) {
      const tx = await pdfTexts(path.join(saveDir, pdf));
      check('mesures figées dans le PDF (texte)', tx.includes('3,53 m') && tx.some((s) => /^(5,0[01]|4,9[89]) m$/.test(s)), tx);
      fs.unlinkSync(path.join(saveDir, pdf));
      await c.click('#rpanel-measure [data-cmd=m-include]'); await sleep(250);
      check('« Dans le PDF » désactivé', await c.ev(`document.querySelector('[data-cmd=m-include]').getAttribute('aria-pressed')`) === 'false');
      await c.ev(`document.body.click()`);
      await key('s', 'KeyS', 83, 2); await sleep(2500);
      pdf = fs.readdirSync(saveDir).find((f) => f.endsWith('.pdf'));
      const tx2 = pdf ? await pdfTexts(path.join(saveDir, pdf)) : ['?'];
      check('mesures exclues du PDF quand l\'interrupteur est coupé', pdf && tx2.length === 0, tx2);
      check('mesures toujours visibles à l\'écran', (await texts()).length > 0);
    }
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (err) {
    check('exécution sans exception', false, String(err && err.stack || err));
  } finally {
    try { scalesJson = fs.readFileSync(path.join(userData, 'measure-scales.json'), 'utf8'); } catch { /* */ }
    await c.close();
  }

  // ------------------------------------------------------------ 6. persistance de l'échelle (même fichier, même dossier utilisateur)
  console.log('6. Persistance de l\'échelle');
  const c2 = await launchApp({ files: [planPath], userDataFiles: scalesJson ? { 'measure-scales.json': scalesJson } : {} });
  try {
    await c2.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(1200);
    const lab = await c2.ev(`document.getElementById('scale-label').textContent`);
    check('échelle retrouvée à la réouverture du fichier', lab.includes('≈ 1:'), lab);
  } catch (err) {
    check('réouverture sans exception', false, String(err && err.stack || err));
  } finally {
    await c2.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : onglet Mesure (interface).');
})();
