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

/*
 * MN95 -> ECEF WGS84, formules rigoureuses de swisstopo (projection cylindrique conforme à axe oblique sur l'ellipsoïde
 * de Bessel, puis translation CH1903+ -> ETRS89/WGS84) : ~1 cm, contre ~0,2–0,8 m pour versWgs (vérifié sur
 * l'origine de Berne). `h` : hauteur sur l'ellipsoïde de Bessel (≈ altitude suisse, à quelques mètres près).
 */
const B_A = 6377397.155, B_E2 = 0.006674372230614, B_E = Math.sqrt(B_E2), RAD = Math.PI / 180;
const PHI0 = (46 + 57 / 60 + 8.66 / 3600) * RAD, LAM0 = (7 + 26 / 60 + 22.5 / 3600) * RAD;
const P_R = B_A * Math.sqrt(1 - B_E2) / (1 - B_E2 * Math.sin(PHI0) ** 2), P_ALPHA = Math.sqrt(1 + B_E2 / (1 - B_E2) * Math.cos(PHI0) ** 4);
const P_B0 = Math.asin(Math.sin(PHI0) / P_ALPHA);
const P_K = Math.log(Math.tan(Math.PI / 4 + P_B0 / 2)) - P_ALPHA * Math.log(Math.tan(Math.PI / 4 + PHI0 / 2)) + P_ALPHA * B_E / 2 * Math.log((1 + B_E * Math.sin(PHI0)) / (1 - B_E * Math.sin(PHI0)));
export function mn95VersEcef(E, N, h = 0) {
  const Y = E - 2600000, X = N - 1200000, lb = Y / P_R, bb = 2 * (Math.atan(Math.exp(X / P_R)) - Math.PI / 4);
  const b = Math.asin(Math.cos(P_B0) * Math.sin(bb) + Math.sin(P_B0) * Math.cos(bb) * Math.cos(lb));
  const l = Math.atan(Math.sin(lb) / (Math.cos(P_B0) * Math.cos(lb) - Math.sin(P_B0) * Math.tan(bb)));
  const lam = LAM0 + l / P_ALPHA, S0 = (Math.log(Math.tan(Math.PI / 4 + b / 2)) - P_K) / P_ALPHA;
  let phi = b;
  for (let i = 0; i < 6; i++) phi = 2 * Math.atan(Math.exp(S0 + B_E * Math.log(Math.tan(Math.PI / 4 + Math.asin(B_E * Math.sin(phi)) / 2)))) - Math.PI / 2;
  const Nn = B_A / Math.sqrt(1 - B_E2 * Math.sin(phi) ** 2);
  return [(Nn + h) * Math.cos(phi) * Math.cos(lam) + 674.374, (Nn + h) * Math.cos(phi) * Math.sin(lam) + 15.056, (Nn * (1 - B_E2) + h) * Math.sin(phi) + 405.346];
}

