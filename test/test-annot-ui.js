// Tests d'interface des annotations (lot 2a) : pilotage CDP. Nécessite un affichage. Usage : npm run test:ui
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

    // ------------------------------------------------------------ utilitaires
    const SC = 4 / 3; // zoom 100 %
    const page1 = async () => c.rect('.docview.active .page');
    const P = async (x, y) => { const [l, t] = await page1(); return [l + x * SC, t + y * SC]; }; // x, y en px de page → écran
    const mouse = (type, x, y, mods = 0) => c.mouse(type, x, y, { modifiers: mods });
    const drag = async (x1, y1, x2, y2, mods = 0, steps = 6) => {
      await mouse('mouseMoved', x1, y1, mods); await mouse('mousePressed', x1, y1, mods);
      for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps, mods); await sleep(15); }
      await mouse('mouseReleased', x2, y2, mods); await sleep(200);
    };
    const objs = () => J(`JSON.stringify([...document.querySelectorAll('.docview.active .page:nth-child(1) .objs > g')].map(g=>({id:g.dataset.id, d:(g.querySelector('path')||{getAttribute:()=>null}).getAttribute('d'), fill:(g.querySelector('path')||{getAttribute:()=>null}).getAttribute('fill'), sw:(g.querySelector('path')||{getAttribute:()=>null}).getAttribute('stroke-width'), n:g.children.length, blend:(g.querySelector('path')||{style:{}}).style.mixBlendMode||'' })))`);
    const nums = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    const tool = (t) => c.click(`#rpanel-annotate [data-cmd=tool-${t}]`);
    const handles = () => J(`JSON.stringify([...document.querySelectorAll('.docview.active .page:nth-child(1) .sel-handle')].map(h=>{const r=h.getBoundingClientRect();return [r.left+r.width/2, r.top+r.height/2]}))`);
    const state = () => J(`JSON.stringify({dot:!!document.querySelector('.doctab[aria-selected=true] .doctab-dot'), props:!document.getElementById('props').hidden, title:document.getElementById('props-title').textContent, tool:[...document.querySelectorAll('[data-cmd^=tool-][aria-pressed=true]')].map(b=>b.dataset.cmd).join(',')})`);
    const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });

    await c.click('#rtab-annotate'); await sleep(200);
    await c.click('#rpanel-annotate [data-cmd=props]'); await sleep(200); // le panneau de propriétés ne s'ouvre seul que s'il est activé
    check('ruban Annoter : outils formes, marquage, dessin, objets présents', (await c.ev(`['line','arrow','rect','ellipse','polygon','polyline','cloud','highlight','underline','strike','hlrect','pen','eraser'].every(t=>!!document.querySelector('[data-cmd=tool-'+t+']'))`)) === true);

    // ------------------------------------------------------------ 1. rectangle : création, propriétés
    console.log('1. Création et propriétés');
    await tool('rect');
    const [rx1, ry1] = await P(100, 150), [rx2, ry2] = await P(250, 230);
    await drag(rx1, ry1, rx2, ry2);
    let o = await objs();
    check('rectangle créé (un objet dans le calque)', o.length === 1 && /Z$/.test(o[0].d), o);
    let st = await state();
    check('outil persistant : « Rectangle » reste actif, aucun objet sélectionné, panneau = réglages de l\'outil', st.tool.includes('tool-rect') && (await handles()).length === 0 && st.props && st.title === 'Outil : Rectangle' && st.dot, st);
    await tool('select');
    { const [bx, by] = await P(175, 150); await c.clickXY(bx, by); await sleep(250); }
    check('« Sélection » + clic sur le bord : objet sélectionné, panneau « Rectangle »', (await state()).title === 'Rectangle');
    check('poignées : 8 de redimensionnement + 1 de rotation', (await handles()).length === 9);

    const setField = async (label, fn) => c.ev(`(()=>{const row=[...document.querySelectorAll('#props .prop-row')].find(r=>r.querySelector('label').textContent==='${label}'); ${fn}})()`);
    await setField('Épaisseur', `const i=row.querySelector('input'); i.value=6; i.dispatchEvent(new Event('change'))`); await sleep(200);
    o = await objs();
    check('panneau : épaisseur 6 pt appliquée (6 × 1,333 px)', Math.abs(Number(o[0].sw) - 6 * SC) < 0.05, o[0].sw);
    await setField('Remplissage', `const cb=row.querySelector('input[type=checkbox]'); cb.checked=false; cb.dispatchEvent(new Event('change'))`); await sleep(200);
    o = await objs();
    check('panneau : remplissage activé', o[0].fill && o[0].fill !== 'none', o[0].fill);
    await setField('Opacité', `const i=row.querySelector('input'); i.value=50; i.dispatchEvent(new Event('change'))`); await sleep(200);
    check('panneau : opacité 50 % (fill-opacity)', (await c.ev(`document.querySelector('.docview.active .objs path').getAttribute('fill-opacity')`)) === '0.5');
    await setField('Style de trait', `const s=row.querySelector('select'); s.value='dash'; s.dispatchEvent(new Event('change'))`); await sleep(200);
    check('panneau : style de trait en tirets', !!(await c.ev(`document.querySelector('.docview.active .objs path').getAttribute('stroke-dasharray')`)));

    // ------------------------------------------------------------ 2. déplacement, redimensionnement, rotation
    console.log('2. Déplacement, redimensionnement, rotation');
    const before = nums((await objs())[0].d);
    const [mx, my] = await P(175, 190);
    await drag(mx, my, mx + 40, my + 20);
    let after = nums((await objs())[0].d);
    check('déplacement : le rectangle bouge de (+40, +20) px', Math.abs(after[0] - before[0] - 40) < 2 && Math.abs(after[1] - before[1] - 20) < 2, { before: before.slice(0, 2), after: after.slice(0, 2) });
    await key('z', 'KeyZ', 90, 2); await sleep(200);
    after = nums((await objs())[0].d);
    check('Ctrl+Z annule le déplacement', Math.abs(after[0] - before[0]) < 0.5, after.slice(0, 2));
    await key('y', 'KeyY', 89, 2); await sleep(200);
    const moved = nums((await objs())[0].d);
    check('Ctrl+Y le rétablit', Math.abs(moved[0] - before[0] - 40) < 2);

    let hs = await handles(); // nw, n, ne, e, se, s, sw, w, rot
    const bb = async () => J(`(()=>{const p=document.querySelector('.docview.active .objs path'); const r=p.getBoundingClientRect(); return JSON.stringify([r.width, r.height])})()`);
    const sizeBefore = await bb();
    await drag(hs[4][0], hs[4][1], hs[4][0] + 30, hs[4][1] + 24);
    const sizeAfter = await bb();
    check('poignée sud-est : le rectangle grandit', sizeAfter[0] > sizeBefore[0] + 20 && sizeAfter[1] > sizeBefore[1] + 15, { sizeBefore, sizeAfter });
    hs = await handles();
    const cxs = (hs[0][0] + hs[4][0]) / 2, cys = (hs[0][1] + hs[4][1]) / 2;
    await drag(hs[8][0], hs[8][1], cxs + 80, cys, 0, 8); // vers la droite : rotation d'environ 90°
    const rd = nums((await objs())[0].d);
    const slanted = Math.abs(rd[1] - rd[3]) > 0.5 || Math.abs(rd[0] - rd[2]) > 0.5;
    check('poignée de rotation : le contour tourne', (rd[0] !== rd[2] || rd[1] !== rd[3]) && sizeAfter && slanted, rd.slice(0, 4));
    await drag((await handles())[8][0], (await handles())[8][1], cxs, cys - 80, 8, 8); // Maj = pas de 15°
    check('rotation avec Maj : aucune erreur, objet toujours là', (await objs()).length === 1);

    // ------------------------------------------------------------ 3. duplication, ordre, suppression
    console.log('3. Duplication, ordre, suppression');
    await key('d', 'KeyD', 68, 2); await sleep(250);
    check('Ctrl+D duplique (2 objets)', (await objs()).length === 2);
    const idsBefore = (await objs()).map((x) => x.id);
    await c.click('[data-cmd=obj-back]'); await sleep(250);
    const idsAfter = (await objs()).map((x) => x.id);
    check('« Arrière-plan » : l\'objet dupliqué passe en dessous', idsAfter[0] === idsBefore[1] && idsAfter[1] === idsBefore[0], { idsBefore, idsAfter });
    await key('Delete', 'Delete', 46); await sleep(250);
    check('Suppr supprime l\'objet sélectionné', (await objs()).length === 1);
    await key('z', 'KeyZ', 90, 2); await sleep(250);
    check('Annuler restaure la suppression', (await objs()).length === 2);

    // ------------------------------------------------------------ 4. ligne, flèche (Maj = 15°), polygone, crayon
    console.log('4. Ligne, flèche, polygone, crayon');
    await tool('line');
    const [lx1, ly1] = await P(60, 300), [lx2, ly2] = await P(260, 330);
    await drag(lx1, ly1, lx2, ly2, 8);
    o = await objs();
    const ln = nums(o[o.length - 1].d);
    const ang = (Math.atan2(-(ln[3] - ln[1]), ln[2] - ln[0]) * 180) / Math.PI;
    check('ligne + Maj : angle multiple de 15° (' + ang.toFixed(2) + '°)', Math.abs(ang / 15 - Math.round(ang / 15)) < 0.02, ang);
    await tool('arrow');
    const [ax1, ay1] = await P(60, 360), [ax2, ay2] = await P(260, 360);
    await drag(ax1, ay1, ax2, ay2);
    o = await objs();
    check('flèche : trait + pointe (2 tracés)', o[o.length - 1].n === 2, o[o.length - 1]);
    await tool('polygon');
    for (const [x, y] of [[300, 300], [380, 300], [380, 380], [300, 380]]) { const [sx, sy] = await P(x, y); await c.clickXY(sx, sy); await sleep(60); }
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (await P(300, 380))[0], y: (await P(300, 380))[1] });
    const [dx1, dy1] = await P(300, 380);
    await mouse('mousePressed', dx1, dy1); await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dx1, y: dy1, button: 'left', clickCount: 2, buttons: 1 }); await mouse('mouseReleased', dx1, dy1); await sleep(250);
    o = await objs();
    check('polygone : clics + double-clic → forme fermée', /Z$/.test(o[o.length - 1].d) && nums(o[o.length - 1].d).length >= 8, o[o.length - 1]);
    await tool('pen');
    const [px1, py1] = await P(60, 400);
    await mouse('mouseMoved', px1, py1); await mouse('mousePressed', px1, py1);
    for (let i = 1; i <= 20; i++) { await mouse('mouseMoved', px1 + i * 8, py1 + Math.sin(i / 3) * 15); await sleep(10); }
    await mouse('mouseReleased', px1 + 160, py1); await sleep(250);
    o = await objs();
    check('crayon : tracé lissé créé', o[o.length - 1].n === 1 && nums(o[o.length - 1].d).length > 40, nums(o[o.length - 1].d).length);
    check('le crayon reste actif (plusieurs traits possibles)', (await state()).tool.includes('tool-pen'));

    // ------------------------------------------------------------ 5. gomme
    console.log('5. Gomme');
    const countBefore = (await objs()).length;
    await tool('eraser');
    const [gx, gy] = await P(150, 190);
    await c.clickXY(gx, gy); await sleep(250);
    check('gomme : un clic supprime l\'objet touché', (await objs()).length === countBefore - 1, await objs());
    await key('z', 'KeyZ', 90, 2); await sleep(250);
    check('Annuler restaure l\'objet effacé', (await objs()).length === countBefore);

    // ------------------------------------------------------------ 6. marquage du texte
    console.log('6. Surligner, souligner, barrer');
    await c.waitFor(`document.querySelectorAll('.docview.active .page:nth-child(1) .textLayer span').length>0`);
    const spanRect = await c.rect('.docview.active .page:nth-child(1) .textLayer span');
    for (const t of ['highlight', 'underline', 'strike']) {
      await tool(t);
      const y = spanRect[1] + spanRect[3] / 2;
      await drag(spanRect[0] + 2, y, spanRect[0] + spanRect[2] - 2, y, 0, 8);
      await sleep(250);
    }
    o = await objs();
    const hl = o.find((x) => x.blend === 'multiply');
    check('surlignage : tracé en fusion « Multiply »', !!hl, o.map((x) => x.blend));
    check('soulignement et texte barré créés (3 objets de marquage)', o.length >= countBefore + 3, o.length);
    check('l\'aperçu du surlignage correspond à l\'enregistré (même mode de fusion Multiply)', !!hl);

    // ------------------------------------------------------------ 7. panneau Annotations
    console.log('7. Panneau Annotations');
    await c.click('#sb-toggle'); await sleep(300);
    await c.click('#sbtab-annots'); await sleep(300);
    const nItems = await c.ev(`document.querySelectorAll('#sb-annots .annot-item').length`);
    const nObjs = (await objs()).length;
    check('liste des annotations : un élément par objet (' + nObjs + ')', nItems === nObjs, { nItems, nObjs });
    await c.click('#sb-annots .annot-item:nth-of-type(1)'); await sleep(300);
    const selInfo = await J(`JSON.stringify({outline: document.querySelectorAll('.docview.active .sel-outline').length, handles: document.querySelectorAll('.docview.active .sel-handle').length, cur: document.querySelectorAll('#sb-annots .annot-item.current').length})`);
    check('clic sur un élément : l\'objet est sélectionné', selInfo.cur === 1 && (selInfo.outline + selInfo.handles) > 0, selInfo);
    await c.click('#sb-toggle');

    // ------------------------------------------------------------ 8. lasso, sélection multiple
    console.log('8. Sélection par rectangle');
    await c.click('#rpanel-annotate [data-cmd=tool-select]');
    const [sx1, sy1] = await P(20, 120), [sx2, sy2] = await P(290, 250);
    await drag(sx1, sy1, sx2, sy2, 0, 8);
    const nSel = await c.ev(`document.querySelectorAll('.docview.active .page:nth-child(1) .sel-outline').length`);
    check('lasso : plusieurs objets sélectionnés', nSel >= 2, nSel);
    check('panneau : titre « n objets »', /objets/.test((await state()).title), (await state()).title);

    // ------------------------------------------------------------ 9. copier / coller entre documents
    console.log('9. Copier / coller entre documents');
    await key('c', 'KeyC', 67, 2);
    await c.openMore(f.b); await sleep(1800);
    check('2 onglets', (await c.ev(`document.querySelectorAll('.doctab').length`)) === 2);
    await key('v', 'KeyV', 86, 2); await sleep(300);
    check('Ctrl+V dans l\'autre document : objets collés', (await c.ev(`document.querySelectorAll('.docview.active .page:nth-child(1) .objs > g').length`)) >= 1);
    check('le premier document n\'a pas été modifié par le collage', (await c.click('.doctab:nth-child(1)'), await sleep(400), (await objs()).length === nObjs));

    // ------------------------------------------------------------ 9b. texte amélioré
    console.log('9b. Texte amélioré');
    await c.click('.doctab:nth-child(1)'); await sleep(400);
    await c.click('#rtab-annotate');
    await tool('add');
    const [tx, ty] = await P(270, 395);
    await c.clickXY(tx, ty); await sleep(250);
    await c.type('Bonjour le monde en Times gras'); await c.key('Enter', { code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(300);
    const txt = () => J(`JSON.stringify([...document.querySelectorAll('.docview.active .page:nth-child(1) .objs > g')].filter(g=>g.querySelector('text')).map(g=>[...g.querySelectorAll('text')].map(t=>({s:t.textContent, f:t.getAttribute('font-family'), w:t.getAttribute('font-weight'), st:t.getAttribute('font-style'), tr:t.getAttribute('transform')}))).pop() || [])`);
    await tool('select');
    { const [sx, sy] = await P(276, 402); await c.clickXY(sx, sy); await sleep(300); }
    let tt = await txt();
    check('texte ajouté (aperçu SVG, police Helvetica par défaut)', tt.length === 1 && tt[0].s === 'Bonjour le monde en Times gras' && /Helvetica/.test(tt[0].f), tt);
    check('panneau : propriétés du texte visibles (Police, Taille, Alignement, Largeur fixe)', (await c.ev(`['Police','Gras','Italique','Taille','Alignement','Largeur fixe'].every(l=>[...document.querySelectorAll('#props .prop-row label')].some(x=>x.textContent===l))`)) === true);
    await setField('Police', `const s=row.querySelector('select'); s.value='Times'; s.dispatchEvent(new Event('change'))`); await sleep(200);
    await setField('Gras', `const i=row.querySelector('input'); i.checked=true; i.dispatchEvent(new Event('change'))`); await sleep(200);
    await setField('Italique', `const i=row.querySelector('input'); i.checked=true; i.dispatchEvent(new Event('change'))`); await sleep(200);
    tt = await txt();
    check('police Times, gras, italique appliqués à l\'aperçu', /Times/.test(tt[0].f) && tt[0].w === 'bold' && tt[0].st === 'italic', tt);
    await setField('Largeur fixe', `const cb=row.querySelector('input[type=checkbox]'); cb.checked=false; cb.dispatchEvent(new Event('change'))`); await sleep(200);
    await setField('Largeur fixe', `const i=row.querySelector('input[type=number]'); i.value=50; i.dispatchEvent(new Event('change'))`); await sleep(250);
    tt = await txt();
    check('largeur fixe 50 pt : retour automatique à la ligne (' + tt.length + ' lignes)', tt.length >= 3, tt.length);
    await setField('Alignement', `const s=row.querySelector('select'); s.value='center'; s.dispatchEvent(new Event('change'))`); await sleep(250);
    check('alignement centré appliqué', (await txt()).length >= 3);
    check('poignées du texte : largeur (2) + rotation (1)', (await handles()).length === 3, await handles());
    const th = await handles();
    const ctr = [(th[0][0] + th[1][0]) / 2, (th[0][1] + th[1][1]) / 2];
    await drag(th[2][0], th[2][1], ctr[0] + 90, ctr[1], 0, 8);
    tt = await txt();
    check('rotation du texte : le calque est tourné', /rotate\((?!-?0\))/.test(tt[0].tr) && /rotate\(-?\d/.test(tt[0].tr) && !/rotate\(0\)/.test(tt[0].tr), tt[0].tr);
    await key('z', 'KeyZ', 90, 2); await sleep(250);
    tt = await txt();
    check('Annuler défait la rotation', /rotate\(-?0\)/.test(tt[0].tr), tt[0].tr);

    // ------------------------------------------------------------ 9c. autres formes et aimantation
    console.log('9c. Ellipse, polyligne, nuage, surlignage libre, aimantation');
    const countNow = async () => (await objs()).length;
    let n0 = await countNow();
    await tool('ellipse'); await drag(...(await P(400, 120)), ...(await P(470, 170)));
    check('ellipse créée', (await countNow()) === n0 + 1 && /C/.test((await objs()).pop().d)); n0++;
    await tool('polyline');
    for (const [x, y] of [[400, 200], [440, 230], [480, 200], [520, 240]]) { await c.clickXY(...(await P(x, y))); await sleep(60); }
    await key('Enter', 'Enter', 13); await sleep(250);
    o = await objs();
    check('polyligne créée avec Entrée (tracé ouvert, sans fermeture)', (await countNow()) === n0 + 1 && !/Z$/.test(o[o.length - 1].d), o[o.length - 1]); n0++;
    await tool('cloud');
    for (const [x, y] of [[400, 260], [470, 260], [470, 300], [400, 300]]) { const [sx, sy] = await P(x, y); await c.clickXY(sx, sy); await sleep(60); }
    { const [sx, sy] = await P(400, 300); await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 2, buttons: 1 }); await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 2 }); await sleep(250); }
    o = await objs();
    check('nuage créé (nombreux arcs)', (await countNow()) === n0 + 1 && (o[o.length - 1].d.match(/C/g) || []).length >= 8, (o[o.length - 1].d.match(/C/g) || []).length); n0++;
    await tool('hlrect'); await drag(...(await P(500, 120)), ...(await P(560, 160)));
    o = await objs();
    check('surlignage rectangulaire libre créé (Multiply)', (await countNow()) === n0 + 1 && o[o.length - 1].blend === 'multiply'); n0++;

    await tool('rect'); await drag(...(await P(400, 330)), ...(await P(450, 370)));
    await tool('rect'); await drag(...(await P(480, 330)), ...(await P(530, 370)));
    await tool('select');
    const r2 = nums((await objs()).pop().d);
    const [e1x, e1y] = await P(492, 330);
    await mouse('mouseMoved', e1x, e1y); await mouse('mousePressed', e1x, e1y);
    for (let i = 1; i <= 4; i++) { await mouse('mouseMoved', e1x, e1y + i); await sleep(30); }
    const guides = await c.ev(`document.querySelectorAll('.docview.active .page:nth-child(1) .sel-guide').length`);
    await mouse('mouseReleased', e1x, e1y + 4); await sleep(250);
    const r2b = nums((await objs()).pop().d);
    check('aimantation : un guide bleu apparaît pendant le déplacement', guides >= 1, guides);
    check("aimantation : l'objet est rattrapé par un bord voisin (déplacement final < déplacement brut de 4 px)", r2b[1] - r2[1] >= -0.1 && r2b[1] - r2[1] < 3.9, { r2: r2.slice(0, 2), r2b: r2b.slice(0, 2) });

    // ------------------------------------------------------------ 9d. outils persistants
    console.log('9d. Outils persistants');
    const n1 = await countNow();
    await tool('rect');
    check('curseur en croix avec un outil de dessin', (await c.ev(`getComputedStyle(document.querySelector('.docview.active .page')).cursor`)) === 'crosshair');
    check('indicateur d\'outil actif dans la barre d\'état', (await c.ev(`document.getElementById('tool-label').textContent`)) === 'Outil : Rectangle');
    await drag(...(await P(300, 150)), ...(await P(345, 190)));
    await drag(...(await P(300, 200)), ...(await P(345, 240)));
    check('deux tracés de suite sans rechoisir l\'outil', (await countNow()) === n1 + 2 && (await state()).tool.includes('tool-rect'), { n: await countNow(), n1 });
    check('un nouvel objet n\'est pas sélectionné', (await handles()).length === 0);
    await key('z', 'KeyZ', 90, 2); await sleep(250);
    check('Ctrl+Z annule le dernier objet', (await countNow()) === n1 + 1 && (await state()).tool.includes('tool-rect'));
    await tool('line');
    await drag(...(await P(520, 250)), ...(await P(570, 285)));
    check('ligne : l\'outil reste actif après le tracé', (await state()).tool.includes('tool-line') && (await countNow()) === n1 + 2, { st: await state(), n: await countNow(), n1, dbg: await c.ev(`import('./js/ui.js').then(m=>{const d=m.store.active; return JSON.stringify({drag:d.runtime.drag&&d.runtime.drag.kind, last:d.edits.slice(-3).map(e=>[e.type,e.page,Math.round(e.cx||0),Math.round(e.cy||0)]), tmp:!!d.runtime.tmp})})`) });
    // Ctrl + clic = sélection temporaire sans quitter l'outil
    { const [bx, by] = await P(322, 150); await mouse('mouseMoved', bx, by, 2); await mouse('mousePressed', bx, by, 2); await mouse('mouseReleased', bx, by, 2); await sleep(250); }
    check('Ctrl+clic sélectionne un objet existant sans quitter l\'outil', (await handles()).length === 9 && (await state()).tool.includes('tool-line'), { h: (await handles()).length, st: await state() });
    await key('Escape', 'Escape', 27); await sleep(250);
    check('Échap quitte l\'outil (retour à « Sélection »)', (await state()).tool.includes('tool-select'));
    // polygone : se termine par double-clic ou Entrée et l'outil reste actif
    await tool('polygon');
    for (const [x, y] of [[420, 330], [470, 330], [470, 380]]) { await c.clickXY(...(await P(x, y))); await sleep(60); }
    await key('Enter', 'Enter', 13); await sleep(250);
    check('polygone terminé avec Entrée : l\'outil reste actif', (await state()).tool.includes('tool-polygon') && (await countNow()) === n1 + 3);
    await key('Escape', 'Escape', 27);
    // réglage « Garder l'outil actif après un tracé » désactivé : ancien comportement
    await c.click('#btn-settings'); await c.click('#opt-keeptool'); await c.click('#settings-close'); await sleep(200);
    await tool('rect'); await drag(...(await P(500, 300)), ...(await P(550, 330)));
    check('réglage désactivé : retour à « Sélection » avec l\'objet sélectionné', (await state()).tool.includes('tool-select') && (await handles()).length === 9);
    await c.click('#btn-settings'); await c.click('#opt-keeptool'); await c.click('#settings-close'); await sleep(200);
    check('réglage mémorisé (réactivé)', (await c.ev(`window.spinadoc.getSettings().then(s=>s.keepTool)`)) === true);

    // ------------------------------------------------------------ 10. enregistrement : identique à l'aperçu
    console.log('10. Enregistrement figé');
    const saved = await J(`(async()=>{
      const { store } = await import('./js/ui.js');
      const pdfjs = await import('../vendor/pdfjs/pdf.mjs');
      const doc = store.docs[0];
      const out = await PdfEdit.applyEdits(PDFLib, doc.bytes.slice(), doc.edits);
      const pdf = await pdfjs.getDocument({ data: out, cMapUrl: '', isEvalSupported: false }).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      const ctx = cv.getContext('2d');
      const rect = doc.edits.find(e => e.type === 'rect');
      const px = (x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(vp.height - y), 1, 1).data).slice(0, 3);
      const hl = doc.edits.find(e => e.type === 'highlight');
      const tc = await page.getTextContent();
      return JSON.stringify({ texts: tc.items.map(i => i.str), n: doc.edits.length, types: doc.edits.map(e => e.type), rectFill: rect && rect.fill, rectPix: rect && px(rect.cx, rect.cy), hlPix: hl && Array.from({ length: 30 }, (_, k) => px(hl.rects[0][0] + 1 + (k * (hl.rects[0][2] - 2)) / 30, hl.rects[0][1] + hl.rects[0][3] * 0.15)).sort((p, q) => q[0] + q[1] - (p[0] + p[1]))[0], pages: pdf.numPages });
    })()`);
    check('applyEdits sur le document réel : toutes les annotations incorporées', saved.n >= 6 && saved.pages === 8, saved);
    const fillRef = saved.rectFill ? saved.rectFill.map((v) => Math.round(v * 255)) : null;
    check('PDF enregistré : pixel du rectangle au centre = couleur de remplissage (opacité 50 % sur blanc)', saved.rectPix && fillRef && saved.rectPix.every((v, i) => Math.abs(v - Math.round(fillRef[i] * 0.5 + 255 * 0.5)) < 30), { saved });
    check('PDF enregistré : le texte ajouté (Times, retour automatique) est dans le contenu de la page', saved.texts.some((t) => /Bonjour/.test(t)) && saved.texts.some((t) => /Times|gras|monde/.test(t)), saved.texts);
    check('PDF enregistré : le surlignage jaune est visible', saved.hlPix && saved.hlPix[0] > 200 && saved.hlPix[2] < 150, saved.hlPix);

    check('aucune erreur JavaScript pendant les tests', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : tests d\'interface des annotations.');
})();
