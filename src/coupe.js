// Coupe verticale à travers le terrain, les bâtiments et les arbres, le long d'une ligne A–B.
// Le profil est lu dans les grilles ; il sert au trait de coupe dans la 3D (surfaces tranchées pochées)
// et au dessin 2D (SVG) avec altitudes, limites de parcelle et rayon du soleil.
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { solEn } from "./grille.js";
import { dansBatiment } from "./contours.js";
import { t as tr, nombre } from "./i18n.js";

/** Valeur d'une grille au point (x, y), interpolée entre les cellules renseignées voisines (NaN si aucune). */
function valeurEn(G, a, x, y) {
  const fi = (x - G.x0) / G.c - 0.5, fj = (y - G.x0) / G.c - 0.5, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
  let s = 0, q = 0;
  for (const [di, dj, p] of [[0, 0, (1 - u) * (1 - v)], [1, 0, u * (1 - v)], [0, 1, (1 - u) * v], [1, 1, u * v]]) {
    const ii = i + di, jj = j + dj;
    if (ii < 0 || jj < 0 || ii >= G.n || jj >= G.n) continue;
    const z = a[jj * G.n + ii];
    if (!isNaN(z) && p > 0) { s += z * p; q += p; }
  }
  return q > 0.02 ? s / q : NaN;
}

/**
 * Profil le long de la droite A→B, prolongée jusqu'aux bords du modèle. `s` = distance depuis A (négative avant A).
 * `bat` suit les bâtiments tels qu'affichés, `veg` la canopée ; NaN où il n'y en a pas.
 * `o.batiments` : jeu de bâtiments affiché — rien = relevé (contours redressés, sans les masqués), "aucun", ou une
 * grille de hauteurs alignée sur G (bâtiments swisstopo ou roofer vus de dessus, scene.grilleComparaison).
 * `o.nuage` et `o.distance` : points du nuage à moins de `distance` m de la ligne, projetés dans le plan (`points`) ;
 * le nuage sert aussi à estimer le dessous des couronnes d'arbres (`arbres`).
 */
export function profilCoupe(G, contours, A, B, parcelle, pas = 0.25, voisines = [], o = {}) {
  const grille = o.batiments instanceof Float32Array ? o.batiments : null, aucun = o.batiments === "aucun";
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
  // anneau autour de la maquette fine (o.rayonExt, o.solHors) : la coupe va jusqu'à son bord, terrain à 2 m
  const Rext = o.rayonExt > (G.rayonZone || 0) && o.solHors ? o.rayonExt : 0, lim = Rext ? Rext : G.R - 1;
  // étendue de la droite dans le carré du modèle
  let s0 = -Infinity, s1 = Infinity;
  for (const [o, d] of [[A[0], ux], [A[1], uy]]) {
    if (Math.abs(d) < 1e-9) continue;
    const a = (-lim - o) / d, b = (lim - o) / d;
    s0 = Math.max(s0, Math.min(a, b)); s1 = Math.min(s1, Math.max(a, b));
  }
  s0 = Math.max(s0, -2 * lim * 1.5); s1 = Math.min(s1, 2 * lim * 1.5);
  // maquette ronde : la droite s'arrête au cercle
  if (G.rayonZone) {
    const r = (Rext || G.rayonZone) - 1, b = A[0] * ux + A[1] * uy, cc = A[0] * A[0] + A[1] * A[1] - r * r, delta = b * b - cc;
    if (delta > 0) { s0 = Math.max(s0, -b - Math.sqrt(delta)); s1 = Math.min(s1, -b + Math.sqrt(delta)); }
  }
  const nb = Math.max(2, Math.floor((s1 - s0) / pas) + 1), s = new Float32Array(nb), sol = new Float32Array(nb), bat = new Float32Array(nb), veg = new Float32Array(nb);
  // toit tel qu'affiché à la distance d : le plan du pan s'il y en a un, sinon la grille (NaN hors bâtiment)
  const toit = d => toitEn(A[0] + ux * d, A[1] + uy * d);
  const toitEn = (x, y) => {
    const pan = contours?.pans ? contours.pans.hauteurEn(x, y) : NaN;
    const b = aucun ? NaN : grille ? (isNaN(celluleEn(G, grille, x, y)) ? NaN : valeurEn(G, grille, x, y))
      : contours && dansBatiment(contours, x, y) ? (isNaN(pan) ? valeurEn(G, G.bat, x, y) : pan) : NaN;
    return b > solEn(G, x, y) + 0.5 ? b : NaN;
  };
  for (let k = 0; k < nb; k++) {
    const d = s0 + k * pas, x = A[0] + ux * d, y = A[1] + uy * d;
    // dans l'anneau : terrain à 2 m (pas de bâtiments ni d'arbres du relevé là)
    const dehors = Rext && x * x + y * y > (G.rayonZone - 0.5) ** 2;
    // terrain TIN affiché (terrainTIN.js) : la coupe suit ses triangles, sinon la grille 0,5 m
    s[k] = d; sol[k] = dehors ? o.solHors(x, y) : G.tin?.hauteur ? G.tin.hauteur(x, y) : solEn(G, x, y);
    if (dehors) { bat[k] = veg[k] = NaN; continue; }
    bat[k] = toit(d);
    const v = isNaN(bat[k]) ? valeurEn(G, G.veg, x, y) : NaN;
    veg[k] = v > sol[k] + 1 ? v : NaN;
  }
  // limites traversées : celles de la parcelle choisie, et celles des parcelles voisines (avec leurs numéros)
  const traversees = anneaux => {
    const t = [];
    for (const a of anneaux) for (let k = 0; k < a.length - 1; k++) {
      const [x1, y1] = a[k], [x2, y2] = a[k + 1], ex = x2 - x1, ey = y2 - y1, det = ux * ey - uy * ex;
      if (Math.abs(det) < 1e-9) continue;
      const d = ((x1 - A[0]) * ey - (y1 - A[1]) * ex) / det, r = ((x1 - A[0]) * uy - (y1 - A[1]) * ux) / det;
      if (r >= 0 && r <= 1) t.push(d);
    }
    return t;
  };
  const limites = traversees(parcelle?.anneauxRel || []).sort((a, b) => a - b);
  const toutes = [...limites];
  for (const v of voisines) for (const d of traversees(v.anneauxRel)) if (!toutes.some(e => Math.abs(e - d) < 0.3)) toutes.push(d);
  toutes.sort((a, b) => a - b);
  // tronçons entre deux limites : numéro de la parcelle qui contient leur milieu
  const parcelles = [], bornes = [s0, ...toutes, s1];
  for (let k = 0; k < bornes.length - 1; k++) {
    const m = (bornes[k] + bornes[k + 1]) / 2, x = A[0] + ux * m, y = A[1] + uy * m;
    const p = (parcelle?.anneauxRel?.length && dansAnneaux(x, y, parcelle.anneauxRel)) ? { numero: parcelle.numero, choisie: true }
      : voisines.find(v => dansAnneaux(x, y, v.anneauxRel));
    if (p) parcelles.push({ s0: bornes[k], s1: bornes[k + 1], numero: p.numero, choisie: !!p.choisie });
  }
  // façades : position exacte du mur entre deux échantillons (par dichotomie), pour un trait de coupe bien vertical
  // et un poché qui va jusqu'au mur. `debut[k]` : le bâtiment qui commence à l'échantillon k ; `fin[k]` : qui y finit.
  const debut = new Float32Array(nb).fill(NaN), fin = new Float32Array(nb).fill(NaN);
  for (let k = 0; k < nb - 1; k++) {
    if (isNaN(bat[k]) === isNaN(bat[k + 1])) continue;
    let dehors = isNaN(bat[k]) ? s[k] : s[k + 1], dedans = isNaN(bat[k]) ? s[k + 1] : s[k];
    for (let t = 0; t < 8; t++) { const m = (dehors + dedans) / 2; if (isNaN(toit(m))) dehors = m; else dedans = m; }
    if (isNaN(bat[k])) debut[k + 1] = dedans; else fin[k] = dedans;
  }
  const P = { A, B, L, ux, uy, pas, nb, s, sol, bat, veg, debut, fin, limites, voisines: toutes.filter(d => !limites.some(e => Math.abs(e - d) < 0.3)), parcelles };
  // `o.rapide` (poignée en mouvement) : ni vue au-delà, ni points du nuage ; le dessin complet suit au relâchement
  if (o.rapide) { P.rapide = true; P.arbres = arbresCoupe(P, lireNuage(P, null, 0)); return P; }
  P.audela = audela(G, P, toitEn, lim);
  const N = lireNuage(P, o.nuage, o.distance || 0);
  P.points = N.points;
  P.arbres = arbresCoupe(P, N);
  return P;
}

