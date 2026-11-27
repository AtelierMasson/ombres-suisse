// Axes des routes et chemins swissTLM3D autour d'un lieu, pour orienter les routes d'accès des ponts (raccordsPonts.js).
// Source : couche « transportation » des tuiles vectorielles swisstopo (base.vt, z14 : ~1,7 km par tuile, axes au
// demi-mètre près), décodées sans dépendance (mvt.js) et gardées en cache d'un lieu à l'autre. `brunnel: "bridge"` marque
// les tronçons sur un ouvrage : leurs bouts sont les bouts de pont officiels.
import { lireCouche } from "./mvt.js";
import { versWgs, versMn95 } from "./geo.js";

const URL_VT = (z, x, y) => `https://vectortiles${(x + y) % 5}.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/${z}/${x}/${y}.pbf`;
const Z = 14, CACHE = new Map(), CACHE_MAX = 32;

/** Lignes d'une tuile en MN95 : [{ pts: [[E, N], …], pont, classe }]. */
function lignesTuile(x, y) {
  const k = `${x}/${y}`;
  if (CACHE.has(k)) return CACHE.get(k);
  while (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  const p = fetch(URL_VT(Z, x, y)).then(r => r.ok ? r.arrayBuffer() : null).then(b => {
    if (!b) return [];
    const { entites, etendue } = lireCouche(new Uint8Array(b), "transportation"), n = 2 ** Z, out = [];
    const versMN = ([px, py]) => versMn95((x + px / etendue) / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + py / etendue) / n))) * 180 / Math.PI);
    for (const e of entites) {
      if (e.type !== 2) continue;
      for (const a of e.anneaux) if (a.length >= 2) out.push({ pts: a.map(versMN), pont: e.props.brunnel === "bridge", tunnel: e.props.brunnel === "tunnel", classe: e.props.class });
    }
    return out;
  });
  p.catch(() => CACHE.delete(k));
  CACHE.set(k, p);
  return p;
}

/**
 * Axes des routes dans le carré de demi-côté `R` autour de (E0, N0), relatifs au centre : [{ pts: [[x, y], …], pont,
 * tunnel, classe }]. Liste vide si les tuiles ne répondent pas (les raccords suivent alors l'axe du pont).
 */
export async function routesAutour(E0, N0, R) {
  const tuile = (E, N) => { const [lon, lat] = versWgs(E, N), n = 2 ** Z; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; };
  const [xa, ya] = tuile(E0 - R, N0 + R), [xb, yb] = tuile(E0 + R, N0 - R), lots = [];
  for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) lots.push(lignesTuile(x, y).catch(() => []));
  const out = [];
  for (const L of await Promise.all(lots)) for (const l of L) {
    const pts = l.pts.map(([E, N]) => [E - E0, N - N0]);
    if (pts.some(([x, y]) => Math.abs(x) < R + 30 && Math.abs(y) < R + 30)) out.push({ ...l, pts });
  }
  return out;
}

/**
 * Direction de la route au bout d'un pont : la ligne TLM qui passe à moins de 10 m du joint `j` ([x, y]) dans le sens
 * du pont (à 40° près de `u`, direction vers l'extérieur), suivie sur 15 m vers l'extérieur. Renvoie { d: [dx, dy] (unitaire),
 * ecart (distance du joint à la ligne), boutTLM (distance du joint au bout de pont TLM le plus proche, ou null) } ;
 * null sans route trouvée.
 */
export function directionRoute(routes, j, u) {
  let best = null;
  for (const L of routes || []) {
    if (L.tunnel) continue;
    const P = L.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const ax = P[i][0], ay = P[i][1], ex = P[i + 1][0] - ax, ey = P[i + 1][1] - ay, l2 = ex * ex + ey * ey;
      if (!l2) continue;
      const lg = Math.sqrt(l2), c = (ex * u[0] + ey * u[1]) / lg;
      if (Math.abs(c) < Math.cos(40 * Math.PI / 180)) continue;
      const v = Math.max(0, Math.min(1, ((j[0] - ax) * ex + (j[1] - ay) * ey) / l2)), px = ax + ex * v, py = ay + ey * v;
      const ecart = Math.hypot(j[0] - px, j[1] - py);
      if (ecart > 10 || (best && ecart >= best.ecart)) continue;
      // suivre la ligne vers l'extérieur (sens de u) sur 15 m
      const sens = c > 0 ? 1 : -1;
      let x = px, y = py, reste = 15, k = sens > 0 ? i + 1 : i;
      while (reste > 0 && k >= 0 && k < P.length) {
        const dx = P[k][0] - x, dy = P[k][1] - y, dl = Math.hypot(dx, dy);
        if (dl >= reste) { x += dx / dl * reste; y += dy / dl * reste; reste = 0; break; }
        x = P[k][0]; y = P[k][1]; reste -= dl; k += sens;
      }
      const lx = x - px, ly = y - py, ll = Math.hypot(lx, ly);
      if (ll < 5) continue;
      best = { d: [lx / ll, ly / ll], ecart };
    }
  }
  if (!best) return null;
  let bt = Infinity;
  for (const L of routes) if (L.pont) for (const p of [L.pts[0], L.pts.at(-1)]) bt = Math.min(bt, Math.hypot(p[0] - j[0], p[1] - j[1]));
  best.boutTLM = Number.isFinite(bt) && bt < 50 ? +bt.toFixed(1) : null;
  return best;
}
