// Liste des fichiers récents (logique pure). Le stockage disque est dans main.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Recents = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX = 10;
  const key = (p) => String(p).replace(/\//g, '\\').toLowerCase();

  // Place `filePath` en tête (sans doublon, insensible à la casse), limite à `max` entrées.
  function addRecent(list, filePath, now, max) {
    const name = String(filePath).split(/[\\/]/).pop();
    const rest = (list || []).filter((e) => key(e.path) !== key(filePath));
    return [{ path: filePath, name, date: now }].concat(rest).slice(0, max || MAX);
  }

  function removeRecent(list, filePath) {
    return (list || []).filter((e) => key(e.path) !== key(filePath));
  }

  return { addRecent, removeRecent, MAX };
});
