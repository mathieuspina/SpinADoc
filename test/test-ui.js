// Tests d'interface : lance l'application et la pilote via CDP (voir test/lib/app.js).
// Nécessite un affichage. Usage : npm run test:ui
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

// Pages visibles dans la zone de lecture et pixels non vides dans leurs canvas.
const VISIBLE_INK = `(()=>{const v=document.querySelector('.docview.active .viewer'); if(!v||!v.clientHeight) return JSON.stringify({vis:0,ink:0,h:v?v.clientHeight:-1});
  const vr=v.getBoundingClientRect(); let vis=0, ink=0;
  document.querySelectorAll('.docview.active .page').forEach(p=>{const r=p.getBoundingClientRect();
    if(r.bottom>vr.top && r.top<vr.bottom && r.right>vr.left && r.left<vr.right){vis++; const c=p.querySelector('canvas'); if(!c.width) return;
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; for(let k=0;k<d.length;k+=28){ if(d[k+3]>0&&(d[k]<235||d[k+1]<235||d[k+2]<235)){ink++;break;} } }});
  return JSON.stringify({vis,ink,h:v.clientHeight});})()`;

(async () => {
  const dir = path.join(os.tmpdir(), 'spinadoc-ui-pdfs');
  const f = await makeAll(dir);
  const c = await launchApp({ files: [f.a] });
  const J = async (e) => JSON.parse(await c.ev(e));
  const setRange = (id, v) => c.ev(`(()=>{const z=document.getElementById('${id}'); z.value=${v}; z.dispatchEvent(new Event('input'))})()`);
  const goPage = (n) => c.ev(`(()=>{const i=document.getElementById('in-page'); i.value=${n}; i.dispatchEvent(new Event('change'))})()`);
  const page = async () => Number(await c.ev(`document.getElementById('in-page').value`));
  const inkNow = async (label, expectDoc) => {
    let r = null;
    for (let i = 0; i < 40; i++) { r = await J(VISIBLE_INK); if (r.vis >= 1 && r.ink >= 1) break; await sleep(150); }
    check(`rendu non vide : ${label}`, r.vis >= 1 && r.ink >= 1, r);
  };

  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);

    // ------------------------------------------------------------ 1. plusieurs documents, bascule d'onglets
    console.log('1. Plusieurs documents / bascule d\'onglets');
    await inkNow('document 1 ouvert');
    await goPage(3); await sleep(400);
    await setRange('zoom-range', 120); await sleep(700);
    await inkNow('document 1, page 3, zoom 120 %');
    for (const file of [f.b, f.c, f.d]) { await c.openMore(file); await sleep(1800); await inkNow('ouverture de ' + path.basename(file)); }
    check('4 onglets ouverts', (await c.ev(`document.querySelectorAll('.doctab').length`)) === 4);
    check('aucun canvas parasite dans <body>', (await c.ev(`[...document.body.children].filter(e=>e.tagName==='CANVAS'&&getComputedStyle(e).display!=='none').length`)) === 0);
    for (let round = 0; round < 2; round++) for (let t = 1; t <= 4; t++) {
      await c.click(`.doctab:nth-child(${t})`); await sleep(500);
      await inkNow(`bascule vers l'onglet ${t} (tour ${round + 1})`);
    }
    await c.click('.doctab:nth-child(1)'); await sleep(500);
    check('document 1 : zoom et page conservés', (await c.ev(`document.getElementById('zoom-label').textContent`)) === '120 %' && (await page()) === 3);
    await setRange('zoom-range', 200); await sleep(500);
    await c.click('.doctab:nth-child(2)'); await sleep(400);
    await c.click('.doctab:nth-child(1)'); await sleep(500);
    await inkNow('retour sur le document 1 après zoom 200 %');
    for (const [w, h] of [[900, 600], [1400, 800]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(700);
      await inkNow(`redimensionnement ${w}x${h}`);
      await c.click('.doctab:nth-child(3)'); await sleep(500);
      await inkNow(`onglet 3 à ${w}x${h}`);
      await c.click('.doctab:nth-child(1)'); await sleep(400);
    }
    await c.send('Emulation.clearDeviceMetricsOverride');
    // fermer des onglets : le voisin doit s'afficher
    await c.click('.doctab:nth-child(4) .doctab-close'); await sleep(500);
    await inkNow('après fermeture de l\'onglet 4');
    await c.click('.doctab:nth-child(1)'); await sleep(300);

    // ------------------------------------------------------------ 2. ruban non rogné
    console.log('2. Ruban non rogné');
    const RIBBON_OK = `(()=>{const rb=document.getElementById('ribbon').getBoundingClientRect(); const tabs=document.getElementById('doctabs-bar').getBoundingClientRect();
      const panel=document.querySelector('.rpanel:not([hidden])'); const sb=panel.offsetHeight-panel.clientHeight; const pr=panel.getBoundingClientRect();
      const bad=[...panel.querySelectorAll('.rgroup-label')].filter(l=>{const r=l.getBoundingClientRect(); return r.bottom>pr.bottom-sb+1;}).map(l=>l.textContent);
      const ws=document.getElementById('workspace').getBoundingClientRect().height;
      return JSON.stringify({bad, overlap: rb.bottom>tabs.top+1, ws, ribbonH: rb.height});})()`;
    for (const [w, h, dsf, label] of [[1280, 720, 1, '100 %'], [1024, 576, 1.25, '125 %'], [853, 480, 1.5, '150 %'], [700, 600, 1, 'fenêtre étroite']]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: false }); await sleep(500);
      for (const tab of ['#rtab-home', '#rtab-annotate', '#rtab-view']) {
        await c.click(tab); await sleep(250);
        const r = await J(RIBBON_OK);
        check(`ruban ${tab.slice(6)} @ ${w}x${h} (${label}) : libellés visibles, sans recouvrement`, r.bad.length === 0 && !r.overlap && r.ws > 100, r);
      }
    }
    await c.send('Emulation.clearDeviceMetricsOverride'); await sleep(300);
    await c.click('#rtab-home');

    // ------------------------------------------------------------ 3. indicateurs actifs au survol
    console.log('3. Indicateurs actifs stables au survol');
    await c.click('#rtab-view'); await sleep(200);
    const STYLE = (sel, pseudo) => `(()=>{const e=document.querySelector('${sel}'); const s=getComputedStyle(e${pseudo ? `,'${pseudo}'` : ''}); return JSON.stringify([s.borderTopColor, s.boxShadow, s.opacity, s.height, s.backgroundImage.slice(0,40), s.content]);})()`;
    const sameOnHover = async (name, sel, pseudo) => {
      await c.mouse('mouseMoved', 5, 400); await sleep(300);
      const before = await c.ev(STYLE(sel, pseudo));
      await c.hover(sel);
      const during = await c.ev(STYLE(sel, pseudo));
      await c.mouse('mouseMoved', 5, 400); await sleep(300);
      check(`${name} : indicateur identique avant / pendant le survol`, before === during, { before, during });
      return before;
    };
    const b1 = await sameOnHover('bouton à bascule « Continu »', '[data-cmd=mode-continuous]');
    check('« Continu » : liseré rouge présent', /255, 74, 74/.test(b1), b1);
    await sameOnHover('bouton « Page par page » (inactif→actif)', '[data-cmd=mode-single]');
    await c.click('[data-cmd=mode-single]');
    const b2 = await sameOnHover('bouton « Page par page » actif', '[data-cmd=mode-single]');
    check('« Page par page » actif : liseré rouge présent', /255, 74, 74/.test(b2), b2);
    await c.click('[data-cmd=mode-continuous]');
    await sameOnHover('onglet de ruban actif', '#ribbon-tabs [aria-selected=true]', '::after');
    await sameOnHover('onglet de document actif', '.doctab[aria-selected=true]', '::before');
    await c.click('[data-cmd=sidebar]'); await sleep(300);
    await sameOnHover('onglet du panneau latéral actif', '#sb-tabs [aria-selected=true]');
    await c.click('[data-cmd=sidebar]');

    // ------------------------------------------------------------ 4. mode page par page : molette et clavier
    console.log('4. Mode page par page');
    await c.click('.doctab:nth-child(1)'); await sleep(400);
    await c.click('[data-cmd=mode-single]'); await sleep(300);
    await c.click('[data-cmd=fit-page]'); await sleep(600);
    await goPage(1); await sleep(300);
    const [vx, vy, vw, vh] = await c.rect('.docview.active .viewer');
    const cx = vx + vw / 2, cy = vy + vh / 2;
    await c.wheel(cx, cy, 100); await sleep(400);
    check('molette : 1 cran → page suivante (page entière visible)', (await page()) === 2, await page());
    await c.wheel(cx, cy, 100); await sleep(40); await c.wheel(cx, cy, 100); await sleep(40); await c.wheel(cx, cy, 100); await sleep(500);
    check('molette : plusieurs crans rapprochés = une seule page (temporisation)', (await page()) === 3, await page());
    await sleep(300);
    await c.wheel(cx, cy, -100); await sleep(500);
    check('molette arrière → page précédente', (await page()) === 2, await page());
    // zoom : la page dépasse la fenêtre
    await setRange('zoom-range', 250); await sleep(700);
    await goPage(4); await sleep(300);
    const scrollInfo = () => J(`(()=>{const v=document.querySelector('.docview.active .viewer'); return JSON.stringify({st:v.scrollTop, bottom:v.scrollTop+v.clientHeight>=v.scrollHeight-1, fits:v.scrollHeight<=v.clientHeight+1})})()`);
    check('page zoomée plus grande que la fenêtre', !(await scrollInfo()).fits);
    let n = 0; const startPage = await page();
    while (!(await scrollInfo()).bottom && n++ < 60) { await c.wheel(cx, cy, 120); await sleep(230); }
    check('la molette fait défiler la page sans changer de page', (await page()) === startPage && (await scrollInfo()).bottom, { p: await page(), n });
    await sleep(400);
    await c.wheel(cx, cy, 120); await sleep(500);
    check('arrivé en bas, un nouveau cran passe à la page suivante (haut de page)', (await page()) === startPage + 1 && (await scrollInfo()).st === 0, { p: await page(), s: await scrollInfo() });
    await sleep(400);
    await c.wheel(cx, cy, -120); await sleep(500);
    check('en haut, molette arrière → page précédente, positionnée en bas', (await page()) === startPage && (await scrollInfo()).st > 0, { p: await page(), s: await scrollInfo() });
    await c.wheel(cx, cy, -100, 2); await sleep(500); // Ctrl+molette : zoom
    check('Ctrl+molette zoome toujours (sans changer de page)', Number((await c.ev(`document.getElementById('zoom-label').textContent`)).replace(/\D/g, '')) > 250 && (await page()) === startPage);
    // clavier : page entière
    await c.click('[data-cmd=fit-page]'); await sleep(600); await goPage(1); await sleep(300);
    const kb = async (key, code, vk, extra = {}) => { await c.key(key, { code, windowsVirtualKeyCode: vk, ...extra }); await sleep(300); };
    await c.mouse('mouseMoved', 5, 400);
    await kb('PageDown', 'PageDown', 34); check('clavier : Page suivante', (await page()) === 2, await page());
    await kb('ArrowRight', 'ArrowRight', 39); check('clavier : flèche droite (page entière)', (await page()) === 3, await page());
    await kb(' ', 'Space', 32, { text: ' ' }); check('clavier : Espace', (await page()) === 4, await page());
    await kb(' ', 'Space', 32, { text: ' ', modifiers: 8 }); check('clavier : Maj+Espace', (await page()) === 3, await page());
    await kb('ArrowLeft', 'ArrowLeft', 37); check('clavier : flèche gauche', (await page()) === 2, await page());
    await kb('PageUp', 'PageUp', 33); check('clavier : Page précédente', (await page()) === 1, await page());
    await kb('End', 'End', 35); check('clavier : Fin', (await page()) === 8, await page());
    await kb('Home', 'Home', 36); check('clavier : Début', (await page()) === 1, await page());
    // deux pages côte à côte
    await c.click('[data-cmd=spread]'); await sleep(500); await c.click('[data-cmd=fit-page]'); await sleep(600);
    const onPages = await c.ev(`[...document.querySelectorAll('.docview.active .page')].filter(p=>!p.classList.contains('off')).length`);
    check('page par page + côte à côte : 2 pages affichées', onPages === 2, onPages);
    await goPage(1); await sleep(300);
    await c.wheel(cx, cy, 100); await sleep(500);
    check('côte à côte : un cran de molette avance de 2 pages', (await page()) === 3, await page());
    await inkNow('page par page, deux pages');
    await c.click('[data-cmd=spread]'); await c.click('[data-cmd=mode-continuous]'); await sleep(400);

    // ------------------------------------------------------------ 5. état modifié via l'historique + boîte de fermeture
    console.log('5. État modifié et boîte de fermeture');
    await goPage(1); await sleep(400);
    await c.click('#rtab-annotate'); await c.click('[data-cmd=tool-add]');
    const [ox, oy] = await c.rect('.docview.active .page .overlay');
    await c.clickXY(ox + 100, oy + 400); await sleep(200);
    await c.type('Texte de test'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(300);
    const dot = () => c.ev(`!!document.querySelector('.doctab[aria-selected=true] .doctab-dot')`);
    check('texte ajouté → pastille « modifié »', (await dot()) === true);
    await c.click('#rtab-home'); await c.click('[data-cmd=undo]'); await sleep(200);
    check('annuler jusqu\'à l\'état de départ → plus de pastille', (await dot()) === false);
    await c.click('[data-cmd=redo]'); await sleep(200);
    check('rétablir → pastille', (await dot()) === true);
    await c.click('.doctab[aria-selected=true] .doctab-close'); await sleep(400);
    check('fermer un document modifié → boîte modale de l\'application', (await c.ev(`!document.getElementById('unsaved').hidden`)) === true);
    const msg = await c.ev(`document.getElementById('unsaved-msg').textContent`);
    check('message : « Enregistrer les modifications de « nom.pdf » avant de fermer ? »', msg === 'Enregistrer les modifications de « a-huit-pages.pdf » avant de fermer ?', msg);
    check('trois boutons : Enregistrer (principal), Ne pas enregistrer, Annuler', (await c.ev(`['unsaved-save','unsaved-discard','unsaved-cancel'].map(i=>document.getElementById(i).textContent).join('|')`)) === 'Enregistrer|Ne pas enregistrer|Annuler');
    check('focus initial sur « Enregistrer »', (await c.ev(`document.activeElement.id`)) === 'unsaved-save');
    await c.key('Tab', { code: 'Tab', windowsVirtualKeyCode: 9 });
    check('Tab reste dans la boîte', (await c.ev(`document.activeElement.id`)) === 'unsaved-cancel');
    await c.key('Escape', { code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300);
    check('Échap = Annuler : boîte fermée, document toujours ouvert', (await c.ev(`document.getElementById('unsaved').hidden`)) === true && (await c.ev(`document.querySelectorAll('.doctab').length`)) === 3);
    await c.click('.doctab[aria-selected=true] .doctab-close'); await sleep(300);
    await c.click('#unsaved-cancel'); await sleep(200);
    check('bouton Annuler : le document reste ouvert', (await c.ev(`document.querySelectorAll('.doctab').length`)) === 3);
    await c.click('.doctab[aria-selected=true] .doctab-close'); await sleep(300);
    await c.click('#unsaved-discard'); await sleep(500);
    check('« Ne pas enregistrer » : l\'onglet se ferme', (await c.ev(`document.querySelectorAll('.doctab').length`)) === 2);
    await inkNow('document suivant affiché après fermeture');

    // ------------------------------------------------------------ 6. animations
    console.log('6. Animations');
    await c.ev(`document.getElementById('busy').hidden=false`);
    const spin = () => c.ev(`document.querySelector('#busy .spinner').getAnimations().map(a=>a.animationName).join(',')`);
    check('indicateur de chargement : rotation (complètes)', (await spin()) === 'spin');
    await c.ev(`document.getElementById('busy').hidden=true`);
    await c.click('#btn-settings'); await c.click('input[name=anim][value=none]');
    await c.ev(`document.getElementById('busy').hidden=false`);
    check('animations « Aucune » : plus d\'animation', (await spin()) === '');
    await c.ev(`document.getElementById('busy').hidden=true`);
    await c.click('input[name=anim][value=full]'); await c.click('#settings-close');
    await c.send('Page.reload'); await sleep(250);
    check('démarrage : l\'éventail s\'ouvre (animation en cours)', (await c.ev(`document.querySelectorAll('#brand-mark .ghost')[0].getAnimations().length`)) > 0);
    check('aucune erreur JavaScript pendant les tests', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  // ------------------------------------------------------------ 7. quitter avec plusieurs documents modifiés
  console.log('7. Fermeture de la fenêtre avec plusieurs documents modifiés');
  const q = await launchApp({ files: [f.a] });
  try {
    await q.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await q.openMore(f.b); await sleep(1800);
    const addText = async (label) => {
      await q.click('#rtab-annotate'); await q.click('[data-cmd=tool-add]');
      const [x, y] = await q.rect('.docview.active .page .overlay');
      await q.clickXY(x + 100, y + 300); await sleep(200);
      await q.type(label); await q.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(300);
    };
    await addText('un'); await q.click('.doctab:nth-child(1)'); await sleep(400); await addText('deux');
    const { spawnSync } = require('child_process');
    const closeWindow = () => spawnSync('taskkill', ['/PID', String(q.proc.pid)]); // fermeture « gracieuse » (WM_CLOSE)
    closeWindow();
    check('fermer la fenêtre → boîte de l\'application (pas de fermeture directe)', await q.waitFor(`!document.getElementById('unsaved').hidden`, 5000));
    const listTxt = await q.ev(`document.getElementById('unsaved-list').textContent`);
    const saveTxt = await q.ev(`document.getElementById('unsaved-save').textContent`);
    check('la boîte liste les deux fichiers et propose « Tout enregistrer »', /a-huit-pages\.pdf/.test(listTxt) && /b-letter\.pdf/.test(listTxt) && saveTxt === 'Tout enregistrer', { listTxt, saveTxt });
    await q.key('Escape', { code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(500);
    check('Annuler : l\'application reste ouverte', q.proc.exitCode === null && (await q.ev(`document.getElementById('unsaved').hidden`)) === true);
    closeWindow();
    await q.waitFor(`!document.getElementById('unsaved').hidden`, 5000);
    await q.click('#unsaved-discard');
    const exited = await new Promise((res) => { if (q.proc.exitCode !== null) return res(true); const t = setTimeout(() => res(false), 6000); q.proc.on('exit', () => { clearTimeout(t); res(true); }); });
    check('« Ne pas enregistrer » : l\'application se ferme', exited);
  } catch (e) {
    check('scénario de fermeture sans exception', false, String(e && e.stack || e));
  } finally {
    await q.close();
  }

  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : tests d\'interface.');
})();
