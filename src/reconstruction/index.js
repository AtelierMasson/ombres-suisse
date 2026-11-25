// Reconstruction des bâtiments (LoD2, code maison) : emprises officielles + nuage swissSURFACE3D.
// Sans DOM ni three.js : utilisable dans un fil de calcul ou sous Node. Sortie au format des fichiers
// public/essais/roofer_*.json : { origine, source, batiments, polygones: [{ t: "toit" | "mur", r: [anneaux [x, y, z]] }] },
// x et y relatifs à l'origine (MN95), z absolu.
import { reconstruireBatiment } from "./batiment.js";
import { boite } from "./geometrie.js";

export { emprisesOfficielles } from "./emprises.js";
export { reconstruireBatiment };

/** Index des points de classes 2 et 6 sur une grille de `pas` m ; candidats(boite) -> { x, y, z, c }. */
export function indexerPoints({ X, Y, Z, C, n }, pas = 2) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, nb = 0;
  for (let k = 0; k < n; k++) {
    if (C[k] !== 6 && C[k] !== 2) continue;
    nb++; x0 = Math.min(x0, X[k]); x1 = Math.max(x1, X[k]); y0 = Math.min(y0, Y[k]); y1 = Math.max(y1, Y[k]);
  }
  if (!nb) return () => ({ x: [], y: [], z: [], c: [] });
  const nx = Math.floor((x1 - x0) / pas) + 1, ny = Math.floor((y1 - y0) / pas) + 1, debut = new Uint32Array(nx * ny + 1);
  const cellule = k => Math.floor((Y[k] - y0) / pas) * nx + Math.floor((X[k] - x0) / pas);
  for (let k = 0; k < n; k++) if (C[k] === 6 || C[k] === 2) debut[cellule(k) + 1]++;
  for (let p = 0; p < nx * ny; p++) debut[p + 1] += debut[p];
  const ordre = new Uint32Array(nb), pose = debut.slice(0, nx * ny);
  for (let k = 0; k < n; k++) if (C[k] === 6 || C[k] === 2) ordre[pose[cellule(k)]++] = k;
  return ([a0, b0, a1, b1]) => {
    const i0 = Math.max(0, Math.floor((a0 - x0) / pas)), i1 = Math.min(nx - 1, Math.floor((a1 - x0) / pas));
    const j0 = Math.max(0, Math.floor((b0 - y0) / pas)), j1 = Math.min(ny - 1, Math.floor((b1 - y0) / pas));
    let q = 0;
    if (i1 >= i0) for (let j = j0; j <= j1; j++) q += debut[j * nx + i1 + 1] - debut[j * nx + i0];
    const x = new Float64Array(q), y = new Float64Array(q), z = new Float64Array(q), c = new Uint8Array(q);
    q = 0;
    if (i1 >= i0) for (let j = j0; j <= j1; j++) for (let t = debut[j * nx + i0], f = debut[j * nx + i1 + 1]; t < f; t++) {
      const k = ordre[t];
      x[q] = X[k]; y[q] = Y[k]; z[q] = Z[k]; c[q] = C[k]; q++;
    }
    return { x, y, z, c };
  };
}

/**
 * Reconstruit tous les bâtiments.
 * @param points  nuage { X, Y, Z, C, n } relatif à l'origine (Z absolu), comme chargerNuage (src/nuage.js)
 * @param origine [E0, N0] MN95
 * @param emprises [{ id, egid, anneaux: [[E, N], …][] }] en MN95 (emprisesOfficielles)
 * @param options  { boite: [e0, n0, e1, n1] MN95 pour ne garder que les emprises qui la touchent, batiment: {...} }
 * @returns {{ origine, source, batiments, polygones, details, ms }}
 */
export function reconstruire({ points, origine: [E0, N0], emprises, source = "", options = {} }) {
  const t0 = performance.now(), candidats = indexerPoints(points), details = [], polygones = [];
  for (const e of emprises) {
    const anneaux = e.anneaux.map(a => a.map(p => [p[0] - E0, p[1] - N0]));
    const [x0, y0, x1, y1] = boite(anneaux);
    if (options.boite && (x1 + E0 < options.boite[0] || x0 + E0 > options.boite[2] || y1 + N0 < options.boite[1] || y0 + N0 > options.boite[3])) continue;
    const m = 3;
    let r;
    try {
      r = reconstruireBatiment({ id: e.id, anneaux, ...candidats([x0 - m, y0 - m, x1 + m, y1 + m]) }, options.batiment);
    } catch (err) {
      r = { id: e.id, niveau: null, polygones: [], motif: "erreur : " + err.message, ms: 0 };
    }
    details.push({ id: r.id, egid: e.egid ?? null, niveau: r.niveau, plans: r.plans, qualite: r.qualite, zSol: r.zSol, zToit: r.zToit, ms: r.ms, motif: r.motif, debut: polygones.length, nb: r.polygones.length });
    for (const p of r.polygones) polygones.push(p);
  }
  const ms = performance.now() - t0;
  return {
    origine: [E0, N0],
    source: `Reconstruction maison (pans détectés, partition par droites) : ${source} + swissSURFACE3D`,
    batiments: details.filter(d => d.niveau).length,
    polygones, details, ms,
  };
}

/** JSON compact au format des essais roofer (les détails par bâtiment en plus). */
export const enJSON = r => JSON.stringify({ origine: r.origine, source: r.source, batiments: r.batiments, polygones: r.polygones, details: r.details.map(d => ({ id: d.id, egid: d.egid, niveau: d.niveau, plans: d.plans, debut: d.debut, nb: d.nb })) });
