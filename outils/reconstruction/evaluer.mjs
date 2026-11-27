// Évaluation de la reconstruction « Advanced » (src/reconstruction/) sur un échantillon de bâtiments connus
// (outils/reconstruction/echantillon.json) : pour chaque lieu, reconstruction de toutes les emprises de la boîte,
// mesures par bâtiment (points de toit à moins de 0,3 / 0,5 m du modèle, écart médian, nombre de pans, niveau),
// et, pour les bâtiments de l'échantillon, un fichier de planche (points, pans détectés, polygones, photo aérienne)
// que outils/reconstruction/planches.py met en image.
// Usage : node outils/reconstruction/evaluer.mjs [--src dossier de reconstruction] [--nom avant] [--lieux a,b] [--planches dossier]
//   --src      : autre version du code (copie de src/reconstruction/) pour comparer avant / après
//   --nom      : nom du jeu de mesures, écrit dans <cache>/mesures_<nom>.json
//   --planches : écrit les fichiers <dossier>/<id>.json des bâtiments de l'échantillon
// Cache des téléchargements : variable CACHE_ESSAI (sinon dossier temporaire du système).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { donneesLieu, CACHE } from "./donnees-lieu.mjs";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const ici = new URL(".", import.meta.url).pathname;
const src = resolve(arg("src", join(ici, "../../src/reconstruction")));
const { reconstruire } = await import(pathToFileURL(join(src, "index.js")));
const { detecterPlans } = await import(pathToFileURL(join(src, "plans.js")));
const { dansAnneaux, distanceBord, simplifierAnneau, directionsFacades, aireSignee } = await import(pathToFileURL(join(src, "geometrie.js")));
const echantillon = JSON.parse(readFileSync(arg("echantillon", join(ici, "echantillon.json")), "utf8"));
const seulement = arg("lieux", "") ? arg("lieux").split(",") : null, dossierPlanches = arg("planches", null), nomJeu = arg("nom", "essai");
if (dossierPlanches) mkdirSync(dossierPlanches, { recursive: true });

const q = (v, f) => v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] : NaN;
const a2 = v => Math.round(v * 100) / 100;

/** Plan (Newell) et boîte d'un polygone de toit { r: [anneaux [x, y, z]] } ; null s'il est vertical. */
function planToit(r) {
  const A = r[0];
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    cx += a[0]; cy += a[1]; cz += a[2];
    x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); y0 = Math.min(y0, a[1]); y1 = Math.max(y1, a[1]);
  }
  if (Math.abs(nz) < 1e-9) return null;
  cx /= A.length; cy /= A.length; cz /= A.length;
  return { r, x0, y0, x1, y1, z: (x, y) => cz - (nx * (x - cx) + ny * (y - cy)) / nz, pente: Math.hypot(nx, ny) / Math.abs(nz), aire: Math.abs(nz) / 2 };
}

/** Mesures d'un bâtiment : points « bâtiment » de l'emprise contre les toits du modèle. */
function mesurer(anneaux, P, toits) {
  const T = toits.map(t => planToit(t.r)).filter(Boolean), e = [], dz = new Float32Array(P.n).fill(NaN);
  let sans = 0;
  for (let k = 0; k < P.n; k++) {
    let z = -Infinity;
    for (const t of T) {
      if (P.x[k] < t.x0 || P.x[k] > t.x1 || P.y[k] < t.y0 || P.y[k] > t.y1 || !dansAnneaux(t.r, P.x[k], P.y[k])) continue;
      z = Math.max(z, t.z(P.x[k], P.y[k]));
    }
    if (z === -Infinity) { sans++; continue; }
    dz[k] = z - P.z[k]; e.push(dz[k]);
  }
  const abs = e.map(Math.abs).sort((u, v) => u - v), signe = e.slice().sort((u, v) => u - v);
  return {
    n: P.n, p03: P.n ? abs.filter(v => v < 0.3).length / P.n : NaN, p05: P.n ? abs.filter(v => v < 0.5).length / P.n : NaN,
    mediane: q(abs, 0.5), c90: q(abs, 0.9), biais: q(signe, 0.5), sansToit: P.n ? sans / P.n : NaN, dz,
    toits: T.length, plats: T.filter(t => t.pente < 0.03).length,
  };
}

