// Eau partout où l'on survole : rivières et lacs hors de la maquette fine (vol de l'accueil, paysage navigable, anneau
// et paysage lointain). La maquette fine garde son eau, tirée des points « eau » du nuage (grille.js).
//
// Source : couche « water » des tuiles vectorielles swisstopo (base.vt, polygones swissTLM3D : rivières et lacs), en
// tuiles Web Mercator : z14 (~1,7 km, berges au mètre) près de la caméra, z12 (~6,7 km, généralisées) jusqu'à 8 km ;
// décodées sans dépendance (mvt.js), gardées en cache. Une tuile pèse ~30–130 Ko (gzip) ; seule l'eau en est lue.
//
// Niveau : tiré du terrain qui est dessiné à cet endroit (sinon l'eau flotte ou se noie) — swissALTI3D 2 m près de la
// caméra (grille `fin` du lieu, ou tuiles kilométriques lues à la demande dans le paysage), relief Terrarium au loin.
// Rivière : minimum local (le lit, pas les berges) puis moyenne glissante sur ~25 m, dans le seul polygone : la surface
// suit la pente sans marches. Lac : un plan (médiane), calé sur le niveau du lac de la maquette s'il est le même.
// Rendu : matière de l'eau de la maquette (couleur du thème, reflets, grain, brume), un peu au-dessus du terrain et
// rapprochée de la caméra dans la profondeur (proportionnellement à la distance) : jamais de scintillement avec le
// terrain qu'elle recouvre, les berges plus hautes la coupent.
import * as THREE from "three";
import { PROF, COURANT, EAU_DECL, EAU_FRAG, EAU_COURANT, EAU_COURANT_FRAG_DECL, animerCourant } from "./eauShader.js";
import { lireCouche } from "./mvt.js";
import { versWgs, versMn95, tuilesAlti2m } from "./geo.js";
import { tuile as tuileRelief, versTuile } from "./horizon.js";
import { lireAlti } from "./grille.js";

const URL_VT = (z, x, y) => `https://vectortiles${(x + y) % 5}.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/${z}/${x}/${y}.pbf`;
// z14 : ~1,7 km, polygones swissTLM3D presque intacts ; dès z13 ils sont généralisés (berges à ~20 m près), assez au loin
const Z_PROCHE = 14, Z_LOIN = 12;
const RAYON_TERRE = 6371000, REFRACTION = 0.13;
// surface posée un peu au-dessus du terrain du lit (swissALTI3D y porte la surface de l’eau, à quelques décimètres près)
const LEVEE = 0.35;

// surfaces d'eau décodées par tuile (promesses), gardées d'un lieu à l'autre ; bornées
const POLYS = new Map(), POLYS_MAX = 96;
function polygonesTuile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (POLYS.has(k)) { const p = POLYS.get(k); POLYS.delete(k); POLYS.set(k, p); return p; }
  while (POLYS.size >= POLYS_MAX) POLYS.delete(POLYS.keys().next().value);
  const p = fetch(URL_VT(z, x, y)).then(r => r.ok ? r.arrayBuffer() : null).then(b => b ? extraire(new Uint8Array(b), z, x, y) : []);
  p.catch(() => POLYS.delete(k));
  POLYS.set(k, p);
  return p;
}

/** Tuile -> polygones d'eau en MN95 (coupés au bord exact de la tuile) : [{ classe, anneaux: [[[E, N], …], …], aire }]. */
function extraire(octets, z, tx, ty) {
  const { entites, etendue } = lireCouche(octets, "water"), n = 2 ** z;
  const versMN = ([px, py]) => {
    const lon = (tx + px / etendue) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + py / etendue) / n))) * 180 / Math.PI;
    return versMn95(lon, lat);
  };
  const aireSignee = a => { let s = 0; for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += (a[j][0] - a[i][0]) * (a[j][1] + a[i][1]); return s / 2; };
  const out = [];
  for (const e of entites) {
    if (e.type !== 3 || e.props.class === "pool") continue; // piscines : celles de la maquette viennent du cadastre
    let poly = null;
    for (const brut of e.anneaux) {
      const exterieur = aireSignee(brut) > 0; // spécification MVT : aire positive (formule de l'arpenteur) en coordonnées de tuile
      const a = couper(brut, etendue);
      if (a.length < 3) { if (exterieur) poly = null; continue; }
      const m = a.map(versMN);
      if (exterieur) { poly = { classe: e.props.class, anneaux: [m] }; out.push(poly); } else if (poly) poly.anneaux.push(m);
    }
  }
  for (const p of out) p.aire = Math.abs(aireSignee(p.anneaux[0])) - p.anneaux.slice(1).reduce((s, a) => s + Math.abs(aireSignee(a)), 0);
  return out;
}

