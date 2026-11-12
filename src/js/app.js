// Point d'entrée de l'interface : ruban, onglets de documents, accueil, réglages, raccourcis.
import { $, api, bus, store, toast, busy, enableTablist, askChoice } from './ui.js';
import * as V from './viewer.js';
import * as Sidebar from './sidebar.js';
import * as A from './annotate.js';
import * as Props from './props.js';
import * as Stamps from './stamps-ui.js';
import * as Measures from './measure-ui.js';
import * as Pages from './pages-ui.js';
import * as Merge from './merge-ui.js';
import * as NumUI from './numbering-ui.js';
import * as Docs from './docs-ui.js';
import * as CompareUI from './compare-ui.js';
import * as OcrUI from './ocr-ui.js';
import * as WinInt from './winint-ui.js';
import * as CalloutUI from './callout-ui.js';
import * as RedactUI from './redact-ui.js';
import * as FormsUI from './forms-ui.js';
import * as FieldsUI from './fields-ui.js';
import * as Help from './help-ui.js';
import * as FieldsOrder from './fields-order.js';
import * as Align from './align.js';
import { readSource } from './pdf-source.js';
import { initPan } from './pan.js';
import * as Print from './print-ui.js';
import { initAnim, startupSpin, getAnim, setAnim } from './anim.js';
import * as Settings from './settings.js';

const { DocModel } = window;
const APP = 'Spin A Doc';
V.hooks.toast = toast;

const active = () => store.active;

// =====================================================================  ouverture / fermeture
async function openFiles(paths) {
  for (const p of paths) {
    const existing = store.findByPath(p);
    if (existing) { activate(existing); continue; }
    const done = busy('Ouverture…');
    let doc = null;
    let f;
    try {
      f = await api.readFile(p);
    } catch (err) {
      // Fichier supprimé, disque absent, accès refusé… : message clair et retrait de la liste des récents.
      console.warn('Lecture impossible :', err && err.message);
      done();
      toast(`Impossible d'ouvrir « ${String(p).split(/[\\/]/).pop()} » : fichier introuvable ou inaccessible (disque absent ?).`, 6000);
      await api.removeRecent(p);
      await loadRecents();
      continue;
    }
    try {
      doc = DocModel.createDoc({ path: f.path, name: f.name, bytes: f.bytes });
      store.add(doc);
      await V.openDocument(doc);
      activate(doc);
      FormsUI.scan(doc).catch((e) => console.warn('Formulaire :', e));
    } catch (err) {
      if (!(err && err.name === 'PasswordException')) console.error(err);
      if (doc) { V.closeDocument(doc); store.close(doc.id); activate(active()); }
      doc = null;
      if (err && err.name === 'PasswordException') {
        // PDF protégé : mot de passe demandé (message clair si faux), copie déchiffrée calculée dans un Web Worker ; l'enregistrement
        // remet la même protection (doc.protect) tant qu'on ne la retire pas (Document > Protéger).
        const r = await readSource(f.name, f.bytes, (o) => { done(); return Pages.askForm(o); });
        if (r.error) toast(r.cancelled ? `Ouverture annulée : « ${f.name} » est protégé par un mot de passe.` : r.error, 6000);
        else {
          try {
            doc = DocModel.createDoc({ path: f.path, name: f.name, bytes: r.bytes });
            doc.protect = { userPassword: r.password };
            store.add(doc);
            await V.openDocument(doc);
            await Docs.adoptInfo(doc, f.bytes, r.password);
            activate(doc);
            FormsUI.scan(doc).catch((e) => console.warn('Formulaire :', e));
            toast('PDF protégé ouvert. Il sera enregistré avec le même mot de passe (Document > Protéger pour le changer ou le retirer).', 7000);
          } catch (e2) {
            console.error(e2);
            if (doc) { V.closeDocument(doc); store.close(doc.id); activate(active()); }
            toast('Impossible d\'ouvrir ce fichier PDF.');
          }
        }
      } else toast('Impossible d\'ouvrir ce fichier PDF.');
    } finally {
      done();
    }
  }
  loadRecents();
}

// Ouvre des octets dans un nouvel onglet NON enregistré (exemplaire aplati…).
async function openBytesTab(name, bytes) {
  const done = busy('Ouverture…');
  try {
    const doc = DocModel.createDoc({ path: null, name, bytes });
    doc.savedStateId = -1;
    doc.dirty = true;
    store.add(doc);
    await V.openDocument(doc);
    activate(doc);
  } catch (err) { console.error(err); toast('Impossible d\'ouvrir le résultat.'); } finally { done(); }
}

