// Comparaison (interface, hors écran) : ouverture depuis l'onglet Document, choix des documents et des paires, 3 modes + texte, navigation
// suivante / précédente, couleurs, décalage manuel, tolérance, pages de formats différents, page sans texte, annulation en cours de calcul,
// calcul de toutes les pages, export PDF relu avec pdf.js (jamais d'écrasement), plan A0 (durée). Usage : node test/test-compare-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const PDFLib = require('@cantoo/pdf-lib');
const { launchApp, sleep } = require('./lib/app.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

const MM = 72 / 25.4;
// Plan fabriqué : cadre, traits, bloc ; « variant » : ancien indice (bloc, IPE 200, indice A) ou nouveau (trait ajouté, IPE 240, indice B), décalé de 5 × 3 mm.
function drawPlan(page, font, { ox = 0, oy = 0, nouveau = false, texte = true }) {
  const C = PDFLib.rgb(0, 0, 0);
  const line = (x0, y0, x1, y1, t = 1.6) => page.drawLine({ start: { x: x0 + ox, y: y0 + oy }, end: { x: x1 + ox, y: y1 + oy }, thickness: t, color: C });
  page.drawRectangle({ x: 40 + ox, y: 40 + oy, width: 760, height: 500, borderWidth: 2, borderColor: C });
  line(100, 300, 500, 300); line(200, 100, 200, 450); line(400, 120, 700, 120, 2.2); line(330, 200, 330, 480); line(520, 160, 520, 470, 2); line(600, 250, 740, 250);
  if (!nouveau) page.drawRectangle({ x: 600 + ox, y: 400 + oy, width: 60, height: 40, color: C });
  else line(100, 220, 330, 220, 2.5);
  if (texte) {
    page.drawText('Poutre IPE ' + (nouveau ? '240' : '200') + ' acier S235', { x: 60 + ox, y: 500 + oy, size: 14, font });
    page.drawText('Entraxe 600 mm', { x: 60 + ox, y: 470 + oy, size: 14, font });
    page.drawText('Indice ' + (nouveau ? 'B' : 'A'), { x: 600 + ox, y: 60 + oy, size: 14, font });
  }
}
async function makeSet(dir) {
  const mk = async (file, fn) => { const d = await PDFLib.PDFDocument.create(); const f = await d.embedFont(PDFLib.StandardFonts.Helvetica); await fn(d, f); fs.writeFileSync(file, await d.save()); return file; };
  const out = {};
  out.old = await mk(path.join(dir, 'plan-indice-A.pdf'), async (d, f) => {
    drawPlan(d.addPage([842, 595]), f, {});
    drawPlan(d.addPage([842, 595]), f, { texte: false });
    d.addPage([595, 842]).drawText('Notice A4', { x: 60, y: 700, size: 20, font: f });
  });
  out.nu = await mk(path.join(dir, 'plan-indice-B.pdf'), async (d, f) => {
    drawPlan(d.addPage([842, 595]), f, { ox: 5 * MM, oy: -3 * MM, nouveau: true });
    drawPlan(d.addPage([842, 595]), f, { texte: false });
    d.addPage([1191, 842]).drawText('Notice A4', { x: 60, y: 700, size: 20, font: f });
    d.addPage([595, 842]).drawText('Annexe ajoutée', { x: 60, y: 700, size: 20, font: f });
  });
  // plans A0 : milliers de petits traits (durée et mémoire)
  const bigDraw = (page, ox, oy, extra) => {
    const C = PDFLib.rgb(0, 0, 0);
    for (let i = 0; i < 2500; i++) { const x = 60 + ((i * 7919) % 2200), y = 60 + ((i * 104729) % 3200); page.drawLine({ start: { x: x + ox, y: y + oy }, end: { x: x + ox + 20 + (i % 90), y: y + oy }, thickness: 1.5, color: C }); page.drawLine({ start: { x: x + ox + 6, y: y + oy }, end: { x: x + ox + 6, y: y + oy + 12 + (i % 60) }, thickness: 1.5, color: C }); }
    if (extra) page.drawLine({ start: { x: 400 + ox, y: 1500 + oy }, end: { x: 1400 + ox, y: 1500 + oy }, thickness: 4, color: C });
  };
  out.bigOld = await mk(path.join(dir, 'A0-indice-A.pdf'), async (d) => bigDraw(d.addPage([2384, 3370]), 0, 0, false));
  out.bigNew = await mk(path.join(dir, 'A0-indice-B.pdf'), async (d) => bigDraw(d.addPage([2384, 3370]), 5 * MM, -3 * MM, true));
  return out;
}

const electronMemMo = () => { try { return Number(execSync('powershell -NoProfile -Command "(Get-Process electron -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum"', { encoding: 'utf8' }).trim() || 0) / 1048576; } catch { return NaN; } };

(async () => {
  const dir = path.join(os.tmpdir(), 'spinadoc-compare-pdfs');
  fs.mkdirSync(dir, { recursive: true });
  const f = await makeSet(dir);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-compare-out-'));
  const c = await launchApp({ files: [f.old, f.nu, f.bigOld, f.bigNew], env: { SPINADOC_TEST_SAVE_DIR: out } });
  const S = (expr) => c.ev(`import('./js/compare-ui.js').then((m)=>{const S=m.getState(); return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const ready = () => c.waitFor(`import('./js/compare-ui.js').then((m)=>{const S=m.getState(); return !!S.sess && !S.job && document.getElementById('cmp-progress').hidden})`, 60000);
  const selectDoc = (side, name) => c.ev(`(()=>{const s=document.getElementById('cmp-doc-${side}'); const o=[...s.options].find((o)=>o.textContent.startsWith(${JSON.stringify(name)})); s.value=o.value; s.dispatchEvent(new Event('change',{bubbles:true})); return o.value})()`);
  const setv = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const countText = () => c.ev(`document.getElementById('cmp-count').textContent`);
  const pixel = (cv, x, y) => S(`(()=>{const d=S.sess.${cv}.getContext('2d').getImageData(${x},${y},1,1).data; return [d[0],d[1],d[2]]})()`);
  // couleur dominante des pixels « non blancs » d'une zone de la carte
  const hasColor = (r, test) => S(`(()=>{const g=S.sess.regions[${r}]; const d=S.sess.cvMap.getContext('2d').getImageData(g.x0,g.y0,g.x1-g.x0,g.y1-g.y0).data; for(let i=0;i<d.length;i+=4){ if(${test}) return true } return false})()`);
  const files = (re) => fs.readdirSync(out).filter((n) => re.test(n)).sort();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    await c.waitFor(`document.querySelectorAll('.doctab').length===4`, 25000);
    await c.waitFor(`document.querySelectorAll('.docview canvas').length>0`, 15000);
    console.log('1. Ouverture depuis l\'onglet Document');
    await c.click('#rtab-document'); await sleep(250);
    check('bouton « Comparer » dans l\'onglet Document', await c.ev(`!!document.querySelector('#rpanel-document [data-cmd=doc-compare]')`));
    // le document actif est le dernier ouvert (A0 nouveau) : on choisit à la main les deux indices du petit plan
    await c.click('#rpanel-document [data-cmd=doc-compare]'); await sleep(600);
    check('espace de comparaison affiché, document en lecture seule', await c.ev(`!document.getElementById('cmpws').hidden`));
    await selectDoc('a', 'plan-indice-A.pdf'); await sleep(300); await selectDoc('b', 'plan-indice-B.pdf');
    check('calcul terminé sans geler l\'interface', await ready());
    const st = await S(`({pairs:S.pairs.map((p)=>[p.a,p.b]), a:S.a.name, b:S.b.name, n:S.sess.regions.length, kinds:S.sess.regions.map((g)=>g.kind), shift:S.sess.shift, mm:S.sess.mmPerPx, k:S.sess.k, same:S.sess.frame.sameSize, dirty:null})`);
    check('4 paires par défaut : p.N contre p.N, la 4e est une page ajoutée', JSON.stringify(st.pairs) === JSON.stringify([[0, 0], [1, 1], [2, 2], [null, 3]]), st.pairs);
    check('plusieurs zones détectées, dont une ajoutée et une supprimée', st.n >= 3 && st.kinds.includes('added') && st.kinds.includes('removed'), st.kinds);
    check('alignement automatique : décalage retrouvé (-5 ; -3 mm à 0,4 mm près)', Math.abs(st.shift.dx * st.mm + 5) < 0.4 && Math.abs(st.shift.dy * st.mm + 3) < 0.4, [st.shift.dx * st.mm, st.shift.dy * st.mm]);
    check('résolution indiquée dans le panneau', /Résolution : 0,\d+ mm par pixel \(\d+ dpi\)/.test(await c.ev(`document.getElementById('cmp-info').textContent`)), await c.ev(`document.getElementById('cmp-info').textContent`));
    check('compteur « N différences sur cette page »', /^\d+ différences sur cette page/.test(await countText()), await countText());
    check('les documents ouverts ne sont pas modifiés (aucun onglet « modifié »)', (await c.ev(`document.querySelectorAll('.doctab .dirty, .doctab[data-dirty=true]').length`)) === 0);

    console.log('2. Superposition en deux couleurs');
    const iAdded = st.kinds.indexOf('added'), iRemoved = st.kinds.indexOf('removed');
    check('zone ajoutée : pixels bleus', await hasColor(iAdded, 'd[i+2]>180&&d[i]<90&&d[i+1]<150'));
    check('zone supprimée : pixels rouges', await hasColor(iRemoved, 'd[i]>180&&d[i+1]<90&&d[i+2]<90'));
    await setv('cmp-c-new', '#00c000');
    await sleep(500);
    check('couleurs réglables : le « nouveau » devient vert', await hasColor(iAdded, 'd[i+1]>150&&d[i]<60&&d[i+2]<60'));
    await setv('cmp-c-new', '#1f6feb'); await sleep(400);

    console.log('3. Navigation entre les différences');
    await c.click('#cmp-next'); await sleep(200);
    check('« suivante » : première zone encadrée', (await S('S.listCur')) === 0 && (await c.ev(`document.querySelectorAll('.cmp-box.cur').length`)) >= 1);
    await c.click('#cmp-next'); await sleep(150);
    check('« suivante » encore : deuxième zone', (await S('S.listCur')) === 1);
    await c.click('#cmp-prev'); await c.click('#cmp-prev'); await sleep(150);
    check('« précédente » depuis la première : retour à la dernière (cycle)', (await S('S.listCur')) === st.n - 1, await S('S.listCur'));
    const vis = await c.ev(`(()=>{const b=document.querySelector('.cmp-box.cur'); const p=document.getElementById('cmp-pane-a'); const r=b.getBoundingClientRect(), q=p.getBoundingClientRect(); return r.right>q.left&&r.left<q.right&&r.bottom>q.top&&r.top<q.bottom})()`);
    check('la zone courante est visible dans la fenêtre (centrée)', vis === true);

    console.log('4. Fondu, côte à côte, texte');
    await c.click('#cmp-m-fade'); await sleep(250);
    check('fondu : curseur affiché, panneau de droite masqué', (await c.ev(`!document.getElementById('cmp-fadebox').hidden && document.getElementById('cmp-pane-b').hidden`)) === true);
    await setv('cmp-fade', '0'); await sleep(100);
    const o0 = await S(`S.sess.cvA.style.opacity`);
    await setv('cmp-fade', '100'); await sleep(100);
    const o1 = await S(`S.sess.cvA.style.opacity`);
    check('curseur : ancien seul (opacité 1) puis nouveau seul (opacité 0)', o0 === '1' && o1 === '0', [o0, o1]);
    await c.click('#cmp-blink'); await sleep(1500);
    check('« Clignoter » : le curseur alterne', (await c.ev(`document.getElementById('cmp-blink').getAttribute('aria-pressed')`)) === 'true' && (await S('S.blink !== null')) === true);
    await c.click('#cmp-blink');
    await c.click('#cmp-m-side'); await sleep(300);
    check('côte à côte : deux fenêtres avec une page chacune', (await c.ev(`!document.getElementById('cmp-pane-b').hidden && document.querySelectorAll('#cmp-pane-a canvas').length===1 && document.querySelectorAll('#cmp-pane-b canvas').length===1`)) === true);
    await c.click('#cmp-zin'); await sleep(200);
    await c.ev(`(()=>{const a=document.getElementById('cmp-pane-a'); a.scrollLeft=120; a.scrollTop=90; return 1})()`); await sleep(200);
    const sync = await c.ev(`(()=>{const a=document.getElementById('cmp-pane-a'), b=document.getElementById('cmp-pane-b'); return [a.scrollLeft,b.scrollLeft,a.scrollTop,b.scrollTop]})()`);
    check('défilement synchronisé entre les deux fenêtres', sync[0] > 0 && sync[0] === sync[1] && sync[2] === sync[3], sync);
    const z = await S('S.view.z'); await c.click('#cmp-fit'); await sleep(200);
    check('zoom commun : « Ajuster » change le zoom des deux fenêtres', (await S('S.view.z')) !== z);
    await c.click('#cmp-m-text'); await sleep(400);
    const tl = await c.ev(`document.getElementById('cmp-list').textContent`);
    check('texte : « 200 » supprimé et « 240 » ajouté, « A » → « B »', /200/.test(tl) && /240/.test(tl) && /A/.test(tl) && /B/.test(tl), tl);
    check('texte : boîtes vertes (ajouts) et rouges (suppressions) sur la page', (await c.ev(`document.querySelectorAll('.cmp-box.add').length>0 && document.querySelectorAll('.cmp-box.del').length>0`)) === true);
    check('texte : compteur de modifications', /modifications? de texte/.test(await countText()), await countText());
    await c.click('#cmp-next'); await sleep(150);
    check('texte : « suivante » encadre la première modification', (await c.ev(`document.querySelectorAll('.cmp-box.cur').length`)) >= 1);
    await c.click('#cmp-m-overlay'); await sleep(250);

    console.log('5. Décalage manuel et tolérance');
    const base = await S('S.sess.regions.length');
    await c.click('#cmp-sh-r'); await sleep(700);
    const dx1 = await S('S.sess.shift.dx * S.sess.mmPerPx');
    check('flèche droite : décalage manuel (+1 mm), champ X mis à jour', Math.abs(dx1 - (st.shift.dx * st.mm + 1)) < 0.4 && Math.abs(Number(await c.ev(`document.getElementById('cmp-dx').value`)) - dx1) < 0.1 && (await S('S.manual !== null')) === true, dx1);
    await setv('cmp-dx', '0'); await setv('cmp-dy', '0'); await sleep(800);
    const zeroN = await S('S.sess.regions.length');
    check('décalage saisi à 0 : le déplacement de 5 mm n\'est plus compensé (plus de zones)', zeroN > base, [base, zeroN]);
    await c.click('#cmp-auto'); await sleep(1200); await ready();
    check('« Auto » : alignement retrouvé, même nombre de zones qu\'au départ', (await S('S.sess.regions.length')) === base && (await S('S.manual')) === null, [base, await S('S.sess.regions.length')]);
    await setv('cmp-tol', '0'); await sleep(900);
    const n0 = await S('S.sess.regions.length');
    await setv('cmp-tol', '3'); await sleep(900);
    const n3 = await S('S.sess.regions.length');
    check('tolérance : 3 mm donne autant ou moins de zones que 0 mm', n3 <= n0, [n0, n3]);
    await setv('cmp-tol', '0.5'); await sleep(800);

    console.log('6. Autres paires : identique, sans texte, formats différents, page ajoutée');
    await c.click('#cmp-pages .cmp-row:nth-child(2) .cmp-open'); check('page identique calculée', await ready());
    check('page identique : 0 différence', (await S('S.sess.regions.length')) === 0 && /^Aucune différence/.test(await countText()), await countText());
    await c.click('#cmp-m-text'); await sleep(400);
    check('page sans texte : message clair, sans erreur', /ne contiennent pas de texte/.test(await c.ev(`document.getElementById('cmp-msg').textContent`)) && !(await c.ev(`document.getElementById('cmp-msg').hidden`)), await c.ev(`document.getElementById('cmp-msg').textContent`));
    await c.click('#cmp-m-overlay');
    await c.click('#cmp-pages .cmp-row:nth-child(3) .cmp-open'); check('paire A4 / A3 calculée', await ready());
    check('formats différents signalés (zone commune)', /Formats différents/.test(await c.ev(`document.getElementById('cmp-info').textContent`)) && (await S('S.sess.frame.sameSize')) === false);
    check('4e ligne = page ajoutée, non comparable', (await c.ev(`(()=>{const b=document.querySelector('#cmp-pages .cmp-row:nth-child(4) .cmp-open'); return b.disabled && /ajoutée/.test(b.textContent)})()`)) === true);
    // correspondance libre : la page 3 de l'ancien contre la page 4 du nouveau
    await c.ev(`(()=>{const s=document.querySelector('#cmp-pages .cmp-row:nth-child(3) select[aria-label^="Page du nouveau"]'); s.value='3'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
    check('correspondance libre : A4 contre A4 (annexe), plus de format différent', await ready() && (await S('S.sess.pair.b')) === 3 && /Formats différents/.test(await c.ev(`document.getElementById('cmp-info').textContent`)) === false);
    await c.ev(`(()=>{const s=document.querySelector('#cmp-pages .cmp-row:nth-child(3) select[aria-label^="Page du nouveau"]'); s.value='2'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`); await ready();

    console.log('7. Toutes les pages et export PDF');
    await c.click('#cmp-all'); await c.waitFor(`import('./js/compare-ui.js').then((m)=>{const S=m.getState(); return S.pairs.filter((p)=>p.a!==null&&p.b!==null).every((p)=>p.res)&&!S.job})`, 60000);
    const pcts = await S('S.pairs.map((p)=>p.res?Math.round(p.res.pct*10)/10:null)');
    check('pourcentage de changement par page : p.1 > 0, p.2 = 0', pcts[0] > 0 && pcts[1] === 0, pcts);
    check('pourcentages affichés dans la liste', /%/.test(await c.ev(`document.querySelector('#cmp-pages .cmp-row:nth-child(1) .cmp-pct').textContent`)));
    await c.click('#cmp-export'); await c.waitFor(`!document.getElementById('pgdlg').hidden`, 5000);
    check('boîte d\'export : toutes les paires comparables', /Toutes les paires comparables \(3\)/.test(await c.ev(`document.getElementById('pgdlg-body').textContent`)));
    await c.ev(`(()=>{const r=document.querySelector('input[name=pgf-scope][value=all]'); r.checked=true; return 1})()`);
    await c.click('#pgdlg-ok');
    for (let i = 0; i < 100 && !files(/^Comparaison .*\.pdf$/).length; i++) await sleep(300);
    const rep = files(/^Comparaison .*\.pdf$/);
    check('PDF de comparaison écrit', rep.length === 1, rep);
    if (rep.length) {
      const p = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(out, rep[0]))), verbosity: 0 }).promise;
      check('une page par page comparée (3)', p.numPages === 3, p.numPages);
      const pg = await p.getPage(1);
      const txt = (await pg.getTextContent()).items.map((i) => i.str).join(' ');
      check('légende, titre et zones numérotées lisibles dans le PDF', /Ancien seulement/.test(txt) && /Nouveau seulement/.test(txt) && /Inchangé/.test(txt) && /plan-indice-A\.pdf, p\. 1/.test(txt) && /différences/.test(txt) && /\b1\b/.test(txt), txt.slice(0, 200));
      const ops = await pg.getOperatorList();
      check('image de superposition dans le PDF', ops.fnArray.some((f2) => f2 === pdfjs.OPS.paintImageXObject));
      await p.destroy();
    }
    await c.click('#cmp-export'); await c.waitFor(`!document.getElementById('pgdlg').hidden`, 5000);
    await c.ev(`(()=>{const r=document.querySelector('input[name=pgf-scope][value=cur]'); if(r) r.checked=true; return 1})()`);
    await c.click('#pgdlg-ok');
    for (let i = 0; i < 100 && files(/^Comparaison .*\.pdf$/).length < 2; i++) await sleep(300);
    check('second export : jamais d\'écrasement (nom « (2) »)', files(/^Comparaison .*\.pdf$/).length === 2 && files(/\(2\)\.pdf$/).length === 1, files(/\.pdf$/));

    console.log('8. Annulation en cours de calcul');
    await selectDoc('a', 'A0-indice-A.pdf'); await selectDoc('b', 'A0-indice-B.pdf');
    await c.waitFor(`document.getElementById('cmp-prog-label').textContent.includes('nouveau document')`, 30000);
    await c.click('#cmp-cancel'); await sleep(600);
    check('annulation : barre de progression retirée, message clair', (await c.ev(`document.getElementById('cmp-progress').hidden`)) === true && /annulé/.test(await c.ev(`document.getElementById('cmp-msg').textContent`)), await c.ev(`document.getElementById('cmp-msg').textContent`));
    check('annulation : aucune comparaison affichée, interface vivante', (await S('S.sess')) === null && (await c.ev(`!document.getElementById('cmp-close').disabled`)) === true);

    console.log('9. Plan A0 (2384 × 3370 pt) : durée et mémoire');
    const t0 = Date.now();
    await c.click('#cmp-pages .cmp-row:nth-child(1) .cmp-open');
    check('A0 calculé', await ready());
    const dur = Date.now() - t0;
    const a0 = await S(`({w:S.sess.frame.W, h:S.sess.frame.H, mm:S.sess.mmPerPx, dpi:Math.round(S.sess.k*72), n:S.sess.regions.length, shift:[S.sess.shift.dx*S.sess.mmPerPx, S.sess.shift.dy*S.sess.mmPerPx], heap:Math.round(performance.memory.usedJSHeapSize/1048576)})`);
    console.log(`     A0 : ${a0.w}×${a0.h} px (${a0.mm.toFixed(3)} mm/px, ${a0.dpi} dpi), rendu + alignement + différences en ${(dur / 1000).toFixed(1)} s, ${a0.n} zone(s), tas JS ${a0.heap} Mo`);
    check('A0 : décalage de 5 × 3 mm retrouvé', Math.abs(a0.shift[0] + 5) < 0.6 && Math.abs(a0.shift[1] + 3) < 0.6, a0.shift);
    check('A0 : le trait épais ajouté est détecté', (await S(`S.sess.regions.some((g)=>g.kind==='added')`)) === true);
    check('A0 : moins de 40 s', dur < 40000, dur);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
    await c.click('#cmp-close'); await sleep(300);
    check('fermeture : espace masqué, documents toujours ouverts', (await c.ev(`document.getElementById('cmpws').hidden && document.querySelectorAll('.doctab').length===4`)) === true);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log('10. Mémoire d un A0 dans une session neuve (tous les processus de l application)');
  const c2 = await launchApp({ files: [f.bigOld, f.bigNew] });
  try {
    await c2.waitFor("document.querySelectorAll('.doctab').length===2", 25000);
    await sleep(2500);
    const base = electronMemMo();
    await c2.click('#rtab-document'); await c2.click('#rpanel-document [data-cmd=doc-compare]');
    let peak = base;
    const sampler = setInterval(() => { peak = Math.max(peak, electronMemMo()); }, 400);
    await c2.waitFor("import('./js/compare-ui.js').then((m)=>{const S=m.getState(); return !!S.sess && !S.job})", 60000);
    clearInterval(sampler);
    await sleep(1500);
    peak = Math.max(peak, electronMemMo());
    console.log('     A0 à 4096 px : mémoire de l application ' + Math.round(base) + ' Mo au repos, pointe ' + Math.round(peak) + ' Mo (+' + Math.round(peak - base) + ' Mo)');
    check("A0 : pointe de mémoire inférieure à 1,5 Go de plus qu au repos", peak - base < 1536, peak - base);
    check('A0 (session neuve) : aucune erreur JavaScript', c2.logs.length === 0, c2.logs.slice(0, 2));
  } catch (e) { check('mesure mémoire sans exception', false, String(e && e.stack || e)); } finally { await c2.close(); }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : comparaison (interface).');
})();