const lieux = new Map();
for (const b of echantillon.batiments) {
  const idLieu = b.lieu || b.id, L = echantillon.lieux?.[idLieu] || { E: b.E, N: b.N, R: b.R || 80 };
  if (!lieux.has(idLieu)) lieux.set(idLieu, { id: idLieu, ...L, cibles: [] });
  lieux.get(idLieu).cibles.push(b);
}
for (const [id, L] of Object.entries(echantillon.lieux || {})) if (!lieux.has(id) && L.toujours) lieux.set(id, { id, ...L, cibles: [] });

const tous = [], cibles = [], temps = [];
for (const L of lieux.values()) {
  if (seulement && !seulement.includes(L.id)) continue;
  let d;
  try { d = await donneesLieu(L); } catch (e) { d = { erreur: e.message }; }
  if (d.erreur) { console.log(`${L.id} : ${d.erreur}`); for (const b of L.cibles) cibles.push({ id: b.id, nom: b.nom, erreur: d.erreur }); continue; }
  const { origine, boite, points, emprises } = d;
  let res;
  for (let k = 0; k < 2; k++) { const r = reconstruire({ points, origine, emprises: emprises.emprises, source: emprises.source, options: { boite } }); if (!res || r.ms < res.ms) res = r; }
  temps.push({ lieu: L.id, ms: res.ms, emprises: res.details.length, points: points.n });
  // points « bâtiment » par emprise (grille de recherche simple)
  const pas = 4, R = L.R, ng = Math.ceil(2 * R / pas), cases = Array.from({ length: ng * ng }, () => []);
  for (let k = 0; k < points.n; k++) if (points.C[k] === 6) {
    const i = Math.floor((points.X[k] + R) / pas), j = Math.floor((points.Y[k] + R) / pas);
    if (i >= 0 && j >= 0 && i < ng && j < ng) cases[j * ng + i].push(k);
  }
  const parId = new Map(emprises.emprises.map(e => [e.id, e]));
  const fiches = [];
  for (const det of res.details) {
    const e = parId.get(det.id), anneaux = e.anneaux.map(a => a.map(p => [p[0] - origine[0], p[1] - origine[1]]));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of anneaux[0]) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const entier = x0 >= -R && y0 >= -R && x1 <= R && y1 <= R; // emprise entièrement dans la boîte du nuage
    const px = [], py = [], pz = [];
    for (let j = Math.max(0, Math.floor((y0 + R) / pas)); j <= Math.min(ng - 1, Math.floor((y1 + R) / pas)); j++)
      for (let i = Math.max(0, Math.floor((x0 + R) / pas)); i <= Math.min(ng - 1, Math.floor((x1 + R) / pas)); i++)
        for (const k of cases[j * ng + i]) if (dansAnneaux(anneaux, points.X[k], points.Y[k])) { px.push(points.X[k]); py.push(points.Y[k]); pz.push(points.Z[k]); }
    const P = { x: px, y: py, z: pz, n: px.length };
    const polygones = res.polygones.slice(det.debut, det.debut + det.nb), toits = polygones.filter(p => p.t === "toit");
    const m = mesurer(anneaux, P, toits);
    // pans détectés (mêmes points et mêmes directions que reconstruireBatiment) et cause des écarts de plus de 0,3 m
    const simples = anneaux.map(a => simplifierAnneau(a, 0.2)).filter((a, k) => a.length >= 3 && (k === 0 || Math.abs(aireSignee(a)) > 2));
    let etiquette = new Int32Array(P.n).fill(-1), plans = [];
    if (P.n >= 10 && simples.length) try { ({ etiquette, plans } = detecterPlans({ x: Float64Array.from(px), y: Float64Array.from(py), z: Float64Array.from(pz), n: P.n }, directionsFacades(simples))); } catch { /* version incompatible */ }
    const causes = { bord: 0, sansPanHaut: 0, sansPanBas: 0, panEcarte: 0, panInexact: 0, sansToit: 0 };
    for (let k = 0; k < P.n; k++) {
      if (Math.abs(m.dz[k]) < 0.3) continue;
      const e = etiquette[k];
      if (Number.isNaN(m.dz[k])) causes.sansToit++;
      else if (distanceBord(anneaux, px[k], py[k]) < 1) causes.bord++;
      else if (e < 0) causes[m.dz[k] < 0 ? "sansPanHaut" : "sansPanBas"]++;
      else if (Math.abs(pz[k] - plans[e].a * px[k] - plans[e].b * py[k] - plans[e].c) < 0.3) causes.panEcarte++;
      else causes.panInexact++;
    }
    const f = { lieu: L.id, id: det.id, niveau: det.niveau, motif: det.motif || "", plans: det.plans || 0, ms: det.ms, entier, aire: Math.abs(aireSignee(anneaux[0])), ...m, causes };
    fiches.push({ f, anneaux, P, polygones, zSol: det.zSol, boiteE: [x0, y0, x1, y1], etiquette, pans: plans });
    const { dz, ...sansDz } = f;
    tous.push(sansDz);
  }
  // bâtiments de l'échantillon : emprise qui contient le point (sinon la plus proche)
  for (const b of L.cibles) {
    const x = b.E - origine[0], y = b.N - origine[1];
    let F = fiches.filter(F => dansAnneaux(F.anneaux, x, y)).sort((u, v) => v.f.aire - u.f.aire)[0];
    if (!F) F = fiches.map(F => [distanceBord(F.anneaux, x, y), F]).sort((u, v) => u[0] - v[0])[0]?.[1];
    if (!F) { cibles.push({ id: b.id, nom: b.nom, erreur: "aucune emprise" }); continue; }
    const { dz, ...f } = F.f;
    cibles.push({ ...b, ...f, idEmprise: F.f.id, id: b.id });
    if (!dossierPlanches) continue;
    const { etiquette, pans: plans } = F;
    const pasPt = Math.max(1, Math.ceil(F.P.n / 150000)), pts = [];
    for (let k = 0; k < F.P.n; k += pasPt) pts.push([a2(F.P.x[k]), a2(F.P.y[k]), a2(F.P.z[k]), etiquette[k], Number.isNaN(dz[k]) ? null : a2(dz[k])]);
    // sol et autres classes autour (contexte de la planche) : non
    writeFileSync(join(dossierPlanches, b.id + ".json"), JSON.stringify({
      ...b, ...f, idEmprise: F.f.id, id: b.id, origine, boiteLieu: boite, photo: d.photo, annee: d.annee, source: emprises.source,
      anneaux: F.anneaux, zSol: F.zSol, points: pts, pansDetectes: plans.map(p => ({ a: p.a, b: p.b, c: p.c, n: p.n })),
      polygones: F.polygones, voisins: fiches.filter(G => G !== F && G.boiteE[0] < F.boiteE[2] + 15 && G.boiteE[2] > F.boiteE[0] - 15 && G.boiteE[1] < F.boiteE[3] + 15 && G.boiteE[3] > F.boiteE[1] - 15).map(G => G.anneaux),
    }));
  }
  console.log(`${L.id} : ${res.details.length} emprises, ${Math.round(res.ms)} ms`);
}