// Résultat d'une fusion : nouvel onglet NON enregistré (pas de chemin : « Enregistrer sous » demande le nom ; fermer demande confirmation).
async function openMerged(name, bytes, stats) {
  const done = busy('Ouverture du résultat…');
  let doc = null;
  try {
    doc = DocModel.createDoc({ path: null, name, bytes });
    doc.savedStateId = -1;
    doc.dirty = true;
    store.add(doc);
    await V.openDocument(doc);
    activate(doc);
    toast(`Fusion terminée : ${stats.pages} pages${stats.bookmarks ? `, ${stats.bookmarks} signets` : ''}. Enregistrez le résultat avec « Enregistrer sous ».`, 6000);
  } catch (err) {
    console.error(err);
    if (doc) { V.closeDocument(doc); store.close(doc.id); activate(active()); }
    toast('Le résultat de la fusion n\'a pas pu être ouvert.');
  } finally { done(); }
}

async function openFromDialog() {
  const paths = await api.openDialog();
  if (paths.length) await openFiles(paths);
}

function activate(doc) {
  Pages.cancelCrop();
  if (doc) { store.activate(doc.id); V.activateDoc(doc); }
  Sidebar.setSidebarDoc(doc || null);
  refreshAll();
}

async function closeTab(id) {
  const doc = store.docs.find((d) => d.id === id);
  if (!doc) return;
  if (doc.dirty && !(await resolveUnsaved([doc], 'fermer'))) return;
  if (!store.docs.includes(doc)) return;
  V.closeDocument(doc);
  store.close(id);
  activate(active());
}

// Enregistre un document (boîte « Enregistrer sous », prérempli avec le nom du fichier).
// Renvoie true seulement si le fichier a bien été écrit (annulation ou échec : false, le document reste ouvert).
async function saveDoc(doc, o) {
  A.closeEditor(doc, true);
  // Caviardage : zones non appliquées (question), nouveau nom, interdiction d'écraser le fichier d'origine, réouverture depuis le fichier écrit.
  const g = await RedactUI.beforeSave(doc, o && o.redact);
  if (!g) return false;
  if (g.applied && o && o.bytes) o = Object.assign({}, o, { bytes: null }); // octets calculés avant l'application : périmés
  const done = busy('Enregistrement…');
  try {
    // o : { bytes (déjà calculés), encrypt (protection de cet enregistrement), useObjectStreams } — par défaut la protection du document (doc.protect)
    const warns = [];
    const bytes = o && o.bytes ? o.bytes : await V.exportBytes(doc, null, { warn: (m) => warns.push(m), encrypt: o && 'encrypt' in o ? o.encrypt : (doc.protect || null), useObjectStreams: o && o.useObjectStreams });
    const r = await api.saveAs(bytes, g.name || doc.name, doc.path, g.forbid ? { forbid: g.forbid } : undefined);
    if (r.refused) { toast('Un document caviardé ne peut pas remplacer le fichier d\'origine : enregistrez-le sous un autre nom.', 8000); return false; }
    if (!r.saved) return false;
    DocModel.markSaved(doc);
    if (r.path && r.path.toLowerCase() !== (doc.path || '').toLowerCase()) { doc.path = r.path; doc.name = r.name; }
    toast(`Enregistré : ${r.name}` + (warns.length ? ' — ' + warns[0] + (warns.length > 1 ? ` (+${warns.length - 1})` : '') : ''), warns.length ? 8000 : 4500);
    if (g.reopen && r.path) { done(); await reopenSaved(doc, r.path); }
    refreshAll();
    loadRecents();
    return true;
  } catch (err) {
    console.error(err);
    toast(`Échec de l'enregistrement de « ${doc.name} » : ${err && err.message ? err.message : err}. Le document reste ouvert.`, 8000);
    return false;
  } finally {
    done();
  }
}

// Document caviardé enregistré : l'onglet est rouvert depuis le fichier écrit (son historique, qui contient encore les pages d'origine, est fermé).
async function reopenSaved(doc, p) {
  V.closeDocument(doc);
  store.close(doc.id);
  await openFiles([p]);
  toast('Document caviardé rouvert depuis le fichier enregistré : l\'historique d\'annulation est fermé, l\'information caviardée n\'existe plus.', 7000);
}

async function saveActive() {
  const doc = active();
  if (doc) await saveDoc(doc);
}

