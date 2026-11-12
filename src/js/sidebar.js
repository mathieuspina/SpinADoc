// Panneau latéral : miniatures, signets (plan), recherche. État par document dans doc.runtime.sb.
import { $, bus, enableTablist } from './ui.js';
import * as V from './viewer.js';
import * as A from './annotate.js';
import * as Settings from './settings.js';
import { buildThumbs, markSelection } from './thumbs.js';

const { Search } = window;
const MAX_RESULTS = 500;

let current = null; // document affiché dans le panneau

export function initSidebar() {
  const applyPin = () => {
    const pinned = !!Settings.get('pinSidebar');
    $('sidebar').classList.toggle('pinned', pinned);
    $('sb-pin').setAttribute('aria-pressed', String(pinned));
  };
  applyPin();
  $('sb-pin').addEventListener('click', () => { Settings.set('pinSidebar', !Settings.get('pinSidebar')); applyPin(); bus.emit('view', current); });
  enableTablist($('sb-tabs'), (tab) => {
    ['sb-thumbs', 'sb-outline', 'sb-search', 'sb-annots', 'sb-measures'].forEach((id) => { $(id).hidden = id !== tab.getAttribute('aria-controls'); });
    if (tab.id === 'sbtab-search') $('search-input').focus();
  });

  let timer = 0;
  $('search-input').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => current && runSearch(current, $('search-input').value), 250);
  });
  $('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); stepMatch(e.shiftKey ? -1 : 1, true); }
  });
  $('search-next').addEventListener('click', () => stepMatch(1));
  $('search-prev').addEventListener('click', () => stepMatch(-1));

  bus.on('page', (doc) => { if (doc === current) markCurrentThumb(doc); });
  bus.on('doc-changed', (doc) => { if (doc === current) renderAnnots(doc); });
  // La liste de pages a changé (opération sur les pages, annuler / rétablir) : miniatures, annotations, recherche et signets suivent.
  bus.on('pages', (doc) => {
    const sb = doc.runtime.sb;
    if (!sb) return;
    buildThumbs(doc, sb);
    markCurrentThumb(doc);
    if (doc === current) {
      renderAnnots(doc);
      if (sb.query) runSearch(doc, sb.query);
    } else { sb.results = []; sb.token++; }
  });
}

let open = false;
const applyOpen = () => { $('sidebar').hidden = !(open && current); };
export function isOpen() { return open; }
export function setOpen(v) {
  open = v;
  applyOpen();
  bus.emit('view', current);
}

export function showTab(id) {
  setOpen(true);
  const tab = $(id);
  tab.click();
}

// Appelé quand le document actif change (ou devient null).
export function setSidebarDoc(doc) {
  current = doc;
  applyOpen();
  const thumbs = $('sb-thumbs');
  const outline = $('sb-outline');
  thumbs.replaceChildren();
  outline.replaceChildren();
  $('search-results').replaceChildren();
  $('search-input').value = '';
  $('search-status').textContent = '';
  if (!doc) return;
  const sb = ensure(doc);
  thumbs.append(sb.thumbsEl);
  outline.append(sb.outlineEl);
  $('search-input').value = sb.query;
  $('search-status').textContent = sb.status;
  $('search-results').append(sb.listEl);
  markCurrentThumb(doc);
  markSelection(doc);
  renderAnnots(doc);
}

// ---------------------------------------------------------------- annotations (liste des objets par page)
function renderAnnots(doc) {
  const el = $('sb-annots');
  el.replaceChildren();
  if (!doc) return;
  const { Shapes } = window;
  if (!doc.edits.length) {
    const p = document.createElement('div');
    p.className = 'outline-empty muted';
    p.textContent = 'Aucune annotation.';
    el.append(p);
    return;
  }
  const pages = [...new Set(doc.edits.map((e) => e.page))].sort((a, b) => a - b);
  for (const pg of pages) {
    const h = document.createElement('div');
    h.className = 'annot-page';
    h.textContent = `Page ${pg + 1}`;
    el.append(h);
    for (const e of doc.edits.filter((x) => x.page === pg)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'annot-item' + (doc.selection.includes(e.id) ? ' current' : '');
      const chip = document.createElement('span');
      chip.className = 'annot-chip';
      const c = e.color || [0.5, 0.5, 0.5];
      chip.style.background = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
      const t = document.createElement('span');
      t.className = 'annot-text';
      const snippet = e.text ? ' — ' + e.text.replace(/\s+/g, ' ').slice(0, 28) : '';
      t.textContent = (Shapes.LABELS[e.type] || e.type) + snippet;
      b.append(chip, t);
      b.addEventListener('click', () => { V.goToPage(doc, e.page); A.selectIds(doc, [e.id]); });
      el.append(b);
    }
  }
}

function ensure(doc) {
  const r = doc.runtime;
  if (r.sb) return r.sb;
  const sb = (r.sb = {
    thumbsEl: document.createElement('div'),
    outlineEl: document.createElement('div'),
    listEl: document.createElement('div'),
    query: '', status: '', results: [], currentMatch: -1, token: 0,
  });
  buildThumbs(doc, sb);
  buildOutline(doc, sb);
  return sb;
}

