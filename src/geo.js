// Services fédéraux geo.admin.ch : recherche, parcelle, catalogue STAC des données swisstopo (fonds de plan : fond.js).
// Toutes les coordonnées internes sont en MN95 (EPSG:2056) : E (est), N (nord), en mètres.

const API = "https://api3.geo.admin.ch/rest/services";
const STAC = "https://data.geo.admin.ch/api/stac/v1/collections";

/** MN95 -> WGS84 (formules approchées de swisstopo, précision ~1 m). */
export function versWgs(E, N) {
  const y = (E - 2600000) / 1e6, x = (N - 1200000) / 1e6;
  const lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3;
  const lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x ** 3;
  return [lon * 100 / 36, lat * 100 / 36];
}

// lieux notables (cathédrales, hôtels de ville, ponts, châteaux, gares, musées…) : liste interne tirée d'OpenStreetMap
// (outils/lieux/extraire_osm.py), servie avec le site et chargée à la première recherche (~150 Ko compressée)
const normaliser = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
let lieux = null;
const listeLieux = () => lieux ||= fetch(`${import.meta.env.BASE_URL}lieux/lieux-ch.json`).then(r => r.ok ? r.json() : { lieux: [] })
  .then(d => d.lieux.map(([nom, type, E, N, loc = "", autres = []]) => ({ nom, type, E, N, loc, cle: normaliser([nom, ...autres].join(" | ")), cleLoc: normaliser(loc) })))
  .catch(() => []);
async function chercherLieux(texte) {
  const mots = normaliser(texte).split(/[\s,]+/).filter(m => m.length > 1);
  if (!mots.length) return [];
  const L = await listeLieux(), r = [];
  for (const l of L) {
    // chaque mot doit être dans le nom (ou un autre nom) ou dans la localité ; le nom compte plus que la localité
    let score = 0, ok = true;
    for (const m of mots) {
      if (l.cle.includes(m)) score += l.cle.startsWith(m) || l.cle.includes(" " + m) ? 3 : 2;
      else if (l.cleLoc.includes(m)) score += 1;
      else { ok = false; break; }
    }
    if (ok) r.push([score, l]);
  }
  r.sort((a, b) => b[0] - a[0] || a[1].nom.length - b[1].nom.length);
  return r.slice(0, 5).map(([, l]) => ({ label: l.loc && !normaliser(l.nom).includes(l.cleLoc) ? `${l.nom}, ${l.loc}` : l.nom, type: "Lieu", E: l.E, N: l.N }));
}

/** Adresses, parcelles et lieux de toute la Suisse. */
export async function chercher(texte, signal) {
  // coordonnées tapées (GPS en degrés décimaux ou degrés-minutes-secondes, MN95, MN03) : le lieu directement
  const c = lireCoordonnees(texte);
  if (c) return [{ label: c.label, type: "Coordonnées", E: c.E, N: c.N }];
  // adresses et parcelles, plus les noms de swisstopo (swissNAMES3D : rues et ponts nommés, sites historiques, écoles…)
  const u = `${API}/api/SearchServer?type=locations&origins=address,parcel,gazetteer&sr=2056&limit=10&searchText=${encodeURIComponent(texte)}`;
  const [d, L] = await Promise.all([fetch(u, { signal }).then(r => r.json()), chercherLieux(texte).catch(() => [])]);
  const officiels = (d.results || [])
    // noms de swisstopo : seulement les objets précis (pas les régions, cantons, communes entières, lieux-dits)
    .filter(r => r.attrs.origin !== "gazetteer" || /<i>(Strasse|Historisches Areal|Schul- und Hochschulareal|Spital|Sportanlage|Gebäude|Kirche|Schloss|Turm|Brücke|Denkmal|Museum|Bahnhof|Friedhof|Kloster|Burg|Ruine)/.test(r.attrs.label))
    .map(r => ({
      label: r.attrs.label.replace(/<i>[^<]*<\/i>\s*/g, "").replace(/<[^>]+>/g, "").trim(),
      type: r.attrs.origin === "parcel" ? "Parcelle" : r.attrs.origin === "address" ? "Adresse" : "Lieu",
      E: r.attrs.y, N: r.attrs.x,
    }));
  // une adresse tapée (avec un numéro) passe d'abord ; sinon les lieux notables d'abord
  const adresse = /\d/.test(texte), vus = new Set(), tous = adresse ? [...officiels, ...L] : [...L, ...officiels];
  return tous.filter(r => { const k = r.label.toLowerCase(); if (vus.has(k)) return false; vus.add(k); return true; }).slice(0, 10);
}

/** WGS84 (degrés) -> MN95, formules approchées de swisstopo (précision ~1 m). */
export function versMn95(lon, lat) {
  const p = (lat * 3600 - 169028.66) / 10000, l = (lon * 3600 - 26782.5) / 10000;
  return [2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3,
    1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3];
}

