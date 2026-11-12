// Glisser-déposer de PDF depuis l'Explorateur sur le panneau des miniatures (interface, hors écran) : vrais événements de glisser avec de vrais chemins
// de fichiers (CDP Input.dispatchDragEvent). Insertion au début, entre deux pages, à la fin, plusieurs fichiers, PDF chiffré, fichier non PDF,
// annuler / rétablir, défilement stable, dépôt hors du panneau inchangé. Usage : node test/test-drop-ui.js
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
  const enc = path.join(dir, 'chiffre-drop.pdf');
  {
    const d = await PDFLib.PDFDocument.create();
    d.addPage([595, 842]).drawText('Secret page 1', { x: 50, y: 700 });
    d.addPage([595, 842]).drawText('Secret page 2', { x: 50, y: 700 });
    d.encrypt({ userPassword: 'sesame', ownerPassword: 'sesame2', permissions: { printing: true } });
    fs.writeFileSync(enc, await d.save());
  }
  const txt = path.join(dir, 'notes-drop.txt');
  fs.writeFileSync(txt, 'pas un pdf');
  const c = await launchApp({ files: [f.a] });
  const J = async (e) => JSON.parse(await c.ev(e));
  const doc = (expr) => J(`import('./js/ui.js').then(m=>{const d=m.store.active; return JSON.stringify(${expr})})`);
  const pageText = (k) => c.ev(`import('./js/ui.js').then(async m=>{const r=m.store.active.runtime.pages[${k}]; const t=await r.page.getTextContent(); return t.items.map(i=>i.str).join(' ')})`);
  const srcs = () => doc('d.pages.map(p=>p.src+":"+p.i)');
  const thumbRect = async (i) => c.rect(`#sb-thumbs .thumb[data-index="${i}"]`);
  const into = (i) => c.ev(`document.querySelector('#sb-thumbs .thumb[data-index="${i}"]').scrollIntoView({block:'center'})`).then(() => sleep(100));
  const drag = async (type, x, y, files) => { await c.send('Input.dispatchDragEvent', { type, x, y, data: { items: [], files, dragOperationsMask: 1 } }); await sleep(60); };
  // dépose `files` sur la miniature i (moitié haute ou basse), ou en zone vide si i === null
  async function dropOn(files, i, after) {
    let x, y;
    if (i === null) {
      await c.ev(`(()=>{const p=document.getElementById('sb-thumbs'); p.scrollTop=p.scrollHeight; return 1})()`); await sleep(200);
      const r = JSON.parse(await c.ev(`(()=>{const r=document.getElementById('sb-thumbs').getBoundingClientRect(); const t=[...document.querySelectorAll('#sb-thumbs .thumb')].pop().getBoundingClientRect(); return JSON.stringify([r.left+r.width/2, Math.min(r.bottom-6, t.bottom+10)])})()`));
      [x, y] = r;
    } else {
      await into(i);
      const [l, t, w, h] = await thumbRect(i);
      x = l + w / 2; y = t + h * (after ? 0.8 : 0.2);
    }
    await drag('dragEnter', x, y, files);
    await drag('dragOver', x, y, files);
    const cls = await c.ev(`JSON.stringify([...document.querySelectorAll('#sb-thumbs .thumb')].filter((t)=>t.classList.contains('drop-before')||t.classList.contains('drop-after')).map((t)=>t.dataset.index+':'+(t.classList.contains('drop-after')?'after':'before')))`).then(JSON.parse);
    await drag('drop', x, y, files);
    await sleep(900);
    return cls;
  }
  const undo = async () => { await c.key('z', { modifiers: 2, windowsVirtualKeyCode: 90 }); await sleep(700); };
  const redo = async () => { await c.key('y', { modifiers: 2, windowsVirtualKeyCode: 89 }); await sleep(700); };
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(900);
    await c.click('#sb-toggle'); await sleep(500);
    check('document de test : 8 pages, 8 miniatures', (await doc('d.pages.length')) === 8 && (await c.ev(`document.querySelectorAll('#sb-thumbs .thumb').length`)) === 8);

    console.log('1. Insertion au début (moitié haute de la première miniature)');
    let cls = await dropOn([f.b], 0, false);
    check('trait de séparation avant la miniature 1 pendant le survol', cls.join() === '0:before', cls);
    check('5 pages de b insérées au début : 13 pages', (await doc('d.pages.length')) === 13);
    check('ordre : s1:0…s1:4 puis les pages d\'origine', (await srcs()).slice(0, 7).join() === 's1:0,s1:1,s1:2,s1:3,s1:4,0:0,0:1', await srcs());
    check('texte de la nouvelle première page', /Doc B - page 1/.test(await pageText(0)), await pageText(0));
    check('sélection = les pages insérées', (await doc('[...d.runtime.pageSel].sort((a,b)=>a-b)')).join() === '0,1,2,3,4');
    check('une seule étape d\'historique, document modifié', (await doc('[d.undo.length, d.dirty]')).join() === '1,true');
    await undo();
    check('Ctrl+Z : retour à 8 pages', (await doc('d.pages.length')) === 8 && (await c.ev(`document.querySelectorAll('#sb-thumbs .thumb').length`)) === 8);
    await redo();
    check('Ctrl+Y : 13 pages', (await doc('d.pages.length')) === 13);
    await undo();

    console.log('2. Entre deux pages (moitié basse de la miniature 2 = après la page 2)');
    cls = await dropOn([f.d], 1, true);
    check('trait après la miniature 2', cls.join() === '1:after', cls);
    check('3 pages de d entre les pages 2 et 3', (await srcs()).slice(0, 7).join() === '0:0,0:1,s2:0,s2:1,s2:2,0:2,0:3', await srcs());
    check('texte : page 3 = « Doc D - page 1 »', /Doc D - page 1/.test(await pageText(2)), await pageText(2));
    await undo();

    console.log('3. À la fin (zone vide sous la dernière miniature)');
    cls = await dropOn([f.b], null);
    check('trait après la dernière miniature', cls.join() === '7:after', cls);
    check('13 pages, les nouvelles à la fin', (await doc('d.pages.length')) === 13 && (await srcs()).slice(-5).join() === 's3:0,s3:1,s3:2,s3:3,s3:4', await srcs());
    await undo();

    console.log('4. Plusieurs fichiers d\'un coup : dans l\'ordre');
    await dropOn([f.d, f.b], 0, false);
    check('d (3 pages) puis b (5 pages) au début : 16 pages', (await doc('d.pages.length')) === 16 && (await srcs()).slice(0, 8).map((x) => x.replace(/s\d+/, 's')).join() === 's:0,s:1,s:2,s:0,s:1,s:2,s:3,s:4', await srcs());
    check('texte : « Doc D - page 1 » puis « Doc B - page 1 » en 4e', /Doc D - page 1/.test(await pageText(0)) && /Doc B - page 1/.test(await pageText(3)));
    check('une seule étape d\'historique', (await doc('d.undo.length')) === 1);
    await undo();

    console.log('5. PDF chiffré');
    await c.ev(`document.getElementById('pgdlg').hidden`);
    await into(0);
    const [l, t, w, h] = await thumbRect(0);
    const x = l + w / 2, y = t + h * 0.2;
    await drag('dragEnter', x, y, [enc]); await drag('dragOver', x, y, [enc]); await drag('drop', x, y, [enc]);
    await c.waitFor(`!document.getElementById('pgdlg').hidden`, 5000);
    check('mot de passe demandé', /protégé/.test(await c.ev(`document.getElementById('pgdlg-intro').textContent`)));
    await c.ev(`(()=>{const e=document.getElementById('pgf-pw'); e.value='faux'; return 1})()`); await c.click('#pgdlg-ok'); await sleep(800);
    check('mauvais mot de passe : demandé à nouveau, message clair', !(await c.ev(`document.getElementById('pgdlg').hidden`)) && /incorrect/.test(await c.ev(`document.getElementById('pgdlg-intro').textContent`)), await c.ev(`document.getElementById('pgdlg-intro').textContent`));
    await c.ev(`(()=>{const e=document.getElementById('pgf-pw'); e.value='sesame'; return 1})()`); await c.click('#pgdlg-ok');
    await c.waitFor(`document.getElementById('pgdlg').hidden`, 5000); await sleep(1500);
    check('bon mot de passe : 2 pages insérées au début', (await doc('d.pages.length')) === 10, await doc('d.pages.length'));
    check('contenu lisible (« Secret page 1 »)', /Secret page 1/.test(await pageText(0)), await pageText(0));
    // enregistrement : le PDF produit n'est pas chiffré et contient les pages
    const n = await c.ev(`import('./js/ui.js').then(async (m)=>{const V=await import('./js/viewer.js'); const b=await V.exportBytes(m.store.active); const d=await window.PDFLib.PDFDocument.load(b); return d.getPageCount()})`);
    check('écriture du document avec les pages déchiffrées : 10 pages', n === 10, n);
    await undo();
    // annulation de la boîte : fichier ignoré
    await drag('dragEnter', x, y, [enc]); await drag('dragOver', x, y, [enc]); await drag('drop', x, y, [enc]);
    await c.waitFor(`!document.getElementById('pgdlg').hidden`, 5000);
    await c.click('#pgdlg-cancel'); await sleep(800);
    check('boîte annulée : rien n\'est inséré, message clair', (await doc('d.pages.length')) === 8 && /ignoré/.test(await c.ev(`document.getElementById('toast').textContent`)), await c.ev(`document.getElementById('toast').textContent`));

    console.log('6. Fichier non PDF');
    await drag('dragEnter', x, y, [txt]); await drag('dragOver', x, y, [txt]); await drag('drop', x, y, [txt]); await sleep(600);
    check('message « n\'est pas un PDF », aucune page ajoutée', (await doc('d.pages.length')) === 8 && /n'est pas un PDF/.test(await c.ev(`document.getElementById('toast').textContent`)));
    await dropOn([txt, f.d], 0, false);
    check('mélange texte + PDF : le PDF est inséré, le texte ignoré', (await doc('d.pages.length')) === 11);
    await undo();

    console.log('7. Défilement stable');
    await c.ev(`import('./js/ui.js').then(async (m)=>{const V=await import('./js/viewer.js'); V.goToPage(m.store.active, 4); return 1})`); await sleep(700);
    const before = JSON.parse(await c.ev(`import('./js/ui.js').then(m=>{const d=m.store.active; const r=d.runtime.pages[d.page]; return JSON.stringify([d.page, Math.round(r.div.getBoundingClientRect().top - d.runtime.viewer.getBoundingClientRect().top), r.uid])})`));
    await dropOn([f.b], 0, false);
    const after = JSON.parse(await c.ev(`import('./js/ui.js').then(m=>{const d=m.store.active; const r=d.runtime.pages[d.page]; return JSON.stringify([d.page, Math.round(r.div.getBoundingClientRect().top - d.runtime.viewer.getBoundingClientRect().top), r.uid])})`));
    check('la page affichée reste la même (indice décalé de 5) et au même endroit à l\'écran', after[2] === before[2] && after[0] === before[0] + 5 && Math.abs(after[1] - before[1]) <= 3, { before, after });
    await undo();

    console.log('8. Dépôt hors du panneau : comportement inchangé (ouverture dans un onglet)');
    const tabs0 = await c.ev(`document.querySelectorAll('.doctab').length`);
    const [vx, vy] = JSON.parse(await c.ev(`(()=>{const r=document.querySelector('.docview.active .viewer').getBoundingClientRect(); return JSON.stringify([r.left+r.width/2, r.top+r.height/2])})()`));
    await drag('dragEnter', vx, vy, [f.d]); await drag('dragOver', vx, vy, [f.d]); await drag('drop', vx, vy, [f.d]); await sleep(1500);
    check('le PDF s\'ouvre dans un nouvel onglet, le document actif est inchangé', (await c.ev(`document.querySelectorAll('.doctab').length`)) === tabs0 + 1);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : dépôt de PDF dans les miniatures.');
})();