/**
 * Ce qu'on voit au-delà du plan de coupe, en regardant la coupe avec A à gauche et B à droite (donc vers la gauche
 * de A→B), entre A et B, une colonne tous les 0,5 m :
 * - `plans[b]` : le plus haut (terrain ou bâtiment) dans chaque tranche de profondeur BORDS[b]–BORDS[b+1] ;
 * - `face` / `faceD` : toit du premier bâtiment rencontré et sa profondeur (élévation) ; `solMax` : terrain le plus haut ;
 * - `veg` : cime la plus haute des arbres dans les 30 premiers mètres.
 */
export const BORDS = [0, 5, 10, 18, 30, 45, 65, 90, 130, 200, 400];
function audela(G, P, toitEn, lim) {
  const { A, ux, uy, L } = P, nx = -uy, ny = ux, pasC = 0.5, nc = Math.max(2, Math.floor(L / pasC) + 1);
  const s = new Float32Array(nc), plans = BORDS.slice(1).map(() => new Float32Array(nc).fill(NaN));
  const face = new Float32Array(nc).fill(NaN), faceD = new Float32Array(nc).fill(NaN), solMax = new Float32Array(nc).fill(NaN), veg = new Float32Array(nc).fill(NaN);
  const prof = [];
  for (let d = 0.5; d < BORDS.at(-1); d += d < 20 ? 0.5 : d < 80 ? 1 : 2) prof.push(d);
  for (let c = 0; c < nc; c++) {
    const sd = c * pasC; s[c] = sd;
    const x0 = A[0] + ux * sd, y0 = A[1] + uy * sd;
    let b = 0;
    for (const d of prof) {
      const x = x0 + nx * d, y = y0 + ny * d;
      if (Math.abs(x) > lim || Math.abs(y) > lim) break;
      while (d >= BORDS[b + 1]) b++;
      const zs = solEn(G, x, y), zb = toitEn(x, y), z = isNaN(zb) ? zs : zb;
      if (!(plans[b][c] >= z)) plans[b][c] = z;
      if (!(solMax[c] >= zs)) solMax[c] = zs;
      if (!isNaN(zb) && isNaN(face[c])) { face[c] = zb; faceD[c] = d; }
      if (d < 30 && isNaN(zb)) { const v = valeurEn(G, G.veg, x, y); if (v > zs + 1 && !(veg[c] >= v)) veg[c] = v; }
    }
  }
  return { s, nc, pasC, plans, face, faceD, solMax, veg };
}

