// Vérifie un pont modélisé contre le nuage de points swisstopo (swissSURFACE3D, COPC).
//   node outils/ponts/verifier_nuage.mjs outils/ponts/modeles/<nom>.json <sortie.png> [> rapport.txt]
//
// 1. Tablier : écart d'altitude entre les points « pont » (classe 17) et le dessus du tablier modélisé, et largeur.
// 2. Points non expliqués : points d'ouvrage (classes 1, 6, 17 et autres hors sol, végétation, eau) dans le couloir du
//    pont, à plus de 1,5 m de toute surface du modèle, regroupés par tranches de 10 m le long de l'axe : ce qui manque.
// 3. Appuis : points du nuage à moins de 2 m de chaque pile, pylône ou élément (vu ou non par le laser), et sommet mesuré
//    des pylônes.
// 4. Image : élévation (s, altitude) des points du couloir et de la silhouette du modèle, plus une vue en plan.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { Copc } from "copc";
import { createLazPerf } from "laz-perf/lib/node/index.js";
import { maillagePont } from "../../src/pontsModeles.js";

const [fichier, sortie = "/tmp/verif.png"] = process.argv.slice(2);
const P = JSON.parse(readFileSync(fichier, "utf8"));
const axe = P.axe, sA = [0];
for (let i = 1; i < axe.length; i++) sA.push(sA[i - 1] + Math.hypot(axe[i][0] - axe[i - 1][0], axe[i][1] - axe[i - 1][1]));
const L = sA.at(-1);
const projeter = (x, y) => { // -> [s, o (+ à gauche), z chaussée]
  let best = [0, Infinity, 0];
  for (let i = 0; i < axe.length - 1; i++) {
    const ax = axe[i][0], ay = axe[i][1], dx = axe[i + 1][0] - ax, dy = axe[i + 1][1] - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), px = ax + t * dx, py = ay + t * dy, d = Math.hypot(x - px, y - py);
    if (d < Math.abs(best[1])) best = [sA[i] + t * Math.sqrt(l2), -Math.sign((x - ax) * dy - (y - ay) * dx) * d, axe[i][2] + (axe[i + 1][2] - axe[i][2]) * t];
  }
  return best;
};

