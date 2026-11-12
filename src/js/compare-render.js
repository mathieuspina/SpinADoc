// Rendu d'une page pour la comparaison : pdf.js, par bandes (la mémoire de travail reste petite même sur un A0), à l'échelle k (px par point).
// Remplit à la fois le canevas d'affichage de la page (couleurs d'origine) et le tableau d'« encre » (255 - luminance) envoyé au worker.
const { Compare } = window;
const BAND = 256; // lignes par bande
const tick = () => new Promise((r) => setTimeout(r, 0));

// Taille d'une page en points (rotation comprise), sans la rendre.
export async function pageSizePt(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  page.cleanup();
  return [vp.width, vp.height];
}

// job : { cancelled }. onProgress(fraction). keepCanvas : false = pas de canevas d'affichage (calcul seul : lot, export).
// Renvoie { w, h, ink: Uint8Array, canvas | null, page } ; page reste ouverte (texte), à nettoyer par l'appelant.
export async function renderInk(pdf, pageNum, k, { job, onProgress, keepCanvas = true } = {}) {
  const page = await pdf.getPage(pageNum);
  const vp = page.getViewport({ scale: k });
  const w = Math.max(1, Math.ceil(vp.width)), h = Math.max(1, Math.ceil(vp.height));
  const ink = new Uint8Array(w * h);
  let canvas = null, cctx = null;
  if (keepCanvas) {
    canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    cctx = canvas.getContext('2d');
    cctx.fillStyle = '#fff'; cctx.fillRect(0, 0, w, h);
  }
  const band = document.createElement('canvas');
  band.width = w;
  for (let y0 = 0; y0 < h; y0 += BAND) {
    if (job && job.cancelled) { band.width = 0; if (canvas) canvas.width = 0; throw Object.assign(new Error('annulé'), { cancelled: true }); }
    const bh = Math.min(BAND, h - y0);
    band.height = bh;
    const ctx = band.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, bh);
    await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, 0, -y0], background: 'rgb(255,255,255)' }).promise;
    const data = ctx.getImageData(0, 0, w, bh).data;
    Compare.inkFromRGBA(data, ink, y0 * w, w * bh);
    if (cctx) cctx.drawImage(band, 0, y0);
    if (onProgress) onProgress(Math.min(1, (y0 + bh) / h));
    await tick();
  }
  band.width = 0;
  return { w, h, ink, canvas, page, vp };
}

// Peint la carte de classes (Uint8Array W×H) dans un canevas, par tranches (l'interface reste fluide).
export async function paintMap(canvas, map, W, H, pal) {
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  const P = { old: Compare.parseColor(pal.old), nu: Compare.parseColor(pal.nu), same: Compare.parseColor(pal.same) };
  const rows = Math.max(1, Math.min(512, Math.floor(4e6 / W)));
  for (let y = 0; y < H; y += rows) {
    const n = Math.min(rows, H - y);
    const img = ctx.createImageData(W, n);
    Compare.paintRows(map, W, y, y + n, P, img.data);
    ctx.putImageData(img, 0, y);
    if (y % (rows * 4) === 0) await tick();
  }
}
