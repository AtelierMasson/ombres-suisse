// Géométries de la scène : terrain et socle, bâtiments (toits + murs droits), canopée, nuages de points, limite de parcelle.
// Repère three.js : x = est, y = altitude (relative à zRef), z = sud (−nord).
import * as THREE from "three";
import { solEn } from "./grille.js";
import { contoursBatiments } from "./contours.js";
import { pansToits } from "./pans.js";

/** Suite de nombres dans un tableau typé qui grandit par doublement, quand la taille n'est pas connue d'avance. */
class Tampon {
  constructor(Type = Float32Array, taille = 4096) { this.a = new Type(taille); this.n = 0; }
  ajouter(...v) {
    if (this.n + v.length > this.a.length) {
      const b = new this.a.constructor(Math.max(2 * this.a.length, this.n + v.length));
      b.set(this.a.subarray(0, this.n)); this.a = b;
    }
    for (let k = 0; k < v.length; k++) this.a[this.n++] = v[k];
  }
  /** Tableau ajusté à la taille utile. */
  fin() { return this.a.slice(0, this.n); }
}

/** Après l'envoi à la carte graphique, la copie en mémoire vive ne sert plus (couches jamais relues ni exportées). */
function jetable(g) {
  g.computeBoundingSphere();
  for (const a of [...Object.values(g.attributes), g.index]) a?.onUpload(function () { this.array = null; });
  return g;
}

/** Terrain (un sommet tous les mètres) avec coordonnées de texture pour le fond de plan. */
export function terrain(G, zRef) {
  const pas = 2, m = Math.floor(G.n / pas) + 1, pos = new Float32Array(m * m * 3), uv = new Float32Array(m * m * 2);
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
    const x = G.x0 + a * pas * G.c, y = G.x0 + b * pas * G.c, k = b * m + a;
    pos[3 * k] = x; pos[3 * k + 1] = solEn(G, x, y) - zRef; pos[3 * k + 2] = -y;
    uv[2 * k] = (x - G.x0) / (2 * G.R); uv[2 * k + 1] = (y - G.x0) / (2 * G.R);
  }
  const idx = new Uint32Array((m - 1) * (m - 1) * 6);
  let q = 0;
  for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
    const p = b * m + a;
    idx[q++] = p; idx[q++] = p + 1; idx[q++] = p + m + 1; idx[q++] = p; idx[q++] = p + m + 1; idx[q++] = p + m;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  return g;
}

/** Hauteur du terrain tel qu'affiché (triangles de 1 m) au coin (i, j) de la grille : sert à poser des calques dessus. */
export function hauteurTerrain(G, i, j) {
  const pas = 2, a = Math.min(Math.floor(i / pas), Math.floor(G.n / pas) - 1), b = Math.min(Math.floor(j / pas), Math.floor(G.n / pas) - 1);
  const u = (i - a * pas) / pas, v = (j - b * pas) / pas, z = (a, b) => solEn(G, G.x0 + a * pas * G.c, G.x0 + b * pas * G.c);
  const z00 = z(a, b), z11 = z(a + 1, b + 1);
  return u >= v ? z00 + u * (z(a + 1, b) - z00) + v * (z11 - z(a + 1, b)) : z00 + u * (z11 - z(a, b + 1)) + v * (z(a, b + 1) - z00);
}

/**
 * Socle : bords verticaux jusqu'à une base plane, comme une maquette posée. Là où un bâtiment touche le bord, la face
 * monte jusqu'à son toit : la tranche du bâtiment coupé fait partie du socle (une seule masse).
 */
