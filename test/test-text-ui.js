// « Modifier texte » / « Ajouter texte » dans l'interface : couleur, police, fond, texte incliné, page paysage, page /Rotate 90.
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

async function makeSource(file) {
  const { rgb, degrees, StandardFonts } = PDFLib;
  const d = await PDFLib.PDFDocument.create();
  const helv = await d.embedFont(StandardFonts.Helvetica);
  const obl = await d.embedFont(StandardFonts.HelveticaOblique);
  const p1 = d.addPage([595, 842]);
  p1.drawRectangle({ x: 60, y: 640, width: 460, height: 60, color: rgb(0.8, 0.8, 0.8) });
  p1.drawText('Rouge italique sur cellule', { x: 70, y: 662, size: 20, font: obl, color: rgb(0.85, 0.1, 0.1) });
  p1.drawText('Angle trente degres', { x: 100, y: 400, size: 22, font: helv, color: rgb(0, 0, 0), rotate: degrees(30) });
  p1.drawText('Verticale quatre vingt dix', { x: 480, y: 300, size: 20, font: helv, color: rgb(0.1, 0.2, 0.85), rotate: degrees(90) });
  const p2 = d.addPage([842, 595]);
  p2.drawRectangle({ x: 80, y: 280, width: 500, height: 50, color: rgb(0.8, 0.8, 0.8) });
  p2.drawText('Paysage bleu sur gris', { x: 100, y: 296, size: 24, font: helv, color: rgb(0.1, 0.2, 0.85) });
  const p3 = d.addPage([595, 842]);
  p3.setRotation(degrees(90));
  p3.drawText('Page tournee verte', { x: 100, y: 496, size: 22, font: helv, color: rgb(0.1, 0.55, 0.15) });
  fs.writeFileSync(file, await d.save());
}

