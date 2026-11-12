// Aide intégrée, À propos, diagnostic, hors-ligne (interface, hors écran) : F1 et bouton Aide, sommaire (chaque lien mène à sa rubrique), liens
// internes, recherche (filtre, aucun résultat, Échap), Échap ferme ; À propos (version, droits, mention hors-ligne, licences) ; diagnostic sans
// chemin, nom de fichier ni nom d'utilisateur ; AUCUNE requête réseau (garde du processus principal + domaine Network de CDP) ; débordement
// et cliquabilité de l'aide et de À propos.
// Usage : node test/test-help-ui.js
const os = require('os');
const path = require('path');
const { launchApp, sleep } = require('./lib/app.js');
const { makeAll } = require('./lib/make-pdfs.js');
const { SCRIPT: OVERFLOW } = require('./lib/overflow.js');
const { SCRIPT: CLICKABLE } = require('./lib/clickable.js');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail).slice(0, 400) : ''); }
}

(async () => {
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const c = await launchApp({ files: [f.a] });
  const requests = [];
  try {
    await c.send('Network.enable');
    c.send('Runtime.evaluate', { expression: '1' });
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`, 15000);
    await sleep(800);
    // requêtes vues par CDP (renderer) : relevées à la fin via Performance (ressources chargées)
    console.log('1. Aide : F1, sommaire, liens, recherche');
    await c.key('F1', { code: 'F1', windowsVirtualKeyCode: 112 }); await sleep(300);
    check('F1 ouvre l\'aide', await c.ev(`!document.getElementById('helpws').hidden`));
    const n = await c.ev(`document.querySelectorAll('#help-body .help-sec').length`);
    const links = await c.ev(`JSON.stringify([...document.querySelectorAll('#help-nav a')].map(a=>a.getAttribute('href')))`).then(JSON.parse);
    check(`sommaire : un lien par rubrique (${n} rubriques)`, n >= 15 && links.length === n);
    const topics = ['demarrer', 'texte', 'annotations', 'mesure', 'pages', 'fusion', 'impression', 'comparer', 'ocr', 'formulaires', 'caviardage', 'document', 'raccourcis', 'limites', 'informatique', 'confidentialite', 'ruban', 'smartscreen'];
    check('raccourcis : aucune touche vide (« Ctrl+Maj++ » affiche la touche +)', (await c.ev(`document.querySelectorAll('#help-body kbd:empty').length`)) === 0);
    check('rubriques demandées toutes présentes', topics.every((t) => links.includes('#aide-' + t)), links);
    await sleep(200);
    const hv = await c.ev(`document.getElementById('help-version').textContent`);
    check('version affichée dans l\'aide = package.json (lue par app.getVersion, pas en dur)', hv === 'Version ' + require('../package.json').version, hv);
    const lim = await c.ev(`document.getElementById('aide-limites').textContent`);
    check('limites : réouverture, champs figés, page pivotée, échelle, OCR (manuscrit, fond bruité, « ? »), caviardage', ['réouverture', 'figés', 'pivotée', 'échelle', 'manuscrite', 'bruité', 'couche de texte invisible', 'autre lecteur'].every((w) => lim.includes(w)), lim);
    const ss = await c.ev(`document.getElementById('aide-smartscreen').textContent`);
    check('avertissement SmartScreen : non signé, « Exécuter quand même », Get-FileHash', /pas signé/.test(ss) && /Exécuter quand même/.test(ss) && ss.includes('Get-FileHash .\\SpinADoc-Setup-'), ss);
    let bad = [];
    for (const href of links) {
      await c.ev(`(()=>{document.querySelector('#help-nav a[href="${href}"]').scrollIntoView({block:'nearest'}); return 1})()`);
      await c.click(`#help-nav a[href="${href}"]`); await sleep(80);
      const ok = await c.ev(`(()=>{const s=document.querySelector(${JSON.stringify(href)}); const b=document.getElementById('help-body').getBoundingClientRect(); const r=s.getBoundingClientRect(); return !s.hidden && Math.abs(r.top-b.top) < 30 || (b.bottom - r.top > 0 && document.getElementById('help-body').scrollTop + document.getElementById('help-body').clientHeight >= document.getElementById('help-body').scrollHeight - 2)})()`);
      if (!ok) bad.push(href);
    }
    check('chaque lien du sommaire amène sa rubrique en haut de la vue', bad.length === 0, bad);
    check('aucune navigation de la fenêtre (adresse inchangée)', /index\.html$/.test(await c.ev('location.pathname')));
    await c.ev(`(()=>{document.querySelector('#aide-texte a[href="#aide-caviardage"]').click(); return 1})()`); await sleep(100);
    check('lien interne (texte → caviardage)', await c.ev(`Math.abs(document.getElementById('aide-caviardage').getBoundingClientRect().top - document.getElementById('help-body').getBoundingClientRect().top) < 30`));
    const search = async (q) => { await c.ev(`(()=>{const i=document.getElementById('help-q'); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return 1})()`); await sleep(80); return c.ev(`JSON.stringify([...document.querySelectorAll('#help-body .help-sec')].filter(s=>!s.hidden).map(s=>s.dataset.id))`).then(JSON.parse); };
    let r = await search('echelle calibrer');
    check('recherche « echelle calibrer » (sans accents) : rubrique Mesure', r.includes('mesure') && r.length < n, r);
    r = await search('Ctrl+D');
    check('recherche d\'un raccourci « Ctrl+D » : table des raccourcis', r.includes('raccourcis'), r);
    r = await search('caviarder');
    check('recherche d\'une commande déplacée : la rubrique « Où sont les commandes ? » répond', r.includes('ruban'), r);
    r = await search('zzzqqq');
    check('aucun résultat : message', r.length === 0 && /Aucune rubrique/.test(await c.ev(`document.getElementById('help-count').textContent`)));
    await c.click('#help-q'); await c.key('Escape', { code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(100);
    check('Échap (avec recherche) : la recherche est effacée, l\'aide reste ouverte', (await c.ev(`document.getElementById('help-q').value`)) === '' && await c.ev(`!document.getElementById('helpws').hidden`));
    const ck = JSON.parse(await c.ev(CLICKABLE('#helpws')));
    check(`aide : ${ck.n} éléments cliquables`, ck.n >= 18 && ck.bad.length === 0, ck.bad.slice(0, 4));
    const ov = JSON.parse(await c.ev(OVERFLOW('#helpws')));
    check(`aide : aucun débordement (${ov.n} éléments)`, ov.bad.length === 0, ov.bad.slice(0, 4));
    await c.key('Escape', { code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(150);
    check('Échap ferme l\'aide', await c.ev(`document.getElementById('helpws').hidden`));
    await c.click('#btn-help'); await sleep(200);
    check('bouton « Aide » ouvre l\'aide', await c.ev(`!document.getElementById('helpws').hidden`));
    await c.click('#help-close'); await sleep(150);

    console.log('2. À propos et diagnostic');
    await c.click('#btn-settings'); await sleep(250); await c.click('#btn-about'); await sleep(400);
    const ab = await c.ev(`JSON.stringify({v:document.getElementById('about-version').textContent, c:document.getElementById('about-copyright').textContent, o:document.getElementById('about-offline').textContent, l:document.getElementById('about-licenses').textContent.length})`).then(JSON.parse);
    check('À propos : version, mention « Tous droits réservés », « 100 % hors-ligne », licences tierces', ab.v.includes(require('../package.json').version) && /Tous droits réservés/.test(ab.c) && /100 % hors-ligne, aucune donnée envoyée/.test(ab.o) && ab.l > 1000, ab);
    const ck2 = JSON.parse(await c.ev(CLICKABLE('#about')));
    const ov2 = JSON.parse(await c.ev(OVERFLOW('#about .dialog')));
    check(`À propos : cliquable (${ck2.n}) et sans débordement`, ck2.bad.length === 0 && ov2.bad.length === 0, [ck2.bad, ov2.bad].map((x) => x.slice(0, 3)));
    await c.click('#about-diag'); await sleep(800);
    check('« Copier les informations de diagnostic » : confirmation', /Copié/.test(await c.ev(`document.getElementById('about-diag-msg').textContent`)));
    const diag = await c.ev(`window.spinadoc.diagnostic()`);
    check('diagnostic : version, système, mémoire, écrans, imprimantes', /Version :/.test(diag) && /Système :/.test(diag) && /Mémoire :/.test(diag) && /écran 1 : \d+ × \d+ px, mise à l'échelle \d+ %/.test(diag) && /Imprimantes \(\d+\)/.test(diag), diag);
    const user = os.userInfo().username;
    const leaks = [[/[A-Za-z]:\\/, 'chemin Windows'], [/\\\\/, 'chemin réseau'], [/\/(Users|home|tmp)\//i, 'chemin'], [/\.pdf\b/i, 'nom de fichier PDF'], [new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'nom d\'utilisateur'], [/a-huit-pages|spinadoc-ui-pdfs/i, 'nom du fichier ouvert']].filter(([re]) => re.test(diag)).map(([, w]) => w);
    check('diagnostic : aucun chemin, nom de fichier ni nom d\'utilisateur', leaks.length === 0, leaks);
    await c.click('#about-close'); await sleep(150);

    console.log('3. Hors-ligne');
    const net = await c.ev(`window.spinadoc.netStats()`);
    check('garde réseau du processus principal : 0 requête réseau tentée', net.blocked === 0, net);
    const res = await c.ev(`JSON.stringify(performance.getEntriesByType('resource').map(e=>e.name).filter(u=>!/^(file|data|blob|devtools):/.test(u)))`).then(JSON.parse);
    check('renderer : aucune ressource chargée hors fichiers locaux', res.length === 0, res);
    const blocked = await c.ev(`fetch('https://example.com/').then(()=>'passé', (e)=>'bloqué')`);
    const net2 = await c.ev(`window.spinadoc.netStats()`);
    check('une requête volontaire vers Internet est bloquée (CSP et garde), et la garde reste à 0 si la CSP l\'arrête avant', blocked === 'bloqué' && net2.blocked <= 1, [blocked, net2]);
    check('aucune erreur JavaScript', c.logs.filter((l) => !/example\.com|Content Security Policy|Failed to fetch/i.test(l)).length === 0, c.logs.slice(0, 3));
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  void requests;
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : aide, À propos, diagnostic, hors-ligne.');
})();
