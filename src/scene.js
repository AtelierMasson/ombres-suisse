// Scène three.js. Repère : x = est, y = altitude (relative à zRef), z = sud (−nord).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RebondPass } from "./rebond.js";
import { Swiss3D } from "./swiss3d.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { solEn, majSurface } from "./grille.js";
import { indexVolumes } from "./volumes.js";
import { terrain, socle, nappe, batiments, nuagePoints, contourParcelle, couronnes, pointsVegetation, hauteursBords, limitesVoisines } from "./maillages.js";
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
// ombre de contact : grilles du lieu (altitude du sol, distance au bâti) partagées par les matériaux
const CONTACT = { tSol: { value: null }, tDist: { value: null }, grille: { value: new THREE.Vector3(0, 1, 0) }, contactActif: { value: 0 },
  // sélection : R = parcelle choisie, G = bâtiment(s) de l'adresse ou de la parcelle ; teinte = couleur de parcelle du thème
  tSel: { value: null }, teinteSel: { value: new THREE.Color("#e0262b") } };

/**
 * `contact` : "mur" (bas des murs assombri sur ~1,5 m), "sol" (sol assombri au pied des bâtiments, ~2 m) ou "toit" ;
 * les trois reçoivent aussi la teinte légère de la sélection (parcelle, bâtiment).
 * L'occlusion ambiante, large et douce, ne marque pas assez la jonction mur–sol : les bâtiments semblaient flotter.
 */