/**
 * Dessin de ce qu'on voit au-delà de la coupe, sous la masse coupée. Plusieurs manières (`vue`) :
 * - « silhouette » : un seul trait fin, le profil le plus haut derrière la coupe ;
 * - « plans » : plans successifs (tranches de BORDS, de 5 m devant à 200 m au loin), aplats sans contour, du plus pâle
 *   au loin au plus soutenu devant ;
 * - « elevation » : façades et toits du premier bâtiment rencontré, arêtes verticales là où il change, terrain
 *   derrière en trait fin et arbres proches en contour pointillé ;
 * - « traits » : élévation au trait seul, sans aplat, comme un dessin d'architecte.
 */
function dessinAudela(V, vue, X, Y, H, f) {
  const { s, nc } = V;
  // chemin ouvert d'une série (coupé aux trous)
  const ligne = a => { let p = "", ouvert = false; for (let c = 0; c < nc; c++) { if (isNaN(a[c])) { ouvert = false; continue; } p += `${ouvert ? "L" : "M"}${f(X(s[c]))},${f(Y(a[c]))}`; ouvert = true; } return p; };
  // aplat jusqu'au bas du cadre, par morceau continu
  const aplat = a => {
    let p = "";
    for (let c = 0; c < nc;) {
      if (isNaN(a[c])) { c++; continue; }
      const d = c; while (c < nc && !isNaN(a[c])) c++;
      p += `M${f(X(s[d]))},${H}`; for (let q = d; q < c; q++) p += `L${f(X(s[q]))},${f(Y(a[q]))}`; p += `L${f(X(s[c - 1]))},${H}Z`;
    }
    return p;
  };
  const max = (...l) => Float32Array.from({ length: nc }, (_, c) => { let m = NaN; for (const a of l) if (!(m >= a[c])) m = isNaN(a[c]) ? m : a[c]; return m; });
  let t = "";
  if (vue === "silhouette") return `<path d="${ligne(max(...V.plans))}" class="audela-sil"/>`;
  if (vue === "plans") {
    // du lointain au proche : chaque plan cumule ce qui est devant lui pour ne pas laisser de trou
    for (let b = V.plans.length - 1; b >= 0; b--) {
      const a = max(...V.plans.slice(0, b + 1));
      // aplats seuls, sans contour : de plus en plus pâles avec la profondeur. Les aplats se superposent (chacun cumule
      // ce qui est devant lui) : l'opacité de chacun est choisie pour que la teinte vue du plan b soit visible(b)
      const N = V.plans.length, visible = k => k >= N ? 0 : 0.035 + 0.165 * Math.pow(1 - k / Math.max(1, N - 1), 1.5);
      const op = 1 - (1 - visible(b)) / (1 - visible(b + 1));
      t += `<path d="${aplat(a)}" class="audela-plan" fill-opacity="${op.toFixed(3)}"/>`;
    }
    return t;
  }
  // élévation : terrain le plus haut derrière, puis le premier bâtiment (toit et arêtes verticales)
  const remplir = vue === "elevation";
  t += `<path d="${ligne(V.solMax)}" class="audela-terrain"/>`;
  if (remplir) t += `<path d="${aplat(V.face)}" class="audela-facade"/>`;
  let aretes = "";
  for (let c = 0; c < nc; c++) {
    const a = V.face[c], b = V.face[c + 1];
    const debut = !isNaN(a) && (c === 0 || isNaN(V.face[c - 1]));
    if (debut) aretes += `M${f(X(s[c]))},${f(Y(V.solMax[c]))}V${f(Y(a))}`;
    if (c + 1 < nc && !isNaN(a) && isNaN(b)) aretes += `M${f(X(s[c]))},${f(Y(V.solMax[c]))}V${f(Y(a))}`;
    // changement de bâtiment (saut de profondeur) ou de hauteur nette : arête verticale du plus haut au plus bas
    if (c + 1 < nc && !isNaN(a) && !isNaN(b) && (Math.abs(V.faceD[c] - V.faceD[c + 1]) > 2 || Math.abs(a - b) > 1.5)) {
      const x = X((s[c] + s[c + 1]) / 2);
      aretes += `M${f(x)},${f(Y(Math.max(a, b)))}V${f(Y(Math.min(a, b)))}`;
      if (Math.abs(V.faceD[c] - V.faceD[c + 1]) > 2) aretes += `V${f(Y(Math.min(V.solMax[c], V.solMax[c + 1])))}`;
    }
  }
  t += `<path d="${ligne(V.face)}${aretes}" class="audela-arete"/>`;
  t += `<path d="${ligne(V.veg)}" class="audela-arbres"/>`;
  return t;
}

/** Valeur de la cellule qui contient (x, y), NaN hors de la grille. */
function celluleEn(G, a, x, y) {
  const i = Math.floor((x - G.x0) / G.c), j = Math.floor((y - G.x0) / G.c);
  return i < 0 || j < 0 || i >= G.n || j >= G.n ? NaN : a[j * G.n + i];
}

/** Catégories des points projetés dans la coupe : classes du relevé regroupées. */
export const CATEGORIES = ["sol", "végétation", "bâtiment", "autre"];
const categorie = cl => cl === 2 ? 0 : cl === 3 || cl === 4 || cl === 5 ? 1 : cl === 6 || cl === 26 ? 2 : 3;

/**
 * Une lecture du nuage le long de la ligne, entre A et B :
 * - `points` : ceux à moins de `distance` m du plan de coupe ({ s, z, c (catégorie), n, distance }), ou null ;
 * - par échantillon du profil, l'enveloppe des points de végétation proches (à `distance`, 1 m au moins) :
 *   nombre, plus haut, et plus bas de la couronne (les points du sous-bois et du tronc, dans le quart bas, sont écartés).
 */
