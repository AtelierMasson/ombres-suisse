// Arbres de l'anneau (grand cercle, au-delà du relevé fin) : points de végétation du relevé laser, chargés selon la
// caméra. Le nuage COPC est un octree : chaque nœud ajoute des points à ceux de ses parents (profondeur d = espacement
// de la tuile / 2^d). On garde les nœuds qui touchent l'anneau et, à chaque déplacement de la caméra, on choisit
// lesquels afficher : plus profonds près de la caméra et dans le champ, plus grossiers au loin, dans un budget de
// points. Les nœuds manquants sont demandés aux fils de nuage.worker.js (file par priorité, demandes devenues inutiles
// abandonnées) ; ceux qui ne servent plus sont rendus (budget de mémoire) mais leurs points décodés restent un moment
// en mémoire (nouveau rayon, voyage au clavier). La taille des points suit la finesse affichée à chaque endroit
// (petite texture), pour que la couverture reste la même d'un niveau à l'autre.
import * as THREE from "three";
import { Copc } from "copc";
import { materiauPoints } from "./maillages.js";

const VEGETATION = [3, 4, 5];
const ESPACEMENT_FIN = 0.5; // nœuds les plus fins : ~0,4 m (comme la maquette fine)
const SEUIL_PX = 2.2; // un nœud est affiné tant que son espacement dépasse ~2 pixels à l'écran
const HORS_CHAMP = 6; // hors du champ : beaucoup moins de finesse (on garde de quoi tourner la tête)
const BUDGET_POINTS = 3.2e6; // points de végétation affichés au plus (avant : jusqu'à 3,8 M pour 1000 m)
const BUDGET_GPU = 4.2e6; // points gardés sur la carte graphique (affichés + récents), ~20 octets chacun
const MEMOIRE_MAX = 48e6; // octets de points décodés gardés entre deux anneaux (nouveau rayon, voyage)
const TEX = 256; // texture des tailles (par case)
const LIGNE_TAILLE = "float px = taille * echelle / max(0.1, -mvPosition.z);";

/* ------------------------------------------------------------------ mémoire partagée (toutes les instances) */
const entetes = new Map(); // url -> Promise<{ copc, noeuds: [[cle, noeud]] }>
const memoire = new Map(); // `${url}|${cle}` -> { X, Y, Z, n, octets } (relatifs à l'origine de la tuile)
let octetsMemoire = 0;
function garderEnMemoire(k, v) {
  if (memoire.has(k)) return;
  memoire.set(k, v); octetsMemoire += v.octets;
  for (const [a, w] of memoire) { if (octetsMemoire <= MEMOIRE_MAX) break; memoire.delete(a); octetsMemoire -= w.octets; }
}
function lireMemoire(k) { const v = memoire.get(k); if (v) { memoire.delete(k); memoire.set(k, v); } return v; } // plus récent à la fin

/** En-tête et hiérarchie complète d'une tuile (jusqu'à la finesse utile), une fois par tuile. */
function entete(url) {
  if (!entetes.has(url)) entetes.set(url, (async () => {
    const copc = await Copc.create(url), noeuds = [];
    const profMax = Math.max(0, Math.ceil(Math.log2(copc.info.spacing / ESPACEMENT_FIN)));
    const pages = [copc.info.rootHierarchyPage];
    while (pages.length) {
      const { nodes, pages: sous } = await Copc.loadHierarchyPage(url, pages.pop());
      for (const [k, n] of Object.entries(nodes)) if (n?.pointCount && +k.split("-")[0] <= profMax) noeuds.push([k, n]);
      for (const [k, p] of Object.entries(sous)) if (+k.split("-")[0] <= profMax) pages.push(p);
    }
    return { copc, noeuds, profMax };
  })().catch(e => { entetes.delete(url); throw e; }));
  return entetes.get(url);
}

function rendreTableau() { this.array = null; }