// lieux notables (cathédrales, hôtels de ville, ponts, châteaux, gares, musées…) : liste interne tirée d'OpenStreetMap
// (outils/lieux/extraire_osm.py), servie avec le site et chargée à la première recherche (~150 Ko compressée)
const normaliser = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
let lieux = null;
const listeLieux = () => lieux ||= fetch(`${import.meta.env.BASE_URL}lieux/lieux-ch.json`).then(r => r.ok ? r.json() : { lieux: [] })
  // [nom, type, E, N, localité, [autres noms]] ; ancien format sans localité : [nom, type, E, N, [autres noms]]
  .then(d => d.lieux.map(([nom, type, E, N, x = "", y = []]) => { const loc = Array.isArray(x) ? "" : x, autres = Array.isArray(x) ? x : y; return { nom, type, E, N, loc, cle: normaliser([nom, ...autres].join(" | ")), cleLoc: normaliser(loc) }; }))
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
  // deux requêtes en parallèle : dans une seule, les noms (localités, régions) prenaient toute la place et les
  // adresses et parcelles ne revenaient plus
  const q = encodeURIComponent(texte), url = origines => `${API}/api/SearchServer?type=locations&origins=${origines}&sr=2056&limit=8&searchText=${q}`;
  const [a, n, L] = await Promise.all([
    fetch(url("address,parcel"), { signal }).then(r => r.json()),
    // catégories en allemand quelle que soit la langue du navigateur (le filtre ci-dessous les lit) ; les noms ne changent pas
    fetch(url("gazetteer") + "&lang=de", { signal }).then(r => r.json()).catch(() => ({ results: [] })),
    chercherLieux(texte).catch(() => []),
  ]);
  // sans numéro tapé, les noms (localités, ponts, sites) avant les adresses
  const officiels = (/\d/.test(texte) ? [...(a.results || []), ...(n.results || [])] : [...(n.results || []), ...(a.results || [])])
    // noms de swisstopo : seulement les objets précis (pas les régions, cantons, communes entières, lieux-dits)
    .filter(r => r.attrs.origin !== "gazetteer" || /<i>(Ort|Strasse|Historisches Areal|Schul- und Hochschulareal|Spital|Sportanlage|Gebäude|Kirche|Schloss|Turm|Brücke|Denkmal|Museum|Bahnhof|Friedhof|Kloster|Burg|Ruine)/.test(r.attrs.label))
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

/*
 * Tuiles kilométriques des données swisstopo (année la plus récente et adresse du fichier), par clé « 2542-1150 ».
 * 1) Index pré-calculé servi avec le site (outils/index_tuiles.mjs, F1) : aucune requête STAC ; 2) sinon le catalogue
 * STAC, interrogé seulement pour les tuiles pas encore vues (mémoire de session, d'un lieu à l'autre).
 */
const INDEX = `${import.meta.env?.BASE_URL ?? "./"}donnees/tuiles-v1.json`;
let index = null;
function lireIndex() {
  index ||= fetch(INDEX).then(r => r.ok ? r.json() : null).then(d => d?.version === 1 ? d : null).catch(() => null);
  return index;
}
// collection STAC -> motif du fichier voulu (le plus récent par tuile)
const JEUX = {
  copc: ["ch.swisstopo.swisssurface3d", /copc/],
  alti2m: ["ch.swisstopo.swissalti3d", /_2_2056_5728\.tif$/],
  alti05: ["ch.swisstopo.swissalti3d", /_0\.5_2056_5728\.tif$/],
  surface05: ["ch.swisstopo.swisssurface3d-raster", /_0\.5_2056_5728\.tif$/],
};
const vues = new Map(); // `${jeu}|${cle}` -> { url, annee, cle } ou null (tuile absente)

/** Éléments STAC (tuiles de 1 km, toutes années) qui touchent une boîte MN95 ; pages suivantes lues (lien « next »). */
async function tuilesStac(collection, [e0, n0, e1, n1]) {
  const [lo0, la0] = versWgs(e0, n0), [lo1, la1] = versWgs(e1, n1);
  let u = `${STAC}/${collection}/items?limit=100&bbox=${lo0},${la0},${lo1},${la1}`;
  const tout = [];
  for (let page = 0; u && page < 8; page++) {
    const d = await (await fetch(u)).json();
    tout.push(...(d.features || []));
    u = (d.links || []).find(l => l.rel === "next")?.href;
  }
  return tout;
}

// identifiant « 2542-1150 » d'une tuile kilométrique et année du vol
const cle = f => f.id.split("_").pop();
const annee = f => +f.id.split("_")[1];

