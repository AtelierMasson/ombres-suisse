// Plan cadastral en tuiles autour de la maquette, chargées au fur et à mesure qu'on se déplace (en 3D comme en vue
// plan), plus fines près de la caméra, plus grossières au loin ; posées sur le paysage, reteintées aux couleurs du
// thème, avec le grain de papier de la maquette. Les tuiles sont alignées sur la grille MN95 (côtés de 125 m × 2^n).
import * as THREE from "three";
import { urlFond, COUCHES, chargerImage, teinterCadastre } from "./fond.js";

const COTE0 = 125, NIVEAUX = 9, PIXELS = 512, MAX_TUILES = 160;

export class TuilesPlan {
  /** `habiller(materiau)` : grain de papier (grainPlatre de la scène). */
  constructor(scene3d, habiller) {
    this.s = scene3d;
    this.habiller = habiller;
    this.groupe = new THREE.Group();
    this.tuiles = new Map(); // clé « niveau/i/j » -> { maille, pret, niveau, e0, n0, cote, vieille }
    this.demiMaquette = { value: 0 };
    this.lieu = null;
    this.attente = null;
  }

  /** Nouveau lieu : origine (E0, N0), demi-côté de la maquette, altitude du paysage (x, y) -> y de la scène. */
  placer(E0, N0, R, altitude) {
    this.vider();
    this.lieu = { E0, N0, R, altitude };
    this.demiMaquette.value = R - 0.05;
    this.demander();
  }

  vider() {
    for (const T of this.tuiles.values()) this.liberer(T);
    this.tuiles.clear();
    this.lieu = null;
  }

  liberer(T) {
    T.abandon = true;
    if (!T.maille) return;
    this.groupe.remove(T.maille);
    T.maille.geometry.dispose(); T.maille.material.map?.dispose(); T.maille.material.dispose();
  }

  /** Recalcul des tuiles voulues, un peu après le dernier mouvement de la caméra. */
  demander() {
    clearTimeout(this.attente);
    this.attente = setTimeout(() => this.maj(), 200);
  }

  /** Tuiles voulues : découpage en quart d'arbre selon la distance à la caméra (ou la largeur vue, en plan). */
  voulues() {
    const { E0, N0 } = this.lieu, cam = this.s.camera, cible = this.s.controls.target, plan = this.s.modeVue === "plan";
    const dCam = cam.position.distanceTo(cible);
    // largeur vue au sol en plan (caméra lointaine à focale longue), rayon couvert en 3D
    const vue = 2 * dCam * Math.tan(cam.fov * Math.PI / 360) * Math.max(1, cam.aspect);
    const rayon = plan ? vue * 0.75 + 200 : Math.min(60000, Math.max(3000, dCam * 6));
    const cE = E0 + cible.x, cN = N0 - cible.z;
    const feuilles = [];
    const visiter = (niveau, i, j) => {
      const cote = COTE0 * 2 ** niveau, e0 = i * cote, n0 = j * cote;
      // hors de la zone couverte
      if (e0 > cE + rayon || e0 + cote < cE - rayon || n0 > cN + rayon || n0 + cote < cN - rayon) return;
      const x = e0 + cote / 2 - E0, y = n0 + cote / 2 - N0;
      const d = plan ? 0 : Math.max(10, Math.hypot(x - cam.position.x, y + cam.position.z, cam.position.y));
      const fin = plan ? cote > vue / 6 : cote > d * 0.55;
      if (niveau > 0 && fin && feuilles.length < MAX_TUILES) {
        for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visiter(niveau - 1, 2 * i + a, 2 * j + b);
      } else feuilles.push({ cle: `${niveau}/${i}/${j}`, niveau, e0, n0, cote });
    };
    const C = COTE0 * 2 ** NIVEAUX;
    for (let i = Math.floor((cE - rayon) / C); i <= Math.floor((cE + rayon) / C); i++)
      for (let j = Math.floor((cN - rayon) / C); j <= Math.floor((cN + rayon) / C); j++) visiter(NIVEAUX, i, j);
    return feuilles;
  }

