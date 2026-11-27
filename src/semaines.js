// Ensoleillement d'une zone (piscine) à partir des masques d'horizon de ses points : heures par semaine sur l'année,
// part de chaque heure au soleil (pour la température de l'eau) et facteur de vue du ciel. Sans three.js ni DOM.
//
// Semaines : blocs de 7 jours depuis le 1er janvier (semaine 1 = 1–7 janvier) ; la 52e reçoit aussi le 31 décembre
// (et le 30 en année bissextile). Positions du soleil au pas de 10 minutes, comptées si le soleil est à plus de 0,5°
// et au-dessus du relief lointain (mêmes règles que `soleilsPeriode`).
import { positionSoleil } from "./soleil.js";
import { horizonA } from "./horizon.js";

export const NB_AZ = 720; // pas de 0,5°

/** Point dans un polygone (anneaux : extérieur puis trous ; règle pair-impair). */
export function dansPoly(x, y, anneaux) {
  let ok = false;
  for (const a of anneaux) for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i], [xj, yj] = a[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}

/** Aire (m²) et périmètre (m) d'un polygone (anneau extérieur moins les trous). */
export function aireEtPerimetre(anneaux) {
  let aire = 0, perim = 0;
  anneaux.forEach((a, k) => {
    let s = 0;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) { s += a[j][0] * a[i][1] - a[i][0] * a[j][1]; perim += Math.hypot(a[i][0] - a[j][0], a[i][1] - a[j][1]); }
    aire += (k ? -1 : 1) * Math.abs(s / 2);
  });
  return { aire, perim };
}

/**
 * Points de mesure d'une zone : centres des cellules de la grille (0,5 m) dont le centre est dans le polygone
 * (coordonnées relatives au centre de la maquette). Rasterisation par bandes : une seule boîte englobante, pas de
 * test sur toute la grille. Une zone plus fine qu'une cellule garde son centre de gravité.
 * @returns {{ ij: Float32Array (i, j en cellules, centre), xy: number[][] }}
 */
export function pointsZone(G, anneaux) {
  const pts = anneaux[0], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const cl = v => Math.max(0, Math.min(G.n - 1, v));
  const i0 = cl(Math.floor((Math.min(...xs) - G.x0) / G.c)), i1 = cl(Math.ceil((Math.max(...xs) - G.x0) / G.c));
  const j0 = cl(Math.floor((Math.min(...ys) - G.x0) / G.c)), j1 = cl(Math.ceil((Math.max(...ys) - G.x0) / G.c));
  const ij = [], xy = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = G.x0 + (i + 0.5) * G.c, y = G.x0 + (j + 0.5) * G.c;
    if (dansPoly(x, y, anneaux)) { ij.push(i + 0.5, j + 0.5); xy.push([x, y]); }
  }
  if (!xy.length) {
    const x = xs.reduce((a, b) => a + b) / xs.length, y = ys.reduce((a, b) => a + b) / ys.length;
    ij.push((x - G.x0) / G.c, (y - G.x0) / G.c); xy.push([x, y]);
  }
  return { ij: Float32Array.from(ij), xy };
}

/** Masque combiné : hauteur d'obstruction proche (demi-degrés) et horizon lointain ; en degrés, Float32 (N × 720). */
export function masquesDegres(masques, N, horizon) {
  const m = new Float32Array(N * NB_AZ), loin = new Float32Array(NB_AZ);
  for (let a = 0; a < NB_AZ; a++) loin[a] = horizon ? horizonA(horizon, a * 0.5) : 0;
  for (let q = 0; q < N; q++) for (let a = 0; a < NB_AZ; a++) m[q * NB_AZ + a] = Math.max(masques[q * NB_AZ + a] / 2, loin[a]);
  return m;
}

/** Facteur de vue du ciel moyen d'une surface horizontale : moyenne sur l'azimut de cos²(hauteur du masque). */
export function facteurCiel(m, N) {
  let s = 0;
  for (let q = 0; q < N; q++) for (let a = 0; a < NB_AZ; a++) { const c = Math.cos(Math.max(0, m[q * NB_AZ + a]) * Math.PI / 180); s += c * c; }
  return s / (N * NB_AZ);
}

const JOUR = 86400000;
/** Nombre de jours de l'année `an`. */
const joursAn = an => (Date.UTC(an + 1, 0, 1) - Date.UTC(an, 0, 1)) / JOUR;
/** Semaine (0…51) d'un jour de l'année (0…364/365). */
export const semaineDe = jour => Math.min(51, Math.floor(jour / 7));

