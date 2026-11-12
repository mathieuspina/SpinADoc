// Mesure OCR (développement) : qualité / vitesse de deux jeux de données de langue (best_int embarqué, « standard » 4.0.0) sur une page de texte
// scannée simulée (A4, 300 dpi, bruit, légère inclinaison) et un plan simulé (cotes, petits textes dispersés, texte pivoté).
// Usage : node scripts/ocr-bench.js
const path = require('path');
const { launchApp } = require('../test/lib/app.js');
const nm = (p) => 'file:///' + path.join(__dirname, '..', 'node_modules', p).split(path.sep).join('/') + '/';
(async () => {
  const c = await launchApp({ files: [] });
  try {
    await c.waitFor("document.getElementById('welcome')", 15000);
    const r = await c.ev(`(async()=>{
      const T = (await import('../vendor/tesseract/tesseract.esm.min.js')).default;
      const base = (p) => new URL(p, location.href).href;
      const FR = ['La poutre principale repose sur deux poteaux en béton armé.', 'Les charges permanentes et les charges d exploitation sont cumulées.', 'Vérifier la flèche maximale admissible avant livraison.', 'The secondary beams are connected by bolted plates.', 'Contact : bureau d études structure, indice B du chantier.'];
      const noisy = (cv, amt) => { const x = cv.getContext('2d'); const d = x.getImageData(0, 0, cv.width, cv.height); for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - 0.5) * amt; d.data[i] = d.data[i+1] = d.data[i+2] = Math.max(0, Math.min(255, d.data[i] + n)); } x.putImageData(d, 0, 0); };
      const pg = document.createElement('canvas'); pg.width = 2480; pg.height = 3508;
      let x = pg.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 2480, 3508); x.fillStyle = '#111'; x.save(); x.translate(1240, 1754); x.rotate(0.006); x.translate(-1240, -1754);
      const truthA = [];
      for (let b = 0; b < 6; b++) FR.forEach((l, i) => { x.font = (i % 2 ? '44px Times New Roman' : '46px Arial'); x.fillText(l, 200, 300 + (b * 5 + i) * 90); truthA.push(...l.split(/\\s+/)); });
      x.restore(); noisy(pg, 40);
      const pl = document.createElement('canvas'); pl.width = 4800; pl.height = 3400;
      x = pl.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 4800, 3400); x.fillStyle = '#000'; x.strokeStyle = '#000'; x.lineWidth = 3;
      const truthP = [];
      const put = (s, px, py, rot, size) => { x.save(); x.translate(px, py); x.rotate(rot); x.font = size + 'px Arial'; x.fillText(s, 0, 0); x.restore(); truthP.push(...s.split(/\\s+/)); };
      for (let i = 0; i < 40; i++) { x.beginPath(); x.moveTo(200 + i * 100, 2200); x.lineTo(260 + i * 100, 2450); x.stroke(); }
      ['2450', 'IPE 200', 'P12 300x500', 'Ø16 e=150', 'Ech 1/50', 'Niveau +3.20', 'Poutre B7', 'HEA 240', 'N°45'].forEach((s, i) => put(s, 300 + (i % 3) * 1400, 500 + Math.floor(i / 3) * 800, 0, 36));
      ['3600', 'Axe C', 'Trémie 120x80'].forEach((s, i) => put(s, 700 + i * 1500, 2800, -Math.PI / 2, 34));
      put('Indice B - Plan de charpente niveau 2 - Bureau d études', 2600, 3300, 0, 60);
      noisy(pl, 30);
      const norm = (s) => s.toLowerCase().replace(/^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$/gu, '');
      const recall = (truth, text) => { const got = new Map(); for (const t of text.split(/\\s+/).map(norm)) got.set(t, (got.get(t) || 0) + 1); let ok = 0; for (const t of truth.map(norm)) { if ((got.get(t) || 0) > 0) { ok++; got.set(t, got.get(t) - 1); } } return Math.round(100 * ok / truth.length); };
      const out = [];
      for (const [label, lp] of [['best_int', base('../vendor/tesseract/lang/')]]) {
        const w = await T.createWorker(['eng'], 1, { workerPath: base('../vendor/tesseract/worker.min.js'), corePath: base('../vendor/tesseract/core/'), langPath: lp, workerBlobURL: false, gzip: true, cacheMethod: 'none' });
        let t = performance.now(); let res = await w.recognize(pg); out.push({ label, case: 'A4 texte (PSM 3)', ms: Math.round(performance.now() - t), recall: recall(truthA, res.data.text) });
        for (const psm of [3, 11, 12]) { await w.setParameters({ tessedit_pageseg_mode: String(psm) }); t = performance.now(); res = await w.recognize(pl); out.push({ label, case: 'plan PSM ' + psm, ms: Math.round(performance.now() - t), recall: recall(truthP, res.data.text), txt: res.data.text.replace(/s+/g, " ").slice(0, 160) }); }
        for (const psm of [11, 6]) { await w.setParameters({ tessedit_pageseg_mode: String(psm) }); t = performance.now(); let all = ''; for (let ty = 0; ty < 3400; ty += 1500) for (let tx = 0; tx < 4800; tx += 1500) { const tc = document.createElement('canvas'); tc.width = 1600; tc.height = 1600; tc.getContext('2d').drawImage(pl, tx, ty, 1600, 1600, 0, 0, 1600, 1600); all += ' ' + (await w.recognize(tc)).data.text; } out.push({ label, case: 'plan tuiles PSM ' + psm, ms: Math.round(performance.now() - t), recall: recall(truthP, all), txt: all.replace(/s+/g, ' ').slice(0, 200) }); }
        await w.terminate();
      }
      return JSON.stringify(out);
    })()`);
    for (const l of JSON.parse(r)) console.log(l.label.padEnd(15), l.case.padEnd(18), String(l.ms).padStart(6) + ' ms', l.recall + ' % des mots', l.txt || '');
    console.log('logs:', JSON.stringify(c.logs.slice(0, 3)));
  } finally { await c.close(); }
})();
