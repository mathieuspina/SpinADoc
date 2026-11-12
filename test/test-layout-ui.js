// Mise en page : panneaux flottants (le document ne bouge pas), épingles, barre de titre masquée. Pilotage CDP.
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
    await sleep(900);
    const geo = () => J(`(()=>{const v=document.querySelector('.docview.active .viewer'); const p=document.querySelector('.docview.active .page'); const r=p.getBoundingClientRect(); return JSON.stringify({l:r.left,t:r.top,w:r.width,h:r.height,st:v.scrollTop,sl:v.scrollLeft,vw:v.clientWidth,zoom:document.getElementById('zoom-label').textContent})})()`);
    const same = (a, b) => ['l', 't', 'w', 'h', 'st', 'sl', 'vw', 'zoom'].every((k) => a[k] === b[k]);

    // ------------------------------------------------------------ 1. panneaux flottants
    console.log('1. Panneaux flottants : la page ne bouge pas');
    await c.click('[data-cmd=fit-page]'); await c.click('#rtab-view'); await c.click('[data-cmd=fit-width]'); await sleep(500);
    const base = await geo();
    check('les panneaux sont flottants par défaut (non épinglés)', (await c.ev(`!document.getElementById('sidebar').classList.contains('pinned') && !document.getElementById('props').classList.contains('pinned') && getComputedStyle(document.getElementById('sidebar')).position`)) === 'absolute');

    // bouton du panneau latéral, en haut à gauche de la zone de lecture
    const corner = () => J(`(()=>{const b=document.getElementById('sb-corner'); const r=b.getBoundingClientRect(); const w=document.getElementById('workspace').getBoundingClientRect(); const top=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2); return JSON.stringify({x:r.left-w.left,y:r.top-w.top,w:r.width,h:r.height,on:b.getAttribute('aria-pressed'),hit:top===b||b.contains(top),vis:!b.hidden&&getComputedStyle(b).visibility==='visible'})})()`);
    let cb = await corner();
    check('bouton de panneau : carré, en haut à gauche de la zone de lecture, cliquable', cb.vis && cb.hit && cb.x < 20 && cb.y < 20 && cb.w === cb.h && cb.on === 'false', cb);
    await c.click('#sb-corner'); await sleep(450);
    check('clic : le panneau s’ouvre, le bouton est actif, la page ne bouge pas', (await c.ev(`!document.getElementById('sidebar').hidden`)) === true && (await corner()).on === 'true' && same(base, await geo()), { g: await geo(), base });
    cb = await corner();
    check('bouton visible et cliquable avec le panneau flottant ouvert (à droite de son bord)', cb.vis && cb.hit && cb.x > 200, cb);
    await c.click('#sb-corner'); await sleep(450);
    check('second clic : panneau refermé, bouton inactif, la page ne bouge pas', (await c.ev(`document.getElementById('sidebar').hidden`)) === true && (await corner()).on === 'false' && same(base, await geo()));
    await c.key('F4'); await sleep(450);
    check('raccourci F4 : le bouton suit l’état du panneau', (await corner()).on === 'true');
    await c.key('F4'); await sleep(450);
    await c.click('#sb-toggle'); await sleep(450);
    check('panneau latéral ouvert (visible, par-dessus le document)', (await c.ev(`!document.getElementById('sidebar').hidden`)) === true);
    const g1 = await geo();
    check('ouverture du panneau latéral : position, taille, zoom et défilement de la page identiques', same(base, g1), { base, g1 });
    for (const tab of ['#sbtab-outline', '#sbtab-search', '#sbtab-annots', '#sbtab-thumbs']) {
      await c.click(tab); await sleep(250);
      check(`onglet ${tab.slice(7)} du panneau : la page ne bouge pas`, same(base, await geo()));
    }
    await c.click('#sb-toggle'); await sleep(450);
    check('fermeture du panneau latéral : la page ne bouge pas', same(base, await geo()) && (await c.ev(`document.getElementById('sidebar').hidden`)) === true);

    // panneau de propriétés : n'apparaît que s'il a été activé
    await c.click('#rtab-annotate'); await c.click('#rpanel-annotate [data-cmd=tool-rect]'); await sleep(350);
    check('propriétés : pas d\'ouverture automatique tant que le bouton n\'est pas activé', (await c.ev(`document.getElementById('props').hidden`)) === true);
    await c.click('#rpanel-annotate [data-cmd=props]'); await sleep(450);
    check('bouton « Propriétés » activé : le panneau s\'ouvre', (await c.ev(`!document.getElementById('props').hidden`)) === true);
    const g2 = await geo();
    check('ouverture du panneau de propriétés : la page ne bouge pas', same(base, g2), { base, g2 });
    await c.click('#rpanel-annotate [data-cmd=tool-select]'); await sleep(350);
    check('changement d\'outil (panneau qui se ferme / s\'ouvre) : la page ne bouge pas', same(base, await geo()));
    await c.click('#rpanel-annotate [data-cmd=props]'); await sleep(400);
    check('fermeture du panneau de propriétés : la page ne bouge pas', same(base, await geo()));
    // « Ajuster à la largeur » : calculé sur toute la largeur disponible, panneau ouvert ou non
    await c.click('#sb-toggle'); await sleep(400);
    await c.click('#rtab-view'); await c.click('[data-cmd=fit-width]'); await sleep(500);
    check('« Ajuster à la largeur » panneau ouvert : même zoom que panneau fermé', same(base, await geo()));
    await c.click('#sb-toggle'); await sleep(300);

    // ------------------------------------------------------------ 2. épingles
    console.log('2. Épingler : le panneau repousse le document');
    await c.click('#sb-toggle'); await sleep(350);
    await c.click('#sb-pin'); await sleep(500);
    check('épinglé : le panneau est dans la mise en page', (await c.ev(`document.getElementById('sidebar').classList.contains('pinned') && getComputedStyle(document.getElementById('sidebar')).position`)) === 'static');
    const gp = await geo();
    check('épinglé : la zone de lecture est plus étroite (le document est repoussé)', gp.vw < base.vw - 200, { base: base.vw, pinned: gp.vw });
    check('le choix est mémorisé (réglage persistant)', (await c.ev(`window.spinadoc.getSettings().then(s=>s.pinSidebar)`)) === true);
    await c.click('#sb-pin'); await sleep(500);
    check('désépinglé : retour exact à la position d\'origine', same(base, await geo()) === false || (await geo()).vw === base.vw);
    await c.click('#sb-toggle'); await sleep(300);
    check('panneau de propriétés épinglé : réglage mémorisé', await (async () => { await c.click('#rtab-annotate'); await c.click('#rpanel-annotate [data-cmd=props]'); await c.click('#rpanel-annotate [data-cmd=tool-rect]'); await sleep(350); await c.click('#props-pin'); await sleep(300); return (await c.ev(`window.spinadoc.getSettings().then(s=>s.pinProps)`)) === true && (await geo()).vw < base.vw - 200; })());
    await c.click('#props-pin'); await sleep(300);
    await c.click('#rpanel-annotate [data-cmd=props]'); await c.click('#rpanel-annotate [data-cmd=tool-select]'); await sleep(300);

    // ------------------------------------------------------------ 3. animation d'ouverture
    console.log('3. Animation d\'ouverture des panneaux');
    await c.click('#sb-toggle');
    const anim = await c.ev(`document.getElementById('sidebar').getAnimations().length`);
    check('animation de glissement à l\'ouverture (animations complètes)', anim >= 1, anim);
    await sleep(300); await c.click('#sb-toggle'); await sleep(300);
    await c.click('#btn-settings'); await c.click('input[name=anim][value=none]'); await c.click('#settings-close');
    await c.click('#sb-toggle');
    check('animations « Aucune » : pas d\'animation à l\'ouverture', (await c.ev(`document.getElementById('sidebar').getAnimations().length`)) === 0);
    await c.click('#sb-toggle'); await c.click('#btn-settings'); await c.click('input[name=anim][value=full]'); await c.click('#settings-close');

    // ------------------------------------------------------------ 4. barre de titre masquée
    console.log('4. Barre de titre masquée');
    const wco = await J(`(()=>{const w=navigator.windowControlsOverlay; if(!w) return JSON.stringify({ok:false}); const r=w.getTitlebarAreaRect(); return JSON.stringify({ok:true, visible:w.visible, x:r.x, y:r.y, w:r.width, h:r.height})})()`);
    check('boutons natifs de Windows en overlay (windowControlsOverlay visible)', wco.ok && wco.visible === true, wco);
    const hb = await J(`(()=>{const t=document.getElementById('topbar').getBoundingClientRect(); const s=document.getElementById('btn-settings').getBoundingClientRect(); return JSON.stringify({th:t.height, sr:s.right, top:t.top})})()`);
    check('hauteur de l\'en-tête = hauteur de l\'overlay (48 px)', wco.ok && hb.th === wco.h && wco.h === 48, { hb, wco });
    check('le bouton Réglages ne passe pas sous les boutons de la fenêtre', wco.ok && hb.sr <= wco.x + wco.w, { hb, wco });
    const regions = await c.ev(`['#topbar','.brand','#ribbon-tabs','#rtab-home','#rtab-view','#btn-settings','[data-cmd=open]'].map(s=>s+'='+getComputedStyle(document.querySelector(s)).webkitAppRegion).join(' ')`);
    check('zone de glisser sur l\'en-tête, no-drag sur les onglets et boutons', /#topbar=drag/.test(regions) && /#rtab-home=no-drag/.test(regions) && /#btn-settings=no-drag/.test(regions), regions);
    check('le titre de la fenêtre suit le document (barre des tâches)', (await c.ev(`document.title`)).startsWith('a-huit-pages.pdf'));
    for (const [w, h, dsf, label] of [[1280, 720, 1, '100 %'], [1024, 576, 1.25, '125 %'], [853, 480, 1.5, '150 %'], [700, 500, 1, 'fenêtre étroite']]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: false }); await sleep(400);
      const v = await J(`(()=>{const t=document.getElementById('topbar').getBoundingClientRect(); const s=document.getElementById('btn-settings').getBoundingClientRect(); const tabs=[...document.querySelectorAll('#ribbon-tabs [role=tab]')].map(b=>b.getBoundingClientRect()); return JSON.stringify({th:t.height, tw:t.width, sright:s.right, sl:s.left, tabsOk: tabs.every(b=>b.bottom<=t.bottom+0.5 && b.height>0), noOverlap: tabs[tabs.length-1].right <= s.left+0.5})})()`);
      check(`en-tête à ${label} (${w}×${h}) : 48 px, onglets entiers, réglages visibles et sans chevauchement`, v.th === 48 && v.tabsOk && v.sright <= w + 1 && v.noOverlap, v);
    }
    await c.send('Emulation.clearDeviceMetricsOverride'); await sleep(300);
    await c.ev(`window.spinadoc.toggleFullscreen()`); await sleep(800);
    check('plein écran (F11) : activé', (await c.ev(`window.spinadoc.isFullscreen()`)) === true);
    check('plein écran : l\'en-tête reste utilisable', (await c.ev(`document.getElementById('topbar').getBoundingClientRect().height`)) > 0);
    await c.ev(`window.spinadoc.toggleFullscreen()`); await sleep(800);
    check('sortie du plein écran', (await c.ev(`window.spinadoc.isFullscreen()`)) === false);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : mise en page.');
})();
