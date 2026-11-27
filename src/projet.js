// Projet (mode pro) : volumes dessinés sur la maquette (rectangle en trois clics ; toit plat, à deux pans ou à quatre
// pans ; étages) et projets enregistrés dans le navigateur (lieu, date, bâtiments démolis, volumes ajoutés, coupes).
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
 * Cadre d'un volume rectangulaire : centre (cx, cy), largeur L (côté 1-2 des coins), profondeur P (côté 2-3), angle
 * (radians, du côté 1-2 depuis l'est, sens trigonométrique), vecteurs unitaires u (le long de L) et n (le long de P).
 */
export function cadre(v) {
  const [a, b, , d] = v.coins, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, P = Math.hypot(d[0] - a[0], d[1] - a[1]) || 1;
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-u[1], u[0]];
  const cx = v.coins.reduce((s, q) => s + q[0], 0) / v.coins.length, cy = v.coins.reduce((s, q) => s + q[1], 0) / v.coins.length;
  return { cx, cy, L, P, angle: Math.atan2(u[1], u[0]), u, n };
}

/** Coins (sens trigonométrique) d'un cadre { cx, cy, L, P, angle }. */
export function coinsDe({ cx, cy, L, P, angle }) {
  const ux = Math.cos(angle), uy = Math.sin(angle), nx = -uy, ny = ux;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [cx + s * L / 2 * ux + t * P / 2 * nx, cy + s * L / 2 * uy + t * P / 2 * ny]);
}

const r2 = x => Math.round(x * 100) / 100;
/** Sol le plus bas sous l'emprise (altitude absolue). */
export const solMinimum = (v, G) => Math.min(...v.coins.map(([x, y]) => solEn(G, x, y)));

/**
 * Complète un volume (anciens projets, volume tout juste dessiné) : base (altitude absolue du pied des murs, fixée une
 * fois pour toutes : le volume garde son altitude quand on le déplace), étages, pente du toit, sens du faîtage, opacité.
 */
export function normaliserVolume(v, G) {
  if (!(v.base > -1000) && G) v.base = r2(solMinimum(v, G));
  if (!Array.isArray(v.etages) || !v.etages.length) {
    const h = v.hauteur > 0 ? v.hauteur : 9, n = Math.max(1, Math.round(h / 3)), e = r2(h / n);
    v.etages = Array.from({ length: n }, (_, k) => k < n - 1 ? e : r2(h - e * (n - 1)));
  }
  v.hauteur = corniche(v);
  if (v.toit !== "deux" && v.toit !== "quatre") v.toit = "plat";
  v.sensFaite ||= "long";
  v.unitePente ||= "deg";
  if (!(v.pente > 0)) {
    // anciens projets : faîte donné en mètres au-dessus de la corniche, le long du grand côté
    const [L, P] = dimensions(v), demi = Math.min(L, P) / 2;
    v.pente = v.faite > 0 && demi > 0 ? Math.round(Math.atan(v.faite / demi) * 180 / Math.PI) : 30;
  }
  delete v.faite;
  if (!(v.opacite > 0)) v.opacite = 1;
  return v;
}

/** Hauteur à la corniche (m au-dessus de la base) : somme des étages. */
export const corniche = v => r2((v.etages || [v.hauteur || 9]).reduce((s, e) => s + e, 0));

/** Hauteur d'un étage courant (les étages entre le rez et le dernier sont tous égaux). */
export const etageCourant = v => v.etages.length > 2 ? v.etages[1] : 3;

/** Étages : rez, n − 2 étages courants égaux, dernier ; la corniche suit. */
function poserEtages(v, rez, courant, dernier, n) {
  n = Math.max(1, Math.min(80, Math.round(n)));
  v.etages = n === 1 ? [r2(rez)] : [r2(rez), ...Array(n - 2).fill(r2(courant)), r2(dernier)];
  v.hauteur = corniche(v);
}

/**
 * Change la hauteur à la corniche : rez et dernier étage gardés, le nombre d'étages courants s'ajuste et ils restent
 * tous de même hauteur (la différence est répartie entre eux).
 */
