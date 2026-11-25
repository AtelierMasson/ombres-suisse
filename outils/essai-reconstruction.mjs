// Essai hors navigateur de la reconstruction maison (src/reconstruction/) et comparaison avec roofer (fichiers d'essai).
// Usage : node outils/essai-reconstruction.mjs [floreal|lutry] [--rayon 150] [--espacement 0.5] [--repetitions 3] [--sortie]
//   --sortie : écrit public/essais/reconstruction_<lieu>.json (même format que roofer_<lieu>.json).
// Cache des téléchargements : variable CACHE_ESSAI (sinon dossier temporaire du système).
import { readFileSync, writeFileSync } from "node:fs";
import { donneesEssai } from "./donnees-essai.mjs";
import { reconstruire, enJSON } from "../src/reconstruction/index.js";
import { dansAnneaux } from "../src/reconstruction/geometrie.js";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const nom = ["floreal", "lutry"].includes(process.argv[2]) ? process.argv[2] : "floreal";
const R = +arg("rayon", 150), espacement = +arg("espacement", 0.5);
const racine = new URL("..", import.meta.url);

const { lieu, origine, boite, points, emprises } = await donneesEssai(nom, { R, espacement });
console.log(`${lieu.nom} : ${points.n.toLocaleString("fr-CH")} points, ${emprises.emprises.length} emprises (${emprises.source})`);

// plusieurs passes : on garde la plus rapide (la machine peut être occupée par ailleurs)
let res;
for (let k = 0, nb = +arg("repetitions", 3); k < nb; k++) {
  const r = reconstruire({ points, origine, emprises: emprises.emprises, source: emprises.source, options: { boite } });
  if (!res || r.ms < res.ms) res = r;
}
const D = res.details, ms = D.map(d => d.ms).sort((a, b) => a - b), q = (v, f) => v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] : NaN;
const par = k => D.filter(d => d.niveau === k).length;
console.log(`reconstruction : ${Math.round(res.ms)} ms (meilleure de ${arg("repetitions", 3)} passes) sur un fil pour ${D.length} emprises — LoD2 ${par("LoD2")}, LoD1.2 ${par("LoD1.2")}, rien ${par(null)}`);
console.log(`  par bâtiment : médiane ${q(ms, 0.5).toFixed(1)} ms, 90e ${q(ms, 0.9).toFixed(1)} ms, max ${ms.at(-1).toFixed(0)} ms`);
for (const d of D) if (d.niveau !== "LoD2") console.log(`  ${d.id} : ${d.niveau || "rien"} — ${d.motif}`);
const lents = D.slice().sort((a, b) => b.ms - a.ms).slice(0, 3);
console.log("  les plus lents : " + lents.map(d => `${d.id} ${Math.round(d.ms)} ms (${d.plans} pans)`).join(", "));

// --- comparaison : grille 0,5 m des points « bâtiment » dans les emprises (max et médiane par case) ---
const c = 0.5, n = Math.round(2 * R / c);
const empr = emprises.emprises.map(e => e.anneaux.map(a => a.map(p => [p[0] - origine[0], p[1] - origine[1]])));
const dansEmprise = new Uint8Array(n * n);
for (const A of empr) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of A[0]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  for (let j = Math.max(0, Math.floor((y0 + R) / c)); j <= Math.min(n - 1, Math.floor((y1 + R) / c)); j++)
    for (let i = Math.max(0, Math.floor((x0 + R) / c)); i <= Math.min(n - 1, Math.floor((x1 + R) / c)); i++)
      if (dansAnneaux(A, -R + (i + 0.5) * c, -R + (j + 0.5) * c)) dansEmprise[j * n + i] = 1;
}
const zs = Array.from({ length: n * n }, () => null);
for (let k = 0; k < points.n; k++) {
  if (points.C[k] !== 6) continue;
  const i = Math.floor((points.X[k] + R) / c), j = Math.floor((points.Y[k] + R) / c);
  if (i < 0 || j < 0 || i >= n || j >= n || !dansEmprise[j * n + i]) continue;
  (zs[j * n + i] ||= []).push(points.Z[k]);
}
const Gmax = new Float32Array(n * n).fill(NaN), Gmed = new Float32Array(n * n).fill(NaN);
let nbCases = 0;
for (let p = 0; p < n * n; p++) if (zs[p]) { const v = zs[p].sort((a, b) => a - b); Gmax[p] = v.at(-1); Gmed[p] = v[v.length >> 1]; nbCases++; }