// Boîte modale « modifications non enregistrées ». Renvoie 'save' | 'discard' | 'cancel'.
// docs : documents modifiés concernés ; verb : 'fermer' ou 'quitter'.
function askUnsaved(docs, verb) {
  return new Promise((resolve) => {
    const dlg = $('unsaved');
    const multi = docs.length > 1;
    $('unsaved-title').textContent = 'Modifications non enregistrées';
    $('unsaved-msg').textContent = multi
      ? `${docs.length} documents contiennent des modifications non enregistrées. Les enregistrer avant de ${verb} ?`
      : `Enregistrer les modifications de « ${docs[0].name} » avant de ${verb} ?`;
    const list = $('unsaved-list');
    list.hidden = !multi;
    list.replaceChildren(...(multi ? docs.map((d) => { const li = document.createElement('li'); li.textContent = d.name; return li; }) : []));
    $('unsaved-save').textContent = multi ? 'Tout enregistrer' : 'Enregistrer';
    const before = document.activeElement;
    const btns = [$('unsaved-cancel'), $('unsaved-discard'), $('unsaved-save')];
    const onCancel = () => finish('cancel');
    const onDiscard = () => finish('discard');
    const onSave = () => finish('save');

    function finish(v) {
      dlg.hidden = true;
      dlg.removeEventListener('keydown', onKey, true);
      $('unsaved-cancel').removeEventListener('click', onCancel);
      $('unsaved-discard').removeEventListener('click', onDiscard);
      $('unsaved-save').removeEventListener('click', onSave);
      if (before && before.focus) before.focus();
      resolve(v);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('cancel'); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); finish('save'); }
      else if (e.key === 'Tab') { // le focus reste dans la boîte
        const i = btns.indexOf(document.activeElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
      } else e.stopPropagation();
    }
    $('unsaved-cancel').addEventListener('click', onCancel);
    $('unsaved-discard').addEventListener('click', onDiscard);
    $('unsaved-save').addEventListener('click', onSave);
    dlg.addEventListener('keydown', onKey, true);
    dlg.hidden = false;
    $('unsaved-save').focus();
  });
}

// Décision pour une liste de documents modifiés ; true = on peut poursuivre (fermer / quitter).
async function resolveUnsaved(docs, verb) {
  if (!docs.length) return true;
  const choice = await askUnsaved(docs, verb);
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  for (const d of docs) {
    activate(d); // montre le document concerné pendant l'enregistrement
    if (!(await saveDoc(d))) return false; // annulé ou échec : on s'arrête, tout reste ouvert
  }
  return true;
}

// =====================================================================  rafraîchissement de l'interface
function refreshAll() {
  const doc = active();
  $('welcome').hidden = !!doc;
  renderTabs();
  document.title = doc ? `${doc.name} – ${APP}` : APP;
  api.setDirty(store.anyDirty());
  refreshRibbon();
  refreshStatus();
}

function refreshRibbon() {
  const doc = active();
  document.querySelectorAll('#ribbon [data-cmd]').forEach((b) => {
    const c = b.dataset.cmd;
    b.disabled = !doc && c !== 'open' && c !== 'recents' && c !== 'props' && c !== 'merge-open';
    const ps = Pages.ribbonState(c, doc);
    if (ps) { b.disabled = ps.disabled; if (ps.pressed !== undefined) b.setAttribute('aria-pressed', String(ps.pressed)); return; }
    const fs_ = FormsUI.ribbonState(c, doc);
    if (fs_) { b.disabled = fs_.disabled; if (fs_.pressed !== undefined) b.setAttribute('aria-pressed', String(fs_.pressed)); return; }
    const os_ = OcrUI.ribbonState(c, doc);
    if (os_) { b.disabled = os_.disabled; if (os_.pressed !== undefined) b.setAttribute('aria-pressed', String(os_.pressed)); return; }
    const rs = RedactUI.ribbonState(c, doc);
    if (rs) { b.disabled = rs.disabled; return; }
    const fl = FieldsUI.ribbonState(c, doc);
    if (fl) { b.disabled = fl.disabled; if (fl.pressed !== undefined) { b.setAttribute('aria-pressed', String(fl.pressed)); return; } }
    if (c === 'fld-order') b.disabled = !doc || doc.edits.filter((e) => e.type === 'field').length < 2 || FieldsUI.isPreview(doc);
    if (Align.MODES[c]) b.disabled = !doc || doc.selection.length < 2;
    const ms = Measures.ribbonState(c, doc);
    if (ms) { b.disabled = ms.disabled; if (ms.pressed !== undefined) b.setAttribute('aria-pressed', String(ms.pressed)); return; }
    if (c === 'undo') b.disabled = !doc || !doc.undo.length;
    if (c === 'redo') b.disabled = !doc || !doc.redo.length;
    if (['obj-copy', 'obj-duplicate', 'obj-delete', 'obj-front', 'obj-back'].includes(c)) b.disabled = !doc || !doc.selection.length;
    if (c === 'obj-paste') b.disabled = !doc || !A.hasClipboard();
    if (c === 'props') b.setAttribute('aria-pressed', String(Props.isManualOpen()));
    if (!b.hasAttribute('data-pressable') || c === 'props') return;
    let on = false;
    if (c === 'sidebar') on = Sidebar.isOpen();
    else if (doc) {
      if (c.startsWith('tool-')) on = doc.tool === c.slice(5);
      else if (c === 'fit-width') on = doc.view.fit === 'width';
      else if (c === 'fit-page') on = doc.view.fit === 'page';
      else if (c === 'mode-continuous') on = doc.view.mode === 'continuous';
      else if (c === 'mode-single') on = doc.view.mode === 'single';
      else if (c === 'spread') on = doc.view.spread === 2;
      else if (c === 'stamps-menu') on = doc.tool === 'stamp';
      else if (c === 'sig-menu') on = doc.tool === 'signature';
      else if (c === 'image-insert') on = doc.tool === 'image';
    }
    b.setAttribute('aria-pressed', String(on));
  });
}