export function reglerCorniche(v, h) {
  h = Math.max(1, Math.min(300, h));
  const E = v.etages, rez = E[0], dernier = E.length > 1 ? E[E.length - 1] : rez, c = etageCourant(v);
  if (E.length === 1 || h < rez + dernier + 1) { poserEtages(v, h, c, c, 1); return; }
  const reste = h - rez - dernier, m = Math.max(0, Math.round(reste / c));
  if (m === 0) { poserEtages(v, rez, c, h - rez, 2); return; }
  poserEtages(v, rez, reste / m, dernier, m + 2);
}

/** Nombre d'étages : les nouveaux étages courants reprennent la hauteur courante ; rez et dernier restent. */
export function reglerEtages(v, n) {
  const E = v.etages, rez = E[0], dernier = E.length > 1 ? E[E.length - 1] : rez;
  poserEtages(v, rez, etageCourant(v), dernier, n);
}

/** Règle le rez, la hauteur des étages courants ou le dernier étage. */
export function reglerEtage(v, quoi, h) {
  h = Math.max(1, Math.min(20, h));
  const E = v.etages, n = E.length, rez = E[0], dernier = n > 1 ? E[n - 1] : rez;
  if (quoi === "rez") poserEtages(v, h, etageCourant(v), n > 1 ? dernier : h, n);
  else if (quoi === "courant") poserEtages(v, rez, h, dernier, n);
  else poserEtages(v, rez, etageCourant(v), h, n);
}

/** Axe du faîtage et demi-portées : { axe: "u" | "n", A (demi-longueur le long du faîte), B (demi-portée) }. */
function faitage(v, L, P) {
  const longU = L >= P, surU = v.toit === "quatre" ? longU : (v.sensFaite === "court" ? !longU : longU);
  return surU ? { axe: "u", A: L / 2, B: P / 2 } : { axe: "n", A: P / 2, B: L / 2 };
}

/** Hauteur du faîte au-dessus de la corniche (m) : 0 pour un toit plat. */
export function hauteurToit(v) {
  if (v.toit === "plat" || !(v.pente > 0)) return 0;
  const { L, P } = cadre(v), { B } = faitage(v, L, P);
  return r2(Math.tan(Math.min(80, v.pente) * Math.PI / 180) * B);
}

/** Règle la pente pour que le faîte soit à `h` m au-dessus de la corniche. */
export function reglerFaite(v, h) {
  if (v.toit === "plat") return;
  const { L, P } = cadre(v), { B } = faitage(v, L, P);
  v.pente = Math.round(Math.max(1, Math.min(80, Math.atan(Math.max(0.05, h) / B) * 180 / Math.PI)) * 10) / 10;
}

/**
 * Géométrie d'un volume : murs du pied (`base`, altitude fixe) à la corniche, prolongés jusque sous le terrain le plus
 * bas de l'emprise (0,5 m) pour ne jamais flotter ; toit plat, à deux pans (pignons) ou à quatre pans (croupes), pente
 * `pente` (°). Repère de la scène (x est, y altitude − zRef, z sud). `userData.faces` : face de chaque triangle pour
 * l'édition (k ≥ 0 = mur du côté k, coins k → k+1 ; −1 = toit).
 */
