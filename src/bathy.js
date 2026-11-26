// Fond réel des lacs (swissBATHY3D, swisstopo), préparé en tuiles de 1 km par outils/bathy_tuiles.py et servies avec le
// site (dossier « bathy/ », hors dépôt). Sous l'eau de la maquette, le sol prend l'altitude mesurée du fond ; là où il
// n'y a pas de tuile, la pente estimée depuis la rive (grille.js) reste.
const BASE = `${import.meta.env.BASE_URL}bathy/`;
let index = null;
const tuiles = new Map();

async function lireIndex() {
  if (!index) index = fetch(BASE + "index.json").then(r => r.ok ? r.json() : null).catch(() => null);
  return index;
}
function lireTuile(cle) {
  if (!tuiles.has(cle)) tuiles.set(cle, fetch(`${BASE}${cle}.bin`).then(r => r.ok ? r.arrayBuffer() : null).then(b => b && new Uint16Array(b)).catch(() => null));
  return tuiles.get(cle);
}

/**
 * Pose le fond réel sous l'eau de G (cellules où G.eau est défini). `E0`, `N0` : centre MN95 de la maquette.
 * Renvoie le nombre de cellules mises au fond mesuré (0 : pas de données pour ce lieu).
 */
export async function fondLacs(G, E0, N0) {
  if (!G.eau || !G.eau.some(v => !isNaN(v))) return 0;
  const I = await lireIndex();
  if (!I) return 0;
  const { n, c, x0, sol, eau } = G, dispo = decalages(I), cases = I.cases, pas = I.pas;
  const cles = new Set();
  for (let e = Math.floor((E0 + x0) / 1000); e <= Math.floor((E0 - x0) / 1000); e++)
    for (let m = Math.floor((N0 + x0) / 1000); m <= Math.floor((N0 - x0) / 1000); m++) if (dispo.has(`${e}-${m}`)) cles.add(`${e}-${m}`);
  if (!cles.size) return 0;
  const T = new Map(await Promise.all([...cles].map(async k => [k, await lireTuile(k)])));
  const dec = k => dispo.get(k) || 0;
  // altitude du fond en (E, N), interpolée entre les quatre cases voisines (décimètres -> mètres ; 0 = pas de donnée)
  const fond = (E, N) => {
    const fe = Math.floor(E / 1000), fn = Math.floor(N / 1000), t = T.get(`${fe}-${fn}`);
    if (!t) return NaN;
    const x = (E - fe * 1000) / pas - 0.5, y = ((fn + 1) * 1000 - N) / pas - 0.5;
    const i = Math.max(0, Math.min(cases - 2, Math.floor(x))), j = Math.max(0, Math.min(cases - 2, Math.floor(y)));
    const u = Math.min(1, Math.max(0, x - i)), v = Math.min(1, Math.max(0, y - j));
    let s = 0, w = 0;
    for (const [di, dj, p] of [[0, 0, (1 - u) * (1 - v)], [1, 0, u * (1 - v)], [0, 1, (1 - u) * v], [1, 1, u * v]]) {
      const z = t[(j + dj) * cases + i + di];
      if (z && p > 0) { s += z * p; w += p; }
    }
    return w > 0.2 ? s / w / 10 - dec(`${fe}-${fn}`) : NaN;
  };
  let nb = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = j * n + i;
    if (isNaN(eau[p])) continue;
    const z = fond(E0 + x0 + (i + 0.5) * c, N0 + x0 + (j + 0.5) * c);
    if (!isNaN(z)) { sol[p] = Math.min(z, eau[p] - 0.1); nb++; }
  }
  return nb;
}

/**
 * Altitude mesurée du fond des lacs autour de (E0, N0), jusqu'à `rayon` : charge les tuiles nécessaires, puis renvoie
 * une fonction (E, N) → altitude (m) ou NaN hors des données. Null s'il n'y a aucune tuile.
 */
export async function fondAutour(E0, N0, rayon) {
  const I = await lireIndex();
  if (!I) return null;
  const dispo = decalages(I), cases = I.cases, pas = I.pas, cles = [];
  for (let e = Math.floor((E0 - rayon) / 1000); e <= Math.floor((E0 + rayon) / 1000); e++)
    for (let m = Math.floor((N0 - rayon) / 1000); m <= Math.floor((N0 + rayon) / 1000); m++) if (dispo.has(`${e}-${m}`)) cles.push(`${e}-${m}`);
  if (!cles.length) return null;
  const T = new Map(await Promise.all(cles.map(async k => [k, await lireTuile(k)])));
  return (E, N) => {
    const fe = Math.floor(E / 1000), fn = Math.floor(N / 1000), t = T.get(`${fe}-${fn}`);
    if (!t) return NaN;
    const i = Math.min(cases - 1, Math.max(0, Math.floor((E - fe * 1000) / pas))), j = Math.min(cases - 1, Math.max(0, Math.floor(((fn + 1) * 1000 - N) / pas)));
    const z = t[j * cases + i];
    return z ? z / 10 - (dispo.get(`${fe}-${fn}`) || 0) : NaN;
  };
}

/** Tuiles de l'index → Map « E-N » → décalage en m (0, ou la valeur après « @ » pour les fonds sous le niveau de la mer). */
function decalages(I) {
  const m = new Map();
  for (const t of I.tuiles) { const [k, d] = t.split("@"); m.set(k, +(d || 0)); }
  return m;
}
