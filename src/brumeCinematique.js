// Brume cinématique (docs/brume-cinematique.md) : brouillard au sol / mer de brouillard, purement visuel.
// 1. Brume de hauteur analytique, ajoutée à la brume de tous les matériaux (scene.js, fog_fragment) : densité qui décroît
//    exponentiellement au-dessus du dessus de la nappe, intégrée le long du rayon caméra → point (forme fermée, comme
//    l'Exponential Height Fog d'Unreal), modulée par un bruit 2D lent.
// 2. Deux nappes bas-poly (grille de 129 × 129 sommets sur ±16 km) posées au-dessus du fond de vallée et qui suivent le
//    relief lissé là où il dépasse ; dessus : bruit 2D animé (texture répétée), éclairé par le soleil ; fondu doux en
//    lisière là où la nappe rejoint le terrain (épaisseur lue dans une carte des altitudes, sans tampon de profondeur).
// Ni ombre portée, ni lancer de rayons, ni occlusion ambiante : le calcul d'ensoleillement n'est pas touché.
import * as THREE from "three";
import { tuile, versTuile } from "./horizon.js";
import { versWgs } from "./geo.js";

// Uniformes partagés par tous les matériaux qui ont la brume : des objets simples (ni Vector4 ni Color), que
// UniformsUtils.clone/merge copient par référence — une seule valeur pour toute la scène, sans toucher aux matériaux.
// brumeSol : x = dessus de la nappe (y de la scène), y = 1 / hauteur d'échelle, z = densité au dessus (1/m), w = temps (s)
export const BRUME_SOL = { x: 0, y: 0.02, z: 0, w: 0 };
// teinte de la brume au sol (linéaire, éclairée par le soleil et le ciel) ; w = opacité maximale
export const BRUME_SOL_TEINTE = { x: 1, y: 1, z: 1, w: 1 };
{
  const U = { brumeSol: { value: BRUME_SOL }, brumeSolTeinte: { value: BRUME_SOL_TEINTE } };
  Object.assign(THREE.UniformsLib.fog, U);
  for (const s of Object.values(THREE.ShaderLib)) if (s.uniforms && "fogDensity" in s.uniforms) Object.assign(s.uniforms, U);
}

/** GLSL ajouté à fog_fragment (scene.js) : facteur et couleur de la brume au sol, avant la brume de distance. */
export const BRUME_SOL_GLSL = /* glsl */`
  if (brumeSol.z > 0.0) {
    // densité ρ(y) = ρ0·exp(−(y − dessus)/H), bornée sous le dessus (au plus e³·ρ0) ; ∫ le long du rayon, forme fermée
    float yb = brumeSol.x - 3.0 / brumeSol.y;
    float y0 = max(cameraPosition.y, yb), y1 = max(vBrumeMonde.y, yb);
    float f0 = exp(-(y0 - brumeSol.x) * brumeSol.y), f1 = exp(-(y1 - brumeSol.x) * brumeSol.y);
    float dy = (y1 - y0) * brumeSol.y;
    float moy = abs(dy) > 1e-3 ? (f0 - f1) / dy : f0;
    float tau = brumeSol.z * length(vBrumeMonde - cameraPosition) * moy;
    vec2 qs = vBrumeMonde.xz * 0.0021 + brumeSol.w * vec2(0.0035, 0.0012);
    float ns = 0.6 * brumeBruit(qs) + 0.4 * brumeBruit(qs * 3.1 + 5.0);
    float fSol = (1.0 - exp(-tau * (0.55 + 0.9 * ns))) * brumeSolTeinte.w;
    vec3 teinteSol = brumeSolTeinte.rgb;
    #ifdef TONE_MAPPING
      teinteSol = toneMapping(teinteSol);
    #endif
    teinteSol = linearToOutputTexel(vec4(teinteSol, 1.0)).rgb;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, teinteSol, fSol);
  }`;

const COTE = 16000, N_CARTE = 256, N_NAPPE = 129, RAYON_TERRE = 6371000, REFRACTION = 0.13;