/**
 * Coordonnées dans un texte de recherche, ou null :
 * « 46.5197, 6.6323 », « 46.5197 N 6.6323 E », « 46°31'11"N 6°37'56"E », « 2'572'794 / 1'159'319 » (MN95),
 * « 572794 159319 » (MN03). L'ordre latitude / longitude est déduit des valeurs (la Suisse : 45,8–47,9 N, 5,9–10,5 E).
 */
export function lireCoordonnees(texte) {
  const t = texte.trim().replace(/[’`´]/g, "'").replace(/″|''/g, '"').replace(/′/g, "'");
  const dansSuisse = (E, N) => E > 2480000 && E < 2840000 && N > 1070000 && N < 1300000;
  // MN95 / MN03 : deux grands nombres (séparateurs de milliers ' ou espace fine admis)
  const g = t.replace(/(\d)['\u2009\u202f](?=\d{3})/g, "$1").match(/^(\d{6,7}(?:\.\d+)?)\s*[,;/ ]\s*(\d{6,7}(?:\.\d+)?)$/);
  if (g) {
    let [a, b] = [+g[1], +g[2]];
    if (a < 2e6 && b < 2e6) { a += a > 400000 ? 2e6 : 1e6; b += b > 400000 ? 2e6 : 1e6; } // MN03 -> MN95
    const [E, N] = a > b ? [a, b] : [b, a];
    return dansSuisse(E, N) ? { E: Math.round(E), N: Math.round(N), label: `MN95 ${Math.round(E)} / ${Math.round(N)}` } : null;
  }
  // degrés, avec minutes et secondes facultatives, et la lettre N/S/E/O/W avant ou après (facultative)
  const nb = String.raw`(\d{1,2}(?:[.,]\d+)?)`, dms = String.raw`${nb}\s*°?\s*(?:${nb}\s*'\s*)?(?:${nb}\s*"\s*)?`;
  const avant = /^[NSEOW]/i.test(t);
  const re = new RegExp(avant ? String.raw`([NSEOW])\s*${dms}` : String.raw`${dms}([NSEOW](?![a-z]))?`, "gi");
  const m = [...t.matchAll(re)].filter(r => r[0].trim());
  if (m.length !== 2 || t.replace(re, "").replace(/[\s,;/]/g, "")) return null; // rien d'autre que deux coordonnées
  const deg = x => x ? +x.replace(",", ".") : 0;
  const [a, b] = m.map(r => avant
    ? { v: deg(r[2]) + deg(r[3]) / 60 + deg(r[4]) / 3600, axe: r[1].toUpperCase() }
    : { v: deg(r[1]) + deg(r[2]) / 60 + deg(r[3]) / 3600, axe: (r[4] || "").toUpperCase() });
  let lat, lon;
  if (a.axe === "N" || b.axe === "E" || b.axe === "O" || b.axe === "W") [lat, lon] = [a.v, b.v];
  else if (a.axe === "E" || a.axe === "O" || a.axe === "W" || b.axe === "N") [lat, lon] = [b.v, a.v];
  else [lat, lon] = a.v > b.v ? [a.v, b.v] : [b.v, a.v]; // en Suisse, la latitude (~46–47) dépasse la longitude (~6–10)
  const [E, N] = versMn95(lon, lat);
  return dansSuisse(E, N) ? { E: Math.round(E), N: Math.round(N), label: `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E` } : null;
}

/** Parcelle (cadastre de la mensuration officielle) qui contient le point. */
export async function parcelleEn(E, N) {
  const u = `${API}/all/MapServer/identify?geometry=${E},${N}&geometryType=esriGeometryPoint` +
    `&layers=all:ch.kantone.cadastralwebmap-farbe&mapExtent=0,0,100,100&imageDisplay=100,100,96&tolerance=0` +
    `&sr=2056&returnGeometry=true&geometryFormat=geojson`;
  const d = await (await fetch(u)).json();
  const f = (d.results || []).find(r => r.geometry?.type === "Polygon" || r.geometry?.type === "MultiPolygon");
  if (!f) return null;
  const anneaux = f.geometry.type === "Polygon" ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map(p => p[0]);
  return { numero: f.properties.number, egrid: f.properties.egris_egrid, canton: f.properties.ak, anneaux };
}

/** Éléments STAC (tuiles de 1 km) qui touchent une boîte MN95. */
async function tuiles(collection, [e0, n0, e1, n1]) {
  const [lo0, la0] = versWgs(e0, n0), [lo1, la1] = versWgs(e1, n1);
  const u = `${STAC}/${collection}/items?limit=100&bbox=${lo0},${la0},${lo1},${la1}`;
  return (await (await fetch(u)).json()).features || [];
}

// identifiant « 2542-1150 » d'une tuile kilométrique et année du vol
const cle = f => f.id.split("_").pop();
const annee = f => +f.id.split("_")[1];

/**
 * Nuage de points swissSURFACE3D au format COPC (lisible par morceaux) pour chaque tuile de la boîte.
 * Renvoie null si une des tuiles n'existe pas encore dans ce format (vols plus anciens).
 */
export async function tuilesNuage(boite) {
  const parTuile = new Map();
  for (const f of await tuiles("ch.swisstopo.swisssurface3d", boite)) {
    const a = Object.values(f.assets).find(a => /copc/.test(a.type || a.href));
    if (!a) continue;
    const k = cle(f);
    if (!parTuile.has(k) || annee(f) > parTuile.get(k).annee) parTuile.set(k, { url: a.href, annee: annee(f), cle: k });
  }
  const attendues = cles(boite);
  return attendues.every(k => parTuile.has(k)) ? attendues.map(k => parTuile.get(k)) : null;
}

/** Modèles en grille 0,5 m (repli) : terrain swissALTI3D et surface swissSURFACE3D Raster, tous deux tirés du relevé laser. */
export async function tuilesGrille(boite) {
  const choisir = async (collection, motif) => {
    const m = new Map();
    for (const f of await tuiles(collection, boite)) {
      const a = Object.values(f.assets).find(a => motif.test(a.href));
      if (a && (!m.has(cle(f)) || annee(f) > m.get(cle(f)).annee)) m.set(cle(f), { url: a.href, annee: annee(f), cle: cle(f) });
    }
    return [...m.values()];
  };
  const [terrain, surface] = await Promise.all([
    choisir("ch.swisstopo.swissalti3d", /_0\.5_2056_5728\.tif$/),
    choisir("ch.swisstopo.swisssurface3d-raster", /_0\.5_2056_5728\.tif$/),
  ]);
  return { terrain, surface };
}

/** Terrain swissALTI3D à 2 m (le plus récent par tuile kilométrique) pour une boîte MN95 : [{ url, annee, cle }]. */
export async function tuilesAlti2m(boite) {
  const m = new Map();
  for (const f of await tuiles("ch.swisstopo.swissalti3d", boite)) {
    const a = Object.values(f.assets).find(a => /_2_2056_5728\.tif$/.test(a.href));
    if (a && (!m.has(cle(f)) || annee(f) > m.get(cle(f)).annee)) m.set(cle(f), { url: a.href, annee: annee(f), cle: cle(f) });
  }
  return [...m.values()];
}

/** Tuiles swissALTI3D 0,5 m (terrain swisstopo de la maquette fine), la plus récente par km². */
export async function tuilesAlti05(boite) {
  const m = new Map();
  for (const f of await tuiles("ch.swisstopo.swissalti3d", boite)) {
    const a = Object.values(f.assets).find(a => /_0\.5_2056_5728\.tif$/.test(a.href));
    if (a && (!m.has(cle(f)) || annee(f) > m.get(cle(f)).annee)) m.set(cle(f), { url: a.href, annee: annee(f), cle: cle(f) });
  }
  return [...m.values()];
}

function cles([e0, n0, e1, n1]) {
  const r = [];
  for (let e = Math.floor(e0 / 1000); e <= Math.floor((e1 - 0.01) / 1000); e++)
    for (let n = Math.floor(n0 / 1000); n <= Math.floor((n1 - 0.01) / 1000); n++) r.push(`${e}-${n}`);
  return r;
}

/** Parcelles (mensuration officielle) qui touchent une boîte MN95 : [{ numero, anneaux }]. */
export async function parcellesAutour([e0, n0, e1, n1]) {
  // l'API rend un nombre limité de parcelles par requête : la boîte est découpée en morceaux d'au plus 200 m,
  // demandés en parallèle, puis fusionnés (une parcelle à cheval sur deux morceaux n'est gardée qu'une fois)
  const pas = 200, ne = Math.max(1, Math.ceil((e1 - e0) / pas)), nn = Math.max(1, Math.ceil((n1 - n0) / pas));
  const morceaux = [];
  for (let a = 0; a < ne; a++) for (let b = 0; b < nn; b++)
    morceaux.push([e0 + (e1 - e0) * a / ne, n0 + (n1 - n0) * b / nn, e0 + (e1 - e0) * (a + 1) / ne, n0 + (n1 - n0) * (b + 1) / nn]);
  const lire = async ([a0, b0, a1, b1]) => {
    const u = `${API}/all/MapServer/identify?geometry=${a0},${b0},${a1},${b1}&geometryType=esriGeometryEnvelope` +
      `&layers=all:ch.kantone.cadastralwebmap-farbe&mapExtent=0,0,100,100&imageDisplay=100,100,96&tolerance=0` +
      `&sr=2056&returnGeometry=true&geometryFormat=geojson&limit=200`;
    try { return (await (await fetch(u)).json()).results || []; } catch { return []; }
  };
  const vues = new Map();
  for (const r of (await Promise.all(morceaux.map(lire))).flat()) {
    if (r.geometry?.type !== "Polygon" && r.geometry?.type !== "MultiPolygon") continue;
    const anneaux = r.geometry.type === "Polygon" ? [r.geometry.coordinates[0]] : r.geometry.coordinates.map(p => p[0]);
    const cle = r.properties.egris_egrid || `${r.properties.number}|${anneaux[0][0].join(",")}`;
    if (!vues.has(cle)) vues.set(cle, { numero: r.properties.number, anneaux });
  }
  return [...vues.values()];
}
