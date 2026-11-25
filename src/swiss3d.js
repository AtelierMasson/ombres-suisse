// Comparaison : bâtiments 3D tout faits de swisstopo (swissBUILDINGS3D, tuiles 3D publiques de geo.admin.ch),
// posés dans le repère de la scène (x = est, y = altitude relative à zRef, z = sud).
import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { solEn } from "./grille.js";
import { versWgs } from "./geo.js";

const TUILES = "https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json";
const GEOIDE = 0; // les tuiles sont ensuite calées sur nos toits (voir caler)
// les tuiles swisstopo sont compressées en Draco : décodeur copié dans public/draco (servi avec le site)
let draco;
const decodeur = () => draco ||= new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`); // écart approximatif ellipsoïde – altitude suisse (m) ; corrigé ensuite sur le terrain

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
    t.group.matrixAutoUpdate = false;
    t.group.matrix.copy(versScene.multiply(inv));
    t.group.matrixWorldNeedsUpdate = true;
    this.socle.add(t.group);
    this.socle.position.set(0, 0, 0);
    this.toits = []; this.ecarts = [];
    t.addEventListener("load-model", ({ scene }) => {
      scene.traverse(o => {
        if (!o.isMesh) return;
        o.material = this.materiau;
        o.castShadow = o.receiveShadow = true;
        this.relever(o, G);
      });
      this.caler(G);
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

  /** Appelé à chaque image : charge ou décharge les tuiles selon la caméra. */
  mettreAJour() {
    if (!this.tuiles || !this.socle.visible) return;
    this.s.camera.updateMatrixWorld();
    this.tuiles.setResolutionFromRenderer(this.s.camera, this.s.renderer);
    this.tuiles.update();
    // rendu à la demande : tant que des tuiles arrivent, on redemande des images pour poursuivre le chargement
    const st = this.tuiles.stats, n = st.downloading + st.parsing + st.queued;
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
    if (!this.tuiles) return;
    this.socle.remove(this.tuiles.group);
    this.tuiles.dispose();
    this.tuiles = null;
    this.socle.position.y = 0;
  }
}