/** Anneau coupé au carré [0, e]² (Sutherland–Hodgman) : les tuiles voisines ne se recouvrent pas. */
function couper(anneau, e) {
  let a = anneau;
  if (a.length > 1 && a[0][0] === a.at(-1)[0] && a[0][1] === a.at(-1)[1]) a = a.slice(0, -1);
  for (const [k, lim, dedans] of [[0, 0, v => v >= 0], [0, e, v => v <= e], [1, 0, v => v >= 0], [1, e, v => v <= e]]) {
    const r = [];
    for (let i = 0; i < a.length; i++) {
      const P = a[i], Q = a[(i + 1) % a.length], dp = dedans(P[k]), dq = dedans(Q[k]);
      if (dp) r.push(P);
      if (dp !== dq) { const t = (lim - P[k]) / (Q[k] - P[k]); r.push(k === 0 ? [lim, P[1] + t * (Q[1] - P[1])] : [P[0] + t * (Q[0] - P[0]), lim]); }
    }
    a = r;
    if (a.length < 3) return [];
  }
  return a;
}

/** Tuiles (z) qui touchent le disque (E, N, R) : [[x, y], …]. */
function tuilesDisque(E, N, R, z) {
  const coins = [[E - R, N - R], [E + R, N + R], [E - R, N + R], [E + R, N - R]].map(([e, n]) => versTuile(...versWgs(e, n), z));
  const x0 = Math.floor(Math.min(...coins.map(c => c[0]))), x1 = Math.floor(Math.max(...coins.map(c => c[0])));
  const y0 = Math.floor(Math.min(...coins.map(c => c[1]))), y1 = Math.floor(Math.max(...coins.map(c => c[1])));
  const r = [], n = 2 ** z;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    // boîte de la tuile en MN95 (presque alignée sur la grille suisse), distance au centre
    const c = [[x, y], [x + 1, y + 1]].map(([a, b]) => versMn95(a / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * b / n))) * 180 / Math.PI));
    const dx = Math.max(c[0][0] - E, 0, E - c[1][0]), dy = Math.max(c[1][1] - N, 0, N - c[0][1]);
    if (Math.hypot(dx, dy) <= R) r.push([x, y, Math.hypot((c[0][0] + c[1][0]) / 2 - E, (c[0][1] + c[1][1]) / 2 - N)]);
  }
  return r.sort((a, b) => a[2] - b[2]);
}

const dansAnneaux = (anneaux, x, y) => {
  let d = false;
  for (const a of anneaux) for (let i = 0, j = a.length - 1; i < a.length; j = i++)
    if ((a[i][1] > y) !== (a[j][1] > y) && x < (a[j][0] - a[i][0]) * (y - a[i][1]) / (a[j][1] - a[i][1]) + a[i][0]) d = !d;
  return d;
};
const pause = () => new Promise(r => setTimeout(r, 0));

/**
 * Niveau d'une rivière : grille de pas `g` sur le polygone ; terrain dans le polygone, minimum local (3 × 3 cases), puis
 * moyenne glissante (~25 m, deux passes) restreinte au polygone, prolongée de 3 cases au-delà (sommets des berges).
 * Renvoie niveau(E, N) (NaN si inconnu).
 */
