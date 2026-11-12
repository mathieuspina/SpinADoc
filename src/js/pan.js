// Déplacer le document en l'attrapant : bouton du milieu enfoncé + mouvement (comme dans AutoCAD), ou Espace + glisser (bouton gauche).
// Fonctionne avec tous les outils, au-dessus des annotations, champs de texte et panneaux flottants ; l'outil actif et les tracés en cours
// ne sont pas touchés (les événements souris du geste n'atteignent pas les outils). Pas d'inertie : le défilement suit la souris au pixel près.
// Le défilement automatique de Windows (cercle) est désactivé pour le bouton du milieu (preventDefault sur mousedown et auxclick).
import { $, store } from './ui.js';
import * as V from './viewer.js';
import * as Settings from './settings.js';

let pan = null; // { v, x, y, sl, st, id }
let spaceDown = false;
let spaceUsed = false;

const inWorkspace = (el) => !!(el && el.closest && el.closest('#workspace'));
const modalOpen = () => ['unsaved', 'choice', 'stampdlg', 'sigdlg', 'settings', 'about', 'mcdlg', 'printdlg', 'pgdlg', 'mergews'].some((id) => $(id) && !$(id).hidden);
const typing = (t) => !!(t && t.closest && t.closest('input, textarea, select, button, [contenteditable], [role=tab], [role=menu]'));

function endPan() {
  if (!pan) return;
  pan = null;
  document.body.classList.remove('panning');
}

function endSpace() {
  spaceDown = false;
  document.body.classList.remove('pan-ready');
}

export function initPan() {
  // Début du geste (capture : avant tout outil, quel que soit l'élément visé)
  window.addEventListener('pointerdown', (e) => {
    if (pan) return;
    const middle = e.button === 1 && Settings.get('panMiddle') !== false;
    const space = e.button === 0 && spaceDown;
    if (!middle && !space) return;
    const doc = store.active;
    const v = doc && doc.runtime.viewer;
    if (!v || !inWorkspace(e.target)) return;
    pan = { v, x: e.clientX, y: e.clientY, sl: v.scrollLeft, st: v.scrollTop, id: e.pointerId };
    if (space) spaceUsed = true;
    try { v.setPointerCapture(e.pointerId); } catch { /* geste suivi par les événements de la fenêtre */ }
    document.body.classList.add('panning');
  }, true);

  window.addEventListener('pointermove', (e) => {
    if (!pan || e.pointerId !== pan.id) return;
    pan.v.scrollLeft = pan.sl - (e.clientX - pan.x);
    pan.v.scrollTop = pan.st - (e.clientY - pan.y);
  }, true);
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) window.addEventListener(t, (e) => { if (pan && e.pointerId === pan.id) endPan(); }, true);
  window.addEventListener('blur', () => { endPan(); endSpace(); });

  // Pendant le geste, les outils ne reçoivent rien (ni appui, ni déplacement, ni relâchement) ; pas de défilement automatique de Windows.
  const swallow = (e) => { if (pan || (e.button === 1 && Settings.get('panMiddle') !== false && inWorkspace(e.target) && store.active)) { e.preventDefault(); e.stopImmediatePropagation(); } };
  window.addEventListener('mousedown', (e) => { if (e.button === 1 || pan) swallow(e); }, true);
  window.addEventListener('auxclick', (e) => { if (e.button === 1 && Settings.get('panMiddle') !== false) e.preventDefault(); }, true);
  for (const t of ['mousemove', 'mouseup']) window.addEventListener(t, (e) => { if (pan) e.stopImmediatePropagation(); }, true);

  // Espace maintenu : le curseur devient une main ; glisser avec le bouton gauche déplace le document.
  // Sans glissement, Espace garde son rôle habituel (page suivante), exécuté au relâchement.
  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.ctrlKey || e.altKey || e.metaKey || typing(e.target) || modalOpen() || !store.active) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (spaceDown) return;
    spaceDown = true; spaceUsed = false;
    document.body.classList.add('pan-ready');
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key !== ' ' || !spaceDown) return;
    endSpace();
    const doc = store.active;
    if (!spaceUsed && doc && !modalOpen()) V.handleNavKey(doc, { key: ' ', shiftKey: e.shiftKey });
  }, true);
}
