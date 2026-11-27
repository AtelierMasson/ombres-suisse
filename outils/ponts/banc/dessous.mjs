// node --import ./env.mjs dessous.mjs <site> <R> <x> <y> [pas] : profil du dessous d'un pont de référence (points 17 / 27 / 1 / 26 sous la chaussée, par station)
import { readFileSync } from "node:fs";
import { nuageSite } from "./charger.mjs";
import { MESURES, REFERENCE } from "./sites.mjs";
import { existsSync } from "node:fs";
const fichierRef = (site, R) => [MESURES, REFERENCE].map(d => `${d}/avant-${site}-${R}.ref.json`).find(f => existsSync(f));
const [site, Rs, xs, ys, ps] = process.argv.slice(2), R = +Rs, pas = +(ps || 2);
const N = await nuageSite(site);
const refs = JSON.parse(readFileSync(fichierRef(site, R), "utf8"));
const Rf = refs.sort((a, b) => Math.hypot(a.x - xs, a.y - ys) - Math.hypot(b.x - xs, b.y - ys))[0];
const { axe, cum, s0, s1 } = Rf.dbg, demi = Rf.largeur / 2 + 1;
console.log("pont", Rf.x, Rf.y, "longueur", Rf.longueur, "largeur", Rf.largeur, "piles", JSON.stringify(Rf.piles));
const projeter = (x, y) => { let best = [0, 0], bd = Infinity; for (let i = 0; i < axe.length - 1; i++) { const [ax, ay] = axe[i], [bx, by] = axe[i + 1], ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1; const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)), px = ax + ex * u, py = ay + ey * u, dd = (x - px) ** 2 + (y - py) ** 2; if (dd < bd) { bd = dd; const L = Math.sqrt(L2); best = [cum[i] + u * L, (-(x - ax) * ey + (y - ay) * ex) / L]; } } return best; };
const nb = Math.ceil((s1 - s0) / pas) + 1, st = Array.from({ length: nb }, () => ({ haut: [], p17: [], p27: [], sol: [], tmin: 1e9, tmax: -1e9 }));
for (let k = 0; k < N.n; k++) {
  const cl = N.C[k]; if (cl !== 17 && cl !== 27 && cl !== 2 && cl !== 1 && cl !== 26) continue;
  if (Math.hypot(N.X[k] - Rf.x, N.Y[k] - Rf.y) > Rf.longueur) continue;
  const [s, t] = projeter(N.X[k], N.Y[k]);
  if (Math.abs(t) > demi + 6 || s < s0 || s > s1) continue;
  const T = st[Math.min(nb - 1, Math.floor((s - s0) / pas))];
  if (cl === 2) { if (Math.abs(t) < demi + 3) T.sol.push(N.Z[k]); continue; }
  if (Math.abs(t) > demi + 1.5) continue;
  if (cl === 17) T.p17.push([N.Z[k], t]); else T.p27.push([N.Z[k], t, cl]);
}
const q = (a, f) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : NaN;
for (let i = 0; i < nb; i++) {
  const T = st[i], z = T.p17.map(p => p[0]).sort((a, b) => a - b), haut = q(z, 0.9), bas = z.filter(v => v < haut - 1), sol = T.sol.sort((a, b) => a - b);
  const par = cl => { const v = T.p27.filter(p => p[2] === cl && p[0] < haut - 1).map(p => p[0]).sort((a, b) => a - b); return v.length ? `${String(v.length).padStart(4)} ${(haut - v.at(-1)).toFixed(1).padStart(5)}…${(haut - v[0]).toFixed(1).padEnd(5)}` : "   0            "; };
  console.log(`s=${String(i * pas).padStart(4)} haut ${haut.toFixed(1)} | 17 sous n=${String(bas.length).padStart(4)} ${bas.length ? (haut - bas.at(-1)).toFixed(1) + "…" + (haut - bas[0]).toFixed(1) : "".padEnd(9)} | 27: ${par(27)} | 26: ${par(26)} | 1: ${par(1)} | sol −${sol.length ? (haut - q(sol, 0.1)).toFixed(1) : "?"}`);
}