function refreshStatus() {
  const doc = active();
  const has = !!doc;
  ['in-page', 'page-prev', 'page-next', 'zoom-out', 'zoom-in', 'zoom-range'].forEach((id) => { $(id).disabled = !has; });
  const pct = has ? Math.round((doc.view.zoom / V.CSS_100) * 100) : 100;
  $('zoom-label').textContent = pct + ' %';
  $('zoom-label-ribbon').textContent = pct + ' %';
  $('zoom-range').value = String(pct);
  $('page-count').textContent = has ? String(V.pageCount(doc)) : '0';
  $('tool-label').textContent = has && doc.tool !== 'select' ? 'Outil : ' + (A.TOOL_LABELS[doc.tool] || doc.tool) : '';
  if (document.activeElement !== $('in-page')) $('in-page').value = has ? String(doc.page + 1) : '1';
  $('in-page').max = has ? String(V.pageCount(doc)) : '1';
  $('sb-toggle').setAttribute('aria-pressed', String(Sidebar.isOpen()));
  $('sb-corner').setAttribute('aria-pressed', String(Sidebar.isOpen() && has));
  $('sb-corner').disabled = !has;
  $('props-toggle').setAttribute('aria-pressed', String(Props.isManualOpen()));
  Measures.onChange();
}

bus.on('doc-changed', (doc) => { if (doc === active()) { renderTabs(); refreshRibbon(); api.setDirty(store.anyDirty()); } });
bus.on('page', (doc) => { if (doc === active()) refreshStatus(); });
bus.on('pages', (doc) => { if (doc === active()) { refreshStatus(); refreshRibbon(); } });
bus.on('page-selection', (doc) => { if (doc === active()) refreshRibbon(); });
bus.on('zoom', (doc) => { if (doc === active()) { refreshStatus(); refreshRibbon(); } });
bus.on('view', () => { refreshRibbon(); refreshStatus(); });
bus.on('tool', (doc) => { if (doc === active()) { refreshRibbon(); refreshStatus(); } });

// =====================================================================  onglets de documents
function renderTabs() {
  const list = $('doctabs');
  list.replaceChildren();
  store.docs.forEach((doc, i) => {
    const tab = document.createElement('div');
    tab.className = 'doctab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(doc === active()));
    tab.tabIndex = doc === active() ? 0 : -1;
    tab.draggable = true;
    tab.dataset.id = doc.id;
    tab.title = doc.path || doc.name;
    const name = document.createElement('span');
    name.className = 'doctab-name';
    name.textContent = doc.name;
    tab.append(name);
    if (doc.dirty) {
      const dot = document.createElement('span');
      dot.className = 'doctab-dot';
      dot.title = 'Modifications non enregistrées';
      tab.append(dot);
    }
    const close = document.createElement('button');
    close.className = 'doctab-close';
    close.type = 'button';
    close.setAttribute('aria-label', `Fermer ${doc.name}`);
    close.tabIndex = -1;
    const ic = document.createElement('span');
    ic.className = 'ico';
    ic.dataset.icon = 'x';
    close.append(ic);
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(doc.id); });
    tab.append(close);

    tab.addEventListener('click', () => activate(doc));
    tab.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(doc.id); });
    tab.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-spinadoc-tab', String(i)); e.dataTransfer.effectAllowed = 'move'; tab.classList.add('dragging'); });
    tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
    tab.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-spinadoc-tab')) { e.preventDefault(); tab.classList.add('dragover'); } });
    tab.addEventListener('dragleave', () => tab.classList.remove('dragover'));
    tab.addEventListener('drop', (e) => {
      const from = Number(e.dataTransfer.getData('application/x-spinadoc-tab'));
      if (Number.isNaN(from)) return;
      e.preventDefault();
      store.move(from, i);
      renderTabs();
    });
    list.append(tab);
  });
}

