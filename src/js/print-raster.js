// Impression rasterisée (couleur → niveaux de gris / noir et blanc, renforcement des traits fins) : une page d'impression est rendue par
// pdf.js par bandes horizontales (mémoire bornée, même sur du A0), traitée pixel par pixel, compressée (Flate) et assemblée en un PDF
// d'images (une page = une feuille). Le vectoriel est perdu : à n'utiliser que si le réglage l'exige (voir print-ui.js).
import { loadPdf } from './pdfjs-load.js';

const { PDFLib } = window;

const BAND_PIXELS = 6e6; // pixels par bande (≈ 24 Mo en RGBA)

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Minimum sur 3×3 appliqué k fois (le plus sombre gagne : un trait fin s'épaissit de k pixels de chaque côté). Canal unique, w × h.
function dilateDark(g, w, h, k) {
  const tmp = new Uint8Array(g.length);
  for (let n = 0; n < k; n++) {
    for (let y = 0; y < h; y++) { // horizontal
      const o = y * w;
      for (let x = 0; x < w; x++) { let m = g[o + x]; if (x > 0 && g[o + x - 1] < m) m = g[o + x - 1]; if (x < w - 1 && g[o + x + 1] < m) m = g[o + x + 1]; tmp[o + x] = m; }
    }
    for (let y = 0; y < h; y++) { // vertical
      const o = y * w;
      for (let x = 0; x < w; x++) { let m = tmp[o + x]; if (y > 0 && tmp[o - w + x] < m) m = tmp[o - w + x]; if (y < h - 1 && tmp[o + w + x] < m) m = tmp[o + w + x]; g[o + x] = m; }
    }
  }
}

// Convertit en gris (RGBA → 1 canal)
function toGray(rgba, n) {
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}

// Ajoute un bandeau d'image (déjà compressé) à la page, à la position donnée (pt, origine bas-gauche).
function addStrip(doc, page, name, data, w, h, bits, space, x, y, wPt, hPt) {
  const dict = doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: space, BitsPerComponent: bits, Filter: 'FlateDecode', Length: data.length });
  const ref = doc.context.register(PDFLib.PDFRawStream.of(dict, data));
  const key = page.node.newXObject(name, ref);
  page.pushOperators(PDFLib.pushGraphicsState(), PDFLib.concatTransformationMatrix(wPt, 0, 0, hPt, x, y), PDFLib.drawObject(key), PDFLib.popGraphicsState());
}

// sheetBytes : PDF d'impression (une page = une feuille) → octets d'un PDF d'images.
//   mode : 'color' | 'gray' | 'bw' ; dpi ; minLineMm : épaisseur minimale des traits (0 = pas de renforcement)
//   onProgress(fraction) ; shouldCancel() → true pour interrompre
export async function rasterize(sheetBytes, { mode, dpi, minLineMm, onProgress, shouldCancel, title }) {
  const src = await loadPdf(sheetBytes);
  const out = await PDFLib.PDFDocument.create();
  if (title) out.setTitle(title);
  const k = minLineMm > 0 ? Math.max(0, Math.ceil(((minLineMm / 25.4) * dpi - 1) / 2)) : 0;
  const scale = dpi / 72;
  let stripNo = 0;
  for (let pn = 1; pn <= src.numPages; pn++) {
    const page = await src.getPage(pn);
    const vp0 = page.getViewport({ scale: 1 });
    const wPt = vp0.width, hPt = vp0.height;
    const W = Math.round(wPt * scale), H = Math.round(hPt * scale);
    const sheet = out.addPage([wPt, hPt]);
    const band = Math.max(64, Math.floor(BAND_PIXELS / W));
    for (let y = 0; y < H; y += band) {
      if (shouldCancel && shouldCancel()) throw new Error('Impression annulée');
      const bh = Math.min(band, H - y);
      const ch = bh + 2 * k;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = ch;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, ch);
      // Le rendu est étiré pour que la feuille occupe exactement W × H pixels (pas de dérive d'arrondi sur les grands formats).
      const vp = page.getViewport({ scale: W / wPt, offsetX: 0, offsetY: -(y - k) });
      await page.render({ canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise;
      const img = ctx.getImageData(0, 0, W, ch);
      let data, bits, space;
      if (mode === 'color') {
        // renforcement par canal (le plus sombre gagne)
        if (k > 0) for (let c = 0; c < 3; c++) {
          const ch1 = new Uint8Array(W * ch);
          for (let i = 0; i < ch1.length; i++) ch1[i] = img.data[i * 4 + c];
          dilateDark(ch1, W, ch, k);
          for (let i = 0; i < ch1.length; i++) img.data[i * 4 + c] = ch1[i];
        }
        const rgb = new Uint8Array(W * bh * 3);
        for (let r = 0; r < bh; r++) for (let x = 0; x < W; x++) { const s = ((r + k) * W + x) * 4, d = (r * W + x) * 3; rgb[d] = img.data[s]; rgb[d + 1] = img.data[s + 1]; rgb[d + 2] = img.data[s + 2]; }
        data = await deflate(rgb); bits = 8; space = 'DeviceRGB';
      } else {
        const g = toGray(img.data, W * ch);
        if (k > 0) dilateDark(g, W, ch, k);
        if (mode === 'gray') {
          data = await deflate(g.subarray(k * W, (k + bh) * W)); bits = 8; space = 'DeviceGray';
        } else { // noir et blanc : 1 bit par pixel (0 = noir)
          const stride = (W + 7) >> 3;
          const packed = new Uint8Array(stride * bh);
          for (let r = 0; r < bh; r++) for (let x = 0; x < W; x++) if (g[(r + k) * W + x] >= 160) packed[r * stride + (x >> 3)] |= 0x80 >> (x & 7);
          data = await deflate(packed); bits = 1; space = 'DeviceGray';
        }
      }
      const yTop = hPt - (y * hPt) / H, hh = (bh * hPt) / H;
      addStrip(out, sheet, 'S' + (++stripNo), data, W, bh, bits, space, 0, yTop - hh, wPt, hh);
      canvas.width = canvas.height = 0; // libère la mémoire de la bande
      if (onProgress) onProgress(((pn - 1) + Math.min(1, (y + bh) / H)) / src.numPages);
    }
  }
  src.destroy();
  return out.save();
}
