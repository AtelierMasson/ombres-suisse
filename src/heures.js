// Carte des heures de soleil : zone arrondie autour de la parcelle, positions du soleil par période
// (jour, moyenne du mois, moyenne de l'année), points d'échantillonnage sur les façades et maillages colorés.
import * as THREE from "three";
import { solEn } from "./grille.js";
import { hauteurTerrain } from "./maillages.js";
import { positionSoleil, dateA } from "./soleil.js";
import { horizonA } from "./horizon.js";
import { couleurEchelle } from "./themes.js";

/* ------------------------------------------------------------------ zone */

/** Distance (en cellules) de chaque cellule à la cellule « vraie » la plus proche (transformée exacte, deux passes). */
function distances(masque, w, h) {
  const INF = 1e12, d = new Float64Array(w * h), m = Math.max(w, h);
  for (let p = 0; p < w * h; p++) d[p] = masque[p] ? 0 : INF;
  const f = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  const passe = (debut, pas, n) => {
    for (let q = 0; q < n; q++) f[q] = d[debut + q * pas];
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) {
        const r = v[k];
        s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
        if (s <= z[k]) k--; else break;
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const r = v[k];
      d[debut + q * pas] = (q - r) * (q - r) + f[r];
    }
  };
  for (let j = 0; j < h; j++) passe(j * w, 1, w);
  for (let i = 0; i < w; i++) passe(i, w, h);
  for (let p = 0; p < w * h; p++) d[p] = Math.sqrt(d[p]);
  return d;
}

export function dans(x, y, anneaux) {
  let ok = false;
  for (const a of anneaux) for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i], [xj, yj] = a[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}

/**
 * Zone de la carte : la parcelle élargie d'environ 20 m, sans angle ni encoche (dilatation de 32 m puis érosion
 * de 12 m), avec un bord fondu sur les 4 derniers mètres. `alpha` vaut 0 hors zone et 1 au cœur.
 */
export function zoneHeures(G, anneaux, { elargi = 20, lissage = 12, fondu = 4 } = {}) {
  if (!anneaux.length) anneaux = [[[-6, -6], [6, -6], [6, 6], [-6, 6], [-6, -6]]];
  const pts = anneaux.flat(), xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), marge = elargi + lissage + 2;
  const cl = v => Math.max(0, Math.min(G.n, v));
  const i0 = cl(Math.floor((Math.min(...xs) - marge - G.x0) / G.c)), i1 = cl(Math.ceil((Math.max(...xs) + marge - G.x0) / G.c));
  const j0 = cl(Math.floor((Math.min(...ys) - marge - G.x0) / G.c)), j1 = cl(Math.ceil((Math.max(...ys) + marge - G.x0) / G.c));
  const w = i1 - i0, h = j1 - j0, parcelle = new Uint8Array(w * h);
  let nb = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const x = G.x0 + (i0 + i + 0.5) * G.c, y = G.x0 + (j0 + j + 0.5) * G.c;
    if (dans(x, y, anneaux)) { parcelle[j * w + i] = 1; nb++; }
  }
  if (!nb) { // parcelle plus fine qu'une cellule : on part de son centre
    const i = Math.min(w - 1, Math.max(0, Math.round((xs.reduce((a, b) => a + b) / xs.length - G.x0) / G.c) - i0));
    const j = Math.min(h - 1, Math.max(0, Math.round((ys.reduce((a, b) => a + b) / ys.length - G.x0) / G.c) - j0));
    parcelle[j * w + i] = 1;
  }
  const d1 = distances(parcelle, w, h), dehors = new Uint8Array(w * h), rayon = (elargi + lissage) / G.c;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++)
    dehors[j * w + i] = d1[j * w + i] > rayon || i === 0 || j === 0 || i === w - 1 || j === h - 1 ? 1 : 0;
  const d2 = distances(dehors, w, h), alpha = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const t = Math.max(0, Math.min(1, (d2[p] * G.c - lissage) / fondu));
    alpha[p] = t * t * (3 - 2 * t);
  }
  return { i0, j0, i1, j1, w, h, alpha, parcelle };
}

