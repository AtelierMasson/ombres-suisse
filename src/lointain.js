// Relief lointain visible : le paysage jusqu'à 50 km autour de la maquette (collines, montagnes, lacs), tiré des mêmes
// tuiles « Terrarium » que l'horizon (et, jusqu'à 2 km, du terrain swissALTI3D à 2 m). Il est dans la scène avec la
// maquette ; la caméra étend alors son plan lointain (voir Scene3D.rendre).
import * as THREE from "three";
import { tuile, versTuile } from "./horizon.js";
import { versWgs } from "./geo.js";
import { DEGRADE, RAMPE_GLSL } from "./maillages.js";

const RAYON_TERRE = 6371000, REFRACTION = 0.13;

/**
 * Maillage du relief entre le bord de la maquette (carré de demi-côté R) et `rayonMax`.
 * `hBord(x, y)` : altitude du terrain de la maquette au bord, pour raccorder sans marche.
 */
export async function reliefLointain(E0, N0, R, zRef, hBord, fin = null, rayonMax = 50000, rond = false, niveauLac = NaN) {
  // `niveauLac` : niveau connu du lac de la maquette ; les lacs du paysage voisins (à 3 m près) s'y calent
  // anneau intermédiaire : terrain swissALTI3D à 2 m (fin), fondu vers le relief libre sur ses 500 derniers mètres
  const rayonFin = fin ? fin.n * fin.c / 2 - 50 : 0;
  const altFin = (E, N) => {
    const x = (E - fin.e0) / fin.c - 0.5, y = (fin.n1 - N) / fin.c - 0.5, i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= fin.n - 1 || j >= fin.n - 1) return NaN;
    const u = x - i, v = y - j, p = j * fin.n + i, H = fin.h;
    return (H[p] * (1 - u) + H[p + 1] * u) * (1 - v) + (H[p + fin.n] * (1 - u) + H[p + fin.n + 1] * u) * v;
  };
  const nA = 2048;
  // anneaux : écart au bord de la maquette, de plus en plus espacés avec la distance
  const ecarts = [0];
  while (ecarts.at(-1) < rayonMax) ecarts.push(ecarts.at(-1) * 1.015 + 4);
  const nR = ecarts.length;
  // altitude en un point (E, N) : tuile la plus fine jusqu'à 6 km (mêmes niveaux que l'horizon, tuiles en cache)
  const tuiles = new Map();
  const cleEn = (E, N, z) => {
    const [lon, lat] = versWgs(E, N), [tx, ty] = versTuile(lon, lat, z);
    return [`${z}/${Math.floor(tx)}/${Math.floor(ty)}`, (tx - Math.floor(tx)) * 256, (ty - Math.floor(ty)) * 256];
  };
  const bil = (h, fx, fy) => {
    const x = Math.min(254.999, Math.max(0, fx - 0.5)), y = Math.min(254.999, Math.max(0, fy - 0.5));
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, p = j * 256 + i;
    return (h[p] * (1 - u) + h[p + 1] * u) * (1 - v) + (h[p + 256] * (1 - u) + h[p + 257] * u) * v;
  };
  const altLibre = (E, N, z) => {
    const [cle, fx, fy] = cleEn(E, N, z), h = tuiles.get(cle);
    return h ? bil(h, fx, fy) : NaN;
  };
  const altEn = (E, N, z) => {
    const d = Math.hypot(E - E0, N - N0);
    if (!fin || d > rayonFin) return altLibre(E, N, z);
    const f = altFin(E, N), w = Math.min(1, Math.max(0, (rayonFin - d) / 500)), t = w * w * (3 - 2 * w);
    if (isNaN(f)) return altLibre(E, N, z);
    return t >= 1 ? f : f * t + altLibre(E, N, z) * (1 - t);
  };
  const sommets = [];
  for (let a = 0; a < nA; a++) {
    const az = a / nA * 2 * Math.PI, sx = Math.sin(az), sy = Math.cos(az);
    const r0 = rond ? R : R / Math.max(Math.abs(sx), Math.abs(sy)); // bord du cercle, ou du carré dans cette direction
    for (let k = 0; k < nR; k++) {
      const d = r0 + ecarts[k];
      sommets.push({ e: sx * d, n: sy * d, d, s: ecarts[k], bx: sx * r0 * 0.995, by: sy * r0 * 0.995, z: d < 3000 ? 13 : d < 12000 ? 12 : 11, pas: d < rayonFin ? Math.max(3, d * 0.004) : Math.max(15, d * 0.003) });
    }
  }
  // tuiles nécessaires (sommets et voisins servant aux pentes)
  const besoin = new Set();
  for (const P of sommets) for (const [de, dn] of [[0, 0], [P.pas, 0], [-P.pas, 0], [0, P.pas], [0, -P.pas]])
    besoin.add(cleEn(E0 + P.e + de, N0 + P.n + dn, P.z)[0]);
  await Promise.all([...besoin].map(async cle => {
    const [z, x, y] = cle.split("/").map(Number);
    try { tuiles.set(cle, await tuile(z, x, y)); } catch { /* hors couverture */ }
  }));

  const pos = new Float32Array(nA * nR * 3), nor = new Float32Array(nA * nR * 3), eau = new Float32Array(nA * nR);
  for (let q = 0; q < sommets.length; q++) {
    if (q % 40000 === 0 && q) await new Promise(r => setTimeout(r)); // par morceaux : la page reste réactive
    const P = sommets[q], E = E0 + P.e, N = N0 + P.n, h = P.pas;
    let alt = altEn(E, N, P.z);
    // pente mesurée sur le terrain lui-même (et non sur les facettes du maillage polaire, qui dessinaient des rayons)
    const hE = altEn(E + h, N, P.z), hO = altEn(E - h, N, P.z), hN = altEn(E, N + h, P.z), hS = altEn(E, N - h, P.z);
    let nx = 0, nz = 0;
    if (![hE, hO, hN, hS].some(isNaN)) { nx = -(hE - hO) / (2 * h); nz = (hN - hS) / (2 * h); }
    const [cle, fx, fy] = cleEn(E, N, P.z), T = tuiles.get(cle);
    // lac : plan d'eau voisin (pixels plats), puis rive suivie par l'altitude elle-même (et non par les pixels, en escalier)
    let lac = 0;
    if (T && !isNaN(alt)) {
      const i0 = Math.floor(fx - 0.5), j0 = Math.floor(fy - 0.5);
      let niveau = NaN;
      for (let j = Math.max(0, j0 - 1); j <= Math.min(255, j0 + 2) && isNaN(niveau); j++)
        for (let i = Math.max(0, i0 - 1); i <= Math.min(255, i0 + 2); i++) if (T.eau[j * 256 + i]) { niveau = T[j * 256 + i]; break; }
      if (!isNaN(niveau)) {
        const u = Math.min(1, Math.max(0, (niveau + 1.2 - alt) / 1.0)); lac = u * u * (3 - 2 * u);
        // même lac que celui de la maquette : surface au niveau connu (sinon une marche au bord de l'anneau)
        if (lac > 0.5 && Math.abs(niveau - niveauLac) < 3) alt = niveauLac;
      }
    }
    // raccord au bord de la maquette : sur 300 m avec le seul relief libre, sur 30 m avec le terrain à 2 m (même relevé)
    const b = hBord(P.bx, P.by);
    const m = Math.min(1, P.s / (fin ? 30 : 300)), t = m * m * (3 - 2 * m);
    if (isNaN(alt)) alt = b;
    alt = b * (1 - t) + alt * t;
    alt -= P.d * P.d / (2 * RAYON_TERRE) * (1 - REFRACTION); // courbure de la Terre
    pos.set([P.e, alt - zRef, -P.n], 3 * q);
    const l = Math.hypot(nx * t, 1, nz * t);
    nor.set([nx * t / l, 1 / l, nz * t / l], 3 * q);
    eau[q] = lac * t;
  }
  const idx = [];
  for (let a = 0; a < nA; a++) {
    const a2 = (a + 1) % nA;
    for (let k = 0; k < nR - 1; k++) {
      const p = a * nR + k, q = a2 * nR + k;
      idx.push(p, q, p + 1, q, q + 1, p + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("eau", new THREE.BufferAttribute(eau, 1));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  // altitude (repère de la scène) en un point relatif (x est, y nord), pour poser le plan cadastral en tuiles
  g.userData.altitude = (x, y) => {
    const d = Math.hypot(x, y), a = altEn(E0 + x, N0 + y, d < 3000 ? 13 : d < 12000 ? 12 : 11);
    return isNaN(a) ? NaN : a - d * d / (2 * RAYON_TERRE) * (1 - REFRACTION) - zRef;
  };
  return g;
}

// Matériau : celui du sol de la maquette (MeshStandardMaterial : mêmes lumières, ombres portées, brume, rendu), dont
// la couleur vient du plan cadastral drapé (deux finesses), des lacs et du même grain de papier.
const DECLARATIONS = /* glsl */`
uniform vec3 sol, lac;
uniform float planActif; // plan cadastral en tuiles, peint dans deux images centrées sur la vue (plan.js)
uniform sampler2D tPlanP, tPlanL; // proche (fine) et large
uniform vec3 cPlanP, cPlanL;      // centre (x, y nord) et demi-côté de chaque image (0 : vide)
varying vec3 vMonde;
varying float vEau;
float hachage(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bruit3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hachage(i), hachage(i + vec3(1, 0, 0)), f.x), mix(hachage(i + vec3(0, 1, 0)), hachage(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hachage(i + vec3(0, 0, 1)), hachage(i + vec3(1, 0, 1)), f.x), mix(hachage(i + vec3(0, 1, 1)), hachage(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
const COULEUR = /* glsl */`
  vec3 base = sol;
  float plan = 0.0; // part du plan cadastral (qui dessine déjà les lacs, à leur vraie rive)
  if (planActif > 0.5) {
    vec2 p = vec2(vMonde.x, -vMonde.z);
    for (int k = 0; k < 2; k++) {
      vec3 c = k == 0 ? cPlanL : cPlanP;
      if (c.z <= 0.0) continue;
      vec2 uv = (p - c.xy) / (2.0 * c.z) + 0.5;
      float bord = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
      if (bord >= 1.0) continue;
      vec4 t = k == 0 ? texture2D(tPlanL, uv) : texture2D(tPlanP, uv);
      float a = t.a * (1.0 - smoothstep(0.92, 1.0, bord));
      base = mix(base, t.rgb / max(t.a, 1e-3), a);
      plan = max(plan, a);
    }
  }
  // le lac l'emporte sur le plan cadastral peint (sinon il devient gris là où le plan le couvre)
  base = mix(base, lac, smoothstep(0.3, 0.9, vEau));
  // même grain que le sol de la maquette ; le grain fin s'efface quand il devient plus petit qu'un pixel (scintillement)
  if (plan > 0.01) {
    float g = 0.55 * bruit3(vMonde * 2.7) + 0.3 * bruit3(vMonde * 9.0) + 0.15 * bruit3(vMonde * 0.35);
    float pixel = hachage(floor(vMonde * 2.0 + 0.001) + 0.37);
    vec2 taille = fwidth(vMonde.xz);
    float fin = 1.0 - smoothstep(0.15, 0.6, max(taille.x, taille.y));
    base *= 1.0 + 0.07 * ((g - 0.5) * 1.4 * mix(0.5, 1.0, fin) + (pixel - 0.5) * 0.9 * fin);
  }
  diffuseColor.rgb *= base;`;
// dégradé selon la hauteur : même rampe et même grain que le sol de la maquette fine (scene.js)
const DEGRADE_GLSL = /* glsl */`
  if (degrade > 0.5) {
    float gD = 0.55 * bruit3(vMonde * 2.7) + 0.3 * bruit3(vMonde * 9.0) + 0.15 * bruit3(vMonde * 0.35);
    diffuseColor.rgb = rampeHaut(vMonde.y) * (1.0 + 0.07 * (gD - 0.5) * 1.4);
  }`;

export function materiauLointain(partages = null, { degrade = false } = {}) {
  // `degrade` : suit la case « Couleur selon la hauteur » comme la maquette fine (anneau du grand périmètre)
  // `partages` : uniformes d'un autre matériau du paysage (l'anneau de la maquette réutilise ceux du paysage)
  const uniforms = partages || {
    sol: { value: new THREE.Color() }, lac: { value: new THREE.Color() },
    tPlanP: { value: null }, tPlanL: { value: null }, cPlanP: { value: new THREE.Vector3() }, cPlanL: { value: new THREE.Vector3() }, planActif: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 1 });
  mat.uniforms = uniforms; // réglés par la scène (couleurs du thème, plans drapés)
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    if (degrade) Object.assign(sh.uniforms, DEGRADE);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float eau;\nvarying vec3 vMonde;\nvarying float vEau;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMonde = (modelMatrix * vec4(transformed, 1.0)).xyz; vEau = eau;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + DECLARATIONS + (degrade ? RAMPE_GLSL : ""))
      .replace("#include <map_fragment>", "#include <map_fragment>\n" + COULEUR + (degrade ? DEGRADE_GLSL : ""));
  };
  mat.customProgramCacheKey = () => degrade ? "paysage-degrade" : "paysage";
  return mat;
}
