// Espace de fusion (interface, hors écran) : ouverture depuis Accueil et Pages (plus d'onglet Fusionner), cartes (ajout, réordonnancement, plages,
// rotation, suppression), résultat dans un nouvel onglet non enregistré, animation (3 réglages), fichier chiffré (mot de passe).
// Usage : node test/test-merge-ui.js
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
  const dir = path.join(os.tmpdir(), 'spinadoc-ui-pdfs');
  const f = await makeAll(dir);
  const enc = path.join(dir, 'chiffre.pdf');
  {
    const d = await PDFLib.PDFDocument.create();
    d.addPage([300, 300]).drawText('SECRET-1', { x: 20, y: 100, size: 20 });
    d.addPage([300, 300]);
    d.encrypt({ userPassword: 'sesame', ownerPassword: 'sesame2', permissions: { printing: true } });
    fs.writeFileSync(enc, await d.save());
  }
  const run = async (opts, fn) => {
    const c = await launchApp(opts);
    try { await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 20000); await sleep(800); await fn(c); }
    catch (e) { check('exécution sans exception', false, String(e && e.stack || e)); }
    finally { await c.close(); }
  };
  const J = (c) => async (e) => JSON.parse(await c.ev(e));

  // ---------------------------------------------------------------- 1. fusion de plusieurs fichiers
  await run({ files: [f.a], env: { SPINADOC_TEST_OPEN: JSON.stringify([f.b, f.d]) } }, async (c) => {
    const j = J(c);
    const cards = () => j(`JSON.stringify([...document.querySelectorAll('#mw-cards .mw-card')].map(e=>({name:e.querySelector('.mw-name').textContent,info:e.querySelector('.mw-info').textContent,rot:e.querySelector('.mw-thumb-in').style.transform})))`);
    const summary = () => c.ev(`document.getElementById('mw-summary').textContent`);
    console.log('1. Ouverture et cartes');
    check('plus d\'onglet « Fusionner » dans le ruban', (await c.ev(`!document.getElementById('rtab-merge') && !document.getElementById('rpanel-merge')`)) === true);
    check('bouton « Fusionner des PDF » dans Accueil', (await c.ev(`!!document.querySelector('#rpanel-home [data-cmd=merge-open]')`)) === true);
    await c.click('#rtab-pages');
    check('bouton « Fusionner des PDF » dans Pages', (await c.ev(`!!document.querySelector('#rpanel-pages [data-cmd=merge-open]')`)) === true);
    await c.click('#rtab-home');
    await c.click('#rpanel-home [data-cmd=merge-open]'); await sleep(400);
    check('espace de fusion plein écran ouvert', (await c.ev(`!document.getElementById('mergews').hidden && getComputedStyle(document.getElementById('mergews')).position`)) === 'fixed');
    check('vide : invitation à déposer, « Fusionner » désactivé', (await c.ev(`!document.getElementById('mw-empty').hidden && document.getElementById('mw-go').disabled`)) === true);
    await c.click('#mw-add'); await sleep(2500);
    let cs = await cards();
    check('ajout (boîte d\'ouverture, sélection multiple) : 2 cartes avec nom et nombre de pages', cs.length === 2 && cs[0].name === 'b-letter.pdf' && /5 pages/.test(cs[0].info) && cs[1].name === 'd-a5.pdf' && /3 pages/.test(cs[1].info), cs);
    check('miniature de la première page dessinée', (await c.ev(`document.querySelector('#mw-cards canvas').width`)) > 50);
    check('résumé : 2 fichiers · 8 pages', (await summary()) === '2 fichiers · 8 pages', await summary());
    // depuis les onglets ouverts
    await c.click('#mw-tabs'); await sleep(300);
    check('menu « Depuis les onglets » : document ouvert listé', /a-huit-pages/.test(await c.ev(`document.getElementById('mw-menu').textContent`)));
    await c.ev(`document.querySelector('#mw-menu button').click()`); await sleep(2000);
    cs = await cards();
    check('document d\'un onglet ajouté (3e carte, 8 pages)', cs.length === 3 && cs[2].name === 'a-huit-pages.pdf' && /8 pages/.test(cs[2].info), cs);

    console.log('2. Réordonner, plages, rotation, suppression');
    const dnd = (i, j2, after) => c.ev(`(()=>{const cs=document.querySelectorAll('#mw-cards .mw-card'); const a=cs[${i}], b=cs[${j2}]; const dt=new DataTransfer(); const r=b.getBoundingClientRect(); const x=r.left+r.width*${after ? 0.75 : 0.25};
      a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt})); b.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x})); const c0=b.className;
      b.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:x})); return c0})()`);
    const cls = await dnd(2, 0, false); await sleep(300);
    cs = await cards();
    check('glisser la carte 3 avant la carte 1 : nouvel ordre (a, b, d)', cs.map((x) => x.name).join() === 'a-huit-pages.pdf,b-letter.pdf,d-a5.pdf' && /drop-before/.test(cls), { cs: cs.map((x) => x.name), cls });
    await c.ev(`(()=>{const e=document.querySelectorAll('#mw-cards .mw-range')[0]; e.value='1-2, 5'; e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(200);
    cs = await cards();
    check('plage « 1-2, 5 » : 3 pages retenues, résumé mis à jour', /3 retenues/.test(cs[0].info) && (await summary()) === '3 fichiers · 11 pages', { i: cs[0].info, s: await summary() });
    await c.ev(`(()=>{const e=document.querySelectorAll('#mw-cards .mw-range')[1]; e.value='9'; e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(200);
    check('plage invalide : message sur la carte, « Fusionner » désactivé', (await c.ev(`document.getElementById('mw-go').disabled && document.querySelectorAll('#mw-cards .mw-range.invalid').length`)) === 1);
    await c.ev(`(()=>{const e=document.querySelectorAll('#mw-cards .mw-range')[1]; e.value='2-3'; e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(200);
    await c.ev(`document.querySelectorAll('#mw-cards .mw-card')[2].querySelector('[aria-label="Pivoter à droite"]').click()`); await sleep(200);
    cs = await cards();
    check('rotation par fichier : la miniature tourne de 90°', /rotate\(90deg\)/.test(cs[2].rot), cs[2].rot);
    // suppression puis retour
    await c.ev(`document.querySelectorAll('#mw-cards .mw-card')[2].querySelector('[aria-label="Retirer de la fusion"]').click()`); await sleep(200);
    check('suppression d\'une carte', (await cards()).length === 2 && (await summary()) === '2 fichiers · 5 pages', await summary());
    await c.click('#mw-add'); await sleep(2500);
    cs = await cards();
    check('ajout d\'un fichier à la fin', cs.length === 4 && cs[3].name === 'd-a5.pdf', cs.map((x) => x.name));
    await c.ev(`document.querySelectorAll('#mw-cards .mw-card')[2].querySelector('[aria-label="Retirer de la fusion"]').click()`); await sleep(200); // retire le 2e « b »
    await c.ev(`(()=>{const cs=document.querySelectorAll('#mw-cards .mw-card'); cs[cs.length-1].querySelector('[aria-label="Pivoter à droite"]').click()})()`); await sleep(200);
    cs = await cards();
    check('prêt : a (1-2, 5) + b (2-3) + d (pivoté), 8 pages', cs.length >= 3 && (await summary()).includes('8 pages'), { cs, s: await summary() });

    console.log('3. Fusion, animation complète');
    await c.ev(`import('./js/anim.js').then(m=>m.setAnim('full'))`);
    await c.click('#mw-go'); await sleep(250);
    const anim1 = await j(`JSON.stringify({mode:document.getElementById('mw-stage').dataset.mode, hidden:document.getElementById('mw-stage').hidden, n:document.getElementById('mw-stage').getAnimations({subtree:true}).length, ghosts:document.querySelectorAll('#mw-stage .mw-ghost').length, red:!!document.querySelector('#mw-stage .mw-result svg rect[fill="url(#mwdeep)"]'), spinner:getComputedStyle(document.querySelector('#mw-stage .mw-ring')).opacity})`);
    check('animation complète : miniatures en orbite (une animation par carte + la page rouge)', anim1.mode === 'full' && !anim1.hidden && anim1.ghosts === 3 && anim1.n >= 4 && anim1.red, anim1);
    check('indicateur de chargement tournant pendant le calcul', Number(anim1.spinner) > 0, anim1);
    await c.waitFor(`document.querySelectorAll('.doctab').length===2`, 15000); await sleep(800);
    check('le résultat s\'ouvre dans un nouvel onglet « Fusion.pdf »', (await c.ev(`[...document.querySelectorAll('.doctab-name')].map(e=>e.textContent).join()`)) === 'a-huit-pages.pdf,Fusion.pdf');
    check('espace de fusion fermé, onglet non enregistré (pastille)', (await c.ev(`document.getElementById('mergews').hidden && !!document.querySelector('.doctab[aria-selected=true] .doctab-dot')`)) === true);
    const merged = await j(`import('./js/ui.js').then(async m=>{const d=m.store.active; const out=[]; for(const r of d.runtime.pages){const t=await r.page.getTextContent(); out.push([t.items.map(i=>i.str).join(' ').replace(/Ligne.*/,'').trim(), r.vp.rotation])} return JSON.stringify({name:d.name,path:d.path,dirty:d.dirty,pages:out})})`);
    check('8 pages dans l\'ordre : a 1, 2, 5 ; b 2, 3 ; d 1-3 (pivotées de 90°)', merged.pages.length === 8
      && merged.pages.slice(0, 3).every((p, k) => new RegExp(`Doc A - page ${[1, 2, 5][k]}`).test(p[0]))
      && merged.pages.slice(3, 5).every((p, k) => new RegExp(`Doc B - page ${[2, 3][k]}`).test(p[0]))
      && merged.pages.slice(5).every((p, k) => new RegExp(`Doc D - page ${k + 1}`).test(p[0]) && p[1] === 90), merged);
    check('nom « Fusion.pdf », sans chemin, non enregistré', merged.name === 'Fusion.pdf' && merged.path === null && merged.dirty === true, merged);
    check('signets : un par fichier source', (await c.ev(`document.querySelector('#sbtab-outline') && 1`)) === 1);
    check('aucune erreur JavaScript (animation complète)', c.logs.length === 0, c.logs.slice(0, 2));

    console.log('4. Animation : réglages Réduites et Aucune');
    await c.click('#rpanel-home [data-cmd=merge-open]'); await sleep(300);
    await c.click('#mw-add'); await sleep(2200);
    await c.ev(`import('./js/anim.js').then(m=>m.setAnim('reduced'))`);
    await c.click('#mw-go'); await sleep(150);
    const anim2 = await j(`JSON.stringify({mode:document.getElementById('mw-stage').dataset.mode, n:document.getElementById('mw-stage').getAnimations({subtree:true}).filter(a=>!a.animationName).length, onlyFade:document.getElementById('mw-stage').getAnimations({subtree:true}).filter(a=>!a.animationName).every(a=>a.effect.getKeyframes().every(k=>!k.transform||k.transform==='none'))})`);
    check('« Réduites » : simple fondu (aucune transformation animée)', anim2.mode === 'reduced' && anim2.n >= 1 && anim2.onlyFade, anim2);
    await c.waitFor(`document.querySelectorAll('.doctab').length===3`, 15000); await sleep(600);
    await c.click('#rpanel-home [data-cmd=merge-open]'); await sleep(300);
    await c.click('#mw-add'); await sleep(2200);
    await c.ev(`import('./js/anim.js').then(m=>m.setAnim('none'))`);
    await c.click('#mw-go'); await sleep(100);
    const anim3 = await j(`JSON.stringify({mode:document.getElementById('mw-stage').dataset.mode, ghosts:document.querySelectorAll('#mw-stage .mw-ghost').length, n:document.getElementById('mw-stage').getAnimations({subtree:true}).filter(a=>a.playState==='running').length})`);
    check('« Aucune » : aucun effet (pas de miniature fantôme, aucune animation)', (anim3.mode === 'none' || anim3.mode === undefined) && anim3.ghosts === 0 && anim3.n === 0, anim3);
    await c.waitFor(`document.querySelectorAll('.doctab').length===4`, 15000);
    check('« Aucune » : le résultat s\'ouvre quand même', (await c.ev(`document.querySelectorAll('.doctab').length`)) === 4);
    await c.ev(`import('./js/anim.js').then(m=>m.setAnim('full'))`);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 2));
  });

  // ---------------------------------------------------------------- 2. fichier chiffré
  await run({ files: [f.d], env: { SPINADOC_TEST_OPEN: JSON.stringify([enc]) } }, async (c) => {
    console.log('5. Fichier chiffré');
    const cardsN = () => c.ev(`document.querySelectorAll('#mw-cards .mw-card').length`);
    await c.click('#rpanel-home [data-cmd=merge-open]'); await sleep(300);
    await c.click('#mw-add'); await sleep(1500);
    check('PDF chiffré : le mot de passe est demandé', (await c.ev(`!document.getElementById('pgdlg').hidden && /protégé/.test(document.getElementById('pgdlg-title').textContent)`)) === true);
    await c.click('#pgdlg-cancel'); await sleep(800);
    check('mot de passe refusé : fichier ignoré avec un message clair', (await cardsN()) === 0 && /protégé par un mot de passe/.test(await c.ev(`document.getElementById('toast').textContent`)), await c.ev(`document.getElementById('toast').textContent`));
    await c.click('#mw-add'); await sleep(1200);
    await c.ev(`(()=>{const e=document.getElementById('pgf-pw'); e.value='faux'; e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await c.click('#pgdlg-ok'); await sleep(1200);
    check('mauvais mot de passe : on redemande', (await c.ev(`!document.getElementById('pgdlg').hidden && /incorrect/.test(document.getElementById('pgdlg-intro').textContent)`)) === true);
    await c.ev(`(()=>{const e=document.getElementById('pgf-pw'); e.value='sesame'; e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await c.click('#pgdlg-ok'); await sleep(1500);
    check('bon mot de passe : carte « protégé »', (await cardsN()) === 1 && /protégé/.test(await c.ev(`document.querySelector('#mw-cards .mw-info').textContent`)));
    await c.ev(`import('./js/anim.js').then(m=>m.setAnim('none'))`);
    await c.click('#mw-go'); await c.waitFor(`document.querySelectorAll('.doctab').length===2`, 15000); await sleep(800);
    check('fusion du fichier chiffré : résultat de 2 pages ouvert', (await c.ev(`import('./js/ui.js').then(m=>m.store.active.runtime.pages.length)`)) === 2);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 2));
  });

  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : espace de fusion (interface).');
})();
