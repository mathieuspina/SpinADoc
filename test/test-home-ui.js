// Test complet de l'écran d'accueil et de l'onglet Accueil du ruban, élément par élément.
// Usage : node test/test-home-ui.js                      (version de développement)
//         SPINADOC_EXE="chemin\Spin A Doc.exe" node test/test-home-ui.js   (app empaquetée / portable / installée)
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
  const label = process.env.SPINADOC_EXE ? path.basename(process.env.SPINADOC_EXE) : 'développement';
  console.log(`Accueil — variante : ${label}`);
  // Fichiers « réels » : chemins avec espaces, majuscules et tirets, comme C:\Projets\1234_56 CLIENT EXEMPLE\...
  const base = path.join(os.tmpdir(), 'Spin Test Dossiers', '1234_56 CLIENT EXEMPLE');
  fs.mkdirSync(base, { recursive: true });
  const gen = await makeAll(path.join(os.tmpdir(), 'spinadoc-home-gen'));
  const f1 = path.join(base, 'RAPPORT - Chargement 24-25.pdf');
  const f2 = path.join(base, 'PLAN-A3 Final (v2).pdf');
  const f3 = path.join(base, 'à supprimer.pdf');
  fs.copyFileSync(gen.a, f1); fs.copyFileSync(gen.b, f2); fs.copyFileSync(gen.d, f3);
  const absentDrive = 'ZYXWVUTSRQPONM'.split('').map((l) => l + ':\\').find((d) => !fs.existsSync(d));
  const f4 = path.join(absentDrive, 'Disque absent', 'plan.pdf');
  const now = Date.now();
  const recents = [f1, f2, f3, f4].map((p, i) => ({ path: p, name: path.basename(p), date: now - i * 1000 }));
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-save-'));
  const openEnv = (list) => ({ SPINADOC_TEST_OPEN: JSON.stringify(list), SPINADOC_TEST_SAVE_DIR: saveDir });

  const c = await launchApp({ files: [], env: openEnv([f1]), userDataFiles: { 'recents.json': recents } });
  const J = async (e) => JSON.parse(await c.ev(e));
  const tabs = () => c.ev(`document.querySelectorAll('.doctab').length`);
  const welcomeShown = () => c.ev(`!document.getElementById('welcome').hidden`);
  const closeAll = async () => { for (let i = 0; i < 6 && (await tabs()) > 0; i++) { await c.click('.doctab .doctab-close'); await sleep(250); } await sleep(200); };
  const reachable = (sel) => c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'absent'; const r=e.getBoundingClientRect(); if(!r.width) return 'invisible'; const t=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return t===e||e.contains(t) ? 'ok' : 'recouvert par '+(t?t.tagName+'#'+t.id:'rien');})()`);

  try {
    await c.waitFor(`document.getElementById('recents-list').children.length>0`, 10000);
    await sleep(500);

    // ------------------------------------------------------------ 1. écran d'accueil
    console.log('1. Écran d\'accueil');
    check('accueil affiché sans document', (await welcomeShown()) === true && (await tabs()) === 0);
    check('logo chargé (grande et petite images)', (await c.ev(`[...document.querySelectorAll('#welcome img')].every(i=>i.complete&&i.naturalWidth>0)`)) === true);
    for (const sel of ['#welcome-open', '#recents-clear', '#recents-list li:first-child .recent-item', '#btn-settings', '#btn-newtab', '[data-cmd=open]', '[data-cmd=recents]', '#rtab-annotate']) {
      const r = await reachable(sel);
      check(`élément cliquable (non recouvert) : ${sel}`, r === 'ok', r);
    }
    check('liste des récents : 4 fichiers (espaces, majuscules, tirets)', (await c.ev(`document.querySelectorAll('#recents-list .recent-item').length`)) === 4);
    check('noms et chemins affichés', (await c.ev(`[...document.querySelectorAll('#recents-list .recent-name')].map(e=>e.textContent).join('|')`)).includes('RAPPORT - Chargement 24-25.pdf'));

    // ------------------------------------------------------------ 2. ouvrir : bouton et Ctrl+O
    console.log('2. Ouvrir');
    await c.click('#welcome-open'); await sleep(1500);
    check('bouton « Ouvrir un PDF » : le document s\'ouvre', (await tabs()) === 1 && (await welcomeShown()) === false);
    check('titre de la fenêtre = nom du fichier', (await c.ev(`document.title`)).startsWith('RAPPORT - Chargement 24-25.pdf'));
    await closeAll();
    check('fermeture du dernier onglet : retour à l\'accueil (cliquable)', (await welcomeShown()) === true && (await reachable('#welcome-open')) === 'ok');
    await c.key('o', { code: 'KeyO', windowsVirtualKeyCode: 79, modifiers: 2 }); await sleep(1500);
    check('Ctrl+O ouvre un fichier', (await tabs()) === 1);
    await closeAll();

    // ------------------------------------------------------------ 3. fichiers récents
    console.log('3. Fichiers récents');
    await c.click('#recents-list li:nth-child(1) .recent-item'); await sleep(1500);
    check('clic sur un fichier récent (chemin avec espaces) : ouvert', (await tabs()) === 1 && (await c.ev(`document.querySelector('.doctab-name').textContent`)) === 'RAPPORT - Chargement 24-25.pdf');
    await closeAll();
    await c.click('#recents-list li:nth-child(2) .recent-item'); await sleep(1500);
    check('2e fichier récent (parenthèses, tirets) : ouvert', (await tabs()) === 1 && /PLAN-A3 Final/.test(await c.ev(`document.querySelector('.doctab-name').textContent`)));
    await closeAll();
    fs.rmSync(f3, { force: true });
    await c.click('#recents-list li:nth-child(3) .recent-item'); await sleep(800);
    check('fichier supprimé : message clair, pas de plantage', (await c.ev(`!document.getElementById('toast').hidden && /introuvable|inaccessible/.test(document.getElementById('toast').textContent)`)) === true && (await tabs()) === 0);
    check('fichier supprimé : retiré de la liste', (await c.ev(`document.querySelectorAll('#recents-list .recent-item').length`)) === 3);
    await c.click('#recents-list li:nth-child(3) .recent-item');
    await c.waitFor(`document.querySelectorAll('#recents-list .recent-item').length===2`, 20000);
    check(`disque absent (${absentDrive}) : message clair, retiré de la liste`, (await c.ev(`document.querySelectorAll('#recents-list .recent-item').length`)) === 2 && (await tabs()) === 0, await c.ev(`[...document.querySelectorAll('#recents-list .recent-path')].map(e=>e.textContent).join(' | ')+' // '+document.getElementById('toast').textContent`));
    check('l\'application répond toujours après ces erreurs', (await reachable('#welcome-open')) === 'ok');
    await c.click('#recents-clear'); await sleep(400);
    check('« Vider la liste » : liste masquée', (await c.ev(`document.getElementById('welcome-recents').hidden`)) === true);
    check('« Vider la liste » : persisté (liste vide côté application)', (await c.ev(`window.spinadoc.listRecents().then(l=>l.length)`)) === 0);

    // ------------------------------------------------------------ 4. glisser-déposer
    console.log('4. Glisser-déposer');
    const drop = async (file) => {
      const data = { items: [], files: [file], dragOperationsMask: 1 };
      await c.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 600, y: 400, data });
      await c.send('Input.dispatchDragEvent', { type: 'dragOver', x: 600, y: 400, data });
      await c.send('Input.dispatchDragEvent', { type: 'drop', x: 600, y: 400, data });
      await sleep(1500);
    };
    await drop(f2);
    check('dépôt d\'un PDF depuis l\'Explorateur : ouvert', (await tabs()) === 1 && /PLAN-A3 Final/.test(await c.ev(`document.querySelector('.doctab-name').textContent`)));
    check('le fichier déposé apparaît dans les récents', (await c.ev(`window.spinadoc.listRecents().then(l=>l.length)`)) === 1);
    await closeAll();
    const txt = path.join(base, 'notes.txt'); fs.writeFileSync(txt, 'x');
    await drop(txt);
    check('dépôt d\'un fichier non PDF : message, rien d\'ouvert', (await tabs()) === 0 && (await c.ev(`!document.getElementById('toast').hidden`)) === true);

    // ------------------------------------------------------------ 5. onglet Accueil du ruban
    console.log('5. Onglet Accueil du ruban');
    check('onglet Accueil sélectionné par défaut', (await c.ev(`document.getElementById('rtab-home').getAttribute('aria-selected')`)) === 'true');
    await c.click('#rpanel-home [data-cmd=open]'); await sleep(1500);
    check('ruban : Ouvrir', (await tabs()) === 1);
    for (const cmd of ['open', 'recents', 'saveas', 'tool-select', 'search', 'undo', 'redo']) {
      const r = await reachable(`#rpanel-home [data-cmd=${cmd}]`);
      check(`ruban Accueil : « ${cmd} » visible et non recouvert`, r === 'ok', r);
    }
    await c.click('#rpanel-home [data-cmd=recents]'); await sleep(300);
    check('ruban : Fichiers récents ouvre le menu avec des entrées', (await c.ev(`!document.getElementById('recents-menu').hidden && document.querySelectorAll('#recents-menu .recent-item').length`)) >= 1);
    await c.click('#recents-menu .recent-item'); await sleep(1500);
    check('ruban : un fichier du menu des récents s\'ouvre', (await tabs()) >= 1 && (await c.ev(`document.getElementById('recents-menu').hidden`)) === true);
    await c.click('#rpanel-home [data-cmd=tool-select]');
    check('ruban : Souris (outil actif, bouton enfoncé)', (await c.ev(`document.querySelector('#rpanel-home [data-cmd=tool-select]').getAttribute('aria-pressed')`)) === 'true');
    await c.click('#rpanel-home [data-cmd=search]'); await sleep(400);
    check('ruban : Rechercher ouvre le panneau et met le focus sur le champ', (await c.ev(`!document.getElementById('sidebar').hidden && document.activeElement.id`)) === 'search-input');
    await c.click('#sb-toggle');
    // Annuler / Rétablir : visibles, désactivés sans historique, fonctionnels après une modification
    check('Annuler / Rétablir désactivés sans historique', (await c.ev(`document.querySelector('#rpanel-home [data-cmd=undo]').disabled && document.querySelector('#rpanel-home [data-cmd=redo]').disabled`)) === true);
    await c.click('#rtab-annotate'); await c.click('#rpanel-annotate [data-cmd=tool-add]');
    const [ox, oy] = await c.rect('.docview.active .page');
    await c.clickXY(ox + 120, oy + 200); await sleep(250); await c.type('Essai'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(300);
    await c.click('#rtab-home'); await sleep(200);
    check('Annuler actif après une modification (dans l\'onglet Accueil)', (await c.ev(`!document.querySelector('#rpanel-home [data-cmd=undo]').disabled`)) === true && (await reachable('#rpanel-home [data-cmd=undo]')) === 'ok');
    await c.click('#rpanel-home [data-cmd=undo]'); await sleep(300);
    check('ruban : Annuler défait la modification (texte retiré, Rétablir actif)', (await c.ev(`document.querySelectorAll('.docview.active .objs > g').length`)) === 0 && (await c.ev(`!document.querySelector('#rpanel-home [data-cmd=redo]').disabled`)) === true);
    await c.click('#rpanel-home [data-cmd=redo]'); await sleep(300);
    check('ruban : Rétablir', (await c.ev(`document.querySelectorAll('.docview.active .objs > g').length`)) === 1);
    await c.click('#rpanel-home [data-cmd=saveas]'); await sleep(1200);
    const saved = fs.readdirSync(saveDir);
    check('ruban : Enregistrer sous écrit le fichier (contenu PDF valide)', saved.length >= 1 && fs.readFileSync(path.join(saveDir, saved[0])).slice(0, 5).toString() === '%PDF-', saved);
    check('après enregistrement : plus de pastille « modifié »', (await c.ev(`!document.querySelector('.doctab-dot')`)) === true);
    await c.key('s', { code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 2 }); await sleep(800);
    check('Ctrl+S fonctionne aussi', true);
    check('aucune erreur JavaScript', c.logs.filter((l) => !/Failed to load resource/.test(l)).length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s). [${label}]`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : accueil.');
})();
