// Impression RÉELLE vers l'imprimante virtuelle « SpinADoc Test PDF » (port fichier C:\Temp\SpinADocPrintTest\sortie.pdf), puis mesure du
// résultat avec pdf.js (taille de feuille, trait de 100 mm, position). Envoie UNIQUEMENT à cette imprimante : le garde-fou
// SPINADOC_PRINT_ALLOW la rend la seule imprimante visible ET refuse toute autre en main.js. Fenêtre cachée.
// Mesure aussi le temps et la mémoire (processus Electron) sur un A1. Usage : node test/test-print-real.js [--sans-a1]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const PDFLib = require('@cantoo/pdf-lib');
const { launchApp, sleep } = require('./lib/app.js');

const PRINTER = 'SpinADoc Test PDF';
const SORTIE = 'C:\\Temp\\SpinADocPrintTest\\sortie.pdf';
const MM = 72 / 25.4;
const failures = [];
let passed = 0;
const rows = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failures.push(name); console.log('  ECHEC', name, detail !== undefined ? '→ ' + JSON.stringify(detail) : ''); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function renderDark(file, dpi) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const vp0 = page.getViewport({ scale: dpi / 72 });
  const W = Math.ceil(vp0.width), H = Math.ceil(vp0.height);
  const cc = doc.canvasFactory.create(W, H);
  cc.context.fillStyle = '#fff'; cc.context.fillRect(0, 0, W, H);
  await page.render({ canvasContext: cc.context, viewport: vp0, canvasFactory: doc.canvasFactory }).promise;
  const img = cc.context.getImageData(0, 0, W, H);
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (img.data[(y * W + x) * 4] < 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  const k = 25.4 / dpi;
  return { pw: page.view[2] * 25.4 / 72, ph: page.view[3] * 25.4 / 72, w: (x1 - x0 + 1) * k, h: (y1 - y0 + 1) * k, x: x0 * k, y: y0 * k, pages: doc.numPages };
}
function mkSource(file, wmm, hmm) {
  return (async () => {
    const d = await PDFLib.PDFDocument.create();
    const p = d.addPage([wmm * MM, hmm * MM]);
    const top = (y) => (hmm - y) * MM;
    p.drawLine({ start: { x: 20 * MM, y: top(30) }, end: { x: 120 * MM, y: top(30) }, thickness: 0.3 * MM });
    p.drawLine({ start: { x: 20 * MM, y: top(30) }, end: { x: 20 * MM, y: top(130) }, thickness: 0.3 * MM });
    fs.writeFileSync(file, await d.save());
  })();
}
const electronMem = () => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-Process -Name electron -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum"], { encoding: 'utf8' });
  return Number((r.stdout || '').trim()) || 0;
};
async function waitSortie(t0, timeoutMs) {
  let last = -1, same = 0;
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await sleep(500);
    let st = null;
    try { st = fs.statSync(SORTIE); } catch { continue; }
    if (st.mtimeMs < t0) continue;
    if (st.size > 0 && st.size === last) { if (++same >= 4) return st.size; } else { same = 0; last = st.size; }
  }
  throw new Error('sortie.pdf non écrit ou instable');
}

