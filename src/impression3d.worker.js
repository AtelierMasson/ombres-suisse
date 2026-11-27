// Fil de calcul de l'impression 3D : reçoit les grilles du lieu et les toits, renvoie les solides (sommets en mm et
// triangles, par tuile) sans bloquer la fenêtre ; l'avancement est signalé étape par étape.
import { calculerImpression } from "./impression3d.js";

self.onmessage = ({ data: { d, o } }) => {
  try {
    const r = calculerImpression(d, o, (etape, part) => self.postMessage({ etape, part }));
    self.postMessage({ ok: true, r }, r.tuiles.flatMap(t => [t.pos.buffer, t.idx.buffer]));
  } catch (e) { self.postMessage({ ok: false, erreur: e.message }); }
};
