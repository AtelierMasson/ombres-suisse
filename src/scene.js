// Scène three.js. Repère : x = est, y = altitude (relative à zRef), z = sud (−nord).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { solEn } from "./grille.js";
import { terrain, socle, nappe, batiments, nuagePoints, contourParcelle, couronnes } from "./maillages.js";
import { chargerImage, teinterCadastre } from "./fond.js";
import { trancheCoupe } from "./coupe.js";

const CIEL_SOMMETS = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CIEL_FRAGMENTS = /* glsl */`
uniform vec3 zenith, horizon, lueur, soleil;
uniform float force;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = mix(horizon, zenith, pow(clamp(d.y, 0.0, 1.0), 0.6));
  c = mix(c, horizon * 0.94, smoothstep(0.0, -0.3, d.y)); // sous l'horizon : brume
  float s = max(dot(d, soleil), 0.0);
  c += lueur * (pow(s, 12.0) * 0.18 + pow(s, 180.0) * 0.5) * force; // halo autour du soleil
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Grain de plâtre : variation de teinte très légère, en coordonnées du monde (indépendante de la forme), avec un grain
 * fin et de larges nuances. `force` = amplitude relative (0,07 = ±3,5 %).
 */
function grainPlatre(mat, force) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.grainForce = { value: force };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMonde;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMonde = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vMonde;
uniform float grainForce;
float hachage(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bruit3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hachage(i), hachage(i + vec3(1, 0, 0)), f.x), mix(hachage(i + vec3(0, 1, 0)), hachage(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hachage(i + vec3(0, 0, 1)), hachage(i + vec3(1, 0, 1)), f.x), mix(hachage(i + vec3(0, 1, 1)), hachage(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
float g = 0.55 * bruit3(vMonde * 2.7) + 0.3 * bruit3(vMonde * 9.0) + 0.15 * bruit3(vMonde * 0.35);
diffuseColor.rgb *= 1.0 + grainForce * (g - 0.5) * 2.0;`);
  };
  mat.customProgramCacheKey = () => "platre" + force;
}

export class Scene3D {
  constructor(conteneur, theme) {
    this.el = conteneur;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.ratio = Math.min(2, devicePixelRatio);
    r.setPixelRatio(this.ratio);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false; // les ombres ne sont recalculées que si le soleil ou la scène change
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.localClippingEnabled = true; // plan de coupe
    conteneur.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2("#e4eef6", 0.0006);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 20000);
    this.camera.position.set(-120, 140, 160);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.zoomToCursor = true;
    // rendu à la demande : tout mouvement de la caméra (molette comprise, avec son amorti) redessine
    this.controls.addEventListener("change", () => this.demander(3));
    r.domElement.addEventListener("wheel", () => this.demander(40), { passive: true });

    // lumières : ciel (hémisphère) et soleil (ombres portées)
    this.ciel = new THREE.HemisphereLight("#ffffff", "#8a8f7a", 1.1);
    const s = this.soleil = new THREE.DirectionalLight("#fff6e0", 2.6);
    s.castShadow = true;
    s.shadow.mapSize.set(4096, 4096);
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.25;
    s.shadow.radius = 2; // bord d'ombre adouci
    this.scene.add(this.ciel, s, s.target);

