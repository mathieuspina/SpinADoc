// Annotations : API publique (façade). Le code est découpé dans src/js/annot/ :
//   common (constantes, outils, coordonnées), render (calques SVG), select (poignées), texted (éditeur de texte), drag (gestes de souris),
//   events (événements de page, changement d'outil), clipboard (presse-papiers, ordre), place (tampons / images / signatures),
//   props-model (propriétés), keys (clavier), init (crochets du visionneur).
export * from './annot/common.js';
export * from './annot/props-model.js';
export * from './annot/render.js';
export * from './annot/select.js';
export * from './annot/texted.js';
export * from './annot/drag.js';
export * from './annot/events.js';
export * from './annot/clipboard.js';
export * from './annot/place.js';
export * from './annot/keys.js';
import './annot/init.js';
