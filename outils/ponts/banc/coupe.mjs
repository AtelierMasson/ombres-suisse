// node --import ./env.mjs coupe.mjs <site> <R> <x> <y> [s…] : coupes en travers des points bruts (classe 17) d'un pont de référence
import { readFileSync } from "node:fs";
import { nuageSite } from "./charger.mjs";
import { MESURES, REFERENCE } from "./sites.mjs";
import { existsSync } from "node:fs";
const fichierRef = (site, R) => [MESURES, REFERENCE].map(d => `${d}/avant-${site}-${R}.ref.json`).find(f => existsSync(f));
const [site, Rs, xs, ys, ...ss] = process.argv.slice(2), R = +Rs;
const N = await nuageSite(site);
const refs = JSON.parse(readFileSync(fichierRef(site, R), "utf8"));
const Rf = refs.sort((a, b) => Math.hypot(a.x - xs, a.y - ys) - Math.hypot(b.x - xs, b.y - ys))[0];
const { axe, cum, s0, s1 } = Rf.dbg;
console.log("pont", Rf.x, Rf.y, "longueur", Rf.longueur, "largeur", Rf.largeur, "s0", s0.toFixed(1), "s1", s1.toFixed(1));
const projeter = (x, y) => { let best = [0, 0], bd = Infinity; for (let i = 0; i < axe.length - 1; i++) { const [ax, ay] = axe[i], [bx, by] = axe[i + 1], ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1; const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)), px = ax + ex * u, py = ay + ey * u, dd = (x - px) ** 2 + (y - py) ** 2; if (dd < bd) { bd = dd; const L = Math.sqrt(L2); best = [cum[i] + u * L, (-(x - ax) * ey + (y - ay) * ex) / L]; } } return best; };
const stations = ss.length ? ss.map(Number) : [0.1, 0.3, 0.5, 0.7, 0.9];
const S = stations.map(f => s0 + f * (s1 - s0)), bins = S.map(() => new Map());
for (let k = 0; k < N.n; k++) {
  const cl = N.C[k]; if (cl !== 17 && cl !== 27 && cl !== 2 && cl !== 1 && cl !== 26) continue;
  if (Math.hypot(N.X[k] - Rf.x, N.Y[k] - Rf.y) > Rf.longueur) continue;
  const [s, t] = projeter(N.X[k], N.Y[k]);
  if (Math.abs(t) > 25) continue;
  for (let q = 0; q < S.length; q++) if (Math.abs(s - S[q]) < 0.75) { const b = Math.round(t / 0.5), M = bins[q]; (M.get(b) || M.set(b, []).get(b)).push([N.Z[k], cl]); }
}
for (let q = 0; q < S.length; q++) {
  console.log(`--- station ${stations[q]} (s = ${(S[q] - s0).toFixed(0)} m)`);
  const cles = [...bins[q].keys()].sort((a, b) => a - b);
  let ligne = "";
  for (const b of cles) {
    const P = bins[q].get(b), z17 = P.filter(p => p[1] === 17).map(p => p[0]).sort((a, c) => a - c), zs = P.filter(p => p[1] === 2).map(p => p[0]).sort((a, c) => a - c), z27 = P.filter(p => p[1] === 27 || p[1] === 1 || p[1] === 26).map(p => p[0]).sort((a, c) => a - c);
    console.log(`t=${(b * 0.5).toFixed(1).padStart(6)}  pont n=${String(z17.length).padStart(3)} ${z17.length ? `max ${z17.at(-1).toFixed(2)} méd ${z17[z17.length >> 1].toFixed(2)} min ${z17[0].toFixed(2)}` : "".padEnd(33)}  sol n=${zs.length} ${zs.length ? zs[zs.length >> 1].toFixed(2) : ""}  autres n=${z27.length} ${z27.length ? z27[0].toFixed(1) + "…" + z27.at(-1).toFixed(1) : ""}`);
  }
}
