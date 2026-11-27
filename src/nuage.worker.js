// Décodage d'un bloc du nuage COPC hors du fil principal : téléchargement, décompression LAZ (laz-perf, une
// instance par fil), tri à la boîte. Les tableaux typés (relatifs à E0, N0) sont transférés, sans copie.
import { Copc } from "copc";
import { createLazPerf } from "laz-perf";
import wasmUrl from "laz-perf/lib/web/laz-perf.wasm?url";

let lazPerf;
const decodeur = () => (lazPerf ||= createLazPerf({ locateFile: () => wasmUrl }));

self.onmessage = async ({ data }) => {
  if (data.chauffer) { decodeur().catch(() => {}); return; }
  decoder(data);
};
async function decoder({ id, url, copc, noeud, boite: [e0, n0, e1, n1], origine: [E0, N0], cercle = null, classes = null }) {
  try {
    const v = await Copc.loadPointDataView(url, copc, noeud, { lazPerf: await decodeur(), include: ["X", "Y", "Z", "Classification"] });
    const gx = v.getter("X"), gy = v.getter("Y"), gz = v.getter("Z"), gc = v.getter("Classification"), nb = v.pointCount;
    const X = new Float32Array(nb), Y = new Float32Array(nb), Z = new Float32Array(nb), C = new Uint8Array(nb);
    // altitudes possibles : celles annoncées par l'en-tête du fichier (un bloc mal décodé donnait parfois des points à
    // des millions de mètres sous terre, qui tiraient le fond du socle tout en bas), à défaut celles de la Suisse
    const zMin = (copc?.header?.min?.[2] ?? 0) - 5, zMax = (copc?.header?.max?.[2] ?? 5000) + 5;
    let n = 0;
    for (let i = 0; i < nb; i++) {
      const x = gx(i), y = gy(i);
      if (x < e0 || x >= e1 || y < n0 || y >= n1) continue;
      const z = gz(i);
      if (!(z >= zMin && z <= zMax)) continue;
      if (classes && !classes.includes(gc(i))) continue; // seulement ces classes (arbres de l'anneau : végétation)
      if (cercle && (x - cercle.E) ** 2 + (y - cercle.N) ** 2 > cercle.R * cercle.R) continue; // maquette ronde : hors du disque
      X[n] = x - E0; Y[n] = y - N0; Z[n] = z; C[n] = gc(i); n++;
    }
    self.postMessage({ id, n, X, Y, Z, C }, [X.buffer, Y.buffer, Z.buffer, C.buffer]);
  } catch (e) {
    self.postMessage({ id, erreur: e.message || String(e) });
  }
}
