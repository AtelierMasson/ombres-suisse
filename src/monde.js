// Monde persistant (docs/chargement-paysage-plan.md, B) : jeux de tuiles swisstopo posés dans le repère de la scène
// par une seule matrice (ECEF -> scène), indépendants de la maquette. Premier jeu : le terrain swisstopo en
// quantized-mesh (niveaux 0–17, normales), à la place du terrain 2 m et du relief Terrarium là où il est montré.
// Le monde n'est jamais vidé par scene.construire : changer de lieu ne fait que recalculer sa matrice (rebaser).
import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { QuantizedMeshPlugin } from "3d-tiles-renderer/plugins";
import { mn95VersEcef } from "./geo.js";

export const TERRAIN = "https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/";
const NIVEAU_MAX = 17; // le niveau 18 pèse ~100 Ko par tuile pour ~0,5 m de maille : inutile hors de la maquette

/**
 * Budget commun à tous les jeux de tuiles 3D (bâtiments, arbres, ponts, terrain partagent un seul cache LRU, celui
 * par défaut de 3d-tiles-renderer) : 256 Mo sur ordinateur, 96 Mo sur un appareil à peu de mémoire (avant : 300–400 Mo).
 */
export function bornerCache(t) {
  const peu = (globalThis.navigator?.deviceMemory || 8) <= 4, Mo = 1024 * 1024, c = t.lruCache;
  c.maxBytesSize = (peu ? 96 : 256) * Mo;
  c.minBytesSize = (peu ? 64 : 192) * Mo;
}

/**
 * Matrice ECEF -> scène (x = est, y = haut, z = sud) autour de (E, N, h) : repère local est-nord-haut, puis rotation
 * et échelle locales vers la grille MN95, mesurées sur deux points voisins (100 m à l'est, 100 m au nord) convertis
 * par les formules rigoureuses (mn95VersEcef). Précision : ~1 cm au centre ; la courbure n'est pas suivie (≈ 0,3 m à
 * 2 km, ≈ 8 m à 10 km) : rebaser au-delà de ~2 km.
 */
export function matriceVersScene(E, N, h) {
  const V = (e, n) => new THREE.Vector3(...mn95VersEcef(e, n, h));
  const c = WGS84_ELLIPSOID.getPositionToCartographic(V(E, N), {});
  const enu = WGS84_ELLIPSOID.getEastNorthUpFrame(c.lat, c.lon, c.height, new THREE.Matrix4());
  const inv = enu.clone().invert(), o = V(E, N).applyMatrix4(inv);
  const ve = V(E + 100, N).applyMatrix4(inv).sub(o).divideScalar(100), vn = V(E, N + 100).applyMatrix4(inv).sub(o).divideScalar(100);
  // [ve vn] : MN95 local -> ENU ; inverse : ENU -> MN95 (dx, dy) ; scène : x = dx, y = haut, z = -dy. La projection est
  // conforme : on garde la similitude la plus proche (rotation + échelle uniforme, appliquée aussi à la hauteur, soit
  // ~1e-4 : 5 cm sur 500 m de dénivelé) ; une échelle non uniforme fausse l'erreur écran de 3d-tiles-renderer.
  const det = ve.x * vn.y - vn.x * ve.y, a0 = vn.y / det, b0 = -vn.x / det, c0 = -ve.y / det, d0 = ve.x / det;
  const a = (a0 + d0) / 2, b = (b0 - c0) / 2, k = Math.hypot(a, b);
  return new THREE.Matrix4().set(a, b, 0, -(a * o.x + b * o.y), 0, 0, k, -k * o.z, b, -a, 0, -(b * o.x - a * o.y), 0, 0, 0, 1).multiply(inv);
}

// découpe du terrain du monde là où la maquette (ou le terrain fin) le remplace : disque de rayon `trou` autour de
// l'origine de la scène, à la position du fragment (le plus simple : pas de couture à calculer)
const TROU = { trou: { value: 0 } };
function avecTrou(mat) {
  const avant = mat.onBeforeCompile, cle = mat.customProgramCacheKey?.bind(mat);
  mat.onBeforeCompile = (sh, r) => {
    avant?.(sh, r);
    Object.assign(sh.uniforms, TROU);
    if (!sh.vertexShader.includes("varying vec3 vMonde;")) {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vMonde;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMonde = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vMonde;");
    }
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float trou;")
      .replace("void main() {", "void main() {\n  if (trou > 0.0 && dot(vMonde.xz, vMonde.xz) < trou * trou) discard;");
  };
  mat.customProgramCacheKey = () => `${cle ? cle() : ""}|monde-trou`;
  return mat;
}

export class Monde {
  /** `s` : la Scene (scene.js). Le monde s'accroche à s.scene et n'est vidé que par detruire(). */
  constructor(s) {
    this.s = s;
    this.racine = new THREE.Group(); // reçoit le calage vertical (géoïde) ; enfant : le groupe des tuiles (matrice)
    this.racine.name = "monde";
    s.scene.add(this.racine);
    this.E0 = this.N0 = null; this.zRef = 0;
    this.enCours = 0;
    this.calage = { dz: 0, n: 0 };
  }

  /** Origine de la scène (centre MN95 et altitude de référence) : seule la matrice change, les tuiles restent. */
  placer(E, N, zRef) {
    Object.assign(this, { E0: E, N0: N, zRef });
    this.matrice = matriceVersScene(E, N, zRef);
    if (this.terrain) { this.terrain.group.matrix.copy(this.matrice); this.terrain.group.matrixWorldNeedsUpdate = true; }
    this.calage = { ...this.calage, n: 0 }; // le géoïde change peu d'un lieu voisin à l'autre : on repart du précédent
    this.s.demander(2);
  }

