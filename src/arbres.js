// Styles des arbres en 3D (onglet Affichage, choix mémorisé) :
//  - « points » : les points du relevé (disques plats), dont la canopée invisible porte l'ombre (par défaut) ;
//  - « masses » : couronnes lissées, un volume arrondi par massif (maillages.couronnes) ;
//  - « isolés » : un arbre stylisé par couronne détectée (tronc à six pans, couronne en ellipsoïde pour un feuillu, en
//    cône pour un conifère, rayons lus sur 8 directions), à partir de la segmentation (arbresSegmentation.js, calculée
//    dans un fil). Si elle échoue ou ne trouve rien, les points restent.
// Dans l'anneau du paysage, les volumes sont les arbres de swisstopo (swissTLM3D, déjà chargés pour porter l'ombre) ;
// en points, ceux du relevé. Ombres, thème, coupe et visibilité suivent le style.
// Les arbres un par un servent aussi aux symboles de la vue plan (vuePlan.js : `scene.arbresPlan`).
// Comme vuePlan.js, le module se greffe autour des méthodes de la scène (styleArbres, appliquerCalques, thème, coupe).
import * as THREE from "three";
import { couronnes } from "./maillages.js";
import { CHAMPS, TYPE, rayonDirection, rayonMoyen } from "./arbresSegmentation.js";
import { t, entier } from "./i18n.js";

const CALQUE_OMBRE = 2; // comme scene.js : calque vu du seul soleil
const CLE = "ombres.arbresStyle";
export const STYLES = ["points", "masses", "isoles"];

/** Teintes d'un arbre isolé selon son type, dans les couleurs du thème (c1 ombre, c2 lumière, c3 accent). */
function teintes(T) {
  const [c1, c2, c3] = T.arbres.map(x => new THREE.Color(x));
  return {
    [TYPE.conifere]: c1.clone().lerp(c2, 0.3),
    [TYPE.feuillu]: c2.clone().lerp(c3, 0.25),
    [TYPE.indetermine]: c1.clone().lerp(c2, 0.62),
    tronc: new THREE.Color(T.sol).multiplyScalar(T.sombre ? 0.62 : 0.6).lerp(new THREE.Color(T.coupe.bati), 0.15),
  };
}

