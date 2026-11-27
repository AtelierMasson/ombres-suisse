// Fil de calcul de la reconstruction « Advanced » : reçoit le nuage (relatif à l'origine) et les emprises officielles,
// renvoie les polygones (toits et murs) au format des essais roofer, sans bloquer la vue 3D.
import { reconstruire } from "./index.js";

self.onmessage = ({ data: { points, origine, emprises, source, boite } }) => {
  try {
    const r = reconstruire({ points, origine, emprises, source, options: { boite } });
    self.postMessage({ ok: true, d: { origine: r.origine, source: r.source, batiments: r.batiments, polygones: r.polygones }, ms: r.ms,
      lod2: r.details.filter(d => d.niveau === "LoD2").length, lod1: r.details.filter(d => d.niveau === "LoD1.2").length });
  } catch (e) { self.postMessage({ ok: false, erreur: e.message }); }
};