  /**
   * Origine flottante : recentre la scène sur (E, N) en déplaçant la caméra et la cible du même écart ; les tuiles
   * chargées restent. Renvoie le décalage [dx est, dn nord] appliqué.
   */
  rebaser(E, N, zRef = this.zRef) {
    const dx = E - this.E0, dn = N - this.N0, dz = zRef - this.zRef, cam = this.s.camera, cib = this.s.controls.target;
    for (const v of [cam.position, cib]) { v.x -= dx; v.z += dn; v.y -= dz; }
    cam.updateMatrixWorld();
    this.solEn = null; // la grille de référence ne vaut qu'au lieu de départ : calage figé (le géoïde varie de ~10 cm/km)
    this.placer(E, N, zRef);
    return [dx, dn];
  }

  /** Terrain swisstopo, matière `materiau` (celle du paysage : plan drapé, grain, brume) ; `trou` : rayon caché. */
  montrerTerrain(materiau, { trou = 0, erreur = 4 } = {}) {
    TROU.trou.value = trou;
    if (this.terrain) { this.terrain.group.visible = true; return this.terrain; }
    const s = this.s, t = this.terrain = new TilesRenderer(TERRAIN);
    bornerCache(t);
    t.registerPlugin(new QuantizedMeshPlugin({ useRecommendedSettings: false, skirtLength: 30 }));
    t.errorTarget = erreur;
    t.maxDepth = NIVEAU_MAX + 1; // profondeur 1 = niveau 0
    t.setCamera(s.camera);
    t.setResolutionFromRenderer(s.camera, s.renderer);
    t.group.matrixAutoUpdate = false;
    t.group.matrix.copy(this.matrice);
    this.racine.add(t.group);
    this.materiau = avecTrou(materiau);
    t.addEventListener("load-model", ({ scene }) => {
      scene.traverse(o => {
        if (!o.isMesh) return;
        o.material = this.materiau;
        o.receiveShadow = true; o.castShadow = false;
      });
    });
    t.addEventListener("tiles-load-end", () => s.demander(3));
    return t;
  }

  cacherTerrain() { if (this.terrain) this.terrain.group.visible = false; }

  /**
   * Calage vertical (géoïde) : écart médian entre le terrain du monde et `solEn(x, y nord)` (altitude absolue) sur
   * une couronne de points, par lancers de rayons verticaux. Réestimé en douceur à chaque fin de chargement.
   */
  caler(solEn = this.solEn) {
    if (!solEn || !this.terrain) return;
    const r = new THREE.Raycaster(), bas = new THREE.Vector3(0, -1, 0), e = [];
    this.racine.updateMatrixWorld(true);
    const Rc = this.rayonCalage || 500; // dans la grille de référence (au-delà, solEn n'a plus de sens)
    for (const R of [0.15 * Rc, 0.45 * Rc, 0.85 * Rc]) for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, x = Math.cos(a) * R, y = Math.sin(a) * R, z = solEn(x, y);
      if (isNaN(z)) continue;
      r.set(new THREE.Vector3(x, 20000, -y), bas);
      // seulement les tuiles fines (rayon < 800 m, niveaux ≥ ~14) : une tuile grossière passe sous la surface (flèche de ~40 km au niveau 0)
      const t = r.intersectObject(this.terrain.group, true).find(i => (i.object.geometry.boundingSphere?.radius ?? 1e9) < 800);
      if (t) e.push(z - this.zRef - (t.point.y - this.racine.position.y));
    }
    if (e.length < 8) return;
    e.sort((a, b) => a - b);
    const dz = e[e.length >> 1], c = this.calage;
    c.dz = c.n ? c.dz + (dz - c.dz) * 0.5 : dz; c.n++;
    c.ecart = +(e[Math.floor(e.length * 0.9)] - e[Math.floor(e.length * 0.1)]).toFixed(2); // dispersion (qualité du raccord)
    this.racine.position.y = c.dz;
  }

  /** Altitude du terrain du monde (repère de la scène) sous (x, z), ou NaN (tuiles pas encore là). */
  solSous(x, z) {
    if (!this.terrain?.group.visible) return NaN;
    const r = this.rayon ||= new THREE.Raycaster();
    r.set(new THREE.Vector3(x, 20000, z), new THREE.Vector3(0, -1, 0));
    const t = r.intersectObject(this.terrain.group, true)[0];
    return t ? t.point.y : NaN;
  }

  /** Appelé à chaque image (scene.rendre) : chargement selon la caméra. */
  mettreAJour() {
    const t = this.terrain;
    if (!t || !t.group.visible) return;
    this.s.camera.updateMatrixWorld();
    t.setResolutionFromRenderer(this.s.camera, this.s.renderer);
    t.update();
    // calage : quelques fois au début (les tuiles fines arrivent), puis rarement
    const maintenant = performance.now();
    if (this.solEn && maintenant - (this.dernierCalage || 0) > (this.calage.n < 6 ? 1500 : 15000)) { this.dernierCalage = maintenant; this.caler(); }
    const st = t.stats, n = st.downloading + st.parsing + st.queued;
    if (n > 0) this.s.demander(2);
    this.enCours = n;
  }

  detruire() {
    this.terrain?.dispose(); this.terrain = null;
    this.racine.removeFromParent();
  }
}