$('doctabs').addEventListener('keydown', (e) => {
  const docs = store.docs;
  const i = docs.findIndex((d) => d === active());
  if (i < 0) return;
  let n = -1;
  if (e.key === 'ArrowRight') n = (i + 1) % docs.length;
  else if (e.key === 'ArrowLeft') n = (i - 1 + docs.length) % docs.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = docs.length - 1;
  if (n >= 0) { e.preventDefault(); activate(docs[n]); const t = $('doctabs').children[n]; if (t) t.focus(); }
});

// =====================================================================  ruban
enableTablist($('ribbon-tabs'), (tab) => {
  document.querySelectorAll('.rpanel').forEach((p) => { p.hidden = p.id !== tab.getAttribute('aria-controls'); });
});

function zoomBy(f) { const d = active(); if (d) V.setZoom(d, d.view.zoom * f); }
function setToolActive(t) { const d = active(); if (d) A.setTool(d, t); }

const commands = {
  open: openFromDialog,
  'merge-open': () => Merge.open(),
  recents: (btn) => toggleRecentsMenu(btn),
  saveas: saveActive,
  print: () => { const d = active(); if (d) Print.openPrint(d); },

  search: () => Sidebar.focusSearch(),
  undo: () => { const d = active(); if (d) A.undo(d); },
  redo: () => { const d = active(); if (d) A.redo(d); },
  'stamps-menu': (btn) => Stamps.openMenu('stamps', btn),
  'sig-menu': (btn) => Stamps.openMenu('sig', btn),
  'image-insert': () => Stamps.insertImage(),
  'obj-copy': () => { const d = active(); if (d && A.copySelection(d)) { Stamps.markInternalCopy(); refreshRibbon(); toast('Copié.', 1500); } },
  'obj-paste': () => { const d = active(); if (d) A.paste(d); },
  'obj-duplicate': () => { const d = active(); if (d) A.duplicateSelection(d); },
  'obj-delete': () => { const d = active(); if (d) A.deleteSelected(d); },
  'obj-front': () => { const d = active(); if (d) A.reorder(d, 'front'); },
  'obj-back': () => { const d = active(); if (d) A.reorder(d, 'back'); },
  props: () => { Props.toggle(); refreshRibbon(); },
  'zoom-in': () => zoomBy(1.15),
  'zoom-out': () => zoomBy(1 / 1.15),
  'fit-width': () => { const d = active(); if (d) V.fit(d, 'width'); },
  'fit-page': () => { const d = active(); if (d) V.fit(d, 'page'); },
  'mode-continuous': () => { const d = active(); if (d) V.setMode(d, 'continuous'); },
  'mode-single': () => { const d = active(); if (d) V.setMode(d, 'single'); },
  spread: () => { const d = active(); if (d) V.setSpread(d, d.view.spread === 2 ? 1 : 2); },
  'rotate-right': () => { const d = active(); if (d) V.rotateView(d, 90); },
  'rotate-left': () => { const d = active(); if (d) V.rotateView(d, -90); },
  fullscreen: async () => { await api.toggleFullscreen(); },
  sidebar: () => { Sidebar.setOpen(!Sidebar.isOpen()); refreshRibbon(); refreshStatus(); },
};
Object.assign(commands, Measures.commands);
Docs.hooks.save = (d, o) => saveDoc(d, o);
for (const k of Object.keys(FormsUI.commands)) commands[k] = () => { const d = active(); if (d) FormsUI.exec(k, d); };
commands['doc-compare'] = () => CompareUI.open(active());
Pages.hooks.ocr = (d) => OcrUI.commands['pg-ocr'](d);
for (const k of Object.keys(OcrUI.commands)) if (k !== 'pg-ocr') commands[k] = () => { const d = active(); if (d) OcrUI.commands[k](d); };
for (const k of Object.keys(Docs.commands)) commands[k] = () => { const d = active(); if (d) Docs.exec(k, d); };
for (const k of Object.keys(Pages.commands)) commands[k] = () => { const d = active(); if (d) Pages.exec(k, d); };
for (const k of Object.keys(RedactUI.commands)) commands[k] = () => { const d = active(); if (d) RedactUI.commands[k](d); };
for (const k of Object.keys(FieldsUI.commands)) commands[k] = () => { const d = active(); if (d) FieldsUI.commands[k](d); };
commands['fld-order'] = () => FieldsOrder.open(active());
for (const k of Object.keys(Align.MODES)) commands[k] = () => Align.align(active(), Align.MODES[k]);

