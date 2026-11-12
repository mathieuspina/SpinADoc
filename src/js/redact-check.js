// Boîte « Appliquer le caviardage » : liste « Éléments à vérifier ». Le document d'origine est lu avec pdf-lib (les actions des liens ne sont
// pas exposées par pdf.js) et classé par les MÊMES règles que le nettoyage de l'enregistrement (src/redact-active.js) : ce qui sera supprimé
// automatiquement, et ce qui subsistera (à vérifier par l'utilisateur). Aucune garantie n'est affichée.
import { $ } from './ui.js';

const { PDFLib, RedactActive } = window;
let token = 0;

// plan : pages qui seront caviardées (indices de sortie). Pages conservées analysées = celles du fichier ouvert (source '0') hors plan.
export async function fill(doc, plan) {
  const my = ++token;
  const box = $('rdx-apply-check'), list = $('rdx-apply-check-list'), note = $('rdx-apply-check-note');
  const li = (text, cls) => { const e = document.createElement('li'); e.className = cls || ''; e.textContent = text; return e; };
  list.replaceChildren(li('Analyse du document…', 'muted'));
  note.textContent = '';
  box.hidden = false;
  const red = new Set(plan.map((p) => p.index));
  const kept = [], other = [];
  doc.pages.forEach((p, i) => { if (red.has(i)) return; if (p.src === '0') kept.push(p.i); else if (!/^(blank:|rd)/.test(p.src)) other.push(i); });
  let items;
  try {
    const src = await PDFLib.PDFDocument.load(doc.bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    items = RedactActive.items(RedactActive.inventory(PDFLib, src, kept));
  } catch (err) {
    if (my !== token) return null;
    list.replaceChildren(li('Analyse impossible : ' + (err && err.message ? err.message : err), 'kept'));
    return null;
  }
  if (my !== token) return null;
  items.sort((a, b) => (a.fate === 'kept' ? 0 : 1) - (b.fate === 'kept' ? 0 : 1)); // ce qui SUBSISTE d'abord (à vérifier)
  list.replaceChildren(...(items.length
    ? items.map((x) => li(`${x.fate === 'kept' ? 'Subsiste' : 'Supprimé'} : ${x.label} (${x.n})`, x.fate))
    : [li('Rien trouvé hors du contenu des pages (signets, pièces jointes, JavaScript, formulaire, commentaires).', 'muted')]));
  note.textContent = (other.length ? `Pages insérées depuis un autre PDF (${other.map((i) => i + 1).join(', ')}) : non analysées. ` : '')
    + 'Le texte et les images des pages sans zone restent tels quels.';
  return items;
}
