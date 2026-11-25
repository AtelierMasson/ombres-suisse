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
 * `bat` suit les bâtiments tels qu'affichés (contours redressés), `veg` la canopée ; NaN où il n'y en a pas.
 */
export function profilCoupe(G, contours, A, B, parcelle, pas = 0.25) {
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
  for (let k = 0; k < nb; k++) {
    const d = s0 + k * pas, x = A[0] + ux * d, y = A[1] + uy * d;
    s[k] = d; sol[k] = solEn(G, x, y);
    const b = contours && dansBatiment(contours, x, y) ? valeurEn(G, G.bat, x, y) : NaN;
    bat[k] = b > sol[k] + 0.5 ? b : NaN;
    const v = isNaN(bat[k]) ? valeurEn(G, G.veg, x, y) : NaN;
    veg[k] = v > sol[k] + 1 ? v : NaN;
  }
  // limites de parcelle traversées
  const limites = [];
  for (const a of parcelle?.anneauxRel || []) for (let k = 0; k < a.length - 1; k++) {
    const [x1, y1] = a[k], [x2, y2] = a[k + 1], ex = x2 - x1, ey = y2 - y1, det = ux * ey - uy * ex;
    if (Math.abs(det) < 1e-9) continue;
    const t = ((x1 - A[0]) * ey - (y1 - A[1]) * ex) / det, r = ((x1 - A[0]) * uy - (y1 - A[1]) * ux) / det;
    if (r >= 0 && r <= 1) limites.push(t);
  }
  return { A, B, L, ux, uy, pas, nb, s, sol, bat, veg, limites: limites.sort((a, b) => a - b) };
}

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
  const grp = new THREE.Group(), pt = (k, z) => [P.A[0] + P.ux * P.s[k], z - zRef, -(P.A[1] + P.uy * P.s[k])];
  const plein = (pos, couleur) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals(); // pour l'occlusion ambiante
    grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: couleur, side: THREE.DoubleSide, fog: false })));
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
  };
  plein(bande(0, P.nb - 1, () => zBas + zRef, k => P.sol[k]), couleurs.terrain);
  const ligneSol = [];
  for (let k = 0; k < P.nb; k++) ligneSol.push(pt(k, P.sol[k]));
  trait(ligneSol);
  for (const [a, b] of suites(P.bat)) {
    if (b - a < 1) continue;
    plein(bande(a, b, k => P.sol[k] - 0.05, k => P.bat[k]), couleurs.bati);
    const c = [pt(a, P.sol[a])];
    for (let k = a; k <= b; k++) c.push(pt(k, P.bat[k]));
    c.push(pt(b, P.sol[b]));
    trait(c);
  }
  return grp;
}

/* ------------------------------------------------------------------ 2D */

