// Boîte « Intégration à Windows » (Réglages) : Spin A Doc figure dans « Ouvrir avec » pour les PDF (écrit par l'installeur) ; le bouton
// ouvre la page « Applications par défaut » des Paramètres de Windows (processus principal : IPC app:default-apps).
import { $, api } from './ui.js';

export function open() {
  $('winint').hidden = false;
  $('winint-close').focus();
}

$('winint-defaults').addEventListener('click', () => api.defaultApps());
$('winint-close').addEventListener('click', () => { $('winint').hidden = true; });
