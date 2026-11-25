// Comparaison : bâtiments 3D tout faits de swisstopo (swissBUILDINGS3D, tuiles 3D publiques de geo.admin.ch),
// posés dans le repère de la scène (x = est, y = altitude relative à zRef, z = sud).
import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { solEn } from "./grille.js";

const TUILES = "https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json";
const GEOIDE = 50;
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

  /** (Re)charge les tuiles autour du lieu courant. */
  charger({ lon, lat }) {
    this.vider();
    const s = this.s, G = s.G, rad = Math.PI / 180;
    const t = this.tuiles = new TilesRenderer(TUILES);
    t.errorTarget = 6;
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: decodeur() }));
    t.setCamera(s.camera);
    t.setResolutionFromRenderer(s.camera, s.renderer);
    // ECEF -> ENU local (origine au centre, à l'altitude zRef) -> repère de la scène
    const enu = WGS84_ELLIPSOID.getEastNorthUpFrame(lat * rad, lon * rad, s.zRef + GEOIDE, new THREE.Matrix4());
    const axes = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    t.group.matrixAutoUpdate = false;
    t.group.matrix.copy(axes.multiply(enu.invert()));
    t.group.matrixWorldNeedsUpdate = true;
    this.socle.add(t.group);
    this.ecarts = [];
    t.addEventListener("load-model", ({ scene }) => {
      scene.traverse(o => {
        if (!o.isMesh) return;
        o.material = this.materiau;
        o.castShadow = o.receiveShadow = true;
        this.caler(o, G);
      });
      s.ombres();
    });
    t.addEventListener("tiles-load-end", () => s.demander(3));
  }

  /**
   * Correction de hauteur : le pied des bâtiments doit toucher notre terrain. Pour chaque sommet, écart terrain – sommet :
   * les pieds de murs donnent les plus grands écarts (les toits, des écarts bien plus petits). On garde la médiane du
   * tiers supérieur, ce qui absorbe l'approximation du géoïde sans être faussé par la pente.
   */
  caler(mesh, G) {
    // au chargement, la tuile n'est pas encore rattachée au groupe : on compose sa position avec celle du groupe
    mesh.updateWorldMatrix(true, false);
    const M = new THREE.Matrix4().multiplyMatrices(this.tuiles.group.matrix, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position, v = new THREE.Vector3(), zRef = this.s.zRef;
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(M);
      if (Math.abs(v.x) < G.R && Math.abs(v.z) < G.R) this.ecarts.push(solEn(G, v.x, -v.z) - zRef - v.y);
    }
    if (this.ecarts.length < 30) return;
    const e = Float32Array.from(this.ecarts).sort(), haut = e.subarray(Math.floor(e.length * 2 / 3));
    this.socle.position.y = haut[haut.length >> 1];
  }

  /** Appelé à chaque image : charge ou décharge les tuiles selon la caméra. */
  mettreAJour() {
    if (!this.tuiles || !this.socle.visible) return;
    this.s.camera.updateMatrixWorld();
    this.tuiles.setResolutionFromRenderer(this.s.camera, this.s.renderer);
    this.tuiles.update();
    // rendu à la demande : tant que des tuiles arrivent, on redemande des images pour poursuivre le chargement
    const st = this.tuiles.stats;
    if (st.downloading + st.parsing + st.queued > 0) this.s.demander(2);
  }

  montrer(visible) {
    this.socle.visible = visible;
    if (visible && !this.tuiles && this.lieu) this.charger(this.lieu);
    this.s.ombres();
  }

  vider() {
    if (!this.tuiles) return;
    this.socle.remove(this.tuiles.group);
    this.tuiles.dispose();
    this.tuiles = null;
    this.socle.position.y = 0;
  }
}
