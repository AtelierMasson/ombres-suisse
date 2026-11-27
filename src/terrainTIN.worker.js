// Terrain TIN calculé hors du fil principal (la page reste fluide pendant la simplification).
import { calculerTIN, masqueTIN } from "./tinNoyau.js";

self.onmessage = ({ data: { id, h, n, c, x0, rayon, tolerance, maxSommets } }) => {
  try {
    const r = calculerTIN({ h, n, tolerance, maxSommets, masque: masqueTIN(n, c, x0, rayon) });
    self.postMessage({ id, ...r }, [r.coords.buffer, r.z.buffer, r.triangles.buffer]);
  } catch (e) { self.postMessage({ id, erreur: e.message }); }
};
