// Sonde OCR (développement) : forme du résultat de tesseract.js dans le moteur de rendu.
const { launchApp } = require('../test/lib/app.js');
(async () => {
  const c = await launchApp({ files: [] });
  try {
    await c.waitFor("document.getElementById('welcome')", 15000);
    console.log(await c.ev(`(async()=>{
      const T = (await import('../vendor/tesseract/tesseract.esm.min.js')).default;
      const base = (p) => new URL(p, location.href).href;
      const w = await T.createWorker(['eng', 'fra'], 1, { workerPath: base('../vendor/tesseract/worker.min.js'), corePath: base('../vendor/tesseract/core/'), langPath: base('../vendor/tesseract/lang/'), workerBlobURL: false, gzip: true, cacheMethod: 'none' });
      const cv = document.createElement('canvas'); cv.width = 900; cv.height = 200;
      const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 200); x.fillStyle = '#000'; x.font = '48px Arial'; x.fillText('Bonjour le monde', 20, 100);
      const res = await w.recognize(cv, {}, { blocks: true, text: true });
      const d = res.data;
      const words = []; for (const b of d.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words) words.push(wd);
      const out = { keys: Object.keys(d), nWords: (d.words || []).length, w0: d.words && d.words[0], fromBlocks: words.slice(0, 2).map((q) => ({ text: q.text, conf: q.confidence, bbox: q.bbox })) };
      await w.terminate();
      return JSON.stringify(out);
    })()`));
  } finally { await c.close(); }
})();
