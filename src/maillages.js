// Géométries de la scène : terrain et socle, bâtiments (toits + murs droits), canopée, nuages de points, limite de parcelle.
// Repère three.js : x = est, y = altitude (relative à zRef), z = sud (−nord).
import * as THREE from "three";
import { solEn } from "./grille.js";
import { contoursBatiments } from "./contours.js";
import { pansToits } from "./pans.js";

/** Terrain (un sommet tous les mètres) avec coordonnées de texture pour le fond de plan. */
export function terrain(G, zRef) {
  const pas = 2, m = Math.floor(G.n / pas) + 1, pos = new Float32Array(m * m * 3), uv = new Float32Array(m * m * 2);
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
    const x = G.x0 + a * pas * G.c, y = G.x0 + b * pas * G.c, k = b * m + a;
    pos.set([x, solEn(G, x, y) - zRef, -y], 3 * k);
    uv.set([(x - G.x0) / (2 * G.R), (y - G.x0) / (2 * G.R)], 2 * k);
  }
  const idx = [];
  for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
    const p = b * m + a;
    idx.push(p, p + 1, p + m + 1, p, p + m + 1, p + m);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
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

/** Socle : bords verticaux du terrain jusqu'à une base plane, comme une maquette posée. */
export function socle(G, zRef, zBas) {
  const pas = 2, m = Math.floor(G.n / pas) + 1, pos = [];
  const bord = [];
  for (let a = 0; a < m; a++) bord.push([a, 0]);
  for (let b = 1; b < m; b++) bord.push([m - 1, b]);
  for (let a = m - 2; a >= 0; a--) bord.push([a, m - 1]);
  for (let b = m - 2; b >= 0; b--) bord.push([0, b]);
  const P = bord.map(([a, b]) => { const x = G.x0 + a * pas * G.c, y = G.x0 + b * pas * G.c; return [x, solEn(G, x, y) - zRef, -y]; });
  for (let k = 0; k < P.length - 1; k++) {
    const H = P[k], K = P[k + 1], Hb = [H[0], zBas, H[2]], Kb = [K[0], zBas, K[2]];
    pos.push(...H, ...Hb, ...Kb, ...H, ...Kb, ...K);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Nappe d'une grille de hauteurs (NaN = vide), lissée aux coins. Avec `C` (contours des bâtiments), chaque volume
 * a sa propre nappe (pas de pente entre deux toits de hauteurs différentes) et les coins de bord sont redressés.
 * `sauf` (numéro de pan par cellule) écarte les cellules déjà couvertes par un pan de toit.
 */
export function nappe(G, val, zRef, C, sauf) {
  const { n, c, x0 } = G, m = n + 1;
  const rang = new Int32Array(m * m).fill(-1), vol = new Int32Array(m * m).fill(-1), pos = [], idx = [];
  const coin = k => { // sans contours : moyenne des cellules renseignées autour du coin
    const i = k % m, j = (k - i) / m;
    let s = 0, q = 0;
    for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const v = val[b * n + a];
      if (!isNaN(v)) { s += v; q++; }
    }
    return s / q;
  };
  const sommet = (k, s) => {
    if (rang[k] < 0 || vol[k] !== s) {
      rang[k] = pos.length / 3; vol[k] = s;
      if (C) pos.push(C.px[k], C.hauteurCoin(k, s) - zRef, -C.py[k]);
      else pos.push(x0 + (k % m) * c, coin(k) - zRef, -(x0 + Math.floor(k / m) * c));
    }
    return rang[k];
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const s = C ? C.seg[j * n + i] : isNaN(val[j * n + i]) ? -1 : 0;
    if (s < 0 || (sauf && sauf[j * n + i] >= 0)) continue;
    const A = sommet(j * m + i, s), B = sommet(j * m + i + 1, s), D = sommet((j + 1) * m + i + 1, s), E = sommet((j + 1) * m + i, s);
    idx.push(A, B, D, A, D, E);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Bâtiments : toits et murs plans, du toit jusqu'au sol. `pans` = faux (par défaut) : toits du relevé (grille de
 * hauteurs) ; vrai : toits en pans plans dont les arêtes suivent les façades (pans.js), la grille ne restant que pour
 * les volumes qui ne s'y prêtent pas. `contours` permet de réutiliser les contours déjà calculés (changement de style).
 * Retourne aussi les contours du style choisi : hauteur des murs (`hauts`) et, en pans, `pans` (hauteurs du toit).
 */
export function batiments(G, zRef, pans = false, contours = contoursBatiments(G)) {
  const C0 = contours.base || contours, P = pans ? (C0.pansCalcules ||= pansToits(G, C0)) : null, { n } = G, m = n + 1, pos = [];
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
        pos.push(x1, z1 - zRef, -y1, x1, b1, -y1, x2, b2, -y2, x1, z1 - zRef, -y1, x2, b2, -y2, x2, z2 - zRef, -y2);
      }
    }
    return P ? { ...B, hauts } : B;
  });
  const murs = new THREE.BufferGeometry();
  murs.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  murs.computeVertexNormals();
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
const SOMMETS = /* glsl */`
uniform float taille, echelle;
uniform vec3 c1, c2, c3;
attribute float aRel, aVar;
#ifdef PAR_CLASSE
attribute vec3 aCouleur;
#endif
varying vec3 vCouleur;
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
uniform float lum, relief, ombre, gris;
varying vec3 vCouleur;
#include <common>
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
  float soleil = mix(ombre, 1.0, getShadowMask());
  // crépuscule et nuit : couleurs désaturées (vision de nuit), en plus de l'assombrissement
  vec3 c = mix(vCouleur, vec3(dot(vCouleur, vec3(0.2126, 0.7152, 0.0722))), gris);
  gl_FragColor = vec4(c * (1.0 - relief * (0.3 * r2 + 0.12 * p.y)) * lum * soleil, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Matériau des points : ronds, taille en mètres, teinte variée (c1 bas, c2 haut, c3 accent) ou couleur par classe. */
export function materiauPoints(taille, parClasse = false) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, THREE.UniformsLib.lights, {
      taille: { value: taille }, echelle: { value: 800 }, lum: { value: 1 }, relief: { value: 1 }, ombre: { value: 0.5 }, gris: { value: 0 },
      c1: { value: new THREE.Color("#2f5d2a") }, c2: { value: new THREE.Color("#7fae4b") }, c3: { value: new THREE.Color("#b9c45a") },
    }]),
    defines: parClasse ? { PAR_CLASSE: 1 } : {},
    vertexShader: SOMMETS, fragmentShader: FRAGMENTS, fog: true, clipping: true, lights: true,
  });
}

// bruit de valeur lisse (0..1) : donne une teinte propre à chaque arbre
const alea = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function bruit(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  return (alea(i, j) * (1 - a) + alea(i + 1, j) * a) * (1 - b) + (alea(i, j + 1) * (1 - a) + alea(i + 1, j + 1) * a) * b;
}

const CLASSES = { 2: "#c9b999", 3: "#5a8c3a", 4: "#5a8c3a", 5: "#5a8c3a", 6: "#d9725a", 9: "#4d8cd9", 17: "#9a9a9a", 26: "#8d6fc2" };

/**
 * Nuage de points. `mode` : "arbres" (végétation, teinte variée), "facades" (points mesurés sur les murs)
 * ou "tous" (couleur par classe). `part` = fraction gardée.
 */
export function nuagePoints(nuage, G, zRef, mode, part, taille) {
  const { n, c, R } = G, pos = [], rel = [], va = [], col = [], pas = Math.max(1, Math.round(1 / part)), teinte = new THREE.Color();
  for (let k = 0; k < nuage.n; k++) {
    const cl = nuage.C[k], x = nuage.X[k], y = nuage.Y[k], z = nuage.Z[k];
    const i = Math.floor((x + R) / c), j = Math.floor((y + R) / c);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const p = j * n + i;
    if (mode === "arbres") {
      if ((cl !== 3 && cl !== 4 && cl !== 5) || k % pas) continue;
      // hauteur dans la couronne : 0 au pied, 1 au sommet
      const h = G.veg[p] - G.sol[p];
      rel.push(h > 1 ? Math.min(1, Math.max(0, (z - G.sol[p]) / h)) : 0.5);
      va.push(Math.min(0.999, 0.75 * bruit(x / 7, y / 7) + 0.25 * alea(k, 3)));
    } else if (mode === "facades") {
      // classe 26 (façades et murs des vols récents) ou point « bâtiment » nettement sous le toit de sa cellule
      if (!(cl === 26 || (cl === 6 && z < G.bat[p] - 1.2)) || z < G.sol[p] + 0.3) continue;
      rel.push(0.5); va.push(0.5 * alea(k, 5));
    } else {
      if (k % pas) continue;
      rel.push(0); va.push(0);
      teinte.set(CLASSES[cl] || "#8d8f99");
      col.push(teinte.r, teinte.g, teinte.b);
    }
    pos.push(x, z - zRef, -y);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aRel", new THREE.Float32BufferAttribute(rel, 1));
  g.setAttribute("aVar", new THREE.Float32BufferAttribute(va, 1));
  if (mode === "tous") g.setAttribute("aCouleur", new THREE.Float32BufferAttribute(col, 3));
  const pts = new THREE.Points(g, materiauPoints(taille, mode === "tous"));
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
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0), pts.length * 2, 0.3, 6), materiau));
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
  const idx = new Int32Array(m * m).fill(-1), pos = [], col = [], tri = [];
  const C = couleurs.map(x => new THREE.Color(x)), coul = new THREE.Color();
  const solM = (i, j) => sol[Math.min(n - 1, j * pas + 1) * n + Math.min(n - 1, i * pas + 1)];
  const dessus = [], dessous = [];
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = j * m + i;
    if (!dist[k]) continue;
    // dôme : profil en quart de cercle, dont le rayon suit la hauteur de la couronne
    const H = Hp[k] / Math.max(1e-3, P[k]), z0 = solM(i, j) - zRef;
    const rayon = Math.max(1.5, H * 0.45), d = Math.max(0, dist[k] * pas * c - 0.5);
    const e = Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, d / rayon)) ** 2));
    const base = z0 + H * 0.45, sommet = z0 + H;
    const x = x0 + (i + 0.5) * pas * c, y = x0 + (j + 0.5) * pas * c;
    dessus[k] = [x, base + (sommet - base) * e, -y];
    dessous[k] = [x, base - (sommet - base) * 0.12 * e, -y];
    const v = 0.7 * bruit(x / 6, y / 6) + 0.3 * alea(i, j);
    coul.copy(C[0]).lerp(C[1], 0.3 + 0.55 * e).lerp(C[2], Math.max(0, v - 0.55) * 1.2).multiplyScalar(0.9 + 0.2 * v);
    dessus[k].c = [coul.r, coul.g, coul.b];
    dessous[k].c = [coul.r * 0.7, coul.g * 0.7, coul.b * 0.7];
  }
  for (const [nappeV, inverse] of [[dessus, false], [dessous, true]]) {
    idx.fill(-1);
    for (let k = 0; k < m * m; k++) if (nappeV[k]) { idx[k] = pos.length / 3; pos.push(...nappeV[k]); col.push(...nappeV[k].c); }
    for (let j = 0; j < m - 1; j++) for (let i = 0; i < m - 1; i++) {
      const a = idx[j * m + i], b = idx[j * m + i + 1], d = idx[(j + 1) * m + i + 1], e = idx[(j + 1) * m + i];
      const t1 = [a, b, d], t2 = [a, d, e], t3 = [a, b, e], t4 = [b, d, e];
      const ajoute = t => { if (t.every(v => v >= 0)) tri.push(...(inverse ? [t[0], t[2], t[1]] : t)); };
      if (a >= 0 && d >= 0) { ajoute(t1); ajoute(t2); } else { ajoute(t3); ajoute(t4); }
    }
  }
  if (!tri.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(tri);
  g.computeVertexNormals();
  return g;
}