function grainPlatre(mat, force, contact = "") {
  mat.onBeforeCompile = sh => {
    sh.uniforms.grainForce = { value: force };
    Object.assign(sh.uniforms, CONTACT);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMonde;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMonde = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vMonde;
uniform float grainForce;
uniform sampler2D tSol, tDist, tSel;
uniform vec3 teinteSel;
uniform vec3 grille; // x0, côté (m), zRef inutilisé
uniform float contactActif;
float hachage(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bruit3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hachage(i), hachage(i + vec3(1, 0, 0)), f.x), mix(hachage(i + vec3(0, 1, 0)), hachage(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hachage(i + vec3(0, 0, 1)), hachage(i + vec3(1, 0, 1)), f.x), mix(hachage(i + vec3(0, 1, 1)), hachage(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
float g = 0.55 * bruit3(vMonde * 2.7) + 0.3 * bruit3(vMonde * 9.0) + 0.15 * bruit3(vMonde * 0.35);
// trame de cases de 0,5 m (celle du relevé) : un ton légèrement différent par case, sur toutes les faces
float pixel = hachage(floor(vMonde * 2.0 + 0.001) + 0.37);
diffuseColor.rgb *= 1.0 + grainForce * ((g - 0.5) * 1.4 + (pixel - 0.5) * 0.9);
${contact && `if (contactActif > 0.5) {
  vec2 uvG = (vec2(vMonde.x, -vMonde.z) - grille.x) / grille.y;
  ${contact === "mur"
    ? "float hc = vMonde.y - texture2D(tSol, uvG).r; diffuseColor.rgb *= mix(0.84, 1.0, smoothstep(0.0, 1.2, hc));"
    : contact === "sol" ? "float dc = texture2D(tDist, uvG).r; diffuseColor.rgb *= mix(0.86, 1.0, smoothstep(0.0, 1.6, dc));" : ""}
  vec2 sel = texture2D(tSel, uvG).rg;
  diffuseColor.rgb = mix(diffuseColor.rgb, teinteSel * 1.15, ${contact === "sol" ? "0.13 * sel.r" : "0.22 * sel.g"});
}`}`);
  };
  mat.customProgramCacheKey = () => "platre" + force + contact;
}

// Couleur de la lumière directe du soleil selon sa hauteur (degrés), après la traversée de l'atmosphère
const TEINTES_SOLEIL = [[0, "#ff6a30"], [1.5, "#ff8740"], [4, "#ffa45e"], [8, "#ffc285"], [15, "#ffd9ac"], [25, "#ffead0"], [45, "#fff4e6"]]
  .map(([h, c]) => [h, new THREE.Color(c)]);
function couleurSoleil(h) {
  const T = TEINTES_SOLEIL, c = new THREE.Color();
  if (h <= T[0][0]) return c.copy(T[0][1]);
  for (let k = 1; k < T.length; k++) if (h <= T[k][0]) return c.copy(T[k - 1][1]).lerp(T[k][1], (h - T[k - 1][0]) / (T[k][0] - T[k - 1][0]));
  return c.copy(T[T.length - 1][1]);
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
    for (const [k, force, contact] of [["terrain", 0.07, "sol"], ["socle", 0.07], ["toit", 0.07, "toit"], ["mur", 0.07, "mur"], ["couronne", 0.05]]) grainPlatre(this.mat[k], force, contact);
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
    // occlusion large et douce : rayon 12 m, décroissance progressive, débruitage plus étendu
    ao.updateGtaoMaterial({ radius: 12, distanceExponent: 2, thickness: 10, scale: 1.15, samples: 16, distanceFallOff: 1, screenSpaceRadius: false }); // rayon en mètres
    ao.updatePdMaterial({ lumaPhi: 8, depthPhi: 1.5, normalPhi: 2, radius: 10, radiusExponent: 1.5, rings: 3, samples: 16 });
    // calculée en demi-résolution : ~4 fois moins coûteuse, et l'agrandissement bilinéaire la lisse encore
    const tailleAo = ao.setSize.bind(ao);
    ao.setSize = (w, h) => tailleAo(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    ao.normalMaterial.side = THREE.DoubleSide; // murs et tranche de coupe se voient des deux côtés
    // l'occlusion ne doit voir ni le ciel, ni la canopée invisible, ni les poignées et calques posés par-dessus
    const rendu = ao.render.bind(ao);
    ao.render = (...a) => {
      // les points n'entrent jamais dans l'occlusion (sinon chaque point a son halo sombre)
      const c = this.couches, caches = [this.voute, this.disque, ...this.poignees, c.heures, c.limite, c.voisines, c.arbres, c.facades, c.tous, c.selection,
        c.canopee?.material.colorWrite === false ? c.canopee : null].filter(o => o && o.visible);
      for (const o of caches) o.visible = false;
      rendu(...a);
      for (const o of caches) o.visible = true;
    };
    this.composeur.addPass(ao);
    // un rebond de lumière (éclairage indirect) à l'écran, après l'occlusion dont il reprend profondeur et normales
    this.composeur.addPass(this.rebond = new RebondPass(this.camera, ao));
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
    this.swiss?.mettreAJour();
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
    // bâtiments de la couleur du sol : une maquette d'un seul matériau, le relief vient des ombres
    m.toit.color.set(T.sol).multiplyScalar(sombre); m.mur.color.set(T.sol).multiplyScalar(sombre);
    this.swiss?.materiau.color.set(T.sol);
    // socle de la même matière que le terrain et les bâtiments
    m.socle.color.set(T.sol); m.canopee.color.set(T.arbres[1]); m.parcelle.color.set(T.parcelle);
    m.trait.color.set(T.coupe.trait); m.poignee.color.set(T.parcelle);
    CONTACT.teinteSel.value.set(T.parcelle);
    this.couches?.selection?.material.color.set(T.parcelle);
    m.terrain.color.set(m.terrain.map ? "#ffffff" : T.sol);
    // lumière du ciel quasi uniforme : un mur dos au soleil a le même ton qu'une ombre portée au sol. Le « rebond » du sol
    // (éclairage indirect) teinte légèrement les faces tournées vers le bas ou de côté, à luminosité égale.
    this.ciel.color.set(T.lumiere.ciel);
    const rebond = new THREE.Color(T.lumiere.ciel).lerp(new THREE.Color(T.lumiere.sol), 0.35), lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    this.ciel.groundColor.copy(rebond.multiplyScalar(lum(this.ciel.color) / Math.max(1e-3, lum(rebond))));
    this.renderer.toneMappingExposure = T.lumiere.exposition;
    this.scene.fog.density = this.modeVue ? 0 : T.lumiere.brume;
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
    this.swiss?.vider();
    this.liberer(this.groupe); this.liberer(this.outils);
    for (const F of Object.values(this.fonds)) F.tex?.dispose();
    this.fonds = {};
    if (this.mat.terrain.map) { this.mat.terrain.map = null; this.mat.terrain.needsUpdate = true; }
    this.couches = {};
    this.poignees = [];
    this.coupe = this.contours = this.urls = null;
    this.contoursTous = this.volumes = this.batOrigine = null;
    this.idScene++;
  }

  /** Construit la scène depuis les grilles. `urls` = { cadastre } (image du plan cadastral) ou null. */
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
    this.grillesContact(G);

    const m = this.mat, maille = (g, mat, porte, recoit) => { const o = new THREE.Mesh(g, mat); o.castShadow = porte; o.receiveShadow = recoit; return o; };
    const sol = maille(terrain(G, this.zRef), m.terrain, false, true);
    const base = maille(socle(G, this.zRef, this.zBas), m.socle, false, false);
    const B = batiments(G, this.zRef), bati = new THREE.Group();
    bati.add(maille(B.toits, m.toit, true, true), maille(B.murs, m.mur, true, true));
    this.contours = this.contoursTous = B.contours;
    // la canopée (grille) porte l'ombre des points ; sans points, styleArbres() construit des couronnes lissées
    const canopee = maille(nappe(G, G.veg, this.zRef), m.canopee, true, false);
    // arbres toujours en points : sans relevé classé (repli raster), points tirés de la grille de végétation
    const arbres = nuage ? nuagePoints(nuage, G, this.zRef, "arbres", 0.5, 0.9) : nuagePoints(pointsVegetation(G), G, this.zRef, "arbres", 1, 0.9);
    const facades = nuage ? nuagePoints(nuage, G, this.zRef, "facades", 1, 0.42) : null;
    const tous = nuage ? nuagePoints(nuage, G, this.zRef, "tous", 0.35, 0.45) : null;
    const limite = contourParcelle(parcelle, G, this.zRef, m.parcelle);
    this.couches = { terrain: sol, socle: base, bati, canopee, arbres, facades, tous, limite };
    for (const o of Object.values(this.couches)) if (o) this.groupe.add(o);
    if (tous) tous.visible = false;
    if (facades) facades.visible = false;
    // la canopée qui porte l'ombre des points est un peu abaissée : le haut des couronnes reste au soleil,
    // l'intérieur et le bas s'assombrissent
    canopee.position.y = -0.8;
    this.styleArbres();
    this.appliquerCoupe();
    this.appliquerTheme(this.T);
    if (this.typeFond !== "cadastre") this.fond(this.typeFond);
    this.controls.target.set(0, 0, 0);
    this.vueDepart();
    if (this.modeVue) { const m = this.modeVue; this.modeVue = null; this.avant3D = null; this.vueOrtho(m); }
    this.ombres();
  }

  /**
   * Arbres : les points du relevé laser (disques plats, sans halo), qui reçoivent les ombres ; la canopée invisible
   * porte leur ombre. Sans points (repli raster), des couronnes lissées.
   */
  styleArbres(visibles = this.arbresVisibles ?? true) {
    this.arbresVisibles = visibles;
    const c = this.couches, m = this.mat;
    if (!this.G) return;
    if (c.arbres) {
      c.arbres.visible = visibles;
      c.arbres.material.uniforms.relief.value = 0; // plus d'effet de petites boules
      c.arbres.material.uniforms.taille.value = 0.7;
      c.canopee.visible = visibles;
    } else {
      if (!c.couronnes) {
        this.arbresTeinte = this.T.arbres;
        const g = couronnes(this.G, this.zRef, this.T.arbres);
        if (g) { c.couronnes = new THREE.Mesh(g, m.couronne); c.couronnes.castShadow = c.couronnes.receiveShadow = true; this.groupe.add(c.couronnes); this.appliquerCoupe(); }
      }
      if (c.couronnes) c.couronnes.visible = visibles;
      c.canopee.visible = false;
    }
    m.canopee.colorWrite = m.canopee.depthWrite = false;
    m.canopee.needsUpdate = true;
    this.ombres();
  }

  /**
   * Comparaison avec les bâtiments 3D tout faits de swisstopo (swissBUILDINGS3D). `lieu` = { E, N } : centre MN95.
   * Ils portent et reçoivent les ombres comme les nôtres ; décocher « Bâtiments » pour ne voir qu'eux.
   */
  comparerSwiss(actif, lieu) {
    if (!this.swiss) {
      // même matière que nos bâtiments (couleur du terrain) ; coupés au bord du modèle et par la coupe A–B
      this.swiss = new Swiss3D(this, new THREE.MeshStandardMaterial({ color: this.T.sol, roughness: 0.92, side: THREE.DoubleSide }));
      grainPlatre(this.swiss.materiau, 0.07);
      this.appliquerCoupe();
    }
    if (lieu) this.swiss.lieu = lieu;
    this.swiss.montrer(!!actif && !!this.G);
    this.majBords();
    this.demander(5);
  }

  /** Couche de comparaison roofer (maillage préparé par roofer.js), ou null pour l'enlever. */
  afficherRoofer(m) {
    const vieux = this.couches.roofer;
    if (vieux) { this.groupe.remove(vieux); vieux.geometry.dispose(); }
    this.couches.roofer = m;
    if (m) { this.groupe.add(m); this.appliquerCoupe(); }
    this.majBords();
    this.ombres();
  }

  /**
   * Bord du socle : la face monte aussi jusqu'au toit des bâtiments de comparaison affichés (swisstopo, roofer)
   * qui traversent le bord, sinon on voit leur tranche creuse. Appelé (avec un délai) quand ils changent.
   */
  majBords() {
    clearTimeout(this.minuteBords);
    this.minuteBords = setTimeout(() => {
      const base = this.couches.socle;
      if (!base || !this.G) return;
      const objets = [this.swiss?.socle.visible ? this.swiss.socle : null, this.couches.roofer?.visible ? this.couches.roofer : null].filter(Boolean);
      // nos bâtiments masqués (autre jeu affiché) : le bord ne suit que celui qui est visible
      const releve = this.couches.bati?.visible !== false;
      base.geometry.dispose();
      base.geometry = socle(this.G, this.zRef, this.zBas, objets.length ? hauteursBords(this.G, this.zRef, objets) : null, releve);
      this.ombres();
    }, 400);
  }

  /** Limites et numéros des parcelles voisines (anneaux relatifs au centre), ou null pour les enlever. */
  /** Change la parcelle choisie sans recharger la maquette : nouvelle limite et nouvelle teinte de sélection. */
  changerParcelle(parcelle) {
    const vieux = this.couches.limite;
    if (vieux) { this.groupe.remove(vieux); this.liberer(vieux); }
    this.couches.limite = contourParcelle(parcelle, this.G, this.zRef, this.mat.parcelle);
    this.groupe.add(this.couches.limite);
    this.surligner(parcelle, null);
    this.appliquerCoupe();
    this.ombres();
  }

  /** Point du sol (ou d'un toit) sous le pointeur, en coordonnées relatives [x est, y nord], ou null. */
  pointSol(e) {
    const c = this.couches, cibles = [c.terrain, c.bati?.visible ? c.bati : null].filter(Boolean);
    const t = this.viser(e).intersectObjects(cibles, true)[0];
    return t ? [t.point.x, -t.point.z] : null;
  }

  afficherParcelles(voisines, visibles = true) {
    const vieux = this.couches.voisines;
    if (vieux) { this.groupe.remove(vieux); this.liberer(vieux); }
    this.couches.voisines = voisines?.length && this.G ? limitesVoisines(voisines, this.G, this.zRef, this.T.sombre ? "#c9d3e3" : "#4b4f57") : null;
    if (this.couches.voisines) { this.couches.voisines.visible = visibles; this.groupe.add(this.couches.voisines); }
    this.demander();
  }

  /* ------------------------------------------------------------------ mode pro : volumes */

  /** Index des volumes des bâtiments (calculé à la première demande). */
  indexer() { return this.volumes ||= indexVolumes(this.G, this.contoursTous); }

  /** Volume de nos bâtiments sous le pointeur (−1 : aucun, ou caché par le terrain ou la coupe). */
  designer(e) {
    const b = this.couches.bati;
    if (!b?.visible) return -1;
    for (const t of this.viser(e).intersectObjects([this.couches.terrain, ...b.children])) {
      if (this.coupe && this.plan.distanceToPoint(t.point) < 0) continue; // partie masquée par la coupe
      if (Math.max(Math.abs(t.point.x), Math.abs(t.point.z)) > this.G.R) continue;
      return t.object === this.couches.terrain ? -1 : t.object.geometry.userData.volumes[t.faceIndex >> 1];
    }
    return -1;
  }

  /** Surbrillance des volumes choisis (ensemble de numéros), ou rien. */
  surbrillance(ids) {
    const vieux = this.couches.selection;
    if (vieux) { this.groupe.remove(vieux); vieux.geometry.dispose(); vieux.material.dispose(); }
    this.couches.selection = null;
    if (ids?.size && this.couches.bati) {
      const pos = [];
      for (const m of this.couches.bati.children) {
        const g = m.geometry, P = g.attributes.position.array, I = g.index?.array, V = g.userData.volumes;
        for (let q = 0; q < V.length; q++) {
          if (!ids.has(V[q])) continue;
          for (let k = 6 * q; k < 6 * q + 6; k++) { const v = 3 * (I ? I[k] : k); pos.push(P[v], P[v + 1], P[v + 2]); }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const o = this.couches.selection = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: this.T.parcelle, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, fog: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }));
      o.renderOrder = 2;
      this.groupe.add(o);
    }
    this.appliquerCoupe();
    this.demander();
  }

  /**
   * Masque les volumes donnés (ensemble de numéros ; vide = tout réafficher), à l'écran et dans les calculs : leurs
   * cellules sortent de G.bat (le sol dessous est déjà rempli), la surface et la base sont recalculées, toits et murs
   * sont refaits sans eux. Les valeurs d'origine sont gardées pour la restauration.
   */
  masquer(masques) {
    const G = this.G, C = this.contoursTous, V = this.indexer();
    this.batOrigine ||= G.bat.slice();
    G.bat.set(this.batOrigine);
    const seg = masques.size ? C.seg.slice() : C.seg;
    for (const s of masques) for (const p of V.cellules[s]) { G.bat[p] = NaN; seg[p] = -1; }
    majSurface(G);
    this.contours = masques.size ? { ...C, seg, boucles: C.boucles.filter(B => !masques.has(B.seg)) } : C;
    const B = batiments(G, this.zRef, false, this.contours), [toits, murs] = this.couches.bati.children;
    toits.geometry.dispose(); murs.geometry.dispose();
    toits.geometry = B.toits; murs.geometry = B.murs;
    this.grillesContact(G); // l'ombre de contact au pied des bâtiments disparaît avec eux
    this.majBords();
    this.ombres();
  }

  /** Couronnes à refaire (couleurs du thème changées). */
  refaireCouronnes() {
    const o = this.couches.couronnes;
    if (o) { this.groupe.remove(o); o.geometry.dispose(); this.couches.couronnes = null; }
    this.styleArbres();
  }

  /**
   * Sélection mise en évidence par une teinte légère : la parcelle (anneaux relatifs) au sol, et les bâtiments
   * de l'adresse (bâtiment sous le point, ou le plus proche à 6 m) ou, pour une parcelle, ceux qui sont dessus.
   */
  surligner(parcelle, point) {
    const G = this.G, { n, c, x0, bat } = G, sel = new Float32Array(n * n * 2);
    const dans = (x, y, anneaux) => {
      let ok = false;
      for (const a of anneaux) for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
        const [xi, yi] = a[i], [xj, yj] = a[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ok = !ok;
      }
      return ok;
    };
    const anneaux = parcelle?.anneauxRel || [];
    // bâtiments : composante connexe sous le point de l'adresse, sinon cellules « bâtiment » dans la parcelle
    const graines = [];
    if (point) {
      let meilleur = -1, dmin = 6 / c;
      const i0 = Math.floor((point[0] - x0) / c), j0 = Math.floor((point[1] - x0) / c), r = Math.ceil(dmin);
      for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= n || j >= n || isNaN(bat[j * n + i])) continue;
        const d = Math.hypot(i - i0, j - j0);
        if (d < dmin) { dmin = d; meilleur = j * n + i; }
      }
      if (meilleur >= 0) graines.push(meilleur);
    }
    const vu = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = j * n + i, x = x0 + (i + 0.5) * c, y = x0 + (j + 0.5) * c;
      if (anneaux.length && dans(x, y, anneaux)) {
        sel[2 * p] = 1;
        if (!point && !isNaN(bat[p])) graines.push(p);
      }
    }
    // point de l'adresse hors de la parcelle (entrée côté rue) : on part des bâtiments de la parcelle
    if (point && anneaux.length && graines.length && !sel[2 * graines[0]])
      for (let p = 0; p < n * n; p++) if (sel[2 * p] && !isNaN(bat[p])) graines.push(p);
    const pile = [...graines];
    for (const p of pile) vu[p] = 1;
    while (pile.length) {
      const p = pile.pop(), i = p % n;
      sel[2 * p + 1] = 1;
      for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
        // maisons mitoyennes : le bloc bâti peut couvrir plusieurs parcelles, on s'arrête à la parcelle choisie
        if (q >= 0 && q < n * n && !vu[q] && !isNaN(bat[q]) && (!anneaux.length || sel[2 * q])) { vu[q] = 1; pile.push(q); }
    }
    // un peu élargi : les murs, posés au bord des cellules, doivent lire la sélection
    const bord = sel.slice();
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const p = j * n + i;
      if (bord[2 * p + 1]) continue;
      if (bord[2 * (p - 1) + 1] || bord[2 * (p + 1) + 1] || bord[2 * (p - n) + 1] || bord[2 * (p + n) + 1]) sel[2 * p + 1] = 1;
    }
    const h = new Uint16Array(sel.length);
    for (let k = 0; k < sel.length; k++) h[k] = THREE.DataUtils.toHalfFloat(sel[k]);
    const t = new THREE.DataTexture(h, n, n, THREE.RGFormat, THREE.HalfFloatType);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    CONTACT.tSel.value?.dispose();
    CONTACT.tSel.value = t;
    this.demander();
  }

  /** Textures de l'ombre de contact : altitude du sol (relative) et distance au bâtiment le plus proche (m, plafonnée). */
  grillesContact(G) {
    const { n, c, sol, bat } = G, alt = new Float32Array(n * n), dist = new Float32Array(n * n);
    for (let p = 0; p < n * n; p++) { alt[p] = sol[p] - this.zRef; dist[p] = isNaN(bat[p]) ? 1e3 : 0; }
    // distance de chanfrein (deux passes), en mètres
    const passe = (sens) => {
      const d0 = sens > 0 ? 0 : n - 1, d1 = sens > 0 ? n : -1;
      for (let j = d0; j !== d1; j += sens) for (let i = d0; i !== d1; i += sens) {
        const p = j * n + i;
        let d = dist[p];
        for (const [a, b, w] of [[-sens, 0, c], [0, -sens, c], [-sens, -sens, c * 1.414], [sens, -sens, c * 1.414]]) {
          const x = i + a, y = j + b;
          if (x >= 0 && y >= 0 && x < n && y < n) d = Math.min(d, dist[y * n + x] + w);
        }
        dist[p] = d;
      }
    };
    passe(1); passe(-1);
    for (let p = 0; p < n * n; p++) dist[p] = Math.min(dist[p], 10);
    // demi-précision : le filtrage linéaire est garanti partout en WebGL2 (Safari compris), pas celui des flottants 32 bits
    const tex = a => {
      const h = new Uint16Array(a.length);
      for (let p = 0; p < a.length; p++) h[p] = THREE.DataUtils.toHalfFloat(a[p]);
      const t = new THREE.DataTexture(h, n, n, THREE.RedFormat, THREE.HalfFloatType);
      t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
      return t;
    };
    CONTACT.tSol.value?.dispose(); CONTACT.tDist.value?.dispose();
    CONTACT.tSol.value = tex(alt); CONTACT.tDist.value = tex(dist);
    CONTACT.grille.value.set(G.x0, n * c, 0);
    CONTACT.contactActif.value = 1;
  }

  /**
   * Caméra de départ, en oblique vers le centre ; relevée si le relief, les arbres ou les bâtiments autour d'elle
   * ou sur sa ligne de visée la dépassent (pente, grand arbre) : on ne doit jamais arriver dans la canopée.
   */
  /**
   * Vues orthogonales : "plan" (de dessus, nord en haut) ou élévation depuis "N", "S", "E", "O" ; null = retour à la 3D.
   * Quasiment sans perspective : caméra très éloignée à focale très longue (les passes de rendu restent les mêmes).
   * Rotation bloquée ; déplacement et zoom libres.
   */
  vueOrtho(mode) {
    const cam = this.camera, ctl = this.controls;
    if ((mode || null) === (this.modeVue || null)) return;
    if (mode && !this.modeVue) this.avant3D = { pos: cam.position.clone(), cible: ctl.target.clone(), fov: cam.fov };
    this.modeVue = mode || null;
    if (mode) {
      const R = this.G?.R || 150, fov = 3, h = R * 1.25 / Math.tan(fov * Math.PI / 360);
      cam.fov = fov; cam.far = h * 3; cam.near = h * 0.2;
      ctl.enableRotate = false; ctl.screenSpacePanning = true; ctl.minDistance = h * 0.05; ctl.maxDistance = h * 2;
      if (mode === "plan") {
        ctl.target.set(ctl.target.x, 0, ctl.target.z);
        cam.position.set(ctl.target.x, h, ctl.target.z + 0.001);
        ctl.minPolarAngle = ctl.maxPolarAngle = 0;
      } else {
        // élévation : caméra du côté choisi, à hauteur des bâtiments, regard horizontal
        const [dx, dz] = { N: [0, -1], S: [0, 1], E: [1, 0], O: [-1, 0] }[mode];
        ctl.target.set(0, 8, 0);
        cam.position.set(dx * h, 8, dz * h);
        ctl.minPolarAngle = ctl.maxPolarAngle = Math.PI / 2;
      }
      this.scene.fog.density = 0; // à cette distance, la brume masquerait tout
    } else {
      const a = this.avant3D;
      cam.fov = a?.fov || 45; cam.near = 0.5; cam.far = 20000;
      ctl.enableRotate = true; ctl.minPolarAngle = 0; ctl.maxPolarAngle = Math.PI * 0.495;
      ctl.minDistance = 0; ctl.maxDistance = Infinity;
      this.scene.fog.density = this.T.lumiere.brume;
      if (a) { cam.position.copy(a.pos); ctl.target.copy(a.cible); } else this.vueDepart();
    }
    cam.updateProjectionMatrix();
    ctl.update();
    this.surVue?.(this.modeVue);
    this.demander(5);
  }

  vueDepart() {
    const p = new THREE.Vector3(-110, 120, 150), G = this.G;
    if (G) {
      let haut = -Infinity;
      for (let t = 0.15; t <= 1; t += 0.05) { // le long de la visée, du centre vers la caméra
        const x = p.x * t, y = -p.z * t, i = Math.floor((x - G.x0) / G.c), j = Math.floor((y - G.x0) / G.c);
        for (let dj = -8; dj <= 8; dj += 4) for (let di = -8; di <= 8; di += 4) {
          const a = i + di, b = j + dj;
          if (a >= 0 && b >= 0 && a < G.n && b < G.n) haut = Math.max(haut, (G.surface[b * G.n + a] - this.zRef) - p.y * t);
        }
      }
      if (haut > -20) p.y += haut + 20; // au moins 20 m de dégagement au-dessus de la visée
    }
    this.camera.position.copy(p);
  }

  /** Les ombres portées sont à recalculer (soleil déplacé, couche affichée ou masquée). */
  ombres() { this.renderer.shadowMap.needsUpdate = true; this.demander(); }

  /** Fond de plan du terrain : "cadastre" (reteinté selon le thème) ou "uni". */
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
    // couleur réelle du soleil selon sa hauteur : plus il est bas, plus sa lumière traverse d'atmosphère (le bleu est
    // diffusé, il reste le jaune puis l'orangé) et plus elle faiblit ; en hiver le soleil reste bas toute la journée
    const h = Math.asin(Math.max(-1, Math.min(1, dir[1]))) * 180 / Math.PI, bas = visible ? 1 - Math.min(1, Math.max(0, h / 15)) : 0;
    this.soleil.color.copy(couleurSoleil(h)).lerp(new THREE.Color(T.lumiere.soleil), Math.min(1, Math.max(0, (h - 25) / 20)));
    this.soleil.intensity = visible ? 2.6 * (0.35 + 0.65 * (1 - Math.exp(-Math.max(0, h) / 6))) : 0;
    this.ciel.intensity = visible ? 1.1 : Math.max(0.35, 0.9 * Math.min(1, (dir[1] + 0.1) * 4));
    // soleil bas : les ombres prennent un peu le bleu du ciel
    this.ciel.color.set(T.lumiere.ciel).lerp(new THREE.Color("#c6d6f2"), 0.3 * bas);
    this.disque.material.color.copy(couleurSoleil(h + 2)).multiplyScalar(1.1);
    this.disque.position.copy(d.clone().multiplyScalar(1200));
    this.disque.visible = dir[1] > -0.02 && !!this.G;
    // ciel : jour, soleil caché par le relief (plus terne), nuit
    const jour = visible ? 1 : dir[1] > 0 ? 0.72 : Math.max(0, Math.min(0.5, 0.5 + dir[1] * 4));
    u.zenith.value.set(T.ciel.nuitZenith).lerp(new THREE.Color(T.ciel.zenith), jour);
    u.horizon.value.set(T.ciel.nuitHorizon).lerp(new THREE.Color(T.ciel.horizon), jour).lerp(couleurSoleil(h).lerp(new THREE.Color("#f3c9a2"), 0.4), 0.55 * bas);
    u.soleil.value.copy(d).normalize();
    u.force.value = visible ? 1 : 0;
    this.scene.fog.color.copy(u.horizon.value);
    // les points ne sont pas éclairés par three.js : leur luminosité suit la lumière présente (ciel + soleil), rapportée
    // à celle d'un jour clair, comme pour les surfaces ; à l'ombre, ils ne gardent que la part du ciel
    const k = 0.55, jourClair = 1.1 + 2.6 * k, total = this.ciel.intensity + this.soleil.intensity * k;
    for (const c of ["arbres", "facades", "tous"]) {
      const u = this.couches[c]?.material.uniforms;
      const f = Math.min(1, total / jourClair);
      if (u) { u.lum.value = Math.max(0.04, f ** 1.5); u.gris.value = 0.7 * (1 - f) ** 2; u.ombre.value = visible ? this.ciel.intensity / total : 1; }
    }
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
    // bâtiments swisstopo : chargés par tuiles bien au-delà du modèle, on les coupe aux bords du terrain
    // (et l'occlusion ambiante ne doit pas voir la partie coupée)
    if (this.G) {
      const R = this.G.R, boite = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(n => new THREE.Plane(new THREE.Vector3(...n), R));
      const avecBoite = [...boite, ...(plans || [])];
      if (this.ao.normalMaterial) { this.ao.normalMaterial.clippingPlanes = avecBoite; this.ao.normalMaterial.needsUpdate = true; }
      // nos bâtiments (et roofer) : coupés 3 cm en retrait du bord, sinon les murs du bord sont dans le plan de la face
      // du socle et leur partie enterrée apparaît en stries à travers elle
      const dedans = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(n => new THREE.Plane(new THREE.Vector3(...n), R - 0.03));
      for (const x of [m.toit, m.mur, c.roofer?.material, this.swiss?.materiau]) if (x) { x.clippingPlanes = [...dedans, ...(plans || [])]; x.needsUpdate = true; }
    }
    const cibles = [m.terrain, m.socle, m.canopee, m.couronne, m.parcelle];
    for (const k of ["arbres", "facades", "tous"]) if (c[k]) cibles.push(c[k].material);
    c.heures?.traverse(o => o.material && cibles.push(o.material));
    if (c.selection) cibles.push(c.selection.material);
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
      if (!appui || Math.hypot(e.clientX - appui[0], e.clientY - appui[1]) > 5) return;
      if (!this.trace) { if (e.button === 0) this.surClic?.(e); return; } // simple clic : sélection (mode pro)
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
