// Lecture du nuage de points swissSURFACE3D (COPC) : on ne télécharge que les blocs qui touchent la boîte,
// jusqu'à la profondeur qui donne environ un point tous les 0,5 m. Les blocs sont téléchargés et décodés par
// quelques fils de calcul (nuage.worker.js) : la page reste fluide pendant le chargement.
import { Copc } from "copc";
import { t, entier } from "./i18n.js";

/** Classes swisstopo utiles : 2 sol, 3 végétation, 6 bâtiment, 9 eau, 17 pont ; le reste = autre. */
export const CLASSES = { 2: "sol", 3: "végétation", 6: "bâtiment", 9: "eau", 17: "pont" };

/* ------------------------------------------------------------------ mémoire d'un lieu à l'autre */
// En-tête (Copc.create, ~0,7 s) et pages de hiérarchie d'une tuile : gardés pour la session (recentrage, parcelle
// voisine, arbres de l'anneau). Petits (quelques dizaines de Ko par tuile) : bornés au nombre.
const MAX_ENTETES = 64, entetes = new Map(), pagesHier = new Map();
function borner(m, max) { while (m.size > max) m.delete(m.keys().next().value); }
/** En-tête COPC d'une tuile, une seule fois par session. */
export function enteteCopc(url) {
  if (!entetes.has(url)) {
    entetes.set(url, Copc.create(url).catch(e => { entetes.delete(url); throw e; }));
    borner(entetes, MAX_ENTETES);
  }
  return entetes.get(url);
}
/** Page de hiérarchie COPC (nœuds et sous-pages), une seule fois par session. */
export function pageHierarchie(url, page) {
  const k = `${url}|${page.pageOffset}`;
  if (!pagesHier.has(k)) {
    pagesHier.set(k, Copc.loadHierarchyPage(url, page).catch(e => { pagesHier.delete(k); throw e; }));
    borner(pagesHier, MAX_ENTETES * 8);
  }
  return pagesHier.get(k);
}

/* ------------------------------------------------------------------ fils de décodage gardés */
// Les fils (et leur laz-perf, ~0,2 Mo de WASM compilé) restent d'un chargement à l'autre ; ils ne sont arrêtés que si
// un chargement est abandonné en route (changement de lieu), et recréés au suivant.
let pool = [];
function filsNuage(nb) {
  while (pool.length < nb) {
    const w = new Worker(new URL("./nuage.worker.js", import.meta.url), { type: "module" });
    w.postMessage({ chauffer: true }); // compile laz-perf tout de suite (le premier bloc n'attend pas)
    pool.push(w);
  }
  return pool.slice(0, nb);
}
function arreterFils() { pool.forEach(w => w.terminate()); pool = []; }
/** Prépare les fils pendant que la page attend (accueil, recherche) : script et WASM déjà chargés au premier lieu. */
export function chaufferFils() { filsNuage(Math.min(6, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))); }

/**
 * Points de la boîte [e0, n0, e1, n1] (MN95). Retourne des tableaux typés relatifs à (E0, N0).
 * onProgres(fraction, texte) est appelé pendant le chargement. `signal` (AbortSignal) arrête les fils en cours.
 */
