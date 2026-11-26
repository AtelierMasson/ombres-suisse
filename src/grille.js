// Mise en grille 0,5 m : terrain (sol), bâtiments, végétation et surface (le plus haut des trois).
// Indices : i vers l'est, j vers le nord ; la cellule (i, j) couvre [x0 + i·c, x0 + (i+1)·c] (relatif à E0, N0).
import { fromUrl } from "geotiff";
import { t as tr } from "./i18n.js";

export function grilleVide(R, c = 0.5) {
  const n = Math.round(2 * R / c);
  const g = () => new Float32Array(n * n).fill(NaN);
  return { n, c, R, x0: -R, sol: g(), bat: g(), veg: g(), surface: null, classifie: true };
}

/** Points -> grilles (min du sol, max des bâtiments et de la végétation). */
export function depuisPoints(nuage, R, c = 0.5) {
  const G = grilleVide(R, c), { n, sol, bat, veg } = G;
  const { X, Y, Z, C } = nuage, eauZ = new Float32Array(n * n).fill(NaN), pont = G.pont = new Float32Array(n * n).fill(NaN);
  for (let k = 0; k < nuage.n; k++) {
    const i = Math.floor((X[k] + R) / c), j = Math.floor((Y[k] + R) / c);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const p = j * n + i, z = Z[k], cl = C[k];
    if (cl === 2 || cl === 9) { if (!(sol[p] <= z)) sol[p] = z; }
    if (cl === 9 && !(eauZ[p] <= z)) eauZ[p] = z;
    else if (cl === 6) { if (!(bat[p] >= z)) bat[p] = z; }
    else if (cl === 17) { if (!(pont[p] >= z)) pont[p] = z; } // ponts : un tablier, pas un bâtiment plein jusqu'au sol
    else if (cl === 3 || cl === 4 || cl === 5) { if (!(veg[p] >= z)) veg[p] = z; }
  }
  G.eau = plansEau(eauZ, n, c);
  remplir(sol, n);
  // sous l'eau : fond plat un peu sous le niveau (le plan d'eau est dessiné à part)
  for (let p = 0; p < n * n; p++) if (!isNaN(G.eau[p])) sol[p] = Math.min(sol[p], G.eau[p] - 0.3);
  fermer(bat, n, 2); fermer(veg, n, 1); fermer(pont, n, 2);
  for (let p = 0; p < n * n; p++) {
    if (bat[p] < sol[p] + 1.5) bat[p] = NaN;
    if (veg[p] < sol[p] + 1.0) veg[p] = NaN;
    if (pont[p] < sol[p] + 2.5 || !isNaN(bat[p])) pont[p] = NaN; // tablier au ras du sol : c'est la chaussée
  }
  retirerIsoles(pont, n, 3);
  retirerIsoles(bat, n, 3);
  boucherTrous(bat, n, c);
  retirerMats(bat, sol, n, c);
  G.surface = surface(G);
  return G;
}

