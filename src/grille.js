// Mise en grille 0,5 m : terrain (sol), bâtiments, végétation et surface (le plus haut des trois).
// Indices : i vers l'est, j vers le nord ; la cellule (i, j) couvre [x0 + i·c, x0 + (i+1)·c] (relatif à E0, N0).
import { fromUrl } from "geotiff";

export function grilleVide(R, c = 0.5) {
  const n = Math.round(2 * R / c);
  const g = () => new Float32Array(n * n).fill(NaN);
  return { n, c, R, x0: -R, sol: g(), bat: g(), veg: g(), surface: null, classifie: true };
}

/** Points -> grilles (min du sol, max des bâtiments et de la végétation). */
export function depuisPoints(nuage, R, c = 0.5) {
  const G = grilleVide(R, c), { n, sol, bat, veg } = G;
  const { X, Y, Z, C } = nuage;
  for (let k = 0; k < nuage.n; k++) {
    const i = Math.floor((X[k] + R) / c), j = Math.floor((Y[k] + R) / c);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const p = j * n + i, z = Z[k], cl = C[k];
    if (cl === 2 || cl === 9) { if (!(sol[p] <= z)) sol[p] = z; }
    else if (cl === 6 || cl === 17) { if (!(bat[p] >= z)) bat[p] = z; }
    else if (cl === 3 || cl === 4 || cl === 5) { if (!(veg[p] >= z)) veg[p] = z; }
  }
  remplir(sol, n);
  fermer(bat, n, 2); fermer(veg, n, 1);
  for (let p = 0; p < n * n; p++) {
    if (bat[p] < sol[p] + 1.5) bat[p] = NaN;
    if (veg[p] < sol[p] + 1.0) veg[p] = NaN;
  }
  retirerIsoles(bat, n, 3);
  G.surface = surface(G);
  return G;
}

/** Repli : modèles en grille swissALTI3D (terrain) et swissSURFACE3D Raster (surface) ; pas de classes. */
export async function depuisRasters({ terrain, surface: surf }, [E0, N0], R, c = 0.5, onProgres = () => {}) {
  const G = grilleVide(R, c);
  G.classifie = false;
  const dsm = new Float32Array(G.n * G.n).fill(NaN);
  const lire = async (liste, cible, nom) => {
    for (const [k, t] of liste.entries()) {
      onProgres(k / liste.length, `${nom} (${t.annee})…`);
      const img = await (await fromUrl(t.url)).getImage();
      const [bx0, , , by1] = img.getBoundingBox(), [rx] = img.getResolution();
      const w = img.getWidth(), h = img.getHeight();
      // fenêtre de l'image (lignes depuis le nord) qui recouvre la boîte
      const e0 = E0 - R, n1 = N0 + R;
      const c0 = Math.max(0, Math.floor((e0 - bx0) / rx)), c1 = Math.min(w, Math.ceil((e0 + 2 * R - bx0) / rx));
      const l0 = Math.max(0, Math.floor((by1 - n1) / rx)), l1 = Math.min(h, Math.ceil((by1 - (n1 - 2 * R)) / rx));
      if (c1 <= c0 || l1 <= l0) continue;
      const [ras] = await img.readRasters({ window: [c0, l0, c1, l1], samples: [0] });
      for (let l = l0; l < l1; l++) for (let col = c0; col < c1; col++) {
        const E = bx0 + (col + 0.5) * rx, N = by1 - (l + 0.5) * rx;
        const i = Math.floor((E - E0 + R) / c), j = Math.floor((N - N0 + R) / c);
        if (i < 0 || j < 0 || i >= G.n || j >= G.n) continue;
        const v = ras[(l - l0) * (c1 - c0) + (col - c0)];
        if (v > -1000) cible[j * G.n + i] = v;
      }
    }
  };
  await lire(terrain, G.sol, "Terrain swissALTI3D");
  await lire(surf, dsm, "Surface swissSURFACE3D");
  remplir(G.sol, G.n); remplir(dsm, G.n);
  // sans classes : tout ce qui dépasse le sol de plus de 2 m est un obstacle, puis on sépare toits (lisses) et arbres (rugueux)
  for (let p = 0; p < G.n * G.n; p++) if (dsm[p] > G.sol[p] + 2) G.bat[p] = dsm[p];
  retirerIsoles(G.bat, G.n, 3);
  separerArbres(G);
  G.surface = surface(G);
  return G;
}

