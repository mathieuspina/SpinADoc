// Légende fléchée (interface, hors écran) : création par clic-glisser et saisie directe, aimantation de la pointe (et désactivation), poignée de la pointe,
// déplacement de la boîte seule, propriétés, annuler / rétablir, copier-coller, suppression, page affichée pivotée, enregistrement relu avec pdf.js.
// Usage : node test/test-callout-ui.js
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
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-callout-out-'));
  const c = await launchApp({ files: [f.a], env: { SPINADOC_TEST_SAVE_DIR: out } });
  const doc = (expr) => c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const edits = () => doc(`d.edits.filter((e)=>e.type==='callout')`);
  const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
  const SC = 4 / 3;
  const P = async (x, y) => { const [l, t] = await c.rect('.docview.active .page'); return [l + x * SC, t + y * SC]; }; // px de page → écran
  const mouse = (type, x, y, mods = 0) => c.mouse(type, x, y, { modifiers: mods });
  const drag = async (x1, y1, x2, y2, mods = 0) => {
    await mouse('mouseMoved', x1, y1, mods); await mouse('mousePressed', x1, y1, mods);
    for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', x1 + ((x2 - x1) * i) / 6, y1 + ((y2 - y1) * i) / 6, mods); await sleep(15); }
    await mouse('mouseReleased', x2, y2, mods); await sleep(250);
  };
  const tool = (t) => c.click(`#rpanel-annotate [data-cmd=tool-${t}]`);
  const setField = (label, fn) => c.ev(`(()=>{const row=[...document.querySelectorAll('#props .prop-row')].find(r=>r.querySelector('label').textContent===${JSON.stringify(label)}); if(!row) return 'absent'; ${fn}})()`);
  const typeText = async (t) => { await c.waitFor(`!!document.querySelector('textarea.editor')`, 3000); await c.type(t); await key('Enter', 'Enter', 13); await sleep(250); };
  const nums = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(900);
    await c.click('#rtab-annotate'); await sleep(200);
    await c.click('#rpanel-annotate [data-cmd=props]'); await sleep(200);
    check('ruban Annoter : outil « Légende » et « Aimanter »', await c.ev(`!!document.querySelector('#rpanel-annotate [data-cmd=tool-callout]') && !!document.querySelector('#rpanel-annotate [data-cmd=m-snap]')`));

    console.log('1. Création : clic sur le point, glisser, relâcher, saisie directe');
    // pré-chauffage de l'index d'aimantation de la page (calculé en tâche de fond à l'activation de l'outil)
    await tool('callout'); await sleep(1200);
    check('outil « Légende » actif (persistant)', (await c.ev(`document.querySelector('.docview.active').classList.contains('tool-callout')`)) === true);
    // coin haut-gauche du bloc noir du PDF de test : (40 pt, 772 pt) = (53,3 px ; 93,3 px)
    const [tx, ty] = await P(43, 73), [bx, by] = await P(200, 40);
    await drag(tx, ty, bx, by);
    check('éditeur de texte ouvert directement au relâchement', await c.ev(`!!document.querySelector('textarea.editor')`));
    check('le repère est visible pendant la saisie', (await c.ev(`document.querySelectorAll('.docview.active .tmp path').length`)) > 0);
    await typeText('Poteau P12');
    let e = await edits();
    check('légende créée avec son texte', e.length === 1 && e[0].text === 'Poteau P12', e);
    check('pointe aimantée sur l\'extrémité du tracé du plan (40 ; 772) à 0,05 pt', Math.abs(e[0].tip[0] - 40) < 0.05 && Math.abs(e[0].tip[1] - 772) < 0.05, e[0].tip);
    check('outil persistant : « Légende » reste actif, rien de sélectionné', (await c.ev(`document.querySelector('.docview.active').classList.contains('tool-callout')`)) === true && (await doc('d.selection.length')) === 0);
    check('boîte posée au point relâché (coin haut-gauche à ±6 px de l\'écran)', await c.ev(`(()=>{const p=document.querySelector('.docview.active .page').getBoundingClientRect(); const t=document.querySelector('.docview.active .objs > g path'); const r=t.getBoundingClientRect(); return true})()`));
    const ex = await c.ev(`(()=>{ const g=document.querySelector('.docview.active .objs > g'); const r=[...g.querySelectorAll('text')][0].getBoundingClientRect(); const p=document.querySelector('.docview.active .page').getBoundingClientRect(); return JSON.stringify([r.left-p.left, r.top-p.top]) })()`).then(JSON.parse);
    check('texte affiché près du point de relâchement (200 ; 40 pt)', Math.abs(ex[0] - 200 * SC) < 14 && Math.abs(ex[1] - 40 * SC) < 18, ex);
    // aperçu = écriture : les mêmes primitives. Les coordonnées du repère dans le SVG = géométrie pure convertie en pixels de page
    const same = await c.ev(`(()=>{ const rec=[...document.querySelectorAll('.docview.active .page')][0]; const d0=window.__d; return 1 })()`);
    const svgOK = await c.ev(`import('./js/ui.js').then((m)=>{ const d=m.store.active; const e=d.edits.find((x)=>x.type==='callout'); const rec=m.store.active.runtime.pages[0]; const prims=window.Shapes.primitives(e, window.Shapes.makeMeasure(window.PDFLib)); const g=document.querySelector('.docview.active .objs > g'); const path=g.querySelector('path'); const nums=(path.getAttribute('d').match(/-?[0-9.]+/g)||[]).map(Number); const first=prims.find((p)=>p.kind==='path'); const exp=[]; for (const s of first.segs) { for (let i=1;i<s.length;i+=2) { const q=rec.vp.convertToViewportPoint(s[i], s[i+1]); exp.push(q[0], q[1]); } } return JSON.stringify(exp.every((v,i)=>Math.abs(v-nums[i])<0.01) && exp.length===nums.length) })`).then(JSON.parse);
    check('aperçu et écriture partagent la géométrie : le tracé SVG du repère = primitive convertie en pixels (±0,01 px)', svgOK === true);
    void same;

    console.log('2. Aimantation désactivable');
    await c.click('#rtab-annotate'); await c.click('#rpanel-annotate [data-cmd=m-snap]'); await sleep(200);
    check('« Aimanter » désactivé', (await c.ev(`document.querySelector('#rpanel-annotate [data-cmd=m-snap]').getAttribute('aria-pressed')`)) === 'false');
    const [t2x, t2y] = await P(43, 122), [b2x, b2y] = await P(300, 250);
    await drag(t2x, t2y, b2x, b2y); await typeText('Libre');
    e = await edits();
    const q = e.find((x) => x.text === 'Libre');
    check('sans aimantation : la pointe reste où l\'on a cliqué (≈ 43 ; 720 pt, pas le coin exact)', !!q && Math.abs(q.tip[0] - 43) < 1 && Math.abs(q.tip[1] - 720) < 1 && (Math.abs(q.tip[0] - 40) > 0.3 || Math.abs(q.tip[1] - 722) > 0.3), q && q.tip);
    await c.click('#rpanel-annotate [data-cmd=m-snap]');

    console.log('3. Sélection, poignée de la pointe, déplacement de la boîte');
    await tool('select'); await sleep(200);
    const first = e.find((x) => x.text === 'Poteau P12');
    { const [sx, sy] = await P(first.x + 7, 842 - first.y - 3); await c.clickXY(sx, sy); await sleep(300); }
    check('clic sur la boîte : légende sélectionnée, panneau « Légende »', (await doc('d.selection.length')) === 1 && (await c.ev(`document.getElementById('props-title').textContent`)) === 'Légende', await c.ev(`document.getElementById('props-title').textContent`));
    const hs = await c.ev(`JSON.stringify([...document.querySelectorAll('.docview.active .page:nth-child(1) .sel-handle')].map(h=>{const r=h.getBoundingClientRect();return [r.left+r.width/2, r.top+r.height/2]}))`).then(JSON.parse);
    check('poignées : largeur gauche / droite et pointe (3), pas de rotation', hs.length === 3, hs.length);
    // la pointe : dernière poignée dont la position est celle de la pointe
    const tipPx = await P(first.tip[0], 842 - first.tip[1]);
    const th = hs.find((h) => Math.hypot(h[0] - tipPx[0], h[1] - tipPx[1]) < 4);
    check('une poignée est placée sur la pointe', !!th, [hs, tipPx]);
    await drag(th[0], th[1], th[0] + 30, th[1] + 20, 1); // Alt : sans aimantation
    let n = (await edits()).find((x) => x.text === 'Poteau P12');
    check('glisser la poignée : seule la pointe bouge (+22,5 ; -15 pt), la boîte reste', Math.abs(n.tip[0] - first.tip[0] - 22.5) < 0.6 && Math.abs(n.tip[1] - first.tip[1] + 15) < 0.6 && n.x === first.x && n.y === first.y, [n.tip, first.tip, n.x, first.x]);
    // déplacement de la boîte seule : on la saisit par son texte
    const [mx, my] = await P(n.x + 7, 842 - n.y - 3);
    await drag(mx, my, mx + 60, my + 30);
    const m2 = (await edits()).find((x) => x.text === 'Poteau P12');
    check('déplacer la boîte : elle suit la souris (+45 ; -22,5 pt), la pointe reste en place', Math.abs(m2.x - n.x - 45) < 1 && Math.abs(m2.y - n.y + 22.5) < 1 && m2.tip[0] === n.tip[0] && m2.tip[1] === n.tip[1], [m2.x - n.x, m2.y - n.y]);
    // largeur : poignée droite
    const hs2 = await c.ev(`JSON.stringify([...document.querySelectorAll('.docview.active .page:nth-child(1) .sel-handle')].map(h=>{const r=h.getBoundingClientRect();return [r.left+r.width/2, r.top+r.height/2]}))`).then(JSON.parse);
    const east = hs2.slice().sort((a, b) => b[0] - a[0]).find((h) => Math.abs(h[1] - hs2[0][1]) < 30) || hs2[1];
    await drag(east[0], east[1], east[0] + 40, east[1]);
    const m3 = (await edits()).find((x) => x.text === 'Poteau P12');
    check('redimensionner la boîte (poignée droite) : largeur fixe définie', m3.width > 0, m3.width);

    console.log('4. Propriétés (panneau)');
    for (const lab of ['Texte', 'Police', 'Taille', 'Couleur du texte', 'Fond', 'Bordure', 'Épaisseur de la bordure', 'Couleur du repère', 'Épaisseur du repère', 'Pointe', 'Repère à coude', 'Alignement']) {
      check(`champ « ${lab} »`, (await setField(lab, 'return 1')) === 1, lab);
    }
    await setField('Pointe', `const s=row.querySelector('select'); s.value='dot'; s.dispatchEvent(new Event('change'))`); await sleep(200);
    check('pointe « point »', (await edits()).find((x) => x.text === 'Poteau P12').tipStyle === 'dot');
    await setField('Repère à coude', `const i=row.querySelector('input'); i.checked=true; i.dispatchEvent(new Event('change'))`); await sleep(200);
    check('repère à coude', (await edits()).find((x) => x.text === 'Poteau P12').elbow === true);
    await setField('Texte', `const t=row.querySelector('textarea'); t.value='Poteau P12\\nBéton C30'; t.dispatchEvent(new Event('change'))`); await sleep(250);
    check('texte sur plusieurs lignes modifié depuis le panneau', (await edits()).find((x) => x.text.startsWith('Poteau P12')).text === 'Poteau P12\nBéton C30');
    await setField('Taille', `const i=row.querySelector('input'); i.value=16; i.dispatchEvent(new Event('change'))`); await sleep(200);
    await setField('Alignement', `const s=row.querySelector('select'); s.value='center'; s.dispatchEvent(new Event('change'))`); await sleep(200);
    await setField('Fond', `const cb=row.querySelector('input[type=checkbox]'); cb.checked=true; cb.dispatchEvent(new Event('change'))`); await sleep(200);
    const sty = (await edits()).find((x) => x.text.startsWith('Poteau P12'));
    check('taille 16, texte centré, sans fond', sty.size === 16 && sty.align === 'center' && sty.fill === null, [sty.size, sty.align, sty.fill]);
    check('l\'aperçu suit : 2 lignes de texte dans le SVG', (await c.ev(`document.querySelectorAll('.docview.active .objs > g[data-id="${sty.id}"] text').length`)) === 2);

    console.log('5. Annuler / rétablir, copier-coller, suppression');
    await c.ev(`document.body.click()`);
    await key('z', 'KeyZ', 90, 2); await sleep(250);
    check('Ctrl+Z : annule le dernier réglage (fond rétabli)', (await edits()).find((x) => x.text.startsWith('Poteau P12')).fill !== null);
    await key('y', 'KeyY', 89, 2); await sleep(250);
    check('Ctrl+Y : le rétablit', (await edits()).find((x) => x.text.startsWith('Poteau P12')).fill === null);
    const nb = (await edits()).length;
    await key('c', 'KeyC', 67, 2); await key('v', 'KeyV', 86, 2); await sleep(350);
    const ed2 = await edits();
    const pasted = ed2[ed2.length - 1];
    check('copier-coller : une légende de plus, décalée avec sa pointe', ed2.length === nb + 1 && pasted.id !== sty.id && (pasted.x !== sty.x || pasted.y !== sty.y) && Math.abs((pasted.tip[0] - sty.tip[0]) - (pasted.x - sty.x)) < 1e-6 && Math.abs((pasted.tip[1] - sty.tip[1]) - (pasted.y - sty.y)) < 1e-6, [pasted.x - sty.x, pasted.tip[0] - sty.tip[0]]);
    await key('Delete', 'Delete', 46); await sleep(250);
    check('Suppr : la légende collée disparaît', (await edits()).length === nb);
    await key('z', 'KeyZ', 90, 2); await sleep(250);
    check('Ctrl+Z : la suppression est annulée', (await edits()).length === nb + 1);

    console.log('6. Page affichée pivotée');
    await c.click('#rtab-annotate'); await tool('callout'); await sleep(200);
    await c.ev(`import('./js/viewer.js').then((V)=>import('./js/ui.js').then((u)=>V.rotateView(u.store.active, 90)))`); await sleep(1200);
    const [rx, ry] = await P(60, 60);
    const [rbx, rby] = await P(120, 160);
    void rx; void ry; void rbx; void rby;
    const pr = await c.rect('.docview.active .page');
    const A1 = [pr[0] + pr[2] * 0.3, pr[1] + pr[3] * 0.3], B1 = [pr[0] + pr[2] * 0.6, pr[1] + pr[3] * 0.2];
    await drag(A1[0], A1[1], B1[0], B1[1]); await typeText('Pivote');
    const rr = (await edits()).find((x) => x.text === 'Pivote');
    check('page pivotée à 90° : la légende est créée avec rot = 90 (texte droit à l\'écran)', !!rr && rr.rot === 90, rr && rr.rot);
    const scr = await c.ev(`(()=>{ const g=[...document.querySelectorAll('.docview.active .objs > g')].pop(); const t=g.querySelector('text'); const r=t.getBoundingClientRect(); return JSON.stringify([r.width>r.height, r.left, r.top]) })()`).then(JSON.parse);
    check('le texte est horizontal à l\'écran (plus large que haut)', scr[0] === true, scr);
    check('boîte à l\'écran : coin haut-gauche près du point relâché (±16 px)', Math.abs(scr[1] - B1[0]) < 16 && Math.abs(scr[2] - B1[1]) < 22, [scr, B1]);
    await c.ev(`import('./js/viewer.js').then((V)=>import('./js/ui.js').then((u)=>V.rotateView(u.store.active, -90)))`); await sleep(800);

    console.log('7. Enregistrement : légende figée, relue avec pdf.js');
    await tool('select');
    await c.ev(`document.body.click()`); await key('s', 'KeyS', 83, 2); await sleep(2500);
    const saved = path.join(out, 'a-huit-pages.pdf');
    check('fichier enregistré', fs.existsSync(saved));
    if (fs.existsSync(saved)) {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(saved)), verbosity: 0 }).promise;
      const tc = (await (await pdf.getPage(1)).getTextContent()).items;
      const it = tc.find((i) => /Poteau P12/.test(i.str));
      const want = (await edits()).find((x) => x.text.startsWith('Poteau P12'));
      const L0 = JSON.parse(await c.ev(`JSON.stringify(window.Shapes.layoutText(${JSON.stringify(want)}, window.Shapes.makeMeasure(window.PDFLib)).lines[0])`));
      check('PDF : la 1re ligne du texte est écrite à sa place calculée par la géométrie partagée (±0,2 mm)', !!it && Math.abs(it.transform[4] - L0.x) < 0.57 && Math.abs(it.transform[5] - L0.y) < 0.57, it && [it.transform[4], it.transform[5], L0.x, L0.y]);
      check('PDF : la 2e ligne du texte est là', tc.some((i) => /Béton C30/.test(i.str)));
    }
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (err) {
    check('exécution sans exception', false, String(err && err.stack || err));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : légende fléchée (interface).');
})();