$('ribbon').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b || b.disabled) return;
  const fn = commands[b.dataset.cmd] || (b.dataset.cmd.startsWith('tool-') ? () => setToolActive(b.dataset.cmd.slice(5)) : null);
  if (fn) fn(b);
});

// =====================================================================  barre d'état
$('sb-toggle').addEventListener('click', () => commands.sidebar());
$('sb-corner').addEventListener('click', () => commands.sidebar());
$('props-toggle').addEventListener('click', () => commands.props());
$('page-prev').addEventListener('click', () => { const d = active(); if (d) V.pageStep(d, -1); });
$('page-next').addEventListener('click', () => { const d = active(); if (d) V.pageStep(d, 1); });
$('in-page').addEventListener('change', (e) => {
  const d = active();
  if (!d) return;
  const n = Math.min(V.pageCount(d), Math.max(1, Number(e.target.value) || 1));
  V.goToPage(d, n - 1);
  e.target.value = n;
});
$('zoom-in').addEventListener('click', () => zoomBy(1.15));
$('zoom-out').addEventListener('click', () => zoomBy(1 / 1.15));
$('zoom-range').addEventListener('input', (e) => { const d = active(); if (d) V.setZoom(d, (Number(e.target.value) / 100) * V.CSS_100); });
$('btn-newtab').addEventListener('click', openFromDialog);

// =====================================================================  accueil et fichiers récents
function recentItem(r) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'recent-item';
  b.setAttribute('role', 'menuitem');
  const ic = document.createElement('span');
  ic.className = 'ico';
  ic.dataset.icon = 'file-text';
  const t = document.createElement('span');
  t.className = 'recent-text';
  const n = document.createElement('span');
  n.className = 'recent-name';
  n.textContent = r.name;
  const p = document.createElement('span');
  p.className = 'recent-path';
  p.textContent = r.path;
  t.append(n, p);
  b.append(ic, t);
  b.title = r.path;
  b.addEventListener('click', () => { closeRecentsMenu(); openFiles([r.path]); });
  return b;
}

let recents = [];
async function loadRecents() {
  recents = await api.listRecents();
  const ul = $('recents-list');
  ul.replaceChildren();
  recents.forEach((r) => { const li = document.createElement('li'); li.append(recentItem(r)); ul.append(li); });
  $('welcome-recents').hidden = recents.length === 0;
}

$('welcome-open').addEventListener('click', openFromDialog);
$('recents-clear').addEventListener('click', async () => { await api.clearRecents(); await loadRecents(); });

