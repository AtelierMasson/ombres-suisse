// Données météo horaires de MétéoSuisse (Open Government Data, SwissMetNet, licence CC BY, « Source : MétéoSuisse »),
// lues directement depuis le navigateur : data.geo.admin.ch sert les fichiers avec Access-Control-Allow-Origin: *
// (vérifié le 27.11.2026). Un fichier CSV (séparateur « ; ») par station et par décennie ; on lit 2010-2019 et
// 2020-2029 (≈ 11 + 7 Mo pour Pully), années complètes seulement.
//
// Repli : si MétéoSuisse ne répond pas (réseau, CORS, nom de fichier changé), on lit les mêmes fichiers depuis notre
// serveur, sous /climat/ (préparés par outils/climat/preparer.mjs, mêmes noms, colonnes utiles seulement). Si aucun
// des deux ne répond, la température de l'eau n'est pas estimée et l'interface le dit.
//
// Horodatage : `reference_timestamp` en UTC, à la FIN de l'intervalle horaire (vérifié sur le profil moyen du
// rayonnement de Pully en juin–juillet, centré sur 11 h 37 UTC = midi solaire). L'heure « 12:00 » couvre 11–12 h UTC.

const BASE = "https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn";
const REPLI = "/climat";
const COLONNES = ["tre200h0", "tde200h0", "pva200h0", "fkl010h0", "gre000h0", "ods000h0", "oli000h0", "sre000h0", "prestah0"];
const DECENNIES = ["2010-2019", "2020-2029"];

let stations = null;
/** Liste des stations SwissMetNet : { abr, nom, E, N, alt }. */
export async function listeStations() {
  if (stations) return stations;
  const texte = await lire("ogd-smn_meta_stations.csv");
  const [tete, ...lignes] = texte.trim().split(/\r?\n/), c = tete.split(";");
  const k = n => c.indexOf(n);
  stations = lignes.map(l => l.split(";")).map(v => ({
    abr: v[k("station_abbr")], nom: v[k("station_name")], E: +v[k("station_coordinates_lv95_east")], N: +v[k("station_coordinates_lv95_north")],
    alt: +v[k("station_height_masl")],
  })).filter(s => s.abr && Number.isFinite(s.E) && Number.isFinite(s.alt));
  return stations;
}

/**
 * Stations classées pour un lieu : score = distance + dénivelé (100 m de dénivelé comptent comme 10 km).
 * @returns {{ abr, nom, E, N, alt, km, denivele }[]}
 */
export async function stationsProches(E, N, alt) {
  return (await listeStations()).map(s => ({ ...s, km: Math.hypot(s.E - E, s.N - N) / 1000, denivele: s.alt - alt }))
    .map(s => ({ ...s, score: s.km + Math.abs(s.denivele) / 10 })).sort((a, b) => a.score - b.score);
}

async function lire(chemin) {
  // le CSV de MétéoSuisse est en Latin-1 (noms de stations accentués)
  const essai = async url => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    return new TextDecoder("latin1").decode(await r.arrayBuffer());
  };
  try { return await essai(`${BASE}/${chemin}`); } catch (e1) {
    try { return await essai(`${REPLI}/${chemin.split("/").pop()}`); } catch { throw new Error(`MétéoSuisse : ${chemin} (${e1.message})`); }
  }
}

/** Date « jj.mm.aaaa hh:mm » (UTC) → millisecondes. */
const instant = s => Date.UTC(+s.slice(6, 10), +s.slice(3, 5) - 1, +s.slice(0, 2), +s.slice(11, 13), +s.slice(14, 16));

const cache = new Map();
/**
 * Séries horaires d'une station, par année complète (au moins 90 % des heures d'avril à septembre avec température et
 * rayonnement) : Map(an → { debut (ms, début de la première heure), T, Td, ea (Pa), V (m/s, 10 m), G, D (W/m²),
 *   L (W/m² ou NaN), soleil (0–1, part de l'heure ensoleillée), p (Pa) }), tableaux de 8760/8784 valeurs.
 */
export function seriesStation(abr, onProgres = () => {}) {
  const cle = abr.toLowerCase();
  if (!cache.has(cle)) cache.set(cle, (async () => {
    const annees = new Map();
    let fait = 0;
    const textes = await Promise.all(DECENNIES.map(d => lire(`${cle}/ogd-smn_${cle}_h_historical_${d}.csv`).catch(() => null)
      .finally(() => onProgres(++fait / DECENNIES.length))));
    for (const texte of textes) if (texte) analyser(texte, annees);
    // années complètes seulement (la saison de baignade doit y être presque entière)
    for (const [an, A] of annees) {
      const d0 = (Date.UTC(an, 3, 1) - A.debut) / 3600000, d1 = (Date.UTC(an, 9, 1) - A.debut) / 3600000;
      let ok = 0;
      for (let h = d0; h < d1; h++) if (!isNaN(A.T[h]) && !isNaN(A.G[h])) ok++;
      if (ok < 0.9 * (d1 - d0)) annees.delete(an); else combler(A);
    }
    if (!annees.size) throw new Error("aucune année complète");
    return annees;
  })());
  const p = cache.get(cle);
  p.catch(() => cache.delete(cle));
  return p;
}

function analyser(texte, annees) {
  const fin = texte.indexOf("\n"), tete = texte.slice(0, fin).trim().split(";"), idx = COLONNES.map(c => tete.indexOf(c)), iT = tete.indexOf("reference_timestamp");
  let pos = fin + 1;
  while (pos < texte.length) {
    let e = texte.indexOf("\n", pos);
    if (e < 0) e = texte.length;
    const v = texte.slice(pos, e).split(";");
    pos = e + 1;
    if (v.length < 3) continue;
    const t = instant(v[iT]) - 3600000; // début de l'heure
    const an = new Date(t).getUTCFullYear();
    let A = annees.get(an);
    if (!A) {
      const n = (Date.UTC(an + 1, 0, 1) - Date.UTC(an, 0, 1)) / 3600000, nan = () => new Float32Array(n).fill(NaN);
      A = { debut: Date.UTC(an, 0, 1), n, T: nan(), Td: nan(), ea: nan(), V: nan(), G: nan(), D: nan(), L: nan(), soleil: nan(), p: nan() };
      annees.set(an, A);
    }
    const h = (t - A.debut) / 3600000;
    const val = k => { const s = idx[k] >= 0 ? v[idx[k]] : ""; return s === "" || s === undefined ? NaN : +s; };
    A.T[h] = val(0); A.Td[h] = val(1); A.ea[h] = val(2) * 100; A.V[h] = val(3); A.G[h] = Math.max(0, val(4)); A.D[h] = Math.max(0, val(5));
    A.L[h] = val(6); A.soleil[h] = Math.min(1, Math.max(0, val(7) / 60)); A.p[h] = val(8) * 100;
  }
}

/** Trous comblés par la dernière valeur connue (puis la suivante au début) ; rayonnement et soleil à 0 la nuit. */
function combler(A) {
  for (const k of ["T", "Td", "ea", "V", "G", "D", "soleil", "p"]) {
    const a = A[k];
    let der = NaN;
    for (let h = 0; h < a.length; h++) if (isNaN(a[h])) a[h] = der; else der = a[h];
    let suiv = NaN;
    for (let h = a.length - 1; h >= 0; h--) if (isNaN(a[h])) a[h] = suiv; else suiv = a[h];
  }
}