export async function chargerNuage(tuiles, boite, [E0, N0], espacement = 0.5, onProgres = () => {}, signal = null, densite = null, apercu = null, cercle = null) {
  // `cercle` = { E, N, R } (maquette ronde) : seuls les nœuds et les points qui touchent le disque sont lus (pas les coins du carré)
  // `apercu` (facultatif) = { debut(total), bloc(X, Y, Z, C, n) } : les points arrivent, bloc par bloc (chargement visible)
  const [e0, n0, e1, n1] = boite;
  // densité selon la distance : toute la finesse dans la boîte intérieure (parcelle et ses abords), un niveau de moins
  // au-delà (« équilibrée »), deux niveaux de moins loin de la parcelle (« légère ») ; `densite` = { interieur, niveau }
  const coupe = (b, [a0, b0, a1, b1]) => b[0] < a1 && b[2] > a0 && b[1] < b1 && b[3] > b0;
  const elargir = ([a0, b0, a1, b1], m) => [a0 - m, b0 - m, a1 + m, b1 + m];
  const niveauMax = (bn, profMax) => {
    if (!densite?.niveau || !densite.interieur) return profMax;
    if (coupe(bn, densite.interieur)) return profMax;
    if (densite.niveau >= 2 && !coupe(bn, elargir(densite.interieur, 100))) return profMax - 2;
    return profMax - 1;
  };
  // en-têtes et hiérarchies des tuiles en parallèle (chacune coûte ~0,7 s)
  const parTuile = await Promise.all(tuiles.map(async t => {
    const copc = await enteteCopc(t.url), liste = [];
    const cube = copc.info.cube, cote = cube[3] - cube[0];
    const profMax = Math.max(0, Math.ceil(Math.log2(copc.info.spacing / espacement)));
    const boiteNoeud = k => {
      const [d, x, y] = k.split("-").map(Number), s = cote / 2 ** d, x0 = cube[0] + x * s, y0 = cube[1] + y * s;
      return [x0, y0, x0 + s, y0 + s];
    };
    const dansCercle = b => !cercle || Math.hypot(Math.max(b[0] - cercle.E, 0, cercle.E - b[2]), Math.max(b[1] - cercle.N, 0, cercle.N - b[3])) <= cercle.R;
    const garder = k => { const b = boiteNoeud(k); return coupe(b, boite) && dansCercle(b) && +k.split("-")[0] <= niveauMax(b, profMax); };
    // la hiérarchie peut être répartie sur plusieurs pages
    const pages = [copc.info.rootHierarchyPage];
    while (pages.length) {
      const { nodes, pages: sous } = await pageHierarchie(t.url, pages.pop());
      for (const [k, n] of Object.entries(nodes)) if (n && n.pointCount && garder(k)) liste.push({ url: t.url, copc, n, d: +k.split("-")[0] });
      for (const [k, p] of Object.entries(sous)) if (+k.split("-")[0] <= profMax && coupe(boiteNoeud(k), boite) && dansCercle(boiteNoeud(k))) pages.push(p);
    }
    return liste;
  }));
  const taches = parTuile.flat();
  const total = taches.reduce((s, t) => s + t.n.pointCount, 0);
  apercu?.debut(total);
  let X = new Float32Array(total), Y = new Float32Array(total), Z = new Float32Array(total), C = new Uint8Array(total);
  let n = 0, faits = 0;
  // niveaux grossiers d'abord (environ un point par m² sur toute la zone), puis les fins ; dans un même niveau, les plus
  // gros blocs d'abord : les fils finissent à peu près ensemble
  taches.sort((a, b) => a.d - b.d || b.n.pointCount - a.n.pointCount);
  const nb = Math.min(6, Math.max(1, (navigator.hardwareConcurrency || 2) - 1), taches.length);
  const fils = filsNuage(nb);
  let fini = false;
  try {
    await new Promise((ok, ko) => {
      if (!taches.length) return ok();
      let suivante = 0, restantes = taches.length;
      signal?.addEventListener("abort", () => { if (!fini) arreterFils(); ko(new DOMException(t("erreur.chargementAnnule"), "AbortError")); }, { once: true });
      const donner = w => {
        if (suivante >= taches.length) return;
        const { url, copc, n: noeud } = taches[suivante];
        w.postMessage({ id: suivante++, url, copc, noeud, boite, origine: [E0, N0], cercle });
      };
      for (const w of fils) {
        w.onerror = e => ko(new Error(t("erreur.nuageDecodage", { m: e.message || t("erreur.filEchec") })));
        w.onmessage = ({ data }) => {
          if (data.erreur) return ko(new Error(data.erreur));
          apercu?.bloc(data.X, data.Y, data.Z, data.C, data.n);
          X.set(data.X.subarray(0, data.n), n); Y.set(data.Y.subarray(0, data.n), n);
          Z.set(data.Z.subarray(0, data.n), n); C.set(data.C.subarray(0, data.n), n);
          n += data.n;
          faits += taches[data.id].n.pointCount;
          onProgres(faits / total, t("etat.nuage", { faits: entier(faits / 1e3), total: entier(total / 1e3) }));
          if (--restantes === 0) ok(); else donner(w);
        };
        donner(w);
      }
    });
  } catch (e) { arreterFils(); throw e; } // fils peut-être encore occupés : arrêtés, recréés au prochain lieu
  finally { fini = true; for (const w of fils) w.onmessage = w.onerror = null; }
  // le nuage est gardé (nuage brut à la demande, points proches de la coupe) : tableaux ramenés à la taille utile
  // (un tableau à la fois : l'ancien est rendu avant de copier le suivant)
  X = X.slice(0, n); Y = Y.slice(0, n); Z = Z.slice(0, n); C = C.slice(0, n);
  return { X, Y, Z, C, n };
}