function lireNuage(P, nuage, distance) {
  const nb = P.nb, nv = new Uint16Array(nb), haut = new Float32Array(nb).fill(-Infinity), bas = new Float32Array(nb).fill(Infinity);
  if (!nuage) return { points: null, nv, haut, bas };
  const { X, Y, Z, C } = nuage, [ax, ay] = P.A, { ux, uy, L } = P, s0 = P.s[0], large = Math.max(distance, 1);
  let S = new Float32Array(distance ? 8192 : 0), Zp = new Float32Array(S.length), Cp = new Uint8Array(S.length), n = 0;
  for (let k = 0; k < nuage.n; k++) {
    const dx = X[k] - ax, dy = Y[k] - ay, e = dx * uy - dy * ux;
    if (e > large || e < -large) continue;
    const t = dx * ux + dy * uy;
    if (t < 0 || t > L) continue;
    const cat = categorie(C[k]), z = Z[k];
    if (cat === 1) {
      const q = Math.round((t - s0) / P.pas), h = P.veg[q] - P.sol[q];
      if (q >= 0 && q < nb && z > P.sol[q] + 1) {
        if (nv[q] < 65535) nv[q]++;
        if (z > haut[q]) haut[q] = z;
        if (z < bas[q] && !(z < P.sol[q] + 0.25 * h)) bas[q] = z;
      }
    }
    if (!distance || e > distance || e < -distance) continue;
    if (n === S.length) {
      const a = new Float32Array(2 * n), b = new Float32Array(2 * n), c = new Uint8Array(2 * n);
      a.set(S); b.set(Zp); c.set(Cp); S = a; Zp = b; Cp = c;
    }
    S[n] = t; Zp[n] = z; Cp[n++] = cat;
  }
  return { points: distance ? { s: S.subarray(0, n), z: Zp.subarray(0, n), c: Cp.subarray(0, n), n, distance } : null, nv, haut, bas };
}

/** Texture de hachure diagonale (traits sur fond transparent), répétée ; partagée. */
let hachure = null;
function textureHachure() {
  if (hachure) return hachure;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const x = cv.getContext("2d");
  x.strokeStyle = "#fff";
  x.lineWidth = 9;
  for (const o of [-64, 0, 64]) { x.beginPath(); x.moveTo(o, 64); x.lineTo(o + 64, 0); x.stroke(); }
  hachure = new THREE.CanvasTexture(cv);
  hachure.wrapS = hachure.wrapT = THREE.RepeatWrapping;
  hachure.anisotropy = 4;
  return hachure;
}

/**
 * Arbres coupés : pour chaque couronne traversée, son dessus et son dessous (lissés, bouts arrondis) et ses troncs.
 * Le dessus vient de la canopée (grille) ou, quand les points proches sont affichés, de leur enveloppe ; le dessous,
 * des points de végétation proches de la ligne (à défaut : 40 % de la hauteur). Les tronçons de moins de 1 m
 * (la ligne frôle une couronne) sont écartés.
 * @returns {{ a, b, haut: Float32Array, bas: Float32Array, troncs: number[] }[]} a, b : échantillons du profil.
 */
function arbresCoupe(P, N) {
  const nb = P.nb, r = Math.max(1, Math.round(0.5 / P.pas)), haut = new Float32Array(nb).fill(NaN), bas = new Float32Array(nb).fill(NaN);
  const parPoints = !!N.points;
  for (let k = 0; k < nb; k++) {
    // enveloppe des points sur ±0,5 m
    let q = 0, h = -Infinity, b = Infinity;
    for (let d = Math.max(0, k - r); d <= Math.min(nb - 1, k + r); d++) { q += N.nv[d]; if (N.haut[d] > h) h = N.haut[d]; if (N.bas[d] < b) b = N.bas[d]; }
    const dessus = parPoints ? (q >= 3 && isNaN(P.bat[k]) ? h : NaN) : P.veg[k];
    if (!(dessus > P.sol[k] + 1)) continue;
    const H = dessus - P.sol[k];
    haut[k] = dessus;
    // dessous : entre 30 cm du sol et 55 % de la hauteur (une couronne garde de l'épaisseur)
    bas[k] = Math.min(P.sol[k] + 0.55 * H, Math.max(P.sol[k] + 0.3, q >= 3 && b < Infinity ? b : P.sol[k] + 0.4 * H));
  }
  // petits trous (moins de 1 m) dans une couronne : comblés, pour ne pas la découper en pics
  for (let k = 1, dernier = -1; k < nb; k++) {
    if (isNaN(haut[k])) continue;
    if (dernier >= 0 && k - dernier > 1 && (k - dernier) * P.pas < 1)
      for (let d = dernier + 1; d < k; d++) { const u = (d - dernier) / (k - dernier); haut[d] = haut[dernier] + (haut[k] - haut[dernier]) * u; bas[d] = bas[dernier] + (bas[k] - bas[dernier]) * u; }
    dernier = k;
  }
  const lisse = (a, k, k0, k1, r) => { let s = 0, q = 0; for (let d = Math.max(k0, k - r); d <= Math.min(k1, k + r); d++) { s += a[d]; q++; } return s / q; };
  const arbres = [];
  for (const [a, b] of suites(haut)) {
    const long = (b - a) * P.pas;
    if (long < 1) continue;
    const nbk = b - a + 1, H = new Float32Array(nbk), Bs = new Float32Array(nbk), bout = Math.min(2, long / 2);
    for (let k = a; k <= b; k++) {
      // bouts arrondis : dessus et dessous se rejoignent à mi-hauteur, en quart de cercle
      const h = lisse(haut, k, a, b, 2), bs = lisse(bas, k, a, b, 5), milieu = (h + bs) / 2, d = Math.min(k - a, b - k) * P.pas;
      const e = Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, d / bout)) ** 2));
      H[k - a] = milieu + (h - milieu) * e; Bs[k - a] = milieu - (milieu - bs) * e;
    }
    // troncs : sous les sommets de la couronne, espacés d'au moins 5 m
    const troncs = [], sommets = [];
    for (let k = a + 1; k < b; k++) if (H[k - a] >= H[k - a - 1] && H[k - a] > H[k - a + 1] && H[k - a] - P.sol[k] > 2.5) sommets.push(k);
    sommets.sort((u, v) => H[v - a] - H[u - a]);
    for (const k of sommets) if (!troncs.some(t => Math.abs(t - k) * P.pas < 5)) troncs.push(k);
    arbres.push({ a, b, haut: H, bas: Bs, troncs });
  }
  return arbres;
}

