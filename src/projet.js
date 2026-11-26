// Projet (mode pro) : volumes dessinés sur la maquette (rectangle en trois clics, toit plat ou à deux pans) et
// projets enregistrés dans le navigateur (lieu, date, bâtiments démolis, volumes ajoutés, coupes).
import * as THREE from "three";
import { solEn } from "./grille.js";

/* ------------------------------------------------------------------ volumes */

/**
 * Rectangle à partir de trois clics : A et B donnent un côté, C la profondeur (distance signée à la droite AB).
 * Renvoie les quatre coins (relatifs, x est, y nord) dans le sens trigonométrique, ou null si trop petit.
 */
export function rectangle(A, B, C) {
  const ux = B[0] - A[0], uy = B[1] - A[1], L = Math.hypot(ux, uy);
  if (L < 1) return null;
  const nx = -uy / L, ny = ux / L, d = (C[0] - A[0]) * nx + (C[1] - A[1]) * ny;
  if (Math.abs(d) < 1) return null;
  const coins = [A, B, [B[0] + nx * d, B[1] + ny * d], [A[0] + nx * d, A[1] + ny * d]];
  return d > 0 ? coins : coins.reverse();
}

/** Dimensions d'un volume rectangulaire : longueur et largeur (m). */
export function dimensions(v) {
  const [a, b, c] = v.coins;
  return [Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1])];
}

/**
 * Géométrie d'un volume : murs posés sur le point le plus bas du terrain sous l'emprise (et enfoncés de 0,5 m pour ne
 * pas flotter sur une pente), toit plat à `hauteur` ou à deux pans (corniche à `hauteur`, faîte `faite` m plus haut,
 * parallèle au grand côté). Repère de la scène (x est, y altitude − zRef, z sud).
 */
export function volumeGeometrie(v, G, zRef) {
  const P = v.coins, base = Math.min(...P.map(([x, y]) => solEn(G, x, y))) - zRef;
  const bas = base - 0.5, h = base + v.hauteur, pos = [];
  const S = ([x, y], z) => [x, z, -y];
  // face de chaque triangle (édition) : k ≥ 0 = mur du côté k (coins k → k+1), −1 = toit
  const faces = [];
  let face = -1;
  const tri = (a, b, c) => { pos.push(...a, ...b, ...c); faces.push(face); };
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  // toit à deux pans : faîte au milieu, parallèle au grand côté (rectangle seulement)
  const deuxPans = v.toit === "deux" && P.length === 4 && v.faite > 0;
  let haut = P.map(() => h);
  let faite = null;
  if (deuxPans) {
    const [L0, L1] = dimensions(v), long = L0 >= L1; // grand côté : 0-1 (et 2-3) ou 1-2 (et 3-0)
    const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    faite = long ? [m(P[1], P[2]), m(P[3], P[0])] : [m(P[0], P[1]), m(P[2], P[3])];
    v._long = long;
  }
  // murs
  for (let k = 0; k < P.length; k++) {
    const a = P[k], b = P[(k + 1) % P.length];
    face = k;
    quad(S(a, bas), S(b, bas), S(b, haut[(k + 1) % P.length]), S(a, haut[k]));
  }
  face = -1;
  if (!deuxPans) {
    for (let k = 1; k + 1 < P.length; k++) tri(S(P[0], h), S(P[k], h), S(P[k + 1], h));
  } else {
    const zf = h + v.faite, [f0, f1] = faite;
    if (v._long) {
      // pans le long de 0-1 et 2-3 ; pignons sur 1-2 et 3-0
      quad(S(P[0], h), S(P[1], h), S(f0, zf), S(f1, zf));
      quad(S(P[2], h), S(P[3], h), S(f1, zf), S(f0, zf));
      tri(S(P[1], h), S(P[2], h), S(f0, zf));
      tri(S(P[3], h), S(P[0], h), S(f1, zf));
    } else {
      quad(S(P[1], h), S(P[2], h), S(f1, zf), S(f0, zf));
      quad(S(P[3], h), S(P[0], h), S(f0, zf), S(f1, zf));
      tri(S(P[0], h), S(P[1], h), S(f0, zf));
      tri(S(P[2], h), S(P[3], h), S(f1, zf));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.userData.faces = faces;
  g.userData.base = base; // pied des murs (repère de la scène)
  return g;
}

/* ------------------------------------------------------------------ projets enregistrés */

const CLE = "ombres.projets";
export function listerProjets() {
  try { return JSON.parse(localStorage.getItem(CLE) || "[]"); } catch { return []; }
}
function ecrire(liste) {
  try { localStorage.setItem(CLE, JSON.stringify(liste)); return true; } catch { return false; }
}
/** Enregistre (ou remplace, même id) un projet ; renvoie false si le stockage du navigateur est indisponible. */
export function enregistrerProjet(p) {
  const liste = listerProjets().filter(q => q.id !== p.id);
  liste.unshift({ ...p, modifie: new Date().toISOString() });
  return ecrire(liste);
}
export function supprimerProjet(id) { ecrire(listerProjets().filter(q => q.id !== id)); }