// ------------------------------------------------------------------ nuage : COPC dans la boîte de l'ouvrage
const marge = (P.largeur || 10) / 2 + 25;
const xs = axe.map(p => p[0]), ys = axe.map(p => p[1]);
const boite = [Math.min(...xs) - marge, Math.min(...ys) - marge, Math.max(...xs) + marge, Math.max(...ys) + marge];
const versWgs = (e, n) => {
  const y = (e - 2600000) / 1e6, x = (n - 1200000) / 1e6;
  return [(2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3) * 100 / 36,
    (16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x ** 3) * 100 / 36];
};
const [lo0, la0] = versWgs(boite[0], boite[1]), [lo1, la1] = versWgs(boite[2], boite[3]);
const stac = await (await fetch(`https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swisssurface3d/items?limit=100&bbox=${lo0},${la0},${lo1},${la1}`)).json();
const tuiles = new Map();
for (const f of stac.features || []) {
  const a = Object.values(f.assets).find(a => /copc/.test(a.href)); if (!a) continue;
  const k = f.id.split("_").pop(), an = +f.id.split("_")[1];
  if (!tuiles.has(k) || an > tuiles.get(k).an) tuiles.set(k, { url: a.href, an });
}
if (!tuiles.size) { console.error("pas de nuage COPC ici"); process.exit(2); }
const lazPerf = await createLazPerf();
const pts = []; // [x, y, z, classe, s, o]
const coupe = (b, a) => b[0] < a[2] && b[2] > a[0] && b[1] < a[3] && b[3] > a[1];
for (const { url } of tuiles.values()) {
  const copc = await Copc.create(url), cube = copc.info.cube, cote = cube[3] - cube[0];
  const profMax = Math.max(0, Math.ceil(Math.log2(copc.info.spacing / 0.5)));
  const bn = k => { const [d, x, y] = k.split("-").map(Number), s = cote / 2 ** d; return [cube[0] + x * s, cube[1] + y * s, cube[0] + (x + 1) * s, cube[1] + (y + 1) * s]; };
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
      const [s, o] = projeter(x, y);
      if (s < -15 || s > L + 15 || Math.abs(o) > marge) continue;
      pts.push([x, y, gz(i), gc(i), s, o]);
    }
  }
}
// terrain mesuré (classe 2) en cases de 2 m, pour les pieds de piles sans z_bas
const solG = new Map();
for (const p of pts) if (p[3] === 2) { const k = `${Math.floor(p[0] / 2)},${Math.floor(p[1] / 2)}`; if (!(solG.get(k) <= p[2])) solG.set(k, p[2]); }
function solMesure(x, y) { for (let r = 0; r < 6; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { const v = solG.get(`${Math.floor(x / 2) + i},${Math.floor(y / 2) + j}`); if (v != null) return v; } return NaN; }

// ------------------------------------------------------------------ maillage du modèle (coordonnées MN95 absolues)
const E0 = axe[0][0], N0 = axe[0][1];
const { dessus, reste } = maillagePont(P, E0, N0, 0, (x, y) => solMesure(x + E0, y + N0));
const tris = [];
for (const g of [dessus, reste]) {
  const a = g.attributes.position.array;
  for (let k = 0; k < a.length; k += 9) {
    const t = [0, 3, 6].map(o => [a[k + o] + E0, -a[k + o + 2] + N0, a[k + o + 1]]);
    if (t.flat().every(Number.isFinite)) tris.push(t);
  }
}

// ------------------------------------------------------------------ distance point -> maillage (grille de 3 m)
const C = 3, grille = new Map();
for (const t of tris) {
  const mn = [0, 1, 2].map(k => Math.min(t[0][k], t[1][k], t[2][k])), mx = [0, 1, 2].map(k => Math.max(t[0][k], t[1][k], t[2][k]));
  for (let i = Math.floor((mn[0] - 2) / C); i <= Math.floor((mx[0] + 2) / C); i++)
    for (let j = Math.floor((mn[1] - 2) / C); j <= Math.floor((mx[1] + 2) / C); j++)
      for (let k = Math.floor((mn[2] - 2) / C); k <= Math.floor((mx[2] + 2) / C); k++) {
        const c = `${i},${j},${k}`; if (!grille.has(c)) grille.set(c, []); grille.get(c).push(t);
      }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function distTri(p, [a, b, c]) { // Ericson, Real-Time Collision Detection
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  const q = (u, v) => Math.hypot(p[0] - (a[0] + u * ab[0] + v * ac[0]), p[1] - (a[1] + u * ab[1] + v * ac[1]), p[2] - (a[2] + u * ab[2] + v * ac[2]));
  if (d1 <= 0 && d2 <= 0) return q(0, 0);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return q(1, 0);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return q(d1 / (d1 - d3), 0);
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return q(0, 1);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return q(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return q(1 - w, w); }
  const den = 1 / (va + vb + vc); return q(vb * den, vc * den);
}
const distModele = p => {
  const c = `${Math.floor(p[0] / C)},${Math.floor(p[1] / C)},${Math.floor(p[2] / C)}`, l = grille.get(c);
  if (!l) return Infinity; let d = Infinity; for (const t of l) d = Math.min(d, distTri(p, t)); return d;
};

// ------------------------------------------------------------------ 1. tablier
const zDessus = s => { let i = 0; while (i < axe.length - 2 && s > sA[i + 1]) i++; const u = (s - sA[i]) / ((sA[i + 1] - sA[i]) || 1); return axe[i][2] + (axe[i + 1][2] - axe[i][2]) * u; };
const tab = pts.filter(p => p[3] === 17 && p[4] >= 0 && p[4] <= L && Math.abs(p[5]) < P.largeur / 2);
const dz = tab.map(p => p[2] - zDessus(p[4])).sort((a, b) => a - b), q = (a, f) => a.length ? a[Math.floor(a.length * f)] : NaN;
const oT = pts.filter(p => p[3] === 17 && p[4] > 10 && p[4] < L - 10).map(p => p[5]).sort((a, b) => a - b);
const lignes = [];
const ecrire = l => { lignes.push(l); console.log(l); };
ecrire(`# Vérification de « ${P.nom} » contre le nuage swissSURFACE3D (${[...tuiles.values()].map(t => t.an).join(", ")})`);
ecrire(`${pts.length} points dans le couloir (±${marge.toFixed(0)} m), ${tris.length} triangles dans le modèle`);
ecrire(`Tablier : ${tab.length} points « pont » ; écart (nuage - modèle) médiane ${q(dz, 0.5)?.toFixed(2)} m, 5 % ${q(dz, 0.05)?.toFixed(2)}, 95 % ${q(dz, 0.95)?.toFixed(2)} m`);
ecrire(`Largeur : nuage (classe 17, 2-98 %) ${(q(oT, 0.98) - q(oT, 0.02)).toFixed(1)} m ; modèle ${P.largeur} m`);

// ------------------------------------------------------------------ 2. points d'ouvrage non expliqués
const ouvrage = p => ![2, 3, 4, 5, 7, 9].includes(p[3]);
const zSol = p => solMesure(p[0], p[1]);
const candidats = pts.filter(p => ouvrage(p) && p[4] >= -5 && p[4] <= L + 5 && Math.abs(p[5]) < P.largeur / 2 + 12 && !(p[2] < zSol(p) + 1.5));
let expliques = 0; const manque = new Map();
for (const p of candidats) {
  const d = distModele(p);
  if (d <= 1.5) expliques++;
  else { const k = Math.floor(p[4] / 10) * 10; const m = manque.get(k) || { n: 0, zmin: Infinity, zmax: -Infinity, omin: Infinity, omax: -Infinity }; m.n++; m.zmin = Math.min(m.zmin, p[2]); m.zmax = Math.max(m.zmax, p[2]); m.omin = Math.min(m.omin, p[5]); m.omax = Math.max(m.omax, p[5]); manque.set(k, m); }
}
ecrire(`Points d'ouvrage hors sol dans le couloir : ${candidats.length}, dont ${(100 * expliques / (candidats.length || 1)).toFixed(1)} % à moins de 1,5 m du modèle`);
const gros = [...manque.entries()].filter(([, m]) => m.n >= 15).sort((a, b) => a[0] - b[0]);
if (gros.length) {
  ecrire(`Non expliqués (tranches de 10 m, ≥ 15 points) : s, nombre, altitudes, décalage en travers`);
  for (const [s, m] of gros) ecrire(`  s ${s}-${s + 10} : ${m.n} pts, z ${m.zmin.toFixed(1)}..${m.zmax.toFixed(1)}, o ${m.omin.toFixed(1)}..${m.omax.toFixed(1)}`);
}

// ------------------------------------------------------------------ 3. appuis et pylônes
const autour = (s0, r) => pts.filter(p => ouvrage(p) && Math.abs(p[4] - s0) < r && Math.abs(p[5]) < P.largeur / 2 + 10);
for (const a of P.appuis || []) {
  if (a.type !== "pile") continue;
  const l = autour(a.s, (a.long || 3) / 2 + 2).filter(p => p[2] < zDessus(a.s) - (P.epaisseur || 1) - 0.5);
  ecrire(`Pile s ${a.s} : ${l.length} points sous le tablier${l.length ? `, z ${Math.min(...l.map(p => p[2])).toFixed(1)}..${Math.max(...l.map(p => p[2])).toFixed(1)}, o ${Math.min(...l.map(p => p[5])).toFixed(1)}..${Math.max(...l.map(p => p[5])).toFixed(1)}` : " (non vue par le laser)"}`);
}
for (const y of P.pylones || []) {
  const l = autour(y.s, 8).filter(p => p[2] > zDessus(y.s) + 3);
  ecrire(`Pylône s ${y.s} : sommet mesuré ${l.length ? Math.max(...l.map(p => p[2])).toFixed(1) : "—"} m, modèle ${y.z_haut} m (${l.length} points au-dessus du tablier)`);
}

// ------------------------------------------------------------------ 4. image : élévation et plan
const zs = pts.filter(p => p[4] >= -10 && p[4] <= L + 10).map(p => p[2]).sort((a, b) => a - b);
const zmin = q(zs, 0.005) - 2, zmax = Math.max(q(zs, 0.999), ...(P.pylones || []).map(y => y.z_haut)) + 3;
const Wd = 1600, ech = Wd / (L + 30), He = Math.min(900, Math.ceil((zmax - zmin) * ech)), Hp = Math.ceil((2 * marge) * ech), Ht = He + Hp + 30;
const img = new Uint8Array(Wd * Ht * 3).fill(255);
const px = (x, y, r, g, b, a = 1) => { if (x < 0 || y < 0 || x >= Wd || y >= Ht) return; const i = 3 * (Math.floor(y) * Wd + Math.floor(x)); img[i] = img[i] * (1 - a) + r * a; img[i + 1] = img[i + 1] * (1 - a) + g * a; img[i + 2] = img[i + 2] * (1 - a) + b * a; };
const X = s => (s + 15) * ech, Ye = z => He - (z - zmin) * ech, Yp = o => He + 30 + (marge - o) * ech;
// silhouette du modèle (triangles projetés), en bleu pâle
const remplir = (A, B, Cc, f) => { // triangle 2D, remplissage par balayage
  const v = [A, B, Cc].sort((a, b) => a[1] - b[1]);
  for (let y = Math.ceil(v[0][1]); y <= v[2][1]; y++) {
    const xa = (y2 => { const [p, q2] = y2 < v[1][1] ? [v[0], v[1]] : [v[1], v[2]]; return p[0] + (q2[0] - p[0]) * ((y2 - p[1]) / ((q2[1] - p[1]) || 1)); })(y);
    const xb = v[0][0] + (v[2][0] - v[0][0]) * ((y - v[0][1]) / ((v[2][1] - v[0][1]) || 1));
    for (let x = Math.ceil(Math.min(xa, xb)); x <= Math.max(xa, xb); x++) f(x, y);
  }
};
const silE = new Uint8Array(Wd * Ht), silP = new Uint8Array(Wd * Ht);
for (const t of tris) {
  const so = t.map(p => projeter(p[0], p[1]));
  remplir(...so.map((v, k) => [X(v[0]), Ye(t[k][2])]), (x, y) => { if (x >= 0 && y >= 0 && x < Wd && y < He) silE[y * Wd + x] = 1; });
  remplir(...so.map(v => [X(v[0]), Yp(v[1])]), (x, y) => { if (x >= 0 && y >= He + 30 && x < Wd && y < Ht) silP[y * Wd + x] = 1; });
}
for (let i = 0; i < Wd * Ht; i++) if (silE[i] || silP[i]) { img[3 * i] = 150; img[3 * i + 1] = 190; img[3 * i + 2] = 235; }
// points : pont (17) gris foncé, ouvrage non classé rouge s'il est loin du modèle, sol brun, végétation vert, eau bleu
const couleur = p => p[3] === 17 ? [60, 60, 70] : p[3] === 2 ? [150, 110, 70] : [3, 4, 5].includes(p[3]) ? [90, 160, 80] : p[3] === 9 ? [40, 90, 200] : [220, 120, 20];
for (const p of pts) {
  if (Math.abs(p[5]) > P.largeur / 2 + 6 && p[3] !== 17) continue; // élévation : couloir étroit (pas les arbres des rives)
  const c = couleur(p); px(X(p[4]), Ye(p[2]), ...c, 0.5);
}
for (const p of pts) { if (p[2] < zSol(p) + 1.5 && p[3] !== 17) continue; const c = couleur(p); px(X(p[4]), Yp(p[5]), ...c, 0.35); }
for (const p of candidats) if (distModele(p) > 1.5) { px(X(p[4]), Ye(p[2]), 230, 20, 30, 0.9); px(X(p[4]), Yp(p[5]), 230, 20, 30, 0.9); }
// écriture PNG
const lignesPng = Buffer.alloc((Wd * 3 + 1) * Ht);
for (let y = 0; y < Ht; y++) { lignesPng[y * (Wd * 3 + 1)] = 0; Buffer.from(img.buffer, y * Wd * 3, Wd * 3).copy(lignesPng, y * (Wd * 3 + 1) + 1); }
const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const x of b) r = t[(r ^ x) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
const bloc = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(Wd, 0); ihdr.writeUInt32BE(Ht, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(sortie, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc("IHDR", ihdr), bloc("IDAT", deflateSync(lignesPng)), bloc("IEND", Buffer.alloc(0))]));
ecrire(`Image : ${sortie} (haut : élévation le long de l'axe ; bas : plan ; bleu = modèle, gris = points « pont », orange = autres points d'ouvrage, rouge = non expliqués, brun = sol, vert = végétation)`);