function toggleRecentsMenu(btn) {
  const menu = $('recents-menu');
  if (!menu.hidden) return closeRecentsMenu();
  menu.replaceChildren();
  if (!recents.length) {
    const e = document.createElement('div');
    e.className = 'menu-empty';
    e.textContent = 'Aucun fichier récent.';
    menu.append(e);
  } else {
    recents.forEach((r) => menu.append(recentItem(r)));
  }
  const rect = btn.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 440)) + 'px';
  menu.style.top = rect.bottom + 6 + 'px';
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('button');
  if (first) first.focus();
}
function closeRecentsMenu() {
  $('recents-menu').hidden = true;
  document.querySelectorAll('[data-cmd=recents]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}
document.addEventListener('mousedown', (e) => {
  if (!$('recents-menu').hidden && !e.target.closest('#recents-menu') && !e.target.closest('[data-cmd=recents]')) closeRecentsMenu();
});

// =====================================================================  réglages et « À propos »
function openDialog(id) { $(id).hidden = false; const f = $(id).querySelector('button, input'); if (f) f.focus(); }
function closeDialog(id) { $(id).hidden = true; }

$('btn-settings').addEventListener('click', () => {
  document.querySelectorAll('input[name=anim]').forEach((r) => { r.checked = r.value === getAnim(); });
  $('opt-keeptool').checked = Settings.get('keepTool') !== false;
  $('opt-panmiddle').checked = Settings.get('panMiddle') !== false;
  $('opt-username').value = Settings.get('userName') || '';
  openDialog('settings');
});
document.querySelectorAll('input[name=anim]').forEach((r) => r.addEventListener('change', () => setAnim(r.value)));
$('opt-keeptool').addEventListener('change', (e) => Settings.set('keepTool', e.target.checked));
$('opt-panmiddle').addEventListener('change', (e) => Settings.set('panMiddle', e.target.checked));
$('opt-username').addEventListener('change', (e) => Settings.set('userName', e.target.value.trim()));
$('settings-close').addEventListener('click', () => closeDialog('settings'));
$('btn-winint').addEventListener('click', () => { closeDialog('settings'); WinInt.open(); });
$('btn-about').addEventListener('click', async () => {
  const info = await api.getAbout();
  $('about-title').textContent = info.name;
  $('about-version').textContent = `Version ${info.version}` + (info.buildDate ? ` — build du ${info.buildDate.split('-').reverse().join('/')}` : ' — version de développement');
  $('about-copyright').textContent = info.copyright;
  $('about-net').textContent = `Requêtes réseau bloquées depuis le démarrage : ${info.net.blocked}.`;
  $('about-diag-msg').textContent = '';
  $('about-licenses').textContent = info.licenses;
  closeDialog('settings');
  openDialog('about');
});
$('about-close').addEventListener('click', () => closeDialog('about'));
$('about-diag').addEventListener('click', async () => {
  try { await api.diagnostic(); $('about-diag-msg').textContent = 'Copié dans le presse-papiers.'; } catch (err) { $('about-diag-msg').textContent = 'Échec : ' + (err && err.message ? err.message : err); }
});
['settings', 'about'].forEach((id) => $(id).addEventListener('mousedown', (e) => { if (e.target === $(id)) closeDialog(id); }));

// =====================================================================  glisser-déposer de fichiers
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); $('stage').classList.add('dragging'); } });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('stage').classList.remove('dragging'); });
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  $('stage').classList.remove('dragging');
  const files = Array.from(e.dataTransfer.files);
  if (Merge.isOpen() || CompareUI.isOpen()) return; // l'espace de fusion gère lui-même le dépôt
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
  const images = files.filter((f) => /\.(png|jpe?g)$/i.test(f.name));
  if (!pdfs.length && !images.length) return toast('Ce fichier n\'est pas un PDF.');
  // Images déposées sur la page : posées au point de dépôt (dans le document actif).
  if (images.length && active()) await Stamps.dropImages(active(), images, e.clientX, e.clientY);
  else if (images.length) toast('Ouvrez d\'abord un PDF pour y déposer une image.');
  if (pdfs.length) await openFiles(pdfs.map((f) => api.getPathForFile(f)).filter(Boolean));
});

