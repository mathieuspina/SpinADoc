// Boîte « Ordre de tabulation » (#fldorder) : liste des champs créés dans l'ordre de tabulation (un groupe radio = une ligne), Monter / Descendre
// (boutons ou Alt+flèches), « Par position » (haut → bas, gauche → droite). Valider écrit l'ordre (propriété `tab` de chaque champ) en UNE étape
// d'historique. L'ordre sert au calque de remplissage et à l'ordre des widgets dans /Annots à l'écriture.
import { $, toast } from './ui.js';

const { DocModel, Fields } = window;

// Lignes : [{ key, label, ids }] (une par champ, une par groupe radio).
function rowsOf(doc) {
  const rows = [], groups = new Map();
  for (const f of Fields.tabOrder(doc.edits)) {
    if (f.ftype === 'radio') {
      if (groups.has(f.name)) { groups.get(f.name).ids.push(f.id); continue; }
      const r = { key: 'r:' + f.name, label: `${f.name} — boutons radio`, page: f.page, ids: [f.id] };
      groups.set(f.name, r); rows.push(r);
    } else rows.push({ key: 'f:' + f.id, label: `${f.name} — ${Fields.LABELS[f.ftype].toLowerCase()}`, page: f.page, ids: [f.id] });
  }
  return rows;
}

// Applique un ordre de lignes (tests : order = liste de clés). Renvoie true si l'ordre a changé.
export function applyRows(doc, rows) {
  const tab = {};
  let k = 0;
  for (const r of rows) for (const id of r.ids) tab[id] = k++;
  if (doc.edits.every((e) => !Fields.isField(e) || e.tab === tab[e.id])) return false;
  DocModel.commit(doc, (d) => { d.edits = d.edits.map((e) => (Fields.isField(e) && tab[e.id] !== undefined ? Object.assign({}, e, { tab: tab[e.id] }) : e)); });
  return true;
}
export function autoRows(doc) {
  const m = Fields.autoTabs(doc.edits);
  return rowsOf(doc).sort((a, b) => Math.min(...a.ids.map((i) => m[i])) - Math.min(...b.ids.map((i) => m[i])));
}

export function open(doc) {
  if (!doc) return Promise.resolve(false);
  let rows = rowsOf(doc);
  if (rows.length < 2) { toast(rows.length ? 'Un seul champ : rien à ordonner.' : 'Aucun champ créé.', 3500); return Promise.resolve(false); }
  return new Promise((resolve) => {
    const dlg = $('fldorder'), list = $('fldorder-list');
    let cur = 0;
    const draw = () => {
      list.replaceChildren(...rows.map((r, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = 'fldorder-' + i;
        li.tabIndex = -1;
        li.setAttribute('aria-selected', String(i === cur));
        li.dataset.key = r.key;
        const n = document.createElement('span'); n.className = 'fo-n'; n.textContent = String(i + 1);
        const t = document.createElement('span'); t.className = 'fo-t'; t.textContent = r.label;
        const p = document.createElement('span'); p.className = 'fo-p muted'; p.textContent = 'p. ' + (r.page + 1);
        li.append(n, t, p);
        li.addEventListener('click', () => { cur = i; draw(); list.focus(); });
        return li;
      }));
      list.setAttribute('aria-activedescendant', 'fldorder-' + cur);
      const el = list.children[cur]; if (el) el.scrollIntoView({ block: 'nearest' });
      $('fldorder-up').disabled = cur === 0; $('fldorder-down').disabled = cur === rows.length - 1;
    };
    const move = (d) => { const j = cur + d; if (j < 0 || j >= rows.length) return; [rows[cur], rows[j]] = [rows[j], rows[cur]]; cur = j; draw(); };
    const finish = (ok) => {
      dlg.hidden = true;
      dlg.removeEventListener('keydown', onKey, true);
      for (const id of ['fldorder-up', 'fldorder-down', 'fldorder-auto', 'fldorder-ok', 'fldorder-cancel']) $(id).onclick = null;
      resolve(ok ? applyRows(doc, rows) : false);
    };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); return; }
      if (e.target === list && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (e.altKey) move(e.key === 'ArrowUp' ? -1 : 1); else { cur = Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'ArrowUp' ? -1 : 1))); draw(); }
      }
      e.stopPropagation();
    }
    $('fldorder-up').onclick = () => move(-1);
    $('fldorder-down').onclick = () => move(1);
    $('fldorder-auto').onclick = () => { rows = autoRows(doc); cur = 0; draw(); };
    $('fldorder-ok').onclick = () => finish(true);
    $('fldorder-cancel').onclick = () => finish(false);
    dlg.addEventListener('keydown', onKey, true);
    dlg.hidden = false;
    draw();
    list.focus();
  });
}
