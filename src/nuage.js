// Lecture du nuage de points swissSURFACE3D (COPC) : on ne télécharge que les blocs qui touchent la boîte,
// jusqu'à la profondeur qui donne environ un point tous les 0,5 m. Les blocs sont téléchargés et décodés par
// quelques fils de calcul (nuage.worker.js) : la page reste fluide pendant le chargement.
import { Copc } from "copc";
import { t, entier } from "./i18n.js";

/** Classes swisstopo utiles : 2 sol, 3 végétation, 6 bâtiment, 9 eau, 17 pont ; le reste = autre. */
export const CLASSES = { 2: "sol", 3: "végétation", 6: "bâtiment", 9: "eau", 17: "pont" };

/**
 * Points de la boîte [e0, n0, e1, n1] (MN95). Retourne des tableaux typés relatifs à (E0, N0).
 * onProgres(fraction, texte) est appelé pendant le chargement. `signal` (AbortSignal) arrête les fils en cours.
 */
export async function chargerNuage(tuiles, boite, [E0, N0], espacement = 0.5, onProgres = () => {}, signal = null, densite = null) {
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
    const copc = await Copc.create(t.url), liste = [];
    const cube = copc.info.cube, cote = cube[3] - cube[0];
    const profMax = Math.max(0, Math.ceil(Math.log2(copc.info.spacing / espacement)));
    const boiteNoeud = k => {
      const [d, x, y] = k.split("-").map(Number), s = cote / 2 ** d, x0 = cube[0] + x * s, y0 = cube[1] + y * s;
      return [x0, y0, x0 + s, y0 + s];
    };
    const garder = k => { const b = boiteNoeud(k); return coupe(b, boite) && +k.split("-")[0] <= niveauMax(b, profMax); };
    // la hiérarchie peut être répartie sur plusieurs pages
    const pages = [copc.info.rootHierarchyPage];
    while (pages.length) {
      const { nodes, pages: sous } = await Copc.loadHierarchyPage(t.url, pages.pop());
      for (const [k, n] of Object.entries(nodes)) if (n && n.pointCount && garder(k)) liste.push({ url: t.url, copc, n });
      for (const [k, p] of Object.entries(sous)) if (+k.split("-")[0] <= profMax && coupe(boiteNoeud(k), boite)) pages.push(p);
    }
    return liste;
  }));
  const taches = parTuile.flat();
  const total = taches.reduce((s, t) => s + t.n.pointCount, 0);
  let X = new Float32Array(total), Y = new Float32Array(total), Z = new Float32Array(total), C = new Uint8Array(total);
  let n = 0, faits = 0;
  // les plus gros blocs d'abord : les fils finissent à peu près ensemble
  taches.sort((a, b) => b.n.pointCount - a.n.pointCount);
  const nb = Math.min(6, Math.max(1, (navigator.hardwareConcurrency || 2) - 1), taches.length);
  const fils = Array.from({ length: nb }, () => new Worker(new URL("./nuage.worker.js", import.meta.url), { type: "module" }));
  const arreter = () => fils.forEach(w => w.terminate());
  try {
    await new Promise((ok, ko) => {
      if (!taches.length) return ok();
      let suivante = 0, restantes = taches.length;
      signal?.addEventListener("abort", () => ko(new DOMException(t("erreur.chargementAnnule"), "AbortError")), { once: true });
      const donner = w => {
        if (suivante >= taches.length) return;
        const { url, copc, n: noeud } = taches[suivante];
        w.postMessage({ id: suivante++, url, copc, noeud, boite, origine: [E0, N0] });
      };
      for (const w of fils) {
        w.onerror = e => ko(new Error(t("erreur.nuageDecodage", { m: e.message || t("erreur.filEchec") })));
        w.onmessage = ({ data }) => {
          if (data.erreur) return ko(new Error(data.erreur));
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
  } finally { arreter(); }
  // le nuage est gardé (nuage brut à la demande, points proches de la coupe) : tableaux ramenés à la taille utile
  // (un tableau à la fois : l'ancien est rendu avant de copier le suivant)
  X = X.slice(0, n); Y = Y.slice(0, n); Z = Z.slice(0, n); C = C.slice(0, n);
  return { X, Y, Z, C, n };
}