(async () => {
  const printers = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-Printer -Name '" + PRINTER + "' -ErrorAction SilentlyContinue).Name"], { encoding: 'utf8' }).stdout.trim();
  if (printers !== PRINTER) { console.log('SKIP : imprimante virtuelle « ' + PRINTER + ' » absente.'); process.exit(0); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spinadoc-real-'));
  const skipA1 = process.argv.includes('--sans-a1');
  const src = { A4: [210, 297], A3: [297, 420], A1: [594, 841] };
  for (const [n, [w, h]] of Object.entries(src)) await mkSource(path.join(dir, n + '.pdf'), w, h);

  const c = await launchApp({ files: [path.join(dir, 'A4.pdf')], env: { SPINADOC_PRINT_ALLOW: PRINTER } });
  try {
    await c.waitFor(`document.querySelectorAll('.docview.active canvas').length>0`);
    await sleep(800);
    const setv = (id, v) => c.ev(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const txt = (id) => c.ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
    const key = (k, code, vk, mods = 0) => c.key(k, { code, windowsVirtualKeyCode: vk, modifiers: mods });
    const openDoc = async (n) => { await c.openMore(path.join(dir, n + '.pdf')); await sleep(1500); };
    const paperOpt = (prefix) => c.ev(`(()=>{const o=[...document.getElementById('pr-paper').options].find(o=>${JSON.stringify(prefix)}==='page'?o.value==='page':o.textContent.startsWith(${JSON.stringify(prefix)}));return o?o.value:null})()`);
    const sq = { x: 19.85, y: 29.85, w: 100.3, h: 100.3 };

    // un cas : ouvre la boîte, règle, imprime, attend le fichier, mesure
    async function run(label, doc, o, expect) {
      await openDoc(doc);
      await c.ev(`document.body.click()`);
      await key('p', 'KeyP', 80, 2); await sleep(2500);
      const printerList = await c.ev(`[...document.getElementById('pr-printer').options].map(o=>o.value).join('|')`);
      if (printerList !== PRINTER) throw new Error('garde-fou : liste d\'imprimantes inattendue : ' + printerList);
      const pv = await paperOpt(o.paper);
      if (!pv) throw new Error('papier introuvable : ' + o.paper);
      await setv('pr-paper', pv); await setv('pr-scale', o.mode || 'actual'); if (o.percent) await setv('pr-percent', String(o.percent));
      await setv('pr-color', o.color || 'color'); await setv('pr-dpi', String(o.dpi || 300)); await setv('pr-margin', '0');
      await sleep(900);
      try { fs.unlinkSync(SORTIE); } catch { /* absent */ }
      const t0 = Date.now() - 500;
      const m0 = electronMem();
      let peak = m0;
      const timer = setInterval(() => { peak = Math.max(peak, electronMem()); }, 1500);
      const T = Date.now();
      await c.click('#pr-ok');
      const size = await waitSortie(t0, 300000);
      const secs = (Date.now() - T) / 1000;
      clearInterval(timer);
      await c.waitFor(`document.getElementById('printdlg').hidden`, 90000).catch(() => {});
      const copy = path.join(dir, 'sortie-' + label.replace(/\W+/g, '_') + '.pdf');
      fs.copyFileSync(SORTIE, copy);
      const r = await renderDark(copy, o.measureDpi || 300);
      const e = expect ? expect(r) : { pw: r.pw, ph: r.ph, w: r.w, h: r.h, x: r.x, y: r.y };
      const tolSize = 0.6, tolPos = 1;
      const ok = near(r.pw, e.pw, tolSize) && near(r.ph, e.ph, tolSize) && near(r.w, e.w, tolSize) && near(r.h, e.h, tolSize) && near(r.x, e.x, tolPos) && near(r.y, e.y, tolPos) && r.pages === 1;
      rows.push({ label, pw: r.pw, ph: r.ph, w: r.w, h: r.h, dx: r.x - e.x, dy: r.y - e.y, kb: Math.round(size / 1024), secs, peakMb: Math.round((peak - m0) / 1048576) });
      check(`${label} : feuille ${r.pw.toFixed(1)}×${r.ph.toFixed(1)} mm, tracé ${r.w.toFixed(2)}×${r.h.toFixed(2)} mm, écart (${(r.x - e.x).toFixed(2)} ; ${(r.y - e.y).toFixed(2)}) mm, ${Math.round(size / 1024)} Ko, ${secs.toFixed(1)} s`, ok, { r, e });
      await sleep(500);
    }

    console.log('Impression réelle vers « ' + PRINTER + ' »');
    await run('A4 sur A4, taille réelle', 'A4', { paper: 'page' }, () => ({ pw: 210, ph: 297, w: sq.w, h: sq.h, x: sq.x, y: sq.y }));
    await run('A4 sur A3, taille réelle', 'A4', { paper: 'A3' }, () => ({ pw: 297, ph: 420, w: sq.w, h: sq.h, x: sq.x + 43.5, y: sq.y + 61.5 }));
    await run('A3 sur A3, taille réelle', 'A3', { paper: 'page' }, () => ({ pw: 297, ph: 420, w: sq.w, h: sq.h, x: sq.x, y: sq.y }));
    if (!skipA1) {
      await run('A1 sur A1 (vectoriel), taille réelle', 'A1', { paper: 'page' }, () => ({ pw: 594, ph: 841, w: sq.w, h: sq.h, x: sq.x, y: sq.y }));
      const k = Math.min(297 / 594, 420 / 841);
      await run('A1 sur A3, ajusté (vectoriel)', 'A1', { paper: 'A3', mode: 'fit' }, () => {
        const w = 594 * k, h = 841 * k, ox = (297 - w) / 2, oy = (420 - h) / 2;
        return { pw: 297, ph: 420, w: sq.w * k, h: sq.h * k, x: ox + sq.x * k, y: oy + sq.y * k };
      });
      await run('A1 sur A1, noir et blanc 600 dpi (rasterisé)', 'A1', { paper: 'page', color: 'bw', dpi: 600, measureDpi: 300 }, () => ({ pw: 594, ph: 841, w: sq.w, h: sq.h, x: sq.x, y: sq.y }));
    }
    if (process.argv.includes('--dense')) { // A1 dense (40 000 traits fins + 600 libellés) : durée, mémoire et taille uniquement
      const d = await PDFLib.PDFDocument.create();
      const p = d.addPage([594 * MM, 841 * MM]);
      const font = await d.embedFont(PDFLib.StandardFonts.Helvetica);
      let seed = 12345;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let i = 0; i < 40000; i++) { const x = rnd() * 594 * MM, y = rnd() * 841 * MM; p.drawLine({ start: { x, y }, end: { x: x + (rnd() - 0.5) * 60 * MM, y: y + (rnd() - 0.5) * 60 * MM }, thickness: 0.1 * MM }); }
      for (let i = 0; i < 600; i++) p.drawText('Cote ' + i, { x: rnd() * 550 * MM, y: rnd() * 800 * MM, size: 8, font });
      fs.writeFileSync(path.join(dir, 'DENSE.pdf'), await d.save());
      await run('A1 dense, vectoriel, taille réelle', 'DENSE', { paper: 'page', measureDpi: 72 }, null);
      await run('A1 dense, noir et blanc 600 dpi (rasterisé)', 'DENSE', { paper: 'page', color: 'bw', dpi: 600, measureDpi: 72 }, null);
    }
    console.log('\nTableau des mesures :');
    console.log('| Cas | Feuille (mm) | Tracé (mm) | Écart x ; y (mm) | Taille | Durée | Mémoire pic (Electron) |');
    for (const r of rows) console.log(`| ${r.label} | ${r.pw.toFixed(1)} × ${r.ph.toFixed(1)} | ${r.w.toFixed(2)} × ${r.h.toFixed(2)} | ${r.dx.toFixed(2)} ; ${r.dy.toFixed(2)} | ${r.kb} Ko | ${r.secs.toFixed(1)} s | +${r.peakMb} Mo |`);
    check('aucune erreur JavaScript', c.logs.length === 0, c.logs);
  } catch (e) {
    check('exécution sans exception', false, String(e && e.stack || e));
  } finally {
    await c.close();
  }
  console.log(`\n${passed} vérifications réussies, ${failures.length} échec(s).`);
  if (failures.length) { console.log('Échecs :\n - ' + failures.join('\n - ')); process.exit(1); }
  console.log('OK : impression réelle (imprimante virtuelle).');
})();