/** Repli : modèles en grille swissALTI3D (terrain) et swissSURFACE3D Raster (surface) ; pas de classes. */
export async function depuisRasters({ terrain, surface: surf }, [E0, N0], R, c = 0.5, onProgres = () => {}) {
  const G = grilleVide(R, c);
  G.classifie = false;
  const dsm = new Float32Array(G.n * G.n).fill(NaN);
  const lire = async (liste, cible, cle) => {
    for (const [k, t] of liste.entries()) {
      onProgres(k / liste.length, tr(cle, { annee: t.annee }));
      const img = await (await fromUrl(t.url, { maxRanges: 1 })).getImage();
      const [bx0, , , by1] = img.getBoundingBox(), [rx] = img.getResolution();
      const w = img.getWidth(), h = img.getHeight();
      // fenêtre de l'image (lignes depuis le nord) qui recouvre la boîte
      const e0 = E0 - R, n1 = N0 + R;
      const c0 = Math.max(0, Math.floor((e0 - bx0) / rx)), c1 = Math.min(w, Math.ceil((e0 + 2 * R - bx0) / rx));
      const l0 = Math.max(0, Math.floor((by1 - n1) / rx)), l1 = Math.min(h, Math.ceil((by1 - (n1 - 2 * R)) / rx));
      if (c1 <= c0 || l1 <= l0) continue;
      const ras = await lireFenetre(t.url, [c0, l0, c1, l1]);
      for (let l = l0; l < l1; l++) for (let col = c0; col < c1; col++) {
        const E = bx0 + (col + 0.5) * rx, N = by1 - (l + 0.5) * rx;
        const i = Math.floor((E - E0 + R) / c), j = Math.floor((N - N0 + R) / c);
        if (i < 0 || j < 0 || i >= G.n || j >= G.n) continue;
        const v = ras[(l - l0) * (c1 - c0) + (col - c0)];
        if (v > -1000) cible[j * G.n + i] = v;
      }
    }
  };
  await lire(terrain, G.sol, "etat.grilleTerrain");
  await lire(surf, dsm, "etat.grilleSurface");
  remplir(G.sol, G.n); remplir(dsm, G.n);
  // sans classes : tout ce qui dépasse le sol de plus de 2 m est un obstacle, puis on sépare toits (lisses) et arbres (rugueux)
  for (let p = 0; p < G.n * G.n; p++) if (dsm[p] > G.sol[p] + 2) G.bat[p] = dsm[p];
  retirerIsoles(G.bat, G.n, 3);
  boucherTrous(G.bat, G.n, c);
  retirerMats(G.bat, G.sol, G.n, c);
  separerArbres(G);
  G.surface = surface(G);
  return G;
}

/** Surface (obstacles : sol, bâtiments, arbres) ; la base (sol ou toit) sert de point de départ et d'appui à la carte. */
/**
 * Lecture d'une fenêtre d'un COG, avec reprise : le cache HTTP du navigateur renvoie parfois un bloc tronqué
 * (« Offset is outside the bounds of the DataView ») ; on relit alors à une adresse distincte, hors cache.
 */
async function lireFenetre(url, fenetre, essais = 3) {
  for (let k = 1; ; k++) {
    try {
      const u = k === 1 ? url : `${url}?essai=${Date.now()}`;
      const img = await (await fromUrl(u, { maxRanges: 1 })).getImage();
      return (await img.readRasters({ window: fenetre, samples: [0] }))[0];
    } catch (e) {
      if (k >= essais || !(e instanceof RangeError)) throw e;
      await new Promise(r => setTimeout(r, 300 * k));
    }
  }
}

/**
 * Terrain swissALTI3D à 2 m autour de (E0, N0), jusqu'à `rayon` : une grille unique { e0, n1, c, n, h } (lignes depuis
 * le nord, NaN hors couverture). Sert d'anneau intermédiaire entre la maquette et le paysage lointain.
 */
// tuiles swissALTI3D 2 m déjà lues, gardées d'un lieu à l'autre (environ 1 Mo chacune, au plus 80)
const ALTI = new Map();
function lireAlti(url) {
  if (!ALTI.has(url)) {
    const p = (async () => {
      const img = await (await fromUrl(url, { maxRanges: 1 })).getImage();
      const [bx0, , , by1] = img.getBoundingBox();
      return { bx0, by1, w: img.getWidth(), h: img.getHeight(), ras: (await img.readRasters({ samples: [0] }))[0] };
    })();
    p.catch(() => ALTI.delete(url));
    ALTI.set(url, p);
    if (ALTI.size > 80) ALTI.delete(ALTI.keys().next().value);
  }
  return ALTI.get(url);
}