// ---------------------------------------------------------------- miniatures (voir thumbs.js)
function markCurrentThumb(doc) {
  const sb = doc.runtime.sb;
  if (!sb) return;
  const spread = doc.view.mode === 'single' && doc.view.spread === 2 ? [doc.page - (doc.page % 2), doc.page - (doc.page % 2) + 1] : [doc.page];
  Array.from(sb.thumbsEl.children).forEach((t) => {
    const on = spread.includes(Number(t.dataset.index));
    t.classList.toggle('current', on);
    if (on && Number(t.dataset.index) === doc.page && isOpen()) t.scrollIntoView({ block: 'nearest' });
  });
}

// ---------------------------------------------------------------- signets
async function destToPage(pdf, dest) {
  try {
    if (typeof dest === 'string') dest = await pdf.getDestination(dest);
    if (!Array.isArray(dest)) return null;
    const ref = dest[0];
    if (ref && typeof ref === 'object') return await pdf.getPageIndex(ref);
    if (Number.isInteger(ref)) return ref;
  } catch { /* destination invalide */ }
  return null;
}

async function buildOutline(doc, sb) {
  const pdf = V.getPdf(doc);
  const outline = await pdf.getOutline();
  sb.outlineEl.classList.add('outline');
  if (!outline || !outline.length) {
    const p = document.createElement('div');
    p.className = 'outline-empty muted';
    p.textContent = 'Ce document n\'a pas de signets.';
    sb.outlineEl.append(p);
    return;
  }
  const make = (items) => {
    const ul = document.createElement('ul');
    for (const it of items) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'outline-item';
      b.textContent = it.title || '(sans titre)';
      b.addEventListener('click', async () => {
        const p = await destToPage(pdf, it.dest);
        // le signet désigne une page du fichier d'origine : on retrouve sa place actuelle (page supprimée : rien)
        const k = p === null ? -1 : doc.pages.findIndex((d) => d.src === '0' && d.i === p);
        if (k >= 0) V.goToPage(doc, k);
      });
      li.append(b);
      if (it.items && it.items.length) li.append(make(it.items));
      ul.append(li);
    }
    return ul;
  };
  sb.outlineEl.append(make(outline));
}

// ---------------------------------------------------------------- recherche
export function focusSearch() {
  showTab('sbtab-search');
  const i = $('search-input');
  i.focus();
  i.select();
}

async function runSearch(doc, query) {
  const sb = ensure(doc);
  const token = ++sb.token;
  sb.query = query;
  sb.results = [];
  sb.currentMatch = -1;
  sb.listEl.replaceChildren();
  V.setHighlights(doc, null, -1);
  if (!query.trim()) { sb.status = ''; if (doc === current) $('search-status').textContent = ''; return; }

  const n = V.pageCount(doc);
  const setStatus = (t) => { sb.status = t; if (doc === current) $('search-status').textContent = t; };
  for (let p = 0; p < n; p++) {
    setStatus(`Recherche… page ${p + 1} / ${n}`);
    const items = await V.getPageItems(doc, p);
    if (token !== sb.token) return;
    for (const m of Search.findMatches(items, query)) {
      if (sb.results.length >= MAX_RESULTS) break;
      sb.results.push({ page: p, parts: m.parts, pre: m.pre, hit: m.hit, post: m.post });
    }
    if (sb.results.length >= MAX_RESULTS) break;
  }
  const count = sb.results.length;
  setStatus(count === 0 ? 'Aucun résultat.' : `${count}${count >= MAX_RESULTS ? '+' : ''} résultat${count > 1 ? 's' : ''}`);
  sb.results.forEach((m, k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'search-result';
    const pg = document.createElement('span');
    pg.className = 'sr-page';
    pg.textContent = `Page ${m.page + 1}`;
    const bold = document.createElement('b');
    bold.textContent = m.hit;
    b.append(pg, m.pre, bold, m.post);
    b.addEventListener('click', () => gotoMatch(doc, k));
    sb.listEl.append(b);
  });
  if (count) {
    // Première occurrence à partir de la page courante.
    const first = sb.results.findIndex((m) => m.page >= doc.page);
    gotoMatch(doc, first < 0 ? 0 : first);
  }
}

function gotoMatch(doc, k) {
  const sb = doc.runtime.sb;
  if (!sb || !sb.results.length) return;
  sb.currentMatch = (k + sb.results.length) % sb.results.length;
  V.setHighlights(doc, sb.results, sb.currentMatch);
  Array.from(sb.listEl.children).forEach((el, i) => el.classList.toggle('current', i === sb.currentMatch));
  const el = sb.listEl.children[sb.currentMatch];
  if (el) el.scrollIntoView({ block: 'nearest' });
  V.revealMatch(doc, sb.results[sb.currentMatch]);
}

function stepMatch(dir, fromInput) {
  if (!current) return;
  const sb = ensure(current);
  if (sb.query !== $('search-input').value) { runSearch(current, $('search-input').value); return; }
  if (!sb.results.length) return;
  gotoMatch(current, sb.currentMatch + dir);
  if (fromInput) $('search-input').focus();
}
