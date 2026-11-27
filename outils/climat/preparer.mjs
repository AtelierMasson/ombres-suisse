// Repli des données météo de la section Piscine (src/climat.js) : copie, pour une liste de stations SwissMetNet, des
// fichiers horaires de MétéoSuisse (OGD, CC BY, « Source : MétéoSuisse ») dans public/climat/, sous les mêmes noms,
// réduits aux colonnes utiles. Le site ne les lit que si data.geo.admin.ch ne répond pas (réseau, CORS, nom changé).
//
// Usage : node outils/climat/preparer.mjs PUY GVE PAY …   (sans argument : toutes les stations, ~1 Go en entrée)
// À relancer une fois par an (nouvelle année complète). Node 18 ou plus (fetch intégré).
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn";
const GARDER = ["station_abbr", "reference_timestamp", "tre200h0", "tde200h0", "pva200h0", "fkl010h0", "gre000h0", "ods000h0", "oli000h0", "sre000h0", "prestah0"];
const DECENNIES = ["2010-2019", "2020-2029"];
const SORTIE = new URL("../../public/climat/", import.meta.url);

const latin1 = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); };
await mkdir(SORTIE, { recursive: true });
const meta = await latin1(`${BASE}/ogd-smn_meta_stations.csv`);
await writeFile(new URL("ogd-smn_meta_stations.csv", SORTIE), meta);
let stations = process.argv.slice(2).map(s => s.toLowerCase());
if (!stations.length) stations = meta.toString("latin1").trim().split(/\r?\n/).slice(1).map(l => l.split(";")[0].toLowerCase());
for (const st of stations) for (const d of DECENNIES) {
  const nom = `ogd-smn_${st}_h_historical_${d}.csv`;
  try {
    const lignes = (await latin1(`${BASE}/${st}/${nom}`)).toString("latin1").trim().split(/\r?\n/), tete = lignes[0].split(";");
    const idx = GARDER.map(c => tete.indexOf(c));
    const texte = lignes.map(l => { const v = l.split(";"); return idx.map(i => (i >= 0 ? v[i] : "")).join(";"); }).join("\n");
    await writeFile(new URL(nom, SORTIE), Buffer.from(texte.replace(/^[^\n]*/, GARDER.join(";")) + "\n", "latin1"));
    console.log(nom, lignes.length - 1, "heures");
  } catch (e) { console.warn(nom, e.message); }
}
