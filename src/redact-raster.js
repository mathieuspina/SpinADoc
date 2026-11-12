// Caviardage : rastérisation d'une page par bandes (pdf.js), blocs peints DANS les pixels, compression au fil de l'eau (CompressionStream, zlib)
// avec le prédicteur PNG « Up » : le résultat est directement le flux /FlateDecode d'une image PDF. La mémoire de travail reste celle d'une bande,
// même sur un A0 ; l'image est en niveaux de gris si la page n'a aucune couleur (3 fois plus petite), sinon en RVB.
// Fonctionne dans le renderer et dans Node (tests) : la fabrique de canevas est fournie par l'appelant.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./redact.js'));
  else root.RedactRaster = factory(root.Redact);
})(typeof self !== 'undefined' ? self : this, function (Redact) {
  'use strict';

  const BAND_PIXELS = 12e6; // pixels par bande
  const GRAY_TOL = 3;

  // Compresseur zlib en flux : write(Uint8Array), end() → Uint8Array ; abort() abandonne.
  function deflater() {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    const out = new Response(cs.readable).arrayBuffer();
    out.catch(() => {});
    let dead = false;
    return {
      write: (u8) => (dead ? Promise.resolve() : writer.write(u8)),
      async end() { await writer.close(); return new Uint8Array(await out); },
      abort() { if (!dead) { dead = true; writer.abort().catch(() => {}); } },
    };
  }

  const rgbOf = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

  // Libellé optionnel centré dans un bloc (blanc sur fond sombre, noir sur fond clair), réduit pour tenir dans le bloc.
  function drawLabel(ctx, r, y0, label, color) {
    const w = r[2] - r[0], h = r[3] - r[1];
    let fs = Math.min(h * 0.62, 64);
    if (fs < 6) return;
    ctx.save();
    ctx.font = `bold ${fs}px Helvetica, Arial, sans-serif`;
    const tw = ctx.measureText(label).width;
    if (tw > w * 0.92) { fs *= (w * 0.92) / tw; ctx.font = `bold ${fs}px Helvetica, Arial, sans-serif`; }
    if (fs < 6) { ctx.restore(); return; }
    const lum = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
    ctx.fillStyle = lum < 0.5 ? '#fff' : '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.beginPath(); ctx.rect(r[0], r[1] - y0, w, h); ctx.clip();
    ctx.fillText(label, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2 - y0);
    ctx.restore();
  }

  // page : page pdf.js ; opts : { dpi, maxPixels, zones: [[x0,y0,x1,y1]] (coordonnées PDF de la page), color [r,g,b], label, createCanvas(w, h) → { canvas, context },
  //   renderCanvasFactory (Node), annotationMode (défaut 1 : apparences des annotations et des champs dessinées), job { cancelled }, onProgress(fraction) }.
  // Renvoie { width, height, gray, data (flux zlib, prédicteur PNG), dpi, view, rotate, blocks (rectangles en pixels) }.
  async function rasterize(page, opts) {
    const view = page.view.slice();
    const vw = view[2] - view[0], vh = view[3] - view[1];
    const dpi = Redact.effectiveDpi(view, opts.dpi || 300, opts.maxPixels || 80e6);
    const W = Math.max(1, Math.round((vw * dpi) / 72)), H = Math.max(1, Math.round((vh * dpi) / 72));
    const vp = page.getViewport({ scale: dpi / 72, rotation: 0 });
    const kx = W / vp.width, ky = H / vp.height;
    const blocks = Redact.pixelRects(opts.zones || [], view, W, H, 1);
    const color = opts.color || [0, 0, 0];
    const bandH = Math.max(32, Math.min(H, Math.floor(BAND_PIXELS / W)));
    const { canvas, context: ctx } = opts.createCanvas(W, bandH);
    const rgb = deflater(), gray = deflater();
    let isGray = true;
    const prevRGB = new Uint8Array(W * 3), prevG = new Uint8Array(W); // ligne précédente (filtre « Up » ; la 1re ligne part de zéro)
    try {
      for (let y0 = 0; y0 < H; y0 += bandH) {
        if (opts.job && opts.job.cancelled) throw Object.assign(new Error('Caviardage annulé.'), { cancelled: true });
        const bh = Math.min(bandH, H - y0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, bandH);
        const params = { canvasContext: ctx, viewport: vp, transform: [kx, 0, 0, ky, 0, -y0], background: 'rgb(255,255,255)', annotationMode: opts.annotationMode === undefined ? 1 : opts.annotationMode };
        if (opts.renderCanvasFactory) params.canvasFactory = opts.renderCanvasFactory;
        await page.render(params).promise;
        // blocs : peints dans les pixels de la bande (le contenu dessous est remplacé, pas recouvert)
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = rgbOf(color);
        for (const r of blocks) if (r[3] > y0 && r[1] < y0 + bh) ctx.fillRect(r[0], r[1] - y0, r[2] - r[0], r[3] - r[1]);
        if (opts.label) for (const r of blocks) if (r[3] > y0 && r[1] < y0 + bh) drawLabel(ctx, r, y0, opts.label, color);
        const data = ctx.getImageData(0, 0, W, bh).data;
        const outRGB = new Uint8Array(bh * (1 + W * 3));
        const outG = isGray ? new Uint8Array(bh * (1 + W)) : null;
        for (let y = 0; y < bh; y++) {
          let o = y * W * 4;
          const bR = y * (1 + W * 3), bG = y * (1 + W);
          outRGB[bR] = 2; // filtre PNG « Up »
          if (isGray) outG[bG] = 2;
          for (let x = 0, j = 0; x < W; x++, o += 4, j += 3) {
            const r = data[o], g = data[o + 1], b = data[o + 2];
            outRGB[bR + 1 + j] = (r - prevRGB[j]) & 255; outRGB[bR + 2 + j] = (g - prevRGB[j + 1]) & 255; outRGB[bR + 3 + j] = (b - prevRGB[j + 2]) & 255;
            prevRGB[j] = r; prevRGB[j + 1] = g; prevRGB[j + 2] = b;
            if (isGray) {
              if (Math.abs(r - g) > GRAY_TOL || Math.abs(g - b) > GRAY_TOL) { isGray = false; gray.abort(); }
              else { const v = (r * 77 + g * 151 + b * 28) >> 8; outG[bG + 1 + x] = (v - prevG[x]) & 255; prevG[x] = v; }
            }
          }
        }
        await rgb.write(outRGB);
        if (isGray) await gray.write(outG);
        if (opts.onProgress) opts.onProgress(Math.min(1, (y0 + bh) / H));
      }
    } catch (err) {
      rgb.abort(); gray.abort();
      try { canvas.width = 0; canvas.height = 0; } catch { /* canevas Node */ }
      throw err;
    }
    try { canvas.width = 0; canvas.height = 0; } catch { /* canevas Node */ }
    let data;
    if (isGray) { rgb.abort(); data = await gray.end(); } else data = await rgb.end();
    return { width: W, height: H, gray: isGray, data, dpi, view, rotate: page.rotate || 0, blocks };
  }

  return { rasterize, BAND_PIXELS };
});
