// Outil « Légende » : clic sur le point à annoter, glisser vers l'emplacement du texte, relâcher, puis saisie directe du texte.
// L'objet (src/callout.js) est un texte + un repère jusqu'à une pointe ; poignées, édition et propriétés passent par les modules d'annotation existants
// (annot/select.js : poignée « tip » ; annot/drag.js : déplacement de la boîte seule ; panneau Propriétés : champs ajoutés ici). La pointe s'aimante aux
// extrémités et intersections du plan (même système que l'onglet Mesure : snap-geometry.js, réglage « Aimanter »).
import { bus } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';
import * as Settings from './settings.js';
import { snapIndex, snapPending } from './measure-ui.js';

const { Shapes } = window;
const clone = (o) => JSON.parse(JSON.stringify(o));
const SVGNS = 'http://www.w3.org/2000/svg';

// Point aimanté (ou libre avec Alt / aimantation désactivée) : { pt, snap }.
function snapped(doc, rec, pt, altKey) {
  if (Settings.get('snap') === false || altKey) return { pt, snap: null };
  const idx = snapIndex(doc, rec);
  const s = idx ? idx.snap(pt[0], pt[1], 10 / rec.vp.scale) : null;
  return s ? { pt: [s.x, s.y], snap: s } : { pt, snap: null };
}

function drawMark(rec, snap) {
  if (!snap) return;
  const [x, y] = A.toPx(rec)(snap.x, snap.y);
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('class', 'snap-mark');
  p.setAttribute('d', snap.kind === 'end' ? `M${x - 6} ${y - 6}h12v12h-12z` : `M${x - 6} ${y - 6}l12 12M${x + 6} ${y - 6}l-12 12`);
  rec.gTmp.append(p);
}

// Légende dont la boîte a son coin haut-gauche (à l'écran) au point (lx, ly) de la page affichée ; texte droit dans l'orientation affichée.
function calloutAt(rec, tip, lx, ly, text) {
  const d = clone(A.defaultsOf('callout'));
  const s = rec.vp.scale, pad = d.size * 0.4;
  const [px, py] = rec.vp.convertToPdfPoint(lx + pad * s, ly + (Shapes.K_BASE * d.size + pad) * s);
  return Object.assign(d, { type: 'callout', page: rec.index, x: px, y: py, text, tip, rot: rec.vp.rotation || 0 });
}

// Attente maximale de l'analyse des tracés pour un clic posé avant la fin (au-delà : pointe libre, rien n'est bloqué).
export const SNAP_WAIT_MS = 4000;

const tool = {
  down(doc, rec, ev) {
    const r = doc.runtime;
    if (r.drag) return;
    const raw = A.pdfPoint(rec, ev);
    let a = snapped(doc, rec, raw, ev.altKey);
    let tip = a.pt;
    // Clic posé pendant l'analyse du plan : la pointe sera aimantée dès que l'index est prêt (le glisser continue normalement).
    const pending = !a.snap && !ev.altKey && Settings.get('snap') !== false ? snapPending(doc, rec) : null;
    const wait = pending ? Promise.race([pending, new Promise((res) => setTimeout(res, SNAP_WAIT_MS))]).then(() => {
      a = snapped(doc, rec, raw, false);
      tip = a.pt;
    }) : null;
    const start = [ev.clientX, ev.clientY];
    let last = null;
    const objFor = (m, moved) => {
      const [lx, ly] = A.localXY(rec, m);
      // simple clic (sans glisser) : la boîte se place en haut à droite de la pointe
      return moved ? calloutAt(rec, tip, lx, ly, 'Texte') : calloutAt(rec, tip, A.localXY(rec, ev)[0] + 40, A.localXY(rec, ev)[1] - 50, 'Texte');
    };
    const move = (m) => {
      if (!last && Math.hypot(m.clientX - start[0], m.clientY - start[1]) < 4) return;
      last = m;
      A.setTmp(doc, rec, { obj: objFor(m, true) });
      drawMark(rec, a.snap);
    };
    const up = async (m) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      if (wait) { // ce premier clic patiente jusqu'à la fin de l'analyse (Échap l'abandonne)
        const w = r.drag = { kind: 'callout-wait', move() {}, up() {} };
        await wait;
        if (r.drag !== w) return;
      }
      r.drag = null;
      const moved = !!last;
      const o = objFor(m, moved);
      o.text = '';
      A.setTmp(doc, rec, null);
      A.openEditor(doc, rec, { type: 'callout', page: rec.index, obj: o });
      A.setTmp(doc, rec, { obj: o }); // le repère reste visible pendant la saisie (retiré à la fermeture de l'éditeur)
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    r.drag = { kind: 'callout', move, up };
    A.setTmp(doc, rec, null);
    drawMark(rec, a.snap);
  },
  cancel() { return false; },
};

export function initCallout() {
  A.registerTool('callout', 'Légende', tool);
  // l'index d'aimantation d'une page se calcule en tâche de fond : on le prépare dès le choix de l'outil
  bus.on('tool', (doc) => { if (doc && doc.tool === 'callout') { const rec = V.getPages(doc)[Math.min(doc.page, doc.pages.length - 1)]; if (rec) snapIndex(doc, rec); } });
  A.hooks.snapPoint = (doc, rec, pt, ev) => snapped(doc, rec, pt, ev && ev.altKey).pt;
  // Propriétés : champs de texte partagés avec les autres textes, puis champs propres à la légende.
  for (const f of A.FIELDS) {
    if (f.types.includes('m-dist')) continue; // champs des mesures : leur liste de types est partagée avec Measure.TYPES, ne jamais la modifier
    if (['font', 'bold', 'italic', 'size', 'align', 'opacity'].includes(f.k) || (f.k === 'width' && f.kind === 'optnum')) f.types = f.types.concat('callout');
  }
  A.FIELDS.push(
    { k: 'text', label: 'Texte', kind: 'textarea', types: ['callout'] },
    { k: 'color', label: 'Couleur du texte', kind: 'color', types: ['callout'] },
    { k: 'fill', label: 'Fond', kind: 'colorOrNone', types: ['callout'] },
    { k: 'border', label: 'Bordure', kind: 'colorOrNone', types: ['callout'] },
    { k: 'borderWidth', label: 'Épaisseur de la bordure', kind: 'number', min: 0.25, max: 10, step: 0.25, types: ['callout'] },
    { k: 'lineColor', label: 'Couleur du repère', kind: 'color', types: ['callout'] },
    { k: 'lineWidth', label: 'Épaisseur du repère', kind: 'number', min: 0.25, max: 12, step: 0.25, types: ['callout'] },
    { k: 'tipStyle', label: 'Pointe', kind: 'select', options: [['arrow', 'Flèche'], ['dot', 'Point'], ['none', 'Aucune']], types: ['callout'] },
    { k: 'elbow', label: 'Repère à coude', kind: 'bool', types: ['callout'] },
  );
}
