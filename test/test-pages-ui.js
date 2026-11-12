// Onglet Pages (interface, hors écran) : miniatures (sélection multiple, glisser-déposer), rotation, suppression, duplication, insertion,
// recadrage, extraction, division, annuler / rétablir, enregistrement, case « Pages sélectionnées » de l'impression. Pilotage CDP.
// Usage : node test/test-pages-ui.js   (SPIN_TEST_HEADLESS=1 par défaut : aucune fenêtre visible)
const path = require('path');
const os = require('os');
const fs = require('fs');
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
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-pages-out-'));
  const c = await launchApp({ files: [f.a], env: { SPINADOC_TEST_SAVE_DIR: out, SPINADOC_TEST_OPEN: JSON.stringify([f.b]) } });
  const J = async (e) => JSON.parse(await c.ev(e));
  const doc = (expr) => J(`import('./js/ui.js').then(m=>{const d=m.store.active; return JSON.stringify(${expr})})`);
  const order = () => doc('d.pages.map(p=>p.src+":"+p.i+(p.rot?"r"+p.rot:"")+(p.crop?"c":""))');
  const sel = () => doc('[...(d.runtime.pageSel||[])].sort((a,b)=>a-b)');
  const thumbs = () => c.ev(`document.querySelectorAll('#sb-thumbs .thumb').length`);
  const thumb = (i) => `#sb-thumbs .thumb[data-index="${i}"]`;
  // les miniatures sont dans un panneau défilant : on amène celle qu'on vise au centre avant de cliquer
  const into = (sel_) => c.ev(`document.querySelector(${JSON.stringify(sel_)}).scrollIntoView({block:'center'})`).then(() => sleep(80));
  const ct = async (i) => { await into(thumb(i)); await c.click(thumb(i)); };
  const clickMod = async (sel_, modifiers) => {
    await into(sel_);
    const [x, y, w, h] = await c.rect(sel_);
    await c.mouse('mouseMoved', x + w / 2, y + h / 2);
    await c.mouse('mousePressed', x + w / 2, y + h / 2, { modifiers });
    await c.mouse('mouseReleased', x + w / 2, y + h / 2, { modifiers });
    await sleep(150);
  };
  const setField = (id, v) => c.ev(`(()=>{const r=document.querySelector('input[name=pgf-${id}][value="${v}"]'); if(r){r.checked=true; r.dispatchEvent(new Event('input',{bubbles:true})); return true} const e=document.getElementById('pgf-${id}'); e.value=${JSON.stringify(String(v))}; e.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
  const waitIdle = () => sleep(500);
  // glisser-déposer simulé (DragEvent + DataTransfer) : de la miniature i vers la moitié basse / haute de la miniature j
  const dnd = (i, j, after) => c.ev(`(()=>{
    const a=document.querySelector('#sb-thumbs .thumb[data-index="${i}"]'), b=document.querySelector('#sb-thumbs .thumb[data-index="${j}"]');
    const dt=new DataTransfer(); const r=b.getBoundingClientRect();
    const y=r.top+r.height*${after ? 0.75 : 0.25};
    a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));
    b.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:y}));
    const cls=b.className;
    b.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientY:y}));
    a.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
    return cls})()`);
  const undo = async () => { await c.key('z', { modifiers: 2, windowsVirtualKeyCode: 90 }); await waitIdle(); };
  const redo = async () => { await c.key('y', { modifiers: 2, windowsVirtualKeyCode: 89 }); await waitIdle(); };
  const pageText = (k) => c.ev(`import('./js/ui.js').then(async m=>{const r=m.store.active.runtime.pages[${k}]; const t=await r.page.getTextContent(); return t.items.map(i=>i.str).join(' ')})`);

  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(800);
    await c.click('#sb-toggle'); await sleep(450);
    console.log('1. Miniatures : sélection multiple');
    check('8 miniatures', (await thumbs()) === 8, await thumbs());
    await ct(1);
    check('clic : la page 2 est sélectionnée et affichée', JSON.stringify(await sel()) === '[1]' && (await doc('d.page')) === 1, await sel());
    await clickMod(thumb(3), 2); // Ctrl
    check('Ctrl+clic : ajoute la page 4', JSON.stringify(await sel()) === '[1,3]', await sel());
    await clickMod(thumb(1), 2);
    check('Ctrl+clic sur une page sélectionnée : la retire', JSON.stringify(await sel()) === '[3]', await sel());
    await clickMod(thumb(6), 8); // Maj : depuis l'ancre (dernière page cliquée)
    check('Maj+clic : plage depuis la dernière page cliquée (2) jusqu’à la page 7', JSON.stringify(await sel()) === '[1,2,3,4,5,6]', await sel());
    check('classe « selected » sur 6 miniatures', (await c.ev(`document.querySelectorAll('#sb-thumbs .thumb.selected').length`)) === 6);
    await ct(2); await clickMod(thumb(2), 2);
    check('Ctrl+clic retire la dernière page sélectionnée : sélection vide', JSON.stringify(await sel()) === '[]', await sel());

    console.log('2. Pivoter (écrit dans la page), annuler / rétablir');
    await ct(2);
    await c.click('#rtab-pages');
    const vpRot = () => doc('d.runtime.pages[2].vp.rotation');
    check('page 3 non pivotée au départ', (await vpRot()) === 0);
    // Accueil : mêmes commandes, même historique, raccourcis Ctrl+Maj+ + / -, ruban sans débordement
    await c.click('#rtab-home');
    check('ruban Accueil : tient dans la largeur de la fenêtre (sans défilement horizontal)', (await c.ev(`(()=>{const p=document.getElementById('rpanel-home'); return p.scrollWidth<=p.clientWidth+1})()`)) === true, await c.ev(`(()=>{const p=document.getElementById('rpanel-home'); return [p.scrollWidth,p.clientWidth]})()`));
    check('groupe « Pages » dans Accueil (pivoter à gauche / à droite)', (await c.ev(`!!document.querySelector('#rpanel-home [data-cmd=pg-rot-left]') && !!document.querySelector('#rpanel-home [data-cmd=pg-rot-right]')`)) === true);
    await c.click('#rpanel-home [data-cmd=pg-rot-right]'); await waitIdle();
    check('Accueil : pivoter à droite agit sur la page sélectionnée', (await order())[2] === '0:2r90', await order());
    await undo();
    check('Accueil : annuler (même historique)', (await order())[2] === '0:2');
    await c.key('+', { modifiers: 10, windowsVirtualKeyCode: 187 }); await waitIdle();
    check('raccourci Ctrl+Maj++ : pivoter à droite', (await order())[2] === '0:2r90', await order());
    await c.key('_', { modifiers: 10, windowsVirtualKeyCode: 189 }); await waitIdle();
    check('raccourci Ctrl+Maj+- : pivoter à gauche', (await order())[2] === '0:2', await order());
    await undo(); await undo(); // retour à l'état d'origine (plus « modifié »)
    await c.click('#rtab-pages');
    await ct(2);
    const tok = () => doc('d.runtime.pages.map(r=>r.token)');
    const tok0 = await tok();
    await c.click('#rpanel-pages [data-cmd=pg-rot-right]'); await waitIdle();
    const tok1 = await tok();
    check('rendu partiel : seule la page pivotée est redessinée (les autres pages gardent leur rendu)', tok1.every((t, k) => (k === 2 ? t > tok0[k] : t === tok0[k])), { tok0, tok1 });
    check('pivoter à droite : /Rotate +90 dans la liste de pages, affichage pivoté', (await order())[2] === '0:2r90' && (await vpRot()) === 90, await order());
    check('document marqué modifié', (await doc('d.dirty')) === true);
    await c.click('#rpanel-pages [data-cmd=pg-rot-left]'); await c.click('#rpanel-pages [data-cmd=pg-rot-left]'); await waitIdle();
    check('deux rotations à gauche : 270°', (await order())[2] === '0:2r270', await order());
    await undo(); await undo();
    check('annuler ×2 : 90°', (await order())[2] === '0:2r90', await order());
    await undo();
    check('annuler : retour à 0°, plus « modifié »', (await order())[2] === '0:2' && (await doc('d.dirty')) === false && (await vpRot()) === 0);
    await redo();
    check('rétablir : 90°', (await order())[2] === '0:2r90');
    await undo();

    console.log('3. Glisser-déposer, annotations et mesures qui suivent');
    await c.ev(`import('./js/ui.js').then(async m=>{const A=await import('./js/annotate.js'); const d=m.store.active; window.DocModel.addEdit(d,{page:2,type:'add',x:60,y:700,text:'ANNOT-P3',size:14,color:[1,0,0]}); window.DocModel.setMeasure(d,{scales:{2:{mmPerPt:0.5,source:'t',ratio:1}}}); A.changed(d); return 1})`);
    await sleep(300);
    const annots = () => doc('d.edits.map(e=>e.page+":"+e.text)');
    check('annotation sur la page 3 (indice 2)', JSON.stringify(await annots()) === '["2:ANNOT-P3"]', await annots());
    await ct(2);
    const cls = await dnd(2, 0, false);
    await waitIdle();
    check('indicateur de dépôt affiché pendant le survol', /drop-before/.test(cls), cls);
    check('glisser la page 3 avant la page 1 : nouvel ordre', JSON.stringify(await order()) === '["0:2","0:0","0:1","0:3","0:4","0:5","0:6","0:7"]', await order());
    check('l\'annotation a suivi sa page (indice 0)', JSON.stringify(await annots()) === '["0:ANNOT-P3"]', await annots());
    check('l\'échelle de mesure a suivi sa page', (await doc('Object.keys(d.measure.scales)')).join() === '0');
    check('panneau Annotations : l\'objet est listé sous « Page 1 »', /Page 1/.test(await c.ev(`document.getElementById('sb-annots').textContent`)));
    check('texte de la page 1 affichée = « page 3 »', /page 3/.test(await pageText(0)), await pageText(0));
    check('le calque d\'annotation de la page 1 contient l\'objet', (await c.ev(`document.querySelectorAll('.docview.active .page')[0].querySelectorAll('svg.annot .objs > *').length`)) >= 1);
    check('miniatures reconstruites (8), sélection sur la page déplacée', (await thumbs()) === 8 && JSON.stringify(await sel()) === '[0]', await sel());
    // recherche : après le déplacement, « page 3 » se trouve sur la page 1
    await c.click('#sbtab-search'); await c.ev(`(()=>{const i=document.getElementById('search-input'); i.value='Doc A - page 3'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1})()`); await sleep(1200);
    check('recherche : le résultat désigne la page 1 (nouvel ordre)', /Page 1/.test(await c.ev(`document.querySelector('#sb-search .search-result .sr-page').textContent`)));
    await c.click('#sbtab-thumbs'); await sleep(200);
    await dnd(0, 6, true); await waitIdle();
    check('glisser vers la fin : page 3 après la page 7', JSON.stringify((await order())).includes('"0:2"]') === false && (await order())[6] === '0:2', await order());
    await undo(); await undo();
    check('annuler ×2 : ordre d\'origine, annotation sur la page 3', JSON.stringify(await annots()) === '["2:ANNOT-P3"]' && (await order()).join() === '0:0,0:1,0:2,0:3,0:4,0:5,0:6,0:7', await order());

    console.log('4. Supprimer, dupliquer (clavier dans les miniatures)');
    await ct(2);
    await c.key('Delete'); await waitIdle();
    check('Suppr : la page 3 et son annotation disparaissent', (await order()).length === 7 && (await annots()).length === 0 && (await thumbs()) === 7, await order());
    check('compteur de pages de la barre d\'état = 7', (await c.ev(`document.getElementById('page-count').textContent`)) === '7');
    await undo();
    check('annuler : la page et l\'annotation reviennent', (await order()).length === 8 && JSON.stringify(await annots()) === '["2:ANNOT-P3"]', await annots());
    await ct(2);
    await c.click('#rpanel-pages [data-cmd=pg-dup]'); await waitIdle();
    check('dupliquer : 9 pages, la copie suit la page, annotation copiée', (await order()).length === 9 && (await order())[3] === '0:2' && (await annots()).length === 2, { o: await order(), a: await annots() });
    check('la copie est sélectionnée', JSON.stringify(await sel()) === '[3]', await sel());
    await undo();
    // sélection de toutes les pages : la suppression est refusée
    await c.click('#rpanel-pages [data-cmd=pg-select-all]');
    check('tout sélectionner : 8 pages', (await sel()).length === 8);
    check('supprimer désactivé quand tout est sélectionné', (await c.ev(`document.querySelector('#rpanel-pages [data-cmd=pg-delete]').disabled`)) === true);
    await ct(0);

    console.log('5. Insérer une page vierge et des pages d\'un autre PDF');
    await ct(1);
    await c.click('#rpanel-pages [data-cmd=pg-blank]'); await sleep(300);
    check('boîte « page vierge » ouverte', (await c.ev(`!document.getElementById('pgdlg').hidden`)) === true);
    await setField('size', 'A3'); await setField('orient', 'landscape'); await setField('where', 'after');
    await c.click('#pgdlg-ok'); await waitIdle();
    const o5 = await order();
    check('page vierge A3 paysage insérée après la page 2', o5.length === 9 && /^blank:1190\.55x841\.89:0$/.test(o5[2]), o5);
    check('affichée : 1190,55 × 841,89 points', (await J(`import('./js/ui.js').then(m=>{const r=m.store.active.runtime.pages[2]; return JSON.stringify([Math.round(r.bw), Math.round(r.bh)])})`)).join() === '1191,842');
    check('la page insérée est sélectionnée', JSON.stringify(await sel()) === '[2]');
    await c.click('#rpanel-pages [data-cmd=pg-insert]'); await sleep(400);
    check('boîte « pages d\'un PDF » : source nommée', /Doc B|b-letter/.test(await c.ev(`document.getElementById('pgdlg-intro').textContent`)) && /5 pages/.test(await c.ev(`document.getElementById('pgdlg-intro').textContent`)));
    await setField('range', '9');
    await c.click('#pgdlg-ok'); await sleep(200);
    check('plage invalide : message, la boîte reste ouverte', /dépasse/.test(await c.ev(`document.getElementById('pgdlg-err').textContent`)) && (await c.ev(`!document.getElementById('pgdlg').hidden`)));
    await setField('range', '2-3'); await setField('where', 'start');
    await c.click('#pgdlg-ok'); await waitIdle();
    const o6 = await order();
    check('2 pages de « Doc B » insérées au début', o6.length === 11 && o6[0] === 's1:1' && o6[1] === 's1:2', o6);
    check('la page insérée affiche le contenu de l\'autre PDF', /Doc B - page 2/.test(await pageText(0)), await pageText(0));
    check('ouverture interne : « Doc B » n\'est pas ajouté aux fichiers récents', !(await c.ev(`(async()=>JSON.stringify(await window.spinadoc.listRecents()))()`)).includes('b-letter'));
    await undo(); await undo();
    check('annuler ×2 : 8 pages d\'origine', (await order()).length === 8 && (await thumbs()) === 8, await order());

    console.log('6. Recadrer (cadre tiré à la souris)');
    await ct(0);
    await c.click('#sb-toggle'); await sleep(450); // panneau fermé : il ne couvre pas la page
    await c.click('#rpanel-pages [data-cmd=pg-crop]'); await sleep(300);
    check('barre de recadrage affichée, « Appliquer » désactivé', (await c.ev(`!document.getElementById('cropbar').hidden && document.getElementById('crop-ok').disabled`)) === true);
    const [px, py] = await c.rect('.docview.active .crop-layer');
    await c.mouse('mouseMoved', px + 60, py + 80); await c.mouse('mousePressed', px + 60, py + 80);
    await c.mouse('mouseMoved', px + 200, py + 250); await c.mouse('mouseMoved', px + 300, py + 400); await c.mouse('mouseReleased', px + 300, py + 400);
    await sleep(200);
    check('cadre dessiné, « Appliquer » activé', (await c.ev(`!document.getElementById('crop-ok').disabled && document.querySelectorAll('.crop-rect').length===1`)) === true);
    const wBefore = await doc('d.runtime.pages[0].vp.width');
    await c.click('#crop-ok'); await waitIdle();
    const crop0 = await doc('d.pages[0].crop');
    check('CropBox enregistrée dans la liste de pages (en points)', Array.isArray(crop0) && crop0[2] - crop0[0] > 100 && crop0[2] - crop0[0] < 400, crop0);
    check('la page affichée est plus étroite', (await doc('d.runtime.pages[0].vp.width')) < wBefore, { wBefore, now: await doc('d.runtime.pages[0].vp.width') });
    check('la barre de recadrage est fermée', (await c.ev(`document.getElementById('cropbar').hidden`)) === true);
    await undo();
    check('annuler : page entière', (await doc('d.pages[0].crop')) === null && (await doc('d.runtime.pages[0].vp.width')) === wBefore);
    await redo();
    await c.click('#sb-toggle'); await sleep(450);

    console.log('7. Extraire et diviser');
    await ct(1); await clickMod(thumb(3), 8);
    await c.click('#rpanel-pages [data-cmd=pg-extract]'); await sleep(1200);
    const ex = fs.readdirSync(out).filter((n) => /-extrait\.pdf$/.test(n));
    check('fichier « -extrait.pdf » écrit', ex.length === 1, fs.readdirSync(out));
    const exDoc = await PDFLib.PDFDocument.load(fs.readFileSync(path.join(out, ex[0])));
    check('extraction : 3 pages (2 à 4)', exDoc.getPageCount() === 3);
    check('l\'extraction ne change pas le document (mêmes pages, toujours « modifié » par le recadrage)', (await order()).length === 8);
    await c.click('#rpanel-pages [data-cmd=pg-split]'); await sleep(300);
    await setField('mode', 'every'); await setField('every', 3);
    await c.click('#pgdlg-ok'); await sleep(2500);
    const parts = fs.readdirSync(out).filter((n) => /^a-huit-pages-\d/.test(n)).sort();
    check('division tous les 3 pages : 3 fichiers (3 + 3 + 2 pages)', parts.length === 3 && parts.join() === 'a-huit-pages-1-3.pdf,a-huit-pages-4-6.pdf,a-huit-pages-7-8.pdf', parts);
    const pc = [];
    for (const p of parts) pc.push((await PDFLib.PDFDocument.load(fs.readFileSync(path.join(out, p)))).getPageCount());
    check('pages par fichier', pc.join() === '3,3,2', pc);
    // plages avec annotation : l'annotation de la page 3 est dans le fichier « 1-3 »
    await c.click('#rpanel-pages [data-cmd=pg-split]'); await sleep(300);
    await setField('mode', 'ranges'); await setField('ranges', '1-3, 5');
    await c.click('#pgdlg-ok'); await sleep(2500);
    const parts2 = fs.readdirSync(out).filter((n) => /^a-huit-pages-(1-3|5)/.test(n)).sort();
    check('plages « 1-3, 5 » : les fichiers existants ne sont pas écrasés', parts2.join() === 'a-huit-pages-1-3 (2).pdf,a-huit-pages-1-3.pdf,a-huit-pages-5.pdf', parts2);

    console.log('8. Menu contextuel et impression');
    await ct(4);
    await into(thumb(4));
    const [tx, ty, tw, th] = await c.rect(thumb(4));
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx + tw / 2, y: ty + th / 2, button: 'right', clickCount: 1, buttons: 2 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx + tw / 2, y: ty + th / 2, button: 'right', clickCount: 1, buttons: 0 });
    await sleep(250);
    check('menu contextuel ouvert avec les commandes', (await c.ev(`!document.getElementById('pgmenu').hidden && document.querySelectorAll('#pgmenu button').length`)) >= 8);
    await c.key('Escape'); await sleep(150);
    check('Échap ferme le menu', (await c.ev(`document.getElementById('pgmenu').hidden`)) === true);
    await ct(1); await clickMod(thumb(2), 8);
    await c.key('p', { modifiers: 2, windowsVirtualKeyCode: 80 }); await sleep(1500);
    check('impression : « Pages sélectionnées (2) » proposé et coché', (await c.ev(`(()=>{const r=document.querySelector('input[name=pr-pages][value=selected]'); return !r.disabled && r.checked && document.getElementById('pr-sel-n').textContent==='2'})()`)) === true);
    await c.click('#pr-cancel'); await sleep(300);

    console.log('9. Enregistrement : structure des pages écrite dans le PDF');
    await ct(2);
    await c.click('#rpanel-pages [data-cmd=pg-rot-right]'); await waitIdle();
    await ct(5);
    await c.click('#rpanel-pages [data-cmd=pg-delete]'); await waitIdle();
    await c.key('s', { modifiers: 2, windowsVirtualKeyCode: 83 }); await sleep(2500);
    const saved = path.join(out, 'a-huit-pages.pdf');
    check('fichier enregistré', fs.existsSync(saved));
    const sd = await PDFLib.PDFDocument.load(fs.readFileSync(saved));
    check('7 pages dans le fichier enregistré', sd.getPageCount() === 7, sd.getPageCount());
    check('rotation de la page 3 écrite (/Rotate 90)', sd.getPage(2).getRotation().angle === 90);
    check('recadrage de la page 1 écrit (CropBox)', Math.abs(sd.getPage(0).getCropBox().width - (crop0[2] - crop0[0])) < 1, sd.getPage(0).getCropBox());
    check('plus « modifié » après l\'enregistrement', (await doc('d.dirty')) === false);
    check('aucune erreur JavaScript pendant le test', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    failures.push('exception : ' + (e && e.stack || e));
    console.log('  ECHEC exception', e && e.stack || e);
  } finally {
    await c.close();
    try { fs.rmSync(out, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  process.exit(failures.length ? 1 : 0);
})();
