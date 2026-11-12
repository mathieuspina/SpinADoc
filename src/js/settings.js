// Réglages mémorisés (dossier userData, via main.js) : lus une fois au démarrage, écrits à chaque changement.
import { api } from './ui.js';

const values = {
  keepTool: true, snap: true, panMiddle: true, print: null, printPrinters: {}, pinSidebar: false, pinProps: false, propsAuto: false, propsWidth: null,
  userName: '', stampDate: false, stampUser: false, stampTilt: false, sigDate: false,
};

export async function loadSettings() {
  const s = await api.getSettings();
  for (const k of Object.keys(values)) if (s[k] !== undefined) values[k] = s[k];
  return values;
}
export const get = (k) => values[k];
export function set(k, v) { values[k] = v; api.setSettings({ [k]: v }); }
