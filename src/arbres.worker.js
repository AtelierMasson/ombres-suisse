// Segmentation des arbres un par un hors du fil principal (arbresSegmentation.js). Reçoit la grille (sol, végétation)
// et les points de végétation ; rend le tableau des arbres, transféré sans copie.
import { segmenterArbres } from "./arbresSegmentation.js";

self.onmessage = ({ data: { id, G, pts } }) => {
  try {
    const r = segmenterArbres(G, pts);
    self.postMessage({ id, ...r }, [r.arbres.buffer]);
  } catch (e) {
    self.postMessage({ id, erreur: e.message || String(e) });
  }
};