/* ------------------------------------------------------------------ positions du soleil */

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const iso = (a, m, j) => `${a}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;

/**
 * Positions du soleil d'une période, avec leur poids en heures par jour. Seules comptent les positions au-dessus du
 * relief lointain. Pour le mois et l'année, on échantillonne quelques jours et on regroupe les positions voisines
 * (à 1–2° près) : l'ombre ne dépend que de l'azimut et de la hauteur, chaque position n'est calculée qu'une fois.
 * @returns {{ soleils: {azimut, hauteur, duree}[], max: number, titre: string, nbJours: number }}
 */
export function soleilsPeriode(periode, jour, lat, lon, horizon) {
  const [an, mois] = jour.split("-").map(Number);
  let jours = [jour], pas = 10, titre = `le ${new Date(jour + "T12:00:00").toLocaleDateString("fr-CH", { day: "numeric", month: "long" })}`;
  if (periode === "mois") {
    const fin = new Date(an, mois, 0).getDate();
    jours = [3, 8, 13, 18, 23, 28].filter(j => j <= fin).map(j => iso(an, mois, j));
    pas = 15; titre = `moyenne ${/^[ao]/.test(MOIS[mois - 1]) ? "d'" : "de "}${MOIS[mois - 1]}`;
  } else if (periode === "annee") {
    jours = [];
    for (let m = 1; m <= 12; m++) jours.push(iso(an, m, 1), iso(an, m, 16));
    pas = 20; titre = "moyenne annuelle";
  }
  const groupes = new Map(), fin = periode === "jour" ? 1 : 1 / jours.length, finesse = periode === "annee" ? 2 : 1; // degrés d'azimut par groupe
  let max = 0;
  for (const j of jours) for (let t = 0; t < 1440; t += pas) {
    const p = positionSoleil(dateA(j, t + pas / 2), lat, lon);
    if (!(p.hauteur > 0.5 && p.hauteur > horizonA(horizon, p.azimut))) continue;
    const d = pas / 60 * fin, k = periode === "jour" ? t : Math.round(p.azimut / finesse) * 100 + Math.round(p.hauteur);
    max += d;
    const g = groupes.get(k);
    if (g) { g.az += p.azimut * d; g.h += p.hauteur * d; g.duree += d; } else groupes.set(k, { az: p.azimut * d, h: p.hauteur * d, duree: d });
  }
  const soleils = [...groupes.values()].map(g => ({ azimut: g.az / g.duree, hauteur: g.h / g.duree, duree: g.duree }));
  return { soleils, max, titre, nbJours: jours.length };
}

/* ------------------------------------------------------------------ façades */

/**
 * Carreaux d'environ 1 m × 1 m sur les murs des bâtiments de la zone. Chaque carreau a un point de mesure
 * légèrement décollé du mur (vers l'extérieur) : `pts` = [i, j (en cellules), altitude, nx, ny] par carreau.
 */
export function carreauxFacades(G, C, zone) {
  const pts = [], carreaux = [];
  const alphaEn = (x, y) => {
    const i = Math.floor((x - G.x0) / G.c) - zone.i0, j = Math.floor((y - G.x0) / G.c) - zone.j0;
    return i < 0 || j < 0 || i >= zone.w || j >= zone.h ? 0 : zone.alpha[j * zone.w + i];
  };
  for (const B of C.boucles) {
    const q = B.coins.length, S = B.sommets.length;
    for (let s = 0; s < S; s++) {
      // un côté : ligne des coins entre deux sommets, avec la hauteur du toit à chaque coin
      const k0 = B.sommets[s], k1 = s + 1 < S ? B.sommets[s + 1] : B.sommets[0] + q, L = [0], P = [];
      for (let k = k0; k <= k1; k++) {
        const a = B.coins[k % q];
        if (P.length) L.push(L[L.length - 1] + Math.hypot(C.px[a] - P[P.length - 1][0], C.py[a] - P[P.length - 1][1]));
        P.push([C.px[a], C.py[a], B.hauts[k % q]]);
      }
      const long = L[L.length - 1];
      if (long < 0.6) continue;
      const dx = (P[P.length - 1][0] - P[0][0]), dy = (P[P.length - 1][1] - P[0][1]), dl = Math.hypot(dx, dy) || 1;
      const nx = dy / dl, ny = -dx / dl; // bâtiment à gauche : l'extérieur est à droite
      let r = 0;
      const en = u => { // point du côté à la distance u : [x, y, toit, sol]
        while (r < L.length - 2 && L[r + 1] < u) r++;
        while (r > 0 && L[r] > u) r--;
        const t = L[r + 1] > L[r] ? (u - L[r]) / (L[r + 1] - L[r]) : 0, a = P[r], b = P[r + 1];
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        return [x, y, a[2] + (b[2] - a[2]) * t, solEn(G, x, y)];
      };
      const nc = Math.max(1, Math.round(long));
      for (let col = 0; col < nc; col++) {
        const g = en(col * long / nc), d = en((col + 1) * long / nc), m = en((col + 0.5) * long / nc);
        const a = alphaEn(m[0] + nx * 0.6, m[1] + ny * 0.6), haut = m[2] - m[3];
        if (a <= 0 || haut < 0.8) continue;
        const nr = Math.max(1, Math.round(haut));
        for (let l = 0; l < nr; l++) {
          pts.push((m[0] + nx * 0.75 - G.x0) / G.c, (m[1] + ny * 0.75 - G.x0) / G.c, m[3] + (l + 0.5) * haut / nr, nx, ny);
          carreaux.push({ g, d, nx, ny, l, nr, alpha: a, premier: l === 0 });
        }
      }
    }
  }
  return { pts: new Float32Array(pts), carreaux };
}

/* ------------------------------------------------------------------ maillages */

/**
 * Maillages colorés de la carte : carreaux du sol et des toits posés à la hauteur de leur propre cellule
 * (aucun carreau vertical), et carreaux des façades. Les couleurs sont lissées entre voisins de même nature.
 */
export function maillagesHeures(G, C, zone, facades, { heures, heuresF }, max, etapes, zRef) {
  const { n, c, x0 } = G, m = n + 1, { i0, j0, w, h, alpha } = zone, palette = etapes.map(e => new THREE.Color(e)), teinte = new THREE.Color();
  const pos = [], col = [];
  const cellule = (i, j) => i < 0 || j < 0 || i >= w || j >= h || alpha[j * w + i] <= 0 ? -1 : j * w + i;
  const volume = p => C.seg[(j0 + Math.floor(p / w)) * n + i0 + p % w]; // −1 = sol
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = cellule(i, j);
    if (p < 0) continue;
    const toit = volume(p), gi = i0 + i, gj = j0 + j;
    const S = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([di, dj]) => {
      // valeur et opacité au coin : moyenne des cellules voisines de même nature (sol, ou même volume de toit)
      let s = 0, q = 0, a = 0;
      for (const [ai, aj] of [[i + di - 1, j + dj - 1], [i + di, j + dj - 1], [i + di - 1, j + dj], [i + di, j + dj]]) {
        const v = cellule(ai, aj);
        if (v >= 0) a += alpha[v];
        if (v >= 0 && volume(v) === toit) { s += heures[v]; q++; }
      }
      const k = (gj + dj) * m + gi + di;
      couleurEchelle(palette, (q ? s / q : heures[p]) / max, teinte);
      return toit >= 0
        ? [C.px[k], C.hauteurCoin(k, toit) - zRef + 0.12, -C.py[k], teinte.r, teinte.g, teinte.b, a / 4]
        : [x0 + (gi + di) * c, hauteurTerrain(G, gi + di, gj + dj) - zRef + 0.12, -(x0 + (gj + dj) * c), teinte.r, teinte.g, teinte.b, a / 4];
    });
    for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(S[k][0], S[k][1], S[k][2]); col.push(S[k][3], S[k][4], S[k][5], S[k][6]); }
  }
  // façades : la couleur est lissée de bas en haut dans chaque colonne
  const posF = [], colF = [];
  facades.carreaux.forEach((K, t) => {
    const { g, d, nx, ny, l, nr, alpha: a } = K, v = heuresF[t];
    const bas = l > 0 ? (v + heuresF[t - 1]) / 2 : v, haut = l < nr - 1 ? (v + heuresF[t + 1]) / 2 : v;
    const P = (pt, f) => [pt[0] + nx * 0.07, pt[3] + (pt[2] - pt[3]) * f - zRef, -(pt[1] + ny * 0.07)];
    const f0 = l / nr, f1 = (l + 1) / nr, Q = [[P(g, f0), bas], [P(d, f0), bas], [P(d, f1), haut], [P(g, f1), haut]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      couleurEchelle(palette, Q[k][1] / max, teinte);
      posF.push(...Q[k][0]); colF.push(teinte.r, teinte.g, teinte.b, a);
    }
  });
  const maillage = (p, k) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(k, 4));
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
  };
  const grp = new THREE.Group();
  grp.add(maillage(pos, col));
  if (posF.length) grp.add(maillage(posF, colF));
  return grp;
}
