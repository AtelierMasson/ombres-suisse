// Comparaison : bâtiments 3D tout faits de swisstopo (swissBUILDINGS3D, tuiles 3D publiques de geo.admin.ch),
// posés dans le repère de la scène (x = est, y = altitude relative à zRef, z = sud).
import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { solEn } from "./grille.js";
import { versWgs } from "./geo.js";

const TUILES = "https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json";
// arbres isolés et forêts de swisstopo (swissTLM3D) : arbres instanciés (Tree-n.glb), chargés selon la vue
const ARBRES = "https://3d.geo.admin.ch/ch.swisstopo.vegetation.3d/v1/tileset.json";
const GEOIDE = 0; // les tuiles sont ensuite calées sur nos toits (voir caler)
// les tuiles swisstopo sont compressées en Draco : décodeur copié dans public/draco (servi avec le site)
let draco;
const decodeur = () => draco ||= new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`); // écart approximatif ellipsoïde – altitude suisse (m) ; corrigé ensuite sur le terrain

/**
 * Nuage de points d'arbres pour un jeu d'arbres instanciés (InstancedMesh) : pour chaque arbre, des points répartis dans
 * une couronne arrondie (du tiers de la hauteur au sommet), plus denses en surface, avec les attributs du matériau des
 * arbres du relevé (aRel : hauteur relative, aVar : teinte propre à l'arbre). Repère : celui du maillage (le nuage reprend sa position).
 */
/**
 * Instances d'arbres hors de la zone [rmin, rmax] (distance au centre de la scène) : échelle nulle. Le maillage n'est
 * pas encore rattaché : sa position dans la scène = matrice du groupe des tuiles × chaîne de ses parents.
 */
function limiterZone(mesh, groupe, [rmin, rmax]) {
  mesh.updateWorldMatrix(true, false);
  const M = new THREE.Matrix4().multiplyMatrices(groupe.matrix, mesh.matrixWorld), I = new THREE.Matrix4(), v = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let k = 0; k < mesh.count; k++) {
    mesh.getMatrixAt(k, I);
    v.setFromMatrixPosition(I).applyMatrix4(M);
    const d = Math.hypot(v.x, v.z);
    if (d < rmin || d > rmax) mesh.setMatrixAt(k, zero);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function nuageArbres(mesh, materiau, groupe = null) {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const b = g.boundingBox, t = new THREE.Vector3(), centre = new THREE.Vector3();
  b.getSize(t); b.getCenter(centre);
  // axe vertical du modèle : sa plus grande dimension
  const haut = t.y >= t.x && t.y >= t.z ? 1 : t.z >= t.x ? 2 : 0, l1 = (haut + 1) % 3, l2 = (haut + 2) % 3;
  const bas = b.min.getComponent(haut), H = t.getComponent(haut), r1 = t.getComponent(l1) / 2, r2 = t.getComponent(l2) / 2;
  const M = new THREE.Matrix4(), I = new THREE.Matrix4(), v = new THREE.Vector3(), echelle = new THREE.Vector3();
  // position dans la scène de chaque arbre (pour une densité qui baisse doucement avec la distance au centre)
  let Mw = null;
  if (groupe) { mesh.updateWorldMatrix(true, false); Mw = new THREE.Matrix4().multiplyMatrices(groupe.matrix, mesh.matrixWorld); }
  const w = new THREE.Vector3();
  const pos = [], rel = [], va = [];
  let graine = 1;
  const alea = () => { graine = (graine * 16807) % 2147483647; return graine / 2147483647; };
  for (let k = 0; k < mesh.count; k++) {
    mesh.getMatrixAt(k, I);
    M.copy(I); // repère du maillage (sa position, loin de l'origine, est reprise par le nuage : précision des flottants)
    echelle.setFromMatrixScale(M);
    if (echelle.x === 0) continue; // instance hors de la zone (limiterZone)
    const hm = H * echelle.getComponent(haut), rm = Math.max(r1, r2) * echelle.getComponent(l1);
    // nombre de points selon la taille de la couronne (de 24 à 110), puis en douceur moins nombreux en s'éloignant
    // (plein jusqu'à 400 m du centre, environ 40 % à 2,5 km) : pas de saut net avec les arbres du relevé
    // (la densité baisse ensuite selon la distance à la caméra, dans le shader : materiauPoints, « allege »)
    const f = 1;
    const nb = Math.max(8, Math.round(f * Math.min(110, Math.max(24, rm * rm * 3 + hm * 2))));
    graine = 1 + ((k * 7919) % 2147483646);
    const teinte = alea();
    for (let q = 0; q < nb; q++) {
      // couronne : ellipsoïde du tiers de la hauteur au sommet, rayon un peu plus large vers le bas
      const h = 0.33 + 0.67 * Math.pow(alea(), 0.8), z = (h - 0.33) / 0.67, a = alea() * Math.PI * 2;
      const ray = Math.sin(Math.PI * Math.min(1, z * 0.92 + 0.08)) * (0.75 + 0.25 * Math.sqrt(alea()));
      const p = [0, 0, 0];
      p[haut] = bas + h * H;
      p[l1] = centre.getComponent(l1) + Math.cos(a) * r1 * ray;
      p[l2] = centre.getComponent(l2) + Math.sin(a) * r2 * ray;
      v.set(p[0], p[1], p[2]).applyMatrix4(M);
      pos.push(v.x, v.y, v.z); rel.push(h); va.push(Math.min(0.999, 0.6 * teinte + 0.4 * alea()));
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aRel", new THREE.Float32BufferAttribute(rel, 1));
  geo.setAttribute("aVar", new THREE.Float32BufferAttribute(va, 1));
  const pts = new THREE.Points(geo, materiau);
  pts.position.copy(mesh.position); pts.quaternion.copy(mesh.quaternion); pts.scale.copy(mesh.scale);
  pts.receiveShadow = true;
  pts.frustumCulled = false;
  return pts;
}

export class Swiss3D {
  /** `scene3d` : la Scene3D ; `materiau` : matériau commun des bâtiments swisstopo. */
  constructor(scene3d, materiau) {
    this.s = scene3d;
    this.materiau = materiau;
    this.socle = new THREE.Group(); // reçoit la correction de hauteur
    this.socle.visible = false;
    scene3d.scene.add(this.socle);
  }

  /** (Re)charge les tuiles autour du lieu courant ({ E, N } : centre MN95 de la scène). */
  charger({ E, N }) {
    this.vider();
    const s = this.s, G = s.G, rad = Math.PI / 180, h = s.zRef + GEOIDE;
    const t = this.tuiles = new TilesRenderer(TUILES);
    t.errorTarget = 6;
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: decodeur() }));
    t.setCamera(s.camera);
    t.setResolutionFromRenderer(s.camera, s.renderer);
    // Repère : les tuiles sont en ECEF. Le repère local « est-nord-haut » (ENU) a le nord géographique, alors que la
    // scène suit la grille MN95, tournée de la convergence des méridiens (≈ 0,5° à Lausanne, jusqu'à ~1,5° aux
    // extrémités du pays) : sans correction, les bâtiments tournent autour du centre. On mesure donc localement
    // la correspondance ENU -> MN95 avec deux points voisins (100 m à l'est, 100 m au nord) convertis comme le centre.
    const ecef = (e, n) => { const [lo, la] = versWgs(e, n); return WGS84_ELLIPSOID.getCartographicToPosition(la * rad, lo * rad, h, new THREE.Vector3()); };
    const [lo0, la0] = versWgs(E, N), enu = WGS84_ELLIPSOID.getEastNorthUpFrame(la0 * rad, lo0 * rad, h, new THREE.Matrix4());
    const inv = enu.clone().invert(), o = ecef(E, N).applyMatrix4(inv);
    const ve = ecef(E + 100, N).applyMatrix4(inv).sub(o).divideScalar(100), vn = ecef(E, N + 100).applyMatrix4(inv).sub(o).divideScalar(100);
    // [ve vn] : MN95 local -> ENU ; on l'inverse pour ENU -> MN95 (dx, dy), puis scène : x = dx, y = haut, z = -dy
    const det = ve.x * vn.y - vn.x * ve.y, a = vn.y / det, b = -vn.x / det, c = -ve.y / det, d = ve.x / det;
    const versScene = new THREE.Matrix4().set(a, b, 0, -(a * o.x + b * o.y), 0, 0, 1, 0, -c, -d, 0, c * o.x + d * o.y, 0, 0, 0, 1);
    this.versScene = versScene.multiply(inv);
    t.group.matrixAutoUpdate = false;
    t.group.matrix.copy(this.versScene);
    t.group.matrixWorldNeedsUpdate = true;
    this.socle.add(t.group);
    this.socle.position.set(0, 0, 0);
    this.toits = []; this.ecarts = []; this.bases = [];
    t.addEventListener("load-model", ({ scene }) => {
      scene.traverse(o => {
        if (!o.isMesh) return;
        o.material = this.materiau;
        // la tuile n'est pas encore rattachée au groupe : calque et ombre selon l'affichage (voir appliquerCalques)
        const k = s.calques;
        o.layers.set(k.batVoir ? 0 : 2);
        o.castShadow = k.batOmbre;
        o.receiveShadow = true;
        this.relever(o, G);
      });
      this.caler(G);
      if (!this.calage) this.calerSol(G);
      s.appliquerCalques(); // tuiles nouvelles : calque et ombre selon l'affichage
      s.majBords();
      s.ombres();
    });
    t.addEventListener("tiles-load-end", () => s.demander(3));
  }

  /** Garde des sommets de toit (nettement au-dessus de notre sol) pour le calage. */
  relever(mesh, G) {
    // au chargement, la tuile n'est pas encore rattachée au groupe : on compose sa position avec celle du groupe
    mesh.updateWorldMatrix(true, false);
    const M = new THREE.Matrix4().multiplyMatrices(this.tuiles.group.matrix, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position, v = new THREE.Vector3(), zRef = this.s.zRef;
    // pied du maillage (le point le plus bas) : pour caler sur le terrain là où nous n'avons pas de toits (calerSol)
    let bas = null;
    for (let i = 0; i < pos.count; i += 3) { v.fromBufferAttribute(pos, i).applyMatrix4(M); if (!bas || v.y < bas[1]) bas = [v.x, v.y, v.z]; }
    if (bas && Math.abs(bas[0]) < G.R - 3 && Math.abs(bas[2]) < G.R - 3) {
      const z = solEn(G, bas[0], -bas[2]);
      if (!isNaN(z)) this.bases.push(z - zRef - bas[1]);
    }
    for (let i = 0; i < pos.count; i += 2) {
      v.fromBufferAttribute(pos, i).applyMatrix4(M);
      if (Math.abs(v.x) > G.R - 3 || Math.abs(v.z) > G.R - 3) continue;
      if (v.y + 3 > solEn(G, v.x, -v.z) - zRef + 2.5) this.toits.push(v.x, -v.z, v.y);
    }
  }

  /**
   * Calage : décalage (dx, dy, dz) qui fait coïncider les toits swisstopo avec nos toits. Le géoïde et la conversion
   * approchée MN95 -> WGS84 laissent un écart de l'ordre du mètre : on teste les décalages horizontaux de ±2 m (pas
   * de 25 cm) et on garde celui où le plus de sommets tombent sur un toit à la bonne hauteur ; dz = médiane des écarts.
   */
  caler(G) {
    const T = this.toits, nb = T.length / 3;
    if (nb < 100) return;
    const pas = Math.max(1, Math.floor(nb / 4000)), zRef = this.s.zRef, { n, c, x0, bat } = G;
    const toitEn = (x, y) => {
      const i = Math.floor((x - x0) / c), j = Math.floor((y - x0) / c);
      return i < 0 || j < 0 || i >= n || j >= n ? NaN : bat[j * n + i] - zRef;
    };
    const ecartsZ = (dx, dy) => {
      const e = [];
      for (let k = 0; k < nb; k += pas) { const r = toitEn(T[3 * k] + dx, T[3 * k + 1] + dy); if (!isNaN(r)) e.push(r - T[3 * k + 2]); }
      return Float32Array.from(e).sort();
    };
    const e0 = ecartsZ(0, 0);
    if (e0.length < 50) return;
    let dz = e0[e0.length >> 1], meilleur = { s: -1, dx: 0, dy: 0 };
    for (let dx = -2; dx <= 2.001; dx += 0.25) for (let dy = -2; dy <= 2.001; dy += 0.25) {
      let s = 0;
      for (let k = 0; k < nb; k += pas) { const r = toitEn(T[3 * k] + dx, T[3 * k + 1] + dy); if (Math.abs(r - T[3 * k + 2] - dz) < 0.6) s++; }
      if (s > meilleur.s) meilleur = { s, dx, dy };
    }
    const e = ecartsZ(meilleur.dx, meilleur.dy), m0 = e[e.length >> 1], proches = e.filter(d => Math.abs(d - m0) < 2);
    dz = proches.length ? proches[proches.length >> 1] : m0;
    // nos toits sont en (x + dx, y + dy) : on déplace les tuiles d'autant (scène : z = -y)
    this.socle.position.set(meilleur.dx, dz, -meilleur.dy);
    this.calage = { dx: meilleur.dx, dy: meilleur.dy, dz, part: meilleur.s / Math.ceil(nb / pas) };
  }

  /**
   * Calage sur le terrain seul (sans nos toits, par ex. le vol de l'accueil) : le pied des bâtiments swisstopo est posé
   * au terrain le plus bas de leur emprise ; on prend la médiane des écarts (le géoïde, ~50 m en Suisse, s'y retrouve).
   */
  calerSol() {
    const e = Float32Array.from(this.bases || []).sort();
    if (e.length < 15) return;
    const dz = e[e.length >> 1];
    this.socle.position.set(0, dz, 0);
    if (e.length > 60) this.calage = { dx: 0, dy: 0, dz, part: 0, sol: true };
  }

  /**
   * Arbres 3D de swisstopo (forêts et arbres isolés, instanciés), dans le même repère et le même calage que les
   * bâtiments. `materiaux` = { couronne, tronc }. `erreur` : erreur d'écran visée (plus petit = plus loin, plus lourd).
   */
  chargerArbres(materiaux, erreur = 8) {
    if (!this.versScene || this.arbres) return;
    const s = this.s, t = this.arbres = new TilesRenderer(ARBRES);
    t.errorTarget = erreur;
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: decodeur() }));
    t.setCamera(s.camera);
    t.setResolutionFromRenderer(s.camera, s.renderer);
    t.group.matrixAutoUpdate = false;
    t.group.matrix.copy(this.versScene);
    t.group.matrixWorldNeedsUpdate = true;
    this.socle.add(t.group);
    t.addEventListener("load-model", ({ scene }) => {
      const nuages = [];
      scene.traverse(o => {
        if (!o.isMesh) return;
        // tronc : matière d'origine brune (rouge > vert) ; couronne : tout le reste
        const c = o.material?.color, tronc = c && c.r > c.g * 1.15;
        o.material = tronc ? materiaux.tronc : materiaux.couronne;
        o.castShadow = true; o.receiveShadow = true;
        o.frustumCulled = false; // les instances débordent de la boîte du modèle d'origine
        // arbres en nuage de points, comme ceux du relevé : le modèle ne sert plus qu'à porter l'ombre
        // zone [min, max] : les instances hors de l'anneau sont réduites à rien (ni dessinées ni portant d'ombre)
        if (materiaux.zone && o.isInstancedMesh) limiterZone(o, t.group, materiaux.zone);
        if (materiaux.points && o.isInstancedMesh && !tronc) {
          const p = nuageArbres(o, materiaux.points, t.group);
          if (p) nuages.push([o.parent, p]);
          o.layers.set(materiaux.calqueOmbre);
        } else if (materiaux.points) o.layers.set(materiaux.calqueOmbre);
      });
      for (const [parent, p] of nuages) parent.add(p);
      s.ombres();
    });
    t.addEventListener("tiles-load-end", () => s.demander(3));
  }

  /** Appelé à chaque image : charge ou décharge les tuiles selon la caméra. */
  mettreAJour() {
    if (!this.tuiles || !this.socle.visible) return;
    this.s.camera.updateMatrixWorld();
    this.tuiles.setResolutionFromRenderer(this.s.camera, this.s.renderer);
    this.tuiles.update();
    if (this.arbres) { this.arbres.setResolutionFromRenderer(this.s.camera, this.s.renderer); this.arbres.update(); }
    // rendu à la demande : tant que des tuiles arrivent, on redemande des images pour poursuivre le chargement
    const st = this.tuiles.stats, sa = this.arbres?.stats, n = st.downloading + st.parsing + st.queued + (sa ? sa.downloading + sa.parsing + sa.queued : 0);
    if (n > 0) this.s.demander(2);
    if (n !== this.enCours) { this.enCours = n; this.s.surTuilesSwiss?.(n); }
  }

  montrer(visible) {
    this.socle.visible = visible;
    if (!visible && this.enCours) { this.enCours = 0; this.s.surTuilesSwiss?.(0); }
    if (visible && !this.tuiles && this.lieu) this.charger(this.lieu);
    this.s.ombres();
  }

  vider() {
    if (this.enCours) { this.enCours = 0; this.s.surTuilesSwiss?.(0); }
    if (this.arbres) { this.socle.remove(this.arbres.group); this.arbres.dispose(); this.arbres = null; }
    if (!this.tuiles) return;
    this.socle.remove(this.tuiles.group);
    this.tuiles.dispose();
    this.tuiles = null;
    this.calage = null;
    this.socle.position.y = 0;
  }
}