export async function terrainAutour(liste, E0, N0, rayon) {
  const c = 2, n = Math.ceil(2 * rayon / c), e0 = Math.floor((E0 - rayon) / c) * c, n1 = Math.ceil((N0 + rayon) / c) * c;
  const h = new Float32Array(n * n).fill(NaN);
  let i = 0;
  const lire = async () => {
    while (i < liste.length) {
      const t = liste[i++];
      try {
        const { bx0, by1, w, h: hh, ras } = await lireAlti(t.url);
        for (let l = 0; l < hh; l++) {
          const j = Math.round((n1 - (by1 - l * c)) / c);
          if (j < 0 || j >= n) continue;
          for (let col = 0; col < w; col++) {
            const k = Math.round((bx0 + col * c - e0) / c), v = ras[l * w + col];
            if (k >= 0 && k < n && v > -1000) h[j * n + k] = v;
          }
        }
      } catch (e) { console.warn("swissALTI3D 2 m :", t.cle, e.message); }
    }
  };
  await Promise.all([lire(), lire(), lire(), lire()]); // quatre téléchargements à la fois
  return { e0, n1, c, n, h };
}

/** Recalcule la surface et la base après une modification de G.bat (bâtiments masqués en mode pro). */
export function majSurface(G) { G.surface = surface(G); }

function surface(G) {
  const { sol, bat, veg } = G, s = new Float32Array(sol.length);
  G.base = new Float32Array(sol.length);
  for (let p = 0; p < s.length; p++) {
    G.base[p] = Math.max(sol[p], bat[p] || -1e9);
    s[p] = Math.max(G.base[p], veg[p] || -1e9, G.pont?.[p] || -1e9); // le tablier d'un pont fait de l'ombre au-dessous
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

/**
 * Bouche les trous et les puits d'un toit : zones sans point « bâtiment » ou nettement plus basses que le toit qui
 * les entoure (verrières et sheds traversés par le laser, toits sombres ou mouillés, points classés autrement) ;
 * sinon le toit descend jusqu'au sol ou à l'étage. Un creux n'est bouché que s'il est entouré de toit de tous côtés
 * et fait moins de `aireMax` m² : les cours intérieures et les toits plus bas en bordure restent. Le creux prend
 * la hauteur du toit « tendu » par-dessus (fermeture morphologique), à défaut celle de ses bords.
 */
function boucherTrous(a, n, c, aireMax = 30, largeur = 2.5) {
  // fermeture (max puis min sur une fenêtre de ±largeur) : hauteur du toit « tendu » par-dessus les creux étroits
  const N = n * n;
  const filtre = (src, max, horiz, r) => {
    const out = new Float32Array(N);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let m = max ? -Infinity : Infinity;
      for (let k = -r; k <= r; k++) {
        const ii = horiz ? i + k : i, jj = horiz ? j : j + k;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const v = src[jj * n + ii];
        if (v !== v) { if (!max) { m = -Infinity; break; } continue; } // NaN : ignoré pour le max, « bas » pour le min
        if (max ? v > m : v < m) m = v;
      }
      out[j * n + i] = m === -Infinity ? NaN : m;
    }
    return out;
  };
  const fermeture = r => filtre(filtre(filtre(filtre(a, true, true, r), true, false, r), false, true, r), false, false, r);
  // deux fermetures : large (creux jusqu'à ~5 m de large, profonds de plus de 2 m) et étroite (fentes de moins de ~2 m,
  // dès 1,2 m de profondeur : la noue d'un toit à moins de 50° de pente reste en dessous)
  const tendu = fermeture(Math.round(largeur / c)), tenduE = fermeture(Math.round(1 / c));
  const creux = new Uint8Array(N);
  for (let p = 0; p < N; p++) creux[p] = isNaN(a[p]) || tendu[p] - a[p] > 2 || tenduE[p] - a[p] > 1.2 ? 1 : 0;
  const vu = new Uint8Array(N), maxCel = aireMax / (c * c);
  for (let p0 = 0; p0 < N; p0++) {
    if (vu[p0] || !creux[p0]) continue;
    const pile = [p0], m = [];
    vu[p0] = 1;
    let ouvert = false;
    while (pile.length) {
      const p = pile.pop(), i = p % n, j = (p / n) | 0;
      m.push(p);
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) ouvert = true;
      for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, j > 0 ? p - n : -1, j < n - 1 ? p + n : -1])
        if (q >= 0 && !vu[q] && creux[q]) { vu[q] = 1; pile.push(q); }
    }
    if (ouvert || m.length > maxCel) continue;
    // toit « tendu » par-dessus le creux ; là où il manque, de proche en proche depuis le bord
    for (const p of m) a[p] = tendu[p] - a[p] > 2 || isNaN(tenduE[p]) ? tendu[p] : tenduE[p];
    // de proche en proche : chaque passe remplit les cellules qui touchent déjà du toit
    let reste = m.filter(p => isNaN(a[p]));
    while (reste.length) {
      const ajout = [], suite = [];
      for (const p of reste) {
        let s = 0, k = 0;
        for (const q of [p - 1, p + 1, p - n, p + n, p - n - 1, p - n + 1, p + n - 1, p + n + 1]) if (!isNaN(a[q])) { s += a[q]; k++; }
        if (k) ajout.push(p, s / k); else suite.push(p);
      }
      if (!ajout.length) break;
      for (let q = 0; q < ajout.length; q += 2) a[ajout[q]] = ajout[q + 1];
      reste = suite;
    }
  }
}

