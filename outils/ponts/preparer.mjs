// Résumé compact du relevé laser autour d'un pont, à donner à l'agent qui le modélise (outils/ponts/consigne.md).
//   node outils/ponts/preparer.mjs <E> <N> [rayon=150] > resume.txt
// Le pont est trouvé dans le relevé (classe 17 de swissSURFACE3D : tabliers de ponts), autour du point donné.
// Sortie : axe (2 bouts), largeur mesurée, puis une ligne tous les 4 m : chaussée, terrain, et ce qu'il y a dessous
// (piles, arches) d'après les points entre le terrain et le tablier.
import { Copc } from "copc";
import { createLazPerf } from "laz-perf/lib/node/index.js";

const [E, N, R = 150] = process.argv.slice(2).map(Number);
if (!E || !N) { console.error("usage : node outils/ponts/preparer.mjs E N [rayon]"); process.exit(1); }
const boite = [E - R, N - R, E + R, N + R];

// ---------------------------------------------------------------- tuiles COPC (STAC swisstopo)
const versWgs = (e, n) => { // MN95 -> WGS84 (formules approchées de swisstopo, ~1 m)
  const y = (e - 2600000) / 1e6, x = (n - 1200000) / 1e6;
  const lo = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
  const la = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x * x * x;
  return [lo * 100 / 36, la * 100 / 36];
};
const [lo0, la0] = versWgs(boite[0], boite[1]), [lo1, la1] = versWgs(boite[2], boite[3]);
const stac = await (await fetch(`https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swisssurface3d/items?limit=100&bbox=${lo0},${la0},${lo1},${la1}`)).json();
const parTuile = new Map();
for (const f of stac.features || []) {
  const a = Object.values(f.assets).find(a => /copc/.test(a.type || a.href)); if (!a) continue;
  const k = f.id.split("_").pop(), an = +f.id.split("_")[1];
  if (!parTuile.has(k) || an > parTuile.get(k).an) parTuile.set(k, { url: a.href, an });
}
if (!parTuile.size) { console.error("pas de nuage COPC ici"); process.exit(2); }

const lazPerf = await createLazPerf();
const P = []; // [x, y, z, classe] relatifs à E, N
const coupe = (b, a) => b[0] < a[2] && b[2] > a[0] && b[1] < a[3] && b[3] > a[1];
for (const { url } of parTuile.values()) {
  const copc = await Copc.create(url), cube = copc.info.cube, cote = cube[3] - cube[0];
  const profMax = Math.max(0, Math.ceil(Math.log2(copc.info.spacing / 0.5)));
  const boiteNoeud = k => { const [d, x, y] = k.split("-").map(Number), s = cote / 2 ** d; return [cube[0] + x * s, cube[1] + y * s, cube[0] + (x + 1) * s, cube[1] + (y + 1) * s]; };
  const pages = [copc.info.rootHierarchyPage], noeuds = [];
  while (pages.length) {
    const { nodes, pages: sous } = await Copc.loadHierarchyPage(url, pages.pop());
    for (const [k, n] of Object.entries(nodes)) if (n?.pointCount && +k.split("-")[0] <= profMax && coupe(boiteNoeud(k), boite)) noeuds.push(n);
    for (const [k, p] of Object.entries(sous)) if (+k.split("-")[0] <= profMax && coupe(boiteNoeud(k), boite)) pages.push(p);
  }
  for (const n of noeuds) {
    const v = await Copc.loadPointDataView(url, copc, n, { lazPerf, include: ["X", "Y", "Z", "Classification"] });
    const gx = v.getter("X"), gy = v.getter("Y"), gz = v.getter("Z"), gc = v.getter("Classification");
    for (let i = 0; i < v.pointCount; i++) {
      const x = gx(i), y = gy(i);
      if (x < boite[0] || x > boite[2] || y < boite[1] || y > boite[3]) continue;
      P.push([x - E, y - N, gz(i), gc(i)]);
    }
  }
}