/** Texture de bruit de valeur répétable (256², deux octaves indépendantes dans R et G), avec mipmaps. */
function textureBruit() {
  const n = 256, d = new Uint8Array(n * n * 4);
  const alea = (i, j, p, g) => { i = ((i % p) + p) % p; j = ((j % p) + p) % p; const s = Math.sin(i * 127.1 + j * 311.7 + g * 74.7) * 43758.5453; return s - Math.floor(s); };
  const valeur = (x, y, p, g) => {
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
    return (alea(i, j, p, g) * (1 - a) + alea(i + 1, j, p, g) * a) * (1 - b) + (alea(i, j + 1, p, g) * (1 - a) + alea(i + 1, j + 1, p, g) * a) * b;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let r = 0, g = 0, amp = 0.5, tot = 0;
    for (const p of [4, 8, 16, 32]) {
      r += amp * valeur(x * p / n, y * p / n, p, 1); g += amp * valeur(x * p / n, y * p / n, p, 2); tot += amp; amp *= 0.5;
    }
    const q = 4 * (y * n + x);
    d[q] = Math.round(255 * r / tot); d[q + 1] = Math.round(255 * g / tot); d[q + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const SOMMETS = /* glsl */`
varying vec3 vLocal;
varying vec3 vBrumeMonde;
varying float vFogDepth;
void main() {
  vLocal = position;
  vec4 m = modelMatrix * vec4(position, 1.0);
  vBrumeMonde = m.xyz;
  vec4 mv = viewMatrix * m;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAGMENTS = /* glsl */`
uniform sampler2D tSol, tBruit;
uniform float cote, dessus, echelleH, temps, opacite, couverture, epaisseur, echelle;
uniform vec3 couleurCiel, couleurSoleil, dirSoleil;
varying vec3 vLocal;
#include <common>
#include <fog_pars_fragment>
void main() {
  { // bloc : ses noms (n, p, a…) ne doivent pas croiser ceux de fog_fragment
  // épaisseur de la nappe au-dessus du terrain (carte des altitudes, ~125 m) : fondu doux en lisière
  float sol = texture2D(tSol, vec2(vLocal.x, -vLocal.z) / (2.0 * cote) + 0.5).r;
  float a = smoothstep(0.0, epaisseur, vLocal.y - sol);
  // là où la nappe suit le relief au-dessus de son niveau, elle s'amincit
  a *= exp(-max(0.0, vLocal.y - dessus) / echelleH);
  // bruit 2D : trois échelles qui dérivent lentement (vent)
  vec2 p = vLocal.xz * echelle, vent = vec2(1.0, 0.35) * temps;
  float n1 = texture2D(tBruit, p / 2200.0 + vent * 0.0011).r;
  float n2 = texture2D(tBruit, p / 640.0 - vent * 0.0027).g;
  float n3 = texture2D(tBruit, p / 170.0 + vent * 0.006).r;
  float n = clamp((0.55 * n1 + 0.3 * n2 + 0.15 * n3 - 0.5) * 2.4 + 0.5, 0.0, 1.0); // contraste étiré (fbm resserré autour de 0,5)
  a *= smoothstep(couverture - 0.16, couverture + 0.16, n) * opacite;
  a *= 1.0 - smoothstep(0.72, 0.97, length(vLocal.xz) / cote); // bord de la grille
  float dCam = distance(vBrumeMonde, cameraPosition);
  a *= smoothstep(25.0, 300.0, dCam); // pas de plan dur collé à la caméra
  a *= mix(0.3, 1.0, smoothstep(-20.0, 20.0, cameraPosition.y - vBrumeMonde.y)); // vue de dessous : plafond léger
  if (a < 0.003) discard;
  // relief des bourrelets : normale tirée de la pente du bruit, éclairée par le soleil (dessus plus clair côté soleil)
  float e = 0.006;
  float nx = texture2D(tBruit, p / 2200.0 + vent * 0.0011 + vec2(e, 0.0)).r - n1;
  float nz = texture2D(tBruit, p / 2200.0 + vent * 0.0011 + vec2(0.0, e)).r - n1;
  vec3 N = normalize(vec3(-nx * 30.0, 1.0, -nz * 30.0));
  float lamb = 0.35 + 0.65 * max(dot(N, dirSoleil), 0.0); // diffusion : la lumière pénètre un peu partout
  vec3 c = (couleurCiel + couleurSoleil * lamb) * (0.6 + 0.45 * smoothstep(0.15, 0.85, n)); // creux plus sombres, bourrelets clairs
  gl_FragColor = vec4(c, a);
  }
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// Réglage de chaque nappe : basse (dense, presque couvrante) et haute (lambeaux plus clairsemés)
const NAPPES = [
  { dessus: 1.0, marge: 6, opacite: 1.0, couverture: 0.4, epaisseur: 45, echelle: 1.0 },
  { dessus: 1.3, marge: 25, opacite: 0.45, couverture: 0.58, epaisseur: 80, echelle: 1.37 },
];

export class BrumeCinematique {
  /** `s` : la Scene3D. */
  constructor(s) {
    this.s = s;
    this.actif = false; this.hauteur = 150; this.densite = 0.5;
    this.groupe = new THREE.Group();
    this.groupe.name = "brumeCinematique";
    this.groupe.visible = false;
    s.scene.add(this.groupe);
    (s.horsAO ||= []).push(this.groupe); // ni occlusion ambiante, ni rebond
    this.bruit = textureBruit();
    this.communs = {
      tSol: { value: null }, tBruit: { value: this.bruit }, cote: { value: COTE }, temps: { value: 0 },
      couleurCiel: { value: new THREE.Color() }, couleurSoleil: { value: new THREE.Color() }, dirSoleil: { value: new THREE.Vector3(0, 1, 0) },
    };
    this.mailles = NAPPES.map((r, k) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), ...this.communs,
          dessus: { value: 0 }, echelleH: { value: 40 }, opacite: { value: r.opacite }, couverture: { value: r.couverture },
          epaisseur: { value: r.epaisseur }, echelle: { value: r.echelle },
        },
        vertexShader: SOMMETS, fragmentShader: FRAGMENTS, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      m.frustumCulled = false; m.castShadow = m.receiveShadow = false;
      m.raycast = () => {}; // invisible pour les clics et les mesures
      m.renderOrder = 2 + k;
      this.groupe.add(m);
      return m;
    });
    this.horloge = null;
  }

  /** Réglages (case et curseurs d'Affichage). */
  regler({ actif = this.actif, hauteur = this.hauteur, densite = this.densite } = {}) {
    const refaire = hauteur !== this.hauteur;
    Object.assign(this, { actif, hauteur, densite });
    if (refaire) this.poserNappes();
    // dérive du bruit : une image tous les 1/12 s quand rien d'autre ne bouge (léger : l'image est à la demande)
    clearInterval(this.horloge); this.horloge = null;
    if (actif) this.horloge = setInterval(() => { if (!document.hidden && this.groupe.visible) this.s.demander(1); }, 83);
    this.s.demander(2);
  }

  /** Carte des altitudes (repère de la scène du lieu) sur ±16 km, relief libre Terrarium (zoom 11, tuiles en cache). */
  async charger(E0, N0, zRef) {
    const id = this.idCharge = (this.idCharge || 0) + 1;
    this.enCours = true;
    try {
      const n = N_CARTE, c = 2 * COTE / n, z = 11, ech = new Array(n * n), besoin = new Set();
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const E = E0 - COTE + (i + 0.5) * c, N = N0 - COTE + (j + 0.5) * c, [lon, lat] = versWgs(E, N), [tx, ty] = versTuile(lon, lat, z);
        const cle = `${z}/${Math.floor(tx)}/${Math.floor(ty)}`;
        ech[j * n + i] = [cle, (tx - Math.floor(tx)) * 256, (ty - Math.floor(ty)) * 256];
        besoin.add(cle);
      }
      const tuiles = new Map();
      await Promise.all([...besoin].map(async cle => { try { tuiles.set(cle, await tuile(...cle.split("/").map(Number))); } catch { /* hors couverture */ } }));
      if (id !== this.idCharge) return;
      const h = new Float32Array(n * n);
      let somme = 0, nb = 0;
      for (let q = 0; q < n * n; q++) {
        const [cle, fx, fy] = ech[q], T = tuiles.get(cle);
        if (!T) { h[q] = NaN; continue; }
        const x = Math.min(254.999, Math.max(0, fx - 0.5)), y = Math.min(254.999, Math.max(0, fy - 0.5)), i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, p = j * 256 + i;
        const a = (T[p] * (1 - u) + T[p + 1] * u) * (1 - v) + (T[p + 256] * (1 - u) + T[p + 257] * u) * v;
        const dx = (q % n + 0.5) * c - COTE, dy = (Math.floor(q / n) + 0.5) * c - COTE, d2 = dx * dx + dy * dy;
        h[q] = a - zRef - d2 / (2 * RAYON_TERRE) * (1 - REFRACTION);
        somme += h[q]; nb++;
      }
      const moyenne = nb ? somme / nb : 0;
      for (let q = 0; q < n * n; q++) if (isNaN(h[q])) h[q] = moyenne;
      // fond de vallée : 3e centile des altitudes à moins de 3 km (le lac, le fond de la vallée)
      const proches = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const dx = (i + 0.5) * c - COTE, dy = (j + 0.5) * c - COTE;
        if (dx * dx + dy * dy < 3000 * 3000) proches.push(h[j * n + i]);
      }
      proches.sort((a, b) => a - b);
      const fond = proches.length ? proches[Math.floor(proches.length * 0.03)] : 0;
      // relief lissé (deux flous en boîte de ±2 cellules, ~600 m) pour la forme des nappes
      let L = h.slice();
      for (let passe = 0; passe < 2; passe++) {
        const t = new Float32Array(n * n), r = 2;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          let s = 0, k = 0;
          for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) {
            const ii = i + a, jj = j + b;
            if (ii >= 0 && jj >= 0 && ii < n && jj < n) { s += L[jj * n + ii]; k++; }
          }
          t[j * n + i] = s / k;
        }
        L = t;
      }
      const tex = new THREE.DataTexture(Uint16Array.from(h, v => THREE.DataUtils.toHalfFloat(v)), n, n, THREE.RedFormat, THREE.HalfFloatType);
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      this.communs.tSol.value?.dispose();
      this.communs.tSol.value = tex;
      this.carte = { E0, N0, zRef, n, c, h, lisse: L, fond };
      this.poserNappes();
      this.s.demander(2);
    } finally {
      if (id === this.idCharge) this.enCours = false;
    }
  }

  /** Altitude lissée (repère de la carte) en (x est, y nord), bilinéaire. */
  lisseEn(x, y) {
    const { n, c, lisse } = this.carte;
    const fx = Math.min(n - 1.001, Math.max(0, (x + COTE) / c - 0.5)), fy = Math.min(n - 1.001, Math.max(0, (y + COTE) / c - 0.5));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, p = j * n + i;
    return (lisse[p] * (1 - u) + lisse[p + 1] * u) * (1 - v) + (lisse[p + n] * (1 - u) + lisse[p + n + 1] * u) * v;
  }

  /** Grilles des nappes : à plat au-dessus du fond de vallée, et sur le relief lissé là où il dépasse. */
  poserNappes() {
    if (!this.carte) return;
    const m = N_NAPPE, pas = 2 * COTE / (m - 1);
    NAPPES.forEach((r, k) => {
      const dessus = this.carte.fond + this.hauteur * r.dessus, pos = new Float32Array(m * m * 3);
      for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
        const x = -COTE + i * pas, y = -COTE + j * pas;
        pos.set([x, Math.max(dessus, this.lisseEn(x, y) + r.marge), -y], 3 * (j * m + i));
      }
      const idx = [];
      for (let j = 0; j < m - 1; j++) for (let i = 0; i < m - 1; i++) {
        const p = j * m + i;
        idx.push(p, p + 1, p + m, p + 1, p + m + 1, p + m);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      const M = this.mailles[k];
      M.geometry.dispose(); M.geometry = g;
      M.material.uniforms.dessus.value = dessus;
      M.material.uniforms.echelleH.value = Math.max(20, this.hauteur * 0.35) * (k ? 1.5 : 1);
    });
  }

  /** À chaque image (Scene3D.rendre) : origine, lumière, temps ; coupée en vue en plan, en élévation et à l'accueil. */
  mettreAJour() {
    const s = this.s, lieu = s.tuilesPlan?.lieu;
    const on = this.actif && !s.modeVue && !s.vol && !!lieu && s.zRef != null;
    if (!on) { BRUME_SOL.z = 0; this.groupe.visible = false; return; }
    const C = this.carte;
    // nouveau lieu (ou origine flottante partie trop loin) : nouvelle carte, l'ancienne sert en attendant
    if (!this.enCours && (!C || Math.hypot(C.E0 - lieu.E0, C.N0 - lieu.N0) > 5000 || Math.abs(C.zRef - s.zRef) > 300))
      this.charger(lieu.E0, lieu.N0, s.zRef).catch(e => console.warn("Brume cinématique :", e.message));
    if (!C) { BRUME_SOL.z = 0; this.groupe.visible = false; return; }
    const ox = C.E0 - lieu.E0, oy = C.zRef - s.zRef, oz = -(C.N0 - lieu.N0);
    this.groupe.position.set(ox, oy, oz);
    const t = performance.now() / 1000;
    this.communs.temps.value = t;
    // brume de hauteur : densité au dessus de la nappe, échelle de hauteur selon l'épaisseur voulue
    const d = Math.max(0, Math.min(1, this.densite));
    BRUME_SOL.x = C.fond + this.hauteur + oy;
    BRUME_SOL.y = 1 / Math.max(15, this.hauteur * 0.3);
    BRUME_SOL.z = d > 0 ? 0.0035 * (2 * d) ** 2 : 0;
    BRUME_SOL.w = t;
    // lumière : ciel (bleuté) et soleil (dessus plus clair côté soleil), d'un blanc laiteux d'albédo ~0,85
    const ciel = s.ciel, sol = s.soleil, k = 0.58; // blanc laiteux (diffusion multiple : plus clair qu'un sol lambertien)
    const dir = this.communs.dirSoleil.value.copy(sol.position).normalize();
    this.communs.couleurCiel.value.copy(ciel.color).multiplyScalar(ciel.intensity * k);
    this.communs.couleurSoleil.value.copy(sol.color).multiplyScalar(sol.intensity * k * 0.45);
    const teinte = this.communs.couleurSoleil.value.clone().multiplyScalar(0.35 + 0.65 * Math.max(0, dir.y)).add(this.communs.couleurCiel.value);
    BRUME_SOL_TEINTE.x = teinte.r; BRUME_SOL_TEINTE.y = teinte.g; BRUME_SOL_TEINTE.z = teinte.b;
    BRUME_SOL_TEINTE.w = Math.min(1, 0.6 + 0.4 * d);
    this.mailles.forEach((M, i) => { M.material.uniforms.opacite.value = NAPPES[i].opacite * Math.min(1, 0.35 + 1.1 * d); });
    // nappes : seulement sur le paysage (sur la maquette seule, la carte de ~125 m serait trop grossière)
    const paysageVu = !!(s.loin.maille?.visible || s.monde?.terrain?.group.visible);
    this.groupe.visible = paysageVu && d > 0;
  }
}

