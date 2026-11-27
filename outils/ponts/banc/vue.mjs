// node --import ./env.mjs vue.mjs <src> <site> <R> <x> <y> <demi> <sortie.png> [échelle px/m = 6]
// Vue de dessus de diagnostic : terrain ombré, cases « pont » teintées selon l'écart au modèle, arêtes du dessus du
// modèle (rouge), piles (vert), joints (croix).
import { nuageSite } from "./charger.mjs";
import { Image } from "./image.mjs";
const [src, site, Rs, xs, ys, ds, sortie, es] = process.argv.slice(2), R = +Rs, cx = +xs, cy = +ys, demi = +ds, ech = +(es || 6);
process.argv[1] = "x";
const B = await import("./banc.mjs");
const g = await import(src + "/grille.js"), m = await import(src + "/maillages.js"), pm = await import(src + "/pontsModeles.js");
const N = B.rogner(await nuageSite(site), R), S = B.construire(N, R, { g, m, pm }), G = S.G, { n, c, x0 } = G;
const W = Math.round(2 * demi * ech), im = new Image(W, W), X = x => (x - cx + demi) * ech, Y = y => (cy + demi - y) * ech;
const I = B.indexer(S.dessus), pont = G.pontAuto || G.pont;
for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
  const x = cx - demi + (px + 0.5) / ech, y = cy + demi - (py + 0.5) / ech;
  if (Math.abs(x) >= R - 1 || Math.abs(y) >= R - 1) continue;
  const z = g.solEn(G, x, y), dzx = g.solEn(G, x + 1, y) - g.solEn(G, x - 1, y), dzy = g.solEn(G, x, y + 1) - g.solEn(G, x, y - 1);
  let v = Math.max(60, Math.min(250, 170 - 25 * dzx + 25 * dzy));
  let col = [v, v, v];
  const i = Math.floor((x - x0) / c), j = Math.floor((y - x0) / c), p = j * n + i;
  if (G.eau && !isNaN(G.eau[p])) col = [v * 0.6, v * 0.8, 255];
  if (!isNaN(pont[p])) {
    const h = B.lire(I, x, y).haut, d = isNaN(h) ? NaN : h - (pont[p] - S.zRef);
    // bleu : couvert et proche ; orange : chaussée trop basse (> 15 cm) ; violet : trop haute ; noir : non couvert
    col = isNaN(d) ? [40, 40, 40] : d < -0.15 ? [255, 150, 40] : d > 0.15 ? [190, 80, 220] : [90, 150, 255];
    col = col.map(k => k * (0.75 + 0.25 * v / 190));
  }
  im.px(px, py, col);
}
// arêtes du dessus et des côtés
const aretes = (geoms, col, a) => { for (const geo of geoms) { const P = geo.attributes.position; for (let t = 0; t < P.count; t += 3) for (let e = 0; e < 3; e++) { const i0 = t + e, i1 = t + (e + 1) % 3; im.ligne(X(P.getX(i0)), Y(-P.getZ(i0)), X(P.getX(i1)), Y(-P.getZ(i1)), col, 1, a); } } };
aretes(S.dessus, [220, 0, 0], 0.8);
aretes(S.dessusModeles, [200, 0, 200], 0.8);
for (const inf of S.infos) for (const b of inf.bouts || []) im.croix(X(b[0]), Y(b[1]), [255, 230, 0], 5);
im.ecrire(sortie);
console.log(sortie, W, JSON.stringify(S.infos.map(i => ({ ...i, dbg: undefined }))));