/* ------------------------------------------------------------------ tas (file par priorité) */
function pousser(tas, n) {
  tas.push(n);
  for (let i = tas.length - 1; i > 0;) { const p = (i - 1) >> 1; if (tas[p].prio >= tas[i].prio) break; [tas[p], tas[i]] = [tas[i], tas[p]]; i = p; }
}
function tirer(tas) {
  const haut = tas[0], dernier = tas.pop();
  if (tas.length) {
    tas[0] = dernier;
    for (let i = 0; ;) {
      const a = 2 * i + 1, b = a + 1; let m = i;
      if (a < tas.length && tas[a].prio > tas[m].prio) m = a;
      if (b < tas.length && tas[b].prio > tas[m].prio) m = b;
      if (m === i) break;
      [tas[m], tas[i]] = [tas[i], tas[m]]; i = m;
    }
  }
  return haut;
}

export class LodAnneau {
  /**
   * `scene` : la Scene ; `tuiles` : tuiles COPC (tuilesNuage) ; `lieu` = { E0, N0, Rint, Rext }.
   * Les points s'affichent dans scene.couches.releveAnneau (un conteneur dont les enfants sont les nœuds).
   */
  constructor(scene, tuiles, { E0, N0, Rint, Rext }) {
    Object.assign(this, { scene, tuiles, E0, N0, Rint, Rext });
    this.noeuds = []; this.racines = [];
    this.selection = new Set();
    this.file = []; this.arrivees = []; this.enVol = new Map();
    this.ratioVeg = 0.5; this.vusRatio = [0, 0]; // part des points d'un nœud gardée (végétation dans l'anneau)
    this.pointsGPU = 0; this.fini = false; this.signature = ""; this.aSelectionner = true; this.derniereSel = 0;
    this.stats = { selection: 0, affiches: 0, majMs: 0, enAttente: 0 };
    this.libererTableaux = true; // tableaux rendus une fois envoyés à la carte graphique (les points décodés restent en mémoire)
    this.budget = BUDGET_POINTS; this.seuilPx = SEUIL_PX; // réglables (mesures)
    this.haut = null; // sommet de la végétation par case de 4 m (teinte : hauteur dans la couronne)
  }

