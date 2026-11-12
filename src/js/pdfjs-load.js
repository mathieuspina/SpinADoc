// PDF.js sur des octets quelconques (aperçu, rasterisation de l'impression, fusion) : module sans dépendance au DOM de l'application,
// utilisable aussi par la fenêtre de travail cachée (print-worker.html).
import * as pdfjsLib from '../../vendor/pdfjs/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
export const CMAP_URL = new URL('../../vendor/pdfjs/cmaps/', import.meta.url).href;
export const FONT_URL = new URL('../../vendor/pdfjs/standard_fonts/', import.meta.url).href;
export { pdfjsLib };

// Les octets fournis ne sont pas consommés. opts.password : mot de passe d'un PDF chiffré.
export function loadPdf(bytes, opts) {
  return pdfjsLib.getDocument(Object.assign({ data: new Uint8Array(bytes).slice(), cMapUrl: CMAP_URL, cMapPacked: true, standardFontDataUrl: FONT_URL, isEvalSupported: false }, opts || {})).promise;
}
