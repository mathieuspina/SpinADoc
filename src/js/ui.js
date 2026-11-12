// Utilitaires d'interface partagés : accès DOM, bus d'événements, notifications, indicateur de chargement.
export const $ = (id) => document.getElementById(id);
export const api = window.spinadoc;
export const store = window.DocModel.createStore();

// Bus d'événements minimal. Événements : 'doc-changed', 'page', 'zoom', 'view', 'tool', 'tabs'.
const target = new EventTarget();
export const bus = {
  on: (name, fn) => target.addEventListener(name, (e) => fn(e.detail)),
  emit: (name, detail) => target.dispatchEvent(new CustomEvent(name, { detail })),
};

let toastTimer = null;
export function toast(msg, ms = 4500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Indicateur de chargement (la page du logo qui tourne). Retourne la fonction qui l'arrête.
// Affiché seulement si l'attente dépasse ~150 ms, pour éviter les clignotements.
let busyCount = 0;
let busyTimer = null;
export function busy(label) {
  busyCount++;
  $('busy-label').textContent = label || 'Chargement…';
  if (!busyTimer && $('busy').hidden) busyTimer = setTimeout(() => { busyTimer = null; if (busyCount > 0) $('busy').hidden = false; }, 150);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    busyCount = Math.max(0, busyCount - 1);
    if (busyCount === 0) {
      clearTimeout(busyTimer);
      busyTimer = null;
      $('busy').hidden = true;
    }
  };
}

// Boîte de choix modale de l'application. buttons : [{ id, label, primary? }] ; renvoie l'id choisi (Échap = dernier bouton).
export function askChoice({ title, message, buttons }) {
  return new Promise((resolve) => {
    const dlg = $('choice');
    $('choice-title').textContent = title;
    $('choice-msg').textContent = message;
    const row = $('choice-actions');
    row.replaceChildren();
    const finish = (id) => { dlg.hidden = true; dlg.removeEventListener('keydown', onKey, true); resolve(id); };
    const nodes = buttons.map((b) => {
      const e = document.createElement('button');
      e.type = 'button';
      e.className = b.primary ? 'primary' : 'secondary';
      e.textContent = b.label;
      e.addEventListener('click', () => finish(b.id));
      row.append(e);
      return e;
    });
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(buttons[buttons.length - 1].id); }
      else if (e.key === 'Tab') { e.preventDefault(); const i = nodes.indexOf(document.activeElement); nodes[(i + (e.shiftKey ? -1 : 1) + nodes.length) % nodes.length].focus(); }
      else e.stopPropagation();
    }
    dlg.addEventListener('keydown', onKey, true);
    dlg.hidden = false;
    (nodes.find((n) => n.className === 'primary') || nodes[0]).focus();
  });
}

// Applique un rôle « boutons radio / onglets » avec navigation clavier (flèches, Début, Fin).
export function enableTablist(list, onSelect) {
  const tabs = () => Array.from(list.querySelectorAll('[role=tab]'));
  const select = (tab, focus) => {
    tabs().forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    if (focus) tab.focus();
    onSelect(tab);
  };
  list.addEventListener('click', (e) => { const t = e.target.closest('[role=tab]'); if (t && list.contains(t)) select(t, false); });
  list.addEventListener('keydown', (e) => {
    const all = tabs();
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (e.key === 'ArrowRight') n = all[(i + 1) % all.length];
    else if (e.key === 'ArrowLeft') n = all[(i - 1 + all.length) % all.length];
    else if (e.key === 'Home') n = all[0];
    else if (e.key === 'End') n = all[all.length - 1];
    if (n) { e.preventDefault(); select(n, true); }
  });
  return select;
}
