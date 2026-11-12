// Mise en page du panneau Propriétés (interface, hors écran) : pour CHAQUE type d'objet, à la largeur par défaut et à la largeur
// minimale du panneau : aucun débordement horizontal, chaque contrôle entièrement dans le panneau, aucune unité seule sur une ligne,
// aucun libellé rogné (test/lib/overflow.js). Redimensionnement du panneau par son bord gauche (bornes, mémorisation).
// Même contrôle sur les panneaux Mesures, Caviarder (recherche, boîtes Appliquer et Métadonnées), Comparer et OCR.
// Usage : node test/test-props-layout-ui.js
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');
const { SCRIPT } = require('./lib/overflow.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}

// Outil → type d'objet affiché (le panneau montre les réglages de l'outil actif pour la prochaine création).
const TOOLS = [
  ['add', 'texte'], ['note', 'note'], ['replace', 'texte modifié'], ['stamp', 'tampon'], ['image', 'image'], ['signature', 'signature'],
  ['line', 'ligne'], ['arrow', 'flèche'], ['rect', 'rectangle'], ['ellipse', 'ellipse'], ['polygon', 'polygone'], ['polyline', 'polyligne'],
  ['cloud', 'nuage'], ['pen', 'crayon'], ['hlrect', 'surlignage'], ['highlight', 'surlignage du texte'], ['underline', 'soulignement'],
  ['strike', 'texte barré'], ['m-dist', 'mesure distance'], ['m-poly', 'mesure polyligne'], ['m-area', 'mesure surface'],
  ['m-angle', 'mesure angle'], ['m-dim', 'cote'], ['m-circle', 'mesure cercle'], ['callout', 'légende'], ['redact', 'zone de caviardage'],
  ['field-text', 'champ texte'], ['field-check', 'case à cocher'], ['field-radio', 'bouton radio'], ['field-combo', 'liste déroulante'],
  ['field-list', 'liste'], ['field-date', 'champ de date'],
];

(async () => {
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const c = await launchApp({ files: [f.a] });
  const overflow = async (label, scope) => {
    const r = JSON.parse(await c.ev(SCRIPT(scope)));
    check(`${label} : ${r.n} éléments, aucun débordement`, r.n > 0 && r.bad.length === 0, r.bad.length ? r.bad.slice(0, 5) : r);
    return r;
  };
  const setTool = (t) => c.ev(`import('./js/annotate.js').then((A)=>import('./js/ui.js').then((m)=>{A.setTool(m.store.active, ${JSON.stringify(t)}); return 1}))`);
  const width = () => c.ev(`Math.round(document.getElementById('props').getBoundingClientRect().width)`);
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 15000);
    await sleep(800);
    await c.click('#props-toggle'); await sleep(300);
    await setTool('callout'); await sleep(100); // le panneau n'est visible qu'avec un outil actif ou une sélection
    const MIN = await c.ev(`parseFloat(getComputedStyle(document.getElementById('props')).minWidth) || 240`);
    const DEF = await width();
    console.log(`Largeurs : défaut ${DEF} px, minimale ${MIN} px`);

    console.log('1. Panneau Propriétés : chaque type d\'objet, largeur par défaut puis minimale');
    for (const [w, wl] of [[null, 'défaut'], [MIN, 'minimale']]) {
      await c.ev(`(()=>{document.getElementById('props').style.width=${w ? `'${w}px'` : `''`}; return 1})()`);
      for (const [t, label] of TOOLS) {
        await setTool(t); await sleep(60);
        const open = await c.ev(`!document.getElementById('props').hidden && document.querySelectorAll('#props-body > *').length>0`);
        if (!open) { check(`${label} (largeur ${wl}) : panneau ouvert`, false); continue; }
        await overflow(`${label}, largeur ${wl}`, '#props');
      }
    }
    await c.ev(`(()=>{document.getElementById('props').style.width=''; return 1})()`);
    await setTool('callout'); await sleep(60);

    console.log('2. Libellés et unités du panneau Propriétés (légende)');
    const pct = await c.ev(`(()=>{const s=[...document.querySelectorAll('#props .prop-ctl .muted')].find(e=>/%/.test(e.textContent)); return s ? s.textContent : null})()`);
    check('« 100 % » : espace insécable entre le nombre et l\'unité', !!pct && /\d[  ]%/.test(pct), pct);
    const none = await c.ev(`JSON.stringify([...document.querySelectorAll('#props .chk')].map(e=>[e.textContent.trim(), e.scrollWidth<=e.clientWidth+1]))`).then(JSON.parse);
    check('cases « Aucun » entières (Fond, Bordure)', none.length >= 2 && none.every(([, ok]) => ok), none);

    const heads = await c.ev(`JSON.stringify([...document.querySelectorAll('#props-body h3')].map(h=>h.textContent))`).then(JSON.parse);
    check('chaque rubrique (Aspect, Texte) n\'apparaît qu\'une fois', heads.length === new Set(heads).size && heads.length === 2, heads);

    console.log('3. Redimensionnement par le bord gauche');
    const grip = await c.ev(`(()=>{const g=document.getElementById('props-resize'); if(!g) return null; const r=g.getBoundingClientRect(); return JSON.stringify([r.left+r.width/2, r.top+r.height/2])})()`);
    check('poignée de redimensionnement présente', !!grip);
    if (grip) {
      const [gx, gy] = JSON.parse(grip);
      const drag = async (dx) => {
        await c.mouse('mouseMoved', gx, gy); await c.mouse('mousePressed', gx, gy);
        for (let i = 1; i <= 5; i++) { await c.mouse('mouseMoved', gx + (dx * i) / 5, gy); await sleep(15); }
        await c.mouse('mouseReleased', gx + dx, gy); await sleep(200);
      };
      await drag(-120);
      const w1 = await width();
      check('glisser de 120 px vers la gauche élargit le panneau de 120 px', Math.abs(w1 - (DEF + 120)) <= 2, { DEF, w1 });
      await overflow('légende, panneau élargi', '#props');
      const saved = await c.ev(`import('./js/settings.js').then((S)=>S.get('propsWidth'))`);
      check('largeur mémorisée dans les réglages', Math.abs(saved - w1) <= 2, saved);
      const g2 = JSON.parse(await c.ev(`(()=>{const r=document.getElementById('props-resize').getBoundingClientRect(); return JSON.stringify([r.left+r.width/2, r.top+r.height/2])})()`));
      await c.mouse('mouseMoved', g2[0], g2[1]); await c.mouse('mousePressed', g2[0], g2[1]);
      await c.mouse('mouseMoved', g2[0] + 600, g2[1]); await c.mouse('mouseReleased', g2[0] + 600, g2[1]); await sleep(200);
      check('borné à la largeur minimale', (await width()) === Math.round(MIN), await width());
      const g3 = JSON.parse(await c.ev(`(()=>{const r=document.getElementById('props-resize').getBoundingClientRect(); return JSON.stringify([r.left+r.width/2, r.top+r.height/2])})()`));
      await c.mouse('mouseMoved', g3[0], g3[1]); await c.mouse('mousePressed', g3[0], g3[1]);
      await c.mouse('mouseMoved', g3[0] - 2000, g3[1]); await c.mouse('mouseReleased', g3[0] - 2000, g3[1]); await sleep(200);
      const MAX = await c.ev(`parseFloat(getComputedStyle(document.getElementById('props')).maxWidth)`);
      check('borné à la largeur maximale', MAX > MIN && (await width()) <= MAX + 1, { w: await width(), MAX });
      check('double-clic sur la poignée : largeur par défaut', await c.ev(`(()=>{document.getElementById('props-resize').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return Math.round(document.getElementById('props').getBoundingClientRect().width)})()`) === DEF);
    }
    await setTool('select');

    console.log('4. Autres panneaux : Mesures, Caviarder, Comparer, OCR');
    await c.ev(`import('./js/ui.js').then((m)=>{const d=m.store.active; window.DocModel.addEdits(d, [{type:'m-dist', page:0, points:[[100,300],[383.46,300]], label:'Longueur de la façade nord du bâtiment principal'}, {type:'m-area', page:0, points:[[100,300],[200,300],[200,400],[100,400]]}, {type:'m-angle', page:0, points:[[100,300],[200,300],[200,400]]}]); m.bus.emit('doc-changed', d); return 1})`);
    await c.ev(`(()=>{const s=document.getElementById('sidebar'); if(s.hidden) document.getElementById('sb-corner').click(); return 1})()`); await sleep(300);
    await c.click('#sbtab-measures'); await sleep(400);
    check('panneau Mesures : 3 lignes de mesures affichées', (await c.ev(`document.querySelectorAll('#sb-measures tr.m-row').length`)) === 3);
    await overflow('panneau Mesures (3 mesures)', '#sidebar');
    await c.click('#rtab-document'); await c.click('#rpanel-document [data-cmd=rdx-find]'); await sleep(300);
    await c.ev(`(()=>{const q=document.getElementById('rdx-q'); q.value='Doc'; return 1})()`); await c.click('#rdx-search'); await sleep(1500);
    await overflow('Caviarder : panneau « Rechercher et caviarder » (avec résultats)', '#rdx-find');
    await c.click('#rdx-close'); await sleep(200);
    await c.click('#rpanel-document [data-cmd=rdx-meta]'); await sleep(500);
    await overflow('Caviarder : boîte « Nettoyer les métadonnées »', '#rdx-meta');
    await c.click('#rdx-meta-cancel'); await sleep(200);
    await c.ev(`(()=>{document.getElementById('rdx-apply').hidden=false; return 1})()`); await sleep(150);
    await overflow('Caviarder : boîte « Appliquer le caviardage »', '#rdx-apply');
    await c.ev(`(()=>{document.getElementById('rdx-apply').hidden=true; return 1})()`);
    await c.click('#rtab-document'); await c.click('#rpanel-document [data-cmd=doc-ocr]'); await sleep(600);
    await overflow('boîte OCR', '#pgdlg');
    await c.click('#pgdlg-cancel'); await sleep(300);
    await c.ev(`(()=>{document.getElementById('fldorder').hidden=false; document.getElementById('fldorder-list').innerHTML='<li role="option"><span class="fo-n">1</span><span class="fo-t">Nom_de_champ_tres_long_sans_espace_pour_tester_le_retour_a_la_ligne — champ texte</span><span class="fo-p muted">p. 12</span></li>'; return 1})()`); await sleep(150);
    await overflow('Formulaire : boîte « Ordre de tabulation » (nom très long)', '#fldorder .dialog');
    await c.ev(`(()=>{document.getElementById('fldorder').hidden=true; return 1})()`);
    await c.click('#btn-help'); await sleep(300); await overflow('Aide intégrée (vue complète)', '#helpws'); await c.click('#help-close'); await sleep(150);
    await c.click('#btn-settings'); await sleep(200); await c.click('#btn-about'); await sleep(400); await overflow('À propos (version, hors-ligne, diagnostic, licences)', '#about .dialog'); await c.click('#about-close'); await sleep(150);
    await c.click('#btn-settings'); await sleep(200); await c.click('#btn-winint'); await sleep(200); await overflow('Intégration à Windows (lecteur PDF)', '#winint .dialog'); await c.click('#winint-close'); await sleep(150);
    await c.ev(`(()=>{document.getElementById('fldorder').hidden=true; return 1})()`);
    await c.click('#rtab-document'); await c.click('#rpanel-document [data-cmd=doc-compare]'); await sleep(900);
    await overflow('Comparer : espace complet', '#cmpws');
    for (const m of ['side', 'fade']) { await c.click('#cmp-m-' + m); await sleep(200); await overflow('Comparer : mode ' + m, '#cmpws'); }
    await c.click('#cmp-close'); await sleep(300);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : mise en page des panneaux.');
})();
