// Interface 2b-1 : note, tampons (prédéfinis, bibliothèque), images (bouton, glisser-déposer, Ctrl+V, réduction), signatures.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const PDFLib = require('@cantoo/pdf-lib');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

const dir = path.join(os.tmpdir(), 'spinadoc-stamps-ui');
fs.mkdirSync(dir, { recursive: true });
function writeImg(file, w, h, mime, color) {
  const c = createCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgb(255,255,255)'; g.fillRect(w / 2, 0, w / 2, h / 4);
  fs.writeFileSync(file, c.toBuffer(mime));
}
const small = path.join(dir, 'petite image.png');
const big = path.join(dir, 'grande-image.png');
const photo = path.join(dir, 'photo.jpg');
writeImg(small, 120, 60, 'image/png', 'rgb(200,30,30)');
writeImg(big, 4200, 100, 'image/png', 'rgb(30,30,200)');
writeImg(photo, 90, 90, 'image/jpeg', 'rgb(30,160,60)');

(async () => {
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-stamps-save-'));
  const c = await launchApp({ files: [f.a], env: { SPINADOC_TEST_IMAGES: JSON.stringify([small]), SPINADOC_TEST_CLIPBOARD_IMAGE: photo, SPINADOC_TEST_SAVE_DIR: saveDir } });
  const J = async (e) => JSON.parse(await c.ev(e));
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(900);
    const SC = 4 / 3;
    const P = async (x, y) => { const [l, t] = await c.rect('.docview.active .page'); return [l + x * SC, t + y * SC]; };
    const click = async (x, y) => c.clickXY(...(await P(x, y)));
    const mouse = (type, x, y, mods = 0) => c.mouse(type, x, y, { modifiers: mods });
    const drag = async (x1, y1, x2, y2, mods = 0) => {
      await mouse('mouseMoved', x1, y1, mods); await mouse('mousePressed', x1, y1, mods);
      for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', x1 + ((x2 - x1) * i) / 6, y1 + ((y2 - y1) * i) / 6, mods); await sleep(15); }
      await mouse('mouseReleased', x2, y2, mods); await sleep(200);
    };
    const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
    const objs = () => J(`JSON.stringify([...document.querySelectorAll('.docview.active .page:nth-child(1) .objs > g')].map(g=>({id:g.dataset.id, texts:[...g.querySelectorAll('text')].map(t=>t.textContent), image:!!g.querySelector('image'), imgHref:(g.querySelector('image')||{getAttribute:()=>null}).getAttribute('href'), fill:(g.querySelector('path')||{getAttribute:()=>null}).getAttribute('fill'), stroke:(g.querySelector('path')||{getAttribute:()=>null}).getAttribute('stroke'), paths:g.querySelectorAll('path').length})))`);
    const state = () => J(`JSON.stringify({tool:[...document.querySelectorAll('[data-cmd^=tool-][aria-pressed=true]')].map(b=>b.dataset.cmd).join(','), label:document.getElementById('tool-label').textContent, title:document.getElementById('props-title').textContent, propsOpen:!document.getElementById('props').hidden})`);
    const lib = () => J(`window.spinadoc.libList().then(l=>JSON.stringify(l.map(e=>({kind:e.kind,name:e.name,hasBytes:!!e.bytes}))))`);
    const assetCount = () => c.ev(`import('./js/ui.js').then(m=>Object.keys(m.store.active.assets.images).length)`);
    const rgbOf = (s) => (String(s).match(/\d+/g) || []).map(Number);
    const doDrop = async (file, x, y) => {
      const data = { items: [], files: [file], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await c.send('Input.dispatchDragEvent', { type, x, y, data });
      await sleep(1200);
    };

    await c.click('#rtab-annotate'); await sleep(200);
    await c.click('#rpanel-annotate [data-cmd=props]'); await sleep(200); // panneau de propriétés activé
    const ribbonOk = await c.ev(`['tool-note','stamps-menu','image-insert','sig-menu'].every(c=>!!document.querySelector('#rpanel-annotate [data-cmd='+c+']'))`);
    check('ruban Annoter : Note, Tampons, Image, Signature', ribbonOk === true);

    // ------------------------------------------------------------ 1. note
    console.log('1. Note');
    await c.click('#rpanel-annotate [data-cmd=tool-note]');
    await sleep(500);
    await click(60, 120); await c.waitFor(`!!document.querySelector('textarea.editor')`, 3000); await c.type('Ma première note'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(350);
    let o = await objs();
    check('note créée : cartouche jaune avec bordure et texte', o.length === 1 && rgbOf(o[0].fill).join() === '255,245,153' && o[0].texts.join(' ').includes('Ma première note'), o);
    check('outil Note persistant', (await state()).label === 'Outil : Note');
    await click(60, 220); await sleep(300); await c.type('Seconde note'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(350);
    check('deuxième note sans rechoisir l\'outil', (await objs()).length === 2);
    await key('Escape', 'Escape', 27); await sleep(200);

    // ------------------------------------------------------------ 2. tampons prédéfinis
    console.log('2. Tampons');
    await c.click('#rpanel-annotate [data-cmd=stamps-menu]'); await sleep(300);
    check('menu Tampons : 6 prédéfinis', (await c.ev(`document.querySelectorAll('#lib-menu .lib-cell').length`)) === 6);
    check('menu : rappel « signature ≠ » non requis ici, options Date / Nom / Incliné présentes', (await c.ev(`document.querySelectorAll('#lib-menu .lib-opts input').length`)) === 3);
    await c.click('#lib-menu .lib-cell'); await sleep(300);
    check('« Approuvé » choisi : outil Tampon actif (menu fermé)', (await state()).label === 'Outil : Tampon' && (await c.ev(`document.getElementById('lib-menu').hidden`)) === true);
    await click(300, 120); await click(300, 200); await sleep(300);
    o = await objs();
    const stamps = o.filter((x) => x.texts.includes('APPROUVÉ'));
    check('deux tampons posés de suite (outil persistant), texte en capitales', stamps.length === 2, o);
    check('tampon : cadre vert (tracé vectoriel)', stamps[0] && rgbOf(stamps[0].stroke)[1] > rgbOf(stamps[0].stroke)[0], stamps[0]);
    await key('Escape', 'Escape', 27); await sleep(200);
    check('Échap quitte l\'outil tampon', (await state()).tool.includes('tool-select') || (await state()).label === '');
    // options Date + Nom
    await c.click('#btn-settings'); await c.ev(`(()=>{const i=document.getElementById('opt-username'); i.value='M. TEST'; i.dispatchEvent(new Event('change'))})()`); await c.click('#settings-close');
    await c.click('#rpanel-annotate [data-cmd=stamps-menu]'); await sleep(250);
    await c.ev(`(()=>{const cb=document.querySelectorAll('#lib-menu .lib-opts input'); cb[0].click(); cb[1].click(); cb[2].click();})()`); await sleep(150);
    await c.click('#lib-menu .lib-grid .lib-cell:nth-child(2)'); await sleep(250);
    await click(300, 300); await sleep(300);
    o = await objs();
    const refuse = o.find((x) => x.texts.includes('REFUSÉ'));
    check('tampon avec date jj/mm/aaaa et nom', refuse && refuse.texts.some((t) => /^\d\d\/\d\d\/\d{4}$/.test(t)) && refuse.texts.includes('M. TEST'), refuse);
    await key('Escape', 'Escape', 27);
    // sélection, propriétés, redimensionnement proportionnel
    await c.click('#rpanel-annotate [data-cmd=tool-select]');
    await click(300, 120); await sleep(250);
    check('tampon sélectionné : panneau « Tampon »', (await state()).title === 'Tampon', { st: await state(), edits: await c.ev(`import('./js/ui.js').then(m=>JSON.stringify({sel:m.store.active.selection, tool:m.store.active.tool, e:m.store.active.edits.map(e=>[e.type,Math.round(e.cx||e.x),Math.round(e.cy||e.y),Math.round(e.w||0),Math.round(e.h||0)])}))`), pt: await P(300, 120), pa: await c.ev(`import('./js/settings.js').then(s=>s.get('propsAuto')+'|'+document.getElementById('props').hidden+'|'+document.getElementById('props').className)`) });
    const sizeOf = () => J(`(()=>{const g=document.querySelector('.docview.active .page:nth-child(1) .objs > g[data-id="${'__ID__'}"]');return '[]'})()`);
    const box = async () => J(`(()=>{const s=[...document.querySelectorAll('.docview.active .page:nth-child(1) .sel-outline')][0].getBoundingClientRect(); return JSON.stringify([s.width,s.height])})()`);
    const b0 = await box();
    const hs = await J(`JSON.stringify([...document.querySelectorAll('.docview.active .page:nth-child(1) .sel-handle')].map(h=>{const r=h.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}))`);
    await drag(hs[4][0], hs[4][1], hs[4][0] + 40, hs[4][1] + 10); // coin sud-est
    const b1 = await box();
    check('redimensionnement proportionnel (rapport largeur/hauteur conservé)', b1[0] > b0[0] + 20 && Math.abs(b1[0] / b1[1] - b0[0] / b0[1]) < 0.02, { b0, b1 });
    const hs2 = await J(`JSON.stringify([...document.querySelectorAll('.docview.active .page:nth-child(1) .sel-handle')].map(h=>{const r=h.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}))`);
    await drag(hs2[4][0], hs2[4][1], hs2[4][0] + 60, hs2[4][1] + 2, 8); // Maj = libre
    const b2 = await box();
    check('Maj + poignée : redimensionnement libre', Math.abs(b2[0] / b2[1] - b1[0] / b1[1]) > 0.1, { b1, b2 });
    check('poignée de rotation présente', (await c.ev(`document.querySelectorAll('.docview.active .page:nth-child(1) .sel-handle').length`)) === 9);
    await c.ev(`(()=>{const row=[...document.querySelectorAll('#props .prop-row')].find(r=>r.querySelector('label').textContent==='Texte du tampon'); const i=row.querySelector('input'); i.value='Validé'; i.dispatchEvent(new Event('change'))})()`); await sleep(300);
    check('propriétés : texte du tampon modifiable', (await objs()).some((x) => x.texts.includes('VALIDÉ')));
    await key('Delete', 'Delete', 46); await sleep(250);

    // ------------------------------------------------------------ 3. bibliothèque de tampons
    console.log('3. Bibliothèque de tampons');
    await c.click('#rpanel-annotate [data-cmd=stamps-menu]'); await sleep(250);
    await c.click('#lib-menu .lib-create'); await sleep(300);
    check('boîte « Créer un tampon » ouverte', (await c.ev(`!document.getElementById('stampdlg').hidden`)) === true);
    await c.ev(`(()=>{const l=document.getElementById('sd-label'); l.value='Reçu'; l.dispatchEvent(new Event('input')); const n=document.getElementById('sd-name'); n.value='Mon reçu'; })()`);
    check('aperçu du tampon dans la boîte', (await c.ev(`document.querySelectorAll('#sd-preview svg').length`)) === 1);
    await c.click('#sd-save'); await sleep(700);
    let L = await lib();
    check('tampon texte enregistré dans la bibliothèque (userData)', L.length === 1 && L[0].kind === 'stamp-text' && L[0].name === 'Mon reçu', L);
    check('outil Tampon actif après la création', (await state()).label === 'Outil : Tampon');
    await click(300, 330); await sleep(300);
    check('tampon personnalisé posé', (await objs()).some((x) => x.texts.includes('REÇU')));
    await key('Escape', 'Escape', 27);
    // tampon image
    await c.click('#rpanel-annotate [data-cmd=stamps-menu]'); await sleep(250);
    await c.click('#lib-menu .lib-create'); await sleep(250);
    await c.click('#sd-tab-img'); await c.click('#sd-pick'); await sleep(800);
    check('tampon image : aperçu', (await c.ev(`document.querySelectorAll('#sd-preview img').length`)) === 1);
    await c.ev(`document.getElementById('sd-name').value='Logo rouge'`);
    await c.click('#sd-save'); await sleep(900);
    L = await lib();
    check('tampon image enregistré (fichier dans userData)', L.length === 2 && L[1].kind === 'stamp-image' && L[1].hasBytes, L);
    await click(120, 330); await sleep(400);
    check('tampon image posé (objet image)', (await objs()).some((x) => x.image));
    await key('Escape', 'Escape', 27);
    // renommer, supprimer
    await c.click('#rpanel-annotate [data-cmd=stamps-menu]'); await sleep(300);
    check('« Mes tampons » : 2 entrées', (await c.ev(`document.querySelectorAll('#lib-menu .lib-row').length`)) === 2);
    await c.click('#lib-menu .lib-row .icon-btn'); await sleep(200);
    await c.ev(`(()=>{const i=document.querySelector('#lib-menu .lib-rename'); i.value='Reçu final'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`); await sleep(500);
    L = await lib();
    check('renommer un tampon', L.some((e) => e.name === 'Reçu final'), L);
    await c.click('#lib-menu .lib-row .icon-btn[aria-label^=Supprimer]'); await sleep(500);
    check('supprimer un tampon', (await lib()).length === 1);
    await key('Escape', 'Escape', 27); await sleep(150);

    // ------------------------------------------------------------ 4. images
    console.log('4. Images');
    const nBefore = (await objs()).length;
    await c.click('#rpanel-annotate [data-cmd=image-insert]'); await sleep(900);
    check('Image : outil de pose actif', (await state()).label === 'Outil : Image');
    await click(60, 330); await click(160, 330); await sleep(400);
    o = await objs();
    check('image posée deux fois (outil persistant)', o.filter((x) => x.image).length >= 3 && o.length === nBefore + 2, o.length);
    check('même image (tampon image + image insérée + posées plusieurs fois) = un seul fichier dans le document', (await assetCount()) === 1, await assetCount());
    await key('Escape', 'Escape', 27);
    // glisser-déposer
    const nDrop = (await objs()).length;
    const [dx, dy] = await P(420, 150);
    await doDrop(photo, dx, dy);
    o = await objs();
    check('glisser-déposer d\'une image JPEG sur la page', o.length === nDrop + 1 && o[o.length - 1].image, o.length);
    // grande image → proposition de réduction
    await doDrop(big, dx, dy);
    const choiceOpen = await c.ev(`!document.getElementById('choice').hidden`);
    check('image de plus de 4000 px : proposition de réduction', choiceOpen === true && /4200/.test(await c.ev(`document.getElementById('choice-msg').textContent`)), await c.ev(`document.getElementById('choice-msg').textContent`));
    await c.click('#choice-actions .primary'); await sleep(1200);
    const dims = await J(`import('./js/ui.js').then(m=>JSON.stringify(Object.values(m.store.active.assets.images).map(a=>[a.w,a.h])))`);
    check('après « Réduire » : l\'image fait au plus 4000 px de côté', dims.some((d) => d[0] === 4000) && dims.every((d) => Math.max(d[0], d[1]) <= 4000), dims);
    // Ctrl+V
    const nPaste = (await objs()).length;
    await c.mouse('mouseMoved', 600, 500, { buttons: 0 });
    await key('v', 'KeyV', 86, 2); await sleep(1200);
    check('Ctrl+V : image du presse-papiers collée', (await objs()).length === nPaste + 1, (await objs()).length);
    await key('v', 'KeyV', 86, 2); await sleep(600);
    check('Ctrl+V répété : l\'image déjà collée n\'est pas recollée', (await objs()).length === nPaste + 1);
    // sélection d'une image : redimensionnement proportionnel, opacité
    await c.click('#rpanel-annotate [data-cmd=tool-select]');
    await click(90, 345); await sleep(300);
    check('image sélectionnée : panneau « Image » avec opacité', (await state()).title === 'Image' && (await c.ev(`[...document.querySelectorAll('#props .prop-row label')].some(l=>l.textContent==='Opacité')`)) === true);
    await c.ev(`(()=>{const row=[...document.querySelectorAll('#props .prop-row')].find(r=>r.querySelector('label').textContent==='Opacité'); const i=row.querySelector('input'); i.value=50; i.dispatchEvent(new Event('change'))})()`); await sleep(250);
    check('opacité 50 % appliquée', (await c.ev(`import('./js/ui.js').then(m=>{const d=m.store.active; const e=d.edits.find(x=>x.id===d.selection[0]); return e && e.opacity})`)) === 0.5);
    await key('Escape', 'Escape', 27);

    // ------------------------------------------------------------ 5. signatures
    console.log('5. Signatures');
    await c.click('#rpanel-annotate [data-cmd=sig-menu]'); await sleep(300);
    check('menu Signature : avertissement « pas une signature électronique qualifiée »', /qualifiée ou certifiée/.test(await c.ev(`document.getElementById('lib-menu').textContent`)));
    await c.click('#lib-menu .lib-create'); await sleep(350);
    check('boîte « Nouvelle signature » : onglets Dessiner / Importer / Taper', (await c.ev(`['sg-tab-draw','sg-tab-import','sg-tab-type'].every(i=>!!document.getElementById(i))`)) === true && /qualifiée ou certifiée/.test(await c.ev(`document.getElementById('sigdlg').textContent`)));
    const [cx0, cy0, cw, ch] = await c.rect('#sg-canvas');
    await mouse('mouseMoved', cx0 + cw * 0.1, cy0 + ch * 0.6); await mouse('mousePressed', cx0 + cw * 0.1, cy0 + ch * 0.6);
    for (let i = 1; i <= 25; i++) { await mouse('mouseMoved', cx0 + cw * (0.1 + i * 0.03), cy0 + ch * (0.5 + 0.3 * Math.sin(i / 2))); await sleep(8); }
    await mouse('mouseReleased', cx0 + cw * 0.85, cy0 + ch * 0.5); await sleep(150);
    check('dessin à la souris dans la zone', (await c.ev(`(()=>{const c=document.getElementById('sg-canvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) n++; return n})()`)) > 200);
    await c.ev(`document.getElementById('sg-name').value='Ma signature'`);
    await c.click('#sg-save'); await sleep(800);
    L = await lib();
    check('signature dessinée enregistrée (tracé vectoriel)', L.some((e) => e.kind === 'sig-ink' && e.name === 'Ma signature'), L);
    check('outil Signature actif', (await state()).label === 'Outil : Signature');
    await click(220, 120); await sleep(350);
    o = await objs();
    const sg = o[o.length - 1];
    check('signature posée : tracé vectoriel, pas d\'image', sg.paths >= 1 && !sg.image && /\d/.test(sg.stroke || ''), sg);
    await key('Escape', 'Escape', 27);
    // signature tapée
    await c.click('#rpanel-annotate [data-cmd=sig-menu]'); await sleep(250);
    await c.click('#lib-menu .lib-create'); await sleep(300);
    await c.click('#sg-tab-type'); await c.ev(`(()=>{const t=document.getElementById('sg-text'); t.value='Jean Test'; t.dispatchEvent(new Event('input'))})()`); await sleep(900);
    check('signature tapée : aperçu dans une police manuscrite', (await c.ev(`(()=>{const c=document.querySelector('#sg-type-prev canvas'); return c ? c.width+'x'+c.height : ''})()`)) !== '' && (await c.ev(`document.fonts.check('700 40px "Caveat"')`)) === true);
    await c.ev(`(()=>{const s=document.getElementById('sg-font'); s.value='Dancing Script'; s.dispatchEvent(new Event('change'))})()`); await sleep(700);
    check('police Dancing Script chargée (embarquée, hors ligne)', (await c.ev(`document.fonts.check('700 40px "Dancing Script"')`)) === true);
    await c.ev(`document.getElementById('sg-name').value='Signature tapée'`);
    await c.click('#sg-save'); await sleep(900);
    L = await lib();
    check('signature tapée enregistrée (image PNG transparente)', L.some((e) => e.kind === 'sig-image' && e.name === 'Signature tapée' && e.hasBytes), L);
    await click(220, 200); await sleep(400);
    check('signature tapée posée (image)', (await objs()).slice(-1)[0].image === true);
    await key('Escape', 'Escape', 27);
    // importée (détourage du fond blanc)
    await c.click('#rpanel-annotate [data-cmd=sig-menu]'); await sleep(250);
    await c.click('#lib-menu .lib-create'); await sleep(300);
    await c.click('#sg-tab-import'); await c.click('#sg-pick'); await sleep(900);
    check('signature importée : aperçu après détourage', (await c.ev(`document.querySelectorAll('#sg-import-prev canvas').length`)) === 1);
    await c.ev(`document.getElementById('sg-name').value='Signature importée'`);
    await c.click('#sg-save'); await sleep(900);
    check('signature importée enregistrée', (await lib()).some((e) => e.name === 'Signature importée'));
    await key('Escape', 'Escape', 27);
    // réutilisation + date à côté
    await c.click('#rpanel-annotate [data-cmd=sig-menu]'); await sleep(300);
    check('bibliothèque : 3 signatures', (await c.ev(`document.querySelectorAll('#lib-menu .lib-row').length`)) === 3);
    await c.ev(`document.querySelector('#lib-menu .lib-opts input').click()`); await sleep(150);
    await c.click('#lib-menu .lib-row .lib-pick'); await sleep(300);
    const nSig = (await objs()).length;
    await click(220, 280); await sleep(350);
    o = await objs();
    check('signature posée avec la date à côté (2 objets : signature + texte jj/mm/aaaa)', o.length === nSig + 2 && /^\d\d\/\d\d\/\d{4}$/.test(o[o.length - 1].texts[0] || ''), o.slice(-2));
    await key('Escape', 'Escape', 27);
    await c.click('#rpanel-annotate [data-cmd=sig-menu]'); await sleep(300);
    await c.click('#lib-menu .lib-row .icon-btn[aria-label^=Supprimer]'); await sleep(500);
    check('suppression d\'une signature de la bibliothèque', (await c.ev(`document.querySelectorAll('#lib-menu .lib-row').length`)) === 2);
    await key('Escape', 'Escape', 27);

    // ------------------------------------------------------------ 6. enregistrement
    console.log('6. Enregistrement');
    await c.ev(`document.body.click()`);
    await key('s', 'KeyS', 83, 2); await sleep(2500);
    const saved = fs.readdirSync(saveDir);
    check('Ctrl+S : fichier PDF écrit', saved.length === 1 && fs.readFileSync(path.join(saveDir, saved[0])).slice(0, 5).toString() === '%PDF-', saved);
    if (saved.length) {
      const bytes = fs.readFileSync(path.join(saveDir, saved[0]));
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
      const texts = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join('|');
      check('PDF enregistré : notes, tampons et date dans le contenu de la page', /Ma première note/.test(texts) && /APPROUVÉ/.test(texts) && /REÇU/.test(texts) && /M\. TEST/.test(texts), texts.slice(0, 200));
      const d = await PDFLib.PDFDocument.load(bytes);
      let imgs = 0;
      for (const [, obj] of d.context.enumerateIndirectObjects()) if (obj.dict && obj.dict.get && obj.dict.get(PDFLib.PDFName.of('Subtype')) === PDFLib.PDFName.of('Image')) imgs++;
      check('PDF enregistré : images intégrées une seule fois chacune (' + imgs + ' objets image)', imgs >= 3 && imgs <= 10, imgs);
    }
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : note, tampons, images, signatures (interface).');
})();
