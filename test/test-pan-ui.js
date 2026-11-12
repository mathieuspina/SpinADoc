// Déplacement du document au clic molette et Espace + glisser (lot 3a-1). Fenêtre hors écran. Usage : node test/test-pan-ui.js
const path = require('path');
const os = require('os');
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
  const c = await launchApp({ files: [f.a] });
  const J = async (e) => JSON.parse(await c.ev(e));
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(800);
    const info = () => J(`import('./js/ui.js').then(m=>{const d=m.store.active,v=d.runtime.viewer;return JSON.stringify({sl:v.scrollLeft,st:v.scrollTop,sw:v.scrollWidth,sh:v.scrollHeight,cw:v.clientWidth,ch:v.clientHeight,tool:d.tool,edits:d.edits.length,sel:d.selection.length,mx:d.runtime.mx?d.runtime.mx.points.length:0,page:d.page,panning:document.body.classList.contains('panning'),ready:document.body.classList.contains('pan-ready')})})`);
    const setScroll = (l, t) => c.ev(`import('./js/ui.js').then(m=>{const v=m.store.active.runtime.viewer;v.scrollLeft=${l};v.scrollTop=${t};})`);
    const zoom = (z) => c.ev(`Promise.all([import('./js/ui.js'),import('./js/viewer.js')]).then(([u,V])=>V.setZoom(u.store.active,${z}))`);
    const vrect = () => c.rect('.docview.active .viewer');
    const cursorOf = () => c.ev(`getComputedStyle(document.querySelector('.docview.active .page')).cursor`);
    const mid = (type, x, y, buttons) => c.mouse(type, x, y, { button: 'middle', buttons, clickCount: 1 });
    // geste bouton du milieu : appui, déplacements, (mesure pendant), relâchement
    const middleDrag = async (x, y, dx, dy, during) => {
      await mid('mouseMoved', x, y, 0);
      await mid('mousePressed', x, y, 4);
      for (let i = 1; i <= 5; i++) { await mid('mouseMoved', x + (dx * i) / 5, y + (dy * i) / 5, 4); await sleep(20); }
      if (during) await during();
      await mid('mouseReleased', x + dx, y + dy, 0);
      await sleep(150);
    };
    const near = (a, b) => Math.abs(a - b) <= 1;

    await zoom(3); await sleep(500);
    const [vx, vy, vw, vh] = await vrect();
    const cx = vx + vw / 2, cy = vy + vh / 2;

    // ------------------------------------------------------------ 1. trois modes d'affichage
    for (const [label, sel] of [['continu', 'mode-continuous'], ['page par page', 'mode-single'], ['deux pages', 'spread']]) {
      console.log('1. Mode ' + label);
      await c.click('#rtab-view'); await sleep(150);
      await c.click(`#rpanel-view [data-cmd=${sel}]`); await sleep(500);
      await zoom(3); await sleep(500);
      await setScroll(200, 300); await sleep(200);
      const a = await info();
      check(`${label} : la page dépasse la fenêtre (défilement possible)`, a.sw > a.cw + 300 && a.sh > a.ch + 300, [a.sw, a.cw, a.sh, a.ch]);
      let during = null;
      await middleDrag(cx, cy, -60, -90, async () => { during = await info(); });
      const b = await info();
      check(`${label} : défilement exact (+60, +90 px)`, near(b.sl, a.sl + 60) && near(b.st, a.st + 90), [a.sl, a.st, b.sl, b.st]);
      check(`${label} : curseur « main fermée » pendant le geste`, during && during.panning === true);
      check(`${label} : fin du geste : classe retirée`, b.panning === false);
      check(`${label} : outil, sélection et objets inchangés`, b.tool === a.tool && b.sel === 0 && b.edits === 0, b);
      check(`${label} : curseur normal après le geste`, (await cursorOf()) !== 'grabbing', await cursorOf());
      // sens inverse (vers le bas / la droite) puis clic sans mouvement
      await middleDrag(cx, cy, 40, 70);
      const d = await info();
      check(`${label} : sens inverse (−40, −70 px)`, near(d.sl, b.sl - 40) && near(d.st, b.st - 70), [b.sl, b.st, d.sl, d.st]);
      await mid('mousePressed', cx, cy, 4); await mid('mouseReleased', cx, cy, 0); await sleep(150);
      const e = await info();
      check(`${label} : clic molette sans mouvement : rien ne bouge`, e.sl === d.sl && e.st === d.st && e.page === d.page && e.edits === 0);
    }

    // ------------------------------------------------------------ 2. sortie de la fenêtre, panneau flottant, tracé en cours
    console.log('2. Tracés en cours, panneaux, sortie de zone');
    await c.click('#rtab-view'); await sleep(100);
    await c.click('#rpanel-view [data-cmd=mode-continuous]'); await sleep(400);
    await zoom(3); await sleep(400);
    await setScroll(300, 600); await sleep(200);
    await c.click('#rtab-measure'); await sleep(150);
    await c.click('#rpanel-measure [data-cmd=tool-m-poly]'); await sleep(150);
    await c.clickXY(cx, cy); await sleep(200); // un sommet posé
    let a = await info();
    check('tracé de polyligne en cours (1 sommet)', a.mx === 1 && a.tool === 'm-poly', a);
    await middleDrag(cx, cy, -80, -50);
    let b = await info();
    check('le geste déplace le document avec l\'outil de mesure actif', near(b.sl, a.sl + 80) && near(b.st, a.st + 50), [a.sl, a.st, b.sl, b.st]);
    check('le tracé en cours n\'est pas perdu et l\'outil reste actif', b.mx === 1 && b.tool === 'm-poly' && b.edits === 0, b);
    // geste qui sort de la zone du document (au-delà de la fenêtre)
    await c.send('Page.bringToFront').catch(() => {});
    await middleDrag(cx, cy, 0, 400);
    const o = await info();
    check('geste prolongé hors de la zone du document : défilement continu (capture)', o.st < b.st - 300 || o.st === 0, [b.st, o.st]);
    // panneau flottant : ouvrir le panneau latéral et saisir au-dessus
    await c.click('#statusbar #sb-toggle'); await sleep(400);
    await setScroll(300, 600); await sleep(200);
    const [sx, sy, sw, sh] = await c.rect('#sidebar');
    a = await info();
    await middleDrag(sx + sw / 2, sy + sh / 2, -30, -40);
    b = await info();
    check('geste commencé au-dessus d\'un panneau flottant', near(b.sl, a.sl + 30) && near(b.st, a.st + 40), [a.sl, a.st, b.sl, b.st]);
    await c.click('#statusbar #sb-toggle'); await sleep(300);
    await c.ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    await c.click('#rpanel-measure [data-cmd=tool-m-poly]').catch(() => {});

    // ------------------------------------------------------------ 3. Espace + glisser (bouton gauche)
    console.log('3. Espace + glisser');
    await c.click('#rtab-annotate'); await sleep(150);
    await c.click('#rpanel-annotate [data-cmd=tool-line]'); await sleep(150);
    await setScroll(300, 600); await sleep(200);
    await c.ev('document.activeElement && document.activeElement.blur()'); // un onglet du ruban focalisé garde Espace pour lui
    a = await info();
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await sleep(100);
    check('Espace maintenu : curseur « main » prêt', (await info()).ready === true);
    await c.mouse('mouseMoved', cx, cy);
    await c.mouse('mousePressed', cx, cy);
    for (let i = 1; i <= 5; i++) { await c.mouse('mouseMoved', cx - 10 * i, cy - 14 * i, { buttons: 1 }); await sleep(20); }
    await c.mouse('mouseReleased', cx - 50, cy - 70);
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await sleep(200);
    b = await info();
    check('Espace + glisser : le document suit la souris (+50, +70 px)', near(b.sl, a.sl + 50) && near(b.st, a.st + 70), [a.sl, a.st, b.sl, b.st]);
    check('Espace + glisser : aucun objet créé, outil inchangé', b.edits === 0 && b.tool === 'line', b);
    check('Espace relâché : curseur normal', b.ready === false && b.panning === false);
    // Espace seul (sans glisser) garde son rôle : défilement d'un écran
    await setScroll(300, 600); await sleep(200);
    a = await info();
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await sleep(300);
    b = await info();
    check('Espace seul : défile d\'un écran comme avant', b.st > a.st + a.ch * 0.5, [a.st, b.st]);

    // ------------------------------------------------------------ 4. réglage désactivé
    console.log('4. Réglage « Déplacer avec le clic molette »');
    await c.ev(`import('./js/settings.js').then(m=>m.set('panMiddle',false))`);
    await setScroll(300, 600); await sleep(200);
    a = await info();
    await mid('mouseMoved', cx, cy, 0); await mid('mousePressed', cx, cy, 4);
    await mid('mouseMoved', cx - 50, cy - 50, 4); await sleep(100);
    const off = await info();
    check('réglage désactivé : le geste de déplacement est inactif', off.panning === false, off);
    await mid('mouseReleased', cx - 50, cy - 50, 0);
    await c.ev(`import('./js/settings.js').then(m=>m.set('panMiddle',true))`);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : déplacement au clic molette et Espace (interface).');
})();
