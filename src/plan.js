// Plan cadastral en tuiles autour de la maquette, chargées au fur et à mesure qu'on se déplace (en 3D comme en vue
// plan), plus fines près de la caméra, plus grossières au loin, reteintées aux couleurs du thème. Les tuiles sont
// alignées sur la grille MN95 (côtés de 125 m × 2^n) et gardées en mémoire d'un lieu à l'autre.
//
// Elles ne sont pas posées en 3D (le relief fin du paysage les percerait) : elles sont peintes à plat, vues de
// dessus, dans deux images centrées sur la vue — une proche et fine, une large — que le paysage reprend comme texture.
import * as THREE from "three";
import { urlFond, COUCHES, chargerImage, teinterCadastre, adoucirPhoto, bruitSurPlan } from "./fond.js";

const COTE0 = 125, NIVEAUX = 9, PIXELS = 512, MAX_TUILES = 160;
// deux images du plan : demi-côté (m) et taille (pixels) ; la proche fait environ 0,6 m par pixel, la large 16 m
const NAPPES = [{ demi: 1200, px: 4096 }, { demi: 16000, px: 2048 }];

// images gardées d'un lieu à l'autre (les tuiles sont sur la grille MN95, communes à tous les lieux) : en changeant de
// parcelle, le plan autour réapparaît sans rien retélécharger. Bornées en pixels (D10 ; avant : 600 images de 512²,
// jusqu'à ~600 Mo décodés) : ~200 Mo sur ordinateur, ~64 Mo sur mobile ; les plus anciennes sont oubliées.
const IMAGES = new Map(), PIXELS_MAX = (navigator.deviceMemory || 8) <= 4 ? 16e6 : 48e6;
let pixelsImages = 0;
const pixelsCle = cle => (+cle.split(":")[2] || PIXELS) ** 2;
function image(cle, url) {
  if (IMAGES.has(cle)) { const p = IMAGES.get(cle); IMAGES.delete(cle); IMAGES.set(cle, p); return p; }
  const p = chargerImage(url, 2);
  p.catch(() => { if (IMAGES.get(cle) === p) { IMAGES.delete(cle); pixelsImages -= pixelsCle(cle); } });
  IMAGES.set(cle, p); pixelsImages += pixelsCle(cle);
  while (pixelsImages > PIXELS_MAX && IMAGES.size > 1) { const k = IMAGES.keys().next().value; IMAGES.delete(k); pixelsImages -= pixelsCle(k); }
  return p;
}

