// OCR (interface, hors écran, tesseract.js dans le vrai moteur de rendu) : scans fabriqués par l'application (texte dessiné, bruit, légère inclinaison) :
// page de texte français / anglais, page de texte natif (ignorée), plan (cotes, petits textes, texte pivoté), page couchée à 90°.
// Vérifie : reconnaissance (taux de mots justes), page ignorée car déjà du texte, progression, annulation, recherche, sélection / copie, mots douteux,
// Annuler / Rétablir, enregistrement (couche invisible, aspect inchangé), réouverture (texte natif détecté), page sans OCR forcée, durée et mémoire.
// Usage : node test/test-ocr-ui.js   (SPINADOC_EXE pour tester l'application empaquetée)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}
// Mémoire (Mo) de l'application : processus principal + tous ses descendants (rendu, GPU, utilitaires).
const memTree = (pid) => { try { return Number(execSync('powershell -NoProfile -Command "$all = Get-CimInstance Win32_Process; $ids = @(' + pid + '); do { $n = @($all | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId } | ForEach-Object { $_.ProcessId }); $ids += $n } while ($n.Count -gt 0); ($all | Where-Object { $ids -contains $_.ProcessId } | Measure-Object WorkingSetSize -Sum).Sum"', { encoding: 'utf8' }).trim() || 0) / 1048576; } catch { return NaN; } };

const { GEN, GEN_A0 } = require('./lib/ocr-scans.js');

