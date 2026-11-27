// Index des tuiles kilométriques swisstopo (F1 de docs/chargement-paysage-plan.md) : pour chaque jeu utile au site,
// l'année la plus récente de chaque tuile « E-N », et le gabarit de l'adresse du fichier. Le site le lit à la place
// du catalogue STAC (src/geo.js, tuilesJeu) : plus de requête STAC par lieu, adresses connues d'avance.
//
//   node outils/index_tuiles.mjs [--boite e0,n0,e1,n1] [--chromium] [--sortie public/donnees/tuiles-v1.json]
//
// --boite : seulement cette boîte MN95 (essai) ; sans elle, toute la Suisse (~1000 pages STAC par collection, en
//   série, une requête à la fois : ~15 min ; à lancer une fois par mois, hors des heures de pointe).
// --chromium : requêtes faites par Chromium (Playwright) quand Node n'a pas d'accès direct au réseau.
// Format (version 1) : jeux[jeu] = { gabarit, lignes: { E: [N0, a(N0), a(N0+1), …] }, exceptions: { "E-N": url } },
// a = année − 2000 (0 = pas de tuile). Gabarit : {a} = année, {k} = « E-N ».
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const STAC = "https://data.geo.admin.ch/api/stac/v1/collections";
const JEUX = {
  copc: ["ch.swisstopo.swisssurface3d", h => /copc/.test(h)],
  alti2m: ["ch.swisstopo.swissalti3d", h => /_2_2056_5728\.tif$/.test(h)],
  alti05: ["ch.swisstopo.swissalti3d", h => /_0\.5_2056_5728\.tif$/.test(h)],
  surface05: ["ch.swisstopo.swisssurface3d-raster", h => /_0\.5_2056_5728\.tif$/.test(h)],
};
const arg = (nom, defaut) => { const i = process.argv.indexOf(nom); return i < 0 ? defaut : process.argv[i + 1]; };
const boite = arg("--boite", null)?.split(",").map(Number);
const sortie = arg("--sortie", "public/donnees/tuiles-v1.json");

// MN95 -> WGS84 (formules approchées de swisstopo, comme src/geo.js)
function versWgs(E, N) {
  const y = (E - 2600000) / 1e6, x = (N - 1200000) / 1e6;
  const lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3;
  const lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x ** 3;
  return [lon * 100 / 36, lat * 100 / 36];
}

// lecture JSON : Node directement, ou Chromium (--chromium)
let lire = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
let navigateur = null;
if (process.argv.includes("--chromium")) {
  const { chromium } = createRequire(import.meta.url)("playwright");
  navigateur = await chromium.launch();
  const page = await navigateur.newPage();
  await page.goto("about:blank");
  lire = u => page.evaluate(async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); }, u);
}
const pause = ms => new Promise(r => setTimeout(r, ms));
async function lireRetente(u) {
  for (let k = 0; ; k++) {
    try { return await lire(u); } catch (e) { if (k >= 4) throw e; await pause(1000 * 2 ** k); } // 429 ou panne : on patiente
  }
}

/** Toutes les tuiles (toutes années) d'une collection : Map « E-N » -> [{ annee, hrefs }]. */
async function collection(nom) {
  let u = `${STAC}/${nom}/items?limit=100`;
  if (boite) { const [a, b] = versWgs(boite[0], boite[1]), [c, d] = versWgs(boite[2], boite[3]); u += `&bbox=${a},${b},${c},${d}`; }
  const m = new Map();
  for (let page = 0; u; page++) {
    const d = await lireRetente(u);
    for (const f of d.features || []) {
      const k = f.id.split("_").pop(), annee = +f.id.split("_")[1];
      if (!/^\d{4}-\d{4}$/.test(k) || !annee) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push({ annee, hrefs: Object.values(f.assets).map(a => a.href) });
    }
    u = (d.links || []).find(l => l.rel === "next")?.href;
    if (page % 50 === 49) process.stdout.write(`  ${nom} : ${page + 1} pages, ${m.size} tuiles\n`);
    await pause(150); // une requête à la fois, sans presser le service
  }
  return m;
}

const index = { version: 1, date: new Date().toISOString().slice(0, 10), boite: boite || null, jeux: {} };
const parCollection = new Map();
for (const [jeu, [nom, motif]] of Object.entries(JEUX)) {
  if (!parCollection.has(nom)) { console.log(`STAC ${nom}…`); parCollection.set(nom, await collection(nom)); }
  // tuile -> fichier le plus récent qui répond au motif
  const choix = new Map();
  for (const [k, liste] of parCollection.get(nom)) {
    let meilleur = null;
    for (const { annee, hrefs } of liste) { const h = hrefs.find(motif); if (h && (!meilleur || annee > meilleur.annee)) meilleur = { annee, h }; }
    if (meilleur) choix.set(k, meilleur);
  }
  // gabarit le plus fréquent ; les autres adresses en exceptions
  const gabarits = new Map();
  for (const [k, { annee, h }] of choix) { const g = h.replaceAll(String(annee), "{a}").replaceAll(k, "{k}"); gabarits.set(g, (gabarits.get(g) || 0) + 1); }
  const gabarit = [...gabarits].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const lignes = {}, exceptions = {};
  for (const [k, { annee, h }] of choix) {
    const [e, n] = k.split("-").map(Number);
    if (gabarit.replaceAll("{a}", annee).replaceAll("{k}", k) !== h) exceptions[k] = h.replaceAll(String(annee), "{a}").replaceAll(k, "{k}");
    (lignes[e] ||= new Map()).set(n, annee - 2000);
  }
  for (const e of Object.keys(lignes)) {
    const ns = [...lignes[e].keys()], n0 = Math.min(...ns), n1 = Math.max(...ns), l = [n0];
    for (let n = n0; n <= n1; n++) l.push(lignes[e].get(n) || 0);
    lignes[e] = l;
  }
  index.jeux[jeu] = { collection: nom, gabarit, lignes, exceptions, tuiles: choix.size };
  console.log(`${jeu} : ${choix.size} tuiles, ${Object.keys(exceptions).length} exceptions, gabarit ${gabarit}`);
}
await navigateur?.close();
mkdirSync(dirname(sortie), { recursive: true });
writeFileSync(sortie, JSON.stringify(index));
console.log(`écrit : ${sortie} (${(JSON.stringify(index).length / 1024).toFixed(0)} Ko)`);