function champRiviere(anneaux, hauteur, g) {
  let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
  for (const a of anneaux) for (const [e, n] of a) { e0 = Math.min(e0, e); e1 = Math.max(e1, e); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
  const cells = (e1 - e0) * (n1 - n0) / (g * g);
  if (cells > 1.5e6) g *= Math.sqrt(cells / 1.5e6);
  e0 -= 4 * g; n0 -= 4 * g;
  const nx = Math.ceil((e1 - e0) / g) + 5, ny = Math.ceil((n1 - n0) / g) + 5, N = nx * ny;
  const masque = new Uint8Array(N), v = new Float32Array(N).fill(NaN);
  // masque : balayage par lignes (croisements des côtés), puis terrain dans le polygone
  const xs = [];
  for (let j = 0; j < ny; j++) {
    const y = n0 + (j + 0.5) * g;
    xs.length = 0;
    for (const a of anneaux) for (let i = 0, k = a.length - 1; i < a.length; k = i++)
      if ((a[i][1] > y) !== (a[k][1] > y)) xs.push((a[k][0] - a[i][0]) * (y - a[i][1]) / (a[k][1] - a[i][1]) + a[i][0]);
    xs.sort((p, q) => p - q);
    for (let t = 0; t + 1 < xs.length; t += 2) {
      const i0 = Math.max(0, Math.ceil((xs[t] - e0) / g - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[t + 1] - e0) / g - 0.5));
      for (let i = i0; i <= i1; i++) { const p = j * nx + i; masque[p] = 1; v[p] = hauteur(e0 + (i + 0.5) * g, y); }
    }
  }
  // minimum local (séparable, 3 × 3 cases) : le lit plutôt que les bancs et les berges
  const r = 1, tmp = new Float32Array(N).fill(NaN);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = j * nx + i; if (!masque[p]) continue;
    let m = Infinity;
    for (let a = Math.max(0, i - r); a <= Math.min(nx - 1, i + r); a++) { const w = v[j * nx + a]; if (w < m) m = w; }
    tmp[p] = m === Infinity ? NaN : m;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = j * nx + i; if (!masque[p]) continue;
    let m = Infinity;
    for (let b = Math.max(0, j - r); b <= Math.min(ny - 1, j + r); b++) { const w = tmp[b * nx + i]; if (w < m) m = w; }
    v[p] = m === Infinity ? NaN : m;
  }
  // moyenne glissante dans le polygone (sommes courantes, lignes puis colonnes), deux passes
  const rb = Math.max(1, Math.round(12 / g)), S = new Float64Array(N), C = new Float64Array(N);
  for (let passe = 0; passe < 2; passe++) {
    for (let j = 0; j < ny; j++) {
      let s = 0, c = 0;
      const val = i => { const w = v[j * nx + i]; return w === w ? w : 0; }, cnt = i => { const w = v[j * nx + i]; return w === w ? 1 : 0; };
      for (let i = 0; i < Math.min(nx, rb); i++) { s += val(i); c += cnt(i); }
      for (let i = 0; i < nx; i++) {
        if (i + rb < nx) { s += val(i + rb); c += cnt(i + rb); }
        if (i - rb - 1 >= 0) { s -= val(i - rb - 1); c -= cnt(i - rb - 1); }
        S[j * nx + i] = s; C[j * nx + i] = c;
      }
    }
    for (let i = 0; i < nx; i++) {
      let s = 0, c = 0;
      for (let j = 0; j < Math.min(ny, rb); j++) { s += S[j * nx + i]; c += C[j * nx + i]; }
      for (let j = 0; j < ny; j++) {
        if (j + rb < ny) { s += S[(j + rb) * nx + i]; c += C[(j + rb) * nx + i]; }
        if (j - rb - 1 >= 0) { s -= S[(j - rb - 1) * nx + i]; c -= C[(j - rb - 1) * nx + i]; }
        const p = j * nx + i;
        tmp[p] = masque[p] && c > 0 ? s / c : NaN;
      }
    }
    v.set(tmp);
  }
  // prolongé au-delà du polygone (les sommets des berges tombent à cheval sur le bord)
  for (let k = 0; k < 3; k++) {
    tmp.set(v);
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const p = j * nx + i; if (v[p] === v[p]) continue;
      let s = 0, c = 0;
      for (const q of [p - 1, p + 1, p - nx, p + nx]) if (v[q] === v[q]) { s += v[q]; c++; }
      if (c) tmp[p] = s / c;
    }
    v.set(tmp);
  }
  return (E, N) => {
    const fx = (E - e0) / g - 0.5, fy = (N - n0) / g - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, w = fy - j;
    let s = 0, c = 0;
    for (const [a, b, k] of [[i, j, (1 - u) * (1 - w)], [i + 1, j, u * (1 - w)], [i, j + 1, (1 - u) * w], [i + 1, j + 1, u * w]]) {
      if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const h = v[b * nx + a];
      if (h === h) { s += h * k; c += k; }
    }
    return c > 1e-6 ? s / c : NaN;
  };
}