  maj() {
    if (!this.lieu || !this.groupe.visible) return;
    const voulues = this.voulues(), garder = new Set(voulues.map(v => v.cle));
    for (const v of voulues) if (!this.tuiles.has(v.cle)) this.creer(v);
    for (const [cle, T] of this.tuiles) T.vieille = !garder.has(cle);
    this.nettoyer();
  }

  /** Une vieille tuile reste affichée tant que les nouvelles qui la recouvrent ne sont pas prêtes. */
  nettoyer() {
    const nouvelles = [...this.tuiles.values()].filter(T => !T.vieille);
    for (const [cle, T] of this.tuiles) {
      if (!T.vieille) continue;
      const dessus = nouvelles.filter(N => N.e0 < T.e0 + T.cote && N.e0 + N.cote > T.e0 && N.n0 < T.n0 + T.cote && N.n0 + N.cote > T.n0);
      if (dessus.every(N => N.pret || N.echec)) { this.liberer(T); this.tuiles.delete(cle); }
    }
    this.s.demander();
  }

  async creer(v) {
    const T = { ...v, pret: false };
    this.tuiles.set(v.cle, T);
    const lieu = this.lieu;
    try {
      const img = await chargerImage(urlFond(COUCHES.cadastre, [v.e0, v.n0, v.e0 + v.cote, v.n0 + v.cote], PIXELS), 2);
      if (T.abandon || lieu !== this.lieu) return;
      T.image = img;
      const tex = new THREE.CanvasTexture(teinterCadastre(img, this.s.T.plan));
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 - 2 * (NIVEAUX - v.niveau) });
      this.habiller(mat);
      // la maquette garde son propre plan : la tuile n'est pas dessinée sur son carré
      const avant = mat.onBeforeCompile, demi = this.demiMaquette;
      mat.onBeforeCompile = (sh, r) => {
        avant(sh, r);
        sh.uniforms.demiMaquette = demi;
        sh.fragmentShader = sh.fragmentShader.replace("void main() {", "uniform float demiMaquette;\nvoid main() {\n  if (max(abs(vMonde.x), abs(vMonde.z)) < demiMaquette) discard;");
      };
      mat.customProgramCacheKey = () => "tuilePlan";
      T.maille = new THREE.Mesh(this.geometrie(v), mat);
      T.maille.receiveShadow = true;
      T.maille.renderOrder = v.niveau === 0 ? 2 : 1;
      this.groupe.add(T.maille);
      T.pret = true;
    } catch {
      T.echec = true;
    }
    if (!T.abandon) this.nettoyer();
  }

  /** Grille posée sur le paysage (à plat, à l'altitude de la maquette, là où le paysage n'est pas connu). */
  geometrie({ e0, n0, cote, niveau }) {
    const { E0, N0, altitude } = this.lieu, k = niveau <= 1 ? 32 : 16, n = k + 1;
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx = [];
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const x = e0 + cote * a / k - E0, y = n0 + cote * b / k - N0, q = b * n + a;
      const z = altitude ? altitude(x, y) : NaN;
      pos.set([x, isNaN(z) ? 0 : z + 0.05, -y], 3 * q);
      uv.set([a / k, b / k], 2 * q);
    }
    for (let b = 0; b < k; b++) for (let a = 0; a < k; a++) {
      const p = b * n + a;
      idx.push(p, p + 1, p + n, p + 1, p + n + 1, p + n);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /** Thème changé : toutes les tuiles sont reteintées. */
  reteindre() {
    for (const T of this.tuiles.values()) if (T.maille && T.image) {
      teinterCadastre(T.image, this.s.T.plan, T.maille.material.map.image);
      T.maille.material.map.needsUpdate = true;
    }
    this.s.demander();
  }
}