function dansAnneaux(x, y, anneaux) {
  let ok = false;
  for (const a of anneaux) for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i], [xj, yj] = a[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}

/** Altitude arrondie à 10 cm, à la suisse romande (virgule). */
const alt = z => nombre(Math.round(z * 10) / 10, 1);

/** Suites d'échantillons consécutifs où `a` est renseigné : [[début, fin], …] (indices inclus). */
function suites(a, k0 = 0, k1 = a.length - 1) {
  const r = [];
  let d = -1;
  for (let k = k0; k <= k1; k++) {
    if (!isNaN(a[k])) { if (d < 0) d = k; } else if (d >= 0) { r.push([d, k - 1]); d = -1; }
  }
  if (d >= 0) r.push([d, k1]);
  return r;
}

/* ------------------------------------------------------------------ 3D */

/**
 * Surfaces tranchées dans le plan de coupe : terrain poché jusqu'à la base, bâtiments pochés, trait épais.
 * `couleurs` = { trait, bati, terrain } ; `materiauTrait` = LineMaterial partagé (épaisseur en pixels).
 */
/** Traitillé du terrain estimé sous les bâtiments : même encre que le trait de coupe, fin et léger (partagé). */
const estimes = new WeakMap();
function materiauEstime(trait) {
  let m = estimes.get(trait);
  if (!m) {
    m = new LineMaterial({ linewidth: 1.2, dashed: true, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, fog: false });
    m.uniforms.resolution = trait.uniforms.resolution; // même objet : suit la taille de la vue
    estimes.set(trait, m);
  }
  m.color.copy(trait.color);
  return m;
}

export function trancheCoupe(P, zRef, zBas, couleurs, materiauTrait) {
  const grp = new THREE.Group(), en = (d, z) => [P.A[0] + P.ux * d, z - zRef, -(P.A[1] + P.uy * d)], pt = (k, z) => en(P.s[k], z);
  const plein = (pos, couleur) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals(); // pour l'occlusion ambiante
    // opaque, et tiré un rien vers la caméra : il l'emporte sur les faces coupées qui arrivent dans son plan
    grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: couleur, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })));
  };
  const bande = (k0, k1, bas, haut) => {
    const pos = [];
    for (let k = k0; k < k1; k++) {
      const a = pt(k, bas(k)), b = pt(k + 1, bas(k + 1)), c = pt(k + 1, haut(k + 1)), d = pt(k, haut(k));
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    return pos;
  };
  const trait = pts => {
    if (pts.length < 2) return;
    const g = new LineGeometry();
    g.setPositions(pts.flat());
    const l = new Line2(g, materiauTrait);
    l.renderOrder = 20; // dessiné après tout le reste, par-dessus (le matériau ignore la profondeur)
    grp.add(l);
    (grp.userData.traits ||= []).push(l); // hors de l'occlusion ambiante (scene.js)
    // jonctions rondes : un disque de l'épaisseur du trait à chaque sommet, pour un trait continu sans encoches
    if (materiauTrait.jonction) {
      const gp = new THREE.BufferGeometry();
      gp.setAttribute("position", new THREE.Float32BufferAttribute(pts.flat(), 3));
      const j = new THREE.Points(gp, materiauTrait.jonction);
      j.renderOrder = 20; j.frustumCulled = false;
      grp.add(j); grp.userData.traits.push(j);
    }
  };
  plein(bande(0, P.nb - 1, () => zBas + zRef, k => P.sol[k]), couleurs.terrain);
  // terrain et bâtiments coupés forment une seule masse : même couleur, un seul trait qui suit le dessus ;
  // le poché d'un bâtiment va jusqu'à ses murs (position exacte entre deux échantillons)
  const mur = (k, d) => !isNaN(d) ? [...en(d, P.sol[k] - 0.05), ...pt(k, P.sol[k] - 0.05), ...pt(k, P.bat[k]), ...en(d, P.sol[k] - 0.05), ...pt(k, P.bat[k]), ...en(d, P.bat[k])] : [];
  for (const [a, b] of suites(P.bat)) plein([...mur(a, P.debut[a]), ...bande(a, b, k => P.sol[k] - 0.05, k => P.bat[k]), ...mur(b, P.fin[b])], couleurs.terrain);
  const dessus = [];
  for (let k = 0; k < P.nb; k++) {
    if (!isNaN(P.debut[k])) dessus.push(en(P.debut[k], Math.min(P.sol[k], P.bat[k])), en(P.debut[k], P.bat[k]));
    dessus.push(pt(k, enveloppe(P, k)));
    if (!isNaN(P.fin[k])) dessus.push(en(P.fin[k], P.bat[k]), en(P.fin[k], Math.min(P.sol[k], P.bat[k])));
  }
  trait(dessus);
  // terrain estimé sous les bâtiments coupés : traitillé léger, d'un mur à l'autre
  const estime = materiauEstime(materiauTrait);
  for (const [a, b] of suites(P.bat)) {
    const pts = [];
    if (!isNaN(P.debut[a])) pts.push(en(P.debut[a], P.sol[a]));
    for (let k = a; k <= b; k++) pts.push(pt(k, P.sol[k]));
    if (!isNaN(P.fin[b])) pts.push(en(P.fin[b], P.sol[b]));
    if (pts.length < 2) continue;
    const g = new LineGeometry();
    g.setPositions(pts.flat());
    const l = new Line2(g, estime);
    l.computeLineDistances();
    l.renderOrder = 21;
    grp.add(l);
    grp.userData.traits.push(l);
  }
  // arbres coupés : hachure diagonale grise dans le plan de coupe, du sol jusqu'à la cime (groupe `arbres`)
  if (couleurs.arbres && P.arbres?.length) {
    const pos = [], uv = [], ech = 0.55; // une ligne de hachure tous les ~0,55 m
    for (const T of P.arbres) {
      const p = bande(T.a, T.b, k => P.sol[k] - zRef, k => T.haut[k - T.a] - zRef);
      pos.push(...p);
      // coordonnées de texture : abscisse le long de la coupe et altitude, en mètres
      for (let q = 0; q < p.length; q += 3) {
        const d = (p[q] - P.A[0]) * P.ux + (-p[q + 2] - P.A[1]) * P.uy;
        uv.push(d / ech, p[q + 1] / ech);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: couleurs.arbres, map: textureHachure(), side: THREE.DoubleSide, fog: false, transparent: true, depthWrite: false }));
    m.renderOrder = 2;
    const arbres = new THREE.Group();
    arbres.add(m);
    grp.add(arbres);
    grp.userData.arbres = arbres;
  }
  return grp;
}

