// Panneau de miniatures : sélection multiple (clic, Ctrl, Maj), glisser-déposer pour réordonner, barre d'outils et menu contextuel (commandes de
// pages-ui.js). Rendu paresseux : une miniature n'est dessinée que lorsqu'elle approche de l'écran ; les miniatures déjà dessinées sont
// conservées (par page et par état de rotation / recadrage) quand la liste de pages change.
import { $, api, bus, store } from './ui.js';
import * as V from './viewer.js';
import * as P from './pages-ui.js';

const THUMB_W = 120;
const DND = 'application/x-spinadoc-pages';
let observer = null;

const TOOLS = [
  ['pg-rot-left', 'rotate-ccw', 'Pivoter à gauche'], ['pg-rot-right', 'rotate-cw', 'Pivoter à droite'], null,
  ['pg-dup', 'copy-plus', 'Dupliquer'], ['pg-delete', 'trash-2', 'Supprimer'], ['pg-extract', 'file-output', 'Extraire vers un nouveau PDF'], null,
  ['pg-blank', 'file-plus', 'Insérer une page vierge'], ['pg-insert', 'file-input', 'Insérer des pages d\'un PDF'], ['pg-crop', 'crop', 'Recadrer'],
];

function ensureObserver() {
  if (observer) return;
  observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      observer.unobserve(en.target);
      en.target._render && en.target._render();
    }
  }, { root: $('sb-thumbs'), rootMargin: '400px 0px' });
}

// Construit (ou reconstruit) les miniatures de doc dans sb.thumbsEl.
export function buildThumbs(doc, sb) {
  ensureObserver();
  const pages = V.getPages(doc);
  const cache = sb.thumbCache || (sb.thumbCache = new Map());
  const root = sb.thumbsEl;
  root.replaceChildren();
  root.tabIndex = -1;

  const tools = document.createElement('div');
  tools.className = 'thumb-tools';
  tools.setAttribute('role', 'toolbar');
  tools.setAttribute('aria-label', 'Pages');
  for (const t of TOOLS) {
    if (!t) { const s = document.createElement('span'); s.className = 'sep'; tools.append(s); continue; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'icon-btn'; b.dataset.pgcmd = t[0]; b.title = t[2]; b.setAttribute('aria-label', t[2]);
    const ic = document.createElement('span'); ic.className = 'ico'; ic.dataset.icon = t[1];
    b.append(ic);
    b.addEventListener('click', () => P.exec(t[0], doc));
    tools.append(b);
  }
  root.append(tools);

  const alive = new Set();
  pages.forEach((rec, i) => {
    const b = P_viewport(rec);
    const h = Math.round((THUMB_W * b.height) / b.width);
    const btn = document.createElement('button');
    btn.className = 'thumb';
    btn.type = 'button';
    btn.draggable = true;
    btn.setAttribute('aria-label', `Page ${i + 1}`);
    btn.dataset.index = i;
    const frame = document.createElement('div');
    frame.className = 'thumb-frame';
    frame.style.width = THUMB_W + 'px';
    frame.style.height = h + 'px';
    const num = document.createElement('span');
    num.className = 'thumb-num';
    num.textContent = String(i + 1);
    btn.append(frame, num);
    const key = rec.uid + '|' + rec.sig;
    alive.add(key);
    const cached = cache.get(key);
    if (cached) frame.append(cached);
    else {
      btn._render = async () => {
        const dpr = window.devicePixelRatio || 1;
        const vp = V.pageViewport(rec, (THUMB_W / b.width) * dpr, 0);
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = THUMB_W + 'px';
        canvas.style.height = h + 'px';
        try {
          await rec.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          cache.set(key, canvas);
          frame.append(canvas);
        } catch { /* page détruite : ignoré */ }
      };
      observer.observe(btn);
    }
    wire(doc, btn, i, pages.length);
    root.append(btn);
  });
  for (const k of [...cache.keys()]) if (!alive.has(k)) cache.delete(k);

  if (!root._wired) root.addEventListener('keydown', (e) => {
    if (!e.target.closest('.thumb')) return;
    const k = e.key;
    if (k === 'Delete') { e.preventDefault(); e.stopPropagation(); if (P.selectedList(doc).length) P.exec('pg-delete', doc); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); P.selectAll(doc); }
  });
  if (!window.__thumbDropWired) { window.__thumbDropWired = true; wireFileDrop($('sb-thumbs')); }
  if (!root._wired) root.addEventListener('contextmenu', (e) => { if (!e.target.closest('.thumb')) e.preventDefault(); });
  root._wired = true;
  markSelection(doc);
}

// Viewport « de base » d'une page (rotation et recadrage compris) pour dimensionner la miniature.
const P_viewport = (rec) => V.pageViewport(rec, 1, 0);

