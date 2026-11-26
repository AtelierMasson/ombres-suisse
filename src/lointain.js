// Relief lointain visible : le paysage jusqu'à 50 km autour de la maquette (collines, montagnes, lacs), tiré des mêmes
// tuiles « Terrarium » que l'horizon. Il est dessiné à part, comme un fond (voir Scene3D.rendre) : sa profondeur
// (des dizaines de km) ne se mêle pas à celle de la maquette, qui garde toute sa précision.
import * as THREE from "three";
import { tuile, versTuile } from "./horizon.js";
import { versWgs } from "./geo.js";

const RAYON_TERRE = 6371000, REFRACTION = 0.13;

/**
 * Maillage du relief entre le bord de la maquette (carré de demi-côté R) et `rayonMax`.
 * `hBord(x, y)` : altitude du terrain de la maquette au bord, pour raccorder sans marche.
 */
export async function reliefLointain(E0, N0, R, zRef, hBord, fin = null, rayonMax = 50000) {
  // anneau intermédiaire : terrain swissALTI3D à 2 m (fin), fondu vers le relief libre sur ses 500 derniers mètres
  const rayonFin = fin ? fin.n * fin.c / 2 - 50 : 0;
  const altFin = (E, N) => {
    const x = (E - fin.e0) / fin.c - 0.5, y = (fin.n1 - N) / fin.c - 0.5, i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= fin.n - 1 || j >= fin.n - 1) return NaN;
    const u = x - i, v = y - j, p = j * fin.n + i, H = fin.h;
    return (H[p] * (1 - u) + H[p + 1] * u) * (1 - v) + (H[p + fin.n] * (1 - u) + H[p + fin.n + 1] * u) * v;
  };
  const nA = 1440;
  // anneaux : écart au bord de la maquette, de plus en plus espacés avec la distance
  const ecarts = [0];
  while (ecarts.at(-1) < rayonMax) ecarts.push(ecarts.at(-1) * 1.025 + 6);
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
    const r0 = R / Math.max(Math.abs(sx), Math.abs(sy)); // bord du carré dans cette direction
    for (let k = 0; k < nR; k++) {
      const d = r0 + ecarts[k];
      sommets.push({ e: sx * d, n: sy * d, d, s: ecarts[k], bx: sx * r0 * 0.995, by: sy * r0 * 0.995, z: d < 10000 ? 12 : d < 25000 ? 11 : 10, pas: d < rayonFin ? Math.max(3, d * 0.004) : Math.max(20, d * 0.006) });
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
      if (!isNaN(niveau)) { const u = Math.min(1, Math.max(0, (niveau + 1.2 - alt) / 1.0)); lac = u * u * (3 - 2 * u); }
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
  return g;
}

const SOMMETS = /* glsl */`
attribute float eau;
varying vec3 vMonde, vN;
varying float vEau;
void main() {
  vec4 m = modelMatrix * vec4(position, 1.0);
  vMonde = m.xyz; vN = normalize(mat3(modelMatrix) * normal); vEau = eau;
  gl_Position = projectionMatrix * viewMatrix * m;
}`;
const FRAGMENTS = /* glsl */`
uniform vec3 sol, lac, ciel, terreCiel, soleilCouleur, soleilDir, horizon;
uniform float densite, fondActif, fondDemi; // plan cadastral drapé autour de la maquette (demi-côté en m)
uniform sampler2D tFond;
varying vec3 vMonde, vN;
varying float vEau;
void main() {
  vec3 n = normalize(vN), base = sol;
  if (fondActif > 0.5) {
    vec2 uv = vec2(vMonde.x, -vMonde.z) / (2.0 * fondDemi) + 0.5;
    float bord = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0; // 0 au centre, 1 au bord de l'image
    base = mix(texture2D(tFond, uv).rgb, sol, smoothstep(0.85, 1.0, bord));
  }
  base = mix(base, lac, smoothstep(0.3, 0.9, vEau));
  // même éclairage que la maquette (ciel en hémisphère + soleil), sans ombres portées
  vec3 lum = mix(terreCiel, ciel, n.y * 0.5 + 0.5) + soleilCouleur * max(dot(n, soleilDir), 0.0);
  vec3 c = base * lum / 3.14159;
  // perspective aérienne : le paysage se fond dans la couleur de l'horizon avec la distance
  float d = length(vMonde - cameraPosition);
  float k = d * densite;
  c = mix(c, horizon, 1.0 - exp(-k * k)); // même brume que la maquette (FogExp2)
  gl_FragColor = vec4(c, 1.0);
}`;

export function materiauLointain() {
  return new THREE.ShaderMaterial({
    uniforms: {
      sol: { value: new THREE.Color() }, lac: { value: new THREE.Color() }, ciel: { value: new THREE.Color() },
      terreCiel: { value: new THREE.Color() }, soleilCouleur: { value: new THREE.Color() }, soleilDir: { value: new THREE.Vector3(0, 1, 0) },
      horizon: { value: new THREE.Color() }, densite: { value: 0 },
      tFond: { value: null }, fondActif: { value: 0 }, fondDemi: { value: 2000 },
    },
    vertexShader: SOMMETS, fragmentShader: FRAGMENTS,
  });
}