/** Dessus de la masse coupée : le toit là où il y a un bâtiment, sinon le terrain. */
const enveloppe = (P, k) => isNaN(P.bat[k]) ? P.sol[k] : Math.max(P.sol[k], P.bat[k]);

/* ------------------------------------------------------------------ 2D */

/**
 * Dessin de la coupe entre A et B, à l'échelle (même échelle en longueur et en hauteur), à la manière d'un dessin
 * d'architecte : trait de coupe fin, masse coupée en gris très clair, arbres hachurés, cotes petites qui s'évitent.
 * `soleil` = { azimut, hauteur, visible, heure } ou null.
 */
export function dessinerCoupe(svg, P, soleil, o = {}) {
  const vue = P.audela && o.audela && o.audela !== "aucun" ? o.audela : null;
  const k0 = Math.max(0, Math.ceil((0 - P.s[0]) / P.pas)), k1 = Math.min(P.nb - 1, Math.floor((P.L - P.s[0]) / P.pas));
  if (k1 - k0 < 2) { svg.innerHTML = ""; return; }
  let zmin = Infinity, zmax = -Infinity;
  for (let k = k0; k <= k1; k++) {
    zmin = Math.min(zmin, P.sol[k]);
    zmax = Math.max(zmax, P.sol[k], P.bat[k] || -Infinity, P.veg[k] || -Infinity);
  }
  // au-delà de la coupe : ce qui est proche (< 30 m) entre dans le cadre ; le lointain peut en sortir
  if (vue) for (const a of P.audela.plans.slice(0, 4)) for (const z of a) if (z > zmax) zmax = z;
  const long = P.s[k1] - P.s[k0], bas = zmin - Math.max(1.5, long * 0.015), haut = Math.max(zmax + Math.max(2, long * 0.02), bas + long * 0.12);
  // largeur de la carte (pixels de l'écran, textes à leur taille), hauteur limitée ; échelle identique en x et en z
  const m = { g: 46, d: 12, h: 8, b: 20 }, largeDispo = Math.max(360, (svg.parentElement?.clientWidth || 736) - 16), Hmax = Math.max(260, Math.round(innerHeight * 0.36));
  const e = Math.min((largeDispo - m.g - m.d) / long, (Hmax - m.h - m.b) / (haut - bas));
  const W = Math.round(long * e + m.g + m.d), H = Math.round((haut - bas) * e + m.h + m.b);
  svg.style.width = `${W}px`;
  const X = s => m.g + (s - P.s[k0]) * e, Y = z => m.h + (haut - z) * e, f = v => v.toFixed(1);
  let t = `<defs><clipPath id="cadreCoupe"><rect x="${m.g}" y="${m.h}" width="${W - m.g - m.d}" height="${H - m.h - m.b}"/></clipPath>`
    + `<pattern id="hachureArbres" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" class="hachure"/></pattern></defs>`;
  // altitudes rondes
  const ecart = [1, 2, 5, 10, 20, 50, 100].find(v => (haut - bas) / v <= 6) || 200;
  for (let z = Math.ceil(bas / ecart) * ecart; z < haut; z += ecart)
    t += `<line x1="${m.g}" x2="${W - m.d}" y1="${f(Y(z))}" y2="${f(Y(z))}" class="grille"/><text x="${m.g - 5}" y="${f(Y(z) + 3)}" text-anchor="end">${z} m</text>`;
  const pasD = [5, 10, 20, 50, 100].find(v => long / v <= 9) || 200;
  for (let d = 0; d <= long; d += pasD) t += `<line x1="${f(X(P.s[k0] + d))}" x2="${f(X(P.s[k0] + d))}" y1="${H - m.b}" y2="${H - m.b + 3}" class="axe"/><text x="${f(X(P.s[k0] + d))}" y="${H - 6}" text-anchor="middle">${d} m</text>`;
  t += `<g clip-path="url(#cadreCoupe)">`;
  const chemin = (a, b, dessus, dessous) => {
    let p = "";
    for (let k = a; k <= b; k++) p += `${k === a ? "M" : "L"}${f(X(P.s[k]))},${f(Y(dessus(k)))}`;
    if (dessous) for (let k = b; k >= a; k--) p += `L${f(X(P.s[k]))},${f(Y(dessous(k)))}`;
    return p + (dessous ? "Z" : "");
  };
  if (vue) t += dessinAudela(P.audela, vue, X, Y, H, f);
  // arbres : simple hachure diagonale grise, du sol jusqu'à la cime
  for (const T of P.arbres || []) {
    const a = Math.max(T.a, k0), b = Math.min(T.b, k1);
    if (b <= a) continue;
    t += `<path d="${chemin(a, b, k => T.haut[k - T.a], k => P.sol[k])}" class="arbres"/>`;
  }
  // masse coupée (terrain et bâtiments, d'une seule matière) et trait de coupe, murs à leur position exacte
  const dans = d => d >= P.s[k0] && d <= P.s[k1];
  let masse = "", trait = "";
  for (let k = k0; k <= k1; k++) {
    const pts = [];
    if (!isNaN(P.debut[k]) && dans(P.debut[k])) pts.push([P.debut[k], Math.min(P.sol[k], P.bat[k])], [P.debut[k], P.bat[k]]);
    pts.push([P.s[k], enveloppe(P, k)]);
    if (!isNaN(P.fin[k]) && dans(P.fin[k])) pts.push([P.fin[k], P.bat[k]], [P.fin[k], Math.min(P.sol[k], P.bat[k])]);
    for (const [d, z] of pts) trait += `${trait ? "L" : "M"}${f(X(d))},${f(Y(z))}`;
  }
  masse = `${trait}L${f(X(P.s[k1]))},${H}L${f(X(P.s[k0]))},${H}Z`;
  t += `<path d="${masse}" class="terrain"/><path d="${trait}" class="sol"/>`;
  // terrain estimé sous les bâtiments coupés : traitillé léger
  let estime = "";
  for (const [a, b] of suites(P.bat, k0, k1)) {
    const pts = [];
    if (!isNaN(P.debut[a]) && dans(P.debut[a])) pts.push([P.debut[a], P.sol[a]]);
    for (let k = a; k <= b; k++) pts.push([P.s[k], P.sol[k]]);
    if (!isNaN(P.fin[b]) && dans(P.fin[b])) pts.push([P.fin[b], P.sol[b]]);
    pts.forEach(([d, z], i) => estime += `${i ? "L" : "M"}${f(X(d))},${f(Y(z))}`);
  }
  if (estime) t += `<path d="${estime}" class="sol-estime"/>`;
  // points du nuage proches de la coupe : un chemin par catégorie (points ronds), préparé une fois par profil
  if (P.points?.n) {
    const N = P.points, pas = Math.ceil(N.n / 40000); // au-delà de 40 000 points, le dessin n'en montre qu'une partie
    N.svg ||= CATEGORIES.map((_, c) => {
      let d = "";
      for (let k = 0; k < N.n; k += pas) if (N.c[k] === c) d += `M${f(X(N.s[k]))},${f(Y(N.z[k]))}h0`;
      return d ? `<path d="${d}" class="points pt${c}"/>` : "";
    }).join("");
    t += N.svg;
  }
  // limites de parcelle : tiretés fins du terrain jusqu'en bas (celles de la parcelle choisie un peu plus marquées)
  const rangee = H - m.b - 5; // ligne des numéros de parcelle, sous le profil
  const limite = (s, classe, dessus) => {
    if (!(s > P.s[k0] && s < P.s[k1])) return;
    const z = P.sol[Math.round((s - P.s[0]) / P.pas)] ?? zmin;
    t += `<line x1="${f(X(s))}" x2="${f(X(s))}" y1="${f(Y(z) - dessus)}" y2="${H - m.b}" class="${classe}"/>`;
  };
  for (const s of P.voisines || []) limite(s, "limite-voisine", 8);
  for (const s of P.limites) limite(s, "limite", 14);
  // étiquettes : chacune réserve sa place ; une étiquette qui en recouvrirait une autre est décalée, sinon omise
  const prises = [], large = (texte, taille) => texte.length * taille * 0.56;
  const libre = (x0, y0, x1, y1) => x0 >= m.g && x1 <= W - m.d && y0 >= m.h && !prises.some(b => x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]);
  // une étiquette « hors masse » ne doit pas mordre dans le terrain ou les bâtiments coupés (sous le trait de coupe)
  const dansMasse = (x0, y0, x1, y1) => {
    for (let px = x0; px <= x1; px += 2) {
      const k = Math.min(k1, Math.max(k0, Math.round((P.s[k0] + (px - m.g) / e - P.s[0]) / P.pas)));
      if (y1 > Y(enveloppe(P, k)) + 0.5) return true;
    }
    return false;
  };
  const poser = (x, y, texte, ancre, classe, taille, decalages = [0], horsMasse = false) => {
    const l = large(texte, taille), x0 = ancre === "end" ? x - l : ancre === "middle" ? x - l / 2 : x;
    for (const dy of decalages) {
      if (!libre(x0 - 1, y + dy - taille, x0 + l + 1, y + dy + 2)) continue;
      if (horsMasse && dansMasse(x0 - 1, y + dy - taille, x0 + l + 1, y + dy + 2)) continue;
      prises.push([x0 - 1, y + dy - taille, x0 + l + 1, y + dy + 2]);
      t += `<text x="${f(x)}" y="${f(y + dy)}" text-anchor="${ancre}" class="${classe}">${texte}</text>`;
      return dy;
    }
    return null;
  };
  // numéros des parcelles traversées, alignés sur une même ligne
  for (const p of P.parcelles || []) {
    const a = Math.max(p.s0, P.s[k0]), b = Math.min(p.s1, P.s[k1]);
    if (b - a < 3) continue;
    poser(X((a + b) / 2), rangee, String(p.numero), "middle", p.choisie ? "numero choisie" : "numero", 9.5);
  }
  // cotes des bâtiments coupés (arrondies à 10 cm) : point bas du terrain, corniches aux deux façades, faîte ;
  // un repère fin au niveau coté, le texte à côté (décalé avec un renvoi si la place est prise)
  for (const [a, b] of suites(P.bat, k0, k1)) {
    if (P.s[b] - P.s[a] < 3) continue;
    let zb = Infinity, kf = a, kb = a;
    for (let k = a; k <= b; k++) { if (P.sol[k] < zb) { zb = P.sol[k]; kb = k; } if (P.bat[k] > P.bat[kf]) kf = k; }
    // repère : un petit trait horizontal au niveau coté, juste à côté du point ; le texte sur la même ligne, à droite
    // ou à gauche du trait (côté préféré d'abord). Seulement si les deux côtés sont pris : texte décalé en hauteur,
    // relié au trait par un fin renvoi.
    // symbole de niveau traditionnel : petit triangle, pointe en bas, posé sur une barre au niveau coté ; le texte à
    // côté du triangle, du côté libre (ni sur une autre étiquette, ni dans la masse coupée)
    const cote = (x, z, texte, prefere) => {
      const y = Y(z), cotes = prefere === "g" ? ["g", "d"] : ["d", "g"];
      const essai = (sens, dy) => {
        const xt = sens === "g" ? x - 7 : x + 7, yt = y - 1.5 + dy;
        const dyPose = poser(xt, yt, texte, sens === "g" ? "end" : "start", "cote", 10, [0], true);
        if (dyPose == null) return false;
        t += `<path d="M${f(x - 5)},${f(y)}H${f(x + 5)}M${f(x - 3.2)},${f(y - 5.5)}H${f(x + 3.2)}L${f(x)},${f(y)}Z" class="cote-trait niveau"/>`;
        if (dy) t += `<line x1="${f(x)}" x2="${f(xt)}" y1="${f(y - 5.5)}" y2="${f(yt - 3)}" class="cote-trait"/>`;
        return true;
      };
      for (const sens of cotes) if (essai(sens, 0)) return;
      for (const dy of [-12, -24, 12, 24]) for (const sens of cotes) if (essai(sens, dy)) return;
    };
    const xa = X(isNaN(P.debut[a]) ? P.s[a] : P.debut[a]), xb = X(isNaN(P.fin[b]) ? P.s[b] : P.fin[b]), za = P.bat[a], zbord = P.bat[b];
    const xf = X(P.s[kf]), xbas = X(P.s[kb]);
    if (P.bat[kf] > Math.max(za, zbord) + 0.3) cote(xf, P.bat[kf], tr("coupe.faite", { z: alt(P.bat[kf]) }), xf - xa < xb - xf ? "d" : "g");
    cote(xa, za, tr("coupe.corniche", { z: alt(za) }), "g");
    if (Math.abs(zbord - za) >= 0.2) cote(xb, zbord, tr("coupe.corniche", { z: alt(zbord) }), "d");
    cote(xbas, zb, tr("coupe.bas", { z: alt(zb) }), xbas - xa < xb - xbas ? "g" : "d");
  }
  // rayon du soleil vu dans le plan de coupe (hauteur apparente), posé au milieu de la coupe
  let note = "";
  if (soleil && soleil.visible) {
    const a = soleil.azimut * Math.PI / 180, h = soleil.hauteur * Math.PI / 180;
    const ds = (Math.sin(a) * P.ux + Math.cos(a) * P.uy) * Math.cos(h), dz = Math.sin(h), km = Math.round((k0 + k1) / 2);
    const z0 = Math.max(P.sol[km], P.bat[km] || -Infinity), n = Math.hypot(ds, dz) || 1, portee = (long + (haut - bas)) * 1.2;
    const x1 = X(P.s[km]), y1 = Y(z0), x2 = X(P.s[km] + ds / n * portee), y2 = Y(z0 + dz / n * portee);
    t += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" class="rayon"/><circle cx="${f(x1)}" cy="${f(y1)}" r="2" class="pied"/>`;
    // disque du soleil là où le rayon sort du cadre
    const tx = ds > 1e-6 ? (W - m.d - 12 - x1) / (x2 - x1) : ds < -1e-6 ? (m.g + 12 - x1) / (x2 - x1) : Infinity, ty = (m.h + 12 - y1) / (y2 - y1);
    const tt = Math.min(tx, ty > 0 ? ty : Infinity);
    if (isFinite(tt)) t += `<circle cx="${f(x1 + (x2 - x1) * tt)}" cy="${f(y1 + (y2 - y1) * tt)}" r="5" class="astre"/>`;
    const app = Math.atan2(dz, Math.abs(ds)) * 180 / Math.PI;
    note = tr("coupe.soleilPlan", { heure: soleil.heure, angle: nombre(app, 0) });
  } else if (soleil) note = tr(soleil.hauteur <= 0 ? "coupe.soleilCouche" : "coupe.soleilCache", { heure: soleil.heure });
  t += `</g><line x1="${m.g}" x2="${W - m.d}" y1="${H - m.b}" y2="${H - m.b}" class="axe"/>`;
  t += `<text x="${m.g + 4}" y="${m.h + 11}" class="repere">${P.lettres?.[0] || "A"}</text><text x="${W - m.d - 4}" y="${m.h + 11}" text-anchor="end" class="repere">${P.lettres?.[1] || "B"}</text>`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = t;
  return { note, long, zmin, zmax };
}
