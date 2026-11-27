// node --import ./env.mjs profil.mjs <src> <site> <R> <x> <y> <bout> [f] : profil visible le long d'une ligne au bout d'un pont de référence
import { readFileSync } from "node:fs";
import { nuageSite } from "./charger.mjs";
import { MESURES, REFERENCE } from "./sites.mjs";
import { existsSync } from "node:fs";
const fichierRef = (site, R) => [MESURES, REFERENCE].map(d => `${d}/avant-${site}-${R}.ref.json`).find(f => existsSync(f));
const [src, site, Rs, xs, ys, bs, fs] = process.argv.slice(2), R = +Rs, f = +(fs || 0);
process.argv[1] = "x";
const B = await import("./banc.mjs");
const g = await import(src + "/grille.js"), m = await import(src + "/maillages.js"), pm = await import(src + "/pontsModeles.js");
const N = B.rogner(await nuageSite(site), R), S = B.construire(N, R, { g, m, pm });
const refs = JSON.parse(readFileSync(fichierRef(site, R), "utf8"));
const Rf = refs.sort((a, b) => Math.hypot(a.x - xs, a.y - ys) - Math.hypot(b.x - xs, b.y - ys))[0];
const { axe, cum, s0, s1, mil, lar, joint } = Rf.dbg, b = +bs, I = B.indexer(S.dessus);
const surAxe = s => { let i = 0; while (i < axe.length - 2 && cum[i + 1] < s) i++; const [ax, ay] = axe[i], [bx, by] = axe[i + 1], L = cum[i + 1] - cum[i] || 1, u = (s - cum[i]) / L, dx = (bx - ax) / L, dy = (by - ay) / L; return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, nx: -dy, ny: dx }; };
console.log("pont", Rf.x, Rf.y, "joints", Rf.joints, "libre", Rf.libre, "largeur", lar, "milieu", mil);
const sb = b ? s1 : s0, sens = b ? 1 : -1, t = mil[b] + f * lar[b];
for (let e = -6; e <= 20; e += 0.5) {
  const A = surAxe(sb + sens * e), x = A.x + A.nx * t, y = A.y + A.ny * t, h = B.lire(I, x, y).haut, ts = B.solAffiche(S.G, x, y) - S.zRef, i = Math.floor((x - S.G.x0) / S.G.c), j = Math.floor((y - S.G.x0) / S.G.c), pz = S.G.pont[j * S.G.n + i] - S.zRef;
  console.log(`e=${e.toFixed(1).padStart(5)}  chaussée ${isNaN(h) ? "   —  " : h.toFixed(2).padStart(6)}  terrain ${ts.toFixed(2).padStart(6)}  relevé pont ${isNaN(pz) ? "  —" : pz.toFixed(2)}  visible ${Math.max(ts, isNaN(h) ? -1e9 : h).toFixed(2)} ${!isNaN(h) && ts > h ? "T" : ""}`);
}