(async () => {
  const file = path.join(os.tmpdir(), 'spinadoc-text-ui.pdf');
  await makeSource(file);
  const c = await launchApp({ files: [file] });
  const J = async (e) => JSON.parse(await c.ev(e));
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(900);
    await c.click('#rtab-annotate');
    await c.click('#rpanel-annotate [data-cmd=props]'); // panneau de propriétés activé
    const tool = (t) => c.click(`#rpanel-annotate [data-cmd=tool-${t}]`);
    const pageNo = async (n) => { await c.ev(`(()=>{const i=document.getElementById('in-page'); i.value=${n}; i.dispatchEvent(new Event('change'))})()`); await sleep(700); };
    // position écran d'un point PDF de la page n (page non pivotée)
    const scr = async (n, ptW, x, y, ptH) => { const [l, t, w] = await c.rect(`.docview.active .page:nth-child(${n})`); const s = w / ptW; return [l + x * s, t + (ptH - y) * s]; };
    const svgInfo = () => J(`JSON.stringify([...document.querySelectorAll('.docview.active .page:nth-child(1) .covers path')].map(p=>({fill:p.getAttribute('fill'), d:p.getAttribute('d')})).concat([...document.querySelectorAll('.docview.active .page:nth-child(1) .objs text')].map(t=>({text:t.textContent, fill:t.getAttribute('fill'), tr:t.getAttribute('transform'), fam:t.getAttribute('font-style')+'|'+t.getAttribute('font-family')}))))`);
    const rgbOf = (s) => (s.match(/\d+/g) || []).map(Number);
    const key = (k, code, vk) => c.key(k, { code, windowsVirtualKeyCode: vk });

    // ------------------------------------------------------------ 1. texte rouge italique sur cellule grise
    console.log('1. Couleur, police, fond');
    await tool('edit');
    let [x, y] = await scr(1, 595, 130, 669, 842);
    await c.mouse('mouseMoved', x, y, { buttons: 0 }); await sleep(500); await c.mouse('mouseMoved', x + 2, y, { buttons: 0 }); await sleep(300);
    check('survol : le bloc de texte est surligné', (await c.ev(`document.querySelectorAll('.docview.active .page:nth-child(1) .hover-poly').length`)) === 1);
    await c.clickXY(x, y); await sleep(700);
    check('clic : l\'éditeur s\'ouvre prérempli avec le texte d\'origine', (await c.ev(`document.querySelector('textarea.editor')?.value`)) === 'Rouge italique sur cellule');
    const note = await c.ev(`document.querySelector('.prop-note')?.textContent || ''`);
    check('panneau : « Police d\'origine : … → remplacée par … »', /Police d'origine : Helvetica-Oblique → remplacée par Helvetica italique/.test(note), note);
    const edBg = await c.ev(`getComputedStyle(document.querySelector('textarea.editor')).backgroundColor`);
    check('l\'éditeur reprend la couleur du fond détecté (gris)', rgbOf(edBg).every((v) => Math.abs(v - 204) <= 6), edBg);
    await c.type('Remplace'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(400);
    let info = await svgInfo();
    const cover = info.find((i) => i.d), txt = info.find((i) => i.text);
    check('recouvrement de la couleur du fond détectée (gris, pas blanc)', cover && rgbOf(cover.fill).every((v) => Math.abs(v - 204) <= 6), cover);
    check('texte remplacé : couleur d\'origine (rouge) et italique', txt && txt.text === 'Remplace' && rgbOf(txt.fill)[0] > 180 && rgbOf(txt.fill)[1] < 90 && /italic/.test(txt.fam), txt);
    // sélection du texte remplacé : panneau « Texte remplacé » avec fond Auto ; passage à « Blanc »
    await tool('select');
    [x, y] = await scr(1, 595, 72, 668, 842);
    await c.clickXY(x, y); await sleep(350);
    check('texte remplacé sélectionné : panneau « Texte modifié »', (await c.ev(`document.getElementById('props-title').textContent`)) === 'Texte modifié');
    await c.ev(`(()=>{const row=[...document.querySelectorAll('#props .prop-row')].find(r=>r.querySelector('label').textContent==='Fond du texte remplacé'); const s=row.querySelector('select'); s.value='white'; s.dispatchEvent(new Event('change'))})()`); await sleep(300);
    info = await svgInfo();
    check('fond « Blanc » : recouvrement blanc', rgbOf(info.find((i) => i.d).fill).every((v) => v === 255), info.find((i) => i.d));
    await c.ev(`(()=>{const row=[...document.querySelectorAll('#props .prop-row')].find(r=>r.querySelector('label').textContent==='Fond du texte remplacé'); const s=row.querySelector('select'); s.value='custom'; s.dispatchEvent(new Event('change'))})()`); await sleep(300);
    await c.ev(`(()=>{const row=[...document.querySelectorAll('#props .prop-row')].find(r=>r.querySelector('label').textContent==='Couleur du fond'); const i=row.querySelector('input'); i.value='#ffff00'; i.dispatchEvent(new Event('change'))})()`); await sleep(300);
    info = await svgInfo();
    check('fond « Personnalisé » (jaune)', rgbOf(info.find((i) => i.d).fill).join(',') === '255,255,0', info.find((i) => i.d));
    await c.ev(`(()=>{const row=[...document.querySelectorAll('#props .prop-row')].find(r=>r.querySelector('label').textContent==='Police'); const s=row.querySelector('select'); s.value='Times'; s.dispatchEvent(new Event('change'))})()`); await sleep(300);
    check('police modifiable à la main (Times)', /Times/.test((await svgInfo()).find((i) => i.text).fam));

    // ------------------------------------------------------------ 2. texte incliné et vertical
    console.log('2. Texte incliné et vertical');
    await tool('edit');
    // « Angle trente degres » : origine (100,400), 30° ; milieu du texte ≈ origine + 90*(cos30, sin30)
    [x, y] = await scr(1, 595, 100 + 90 * Math.cos(Math.PI / 6), 400 + 90 * Math.sin(Math.PI / 6) + 3, 842);
    await c.mouse('mouseMoved', x, y, { buttons: 0 }); await sleep(500); await c.mouse('mouseMoved', x + 1, y, { buttons: 0 }); await sleep(300);
    const hd = await c.ev(`document.querySelector('.docview.active .page:nth-child(1) .hover-poly')?.getAttribute('d') || ''`);
    const hp = (hd.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    check('survol d\'un texte à 30° : zone surlignée tournée avec le texte', hp.length >= 8 && Math.abs(hp[1] - hp[3]) > 5 && Math.abs(hp[0] - hp[2]) > 5, hp.slice(0, 4));
    await c.clickXY(x, y); await sleep(700);
    const tr = await c.ev(`document.querySelector('textarea.editor')?.style.transform || ''`);
    check('éditeur tourné de 30° comme le texte', /rotate\(-30/.test(tr), tr);
    await c.type('Incline'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(400);
    info = await svgInfo();
    check('texte remplacé à 30° : le calque est tourné de -30° à l\'écran', info.some((i) => i.text === 'Incline' && /rotate\(-30/.test(i.tr)), info.filter((i) => i.text));
    // texte vertical (90°) : origine (480,300), monte vers le haut
    [x, y] = await scr(1, 595, 470, 505, 842);
    await c.mouse('mouseMoved', x, y, { buttons: 0 }); await sleep(500); await c.mouse('mouseMoved', x, y + 1, { buttons: 0 }); await sleep(300);
    check('survol d\'un texte vertical : bloc surligné', (await c.ev(`document.querySelectorAll('.docview.active .page:nth-child(1) .hover-poly').length`)) === 1);
    await c.clickXY(x, y); await sleep(700);
    check('texte vertical : l\'éditeur s\'ouvre avec le texte d\'origine', (await c.ev(`document.querySelector('textarea.editor')?.value`)) === 'Verticale quatre vingt dix');
    await c.key('Escape', { code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300);

    // ------------------------------------------------------------ 3. page paysage
    console.log('3. Page paysage');
    await pageNo(2);
    [x, y] = await scr(2, 842, 160, 303, 595);
    await c.mouse('mouseMoved', x, y, { buttons: 0 }); await sleep(500); await c.mouse('mouseMoved', x + 1, y, { buttons: 0 }); await sleep(300);
    await c.clickXY(x, y); await sleep(700);
    check('page paysage : Modifier texte fonctionne (éditeur prérempli)', (await c.ev(`document.querySelector('textarea.editor')?.value`)) === 'Paysage bleu sur gris');
    await c.type('Paysage ok'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(400);
    const ls = await J(`JSON.stringify({cover:[...document.querySelectorAll('.docview.active .page:nth-child(2) .covers path')].map(p=>p.getAttribute('fill')), text:[...document.querySelectorAll('.docview.active .page:nth-child(2) .objs text')].map(t=>[t.textContent,t.getAttribute('fill')])})`);
    check('page paysage : fond gris et texte bleu conservés', ls.cover.length === 1 && rgbOf(ls.cover[0]).every((v) => Math.abs(v - 204) <= 6) && rgbOf(ls.text[0][1])[2] > 180 && rgbOf(ls.text[0][1])[0] < 90, ls);
    await tool('add');
    [x, y] = await scr(2, 842, 100, 450, 595);
    await c.clickXY(x, y); await sleep(300); await c.type('Ajout paysage'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(400);
    const lw = await J(`(()=>{const t=[...document.querySelectorAll('.docview.active .page:nth-child(2) .objs text')].find(t=>t.textContent==='Ajout paysage'); const r=t.getBoundingClientRect(); return JSON.stringify([r.width,r.height])})()`);
    check('page paysage : Ajouter texte, texte horizontal', lw[0] > lw[1] * 3, lw);

    // ------------------------------------------------------------ 4. page /Rotate 90
    console.log('4. Page /Rotate 90 et affichage pivoté');
    await pageNo(3);
    const pr = await c.rect('.docview.active .page:nth-child(3)');
    check('la page /Rotate 90 est affichée en paysage', pr[2] > pr[3], pr);
    await tool('add');
    await c.clickXY(pr[0] + 150, pr[1] + 150); await sleep(300); await c.type('Texte droit'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(400);
    const rp = await J(`(()=>{const t=[...document.querySelectorAll('.docview.active .page:nth-child(3) .objs text')].find(t=>t.textContent==='Texte droit'); const r=t.getBoundingClientRect(); return JSON.stringify({w:r.width,h:r.height,tr:t.getAttribute('transform')})})()`);
    check('page /Rotate 90 : Ajouter texte apparaît droit (horizontal) à l\'écran', rp.w > rp.h * 3, rp);
    // Modifier texte sur la page pivotée
    await tool('edit');
    await c.ev(`document.querySelector('.docview.active .viewer').scrollTop = document.querySelector('.docview.active .page:nth-child(3)').offsetTop - 18`); await sleep(500);
    const pr2 = await c.rect('.docview.active .page:nth-child(3)');
    // texte d'origine : repère page (100,496) taille 22 ; sur la page affichée tournée de 90° : x_écran = y_pdf, y_écran = x_pdf
    const sx = pr2[2] / 842;
    const ex = pr2[0] + (496 + 6) * sx, ey = pr2[1] + (100 + 60) * sx;
    await c.mouse('mouseMoved', ex, ey, { buttons: 0 }); await sleep(500); await c.mouse('mouseMoved', ex + 1, ey, { buttons: 0 }); await sleep(300);
    await c.clickXY(ex, ey); await sleep(800);
    check("page /Rotate 90 : Modifier texte (éditeur prérempli, tourné comme le texte d'origine à l'écran)", (await c.ev(`document.querySelector('textarea.editor')?.value`)) === 'Page tournee verte' && /rotate\(90deg\)/.test(await c.ev(`document.querySelector('textarea.editor')?.style.transform || ''`)), await c.ev(`document.querySelector('textarea.editor')?.style.transform || ''`));
    await c.key('Escape', { code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300);
    // affichage pivoté de 90° sur la page 1
    await tool('select'); await pageNo(1);
    await c.click('#rtab-view'); await c.click('[data-cmd=rotate-right]'); await sleep(600);
    await c.click('#rtab-annotate'); await tool('add');
    const p1r = await c.rect('.docview.active .page:nth-child(1)');
    await c.clickXY(p1r[0] + 120, p1r[1] + 120); await sleep(300); await c.type('Affichage pivote'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(400);
    const vr = await J(`(()=>{const t=[...document.querySelectorAll('.docview.active .page:nth-child(1) .objs text')].find(t=>t.textContent==='Affichage pivote'); const r=t.getBoundingClientRect(); return JSON.stringify([r.width,r.height])})()`);
    check('affichage pivoté de 90° : Ajouter texte apparaît droit', vr[0] > vr[1] * 3, vr);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : texte (interface).');
})();
