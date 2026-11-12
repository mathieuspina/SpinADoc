// Ruban : pour CHAQUE onglet, les étiquettes de groupe sont entièrement visibles (pas de rognage vertical), aucun bouton ne dépasse
// en bas, aucun libellé de bouton sur plus de deux lignes. Largeur par défaut, fenêtre de 700 px, zoom 150 %. Pilotage CDP, headless.
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

// Mesure de l'onglet affiché : zone visible = boîte de contenu du panneau (piste de défilement horizontal exclue), bornée par #ribbon.
const MEASURE = `(()=>{
  const p = document.querySelector('.rpanel:not([hidden])'); const rb = document.getElementById('ribbon').getBoundingClientRect();
  const pr = p.getBoundingClientRect(); const top = Math.max(pr.top + p.clientTop, rb.top); const bottom = Math.min(pr.top + p.clientTop + p.clientHeight, rb.bottom);
  const vis = (el) => el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
  const name = (el) => (el.getAttribute('data-cmd') || el.id || el.textContent.trim()).slice(0, 40);
  const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); const tops = new Set(); for (const q of r.getClientRects()) if (q.width > 0.5) tops.add(Math.round(q.top)); return tops.size; };
  const labels = [...p.querySelectorAll('.rgroup-label')].filter(vis).map((l) => { const r = l.getBoundingClientRect(); return { n: l.textContent.trim(), t: r.top, b: r.bottom, ok: r.top >= top - 0.5 && r.bottom <= bottom + 0.5 && l.scrollHeight <= l.clientHeight + 1 }; });
  const btns = [...p.querySelectorAll('.rbtn, .rgroup-body > button, .rgroup-body > label, .rgroup-body select, .rgroup-body input')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { n: name(b), b: r.bottom, ok: r.bottom <= bottom + 0.5 && r.top >= top - 0.5 }; });
  const lbls = [...p.querySelectorAll('.rbtn .lbl')].filter(vis).map((l) => ({ n: name(l.closest('.rbtn')), l: lines(l) }));
  return JSON.stringify({ id: p.id, top, bottom, vscroll: p.scrollHeight - p.clientHeight, labels, btns, lbls });
})()`;

(async () => {
  const f = await makeAll(path.join(os.tmpdir(), 'spinadoc-ui-pdfs'));
  const c = await launchApp({ files: [f.a] });
  const J = async (e) => JSON.parse(await c.ev(e));
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(700);
    const tabs = JSON.parse(await c.ev(`JSON.stringify([...document.querySelectorAll('#ribbon-tabs [role=tab]')].map(t=>t.id))`));
    check('7 onglets de ruban trouvés', tabs.length === 7, tabs);
    for (const [w, h, dsf, label] of [[1280, 860, 1, 'largeur par défaut'], [700, 500, 1, '700 px'], [853, 573, 1.5, 'zoom 150 %']]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: false }); await sleep(300);
      for (const t of tabs) {
        await c.click('#' + t); await sleep(250);
        const m = await J(MEASURE);
        const badL = m.labels.filter((x) => !x.ok); const badB = m.btns.filter((x) => !x.ok); const badT = m.lbls.filter((x) => x.l > 2);
        const where = `${t.replace('rtab-', '')} à ${label}`;
        check(`${where} : étiquettes de groupe entières (${m.labels.length})`, m.labels.length > 0 && !badL.length && m.vscroll <= 0, { badL, vscroll: m.vscroll, top: m.top, bottom: m.bottom });
        check(`${where} : aucun bouton ne dépasse en bas (${m.btns.length})`, !badB.length, { badB, bottom: m.bottom });
        check(`${where} : aucun libellé sur plus de deux lignes`, !badT.length, badT);
      }
    }
    await c.send('Emulation.clearDeviceMetricsOverride');
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
})();
