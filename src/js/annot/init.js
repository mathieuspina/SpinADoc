// Initialisation : calques de page, crochets du visionneur, marquage au relâchement.
// (Découpé de annotate.js : voir src/js/annotate.js pour l'API publique.)
import { bus, store } from '../ui.js';
import * as V from '../viewer.js';
import * as Settings from '../settings.js';

const { DocModel, PdfEdit, Shapes, PDFLib, TextInfo } = window;
import { MARKUP_TOOLS, svgEl } from './common.js';
import { cancelPending, createMarkupFromSelection, onPageDblClick, onPageMouseDown } from './events.js';
import { renderAll } from './render.js';
import { closeEditor, onPageMouseMove, setHover } from './texted.js';

// ----------------------------------------------------------------------------- initialisation
V.hooks.pageBuilt = (doc, rec) => {
  const svg = svgEl('svg');
  svg.setAttribute('class', 'annot');
  const g = (cls) => { const e = svgEl('g'); e.setAttribute('class', cls); svg.append(e); return e; };
  rec.svg = svg;
  rec.docRef = doc;
  rec.gCovers = g('covers');
  rec.gObjs = g('objs');
  rec.gNum = g('num');
  rec.gHover = g('hover');
  rec.gSel = g('sel');
  rec.gTmp = g('tmp');
  rec.div.insertBefore(svg, rec.textLayer);
  rec.div.addEventListener('mousedown', (ev) => onPageMouseDown(doc, rec, ev));
  rec.div.addEventListener('mousemove', (ev) => onPageMouseMove(doc, rec, ev));
  rec.div.addEventListener('dblclick', (ev) => onPageDblClick(doc, rec, ev));
  rec.div.addEventListener('mouseleave', () => setHover(rec, null));
};
V.hooks.beforeScale = (doc) => { closeEditor(doc, true); cancelPending(doc); };
V.hooks.renderAll = (doc) => renderAll(doc);

// Relâchement de la souris avec un outil de marquage : crée l'objet à partir du texte sélectionné.
document.addEventListener('mouseup', () => {
  const doc = store.active;
  if (!doc || !MARKUP_TOOLS.includes(doc.tool)) return;
  setTimeout(() => createMarkupFromSelection(doc, doc.tool), 0);
});

