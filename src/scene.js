// Scène three.js. Repère : x = est, y = altitude (relative à zRef), z = sud (−nord).
import * as THREE from "three";
import { BrumeCinematique, BRUME_SOL_GLSL } from "./brumeCinematique.js";

// Brume (FogExp2) plus naturelle, pour tous les matériaux : elle monte plus lentement près de la caméra puis plus vite
// au loin (exposant 2,8 au lieu de 2), et sa densité varie un peu d'un endroit à l'autre (bruit doux à grande échelle,
// ±15 %), au lieu d'un voile parfaitement uniforme. La position du point (repère du monde) est tirée de mvPosition.
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vBrumeMonde;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vBrumeMonde = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz + cameraPosition;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vBrumeMonde;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec4 brumeSol, brumeSolTeinte; // brume cinématique au sol (brumeCinematique.js) ; z = 0 : coupée
  float brumeHasard(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float brumeBruit(vec2 p) {
    vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(brumeHasard(i), brumeHasard(i + vec2(1, 0)), u.x), mix(brumeHasard(i + vec2(0, 1)), brumeHasard(i + vec2(1, 1)), u.x), u.y);
  }
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    // deux octaves : nappes de ~1,5 km et de ~400 m, qui varient aussi un peu avec l'altitude
    vec2 q = vBrumeMonde.xz * 0.0007 + vBrumeMonde.y * 0.0004;
    float n = 0.65 * brumeBruit(q) + 0.35 * brumeBruit(q * 3.7 + 17.0);
    float dd = fogDensity * vFogDepth;
    float fogFactor = 1.0 - exp(- pow(dd, 2.8) * (0.85 + 0.3 * n));
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  // brume cinématique (nappe au sol, sa propre teinte), puis la brume de distance par-dessus
  ${BRUME_SOL_GLSL}
  // couleur du ciel juste sous l'horizon (shader du ciel : horizon × 0,94), passée par le même rendu que le ciel ; au
  // bout de la brume, rien n'est plus clair que le ciel (neige, façades claires) : la teinte est d'abord plafonnée
  vec3 couleurBrume = fogColor * 0.94;
  #ifdef TONE_MAPPING
    couleurBrume = toneMapping(couleurBrume);
  #endif
  couleurBrume = linearToOutputTexel(vec4(couleurBrume, 1.0)).rgb;
  vec3 plafonne = mix(gl_FragColor.rgb, min(gl_FragColor.rgb, couleurBrume), fogFactor);
  gl_FragColor.rgb = mix(plafonne, couleurBrume, fogFactor);
#endif`;
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
import { socleRond, materiauPoints, bordEauRond, normalesVersLeHaut } from "./maillages.js";
import { dansPont, maillagePont } from "./pontsModeles.js";
import { terrain, socle, canopee as nappeCanopee, batiments, nuagePoints, contourParcelle, couronnes, pointsVegetation, hauteursBords, hauteursDessus, limitesVoisines, DEGRADE, RAMPE_GLSL, plansEau, decouperBord, decouperCercle, tabliersPonts, pontsLegers } from "./maillages.js";
import { chargerImage, teinterCadastre, adoucirPhoto } from "./fond.js";
import { maillageBassins } from "./piscines.js";
import { trancheCoupe } from "./coupe.js";
import { calculerTerrainTIN, maillageTIN, hauteurTIN } from "./terrainTIN.js";

/**
 * Trait de coupe « 2D » : épaisseur constante en pixels, dessiné par-dessus tout (sans test de profondeur), avec des
 * disques aux sommets pour des jonctions rondes, comme un trait de plume sur un plan.
 */
function traitNet() {
  const m = new LineMaterial({ linewidth: 3, fog: false, depthTest: false, depthWrite: false, transparent: true });
  m.jonction = new THREE.ShaderMaterial({
    uniforms: { taille: { value: 3 }, couleur: { value: new THREE.Color() } },
    vertexShader: "uniform float taille; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = taille; }",
    fragmentShader: "uniform vec3 couleur; void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r = dot(p, p); if (r > 1.0) discard; gl_FragColor = vec4(couleur, 1.0); }",
    depthTest: false, depthWrite: false, transparent: true,
  });
  return m;
}
import { carteRelief, materiauLointain } from "./lointain.js";
import { TuilesPlan } from "./plan.js";
import { volumeGeometrie, traitsEtages } from "./projet.js";

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
  // animation de construction (0 → 1) : les murs et les toits montent du sol, en vague depuis le centre
  montee: { value: 1 },
  // rythme propre à chaque bâtiment (0..1, par cellule) et vague : origine (x, z) et direction du regard (x, z)
  tRythme: { value: null }, vague: { value: new THREE.Vector4(0, 0, 0, 0) },
  // carte des heures de soleil, peinte directement sur le sol et les toits : une couleur par cellule (pixels nets)
  tHeures: { value: null }, heuresZone: { value: new THREE.Vector4(0, 0, 1, 1) }, heuresActif: { value: 0 },
  // sélection : R = parcelle choisie, G = bâtiment(s) de l'adresse ou de la parcelle ; teinte = couleur de parcelle du thème
  tSel: { value: null }, teinteSel: { value: new THREE.Color("#e0262b") },
  // couleurs réelles (orthophoto lue par catégorie) : sol, et bâtiments (toits, couleur reprise par leurs façades)
  tReelSol: { value: null }, tReelBati: { value: null }, tReelMur: { value: null }, reelActif: { value: 0 },
  teinteReel: { value: new THREE.Color("#efe6d6") } }; // beige lumineux vers lequel les couleurs réelles sont adoucies

/**
 * `contact` : "mur" (bas des murs assombri sur ~1,5 m), "sol" (sol assombri au pied des bâtiments, ~2 m) ou "toit" ;
 * les trois reçoivent aussi la teinte légère de la sélection (parcelle, bâtiment).
 * L'occlusion ambiante, large et douce, ne marque pas assez la jonction mur–sol : les bâtiments semblaient flotter.
 */
/**
 * Zone ronde : rayons (m, depuis le centre) entre lesquels un matériau est dessiné. Sert aux tuiles swisstopo (bâtiments,
 * roofer) : maquette ronde (0 à R) ou anneau autour de la maquette fine (R fin à R zone). Partagé par les matériaux.
 */
// rayon (m) jusqu'où les bâtiments swisstopo sont montrés dans le paysage (au-delà, la brume et le relief suffisent)
const RAYON_BATI_LOIN = 3000;
export const ZONE = { zoneMin: { value: 0 }, zoneMax: { value: 1e9 } };
/** Zone de nos propres bâtiments, ponts et volumes : le disque de la maquette fine. */
const ZONE_FINE = { zoneMin: { value: 0 }, zoneMax: { value: 1e9 } };
/** Zone vue par l'occlusion ambiante et le rebond : tout ce qui est hors du cercle (ou de l'anneau) en est retiré. */
const ZONE_AO = { zoneMin: { value: 0 }, zoneMax: { value: 1e9 } };
// anneau seul (entre le cercle fin et le bord extérieur) : ponts swissTLM3D, nos ponts étant dans la maquette fine
const ZONE_ANNEAU = { zoneMin: { value: 0 }, zoneMax: { value: 1e9 } };
/**
 * Pose des plans de coupe sur un matériau, et ne le fait recompiler que s'ils changent vraiment (nombre ou valeurs
 * différents) : déplacer une coupe ne touche que les valeurs du plan, que three lit à chaque image. Recompiler à chaque
 * mouvement de poignée coûtait jusqu'à 1,5 s par image sur une grande maquette.
 */
function poserPlans(mat, plans) {
  const sig = plans ? plans.map(p => p === PLAN_MOBILE.plan ? "coupe" : `${p.normal.toArray().join()},${p.constant}`).join(";") : "";
  if (mat.userData.plans === sig && (!!mat.clippingPlanes === !!plans)) {
    // mêmes plans : on remet les objets (le plan de coupe est le même objet, ses valeurs ont changé) sans recompiler
    if (plans && mat.clippingPlanes) mat.clippingPlanes = plans;
    return;
  }
  mat.userData.plans = sig;
  mat.clippingPlanes = plans;
  mat.needsUpdate = true;
}
const PLAN_MOBILE = { plan: null };