export function volumeGeometrie(v, G, zRef) {
  const sol = solMinimum(v, G), base = (v.base > -1000 ? v.base : sol) - zRef;
  const bas = Math.min(base, sol - zRef) - 0.5, h = base + (v.etages ? corniche(v) : v.hauteur), pos = [], faces = [];
  const C = v.coins, S = ([x, y], z) => [x, z, -y];
  let face = -1;
  const tri = (a, b, c) => { pos.push(...a, ...b, ...c); faces.push(face); };
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  for (let k = 0; k < C.length; k++) { face = k; quad(S(C[k], bas), S(C[(k + 1) % C.length], bas), S(C[(k + 1) % C.length], h), S(C[k], h)); }
  face = -1;
  const pans = (v.toit === "deux" || v.toit === "quatre") && C.length === 4 && v.pente > 0;
  if (!pans) for (let k = 1; k + 1 < C.length; k++) tri(S(C[0], h), S(C[k], h), S(C[k + 1], h));
  else {
    const { cx, cy, L, P, u, n } = cadre(v), { axe, A, B } = faitage(v, L, P);
    const a = axe === "u" ? u : n, b = axe === "u" ? n : [-u[0], -u[1]];
    const W = (s, t) => [cx + s * a[0] + t * b[0], cy + s * a[1] + t * b[1]];
    const zf = h + Math.tan(Math.min(80, v.pente) * Math.PI / 180) * B, R = v.toit === "quatre" ? Math.max(0, A - B) : A;
    const c1 = S(W(-A, -B), h), c2 = S(W(A, -B), h), c3 = S(W(A, B), h), c4 = S(W(-A, B), h), f1 = S(W(R, 0), zf), f0 = S(W(-R, 0), zf);
    quad(c1, c2, f1, f0);
    quad(c3, c4, f0, f1);
    // bouts : pignons (murs, à tirer comme eux) ou croupes (toit)
    const murBout = s => axe === "u" ? (s > 0 ? 1 : 3) : (s > 0 ? 2 : 0);
    if (v.toit === "deux") { face = murBout(1); tri(c2, c3, f1); face = murBout(-1); tri(c4, c1, f0); }
    else { tri(c2, c3, f1); tri(c4, c1, f0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.userData.faces = faces;
  g.userData.base = base; // pied des murs (repère de la scène)
  return g;
}

/** Traits des étages sur les façades (segments, repère de la scène), à 4 cm devant les murs. */
export function traitsEtages(v, zRef, G = null) {
  if (!v.etages || !(v.base > -1000) || (v.etages.length < 2 && !(G && v.base > solMinimum(v, G) + 0.1))) return null;
  const { cx, cy, L, P, u, n } = cadre(v), e = 0.04, pos = [];
  const coins = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [cx + s * (L / 2 + e) * u[0] + t * (P / 2 + e) * n[0], cy + s * (L / 2 + e) * u[1] + t * (P / 2 + e) * n[1]]);
  let z = v.base - zRef;
  // base au-dessus du terrain : un trait marque le pied du rez (les murs descendent plus bas, jusqu'au terrain)
  if (G && v.base > solMinimum(v, G) + 0.1) for (let i = 0; i < 4; i++) { const a = coins[i], b = coins[(i + 1) % 4]; pos.push(a[0], z, -a[1], b[0], z, -b[1]); }
  for (let k = 0; k + 1 < v.etages.length; k++) {
    z += v.etages[k];
    for (let i = 0; i < 4; i++) { const a = coins[i], b = coins[(i + 1) % 4]; pos.push(a[0], z, -a[1], b[0], z, -b[1]); }
  }
  return new Float32Array(pos);
}

/* ------------------------------------------------------------------ distances (emprises, en plan) */

/** Points les plus proches de deux segments [a, b] et [c, d] : { d, p, q }. */
export function segmentSegment(a, b, c, d) {
  const croise = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const s1 = croise(a, b, c), s2 = croise(a, b, d), s3 = croise(c, d, a), s4 = croise(c, d, b);
  if (((s1 > 0) !== (s2 > 0)) && ((s3 > 0) !== (s4 > 0)) && s1 && s2 && s3 && s4) {
    const t = s3 / (s3 - s4), p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    return { d: 0, p, q: p };
  }
  const proj = (p, x, y) => { // point de [x, y] le plus proche de p
    const dx = y[0] - x[0], dy = y[1] - x[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - x[0]) * dx + (p[1] - x[1]) * dy) / l)) : 0;
    return [x[0] + dx * t, x[1] + dy * t];
  };
  let best = null;
  for (const [p, x, y, inverse] of [[a, c, d, false], [b, c, d, false], [c, a, b, true], [d, a, b, true]]) {
    const q = proj(p, x, y), dist = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!best || dist < best.d) best = inverse ? { d: dist, p: q, q: p } : { d: dist, p, q };
  }
  return best;
}

/** Distance la plus courte entre une liste de segments (côtés du volume) et un polygone (fermé) ou une polyligne. */
export function distanceSegments(segs, poly, ferme = true) {
  let best = null;
  const m = poly.length;
  for (const [a, b] of segs) for (let i = 0; i < (ferme ? m : m - 1); i++) {
    const r = segmentSegment(a, b, poly[i], poly[(i + 1) % m]);
    if (!best || r.d < best.d) best = r;
  }
  return best;
}