const alea = q => { const s = Math.sin(q * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/**
 * Maillage low-poly de tous les arbres isolés (LOD1 de docs/recherche-arbres.md : ~100 à 130 triangles par arbre),
 * en une seule géométrie indexée, couleurs par sommet. Repère de la scène (x est, y haut, z = −nord).
 */
export function maillageIsoles(A, nb, zRef, T) {
  const AZ = 12, pos = [], col = [], idx = [], C = teintes(T), coul = new THREE.Color();
  for (let q = 0; q < nb; q++) {
    const o = q * CHAMPS, x = A[o], y = A[o + 1], z0 = A[o + 2] - zRef, top = A[o + 3] - zRef, base = A[o + 4] - zRef, type = A[o + 5];
    const L = top - base, h = top - z0, v = alea(q), teinte = C[type] || C[TYPE.indetermine];
    const conif = type === TYPE.conifere;
    // anneaux de la couronne : [hauteur relative 0 (base) – 1 (sommet), part du rayon]
    const anneaux = conif
      ? [[0.04, 0.9], [0.22, 0.97], [0.5, 0.62], [0.78, 0.3]]
      : [-60, -30, 0, 30, 60].map(d => { const f = d * Math.PI / 180; return [0.5 + 0.5 * Math.sin(f) * (f < 0 ? 0.85 : 1) + (f < 0 ? 0.075 : 0), Math.cos(f)]; });
    const b0 = pos.length / 3;
    const sommet = (px, py, pz, k) => { pos.push(px, pz, -py); coul.copy(teinte).multiplyScalar((0.82 + 0.22 * k) * (0.92 + 0.16 * v)); col.push(coul.r, coul.g, coul.b); };
    sommet(x, y, base + (conif ? 0 : 0.03 * L), 0); // pôle bas
    for (const [hr, f] of anneaux) for (let a = 0; a < AZ; a++) {
      const ang = a * 2 * Math.PI / AZ, r = rayonDirection(A, q, ang) * f;
      sommet(x + Math.cos(ang) * r, y + Math.sin(ang) * r, base + hr * L, hr);
    }
    sommet(x, y, top, 1); // pôle haut
    const nA = anneaux.length, haut = b0 + 1 + nA * AZ;
    for (let a = 0; a < AZ; a++) {
      const a1 = (a + 1) % AZ;
      idx.push(b0, b0 + 1 + a1, b0 + 1 + a);
      for (let k = 0; k < nA - 1; k++) {
        const p = b0 + 1 + k * AZ, s = p + AZ;
        idx.push(p + a, p + a1, s + a1, p + a, s + a1, s + a);
      }
      const p = b0 + 1 + (nA - 1) * AZ;
      idx.push(p + a, p + a1, haut);
    }
    // tronc à six pans, du sol (un peu enterré) jusque dans la couronne
    const rt = Math.min(0.5, Math.max(0.12, h / 70 + 0.04 * rayonMoyen(A, q))), zb = z0 - 0.3, zh = base + 0.3 * L, t0 = pos.length / 3;
    for (let k = 0; k < 6; k++) {
      const ang = k * Math.PI / 3, px = x + Math.cos(ang) * rt, py = y + Math.sin(ang) * rt;
      for (const z of [zb, zh]) { pos.push(px, z, -py); col.push(C.tronc.r, C.tronc.g, C.tronc.b); }
    }
    for (let k = 0; k < 6; k++) {
      const a0 = t0 + 2 * k, a1 = t0 + 2 * ((k + 1) % 6);
      idx.push(a0, a1, a1 + 1, a0, a1 + 1, a0 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Points de végétation du nuage (classes 3 à 5), au plus ~800 000 (un sur deux, trois… au-delà). */
function pointsVegetation(nuage) {
  if (!nuage?.n) return null;
  const { X, Y, Z, C } = nuage;
  let nv = 0;
  for (let k = 0; k < nuage.n; k++) if (C[k] >= 3 && C[k] <= 5) nv++;
  const pas = Math.max(1, Math.ceil(nv / 800000)), m = Math.ceil(nv / pas);
  const x = new Float32Array(m), y = new Float32Array(m), z = new Float32Array(m);
  let q = 0, v = 0;
  for (let k = 0; k < nuage.n && q < m; k++) {
    if (C[k] < 3 || C[k] > 5) continue;
    if (v++ % pas) continue;
    x[q] = X[k]; y[q] = Y[k]; z[q] = Z[k]; q++;
  }
  return { X: x.subarray(0, q), Y: y.subarray(0, q), Z: z.subarray(0, q) };
}

export function brancherArbres(scene) {
  let style = "points";
  try { const s = localStorage.getItem(CLE); if (STYLES.includes(s)) style = s; } catch { /* stockage indisponible */ }

  // matériaux propres (gardés d'un lieu à l'autre) : arbres isolés, et arbres swisstopo de l'anneau en volumes
  const mat = {
    isoles: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
    couronneAnneau: new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }),
    troncAnneau: new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }),
  };
  for (const m of Object.values(mat)) scene.partages.add(m);
  const teinterAnneau = T => {
    mat.couronneAnneau.color.set(T.arbres[1]).lerp(new THREE.Color(T.arbres[0]), 0.25);
    mat.troncAnneau.color.copy(teintes(T).tronc);
  };
  if (scene.T) teinterAnneau(scene.T);

  // ---- segmentation : une par grille (lieu, rayon), dans un fil ; résultat gardé
  const calculs = new WeakMap(); // G -> Promise<{ arbres, nb, ms } | null>
  let fil = null, nId = 0;
  const attente = new Map();
  function lancer(G, nuage) {
    if (!fil) {
      fil = new Worker(new URL("./arbres.worker.js", import.meta.url), { type: "module" });
      fil.onmessage = ({ data }) => { const r = attente.get(data.id); attente.delete(data.id); r?.(data); };
      fil.onerror = e => { console.warn("arbres isolés (fil)", e.message); for (const r of attente.values()) r({ erreur: e.message }); attente.clear(); fil?.terminate(); fil = null; };
    }
    const id = ++nId, t0 = performance.now(), pts = pointsVegetation(nuage);
    return new Promise(res => {
      attente.set(id, d => {
        if (d.erreur) { console.warn("arbres isolés :", d.erreur); res(null); return; }
        const total = performance.now() - t0;
        console.info(`arbres isolés : ${d.nb} en ${Math.round(d.ms)} ms dans le fil (${Math.round(total)} ms avec l'envoi)`, d.etapes);
        res({ arbres: d.arbres, nb: d.nb, ms: d.ms, total });
      });
      // copies de la grille et des points (le fil les garde le temps du calcul)
      fil.postMessage({ id, G: { n: G.n, c: G.c, x0: G.x0, sol: G.sol, veg: G.veg }, pts });
    });
  }
  /** Arbres un par un de la maquette fine (promesse, null si la segmentation échoue). */
  function arbresIndividuels() {
    const G = scene.G;
    if (!G?.veg) return Promise.resolve(null);
    if (!calculs.has(G)) calculs.set(G, lancer(G, scene.nuage));
    return calculs.get(G);
  }

  // ---- arbres isolés : maillage de la grille en cours
  let maillage = null, etat = ""; // "" | "calcul" | "echec" | "ok"
  const note = { maj: () => {} };
  function retirerMaillage() {
    if (!maillage) return;
    maillage.parent?.remove(maillage);
    maillage.geometry.dispose();
    maillage = null;
  }
  function construireIsoles(res, G) {
    retirerMaillage();
    if (!res?.nb || G !== scene.G) return;
    maillage = new THREE.Mesh(maillageIsoles(res.arbres, res.nb, scene.zRef, scene.T), mat.isoles);
    maillage.userData.G = G; maillage.userData.res = res;
    maillage.castShadow = maillage.receiveShadow = true;
    maillage.name = "arbresIsoles";
    scene.groupe.add(maillage);
  }
  async function preparerIsoles() {
    const G = scene.G;
    if (!G) return;
    if (maillage?.userData.G === G && maillage.parent) { if (etat !== "ok") { etat = "ok"; note.maj(maillage.userData.res); } return; }
    etat = "calcul"; note.maj();
    const res = await arbresIndividuels();
    if (G !== scene.G || style !== "isoles") { etat = ""; note.maj(); return; }
    if (!res?.nb) { etat = "echec"; note.maj(); appliquer(); return; }
    construireIsoles(res, G);
    etat = "ok"; note.maj(res);
    appliquer();
    scene.ombres();
  }

  // ---- masses : couronnes lissées (les mêmes que le repli sans relevé classé)
  function preparerMasses() {
    const c = scene.couches;
    if (c.couronnes || !scene.G) return;
    scene.arbresTeinte = scene.T.arbres; // le thème les refait (scene.refaireCouronnes)
    const g = couronnes(scene.G, scene.zRef, scene.T.arbres, 5); // plus lissées que le repli sans relevé classé
    if (!g) return;
    c.couronnes = new THREE.Mesh(g, scene.mat.couronne);
    c.couronnes.castShadow = c.couronnes.receiveShadow = true;
    scene.groupe.add(c.couronnes);
    scene.appliquerCoupe();
  }

  /** Style vraiment affiché : les arbres isolés tant qu'ils ne sont pas prêts (ou introuvables) restent en points. */
  const styleEffectif = () => style === "isoles" && !(maillage?.parent && maillage.userData.G === scene.G) ? "points" : style;

  const regler = (o, voir, ombre) => {
    if (!o) return;
    o.visible = voir || ombre;
    o.traverse(m => { m.layers.set(voir ? 0 : CALQUE_OMBRE); if (m.isMesh) m.castShadow = ombre; });
  };
  const cacher = o => { if (o) { o.visible = false; o.traverse(m => { if (m.isMesh) m.castShadow = false; }); } };

  /** Arbres swisstopo de l'anneau : en points (le modèle ne porte que l'ombre) ou en volumes. */
  let versionAnneau = 0;
  function anneau(volumes, voir) {
    const ar = scene.swiss?.arbres;
    if (!ar) return;
    if (!ar.userData?.styleArbres) {
      ar.userData = { ...(ar.userData || {}), styleArbres: true };
      ar.addEventListener("load-model", () => { versionAnneau++; queueMicrotask(appliquer); });
    }
    ar.group.traverse(o => {
      if (o.isPoints) { o.visible = !volumes; return; }
      if (!o.isMesh) return;
      const ud = o.userData;
      if (!ud.matOrigine) ud.matOrigine = o.material;
      if (volumes) {
        o.material = ud.matOrigine === scene.mat.mur ? mat.troncAnneau : mat.couronneAnneau;
        o.layers.set(voir ? 0 : CALQUE_OMBRE);
      } else {
        o.material = ud.matOrigine;
        o.layers.set(CALQUE_OMBRE);
      }
    });
  }

  /** Visibilités et ombres selon le style, après les réglages de la scène (qui ne connaît que les points). */
  function appliquer() {
    const c = scene.couches || {}, k = scene.calques || {}, G = scene.G;
    if (!G) return;
    if (maillage && maillage.userData.G !== G) retirerMaillage();
    if (style === "masses") preparerMasses();
    if (style === "isoles") preparerIsoles();
    const s = styleEffectif(), voir = k.arbVoir !== false && scene.arbresVisibles !== false, ombre = !!k.arbOmbre;
    if (s === "points") {
      if (c.arbres) {
        c.arbres.visible = voir;
        regler(c.canopee, voir && ombre, ombre);
        cacher(c.couronnes); // couronnes des masses
      }
      cacher(maillage);
    } else {
      if (c.arbres) c.arbres.visible = false;
      cacher(c.canopee);
      regler(s === "masses" ? c.couronnes : maillage, voir, ombre);
      cacher(s === "masses" ? maillage : c.couronnes);
    }
    if (c.releveAnneau) c.releveAnneau.visible = voir && s === "points";
    anneau(s !== "points", voir);
    scene.demander?.();
  }

  // ---- greffes sur la scène
  const calques0 = scene.appliquerCalques.bind(scene);
  scene.appliquerCalques = function () { const r = calques0(); appliquer(); return r; };
  const theme0 = scene.appliquerTheme.bind(scene);
  scene.appliquerTheme = function (T) {
    const r = theme0(T);
    teinterAnneau(T);
    const res = maillage?.userData.res;
    if (res && maillage.userData.G === scene.G) { construireIsoles(res, scene.G); scene.appliquerCoupe(); appliquer(); }
    return r;
  };
  const coupe0 = scene.appliquerCoupe.bind(scene);
  scene.appliquerCoupe = function () {
    const r = coupe0();
    const plans = this.coupe && this.couperModele !== false ? [this.plan] : null;
    for (const m of Object.values(mat)) if (!!m.clippingPlanes !== !!plans || (plans && m.clippingPlanes[0] !== plans[0])) { m.clippingPlanes = plans; m.needsUpdate = true; }
    return r;
  };
  const vider0 = scene.vider.bind(scene);
  scene.vider = function () { retirerMaillage(); etat = ""; note.maj(); return vider0(); };
  // les points de l'anneau (lodAnneau.js) arrivent après coup, visibles : on les recache s'ils ne sont pas le style
  const rendre0 = scene.rendre.bind(scene);
  scene.rendre = function () {
    const ra = this.couches?.releveAnneau;
    if (ra?.visible && styleEffectif() !== "points") ra.visible = false;
    return rendre0();
  };

  /** Arbres pour la vue plan : ceux de la maquette fine (promesse) et ceux de l'anneau (swisstopo) en { x, y, z, r }. */
  scene.arbresPlan = {
    fins: arbresIndividuels,
    /** Volumes d'arbres dessinés en ce moment (masses, isolés, arbres de l'anneau) ; et matériaux des points. */
    volumes() {
      const out = [scene.couches?.couronnes, maillage].filter(o => o?.visible);
      scene.swiss?.arbres?.group.traverse(o => { if (o.isMesh && o.layers.mask & 1 && o.visible) out.push(o); });
      return out;
    },
    materiauxPoints: () => [scene.couches?.arbres?.material, scene.mat.pointsAnneau, scene.mat.releveAnneau].filter(Boolean),
    versionAnneau: () => versionAnneau,
    anneau() {
      const ar = scene.swiss?.arbres, out = [];
      if (!ar) return out;
      const M = new THREE.Matrix4(), I = new THREE.Matrix4(), b = new THREE.Box3(), v = new THREE.Vector3(), s = new THREE.Vector3();
      ar.group.updateMatrixWorld(true);
      ar.group.traverse(o => {
        if (!o.isInstancedMesh || (o.userData.matOrigine || o.material) === scene.mat.mur) return;
        o.geometry.boundingBox || o.geometry.computeBoundingBox();
        b.copy(o.geometry.boundingBox);
        const ctr = b.getCenter(new THREE.Vector3()), dim = b.getSize(new THREE.Vector3());
        for (let k = 0; k < o.count; k++) {
          o.getMatrixAt(k, I);
          M.multiplyMatrices(o.matrixWorld, I);
          s.setFromMatrixScale(M);
          if (!(s.x > 0)) continue;
          v.copy(ctr).applyMatrix4(M);
          // rayon : demi-largeur horizontale (l'axe vertical du modèle est sa plus grande dimension)
          const e = [dim.x * s.x, dim.y * s.y, dim.z * s.z].sort((p, q) => p - q);
          out.push({ x: v.x, y: -v.z, z: v.y + e[2] / 2, r: Math.max(0.8, (e[0] + e[1]) / 4) });
        }
      });
      return out;
    },
  };

  // ---- interface : choix du style dans l'onglet Affichage, sous l'interrupteur des arbres
  const choix = document.getElementById("vArbresStyle"), info = document.getElementById("noteArbresStyle");
  if (choix) {
    choix.value = style;
    choix.addEventListener("change", () => {
      style = STYLES.includes(choix.value) ? choix.value : "points";
      try { localStorage.setItem(CLE, style); } catch { /* stockage indisponible */ }
      etat = ""; note.maj();
      appliquer(); scene.ombres(); scene.demander(3);
    });
  }
  note.maj = res => {
    if (!info) return;
    const msg = style !== "isoles" ? "" : etat === "calcul" ? t("aff.arbresCalcul") : etat === "echec" ? t("aff.arbresEchec")
      : etat === "ok" && res ? t("aff.arbresNb", { n: entier(res.nb), ms: entier(res.ms) }) : "";
    info.textContent = msg; info.hidden = !msg;
  };

  return { appliquer, style: () => style, arbresIndividuels };
}
