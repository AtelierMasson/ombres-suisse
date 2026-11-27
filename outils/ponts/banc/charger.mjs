// node charger.mjs <site…> : télécharge le nuage d'un site comme le fait l'application (parcelle, centre, densité,
// disque de 303 m) et le garde en cache (binaire + JSON). Usage interne : import { nuageSite } from "./charger.mjs".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Copc } from "copc";
import { createLazPerf } from "laz-perf";
import { SITES, CACHE, PROJET } from "./sites.mjs";
const { parcelleEn, tuilesNuage } = await import(PROJET + "/src/geo.js");

const RMAX = 300;
async function telecharger(site) {
  const { e: E, n: N } = site;
  const parcelle = site.sansParcelle ? null : await parcelleEn(E, N).catch(() => null);
  let E0 = E, N0 = N, coeur;
  if (parcelle) {
    const xs = parcelle.anneaux.flat().map(p => p[0]), ys = parcelle.anneaux.flat().map(p => p[1]);
    E0 = (Math.min(...xs) + Math.max(...xs)) / 2; N0 = (Math.min(...ys) + Math.max(...ys)) / 2;
    coeur = [Math.min(...xs) - 40, Math.min(...ys) - 40, Math.max(...xs) + 40, Math.max(...ys) + 40];
  }
  E0 = Math.round(E0); N0 = Math.round(N0);
  coeur ||= [E0 - 60, N0 - 60, E0 + 60, N0 + 60];
  const R = RMAX, boite = [E0 - R, N0 - R, E0 + R, N0 + R], cercle = { E: E0, N: N0, R: R + 3 };
  const tuiles = await tuilesNuage(boite);
  if (!tuiles) throw new Error("pas de nuage COPC");
  const coupe = (b, [a0, b0, a1, b1]) => b[0] < a1 && b[2] > a0 && b[1] < b1 && b[3] > b0;
  const lazPerf = await createLazPerf(), taches = [];
  for (const t of tuiles) {
    const copc = await Copc.create(t.url), cube = copc.info.cube, cote = cube[3] - cube[0];
    const profMax = Math.max(0, Math.ceil(Math.log2(copc.info.spacing / 0.5)));
    const boiteNoeud = k => { const [d, x, y] = k.split("-").map(Number), s = cote / 2 ** d, x0 = cube[0] + x * s, y0 = cube[1] + y * s; return [x0, y0, x0 + s, y0 + s]; };
    const dansCercle = b => Math.hypot(Math.max(b[0] - cercle.E, 0, cercle.E - b[2]), Math.max(b[1] - cercle.N, 0, cercle.N - b[3])) <= cercle.R;
    const niveauMax = bn => coupe(bn, coeur) ? profMax : profMax - 1; // densité « équilibrée » (niveau 1)
    const garder = k => { const b = boiteNoeud(k); return coupe(b, boite) && dansCercle(b) && +k.split("-")[0] <= niveauMax(b); };
    const pages = [copc.info.rootHierarchyPage];
    while (pages.length) {
      const { nodes, pages: sous } = await Copc.loadHierarchyPage(t.url, pages.pop());
      for (const [k, n] of Object.entries(nodes)) if (n && n.pointCount && garder(k)) taches.push({ url: t.url, copc, n });
      for (const [k, p] of Object.entries(sous)) if (+k.split("-")[0] <= profMax && coupe(boiteNoeud(k), boite) && dansCercle(boiteNoeud(k))) pages.push(p);
    }
  }
  const total = taches.reduce((s, t) => s + t.n.pointCount, 0);
  const X = new Float32Array(total), Y = new Float32Array(total), Z = new Float32Array(total), C = new Uint8Array(total);
  let n = 0, suivante = 0;
  const fil = async () => {
    while (suivante < taches.length) {
      const { url, copc, n: noeud } = taches[suivante++];
      let v;
      for (let essai = 0; ; essai++) { try { v = await Copc.loadPointDataView(url, copc, noeud, { lazPerf, include: ["X", "Y", "Z", "Classification"] }); break; } catch (e) { if (essai >= 3) throw e; await new Promise(r => setTimeout(r, 500)); } }
      const gx = v.getter("X"), gy = v.getter("Y"), gz = v.getter("Z"), gc = v.getter("Classification");
      for (let i = 0; i < v.pointCount; i++) {
        const x = gx(i), y = gy(i);
        if (x < boite[0] || x >= boite[2] || y < boite[1] || y >= boite[3]) continue;
        if ((x - cercle.E) ** 2 + (y - cercle.N) ** 2 > cercle.R * cercle.R) continue;
        X[n] = x - E0; Y[n] = y - N0; Z[n] = gz(i); C[n] = gc(i); n++;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, fil));
  return { meta: { E0, N0, R, n, parcelle: parcelle ? { numero: parcelle.numero, canton: parcelle.canton } : null, annees: tuiles.map(t => t.annee) }, X: X.slice(0, n), Y: Y.slice(0, n), Z: Z.slice(0, n), C: C.slice(0, n) };
}

/** Nuage d'un site (cache sur disque) : { meta: { E0, N0, R, n }, X, Y, Z, C, n }. */
export async function nuageSite(nom, site = SITES[nom]) {
  mkdirSync(CACHE, { recursive: true });
  const fB = `${CACHE}/${nom}.bin`, fJ = `${CACHE}/${nom}.json`;
  if (!existsSync(fB) || !existsSync(fJ)) {
    const d = await telecharger(site);
    writeFileSync(fB, Buffer.concat([Buffer.from(d.X.buffer), Buffer.from(d.Y.buffer), Buffer.from(d.Z.buffer), Buffer.from(d.C.buffer)]));
    writeFileSync(fJ, JSON.stringify(d.meta));
  }
  const meta = JSON.parse(readFileSync(fJ, "utf8")), b = readFileSync(fB), n = meta.n;
  const f32 = k => new Float32Array(b.buffer.slice(b.byteOffset + 4 * n * k, b.byteOffset + 4 * n * (k + 1)));
  return { meta, X: f32(0), Y: f32(1), Z: f32(2), C: new Uint8Array(b.buffer.slice(b.byteOffset + 12 * n, b.byteOffset + 13 * n)), n };
}

if (process.argv[1].endsWith("charger.mjs")) {
  for (const nom of process.argv.slice(2)) {
    const t0 = Date.now();
    try { const d = await nuageSite(nom); const cl = {}; for (let k = 0; k < d.n; k++) cl[d.C[k]] = (cl[d.C[k]] || 0) + 1; console.log(nom, JSON.stringify(d.meta), ((Date.now() - t0) / 1000).toFixed(0) + " s", JSON.stringify(cl)); }
    catch (e) { console.log(nom, "ERREUR", e.message); }
  }
}