/**
 * Case « Brume cinématique » et ses deux curseurs (onglet Affichage), retenus par ce navigateur ; coupée par défaut.
 * `$` : sélecteur de main.js.
 */
export function brancherBrumeCinematique(scene, $) {
  const memo = (cle, defaut) => { try { const v = localStorage.getItem(cle); return v === null ? defaut : +v; } catch { return defaut; } };
  const garder = (cle, v) => { try { localStorage.setItem(cle, String(v)); } catch { /* stockage indisponible */ } };
  const caseB = $("#vBrumeCine"), haut = $("#brumeCineHaut"), dens = $("#brumeCineDens");
  if (!caseB || !haut || !dens) return;
  caseB.checked = memo("ombres.brumeCine", 0) === 1;
  haut.value = memo("ombres.brumeCineHaut", 150); dens.value = memo("ombres.brumeCineDens", 50);
  const appliquer = () => {
    $("#brumeCineHautVal").textContent = `${haut.value} m`;
    $("#brumeCineDensVal").textContent = `${dens.value} %`;
    document.querySelectorAll("tr.brume-cine").forEach(tr => { tr.hidden = !caseB.checked; });
    scene.brumeCine.regler({ actif: caseB.checked, hauteur: +haut.value, densite: dens.value / 100 });
  };
  caseB.addEventListener("change", () => { garder("ombres.brumeCine", caseB.checked ? 1 : 0); appliquer(); });
  haut.addEventListener("input", () => { garder("ombres.brumeCineHaut", haut.value); appliquer(); });
  dens.addEventListener("input", () => { garder("ombres.brumeCineDens", dens.value); appliquer(); });
  appliquer();
}
