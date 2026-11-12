// Fenêtre de travail cachée de l'impression (src/print-worker.html) : un processus de rendu à part, donc l'interface de l'application ne gèle jamais.
// Reçoit du processus principal une tâche figée { id, edBytes, groups, raster, name } (PDF « édité » + feuilles à composer), assemble le PDF
// d'impression de chaque tâche (vectoriel), le rasterise par bandes si demandé, puis le rend au processus principal qui l'envoie à l'imprimante.
import { rasterize } from './print-raster.js';

const { PDFLib, PrintCompose: C, PrintLayout: L } = window;
const api = window.spinadoc;
const cancelled = new Set();

api.onWorkerCancel((id) => cancelled.add(id));
api.onWorkerRun(async (task) => {
  const { id } = task;
  const total = task.groups.reduce((n, g) => n + g.sheets.length, 0);
  let done = 0;
  const progress = (f, label) => api.workerProgress({ id, fraction: Math.min(1, f / Math.max(1, total)), sheet: Math.min(total, Math.floor(f) + 1), total, label });
  try {
    for (let gi = 0; gi < task.groups.length; gi++) {
      if (cancelled.has(id)) throw new Error('Impression annulée');
      const g = task.groups[gi];
      const title = L.jobTitle(task.name, gi, task.groups.length);
      progress(done, 'Préparation');
      let bytes = await C.compose(PDFLib, task.edBytes, g.sheets, { title });
      if (task.raster) {
        const r = task.raster;
        bytes = await rasterize(bytes, {
          mode: r.mode, dpi: r.dpi, minLineMm: r.thin, title,
          onProgress: (f) => progress(done + f * g.sheets.length, 'Rasterisation'),
          shouldCancel: () => cancelled.has(id),
        });
      }
      done += g.sheets.length;
      progress(done, 'Envoi');
      await api.workerJob({ id, index: gi, count: task.groups.length, bytes, wMm: L.toMm(g.w), hMm: L.toMm(g.h), title, fileName: L.jobFileName(task.name, gi, task.groups.length) });
    }
    api.workerDone({ id });
  } catch (e) {
    api.workerDone({ id, error: String((e && e.message) || e) });
  } finally { cancelled.delete(id); }
});
api.workerReady();
