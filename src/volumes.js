// Mode pro : les volumes des bâtiments (contours.js) numérotés, regroupés en bâtiments entiers, avec leur fiche.
import { dans } from "./heures.js";

/**
 * Index des volumes : cellules de chaque volume et bâtiment auquel il appartient (volumes qui se touchent).
 * @returns {{ nb, cellules: Int32Array[], bati: Int32Array, parBati: number[][] }}
 */
export function indexVolumes(G, C) {
  const { n } = G, seg = C.seg;
  let nb = 0;
  for (let p = 0; p < n * n; p++) if (seg[p] >= nb) nb = seg[p] + 1;
  const compte = new Int32Array(nb), parent = Int32Array.from({ length: nb }, (_, k) => k);
  const racine = s => { while (parent[s] !== s) s = parent[s] = parent[parent[s]]; return s; };
  for (let p = 0; p < n * n; p++) {
    const s = seg[p];
    if (s < 0) continue;
    compte[s]++;
    for (const q of [p % n < n - 1 ? p + 1 : -1, p + n < n * n ? p + n : -1]) {
      if (q < 0 || seg[q] < 0 || seg[q] === s) continue;
      const a = racine(s), b = racine(seg[q]);
      if (a !== b) parent[a] = b;
    }
  }
  const cellules = Array.from(compte, q => new Int32Array(q)), rang = new Int32Array(nb);
  for (let p = 0; p < n * n; p++) if (seg[p] >= 0) cellules[seg[p]][rang[seg[p]]++] = p;
  const bati = new Int32Array(nb), parBati = [];
  for (let s = 0; s < nb; s++) { bati[s] = racine(s); (parBati[bati[s]] ||= []).push(s); }
  return { nb, cellules, bati, parBati };
}

/**
 * Fiche d'un ensemble de volumes : emprise (m²), hauteur au-dessus du sol (au plus haut et en moyenne), altitude du
 * point le plus haut, niveaux estimés à 3 m par niveau (sur la hauteur moyenne : un toit en pente ne compte pas double).
 */
export function ficheVolumes(G, C, V, ids) {
  let q = 0, haut = 0, somme = 0, sommet = -Infinity;
  const batis = new Set();
  for (const s of ids) {
    batis.add(V.bati[s]);
    for (const p of V.cellules[s]) {
      const h = C.val[p] - G.sol[p];
      q++; somme += h;
      if (h > haut) haut = h;
      if (C.val[p] > sommet) sommet = C.val[p];
    }
  }
  if (!q) return null;
  const moyenne = somme / q;
  return { volumes: ids.size, batiments: batis.size, emprise: q * G.c * G.c, haut, moyenne, sommet, niveaux: Math.max(1, Math.round(moyenne / 3)) };
}

/** Volumes situés sur la parcelle : au moins la moitié de leur emprise à l'intérieur (à défaut, au moins 4 m²). */
export function volumesParcelle(G, V, anneaux) {
  const ids = new Set(), partiels = new Set();
  if (!anneaux.length) return ids;
  const xs = anneaux.flat().map(p => p[0]), ys = anneaux.flat().map(p => p[1]);
  const xa = Math.min(...xs), xb = Math.max(...xs), ya = Math.min(...ys), yb = Math.max(...ys);
  for (let s = 0; s < V.nb; s++) {
    let k = 0;
    for (const p of V.cellules[s]) {
      const x = G.x0 + (p % G.n + 0.5) * G.c, y = G.x0 + (Math.floor(p / G.n) + 0.5) * G.c;
      if (x >= xa && x <= xb && y >= ya && y <= yb && dans(x, y, anneaux)) k++;
    }
    if (k && k >= V.cellules[s].length / 2) ids.add(s);
    else if (k * G.c * G.c >= 4) partiels.add(s);
  }
  return ids.size ? ids : partiels;
}
