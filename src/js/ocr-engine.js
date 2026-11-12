// Moteur OCR : tesseract.js (WASM, 100 % local : bibliothèque, worker, cœur et données de langue sont dans vendor/tesseract/, aucun téléchargement).
// Un « pool » de workers tesseract.js tourne dans des Web Workers (l'interface ne gèle pas) ; les tuiles sont rendues par pdf.js, une par une, au moment
// où un worker est libre (la mémoire reste bornée même sur un A0). Annuler = terminer les workers : tout s'arrête immédiatement.
const { Ocr } = window;
const url = (p) => new URL(p, import.meta.url).href;
let lib = null;
async function tess() { if (!lib) lib = (await import('../../vendor/tesseract/tesseract.esm.min.js')).default; return lib; }

export const LANGS = { 'fra+eng': ['fra', 'eng'], fra: ['fra'], eng: ['eng'] };
// Terminer un worker tesseract.js pendant un travail fait échouer, EN INTERNE, des appels qui n'ont plus de worker (« postMessage » sur null) : ces rejets
// ne concernent personne (le travail est déjà annulé) et ne doivent pas polluer la console. On ne les écarte que juste après une annulation.
let lastKill = 0;
window.addEventListener('unhandledrejection', (e) => {
  if (Date.now() - lastKill < 10000 && e.reason && /postMessage|null/.test(String(e.reason.message || e.reason))) e.preventDefault();
});
const cancelErr = () => Object.assign(new Error('annulé'), { cancelled: true });
// Nombre de workers : cœurs moins un, de 1 à 4 (chaque worker garde le moteur et les modèles en mémoire, ~300 Mo).
export const poolSize = () => Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

// psm : 3 = segmentation automatique de pages (texte courant) ; 11 = texte clairsemé (plans : cotes, petits textes dispersés).
export async function createPool({ lang, psm, size, dpi }) {
  const T = await tess();
  const langs = LANGS[lang] || LANGS['fra+eng'];
  const pool = { size, dead: false, workers: [], free: [], waiting: [] };
  let killReject;
  const killed = new Promise((_, rej) => { killReject = rej; });
  killed.catch(() => {});
  try {
    pool.workers = await Promise.all(Array.from({ length: size }, async () => {
      const w = await T.createWorker(langs, 1, { workerPath: url('../../vendor/tesseract/worker.min.js'), corePath: url('../../vendor/tesseract/core/'), langPath: url('../../vendor/tesseract/lang/'), workerBlobURL: false, gzip: true, cacheMethod: 'none' });
      await w.setParameters({ tessedit_pageseg_mode: String(psm), user_defined_dpi: String(Math.round(dpi || 300)) });
      return w;
    }));
  } catch (err) { for (const w of pool.workers) { try { w.terminate(); } catch { /* ignoré */ } } throw err; }
  pool.free = pool.workers.slice();
  pool.kill = () => {
    if (pool.dead) return;
    pool.dead = true;
    lastKill = Date.now();
    for (const w of pool.workers) { try { Promise.resolve(w.terminate()).catch(() => {}); } catch { /* ignoré */ } }
    killReject(cancelErr());
    for (const q of pool.waiting) q.rej(cancelErr());
    pool.waiting = [];
  };
  // Réserve un worker libre ; renvoie un « run(canvas) → blocs » et un « release ».
  pool.acquire = () => new Promise((res, rej) => {
    if (pool.dead) { rej(cancelErr()); return; }
    const give = (w) => res({ w, release: () => { const nxt = pool.waiting.shift(); if (nxt && !pool.dead) nxt.give(w); else if (!pool.dead) pool.free.push(w); } });
    if (pool.free.length) give(pool.free.pop()); else pool.waiting.push({ give, rej });
  });
  pool.recognize = (w, canvas) => {
    const p = w.recognize(canvas, {}, { blocks: true }).then((r) => r.data.blocks || []);
    p.catch(() => {}); // après une annulation, la promesse perdante peut échouer : sans importance
    return Promise.race([p, killed]);
  };
  return pool;
}