export function socle(G, zRef, zBas, bords = null, avecReleve = true) {
  // `bords` (facultatif) : hauteurs absolues des bâtiments de comparaison qui traversent chaque côté, par cellule
  const { n, c, x0, bat } = G, R = n * c / 2, pos = new Float32Array(4 * n * 18);
  // terrain du bord : comme le maillage du terrain (sommets tous les 1 m, interpolés entre deux)
  const sol = (x, y) => {
    const t = (v) => Math.floor((v - x0) / (2 * c)) * 2 * c + x0;
    if (Math.abs(Math.abs(x) - R) < 1e-6) { const y0 = t(Math.min(y, R - 2 * c)), u = (y - y0) / (2 * c); return solEn(G, x, y0) * (1 - u) + solEn(G, x, y0 + 2 * c) * u; }
    const xa = t(Math.min(x, R - 2 * c)), u = (x - xa) / (2 * c); return solEn(G, xa, y) * (1 - u) + solEn(G, xa + 2 * c, y) * u;
  };
  // les quatre côtés, cellule par cellule : cellule (i, j), extrémités (x, y) du segment de bord
  let q = 0;
  const face = (i, j, xa, ya, xb, yb, cote, k) => {
    const b = bords?.[cote][k];
    const h = Math.max(avecReleve && bat[j * n + i] || -Infinity, b > -Infinity ? b : -Infinity), za = sol(xa, ya), zb = sol(xb, yb);
    const ha = (h > -Infinity ? Math.max(za, h) : za) - zRef, hb = (h > -Infinity ? Math.max(zb, h) : zb) - zRef;
    // A, A bas, B bas ; A, B bas, B
    for (const [x, y, z] of [[xa, ha, -ya], [xa, zBas, -ya], [xb, zBas, -yb], [xa, ha, -ya], [xb, zBas, -yb], [xb, hb, -yb]]) { pos[q++] = x; pos[q++] = y; pos[q++] = z; }
  };
  for (let i = 0; i < n; i++) face(i, 0, x0 + i * c, -R, x0 + (i + 1) * c, -R, 0, i);
  for (let j = 0; j < n; j++) face(n - 1, j, R, x0 + j * c, R, x0 + (j + 1) * c, 1, j);
  for (let i = n - 1; i >= 0; i--) face(i, n - 1, x0 + (i + 1) * c, R, x0 + i * c, R, 2, i);
  for (let j = n - 1; j >= 0; j--) face(0, j, -R, x0 + (j + 1) * c, -R, x0 + j * c, 3, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Nappe d'une grille de hauteurs (NaN = vide), lissée aux coins. Avec `C` (contours des bâtiments), chaque volume
 * a sa propre nappe (pas de pente entre deux toits de hauteurs différentes) et les coins de bord sont redressés.
 * `sauf` (numéro de pan par cellule) écarte les cellules déjà couvertes par un pan de toit.
 */
export function nappe(G, val, zRef, C, sauf, normales = true) {
  const { n, c, x0 } = G, m = n + 1;
  const rang = new Int32Array(m * m).fill(-1), vol = new Int32Array(m * m).fill(-1);
  const coin = k => { // sans contours : moyenne des cellules renseignées autour du coin
    const i = k % m, j = (k - i) / m;
    let s = 0, q = 0;
    if (i > 0 && j > 0) { const v = val[(j - 1) * n + i - 1]; if (!isNaN(v)) { s += v; q++; } }
    if (i < n && j > 0) { const v = val[(j - 1) * n + i]; if (!isNaN(v)) { s += v; q++; } }
    if (i > 0 && j < n) { const v = val[j * n + i - 1]; if (!isNaN(v)) { s += v; q++; } }
    if (i < n && j < n) { const v = val[j * n + i]; if (!isNaN(v)) { s += v; q++; } }
    return s / q;
  };
  const volume = p => C ? ((sauf && sauf[p] >= 0) ? -1 : C.seg[p]) : isNaN(val[p]) ? -1 : 0;
  // deux passes, pour des tableaux typés à la bonne taille : compter cellules et sommets, puis remplir
  let pos = null, idx = null, vols = null, ns = 0, nc = 0;
  const sommet = (k, s) => {
    if (rang[k] < 0 || vol[k] !== s) {
      rang[k] = ns; vol[k] = s;
      if (pos) {
        if (C) { pos[3 * ns] = C.px[k]; pos[3 * ns + 1] = C.hauteurCoin(k, s) - zRef; pos[3 * ns + 2] = -C.py[k]; }
        else { pos[3 * ns] = x0 + (k % m) * c; pos[3 * ns + 1] = coin(k) - zRef; pos[3 * ns + 2] = -(x0 + Math.floor(k / m) * c); }
      }
      ns++;
    }
    return rang[k];
  };
  for (const remplir of [false, true]) {
    if (remplir) {
      pos = new Float32Array(3 * ns); idx = new Uint32Array(6 * nc); vols = new Int32Array(nc);
      rang.fill(-1); vol.fill(-1); ns = nc = 0;
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const s = volume(j * n + i);
      if (s < 0) continue;
      const A = sommet(j * m + i, s), B = sommet(j * m + i + 1, s), D = sommet((j + 1) * m + i + 1, s), E = sommet((j + 1) * m + i, s);
      if (remplir) {
        const q = 6 * nc;
        idx[q] = A; idx[q + 1] = B; idx[q + 2] = D; idx[q + 3] = A; idx[q + 4] = D; idx[q + 5] = E;
        vols[nc] = s;
      }
      nc++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (normales) g.computeVertexNormals();
  g.userData.volumes = vols; // volume de chaque paire de triangles (désignation au clic, mode pro)
  return g;
}

/**
 * Canopée qui porte l'ombre des arbres en points : jamais affichée, elle est construite à 1 m (4 fois moins de
 * triangles que la grille de 0,5 m ; l'ombre, adoucie, reste la même) et sans normales.
 */
export function canopee(G, zRef) {
  const { n, c, x0, veg } = G, m = Math.ceil(n / 2), val = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    let s = 0, q = 0;
    for (let b = 2 * j; b < Math.min(n, 2 * j + 2); b++) for (let a = 2 * i; a < Math.min(n, 2 * i + 2); a++) {
      const v = veg[b * n + a];
      if (!isNaN(v)) { s += v; q++; }
    }
    val[j * m + i] = q ? s / q : NaN;
  }
  return jetable(nappe({ n: m, c: 2 * c, x0 }, val, zRef, null, null, false));
}

/**
 * Bâtiments : toits et murs plans, du toit jusqu'au sol. `pans` = faux (par défaut) : toits du relevé (grille de
 * hauteurs) ; vrai : toits en pans plans dont les arêtes suivent les façades (pans.js), la grille ne restant que pour
 * les volumes qui ne s'y prêtent pas. `contours` permet de réutiliser les contours déjà calculés (changement de style).
 * Retourne aussi les contours du style choisi : hauteur des murs (`hauts`) et, en pans, `pans` (hauteurs du toit).
 */
export function batiments(G, zRef, pans = false, contours = contoursBatiments(G)) {
  const C0 = contours.base || contours, P = pans ? (C0.pansCalcules ||= pansToits(G, C0)) : null, { n } = G, m = n + 1, pos = new Tampon(), vols = new Tampon(Int32Array, 1024);
  const entre = (a, b, t) => t === 0 ? a : t === 1 ? b : a + (b - a) * t; // les bouts exacts : murs du relevé inchangés
  const boucles = C0.boucles.map(B => {
    const q = B.coins.length, hauts = P ? new Float32Array(q) : B.hauts;
    for (let k = 0; k < q; k++) {
      const a = B.coins[k], b = B.coins[(k + 1) % q];
      const xa = C0.px[a], ya = C0.py[a], xb = C0.px[b], yb = C0.py[b];
      let profil = [[0, B.hauts[k], 1, B.hauts[(k + 1) % q]]];
      if (P) {
        // cellule du volume à gauche de l'arête : le mur reprend le profil de son toit le long de ce côté (un faîtage
        // qui arrive au bord y ajoute un sommet) ; vers l'ouest ou le sud, le profil se lit à l'envers
        const d = b - a, i = a % m, j = (a - i) / m, p = (d === 1 || d === m ? j : j - 1) * n + (d === 1 || d === -m ? i : i - 1);
        if (P.pan[p] >= 0) {
          profil = P.profil(p, d === 1 ? 0 : d === m ? 1 : d === -1 ? 2 : 3);
          if (d < 0) profil = profil.map(([t1, z1, t2, z2]) => [1 - t2, z2, 1 - t1, z1]);
        }
        hauts[k] = profil.reduce((h, S) => S[0] === 0 ? Math.max(h, S[1]) : h, -Infinity);
        if (hauts[k] === -Infinity) hauts[k] = B.hauts[k];
      }
      if (Math.abs(xa - xb) + Math.abs(ya - yb) < 1e-4) continue;
      // murs prolongés de 2,5 m sous le sol mesuré aux angles : sur une pente, le terrain entre deux angles peut
      // descendre plus bas, ce qui laissait un jour sous le mur (bâtiment qui semble flotter)
      const sa = solEn(G, xa, ya) - 2.5, sb = solEn(G, xb, yb) - 2.5;
      for (const [t1, z1, t2, z2] of profil) {
        const x1 = entre(xa, xb, t1), y1 = entre(ya, yb, t1), x2 = entre(xa, xb, t2), y2 = entre(ya, yb, t2);
        const b1 = entre(sa, sb, t1) - zRef, b2 = entre(sa, sb, t2) - zRef;
        pos.ajouter(x1, z1 - zRef, -y1, x1, b1, -y1, x2, b2, -y2, x1, z1 - zRef, -y1, x2, b2, -y2, x2, z2 - zRef, -y2);
        vols.ajouter(B.seg);
      }
    }
    return P ? { ...B, hauts } : B;
  });
  const murs = new THREE.BufferGeometry();
  murs.setAttribute("position", new THREE.BufferAttribute(pos.fin(), 3));
  murs.computeVertexNormals();
  murs.userData.volumes = vols.fin();
  const C = P ? { ...C0, boucles, pans: P, base: C0 } : C0;
  return { toits: P ? toitsPans(G, zRef, C0, P) : nappe(G, G.bat, zRef, C0), murs, contours: C };
}

/** Toits en pans : triangles plans par cellule (coupés le long des arêtes de toit), grille pour les volumes restants. */
function toitsPans(G, zRef, C, P) {
  const { n } = G, m = n + 1, pos = [];
  // hauteurs d'un profil aux deux bouts de l'intervalle [ta, tb]
  const lire = (profil, ta, tb) => {
    const tm = (ta + tb) / 2;
    for (const [t1, z1, t2, z2] of profil) if (t1 <= tm && tm <= t2) return [z1 + (z2 - z1) * (ta - t1) / (t2 - t1), z1 + (z2 - z1) * (tb - t1) / (t2 - t1)];
    return null;
  };
  for (let p = 0; p < n * n; p++) {
    if (P.pan[p] < 0) continue;
    if (!P.mixte[p]) { // cellule d'un seul pan : deux triangles dans son plan
      const [a, b, d] = P.plans[P.pan[p]], k = Math.floor(p / n) * m + p % n;
      for (const t of [k, k + 1, k + m + 1, k, k + m + 1, k + m]) pos.push(C.px[t], a * C.px[t] + b * C.py[t] + d - zRef, -C.py[t]);
      continue;
    }
    for (const v of P.triangles(p)) pos.push(v[0], v[2] - zRef, -v[1]);
    // raccord avec les cellules voisines du même volume : là où les deux toits ne se rejoignent pas (ressaut entre
    // deux pans sans arête commune, petite lucarne), un pan vertical ferme le décrochement
    const i = p % n, j = (p - i) / n, k = j * m + i;
    for (const [q, cote, a, b] of [[i < n - 1 ? p + 1 : -1, 1, k + 1, k + m + 1], [j < n - 1 ? p + n : -1, 2, k + m, k + m + 1], [i > 0 ? p - 1 : -1, 3, k, k + m], [j > 0 ? p - n : -1, 0, k, k + 1]]) {
      if (q < 0 || P.pan[q] < 0 || C.seg[q] !== C.seg[p] || (P.mixte[q] && cote % 3 === 0)) continue; // deux cellules mixtes : une seule fois
      const U = P.profil(p, cote), V = P.profil(q, (cote + 2) % 4), bornes = [...new Set([...U, ...V].flatMap(S => [S[0], S[2]]))].sort((u, v) => u - v);
      const xa = C.px[a], ya = C.py[a], xb = C.px[b], yb = C.py[b];
      for (let t = 0; t < bornes.length - 1; t++) {
        const ta = bornes[t], tb = bornes[t + 1], u = lire(U, ta, tb), v = lire(V, ta, tb);
        if (tb - ta < 1e-9 || !u || !v || (Math.abs(u[0] - v[0]) < 0.005 && Math.abs(u[1] - v[1]) < 0.005)) continue;
        const x1 = xa + (xb - xa) * ta, w1 = -(ya + (yb - ya) * ta), x2 = xa + (xb - xa) * tb, w2 = -(ya + (yb - ya) * tb);
        pos.push(x1, u[0] - zRef, w1, x1, v[0] - zRef, w1, x2, v[1] - zRef, w2, x1, u[0] - zRef, w1, x2, v[1] - zRef, w2, x2, u[1] - zRef, w2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals(); // sans index : une normale par triangle, donc des pans francs
  const reste = nappe(G, G.bat, zRef, C, P.pan);
  if (!reste.index.count) return g;
  const r = reste.toNonIndexed(), fusion = new THREE.BufferGeometry();
  for (const nom of ["position", "normal"]) {
    const a = g.getAttribute(nom).array, b = r.getAttribute(nom).array, t = new Float32Array(a.length + b.length);
    t.set(a); t.set(b, a.length);
    fusion.setAttribute(nom, new THREE.BufferAttribute(t, 3));
  }
  g.dispose(); r.dispose(); reste.dispose();
  return fusion;
}

/* ------------------------------------------------------------------ points */
/**
 * Dégradé de couleur selon la hauteur (terrain, bâtiments, arbres) : uniformes partagés par tous les matériaux,
 * réglés par la scène (bas et haut du lieu, en m relatifs à zRef).
 */
export const DEGRADE = {
  degrade: { value: 0 }, zBas: { value: 0 }, zHaut: { value: 50 },
  rampe: { value: ["#3b4cc0", "#4fa3c7", "#79c49a", "#e8d36b", "#f09a52", "#d6504f"].map(c => new THREE.Color(c)) },
};
export const RAMPE_GLSL = /* glsl */`
uniform float degrade, zBas, zHaut;
uniform vec3 rampe[6];
vec3 rampeHaut(float y) {
  float t = clamp((y - zBas) / max(1.0, zHaut - zBas), 0.0, 1.0) * 5.0;
  int i = int(min(floor(t), 4.0));
  return mix(rampe[i], rampe[i + 1], smoothstep(0.0, 1.0, t - float(i)));
}`;

const SOMMETS = /* glsl */`
uniform float taille, echelle;
uniform vec3 c1, c2, c3;
attribute float aRel, aVar;
#ifdef PAR_CLASSE
attribute vec3 aCouleur;
#endif
varying vec3 vCouleur;
varying float vHaut;
varying float vZone;
uniform sampler2D tZone;
uniform vec3 grilleZone; // x0, côté (m), zone active (0/1)
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
  #ifdef PAR_CLASSE
    vCouleur = aCouleur;
  #else
    vec3 c = mix(c1, c2, smoothstep(0.1, 0.95, aRel));
    c = mix(c, c3, smoothstep(0.55, 1.0, aVar) * 0.75);
    vCouleur = c * (0.84 + 0.32 * fract(aVar * 7.31));
  #endif
  vec3 transformed = position;
  vec4 monde = modelMatrix * vec4(transformed, 1.0);
  vHaut = monde.y;
  vZone = grilleZone.z > 0.5 ? texture2D(tZone, (vec2(monde.x, -monde.z) - grilleZone.x) / grilleZone.y).r : 0.0;
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  // taille en mètres, avec un minimum en pixels pour que les arbres lointains ne disparaissent pas
  gl_PointSize = clamp(taille * echelle / max(0.1, -mvPosition.z), 2.0, 44.0);
  #include <clipping_planes_vertex>
  #include <fog_vertex>
}`;
const FRAGMENTS = /* glsl */`
uniform float lum, relief, ombre, gris, neutre;
uniform vec3 teinteSoleil; // couleur de la lumière du soleil, ramenée à 1 sur sa composante la plus forte
uniform vec3 teinteNeutre;
varying vec3 vCouleur;
varying float vHaut;
varying float vZone;
#include <common>
${RAMPE_GLSL}
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <fog_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard; // point rond
  // dans l'ombre portée (bâtiments, autres arbres, sa propre couronne) : même assombrissement que le sol
  float masque = getShadowMask(), soleil = mix(ombre, 1.0, masque);
  // la part éclairée prend la couleur du soleil (orangé quand il est bas), comme les surfaces
  // crépuscule et nuit : couleurs désaturées (vision de nuit), en plus de l'assombrissement
  vec3 base = vCouleur;
  // dégradé selon la hauteur : la teinte de la rampe, nuancée par la clarté propre à chaque point
  if (degrade > 0.5) base = rampeHaut(vHaut) * (0.8 + 0.9 * (dot(vCouleur, vec3(0.2126, 0.7152, 0.0722)) - 0.25));
  // carte des heures de soleil affichée : arbres de la zone calculée en gris (le reste garde sa couleur)
  if (neutre > 0.5 && vZone > 0.3) base = teinteNeutre * (0.85 + 0.6 * (dot(vCouleur, vec3(0.2126, 0.7152, 0.0722)) - 0.25));
  vec3 c = mix(base, vec3(dot(base, vec3(0.2126, 0.7152, 0.0722))), gris);
  gl_FragColor = vec4(c * mix(vec3(1.0), teinteSoleil, masque) * (1.0 - relief * (0.3 * r2 + 0.12 * p.y)) * lum * soleil, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Matériau des points : ronds, taille en mètres, teinte variée (c1 bas, c2 haut, c3 accent) ou couleur par classe. */
export function materiauPoints(taille, parClasse = false) {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, THREE.UniformsLib.lights, {
      taille: { value: taille }, echelle: { value: 800 }, lum: { value: 1 }, relief: { value: 1 }, ombre: { value: 0.5 }, gris: { value: 0 },
      neutre: { value: 0 }, teinteSoleil: { value: new THREE.Color(1, 1, 1) }, teinteNeutre: { value: new THREE.Color("#b9b6b0") },
      tZone: { value: null }, grilleZone: { value: new THREE.Vector3(0, 1, 0) },
      c1: { value: new THREE.Color("#2f5d2a") }, c2: { value: new THREE.Color("#7fae4b") }, c3: { value: new THREE.Color("#b9c45a") },
    }]),
    defines: parClasse ? { PAR_CLASSE: 1 } : {},
    vertexShader: SOMMETS, fragmentShader: FRAGMENTS, fog: true, clipping: true, lights: true,
  });
  Object.assign(mat.uniforms, DEGRADE); // partagés (merge les aurait copiés)
  return mat;
}

// bruit de valeur lisse (0..1) : donne une teinte propre à chaque arbre
const alea = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function bruit(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  return (alea(i, j) * (1 - a) + alea(i + 1, j) * a) * (1 - b) + (alea(i, j + 1) * (1 - a) + alea(i + 1, j + 1) * a) * b;
}

const CLASSES = { 2: "#c9b999", 3: "#5a8c3a", 4: "#5a8c3a", 5: "#5a8c3a", 6: "#d9725a", 9: "#4d8cd9", 17: "#9a9a9a", 26: "#8d6fc2" };
const vegetation = cl => cl === 3 || cl === 4 || cl === 5;

/**
 * Nuage de points. `mode` : "arbres" (végétation, teinte variée) ou "tous" (nuage brut, couleur par classe).
 * `part` = fraction gardée. En mode "tous", la végétation est rangée à la fin (`userData.autres` = nombre de points
 * des autres classes) : on peut ne pas la dessiner (drawRange) quand les arbres sont déjà affichés.
 */
export function nuagePoints(nuage, G, zRef, mode, part, taille) {
  const { n, c, R } = G, { X, Y, Z, C } = nuage, pas = Math.max(1, Math.round(1 / part)), arbres = mode === "arbres";
  const dedans = k => { const i = Math.floor((X[k] + R) / c), j = Math.floor((Y[k] + R) / c); return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i; };
  // première passe : compter (tableaux typés à la bonne taille)
  let nv = 0, na = 0;
  for (let k = 0; k < nuage.n; k += arbres ? 1 : pas) {
    if (arbres && (!vegetation(C[k]) || k % pas)) continue;
    if (dedans(k) < 0) continue;
    if (vegetation(C[k])) nv++; else na++;
  }
  const nb = nv + na;
  if (!nb) return null;
  const pos = new Float32Array(3 * nb), g = new THREE.BufferGeometry();
  if (arbres) {
    const rel = new Float32Array(nb), va = new Float32Array(nb);
    for (let k = 0, q = 0; k < nuage.n; k++) {
      if (!vegetation(C[k]) || k % pas) continue;
      const p = dedans(k);
      if (p < 0) continue;
      const x = X[k], y = Y[k], z = Z[k], h = G.veg[p] - G.sol[p];
      // hauteur dans la couronne : 0 au pied, 1 au sommet
      rel[q] = h > 1 ? Math.min(1, Math.max(0, (z - G.sol[p]) / h)) : 0.5;
      va[q] = Math.min(0.999, 0.75 * bruit(x / 7, y / 7) + 0.25 * alea(k, 3));
      pos[3 * q] = x; pos[3 * q + 1] = z - zRef; pos[3 * q + 2] = -y; q++;
    }
    g.setAttribute("aRel", new THREE.BufferAttribute(rel, 1));
    g.setAttribute("aVar", new THREE.BufferAttribute(va, 1));
  } else {
    // couleur par classe, sur un octet par composante
    const col = new Uint8Array(3 * nb), palette = new Uint8Array(3 * 256), teinte = new THREE.Color();
    for (let cl = 0; cl < 256; cl++) { teinte.set(CLASSES[cl] || "#8d8f99"); palette.set([teinte.r * 255, teinte.g * 255, teinte.b * 255].map(Math.round), 3 * cl); }
    for (let k = 0, qa = 0, qv = na; k < nuage.n; k += pas) {
      if (dedans(k) < 0) continue;
      const cl = C[k], q = vegetation(cl) ? qv++ : qa++;
      pos[3 * q] = X[k]; pos[3 * q + 1] = Z[k] - zRef; pos[3 * q + 2] = -Y[k];
      col[3 * q] = palette[3 * cl]; col[3 * q + 1] = palette[3 * cl + 1]; col[3 * q + 2] = palette[3 * cl + 2];
    }
    g.setAttribute("aCouleur", new THREE.BufferAttribute(col, 3, true));
    g.userData.autres = na;
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(jetable(g), materiauPoints(taille, !arbres));
  pts.receiveShadow = true;
  const v = new THREE.Vector2();
  pts.onBeforeRender = (r, s, cam) => { pts.material.uniforms.echelle.value = r.getDrawingBufferSize(v).y / (2 * Math.tan(cam.fov * Math.PI / 360)); };
  return pts;
}

/** Limite de la parcelle posée sur le terrain. */
export function contourParcelle(parcelle, G, zRef, materiau) {
  const grp = new THREE.Group();
  for (const anneau of parcelle.anneauxRel) {
    const pts = [];
    for (let k = 0; k < anneau.length - 1; k++) {
      const [x1, y1] = anneau[k], [x2, y2] = anneau[k + 1], L = Math.hypot(x2 - x1, y2 - y1), m = Math.max(1, Math.ceil(L));
      for (let t = 0; t < m; t++) {
        const x = x1 + (x2 - x1) * t / m, y = y1 + (y2 - y1) * t / m;
        pts.push(new THREE.Vector3(x, solEn(G, x, y) - zRef + 0.4, -y));
      }
    }
    if (pts.length < 2) continue;
    pts.push(pts[0].clone());
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0), pts.length * 2, 0.12, 6), materiau));
  }
  return grp;
}

/* ------------------------------------------------------------------ couronnes d'arbres */
/** Flou gaussien séparable (rayon en cellules) d'une grille n × n. */
function flou(a, n, r) {
  const k = [], s = r / 2;
  for (let d = -r; d <= r; d++) k.push(Math.exp(-d * d / (2 * s * s)));
  const t = new Float32Array(n * n), b = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let v = 0, w = 0;
    for (let d = -r; d <= r; d++) { const x = i + d; if (x >= 0 && x < n) { v += a[j * n + x] * k[d + r]; w += k[d + r]; } }
    t[j * n + i] = v / w;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let v = 0, w = 0;
    for (let d = -r; d <= r; d++) { const y = j + d; if (y >= 0 && y < n) { v += t[y * n + i] * k[d + r]; w += k[d + r]; } }
    b[j * n + i] = v / w;
  }
  return b;
}

/**
 * Couronnes d'arbres lissées : un volume fermé et arrondi par massif (dessus bombé, dessous plus plat), au lieu de
 * milliers de points. Teinte variée par vertex (couleurs du thème : c1 ombre, c2 lumière, c3 accent).
 */
export function couronnes(G, zRef, couleurs) {
  const { n, c, x0, sol, veg } = G, pas = 2, m = Math.floor(n / pas);
  // grille réduite à 1 m : présence de végétation et hauteur de couronne
  const pres = new Float32Array(m * m), haut = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    let q = 0, h = 0;
    for (let b = 0; b < pas; b++) for (let a = 0; a < pas; a++) {
      const p = (j * pas + b) * n + i * pas + a;
      if (!isNaN(veg[p])) { q++; h = Math.max(h, veg[p] - sol[p]); }
    }
    pres[j * m + i] = q / (pas * pas); haut[j * m + i] = h;
  }
  // masque lissé (bouche les trous entre points), puis distance au bord en mètres (chanfrein 3-4)
  const P = flou(pres, m, 2), Hp = flou(haut.map((h, k) => h * pres[k]), m, 2), seuil = 0.3;
  const dist = new Float32Array(m * m);
  for (let k = 0; k < m * m; k++) dist[k] = P[k] >= seuil ? 1e9 : 0;
  const passe = (j0, j1, dj, i0, i1, di) => {
    for (let j = j0; j !== j1; j += dj) for (let i = i0; i !== i1; i += di) {
      const k = j * m + i;
      if (!dist[k]) continue;
      let d = dist[k];
      for (const [a, b, w] of [[-di, 0, 1], [0, -dj, 1], [-di, -dj, 1.4142], [di, -dj, 1.4142]]) {
        const x = i + a, y = j + b;
        d = x < 0 || y < 0 || x >= m || y >= m ? Math.min(d, w) : Math.min(d, dist[y * m + x] + w);
      }
      dist[k] = d;
    }
  };
  passe(0, m, 1, 0, m, 1); passe(m - 1, -1, -1, m - 1, -1, -1);
  // deux nappes (dessus bombé, dessous plus plat) : les sommets du dessous suivent ceux du dessus
  const idx = new Int32Array(m * m).fill(-1);
  let nv = 0;
  for (let k = 0; k < m * m; k++) if (dist[k]) idx[k] = nv++;
  if (!nv) return null;
  const pos = new Float32Array(6 * nv), col = new Float32Array(6 * nv), tri = new Tampon(Uint32Array);
  const C = couleurs.map(x => new THREE.Color(x)), coul = new THREE.Color();
  const solM = (i, j) => sol[Math.min(n - 1, j * pas + 1) * n + Math.min(n - 1, i * pas + 1)];
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = j * m + i, a = 3 * idx[k], b = a + 3 * nv;
    if (!dist[k]) continue;
    // dôme : profil en quart de cercle, dont le rayon suit la hauteur de la couronne
    const H = Hp[k] / Math.max(1e-3, P[k]), z0 = solM(i, j) - zRef;
    const rayon = Math.max(1.5, H * 0.45), d = Math.max(0, dist[k] * pas * c - 0.5);
    const e = Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, d / rayon)) ** 2));
    const base = z0 + H * 0.45, sommet = z0 + H;
    const x = x0 + (i + 0.5) * pas * c, y = x0 + (j + 0.5) * pas * c;
    pos[a] = pos[b] = x; pos[a + 2] = pos[b + 2] = -y;
    pos[a + 1] = base + (sommet - base) * e;
    pos[b + 1] = base - (sommet - base) * 0.12 * e;
    const v = 0.7 * bruit(x / 6, y / 6) + 0.3 * alea(i, j);
    coul.copy(C[0]).lerp(C[1], 0.3 + 0.55 * e).lerp(C[2], Math.max(0, v - 0.55) * 1.2).multiplyScalar(0.9 + 0.2 * v);
    col[a] = coul.r; col[a + 1] = coul.g; col[a + 2] = coul.b;
    col[b] = coul.r * 0.7; col[b + 1] = coul.g * 0.7; col[b + 2] = coul.b * 0.7;
  }
  for (const [o, inverse] of [[0, false], [nv, true]]) {
    const ajoute = (t0, t1, t2) => { if (t0 >= 0 && t1 >= 0 && t2 >= 0) tri.ajouter(t0 + o, (inverse ? t2 : t1) + o, (inverse ? t1 : t2) + o); };
    for (let j = 0; j < m - 1; j++) for (let i = 0; i < m - 1; i++) {
      const a = idx[j * m + i], b = idx[j * m + i + 1], d = idx[(j + 1) * m + i + 1], e = idx[(j + 1) * m + i];
      if (a >= 0 && d >= 0) { ajoute(a, b, d); ajoute(a, d, e); } else { ajoute(a, b, e); ajoute(b, d, e); }
    }
  }
  if (!tri.n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(tri.fin(), 1));
  g.computeVertexNormals();
  return g;
}

/**
 * Points d'arbres simulés depuis la grille de végétation (repli sans relevé classé) : 3 points par cellule de 0,5 m,
 * répartis dans la moitié haute de la couronne, au format d'un nuage (classe 3).
 */
export function pointsVegetation(G) {
  const { n, c, x0, sol, veg } = G;
  let nb = 0;
  for (let p = 0; p < n * n; p++) if (veg[p] - sol[p] > 1) nb += 3;
  const X = new Float32Array(nb), Y = new Float32Array(nb), Z = new Float32Array(nb);
  let q = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = j * n + i, h = veg[p] - sol[p];
    if (!(h > 1)) continue;
    for (let k = 0; k < 3; k++) {
      const a = alea(p, k), b = alea(k, p), t = alea(p + 7, k + 3);
      X[q] = x0 + (i + a) * c; Y[q] = x0 + (j + b) * c;
      Z[q++] = veg[p] - h * 0.45 * t * t; // plus dense près du sommet
    }
  }
  return { X, Y, Z, C: new Uint8Array(nb).fill(3), n: nb };
}

/**
 * Hauteur (absolue) des maillages qui traversent les quatre bords du modèle, par cellule de bord : pour chaque
 * triangle qui coupe un plan de bord, on suit le segment d'intersection. Sert à faire monter la face du socle
 * jusqu'au toit des bâtiments de comparaison coupés au bord (swisstopo, roofer).
 */
export function hauteursBords(G, zRef, objets) {
  // plans de mesure 5 cm en retrait du bord : les maillages y sont coupés à 3 cm (decouperBord)
  const { n, c, x0 } = G, R = n * c / 2 - 0.05, bords = [0, 1, 2, 3].map(() => new Float32Array(n).fill(-Infinity));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), P = [a, b, d];
  // côtés : 0 sud (y = -R), 1 est (x = R), 2 nord (y = R), 3 ouest (x = -R) ; scène : x = est, z = -nord
  const plans = [[p => -p.z + R, p => p.x], [p => p.x - R, p => -p.z], [p => -p.z - R, p => p.x], [p => p.x + R, p => -p.z]];
  const noter = (cote, u, y) => {
    const k = Math.floor((u - x0) / c);
    if (k >= 0 && k < n && y + zRef > bords[cote][k]) bords[cote][k] = y + zRef;
  };
  for (const o of objets) o?.traverse(m => {
    if (!m.isMesh || !m.visible) return;
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position, idx = m.geometry.index, nt = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < nt; t++) {
      for (let s = 0; s < 3; s++) P[s].fromBufferAttribute(pos, idx ? idx.getX(3 * t + s) : 3 * t + s).applyMatrix4(m.matrixWorld);
      for (let cote = 0; cote < 4; cote++) {
        const [dist, long] = plans[cote], dd = P.map(dist);
        if ((dd[0] > 0 && dd[1] > 0 && dd[2] > 0) || (dd[0] < 0 && dd[1] < 0 && dd[2] < 0)) continue;
        // extrémités du segment d'intersection avec le plan du bord
        const pts = [];
        for (let s = 0; s < 3; s++) {
          const s2 = (s + 1) % 3;
          if ((dd[s] <= 0) !== (dd[s2] <= 0)) { const f = dd[s] / (dd[s] - dd[s2]); pts.push([long(P[s]) + (long(P[s2]) - long(P[s])) * f, P[s].y + (P[s2].y - P[s].y) * f]); }
        }
        if (pts.length < 2) continue;
        const [[u1, y1], [u2, y2]] = pts, nb = Math.max(1, Math.ceil(Math.abs(u2 - u1) / (c / 2)));
        for (let q = 0; q <= nb; q++) noter(cote, u1 + (u2 - u1) * q / nb, y1 + (y2 - y1) * q / nb);
      }
    }
  });
  return bords;
}

/**
 * Grille des hauteurs (absolues) de maillages vus de dessus, alignée sur G : pour chaque cellule de 0,5 m, le plus
 * haut des triangles qui couvrent son centre (NaN ailleurs). Sert à la coupe quand les bâtiments affichés sont ceux
 * de swisstopo ou de roofer.
 */
export function hauteursDessus(G, zRef, objets) {
  const { n, c, x0 } = G, h = new Float32Array(n * n).fill(NaN), P = new Float32Array(9), v = new THREE.Vector3();
  for (const o of objets) o?.traverse(m => {
    if (!m.isMesh || !m.visible) return;
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position, idx = m.geometry.index, nt = (idx ? idx.count : pos.count) / 3;
    for (let t = 0; t < nt; t++) {
      for (let s = 0; s < 3; s++) { v.fromBufferAttribute(pos, idx ? idx.getX(3 * t + s) : 3 * t + s).applyMatrix4(m.matrixWorld); P[3 * s] = (v.x - x0) / c; P[3 * s + 1] = (-v.z - x0) / c; P[3 * s + 2] = v.y + zRef; }
      // en cellules : (x1, y1), (x2, y2), (x3, y3) ; les faces verticales (aire nulle vue de dessus) sont ignorées
      const x1 = P[0], y1 = P[1], x2 = P[3], y2 = P[4], x3 = P[6], y3 = P[7], aire = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
      if (Math.abs(aire) < 1e-6) continue;
      const i0 = Math.max(0, Math.floor(Math.min(x1, x2, x3) - 0.5)), i1 = Math.min(n - 1, Math.ceil(Math.max(x1, x2, x3) - 0.5));
      const j0 = Math.max(0, Math.floor(Math.min(y1, y2, y3) - 0.5)), j1 = Math.min(n - 1, Math.ceil(Math.max(y1, y2, y3) - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i + 0.5, y = j + 0.5;
        const a = ((x2 - x) * (y3 - y) - (x3 - x) * (y2 - y)) / aire, b = ((x3 - x) * (y1 - y) - (x1 - x) * (y3 - y)) / aire, d = 1 - a - b;
        if (a < -1e-4 || b < -1e-4 || d < -1e-4) continue;
        const z = a * P[2] + b * P[5] + d * P[8], p = j * n + i;
        if (!(h[p] >= z)) h[p] = z;
      }
    }
  });
  return h;
}

/** Limites des parcelles voisines (traits fins posés sur le terrain) et leurs numéros (étiquettes au centre). */
export function limitesVoisines(voisines, G, zRef, couleur) {
  const grp = new THREE.Group(), pos = new Tampon(), R = G.R;
  const dedans = (x, y) => Math.abs(x) < R - 0.5 && Math.abs(y) < R - 0.5;
  for (const v of voisines) {
    for (const a of v.anneauxRel) for (let k = 0; k < a.length - 1; k++) {
      const [x1, y1] = a[k], [x2, y2] = a[k + 1], L = Math.hypot(x2 - x1, y2 - y1), m = Math.max(1, Math.ceil(L));
      for (let t = 0; t < m; t++) {
        const xa = x1 + (x2 - x1) * t / m, ya = y1 + (y2 - y1) * t / m, xb = x1 + (x2 - x1) * (t + 1) / m, yb = y1 + (y2 - y1) * (t + 1) / m;
        if (!dedans(xa, ya) || !dedans(xb, yb)) continue;
        pos.ajouter(xa, solEn(G, xa, ya) - zRef + 0.15, -ya, xb, solEn(G, xb, yb) - zRef + 0.15, -yb);
      }
    }
    // numéro au centre de la boîte de la parcelle, s'il est dans la maquette
    const pts = v.anneauxRel[0], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (dedans(cx, cy) && v.numero) grp.add(etiquetteNumero(v.numero, couleur, cx, solEn(G, cx, cy) - zRef + 1.2, -cy));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos.fin(), 3));
  grp.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: 0.75 })));
  return grp;
}

function etiquetteNumero(texte, couleur, x, y, z) {
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d");
  cv.width = 128; cv.height = 48;
  ctx.font = "600 30px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.strokeText(texte, 64, 25);
  ctx.fillStyle = couleur; ctx.fillText(texte, 64, 25);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.position.set(x, y, z); sp.scale.set(6, 2.25, 1);
  return sp;
}

/**
 * Plans d'eau (lacs, étangs, rivières) : une surface parfaitement plane au niveau de chaque plan d'eau, faite de
 * bandes (cellules consécutives d'une même ligne au même niveau) pour rester légère.
 */
export function plansEau(G, zRef) {
  const { n, c, x0, eau } = G;
  if (!eau) return null;
  const pos = [], idx = [];
  for (let j = 0; j < n; j++) {
    let i = 0;
    while (i < n) {
      const h = eau[j * n + i];
      if (isNaN(h)) { i++; continue; }
      let k = i + 1;
      while (k < n && eau[j * n + k] === h) k++;
      const xa = x0 + i * c, xb = x0 + k * c, ya = x0 + j * c, yb = ya + c, y = h - zRef, b = pos.length / 3;
      pos.push(xa, y, -ya, xb, y, -ya, xb, y, -yb, xa, y, -yb);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      i = k;
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx.length > 65535 * 3 ? new THREE.Uint32BufferAttribute(idx, 1) : idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Coupe réellement la géométrie d'un maillage au bord du modèle (|x|, |z| ≤ lim, en coordonnées de scène), au lieu
 * de la masquer par des plans de découpe : sinon le bout des murs coupés tombe dans le plan de la face du socle et
 * l'occlusion ambiante (qui voit la géométrie jusqu'au bord) y dessine des stries. La géométrie d'origine est gardée
 * pour redécouper si le maillage bouge (calage des tuiles swisstopo). Les maillages entièrement dedans sont laissés.
 */
export function decouperBord(m, lim) {
  m.updateWorldMatrix(true, false);
  const orig = m.userData.geomOrig || m.geometry, M = m.matrixWorld, e = M.elements;
  if (!orig.boundingBox) orig.computeBoundingBox();
  const bb = orig.boundingBox.clone().applyMatrix4(M);
  const dedans = bb.min.x >= -lim && bb.max.x <= lim && bb.min.z >= -lim && bb.max.z <= lim;
  if (dedans) {
    if (m.userData.geomOrig) { m.geometry.dispose(); m.geometry = orig; delete m.userData.geomOrig; delete m.userData.cleDecoupe; }
    return;
  }
  const cle = e.map(v => v.toFixed(4)).join(",");
  if (m.userData.cleDecoupe === cle) return;
  const pos = orig.attributes.position, nor = orig.attributes.normal, idx = orig.index;
  const nt = (idx ? idx.count : pos.count) / 3, outP = [], outN = [];
  // sommet : [lx, ly, lz, nx, ny, nz, wx, wz]
  const sommet = i => {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    return [x, y, z, nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 0, nor ? nor.getZ(i) : 0,
      e[0] * x + e[4] * y + e[8] * z + e[12], e[2] * x + e[6] * y + e[10] * z + e[14]];
  };
  const mel = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  // quatre demi-plans : distance positive = dedans
  const plans = [v => lim - v[6], v => v[6] + lim, v => lim - v[7], v => v[7] + lim];
  for (let t = 0; t < nt; t++) {
    let poly = [0, 1, 2].map(s2 => sommet(idx ? idx.getX(3 * t + s2) : 3 * t + s2));
    for (const d of plans) {
      if (poly.length < 3) break;
      const dist = poly.map(d);
      if (dist.every(v => v >= 0)) continue;
      const nv = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length], da = dist[k], db = dist[(k + 1) % poly.length];
        if (da >= 0) nv.push(a);
        if ((da >= 0) !== (db >= 0)) nv.push(mel(a, b, da / (da - db)));
      }
      poly = nv;
    }
    for (let k = 1; k + 1 < poly.length; k++) for (const v of [poly[0], poly[k], poly[k + 1]]) {
      outP.push(v[0], v[1], v[2]);
      if (nor) outN.push(v[3], v[4], v[5]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(outP, 3));
  if (nor) g.setAttribute("normal", new THREE.Float32BufferAttribute(outN, 3));
  else g.computeVertexNormals();
  if (m.userData.geomOrig) m.geometry.dispose(); else m.userData.geomOrig = orig;
  m.geometry = g;
  m.userData.cleDecoupe = cle;
}
