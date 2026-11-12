// Déchiffrement d'un PDF protégé par mot de passe dans un Web Worker : { bytes (ArrayBuffer), password } → { type: 'done', bytes } ou { type: 'error', message, wrong }.
// Le document est chargé avec le mot de passe puis réenregistré tel quel (même contenu, sans protection) : les pages, signets et le reste sont conservés.
/* eslint-env worker */
importScripts('../../vendor/pdf-lib/pdf-lib.min.js');

self.onmessage = async (e) => {
  try {
    const d = await PDFLib.PDFDocument.load(e.data.bytes, { password: e.data.password || undefined, updateMetadata: false });
    // pdf-lib réécrit le contenu en clair mais garde l'entrée /Encrypt du trailer : on la retire (second passage, sans déchiffrement).
    const d2 = await PDFLib.PDFDocument.load(await d.save(), { ignoreEncryption: true, updateMetadata: false });
    delete d2.context.trailerInfo.Encrypt;
    const out = await d2.save();
    const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    self.postMessage({ type: 'done', bytes: buf }, [buf]);
  } catch (err) {
    const m = String(err && err.message || err);
    self.postMessage({ type: 'error', message: m, wrong: /password/i.test(m) });
  }
};