// --- résumé ---
const pc = v => (100 * v).toFixed(1).padStart(5);
console.log("\nBâtiments de l'échantillon :");
console.log("id".padEnd(26) + "niveau  pans toits  n pts   <0,3   <0,5  méd.   biais  sans  ms");
for (const c of cibles) {
  if (c.erreur) { console.log(c.id.padEnd(26) + c.erreur); continue; }
  console.log(c.id.padEnd(26) + String(c.niveau).padEnd(7) + String(c.plans).padStart(4) + String(c.toits).padStart(6) + String(c.n).padStart(7) + pc(c.p03) + "  " + pc(c.p05) + "  " + c.mediane.toFixed(2) + "  " + (c.biais >= 0 ? "+" : "") + c.biais.toFixed(2) + " " + pc(c.sansToit) + " " + Math.round(c.ms));
}
function resume(nom, F) {
  F = F.filter(f => f.n >= 30);
  if (!F.length) return null;
  const N = F.reduce((s, f) => s + f.n, 0), moy = k => F.reduce((s, f) => s + f[k] * f.n, 0) / N, med = k => q(F.map(f => f[k]).sort((u, v) => u - v), 0.5);
  const r = { nb: F.length, lod2: F.filter(f => f.niveau === "LoD2").length / F.length, p03: moy("p03"), p05: moy("p05"), p03med: med("p03"), p05med: med("p05"), mediane: med("mediane"), toits: F.reduce((s, f) => s + f.toits, 0) / F.length };
  console.log(`${nom.padEnd(28)} ${String(r.nb).padStart(5)} bât. ; LoD2 ${pc(r.lod2)} % ; points < 0,3 m ${pc(r.p03)} % ; < 0,5 m ${pc(r.p05)} % (pondéré) ; par bâtiment (médiane) < 0,3 m ${pc(r.p03med)} %, < 0,5 m ${pc(r.p05med)} %, écart médian ${r.mediane.toFixed(2)} m ; ${r.toits.toFixed(1)} toits/bât.`);
  return r;
}
console.log("\nEnsemble :");
const R = {
  cibles: resume("échantillon", cibles.filter(c => !c.erreur)),
  tous: resume("toutes les emprises entières", tous.filter(f => f.entier)),
  petits: resume("  emprises < 60 m²", tous.filter(f => f.entier && f.aire < 60)),
  moyens: resume("  emprises 60–400 m²", tous.filter(f => f.entier && f.aire >= 60 && f.aire < 400)),
  grands: resume("  emprises ≥ 400 m²", tous.filter(f => f.entier && f.aire >= 400)),
};
const msTotal = temps.reduce((s, t) => s + t.ms, 0), nbE = temps.reduce((s, t) => s + t.emprises, 0);
console.log(`temps : ${Math.round(msTotal)} ms pour ${nbE} emprises (${(msTotal / nbE * 200 / 1000).toFixed(2)} s pour 200 emprises)`);
// causes des écarts de plus de 0,3 m (part de tous les points de toit des emprises entières)
{
  const F = tous.filter(f => f.entier && f.n >= 30), N = F.reduce((s, f) => s + f.n, 0), noms = {
    bord: "à moins de 1 m du bord de l'emprise (façades, avant-toits, mitoyens)", sansPanHaut: "sans pan, au-dessus du modèle (superstructures, pans non détectés)",
    sansPanBas: "sans pan, sous le modèle (niveaux inférieurs, verrières, façades intérieures)", panEcarte: "sur un pan détecté mais le modèle en place un autre (carte des pans, partition)",
    panInexact: "sur un pan détecté qui s'en écarte (toits courbes, pans fusionnés ou régularisés)", sansToit: "aucun toit du modèle sous le point" };
  R.causes = {};
  console.log("causes des écarts ≥ 0,3 m (part des points de toit) :");
  for (const k of Object.keys(noms)) { R.causes[k] = F.reduce((s, f) => s + f.causes[k], 0) / N; console.log(`  ${pc(R.causes[k])} %  ${noms[k]}`); }
}
const motifs = new Map();
for (const f of tous) if (f.niveau !== "LoD2") { const m = (f.niveau || "rien") + " — " + f.motif.replace(/\(.*\)/, "").trim(); motifs.set(m, (motifs.get(m) || 0) + 1); }
console.log("replis : " + [...motifs].sort((u, v) => v[1] - u[1]).map(([m, n]) => `${m} : ${n}`).join(" ; "));
const fichier = join(CACHE, `mesures_${nomJeu}.json`);
writeFileSync(fichier, JSON.stringify({ src, resume: R, msTotal, nbEmprises: nbE, temps, cibles, tous }));
console.log("écrit : " + fichier);
