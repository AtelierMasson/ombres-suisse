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
export async function reliefLointain(E0, N0, R, zRef, hBord, rayonMax = 50000) {
  const nA = 720;
  // anneaux : écart au bord de la maquette, de plus en plus espacés avec la distance
  const ecarts = [0];
  while (ecarts.at(-1) < rayonMax) ecarts.push(ecarts.at(-1) * 1.045 + 8);
  const nR = ecarts.length;
  const pts = new Array(nA * nR);
  const besoin = new Map();
  for (let a = 0; a < nA; a++) {
    const az = a / nA * 2 * Math.PI, sx = Math.sin(az), sy = Math.cos(az);
    const r0 = R / Math.max(Math.abs(sx), Math.abs(sy)); // bord du carré dans cette direction
    for (let k = 0; k < nR; k++) {
      const d = r0 + ecarts[k], e = sx * d, n = sy * d;
      const [lon, lat] = versWgs(E0 + e, N0 + n), z = d < 6000 ? 12 : 10; // mêmes niveaux que l'horizon (tuiles en cache)
      const [tx, ty] = versTuile(lon, lat, z), cle = `${z}/${Math.floor(tx)}/${Math.floor(ty)}`;
      besoin.set(cle, null);
      pts[a * nR + k] = { e, n, d, s: ecarts[k], bx: sx * r0 * 0.995, by: sy * r0 * 0.995, cle, fx: (tx - Math.floor(tx)) * 256, fy: (ty - Math.floor(ty)) * 256 };
    }
  }
  await Promise.all([...besoin.keys()].map(async cle => {
    const [z, x, y] = cle.split("/").map(Number);
    try { besoin.set(cle, await tuile(z, x, y)); } catch { /* hors couverture */ }
  }));

  const pos = new Float32Array(nA * nR * 3), eau = new Float32Array(nA * nR);
  for (let q = 0; q < pts.length; q++) {
    const P = pts[q], h = besoin.get(P.cle);
    let alt = NaN, lac = 0;
    if (h) {
      // bilinéaire dans la tuile (bord de tuile : pixel le plus proche)
      const x = Math.min(254.999, Math.max(0, P.fx - 0.5)), y = Math.min(254.999, Math.max(0, P.fy - 0.5));
      const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, p = j * 256 + i;
      alt = (h[p] * (1 - u) + h[p + 1] * u) * (1 - v) + (h[p + 256] * (1 - u) + h[p + 257] * u) * v;
      lac = h.eau[Math.min(255, Math.round(P.fy - 0.5)) * 256 + Math.min(255, Math.round(P.fx - 0.5))];
    }
    // raccord au bord de la maquette sur les 300 premiers mètres
    const b = hBord(P.bx, P.by);
    const m = Math.min(1, P.s / 300), t = m * m * (3 - 2 * m);
    if (isNaN(alt)) alt = b;
    alt = b * (1 - t) + alt * t;
    alt -= P.d * P.d / (2 * RAYON_TERRE) * (1 - REFRACTION); // courbure de la Terre
    pos.set([P.e, alt - zRef, -P.n], 3 * q);
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
  g.setIndex(idx);
  g.computeVertexNormals();
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
uniform float brume;
varying vec3 vMonde, vN;
varying float vEau;
void main() {
  vec3 n = normalize(vN), base = mix(sol, lac, smoothstep(0.3, 0.9, vEau));
  // même éclairage que la maquette (ciel en hémisphère + soleil), sans ombres portées
  vec3 lum = mix(terreCiel, ciel, n.y * 0.5 + 0.5) + soleilCouleur * max(dot(n, soleilDir), 0.0);
  vec3 c = base * lum / 3.14159;
  // perspective aérienne : le paysage se fond dans la couleur de l'horizon avec la distance
  float d = length(vMonde - cameraPosition);
  c = mix(c, horizon, 1.0 - exp(-d / brume));
  gl_FragColor = vec4(c, 1.0);
}`;

export function materiauLointain() {
  return new THREE.ShaderMaterial({
    uniforms: {
      sol: { value: new THREE.Color() }, lac: { value: new THREE.Color() }, ciel: { value: new THREE.Color() },
      terreCiel: { value: new THREE.Color() }, soleilCouleur: { value: new THREE.Color() }, soleilDir: { value: new THREE.Vector3(0, 1, 0) },
      horizon: { value: new THREE.Color() }, brume: { value: 30000 },
    },
    vertexShader: SOMMETS, fragmentShader: FRAGMENTS,
  });
}
