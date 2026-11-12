// Caviardage (interface, hors écran) : onglet « Caviarder », tracé / déplacement / suppression / annulation d'une zone, « Rechercher et caviarder »
// (texte et modèle), avertissement et application, annuler / rétablir, nettoyage des métadonnées, enregistrement (nouveau nom) puis réouverture
// depuis le fichier écrit, refus d'écraser le fichier d'origine, question des zones non appliquées, OCR relancé sur la page caviardée (tesseract réel).
// Le fichier enregistré est relu dans Node : texte (pdf.js) et octets (flux décompressés, UTF-16, hexadécimal) sans le secret.
// Usage : node test/test-redact-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('./lib/app.js');
const { makeRedactPdf, SECRET, PUBLIC2, ZONE } = require('./lib/make-redact-pdf.js');
const { scan } = require('./lib/secret-scan.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail).slice(0, 400) : ''); }
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-redact-in-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-redact-out-'));
  const file = path.join(dir, 'piege.pdf');
  fs.writeFileSync(file, await makeRedactPdf());
  const c = await launchApp({ files: [file], env: { SPINADOC_TEST_SAVE_DIR: out } });
  const doc = (expr) => c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const zones = () => doc(`d.edits.filter((e)=>e.type==='redact')`);
  const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
  const SC = 4 / 3;
  const P = async (x, y, n = 0) => { const r = await c.ev(`JSON.stringify((()=>{const b=document.querySelectorAll('.docview.active .page')[${n}].getBoundingClientRect(); return [b.left,b.top]})())`).then(JSON.parse); return [r[0] + x * SC, r[1] + (842 - y) * SC]; }; // point PDF → écran
  const mouse = (type, x, y, mods = 0) => c.mouse(type, x, y, { modifiers: mods });
  const drag = async (x1, y1, x2, y2) => {
    await mouse('mouseMoved', x1, y1); await mouse('mousePressed', x1, y1);
    for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', x1 + ((x2 - x1) * i) / 6, y1 + ((y2 - y1) * i) / 6); await sleep(15); }
    await mouse('mouseReleased', x2, y2); await sleep(250);
  };
  const cmd = (k) => c.click(`#rpanel-document [data-cmd=${k}]`);
  const RU = (expr) => c.ev(`import('./js/redact-ui.js').then((R)=>import('./js/ui.js').then((u)=>{const d=u.store.active; return Promise.resolve(${expr}).then((x)=>JSON.stringify(x===undefined?null:x))}))`).then(JSON.parse);
  const choose = async (label) => { await c.waitFor(`!document.getElementById('choice').hidden`, 8000); await c.ev(`[...document.querySelectorAll('#choice-actions button')].find((b)=>b.textContent===${JSON.stringify(label)}).click()`); await sleep(200); };
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const textOf = async (bytes) => { const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise; const t = []; for (let i = 1; i <= pdf.numPages; i++) t.push((await (await pdf.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ')); await pdf.destroy(); return t; };
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 20000);
    await sleep(900);
    await c.click('#rtab-document'); await sleep(200);
    check('onglet « Document », groupe Caviarder : outil, recherche, retirer, appliquer, OCR, métadonnées', await c.ev(`['tool-redact','rdx-find','rdx-clear','rdx-apply','rdx-ocr','rdx-meta'].every((k)=>!!document.querySelector('#rpanel-document [data-cmd='+k+']'))`));
    check('« Appliquer » et « OCR des pages caviardées » désactivés sans zone ni page caviardée', await c.ev(`document.querySelector('#rpanel-document [data-cmd=rdx-apply]').disabled && document.querySelector('#rpanel-document [data-cmd=rdx-ocr]').disabled`));

    console.log('1. Zone tracée à la main : hachures, déplacement, suppression, annulation');
    await cmd('tool-redact'); await sleep(150);
    const [ax, ay] = await P(ZONE[0], ZONE[3]), [bx, by] = await P(ZONE[2], ZONE[1]);
    await drag(ax, ay, bx, by);
    let z = await zones();
    check('zone créée par glisser (cadre en coordonnées PDF, ±2 pt)', z.length === 1 && Math.abs(z[0].cx - (ZONE[0] + ZONE[2]) / 2) < 2 && Math.abs(z[0].w - (ZONE[2] - ZONE[0])) < 2 && Math.abs(z[0].h - (ZONE[3] - ZONE[1])) < 2, z);
    const g = await c.ev(`(()=>{const g=document.querySelector('.docview.active .objs g[data-id="${z[0] && z[0].id}"]'); return JSON.stringify(g?{paths:g.querySelectorAll('path').length, text:[...g.querySelectorAll('text')].map((t)=>t.textContent), stroke:g.querySelector('path:nth-child(2)').getAttribute('stroke')}:null)})()`).then(JSON.parse);
    check('aperçu : fond, hachures, bordure rouges et libellé « À caviarder »', !!g && g.paths === 3 && g.text.includes('À caviarder') && /rgb\(219,26,31\)|rgb\(219, 26, 31\)/.test(g.stroke || ''), g);
    check('outil persistant, barre d\'état « Zone à caviarder »', (await c.ev(`document.getElementById('tool-label').textContent`)).includes('Zone à caviarder'));
    await key('Escape', 'Escape', 27); await sleep(100); // retour à l'outil de sélection
    check('Échap : retour à la sélection', (await doc('d.tool')) === 'select');
    const [mx, my] = await P((ZONE[0] + ZONE[2]) / 2, (ZONE[1] + ZONE[3]) / 2);
    await drag(mx, my, mx + 30 * SC, my);
    z = await zones();
    check('zone déplacée (cliquable à l\'intérieur) de 30 pt', z.length === 1 && Math.abs(z[0].cx - ((ZONE[0] + ZONE[2]) / 2 + 30)) < 1.5, z[0] && z[0].cx);
    await key('Delete', 'Delete', 46); await sleep(200);
    check('Suppr : zone supprimée', (await zones()).length === 0);
    await key('z', 'KeyZ', 90, 2); await sleep(200);
    check('Ctrl+Z : zone rétablie', (await zones()).length === 1);
    await key('z', 'KeyZ', 90, 2); await sleep(200);
    check('Ctrl+Z : zone revenue à sa place d\'origine', Math.abs((await zones())[0].cx - (ZONE[0] + ZONE[2]) / 2) < 2);
    await cmd('rdx-clear'); await sleep(200);
    check('« Retirer les zones » : plus aucune zone', (await zones()).length === 0);

    console.log('2. Rechercher et caviarder');
    await cmd('rdx-find'); await sleep(200);
    check('panneau ouvert, champ de recherche actif', await c.ev(`!document.getElementById('rdx-find').hidden && document.activeElement.id==='rdx-q'`));
    await c.type(SECRET.toLowerCase()); await key('Enter', 'Enter', 13);
    await c.waitFor(`/occurrence/.test(document.getElementById('rdx-status').textContent)`, 10000);
    const nRows = await c.ev(`document.querySelectorAll('#rdx-list .rdx-row').length`);
    check('au moins 4 occurrences (3 polices + formulaire), toutes en page 1, cochées', nRows >= 4 && (await c.ev(`[...document.querySelectorAll('#rdx-list .rdx-pg')].every((e)=>e.textContent==='p. 1') && [...document.querySelectorAll('#rdx-list input')].every((i)=>i.checked)`)), nRows);
    check('occurrences surlignées dans la page', (await c.ev(`document.querySelectorAll('.docview.active .search-hl').length`)) >= 4);
    await c.ev(`document.querySelector('#rdx-list input').click()`); await sleep(100);
    check('décocher une occurrence : le bouton compte les cochées', (await c.ev(`document.getElementById('rdx-mark').textContent`)) === `Marquer ${nRows - 1} occurrences`, await c.ev(`document.getElementById('rdx-mark').textContent`));
    await c.click('#rdx-all'); await sleep(100);
    await c.click('#rdx-mark'); await sleep(300);
    z = await zones();
    check('« Marquer » : une zone par occurrence, en UNE étape d\'historique', z.length >= 4 && z.length === nRows, z.length);
    check('lignes marquées grisées, case désactivée', await c.ev(`[...document.querySelectorAll('#rdx-list .rdx-row')].every((r)=>r.classList.contains('marked') && r.querySelector('input').disabled)`));
    await c.ev(`(()=>{const s=document.getElementById('rdx-kind'); s.value='email'; s.dispatchEvent(new Event('change')); return 1})()`);
    await c.waitFor(`/occurrence/.test(document.getElementById('rdx-status').textContent)`, 8000);
    check('modèle « e-mail » : aucune occurrence dans ce document (message explicite)', (await c.ev(`document.getElementById('rdx-status').textContent`)).startsWith('Aucune occurrence'));
    await c.click('#rdx-close'); await sleep(150);
    // zone tracée en plus : couvre l'image, la note et le champ (secret non textuel)
    await cmd('tool-redact'); await sleep(100);
    const [cx1, cy1] = await P(ZONE[0], 610), [cx2, cy2] = await P(ZONE[2], ZONE[1]);
    await drag(cx1, cy1, cx2, cy2);
    await key('Escape', 'Escape', 27);
    const nz = (await zones()).length;
    check('zone supplémentaire tracée (image, note, champ)', nz === nRows + 1, nz);

    console.log('3. Appliquer : avertissement, réglages, application');
    await cmd('rdx-apply');
    await c.waitFor(`!document.getElementById('rdx-apply').hidden`, 4000);
    const warn = await c.ev(`document.querySelector('#rdx-apply .rdx-warn').textContent`);
    check('avertissement clair (information détruite, seule l\'annulation avant enregistrement)', /détruite/.test(warn) && /Annuler/.test(warn) && /avant d'enregistrer/.test(warn), warn);
    check('résumé : zones et page concernée', /zones sur 1 page \(1\)/.test(await c.ev(`document.getElementById('rdx-apply-summary').textContent`)), await c.ev(`document.getElementById('rdx-apply-summary').textContent`));
    check('bouton « Appliquer » désactivé tant que la case n\'est pas cochée', await c.ev(`document.getElementById('rdx-apply-ok').disabled`));
    await c.click('#rdx-apply-cancel'); await sleep(150);
    check('Annuler la boîte : rien n\'est appliqué', (await doc('d.pages[0].src')) === '0' && (await zones()).length === nz);
    await cmd('rdx-apply'); await c.waitFor(`!document.getElementById('rdx-apply').hidden`, 4000);
    await c.ev(`(()=>{document.getElementById('rdx-label').value='CAVIARDÉ'; document.getElementById('rdx-color').value='#000000'; const s=document.getElementById('rdx-dpi'); s.value='200'; s.dispatchEvent(new Event('change')); const k=document.getElementById('rdx-confirm'); k.click(); return 1})()`);
    check('case cochée : bouton actif', !(await c.ev(`document.getElementById('rdx-apply-ok').disabled`)));
    const t0 = Date.now();
    await c.click('#rdx-apply-ok');
    await choose('Plus tard');
    const tApply = Date.now() - t0;
    const st = await RU('R.state.last');
    console.log(`        (application : ${tApply} ms, page ${st.report[0].width} × ${st.report[0].height} px, ${st.report[0].dpi} dpi, ${Math.round(st.report[0].bytes / 1024)} Ko)`);
    check('page 1 remplacée par une image (source rd…), 200 dpi, zones retirées', (await doc('d.pages[0].src')).startsWith('rd') && st.report[0].dpi === 200 && (await zones()).length === 0, st);
    const items = await c.ev(`import('./js/viewer.js').then((V)=>import('./js/ui.js').then((u)=>V.getPageItems(u.store.active,0))).then((it)=>it.length)`);
    check('page caviardée : plus aucun texte (sélection / recherche)', items === 0, items);
    check('la page caviardée est affichée (canevas rendu)', await c.waitFor(`(()=>{const p=document.querySelectorAll('.docview.active .page')[0]; const cv=p.querySelector('canvas'); return cv.width>0})()`, 8000).then(() => true, () => false));
    check('« OCR des pages caviardées » actif', !(await c.ev(`document.querySelector('#rpanel-document [data-cmd=rdx-ocr]').disabled`)));

    console.log('4. Annuler / Rétablir');
    await key('z', 'KeyZ', 90, 2); await sleep(900);
    check('Ctrl+Z : page d\'origine (texte de nouveau présent) et zones rétablies', (await doc('d.pages[0].src')) === '0' && (await zones()).length === nz && (await c.ev(`import('./js/viewer.js').then((V)=>import('./js/ui.js').then((u)=>V.getPageItems(u.store.active,0))).then((it)=>it.length)`)) > 0);
    await key('y', 'KeyY', 89, 2); await sleep(900);
    check('Ctrl+Y : de nouveau caviardée', (await doc('d.pages[0].src')).startsWith('rd') && (await zones()).length === 0);

    console.log('5. Métadonnées');
    await cmd('rdx-meta'); await c.waitFor(`!document.getElementById('rdx-meta').hidden`, 4000);
    const rows = await c.ev(`JSON.stringify([...document.querySelectorAll('#rdx-meta-list .rdx-meta-row')].map((r)=>[r.querySelector('input').checked, r.textContent]))`).then(JSON.parse);
    check('8 cases cochées, valeurs actuelles affichées (titre et créateur avec le secret)', rows.length === 8 && rows.every((r) => r[0]) && rows[0][1].includes(SECRET) && rows.some((r) => /créateur/.test(r[1]) && r[1].includes(SECRET)), rows);
    await c.click('#rdx-meta-ok'); await sleep(200);
    check('nettoyage enregistré dans le document (annulable)', (await doc('d.clean && d.clean.title && d.clean.xmp && d.info.title===""')) === true);

    console.log('6. OCR relancé sur la page caviardée (tesseract réel) : le secret ne revient pas');
    const t1 = Date.now();
    await RU(`R.rerunOcr(d, [0], { auto: { scope: 'current', lang: 'fra', quality: 'standard', mode: 'text', orientation: 'no', skip: 'no', redo: 'yes' } })`);
    await c.waitFor(`import('./js/ocr-ui.js').then((m)=>!m.state.running)`, 240000);
    const words = await doc(`(d.ocr[d.pages[0].u]||{words:[]}).words.map((w)=>w.t)`);
    console.log(`        (OCR : ${Date.now() - t1} ms, ${words.length} mots : ${words.slice(0, 12).join(' ')})`);
    check('OCR : du texte public est reconnu (« Mention publique… »)', words.some((w) => /publique/i.test(w)), words);
    check('OCR : le secret n\'est pas reconnu, pas même une lettre isolée (Z, ZQ, 42…)', !words.some((w) => /QX|SECRET|ZQ|^Z$|42/i.test(w)), words);
    check('libellé « CAVIARDÉ » lu dans les blocs (preuve que les blocs sont dans l\'image)', words.some((w) => /CAVIARD/i.test(w)), words);

    console.log('7. Enregistrement : nouveau nom, réouverture depuis le fichier écrit');
    await c.ev(`document.body.click()`); await key('s', 'KeyS', 83, 2);
    const saved = path.join(out, 'piege (caviardé).pdf');
    await c.waitFor(`import('./js/ui.js').then((u)=>!!u.store.active && /caviard/.test(u.store.active.name))`, 20000).catch(() => {});
    await sleep(1500);
    check('fichier « piege (caviardé).pdf » écrit ; l\'original est intact', fs.existsSync(saved) && fs.readFileSync(file).equals(fs.readFileSync(file)) && scan(fs.readFileSync(file), SECRET).hits.length > 0);
    check('onglet rouvert depuis le fichier écrit : historique vide, non modifié', (await doc('d.path')) === saved && (await doc('d.undo.length')) === 0 && (await doc('d.dirty')) === false, await doc('[d.path, d.undo.length]'));
    if (fs.existsSync(saved)) {
      const bytes = fs.readFileSync(saved);
      const t = await textOf(bytes);
      check('fichier relu (pdf.js) : secret absent du texte, texte OCR présent, page 2 intacte', !t.some((x) => x.includes(SECRET)) && /publique/i.test(t[0]) && t[1].includes(PUBLIC2), t);
      const s = scan(bytes, SECRET);
      check('fichier relu (octets bruts et flux décompressés, UTF-16, hexadécimal) : secret introuvable', s.hits.length === 0 && s.inflated > 0, s);
      const meta = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise.then((p) => p.getMetadata());
      check('métadonnées relues : titre, auteur, créateur vides, pas de XMP', !meta.info.Title && !meta.info.Author && !meta.info.Creator && !meta.metadata, meta.info);
      console.log(`        (taille : ${Math.round(fs.statSync(file).size / 1024)} Ko → ${Math.round(bytes.length / 1024)} Ko)`);
    }

    console.log('8. Jamais d\'écrasement du fichier d\'origine ; zones non appliquées à l\'enregistrement');
    const mtime = fs.statSync(saved).mtimeMs;
    await c.click('#rtab-document'); await cmd('tool-redact'); await sleep(100);
    const [qx1, qy1] = await P(60, 830), [qx2, qy2] = await P(300, 810);
    await drag(qx1, qy1, qx2, qy2);
    await key('Escape', 'Escape', 27);
    await c.ev(`document.body.click()`); await key('s', 'KeyS', 83, 2);
    await c.waitFor(`!document.getElementById('choice').hidden`, 6000);
    const q = await c.ev(`JSON.stringify([document.getElementById('choice-msg').textContent, [...document.querySelectorAll('#choice-actions button')].map((b)=>b.textContent)])`).then(JSON.parse);
    check('zone non appliquée : question à l\'enregistrement (appliquer / sans caviarder / annuler)', /jamais écrites/.test(q[0]) && q[1].join('|') === 'Appliquer puis enregistrer|Enregistrer sans caviarder|Annuler', q);
    await choose('Annuler');
    check('Annuler : rien n\'est écrit', fs.statSync(saved).mtimeMs === mtime);
    await RU(`R.apply(d, { auto: { dpi: 150, color: [0, 0, 0], label: '' } })`);
    await c.ev(`document.body.click()`); await key('s', 'KeyS', 83, 2); await sleep(2500);
    check('document caviardé du même nom que son fichier : enregistrement refusé, fichier inchangé', fs.statSync(saved).mtimeMs === mtime && (await doc('d.dirty')) === true);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (err) {
    check('exécution sans exception', false, String(err && err.stack || err));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : caviardage (interface).');
})();
