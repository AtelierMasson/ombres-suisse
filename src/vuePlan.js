// Vue plan « dessin » : en vue de dessus, un vrai plan d'architecte au lieu de la maquette vue d'en haut.
//  - bâtiments dessinés à plat par leurs emprises officielles (mensuration officielle : ogc.vd.ch pour Vaud,
//    geodienste.ch ailleurs), repli sur nos contours du relevé là où il n'y en a pas ; aplat clair (ou poché en
//    thème sombre) et trait fin foncé ;
//  - les bâtiments 3D (relevé, swisstopo, Advanced) ne sont pas dessinés et ne portent pas d'ombre (option : leurs
//    ombres à la date choisie, en aplat léger), pas d'occlusion ambiante ;
//  - arbres en symboles d'architecte : cercle de couronne au trait fin, point du tronc, aplat léger en option ; ceux
//    de la maquette fine viennent de la segmentation (arbres.js), ceux de l'anneau des arbres swisstopo ; les arbres 3D
//    (points, masses ou isolés) ne sont pas dessinés et ne portent leur ombre qu'avec l'option « Ombres » ;
//  - sol (plan cadastral ou autre fond choisi), parcelles, volumes du projet et coupes restent tels quels ;
//  - échelle graphique en bas à gauche ; le nord est donné par la boussole.
// Tout se fait autour du rendu (les objets de la scène sont remis dans leur état après chaque image) : en quittant
// la vue plan, rien n'a changé.
import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { emprisesOfficielles } from "./reconstruction/emprises.js";
import { contoursBatiments } from "./contours.js";
import { solEn } from "./grille.js";
import { t } from "./i18n.js";
import { CHAMPS, rayonMoyen } from "./arbresSegmentation.js";

const CALQUE_OMBRE = 2; // comme scene.js : calque vu du seul soleil (porte son ombre sans être dessiné)
const CLE = "ombres.vuePlan";

const tx = k => t("plan." + k);

/** Couleurs du dessin selon le thème : aplat et trait. */
const couleurs = T => T?.sombre
  ? { aplat: "#3d434d", trait: "#e6eaf0", arbreTrait: "#b9d4c4", arbreAplat: "#7fb89a", opacite: 0.16, papier: "#1d2431" }
  : { aplat: "#ecebe7", trait: "#26292e", arbreTrait: "#3c5a3f", arbreAplat: "#8fb27a", opacite: 0.22, papier: "#f3f1ec" };
const couleurFond = new THREE.Color();

const aire = a => { let s = 0; for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += a[j][0] * a[i][1] - a[i][0] * a[j][1]; return s / 2; };
function dansAnneau(x, y, a) {
  let d = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++)
    if ((a[i][1] > y) !== (a[j][1] > y) && x < (a[j][0] - a[i][0]) * (y - a[i][1]) / (a[j][1] - a[i][1]) + a[i][0]) d = !d;
  return d;
}

/**
 * Nos contours du relevé, en polygones { anneaux: [[x, y], …][] } (coordonnées relatives, m) : un polygone par
 * bâtiment (toutes hauteurs confondues), extérieur trigonométrique, cours intérieures en trous.
 */
function contoursReleve(G) {
  if (!G?.bat) return [];
  const src = new Float32Array(G.bat.length);
  for (let p = 0; p < src.length; p++) src[p] = isNaN(G.bat[p]) ? NaN : 1;
  const C = contoursBatiments(G, src, 0.6, 4), parSeg = new Map();
  for (const B of C.boucles) {
    const idx = B.sommets?.length >= 3 ? B.sommets.map(s => B.coins[s]) : Array.from(B.coins);
    const a = idx.map(k => [C.px[k], C.py[k]]);
    if (a.length < 3) continue;
    const s = aire(a);
    if (!parSeg.has(B.seg)) parSeg.set(B.seg, { ext: [], trous: [] });
    (s > 0 ? parSeg.get(B.seg).ext : parSeg.get(B.seg).trous).push(a);
  }
  const P = [];
  for (const { ext, trous } of parSeg.values()) for (const e of ext) {
    if (Math.abs(aire(e)) < 4) continue;
    P.push({ anneaux: [e, ...trous.filter(t => dansAnneau(t[0][0], t[0][1], e))] });
  }
  return P;
}

