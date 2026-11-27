// Piscines et bassins de la mensuration officielle (couverture du sol, genre « bassin »), posés dans la grille :
// le relevé laser voit mal l'eau des piscines (peu de retours, creux arrondi par l'interpolation du terrain). Pour chaque
// bassin : niveau du terrain mesuré tout autour, abords aplanis à ce niveau (plus de creux), fond creusé à −1,60 m et
// eau à −0,20 m, parois verticales (le bord du bassin suit les cellules de la grille).
//  - Vaud : couche ArcGIS « surface revêtement dur » (GENRE_TXT = bassin) ;
//  - ailleurs : geodienste.ch, WFS de la mensuration officielle (LCSF, Genre = bassin), cantons en accès libre.

const VAUD = "https://www.ogc.vd.ch/public/rest/services/OGC/wmsVD/MapServer/283/query";
const GEODIENSTE = "https://geodienste.ch/db/av_0/fra";
const BOITE_VAUD = [2494000, 1115000, 2586000, 1204000];
export const PROFONDEUR = 1.6, EAU = 0.2, ABORDS = 1.0, RACCORD = 2.5;

const anneauxDe = g => g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];

async function vaud([e0, n0, e1, n1], signal) {
  const q = new URLSearchParams({
    geometry: `${e0},${n0},${e1},${n1}`, geometryType: "esriGeometryEnvelope", inSR: 2056, outSR: 2056, returnGeometry: "true",
    where: "GENRE_TXT='bassin'", outFields: "OBJECTID", resultRecordCount: 2000, f: "geojson",
  });
  const d = await (await fetch(`${VAUD}?${q}`, { signal })).json();
  if (d.error) throw new Error(d.error.message || "erreur");
  return (d.features || []).flatMap(f => anneauxDe(f.geometry));
}

async function geodienste([e0, n0, e1, n1], signal) {
  const filtre = `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"><fes:And>`
    + `<fes:PropertyIsEqualTo><fes:ValueReference>Genre</fes:ValueReference><fes:Literal>bassin</fes:Literal></fes:PropertyIsEqualTo>`
    + `<fes:BBOX><fes:ValueReference>msGeometry</fes:ValueReference><gml:Envelope srsName="urn:ogc:def:crs:EPSG::2056">`
    + `<gml:lowerCorner>${e0} ${n0}</gml:lowerCorner><gml:upperCorner>${e1} ${n1}</gml:upperCorner></gml:Envelope></fes:BBOX></fes:And></fes:Filter>`;
  const q = new URLSearchParams({
    SERVICE: "WFS", VERSION: "2.0.0", REQUEST: "GetFeature", TYPENAMES: "ms:LCSF", SRSNAME: "urn:ogc:def:crs:EPSG::2056",
    OUTPUTFORMAT: "application/json; subtype=geojson", FILTER: filtre, COUNT: 2000,
  });
  const d = await (await fetch(`${GEODIENSTE}?${q}`, { signal })).json();
  return (d.features || []).flatMap(f => anneauxDe(f.geometry));
}

/** Bassins (polygones MN95 : [anneau extérieur, trous…]) qui touchent la boîte ; [] si aucun service ne répond. */
export function bassinsAutour(boite, { signal = null } = {}) {
  const [e0, n0, e1, n1] = boite, essais = [];
  if (e1 > BOITE_VAUD[0] && e0 < BOITE_VAUD[2] && n1 > BOITE_VAUD[1] && n0 < BOITE_VAUD[3]) essais.push(vaud(boite, signal));
  else essais.push(geodienste(boite, signal));
  return Promise.all(essais.map(p => p.catch(() => []))).then(l => l.flat());
}

const dedans = (x, y, a) => {
  let c = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i], [xj, yj] = a[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const distSegment = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};
const distBord = (x, y, a) => { let d = Infinity; for (let i = 0, j = a.length - 1; i < a.length; j = i++) d = Math.min(d, distSegment(x, y, a[j], a[i])); return d; };

/**
 * Creuse les bassins dans la grille G (centrée sur E0, N0) : G.sol modifié, G.eau posé. Renvoie le nombre de bassins
 * traités. Les bassins trop grands (> 2000 m², étangs, réservoirs) ou sous un bâtiment sont laissés tels quels.
 */
