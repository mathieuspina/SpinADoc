// Métadonnées de résolution des images exportées (pur, UMD) : densité en points par pouce écrite dans le PNG (bloc pHYs) et le JPEG (JFIF APP0),
// pour qu'une image exportée à 300 dpi soit reconnue à 300 dpi (taille physique correcte) par les autres logiciels.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImageMeta = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let table = null;
  function crc32(bytes) {
    if (!table) { table = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const isPng = (b) => b.length > 33 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isJpeg = (b) => b.length > 4 && b[0] === 0xff && b[1] === 0xd8;

  // Dimensions (px) d'un PNG ou d'un JPEG ; null si le format n'est pas reconnu.
  function size(b) {
    if (isPng(b)) return { w: u32(b, 16), h: u32(b, 20), type: 'png' };
    if (isJpeg(b)) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], type: 'jpg' };
        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
      }
    }
    return null;
  }

  // Résolution (dpi) lue dans un PNG (pHYs, mètre) ou un JPEG (JFIF) ; null si absente.
  function dpiOf(b) {
    if (isPng(b)) {
      let i = 8;
      while (i + 12 <= b.length) {
        const len = u32(b, i), type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
        if (type === 'pHYs') return u32(b, i + 8) / 39.3701;
        if (type === 'IDAT') break;
        i += 12 + len;
      }
      return null;
    }
    if (isJpeg(b) && b[2] === 0xff && b[3] === 0xe0 && b[6] === 0x4a) { // JFIF
      const units = b[13];
      const x = (b[14] << 8) | b[15];
      return units === 1 ? x : units === 2 ? x * 2.54 : null;
    }
    return null;
  }

  function setPngDpi(b, dpi) {
    if (!isPng(b)) return b;
    const ppm = Math.round(dpi / 0.0254);
    const chunk = new Uint8Array(21);
    chunk.set([0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73]); // longueur 9, « pHYs »
    for (const [o, v] of [[8, ppm], [12, ppm]]) { chunk[o] = v >>> 24; chunk[o + 1] = (v >>> 16) & 255; chunk[o + 2] = (v >>> 8) & 255; chunk[o + 3] = v & 255; }
    chunk[16] = 1; // unité : mètre
    const crc = crc32(chunk.subarray(4, 17));
    chunk[17] = crc >>> 24; chunk[18] = (crc >>> 16) & 255; chunk[19] = (crc >>> 8) & 255; chunk[20] = crc & 255;
    // supprime un éventuel pHYs existant, puis insère après IHDR (33 octets d'en-tête)
    const parts = [b.subarray(0, 33)];
    let i = 33;
    while (i + 12 <= b.length) {
      const len = u32(b, i), type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      if (type !== 'pHYs') parts.push(b.subarray(i, i + 12 + len));
      i += 12 + len;
    }
    parts.splice(1, 0, chunk);
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function setJpegDpi(b, dpi) {
    if (!isJpeg(b)) return b;
    const d = Math.max(1, Math.min(65535, Math.round(dpi)));
    if (b[2] === 0xff && b[3] === 0xe0 && b[6] === 0x4a && b[7] === 0x46) { // JFIF présent : on corrige la densité
      const out = b.slice();
      out[13] = 1; out[14] = d >> 8; out[15] = d & 255; out[16] = d >> 8; out[17] = d & 255;
      return out;
    }
    const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
    const out = new Uint8Array(b.length + app0.length);
    out.set(b.subarray(0, 2)); out.set(app0, 2); out.set(b.subarray(2), 2 + app0.length);
    return out;
  }

  const setDpi = (b, dpi) => (isPng(b) ? setPngDpi(b, dpi) : setJpegDpi(b, dpi));
  return { size, dpiOf, setPngDpi, setJpegDpi, setDpi, crc32 };
});