/**
 * Lacs, étangs, rivières : cellules touchées par des points de classe « eau », trous refermés, regroupées en plans
 * d'eau d'au moins `aireMin` m². Chaque plan reçoit un seul niveau (médiane de ses points, robuste aux vagues et au
 * bruit du laser sur l'eau). Retourne le niveau par cellule (NaN hors de l'eau).
 */
function plansEau(eauZ, n, c, aireMin = 20) {
  const N = n * n, masque = new Float32Array(N).fill(NaN), niveau = new Float32Array(N).fill(NaN);
  for (let p = 0; p < N; p++) if (!isNaN(eauZ[p])) masque[p] = 1;
  fermer(masque, n, 4); // le laser rend peu de points sur l'eau : on referme les trous entre eux
  const vu = new Uint8Array(N);
  for (let p0 = 0; p0 < N; p0++) {
    if (vu[p0] || isNaN(masque[p0])) continue;
    const pile = [p0], m = [], z = [];
    vu[p0] = 1;
    while (pile.length) {
      const p = pile.pop(), i = p % n;
      m.push(p);
      if (!isNaN(eauZ[p])) z.push(eauZ[p]);
      for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
        if (q >= 0 && q < N && !vu[q] && !isNaN(masque[q])) { vu[q] = 1; pile.push(q); }
    }
    if (m.length * c * c < aireMin || z.length < 10) continue;
    z.sort((a, b) => a - b);
    const h = z[Math.floor(z.length / 2)];
    for (const p of m) niveau[p] = h;
  }
  return niveau;
}

/** Supprime les cellules isolées (bruit : antennes, câbles…). */
/** Supprime les « bâtiments » minuscules et très hauts : mâts de grue, cheminées isolées, antennes. */
function retirerMats(bat, sol, n, c) {
  const vu = new Uint8Array(n * n);
  for (let p0 = 0; p0 < n * n; p0++) {
    if (vu[p0] || isNaN(bat[p0])) continue;
    const pile = [p0], membres = [];
    vu[p0] = 1;
    let h = 0;
    while (pile.length) {
      const p = pile.pop(), i = p % n;
      membres.push(p); h = Math.max(h, bat[p] - sol[p]);
      for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
        if (q >= 0 && q < n * n && !vu[q] && !isNaN(bat[q])) { vu[q] = 1; pile.push(q); }
    }
    const aire = membres.length * c * c;
    if (aire < 12 && h > 12 + aire) for (const p of membres) bat[p] = NaN;
  }
}

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