/**
 * Heures de soleil par semaine sur la zone, au pas de 10 minutes, pour l'année `an`.
 * @returns {{ recues: Float64Array(52), possibles: Float64Array(52) (h/jour en moyenne de la semaine et de la zone),
 *   parPoint: Float64Array(N) (h/jour en moyenne annuelle), parPointSaison: Float64Array(N) (mai–septembre),
 *   saison: { recues, possibles } (h/jour, mai–septembre) }}
 */
export function heuresParSemaine(m, N, an, lat, lon, horizon, pas = 10) {
  const nj = joursAn(an), recues = new Float64Array(52), possibles = new Float64Array(52), jours = new Float64Array(52);
  const parPoint = new Float64Array(N), parPointSaison = new Float64Array(N);
  const debutSaison = (Date.UTC(an, 4, 1) - Date.UTC(an, 0, 1)) / JOUR, finSaison = (Date.UTC(an, 9, 1) - Date.UTC(an, 0, 1)) / JOUR;
  let sR = 0, sP = 0;
  const d = pas / 60;
  for (let jour = 0; jour < nj; jour++) {
    const w = semaineDe(jour), enSaison = jour >= debutSaison && jour < finSaison;
    jours[w]++;
    // minuit local ≈ 22 h ou 23 h UTC : on parcourt la journée UTC entière, le total du jour ne dépend pas du fuseau
    const t0 = Date.UTC(an, 0, 1) + jour * JOUR;
    for (let t = 0; t < 1440; t += pas) {
      const p = positionSoleil(new Date(t0 + (t + pas / 2) * 60000), lat, lon);
      if (!(p.hauteur > 0.5 && p.hauteur > (horizon ? horizonA(horizon, p.azimut) : 0))) continue;
      possibles[w] += d;
      if (enSaison) sP += d;
      const a = Math.round(p.azimut * 2) % NB_AZ;
      let k = 0;
      for (let q = 0; q < N; q++) if (p.hauteur > m[q * NB_AZ + a]) { k++; parPoint[q] += d; if (enSaison) parPointSaison[q] += d; }
      recues[w] += d * k / N;
      if (enSaison) sR += d * k / N;
    }
  }
  const jS = finSaison - debutSaison;
  for (let w = 0; w < 52; w++) { recues[w] /= jours[w]; possibles[w] /= jours[w]; }
  for (let q = 0; q < N; q++) { parPoint[q] /= nj; parPointSaison[q] /= jS; }
  return { recues, possibles, parPoint, parPointSaison, saison: { recues: sR / jS, possibles: sP / jS } };
}

/**
 * Part de la zone au soleil pour chaque heure UTC d'une année type (365 × 24, indice jour × 24 + heure, l'heure
 * couvrant [h, h+1[), en moyenne de 4 positions par heure ; et hauteur du soleil au milieu de l'heure (degrés).
 * Sert à la température de l'eau et à l'ensoleillement réel (heures de soleil mesurées par la station).
 */
export function partHoraire(m, N, lat, lon, horizon, an = 2025) {
  const f = new Float32Array(365 * 24), libre = new Float32Array(365 * 24), hauteur = new Float32Array(365 * 24);
  for (let jour = 0; jour < 365; jour++) for (let h = 0; h < 24; h++) {
    const t0 = Date.UTC(an, 0, 1) + jour * JOUR + h * 3600000, k = jour * 24 + h;
    hauteur[k] = positionSoleil(new Date(t0 + 1800000), lat, lon).hauteur;
    for (let s = 0; s < 4; s++) {
      const p = positionSoleil(new Date(t0 + (s + 0.5) * 900000), lat, lon);
      if (!(p.hauteur > 0.5 && p.hauteur > (horizon ? horizonA(horizon, p.azimut) : 0))) continue;
      libre[k] += 0.25;
      const a = Math.round(p.azimut * 2) % NB_AZ;
      let c = 0;
      for (let q = 0; q < N; q++) if (p.hauteur > m[q * NB_AZ + a]) c++;
      f[k] += 0.25 * c / N;
    }
  }
  return { f, libre, hauteur };
}

/** Indice (jour de l'année type × 24 + heure UTC) d'un instant ; le 29 février et le 31 décembre bissextile sont ramenés. */
export function indiceHoraire(ms) {
  const d = new Date(ms), an = d.getUTCFullYear();
  let jour = Math.floor((ms - Date.UTC(an, 0, 1)) / JOUR);
  if (joursAn(an) === 366 && jour >= 59) jour = Math.max(59, jour - 1);
  return Math.min(364, jour) * 24 + d.getUTCHours();
}
