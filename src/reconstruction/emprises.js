// Emprises officielles des bâtiments (mensuration officielle), en MN95, lues directement par le navigateur.
//  - Vaud : service ArcGIS du canton (couche « couverture du sol », genre bâtiment) ;
//  - ailleurs : geodienste.ch, WFS de la mensuration officielle (couche LCSF, Genre = batiment), cantons en accès libre.
// Code écrit pour ce projet (licence du projet) ; seules les adresses des services sont reprises de l'essai « Advanced ».

const VAUD = "https://www.ogc.vd.ch/public/rest/services/OGC/wmsVD/MapServer/276/query";
const GEODIENSTE = "https://geodienste.ch/db/av_0/fra";
const BOITE_VAUD = [2494000, 1115000, 2586000, 1204000];

const aireSignee = a => { let s = 0; for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += a[j][0] * a[i][1] - a[i][0] * a[j][1]; return s / 2; };

/** Anneaux sans point de fermeture ni doublon ; extérieur trigonométrique, trous horaires. */
function nettoyer(anneaux) {
  const R = [];
  anneaux.forEach((a, k) => {
    let b = a.map(p => [p[0], p[1]]);
    if (b.length > 1 && b[0][0] === b.at(-1)[0] && b[0][1] === b.at(-1)[1]) b.pop();
    b = b.filter((p, i) => { const q = b[(i + b.length - 1) % b.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-3; });
    if (b.length < 3) return;
    if ((aireSignee(b) > 0) !== (k === 0)) b.reverse();
    R.push(b);
  });
  return R;
}

function lireGeoJSON(d, idDe, egidDe) {
  const E = [];
  for (const f of d.features || []) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    polys.forEach((p, k) => {
      const anneaux = nettoyer(p);
      if (anneaux.length && Math.abs(aireSignee(anneaux[0])) > 1)
        E.push({ id: String(idDe(f)) + (polys.length > 1 ? "-" + k : ""), egid: +egidDe(f) || null, anneaux });
    });
  }
  return E;
}

async function vaud([e0, n0, e1, n1], signal) {
  const E = [];
  for (let debut = 0; ; debut += 1000) {
    const q = new URLSearchParams({
      geometry: `${e0},${n0},${e1},${n1}`, geometryType: "esriGeometryEnvelope", inSR: 2056, outSR: 2056, returnGeometry: "true",
      where: "GENRE_TXT='bâtiment'", outFields: "OBJECTID,EGID", orderByFields: "OBJECTID", resultOffset: debut, resultRecordCount: 1000, f: "geojson",
    });
    const d = await (await fetch(`${VAUD}?${q}`, { signal })).json();
    if (d.error) throw new Error("Emprises Vaud : " + (d.error.message || "erreur"));
    E.push(...lireGeoJSON(d, f => "VD-" + (f.properties.OBJECTID ?? f.id), f => f.properties.EGID));
    if ((d.features || []).length < 1000) break;
  }
  return E;
}

async function geodienste([e0, n0, e1, n1], signal) {
  const filtre = `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"><fes:And>`
    + `<fes:PropertyIsEqualTo><fes:ValueReference>Genre</fes:ValueReference><fes:Literal>batiment</fes:Literal></fes:PropertyIsEqualTo>`
    + `<fes:BBOX><fes:ValueReference>msGeometry</fes:ValueReference><gml:Envelope srsName="urn:ogc:def:crs:EPSG::2056">`
    + `<gml:lowerCorner>${e0} ${n0}</gml:lowerCorner><gml:upperCorner>${e1} ${n1}</gml:upperCorner></gml:Envelope></fes:BBOX></fes:And></fes:Filter>`;
  const E = [];
  for (let debut = 0; ; debut += 2000) {
    const q = new URLSearchParams({
      SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAMES: "ms:LCSF", SRSNAME: "urn:ogc:def:crs:EPSG::2056",
      OUTPUTFORMAT: "application/json; subtype=geojson", FILTER: filtre, COUNT: 2000, STARTINDEX: debut,
    });
    const d = await (await fetch(`${GEODIENSTE}?${q}`, { signal })).json(), nb = (d.features || []).length;
    E.push(...lireGeoJSON(d, f => { const p = f.geometry.coordinates.flat(3); return `${f.properties.Canton}-${Math.round(p[0] * 10)}-${Math.round(p[1] * 10)}`; }, f => f.properties.RegBL_EGID));
    if (nb < 2000) break;
  }
  return E;
}

/**
 * Emprises des bâtiments qui touchent la boîte [e0, n0, e1, n1] (MN95).
 * @returns {Promise<{ source, emprises: { id, egid, anneaux: [[E, N], …][] }[] } | null>} null si aucune source ne répond.
 */
export async function emprisesOfficielles(boite, { signal = null } = {}) {
  const [e0, n0, e1, n1] = boite, essais = [];
  if (e1 > BOITE_VAUD[0] && e0 < BOITE_VAUD[2] && n1 > BOITE_VAUD[1] && n0 < BOITE_VAUD[3])
    essais.push(vaud(boite, signal).then(E => E.length ? { source: "MO Vaud (ogc.vd.ch)", E } : null));
  essais.push(geodienste(boite, signal).then(E => E.length ? { source: "MO (geodienste.ch)", E } : null));
  const R = (await Promise.all(essais.map(p => p.catch(e => { if (e.name === "AbortError") throw e; return null; })))).filter(Boolean);
  if (!R.length) return null;
  return { source: R.map(r => r.source).join(" ; "), emprises: R.flatMap(r => r.E) };
}