// =====================================================================  clavier
document.addEventListener('keydown', async (e) => {
  if (['unsaved', 'choice', 'stampdlg', 'sigdlg', 'printdlg', 'mcdlg', 'pgdlg', 'mergews', 'cmpws'].some((id) => !$(id).hidden)) return; // les boîtes modales gèrent le clavier
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const inTextarea = e.target.tagName === 'TEXTAREA';
  const inField = inTextarea || ['INPUT', 'SELECT'].includes(e.target.tagName);
  const doc = active();

  // Ctrl+V : image du presse-papiers (nouvelle) ou objets copiés dans l'application.
  if (ctrl && key === 'v' && doc && !inField) { e.preventDefault(); Stamps.pasteFromClipboard(doc); return; }
  if (ctrl && key === 'c' && doc && !inField && doc.selection.length) Stamps.markInternalCopy();

  // Objets d'annotation : Échap, Entrée (fin de polygone), Ctrl+C/X/V/D, flèches (déplacement fin).
  const dialogOpen = !$('settings').hidden || !$('about').hidden || !$('winint').hidden || !$('recents-menu').hidden || !$('lib-menu').hidden;
  if (doc && !inField && !(e.key === 'Escape' && dialogOpen) && A.handleKey(doc, e)) { e.preventDefault(); return; }

  if (ctrl && key === 'o') { e.preventDefault(); openFromDialog(); }
  else if (ctrl && key === 's') { e.preventDefault(); saveActive(); }
  else if (ctrl && key === 'p') { e.preventDefault(); if (doc) Print.openPrint(doc); }
  else if (ctrl && key === 'w') { e.preventDefault(); if (doc) closeTab(doc.id); }
  else if (ctrl && key === 'tab') { e.preventDefault(); store.cycle(e.shiftKey ? -1 : 1); activate(active()); }
  else if (ctrl && key === 'f') { e.preventDefault(); if (doc) Sidebar.focusSearch(); }
  else if (ctrl && key === 'z' && !inTextarea) { e.preventDefault(); if (doc) (e.shiftKey ? A.redo : A.undo)(doc); }
  else if (ctrl && key === 'y' && !inTextarea) { e.preventDefault(); if (doc) A.redo(doc); }
  else if (ctrl && e.shiftKey && (key === '+' || key === '=')) { e.preventDefault(); if (doc) Pages.exec('pg-rot-right', doc); }
  else if (ctrl && e.shiftKey && (key === '-' || key === '_')) { e.preventDefault(); if (doc) Pages.exec('pg-rot-left', doc); }
  else if (ctrl && (key === '+' || key === '=')) { e.preventDefault(); zoomBy(1.15); }
  else if (ctrl && key === '-') { e.preventDefault(); zoomBy(1 / 1.15); }
  else if (ctrl && key === 'c' && !inField) {
    // Sans menu d'application, on déclenche la copie nous-mêmes (texte sélectionné de la page).
    if (window.getSelection().toString()) document.execCommand('copy');
  }
  else if (e.key === 'F1') { e.preventDefault(); if (Help.isOpen()) Help.close(); else Help.open(); }
  else if (e.key === 'F11') { e.preventDefault(); api.toggleFullscreen(); }
  else if (e.key === 'F4') { e.preventDefault(); commands.sidebar(); }
  else if (e.key === 'Delete' && !inField && doc) A.deleteSelected(doc);
  else if (e.key === 'Escape') {
    if (!$('settings').hidden) closeDialog('settings');
    else if (!$('about').hidden) closeDialog('about');
    else if (!$('winint').hidden) closeDialog('winint');
    else if (!$('recents-menu').hidden) closeRecentsMenu();
    else if (!$('lib-menu').hidden) Stamps.closeMenu();
    else if (!inField) {
      if (await api.isFullscreen()) api.toggleFullscreen();

    }
  }
  else if (!inField && doc && !e.target.closest('[role=tab], [role=menu], select')
    && !(e.key === ' ' && e.target.closest('button'))
    && V.handleNavKey(doc, e)) {
    e.preventDefault();
  }
});

// =====================================================================  démarrage
(async function init() {
  await initAnim();
  await Settings.loadSettings();
  await Stamps.initStamps();
  Sidebar.initSidebar();
  Props.initProps();
  Measures.initMeasure();
  initPan();
  Print.initPrint();
  Pages.initCropBar();
  NumUI.init();
  FormsUI.init();
  FormsUI.hooks.openResult = async (name, bytes) => { await openBytesTab(name, bytes); };
  Merge.initMerge();
  CompareUI.initCompare();
  CalloutUI.initCallout();
  RedactUI.initRedact();
  FieldsUI.initFields();
  Help.initHelp();
  Merge.hooks.openResult = openMerged;
  refreshAll();
  startupSpin();
  await loadRecents();
  api.onOpenFile((p) => openFiles([p]));
  // Fermeture de la fenêtre : pose la question s'il y a des modifications, puis confirme à Electron.
  api.onRequestClose(async () => {
    if (!(await resolveUnsaved(store.docs.filter((d) => d.dirty), 'quitter'))) return;
    // impression en cours : demande confirmation (quitter l'annulerait)
    if ((await api.printActive()) > 0) {
      const c = await askChoice({ title: 'Impression en cours', message: 'Une impression est en cours ou en attente. Quitter maintenant l\'interrompt.', buttons: [{ id: 'quit', label: 'Quitter quand même' }, { id: 'stay', label: 'Attendre', primary: true }] });
      if (c !== 'quit') return;
    }
    api.confirmClose();
  });
  const initial = await api.getInitialFiles();
  if (initial.length) await openFiles(initial);
})();

// Un clic souris sur un bouton du ruban ou de la barre d'état ne doit pas lui donner le focus clavier :
// sinon Espace / flèches réactiveraient le bouton au lieu de naviguer dans le document.
// (Au clavier, Tab continue de focaliser et d'activer les boutons normalement.)
['ribbon', 'statusbar', 'sb-corner'].forEach((id) => $(id).addEventListener('mousedown', (e) => {
  if (e.target.closest('button.rbtn, button.icon-btn')) e.preventDefault();
}));