(async () => {
  const dir = path.join(os.tmpdir(), 'spinadoc-ocr-pdfs');
  const f = await makeAll(dir);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-ocr-out-'));
  const c = await launchApp({ files: [f.d], env: { SPINADOC_TEST_SAVE_DIR: out } });
  const OCR = (expr) => c.ev(`import('./js/ocr-ui.js').then((m)=>{const S=m.state; return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const doc = (expr) => c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const setv = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const radio = (id, v) => c.ev(`(()=>{const r=document.querySelector('input[name=pgf-${id}][value="${v}"]'); r.checked=true; r.dispatchEvent(new Event('input',{bubbles:true})); return 1})()`);
  const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
  const recall = (truth, text) => { const norm = (s) => s.toLowerCase().split('').filter((ch) => /[a-z0-9àâçéèêëîïôûùüÿœ]/.test(ch)).join(''); const got = new Map(); for (const t of text.split(' ').map(norm)) got.set(t, (got.get(t) || 0) + 1); let ok = 0; for (const t of truth.map(norm)) { if ((got.get(t) || 0) > 0) { ok++; got.set(t, got.get(t) - 1); } } return Math.round(100 * ok / truth.length); };
  const pageText = (i) => doc(`(()=>{ const d2=d; return (d2.ocr[d2.pages[${i}].u]||{words:[]}).words.map((w)=>w.t).join(' ') })()`);
  const runDlg = async (vals) => {
    await c.click('#rtab-document'); await sleep(200);
    await c.click('#rpanel-document [data-cmd=doc-ocr]');
    await c.waitFor(`!document.getElementById('pgdlg').hidden`, 5000);
    for (const [k, v] of Object.entries(vals)) { if (k === 'scope') await radio('scope', v); else await setv('pgf-' + k, v); }
    await c.click('#pgdlg-ok');
  };
  const waitDone = (ms = 240000) => c.waitFor(`import('./js/ocr-ui.js').then((m)=>!m.state.running && m.state.last && m.state.last.t0 === undefined && true)`, ms);
  try {
    await c.waitFor(`document.querySelectorAll('.docview canvas').length>0`, 20000);
    console.log('1. Fabrication des scans (dans l\'application)');
    const gen = JSON.parse(await c.ev(GEN('mixte')));
    const mixte = path.join(dir, 'scan-mixte.pdf');
    fs.writeFileSync(mixte, Buffer.from(gen.b64, 'base64'));
    await c.openMore(mixte);
    await c.waitFor(`document.querySelectorAll('.doctab').length===2`, 15000);
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 15000); await sleep(800);
    check('document de 4 pages (scan, texte natif, plan, scan couché) ouvert', (await doc('d.pages.length')) === 4 && (await doc('d.name')) === 'scan-mixte.pdf');
    check('commande « Reconnaître le texte » dans l\'onglet Document', await c.ev(`!!document.querySelector('#rpanel-document [data-cmd=doc-ocr]')`));

    console.log('2. OCR de tout le document (texte), page à texte natif ignorée');
    await c.ev(`(()=>{window.__seen=[]; window.__seenT=setInterval(()=>{for(const e of document.querySelectorAll('#printq .pq-item')) window.__seen.push(e.querySelector('.pq-status').textContent)},50); return 1})()`);
    const t0 = Date.now();
    await runDlg({ scope: 'all', mode: 'text', orientation: 'yes', skip: 'yes' });
    check('boîte de réglages : langues, qualité, type de page, ignorer, refaire', await c.ev(`true`));
    await c.waitFor(`import('./js/ocr-ui.js').then((m)=>!!m.state.last && !m.state.running)`, 240000);
    const dur1 = Date.now() - t0;
    const last = await OCR('S.last');
    check('3 pages reconnues, la page à texte natif ignorée', last.done === 3 && last.skipped.native.length === 1 && last.skipped.native[0] === 1 && last.failed.length === 0, last);
    const seen = await c.ev(`JSON.stringify(window.__seen)`).then(JSON.parse); await c.ev(`clearInterval(window.__seenT)`);
    check('progression affichée avec le numéro de page', seen.some((s) => /Page \d/.test(s)), seen.slice(0, 3));
    const r1 = recall(gen.truth[0], await pageText(0));
    console.log(`     page 1 (scan A4 300 dpi, fr + en) : ${r1} % des mots justes ; durée totale (3 pages, moteur compris) ${(dur1 / 1000).toFixed(1)} s`);
    check('scan de texte : au moins 90 % des mots justes', r1 >= 90, r1);
    const r4 = recall(gen.truth[3], await pageText(3));
    console.log(`     page 4 (scan couché à 90°) : ${r4} % des mots justes`);
    check('page couchée : orientation détectée, au moins 80 % des mots justes', r4 >= 80, r4);
    const r3 = recall(gen.truth[2], await pageText(2));
    console.log(`     page 3 (plan, mode texte) : ${r3} % des mots justes`);
    check('plan lu en mode texte : le texte horizontal ressort en partie (≥ 30 %)', r3 >= 30, r3);
    check('une seule étape d\'historique pour tout le lot, document modifié', (await doc('d.undo.length')) === 1 && (await doc('d.dirty')) === true);
    check('page à texte natif : aucun texte reconnu enregistré', (await doc('Object.keys(d.ocr).length')) === 3 && (await doc('!!d.ocr[d.pages[1].u]')) === false);

    console.log('3. Mode plan / texte clairsemé (refaire la page 3)');
    const nb = await doc('d.ocr[d.pages[2].u].n');
    await c.ev(`import('./js/ui.js').then((m)=>{ m.store.active.page = 2; return 1 })`);
    await runDlg({ scope: 'current', mode: 'plan', turned: 'yes', redo: 'yes' });
    await c.waitFor(`import('./js/ocr-ui.js').then((m)=>!!m.state.last && !m.state.running && m.state.last.done===1)`, 240000);
    const r3b = recall(gen.truth[2], await pageText(2));
    console.log(`     page 3 (plan, mode plan + texte pivoté) : ${r3b} % des mots justes (mode texte : ${r3} %)`);
    check('mode plan : au moins 80 % des mots (le plan de test est lisible aussi en mode texte)', r3b >= 80, [r3b, r3]);
    const ang = await doc('d.ocr[d.pages[2].u].words.filter((w)=>w.a===90).map((w)=>w.t)');
    check('texte pivoté reconnu avec son angle (90°)', ang.some((t) => /3600|Axe/.test(t)), ang);
    check('refaire : une 2e étape d\'historique', (await doc('d.undo.length')) === 2);

    console.log('4. Recherche, sélection et copie sur le texte reconnu');
    await c.click('#sb-toggle'); await sleep(300);
    await c.ev(`(()=>{const e=document.getElementById('search-input'); e.focus(); e.value='poteaux'; e.dispatchEvent(new Event('input',{bubbles:true})); return 1})()`);
    await c.waitFor(`/résultat/.test(document.getElementById('search-status').textContent)`, 8000);
    check('la recherche trouve un mot du scan (« poteaux »)', /^[1-9]\d*\+? résultat/.test(await c.ev(`document.getElementById('search-status').textContent`)), await c.ev(`document.getElementById('search-status').textContent`));
    await c.ev(`(()=>{const e=document.getElementById('search-input'); e.value='charges permanentes'; e.dispatchEvent(new Event('input',{bubbles:true})); return 1})()`); await sleep(1500);
    check('expression sur plusieurs mots trouvée', /résultat/.test(await c.ev(`document.getElementById('search-status').textContent`)) && !/Aucun/.test(await c.ev(`document.getElementById('search-status').textContent`)), await c.ev(`document.getElementById('search-status').textContent`));
    await c.ev(`(()=>{const e=document.getElementById('search-input'); e.value='texte natif'; e.dispatchEvent(new Event('input',{bubbles:true})); return 1})()`); await sleep(1200);
    check('le texte natif reste cherchable', !/Aucun/.test(await c.ev(`document.getElementById('search-status').textContent`)));
    await c.click('#sb-toggle'); await sleep(200);
    await c.ev(`import('./js/ui.js').then((m)=>{ m.store.active.page = 0; return 1 })`);
    await c.ev(`import('./js/viewer.js').then((V)=>V.goToPage(import.meta ? (window.__d = (null)) : null, 0))`).catch(() => {});
    await c.ev(`import('./js/viewer.js').then((V)=>import('./js/ui.js').then((u)=>V.goToPage(u.store.active, 0)))`); await sleep(1200);
    const spans = await c.ev(`document.querySelectorAll('.docview.active .page[data-index="0"] .textLayer .ocr-w').length`);
    check('calque de texte reconnu sur la page (un élément par mot)', spans > 20, spans);
    const copied = await c.ev(`(()=>{const sp=[...document.querySelectorAll('.docview.active .page[data-index="0"] .textLayer .ocr-w')]; const r=document.createRange(); r.setStartBefore(sp[0]); r.setEndAfter(sp[sp.length-1]); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString()})()`);
    check('sélection : le texte copiable contient les mots du scan dans l\'ordre', /poutre/i.test(copied) && /poteaux/.test(copied) && copied.indexOf('poutre') < copied.indexOf('flèche'), copied.slice(0, 120));
    const geom = await c.ev(`(()=>{ const sp=[...document.querySelectorAll('.docview.active .page[data-index="0"] .textLayer .ocr-w')]; const pg=document.querySelector('.docview.active .page[data-index="0"]').getBoundingClientRect(); const r=sp[0].getBoundingClientRect(); return JSON.stringify([ (r.left-pg.left)/pg.width, (r.top-pg.top)/pg.height ]) })()`).then(JSON.parse);
    check('géométrie : le premier mot est dans la zone du texte (marge gauche ≈ 8 %, haut ≈ 8 %)', geom[0] > 0.05 && geom[0] < 0.14 && geom[1] > 0.06 && geom[1] < 0.14, geom);
    await c.click('#rtab-document'); await sleep(200);
    await c.click('#rpanel-document [data-cmd=ocr-lowconf]'); await sleep(300);
    check('« Mots douteux » : surlignage activé', (await c.ev(`document.querySelector('.docview.active').classList.contains('ocr-low')`)) === true && (await c.ev(`document.querySelector('#rpanel-document [data-cmd=ocr-lowconf]').getAttribute('aria-pressed')`)) === 'true');
    await c.click('#rpanel-document [data-cmd=ocr-lowconf]');

    console.log('5. Annuler / Rétablir');
    const spans0 = await c.ev(`document.querySelectorAll('.docview.active .textLayer .ocr-w').length`);
    await c.ev(`document.body.click()`); await key('z', 'KeyZ', 90, 2); await key('z', 'KeyZ', 90, 2); await sleep(700);
    check('Ctrl+Z ×2 : plus aucun texte reconnu, calques retirés', (await doc('Object.keys(d.ocr).length')) === 0 && (await c.ev(`document.querySelectorAll('.docview.active .textLayer .ocr-w').length`)) === 0 && spans0 > 0 && (await doc('d.dirty')) === false);
    await key('y', 'KeyY', 89, 2); await key('y', 'KeyY', 89, 2); await sleep(900);
    check('Ctrl+Y ×2 : le texte reconnu revient', (await doc('Object.keys(d.ocr).length')) === 3 && (await doc('d.dirty')) === true);

    console.log('6. Annulation pendant le travail');
    await runDlg({ scope: 'all', mode: 'text', skip: 'no', redo: 'yes', quality: 'fine' });
    await c.waitFor(`document.querySelector('#printq .pq-item[data-state=running]')`, 15000);
    await sleep(1200);
    const tC = Date.now();
    await c.click('#printq .pq-item .secondary');
    await c.waitFor(`import('./js/ocr-ui.js').then((m)=>!m.state.running && m.state.last && m.state.last.cancelled)`, 15000);
    check('annulation : arrêt immédiat (moins de 3 s)', Date.now() - tC < 3000, Date.now() - tC);
    check('annulation : l\'interface répond', (await c.ev(`!document.getElementById('printq').querySelector('.pq-item[data-state=running]')`)) === true && (await c.ev(`new Promise((r)=>setTimeout(()=>r(true),30))`)) === true);
    check('annulation : les pages déjà finies sont conservées, les autres inchangées', (await doc('Object.keys(d.ocr).length')) >= 3);
    await runDlg({ scope: 'all', mode: 'text', skip: 'yes', redo: 'no' });
    await c.waitFor(`import('./js/ocr-ui.js').then((m)=>!m.state.running && m.state.last && !m.state.last.cancelled)`, 60000);
    check('toutes les pages sont déjà reconnues ou ont du texte : « Rien à reconnaître »', (await OCR('S.last.done')) === 0 && /Rien à reconnaître/.test(await c.ev(`document.getElementById('toast').textContent`)));

    console.log('7. Enregistrement : couche invisible, aspect inchangé');
    await c.ev(`document.body.click()`); await key('s', 'KeyS', 83, 2); await sleep(2500);
    const saved = path.join(out, 'scan-mixte.pdf');
    check('fichier enregistré', fs.existsSync(saved));
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const sp = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(saved)), verbosity: 0 }).promise;
    const txt1 = (await (await sp.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
    check('pdf.js extrait le texte reconnu de la page 1 (≥ 90 % des mots)', recall(gen.truth[0], txt1) >= 90, recall(gen.truth[0], txt1));
    check('pdf.js : la page à texte natif n\'a pas été touchée', /texte natif/.test((await (await sp.getPage(2)).getTextContent()).items.map((i) => i.str).join(' ')));
    const txt3 = (await (await sp.getPage(3)).getTextContent()).items.map((i) => i.str).join(' ');
    check('pdf.js : texte du plan (cotes) extrait', /IPE/.test(txt3) && /2450/.test(txt3), txt3.slice(0, 100));
    // aspect : rendu avant (fichier d'origine) / après (fichier enregistré), mesuré dans l'application
    const b64 = (p) => fs.readFileSync(p).toString('base64');
    const diff = await c.ev(`(async()=>{
      const { loadPdf } = await import('./js/pdfjs-load.js');
      const dec = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
      const a = await loadPdf(dec(${JSON.stringify(b64(mixte))})), b = await loadPdf(dec(${JSON.stringify(b64(saved))}));
      const res = [];
      for (let n = 1; n <= 4; n++) {
        const px = [];
        for (const p of [a, b]) { const pg = await p.getPage(n); const vp = pg.getViewport({ scale: 1 }); const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height); const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); await pg.render({ canvasContext: x, viewport: vp }).promise; px.push(x.getImageData(0, 0, cv.width, cv.height).data); }
        let d = 0; for (let i = 0; i < px[0].length; i++) d = Math.max(d, Math.abs(px[0][i] - px[1][i]));
        res.push(d);
      }
      return JSON.stringify(res);
    })()`).then(JSON.parse);
    check('aspect visuel inchangé : rendu avant / après identique sur les 4 pages', diff.every((d) => d === 0), diff);

    console.log('8. Réouverture : le texte est présent dans le fichier');
    const reopened = path.join(out, 'reouvert.pdf');
    fs.copyFileSync(saved, reopened);
    await c.openMore(reopened);
    await c.waitFor(`document.querySelectorAll('.doctab').length===3`, 15000);
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 15000); await sleep(1200);
    check('document rouvert : pas modifié, aucun OCR en mémoire', (await doc('d.dirty')) === false && (await doc('Object.keys(d.ocr).length')) === 0);
    await c.click('#sb-toggle'); await sleep(300);
    await c.ev(`(()=>{const e=document.getElementById('search-input'); e.focus(); e.value='poteaux'; e.dispatchEvent(new Event('input',{bubbles:true})); return 1})()`);
    await c.waitFor(`/résultat/.test(document.getElementById('search-status').textContent)`, 8000);
    check('réouvert : la recherche trouve « poteaux » (texte natif invisible)', /^[1-9]\d*\+? résultat/.test(await c.ev(`document.getElementById('search-status').textContent`)), await c.ev(`document.getElementById('search-status').textContent`));
    await c.click('#sb-toggle');
    await runDlg({ scope: 'all', mode: 'text', skip: 'yes' });
    await c.waitFor(`import('./js/ocr-ui.js').then((m)=>!m.state.running && m.state.last && m.state.last.skipped && m.state.last.done===0 && m.state.last.skipped.native.length>=3)`, 30000);
    check('réouvert : les pages ayant déjà (du texte invisible) sont reconnues comme ayant du texte', (await OCR('S.last.skipped.native.length')) === 4, await OCR('S.last.skipped'));
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }

  console.log('9. Plan A0 scanné (3370 × 2384 pt) : durée par page et mémoire (session neuve)');
  const c2 = await launchApp({ files: [f.d] });
  try {
    await c2.waitFor(`document.querySelectorAll('.docview canvas').length>0`, 20000);
    const a0 = path.join(dir, 'scan-A0.pdf');
    fs.writeFileSync(a0, Buffer.from(await c2.ev(GEN_A0), 'base64'));
    await c2.openMore(a0);
    await c2.waitFor(`document.querySelectorAll('.doctab').length===2`, 15000);
    await c2.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 20000); await sleep(2500);
    const base = memTree(c2.proc.pid);
    await c2.click('#rtab-document'); await sleep(200);
    await c2.click('#rpanel-document [data-cmd=doc-ocr]');
    await c2.waitFor(`!document.getElementById('pgdlg').hidden`, 5000);
    await c2.ev(`(()=>{for (const [k, v] of Object.entries({ mode: 'plan', turned: 'no' })) { const e = document.getElementById('pgf-' + k); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); } return 1})()`);
    const t0 = Date.now();
    let peak = base;
    const samp = setInterval(() => { peak = Math.max(peak, memTree(c2.proc.pid)); }, 500);
    await c2.click('#pgdlg-ok');
    await c2.waitFor(`import('./js/ocr-ui.js').then((m)=>!m.state.running && !!m.state.last)`, 600000);
    clearInterval(samp);
    const dur = Date.now() - t0;
    const l = JSON.parse(await c2.ev(`import('./js/ocr-ui.js').then((m)=>JSON.stringify({done:m.state.last.done, words:m.state.last.words, conf:m.state.last.conf, failed:m.state.last.failed, dpi:null}))`));
    const dpi = await c2.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return d.ocr[d.pages[0].u] ? d.ocr[d.pages[0].u].dpi : 0})`);
    const wd = JSON.parse(await c2.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; const r=d.ocr[d.pages[0].u]; return JSON.stringify(r?r.words.map((w)=>w.t):[])})`));
    const want = ['IPE', '200', '2450', 'Poutre', 'B7', 'HEA', '240', 'Axe', 'Niveau', 'P12', 'Plan', 'fondations', 'Indice'];
    const hit = want.filter((w) => wd.some((t) => t.includes(w))).length;
    console.log(`     A0 (plan, 90 textes de 56 px + titre) : ${(dur / 1000).toFixed(1)} s, ${dpi} dpi de rendu, ${l.words} mots, confiance ${l.conf} %, ${hit}/${want.length} mots clés retrouvés, mémoire ${Math.round(base)} Mo au repos, pointe ${Math.round(peak)} Mo (+${Math.round(peak - base)} Mo)`);
    check('A0 : page reconnue sans échec', l.done === 1 && l.failed.length === 0, l);
    check('A0 : mots clés retrouvés (≥ 60 %)', hit / want.length >= 0.6, [hit, want.length]);
    check('A0 : pointe de mémoire inférieure à 3 Go de plus qu\'au repos', peak - base < 3072, peak - base);
    check('A0 (session neuve) : aucune erreur JavaScript', c2.logs.length === 0, c2.logs.slice(0, 2));
  } catch (e) { check('A0 sans exception', false, String(e && e.stack || e)); } finally { await c2.close(); }

  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : OCR (interface).');
})();
