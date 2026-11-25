// Lecture du nuage de points swissSURFACE3D (COPC) : on ne télécharge que les blocs qui touchent la boîte,
// jusqu'à la profondeur qui donne environ un point tous les 0,5 m.
import { Copc } from "copc";
import { createLazPerf } from "laz-perf";
import wasmUrl from "laz-perf/lib/web/laz-perf.wasm?url";

let lazPerf;
const decodeur = () => (lazPerf ||= createLazPerf({ locateFile: () => wasmUrl }));

/** Classes swisstopo utiles : 2 sol, 3 végétation, 6 bâtiment, 9 eau, 17 pont ; le reste = autre. */
export const CLASSES = { 2: "sol", 3: "végétation", 6: "bâtiment", 9: "eau", 17: "pont" };

/**
 * Points de la boîte [e0, n0, e1, n1] (MN95). Retourne des tableaux typés relatifs à (E0, N0).
 * onProgres(fraction, texte) est appelé pendant le chargement.
 */
export async function chargerNuage(tuiles, boite, [E0, N0], espacement = 0.5, onProgres = () => {}) {
  const lp = await decodeur();
  const [e0, n0, e1, n1] = boite;
  const taches = [];
  for (const t of tuiles) {
    const copc = await Copc.create(t.url);
    const cube = copc.info.cube, cote = cube[3] - cube[0];
    const profMax = Math.max(0, Math.ceil(Math.log2(copc.info.spacing / espacement)));
    const touche = k => {
      const [d, x, y] = k.split("-").map(Number), s = cote / 2 ** d;
      const x0 = cube[0] + x * s, y0 = cube[1] + y * s;
      return x0 < e1 && x0 + s > e0 && y0 < n1 && y0 + s > n0;
    };
    // la hiérarchie peut être répartie sur plusieurs pages
    const pages = [copc.info.rootHierarchyPage];
    while (pages.length) {
      const { nodes, pages: sous } = await Copc.loadHierarchyPage(t.url, pages.pop());
      for (const [k, n] of Object.entries(nodes))
        if (n && n.pointCount && +k.split("-")[0] <= profMax && touche(k)) taches.push({ url: t.url, copc, n });
      for (const [k, p] of Object.entries(sous)) if (+k.split("-")[0] <= profMax && touche(k)) pages.push(p);
    }
  }
  const total = taches.reduce((s, t) => s + t.n.pointCount, 0);
  const X = new Float32Array(total), Y = new Float32Array(total), Z = new Float32Array(total), C = new Uint8Array(total);
  let n = 0, faits = 0;
  // quelques téléchargements en parallèle
  const file = [...taches];
  const travail = async () => {
    while (file.length) {
      const { url, copc, n: noeud } = file.shift();
      const v = await Copc.loadPointDataView(url, copc, noeud, { lazPerf: lp, include: ["X", "Y", "Z", "Classification"] });
      const gx = v.getter("X"), gy = v.getter("Y"), gz = v.getter("Z"), gc = v.getter("Classification");
      for (let i = 0; i < v.pointCount; i++) {
        const x = gx(i), y = gy(i);
        if (x < e0 || x >= e1 || y < n0 || y >= n1) continue;
        X[n] = x - E0; Y[n] = y - N0; Z[n] = gz(i); C[n] = gc(i); n++;
      }
      faits += noeud.pointCount;
      onProgres(faits / total, `Nuage de points : ${Math.round(faits / 1e3).toLocaleString("fr-CH")} k / ${Math.round(total / 1e3).toLocaleString("fr-CH")} k points`);
    }
  };
  await Promise.all([travail(), travail(), travail(), travail()]);
  return { X: X.subarray(0, n), Y: Y.subarray(0, n), Z: Z.subarray(0, n), C: C.subarray(0, n), n };
}