/** Vrai si (x, y) est dans le polygone (pair-impair). */
export function dansPolygone(poly, x, y) {
  let dedans = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/** Aire (m², en plan) d'une emprise polygonale quelconque (coins dans un sens ou dans l'autre). */
export function aireEmprise(coins) {
  let a = 0;
  for (let i = 0, j = coins.length - 1; i < coins.length; j = i++) a += coins[j][0] * coins[i][1] - coins[i][0] * coins[j][1];
  return Math.abs(a) / 2;
}

/** Surface de plancher (m²) : emprise × nombre d'étages (brute, sans déduction). */
export const surfacePlancher = v => aireEmprise(v.coins) * Math.max(1, v.etages?.length || Math.round((v.hauteur || 3) / 3));

/**
 * Limites d'une parcelle, regroupées par voisin : chaque côté de l'anneau va à la parcelle voisine qui le touche (point à
 * 30 cm à l'extérieur du milieu du côté), ou à `null` (voisin inconnu, domaine non cadastré). Renvoie
 * [{ numero, segments: [[a, b], …] }].
 */
export function limitesParVoisin(anneaux, voisines = []) {
  const groupes = new Map();
  for (const a of anneaux) for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 0.01) continue;
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, nx = (q[1] - p[1]) / L * 0.3, ny = -(q[0] - p[0]) / L * 0.3;
    // côté extérieur : celui des deux points qui n'est pas dans la parcelle
    const [ex, ey] = anneaux.some(b => dansPolygone(b, mx + nx, my + ny)) ? [mx - nx, my - ny] : [mx + nx, my + ny];
    const v = voisines.find(w => w.anneauxRel?.some(b => b.length > 2 && dansPolygone(b, ex, ey)));
    const cle = v?.numero ?? null;
    if (!groupes.has(cle)) groupes.set(cle, { numero: cle, segments: [] });
    groupes.get(cle).segments.push([p, q]);
  }
  return [...groupes.values()];
}

/**
 * Distance la plus courte d'une emprise (polygone quelconque) à chaque limite (groupes de `limitesParVoisin`) :
 * [{ numero, d, p (sur le volume), q (sur la limite) }], de la plus proche à la plus lointaine.
 */
export function distancesLimites(coins, limites) {
  const segs = coins.map((p, k) => [p, coins[(k + 1) % coins.length]]);
  return limites.map(g => {
    let best = null;
    for (const [a, b] of segs) for (const [c, d] of g.segments) { const r = segmentSegment(a, b, c, d); if (!best || r.d < best.d) best = r; }
    return best && { numero: g.numero, ...best };
  }).filter(Boolean).sort((x, y) => x.d - y.d);
}

/**
 * Dépassement de la limite : coins de l'emprise hors de la parcelle (anneaux), le plus éloigné de la limite.
 * Renvoie { d, p (coin hors limite), q (point de la limite le plus proche) } ou null si l'emprise est dans la parcelle.
 */
export function depassementLimite(coins, anneaux) {
  if (!anneaux.length) return null;
  let pire = null;
  for (const c of coins) {
    if (anneaux.some(a => dansPolygone(a, c[0], c[1]))) continue;
    const r = anneaux.map(a => distanceSegments([[c, c]], a)).reduce((m, x) => !m || (x && x.d < m.d) ? x : m, null);
    if (r && (!pire || r.d > pire.d)) pire = { d: r.d, p: c, q: r.q };
  }
  return pire;
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
/** Projet enregistré `id`, ou null. */
export const lireProjet = id => listerProjets().find(q => q.id === id) || null;
/** Identifiant neuf de projet. */
export const nouvelId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** Renomme un projet enregistré (sa date de modification suit). */
export function renommerProjet(id, nom) {
  const p = lireProjet(id);
  return !!p && enregistrerProjet({ ...p, nom });
}
/** Copie d'un projet enregistré sous un nouveau nom ; renvoie la copie (ou null). */
export function dupliquerProjet(id, nom) {
  const p = lireProjet(id);
  if (!p) return null;
  const q = { ...JSON.parse(JSON.stringify(p)), id: nouvelId(), nom };
  return enregistrerProjet(q) ? lireProjet(q.id) : null;
}
const CLE_OUVERT = "ombres.projetOuvert";
/** Dernier projet ouvert (retrouvé au rechargement de la page) : lecture, ou écriture (null : aucun). */
export function projetOuvert(id) {
  try {
    if (id === undefined) return localStorage.getItem(CLE_OUVERT);
    if (id == null) localStorage.removeItem(CLE_OUVERT); else localStorage.setItem(CLE_OUVERT, id);
  } catch { /* stockage indisponible */ }
  return null;
}