/** Tuiles du jeu `jeu` pour les clés voulues : { cle -> { url, annee, cle } | null }. */
async function tuilesJeu(jeu, cles) {
  const idx = await lireIndex(), [collection, motif] = JEUX[jeu];
  const I = idx?.jeux?.[jeu];
  // index partiel (boîte d'essai) : hors de sa boîte, on demande à STAC
  const dansIndex = (e, n) => !idx.boite || (e * 1000 >= idx.boite[0] && (e + 1) * 1000 <= idx.boite[2] && n * 1000 >= idx.boite[1] && (n + 1) * 1000 <= idx.boite[3]);
  if (I) for (const k of cles) {
    const [e, n] = k.split("-").map(Number);
    if (!dansIndex(e, n)) continue;
    const ligne = I.lignes[e], a = ligne && ligne[n - ligne[0] + 1];
    vues.set(`${jeu}|${k}`, a ? { url: (I.exceptions?.[k] || I.gabarit).replaceAll("{a}", 2000 + a).replaceAll("{k}", k), annee: 2000 + a, cle: k } : null);
  }
  const manquent = cles.filter(k => !vues.has(`${jeu}|${k}`));
  if (manquent.length) {
    // une requête pour la boîte des tuiles manquantes (un peu rentrée : pas les tuiles voisines qui la touchent)
    const es = manquent.map(k => +k.split("-")[0]), ns = manquent.map(k => +k.split("-")[1]);
    const b = [Math.min(...es) * 1000 + 5, Math.min(...ns) * 1000 + 5, (Math.max(...es) + 1) * 1000 - 5, (Math.max(...ns) + 1) * 1000 - 5];
    const trouve = new Map();
    for (const f of await tuilesStac(collection, b)) {
      const a = Object.values(f.assets).find(a => motif.test(a.type || a.href) || motif.test(a.href));
      if (a && (!trouve.has(cle(f)) || annee(f) > trouve.get(cle(f)).annee)) trouve.set(cle(f), { url: a.href, annee: annee(f), cle: cle(f) });
    }
    for (const k of manquent) vues.set(`${jeu}|${k}`, trouve.get(k) || null);
    for (const [k, v] of trouve) if (!vues.has(`${jeu}|${k}`)) vues.set(`${jeu}|${k}`, v);
  }
  return Object.fromEntries(cles.map(k => [k, vues.get(`${jeu}|${k}`)]));
}

/** Demande d'avance les tuiles du relevé (index ou STAC) d'une boîte, sans attendre : le chargement les retrouve. */
export function preparerTuiles(boite, jeux = ["copc"]) {
  for (const j of jeux) tuilesJeu(j, cles(boite)).catch(() => {});
}

/**
 * Nuage de points swissSURFACE3D au format COPC (lisible par morceaux) pour chaque tuile de la boîte.
 * Renvoie null si une des tuiles n'existe pas encore dans ce format (vols plus anciens).
 */
export async function tuilesNuage(boite) {
  const attendues = cles(boite), t = await tuilesJeu("copc", attendues);
  return attendues.every(k => t[k]) ? attendues.map(k => t[k]) : null;
}

/** Modèles en grille 0,5 m (repli) : terrain swissALTI3D et surface swissSURFACE3D Raster, tous deux tirés du relevé laser. */
export async function tuilesGrille(boite) {
  const k = cles(boite), [a, b] = await Promise.all([tuilesJeu("alti05", k), tuilesJeu("surface05", k)]);
  return { terrain: Object.values(a).filter(Boolean), surface: Object.values(b).filter(Boolean) };
}

/** Terrain swissALTI3D à 2 m (le plus récent par tuile kilométrique) pour une boîte MN95 : [{ url, annee, cle }]. */
export async function tuilesAlti2m(boite) {
  // grandes boîtes : par morceaux (requêtes parallèles, chacune de quelques pages au plus)
  const toutes = cles(boite), morceaux = [];
  for (let i = 0; i < toutes.length; i += 25) morceaux.push(toutes.slice(i, i + 25));
  const r = await Promise.all(morceaux.map(m => tuilesJeu("alti2m", m)));
  return r.flatMap(o => Object.values(o).filter(Boolean));
}

/** Tuiles swissALTI3D 0,5 m (terrain swisstopo de la maquette fine), la plus récente par km² : [{ url, annee, cle }]. */
export async function tuilesAlti05(boite) {
  return Object.values(await tuilesJeu("alti05", cles(boite))).filter(Boolean);
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