  async demarrer() {
    const { E0, N0, Rint, Rext } = this;
    const lots = await Promise.all(this.tuiles.map(t => entete(t.url).then(h => ({ url: t.url, ...h }))));
    if (this.fini) return;
    const r0 = Rint * Rint, r1 = Rext * Rext, parCle = new Map();
    for (const { url, copc, noeuds } of lots) {
      const cube = copc.info.cube, cote = cube[3] - cube[0];
      for (const [cle, info] of noeuds) {
        const [d, x, y, z] = cle.split("-").map(Number), s = cote / 2 ** d;
        const e0 = cube[0] + x * s - E0, n0 = cube[1] + y * s - N0, e1 = e0 + s, n1 = n0 + s;
        // garde les nœuds qui touchent l'anneau (ni tout dedans le cercle fin, ni hors du grand cercle)
        const proche = Math.max(e0, 0, -e1) ** 2 + Math.max(n0, 0, -n1) ** 2, loin = Math.max(e0 * e0, e1 * e1) + Math.max(n0 * n0, n1 * n1);
        if (proche > r1 || loin < r0) continue;
        const n = {
          cle, url, copc, info, d, sp: copc.info.spacing / 2 ** d, ox: cube[0], oy: cube[1],
          boite: new THREE.Box3(new THREE.Vector3(e0, cube[2] + z * s, -n1), new THREE.Vector3(e1, cube[2] + (z + 1) * s, -n0)),
          xy: [e0, n0, e1, n1], parent: null, enfants: [], etat: 0, obj: null, nbVeg: null, vu: 0, prio: 0, proj: 0,
        };
        parCle.set(`${url}|${cle}`, n); this.noeuds.push(n);
      }
    }
    for (const n of this.noeuds) {
      if (!n.d) { this.racines.push(n); continue; }
      const [, x, y, z] = n.cle.split("-").map(Number), p = parCle.get(`${n.url}|${n.d - 1}-${x >> 1}-${y >> 1}-${z >> 1}`);
      if (p) { n.parent = p; p.enfants.push(n); } else this.racines.push(n);
    }
    // altitudes du nœud : relatives à la scène (les boîtes ont été faites en altitude absolue)
    for (const n of this.noeuds) { n.boite.min.y -= this.scene.zRef; n.boite.max.y -= this.scene.zRef; }
    this.preparerAffichage();
    const nb = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 2));
    this.fils = Array.from({ length: nb }, () => {
      const w = new Worker(new URL("./nuage.worker.js", import.meta.url), { type: "module" });
      w.enCours = 0;
      w.onmessage = ({ data }) => this.recu(w, data);
      w.onerror = e => console.warn("arbres de l'anneau (fil)", e.message);
      return w;
    });
    // à chaque image ; si les images s'arrêtent (onglet en arrière-plan), un minuteur prend le relais pour les arrivées
    this.boucle = () => { if (this.fini) return; requestAnimationFrame(this.boucle); this.derniereImage = performance.now(); this.image(); };
    requestAnimationFrame(this.boucle);
    this.minuteur = setInterval(() => { if (performance.now() - (this.derniereImage || 0) > 250) this.image(); }, 250);
  }

  /** Conteneur, matériau (taille des points selon la finesse locale) et grille des sommets de la végétation. */
  preparerAffichage() {
    const sc = this.scene, c = sc.couches, Rext = this.Rext;
    this.donneesTaille = new Uint8Array(TEX * TEX);
    this.texTaille = new THREE.DataTexture(this.donneesTaille, TEX, TEX, THREE.RedFormat, THREE.UnsignedByteType);
    this.texTaille.magFilter = this.texTaille.minFilter = THREE.LinearFilter;
    let m = sc.mat.releveAnneau;
    if (!m?.userData.lod) {
      m?.dispose();
      m = sc.mat.releveAnneau = materiauPoints(1, false);
      m.userData.lod = true;
      m.uniforms.relief.value = 0;
      m.uniforms.allege.value = 0; // l'allègement au loin est fait par le choix des nœuds
      m.uniforms.tTaille = { value: null };
      m.uniforms.grilleTaille = { value: new THREE.Vector3() };
      if (m.vertexShader.includes(LIGNE_TAILLE)) {
        m.vertexShader = m.vertexShader.replace("uniform float taille", "uniform sampler2D tTaille;\nuniform vec3 grilleTaille;\nuniform float taille")
          .replace(LIGNE_TAILLE, `float tl = texture2D(tTaille, (vec2(monde.x, -monde.z) - grilleTaille.xy) / grilleTaille.z).r * (255.0 / 64.0);
  float px = taille * max(tl, 0.3) * echelle / max(0.1, -mvPosition.z);`);
      } else { console.warn("arbres de l'anneau : taille des points fixe (shader modifié)"); m.uniforms.taille.value = 1.4; m.userData.sansTexture = true; }
      const v2 = new THREE.Vector2();
      m.onBeforeRender = (r, s, cam) => { m.uniforms.echelle.value = r.getDrawingBufferSize(v2).y / (2 * Math.tan(cam.fov * Math.PI / 360)); };
    }
    m.uniforms.tTaille.value = this.texTaille;
    m.uniforms.grilleTaille.value.set(-Rext, -Rext, 2 * Rext);
    ["c1", "c2", "c3"].forEach((u, i) => m.uniforms[u].value.set(sc.T.arbres[i]));
    this.mat = m;
    // conteneur : un nuage vide dont les enfants sont les nœuds ; le reste de la scène le traite comme avant
    // (visibilité des arbres, retrait au changement d'anneau : sa géométrie rendue arrête le chargement)
    sc.arbresReleveAnneau(null);
    const cont = this.conteneur = new THREE.Points(new THREE.BufferGeometry(), m);
    cont.frustumCulled = false; cont.raycast = () => {};
    cont.visible = sc.arbresVisibles ?? true;
    cont.geometry.addEventListener("dispose", () => this.detruire());
    c.releveAnneau = cont;
    sc.groupe.add(cont);
    sc.appliquerCoupe();
    if (sc.etatSoleil) sc.placerSoleil(...sc.etatSoleil);
    // contexte WebGL perdu puis rendu : les tableaux ont été rendus, les nœuds sont refaits (depuis la mémoire)
    this.surRestaure = () => this.reconstruireTout();
    sc.renderer.domElement.addEventListener("webglcontextrestored", this.surRestaure);
    const nc = Math.ceil(2 * Rext / 4) + 1;
    this.haut = { nc, v: new Float32Array(nc * nc).fill(-Infinity) };
  }

  /** À chaque image : arrivées (quelques millisecondes au plus), puis nouveau choix si la caméra a bougé. */
  image() {
    const sc = this.scene, t0 = performance.now();
    if (!this.conteneur.parent) { if (t0 - this.derniereSel > 2000) this.detruire(); return; } // l'anneau a été retiré
    if (!this.conteneur.visible) { this.aSelectionner = true; return; } // arbres masqués : rien à charger
    let ajout = false;
    while (this.arrivees.length && performance.now() - t0 < 6) { this.construire(this.arrivees.shift()); ajout = true; }
    const cam = sc.camera;
    cam.updateMatrixWorld(); sc.groupe.updateMatrixWorld();
    const e = cam.matrixWorld.elements, sig = `${e.map(v => v.toFixed(1)).join()}|${cam.fov}|${cam.aspect.toFixed(3)}|${sc.renderer.domElement.height}`;
    if (sig !== this.signature) { this.signature = sig; this.aSelectionner = true; }
    if (ajout) this.aSelectionner = true;
    // la caméra bouge : nouveau choix au plus toutes les 120 ms (et un dernier à l'arrêt)
    if (this.aSelectionner && t0 - this.derniereSel > 120) { this.aSelectionner = false; this.derniereSel = t0; this.choisir(); }
    if (ajout) sc.demander(2);
  }

  /** Choix des nœuds à afficher (budget de points), file des nœuds à charger, visibilité et tailles. */
  choisir() {
    const t0 = performance.now(), sc = this.scene, cam = sc.camera;
    const local = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(sc.groupe.matrixWorld);
    const champ = new THREE.Frustum().setFromProjectionMatrix(local);
    const oeil = sc.groupe.worldToLocal(cam.getWorldPosition(new THREE.Vector3()));
    const echelle = sc.renderer.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
    const noter = n => {
      const dist = Math.max(1, n.boite.distanceToPoint(oeil)), dedans = champ.intersectsBox(n.boite);
      n.proj = n.sp * echelle / dist;
      n.prio = n.proj * (dedans ? 1 : 1 / HORS_CHAMP);
      n.seuil = this.seuilPx * (dedans ? 1 : HORS_CHAMP);
    };
    const estime = n => n.nbVeg ?? n.info.pointCount * this.ratioVeg;
    const sel = new Set(), tas = [];
    let total = 0;
    for (const r of this.racines) { noter(r); sel.add(r); total += estime(r); pousser(tas, r); }
    while (tas.length) {
      const n = tirer(tas);
      if (n.proj <= n.seuil || !n.enfants.length) continue;
      // tous les enfants ensemble (la finesse est la même partout dans le nœud), s'ils tiennent dans le budget
      let s = 0;
      for (const f of n.enfants) s += estime(f);
      if (total + s > this.budget) continue;
      total += s;
      for (const f of n.enfants) { noter(f); sel.add(f); pousser(tas, f); }
    }
    this.selection = sel;
    ["c1", "c2", "c3"].forEach((u, i) => this.mat.uniforms[u].value.set(sc.T.arbres[i])); // thème
    const maintenant = performance.now();
    // file : les nœuds choisis pas encore là, les plus utiles d'abord ; les autres demandes sont abandonnées
    this.file = [...sel].filter(n => n.etat === 0).sort((a, b) => b.prio - a.prio);
    // visibilité
    let affiches = 0;
    for (const n of this.noeuds) {
      if (!n.obj) continue;
      const v = sel.has(n);
      n.obj.visible = v;
      if (v) { n.vu = maintenant; affiches += n.nbVeg; }
    }
    this.liberer();
    this.majTailles();
    this.pomper();
    Object.assign(this.stats, { selection: sel.size, estime: Math.round(total), affiches, enAttente: this.file.length, majMs: +(performance.now() - t0).toFixed(2) });
    sc.demander(2);
  }

  /** Taille des points : la finesse affichée la plus grande à chaque endroit (les nœuds visibles, du plus grossier au plus fin). */
  majTailles() {
    if (this.mat.userData.sansTexture) return;
    const D = this.donneesTaille, R = this.Rext, c = 2 * R / TEX;
    D.fill(Math.round(1.4 * 64));
    const vis = this.noeuds.filter(n => n.obj?.visible).sort((a, b) => a.d - b.d);
    for (const n of vis) {
      // taille ~ racine de l'espacement : 1,3 m à 1,7 m d'espacement, 0,65 m à 0,4 m (comme la maquette fine)
      const v = Math.round(Math.min(3.9, Math.max(0.55, Math.sqrt(n.sp))) * 64);
      const [e0, n0, e1, n1] = n.xy;
      const i0 = Math.max(0, Math.floor((e0 + R) / c)), i1 = Math.min(TEX - 1, Math.floor((e1 + R) / c));
      const j0 = Math.max(0, Math.floor((n0 + R) / c)), j1 = Math.min(TEX - 1, Math.floor((n1 + R) / c));
      for (let j = j0; j <= j1; j++) D.fill(v, j * TEX + i0, j * TEX + i1 + 1);
    }
    this.texTaille.needsUpdate = true;
  }

  /** Demandes aux fils : quelques-unes par fil (le téléchargement et le décodage se recouvrent). */
  pomper() {
    for (const w of this.fils) {
      while (w.enCours < 2 && this.file.length) {
        const n = this.file.shift();
        if (n.etat !== 0) continue;
        const k = `${n.url}|${n.cle}`, m = lireMemoire(k);
        n.etat = 1;
        if (m) { this.arrivees.push({ noeud: n, X: m.X, Y: m.Y, Z: m.Z, nb: m.n }); continue; }
        w.enCours++;
        this.enVol.set(k, n);
        w.postMessage({ id: k, url: n.url, copc: n.copc, noeud: n.info, boite: [-Infinity, -Infinity, Infinity, Infinity], origine: [n.ox, n.oy], classes: VEGETATION });
      }
    }
  }

  recu(w, data) {
    w.enCours--;
    const n = this.enVol.get(data.id);
    this.enVol.delete(data.id);
    if (this.fini || !n) return;
    if (data.erreur) { console.warn("arbres de l'anneau", data.erreur); n.etat = 0; return; }
    const v = { X: data.X.slice(0, data.n), Y: data.Y.slice(0, data.n), Z: data.Z.slice(0, data.n), n: data.n, octets: 12 * data.n };
    garderEnMemoire(data.id, v);
    this.arrivees.push({ noeud: n, X: v.X, Y: v.Y, Z: v.Z, nb: v.n });
    this.pomper();
  }

  /** Points d'un nœud : végétation de l'anneau, à plus de 1,5 m du sol ; teinte selon la hauteur dans la couronne. */
  construire({ noeud: n, X, Y, Z, nb }) {
    if (n.obj || this.fini) return;
    const sc = this.scene, alt = sc.altAnneau, r0 = this.Rint ** 2, r1 = this.Rext ** 2, dx = n.ox - this.E0, dy = n.oy - this.N0;
    const { nc, v: haut } = this.haut, R = this.Rext, cle = (x, y) => Math.floor((y + R) / 4) * nc + Math.floor((x + R) / 4);
    const garde = new Int32Array(nb), sols = new Float32Array(nb);
    let q = 0;
    for (let k = 0; k < nb; k++) {
      const x = X[k] + dx, y = Y[k] + dy, d = x * x + y * y;
      if (d < r0 || d > r1) continue;
      const s = alt(x, y);
      if (!(Z[k] - s > 1.5)) continue; // herbe, buissons bas, végétation posée sur l'eau du lac
      garde[q] = k; sols[q++] = s;
      const c = cle(x, y); if (Z[k] > haut[c]) haut[c] = Z[k];
    }
    this.vusRatio[0] += q; this.vusRatio[1] += n.info.pointCount;
    if (this.vusRatio[1] > 2e5) this.ratioVeg = Math.max(0.05, this.vusRatio[0] / this.vusRatio[1]);
    n.nbVeg = q; n.etat = 2;
    if (!q) return;
    const pos = new Float32Array(3 * q), rel = new Float32Array(q), va = new Float32Array(q), zRef = sc.zRef, graine = n.d * 7919 + n.boite.min.x * 0.37 + n.boite.min.z * 0.73;
    for (let p = 0; p < q; p++) {
      const k = garde[p], x = X[k] + dx, y = Y[k] + dy, z = Z[k], h = haut[cle(x, y)] - sols[p];
      rel[p] = h > 1 ? Math.min(1, Math.max(0, (z - sols[p]) / h)) : 0.5;
      const a = Math.sin(Math.floor(x / 6) * 127.1 + Math.floor(y / 6) * 311.7) * 43758.5453, b = Math.sin((k + graine) * 12.9898) * 43758.5453;
      va[p] = Math.min(0.999, 0.75 * (a - Math.floor(a)) + 0.25 * (b - Math.floor(b)));
      pos[3 * p] = x; pos[3 * p + 1] = z - zRef; pos[3 * p + 2] = -y;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRel", new THREE.BufferAttribute(rel, 1));
    g.setAttribute("aVar", new THREE.BufferAttribute(va, 1));
    if (this.libererTableaux) for (const a of Object.values(g.attributes)) a.onUpload(rendreTableau);
    g.boundingBox = n.boite.clone();
    g.boundingSphere = n.boite.getBoundingSphere(new THREE.Sphere());
    const o = n.obj = new THREE.Points(g, this.mat);
    o.receiveShadow = true; o.raycast = () => {};
    o.visible = this.selection.has(n);
    o.matrixAutoUpdate = false;
    this.conteneur.add(o);
    this.pointsGPU += q;
    // premiers vrais arbres : les arbres générés de swisstopo ne gardent que leur ombre
    if (sc.mat.pointsAnneau?.visible) sc.mat.pointsAnneau.visible = false;
  }

  /** Budget de la carte graphique : les nœuds qui ne servent plus depuis le plus longtemps sont rendus. */
  liberer() {
    if (this.pointsGPU <= BUDGET_GPU) return;
    const inutiles = this.noeuds.filter(n => n.obj && !this.selection.has(n)).sort((a, b) => a.vu - b.vu);
    for (const n of inutiles) {
      if (this.pointsGPU <= BUDGET_GPU * 0.85) break;
      this.conteneur.remove(n.obj); n.obj.geometry.dispose(); n.obj = null;
      this.pointsGPU -= n.nbVeg; n.etat = 0; // les points décodés restent peut-être en mémoire
    }
  }

  /** Tous les nœuds refaits (contexte WebGL rendu, mesures). */
  reconstruireTout() {
    for (const n of this.noeuds) {
      if (n.obj) { this.conteneur.remove(n.obj); n.obj.geometry.dispose(); n.obj = null; this.pointsGPU -= n.nbVeg; }
      if (n.etat === 2) n.etat = 0;
    }
    this.aSelectionner = true;
  }

  detruire() {
    if (this.fini) return;
    this.fini = true;
    this.scene.renderer.domElement.removeEventListener("webglcontextrestored", this.surRestaure);
    clearInterval(this.minuteur);
    this.fils?.forEach(w => w.terminate());
    for (const n of this.noeuds) if (n.obj) { n.obj.geometry.dispose(); n.obj.removeFromParent(); n.obj = null; }
    this.texTaille?.dispose();
    this.arrivees = []; this.file = [];
  }
}

/** Mesures (développement) : points affichés selon la distance à la caméra, mémoire. */
export function mesurerLod(lod) {
  if (!lod) return null;
  return { ...lod.stats, noeuds: lod.noeuds.length, pointsGPU: lod.pointsGPU, memoireMo: +(octetsMemoire / 1e6).toFixed(1), fils: lod.fils?.length };
}
