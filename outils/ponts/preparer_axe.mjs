// Résumé du relevé laser le long de l'axe d'un pont recensé (ponts50.json, swissTLM3D) : pour les longs ouvrages,
// calé sur l'axe officiel plutôt que sur la tache de points la plus proche (preparer.mjs).
//   node outils/ponts/preparer_axe.mjs <ponts.json> <id> [pas = 10 m] [espacement des points = 1 m] > resume.txt
import { readFileSync } from "node:fs";
import { Copc } from "copc";
import { createLazPerf } from "laz-perf/lib/node/index.js";

const [fichier, id, pasArg, espArg] = process.argv.slice(2);
const P = JSON.parse(readFileSync(fichier, "utf8")).find(p => String(p.id) === String(id));
if (!P) { console.error("pont introuvable"); process.exit(1); }
const PAS = +pasArg || 10, ESP = +espArg || 1, COULOIR = 25;
const axe = P.axe, s = [0];
for (let i = 1; i < axe.length; i++) s.push(s[i - 1] + Math.hypot(axe[i][0] - axe[i - 1][0], axe[i][1] - axe[i - 1][1]));
const L = s.at(-1);
// projection d'un point sur l'axe : [distance le long, écart en travers (signé)]
function projeter(x, y) {
  let best = [0, Infinity, 0];
  for (let i = 0; i < axe.length - 1; i++) {
    const ax = axe[i][0], ay = axe[i][1], dx = axe[i + 1][0] - ax, dy = axe[i + 1][1] - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), px = ax + t * dx, py = ay + t * dy, d = Math.hypot(x - px, y - py);
    if (d < Math.abs(best[1])) best = [s[i] + t * Math.sqrt(l2), Math.sign((x - ax) * dy - (y - ay) * dx) * d];
  }
  return best;
}
const b = P.boite, boite = [b[0] - COULOIR, b[1] - COULOIR, b[2] + COULOIR, b[3] + COULOIR];

const versWgs = (e, n) => {
  const y = (e - 2600000) / 1e6, x = (n - 1200000) / 1e6;
  return [(2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y) * 100 / 36,
    (16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x * x * x) * 100 / 36];
};
const [lo0, la0] = versWgs(boite[0], boite[1]), [lo1, la1] = versWgs(boite[2], boite[3]);
const stac = await (await fetch(`https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swisssurface3d/items?limit=100&bbox=${lo0},${la0},${lo1},${la1}`)).json();
const parTuile = new Map();
for (const f of stac.features || []) {
  const a = Object.values(f.assets).find(a => /copc/.test(a.type || a.href)); if (!a) continue;
  const k = f.id.split("_").pop(), an = +f.id.split("_")[1];
  if (!parTuile.has(k) || an > parTuile.get(k).an) parTuile.set(k, { url: a.href, an });
}
const lazPerf = await createLazPerf();
const nb = Math.ceil(L / PAS), T = Array.from({ length: nb }, () => ({ deck: [], sol: [], eau: [], dessous: [], profond17: [] }));
const coupe = (q, a) => q[0] < a[2] && q[2] > a[0] && q[1] < a[3] && q[3] > a[1];
let lus = 0;
for (const { url } of parTuile.values()) {
  const copc = await Copc.create(url), cube = copc.info.cube, cote = cube[3] - cube[0];
  const profMax = Math.max(0, Math.ceil(Math.log2(copc.info.spacing / ESP)));
  const bn = k => { const [d, x, y] = k.split("-").map(Number), w = cote / 2 ** d; return [cube[0] + x * w, cube[1] + y * w, cube[0] + (x + 1) * w, cube[1] + (y + 1) * w]; };
  const pages = [copc.info.rootHierarchyPage], noeuds = [];
  while (pages.length) {
    const { nodes, pages: sous } = await Copc.loadHierarchyPage(url, pages.pop());
    for (const [k, n] of Object.entries(nodes)) if (n?.pointCount && +k.split("-")[0] <= profMax && coupe(bn(k), boite)) noeuds.push(n);
    for (const [k, p] of Object.entries(sous)) if (+k.split("-")[0] <= profMax && coupe(bn(k), boite)) pages.push(p);
  }
  for (const n of noeuds) {
    const v = await Copc.loadPointDataView(url, copc, n, { lazPerf, include: ["X", "Y", "Z", "Classification"] });
    const gx = v.getter("X"), gy = v.getter("Y"), gz = v.getter("Z"), gc = v.getter("Classification");
    for (let i = 0; i < v.pointCount; i++) {
      const x = gx(i), y = gy(i);
      if (x < boite[0] || x > boite[2] || y < boite[1] || y > boite[3]) continue;
      const [sp, tr] = projeter(x, y);
      if (Math.abs(tr) > COULOIR || sp <= 0 || sp >= L) continue;
      lus++;
      const B = T[Math.min(nb - 1, Math.floor(sp / PAS))], z = gz(i), c = gc(i);
      if (c === 17 && Math.abs(tr) < 10) B.deck.push(z);
      else if (c === 2) B.sol.push(z);
      else if (c === 9) B.eau.push(z);
      else if (c !== 3 && c !== 4 && c !== 5 && Math.abs(tr) < 12) B.dessous.push(z);
      if (c === 17 || c === 27) B.profond17.push(z);
    }
  }
}
const q = (a, f) => { if (!a.length) return NaN; a.sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * f))]; };
const f1 = v => isNaN(v) ? "-" : v.toFixed(1);
console.log(`# ${P.nom || P.type} (${P.type}, ${P.proprietaire}) : axe swissTLM3D de ${L.toFixed(0)} m, de [${axe[0].map(v => v.toFixed(1))}] à [${axe.at(-1).map(v => v.toFixed(1))}] ; relevé ${[...parTuile.values()].map(t => t.an).join(", ")}, ${lus} points dans un couloir de ±${COULOIR} m`);
console.log("s = distance le long de l'axe ; chaussee = dessus du tablier (laser) ; dessous_tablier ; terrain ; eau ; appuis = points sous le tablier, de terrain+2,5 m à tablier-1 m (piles, arcs) : nombre et altitudes bas..haut");
console.log("s\tchaussee\tdessous_tablier\tterrain\teau\tappuis");
T.forEach((B, i) => {
  const ch = q(B.deck, 0.9), dt = q(B.deck, 0.05), so = q(B.sol, 0.3), eau = q(B.eau, 0.5), base = isNaN(so) ? eau : so;
  const ap = [...B.dessous, ...B.profond17].filter(z => z < (isNaN(dt) ? Infinity : dt - 1) && z > (isNaN(base) ? -Infinity : base + 2.5));
  console.log(`${i * PAS}\t${f1(ch)}\t${f1(dt)}\t${f1(so)}\t${f1(eau)}\t${ap.length >= 4 ? `${ap.length} ${f1(q(ap, 0.03))}..${f1(q(ap, 0.97))}` : "-"}`);
});
