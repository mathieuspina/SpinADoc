// Garde des sorties (impression, export en images, fusion, extraction, division) : les zones à caviarder ne sont qu'un repère tant que
// le caviardage n'est pas appliqué ; ces sorties écriraient le contenu dessous EN CLAIR. Avant chacune : question « Appliquer d'abord »
// / « Continuer quand même » / « Annuler ». Module séparé de redact-ui.js (qui importe docs-ui.js) pour éviter un import circulaire :
// redact-ui.js fournit la fonction d'application par setApplier().
import { askChoice } from './ui.js';

let applier = null;
export const setApplier = (fn) => { applier = fn; };
// pages (facultatif) : indices des pages concernées par la sortie ; sinon tout le document.
export const pendingZones = (doc, pages) => (doc && doc.edits ? doc.edits.filter((e) => e.type === 'redact' && (!pages || pages.includes(e.page))).length : 0);

// Renvoie 'none' (aucune zone), 'continue', 'applied' (caviardage appliqué, le document a changé) ou false (abandon).
export async function guardOutput(doc, what, pages) {
  const n = pendingZones(doc, pages);
  if (!n) return 'none';
  const zones = n > 1 ? `${n} zones à caviarder ne sont pas appliquées` : 'une zone à caviarder n\'est pas appliquée';
  const c = await askChoice({
    title: 'Zones à caviarder non appliquées',
    message: `« ${doc.name} » : ${zones}. ${what} sortirait le texte et les images situés sous ${n > 1 ? 'ces zones' : 'cette zone'} EN CLAIR : `
      + 'une zone n\'est qu\'un repère tant que « Appliquer le caviardage » n\'a pas été fait.',
    buttons: [
      { id: 'apply', label: 'Appliquer d\'abord', primary: true },
      { id: 'continue', label: 'Continuer quand même' },
      { id: 'cancel', label: 'Annuler' },
    ],
  });
  if (c === 'apply') return applier && (await applier(doc)) ? 'applied' : false;
  return c === 'continue' ? 'continue' : false;
}