export function creuserBassins(G, bassins, E0, N0) {
  const { n, c, x0, sol, bat } = G;
  let nb = 0;
  for (const poly of bassins) {
    const ext = poly[0]?.map(([e, nn]) => [e - E0, nn - N0]);
    if (!ext || ext.length < 3) continue;
    const trous = poly.slice(1).map(a => a.map(([e, nn]) => [e - E0, nn - N0]));
    let aire = 0; for (let i = 0, j = ext.length - 1; i < ext.length; j = i++) aire += ext[j][0] * ext[i][1] - ext[i][0] * ext[j][1];
    if (Math.abs(aire / 2) > 2000 || Math.abs(aire / 2) < 2) continue;
    const xs = ext.map(p => p[0]), ys = ext.map(p => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - ABORDS - 3 - x0) / c)), i1 = Math.min(n - 1, Math.ceil((Math.max(...xs) + ABORDS + 3 - x0) / c));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - ABORDS - 3 - x0) / c)), j1 = Math.min(n - 1, Math.ceil((Math.max(...ys) + ABORDS + 3 - x0) / c));
    if (i0 > i1 || j0 > j1) continue;
    // creusé : toute cellule qui touche le bassin (centre dedans ou à moins d'une demi-diagonale du bord) ; la pente de
    // la grille tombe ainsi hors du contour exact, sous la margelle dessinée à part (maillageBassins)
    const interieur = [], abords = [], couronne = [], demi = c * 0.72;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = x0 + (i + 0.5) * c, y = x0 + (j + 0.5) * c, p = j * n + i;
      const d = distBord(x, y, ext), dans = dedans(x, y, ext) && !trous.some(t => dedans(x, y, t));
      if (dans || d <= demi) interieur.push(p);
      else if (d <= ABORDS + demi) abords.push(p);
      else if (d <= ABORDS + demi + RACCORD && isNaN(bat[p])) couronne.push([p, (d - ABORDS - demi) / RACCORD]);
    }
    if (!interieur.length) continue;
    if (interieur.filter(p => !isNaN(bat[p])).length > interieur.length / 2) continue; // bassin couvert (sous un toit)
    // niveau du terrain propre : médiane du sol mesuré sur la couronne, au-delà des abords (hors du creux du relevé)
    const z = couronne.map(([p]) => sol[p]).filter(v => !isNaN(v)).sort((a, b) => a - b);
    if (!z.length) continue;
    const niveau = z[z.length >> 1];
    for (const p of abords) if (isNaN(bat[p])) sol[p] = niveau;
    // raccord : du niveau de la piscine à la pente naturelle, en douceur (pas de marche au bord des abords)
    for (const [p, u] of couronne) if (!isNaN(sol[p])) { const w = u * u * (3 - 2 * u); sol[p] = niveau + (sol[p] - niveau) * w; }
    for (const p of interieur) { sol[p] = niveau - PROFONDEUR - 0.05; bat[p] = NaN; if (G.veg) G.veg[p] = NaN; if (G.pont) G.pont[p] = NaN; }
    // l'eau, les parois et la margelle sont dessinées sur le contour exact (maillageBassins), pas par cellules
    (G.bassins ||= []).push({ anneau: ext, trous, niveau });
    nb++;
  }
  return nb;
}

/**
 * Maillages des bassins de G.bassins, dans le repère de la scène (x est, y altitude − zRef, z = −nord) :
 *  - eau : polygone exact à niveau − 0,20 m ;
 *  - parois : faces verticales sur le contour exact, du niveau au fond (−1,60 m) ;
 *  - margelle : bande plate de 0,8 m au niveau du terrain, autour du contour (elle couvre la pente de la grille).
 * `uvPlan(x, y)` : coordonnées du plan au sol pour la margelle (même matière que le terrain).
 */
export function maillageBassins(G, zRef, THREE, uvPlan) {
  const eau = [], parois = [], marg = [], uvM = [];
  const v = (x, y, z) => [x, z - zRef, -y];
  for (const B of G.bassins || []) {
    let A = B.anneau.slice();
    let aire = 0; for (let i = 0, j = A.length - 1; i < A.length; j = i++) aire += A[j][0] * A[i][1] - A[i][0] * A[j][1];
    if (aire < 0) A.reverse(); // sens trigonométrique : la normale extérieure d'une arête (a -> b) est (dy, -dx)
    const zE = B.niveau - EAU, zF = B.niveau - PROFONDEUR, zM = B.niveau;
    // eau : triangulation du contour exact (trous compris)
    const tri = THREE.ShapeUtils.triangulateShape(A.map(p => new THREE.Vector2(p[0], p[1])), (B.trous || []).map(t => t.map(p => new THREE.Vector2(p[0], p[1]))));
    const tous = [A, ...(B.trous || [])].flat();
    for (const [a, b, c] of tri) for (const k of [a, b, c]) eau.push(...v(tous[k][0], tous[k][1], zE));
    // fond du bassin, au contour exact (vu d'en haut à travers l'eau)
    for (const [a, b, c] of tri) for (const k of [a, b, c]) { marg.push(...v(tous[k][0], tous[k][1], zF)); uvM.push(...uvPlan(tous[k][0], tous[k][1])); }
    for (let i = 0; i < A.length; i++) {
      const a = A[i], b = A[(i + 1) % A.length];
      // paroi verticale (vue de l'intérieur du bassin)
      parois.push(...v(a[0], a[1], zM), ...v(b[0], b[1], zM), ...v(b[0], b[1], zF), ...v(a[0], a[1], zM), ...v(b[0], b[1], zF), ...v(a[0], a[1], zF));
    }
  }
  const geo = (pos, uv = null) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  return eau.length ? { eau: geo(eau), parois: geo(parois), fond: geo(marg, uvM) } : null;
}
