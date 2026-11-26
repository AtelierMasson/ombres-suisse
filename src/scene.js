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
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { solEn, majSurface } from "./grille.js";
import { indexVolumes } from "./volumes.js";
import { terrain, socle, canopee as nappeCanopee, batiments, nuagePoints, contourParcelle, couronnes, pointsVegetation, hauteursBords, hauteursDessus, limitesVoisines, DEGRADE, RAMPE_GLSL, plansEau, decouperBord } from "./maillages.js";
import { chargerImage, teinterCadastre } from "./fond.js";
import { trancheCoupe } from "./coupe.js";
import { materiauLointain } from "./lointain.js";
import { TuilesPlan } from "./plan.js";

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
    Object.assign(sh.uniforms, CONTACT, DEGRADE);
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
${RAMPE_GLSL}
float hachage(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bruit3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hachage(i), hachage(i + vec3(1, 0, 0)), f.x), mix(hachage(i + vec3(0, 1, 0)), hachage(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hachage(i + vec3(0, 0, 1)), hachage(i + vec3(1, 0, 1)), f.x), mix(hachage(i + vec3(0, 1, 1)), hachage(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
if (degrade > 0.5) diffuseColor.rgb = rampeHaut(vMonde.y); // dégradé selon la hauteur (le grain reste)
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
  mat.userData.platre = true;
}

// Couleur de la lumière directe du soleil selon sa hauteur (degrés), après la traversée de l'atmosphère
/** Calque vu du seul soleil : objets qui portent leur ombre sans être dessinés. */
const CALQUE_OMBRE = 2;

const TEINTES_SOLEIL = [[0, "#ff3d2e"], [1, "#ff4f35"], [3, "#ff6c40"], [6, "#ff8b4e"], [10, "#ffad6c"], [16, "#ffc993"], [25, "#ffe2bf"], [45, "#fff4e6"]]
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
    this.controls.addEventListener("change", () => { if (this.modeVue) this.plansCamera(); this.demander(3); });
    r.domElement.addEventListener("wheel", () => this.demander(40), { passive: true });

    // lumières : ciel (hémisphère) et soleil (ombres portées)
    this.ciel = new THREE.HemisphereLight("#ffffff", "#8a8f7a", 1.1);
    const s = this.soleil = new THREE.DirectionalLight("#fff6e0", 2.6);
    s.castShadow = true;
    s.shadow.camera.layers.enable(CALQUE_OMBRE);
    this.calques = { jeu: "releve", batVoir: true, batOmbre: true, arbVoir: true, arbOmbre: true };
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
    // paysage (relief jusqu'à 50 km) : dans la scène, pour que paysage et maquette se cachent l'un l'autre ; le plan
    // lointain de la caméra s'étend alors à 150 km (la précision de profondeur dépend surtout du plan proche)
    this.loin = { mat: materiauLointain(), maille: null, voir: true, brume: true };
    // plan cadastral en tuiles autour de la maquette, chargées au fil des déplacements
    this.tuilesPlan = new TuilesPlan(this);
    {
      const u = this.loin.mat.uniforms, [p, l] = this.tuilesPlan.textures, [cp, cl] = this.tuilesPlan.centres;
      u.tPlanP.value = p; u.tPlanL.value = l; u.cPlanP.value = cp; u.cPlanL.value = cl;
    }
    this.controls.addEventListener("change", () => this.tuilesPlan.demander());
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
      eau: new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -1 }),
    };
    // même grain léger partout (sol, socle, toits, murs, couronnes) : aspect de maquette en plâtre
    for (const [k, force, contact] of [["terrain", 0.07, "sol"], ["socle", 0.07], ["toit", 0.07, "toit"], ["mur", 0.07, "mur"], ["couronne", 0.05], ["eau", 0.025]]) grainPlatre(this.mat[k], force, contact);
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
      const c = this.couches, caches = [this.voute, this.disque, ...this.poignees, c.heures, c.limite, c.voisines, c.arbres, c.tous, c.selection,
        this.coupe ? this.tranche?.userData.arbres : null, ...(this.coupe && this.tranche?.userData.traits || []),
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

  /** Relief lointain calculé (géométrie de reliefLointain) ; ignoré si la scène a changé entre-temps. */
  afficherLointain(g, idScene, origine) {
    if (idScene !== this.idScene) { g.dispose(); return; }
    const L = this.loin;
    L.maille = new THREE.Mesh(g, L.mat);
    L.maille.frustumCulled = false;
    L.maille.receiveShadow = true; // l'ombre de la maquette déborde sur le paysage
    this.scene.add(L.maille);
    this.scene.fog.density = this.densiteBrume();
    this.majLointain();
    this.demander();
  }

  /** Relief lointain visible ou non, brume avec la distance ou non (maquette et paysage). */
  reglerLointain({ voir = this.loin.voir, brume = this.loin.brume } = {}) {
    Object.assign(this.loin, { voir, brume });
    this.scene.fog.density = this.densiteBrume();
    this.majLointain();
    if (this.etatSoleil) this.placerSoleil(...this.etatSoleil);
    this.demander();
  }

  /**
   * Densité de la brume, la même pour la maquette et le paysage : avec le paysage, une brume légère qui estompe les
   * montagnes lointaines sans blanchir la maquette ; sans paysage, celle du thème (la maquette se fond dans le ciel).
   */
  densiteBrume() {
    if (this.modeVue || !this.loin.brume) return 0;
    return this.loin.maille && this.loin.voir ? 2.2e-5 : this.T.lumiere.brume;
  }

  /** Couleurs et lumière du relief lointain, celles de la maquette (thème, soleil, ciel). */
  majLointain() {
    const u = this.loin.mat.uniforms;
    u.sol.value.set(this.T.sol);
    u.lac.value.set(this.T.plan.eau); // lacs légèrement bleus, du même bleu que l'eau du plan cadastral
  }


  rendre() {
    if (this.coupe) this.orienterCoupe();
    const L = this.loin, enPlan = this.modeVue === "plan";
    if (L.maille) L.maille.visible = L.voir && (!this.modeVue || enPlan);
    // plan en tuiles : avec le plan cadastral, en 3D avec le paysage, et toujours en vue plan
    const tuiles = this.typeFond === "cadastre" && !!L.maille && L.maille.visible;
    if (tuiles !== this.tuilesPlan.actif) { this.tuilesPlan.actif = tuiles; if (tuiles) this.tuilesPlan.demander(); }
    L.mat.uniforms.planActif.value = tuiles ? 1 : 0;
    if (tuiles) this.tuilesPlan.peindre(this.renderer);
    if (!this.modeVue) {
      // avec le paysage : plan lointain à 150 km, plan proche reculé avec la distance (précision au loin), ciel centré
      // sur la caméra (la voûte de 9 km ne doit pas être quittée en dézoomant)
      const cam = this.camera, avecLoin = !!(L.maille && L.voir);
      const far = avecLoin ? 150000 : 20000, near = avecLoin ? Math.min(20, Math.max(0.5, cam.position.distanceTo(this.controls.target) * 0.003)) : 0.5;
      if (cam.far !== far || Math.abs(cam.near - near) > 0.05 * near) { cam.far = far; cam.near = near; cam.updateProjectionMatrix(); }
      this.voute.position.copy(avecLoin ? cam.position : new THREE.Vector3());
    }
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
    m.eau.color.set(T.eau || (T.sombre ? "#36536e" : "#a7c6d6"));
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
    this.scene.fog.density = this.densiteBrume();
    this.couleursPoints();
    if (this.G && this.arbresTeinte && this.T.arbres !== this.arbresTeinte) this.refaireCouronnes();
    if (this.etatSoleil) this.placerSoleil(...this.etatSoleil);
    if (this.typeFond === "cadastre" && this.urls) this.fond("cadastre");
    this.demander();
  }

  couleursPoints() {
    const c = this.couches, T = this.T;
    if (c.arbres) ["c1", "c2", "c3"].forEach((u, k) => c.arbres.material.uniforms[u].value.set(T.arbres[k]));
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
    // la teinte de sélection du lieu précédent (grille d'une autre taille) ne doit pas déteindre sur le suivant, ni sur l'accueil
    CONTACT.tSel.value?.dispose(); CONTACT.tSel.value = null;
    this.contoursTous = this.volumes = this.batOrigine = this.nuage = this.grilleComp = null;
    if (this.loin.maille) { this.scene.remove(this.loin.maille); this.loin.maille.geometry.dispose(); this.loin.maille = null; }
    this.tuilesPlan.vider();
    this.idScene++;
  }

  /** Construit la scène depuis les grilles. `urls` = { cadastre } (image du plan cadastral) ou null. */
  construire(G, nuage, parcelle, urls) {
    this.vider();
    this.G = G;
    // le nuage est gardé (tableaux typés X, Y, Z, C) : nuage brut construit à la demande, points proches de la coupe
    this.nuage = nuage;
    this.urls = urls;
    this.zRef = solEn(G, 0, 0);
    const s = this.soleil.shadow.camera, R = G.R * 1.45;
    Object.assign(s, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 3000 });
    s.updateProjectionMatrix();
    let zmin = Infinity;
    for (let p = 0; p < G.sol.length; p++) if (G.sol[p] < zmin) zmin = G.sol[p];
    this.zBas = zmin - this.zRef - Math.max(6, G.R * 0.05);
    this.grillesContact(G);
    // dégradé selon la hauteur : du point le plus bas du terrain au haut des bâtiments et des arbres (sans les
    // quelques points les plus hauts : grues, antennes)
    {
      const hs = [];
      for (let p = 0; p < G.sol.length; p += 7) { const h = Math.max(G.sol[p], G.bat[p] || -1e9, G.veg[p] || -1e9); if (h > -1e8) hs.push(h); }
      hs.sort((a, b) => a - b);
      DEGRADE.zBas.value = zmin - this.zRef;
      DEGRADE.zHaut.value = (hs[Math.floor(hs.length * 0.998)] ?? zmin + 30) - this.zRef;
    }

    const m = this.mat, maille = (g, mat, porte, recoit) => { const o = new THREE.Mesh(g, mat); o.castShadow = porte; o.receiveShadow = recoit; return o; };
    const sol = maille(terrain(G, this.zRef), m.terrain, false, true);
    const base = maille(socle(G, this.zRef, this.zBas), m.socle, false, false);
    const B = batiments(G, this.zRef), bati = new THREE.Group();
    bati.add(maille(B.toits, m.toit, true, true), maille(B.murs, m.mur, true, true));
    bati.children.forEach(o => decouperBord(o, G.R - 0.03));
    this.contours = this.contoursTous = B.contours;
    // la canopée (grille) porte l'ombre des points ; sans points, styleArbres() construit des couronnes lissées
    const canopee = maille(nappeCanopee(G, this.zRef), m.canopee, true, false);
    // arbres toujours en points : sans relevé classé (repli raster), points tirés de la grille de végétation
    const arbres = nuage ? nuagePoints(nuage, G, this.zRef, "arbres", 0.5, 0.9) : nuagePoints(pointsVegetation(G), G, this.zRef, "arbres", 1, 0.9);
    const limite = contourParcelle(parcelle, G, this.zRef, m.parcelle);
    // lacs et étangs : un vrai plan, au niveau de l'eau
    const ge = plansEau(G, this.zRef), eau = ge ? maille(ge, m.eau, false, true) : null;
    this.couches = { terrain: sol, socle: base, bati, canopee, arbres, limite, eau };
    for (const o of Object.values(this.couches)) if (o) this.groupe.add(o);
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
   * Nuage de points brut (couleur par classe) : construit à la première demande seulement, à partir du nuage gardé.
   * Quand les arbres sont affichés, sa végétation (rangée à la fin) n'est pas dessinée : elle ferait double emploi.
   */
  voirPoints(actif) {
    const c = this.couches;
    if (actif && !c.tous && this.nuage && this.G) {
      c.tous = nuagePoints(this.nuage, this.G, this.zRef, "tous", 0.35, 0.45);
      if (c.tous) {
        this.groupe.add(c.tous);
        this.appliquerCoupe();
        if (this.etatSoleil) this.placerSoleil(...this.etatSoleil); // luminosité des points selon le soleil
      }
    }
    if (!c.tous) return;
    c.tous.visible = !!actif;
    if (actif) this.couleursPoints(this.couleursReelles);
    const g = c.tous.geometry;
    g.setDrawRange(0, this.arbresVisibles !== false && c.arbres ? g.userData.autres : Infinity);
    this.demander();
  }

  /**
   * Couleurs du nuage brut : par classe, ou « réelles », prises sur l'orthophoto SWISSIMAGE à la verticale de chaque
   * point (toits, sol et arbres justes ; les façades, vues seulement d'en haut, prennent la couleur voisine).
   */
  async couleursPoints(reelles) {
    this.couleursReelles = !!reelles;
    const pts = this.couches.tous, id = this.idScene;
    if (!pts) return;
    const g = pts.geometry, attr = g.getAttribute("aCouleur");
    g.userData.classes ||= attr.array.slice();
    if (!reelles) { attr.array.set(g.userData.classes); attr.needsUpdate = true; this.demander(); return; }
    if (!g.userData.reelles) {
      if (!this.urls?.ortho) return;
      g.userData.reelles = (async () => {
        const img = await chargerImage(this.urls.ortho), cv = document.createElement("canvas");
        const w = cv.width = img.naturalWidth, h = cv.height = img.naturalHeight, ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, w, h).data, pos = g.getAttribute("position").array, R = this.G.R, out = new Uint8Array(attr.array.length);
        for (let q = 0; q < out.length / 3; q++) {
          const x = pos[3 * q], y = -pos[3 * q + 2];
          const i = Math.min(w - 1, Math.max(0, Math.floor((x + R) / (2 * R) * w))), j = Math.min(h - 1, Math.max(0, Math.floor((R - y) / (2 * R) * h)));
          const p = 4 * (j * w + i);
          out[3 * q] = d[p]; out[3 * q + 1] = d[p + 1]; out[3 * q + 2] = d[p + 2];
        }
        return out;
      })();
    }
    try {
      const reel = await g.userData.reelles;
      if (id !== this.idScene || !this.couleursReelles || this.couches.tous !== pts) return;
      attr.array.set(reel); attr.needsUpdate = true; this.demander();
    } catch (e) { g.userData.reelles = null; console.warn("Orthophoto :", e.message); }
  }

  /**
   * Arbres : les points du relevé laser (disques plats, sans halo), qui reçoivent les ombres ; la canopée invisible
   * porte leur ombre. Sans points (repli raster), des couronnes lissées.
   */
  styleArbres(visibles = this.arbresVisibles ?? true) {
    this.arbresVisibles = this.calques.arbVoir = visibles;
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
    if (c.tous) this.voirPoints(c.tous.visible);
    if (this.coupe && this.tranche?.userData.arbres) this.tranche.userData.arbres.visible = visibles;
    this.appliquerCalques();
    this.ombres();
  }

  /** Dégradé de couleur selon la hauteur, sur tout le modèle. */
  degradeHauteur(actif) {
    DEGRADE.degrade.value = actif ? 1 : 0;
    this.demander(3);
  }

  /** Réglages d'affichage : { jeu (releve, swiss, roofer, aucun), batVoir, batOmbre, arbOmbre } (arbres : styleArbres). */
  reglerCalques(reglages) {
    Object.assign(this.calques, reglages);
    this.appliquerCalques();
    this.majBords();
    this.ombres();
  }

  /**
   * Bâtiments et arbres visibles ou non, portant leur ombre ou non. « Ombre seule » : l'objet passe sur un calque que
   * seul le soleil voit (il porte son ombre sans être dessiné, ni pris par l'occlusion, ni cliquable).
   */
  appliquerCalques() {
    const k = this.calques, c = this.couches || {};
    const regler = (o, voir, ombre) => {
      if (!o) return;
      o.visible = voir || ombre;
      o.traverse(m => { m.layers.set(voir ? 0 : CALQUE_OMBRE); if (m.isMesh) m.castShadow = ombre; });
    };
    const jeux = { releve: c.bati, swiss: this.swiss?.socle, roofer: c.roofer };
    for (const [j, o] of Object.entries(jeux)) regler(o, j === k.jeu && k.batVoir, j === k.jeu && k.batOmbre);
    // arbres : les points se montrent ; la canopée (invisible) ou, en repli, les couronnes portent l'ombre
    if (c.arbres) regler(c.canopee, k.arbVoir && k.arbOmbre, k.arbOmbre);
    regler(c.couronnes, k.arbVoir, k.arbOmbre);
    this.demander();
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
    this.appliquerCalques();
    this.majBords();
    this.demander(5);
  }

  /** Couche de comparaison roofer (maillage préparé par roofer.js), ou null pour l'enlever. */
  afficherRoofer(m) {
    const vieux = this.couches.roofer;
    if (vieux) { this.groupe.remove(vieux); vieux.geometry.dispose(); }
    this.couches.roofer = m;
    if (m) {
      if (!m.material.userData.platre) { grainPlatre(m.material, 0.07); m.material.needsUpdate = true; }
      this.groupe.add(m); this.appliquerCoupe();
    }
    this.appliquerCalques();
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
      // le bord ne suit que le jeu de bâtiments affiché (pas celui dont on ne montre que l'ombre)
      const k = this.calques, voir = k.batVoir;
      const objets = voir ? [k.jeu === "swiss" ? this.swiss?.socle : null, k.jeu === "roofer" ? this.couches.roofer : null].filter(Boolean) : [];
      const releve = voir && k.jeu === "releve";
      // swisstopo et roofer : géométrie coupée 3 cm en retrait du bord, à leur position calée du moment
      for (const o of [this.swiss?.socle, this.couches.roofer]) o?.traverse(m => m.isMesh && decouperBord(m, this.G.R - 0.03));
      base.geometry.dispose();
      base.geometry = socle(this.G, this.zRef, this.zBas, objets.length ? hauteursBords(this.G, this.zRef, objets) : null, releve);
      this.grilleComp = null; // la coupe relira les bâtiments affichés
      this.surBatiments?.();
      this.ombres();
    }, 400);
  }

  /**
   * Hauteurs (absolues, grille alignée sur G) des bâtiments de comparaison affichés, vus de dessus : `jeu` = "swiss"
   * (tuiles chargées, à leur position calée) ou "roofer". Gardée jusqu'au prochain changement (majBords).
   */
  grilleComparaison(jeu) {
    if (this.grilleComp?.jeu !== jeu) {
      const o = jeu === "swiss" ? this.swiss?.socle : this.couches.roofer;
      this.grilleComp = { jeu, h: o && this.G ? hauteursDessus(this.G, this.zRef, [o]) : null };
    }
    return this.grilleComp.h;
  }

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

  /** Point (x est, y nord, relatifs) visé hors de la maquette : plan en tuiles ou paysage. */
  pointLointain(e) {
    const cibles = [this.loin.maille?.visible ? this.loin.maille : null].filter(Boolean);
    const t = this.viser(e).intersectObjects(cibles, false)[0];
    return t ? [t.point.x, -t.point.z] : null;
  }

  /**
   * Sortie de la vue plan ou d'une élévation vers la 3D, sur place : même point visé, même direction de regard, même
   * largeur vue (Maj + glisser, comme dans la plupart des logiciels 3D) ; la rotation continue avec le même geste.
   */
  libererVue() {
    if (!this.modeVue) return;
    const cam = this.camera, ctl = this.controls, dir = cam.position.clone().sub(ctl.target), d = dir.length();
    const large = 2 * d * Math.tan(cam.fov * Math.PI / 360), d3 = Math.min(30000, Math.max(30, large / (2 * Math.tan(22.5 * Math.PI / 180))));
    this.avant3D = { pos: ctl.target.clone().add(dir.normalize().multiplyScalar(d3)), cible: ctl.target.clone(), fov: 45 };
    this.vueOrtho(null);
  }

  /** Recentre la vue sur l'adresse (vue plan : même zoom, maquette au centre ; 3D : vue de départ). */
  revenir() {
    const ctl = this.controls, cam = this.camera;
    if (this.modeVue) { cam.position.x -= ctl.target.x; cam.position.z -= ctl.target.z; ctl.target.x = ctl.target.z = 0; }
    else { ctl.target.set(0, 0, 0); this.vueDepart(); }
    ctl.update();
    this.demander(5);
  }

  afficherParcelles(voisines, visibles = true) {
    const vieux = this.couches.voisines;
    if (vieux) { this.groupe.remove(vieux); this.liberer(vieux); }
    this.couches.voisines = voisines?.length && this.G ? limitesVoisines(voisines, this.G, this.zRef, this.T.sombre ? "#c9d3e3" : "#4b4f57") : null;
    if (this.couches.voisines) { this.couches.voisines.visible = visibles; this.groupe.add(this.couches.voisines); this.appliquerCoupe(); }
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
    for (const o of [toits, murs]) { o.geometry.dispose(); o.userData.geomOrig?.dispose(); delete o.userData.geomOrig; delete o.userData.cleDecoupe; }
    toits.geometry = B.toits; murs.geometry = B.murs;
    decouperBord(toits, G.R - 0.03); decouperBord(murs, G.R - 0.03);
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
    // un bâtiment qui dépasse un peu de sa parcelle est pris en entier : tout bâtiment (contour vectorisé) dont la
    // moitié au moins est dans la parcelle, ou qui porte le point de l'adresse
    const seg = this.contours?.seg;
    if (seg && anneaux.length) {
      const total = new Map(), dedans = new Map(), entiers = new Set();
      for (let p = 0; p < n * n; p++) {
        const s = seg[p];
        if (s < 0 || isNaN(bat[p])) continue;
        total.set(s, (total.get(s) || 0) + 1);
        if (sel[2 * p]) dedans.set(s, (dedans.get(s) || 0) + 1);
      }
      for (const [s, t] of total) if ((dedans.get(s) || 0) >= 0.5 * t) entiers.add(s);
      if (point && graines.length && seg[graines[0]] >= 0) entiers.add(seg[graines[0]]);
      // un bâtiment qui appartient à une autre parcelle n'est pas teint, même s'il déborde un peu sur celle-ci (avant-toit
      // sur la route, mur mitoyen). Seule exception : parcelle sans bâtiment à elle, dans un bloc mitoyen dont elle
      // porte une part nette (au moins 15 % du bloc et 20 m²) : on teint cette part seulement.
      const partiels = new Set();
      if (!entiers.size) for (const [s, t] of total) { const d = dedans.get(s) || 0; if (d >= 0.15 * t && d * c * c >= 20) partiels.add(s); }
      for (let p = 0; p < n * n; p++) {
        if (isNaN(bat[p])) continue;
        const s = seg[p];
        sel[2 * p + 1] = entiers.has(s) || (partiels.has(s) && sel[2 * p]) ? 1 : 0;
      }
    }
    // élargi de 1,5 m, seulement hors des bâtiments : les murs (posés au bord des cellules) et les façades en retrait
    // (loggias, retraits, avant-toits) lisent la sélection en entier, sans taches ; les bâtiments voisins ne sont pas teints
    for (let passe = 0; passe < 3; passe++) {
      const bord = sel.slice();
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const p = j * n + i;
        if (bord[2 * p + 1] || !isNaN(bat[p])) continue;
        if (bord[2 * (p - 1) + 1] || bord[2 * (p + 1) + 1] || bord[2 * (p - n) + 1] || bord[2 * (p + n) + 1]) sel[2 * p + 1] = 1;
      }
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
  /** Vues plan et élévation : la caméra est loin, les plans proche et lointain encadrent juste la maquette. */
  plansCamera() {
    // en vue plan, le paysage et le plan en tuiles autour (relief compris) restent dans le champ
    const autour = this.modeVue === "plan" && (this.loin.maille || this.tuilesPlan.lieu) ? 6000 : 0;
    const cam = this.camera, d = cam.position.distanceTo(this.controls.target), marge = 2 * (this.G?.R || 150) + 200 + autour;
    const near = Math.max(0.5, d - marge), far = d + marge;
    if (Math.abs(cam.near - near) > 0.01 * near || Math.abs(cam.far - far) > 1) { cam.near = near; cam.far = far; cam.updateProjectionMatrix(); }
    // le ciel suit la caméra et tient dans le champ (la caméra est loin, la voûte de 9 km serait coupée)
    this.voute.position.copy(cam.position);
    this.voute.scale.setScalar(far * 0.9 / 9000);
  }

  vueOrtho(mode) {
    const cam = this.camera, ctl = this.controls;
    if ((mode || null) === (this.modeVue || null)) return;
    if (mode && !this.modeVue) this.avant3D = { pos: cam.position.clone(), cible: ctl.target.clone(), fov: cam.fov };
    this.modeVue = mode || null;
    if (mode) {
      const R = this.G?.R || 150, fov = 3, h = R * 1.25 / Math.tan(fov * Math.PI / 360);
      cam.fov = fov;
      // zoom jusqu'à ~8 m de large à l'écran ; les plans proche et lointain suivent la distance (plansCamera)
      ctl.enableRotate = false; ctl.screenSpacePanning = true; ctl.minDistance = 150; ctl.maxDistance = h * 2;
      // comme une carte : glisser déplace (Maj + glisser revient en 3D, voir interactions)
      ctl.mouseButtons.LEFT = THREE.MOUSE.PAN; ctl.touches.ONE = THREE.TOUCH.PAN;
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
      this.voute.position.set(0, 0, 0); this.voute.scale.setScalar(1);
      ctl.enableRotate = true; ctl.minPolarAngle = 0; ctl.maxPolarAngle = Math.PI * 0.495;
      ctl.minDistance = 0; ctl.maxDistance = Infinity;
      ctl.mouseButtons.LEFT = THREE.MOUSE.ROTATE; ctl.touches.ONE = THREE.TOUCH.ROTATE;
      this.scene.fog.density = this.densiteBrume();
      if (a) { cam.position.copy(a.pos); ctl.target.copy(a.cible); } else this.vueDepart();
    }
    cam.updateProjectionMatrix();
    ctl.update();
    if (mode) this.plansCamera();
    this.surVue?.(this.modeVue);
    this.demander(5);
  }

  /**
   * Vue selon une direction [est, haut, sud] (composantes -1, 0 ou 1), comme le cube d'AutoCAD : le dessus donne le
   * plan, une face latérale l'élévation (vues orthogonales) ; une arête ou un coin, une vue 3D de biais.
   */
  vueDirection([dx, dy, dz]) {
    if (!dx && !dz) return this.vueOrtho("plan");
    if (!dy && (!dx || !dz)) return this.vueOrtho(dz > 0 ? "S" : dz < 0 ? "N" : dx > 0 ? "E" : "O");
    this.vueOrtho(null);
    const ctl = this.controls, cam = this.camera, dist = Math.max(80, cam.position.distanceTo(ctl.target));
    const d = new THREE.Vector3(dx, Math.max(dy, 0) + (dy > 0 ? 0 : 0.45), dz).normalize(); // vues « de dessous » : légèrement au-dessus
    cam.position.copy(ctl.target).addScaledVector(d, dist);
    ctl.update();
    this.demander(5);
  }

  /** Rotation de la vue 3D (glisser sur le cube) : angles en radians. */
  tourner(dAzimut, dPolaire) {
    if (this.modeVue) this.vueOrtho(null);
    const ctl = this.controls, off = this.camera.position.clone().sub(ctl.target), sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= dAzimut;
    sph.phi = Math.max(0.05, Math.min(ctl.maxPolarAngle, sph.phi - dPolaire));
    this.camera.position.copy(ctl.target).add(new THREE.Vector3().setFromSpherical(sph));
    ctl.update();
    this.demander(3);
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
      if (type === "cadastre") this.tuilesPlan.reteindre();
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
    const h = Math.asin(Math.max(-1, Math.min(1, dir[1]))) * 180 / Math.PI, bas = visible ? (1 - Math.min(1, Math.max(0, h / 18))) ** 1.3 : 0;
    this.soleil.color.copy(couleurSoleil(h)).lerp(new THREE.Color(T.lumiere.soleil), Math.min(1, Math.max(0, (h - 25) / 20)));
    this.soleil.intensity = visible ? 2.6 * (0.35 + 0.65 * (1 - Math.exp(-Math.max(0, h) / 6))) : 0;
    // soleil bas : le ciel éclaire moins, la lumière directe (rouge orangé) domine et les ombres virent au violet
    this.ciel.intensity = visible ? 1.1 - 0.3 * bas : Math.max(0.35, 0.9 * Math.min(1, (dir[1] + 0.1) * 4));
    this.ciel.color.set(T.lumiere.ciel).lerp(new THREE.Color("#a99ce6"), 0.5 * bas);
    this.disque.material.color.copy(couleurSoleil(h + 2)).multiplyScalar(1.1);
    this.disque.position.copy(d.clone().multiplyScalar(1200));
    // derrière une montagne du relief lointain affiché, le disque est caché
    this.disque.visible = dir[1] > -0.02 && !!this.G && (visible || !this.loin.maille || !this.loin.voir);
    // ciel : jour, soleil caché par le relief (plus terne), nuit
    const jour = visible ? 1 : dir[1] > 0 ? 0.72 : Math.max(0, Math.min(0.5, 0.5 + dir[1] * 4));
    // lueur de l'aube et du crépuscule : ciel rose orangé à l'horizon, violacé plus haut, jusqu'à 6° sous l'horizon
    const lueur = h < -6 ? 0 : h < 0 ? (h + 6) / 6 : (1 - Math.min(1, h / 18)) ** 1.3;
    u.zenith.value.set(T.ciel.nuitZenith).lerp(new THREE.Color(T.ciel.zenith), jour).lerp(new THREE.Color("#8c84c4"), 0.35 * lueur);
    u.horizon.value.set(T.ciel.nuitHorizon).lerp(new THREE.Color(T.ciel.horizon), jour).lerp(couleurSoleil(Math.max(0, h)).lerp(new THREE.Color("#f59ab4"), 0.45), 0.75 * lueur); // horizon rose orangé
    u.soleil.value.copy(d).normalize();
    u.force.value = visible ? 1 : 0;
    this.scene.fog.color.copy(u.horizon.value);
    this.majLointain();
    // les points ne sont pas éclairés par three.js : leur luminosité suit la lumière présente (ciel + soleil), rapportée
    // à celle d'un jour clair, comme pour les surfaces ; à l'ombre, ils ne gardent que la part du ciel
    const k = 0.55, jourClair = 1.1 + 2.6 * k, total = this.ciel.intensity + this.soleil.intensity * k;
    for (const c of ["arbres", "tous"]) {
      const u = this.couches[c]?.material.uniforms;
      const f = Math.min(1, total / jourClair);
      if (u) {
        u.lum.value = Math.max(0.04, f ** 1.5); u.gris.value = 0.7 * (1 - f) ** 2; u.ombre.value = visible ? this.ciel.intensity / total : 1;
        // teintes ramenées à une luminosité de 1 (la couleur change, pas la clarté), un peu atténuées
        const teinte = (src, dst, force) => {
          const l = Math.max(1e-3, 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b);
          dst.setRGB(src.r / l, src.g / l, src.b / l).lerp(new THREE.Color(1, 1, 1), 1 - force);
        };
        if (u.teinteSoleil) {
          teinte(this.ciel.color, u.teinteOmbre.value, 0.5);
          // soleil couché ou caché : plus de lumière directe, donc plus de teinte rouge orangé (seule celle du ciel)
          if (visible && this.soleil.intensity > 0) teinte(this.soleil.color, u.teinteSoleil.value, 0.6 * Math.min(1, this.soleil.intensity / 1.2));
          else u.teinteSoleil.value.copy(u.teinteOmbre.value);
        }
      }
    }
    this.ombres();
  }

  /** Arbres de la zone en gris tant que la carte des heures de soleil est affichée (sinon ils la cachent). */
  arbresSurHeures() {
    const m = this.couches.arbres?.material;
    if (!m) return;
    m.uniforms.neutre.value = this.couches.heures?.visible ? 1 : 0;
    this.demander();
  }

  /** Zone de la carte des heures de soleil (heures.js) : les arbres qui s'y trouvent passent en gris. */
  zoneArbres(zone) {
    const m = this.couches.arbres?.material, G = this.G;
    if (!m || !G) return;
    const { n, c, x0 } = G, a = new Uint8Array(n * n);
    if (zone) for (let j = 0; j < zone.h; j++) for (let i = 0; i < zone.w; i++) {
      const I = zone.i0 + i, J = zone.j0 + j;
      if (I >= 0 && J >= 0 && I < n && J < n) a[J * n + I] = Math.round(255 * zone.alpha[j * zone.w + i]);
    }
    const t = new THREE.DataTexture(a, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    m.uniforms.tZone.value?.dispose();
    m.uniforms.tZone.value = t;
    m.uniforms.grilleZone.value.set(x0, n * c, zone ? 1 : 0);
    this.demander();
  }

  /** Carte des heures d'ensoleillement (groupe de maillages préparé par heures.js), ou null pour l'enlever. */
  afficherHeures(grp) {
    const vieux = this.couches.heures;
    if (vieux) { this.groupe.remove(vieux); this.liberer(vieux); }
    this.couches.heures = grp;
    if (grp) { if (vieux) grp.visible = vieux.visible; this.groupe.add(grp); }
    this.arbresSurHeures();
    this.appliquerCoupe();
    this.demander();
  }

  /* ------------------------------------------------------------------ coupe */

  /** Affiche la coupe décrite par le profil `P` (coupe.js), ou l'enlève si `P` est nul. */
  definirCoupe(P) {
    this.liberer(this.outils);
    this.coupe = P;
    this.poignees = [];
    this.tranche = null;
    if (P && this.couperModele === false) {
      // maquette entière : seulement le trait de coupe (terrain et bâtiments, murs à leur position exacte), qui épouse
      // les toits et les façades ; un rappel pâle, vu à travers, là où il passe derrière un bâtiment
      this.tranche = trancheCoupe(P, this.zRef, this.zBas, { ...this.T.coupe, arbres: null }, this.mat.trait);
      const traits = this.tranche.userData.traits || [];
      this.tranche.traverse(o => { if (o.isMesh && !traits.includes(o)) o.visible = false; });
      const pale = this.mat.trait.clone();
      Object.assign(pale, { depthTest: false, transparent: true, opacity: 0.3, linewidth: 2 });
      for (const l of traits) { const r = l.clone(); r.material = pale; r.renderOrder = 6; this.tranche.add(r); traits.push(r); }
      this.outils.add(this.tranche);
    } else if (P) {
      this.tranche = trancheCoupe(P, this.zRef, this.zBas, { ...this.T.coupe, arbres: this.T.sombre ? "#7f8da6" : "#8a9096" }, this.mat.trait);
      if (this.tranche.userData.arbres) this.tranche.userData.arbres.visible = this.arbresVisibles !== false;
      this.outils.add(this.tranche);
    }
    if (P) {
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
      // la tranche reste juste du côté visible (l'occlusion ambiante la coupe sinon), à 4 mm seulement : plus loin,
      // le bout des faces coupées (terrain sous un bâtiment, murs enterrés) dépasse devant le poché en traits fins
      // sans coupe de la maquette, le trait est un peu avancé vers la caméra : il reste visible sur les façades qu'il longe
      this.tranche?.position.copy(this.plan.normal).multiplyScalar(this.couperModele === false ? -0.12 : 0.004);
    }
    // poignées de taille constante à l'écran, focale comprise (les vues plan et élévation utilisent une focale très longue)
    const f = 0.011 * Math.tan(this.camera.fov * Math.PI / 360) / Math.tan(Math.PI / 8);
    for (const g of this.poignees) g.scale.setScalar(Math.max(0.6, c.distanceTo(g.position) * f));
  }

  appliquerCoupe() {
    const plans = this.coupe && this.couperModele !== false ? [this.plan] : null, c = this.couches, m = this.mat;
    // bâtiments swisstopo : chargés par tuiles bien au-delà du modèle, on les coupe aux bords du terrain
    // (et l'occlusion ambiante ne doit pas voir la partie coupée)
    if (this.G) {
      // boîte de l'occlusion 2 cm au-delà du bord : la face du socle est exactement à R, une boîte à R l'effaçait par
      // endroits (arrondis) et l'occlusion y dessinait des stries ; les bâtiments sont de toute façon coupés à R - 3 cm
      const R = this.G.R, boite = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(n => new THREE.Plane(new THREE.Vector3(...n), R + 0.02));
      const avecBoite = [...boite, ...(plans || [])];
      if (this.ao.normalMaterial) { this.ao.normalMaterial.clippingPlanes = avecBoite; this.ao.normalMaterial.needsUpdate = true; }
      // nos bâtiments (et roofer) : coupés 3 cm en retrait du bord, sinon les murs du bord sont dans le plan de la face
      // du socle et leur partie enterrée apparaît en stries à travers elle
      const dedans = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(n => new THREE.Plane(new THREE.Vector3(...n), R - 0.03));
      for (const x of [m.toit, m.mur, c.roofer?.material, this.swiss?.materiau]) if (x) { x.clippingPlanes = [...dedans, ...(plans || [])]; x.needsUpdate = true; }
      // swisstopo et roofer débordent du modèle : la partie coupée ne doit pas non plus porter d'ombre (stries sur la
      // face du socle, ombres de bâtiments invisibles au bord du terrain)
      for (const x of [c.roofer?.material, this.swiss?.materiau]) if (x) x.clipShadows = true;
    }
    const cibles = [m.terrain, m.socle, m.canopee, m.couronne, m.parcelle, m.eau];
    for (const k of ["arbres", "tous"]) if (c[k]) cibles.push(c[k].material);
    c.heures?.traverse(o => o.material && cibles.push(o.material));
    c.voisines?.traverse(o => o.material && cibles.push(o.material)); // limites et numéros des parcelles voisines
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
    // vue plan ou élévation : Maj + glisser repasse en 3D sur place, et le même geste fait tourner la vue
    // (OrbitControls : avec Maj, le bouton « déplacer » fait tourner ; le réglage normal revient au relâchement)
    el.addEventListener("pointerdown", e => {
      if (!this.modeVue || !e.shiftKey || e.button !== 0) return;
      this.libererVue();
      this.controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      addEventListener("pointerup", () => { if (!this.modeVue) this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; }, { once: true });
    }, true);
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
