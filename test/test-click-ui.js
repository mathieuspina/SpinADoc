// Cliquabilité RÉELLE de chaque vue : aucun élément interactif visible n'est recouvert ni placé dans une région de déplacement de la
// fenêtre (-webkit-app-region: drag). Usage : node test/test-click-ui.js
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');
const { SCRIPT } = require('./lib/clickable.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

(async () => {
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const c = await launchApp({ files: [], env: { SPINADOC_TEST_OPEN: JSON.stringify([f.a]) } });
  const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
  const view = async (label, scope, minN = 1) => {
    const r = JSON.parse(await c.ev(SCRIPT(scope)));
    check(`${label} : ${r.n} éléments interactifs, tous cliquables`, r.n >= minN && r.bad.length === 0, r.bad.length ? r.bad.slice(0, 6) : { n: r.n });
  };
  const show = (id) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)}); e.hidden=false; return 1})()`);
  const hide = (id) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)}); e.hidden=true; return 1})()`);
  try {
    await c.waitFor(`document.getElementById('welcome')`, 15000);
    await sleep(800);
    console.log('1. Accueil (aucun document)');
    await view('accueil', '#topbar', 3);
    await view('accueil, zone centrale', '#welcome', 1);

    console.log('2. Document ouvert : chaque onglet du ruban');
    await c.click('#welcome-open'); await sleep(2500);
    for (const t of ['home', 'annotate', 'pages', 'measure', 'forms', 'document', 'view']) {
      await c.click('#rtab-' + t); await sleep(250);
      await view('ruban « ' + t + ' »', '#rpanel-' + t, 3);
    }
    await view('barre du haut', '#topbar', 5);

    console.log('3. Espace de fusion plein écran');
    await c.click('#rtab-home'); await c.click('#rpanel-home [data-cmd=merge-open]'); await sleep(500);
    await view('espace de fusion', '#mergews', 4);
    await c.click('#mw-cancel'); await sleep(300);

    console.log('3b. Espace de comparaison plein écran');
    await c.click('#rtab-document'); await c.click('#rpanel-document [data-cmd=doc-compare]'); await sleep(900);
    await view("espace de comparaison (barre d'outils, listes, zone d'affichage)", '#cmpws', 25);
    await c.click('#cmp-m-side'); await sleep(200); await view('comparaison, côte à côte', '#cmpws', 25);
    await c.click('#cmp-m-fade'); await sleep(200); await view('comparaison, fondu', '#cmpws', 25);
    await c.click('#cmp-close'); await sleep(300);
    check('comparaison fermée', await c.ev(`document.getElementById('cmpws').hidden`));

    console.log('3c. Boite de reglages de l OCR');
    await c.click('#rtab-document'); await c.click('#rpanel-document [data-cmd=doc-ocr]'); await sleep(600);
    await view('boîte OCR (portée, langues, qualité, type de page…)', '#pgdlg', 8);
    await c.click('#pgdlg-cancel'); await sleep(300);

    console.log('3d. Caviardage : panneau Rechercher et caviarder, boîtes Appliquer et Métadonnées');
    await c.click('#rtab-document'); await c.click('#rpanel-document [data-cmd=rdx-find]'); await sleep(300);
    await c.ev(`(()=>{const q=document.getElementById('rdx-q'); q.value='Doc'; return 1})()`); await c.click('#rdx-search'); await sleep(1500);
    await view('panneau « Rechercher et caviarder » (avec résultats)', '#rdx-find', 9);
    await c.click('#rdx-close'); await sleep(200);
    await c.click('#rpanel-document [data-cmd=rdx-meta]'); await sleep(500);
    await view('boîte « Nettoyer les métadonnées »', '#rdx-meta', 10);
    await c.click('#rdx-meta-cancel'); await sleep(200);
    await show('rdx-apply'); await sleep(150); await view('boîte « Appliquer le caviardage »', '#rdx-apply', 6); await hide('rdx-apply');

    console.log('4. Boîtes de dialogue et panneaux');
    await c.click('#btn-settings'); await sleep(300);
    await view('réglages', '#settings', 3); await c.click('#btn-winint'); await sleep(200);
    await view('intégration à Windows (lecteur PDF)', '#winint', 2); await c.click('#winint-close'); await sleep(200);
    await c.ev(`document.body.click()`); await key('p', 'KeyP', 80, 2); await sleep(2000);
    await view('boîte d\'impression', '#printdlg', 5); await c.click('#pr-cancel'); await sleep(200);
    await c.click('#btn-help'); await sleep(300); await view('aide (sommaire, recherche, fermer)', '#helpws', 15); await c.click('#help-close'); await sleep(200);
    for (const id of ['mcdlg', 'unsaved', 'stampdlg', 'sigdlg', 'pgdlg', 'numdlg', 'fldorder', 'about']) { await show(id); await sleep(150); await view('boîte #' + id, '#' + id, 2); await hide(id); }
    await c.click('#props-toggle'); await sleep(400);
    await view('panneau Propriétés', '#props', 0);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : cliquabilité réelle.');
})();