    this.voute = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), new THREE.ShaderMaterial({
      uniforms: {
        zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, lueur: { value: new THREE.Color("#fff1c9") },
        soleil: { value: new THREE.Vector3(0, 1, 0) }, force: { value: 1 },
      },
      vertexShader: CIEL_SOMMETS, fragmentShader: CIEL_FRAGMENTS, side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.voute.renderOrder = -1;
    this.disque = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 8), new THREE.MeshBasicMaterial({ color: "#ffcc33", fog: false }));
    this.disque.visible = false; // affiché dès qu'un lieu est chargé
    this.groupe = new THREE.Group();
    this.outils = new THREE.Group(); // tranche de coupe et poignées
    this.scene.add(this.voute, this.disque, this.groupe, this.outils);

    // matériaux partagés : le thème ne change que leurs couleurs
    const std = o => new THREE.MeshStandardMaterial({ roughness: 0.92, side: THREE.DoubleSide, ...o });
    this.mat = {
      terrain: std({ roughness: 1, side: THREE.FrontSide }), socle: std({ roughness: 1 }),
      toit: std({ flatShading: true }), mur: std({ flatShading: true }), canopee: std({ roughness: 1 }),
      couronne: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
      parcelle: new THREE.MeshBasicMaterial(), trait: new LineMaterial({ linewidth: 4, fog: false }),
      poignee: new THREE.MeshBasicMaterial({ depthTest: false, fog: false }),
    };
    // même grain léger partout (sol, socle, toits, murs, couronnes) : aspect de maquette en plâtre
    for (const [k, force] of [["terrain", 0.07], ["socle", 0.07], ["toit", 0.07], ["mur", 0.07], ["couronne", 0.05]]) grainPlatre(this.mat[k], force);
    this.partages = new Set(Object.values(this.mat));
    this.plan = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    this.couches = {};
    this.poignees = [];
    this.fonds = {};
    this.idScene = 0;
    this.typeFond = "cadastre";

    // effets : occlusion ambiante (GTAO), puis conversion des couleurs
    this.composeur = new EffectComposer(r, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }));
    this.composeur.addPass(new RenderPass(this.scene, this.camera));
    const ao = this.ao = new GTAOPass(this.scene, this.camera, 4, 4);
    ao.updateGtaoMaterial({ radius: 6, distanceExponent: 1, thickness: 6, scale: 1.5, samples: 12, distanceFallOff: 1, screenSpaceRadius: false }); // rayon en mètres
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
    ao.normalMaterial.side = THREE.DoubleSide; // murs et tranche de coupe se voient des deux côtés
    // l'occlusion ne doit voir ni le ciel, ni la canopée invisible, ni les poignées et calques posés par-dessus
    const rendu = ao.render.bind(ao);
    ao.render = (...a) => {
      // les points n'entrent jamais dans l'occlusion (sinon chaque point a son halo sombre)
      const c = this.couches, caches = [this.voute, this.disque, ...this.poignees, c.heures, c.limite, c.arbres, c.facades, c.tous,
        c.canopee?.material.colorWrite === false ? c.canopee : null].filter(o => o && o.visible);
      for (const o of caches) o.visible = false;
      rendu(...a);
      for (const o of caches) o.visible = true;
    };
    this.composeur.addPass(ao);
    this.composeur.addPass(new OutputPass());
    this.effets = true;
    this.qualite = 0; // 0 = complète, 1 = résolution réduite, 2 = effets coupés
    this.lent = 0;

    this.appliquerTheme(theme);
    this.placerSoleil([0.35, 0.75, 0.55], true);
    this.interactions();
    new ResizeObserver(() => this.taille()).observe(conteneur);
    this.taille();
    this.aRendre = 3;
    let avant = 0;
    r.setAnimationLoop(t => {
      this.animation?.(t);
      const bouge = this.controls.update();
      if (!bouge && this.aRendre <= 0) { avant = 0; return; }
      this.aRendre = Math.max(0, this.aRendre - 1);
      this.rendre();
      // images qui se suivent trop lentement : on allège
      if (avant && !document.hidden && t - avant < 400) this.mesurer(t - avant);
      avant = t;
    });
  }

  /** Demande un nouveau rendu (la scène n'est redessinée que lorsqu'elle change). */
  demander(n = 2) { this.aRendre = Math.max(this.aRendre || 0, n); }

  taille() {
    const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.setSize(w, h);
    // écran ordinaire : l'image des effets est lissée (MSAA) ; écran à haute densité : inutile et coûteux
    const lisse = this.ratio < 1.5 ? 4 : 0, cible = this.composeur.renderTarget2;
    if (cible.samples !== lisse) { cible.samples = lisse; cible.dispose(); }
    this.composeur.setPixelRatio(this.ratio);
    this.composeur.setSize(w, h);
    this.mat.trait.resolution.set(w, h);
    this.camera.aspect = w / h;
    // `decalage` pousse le modèle vers la droite (écran d'accueil, à côté du texte)
    if (this.decalage && w > 900) this.camera.setViewOffset(w, h, -this.decalage * w, 0, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.demander();
  }

  rendre() {
    if (this.coupe) this.orienterCoupe();
    if (this.effets && this.qualite < 2) this.composeur.render(); else this.renderer.render(this.scene, this.camera);
  }

  mesurer(dt) {
    if (!this.effets || this.qualite >= 2) return;
    this.lent = dt > 55 ? this.lent + 1 : Math.max(0, this.lent - 2);
    if (this.lent < 45) return;
    this.lent = 0;
    this.qualite = this.qualite === 0 && this.ratio > 1 ? 1 : 2;
    if (this.qualite === 1) { this.ratio = 1; this.taille(); }
    this.surQualite?.(this.qualite);
  }

  /** Active ou coupe les effets (occlusion ambiante). */
  reglerEffets(actifs) {
    this.effets = actifs;
    if (actifs && this.qualite === 2) this.qualite = this.ratio > 1 ? 0 : 1;
    this.lent = 0;
    this.demander();
  }

  /* ------------------------------------------------------------------ thème */
  appliquerTheme(T) {
    this.T = T;
    const m = this.mat, sombre = this.G && !this.G.classifie ? 0.93 : 1; // sans classes : bâtiments un peu plus sombres (moins fiables)
    m.toit.color.set(T.toit).multiplyScalar(sombre); m.mur.color.set(T.mur).multiplyScalar(sombre);
    m.socle.color.set(T.socle); m.canopee.color.set(T.arbres[1]); m.parcelle.color.set(T.parcelle);
    m.trait.color.set(T.coupe.trait); m.poignee.color.set(T.parcelle);
    m.terrain.color.set(m.terrain.map ? "#ffffff" : T.sol);
    // lumière du ciel quasi uniforme : un mur dos au soleil a le même ton qu'une ombre portée au sol
    this.ciel.color.set(T.lumiere.ciel); this.ciel.groundColor.set(T.lumiere.ciel).lerp(new THREE.Color(T.lumiere.sol), 0.15);
    this.renderer.toneMappingExposure = T.lumiere.exposition;
    this.scene.fog.density = T.lumiere.brume;
    this.couleursPoints();
    if (this.G && this.arbresTeinte && this.T.arbres !== this.arbresTeinte) this.refaireCouronnes();
    if (this.etatSoleil) this.placerSoleil(...this.etatSoleil);
    if (this.typeFond === "cadastre" && this.urls) this.fond("cadastre");
    this.demander();
  }

  couleursPoints() {
    const c = this.couches, T = this.T;
    if (c.arbres) ["c1", "c2", "c3"].forEach((u, k) => c.arbres.material.uniforms[u].value.set(T.arbres[k]));
    if (c.facades) for (const u of ["c1", "c2", "c3"]) c.facades.material.uniforms[u].value.set(T.facades);
  }

  /* ------------------------------------------------------------------ construction */
  liberer(g) {
    g.traverse(o => {
      o.geometry?.dispose();
      for (const m of [o.material].flat()) if (m && !this.partages.has(m)) { m.map?.dispose(); m.dispose(); }
    });
    g.clear();
  }

  vider() {
    this.liberer(this.groupe); this.liberer(this.outils);
    for (const F of Object.values(this.fonds)) F.tex?.dispose();
    this.fonds = {};
    if (this.mat.terrain.map) { this.mat.terrain.map = null; this.mat.terrain.needsUpdate = true; }
    this.couches = {};
    this.poignees = [];
    this.coupe = this.contours = this.urls = null;
    this.idScene++;
  }

  /** Construit la scène depuis les grilles. `urls` = { cadastre, ortho } (images du fond de plan) ou null. */
  construire(G, nuage, parcelle, urls) {
    this.vider();
    this.G = G;
    this.urls = urls;
    this.zRef = solEn(G, 0, 0);
    const s = this.soleil.shadow.camera, R = G.R * 1.45;
    Object.assign(s, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 3000 });
    s.updateProjectionMatrix();
    let zmin = Infinity;
    for (let p = 0; p < G.sol.length; p++) if (G.sol[p] < zmin) zmin = G.sol[p];
    this.zBas = zmin - this.zRef - Math.max(6, G.R * 0.05);

    const m = this.mat, maille = (g, mat, porte, recoit) => { const o = new THREE.Mesh(g, mat); o.castShadow = porte; o.receiveShadow = recoit; return o; };
    const sol = maille(terrain(G, this.zRef), m.terrain, false, true);
    const base = maille(socle(G, this.zRef, this.zBas), m.socle, false, false);
    const B = batiments(G, this.zRef), bati = new THREE.Group();
    bati.add(maille(B.toits, m.toit, true, true), maille(B.murs, m.mur, true, true));
    this.contours = B.contours;
    // la canopée (grille) porte l'ombre en mode « points » ; les couronnes lissées sont construites par styleArbres()
    const canopee = maille(nappe(G, G.veg, this.zRef), m.canopee, true, false);
    const arbres = nuage ? nuagePoints(nuage, G, this.zRef, "arbres", 0.5, 0.9) : null;
    const facades = nuage ? nuagePoints(nuage, G, this.zRef, "facades", 1, 0.42) : null;
    const tous = nuage ? nuagePoints(nuage, G, this.zRef, "tous", 0.35, 0.45) : null;
    const limite = contourParcelle(parcelle, G, this.zRef, m.parcelle);
    this.couches = { terrain: sol, socle: base, bati, canopee, arbres, facades, tous, limite };
    for (const o of Object.values(this.couches)) if (o) this.groupe.add(o);
    if (tous) tous.visible = false;
    if (facades) facades.visible = false;
    this.styleArbres(this.style || "couronnes");
    this.appliquerCoupe();
    this.appliquerTheme(this.T);
    if (this.typeFond !== "cadastre") this.fond(this.typeFond);
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(-110, 120, 150);
    this.ombres();
  }

  /**
   * Rendu des arbres : "couronnes" (volumes lissés, une ombre douce par massif), "points" (relevé laser, disques plats
   * sans halo ; la canopée invisible porte l'ombre) ou "mixte" (couronnes amincies habillées de points clairsemés).
   */
  styleArbres(style, visibles = this.arbresVisibles ?? true) {
    this.style = style; this.arbresVisibles = visibles;
    const c = this.couches, m = this.mat;
    if (!this.G) return;
    for (const k of ["couronnes", "mixte"]) if (c[k]) c[k].visible = false;
    if (style !== "points" || !c.arbres) {
      const k = style === "mixte" && c.arbres ? "mixte" : "couronnes";
      if (!c[k]) {
        this.arbresTeinte = this.T.arbres;
        const g = couronnes(this.G, this.zRef, this.T.arbres, k === "mixte" ? 0.35 : 0);
        if (g) { c[k] = new THREE.Mesh(g, m.couronne); c[k].castShadow = c[k].receiveShadow = true; this.groupe.add(c[k]); this.appliquerCoupe(); }
      }
      if (c[k]) c[k].visible = visibles;
    }
    // la canopée en grille ne sert plus qu'à porter l'ombre des points
    c.canopee.visible = visibles && style === "points" && !!c.arbres;
    m.canopee.colorWrite = m.canopee.depthWrite = false;
    m.canopee.needsUpdate = true;
    if (c.arbres) {
      c.arbres.visible = visibles && style !== "couronnes";
      const u = c.arbres.material.uniforms;
      u.relief.value = 0; // disques plats : plus d'effet de petites boules
      u.taille.value = style === "mixte" ? 0.55 : 0.7;
    }
    this.ombres();
  }

  /** Couronnes à refaire (couleurs du thème changées). */
  refaireCouronnes() {
    for (const k of ["couronnes", "mixte"]) {
      const o = this.couches[k];
      if (!o) continue;
      this.groupe.remove(o); o.geometry.dispose(); this.couches[k] = null;
    }
    this.styleArbres(this.style);
  }

  /** Les ombres portées sont à recalculer (soleil déplacé, couche affichée ou masquée). */
  ombres() { this.renderer.shadowMap.needsUpdate = true; this.demander(); }

  /** Fond de plan du terrain : "cadastre" (reteinté selon le thème), "ortho" ou "uni". */
  async fond(type) {
    this.typeFond = type;
    const mat = this.mat.terrain, id = this.idScene;
    const poser = tex => {
      if (id !== this.idScene || this.typeFond !== type) return;
      if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }
      mat.color.set(tex ? "#ffffff" : this.T.sol);
      this.demander();
    };
    if (type === "uni" || !this.urls) return poser(null);
    try {
      const F = this.fonds[type] ||= { image: chargerImage(this.urls[type]) };
      if (!F.tex) poser(null);
      const img = await F.image;
      if (id !== this.idScene) return;
      if (type === "cadastre" && F.theme !== this.T) {
        F.canvas = teinterCadastre(img, this.T.plan, F.canvas);
        F.theme = this.T;
        if (F.tex) F.tex.needsUpdate = true;
      }
      if (!F.tex) {
        F.tex = type === "cadastre" ? new THREE.CanvasTexture(F.canvas) : new THREE.Texture(img);
        F.tex.colorSpace = THREE.SRGBColorSpace; F.tex.anisotropy = 8; F.tex.needsUpdate = true;
      }
      poser(F.tex);
    } catch (e) {
      console.warn(e.message);
      if (id === this.idScene) delete this.fonds[type];
      poser(null);
      this.surFondAbsent?.(type);
    }
  }

  /** Place le soleil ; `visible` = au-dessus de l'horizon (relief lointain compris). */
  placerSoleil(dir, visible) {
    this.etatSoleil = [dir, visible];
    const d = new THREE.Vector3(...dir), T = this.T, u = this.voute.material.uniforms;
    this.soleil.position.copy(d.clone().multiplyScalar(900));
    this.soleil.target.position.set(0, 0, 0);
    // soleil bas : lumière plus chaude
    const bas = visible ? 1 - Math.min(1, Math.max(0, dir[1] / 0.21)) : 0;
    this.soleil.color.set(T.lumiere.soleil).lerp(new THREE.Color("#ffb066"), 0.65 * bas * bas);
    this.soleil.intensity = visible ? 2.6 : 0;
    this.ciel.intensity = visible ? 1.1 : Math.max(0.35, 0.9 * Math.min(1, (dir[1] + 0.1) * 4));
    this.disque.position.copy(d.clone().multiplyScalar(1200));
    this.disque.visible = dir[1] > -0.02 && !!this.G;
    // ciel : jour, soleil caché par le relief (plus terne), nuit
    const jour = visible ? 1 : dir[1] > 0 ? 0.72 : Math.max(0, Math.min(0.5, 0.5 + dir[1] * 4));
    u.zenith.value.set(T.ciel.nuitZenith).lerp(new THREE.Color(T.ciel.zenith), jour);
    u.horizon.value.set(T.ciel.nuitHorizon).lerp(new THREE.Color(T.ciel.horizon), jour).lerp(new THREE.Color("#f7c99b"), 0.45 * bas);
    u.soleil.value.copy(d).normalize();
    u.force.value = visible ? 1 : 0;
    this.scene.fog.color.copy(u.horizon.value);
    for (const k of ["arbres", "facades", "tous"]) if (this.couches[k]) this.couches[k].material.uniforms.lum.value = 0.45 + 0.55 * jour;
    this.ombres();
  }

  /** Carte des heures d'ensoleillement (groupe de maillages préparé par heures.js), ou null pour l'enlever. */
  afficherHeures(grp) {
    const vieux = this.couches.heures;
    if (vieux) { this.groupe.remove(vieux); this.liberer(vieux); }
    this.couches.heures = grp;
    if (grp) { if (vieux) grp.visible = vieux.visible; this.groupe.add(grp); }
    this.appliquerCoupe();
    this.demander();
  }

  /**
   * Points mesurés sur les façades. Ils sont sous les avant-toits, donc derrière les murs reconstruits à l'aplomb
   * du bord du toit : les murs deviennent translucides pour les laisser voir.
   */
  voirFacades(actif) {
    const c = this.couches.facades, m = this.mat.mur;
    actif = !!(actif && c);
    if (c) c.visible = actif;
    if (m.transparent !== actif) { m.transparent = actif; m.opacity = actif ? 0.28 : 1; m.depthWrite = !actif; m.needsUpdate = true; }
    this.demander();
  }

  vuePieton(actif) {
    if (actif) {
      this.camera.position.set(0, 1.7, 0.01);
      this.controls.target.set(0, 1.7, -10);
      this.controls.maxPolarAngle = Math.PI * 0.75;
    } else {
      this.controls.maxPolarAngle = Math.PI * 0.495;
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(-110, 120, 150);
    }
    this.demander();
  }

  /* ------------------------------------------------------------------ coupe */

  /** Affiche la coupe décrite par le profil `P` (coupe.js), ou l'enlève si `P` est nul. */
  definirCoupe(P) {
    this.liberer(this.outils);
    this.coupe = P;
    this.poignees = [];
    if (P) {
      this.tranche = trancheCoupe(P, this.zRef, this.zBas, this.T.coupe, this.mat.trait);
      this.outils.add(this.tranche);
      this.poignees = [P.A, P.B].map(([x, y], k) => {
        const g = new THREE.Group(), boule = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), this.mat.poignee);
        boule.renderOrder = 5; boule.userData.bout = k;
        g.add(boule, etiquette(k ? "B" : "A", this.T.coupe.trait));
        g.position.set(x, solEn(this.G, x, y) - this.zRef + 1, -y);
        this.outils.add(g);
        return g;
      });
      this.cote = 0;
      this.orienterCoupe();
    }
    this.appliquerCoupe();
    this.demander();
  }

  /** Le côté masqué est toujours celui de la caméra : on regarde la tranche de face. */
  orienterCoupe() {
    const P = this.coupe, c = this.camera.position;
    const cote = (c.x - P.A[0]) * P.uy + (c.z + P.A[1]) * P.ux >= 0 ? -1 : 1;
    if (cote !== this.cote) {
      this.cote = cote;
      this.plan.normal.set(P.uy * cote, 0, P.ux * cote);
      this.plan.constant = -(P.A[0] * P.uy - P.A[1] * P.ux) * cote;
      this.tranche.position.copy(this.plan.normal).multiplyScalar(0.03); // la tranche reste juste du côté visible
    }
    // poignées de taille constante à l'écran
    for (const g of this.poignees) g.scale.setScalar(Math.max(0.6, c.distanceTo(g.position) * 0.011));
  }

  appliquerCoupe() {
    const plans = this.coupe ? [this.plan] : null, c = this.couches, m = this.mat;
    const cibles = [m.terrain, m.socle, m.toit, m.mur, m.canopee, m.couronne, m.parcelle, this.ao.normalMaterial];
    for (const k of ["arbres", "facades", "tous"]) if (c[k]) cibles.push(c[k].material);
    c.heures?.traverse(o => o.material && cibles.push(o.material));
    for (const x of cibles) if (!!x.clippingPlanes !== !!plans) { x.clippingPlanes = plans; x.needsUpdate = true; }
  }

  /** Rayon de la caméra passant sous le pointeur. */
  viser(e) {
    const b = this.renderer.domElement.getBoundingClientRect();
    this.rayon.setFromCamera(new THREE.Vector2((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1), this.camera);
    return this.rayon;
  }

  /** Souris : déplacer les poignées A et B de la coupe, ou tracer une coupe en deux clics (voir `tracer`). */
  interactions() {
    const el = this.renderer.domElement, sol = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), v = new THREE.Vector3();
    this.rayon = new THREE.Raycaster();
    let prise = null, appui = null;
    const borne = x => Math.max(-this.G.R + 2, Math.min(this.G.R - 2, x));
    el.addEventListener("pointerdown", e => {
      appui = [e.clientX, e.clientY];
      if (!this.coupe || this.trace) return;
      const t = this.viser(e).intersectObjects(this.poignees.map(g => g.children[0]))[0];
      if (!t) return;
      prise = t.object.userData.bout;
      this.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
    }, true);
    el.addEventListener("pointermove", e => {
      if (prise == null) return;
      sol.constant = -this.poignees[prise].position.y;
      if (!this.viser(e).ray.intersectPlane(sol, v)) return;
      const p = [borne(v.x), borne(-v.z)], A = prise === 0 ? p : this.coupe.A, B = prise === 1 ? p : this.coupe.B;
      if (Math.hypot(B[0] - A[0], B[1] - A[1]) > 3) this.surCoupe?.(A, B);
    });
    el.addEventListener("pointerup", e => {
      if (prise != null) { prise = null; this.controls.enabled = true; return; }
      if (!this.trace || !appui || Math.hypot(e.clientX - appui[0], e.clientY - appui[1]) > 5) return;
      const cibles = [this.couches.terrain, ...(this.couches.bati?.visible ? this.couches.bati.children : [])].filter(Boolean);
      const t = this.viser(e).intersectObjects(cibles)[0];
      if (!t) return;
      const p = [borne(t.point.x), borne(-t.point.z)];
      if (!this.depart) { this.depart = p; this.surDepart?.(p); return; }
      if (Math.hypot(p[0] - this.depart[0], p[1] - this.depart[1]) < 3) return;
      const A = this.depart, fin = this.trace;
      this.tracer(null);
      fin(A, p);
    });
  }

  /** Mode « tracer la coupe » : les deux prochains clics sur le modèle donnent A puis B. */
  tracer(fin) {
    this.trace = fin;
    this.depart = null;
    this.renderer.domElement.style.cursor = fin ? "crosshair" : "";
  }
}

/** Petite étiquette (A, B) toujours lisible, au-dessus d'une poignée. */
function etiquette(texte, couleur) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(32, 32, 26, 0, 7); ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = couleur; ctx.stroke();
  ctx.fillStyle = "#1f2933"; ctx.font = "bold 34px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(texte, 32, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false }));
  s.position.y = 3.2; s.scale.setScalar(3.4); s.renderOrder = 6;
  return s;
}