/** Matière : celle de l'eau de la maquette (scene.js, matEau + grain), avec courbure, décalage de profondeur et zones. */
function materiau(U) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, PROF, COURANT);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float lac;\nattribute vec2 flot;\nvarying vec2 vFlot;\nvarying vec3 vEauM;\nvarying float vLac;\nuniform float courbure, hausse;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vec4 eauM = modelMatrix * vec4(transformed, 1.0);
transformed.y += hausse - dot(eauM.xz, eauM.xz) * courbure; // courbure de la Terre (comme le paysage)
vEauM = eauM.xyz; vLac = lac; vFlot = flot;`)
      .replace("#include <project_vertex>", `#include <project_vertex>
{ // rapprochée de la caméra dans la profondeur seulement (même pixel) : 0,25 m + 1,5 ‰ de la distance
  float dV = length(mvPosition.xyz);
  mvPosition.xyz *= 1.0 - min(0.5, (0.25 + 0.0015 * dV) / max(dV, 1.0));
  gl_Position = projectionMatrix * mvPosition;
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vEauM;
varying float vLac;
${EAU_COURANT_FRAG_DECL}
uniform vec3 proche; // centre (x, z) et rayon de la zone des tuiles proches
uniform float cote;  // 1 : tuile proche (gardée dans le disque), -1 : lointaine (gardée hors du disque)
uniform vec3 trou;   // maquette fine : rayon, 1 si carrée ; rayon réservé aux lacs (lac de l'anneau)
uniform float exterieur; // au-delà, pas de terrain dessiné (paysage masqué) : pas d'eau non plus
${EAU_DECL}`)
      .replace("void main() {", `void main() {
  {
    float dP = length(vEauM.xz - proche.xy);
    if (cote * (dP - proche.z) > 0.0) discard;
    float dT = trou.y > 0.5 ? max(abs(vEauM.x), abs(vEauM.z)) : length(vEauM.xz);
    float dO = length(vEauM.xz);
    if (dT < trou.x || (vLac > 0.5 && dO < trou.z) || dO > exterieur) discard;
  }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
${EAU_FRAG}
${EAU_COURANT}`);
  };
  m.customProgramCacheKey = () => "eauVecteur";
  return m;
}

export class EauVecteur {
  /** `s` : la Scene (scene.js). Le groupe vit dans s.scene (comme le monde) : il suit l'origine flottante. */
  constructor(s) {
    this.s = s;
    this.groupe = new THREE.Group();
    this.groupe.name = "eauVecteur";
    this.groupe.visible = false;
    s.scene.add(this.groupe);
    (s.horsAO ||= []).push(this.groupe); // plate et translucide : pas d'occlusion ambiante (comme l'eau de la maquette)
    const commun = { courbure: { value: 0 }, hausse: { value: 0 }, trou: { value: new THREE.Vector3() }, proche: { value: new THREE.Vector3(0, 0, 1e9) }, exterieur: { value: 1e9 } };
    this.matProche = materiau({ ...commun, cote: { value: 1 } });
    this.matLoin = materiau({ ...commun, cote: { value: -1 } });
    this.U = commun;
    this.mailles = new Map(); // clé de tuile -> Mesh (ou null : tuile sans eau)
    this.gen = 0;
    this.alti = new Map(); // tuile kilométrique swissALTI3D "e-n" -> grille (paysage)
  }

  /**
   * Lieu : `origine()` -> { E, N, zRef } (centre de la scène, suit l'origine flottante) ; `fin` : grille swissALTI3D 2 m
   * du lieu (terrain dessiné jusqu'à `rayonFin`) ; `alti` : lire swissALTI3D à la demande autour de la caméra (paysage,
   * sinon le relief Terrarium dessiné au-delà de `fin`) ; `trou` : rayon de la maquette fine (son eau vient du nuage),
   * `carre` si elle est carrée ; `trouLac` : rayon où le lac est déjà dessiné (anneau) ; `niveauLac` : niveau connu ;
   * `courbure` : 1 - réfraction (paysage Terrarium) ou 1 (terrain du monde) ; `rayonLoin` : portée des tuiles lointaines ;
   * `sol(E, N)` : terrain de la maquette fine (prioritaire), `hausse` : surélévation (terrain du monde, plus grossier) ;
   * `rayonSansPaysage` : limite de l'eau quand ni paysage ni anneau ne sont montrés.
   */
  configurer(o) {
    this.gen++;
    for (const m of this.mailles.values()) if (m) { m.geometry.dispose(); m.removeFromParent(); }
    this.mailles.clear();
    const fin = o.fin || null;
    this.o = {
      trou: 0, carre: false, trouLac: 0, niveauLac: NaN, alti: false, courbure: 1 - REFRACTION, rayonLoin: 8000,
      rayonProche: fin ? fin.n * fin.c / 2 - 50 : 2000, suitCamera: !!o.alti, ...o, fin,
    };
    const { E, N } = this.o.origine();
    this.E0c = E; this.N0c = N; // origine du relief Terrarium (paysage lointain : niveaux de tuiles selon la distance)
    this.U.trou.value.set(this.o.trou, this.o.carre ? 1 : 0, this.o.trouLac);
    this.U.courbure.value = this.o.courbure / (2 * RAYON_TERRE);
    this.U.hausse.value = this.o.hausse || 0;
    this.centre = null; this.plan = null; this.portee = 0;
    this.groupe.visible = true;
    this.s.demander?.(2);
  }

  cacher() { this.gen++; this.groupe.visible = false; this.o = null; this.plan = null; this.portee = 0; }

  /** À chaque image (scene.rendre) : place les tuiles (origine flottante) et, si la caméra s'est éloignée, replanifie. */
  mettreAJour() {
    const s = this.s;
    // maquette coupée ou vue en élévation : seule la maquette est montrée (comme le paysage)
    this.groupe.visible = !!this.o && !(s.coupe && s.couperModele !== false) && !(s.modeVue && s.modeVue !== "plan");
    if (!this.groupe.visible) return;
    animerCourant(s, [...this.mailles.values()].some(m => m?.userData.coule));
    // couleur du thème : celle de l'eau de la maquette
    if (s.mat?.eau) { this.matProche.color.copy(s.mat.eau.color); this.matLoin.color.copy(s.mat.eau.color); }
    // pas d'eau au-delà du terrain dessiné : paysage (ou monde) visible, sinon l'anneau, sinon la maquette du vol
    const paysage = !!(s.loin.maille?.visible || s.monde?.terrain?.group.visible);
    this.U.exterieur.value = paysage ? 1e9 : Math.max(s.rayonExt || 0, this.o.rayonSansPaysage || 0);
    const { E, N, zRef } = this.o.origine();
    if (E !== this.Eg || N !== this.Ng || zRef !== this.Zg) {
      Object.assign(this, { Eg: E, Ng: N, Zg: zRef });
      for (const m of this.mailles.values()) if (m) m.position.set(m.userData.E - E, -zRef, -(m.userData.N - N));
      if (this.centre) this.U.proche.value.set(this.centre[0] - E, -(this.centre[1] - N), this.o.rayonProche);
    }
    // centre des tuiles proches : l'origine (vol, maquette : le terrain fin y est dessiné) ou la caméra (paysage)
    // rien à montrer (maquette seule, avec son eau) : rien à charger ; la portée change avec le paysage affiché
    const portee = this.U.exterieur.value;
    if (portee <= this.o.trou) return;
    const cam = this.s.camera.position, F = this.o.suitCamera ? [E + cam.x, N - cam.z] : [E, N];
    if (!this.plan || portee > this.portee || Math.hypot(F[0] - this.plan[0], F[1] - this.plan[1]) > 400) { this.plan = F; this.portee = portee; this.planifier(F, portee); }
  }

  async planifier([E, N], portee) {
    const gen = this.gen, o = this.o, Rp = o.rayonProche;
    const proches = tuilesDisque(E, N, Math.min(Rp, portee) + 100, Z_PROCHE).map(([x, y]) => [Z_PROCHE, x, y]);
    const loin = portee > Rp ? tuilesDisque(E, N, Math.min(o.rayonLoin, portee), Z_LOIN).map(([x, y]) => [Z_LOIN, x, y]) : [];
    const voulues = new Set([...proches, ...loin].map(t => t.join("/")));
    // les tuiles proches d'abord ; le centre ne bascule qu'une fois elles prêtes (sinon un trou dans l'eau)
    for (const t of proches) { await this.tuile(...t, gen); if (gen !== this.gen || this.plan[0] !== E || this.plan[1] !== N) return; }
    this.centre = [E, N];
    const { E: Eo, N: No } = o.origine();
    this.U.proche.value.set(E - Eo, -(N - No), Rp);
    this.s.demander?.(2);
    for (const t of loin) { await this.tuile(...t, gen); if (gen !== this.gen) return; }
    // tuiles qui ne servent plus : libérées (au-delà d'une réserve, pour les allers-retours)
    if (this.mailles.size > 60) for (const [k, m] of this.mailles) if (!voulues.has(k)) { if (m) { m.geometry.dispose(); m.removeFromParent(); } this.mailles.delete(k); }
  }

  /** Construit (une fois) le maillage d'eau d'une tuile. */
  async tuile(z, x, y, gen) {
    const k = `${z}/${x}/${y}`;
    if (this.mailles.has(k)) return;
    this.mailles.set(k, null);
    const t0 = performance.now();
    let polys;
    try { polys = await polygonesTuile(z, x, y); } catch (e) { this.mailles.delete(k); return; }
    if (gen !== this.gen) return;
    const proche = z === Z_PROCHE, o = this.o;
    polys = polys.filter(p => p.aire > (proche ? 150 : 4000));
    if (!polys.length) return;
    // ancre de la tuile (MN95, au mètre) : sommets en coordonnées locales (précision des flottants)
    const n = 2 ** z, [Ea, Na] = versMn95((x + 0.5) / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n))) * 180 / Math.PI).map(Math.round);
    const pos = [], lac = [], flot = [];
    for (const p of polys) {
      const estLac = p.classe !== "river";
      const hauteur = await this.hauteurs(p, proche, estLac);
      if (gen !== this.gen) return;
      if (!hauteur) continue;
      this.trianguler(p, hauteur, estLac, proche, Ea, Na, pos, lac, flot);
      await pause(); // un polygone à la fois : la vue reste fluide
      if (gen !== this.gen) return;
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("lac", new THREE.Float32BufferAttribute(lac, 1));
    g.setAttribute("flot", new THREE.Float32BufferAttribute(flot, 2));
    const coule = flot.some(v => v !== 0);
    const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, proche ? this.matProche : this.matLoin);
    m.userData = { E: Ea, N: Na, ms: Math.round(performance.now() - t0), coule: coule && proche };
    m.receiveShadow = false; m.castShadow = false; // comme l'eau de la maquette (moiré sur un grand plan)
    m.renderOrder = 1;
    m.frustumCulled = false; // la courbure déplace les sommets dans le shader
    m.raycast = () => {};
    const { E, N, zRef } = o.origine();
    m.position.set(Ea - E, -zRef, -(Na - N));
    this.groupe.add(m);
    this.mailles.set(k, m);
    this.s.demander?.(2);
  }

  /**
   * Fonction niveau(E, N) d'un polygone, ou null. Proche : swissALTI3D (grille `fin`, ou tuiles lues à la demande) ;
   * loin, ou faute de mieux : relief Terrarium (celui du paysage lointain).
   */
  async hauteurs(p, proche, estLac) {
    const o = this.o, fin = o.fin;
    const hFin = fin ? (E, N) => {
      const fx = (E - fin.e0) / fin.c - 0.5, fy = (fin.n1 - N) / fin.c - 0.5, i = Math.floor(fx), j = Math.floor(fy);
      if (i < 0 || j < 0 || i >= fin.n - 1 || j >= fin.n - 1) return NaN;
      const u = fx - i, v = fy - j, q = j * fin.n + i, H = fin.h;
      return (H[q] * (1 - u) + H[q + 1] * u) * (1 - v) + (H[q + fin.n] * (1 - u) + H[q + fin.n + 1] * u) * v;
    } : () => NaN;
    // tuiles swissALTI3D (paysage) : celles que le polygone touche (pour un lac, les deux plus proches de la caméra)
    let hAlti = () => NaN;
    if (proche && o.alti) {
      const cles = new Map();
      const pas = estLac ? 250 : 40;
      for (const a of p.anneaux) for (let i = 0; i < a.length; i++) {
        const [e, n] = a[i], [e2, n2] = a[(i + 1) % a.length], m = Math.ceil(Math.hypot(e2 - e, n2 - n) / pas);
        for (let t = 0; t < m; t++) { const E = e + (e2 - e) * t / m, N = n + (n2 - n) * t / m; cles.set(`${Math.floor(E / 1000)}-${Math.floor(N / 1000)}`, Math.hypot(E - this.plan[0], N - this.plan[1])); }
      }
      // au-delà du disque des tuiles proches, l'eau proche n'est pas dessinée : rien à lire
      let voulues = [...cles].sort((a, b) => a[1] - b[1]).filter(c => c[1] < o.rayonProche + 300).map(c => c[0]);
      if (estLac) voulues = voulues.slice(0, 2);
      await Promise.all(voulues.map(c => this.chargerAlti(c)));
      hAlti = (E, N) => {
        const T = this.alti.get(`${Math.floor(E / 1000)}-${Math.floor(N / 1000)}`);
        if (!T) return NaN;
        const fx = (E - T.bx0) / 2 - 0.5, fy = (T.by1 - N) / 2 - 0.5, i = Math.min(T.w - 2, Math.max(0, Math.floor(fx))), j = Math.min(T.h - 2, Math.max(0, Math.floor(fy)));
        const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fy - j)), q = j * T.w + i, H = T.ras;
        const r = (H[q] * (1 - u) + H[q + 1] * u) * (1 - v) + (H[q + T.w] * (1 - u) + H[q + T.w + 1] * u) * v;
        return r > -1000 ? r : NaN;
      };
    }
    // relief Terrarium (mêmes niveaux de tuiles que le paysage lointain : 13 jusqu'à 3 km de l'origine, puis 12)
    const zEn = (E, N) => Math.hypot(E - this.E0c, N - this.N0c) < 3000 ? 13 : 12;
    const cleT = (E, N) => { const z = zEn(E, N), [tx, ty] = versTuile(...versWgs(E, N), z); return [`${z}/${Math.floor(tx)}/${Math.floor(ty)}`, tx, ty]; };
    const T = new Map(), besoin = new Set();
    for (const a of p.anneaux) for (let i = 0; i < a.length; i += Math.max(1, Math.floor(a.length / 400))) besoin.add(cleT(...a[i])[0]);
    await Promise.all([...besoin].map(async c => { try { T.set(c, await tuileRelief(...c.split("/").map(Number))); } catch { /* hors couverture */ } }));
    const hTerr = (E, N) => {
      const [c, tx, ty] = cleT(E, N), h = T.get(c);
      if (!h) return NaN;
      const fx = Math.min(254.999, Math.max(0, (tx - Math.floor(tx)) * 256 - 0.5)), fy = Math.min(254.999, Math.max(0, (ty - Math.floor(ty)) * 256 - 0.5));
      const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, q = j * 256 + i;
      return (h[q] * (1 - u) + h[q + 1] * u) * (1 - v) + (h[q + 256] * (1 - u) + h[q + 257] * u) * v;
    };
    const hSol = o.sol || (() => NaN); // terrain de la maquette fine elle-même (quand elle n'a pas d'eau mesurée)
    const h = proche ? (E, N) => { let r = hSol(E, N); if (r !== r) r = hFin(E, N); if (r !== r) r = hAlti(E, N); return r === r ? r : hTerr(E, N); } : hTerr;
    if (estLac) {
      // un plan : médiane du terrain sur une trame du polygone (le terrain dessiné y porte la surface du lac)
      let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
      for (const [e, n] of p.anneaux[0]) { e0 = Math.min(e0, e); e1 = Math.max(e1, e); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
      const pas = Math.max(6, Math.sqrt(p.aire / 300)), z = [];
      for (let N = n0 + pas / 2; N < n1; N += pas) for (let E = e0 + pas / 2; E < e1; E += pas)
        if (dansAnneaux(p.anneaux, E, N)) { const v = h(E, N); if (v === v) z.push(v); }
      if (!z.length) for (const [E, N] of p.anneaux[0]) { const v = h(E, N); if (v === v) z.push(v); }
      if (!z.length) return null;
      z.sort((a, b) => a - b);
      let niv = z[Math.floor(z.length * 0.3)];
      if (Math.abs(niv - o.niveauLac) < 3) niv = o.niveauLac; // le lac de la maquette : même niveau (sans marche)
      return () => niv;
    }
    const champ = champRiviere(p.anneaux, h, proche ? 4 : 20);
    return (E, N) => { const v = champ(E, N); return v === v ? v : h(E, N); };
  }

  async chargerAlti(cle) {
    if (this.alti.has(cle)) return;
    this.alti.set(cle, null);
    const [e, n] = cle.split("-").map(Number);
    try {
      const [t] = await tuilesAlti2m([e * 1000 + 10, n * 1000 + 10, e * 1000 + 990, n * 1000 + 990]);
      if (t) this.alti.set(cle, await lireAlti(t.url));
    } catch (err) { console.warn("Eau, swissALTI3D :", cle, err.message); }
    if (this.alti.size > 40) { const k = this.alti.keys().next().value; if (k !== cle) this.alti.delete(k); }
  }

  /** Triangule un polygone (points de Steiner à l'intérieur : la surface suit le niveau), niveau + LEVEE. */
  trianguler(p, niveau, estLac, proche, Ea, Na, pos, lac, flot = null) {
    const V2 = ([e, n]) => new THREE.Vector2(e - Ea, n - Na);
    const contour = p.anneaux[0].map(V2), trous = p.anneaux.slice(1).map(a => a.map(V2));
    // points de Steiner : trame régulière, assez dense pour la pente d'une rivière et pour la courbure d'un lac
    let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
    for (const [e, n] of p.anneaux[0]) { e0 = Math.min(e0, e); e1 = Math.max(e1, e); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
    let pas = estLac ? 400 : proche ? 30 : 120;
    while ((e1 - e0) * (n1 - n0) / (pas * pas) > 3000) pas *= 1.5;
    for (let N = n0 + pas / 2; N < n1; N += pas) for (let E = e0 + pas / 2; E < e1; E += pas) {
      if (!dansAnneaux(p.anneaux, E, N)) continue;
      // pas trop près d'un bord (triangles dégénérés)
      if ([[pas / 4, 0], [-pas / 4, 0], [0, pas / 4], [0, -pas / 4]].some(([a, b]) => !dansAnneaux(p.anneaux, E + a, N + b))) continue;
      trous.push([new THREE.Vector2(E - Ea, N - Na)]);
    }
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, trous); } catch { return; }
    const tous = [contour, ...trous].flat(), z = tous.map(v => niveau(v.x + Ea, v.y + Na) + LEVEE);
    const l = estLac ? 1 : 0;
    // rivière : sens du courant par sommet = pente de la surface (vers l'aval), moyenne des triangles qui le touchent,
    // pondérée par leur aire ; nulle sur un lac ou une eau presque plate
    const fx = new Float32Array(tous.length), fy = new Float32Array(tous.length), poids = new Float32Array(tous.length);
    if (!estLac) for (const t of tris) {
      if (t.some(i => !(z[i] === z[i]))) continue;
      const [a, b, c] = t.map(i => tous[i]), [za, zb, zc] = t.map(i => z[i]);
      const A2 = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (!(Math.abs(A2) > 1e-3)) continue;
      const gx = ((zb - za) * (c.y - a.y) - (zc - za) * (b.y - a.y)) / A2, gy = ((zc - za) * (b.x - a.x) - (zb - za) * (c.x - a.x)) / A2, w = Math.abs(A2);
      for (const i of t) { fx[i] -= gx * w; fy[i] -= gy * w; poids[i] += w; }
    }
    for (const t of tris) {
      if (t.some(i => !(z[i] === z[i]))) continue;
      for (const i of t) {
        pos.push(tous[i].x, z[i], -tous[i].y); lac.push(l);
        const gx = poids[i] ? fx[i] / poids[i] : 0, gy = poids[i] ? fy[i] / poids[i] : 0, g = Math.hypot(gx, gy);
        // pente de plus de 0,2 ‰ : sens fiable ; en coordonnées de la scène (x = est, z = -nord)
        if (flot) flot.push(g > 2e-4 ? gx / g : 0, g > 2e-4 ? -gy / g : 0);
      }
    }
  }
}
