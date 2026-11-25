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

/** Adresses et parcelles de toute la Suisse. */
export async function chercher(texte, signal) {
  const u = `${API}/api/SearchServer?type=locations&origins=address,parcel&sr=2056&limit=8&searchText=${encodeURIComponent(texte)}`;
  const d = await (await fetch(u, { signal })).json();
  return (d.results || []).map(r => ({
    label: r.attrs.label.replace(/<[^>]+>/g, ""),
    type: r.attrs.origin === "parcel" ? "Parcelle" : "Adresse",
    E: r.attrs.y, N: r.attrs.x,
  }));
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

function cles([e0, n0, e1, n1]) {
  const r = [];
  for (let e = Math.floor(e0 / 1000); e <= Math.floor((e1 - 0.01) / 1000); e++)
    for (let n = Math.floor(n0 / 1000); n <= Math.floor((n1 - 0.01) / 1000); n++) r.push(`${e}-${n}`);
  return r;
}
