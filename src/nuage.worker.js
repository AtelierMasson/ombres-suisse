// Décodage d'un bloc du nuage COPC hors du fil principal : téléchargement, décompression LAZ (laz-perf, une
// instance par fil), tri à la boîte. Les tableaux typés (relatifs à E0, N0) sont transférés, sans copie.
import { Copc } from "copc";
import { createLazPerf } from "laz-perf";
import wasmUrl from "laz-perf/lib/web/laz-perf.wasm?url";

let lazPerf;
const decodeur = () => (lazPerf ||= createLazPerf({ locateFile: () => wasmUrl }));

self.onmessage = async ({ data: { id, url, copc, noeud, boite: [e0, n0, e1, n1], origine: [E0, N0] } }) => {
  try {
    const v = await Copc.loadPointDataView(url, copc, noeud, { lazPerf: await decodeur(), include: ["X", "Y", "Z", "Classification"] });
    const gx = v.getter("X"), gy = v.getter("Y"), gz = v.getter("Z"), gc = v.getter("Classification"), nb = v.pointCount;
    const X = new Float32Array(nb), Y = new Float32Array(nb), Z = new Float32Array(nb), C = new Uint8Array(nb);
    let n = 0;
    for (let i = 0; i < nb; i++) {
      const x = gx(i), y = gy(i);
      if (x < e0 || x >= e1 || y < n0 || y >= n1) continue;
      X[n] = x - E0; Y[n] = y - N0; Z[n] = gz(i); C[n] = gc(i); n++;
    }
    self.postMessage({ id, n, X, Y, Z, C }, [X.buffer, Y.buffer, Z.buffer, C.buffer]);
  } catch (e) {
    self.postMessage({ id, erreur: e.message || String(e) });
  }
};