/** Fond du socle (relatif) : rien de ce qui est découpé par une zone ne descend plus bas (piles de ponts, fondations). */
const ZONE_BAS = { value: -1e9 };
function decoupeZone(mat, zone = ZONE) {
  if (mat.userData.zone) return;
  mat.userData.zone = true;
  const avant = mat.onBeforeCompile, cle = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    avant?.call(mat, sh, r);
    Object.assign(sh.uniforms, zone, { zoneBas: ZONE_BAS });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vZone;")
      .replace("#include <project_vertex>", `#include <project_vertex>
#ifdef USE_INSTANCING
  vZone = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vZone = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      // déclarations juste avant main : certains shaders (MeshNormalMaterial de l'occlusion) n'incluent pas <common>
      .replace("void main() {", "varying vec3 vZone;\nuniform float zoneMin, zoneMax, zoneBas;\nvoid main() {\n  { float dz = length(vZone.xz); if (dz > zoneMax || dz < zoneMin || vZone.y < zoneBas) discard; }");
  };
  mat.customProgramCacheKey = () => (cle ? cle.call(mat) : "") + "|zone";
  mat.needsUpdate = true;
}

/**
 * Eau : un peu translucide (on devine le fond), bleu-vert ; coupée au cercle de la maquette ronde (`rayonEau`,
 * uniforme partagé) pour ne pas déborder du socle.
 */
const RAYON_EAU = { value: 1e9 };
// eau de l'anneau : sa propre limite extérieure, et une limite intérieure (le raccord avec l'eau de la maquette fine)
const RAYON_EAU_ANNEAU = { value: 1e9 }, RAYON_EAU_INT = { value: 0 };
function matEau(rayon = RAYON_EAU, rayonInt = null) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.88 }); // un peu transparente : on devine le fond près des rives
  m.onBeforeCompile = sh => {
    sh.uniforms.rayonEau = rayon;
    sh.uniforms.rayonEauInt = rayonInt || { value: 0 };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vEauXZ;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvEauXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vEauXZ;\nuniform float rayonEau;")
      .replace("void main() {", "uniform float rayonEauInt;\nvoid main() {\n  float rE = length(vEauXZ);\n  if (rE > rayonEau || rE < rayonEauInt) discard;");
  };
  m.customProgramCacheKey = () => "eauCercle";
  return m;
}

// Montée des bâtiments (animerConstruction) : chacun à son rythme (tRythme), en vague depuis `vague.xy`, un peu plus tôt
// devant la caméra (`vague.zw`). Utilisée par les murs et les toits, et par leur matériau d'ombre (l'ombre suit).
const MONTEE_DECL = "\nuniform sampler2D tSol, tRythme;\nuniform vec3 grille;\nuniform vec4 vague;\nuniform float montee, contactActif;";
const MONTEE_GLSL = `if (montee < 0.999 && contactActif > 0.5) {
  vec4 wm = modelMatrix * vec4(transformed, 1.0);
  vec2 uvM = (vec2(wm.x, -wm.z) - grille.x) / grille.y;
  float sol = texture(tSol, uvM).r, r = texture(tRythme, uvM).r;
  vec2 dv = wm.xz - vague.xy;
  float retard = (length(dv) - 0.4 * dot(dv, vague.zw)) / max(grille.y * 0.5, 1.0) * 0.55 + r * 0.3;
  float k = clamp((montee * 1.95 - retard) * (1.5 + 1.3 * fract(r * 7.31)), 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k);
  transformed.y += (sol + (wm.y - sol) * k) - wm.y;
}
`;

/** Matériau d'ombre des bâtiments : la même montée que leur dessin, sinon l'ombre apparaît avant eux. */
function profondeurMontante() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, CONTACT);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>" + MONTEE_DECL)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + MONTEE_GLSL);
  };
  m.customProgramCacheKey = () => "profondeur-montante";
  return m;
}

function grainPlatre(mat, force, contact = "") {
  mat.onBeforeCompile = sh => {
    sh.uniforms.grainForce = { value: force };
    Object.assign(sh.uniforms, CONTACT, DEGRADE);
    const monte = contact === "mur" || contact === "toit";
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMonde;" + (monte ? MONTEE_DECL : ""))
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + (monte ? MONTEE_GLSL : "") + "vMonde = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vMonde;
uniform float grainForce;
uniform sampler2D tSol, tDist, tSel, tReelSol, tReelBati, tReelMur, tHeures;
uniform vec4 heuresZone;
uniform float heuresActif;
uniform float reelActif;
uniform vec3 teinteReel;
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
// de très près, une case fait des dizaines de pixels et ressemble à un défaut d'affichage : elle s'efface
vec2 tailleCase = fwidth(vec2(vMonde.x, vMonde.z));
float visibleCase = smoothstep(0.008, 0.035, max(tailleCase.x, tailleCase.y));
float pixel = mix(0.5, hachage(floor(vMonde * 2.0 + 0.001) + 0.37), visibleCase);
diffuseColor.rgb *= 1.0 + grainForce * ((g - 0.5) * 1.4 + (pixel - 0.5) * 0.9);
${contact && contact !== "swiss" ? `if (contactActif > 0.5) {
  vec2 uvG = (vec2(vMonde.x, -vMonde.z) - grille.x) / grille.y;
  if (reelActif > 0.5) {
    // couleurs de la photo adoucies : en bonne partie désaturées, éclaircies et fondues dans un beige lumineux (maquette)
    vec3 r = texture2D(${contact === "sol" ? "tReelSol" : contact === "mur" ? "tReelMur" : "tReelBati"}, uvG).rgb;
    float l = dot(r, vec3(0.2126, 0.7152, 0.0722));
    r = mix(vec3(l), r, 0.75);
    r = mix(r, teinteReel, 0.3) * (0.85 + 0.3 * smoothstep(0.0, 0.5, l));
    diffuseColor.rgb = r * (1.0 + grainForce * (g - 0.5) * 0.7);
  }
  ${contact === "mur"
    ? "float hc = vMonde.y - texture2D(tSol, uvG).r; diffuseColor.rgb *= mix(0.84, 1.0, smoothstep(0.0, 1.2, hc));"
    : contact === "sol" ? "float dc = texture2D(tDist, uvG).r; diffuseColor.rgb *= mix(0.86, 1.0, smoothstep(0.0, 1.6, dc));" : ""}
  vec2 sel = texture2D(tSel, uvG).rg;
  diffuseColor.rgb = mix(diffuseColor.rgb, teinteSel * 1.15, ${contact === "sol" ? "0.13 * sel.r" : "0.22 * sel.g"});
}` : ""}`);
  };
  if (contact === "sol" || contact === "toit" || contact === "mur" || contact === "swiss") {
    const avant = mat.onBeforeCompile;
    // murs : la couleur de la cellule juste devant la façade (fond sous les carreaux : aucun recoin ne reste beige) ;
    // bâtiments swisstopo (toits et murs dans le même maillage) : selon la face, toit (vers le haut) ou mur
    const decale = contact === "mur" ? `vec3 nM = normalize(cross(dFdx(vMonde), dFdy(vMonde)));
  vec2 posH = vec2(vMonde.x, -vMonde.z) + vec2(nM.x, -nM.z) * 0.7;` : contact === "swiss" ? `vec3 nM = normalize(cross(dFdx(vMonde), dFdy(vMonde)));
  vec2 posH = vec2(vMonde.x, -vMonde.z) + (abs(nM.y) > 0.45 ? vec2(0.0) : normalize(vec2(nM.x, -nM.z)) * 0.7);` : `vec2 posH = vec2(vMonde.x, -vMonde.z);`;
    mat.onBeforeCompile = (sh, r) => {
      avant(sh, r);
      sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>", `if (heuresActif > 0.5) {
  ${decale}
  vec2 uvH = (posH - heuresZone.xy) / heuresZone.zw;
  if (uvH.x >= 0.0 && uvH.y >= 0.0 && uvH.x < 1.0 && uvH.y < 1.0) {
    vec4 hc = texture2D(tHeures, uvH);
    // couleur de la carte presque pleine, avec un reste du relief éclairé (on lit encore la forme des toits)
    float l = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
    outgoingLight = mix(outgoingLight, hc.rgb * (0.78 + 0.35 * clamp(l, 0.0, 1.0)), hc.a);
  }
}
#include <opaque_fragment>`);
    };
  }
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
    this.controls.maxDistance = 60000; // au-delà, le paysage (50 km) n'est plus qu'un point
    // rendu à la demande : tout mouvement de la caméra (molette comprise, avec son amorti) redessine
    this.controls.addEventListener("change", () => { if (this.modeVue) this.plansCamera(); this.demander(3); });
    r.domElement.addEventListener("wheel", () => this.demander(40), { passive: true });
    // regarder autour de soi : Alt (Option) + glisser, ou bouton du milieu — la caméra tourne sur elle-même (la cible
    // tourne autour d'elle), au lieu de tourner autour de la cible
    {
      const el = r.domElement;
      let tete = null;
      el.addEventListener("pointerdown", e => {
        if (this.modeVue || !(e.altKey && e.button === 0) && e.button !== 1) return;
        e.preventDefault(); e.stopImmediatePropagation();
        tete = { x: e.clientX, y: e.clientY, id: e.pointerId };
        this.controls.enabled = false;
        el.setPointerCapture?.(e.pointerId);
      }, true);
      el.addEventListener("pointermove", e => {
        if (!tete || e.pointerId !== tete.id) return;
        const dx = e.clientX - tete.x, dy = e.clientY - tete.y;
        tete.x = e.clientX; tete.y = e.clientY;
        const cam = this.camera, c = this.controls.target, d = c.clone().sub(cam.position), L = d.length();
        const s = new THREE.Spherical().setFromVector3(d);
        s.theta -= dx * 0.004; s.phi = Math.max(0.05, Math.min(Math.PI - 0.05, s.phi + dy * 0.004));
        c.copy(cam.position).add(new THREE.Vector3().setFromSpherical(s).setLength(L));
        cam.lookAt(c);
        this.demander(2);
      });
      const fin = e => { if (!tete || e.pointerId !== tete.id) return; tete = null; this.controls.enabled = true; this.controls.update(); };
      el.addEventListener("pointerup", fin); el.addEventListener("pointercancel", fin);
      el.addEventListener("auxclick", e => { if (e.button === 1) e.preventDefault(); });
    }

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
    this.loin = { mat: materiauLointain(), maille: null, voir: false, brume: false }; // paysage et brume : coupés par défaut (cases Affichage)
    // plan cadastral en tuiles autour de la maquette, chargées au fil des déplacements
    this.tuilesPlan = new TuilesPlan(this);
    {
      const u = this.loin.mat.uniforms, [p, l] = this.tuilesPlan.textures, [cp, cl] = this.tuilesPlan.centres;
      u.tPlanP.value = p; u.tPlanL.value = l; u.cPlanP.value = cp; u.cPlanL.value = cl;
    }
    this.controls.addEventListener("change", () => this.tuilesPlan.demander());
    this.brumeCine = new BrumeCinematique(this); // brume au sol, mer de brouillard (case d'Affichage, coupée par défaut)
    this.groupe = new THREE.Group();
    this.outils = new THREE.Group(); // tranche de coupe et poignées
    this.scene.add(this.voute, this.disque, this.groupe, this.outils);

    // matériaux partagés : le thème ne change que leurs couleurs
    const std = o => new THREE.MeshStandardMaterial({ roughness: 0.92, side: THREE.DoubleSide, ...o });
    this.mat = {
      terrain: std({ roughness: 1, side: THREE.FrontSide }), socle: std({ roughness: 1 }), socleFond: std({ roughness: 1, side: THREE.FrontSide }),
      toit: std({ flatShading: true }), mur: std({ flatShading: true }), canopee: std({ roughness: 1 }),
      couronne: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
      parcelle: new THREE.MeshBasicMaterial(), trait: traitNet(),
      poignee: new THREE.MeshBasicMaterial({ depthTest: false, fog: false }),
      eau: matEau(), // sans décalage de profondeur : il faisait passer l'eau devant la rive vue de haut
    };
    // même grain léger partout (sol, socle, toits, murs, couronnes) : aspect de maquette en plâtre
    for (const [k, force, contact] of [["terrain", 0.07, "sol"], ["socle", 0.07], ["socleFond", 0.07], ["toit", 0.07, "toit"], ["mur", 0.07, "mur"], ["couronne", 0.05], ["eau", 0.025]]) grainPlatre(this.mat[k], force, contact);
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
      const c = this.couches, caches = [this.voute, this.disque, ...this.poignees, ...(this.reperesAutres || []), ...(this.traitsAutres || []), c.heures, c.limite, c.voisines, c.arbres, c.tous, c.selection, c.laser, c.apercuVolume, c.eau, ...(this.horsAO || []), // l'eau : plate et translucide, l'occlusion y dessinait des arcs
        this.coupe ? this.tranche?.userData.arbres : null, ...(this.coupe && this.tranche?.userData.traits || []),
        c.canopee?.material.colorWrite === false ? c.canopee : null,
        this.loin.maille, this.monde?.racine].filter(o => o && o.visible); // paysage et monde : trop loin pour l'occlusion de 12 m (D9)
      for (const o of caches) o.visible = false;
      rendu(...a);
      for (const o of caches) o.visible = true;
    };
    // l'occlusion s'efface dans la brume, comme le reste : facteur de brume (FogExp2) tiré de la profondeur
    Object.assign(ao.blendMaterial.uniforms, { tDepth: { value: ao.depthTexture }, cameraNear: { value: 1 }, cameraFar: { value: 1000 }, densite: { value: 0 }, ortho: { value: 0 } });
    ao.blendMaterial.fragmentShader = `
uniform float intensity, cameraNear, cameraFar, densite, ortho;
uniform sampler2D tDiffuse, tDepth;
varying vec2 vUv;
#include <packing>
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  float z = texture2D(tDepth, vUv).x;
  float d = ortho > 0.5 ? -orthographicDepthToViewZ(z, cameraNear, cameraFar) : -perspectiveDepthToViewZ(z, cameraNear, cameraFar);
  float brume = z >= 1.0 ? 1.0 : 1.0 - exp(-pow(densite * d, 2.8)); // même courbe que la brume des matériaux
  gl_FragColor = vec4(mix(vec3(1.0), texel.rgb, intensity * (1.0 - brume)), texel.a);
}`;
    ao.blendMaterial.needsUpdate = true;
    const majBrumeAo = () => {
      const u = ao.blendMaterial.uniforms, cam = this.camera;
      u.tDepth.value = ao.depthTexture; u.cameraNear.value = cam.near; u.cameraFar.value = cam.far;
      u.densite.value = this.scene.fog?.density || 0; u.ortho.value = cam.isOrthographicCamera ? 1 : 0;
    };
    const rendu2 = ao.render;
    ao.render = (...a) => { majBrumeAo(); rendu2(...a); };
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
      const clavier = this.deplacerClavier(t);
      if (clavier) this.demander(2);
      const bouge = this.controls.update();
      // navigation à la main (souris, clavier) : images sans occlusion ni rebond, puis une image complète à l'arrêt (D9)
      if ((bouge || clavier) && !this.animation) this.dernierMouvement = t;
      if (!bouge && this.aRendre <= 0) {
        if (!this.imageLegere) { avant = 0; return; }
        this.dernierMouvement = -Infinity; // l'image d'arrêt, avec tous les effets
      }
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
    this.mat.trait.jonction.uniforms.taille.value = this.mat.trait.linewidth * this.ratio;
    this.camera.aspect = w / h;
    DEGRADE.hauteurEcran.value = h * this.ratio;
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
    if (this.batiLoin() && this.G) { this.comparerSwiss(this.calques.jeu === "swiss"); this.majZone(); this.appliquerCoupe(); }
    this.demander();
    // ombre des montagnes sur le paysage : carte des altitudes calculée ensuite, sans retarder l'affichage
    const u = L.mat.uniforms;
    u.reliefActif.value = 0;
    if (g.userData.altitude) carteRelief(g.userData.altitude).then(t => {
      if (idScene !== this.idScene) { t.dispose(); return; }
      u.tRelief.value?.dispose();
      u.tRelief.value = t; u.cRelief.value.set(0, 0, 25000); u.reliefActif.value = 1;
      this.demander(2);
    });
  }

  /** Relief lointain visible ou non, brume avec la distance ou non (maquette et paysage). */
  reglerLointain({ voir = this.loin.voir, brume = this.loin.brume } = {}) {
    const avant = this.batiLoin();
    Object.assign(this.loin, { voir, brume });
    if (this.batiLoin() !== avant && this.G) { this.comparerSwiss(this.calques.jeu === "swiss"); this.majZone(); this.appliquerCoupe(); }
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
    if ((this.vol || this.paysage) && !this.modeVue) return 1.5e-4; // vol de l'accueil, paysage navigable : brume d'été
    if (this.modeVue || !this.loin.brume) return 0;
    // curseur de brume : 0 à 100 % (50 % = la brume habituelle), quadruple au plus
    const f = (this.loin.facteurBrume ?? 0.5) * 2;
    return (this.loin.maille && this.loin.voir ? 2.2e-5 : this.T.lumiere.brume) * f * f;
  }

  /** Couleurs et lumière du relief lointain, celles de la maquette (thème, soleil, ciel). */
  majLointain() {
    const u = this.loin.mat.uniforms;
    u.sol.value.set(this.T.sol);
    // lacs du paysage et de l'anneau : le bleu-vert du plan d'eau de la maquette (un peu éclairci : vu de loin, à plat)
    u.lac.value.set(this.T.eau || (this.T.sombre ? "#2f5d6e" : "#8fc1c9")).lerp(new THREE.Color(this.T.plan.sol), 0.12);
  }


  /** Trait de coupe : 3 px de près, plus fin en s'éloignant (jusqu'à 1,2 px), pour ne pas écraser la maquette. */
  epaisseurTrait() {
    const d = this.camera.position.distanceTo(this.controls.target), e = Math.max(1.2, Math.min(3, 3 * 160 / Math.max(1, d)));
    if (Math.abs(this.mat.trait.linewidth - e) > 0.05) {
      this.mat.trait.linewidth = e;
      this.mat.trait.jonction.uniforms.taille.value = e * this.ratio;
    }
  }

  rendre() {
    if (this.coupe) this.epaisseurTrait();
    if (this.coupe) this.orienterCoupe();
    const L = this.loin, enPlan = this.modeVue === "plan";
    // maquette coupée : posée seule, comme une maquette d'atelier (le paysage autour laisserait un vide à la place de la
    // moitié enlevée) ; avec la ligne de coupe seule, le paysage reste
    const coupee = !!this.coupe && this.couperModele !== false;
    if (L.maille) L.maille.visible = L.voir && (!this.modeVue || enPlan) && !coupee;
    // paysage affiché : il prolonge le lac au-delà du cercle, la bande d'eau du bord n'a plus lieu d'être
    this.couches.eauAnneau?.children.forEach(o => { o.visible = !(L.maille && L.maille.visible); });
    // plan en tuiles (cadastre, photo ou bruit, comme le sol de la maquette) : sur le paysage, et sur l'anneau du
    // grand cercle même sans paysage
    const couche = this.typeFond, avecAnneau = !!this.couches?.anneau && this.couches.anneau.visible !== false;
    const mondeVu = !!this.monde?.terrain?.group.visible;
    const tuiles = couche !== "uni" && ((!!L.maille && L.maille.visible) || avecAnneau || mondeVu);
    if (tuiles) this.tuilesPlan.changerCouche(couche);
    if (tuiles !== this.tuilesPlan.actif) { this.tuilesPlan.actif = tuiles; if (tuiles) this.tuilesPlan.demander(); }
    L.mat.uniforms.planActif.value = tuiles ? 1 : 0;
    if (tuiles) this.tuilesPlan.peindre(this.renderer);
    if (!this.modeVue) {
      // avec le paysage : plan lointain à 150 km, plan proche reculé avec la distance (précision au loin), ciel centré
      // sur la caméra (la voûte de 9 km ne doit pas être quittée en dézoomant)
      const cam = this.camera, avecLoin = !!(L.maille && L.voir) || mondeVu;
      // le plan proche suit ce qui est le plus près : la maquette ou le point visé (après un grand dézoom, le point
      // visé peut être à des kilomètres alors que la caméra revient près de la maquette)
      const R = this.G?.R || 150, versMaquette = Math.max(0, cam.position.length() - R * 1.5);
      const proche = Math.min(cam.position.distanceTo(this.controls.target), versMaquette, Math.max(0, cam.position.y - (this.zBas || 0)));
      let far = avecLoin ? 150000 : 20000;
      const near = avecLoin ? Math.min(20, Math.max(0.5, proche * 0.003)) : 0.5;
      // brume : au-delà de la distance où elle couvre tout (≥ 99,5 %, bruit de densité compris), rien n'est visible.
      // Le plan lointain s'y arrête : ni dessin, ni tuiles téléchargées au-delà (comme le brouillard des jeux vidéo).
      // 1 − exp(−(d·densité)^2,8 · 0,85) = 0,995  →  d ≈ 1,92 / densité ; jamais en deçà de la maquette elle-même
      const dens = this.scene.fog?.density || 0;
      if (dens > 0) far = Math.min(far, Math.max(2.0 / dens, cam.position.length() + 2 * R + 200));
      if (Math.abs(cam.far - far) > 1 || Math.abs(cam.near - near) > 0.05 * near) { cam.far = far; cam.near = near; cam.updateProjectionMatrix(); }
      this.voute.position.copy(avecLoin || far < 9500 ? cam.position : new THREE.Vector3());
      // la voûte du ciel (rayon 9 km) reste dans le champ quand le plan lointain se rapproche
      const ev = Math.min(1, far * 0.92 / 9000);
      if (this.voute.scale.x !== ev) this.voute.scale.setScalar(ev);
    }
    this.swiss?.mettreAJour();
    this.monde?.mettreAJour();
    this.brumeCine.mettreAJour();
    const leger = this.allegerMouvement !== false && performance.now() - (this.dernierMouvement ?? -Infinity) < 120;
    this.imageLegere = leger && this.effets && this.qualite < 2;
    this.ao.enabled = this.rebond.enabled = !this.imageLegere;
    // vue plan et élévations : sans occlusion ambiante ni rebond de lumière (vus de face, ils n'apportent presque rien
    // et coûtent ~25 % de chaque image) ; les ombres portées restent
    if (this.effets && this.qualite < 2 && !this.modeVue) this.composeur.render(); else this.renderer.render(this.scene, this.camera);
  }

  /** Images trop lentes (moins de ~5 par seconde, plusieurs fois de suite) : les effets de lumière se coupent. */
  mesurer(dt) {
    if (!this.effets) return;
    this.lent = dt > 200 ? this.lent + 1 : Math.max(0, this.lent - 1);
    if (this.lent < 8) return;
    this.lent = 0;
    this.reglerQualite(0);
    this.surQualite?.(0);
  }

  /**
   * Qualité du rendu (curseur) : 0 simple (sans effets, image 1:1), 1 effets, 2 effets et image fine sur écran dense
   * (jusqu'à 1,5), 3 la plus fine (jusqu'à 2).
   */
  reglerQualite(niveau) {
    this.niveauQualite = niveau;
    this.effets = niveau >= 1;
    this.qualite = this.effets ? 0 : 2;
    const ratio = Math.min(niveau >= 3 ? 2 : niveau >= 2 ? 1.5 : 1, devicePixelRatio);
    if (ratio !== this.ratio) { this.ratio = ratio; this.taille(); }
    this.lent = 0;
    this.demander();
  }
  /** Ancien interrupteur des effets (gardé pour les appels existants). */
  reglerEffets(actifs) { this.reglerQualite(actifs ? Math.max(1, this.niveauQualite ?? 2) : 0); }

  /* ------------------------------------------------------------------ thème */
  appliquerTheme(T) {
    this.T = T;
    const m = this.mat, sombre = this.G && !this.G.classifie ? 0.93 : 1; // sans classes : bâtiments un peu plus sombres (moins fiables)
    // bâtiments de la couleur du sol : une maquette d'un seul matériau, le relief vient des ombres
    m.toit.color.set(T.sol).multiplyScalar(sombre); m.mur.color.set(T.sol).multiplyScalar(sombre);
    this.swiss?.materiau.color.set(T.sol);
    // socle de la même matière que le terrain et les bâtiments
    m.socle.color.set(T.sol); m.socleFond.color.set(T.sol); m.canopee.color.set(T.arbres[1]); m.parcelle.color.set(T.parcelle);
    m.eau.color.set(T.eau || (T.sombre ? "#2f5d6e" : "#8fc1c9")); // bleu-vert
    m.eauAnneau?.color.copy(m.eau.color); m.eauBord?.color.copy(m.eau.color); // bande du bord : même bleu-vert au changement de thème
    m.trait.color.set(T.coupe.trait); m.trait.jonction.uniforms.couleur.value.set(T.coupe.trait); m.poignee.color.set(T.coupe.trait); // poignées A et B à l'encre du trait de coupe, discrètes
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
    this.swiss?.vider({ garder: true }); // bâtiments swisstopo gardés d'un lieu à l'autre (D5)
    this.rayonExt = 0; this.argsAnneau = null;
    this.liberer(this.groupe); this.liberer(this.outils);
    for (const F of Object.values(this.fonds)) F.tex?.dispose();
    this.fonds = {};
    if (this.mat.terrain.map) { this.mat.terrain.map = null; this.mat.terrain.needsUpdate = true; }
    this.couches = {};
    this.poignees = [];
    this.coupe = this.contours = this.urls = null;
    CONTACT.reelActif.value = 0; for (const k of ["sol", "bati", "mur"]) this.reel?.[k].dispose(); this.reel = null;
    // la teinte de sélection du lieu précédent (grille d'une autre taille) ne doit pas déteindre sur le suivant, ni sur l'accueil
    CONTACT.tSel.value?.dispose(); CONTACT.tSel.value = null;
    this.contoursTous = this.volumes = this.batOrigine = this.nuage = this.grilleComp = null;
    if (this.loin.maille) { this.scene.remove(this.loin.maille); this.loin.maille.geometry.dispose(); this.loin.maille = null; }
    this.tuilesPlan.vider();
    this.idScene++;
  }

  /**
   * Retire les couches de la maquette fine (terrain, socle, bâtiments, arbres, eau, ponts, piscines, nuage brut, heures),
   * en gardant tout le reste : anneau, paysage, tuiles swisstopo, plan, fonds, caméra (voir construire, `remplacer`).
   */
  retirerFine() {
    const c = this.couches;
    for (const k of ["terrain", "socle", "bati", "canopee", "arbres", "limite", "eau", "ponts", "piscines", "couronnes", "tous", "heures"]) {
      const o = c[k];
      if (!o) continue;
      this.groupe.remove(o); this.liberer(o); c[k] = null;
    }
    CONTACT.tHeures.value?.dispose(); CONTACT.tHeures.value = null; CONTACT.heuresActif.value = 0;
    CONTACT.reelActif.value = 0; for (const k of ["sol", "bati", "mur"]) this.reel?.[k].dispose(); this.reel = null;
    CONTACT.tSel.value?.dispose(); CONTACT.tSel.value = null;
    this.contours = this.contoursTous = this.volumes = this.batOrigine = this.grilleComp = null;
  }

  /**
   * Construit la scène depuis les grilles. `urls` = { cadastre } (image du plan cadastral) ou null.
   * `remplacer` : bascule de la vue de base vers la maquette fine (ou changement de terrain) sans rien recharger : seules
   * les couches de la maquette changent ; l'altitude de référence, la caméra, l'anneau, le paysage et les tuiles restent.
   * `terrain` : "grille" (relevé 0,5 m, maillage de 1 m) ou "tin" (triangulation adaptative, posée dès qu'elle est
   * calculée) ; sans `terrain`, le choix précédent (terrainAffiche) est gardé.
   */
  construire(G, nuage, parcelle, urls, { remplacer = false, terrain: maillageSol = null } = {}) {
    if (maillageSol) this.modeTerrain = maillageSol;
    remplacer &&= !!this.G && this.zRef != null;
    if (remplacer) this.retirerFine(); else this.vider();
    this.G = G;
    // le nuage est gardé (tableaux typés X, Y, Z, C) : nuage brut construit à la demande, points proches de la coupe
    this.nuage = nuage;
    if (!remplacer) {
      this.urls = urls;
      this.zRef = solEn(G, 0, 0);
      const s = this.soleil.shadow.camera, R = G.R * 1.45;
      Object.assign(s, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 3000 });
      s.updateProjectionMatrix();
    }
    let zmin = Infinity;
    for (let p = 0; p < G.sol.length; p++) if (G.sol[p] < zmin) zmin = G.sol[p];
    this.zBas = zmin - this.zRef - Math.max(6, G.R * 0.05);
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
    const base = maille(socle(G, this.zRef, this.zBas), [m.socle, m.socleFond], false, false);
    const B = batiments(G, this.zRef), bati = new THREE.Group();
    bati.add(maille(B.toits, m.toit, true, true), maille(B.murs, m.mur, true, true));
    this.mat.profondeurBati ||= profondeurMontante();
    for (const o of bati.children) o.customDepthMaterial = this.mat.profondeurBati;
    bati.children.forEach(o => decouperBord(o, G.R - 0.03));
    this.contours = this.contoursTous = B.contours;
    this.grillesContact(G); // après les contours : le rythme de montée est tiré bâtiment par bâtiment
    // la canopée (grille) porte l'ombre des points ; sans points, styleArbres() construit des couronnes lissées
    const canopee = maille(nappeCanopee(G, this.zRef), m.canopee, true, false);
    // arbres toujours en points : sans relevé classé (repli raster), points tirés de la grille de végétation
    const arbres = nuage ? nuagePoints(nuage, G, this.zRef, "arbres", 0.5, 0.9) : nuagePoints(pointsVegetation(G), G, this.zRef, "arbres", 1, 0.9);
    const limite = contourParcelle(parcelle, G, this.zRef, m.parcelle);
    // lacs et étangs : un vrai plan, au niveau de l'eau
    const ge = plansEau(G, this.zRef), eau = ge ? maille(ge, m.eau, false, false) : null; // sans ombre portée (moiré)
    // bordure du lac au bord du cercle : bande d'eau du fond jusqu'à la surface (l'épaisseur du lac se lit dans la coupe)
    const gb = eau ? bordEauRond(G, this.zRef) : null;
    if (gb) { const mb = new THREE.Mesh(gb, this.mat.eauBord = Object.assign(m.eau.clone(), { side: THREE.DoubleSide })); mb.raycast = () => {}; eau.add(mb); }
    RAYON_EAU.value = G.rayonZone ? G.rayonZone - 0.02 : 1e9;
    // piscines : eau, parois et margelle sur le contour exact du cadastre (pas sur les cellules de la grille)
    const gpis = maillageBassins(G, this.zRef, THREE, (x, y) => [(x - G.x0) / (2 * G.R), (y - G.x0) / (2 * G.R)]);
    let piscines = null;
    if (gpis) {
      piscines = new THREE.Group();
      piscines.add(maille(gpis.eau, m.eau, false, false), maille(gpis.parois, m.mur, false, true), maille(gpis.fond, m.mur, false, true));
      if (G.rayonZone) piscines.children.forEach(o => decouperBord(o, G.R - 0.03));
    }
    // ponts : tablier (dalle et rives) avec le vide dessous, du même plâtre que les murs
    // la chaussée prend la matière du terrain (le plan, le grain, les couleurs réelles continuent sur le pont)
    // ponts allégés (par défaut : quelques centaines de triangles par pont) ou tels que relevés (cellule par cellule)
    // ponts modélisés à part (pontsModeles.js) : le pont reconstruit automatiquement est effacé à leur place
    const modeles = this.pontsModeles || [], { E: Ep, N: Np } = this.lieuPonts || { E: 0, N: 0 };
    let Gp = G;
    if (modeles.length && G.pont) {
      const pont = G.pont.slice();
      for (let j = 0; j < G.n; j++) for (let i = 0; i < G.n; i++) {
        const p = j * G.n + i;
        if (!isNaN(pont[p]) && modeles.some(P => dansPont(P, Ep, Np, G.x0 + (i + 0.5) * G.c, G.x0 + (j + 0.5) * G.c))) pont[p] = NaN;
      }
      Gp = { ...G, pont };
    }
    const gp = this.pontsDetailles ? tabliersPonts(Gp, this.zRef) : pontsLegers(Gp, this.zRef, nuage) || tabliersPonts(Gp, this.zRef);
    let ponts = null;
    if (gp || modeles.length) {
      ponts = new THREE.Group();
      if (gp) ponts.add(maille(gp.dessus, m.terrain, true, true), maille(gp.cotes, m.mur, true, true));
      for (const P of modeles) {
        // chaussée : matière du terrain (cadastre, photo, bruit, grain continuent sur le pont), le reste en plâtre
        const g = maillagePont(P, Ep, Np, this.zRef, (x, y) => solEn(G, Math.max(-G.R, Math.min(G.R, x)), Math.max(-G.R, Math.min(G.R, y))),
          (x, y) => [(x - G.x0) / (2 * G.R), (y - G.x0) / (2 * G.R)], { rayon: G.rayonZone });
        ponts.add(maille(g.dessus, m.terrain, true, true), maille(g.reste, m.mur, true, true));
      }
      // maquette ronde : la chaussée (matière du terrain, que le rendu ne découpe pas) est coupée au cercle, comme
      // le reste du pont l'est par le rendu ; sinon elle dépassait de 25 m sur l'anneau, sans rives ni dessous
      if (G.rayonZone) ponts.children.forEach(o => { if (o.material === m.terrain) o.geometry = decouperCercle(o.geometry, G.rayonZone - 0.03); });
      ponts.children.forEach(o => decouperBord(o, G.R - 0.03));
    }
    const nouvelles = { terrain: sol, socle: base, bati, canopee, arbres, limite, eau, ponts, piscines };
    if (remplacer) Object.assign(this.couches, nouvelles); else this.couches = nouvelles;
    for (const o of Object.values(nouvelles)) if (o) this.groupe.add(o);
    // la canopée qui porte l'ombre des points est un peu abaissée : le haut des couronnes reste au soleil,
    // l'intérieur et le bas s'assombrissent
    canopee.position.y = -0.8;
    this.styleArbres();
    this.appliquerCoupe();
    this.appliquerTheme(this.T);
    if (remplacer) {
      // anneau déjà là : son bord intérieur reprend le terrain de la nouvelle maquette (socle et bande d'eau fins cachés)
      if (this.argsAnneau && this.rayonExt > 0) this.construireAnneau(...this.argsAnneau);
      // tuiles swisstopo calées jusque-là sur le terrain seul : recalées sur les toits du relevé
      if (this.swiss?.tuiles && !G.provisoire) this.swiss.caler(G);
      this.majBords();
      this.ombres();
      return;
    }
    if (this.typeFond !== "cadastre") this.fond(this.typeFond);
    this.controls.target.set(0, 0, 0);
    this.vueDepart();
    if (this.modeVue) { const m = this.modeVue; this.modeVue = null; this.avant3D = null; this.vueOrtho(m); }
    this.ombres();
    if (this.modeTerrain === "tin") this.terrainAffiche("tin").catch(e => console.warn("Terrain TIN :", e.message));
  }

  /**
   * Maillage du terrain affiché : "grille" (relevé 0,5 m, sommets tous les 1 m) ou "tin" (terrainTIN.js, calculé dans
   * un Web Worker, gardé sur G). Les calculs (ombres, heures) restent sur la grille G.sol ; le profil de la coupe suit
   * le TIN (G.tin.hauteur). Promesse résolue une fois le maillage posé (false si le lieu a changé entre-temps).
   */
  async terrainAffiche(mode = "grille") {
    this.modeTerrain = mode;
    const G = this.G, o = this.couches?.terrain, id = this.idScene;
    if (!G || !o) return false;
    let geo;
    if (mode === "tin") {
      const tin = await calculerTerrainTIN(G);
      if (id !== this.idScene || this.modeTerrain !== "tin" || this.G !== G) return false;
      geo = maillageTIN(G, tin, this.zRef);
      G.tin = { ...geo.userData.tin, hauteur: hauteurTIN(G, tin) };
    } else {
      if (!o.geometry.userData.tin) return true;
      geo = terrain(G, this.zRef);
      G.tin = null;
    }
    o.geometry.dispose();
    o.geometry = geo;
    if (this.coupe) this.appliquerCoupe();
    this.demander();
    return true;
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
      if (c.releveAnneau) c.releveAnneau.visible = visibles;
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
    // swisstopo : seulement le groupe des bâtiments (les arbres 3D du vol, dans le même socle, gardent leurs calques)
    const jeux = { releve: c.bati, swiss: this.swiss?.tuiles?.group, roofer: c.roofer };
    for (const [j, o] of Object.entries(jeux)) {
      // anneau autour de la maquette fine : les bâtiments swisstopo y sont toujours montrés (au-delà du rayon fin)
      const anneau = j === "swiss" && (this.rayonExt > (this.G?.rayonZone || Infinity) || this.batiLoin());
      regler(o, (j === k.jeu || anneau) && k.batVoir, (j === k.jeu || anneau) && k.batOmbre);
    }
    this.majZone();
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
      grainPlatre(this.swiss.materiau, 0.07, "swiss");
      this.appliquerCoupe();
    }
    if (lieu) this.swiss.lieu = lieu;
    // montrés aussi avec le paysage : bâtiments swisstopo autour de la maquette, jusqu'à RAYON_BATI_LOIN
    this.swiss.montrer((!!actif || this.rayonExt > (this.G?.rayonZone || Infinity) || this.batiLoin()) && !!this.G);
    this.appliquerCalques();
    this.majBords();
    this.demander(5);
  }

  /** Paysage affiché : les bâtiments swisstopo l'habitent aussi, au-delà de la maquette (et de l'anneau). */
  batiLoin() { return !!(this.G?.rayonZone && this.loin?.voir && this.loin.maille && !this.modeVue); } // maquette ronde : la zone découpe le cercle

  /** Rayons de la zone des tuiles swisstopo : toute la maquette ronde (comparaison), ou seulement l'anneau (et le paysage). */
  majZone() {
    const Rf = this.G?.rayonZone, Rloin = this.batiLoin() ? RAYON_BATI_LOIN : 0;
    ZONE_FINE.zoneMax.value = Rf ? Rf - 0.03 : 1e9;
    ZONE_AO.zoneMax.value = Rf ? Math.max(Rf, this.rayonExt || 0) + 0.5 : 1e9;
    ZONE_BAS.value = Rf ? Math.min(this.zBas ?? -1e9, this.zBasAnneau ?? Infinity) + 0.05 : -1e9;
    if (!Rf) { ZONE.zoneMin.value = 0; ZONE.zoneMax.value = 1e9; return; }
    ZONE.zoneMax.value = Math.max(Rf, this.rayonExt || 0, Rloin) - 0.03;
    ZONE_ANNEAU.zoneMin.value = Rf - 0.03; ZONE_ANNEAU.zoneMax.value = Math.max(Rf, this.rayonExt || 0) - 0.03;
    ZONE.zoneMin.value = this.calques.jeu === "swiss" ? 0 : Rf - 0.03;
    this.demander();
  }

  /**
   * Anneau autour de la maquette fine (rayon `Rint`), jusqu'à `Rext` : terrain swissALTI3D à 2 m (`fin`, grille de
   * terrainAutour), bâtiments et arbres de swisstopo (tuiles chargées selon la vue, arbres en points), paroi du socle
   * au bord extérieur. `lieu` = { E, N } : centre MN95. Sans `fin` ou si Rext <= Rint : pas d'anneau.
   */
  construireAnneau(fin, Rint, Rext, lieu, lac = null) {
    const c = this.couches, G = this.G;
    this.argsAnneau = [fin, Rint, Rext, lieu, lac];
    for (const k of ["anneau", "socleAnneau", "eauAnneau", "releveAnneau"]) if (c[k]) { this.groupe.remove(c[k]); c[k].geometry.dispose(); c[k] = null; }
    if (this.mat.pointsAnneau) this.mat.pointsAnneau.visible = true;
    this.rayonExt = 0; this.zBasAnneau = null;
    // bande d'eau du cercle fin : seulement sans anneau (sinon elle serait au milieu du lac)
    const bandeFine = v => c.eau?.children.forEach(o => { o.visible = v; });
    if (!G || !fin || !(Rext > Rint + 5)) { c.socle && (c.socle.visible = true); bandeFine(true); this.majZone(); this.appliquerCalques(); return; }
    bandeFine(false);
    this.rayonExt = Rext;
    const { E, N } = lieu, H = fin.h;
    // lac de l'anneau : seulement là où le fond est mesuré (swissBATHY3D), ou sur la rive plate au niveau du lac à moins de
    // 20 m d'un fond mesuré. Un terrain bas ailleurs (vallon, rivière en aval) n'est ni creusé ni noyé.
    const fondMesure = (x, y) => lac?.fond?.(E + x, N + y) < lac.niveau - 0.1;
    const estLac = (x, y, z) => {
      if (!lac?.fond) return false;
      if (fondMesure(x, y)) return true;
      if (!(z <= lac.niveau + 0.8 && z >= lac.niveau - 0.5)) return false;
      return fondMesure(x + 20, y) || fondMesure(x - 20, y) || fondMesure(x, y + 20) || fondMesure(x, y - 20);
    };
    // terrain à 2 m tel quel (surface du lac comprise)
    const altBrut = (x, y) => {
      const fx = (E + x - fin.e0) / fin.c - 0.5, fy = (fin.n1 - (N + y)) / fin.c - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
      if (i < 0 || j < 0 || i >= fin.n - 1 || j >= fin.n - 1) return solEn(G, Math.max(-G.R, Math.min(G.R, x)), Math.max(-G.R, Math.min(G.R, y)));
      const p = j * fin.n + i;
      const z = (H[p] * (1 - u) + H[p + 1] * u) * (1 - v) + (H[p + fin.n] * (1 - u) + H[p + fin.n + 1] * u) * v;
      return isNaN(z) ? solEn(G, Math.max(-G.R, Math.min(G.R, x)), Math.max(-G.R, Math.min(G.R, y))) : z;
    };
    const altFin = (x, y) => {
      let z = altBrut(x, y);
      // lac : le terrain à 2 m donne la surface de l'eau ; le fond mesuré (ou 3 m plus bas) la remplace
      // la surface du lac du terrain à 2 m est un peu plus haute que le niveau mesuré par le laser (~0,5 m)
      if (lac && z <= lac.niveau + 0.8 && estLac(x, y, z)) {
        const f = lac.fond?.(E + x, N + y);
        if (f < lac.niveau - 0.1) z = f;
        else {
          // sans fond mesuré : le fond de la maquette fine au bord, dans la même direction (pas de bourrelet au raccord)
          const r = Math.hypot(x, y) || 1, b = solEn(G, x * (Rint - 1) / r, y * (Rint - 1) / r);
          z = b < lac.niveau - 0.5 ? b : lac.niveau - 3;
        }
      }
      return z;
    };
    this.altAnneau = altFin;
    // maillage polaire : environ 3 m le long du cercle extérieur, 2,5 m en rayon ; le bord intérieur suit le terrain fin
    const nA = Math.min(4096, Math.max(512, Math.ceil(2 * Math.PI * Rext / 3))), nR = Math.max(2, Math.ceil((Rext - Rint) / 2.5) + 1);
    const pos = new Float32Array(nA * nR * 3), uv = new Float32Array(nA * nR * 2);
    for (let a = 0; a < nA; a++) {
      const t = a / nA * 2 * Math.PI, cx = Math.cos(t), cy = Math.sin(t);
      for (let k = 0; k < nR; k++) {
        const r = Rint + (Rext - Rint) * k / (nR - 1), x = cx * r, y = cy * r, q = a * nR + k;
        // raccord : le bord intérieur prend exactement le terrain de la maquette, puis glisse vers le 2 m sur 6 m
        const w = Math.min(1, (r - Rint) / 6), z = k === 0 ? solEn(G, x, y) : solEn(G, x * Rint / r, y * Rint / r) * (1 - w) + altFin(x, y) * w;
        pos.set([x, z - this.zRef, -y], 3 * q);
        uv.set([(x - G.x0) / (2 * G.R), (y - G.x0) / (2 * G.R)], 2 * q);
      }
    }
    // index typé, rempli d'un coup (jusqu'à ~3,5 M d'entrées : plus de push) : D10
    const idx = nA * nR < 65536 ? new Uint16Array(nA * (nR - 1) * 6) : new Uint32Array(nA * (nR - 1) * 6);
    for (let a = 0, w = 0; a < nA; a++) {
      const a2 = (a + 1) % nA;
      for (let k = 0; k < nR - 1; k++, w += 6) { const p = a * nR + k, q = a2 * nR + k; idx[w] = p; idx[w + 1] = p + 1; idx[w + 2] = q; idx[w + 3] = q; idx[w + 4] = p + 1; idx[w + 5] = q + 1; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    // même matière que le paysage : plan cadastral en tuiles, grain, brume (la maquette fine garde son plan propre)
    // matière du paysage (mêmes uniformes : plan, lacs, grain), mais à part : elle reçoit le plan de coupe
    this.mat.anneau ||= materiauLointain(this.loin.mat.uniforms, { degrade: true });
    c.anneau = new THREE.Mesh(g, this.mat.anneau);
    c.anneau.receiveShadow = true;
    this.groupe.add(c.anneau);
    // la paroi du socle passe au bord extérieur (jusqu'au niveau de l'eau là où le lac la touche)
    if (c.socle) c.socle.visible = false;
    // fond plat du socle : sous le point le plus bas de tout le bord (terrain ou fond du lac), lu tout autour du cercle.
    // Avec seulement quatre points lus, un grand cercle qui descend plus bas que la maquette fine (versant, fond du
    // Léman) avait des pans de paroi sous le fond : paroi retournée, dont le bas suivait le terrain (bord dentelé).
    const nBord = Math.min(4096, Math.max(256, Math.ceil(2 * Math.PI * Rext)));
    let zMinBord = Infinity;
    // altitudes impossibles en Suisse (donnée corrompue) : ignorées, elles descendaient le fond à des millions de mètres
    for (let k = 0; k < nBord; k++) { const a = k / nBord * 2 * Math.PI, z = altFin(Math.cos(a) * Rext, Math.sin(a) * Rext); if (z > -50 && z < 5000 && z < zMinBord) zMinBord = z; }
    if (!isFinite(zMinBord)) zMinBord = this.zRef + (this.zBas ?? -50);
    const zBasA = Math.min(lac ? Math.min(this.zBas, lac.niveau - this.zRef - 60) : this.zBas, zMinBord - this.zRef - 8);
    this.zBasAnneau = zBasA;
    // la paroi s'arrête au fond du lac : au-dessus, la bordure est de l'eau (bande translucide, plus bas)
    c.socleAnneau = new THREE.Mesh(socleRond(Rext, (x, y) => altFin(x, y), this.zRef, zBasA), [this.mat.socle, this.mat.socleFond]);
    // eau de l'anneau : un plan au niveau du lac, coupé au cercle extérieur ; le terrain plus haut le cache
    RAYON_EAU.value = G.rayonZone ? G.rayonZone - 0.02 : 1e9; // sans lac dans l'anneau : l'eau fine va jusqu'au cercle
    if (lac) {
      // plan d'eau au niveau du lac, seulement sur les cases du lac (fond mesuré ou rive au niveau) et leurs voisines :
      // jamais un disque entier, qui noyait tout terrain plus bas que le lac dans l'anneau
      const nA2 = 1024, pts = [], lvl = lac.niveau - this.zRef, rr = [Rint - 2];
      for (let r = Rint; r < Rext; r += 6) rr.push(r);
      rr.push(Rext);
      const nRr = rr.length, dansLac = new Uint8Array(nA2 * nRr);
      for (let a = 0; a < nA2; a++) for (let k = 0; k < nRr; k++) {
        const t = a / nA2 * 2 * Math.PI, r = Math.max(Rint, Math.min(Rext - 0.5, rr[k])), x = Math.cos(t) * r, y = Math.sin(t) * r;
        if (estLac(x, y, altBrut(x, y))) dansLac[a * nRr + k] = 1;
      }
      const P = (t, r) => [Math.cos(t) * r, lvl, -Math.sin(t) * r];
      for (let a = 0; a < nA2; a++) {
        const a2 = (a + 1) % nA2, t0 = a / nA2 * 2 * Math.PI, t1 = (a + 1) / nA2 * 2 * Math.PI;
        for (let k = 0; k < nRr - 1; k++) {
          if (!(dansLac[a * nRr + k] || dansLac[a * nRr + k + 1] || dansLac[a2 * nRr + k] || dansLac[a2 * nRr + k + 1])) continue;
          // raccord avec l'eau fine sur un cercle commun, 2 m en deçà du cercle fin (l'eau fine finit en escalier de
          // cases : des lames sombres restaient entre les deux)
          const r0 = rr[k], r1 = rr[k + 1];
          pts.push(...P(t0, r0), ...P(t0, r1), ...P(t1, r1), ...P(t0, r0), ...P(t1, r1), ...P(t1, r0));
        }
      }
      const ge = new THREE.BufferGeometry();
      ge.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      const nor = new Float32Array(pts.length); for (let k = 1; k < nor.length; k += 3) nor[k] = 1;
      ge.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      // bordure du lac au bord du cercle : bande verticale d'eau, du fond jusqu'au niveau (juste en deçà du bord, où
      // l'eau est coupée)
      const bord = [], Rb = Rext - 0.05, nB = Math.min(4096, Math.max(512, Math.ceil(2 * Math.PI * Rext / 3)));
      for (let a = 0; a < nB; a++) {
        const t0 = a / nB * 2 * Math.PI, t1 = (a + 1) / nB * 2 * Math.PI;
        const z0 = altFin(Math.cos(t0) * Rb, Math.sin(t0) * Rb), z1 = altFin(Math.cos(t1) * Rb, Math.sin(t1) * Rb);
        if (!(z0 < lac.niveau || z1 < lac.niveau)) continue;
        if (!(estLac(Math.cos(t0) * Rb, Math.sin(t0) * Rb, z0) || estLac(Math.cos(t1) * Rb, Math.sin(t1) * Rb, z1))) continue; // pas de bande hors du lac
        const b0 = Math.min(z0, lac.niveau) - this.zRef, b1 = Math.min(z1, lac.niveau) - this.zRef;
        const A = [Math.cos(t0) * Rb, -Math.sin(t0) * Rb], B = [Math.cos(t1) * Rb, -Math.sin(t1) * Rb];
        bord.push(A[0], b0, A[1], B[0], b1, B[1], B[0], lvl, B[1], A[0], b0, A[1], B[0], lvl, B[1], A[0], lvl, A[1]);
      }
      if (bord.length) {
        const gb = new THREE.BufferGeometry();
        gb.setAttribute("position", new THREE.Float32BufferAttribute(bord, 3));
        normalesVersLeHaut(gb);
        ge.userData.bord = gb;
      }
      this.mat.eauAnneau ||= matEau(RAYON_EAU_ANNEAU, RAYON_EAU_INT);
      this.mat.eauAnneau.color.copy(this.mat.eau.color);
      c.eauAnneau = new THREE.Mesh(ge, this.mat.eauAnneau);
      if (ge.userData.bord) { const mb = new THREE.Mesh(ge.userData.bord, this.mat.eauBord = Object.assign(this.mat.eau.clone(), { side: THREE.DoubleSide })); mb.raycast = () => {}; c.eauAnneau.add(mb); }
      c.eauAnneau.receiveShadow = false; // pas d'ombre portée sur l'eau : sur ce grand plan plat, elle faisait du moiré
      this.groupe.add(c.eauAnneau);
      RAYON_EAU_ANNEAU.value = Rext - 0.02; RAYON_EAU_INT.value = Rint - 0.75;
      RAYON_EAU.value = Rint - 0.75; // l'eau fine s'arrête là où commence celle de l'anneau
    }
    this.groupe.add(c.socleAnneau);
    // ombres sur tout l'anneau
    const sc = this.soleil.shadow.camera, Rs = Rext * 1.15;
    Object.assign(sc, { left: -Rs, right: Rs, top: Rs, bottom: -Rs, far: Math.max(sc.far, 6000) });
    sc.updateProjectionMatrix();
    // bâtiments et arbres swisstopo
    this.comparerSwiss(true, lieu);
    if (!this.mat.pointsAnneau) {
      const pts = this.mat.pointsAnneau = materiauPoints(1.1, false);
      pts.uniforms.relief.value = 0;
      const v2 = new THREE.Vector2();
      pts.onBeforeRender = (r, sc2, cam) => { pts.uniforms.echelle.value = r.getDrawingBufferSize(v2).y / (2 * Math.tan(cam.fov * Math.PI / 360)); };
    }
    ["c1", "c2", "c3"].forEach((u, i) => this.mat.pointsAnneau.uniforms[u].value.set(this.T.arbres[i]));
    this.swiss.chargerArbres({ couronne: this.mat.couronne, tronc: this.mat.mur, points: this.mat.pointsAnneau, calqueOmbre: CALQUE_OMBRE, zone: [Rint, Rext - 6] }, 10); // couronnes (jusqu'à ~6 m) entières dans le cercle : pas de points qui débordent sur la paroi
    // ponts de l'anneau : swissTLM3D (légers), coupés au cercle fin et au bord ; nos ponts modélisés à part y sont ajoutés
    // tuiles sans normales : éclairage par facette
    if (!this.mat.pontsAnneau) { this.mat.pontsAnneau = new THREE.MeshStandardMaterial({ color: this.T.mur, roughness: 1, flatShading: true, side: THREE.DoubleSide }); decoupeZone(this.mat.pontsAnneau, ZONE_ANNEAU); }
    this.swiss.chargerPonts(this.mat.pontsAnneau);
    this.appliquerCoupe();
    this.majZone();
    this.appliquerCalques();
    this.ombres();
  }

  /**
   * Arbres de l'anneau tirés du relevé laser (points de végétation mesurés, moins denses que dans la maquette fine) :
   * ils remplacent les arbres générés de swisstopo, qui ne gardent que leur ombre. `nuage` null : retour aux arbres
   * swisstopo. Coordonnées du nuage relatives au centre ; altitudes absolues.
   */
  arbresReleveAnneau(nuage, Rint, Rext) {
    const c = this.couches;
    if (c.releveAnneau) { this.groupe.remove(c.releveAnneau); c.releveAnneau.geometry.dispose(); c.releveAnneau = null; }
    if (this.mat.pointsAnneau) this.mat.pointsAnneau.visible = !nuage;
    if (!nuage || !this.altAnneau || !(Rext > Rint)) return;
    const { X, Y, Z, C } = nuage, veg = cl => cl === 3 || cl === 4 || cl === 5, r0 = Rint * Rint, r1 = (Rext - 1.2) ** 2; // points (taille ~1 m à l'écran) gardés en deçà du bord : pas de points sombres sur la paroi
    // sommet de la végétation par case de 4 m : hauteur relative de chaque point dans sa couronne (teinte)
    const pas = 4, nc = Math.ceil(2 * Rext / pas) + 1, haut = new Float32Array(nc * nc).fill(-Infinity), cle = (x, y) => Math.floor((y + Rext) / pas) * nc + Math.floor((x + Rext) / pas);
    const garde = [], sols = [];
    for (let k = 0; k < nuage.n; k++) {
      if (!veg(C[k])) continue;
      const x = X[k], y = Y[k], d = x * x + y * y;
      if (d < r0 || d > r1) continue;
      const sol = this.altAnneau(x, y);
      if (!(Z[k] - sol > 1.5)) continue; // herbe, buissons bas, et la végétation posée sur l'eau du lac
      garde.push(k); sols.push(sol);
      const q = cle(x, y); if (Z[k] > haut[q]) haut[q] = Z[k];
    }
    if (!garde.length) { this.mat.pointsAnneau && (this.mat.pointsAnneau.visible = true); return; }
    const n = garde.length, pos = new Float32Array(3 * n), rel = new Float32Array(n), va = new Float32Array(n);
    for (let q = 0; q < n; q++) {
      const k = garde[q], x = X[k], y = Y[k], z = Z[k], h = haut[cle(x, y)] - sols[q];
      rel[q] = h > 1 ? Math.min(1, Math.max(0, (z - sols[q]) / h)) : 0.5;
      const a = Math.sin(Math.floor(x / 6) * 127.1 + Math.floor(y / 6) * 311.7) * 43758.5453, b = Math.sin(k * 12.9898) * 43758.5453;
      va[q] = Math.min(0.999, 0.75 * (a - Math.floor(a)) + 0.25 * (b - Math.floor(b)));
      pos[3 * q] = x; pos[3 * q + 1] = z - this.zRef; pos[3 * q + 2] = -y;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRel", new THREE.BufferAttribute(rel, 1));
    g.setAttribute("aVar", new THREE.BufferAttribute(va, 1));
    if (!this.mat.releveAnneau) {
      const m = this.mat.releveAnneau = materiauPoints(1.4, false), v2 = new THREE.Vector2();
      m.uniforms.relief.value = 0;
      m.onBeforeRender = (r, sc, cam) => { m.uniforms.echelle.value = r.getDrawingBufferSize(v2).y / (2 * Math.tan(cam.fov * Math.PI / 360)); };
    }
    ["c1", "c2", "c3"].forEach((u, i) => this.mat.releveAnneau.uniforms[u].value.set(this.T.arbres[i]));
    c.releveAnneau = new THREE.Points(g, this.mat.releveAnneau);
    c.releveAnneau.receiveShadow = true;
    c.releveAnneau.frustumCulled = false;
    c.releveAnneau.visible = this.arbresVisibles ?? true;
    this.groupe.add(c.releveAnneau);
    this.appliquerCoupe();
    if (this.etatSoleil) this.placerSoleil(...this.etatSoleil);
    this.demander(2);
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
      if (!this.G.rayonZone && this.swiss) this.swiss.reutilisable = false; // géométrie découpée : pas réutilisable ailleurs
      if (!this.G.rayonZone) for (const o of [this.swiss?.socle, this.couches.roofer]) o?.traverse(m => m.isMesh && decouperBord(m, this.G.R - 0.03));
      this.majZone();
      base.geometry.dispose();
      base.geometry = socle(this.G, this.zRef, this.zBas, objets.length ? (this.G.rayonZone ? hauteursDessus(this.G, this.zRef, objets) : hauteursBords(this.G, this.zRef, objets)) : null, releve);
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
      // swisstopo : les tuiles hors de l'écran sont détachées du groupe par 3d-tiles-renderer ; on les rattache le temps
      // de la lecture, sinon les bâtiments hors champ au moment du calcul manquaient dans la coupe
      const t = jeu === "swiss" ? this.swiss?.tuiles : null, rattachees = [];
      t?.forEachLoadedModel(sc => { if (!sc.parent) { t.group.add(sc); rattachees.push(sc); } });
      try { this.grilleComp = { jeu, h: o && this.G ? hauteursDessus(this.G, this.zRef, [o]) : null }; }
      finally { for (const sc of rattachees) t.group.remove(sc); }
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
      if (t.object === this.couches.terrain) return -1;
      const u = t.object.geometry.userData; // géométrie découpée au bord : un volume par triangle
      return u.volumesTri ? u.volumesTri[t.faceIndex] : u.volumes[t.faceIndex >> 1];
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
        const g = m.userData.geomOrig || m.geometry, P = g.attributes.position.array, I = g.index?.array, V = g.userData.volumes;
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

  /**
   * « Plan laser » pendant le dessin d'un volume : murs verticaux de lumière le long de l'emprise (un point, un côté ou
   * le rectangle), qui montent très haut en s'effaçant, pour voir où l'on dessine malgré les bâtiments et les arbres.
   * `pts` = coins relatifs (x est, y nord) ; `ferme` = polygone fermé ; null retire le laser.
   */
  laserVolume(pts, ferme = false) {
    const c = this.couches;
    if (c.laser) { this.groupe.remove(c.laser); c.laser.geometry.dispose(); c.laser = null; }
    if (pts?.length && this.G) {
      if (!this.mat.laser) {
        // dégradé : vif au sol (liseré net au pied), puis de moins en moins visible en montant (canal vert = opacité)
        const cv = document.createElement("canvas"); cv.width = 1; cv.height = 512;
        const x = cv.getContext("2d"), img = x.createImageData(1, 512);
        for (let j = 0; j < 512; j++) {
          const v = j / 511, a = 0.1 * Math.pow(1 - v, 4) + (v < 0.01 ? 0.3 : 0);
          img.data.set([255, Math.round(255 * Math.min(1, a)), 255, 255], (511 - j) * 4);
        }
        x.putImageData(img, 0, 0);
        const tex = new THREE.CanvasTexture(cv);
        // mélange additif : le résultat ne dépend pas de l'ordre des faces (sinon les murs transparents qui se recouvrent
        // dessinaient des triangles)
        this.mat.laser = new THREE.MeshBasicMaterial({ alphaMap: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending });
      }
      this.mat.laser.color.set(this.T.parcelle);
      const H = 150, pos = [], h = [];
      // un point seul : deux plans en croix de 0,6 m, comme un faisceau
      const P = pts.length === 1 ? [[pts[0][0] - 0.3, pts[0][1]], [pts[0][0] + 0.3, pts[0][1]], null, [pts[0][0], pts[0][1] - 0.3], [pts[0][0], pts[0][1] + 0.3]] : pts;
      const bas = p => solEn(this.G, p[0], p[1]) - this.zRef - 0.3;
      const n = P.length, aretes = [];
      for (let k = 0; k + 1 < n; k++) if (P[k] && P[k + 1]) aretes.push([P[k], P[k + 1]]);
      if (ferme && n > 2) aretes.push([P[n - 1], P[0]]);
      for (const [a, b] of aretes) {
        const za = bas(a), zb = bas(b);
        const A0 = [a[0], za, -a[1]], B0 = [b[0], zb, -b[1]], A1 = [a[0], za + H, -a[1]], B1 = [b[0], zb + H, -b[1]];
        pos.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
        h.push(0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(h, 2));
      const m = c.laser = new THREE.Mesh(g, this.mat.laser);
      m.renderOrder = 5; m.frustumCulled = false;
      this.groupe.add(m);
    }
    this.demander();
  }

  /**
   * Volumes du projet (mode pro), dans leur couleur (blanc chaud par défaut) : ils portent et reçoivent les ombres,
   * entrent dans la coupe ; `apercu` = volume en cours de dessin (transparent, sans ombre).
   */
  afficherVolumes(volumes, apercu = null) {
    const c = this.couches;
    for (const k of ["volumes", "apercuVolume"]) if (c[k]) { this.groupe.remove(c[k]); c[k].traverse(o => o.geometry?.dispose()); c[k] = null; }
    if (!this.G) return;
    this.mat.projets ||= new Map();
    // matériau par couleur et opacité (volume translucide : on voit à travers, il porte toujours ses ombres)
    const matVolume = (couleur, opacite = 1) => {
      couleur ||= "#fbf7ee";
      const cle = `${couleur}|${opacite}`;
      let m = this.mat.projets.get(cle);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color: couleur, roughness: 0.9, side: THREE.DoubleSide, transparent: opacite < 1, opacity: opacite, depthWrite: opacite >= 1 });
        grainPlatre(m, 0.05); this.mat.projets.set(cle, m);
      }
      return m;
    };
    if (!this.mat.projets.has("etages")) this.mat.projets.set("etages", new THREE.LineBasicMaterial({ color: "#3a332c", transparent: true, opacity: 0.55 }));
    if (!this.mat.apercu) {
      // aperçu du dessin : faces planes translucides, une seule épaisseur (la passe de profondeur cache les faces arrière,
      // sinon les faces qui se recouvrent dessinaient des triangles plus foncés), arêtes nettes
      this.mat.apercu = new THREE.MeshBasicMaterial({ color: this.T.parcelle, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, depthFunc: THREE.LessEqualDepth, fog: false });
      this.mat.apercuProfondeur = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
      this.mat.apercuArete = new THREE.LineBasicMaterial({ color: this.T.parcelle, fog: false });
    }
    if (volumes?.length) {
      const g = c.volumes = new THREE.Group();
      for (const v of volumes) {
        if (v.visible === false) continue;
        const op = Math.max(0.1, Math.min(1, v.opacite ?? 1)), m = new THREE.Mesh(volumeGeometrie(v, this.G, this.zRef), matVolume(v.couleur, op));
        m.castShadow = m.receiveShadow = true; m.userData.volume = v.id;
        if (op < 1) {
          // translucide : une passe de profondeur d'abord, pour ne voir que les faces avant (pas l'intérieur du volume)
          if (!this.mat.projets.has("profondeur")) this.mat.projets.set("profondeur", new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, side: THREE.DoubleSide }));
          const p = new THREE.Mesh(m.geometry, this.mat.projets.get("profondeur"));
          p.renderOrder = 2; p.raycast = () => {};
          m.renderOrder = 3; m.add(p);
        }
        // étages : traits sur les façades (hors des clics et du calcul des hauteurs, qui ne voient que les maillages)
        const e = v.traits !== false && traitsEtages(v, this.zRef, this.G);
        if (e) {
          const ge = new THREE.BufferGeometry(); ge.setAttribute("position", new THREE.BufferAttribute(e, 3));
          const l = new THREE.LineSegments(ge, this.mat.projets.get("etages"));
          l.raycast = () => {};
          m.add(l);
        }
        g.add(m);
      }
      this.groupe.add(g);
    }
    // réglage de la couleur en direct : les matériaux des teintes de passage sont libérés
    if (this.mat.projets.size > 24) {
      const servis = new Set();
      c.volumes?.traverse(o => o.material && servis.add(o.material));
      for (const [cle, m] of this.mat.projets) if (cle.includes("|") && !servis.has(m)) { m.dispose(); this.mat.projets.delete(cle); }
    }
    if (apercu) {
      const geo = volumeGeometrie(apercu, this.G, this.zRef), g = c.apercuVolume = new THREE.Group();
      const prof = new THREE.Mesh(geo, this.mat.apercuProfondeur), face = new THREE.Mesh(geo, this.mat.apercu), aretes = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), this.mat.apercuArete);
      prof.renderOrder = 3; face.renderOrder = 4; aretes.renderOrder = 4;
      g.add(prof, face, aretes);
      this.groupe.add(g);
    }
    this.appliquerCoupe();
    if (!apercu) this.ombres(); else this.demander();
  }

  /**
   * Couleurs réelles du sol et des bâtiments, tirées de l'orthophoto SWISSIMAGE par catégorie (le nuage de points n'a pas
   * de couleur) : sol = la photo là où le sol est dégagé, sinon (sous les arbres) la couleur du sol dégagé le plus proche ;
   * bâtiments = la couleur de leur toit, reprise par leurs façades. Deux petites textures alignées sur la grille.
   */
  async couleursReellesModele(actif) {
    this.reelModele = !!actif;
    if (!actif) { CONTACT.reelActif.value = 0; this.demander(); return; }
    const G = this.G, id = this.idScene;
    if (!G || !this.urls?.ortho) return;
    if (!this.reel || this.reel.id !== id) {
      const img = await chargerImage(this.urls.ortho), cv = document.createElement("canvas");
      if (id !== this.idScene) return;
      const W = cv.width = img.naturalWidth, H = cv.height = img.naturalHeight, ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, W, H).data, { n, c, x0, R } = G;
      const couleur = (i, j) => { // moyenne des pixels de la cellule
        const xa = Math.floor((x0 + i * c + R) / (2 * R) * W), xb = Math.max(xa + 1, Math.floor((x0 + (i + 1) * c + R) / (2 * R) * W));
        const ya = Math.floor((R - (x0 + (j + 1) * c)) / (2 * R) * H), yb = Math.max(ya + 1, Math.floor((R - (x0 + j * c)) / (2 * R) * H));
        let r = 0, g = 0, b = 0, k = 0;
        for (let y = Math.max(0, ya); y < Math.min(H, yb); y++) for (let x = Math.max(0, xa); x < Math.min(W, xb); x++) { const p = 4 * (y * W + x); r += px[p]; g += px[p + 1]; b += px[p + 2]; k++; }
        return k ? [r / k, g / k, b / k] : null;
      };
      // couleur des cellules de la bonne catégorie, puis, de proche en proche (parcours en largeur), celle de la cellule
      // valide la plus proche pour les autres, jusqu'à `portee` cellules
      const remplir = (ok, portee, valeur = couleur) => {
        const col = new Float32Array(n * n * 3), dist = new Int32Array(n * n).fill(-1), file = new Int32Array(n * n);
        let tete = 0, queue = 0;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const p = j * n + i;
          if (!ok(p)) continue;
          const v = valeur(i, j);
          if (v) { col.set(v, 3 * p); dist[p] = 0; file[queue++] = p; }
        }
        while (tete < queue) {
          const p = file[tete++], i = p % n;
          if (dist[p] >= portee) continue;
          for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n]) {
            if (q < 0 || q >= n * n || dist[q] >= 0) continue;
            dist[q] = dist[p] + 1; col[3 * q] = col[3 * p]; col[3 * q + 1] = col[3 * p + 1]; col[3 * q + 2] = col[3 * p + 2];
            file[queue++] = q;
          }
        }
        const d = new Uint8Array(n * n * 4);
        for (let p = 0; p < n * n; p++) { d[4 * p] = col[3 * p]; d[4 * p + 1] = col[3 * p + 1]; d[4 * p + 2] = col[3 * p + 2]; d[4 * p + 3] = 255; }
        const tex = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
        tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
        return tex;
      };
      const solDegage = p => isNaN(G.bat[p]) && !(G.veg[p] - G.sol[p] > 0.8);
      // façades : une seule couleur par bâtiment, la moyenne de son toit (sinon des bandes verticales, d'une cellule à l'autre)
      const seg = this.contours?.seg, moyennes = new Map();
      if (seg) for (let p = 0; p < n * n; p++) {
        if (isNaN(G.bat[p]) || seg[p] < 0) continue;
        const v = couleur(p % n, Math.floor(p / n)); if (!v) continue;
        const m = moyennes.get(seg[p]) || [0, 0, 0, 0];
        m[0] += v[0]; m[1] += v[1]; m[2] += v[2]; m[3]++; moyennes.set(seg[p], m);
      }
      const murEn = (i, j) => { const m = moyennes.get(seg?.[j * n + i]); return m ? [m[0] / m[3], m[1] / m[3], m[2] / m[3]] : couleur(i, j); };
      this.reel = { id, sol: remplir(solDegage, 1e6), bati: remplir(p => !isNaN(G.bat[p]), 6), mur: remplir(p => !isNaN(G.bat[p]), 6, murEn) };
    }
    if (!this.reelModele || id !== this.idScene) return;
    CONTACT.tReelSol.value = this.reel.sol; CONTACT.tReelBati.value = this.reel.bati; CONTACT.tReelMur.value = this.reel.mur; CONTACT.reelActif.value = 1;
    this.demander();
  }

  /** Hauteurs (absolues, grille de G) des volumes et modèles importés du projet vus de dessus, ou null s'il n'y en a pas. */
  hauteursVolumes() {
    const objets = [this.couches.volumes, this.couches.imports].filter(Boolean);
    return objets.length && this.G ? hauteursDessus(this.G, this.zRef, objets) : null;
  }

  /** Modèles importés du projet (groupes de importerModele), coupés au bord de la maquette, avec ombres. */
  afficherImports(objets) {
    const c = this.couches;
    if (c.imports) { this.groupe.remove(c.imports); c.imports = null; }
    if (objets?.length && this.G) {
      const g = c.imports = new THREE.Group();
      for (const o of objets) {
        o.traverse(m => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; decouperBord(m, this.G.R - 0.03); } });
        g.add(o);
      }
      this.groupe.add(g);
    }
    this.appliquerCoupe();
    this.ombres();
  }

  /** Volume du projet sous le pointeur (id), ou null. */
  volumeVise(e) {
    const g = this.couches.volumes;
    if (!g) return null;
    const t = this.viser(e).intersectObjects(g.children)[0];
    return t ? t.object.userData.volume : null;
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
    // cellules dans la parcelle : par lignes (mêmes croisements que `dans`, calculés une fois par ligne) ; cellule par
    // cellule, une grande parcelle (rivière, route : des milliers de sommets) bloquait la page plusieurs secondes
    if (anneaux.length) for (let j = 0; j < n; j++) {
      const y = x0 + (j + 0.5) * c, xs = [];
      for (const a of anneaux) for (let i = 0, k = a.length - 1; i < a.length; k = i++) {
        const [xi, yi] = a[i], [xk, yk] = a[k];
        if ((yi > y) !== (yk > y)) xs.push((xk - xi) * (y - yi) / (yk - yi) + xi);
      }
      if (!xs.length) continue;
      xs.sort((u, v) => u - v);
      // cellule dedans : nombre impair de croisements à sa droite (x < croisement)
      let q = 0;
      for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.5) * c;
        while (q < xs.length && !(x < xs[q])) q++;
        if ((xs.length - q) % 2 === 0) continue;
        const p = j * n + i;
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
    // rythme de montée : une valeur au hasard par bâtiment (segment des contours), élargie de 1,5 m autour (murs au
    // bord des cellules) ; cellules voisines lues sans interpolation, pour qu'un bâtiment monte d'un seul bloc
    const seg = this.contours?.seg, ry = new Float32Array(n * n).fill(NaN);
    const hasard = v => { const x = Math.sin(v * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
    for (let p = 0; p < n * n; p++) if (!isNaN(bat[p])) ry[p] = hasard(seg && seg[p] >= 0 ? seg[p] + 1 : Math.floor(p / n / 12) * 97 + Math.floor((p % n) / 12));
    for (let passe2 = 0; passe2 < 3; passe2++) {
      const avant = ry.slice();
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const p = j * n + i;
        if (!isNaN(avant[p])) continue;
        const v = [avant[p - 1], avant[p + 1], avant[p - n], avant[p + n]].find(x => !isNaN(x));
        if (v !== undefined) ry[p] = v;
      }
    }
    for (let p = 0; p < n * n; p++) if (isNaN(ry[p])) ry[p] = 0.5;
    const tr = tex(ry); tr.magFilter = tr.minFilter = THREE.NearestFilter;
    CONTACT.tRythme.value?.dispose(); CONTACT.tRythme.value = tr;
    CONTACT.grille.value.set(G.x0, n * c, 0);
    CONTACT.contactActif.value = 1;
  }

  /**
   * Chargement visible : les points du relevé apparaissent bloc par bloc pendant le téléchargement (sol beige,
   * végétation verte, le reste gris), sur le nouveau lieu ; l'ancienne maquette est masquée. `R` : rayon du lieu.
   */
  debutChargement(total, R, { garderVue = false, z0 = null } = {}) {
    this.finChargement();
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(3 * total), col = new Uint8Array(3 * total);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3, true));
    geo.setDrawRange(0, 0);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, fog: false }));
    pts.frustumCulled = false;
    this.chargementPts = { pts, n: 0, z0, R, garderVue }; // z0 connu (accueil) : les points sont déjà à la hauteur de la maquette
    this.groupe.visible = false;
    if (this.swiss) this.swiss.socle.visible = false;
    if (this.loin.maille) this.loin.maille.visible = false;
    this.scene.add(pts);
    this.demander(2);
  }
  ajouterBloc(X, Y, Z, C, n) {
    const c = this.chargementPts;
    if (!c || !n) return;
    const geo = c.pts.geometry, pos = geo.attributes.position.array, col = geo.attributes.color.array, cap = pos.length / 3;
    if (c.z0 === null) {
      // altitude de référence provisoire : le sol bas du premier bloc ; la caméra se place sur le lieu
      let m = Infinity; for (let k = 0; k < n; k++) if (C[k] === 2 && Z[k] < m) m = Z[k];
      c.z0 = isFinite(m) ? m : Z[0];
      const R = c.R || 150;
      // accueil : la caméra suit déjà son trajet, on ne la déplace pas
      if (!c.garderVue) { this.camera.position.set(-R * 0.9, R * 0.75, R * 1.1); this.controls.target.set(0, 0, 0); this.controls.update(); }
    }
    const COUL = { 2: [205, 190, 160], 3: [110, 150, 80], 4: [100, 145, 75], 5: [90, 135, 70], 6: [170, 165, 160], 9: [120, 170, 185], 17: [150, 150, 150] };
    // au plus ~40 000 points par bloc (le dessin reste léger), tirés au hasard plutôt qu'à pas régulier
    const part = Math.min(1, 40000 / n);
    c.vis ??= 0;
    for (let k = 0; k < n && c.n < cap; k++) {
      if (part < 1 && Math.random() > part) continue;
      const q = c.n++, cl = COUL[C[k]] || [160, 160, 165];
      pos[3 * q] = X[k]; pos[3 * q + 1] = Z[k] - c.z0; pos[3 * q + 2] = -Y[k];
      col[3 * q] = cl[0]; col[3 * q + 1] = cl[1]; col[3 * q + 2] = cl[2];
      // mélange avec tous les points pas encore montrés (tous blocs confondus) : ils apparaissent partout à la fois,
      // pas par carrés de bloc
      const j = c.vis + Math.floor(Math.random() * (q - c.vis + 1));
      if (j !== q) for (const [a, d] of [[pos, 3], [col, 3]]) for (let e = 0; e < d; e++) { const t = a[3 * j + e]; a[3 * j + e] = a[3 * q + e]; a[3 * q + e] = t; }
    }
    geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = true;
    // révélation progressive : à chaque image, une part des points en attente (fluide, sans à-coups de bloc)
    if (!c.revele) {
      c.revele = true;
      let avant = performance.now();
      const pas = t => {
        if (this.chargementPts !== c) return;
        const dt = Math.min(0.1, (t - avant) / 1000); avant = t;
        const reste = c.n - c.vis;
        if (reste > 0) {
          c.vis = Math.min(c.n, c.vis + Math.max(300, Math.ceil(reste * dt / 0.7)));
          geo.setDrawRange(0, c.vis);
          this.demander(2);
        }
        requestAnimationFrame(pas);
      };
      requestAnimationFrame(pas);
    }
  }
  /** Fin du chargement visible : les points s'effacent (en douceur) et la maquette reparaît. */
  finChargement(fondu = false) {
    const c = this.chargementPts;
    this.groupe.visible = true;
    if (!c) return;
    this.chargementPts = null;
    const fin = () => { this.scene.remove(c.pts); c.pts.geometry.dispose(); c.pts.material.dispose(); this.demander(2); };
    if (!fondu) return fin();
    const m = c.pts.material, t0 = performance.now();
    m.transparent = true;
    const pas = () => { const f = (performance.now() - t0) / 700; m.opacity = Math.max(0, 1 - f); this.demander(2); if (f < 1) requestAnimationFrame(pas); else fin(); };
    requestAnimationFrame(pas);
  }

  /**
   * Animation de construction d'un lieu qui arrive : les bâtiments montent du sol en vague depuis le centre (~1,4 s),
   * puis les arbres apparaissent (taille des points de 0 à la normale).
   */
  animerConstruction(duree = 2200, { origine = null } = {}) {
    const arbres = this.couches.arbres?.material?.uniforms?.taille, base = arbres?.value, t0 = performance.now();
    // vague : depuis le lieu d'avant (voyage) ou le point visé, en avance dans la direction du regard
    const cam = this.camera, cible = this.controls.target, dir = new THREE.Vector2(cible.x - cam.position.x, cible.z - cam.position.z);
    if (dir.lengthSq() > 1e-6) dir.normalize();
    const o = origine ? new THREE.Vector2(origine[0], -origine[1]) : new THREE.Vector2(cible.x, cible.z);
    CONTACT.vague.value.set(o.x, o.y, dir.x, dir.y);
    CONTACT.montee.value = 0;
    if (arbres) arbres.value = 0;
    // l'ombre des arbres (canopée) n'arrive qu'avec eux ; celle des bâtiments suit leur montée (carte d'ombre à chaque image)
    const canopee = this.couches.canopee, ombreArbres = canopee?.castShadow;
    if (canopee) canopee.castShadow = false;
    const pas = () => {
      const f = Math.min(1, (performance.now() - t0) / duree);
      CONTACT.montee.value = Math.min(1, f / 0.85);
      const g = Math.min(1, Math.max(0, (f - 0.55) / 0.45));
      if (arbres) arbres.value = base * g * g * (3 - 2 * g);
      if (canopee && g > 0.6) canopee.castShadow = ombreArbres;
      this.ombres(); this.demander(2);
      if (f < 1) requestAnimationFrame(pas); else { CONTACT.montee.value = 1; if (arbres) arbres.value = base; if (canopee) canopee.castShadow = ombreArbres; this.ombres(); }
    };
    requestAnimationFrame(pas);
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
    const autour = this.modeVue === "plan" && this.loin.maille && this.loin.voir ? 6000 : 0;
    const cam = this.camera, d = cam.position.distanceTo(this.controls.target), marge = 2 * (this.G?.R || 150) + 200 + autour;
    let near = Math.max(0.5, d - marge), far = d + marge;
    // vue de dessus : le plan proche juste au-dessus du plus haut point (meilleure précision de profondeur en zoomant,
    // moins de surfaces qui scintillent)
    if (this.modeVue === "plan" && !autour) {
      const haut = (DEGRADE.zHaut?.value ?? 60) + 30;
      near = Math.max(0.5, cam.position.y - haut);
      far = cam.position.y - Math.min(this.zBas ?? -50, this.zBasAnneau ?? Infinity) + 50; // l'anneau peut descendre plus bas
    }
    if (Math.abs(cam.near - near) > 0.01 * near || Math.abs(cam.far - far) > 1) { cam.near = near; cam.far = far; cam.updateProjectionMatrix(); }
    // le ciel suit la caméra et tient dans le champ (la caméra est loin, la voûte de 9 km serait coupée)
    this.voute.position.copy(cam.position);
    this.voute.scale.setScalar(far * 0.9 / 9000);
  }

  vueOrtho(mode) {
    DEGRADE.vueDessus.value = mode === "plan" ? 1 : 0; // arbres en points allégés vus de dessus (maillages.js)
    const cam = this.camera, ctl = this.controls;
    if ((mode || null) === (this.modeVue || null)) return;
    if (mode && !this.modeVue) this.avant3D = { pos: cam.position.clone(), cible: ctl.target.clone(), fov: cam.fov };
    this.modeVue = mode || null;
    if (mode) {
      const R = this.G?.R || 150, fov = 3, h = R * 1.25 / Math.tan(fov * Math.PI / 360);
      cam.fov = fov;
      // zoom de ~8 m à ~25 km de large à l'écran (le plan en tuiles et le paysage couvrent au-delà de la maquette) ;
      // les plans proche et lointain suivent la distance (plansCamera)
      ctl.enableRotate = false; ctl.screenSpacePanning = true; ctl.minDistance = 150;
      ctl.maxDistance = mode === "plan" ? Math.max(h * 2, 12500 / Math.tan(fov * Math.PI / 360)) : h * 2;
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
      ctl.minDistance = 0; ctl.maxDistance = 60000;
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
      if (type === "bruit" && !F.canvas) {
        // bruit : bandes de niveau (dB) posées sur le plan cadastral reteinté, un peu transparentes
        const cad = await (this.fonds.cadastre ||= { image: chargerImage(this.urls.cadastre) }).image;
        if (id !== this.idScene) return;
        const cv = F.canvas = teinterCadastre(cad, this.T.plan), ctx = cv.getContext("2d");
        ctx.globalAlpha = 0.72;
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        ctx.globalAlpha = 1;
      }
      if (type === "ortho" && !F.canvas) {
        // photo aérienne au sol, estompée : plus claire, moins saturée, et fondue d'un bon tiers dans la teinte du sol
        // de la maquette (elle reste lisible sans dominer les volumes)
        F.canvas = adoucirPhoto(img, this.T.sol);
      }
      if (!F.tex) {
        F.tex = F.canvas ? new THREE.CanvasTexture(F.canvas) : new THREE.Texture(img);
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
    this.disque.visible = false; // plus de boule du soleil dans la vue (demande du 27.11) ; la lumière et les ombres restent
    // ciel : jour, soleil caché par le relief (plus terne), nuit
    const jour = visible ? 1 : dir[1] > 0 ? 0.72 : Math.max(0, Math.min(0.5, 0.5 + dir[1] * 4));
    // lueur de l'aube et du crépuscule : ciel rose orangé à l'horizon, violacé plus haut, jusqu'à 6° sous l'horizon
    const lueur = h < -6 ? 0 : h < 0 ? (h + 6) / 6 : (1 - Math.min(1, h / 18)) ** 1.3;
    u.zenith.value.set(T.ciel.nuitZenith).lerp(new THREE.Color(T.ciel.zenith), jour).lerp(new THREE.Color("#8c84c4"), 0.35 * lueur);
    u.horizon.value.set(T.ciel.nuitHorizon).lerp(new THREE.Color(T.ciel.horizon), jour).lerp(couleurSoleil(Math.max(0, h)).lerp(new THREE.Color("#f59ab4"), 0.45), 0.75 * lueur); // horizon rose orangé
    u.soleil.value.copy(d).normalize();
    this.loin.mat.uniforms.dirSoleil.value.copy(d).normalize(); // ombre des montagnes sur le paysage
    // lieu à l'ombre d'une montagne, soleil encore levé : le paysage reste éclairé là où le relief ne l'ombrage pas
    const leve = !visible && dir[1] > 0;
    this.loin.mat.uniforms.soleilPaysage.value.copy(couleurSoleil(h)).lerp(new THREE.Color(T.lumiere.soleil), Math.min(1, Math.max(0, (h - 25) / 20)))
      .multiplyScalar(leve ? 2.6 * (0.35 + 0.65 * (1 - Math.exp(-Math.max(0, h) / 6))) : 0);
    u.force.value = visible ? 1 : 0;
    this.scene.fog.color.copy(u.horizon.value);
    this.majLointain();
    // les points ne sont pas éclairés par three.js : leur luminosité suit la lumière présente (ciel + soleil), rapportée
    // à celle d'un jour clair, comme pour les surfaces ; à l'ombre, ils ne gardent que la part du ciel
    const k = 0.55, jourClair = 1.1 + 2.6 * k, total = this.ciel.intensity + this.soleil.intensity * k;
    // nuages de points : arbres et nuage brut du relevé, et arbres swisstopo de l'anneau (même lumière du soir)
    for (const mat of [this.couches.arbres?.material, this.couches.tous?.material, this.mat.pointsAnneau, this.mat.releveAnneau]) {
      const u = mat?.uniforms;
      const f = Math.min(1, total / jourClair);
      if (u) {
        // lumière faible : moins sombres et moins verts qu'avant, ils tirent vers la couleur du sol (comme la maquette)
        u.lum.value = Math.max(0.3, f ** 0.9); u.gris.value = 0.5 * (1 - f) ** 2; u.ombre.value = visible ? this.ciel.intensity / total : 1;
        if (u.versSol) { u.versSol.value = Math.min(0.85, 1.0 * (1 - f) ** 1.1); u.teinteSol.value.set(this.T.sol); }
        // teintes ramenées à une luminosité de 1 (la couleur change, pas la clarté), un peu atténuées
        const teinte = (src, dst, force) => {
          const l = Math.max(1e-3, 0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b);
          dst.setRGB(src.r / l, src.g / l, src.b / l).lerp(new THREE.Color(1, 1, 1), 1 - force);
        };
        if (u.teinteSoleil) {
          teinte(this.ciel.color, u.teinteOmbre.value, 0.5);
          // soleil couché ou caché : plus de lumière directe, donc plus de teinte rouge orangé (seule celle du ciel)
          if (visible && this.soleil.intensity > 0) teinte(this.soleil.color, u.teinteSoleil.value, 0.22 * Math.min(1, this.soleil.intensity / 1.2)); // lueur du soir, discrète sur le feuillage
          else u.teinteSoleil.value.copy(u.teinteOmbre.value);
        }
      }
    }
    this.ombres();
  }

  /** Arbres de la zone en gris tant que la carte des heures de soleil est affichée (sinon ils la cachent). */
  arbresSurHeures() {
    CONTACT.heuresActif.value = this.couches.heures?.visible && CONTACT.tHeures.value ? 1 : 0;
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
  afficherHeures(grp, tex = null) {
    const vieux = this.couches.heures;
    if (vieux) { this.groupe.remove(vieux); this.liberer(vieux); }
    this.couches.heures = grp;
    // sol et toits : la carte est peinte sur leurs faces (texture d'une cellule par pixel, sans lissage)
    if (CONTACT.tHeures.value && CONTACT.tHeures.value !== tex?.texture) CONTACT.tHeures.value.dispose();
    CONTACT.tHeures.value = tex?.texture || null;
    if (tex) CONTACT.heuresZone.value.set(...tex.zone);
    CONTACT.heuresActif.value = grp && tex ? 1 : 0;
    if (grp) { if (vieux) grp.visible = vieux.visible; this.groupe.add(grp); }
    this.arbresSurHeures();
    this.appliquerCoupe();
    this.demander();
  }

  /* ------------------------------------------------------------------ coupe */

  /** Affiche la coupe décrite par le profil `P` (coupe.js), ou l'enlève si `P` est nul. */
  definirCoupe(P, autres = []) {
    this.liberer(this.outils);
    this.coupe = P;
    this.poignees = [];
    this.reperesAutres = []; this.traitsAutres = [];
    this.tranche = null;
    // les autres coupes : leur trait seul, plus pâle et plus fin que la coupe choisie, avec leurs lettres
    this.coupesAutres = autres;
    for (const Q of autres) {
      const t = trancheCoupe(Q, this.zRef, this.zBas, { ...this.T.coupe, arbres: null }, this.mat.trait);
      const traits = t.userData.traits || [];
      t.traverse(o => { if (o.isMesh && !traits.includes(o)) o.visible = false; });
      const m = this.mat.trait.clone();
      Object.assign(m, { opacity: 0.55, transparent: true, linewidth: 2, depthTest: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40 });
      m.uniforms.resolution = this.mat.trait.uniforms.resolution;
      for (const l of traits) { if (l.isPoints) { l.visible = false; continue; } if (!l.material.dashed) l.material = m; this.traitsAutres.push(l); }
      this.outils.add(t);
      [Q.A, Q.B].forEach(([x, y], k) => {
        const g = new THREE.Group();
        g.add(etiquette(Q.lettres?.[k] || (k ? "B" : "A"), this.T.coupe.trait));
        g.position.set(x, solEn(this.G, x, y) - this.zRef + 1, -y);
        this.outils.add(g); this.reperesAutres.push(g);
      });
    }
    if (P && this.couperModele === false) {
      // maquette entière : seulement le trait de coupe (terrain et bâtiments, murs à leur position exacte), qui épouse
      // les toits et les façades ; un rappel pâle, vu à travers, là où il passe derrière un bâtiment
      this.tranche = trancheCoupe(P, this.zRef, this.zBas, { ...this.T.coupe, arbres: null }, this.mat.trait);
      const traits = this.tranche.userData.traits || [];
      this.tranche.traverse(o => { if (o.isMesh && !traits.includes(o)) o.visible = false; });
      const pale = this.mat.trait.clone();
      Object.assign(pale, { opacity: 0.3, linewidth: 2 });
      // trait principal : caché derrière les bâtiments, mais tiré vers la caméra pour ne pas s'enfoncer dans les toits
      const net = this.mat.trait.clone();
      Object.assign(net, { depthTest: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40 });
      net.uniforms.resolution = pale.uniforms.resolution = this.mat.trait.uniforms.resolution; // même objet : suit la taille de la vue
      const jn = this.mat.trait.jonction.clone();
      jn.uniforms = this.mat.trait.jonction.uniforms; net.jonction = jn; Object.assign(jn, { depthTest: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -40 });
      for (const l of [...traits]) {
        if (l.isPoints) { l.material = jn; continue; }
        if (l.material.dashed) continue; // terrain estimé : reste visible à travers, léger
        l.material = net;
        const r = l.clone(); r.material = pale; r.renderOrder = 6; this.tranche.add(r); traits.push(r); // copie : la liste grandit dans la boucle
      }
      this.outils.add(this.tranche);
    } else if (P) {
      this.tranche = trancheCoupe(P, this.zRef, this.zBas, { ...this.T.coupe, arbres: this.T.sombre ? "#7f8da6" : "#8a9096" }, this.mat.trait);
      if (this.tranche.userData.arbres) this.tranche.userData.arbres.visible = this.arbresVisibles !== false;
      this.outils.add(this.tranche);
    }
    if (P) {
      this.poignees = [P.A, P.B].map(([x, y], k) => {
        const g = new THREE.Group(), boule = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 12), this.mat.poignee);
        boule.renderOrder = 5; boule.userData.bout = k;
        g.add(boule, etiquette(P.lettres?.[k] || (k ? "B" : "A"), this.T.coupe.trait));
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

  /** Indice (dans les autres coupes) de celle dont le trait passe à moins de 12 px du pointeur, ou -1. */
  coupeSousPointeur(e) {
    const autres = this.coupesAutres || [];
    if (!autres.length || !this.G) return -1;
    const b = this.renderer.domElement.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top;
    const ecran = (x, y) => { const v = new THREE.Vector3(x, solEn(this.G, x, y) - this.zRef + 0.5, -y).project(this.camera); return v.z > 1 ? null : [(v.x + 1) / 2 * b.width, (1 - v.y) / 2 * b.height]; };
    let meilleur = -1, dMin = 12;
    autres.forEach((Q, k) => {
      // le trait suit le terrain : on le découpe en 24 morceaux projetés à l'écran
      let avant = null;
      for (let i = 0; i <= 24; i++) {
        const u = i / 24, p = ecran(Q.A[0] + (Q.B[0] - Q.A[0]) * u, Q.A[1] + (Q.B[1] - Q.A[1]) * u);
        if (p && avant) {
          const dx = p[0] - avant[0], dy = p[1] - avant[1], l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((px - avant[0]) * dx + (py - avant[1]) * dy) / l2));
          const d = Math.hypot(px - avant[0] - t * dx, py - avant[1] - t * dy);
          if (d < dMin) { dMin = d; meilleur = k; }
        }
        avant = p;
      }
    });
    return meilleur;
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
    for (const g of this.reperesAutres || []) g.scale.setScalar(0.8 * Math.max(0.6, c.distanceTo(g.position) * f));
  }

  appliquerCoupe() {
    const plans = this.coupe && this.couperModele !== false ? [this.plan] : null, c = this.couches, m = this.mat;
    PLAN_MOBILE.plan = this.plan;
    // bâtiments swisstopo : chargés par tuiles bien au-delà du modèle, on les coupe aux bords du terrain
    // (et l'occlusion ambiante ne doit pas voir la partie coupée) ; pendant le vol de l'accueil, rien n'est coupé
    if (this.G && this.vol) {
      if (this.ao.normalMaterial) poserPlans(this.ao.normalMaterial, null);
      for (const x of [m.toit, m.mur, this.swiss?.materiau]) if (x?.clippingPlanes) poserPlans(x, null);
    } else if (this.G) {
      // boîte de l'occlusion 2 cm au-delà du bord : la face du socle est exactement à R, une boîte à R l'effaçait par
      // endroits (arrondis) et l'occlusion y dessinait des stries ; les bâtiments sont de toute façon coupés à R - 3 cm
      const R = this.G.R, Rb = Math.max(R, this.rayonExt || 0), boite = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(n => new THREE.Plane(new THREE.Vector3(...n), Rb + 0.02));
      const avecBoite = [...boite, ...(plans || [])];
      if (this.ao.normalMaterial) {
        // maquette ronde : l'occlusion ne voit rien hors du cercle (sinon des bâtiments « fantômes » pâles apparaissaient
        // contre le ciel, au-delà de la paroi)
        if (this.G.rayonZone) decoupeZone(this.ao.normalMaterial, ZONE_AO);
        poserPlans(this.ao.normalMaterial, avecBoite);
      }
      // nos bâtiments (et roofer) : coupés 3 cm en retrait du bord, sinon les murs du bord sont dans le plan de la face
      // du socle et leur partie enterrée apparaît en stries à travers elle
      const dedans = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(n => new THREE.Plane(new THREE.Vector3(...n), R - 0.03));
      for (const x of [m.toit, m.mur]) if (x) {
        // maquette ronde : coupés net au cercle (dans le shader) ; carrée : coupés au bord par les plans
        if (this.G.rayonZone) decoupeZone(x, ZONE_FINE);
        poserPlans(x, this.G.rayonZone ? plans : [...dedans, ...(plans || [])]);
      }
      // maquette ronde : swisstopo et roofer sont découpés par la zone (cercle ou anneau), pas par la boîte
      for (const x of [c.roofer?.material, this.swiss?.materiau]) if (x) {
        // Advanced (roofer ou reconstruction) ne couvre que la maquette fine ; swisstopo : cercle ou anneau selon le jeu
        if (this.G.rayonZone) decoupeZone(x, x === c.roofer?.material ? ZONE_FINE : ZONE);
        // maquette carrée avec le paysage : swisstopo n'est plus coupé au bord (il habite le paysage)
        const libre = !this.G.rayonZone && x === this.swiss?.materiau && this.batiLoin();
        poserPlans(x, this.G.rayonZone || libre ? plans : [...dedans, ...(plans || [])]);
      }
      // swisstopo et roofer débordent du modèle : la partie coupée ne doit pas non plus porter d'ombre (stries sur la
      // face du socle, ombres de bâtiments invisibles au bord du terrain)
      for (const x of [c.roofer?.material, this.swiss?.materiau]) if (x) x.clipShadows = true;
    }
    const cibles = [m.terrain, m.socle, m.socleFond, m.canopee, m.couronne, m.parcelle, m.eau, m.anneau, m.pointsAnneau, m.releveAnneau].filter(Boolean);
    for (const k of ["arbres", "tous"]) if (c[k]) cibles.push(c[k].material);
    c.heures?.traverse(o => o.material && cibles.push(o.material));
    c.voisines?.traverse(o => o.material && cibles.push(o.material)); // limites et numéros des parcelles voisines
    if (c.selection) cibles.push(c.selection.material);
    for (const m of this.mat.projets?.values() || []) cibles.push(m);
    c.imports?.traverse(o => o.isMesh && cibles.push(o.material));
    for (const x of cibles) poserPlans(x, plans);
  }

  /** Rayon de la caméra passant sous le pointeur. */
  viser(e) {
    const b = this.renderer.domElement.getBoundingClientRect();
    this.rayon.setFromCamera(new THREE.Vector2((e.clientX - b.left) / b.width * 2 - 1, -(e.clientY - b.top) / b.height * 2 + 1), this.camera);
    return this.rayon;
  }

  /** Souris : déplacer les poignées A et B de la coupe, ou tracer une coupe en deux clics (voir `tracer`). */
  /**
   * Déplacement au clavier, sur les principes de Google Earth et des vues de vol des logiciels 3D (Unreal, Blender) :
   * W / S avancer et reculer à plat (on ne plonge pas dans le sol en regardant vers le bas), A / D de côté, E / Q monter
   * et descendre ; Maj pour aller trois fois plus vite. La vitesse suit la hauteur au-dessus du sol (lent près du sol,
   * rapide en altitude) ; la molette, touche de déplacement enfoncée, règle la vitesse de base (×¼ à ×8, gardée).
   * Élan doux au départ et à l'arrêt ; jamais sous le sol. Touches physiques (KeyW…) : ZQSD sur un clavier français.
   */
  deplacerClavier(t) {
    const k = this.touches, avant = this.dernierClavier ?? t, v = (this.vitesseClavier ||= new THREE.Vector3());
    this.dernierClavier = t;
    if ((!k?.size && v.lengthSq() < 1e-4) || this.vol || !this.G) { this.dernierClavier = null; v.set(0, 0, 0); return false; }
    const dt = Math.min(0.1, (t - avant) / 1000);
    if (!dt) return true;
    const cam = this.camera, cible = this.controls.target, e = cam.matrixWorld.elements;
    // devant : à plat, dans la direction de la vue (vue de dessus : le haut de l'écran)
    const devant = this.modeVue === "plan" || Math.abs(e[9]) > 0.97 ? new THREE.Vector3(e[4], 0, e[6]) : new THREE.Vector3(-e[8], 0, -e[10]);
    devant.normalize();
    const droite = new THREE.Vector3(e[0], 0, e[2]).normalize();
    const d = new THREE.Vector3();
    if (k.has("KeyW") || k.has("ArrowUp")) d.add(devant);
    if (k.has("KeyS") || k.has("ArrowDown")) d.sub(devant);
    if (k.has("KeyD") || k.has("ArrowRight")) d.add(droite);
    if (k.has("KeyA") || k.has("ArrowLeft")) d.sub(droite);
    if (k.has("KeyE")) d.y += 1;
    if (k.has("KeyQ")) d.y -= 1;
    const sol = this.solSous(cam.position.x, cam.position.z), haut = Math.max(2, cam.position.y - (isNaN(sol) ? cible.y : sol));
    // hauteur au-dessus du sol, et un peu de la distance au point visé (vue rasante lointaine)
    // plafonnée : 80 m/s (×3 avec Maj, ×8 au plus par la molette) ; sinon, en altitude, on sortait du décor en un instant
    const vitesse = Math.min(80, Math.max(3, 0.6 * haut + 0.05 * cam.position.distanceTo(cible))) * this.facteurVitesse()
      * (k.has("ShiftLeft") || k.has("ShiftRight") ? 3 : 1);
    if (d.lengthSq()) d.normalize().multiplyScalar(vitesse);
    // la vitesse rejoint la vitesse voulue : vite à l'appui (~0,15 s), un peu plus lentement au lâcher (~0,3 s)
    v.lerp(d, 1 - Math.exp(-dt * (d.lengthSq() ? 9 : 6)));
    if (!k.size && v.lengthSq() < 0.01) { v.set(0, 0, 0); return false; }
    const pas = v.clone().multiplyScalar(dt);
    cam.position.add(pas); cible.add(pas);
    // jamais sous le sol : 2 m au moins au-dessus du terrain (la cible suit)
    const sol2 = this.solSous(cam.position.x, cam.position.z);
    if (!isNaN(sol2) && cam.position.y < sol2 + 2) { const m = sol2 + 2 - cam.position.y; cam.position.y += m; cible.y += m; if (v.y < 0) v.y = 0; }
    // jamais plus de 3 km au-dessus du lieu (ni du sol sous la caméra)
    const plafond = (isNaN(sol2) ? 0 : sol2) + 3000;
    if (cam.position.y > plafond) { const m = cam.position.y - plafond; cam.position.y -= m; cible.y -= m; if (v.y > 0) v.y = 0; }
    // paysage navigable : l'origine suit la cible, sans rechargement (vol.js, surPaysage)
    if (this.paysage) { this.surPaysage?.(cible); return true; }
    // voyage : près du bord de la maquette, le lieu se recharge sous la caméra (main.js, surVoyage)
    const Rv = Math.max(this.G.R, this.rayonExt || 0);
    if (Math.hypot(cible.x, cible.z) > Rv * 0.75) this.surVoyage?.(cible);
    return true;
  }

  /** Altitude du sol (repère de la scène) sous un point x, z : maquette fine, puis anneau ; NaN hors du modèle. */
  solSous(x, z) {
    if (this.paysage) return this.monde?.solSous(x, z) ?? NaN; // la grille du départ ne vaut plus après rebasage
    const G = this.G;
    if (G && Math.hypot(x, z) < G.R - 1) return solEn(G, x, -z) - this.zRef;
    const a = this.couches?.anneau;
    if (!a?.visible) return NaN;
    (this.rayonSol ||= new THREE.Raycaster()).set(new THREE.Vector3(x, 1e4, z), new THREE.Vector3(0, -1, 0));
    return this.rayonSol.intersectObject(a, false)[0]?.point.y ?? NaN;
  }

  /** Vitesse de base du clavier (molette pendant un déplacement), gardée d'une visite à l'autre. */
  facteurVitesse() {
    if (this._vitesse == null) { try { this._vitesse = +localStorage.getItem("ombres.vitesseVol") || 1; } catch { this._vitesse = 1; } }
    return this._vitesse;
  }

  reglerVitesse(sens) {
    const f = Math.min(8, Math.max(0.25, this.facteurVitesse() * (sens > 0 ? 1 / 1.25 : 1.25)));
    this._vitesse = f;
    try { localStorage.setItem("ombres.vitesseVol", String(f)); } catch { /* stockage indisponible */ }
    let b = document.getElementById("vitesseVol");
    if (!b) {
      b = Object.assign(document.createElement("div"), { id: "vitesseVol" });
      b.style.cssText = "position:fixed;left:50%;bottom:64px;transform:translateX(-50%);padding:6px 12px;border-radius:8px;"
        + "background:rgba(20,30,50,.82);color:#fff;font:600 14px system-ui;pointer-events:none;transition:opacity .3s;z-index:50";
      document.body.append(b);
    }
    const n = Math.round(Math.log(f) / Math.log(1.25)), barres = "▮".repeat(Math.max(0, n + 7)) + "▯".repeat(Math.max(0, 9 - n));
    b.textContent = `${barres}  ×${f < 1 ? f.toFixed(2) : f.toFixed(1)}`;
    b.style.opacity = "1";
    clearTimeout(this._vitesseT); this._vitesseT = setTimeout(() => { b.style.opacity = "0"; }, 1200);
  }

  /** Double-clic sur le sol ou un bâtiment : la vue y glisse en douceur (Google Earth), même orientation, deux fois plus près. */
  volerVers(point) {
    const cam = this.camera, cible = this.controls.target, p0 = cam.position.clone(), c0 = cible.clone();
    const dir = p0.clone().sub(c0), dist = Math.max(15, dir.length() * 0.5);
    const p1 = point.clone().add(dir.normalize().multiplyScalar(dist)), t0 = performance.now(), duree = 900;
    const pas = () => {
      const u = Math.min(1, (performance.now() - t0) / duree), e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      cam.position.lerpVectors(p0, p1, e); cible.lerpVectors(c0, point, e);
      this.controls.update(); this.demander(2);
      if (u < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
  }

  interactions() {
    // clavier : touches enfoncées (pas quand on écrit dans un champ)
    this.touches = new Set();
    const ecrit = e => e.target.closest?.("input, textarea, select, [contenteditable]");
    const DEPL = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    addEventListener("keydown", e => {
      if (ecrit(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (DEPL.includes(e.code) || e.code.startsWith("Shift")) { this.touches.add(e.code); if (DEPL.includes(e.code)) e.preventDefault(); }
    });
    addEventListener("keyup", e => this.touches.delete(e.code));
    // molette pendant un déplacement au clavier : vitesse de vol (comme Unreal) au lieu du zoom
    const DEPL2 = new Set(DEPL);
    this.renderer.domElement.addEventListener("wheel", e => {
      if (![...this.touches].some(c => DEPL2.has(c))) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.reglerVitesse(e.deltaY);
    }, { capture: true, passive: false });
    this.renderer.domElement.addEventListener("dblclick", e => {
      if (this.trace || this.modeVue) return;
      const cibles = [this.couches.terrain, this.couches.anneau, ...(this.couches.bati?.visible ? this.couches.bati.children : [])].filter(o => o?.visible);
      const t = this.viser(e).intersectObjects(cibles, false)[0];
      if (t) this.volerVers(t.point);
    });
    addEventListener("blur", () => this.touches.clear());
    const el = this.renderer.domElement, sol = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), v = new THREE.Vector3();
    this.rayon = new THREE.Raycaster();
    let prise = null, appui = null;
    const borne = x => { const R = Math.max(this.G.R, this.rayonExt || 0) - 2; return Math.max(-R, Math.min(R, x)); };
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
      // clic près d'une autre coupe (trait pâle) : elle devient la coupe choisie
      if (!this.trace && e.button === 0) { const k = this.coupeSousPointeur(e); if (k >= 0) { this.surChoixCoupe?.(k); return; } }
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
  // lettre seule, à l'encre du trait, avec un fin liseré clair pour rester lisible sur tous les fonds
  ctx.font = "600 40px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 7; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.strokeText(texte, 32, 34);
  ctx.fillStyle = couleur; ctx.fillText(texte, 32, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false }));
  s.position.y = 2.6; s.scale.setScalar(2.6); s.renderOrder = 6;
  return s;
}
