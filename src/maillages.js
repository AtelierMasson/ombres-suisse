// Géométries de la scène : terrain et socle, bâtiments (toits + murs droits), canopée, nuages de points, limite de parcelle.
// Repère three.js : x = est, y = altitude (relative à zRef), z = sud (−nord).
import * as THREE from "three";
import { solEn } from "./grille.js";
import { contoursBatiments } from "./contours.js";

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
 */
export function nappe(G, val, zRef, C) {
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
    if (s < 0) continue;
    const A = sommet(j * m + i, s), B = sommet(j * m + i + 1, s), D = sommet((j + 1) * m + i + 1, s), E = sommet((j + 1) * m + i, s);
    idx.push(A, B, D, A, D, E);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Bâtiments : toits de la grille, bords redressés, et murs plans du toit jusqu'au sol. */
export function batiments(G, zRef) {
  const C = contoursBatiments(G), pos = [];
  for (const B of C.boucles) {
    const q = B.coins.length;
    for (let k = 0; k < q; k++) {
      const a = B.coins[k], b = B.coins[(k + 1) % q];
      const xa = C.px[a], ya = C.py[a], xb = C.px[b], yb = C.py[b];
      if (Math.abs(xa - xb) + Math.abs(ya - yb) < 1e-4) continue;
      const Ta = [xa, B.hauts[k] - zRef, -ya], Tb = [xb, B.hauts[(k + 1) % q] - zRef, -yb];
      const Ba = [xa, solEn(G, xa, ya) - 0.3 - zRef, -ya], Bb = [xb, solEn(G, xb, yb) - 0.3 - zRef, -yb];
      pos.push(...Ta, ...Ba, ...Bb, ...Ta, ...Bb, ...Tb);
    }
  }
  const murs = new THREE.BufferGeometry();
  murs.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  murs.computeVertexNormals();
  return { toits: nappe(G, G.bat, zRef, C), murs, contours: C };
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
#include <clipping_planes_pars_vertex>
void main() {
  #ifdef PAR_CLASSE
    vCouleur = aCouleur;
  #else
    vec3 c = mix(c1, c2, smoothstep(0.1, 0.95, aRel));
    c = mix(c, c3, smoothstep(0.55, 1.0, aVar) * 0.75);
    vCouleur = c * (0.84 + 0.32 * fract(aVar * 7.31));
  #endif
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // taille en mètres, avec un minimum en pixels pour que les arbres lointains ne disparaissent pas
  gl_PointSize = clamp(taille * echelle / max(0.1, -mvPosition.z), 2.0, 44.0);
  #include <clipping_planes_vertex>
  #include <fog_vertex>
}`;
const FRAGMENTS = /* glsl */`
uniform float lum;
varying vec3 vCouleur;
#include <common>
#include <fog_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard; // point rond
  gl_FragColor = vec4(vCouleur * (1.0 - 0.3 * r2 - 0.12 * p.y) * lum, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Matériau des points : ronds, taille en mètres, teinte variée (c1 bas, c2 haut, c3 accent) ou couleur par classe. */
export function materiauPoints(taille, parClasse = false) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      taille: { value: taille }, echelle: { value: 800 }, lum: { value: 1 },
      c1: { value: new THREE.Color("#2f5d2a") }, c2: { value: new THREE.Color("#7fae4b") }, c3: { value: new THREE.Color("#b9c45a") },
    }]),
    defines: parClasse ? { PAR_CLASSE: 1 } : {},
    vertexShader: SOMMETS, fragmentShader: FRAGMENTS, fog: true, clipping: true,
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