export function brancherVuePlan(scene, S) {
  let reglage = { dessin: true, ombres: false, aplat: true };
  try { Object.assign(reglage, JSON.parse(localStorage.getItem(CLE) || "{}")); } catch { /* stockage indisponible */ }
  const garder = () => { try { localStorage.setItem(CLE, JSON.stringify(reglage)); } catch { /* stockage indisponible */ } };

  const groupe = new THREE.Group();
  groupe.name = "planDessin";
  groupe.visible = false;
  scene.scene.add(groupe);
  const matAplat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const matTrait = new LineMaterial({ linewidth: 1.15, fog: false });
  // arbres : trait plus fin, point du tronc, aplat translucide (sans écrire la profondeur, sous les traits)
  const matArbreTrait = new LineMaterial({ linewidth: 0.8, fog: false });
  const matTronc = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false });
  const matArbreAplat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, transparent: true, depthWrite: false });
  const teinter = () => {
    const c = couleurs(scene.T);
    matAplat.color.set(c.aplat); matTrait.color.set(c.trait);
    matArbreTrait.color.set(c.arbreTrait); matTronc.color.set(c.arbreTrait); matArbreAplat.color.set(c.arbreAplat); matArbreAplat.opacity = c.opacite;
  };
  teinter();

  const groupeArbres = new THREE.Group();
  groupeArbres.name = "planArbres";
  groupe.add(groupeArbres);
  let lieu = null, chargement = null, actif = false;

  const vider = () => {
    groupe.traverse(o => o.geometry?.dispose());
    groupe.clear(); groupe.add(groupeArbres); viderArbres();
    polys = [];
    lieu = null; chargement?.abort(); chargement = null;
  };

  /** Hauteur d'un polygone : un peu au-dessus du plus haut point du terrain sous ses sommets. */
  const hauteur = anneau => {
    const G = scene.G;
    if (!G) return NaN;
    // seulement là où un terrain est dessiné : maquette fine (cercle ou carré), sinon l'anneau s'il est affiché
    const dedans = G.rayonZone ? (x, y) => Math.hypot(x, y) < G.rayonZone - 0.5 : (x, y) => Math.abs(x) < G.R - 1 && Math.abs(y) < G.R - 1;
    let cx = 0, cy = 0;
    for (const [x, y] of anneau) { cx += x; cy += y; }
    cx /= anneau.length; cy /= anneau.length;
    let h = -Infinity;
    if (dedans(cx, cy)) { for (const [x, y] of anneau) if (dedans(x, y)) h = Math.max(h, solEn(G, x, y) - scene.zRef); }
    else if (scene.couches?.anneau?.visible && Math.hypot(cx, cy) < (scene.rayonExt || 0)) h = scene.solSous(cx, -cy) + 1.5; // terrain sous le centre
    return h === -Infinity || isNaN(h) ? NaN : h + 0.6;
  };

  let polys = [], signature = "";
  const signer = () => `${!!scene.couches?.anneau?.visible}|${scene.rayonExt || 0}`;
  function construire(liste) {
    polys = liste; signature = signer();
    const pos = [], idx = [], traits = [];
    for (const P of polys) {
      const h = hauteur(P.anneaux[0]);
      if (isNaN(h)) continue;
      const ext = P.anneaux[0].map(([x, y]) => new THREE.Vector2(x, y)), trous = P.anneaux.slice(1).map(a => a.map(([x, y]) => new THREE.Vector2(x, y)));
      let tri;
      try { tri = THREE.ShapeUtils.triangulateShape(ext, trous); } catch { continue; }
      const base = pos.length / 3;
      for (const v of [ext, ...trous].flat()) pos.push(v.x, h, -v.y);
      for (const t of tri) idx.push(base + t[0], base + t[1], base + t[2]);
      for (const a of P.anneaux) for (let i = 0; i < a.length; i++) {
        const p = a[i], q = a[(i + 1) % a.length];
        traits.push(p[0], h + 0.05, -p[1], q[0], h + 0.05, -q[1]);
      }
    }
    for (const o of [...groupe.children]) if (o !== groupeArbres) { o.geometry?.dispose(); groupe.remove(o); }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const aplat = new THREE.Mesh(g, matAplat);
    const gl = new LineSegmentsGeometry().setPositions(traits), trait = new LineSegments2(gl, matTrait);
    for (const o of [aplat, trait]) { o.raycast = () => {}; o.castShadow = o.receiveShadow = false; o.renderOrder = 1; o.frustumCulled = false; }
    groupe.add(aplat, trait);
  }

  // ---- arbres en symboles : maquette fine (segmentation) et anneau (arbres swisstopo)
  let fins = null, sigArbres = "", attenteFins = null;
  function viderArbres() {
    groupeArbres.traverse(o => o.geometry?.dispose());
    groupeArbres.clear();
    fins = null; sigArbres = ""; attenteFins = null;
  }
  const signerArbres = () => `${scene.idScene}|${fins ? fins.nb : -1}|${scene.arbresPlan?.versionAnneau() ?? 0}|${!!scene.couches?.anneau?.visible}|${reglage.aplat}`;
  /** Lance (une fois par grille) la segmentation des arbres de la maquette fine. */
  function chargerArbres() {
    const G = scene.G;
    if (!scene.arbresPlan || !G || attenteFins === G) return;
    attenteFins = G;
    scene.arbresPlan.fins().then(r => { if (scene.G === G && attenteFins === G) { fins = r; scene.demander(2); } });
  }
  function construireArbres() {
    sigArbres = signerArbres();
    groupeArbres.traverse(o => o.geometry?.dispose());
    groupeArbres.clear();
    const liste = [];
    if (fins?.nb) {
      const A = fins.arbres, zRef = scene.zRef, Rz = scene.G?.rayonZone || Infinity;
      for (let q = 0; q < fins.nb; q++) {
        const o = q * CHAMPS, x = A[o], y = A[o + 1];
        if (Math.hypot(x, y) > Rz) continue;
        liste.push({ x, y, z: A[o + 3] - zRef, r: rayonMoyen(A, q) });
      }
    }
    if (scene.couches?.anneau?.visible) {
      const Rz = scene.G?.rayonZone || 0;
      for (const a of scene.arbresPlan?.anneau() || []) if (Math.hypot(a.x, a.y) > Rz) liste.push(a);
    }
    if (!liste.length) return;
    // maquette ronde sans paysage : rien au-delà du cercle (les couronnes du bord y sont coupées)
    const Rmax = scene.couches?.anneau?.visible ? Infinity : scene.G?.rayonZone || Infinity, dedans = (x, y) => x * x + y * y <= Rmax * Rmax;
    const N = 20, traits = [], aplat = [], tronc = [];
    for (const { x, y, z, r } of liste) {
      if (!dedans(x, y)) continue;
      const zt = z + 0.3, rt = Math.min(0.35, Math.max(0.15, r * 0.06));
      for (let k = 0; k < N; k++) {
        const a0 = k * 2 * Math.PI / N, a1 = (k + 1) * 2 * Math.PI / N;
        const p0 = [x + r * Math.cos(a0), y + r * Math.sin(a0)], p1 = [x + r * Math.cos(a1), y + r * Math.sin(a1)];
        if (!dedans(...p0) || !dedans(...p1)) continue;
        traits.push(p0[0], zt, -p0[1], p1[0], zt, -p1[1]);
        if (reglage.aplat) aplat.push(x, z, -y, p1[0], z, -p1[1], p0[0], z, -p0[1]);
      }
      for (let k = 0; k < 8; k++) {
        const a0 = k * Math.PI / 4, a1 = (k + 1) * Math.PI / 4;
        tronc.push(x, zt + 0.02, -y, x + rt * Math.cos(a1), zt + 0.02, -(y + rt * Math.sin(a1)), x + rt * Math.cos(a0), zt + 0.02, -(y + rt * Math.sin(a0)));
      }
    }
    const maille = (pos, m) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); return new THREE.Mesh(g, m); };
    const objets = [new LineSegments2(new LineSegmentsGeometry().setPositions(traits), matArbreTrait), maille(tronc, matTronc)];
    if (aplat.length) objets.unshift(maille(aplat, matArbreAplat));
    objets.forEach((o, k) => { o.raycast = () => {}; o.castShadow = o.receiveShadow = false; o.renderOrder = 2 + k; o.frustumCulled = false; });
    groupeArbres.add(...objets);
  }

  /** Emprises du lieu courant (une fois par lieu) : officielles, et nos contours là où il n'y en a pas. */
  async function charger() {
    const G = scene.G, E0 = S.E0, N0 = S.N0;
    if (!G || E0 == null) return;
    const cle = `${E0},${N0},${G.R},${scene.idScene}`;
    if (lieu === cle) return;
    vider();
    lieu = cle;
    const id = scene.idScene, ctl = chargement = new AbortController();
    const releve = contoursReleve(G);
    construire(releve); // tout de suite, le temps que la mensuration réponde
    scene.demander();
    const R = Math.min(1500, Math.max(G.R, S.rayonZone || 0, scene.rayonExt || 0));
    let off = [];
    try {
      const E = await emprisesOfficielles([E0 - R, N0 - R, E0 + R, N0 + R], { signal: ctl.signal });
      off = (E?.emprises || []).map(e => ({ anneaux: e.anneaux.map(a => a.map(([x, y]) => [x - E0, y - N0])) }));
    } catch (e) {
      if (e.name === "AbortError") return;
      console.warn("Emprises officielles :", e.message);
    }
    if (ctl.signal.aborted || id !== scene.idScene || lieu !== cle) return;
    if (!off.length) return;
    // repli : nos contours dont le centre n'est dans aucune emprise officielle
    const boites = off.map(P => { const a = P.anneaux[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of a) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; });
    const couvert = (x, y) => off.some((P, k) => { const b = boites[k]; return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && dansAnneau(x, y, P.anneaux[0]); });
    const reste = releve.filter(P => {
      const a = P.anneaux[0];
      // point intérieur : centre de gravité, sinon milieu d'un premier triangle
      let cx = 0, cy = 0;
      for (const [x, y] of a) { cx += x; cy += y; }
      cx /= a.length; cy /= a.length;
      if (!dansAnneau(cx, cy, a)) { const t = THREE.ShapeUtils.triangulateShape(a.map(([x, y]) => new THREE.Vector2(x, y)), [])[0]; if (t) { cx = (a[t[0]][0] + a[t[1]][0] + a[t[2]][0]) / 3; cy = (a[t[0]][1] + a[t[1]][1] + a[t[2]][1]) / 3; } }
      return !couvert(cx, cy);
    });
    construire([...off, ...reste]);
    scene.demander(3);
  }

  const enDessin = () => scene.modeVue === "plan" && reglage.dessin && !!scene.G;

  /** Entrée ou sortie du plan dessiné : ombres recalculées (sans ou avec les bâtiments). */
  function maj() {
    const a = enDessin();
    ui.hidden = scene.modeVue !== "plan" || !scene.G;
    echelle.hidden = scene.modeVue !== "plan" || !scene.G;
    bDessin.setAttribute("aria-pressed", reglage.dessin); bDessus.setAttribute("aria-pressed", !reglage.dessin);
    bOmbres.setAttribute("aria-pressed", reglage.ombres); bOmbres.hidden = !reglage.dessin;
    bAplat.setAttribute("aria-pressed", reglage.aplat); bAplat.hidden = !reglage.dessin;
    if (a) { charger(); chargerArbres(); }
    if (a !== actif) { actif = a; }
    scene.ombres();
    majEchelle();
  }

  // ---- rendu : objets de la scène mis dans l'état du plan le temps d'une image, puis remis
  const rendre = scene.rendre.bind(scene);
  scene.rendre = function () {
    if (!enDessin()) { groupe.visible = false; return rendre(); }
    if (polys.length && signature !== signer()) construire(polys); // anneau arrivé ou enlevé depuis
    if (sigArbres !== signerArbres()) construireArbres(); // arbres détectés, tuiles d'arbres de l'anneau arrivées
    // arbres 3D : les points ne sont pas dessinés ; les volumes (masses, isolés, anneau) seulement pour leur ombre
    const pointsArbres = scene.arbresPlan?.materiauxPoints() || [], visPoints = pointsArbres.map(m => m.visible);
    pointsArbres.forEach(m => { m.visible = false; });
    const c = scene.couches || {}, objets = [c.bati, c.roofer, scene.swiss?.tuiles?.group, ...(scene.arbresPlan?.volumes() || [])].filter(Boolean);
    const avant = [], couches = [];
    for (const o of objets) {
      avant.push(o.visible);
      if (reglage.ombres && o.visible) {
        // ombre seule : le soleil voit l'objet, la caméra non (et il n'est jamais pris par l'occlusion)
        o.traverse(m => { couches.push([m, m.layers.mask]); m.layers.set(CALQUE_OMBRE); });
      } else o.visible = false;
    }
    const effets = scene.effets, ombre = scene.soleil.shadow, intensite = ombre.intensity;
    scene.effets = false; // pas d'occlusion ambiante : elle dessinerait les bâtiments absents en creux
    ombre.intensity = reglage.ombres ? intensite * 0.45 : 0; // aplat léger, ou aucune ombre (ni celle des arbres)
    // éclairage de papier : le sol garde le même ton à toute heure (en fin de journée, il virait au brun) ; avec les
    // ombres, un soleil réglé pour que le sol éclairé ait ce ton et que l'ombre reste un aplat léger. Fond hors du
    // modèle : la couleur du papier (il était noir, la caméra regardant sous l'horizon du ciel)
    const soleil = scene.soleil, ciel = scene.ciel, iSoleil = soleil.intensity, iCiel = ciel.intensity, fond = scene.scene.background;
    const teinteSoleil = soleil.color.getHex(); soleil.color.set("#ffffff"); // pas de lumière orangée du soir sur un plan
    const hSoleil = soleil.position.clone().sub(soleil.target.position).normalize().y;
    if (reglage.ombres && iSoleil > 0 && hSoleil > 0.02) { ciel.intensity = 1.7; soleil.intensity = 0.9 / Math.max(0.25, hSoleil); }
    else { ciel.intensity = 2.55; soleil.intensity = 0; }
    scene.scene.background = couleurFond.set(couleurs(scene.T).papier);
    const r = scene.renderer.getSize(new THREE.Vector2());
    matTrait.resolution.set(r.x, r.y);
    const plans = scene.coupe && scene.couperModele !== false && scene.plan ? [scene.plan] : null;
    matArbreTrait.resolution.set(r.x, r.y);
    if ((matAplat.clippingPlanes?.[0] || null) !== (plans?.[0] || null)) for (const m of [matAplat, matTrait, matArbreTrait, matTronc, matArbreAplat]) { m.clippingPlanes = plans; m.needsUpdate = true; }
    groupe.visible = true;
    try { return rendre(); } finally {
      groupe.visible = false;
      scene.effets = effets; ombre.intensity = intensite;
      soleil.intensity = iSoleil; ciel.intensity = iCiel; scene.scene.background = fond; soleil.color.setHex(teinteSoleil);
      objets.forEach((o, k) => { o.visible = avant[k]; });
      pointsArbres.forEach((m, k) => { m.visible = visPoints[k]; });
      for (const [m, mask] of couches) m.layers.mask = mask;
    }
  };

  // ---- changements de vue, de lieu, de thème
  const vueOrtho = scene.vueOrtho.bind(scene);
  scene.vueOrtho = function (mode) { const r = vueOrtho(mode); maj(); return r; };
  const vider0 = scene.vider.bind(scene);
  scene.vider = function () { vider(); return vider0(); };
  const theme0 = scene.appliquerTheme.bind(scene);
  scene.appliquerTheme = function (T) { const r = theme0(T); teinter(); return r; };

  // ---- interface : bascule Plan / 3D (et ombres), sous la boussole ; échelle graphique
  const ui = document.createElement("div");
  ui.className = "plan-bascule";
  ui.setAttribute("role", "group"); ui.setAttribute("aria-label", tx("groupe"));
  ui.hidden = true;
  const bouton = (texte, titre) => { const b = document.createElement("button"); b.type = "button"; b.textContent = texte; b.title = titre; ui.appendChild(b); return b; };
  const bDessin = bouton(tx("dessin"), tx("dessinT")), bDessus = bouton(tx("dessus"), tx("dessusT")), bOmbres = bouton(tx("ombres"), tx("ombresT")), bAplat = bouton(tx("aplatArbres"), tx("aplatArbresTitre"));
  bOmbres.className = bAplat.className = "ombres";
  bAplat.addEventListener("click", () => { reglage.aplat = !reglage.aplat; garder(); maj(); scene.demander(); });
  bDessin.addEventListener("click", () => { reglage.dessin = true; garder(); maj(); });
  bDessus.addEventListener("click", () => { reglage.dessin = false; garder(); maj(); });
  bOmbres.addEventListener("click", () => { reglage.ombres = !reglage.ombres; garder(); maj(); });
  const orient = document.getElementById("orientation");
  if (orient) orient.after(ui); else document.getElementById("cadre")?.appendChild(ui);

  const echelle = document.createElement("div");
  echelle.className = "plan-echelle"; echelle.hidden = true;
  echelle.setAttribute("aria-label", tx("echelle")); echelle.title = tx("echelle");
  echelle.innerHTML = `<div class="barre"><i></i><i></i></div><span class="z">0</span><span class="l"></span>`;
  document.getElementById("cadre")?.appendChild(echelle);
  function majEchelle() {
    if (echelle.hidden) return;
    const cam = scene.camera, d = cam.position.distanceTo(scene.controls.target), h = scene.renderer.domElement.clientHeight || 1;
    const mParPx = 2 * d * Math.tan(cam.fov * Math.PI / 360) / h, cible = mParPx * 110, p = 10 ** Math.floor(Math.log10(cible));
    const L = [1, 2, 5, 10].map(k => k * p).filter(v => v <= cible).pop() || p;
    echelle.querySelector(".barre").style.width = `${(L / mParPx).toFixed(1)}px`;
    echelle.querySelector(".l").textContent = L >= 1000 ? `${L / 1000} km` : `${L} m`;
  }
  scene.controls.addEventListener("change", majEchelle);
  addEventListener("resize", majEchelle);

  const style = document.createElement("style");
  style.textContent = `
.plan-bascule { display: flex; flex-direction: column; border-radius: 11px; overflow: hidden; background: var(--verre); border: 1px solid var(--verre-bord); box-shadow: var(--ombre-flottant); -webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px); }
.plan-bascule[hidden], .plan-echelle[hidden], .plan-bascule button[hidden] { display: none; }
.plan-bascule button { min-width: 44px; padding: 4px 6px; border: 0; background: transparent; color: var(--doux, var(--texte)); font: 600 11.5px system-ui, sans-serif; }
.plan-bascule button + button { border-top: 1px solid var(--verre-bord); }
.plan-bascule button:hover { background: var(--discret); }
.plan-bascule button[aria-pressed=true] { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.plan-bascule button.ombres { font-weight: 500; font-size: 10.5px; }
.plan-echelle { position: absolute; left: 14px; bottom: 14px; z-index: 6; display: flex; align-items: flex-end; gap: 0; padding: 4px 8px 5px; border-radius: 8px; background: var(--verre); border: 1px solid var(--verre-bord); box-shadow: var(--ombre-flottant); color: var(--texte); font: 600 10.5px system-ui, sans-serif; pointer-events: none; position: absolute; }
.plan-echelle .barre { order: 1; display: flex; height: 6px; border: 1px solid currentColor; margin: 0 4px 2px 3px; }
.plan-echelle .barre i { flex: 1; } .plan-echelle .barre i:first-child { background: currentColor; }
.plan-echelle .z { order: 0; } .plan-echelle .l { order: 2; }
@media (max-width: 700px) { .plan-bascule { flex-direction: row; } .plan-bascule button + button { border-top: 0; border-left: 1px solid var(--verre-bord); } }`;
  document.head.appendChild(style);

  maj();
  return { reglage, maj };
}