// ---------------------------------------------------------------- tablier : classe 17, le groupe le plus proche du point
let T = P.filter(p => p[3] === 17);
if (T.length < 50) { console.error(`trop peu de points de pont (classe 17 : ${T.length}) autour de ce point`); process.exit(3); }
// grappe connexe (cases de 2 m) qui contient la case de classe 17 la plus proche du point donné
const cle = p => `${Math.floor(p[0] / 2)},${Math.floor(p[1] / 2)}`, cases = new Map();
for (const p of T) { const k = cle(p); if (!cases.has(k)) cases.set(k, []); cases.get(k).push(p); }
let depart = null, dmin = Infinity;
for (const [k, l] of cases) { const d = Math.hypot(l[0][0], l[0][1]); if (d < dmin) { dmin = d; depart = k; } }
const vu = new Set([depart]), file = [depart];
while (file.length) {
  const [i, j] = file.pop().split(",").map(Number);
  for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) { const k = `${i + di},${j + dj}`; if (cases.has(k) && !vu.has(k)) { vu.add(k); file.push(k); } }
}
T = [...vu].flatMap(k => cases.get(k));
// axe : direction principale du nuage du tablier
let mx = 0, my = 0; for (const p of T) { mx += p[0]; my += p[1]; } mx /= T.length; my /= T.length;
let sxx = 0, sxy = 0, syy = 0; for (const p of T) { const a = p[0] - mx, b = p[1] - my; sxx += a * a; sxy += a * b; syy += b * b; }
const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
const long = p => (p[0] - mx) * ux + (p[1] - my) * uy, trav = p => (p[0] - mx) * nx + (p[1] - my) * ny;
const sl = T.map(long).sort((a, b) => a - b), s0 = sl[Math.floor(sl.length * 0.003)], s1 = sl[Math.floor(sl.length * 0.997)];
const tr = T.map(trav).sort((a, b) => a - b), w0 = tr[Math.floor(tr.length * 0.02)], w1 = tr[Math.floor(tr.length * 0.98)];
const L = s1 - s0, pt = s => [E + mx + ux * s, N + my + uy * s];
const f1 = v => v.toFixed(1), q = (a, f) => { if (!a.length) return NaN; a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * f))]; };

// ---------------------------------------------------------------- tranches de 4 m le long de l'axe
const pas = 4, nb = Math.ceil(L / pas), lignes = [];
const demi = (w1 - w0) / 2 + 3, centre = (w0 + w1) / 2;
const tr0 = Array.from({ length: nb }, () => ({ deck: [], sol: [], dessous: [], eau: [], veg: 0 }));
for (const p of P) {
  const s = long(p) - s0, t = trav(p) - centre;
  if (s < 0 || s >= L || Math.abs(t) > demi) continue;
  const b = tr0[Math.floor(s / pas)];
  if (p[3] === 17) b.deck.push(p[2]); else if (p[3] === 2) b.sol.push(p[2]); else if (p[3] === 9) b.eau.push(p[2]); else if (p[3] === 3 || p[3] === 4 || p[3] === 5) b.veg++; else b.dessous.push(p[2]);
}
console.log(`# Pont autour de ${E} ${N} : relevé swissSURFACE3D (${[...parTuile.values()].map(t => t.an).join(", ")}), ${P.length} points lus`);
console.log(`axe (bouts du tablier mesuré) : [${pt(s0).map(f1)}] -> [${pt(s1).map(f1)}], longueur ${f1(L)} m, largeur mesurée ${f1(w1 - w0)} m`);
console.log("s = distance depuis le premier bout (m) ; chaussee = dessus du tablier ; terrain = sol mesuré sous le pont (absent = eau, ou caché) ;");
console.log("dessous = autres points entre terrain + 2,5 m et le tablier (piles, arcs, murs) : nombre, altitudes bas..haut ; veg = arbres\n(le laser vole au-dessus : sous un tablier large, les arcs et piles fines sont souvent peu ou pas touchés)");
console.log("s\tchaussee\tdessous_tablier\tterrain\teau\tdessous(n bas..haut)\tveg");
tr0.forEach((b, i) => {
  const ch = q(b.deck, 0.9), dt = q(b.deck, 0.05), eau = q(b.eau, 0.5), so = isNaN(q(b.sol, 0.5)) ? eau : q(b.sol, 0.5);
    // au-dessus du terrain de 2,5 m au moins : ni voitures ni mobilier de la rue dessous
  const d = b.dessous.filter(z => !(z > ch - 0.5) && !(z < (isNaN(so) ? -1e9 : so + 2.5)));
  const txt = d.length >= 3 ? `${d.length} ${f1(q(d, 0.02))}..${f1(q(d, 0.98))}` : "-";
  lignes.push(`${i * pas}\t${f1(ch)}\t${f1(dt)}\t${isNaN(q(b.sol, 0.5)) ? "-" : f1(q(b.sol, 0.5))}\t${isNaN(eau) ? "-" : f1(eau)}\t${txt}\t${b.veg || "-"}`);
});
console.log(lignes.join("\n"));