/** Surface (obstacles : sol, bâtiments, arbres) ; la base (sol ou toit) sert de point de départ et d'appui à la carte. */
function surface(G) {
  const { sol, bat, veg } = G, s = new Float32Array(sol.length);
  G.base = new Float32Array(sol.length);
  for (let p = 0; p < s.length; p++) {
    G.base[p] = Math.max(sol[p], bat[p] || -1e9);
    s[p] = Math.max(G.base[p], veg[p] || -1e9);
  }
  return s;
}

/**
 * Sépare les arbres des bâtiments quand le relevé n'a pas de classes : par groupe d'obstacles connexes,
 * la part de cellules « rugueuses » (courbure forte) décide. Un toit est fait de pans lisses, une couronne d'arbre non.
 */
function separerArbres(G) {
  const { n, bat, veg } = G, rugueux = new Uint8Array(n * n), groupe = new Int32Array(n * n).fill(-1);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const p = j * n + i;
    if (isNaN(bat[p])) continue;
    const v = [bat[p - 1], bat[p + 1], bat[p - n], bat[p + n]];
    if (v.some(isNaN)) continue; // bord : non décidé
    rugueux[p] = Math.abs(4 * bat[p] - v[0] - v[1] - v[2] - v[3]) > 0.8 ? 2 : 1;
  }
  let g = 0;
  for (let p0 = 0; p0 < n * n; p0++) {
    if (isNaN(bat[p0]) || groupe[p0] >= 0) continue;
    const pile = [p0], membres = [];
    groupe[p0] = g;
    let r = 0, l = 0;
    while (pile.length) {
      const p = pile.pop(), i = p % n;
      membres.push(p);
      if (rugueux[p] === 2) r++; else if (rugueux[p] === 1) l++;
      for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
        if (q >= 0 && q < n * n && groupe[q] < 0 && !isNaN(bat[q])) { groupe[q] = g; pile.push(q); }
    }
    if (r > 0.45 * (r + l)) for (const p of membres) { veg[p] = bat[p]; bat[p] = NaN; }
    g++;
  }
}

/** Bouche les trous du terrain (sous les bâtiments, les arbres) par une pyramide de moyennes. */
function remplir(a, n) {
  if (n <= 1) { if (isNaN(a[0])) a[0] = 0; return; }
  const m = Math.ceil(n / 2), b = new Float32Array(m * m).fill(NaN);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    let s = 0, k = 0;
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
      const x = 2 * i + di, y = 2 * j + dj;
      if (x < n && y < n && !isNaN(a[y * n + x])) { s += a[y * n + x]; k++; }
    }
    if (k) b[j * m + i] = s / k;
  }
  if (b.some(isNaN)) remplir(b, m);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++)
    if (isNaN(a[j * n + i])) a[j * n + i] = b[(j >> 1) * m + (i >> 1)];
}

/** Ferme les petits trous (cellules sans point entourées de cellules pleines). */
function fermer(a, n, passes) {
  for (let t = 0; t < passes; t++) {
    const ajout = [];
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const p = j * n + i;
      if (!isNaN(a[p])) continue;
      let s = 0, k = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const v = a[p + dj * n + di];
        if (!isNaN(v)) { s += v; k++; }
      }
      if (k >= 5) ajout.push(p, s / k);
    }
    for (let q = 0; q < ajout.length; q += 2) a[ajout[q]] = ajout[q + 1];
  }
}

/** Supprime les cellules isolées (bruit : antennes, câbles…). */
function retirerIsoles(a, n, min) {
  const out = [];
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const p = j * n + i;
    if (isNaN(a[p])) continue;
    let k = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && !isNaN(a[p + dj * n + di])) k++;
    if (k < min) out.push(p);
  }
  for (const p of out) a[p] = NaN;
}

/** Hauteur du sol au point (x, y) relatif, interpolée. */
export function solEn(G, x, y) {
  const fi = (x - G.x0) / G.c - 0.5, fj = (y - G.x0) / G.c - 0.5;
  const i = Math.max(0, Math.min(G.n - 2, Math.floor(fi))), j = Math.max(0, Math.min(G.n - 2, Math.floor(fj)));
  const u = Math.min(1, Math.max(0, fi - i)), v = Math.min(1, Math.max(0, fj - j)), n = G.n, s = G.sol;
  return (s[j * n + i] * (1 - u) + s[j * n + i + 1] * u) * (1 - v) + (s[(j + 1) * n + i] * (1 - u) + s[(j + 1) * n + i + 1] * u) * v;
}