function wire(doc, btn, i, n) {
  btn.addEventListener('click', (e) => {
    const sel = P.selectedList(doc);
    const anchor = doc.runtime.pageAnchor === undefined ? doc.page : doc.runtime.pageAnchor;
    if (e.shiftKey) {
      const a = Math.min(anchor, i), b = Math.max(anchor, i);
      P.setSelection(doc, Array.from({ length: b - a + 1 }, (_, k) => a + k), anchor);
    } else if (e.ctrlKey || e.metaKey) {
      const s = new Set(sel);
      if (s.has(i)) s.delete(i); else s.add(i);
      P.setSelection(doc, [...s], i);
    } else {
      P.setSelection(doc, [i], i);
      V.goToPage(doc, i);
    }
  });
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!P.selection(doc).has(i)) { P.setSelection(doc, [i], i); }
    P.openMenu(e.clientX, e.clientY, doc);
  });
  // glisser-déposer : les pages sélectionnées (ou celle-ci) sont déplacées devant / derrière la miniature visée
  btn.addEventListener('dragstart', (e) => {
    if (!P.selection(doc).has(i)) P.setSelection(doc, [i], i);
    const idx = P.selectedList(doc);
    e.dataTransfer.setData(DND, JSON.stringify(idx));
    e.dataTransfer.effectAllowed = 'move';
    btn.parentElement.querySelectorAll('.thumb').forEach((t) => { if (idx.includes(Number(t.dataset.index))) t.classList.add('dragging'); });
  });
  btn.addEventListener('dragend', () => clearDrop(btn.parentElement));
  btn.addEventListener('dragover', (e) => {
    if (!Array.from(e.dataTransfer.types).includes(DND)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = btn.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    clearDrop(btn.parentElement, true);
    btn.classList.add(after ? 'drop-after' : 'drop-before');
  });
  btn.addEventListener('dragleave', () => btn.classList.remove('drop-before', 'drop-after'));
  btn.addEventListener('drop', (e) => {
    const raw = e.dataTransfer.getData(DND);
    if (!raw) return;
    e.preventDefault();
    const r = btn.getBoundingClientRect();
    const to = i + (e.clientY > r.top + r.height / 2 ? 1 : 0);
    const idx = JSON.parse(raw);
    clearDrop(btn.parentElement);
    P.move(doc, idx, to);
  });
}
// Fichiers PDF glissés depuis l'Explorateur sur le panneau : trait de séparation à la position d'insertion (moitié haute / basse d'une miniature,
// fin de liste sinon) ; le dépôt insère toutes leurs pages. Le reste de la fenêtre garde son comportement (ouvrir dans un onglet).
const isFileDrag = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
function dropPos(root, e) {
  const thumbs = [...root.querySelectorAll('.thumb')];
  for (const t of thumbs) {
    const r = t.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right) {
      const i = Number(t.dataset.index);
      return e.clientY > r.top + r.height / 2 ? { at: i + 1, el: t, cls: 'drop-after' } : { at: i, el: t, cls: 'drop-before' };
    }
  }
  // entre deux miniatures ou sous la dernière : avant la première miniature située sous le pointeur, sinon à la fin
  for (const t of thumbs) { if (t.getBoundingClientRect().top > e.clientY) return { at: Number(t.dataset.index), el: t, cls: 'drop-before' }; }
  const last = thumbs[thumbs.length - 1];
  return { at: thumbs.length, el: last, cls: 'drop-after' };
}
function wireFileDrop(root) {
  root.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    clearDrop(root, true);
    const p = dropPos(root, e);
    if (p.el) p.el.classList.add(p.cls);
    root.classList.add('file-drop');
  });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) { clearDrop(root, true); root.classList.remove('file-drop'); } });
  root.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    const doc = store.active;
    const p = dropPos(root, e);
    const items = Array.from(e.dataTransfer.files).map((f) => ({ name: f.name, path: api.getPathForFile(f) })).filter((x) => x.path);
    clearDrop(root, true); root.classList.remove('file-drop');
    if (doc && items.length) P.insertDropped(doc, items, p.at);
  });
}
function clearDrop(root, keepDragging) {
  root.querySelectorAll('.thumb').forEach((t) => { t.classList.remove('drop-before', 'drop-after'); if (!keepDragging) t.classList.remove('dragging'); });
}

// Classes « sélectionnée » et « page courante », et état de la barre d'outils.
export function markSelection(doc) {
  const sb = doc.runtime.sb;
  if (!sb) return;
  const sel = P.selection(doc);
  Array.from(sb.thumbsEl.querySelectorAll('.thumb')).forEach((t) => {
    const on = sel.has(Number(t.dataset.index));
    t.classList.toggle('selected', on);
    t.setAttribute('aria-pressed', String(on));
  });
  for (const b of sb.thumbsEl.querySelectorAll('[data-pgcmd]')) {
    const st = P.ribbonState(b.dataset.pgcmd, doc);
    b.disabled = !!(st && st.disabled);
    if (st && st.pressed !== undefined) b.setAttribute('aria-pressed', String(st.pressed));
  }
}

bus.on('page-selection', (doc) => markSelection(doc));
