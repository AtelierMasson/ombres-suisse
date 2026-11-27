// Terrain TIN : contrôles sur un terrain synthétique (pente, mur de 2,5 m, bruit de 2 cm), sans navigateur.
// node tests/terrainTIN.test.mjs
import assert from "node:assert/strict";
import { grilleVide, garderCercle } from "../src/grille.js";
import { calculerTerrainTIN, maillageTIN, hauteurTIN, trianglesGrille } from "../src/terrainTIN.js";

const R = Number(process.argv[2]) || 150, G = grilleVide(R);
const { n, c, x0 } = G;
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const x = x0 + (i + 0.5) * c, y = x0 + (j + 0.5) * c;
  G.sol[j * n + i] = 500 + 0.08 * x + 3 * Math.sin(y / 40) + (x > 20 ? 2.5 : 0) + 0.02 * Math.sin(i * 1.7) * Math.cos(j * 2.3);
}
G.bassins = [{ anneau: [[-40, -40], [-30, -40], [-30, -35], [-40, -35], [-40, -40]], niveau: 495 }];
for (const rond of [false, true]) {
  delete G.rayonZone; G.tinCache = null;
  if (rond) garderCercle(G, R);
  for (const budget of [0, 1]) {
    const tin = await calculerTerrainTIN(G, { tolerance: 0.05, budget, sansFil: true });
    const t0 = performance.now(), g = maillageTIN(G, tin, 500), ms = Math.round(performance.now() - t0);
    const h = hauteurTIN(G, tin);
    let e = 0;
    for (let j = 2; j < n - 2; j += 3) for (let i = 2; i < n - 2; i += 3) { // (bord : altitude du socle)
      const x = x0 + (i + 0.5) * c, y = x0 + (j + 0.5) * c;
      if (rond && Math.hypot(x, y) > R - 1) continue;
      const d = Math.abs(h(x, y) - G.sol[j * n + i]); if (d > e) { e = d; globalThis.ou = [x, y, i, j]; }
    }
    // normales vers le haut, aucune valeur invalide
    const N = g.attributes.normal.array, P = g.attributes.position.array;
    let bas = 0;
    for (let k = 1; k < N.length; k += 3) if (N[k] < 0) bas++;
    assert.ok(P.every(Number.isFinite) && N.every(Number.isFinite), "valeurs finies");
    assert.equal(bas, 0, "normales vers le haut");
    // près du bord du carré, les sommets du bord sont repoussés de 0,25 m (jusqu’à ~1,5 × la tolérance)
    if (!budget) assert.ok(e <= 0.05 * 1.5, `écart ${e} > tolérance en ${globalThis.ou}`);
    if (rond) { let rmax = 0; for (let k = 0; k < P.length; k += 3) rmax = Math.max(rmax, Math.hypot(P[k], P[k + 2])); assert.ok(rmax <= R * 1.0001, "dans le cercle (tangentes tous les degrés)"); }
    console.log(rond ? "rond " : "carré", "budget", budget, "triangles", tin.nbTriangles, "/ grille", trianglesGrille(G), "écart", e.toFixed(3),
      "noyau", Math.round(tin.ms), "ms ; maillage", ms, "ms", g.userData.tin.ms.join("/"));
  }
}
console.log("ok");