/**
 * Dessin de la coupe entre A et B, à l'échelle (même échelle en longueur et en hauteur).
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
  let t = `<defs><clipPath id="cadreCoupe"><rect x="${m.g}" y="${m.h}" width="${W - m.g - m.d}" height="${H - m.h - m.b}"/></clipPath></defs>`;
  // altitudes rondes
  const ecart = [1, 2, 5, 10, 20, 50, 100].find(v => (haut - bas) / v <= 6) || 200;
  for (let z = Math.ceil(bas / ecart) * ecart; z < haut; z += ecart)
    t += `<line x1="${m.g}" x2="${W - m.d}" y1="${f(Y(z))}" y2="${f(Y(z))}" class="grille"/><text x="${m.g - 5}" y="${f(Y(z) + 3.5)}" text-anchor="end">${z} m</text>`;
  const pasD = [5, 10, 20, 50, 100].find(v => long / v <= 9) || 200;
  for (let d = 0; d <= long; d += pasD) t += `<line x1="${f(X(P.s[k0] + d))}" x2="${f(X(P.s[k0] + d))}" y1="${H - m.b}" y2="${H - m.b + 4}" class="axe"/><text x="${f(X(P.s[k0] + d))}" y="${H - 5}" text-anchor="middle">${d} m</text>`;
  t += `<g clip-path="url(#cadreCoupe)">`;
  const chemin = (a, b, dessus, dessous) => {
    let p = "";
    for (let k = a; k <= b; k++) p += `${k === a ? "M" : "L"}${f(X(P.s[k]))},${f(Y(dessus(k)))}`;
    if (dessous) for (let k = b; k >= a; k--) p += `L${f(X(P.s[k]))},${f(Y(dessous(k)))}`;
    return p + (dessous ? "Z" : "");
  };
  // arbres (silhouette), terrain poché, bâtiments pochés, trait de coupe
  for (const [a, b] of suites(P.veg, k0, k1)) t += `<path d="${chemin(a, b, k => P.veg[k], k => P.sol[k])}" class="arbres"/>`;
  t += `<path d="${chemin(k0, k1, k => P.sol[k], () => bas - 5)}" class="terrain"/>`;
  for (const [a, b] of suites(P.bat, k0, k1)) t += `<path d="${chemin(a, b, k => P.bat[k], k => P.sol[k] - 0.05)}" class="bati"/>`;
  t += `<path d="${chemin(k0, k1, k => P.sol[k])}" class="sol"/>`;
  // limites de parcelle
  for (const s of P.limites) if (s > P.s[k0] && s < P.s[k1]) {
    const z = P.sol[Math.round((s - P.s[0]) / P.pas)] ?? zmin;
    t += `<line x1="${f(X(s))}" x2="${f(X(s))}" y1="${f(Y(z) - 26)}" y2="${f(Y(z) + 8)}" class="limite"/><text x="${f(X(s))}" y="${f(Y(z) - 29)}" text-anchor="middle" class="limite">limite</text>`;
  }
  // rayon du soleil vu dans le plan de coupe (hauteur apparente), posé au milieu de la coupe
  let note = "";
  if (soleil && soleil.visible) {
    const a = soleil.azimut * Math.PI / 180, h = soleil.hauteur * Math.PI / 180;
    const ds = (Math.sin(a) * P.ux + Math.cos(a) * P.uy) * Math.cos(h), dz = Math.sin(h), km = Math.round((k0 + k1) / 2);
    const z0 = Math.max(P.sol[km], P.bat[km] || -Infinity), n = Math.hypot(ds, dz) || 1, portee = (long + (haut - bas)) * 1.2;
    const x1 = X(P.s[km]), y1 = Y(z0), x2 = X(P.s[km] + ds / n * portee), y2 = Y(z0 + dz / n * portee);
    t += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" class="rayon"/><circle cx="${f(x1)}" cy="${f(y1)}" r="3" class="pied"/>`;
    // disque du soleil là où le rayon sort du cadre
    const tx = ds > 1e-6 ? (W - m.d - 12 - x1) / (x2 - x1) : ds < -1e-6 ? (m.g + 12 - x1) / (x2 - x1) : Infinity, ty = (m.h + 12 - y1) / (y2 - y1);
    const tt = Math.min(tx, ty > 0 ? ty : Infinity);
    if (isFinite(tt)) t += `<circle cx="${f(x1 + (x2 - x1) * tt)}" cy="${f(y1 + (y2 - y1) * tt)}" r="7" class="astre"/>`;
    const app = Math.atan2(dz, Math.abs(ds)) * 180 / Math.PI;
    note = `soleil à ${soleil.heure} : ${app.toFixed(0)}° dans le plan de coupe`;
  } else if (soleil) note = `soleil ${soleil.hauteur <= 0 ? "couché" : "caché par le relief"} à ${soleil.heure}`;
  t += `</g><line x1="${m.g}" x2="${W - m.d}" y1="${H - m.b}" y2="${H - m.b}" class="axe"/>`;
  t += `<text x="${m.g + 4}" y="${m.h + 12}" class="repere">A</text><text x="${W - m.d - 4}" y="${m.h + 12}" text-anchor="end" class="repere">B</text>`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = t;
  return { note, long, zmin, zmax };
}
