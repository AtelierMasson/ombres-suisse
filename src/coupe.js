// Coupe verticale à travers le terrain, les bâtiments et les arbres, le long d'une ligne A–B.
// Le profil est lu dans les grilles ; il sert au trait de coupe dans la 3D (surfaces tranchées pochées)
// et au dessin 2D (SVG) avec altitudes, limites de parcelle et rayon du soleil.
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { solEn } from "./grille.js";
import { dansBatiment } from "./contours.js";

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
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L, lim = G.R - 1;
  // étendue de la droite dans le carré du modèle
  let s0 = -Infinity, s1 = Infinity;
  for (const [o, d] of [[A[0], ux], [A[1], uy]]) {
    if (Math.abs(d) < 1e-9) continue;
    const a = (-lim - o) / d, b = (lim - o) / d;
    s0 = Math.max(s0, Math.min(a, b)); s1 = Math.min(s1, Math.max(a, b));
  }
  s0 = Math.max(s0, -2 * G.R * 1.5); s1 = Math.min(s1, 2 * G.R * 1.5);
  const nb = Math.max(2, Math.floor((s1 - s0) / pas) + 1), s = new Float32Array(nb), sol = new Float32Array(nb), bat = new Float32Array(nb), veg = new Float32Array(nb);
  // toit tel qu'affiché à la distance d : le plan du pan s'il y en a un, sinon la grille (NaN hors bâtiment)
  const toit = d => {
    const x = A[0] + ux * d, y = A[1] + uy * d, pan = contours?.pans ? contours.pans.hauteurEn(x, y) : NaN;
    const b = aucun ? NaN : grille ? (isNaN(celluleEn(G, grille, x, y)) ? NaN : valeurEn(G, grille, x, y))
      : contours && dansBatiment(contours, x, y) ? (isNaN(pan) ? valeurEn(G, G.bat, x, y) : pan) : NaN;
    return b > solEn(G, x, y) + 0.5 ? b : NaN;
  };
  for (let k = 0; k < nb; k++) {
    const d = s0 + k * pas, x = A[0] + ux * d, y = A[1] + uy * d;
    s[k] = d; sol[k] = solEn(G, x, y);
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
  const N = lireNuage(P, o.nuage, o.distance || 0);
  P.points = N.points;
  P.arbres = arbresCoupe(P, N);
  return P;
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
const alt = z => (Math.round(z * 10) / 10).toFixed(1).replace(".", ",");

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
    l.renderOrder = 3;
    grp.add(l);
    (grp.userData.traits ||= []).push(l); // hors de l'occlusion ambiante (scene.js)
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
  // arbres coupés : silhouette de la couronne et tronc, en aplat translucide dans le plan (groupe `arbres`)
  if (couleurs.arbres && P.arbres?.length) {
    const pos = [], troncs = [];
    for (const T of P.arbres) {
      pos.push(...bande(T.a, T.b, k => T.bas[k - T.a], k => T.haut[k - T.a]));
      for (const k of T.troncs) {
        const x = P.s[k], bas = P.sol[k] - zRef, haut = T.bas[k - T.a] - zRef, q = (d, y) => [P.A[0] + P.ux * (x + d), y, -(P.A[1] + P.uy * (x + d))];
        troncs.push(...q(-0.15, bas), ...q(0.15, bas), ...q(0.15, haut), ...q(-0.15, bas), ...q(0.15, haut), ...q(-0.15, haut));
      }
    }
    const arbres = new THREE.Group(), aplat = (p, opacite) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: couleurs.arbres, side: THREE.DoubleSide, fog: false, transparent: true, opacity: opacite, depthWrite: false }));
      m.renderOrder = 2;
      arbres.add(m);
    };
    aplat(pos, 0.5);
    if (troncs.length) aplat(troncs, 0.85);
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
export function dessinerCoupe(svg, P, soleil) {
  const k0 = Math.max(0, Math.ceil((0 - P.s[0]) / P.pas)), k1 = Math.min(P.nb - 1, Math.floor((P.L - P.s[0]) / P.pas));
  if (k1 - k0 < 2) { svg.innerHTML = ""; return; }
  let zmin = Infinity, zmax = -Infinity;
  for (let k = k0; k <= k1; k++) {
    zmin = Math.min(zmin, P.sol[k]);
    zmax = Math.max(zmax, P.sol[k], P.bat[k] || -Infinity, P.veg[k] || -Infinity);
  }
  const long = P.s[k1] - P.s[k0], bas = zmin - Math.max(2, long * 0.03), haut = Math.max(zmax + Math.max(3, long * 0.05), bas + long * 0.22);
  const W = 720, m = { g: 46, d: 12, h: 8, b: 20 }, e = (W - m.g - m.d) / long, H = Math.round((haut - bas) * e + m.h + m.b);
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
  // arbres : couronne hachurée au contour fin, tronc
  for (const T of P.arbres || []) {
    const a = Math.max(T.a, k0), b = Math.min(T.b, k1);
    if (b <= a) continue;
    for (const k of T.troncs) if (k >= a && k <= b) t += `<line x1="${f(X(P.s[k]))}" x2="${f(X(P.s[k]))}" y1="${f(Y(P.sol[k]))}" y2="${f(Y(T.bas[k - T.a]))}" class="tronc"/>`;
    t += `<path d="${chemin(a, b, k => T.haut[k - T.a], k => T.bas[k - T.a])}" class="arbres"/>`;
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
  const poser = (x, y, texte, ancre, classe, taille, decalages = [0]) => {
    const l = large(texte, taille), x0 = ancre === "end" ? x - l : ancre === "middle" ? x - l / 2 : x;
    for (const dy of decalages) {
      if (!libre(x0 - 1, y + dy - taille, x0 + l + 1, y + dy + 2)) continue;
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
    poser(X((a + b) / 2), rangee, String(p.numero), "middle", p.choisie ? "numero choisie" : "numero", 8);
  }
  // cotes des bâtiments coupés (arrondies à 10 cm) : point bas du terrain, corniches aux deux façades, faîte ;
  // un repère fin au niveau coté, le texte à côté (décalé avec un renvoi si la place est prise)
  for (const [a, b] of suites(P.bat, k0, k1)) {
    if (P.s[b] - P.s[a] < 3) continue;
    let zb = Infinity, kf = a, kb = a;
    for (let k = a; k <= b; k++) { if (P.sol[k] < zb) { zb = P.sol[k]; kb = k; } if (P.bat[k] > P.bat[kf]) kf = k; }
    const cote = (x, z, texte, ancre, dy) => {
      const y = Y(z), dx = ancre === "end" ? -7 : ancre === "start" ? 7 : 0;
      const pose = poser(x + dx, y + dy, texte, ancre, "cote", 7.5, [0, -9, 9, -18, 18, -27]);
      if (pose == null) return;
      t += `<line x1="${f(x - 4)}" x2="${f(x + 4)}" y1="${f(y)}" y2="${f(y)}" class="cote-trait"/>`;
      if (pose) t += `<line x1="${f(x + dx * 0.6)}" x2="${f(x + dx)}" y1="${f(y)}" y2="${f(y + dy + pose - 2.5)}" class="cote-trait"/>`;
    };
    const xa = X(isNaN(P.debut[a]) ? P.s[a] : P.debut[a]), xb = X(isNaN(P.fin[b]) ? P.s[b] : P.fin[b]), za = P.bat[a], zbord = P.bat[b];
    if (P.bat[kf] > Math.max(za, zbord) + 0.3) cote(X(P.s[kf]), P.bat[kf], `faîte ${alt(P.bat[kf])}`, "middle", -5);
    cote(xa, za, `corniche ${alt(za)}`, "end", 2.5);
    if (Math.abs(zbord - za) >= 0.2) cote(xb, zbord, `corniche ${alt(zbord)}`, "start", 2.5);
    cote(X(P.s[kb]), zb, `bas ${alt(zb)}`, X(P.s[kb]) - xa < xb - X(P.s[kb]) ? "end" : "start", 2.5);
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
    note = `soleil à ${soleil.heure} : ${app.toFixed(0)}° dans le plan de coupe`;
  } else if (soleil) note = `soleil ${soleil.hauteur <= 0 ? "couché" : "caché par le relief"} à ${soleil.heure}`;
  t += `</g><line x1="${m.g}" x2="${W - m.d}" y1="${H - m.b}" y2="${H - m.b}" class="axe"/>`;
  t += `<text x="${m.g + 4}" y="${m.h + 11}" class="repere">A</text><text x="${W - m.d - 4}" y="${m.h + 11}" text-anchor="end" class="repere">B</text>`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = t;
  return { note, long, zmin, zmax };
}
