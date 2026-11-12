// Lecture d'un PDF « source » (ouverture, dépôt dans les miniatures, insertion) sans geler l'interface : pdf.js (son propre worker) compte les pages et
// détecte le chiffrement ; un PDF protégé est déchiffré dans un Web Worker (decrypt-worker.js : chargé avec le mot de passe, réenregistré sans protection).
import { loadPdf } from './pdfjs-load.js';

// Copie déchiffrée d'un PDF protégé (document complet), calculée dans un Web Worker. Rejette avec { wrong: true } si le mot de passe est refusé.
export function decryptCopy(bytes, password) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./decrypt-worker.js', import.meta.url));
    w.onmessage = (e) => {
      const m = e.data;
      w.terminate();
      if (m.type === 'done') resolve(new Uint8Array(m.bytes)); else reject(Object.assign(new Error(m.message), { wrong: m.wrong }));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Erreur du worker')); };
    const buf = bytes.slice().buffer;
    w.postMessage({ bytes: buf, password }, [buf]);
  });
}

// ask({ title, intro, fields, okLabel }) → valeurs ou null (boîte de mot de passe). Renvoie { bytes, n, password? } ou { error, cancelled? }.
export async function readSource(name, bytes, ask) {
  let password = '';
  let msg = '';
  for (;;) {
    try {
      const pdf = await loadPdf(bytes, password ? { password } : {});
      const n = pdf.numPages;
      pdf.destroy();
      if (!password) return { bytes, n };
      return { bytes: await decryptCopy(bytes, password), n, password };
    } catch (e) {
      if ((e && e.name === 'PasswordException') || (password && e && e.wrong)) {
        const v = await ask({
          title: 'PDF protégé', intro: `« ${name} » est protégé par un mot de passe.${msg ? ' ' + msg : ''}`,
          fields: [{ id: 'pw', label: 'Mot de passe', type: 'password', value: '' }], okLabel: 'Ouvrir',
        });
        if (!v) return { error: `« ${name} » ignoré : protégé par un mot de passe.`, cancelled: true };
        password = v.pw;
        msg = 'Mot de passe incorrect, réessayez.';
        continue;
      }
      return { error: `« ${name} » ignoré : fichier illisible ou abîmé.` };
    }
  }
}
