// Champs de formulaire créés (interface, hors écran) : onglet Formulaire, tracé de chaque type (glisser et clic), outil persistant, groupe radio,
// propriétés (nom unique, renommage d'un groupe, options, valeur par défaut, obligatoire), duplication (nom incrémenté), annuler / rétablir,
// alignement, ordre de tabulation (boîte), mode « Prévisualiser / remplir » (calque du lot 3d, Tab), absence de débordement du panneau
// Propriétés pour chaque type, enregistrement relu avec pdf.js (types, noms, positions ±0,2 mm, page pivotée), réouverture et remplissage.
// Usage : node test/test-fields-ui.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFLib = require('@cantoo/pdf-lib');
const { launchApp, sleep } = require('./lib/app.js');
const { SCRIPT: OVERFLOW } = require('./lib/overflow.js');
const { SCRIPT: CLICKABLE } = require('./lib/clickable.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail).slice(0, 500) : ''); }
}
const MM = 72 / 25.4;
const near = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= (tol || 0.2 * MM));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-fields-'));
  const file = path.join(dir, 'formulaire.pdf');
  const src = await PDFLib.PDFDocument.create();
  const font = await src.embedFont(PDFLib.StandardFonts.Helvetica);
  const p1 = src.addPage([595, 842]); p1.drawText('Fiche d\'inscription', { x: 72, y: 780, size: 18, font });
  const p2 = src.addPage([595, 842]); p2.setRotation(PDFLib.degrees(90)); p2.drawText('Page pivotee', { x: 72, y: 780, size: 14, font });
  fs.writeFileSync(file, await src.save());
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-fields-out-'));
  const c = await launchApp({ files: [file], env: { SPINADOC_TEST_SAVE_DIR: out } });
  const doc = (expr) => c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return JSON.stringify(${expr})})`).then((x) => (x === undefined ? undefined : JSON.parse(x)));
  const fields = () => doc(`d.edits.filter(e=>e.type==='field').map(e=>({id:e.id,name:e.name,ftype:e.ftype,page:e.page,r:[e.cx-e.w/2,e.cy-e.h/2,e.cx+e.w/2,e.cy+e.h/2],export:e.export,value:e.value,options:e.options,required:e.required,tab:e.tab}))`);
  const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
  // point PDF (page i) → écran, via la vue réelle de la page ; la vue défile pour que le point soit au centre (jamais sous le ruban)
  const S = async (i, x, y, keep) => JSON.parse(await c.ev(`import('./js/viewer.js').then((V)=>import('./js/ui.js').then((u)=>{const rec=V.getPages(u.store.active)[${i}]; const view=document.querySelector('.docview.active .viewer'); const pos=()=>{const q=rec.vp.convertToViewportPoint(${x},${y}); const r=rec.div.getBoundingClientRect(); return [r.left+q[0], r.top+q[1]]}; let p=pos(); if (${keep ? 'true' : 'false'}) return JSON.stringify(p); const vr=view.getBoundingClientRect(); view.scrollTop += p[1]-(vr.top+vr.height/2); view.scrollLeft += p[0]-(vr.left+vr.width/2); p=pos(); return JSON.stringify(p)}))`));
  const drag = async (i, a, b) => {
    await S(i, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); // centre du glisser au centre de la vue, puis les deux points sans défilement
    const [x1, y1] = await S(i, a[0], a[1], true); const [x2, y2] = await S(i, b[0], b[1], true);
    await c.mouse('mouseMoved', x1, y1); await c.mouse('mousePressed', x1, y1);
    for (let k = 1; k <= 6; k++) { await c.mouse('mouseMoved', x1 + ((x2 - x1) * k) / 6, y1 + ((y2 - y1) * k) / 6); await sleep(15); }
    await c.mouse('mouseReleased', x2, y2); await sleep(250);
  };
  const clickAt = async (i, x, y) => { const [sx, sy] = await S(i, x, y); await c.clickXY(sx, sy); await sleep(200); };
  const cmd = (k) => c.click(`#rpanel-forms [data-cmd=${k}]`);
  const selectIds = (ids) => c.ev(`import('./js/annotate.js').then((A)=>import('./js/ui.js').then((m)=>{const d=m.store.active; A.setTool(d,'select'); A.selectIds(d, ${JSON.stringify(ids)}); m.bus.emit('doc-changed', d); return 1}))`);
  const setField = async (label, value, kind) => {
    const r = await c.ev(`(()=>{const row=[...document.querySelectorAll('#props .prop-row')].find(r=>r.querySelector('label').textContent===${JSON.stringify(label)}); if(!row) return 'absent'; const el=row.querySelector('input,select,textarea'); if(${JSON.stringify(kind)}==='bool'){el.checked=${JSON.stringify(!!value)};} else el.value=${JSON.stringify(String(value))}; el.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'})()`);
    await sleep(200); return r;
  };
  const propLabels = () => c.ev(`JSON.stringify([...document.querySelectorAll('#props .prop-row > label')].map(l=>l.textContent))`).then(JSON.parse);
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 15000);
    await sleep(900);
    await c.click('#rtab-forms'); await sleep(250);
    await c.click('#props-toggle'); await sleep(200);
    const cl = JSON.parse(await c.ev(CLICKABLE('#rpanel-forms')));
    check(`ruban « Formulaire » : ${cl.n} commandes, toutes cliquables`, cl.n >= 12 && cl.bad.length === 0, cl.bad);

    console.log('1. Tracé de chaque type (glisser, clic), outil persistant');
    await cmd('tool-field-text');
    await drag(0, [72, 722], [272, 700]);
    let F = await fields();
    check('champ texte tracé : « Texte1 », cadre (72 ; 700)–(272 ; 722) à 1 pt près', F.length === 1 && F[0].name === 'Texte1' && near(F[0].r, [72, 700, 272, 722], 1), F);
    check('outil persistant (toujours « Champ texte »)', (await doc('d.tool')) === 'field-text');
    await clickAt(0, 380, 711);
    F = await fields();
    check('clic simple : « Texte2 » à la taille par défaut (160 × 22 pt)', F.length === 2 && F[1].name === 'Texte2' && Math.abs((F[1].r[2] - F[1].r[0]) - 160) < 0.5 && Math.abs((F[1].r[3] - F[1].r[1]) - 22) < 0.5, F[1]);
    await cmd('tool-field-check'); await clickAt(0, 79, 650);
    await cmd('tool-field-radio'); await clickAt(0, 79, 600); await clickAt(0, 129, 600);
    await cmd('fld-radio-new'); await clickAt(0, 79, 560);
    await cmd('tool-field-combo'); await clickAt(0, 150, 500);
    await cmd('tool-field-list'); await drag(0, [300, 520], [440, 460]);
    await cmd('tool-field-date'); await clickAt(0, 120, 420);
    await cmd('tool-field-text'); await drag(1, [100, 300], [130, 500]); // page pivotée de 90°
    F = await fields();
    const names = F.map((f) => f.name + (f.export ? ':' + f.export : ''));
    check('10 champs : Case1, Groupe1 (Choix1, Choix2), Groupe2, Liste1, Choix1, Date1, Texte3', names.join() === 'Texte1,Texte2,Case1,Groupe1:Choix1,Groupe1:Choix2,Groupe2:Choix1,Liste1,Choix1,Date1,Texte3', names);
    check('bouton radio : la 1re option du groupe est choisie par défaut', F.find((f) => f.name === 'Groupe1' && f.export === 'Choix1').value === true && F.find((f) => f.export === 'Choix2').value === false);
    check('champ de la page pivotée : cadre exact (100 ; 300)–(130 ; 500) à 1 pt près', near(F[9].r, [100, 300, 130, 500], 1) && F[9].page === 1, F[9]);
    const txt = await c.ev(`(()=>{const g=[...document.querySelectorAll('.docview.active .page')][1].querySelector('.objs g[data-id="${F[9].id}"] text'); return g ? g.getAttribute('transform') || '' : null})()`);
    check('aperçu sur page pivotée : texte du champ tourné (droit à l\'écran)', txt !== null, txt);

    console.log('2. Propriétés : noms uniques, groupe, options, valeur par défaut');
    await selectIds([F[0].id]); await sleep(250);
    const labs = await propLabels();
    check('panneau : nom, infobulle, valeur par défaut, plusieurs lignes, obligatoire, lecture seule, visible, police, bordure…', ['Nom du champ', 'Infobulle', 'Valeur par défaut', 'Plusieurs lignes', 'Obligatoire', 'Lecture seule', 'Visible', 'Police', 'Bordure'].every((l) => labs.includes(l)), labs);
    await setField('Nom du champ', 'Nom'); await setField('Obligatoire', true, 'bool'); await setField('Valeur par défaut', 'Dupont');
    await selectIds([F[1].id]); await sleep(200);
    await setField('Nom du champ', 'Nom');
    F = await fields();
    check('renommage en « Nom » d\'un 2e champ refusé (nom déjà pris)', F[1].name === 'Texte2' && F[0].name === 'Nom' && F[0].required === true && F[0].value === 'Dupont', F.slice(0, 2));
    check('message d\'erreur affiché', /déjà utilisé/.test(await c.ev(`document.getElementById('toast').textContent`)));
    await selectIds([F[4].id]); await sleep(200);
    await setField('Nom du champ', 'Taille');
    F = await fields();
    check('renommage d\'un bouton radio : tout le groupe est renommé (Taille × 2)', F.filter((f) => f.name === 'Taille').length === 2 && !F.some((f) => f.name === 'Groupe1'));
    const combo = F.find((f) => f.name === 'Liste1');
    await selectIds([combo.id]); await sleep(200);
    await setField('Options (une par ligne)', 'France\nBelgique\nSuisse'); await setField('Valeur par défaut', 'Belgique');
    await setField('Valeur par défaut', 'Espagne');
    F = await fields();
    check('options saisies, valeur par défaut parmi les options (« Espagne » refusée)', JSON.stringify(F.find((f) => f.name === 'Liste1').options) === '["France","Belgique","Suisse"]' && F.find((f) => f.name === 'Liste1').value === 'Belgique', F.find((f) => f.name === 'Liste1'));

    console.log('3. Débordement du panneau Propriétés pour chaque type (largeur par défaut et minimale)');
    for (const ft of ['text', 'check', 'radio', 'combo', 'list', 'date']) {
      const f = F.find((x) => x.ftype === ft);
      await selectIds([f.id]); await sleep(150);
      for (const w of ['', '240px']) {
        await c.ev(`(()=>{document.getElementById('props').style.width='${w}'; return 1})()`); await sleep(60);
        const r = JSON.parse(await c.ev(OVERFLOW('#props')));
        check(`Propriétés « ${ft} » (${w || 'défaut'}) : ${r.n} éléments, aucun débordement`, r.n > 5 && r.bad.length === 0, r.bad.slice(0, 4));
      }
    }
    await c.ev(`(()=>{document.getElementById('props').style.width=''; return 1})()`);

    console.log('4. Duplication, annuler / rétablir, alignement');
    const nomId = F.find((f) => f.name === 'Nom').id;
    await selectIds([nomId]); await key('d', 'KeyD', 68, 2); await sleep(300);
    F = await fields();
    check('Ctrl+D : copie « Nom2 »', F.some((f) => f.name === 'Nom2'), F.map((f) => f.name));
    await selectIds([F.find((f) => f.name === 'Taille' && f.export === 'Choix1').id]); await key('d', 'KeyD', 68, 2); await sleep(300);
    F = await fields();
    check('Ctrl+D d\'un bouton radio : même groupe, option « Choix3 »', F.filter((f) => f.name === 'Taille').map((f) => f.export).sort().join() === 'Choix1,Choix2,Choix3', F.filter((f) => f.name === 'Taille'));
    await key('z', 'KeyZ', 90, 2); await sleep(300);
    check('Ctrl+Z : la copie du bouton radio disparaît', (await fields()).filter((f) => f.name === 'Taille').length === 2);
    await key('y', 'KeyY', 89, 2); await sleep(300);
    check('Ctrl+Y : elle revient', (await fields()).filter((f) => f.name === 'Taille').length === 3);
    await key('z', 'KeyZ', 90, 2); await sleep(300);
    F = await fields();
    const a = F.find((f) => f.name === 'Case1'), b = F.find((f) => f.name === 'Date1');
    await selectIds([a.id, b.id]); await sleep(150);
    await cmd('al-left'); await sleep(250);
    F = await fields();
    check('Aligner à gauche : Case1 et Date1 ont le même bord gauche', Math.abs(F.find((f) => f.name === 'Case1').r[0] - F.find((f) => f.name === 'Date1').r[0]) < 0.01, [F.find((f) => f.name === 'Case1').r, F.find((f) => f.name === 'Date1').r]);
    await key('z', 'KeyZ', 90, 2); await sleep(250);
    check('alignement annulable en une étape', Math.abs((await fields()).find((f) => f.name === 'Date1').r[0] - b.r[0]) < 0.01);

    console.log('5. Ordre de tabulation');
    await cmd('fld-order'); await sleep(300);
    const rows = await c.ev(`JSON.stringify([...document.querySelectorAll('#fldorder-list li .fo-t')].map(e=>e.textContent))`).then(JSON.parse);
    check('boîte : une ligne par champ, un groupe radio = une ligne (10 lignes), de haut en bas', rows.length === 10 && /^Nom/.test(rows[0]) && /^Texte2/.test(rows[1]), rows);
    const ov = JSON.parse(await c.ev(OVERFLOW('#fldorder .dialog')));
    check(`boîte « Ordre de tabulation » : aucun débordement (${ov.n})`, ov.bad.length === 0, ov.bad);
    const ck = JSON.parse(await c.ev(CLICKABLE('#fldorder')));
    check(`boîte « Ordre de tabulation » : ${ck.n} éléments cliquables`, ck.n >= 6 && ck.bad.length === 0, ck.bad);
    await c.click('#fldorder-list li:nth-child(2)'); await c.click('#fldorder-up'); await c.click('#fldorder-ok'); await sleep(300);
    const order = await c.ev(`import('./js/ui.js').then((m)=>JSON.stringify(window.Fields.tabOrder(m.store.active.edits).map(e=>e.name)))`).then(JSON.parse);
    check('« Texte2 » passe avant « Nom » (une étape d\'historique)', order[0] === 'Texte2' && order[1] === 'Nom', order);

    console.log('6. Prévisualiser / remplir');
    await cmd('fld-preview'); await sleep(500);
    const inputs = await c.ev(`JSON.stringify([...document.querySelectorAll('.docview.active .form-layer .ff')].map(e=>e.dataset.field))`).then(JSON.parse);
    check('calque de remplissage : un contrôle par widget, dans l\'ordre de tabulation (page 1 : Texte2 puis Nom)', inputs.length === 11 && inputs[0] === 'Texte2' && inputs[1] === 'Nom', inputs);
    check('valeur par défaut affichée (Nom = Dupont), obligatoire marqué', await c.ev(`(()=>{const e=document.querySelector('.form-layer .ff[data-field="Nom"]'); return e.value==='Dupont' && e.dataset.required==='1'})()`));
    await c.ev(`(()=>{document.querySelector('.form-layer .ff[data-field="Texte2"]').scrollIntoView({block:'center'}); return 1})()`); await sleep(200);
    await c.click('.form-layer .ff[data-field="Texte2"]'); await c.type('Bonjour'); await key('Tab', 'Tab', 9); await sleep(250);
    check('Tab : passe au champ suivant (Nom)', await c.ev(`document.activeElement && document.activeElement.dataset.field === 'Nom'`));
    check('saisie enregistrée dans le document (historique)', (await doc('d.form && d.form.values.Texte2')) === 'Bonjour');
    check('outils de création désactivés pendant la prévisualisation', await c.ev(`document.querySelector('#rpanel-forms [data-cmd=tool-field-text]').disabled`));
    await cmd('fld-preview'); await sleep(300);
    check('retour à la conception : calque retiré', (await c.ev(`document.querySelectorAll('.docview.active .form-layer').length`)) === 0);

    console.log('7. Enregistrement, relecture pdf.js, réouverture');
    await c.ev(`document.body.click()`); await key('s', 'KeyS', 83, 2); await sleep(2500);
    const saved = path.join(out, 'formulaire.pdf');
    check('fichier enregistré', fs.existsSync(saved));
    if (fs.existsSync(saved)) {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(saved)), verbosity: 0 }).promise;
      const an = []; for (let i = 1; i <= pdf.numPages; i++) an.push(await (await pdf.getPage(i)).getAnnotations());
      const W = an.flat().filter((x) => x.subtype === 'Widget');
      F = await fields();
      check('11 widgets relus (vrais champs AcroForm)', W.length === 11, W.map((x) => x.fieldName));
      const nom = W.find((x) => x.fieldName === 'Nom');
      check('« Nom » : texte, obligatoire, /DV Dupont, position ±0,2 mm', nom && nom.fieldType === 'Tx' && (nom.fieldFlags & 2) && nom.defaultFieldValue === 'Dupont' && near(nom.rect, F.find((f) => f.name === 'Nom').r), nom && [nom.fieldFlags, nom.defaultFieldValue, nom.rect]);
      check('« Texte2 » : valeur saisie en prévisualisation écrite', W.find((x) => x.fieldName === 'Texte2').fieldValue === 'Bonjour');
      const piv = an[1].find((x) => x.fieldName === 'Texte3');
      check('page pivotée : rectangle exact et /MK /R = 90', piv && near(piv.rect, F.find((f) => f.name === 'Texte3').r) && piv.rotation === 90, piv && [piv.rect, piv.rotation]);
      check('types : 3 boutons radio (Taille × 2, Groupe2), 1 case, 1 liste déroulante (3 options), 1 liste', W.filter((x) => x.radioButton).length === 3 && W.filter((x) => x.checkBox).length === 1 && W.filter((x) => x.combo).length === 1 && W.find((x) => x.combo).options.length === 3 && W.filter((x) => x.fieldType === 'Ch' && !x.combo).length === 1);
      await pdf.destroy();
      const copy = path.join(out, 'reouverture.pdf'); fs.copyFileSync(saved, copy); // même chemin = onglet déjà ouvert : on rouvre une copie
      await c.openMore(copy);
      await c.waitFor(`import('./js/ui.js').then((m)=>m.store.active && m.store.active.name==='reouverture.pdf' && (m.store.active.runtime.formFields||[]).length>0)`, 15000); await sleep(500);
      const n = await c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; return (d.runtime.formFields||[]).length})`);
      check('réouverture : les 11 widgets sont détectés comme champs remplissables (lot 3d)', n === 11, n);
      check('réouverture : calque de remplissage affiché, valeur « Bonjour » relue', await c.ev(`(()=>{const e=document.querySelector('.docview.active .form-layer .ff[data-field="Texte2"]'); return !!e && e.value==='Bonjour'})()`));
    }
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : champs de formulaire (interface).');
})();