/** Hauteur du toit le plus haut au centre de chaque case (polygones « toit » d'un fichier au format roofer). */
function grilleToits(polygones, [oE, oN]) {
  const H = new Float32Array(n * n).fill(NaN), dx = oE - origine[0], dy = oN - origine[1];
  for (const { t, r } of polygones) {
    if (t !== "toit" || r[0].length < 3) continue;
    const A = r.map(a => a.map(p => [p[0] + dx, p[1] + dy, p[2]]));
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < A[0].length; i++) {
      const a = A[0][i], b = A[0][(i + 1) % A[0].length];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0]; cy += a[1]; cz += a[2];
    }
    if (Math.abs(nz) < 1e-9) continue;
    cx /= A[0].length; cy /= A[0].length; cz /= A[0].length;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of A[0]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    for (let j = Math.max(0, Math.floor((y0 + R) / c)); j <= Math.min(n - 1, Math.floor((y1 + R) / c)); j++)
      for (let i = Math.max(0, Math.floor((x0 + R) / c)); i <= Math.min(n - 1, Math.floor((x1 + R) / c)); i++) {
        const x = -R + (i + 0.5) * c, y = -R + (j + 0.5) * c;
        if (!dansAnneaux(A, x, y)) continue;
        const z = cz - (nx * (x - cx) + ny * (y - cy)) / nz;
        if (!(H[j * n + i] >= z)) H[j * n + i] = z;
      }
  }
  return H;
}
function mesurer(nomJeu, H) {
  const e1 = [], e2 = [];
  let couvert = 0;
  for (let p = 0; p < n * n; p++) {
    if (isNaN(Gmax[p])) continue;
    if (isNaN(H[p])) continue;
    couvert++;
    e1.push(Math.abs(H[p] - Gmed[p])); e2.push(Math.abs(H[p] - Gmax[p]));
  }
  e1.sort((a, b) => a - b); e2.sort((a, b) => a - b);
  console.log(`  ${nomJeu.padEnd(22)} couverture ${(100 * couvert / nbCases).toFixed(1)} % des cases de toit ; |écart| à la médiane des points : médiane ${q(e1, 0.5).toFixed(2)} m, 90e ${q(e1, 0.9).toFixed(2)} m ; au max (grille G.bat) : médiane ${q(e2, 0.5).toFixed(2)} m, 90e ${q(e2, 0.9).toFixed(2)} m ; part < 0,25 m ${(100 * e1.filter(e => e < 0.25).length / e1.length).toFixed(1)} %`);
}
console.log(`\nÉcart de hauteur des toits, cases de 0,5 m avec points « bâtiment » dans les emprises (${nbCases} cases) :`);
mesurer("maison (LoD2+repli)", grilleToits(res.polygones, origine));
try {
  const ref = JSON.parse(readFileSync(new URL(`public/essais/${lieu.roofer}`, racine)));
  mesurer("roofer natif (réf.)", grilleToits(ref.polygones, ref.origine));
} catch (e) { console.log("  (pas de fichier roofer : " + e.message + ")"); }
const t = res.polygones.filter(p => p.t === "toit").length;
console.log(`polygones : ${t} toits, ${res.polygones.length - t} murs`);
if (process.argv.includes("--sortie")) {
  const f = new URL(`public/essais/reconstruction_${nom}.json`, racine);
  writeFileSync(f, enJSON(res));
  console.log("écrit : " + f.pathname);
}