export class TuilesPlan {
  constructor(scene3d) {
    this.s = scene3d;
    this.scenePlan = new THREE.Scene();
    this.tuiles = new Map(); // clé « niveau/i/j » -> { maille, pret, niveau, e0, n0, cote, vieille }
    this.lieu = null;
    this.actif = true;
    this.couche = "cadastre"; // cadastre, ortho (photo aérienne) ou bruit
    this.attente = null;
    this.sale = false;
    this.camPlan = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camPlan.up.set(0, 0, -1); // le nord en haut de l'image
    this.nappes = NAPPES.map(({ demi, px }) => {
      const cible = new THREE.WebGLRenderTarget(px, px, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, depthBuffer: false });
      cible.texture.colorSpace = THREE.SRGBColorSpace;
      cible.texture.anisotropy = 8;
      return { demi, px, cible, centre: new THREE.Vector3(0, 0, 0) }; // centre : x, y (nord), demi-côté (0 : vide)
    });
  }

  /** Textures et centres des deux images, pour le paysage. */
  get textures() { return this.nappes.map(n => n.cible.texture); }
  get centres() { return this.nappes.map(n => n.centre); }

  /** Nouveau lieu : origine (E0, N0) et demi-côté de la maquette. Les tuiles en mémoire reviennent aussitôt. */
  placer(E0, N0, R) {
    this.vider();
    this.lieu = { E0, N0, R };
    this.demander();
  }

  vider() {
    for (const T of this.tuiles.values()) this.liberer(T);
    this.tuiles.clear();
    this.lieu = null;
    for (const n of this.nappes) n.centre.set(0, 0, 0);
    this.sale = true;
  }

  liberer(T) {
    T.abandon = true;
    if (!T.maille) return;
    this.scenePlan.remove(T.maille);
    T.maille.geometry.dispose(); T.maille.material.map?.dispose(); T.maille.material.dispose();
    this.sale = true;
  }

  /** Couche du sol (cadastre, ortho, bruit) : les tuiles affichées sont remplacées par celles de la nouvelle couche. */
  changerCouche(couche) {
    if (couche === this.couche) return;
    this.couche = couche;
    for (const T of this.tuiles.values()) this.liberer(T);
    this.tuiles.clear();
    this.demander();
  }

  /**
   * Recalcul des tuiles voulues : au plus toutes les 200 ms, y compris pendant le mouvement (régulation, D7 ; avant :
   * seulement après l'arrêt, le plan ne suivait pas un vol ou un déplacement au clavier).
   */
  demander() {
    if (this.attente) return;
    this.attente = setTimeout(() => { this.attente = null; this.maj(); }, 200);
  }

  /**
   * Pixels demandés pour une tuile : selon l'image où elle sera peinte (proche ~0,6 m/px, large ~16 m/px), de 64 à
   * 512 (puissance de 2). Les tuiles de 1 km et plus, toujours dans l'image large, ne pèsent plus que 64–128 px.
   */
  pixels(v) {
    const [P, L] = this.nappes, x = v.e0 + v.cote / 2 - (this.lieu?.E0 ?? 0), y = v.n0 + v.cote / 2 - (this.lieu?.N0 ?? 0);
    const proche = Math.max(Math.abs(x - P.centre.x), Math.abs(y - P.centre.y)) < P.demi + v.cote / 2 || !P.centre.z;
    const res = proche ? 2 * P.demi / P.px : 2 * L.demi / L.px;
    return Math.min(PIXELS, Math.max(64, 2 ** Math.ceil(Math.log2(v.cote / res))));
  }

  /** Tuiles voulues : découpage en quart d'arbre selon la distance à la caméra (ou la largeur vue, en plan). */
  voulues() {
    const { E0, N0 } = this.lieu, cam = this.s.camera, cible = this.s.controls.target, plan = this.s.modeVue === "plan";
    const dCam = cam.position.distanceTo(cible);
    const vue = 2 * dCam * Math.tan(cam.fov * Math.PI / 360) * Math.max(1, cam.aspect);
    const rayon = plan ? vue * 0.75 + 200 : Math.min(30000, Math.max(3000, dCam * 6));
    const cE = E0 + cible.x, cN = N0 - cible.z;
    const feuilles = [];
    const visiter = (niveau, i, j) => {
      const cote = COTE0 * 2 ** niveau, e0 = i * cote, n0 = j * cote;
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
    if (!this.lieu || !this.actif) return;
    const voulues = this.voulues(), garder = new Set(voulues.map(v => v.cle));
    for (const v of voulues) if (!this.tuiles.has(v.cle)) this.creer(v);
    for (const [cle, T] of this.tuiles) T.vieille = !garder.has(cle);
    // images recentrées sur la vue quand elle s'est assez déplacée (par pas d'un quart de leur demi-côté)
    const c = this.s.controls.target;
    for (const n of this.nappes) {
      const pas = n.demi / 4, x = Math.round(c.x / pas) * pas, y = Math.round(-c.z / pas) * pas;
      if (x !== n.centre.x || y !== n.centre.y || !n.centre.z) { n.centre.set(x, y, n.demi); this.sale = true; }
    }
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
    this.sale = true;
    this.s.demander();
  }

  async creer(v) {
    const T = { ...v, pret: false };
    this.tuiles.set(v.cle, T);
    const lieu = this.lieu;
    try {
      const couche = this.couche, boite = [v.e0, v.n0, v.e0 + v.cote, v.n0 + v.cote];
      const px = this.pixels(v);
      const img = await image(`${couche}:${v.cle}:${px}`, urlFond(COUCHES[couche], boite, px));
      // bruit : posé sur le plan cadastral de la même tuile
      const cad = couche === "bruit" ? await image(`cadastre:${v.cle}:${px}`, urlFond(COUCHES.cadastre, boite, px)) : null;
      if (T.abandon || lieu !== this.lieu || couche !== this.couche) return;
      T.image = img; T.cadastre = cad; T.couche = couche;
      const tex = new THREE.CanvasTexture(this.preparer(T));
      tex.colorSpace = THREE.SRGBColorSpace;
      const g = new THREE.PlaneGeometry(v.cote, v.cote).rotateX(-Math.PI / 2);
      T.maille = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, depthTest: false, depthWrite: false, toneMapped: false }));
      T.maille.position.set(v.e0 + v.cote / 2 - lieu.E0, 0, -(v.n0 + v.cote / 2 - lieu.N0));
      T.maille.renderOrder = NIVEAUX - v.niveau; // les plus fines par-dessus
      this.scenePlan.add(T.maille);
      T.pret = true;
    } catch {
      T.echec = true;
    }
    if (!T.abandon) this.nettoyer();
  }

  /** Repeint les deux images du plan si des tuiles ont changé ou si la vue s'est déplacée (appelé avant le rendu). */
  peindre(renderer) {
    if (!this.sale) return;
    this.sale = false;
    const fond = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha(), cible = renderer.getRenderTarget();
    const cam = this.camPlan;
    for (const n of this.nappes) {
      if (!n.centre.z) continue;
      Object.assign(cam, { left: -n.demi, right: n.demi, top: n.demi, bottom: -n.demi });
      cam.position.set(n.centre.x, 50, -n.centre.y);
      cam.lookAt(n.centre.x, 0, -n.centre.y);
      cam.updateProjectionMatrix();
      renderer.setRenderTarget(n.cible);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(this.scenePlan, cam);
    }
    renderer.setRenderTarget(cible);
    renderer.setClearColor(fond, alpha);
  }

  /** Image d'une tuile aux couleurs du thème : cadastre reteinté, photo estompée, ou bruit sur le cadastre. */
  preparer(T, cv) {
    const P = this.s.T;
    if (T.couche === "ortho") return adoucirPhoto(T.image, P.sol, cv);
    if (T.couche === "bruit") return bruitSurPlan(T.image, T.cadastre, P.plan);
    return teinterCadastre(T.image, P.plan, cv);
  }

  /** Thème changé : toutes les tuiles sont reteintées. */
  reteindre() {
    for (const T of this.tuiles.values()) if (T.maille && T.image) {
      T.maille.material.map.image = this.preparer(T, T.couche === "bruit" ? undefined : T.maille.material.map.image);
      T.maille.material.map.needsUpdate = true;
    }
    this.sale = true;
    this.s.demander();
  }
}