async function renderTile(page, vp, tile) {
  const c = document.createElement('canvas');
  c.width = tile.w; c.height = tile.h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tile.w, tile.h);
  await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -tile.x, -tile.y], background: 'rgb(255,255,255)' }).promise;
  return c;
}
function rotated(canvas, theta) {
  if (!theta) return canvas;
  const swap = theta === 90 || theta === 270;
  const r = document.createElement('canvas');
  r.width = swap ? canvas.height : canvas.width; r.height = swap ? canvas.width : canvas.height;
  const x = r.getContext('2d');
  x.translate(r.width / 2, r.height / 2); x.rotate(theta * Math.PI / 180); x.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return r;
}
const release = (c) => { c.width = 0; c.height = 0; };

// Plan d'une page (sans la rendre) : tuiles et résolution.
export function planPage(page, opts) {
  const v = page.getViewport({ scale: 1 });
  return Ocr.plan(v.width, v.height, opts);
}

// Reconnaît une page PDF.js. opts : { quality, mode ('text' | 'plan'), turned (lit aussi le texte pivoté de 90° : plans), orientation (page entière tournée : 0/90/180/270) }.
// onTile() à chaque tuile terminée. Renvoie les mots (coordonnées PDF de la page source).
export async function recognizePage(pool, page, opts, onTile) {
  const plan = planPage(page, opts);
  const vp = page.getViewport({ scale: plan.k });
  const convert = (x, y) => vp.convertToPdfPoint(x, y);
  const runTile = async (tile, theta) => {
    const { w, release: done } = await pool.acquire();
    let canvas = null, rot = null;
    try {
      canvas = await renderTile(page, vp, tile);
      rot = rotated(canvas, theta);
      const words = Ocr.wordsFromBlocks(await pool.recognize(w, rot));
      return Ocr.toUser(words, tile, theta, convert, vp.rotation);
    } finally { done(); if (rot && rot !== canvas) release(rot); if (canvas) release(canvas); if (onTile) onTile(); }
  };
  const pass = (theta) => Promise.all(plan.tiles.map((t) => runTile(t, theta)));
  // trace (diagnostic, sans effet) : pour chaque passe, orientation, échantillon ou page, nombre de mots, confiance moyenne, score
  const trace = [];
  const note = (th, ws, sample) => { trace.push(Object.assign({ theta: th, sample: !!sample }, Ocr.stats(ws), { score: Math.round(Ocr.score(ws) * 10) / 10 })); };
  const lists = await pass(0);
  let words = lists.flat();
  let theta = 0;
  note(0, words);
  // Page entière tournée (scan posé de côté ou à l'envers), mode texte : si la lecture à 0° est douteuse, les 4 orientations sont comparées
  // sur un échantillon (zone la plus riche en mots), puis la page entière est relue à l'orientation gagnante (voir Ocr.pickOrientation).
  if (opts.orientation && opts.mode !== 'plan' && Ocr.looksWrong(words)) {
    const pts = words.map((w) => { const [x, y] = vp.convertToViewportPoint((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2); return { x, y }; });
    const rect = Ocr.sampleRect(pts, Math.floor(vp.width), Math.floor(vp.height), Ocr.ORIENT.sample);
    const cands = await Promise.all([0, 90, 270, 180].map(async (th) => { const ws = await runTile(rect, th); note(th, ws, true); return Object.assign({ theta: th }, Ocr.stats(ws)); }));
    const th = Ocr.pickOrientation(cands);
    if (th) {
      const w2 = (await pass(th)).flat();
      note(th, w2);
      // garde-fou : la page entière relue doit faire au moins aussi bien qu'à 0°
      const a = Ocr.stats(w2), b = Ocr.stats(words);
      if (a.n >= 3 && (a.avg > b.avg || Ocr.score(w2) > Ocr.score(words))) { words = w2; theta = th; }
    }
  }
  if (opts.turned && opts.mode === 'plan') words = Ocr.mergeWords([words, (await pass(90)).flat()]);
  else words = Ocr.mergeWords([words]);
  return { words, plan, theta, trace };
}
