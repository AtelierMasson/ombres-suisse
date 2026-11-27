// Arbres un par un à partir de la grille du relevé (docs/recherche-arbres.md, étapes A et B), sans dépendance :
// utilisable dans un fil (arbres.worker.js) comme dans node.
//  A. modèle de canopée (MNC) 0,5 m = végétation − sol ; fermeture morphologique (1 m) qui bouche les couronnes
//     trouées des feuillus relevés sans feuilles ; lissage 3 × 3 ; sommets = maxima locaux à fenêtre variable selon la
//     hauteur ; croissance de région depuis les sommets (critères de Dalponte & Coomes 2016 : part de la hauteur du
//     sommet, part de la hauteur moyenne de la couronne, rayon maximal) ; deux couronnes séparées par un col haut sont
//     fusionnées (un grand tilleul ne devient pas trois arbres).
//  B. par arbre : sommet, pied, rayon de couronne sur 8 directions, base de la couronne et type (conifère, feuillu ou
//     indéterminé) par quelques indices simples (élancement, pointe du sommet, densité et répartition des points).
// Réimplémenté d'après les articles (lidR, GPL, n'est pas repris).

/** Champs par arbre dans le tableau de sortie : x, y (m, relatifs), sol, sommet, base de couronne (altitudes), type, 8 rayons. */
export const CHAMPS = 14;
export const TYPE = { indetermine: 0, conifere: 1, feuillu: 2 };

const HMIN = 3; // hauteur minimale d'un arbre (m)

/** Max (ou min) glissant séparable sur une fenêtre carrée de 2r+1 cellules. */
function filtreExtreme(a, n, r, max) {
  const t = new Float32Array(n * n), b = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const o = j * n;
    for (let i = 0; i < n; i++) {
      const x0 = Math.max(0, i - r), x1 = Math.min(n - 1, i + r);
      let v = a[o + x0];
      if (max) { for (let x = x0 + 1; x <= x1; x++) if (a[o + x] > v) v = a[o + x]; }
      else for (let x = x0 + 1; x <= x1; x++) if (a[o + x] < v) v = a[o + x];
      t[o + i] = v;
    }
  }
  for (let j = 0; j < n; j++) {
    const y0 = Math.max(0, j - r), y1 = Math.min(n - 1, j + r);
    for (let i = 0; i < n; i++) {
      let v = t[y0 * n + i];
      if (max) { for (let y = y0 + 1; y <= y1; y++) if (t[y * n + i] > v) v = t[y * n + i]; }
      else for (let y = y0 + 1; y <= y1; y++) if (t[y * n + i] < v) v = t[y * n + i];
      b[j * n + i] = v;
    }
  }
  return b;
}

/** Lissage 3 × 3 (1 2 1), sans étaler la végétation sur le vide : une case vide le reste. */
function lisser(a, n) {
  const b = new Float32Array(n * n), k = [1, 2, 1];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = j * n + i;
    if (!(a[p] > 0)) continue;
    let s = 0, w = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const x = i + di, y = j + dj;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const v = a[y * n + x], q = k[di + 1] * k[dj + 1];
      if (v > 0) { s += v * q; w += q; }
    }
    b[p] = s / w;
  }
  return b;
}

/**
 * File de priorité sur des cellules, la plus haute d'abord, par paliers de 2 cm (listes chaînées : ajout et retrait
 * en temps constant). Une cellule plus haute que le palier en cours y est rangée (traitée tout de suite).
 */
class File {
  constructor(H, N) {
    this.H = H; this.suiv = new Int32Array(N); this.tete = new Int32Array(4096).fill(-1); this.cur = 0; this.n = 0;
  }
  palier(p) { return Math.min(4095, Math.max(0, Math.floor(this.H[p] * 50))); }
  pousser(p, graine = false) {
    let b = this.palier(p);
    if (graine || !this.n) this.cur = Math.max(this.n ? this.cur : 0, b);
    else if (b > this.cur) b = this.cur;
    this.suiv[p] = this.tete[b]; this.tete[b] = p; this.n++;
  }
  tirer() {
    while (this.tete[this.cur] < 0) this.cur--;
    const p = this.tete[this.cur];
    this.tete[this.cur] = this.suiv[p]; this.n--;
    return p;
  }
}

/**
 * Segmentation. `G` = { n, c, x0, sol, veg } (grilles n × n, altitudes absolues, végétation NaN là où il n'y en a
 * pas) ; `pts` (facultatif) = { X, Y, Z } : points de végétation, mêmes coordonnées que la grille (densité, base de
 * couronne, répartition verticale). Retourne { arbres: Float32Array (CHAMPS par arbre), nb, ms, etapes }.
 */
export function segmenterArbres(G, pts = null) {
  const t0 = performance.now(), etapes = {};
  const { n, c, x0, sol, veg } = G, N = n * n;
  // ---- A1. MNC, fermeture (1 m), lissage
  const brut = new Float32Array(N);
  for (let p = 0; p < N; p++) { const h = veg[p] - sol[p]; brut[p] = h > 1 ? h : 0; }
  const rf = Math.max(1, Math.round(1 / c));
  const ferme = filtreExtreme(filtreExtreme(brut, n, rf, true), n, rf, false);
  // la fermeture ne crée pas de végétation loin de tout point (bords de couronne gardés)
  for (let p = 0; p < N; p++) if (!(brut[p] > 0) && ferme[p] < HMIN) ferme[p] = 0;
  const H = lisser(ferme, n);
  etapes.mnc = performance.now() - t0;

  // ---- A2. sommets : maxima locaux, fenêtre (rayon) de 0,6 + 0,08 h, entre 1,5 et 6 m
  const sommets = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = j * n + i, h = H[p];
    if (h < HMIN) continue;
    const r = Math.min(6, Math.max(1.5, 0.6 + 0.08 * h)) / c, rc = Math.ceil(r), r2 = r * r;
    let max = true;
    for (let dj = -rc; dj <= rc && max; dj++) {
      const y = j + dj;
      if (y < 0 || y >= n) continue;
      for (let di = -rc; di <= rc; di++) {
        const x = i + di;
        if (x < 0 || x >= n || di * di + dj * dj > r2) continue;
        const q = y * n + x, v = H[q];
        if (v > h || (v === h && q < p)) { max = false; break; }
      }
    }
    if (max) sommets.push(p);
  }
  etapes.sommets = performance.now() - t0;

  // ---- A3. croissance de région, la plus haute cellule d'abord
  const nb0 = sommets.length, lab = new Int32Array(N).fill(-1);
  const hS = new Float32Array(nb0), som = new Float64Array(nb0), cnt = new Int32Array(nb0), iS = new Int32Array(nb0), jS = new Int32Array(nb0);
  const tas = new File(H, N);
  sommets.forEach((p, t) => { lab[p] = t; hS[t] = H[p]; som[t] = H[p]; cnt[t] = 1; iS[t] = p % n; jS[t] = (p / n) | 0; tas.pousser(p, true); });
  const cols = new Map(); // paire de couronnes voisines -> hauteur du col (le plus haut point de passage)
  const DI = [1, -1, 0, 0, 1, -1, 1, -1], DJ = [0, 0, 1, -1, 1, -1, -1, 1];
  while (tas.n) {
    const p = tas.tirer(), t = lab[p], i = p % n, j = (p / n) | 0;
    const rMax = Math.min(10, Math.max(2, 0.6 * hS[t])) / c;
    for (let e = 0; e < 8; e++) {
      const x = i + DI[e], y = j + DJ[e];
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const q = y * n + x, v = H[q];
      if (v < 2) continue;
      const u = lab[q];
      if (u >= 0) {
        if (u !== t) { const a = Math.min(t, u), b = Math.max(t, u), cle = a * nb0 + b, col = Math.min(H[p], v); if (!(cols.get(cle) >= col)) cols.set(cle, col); }
        continue;
      }
      if (v > hS[t] * 1.05 || v < 0.45 * hS[t] || v < 0.55 * som[t] / cnt[t]) continue;
      if ((x - iS[t]) ** 2 + (y - jS[t]) ** 2 > rMax * rMax) continue;
      lab[q] = t; som[t] += v; cnt[t]++; tas.pousser(q);
    }
  }
  etapes.croissance = performance.now() - t0;

  // ---- A4. fusion des couronnes séparées par un col haut (sommets multiples d'un même feuillu)
  const pere = Int32Array.from({ length: nb0 }, (_, k) => k);
  const racine = k => { while (pere[k] !== k) k = pere[k] = pere[pere[k]]; return k; };
  const aire = Float64Array.from(cnt);
  const paires = [...cols].map(([cle, col]) => [Math.floor(cle / nb0), cle % nb0, col]).sort((a, b) => b[2] - a[2]);
  for (const [a0, b0, col] of paires) {
    const a = racine(a0), b = racine(b0);
    if (a === b) continue;
    const hmin = Math.min(hS[a], hS[b]), hmax = Math.max(hS[a], hS[b]);
    // col à plus de 85 % du plus bas des deux sommets, et une couronne réunie de taille plausible pour sa hauteur
    const rayon = Math.sqrt((aire[a] + aire[b]) * c * c / Math.PI);
    if (col < 0.85 * hmin || rayon > Math.min(12, 0.45 * hmax + 2.5)) continue;
    const [g, p] = hS[a] >= hS[b] ? [a, b] : [b, a];
    pere[p] = g; aire[g] += aire[p];
  }

  // ---- B. par arbre : rayons sur 8 directions, aire, pointe du sommet
  const ray = new Float32Array(nb0 * 8), nbC = new Int32Array(nb0), anneau = new Float64Array(nb0), nbA = new Int32Array(nb0);
  const SECT = Math.PI / 4;
  for (let p = 0; p < N; p++) {
    if (lab[p] < 0) continue;
    const t = racine(lab[p]), dx = (p % n - iS[t]) * c, dy = (((p / n) | 0) - jS[t]) * c, d = Math.hypot(dx, dy);
    lab[p] = t; nbC[t]++;
    const k = ((Math.round(Math.atan2(dy, dx) / SECT) % 8) + 8) % 8;
    if (d + c / 2 > ray[8 * t + k]) ray[8 * t + k] = d + c / 2;
    if (d > 1 && d <= 2) { anneau[t] += H[p]; nbA[t]++; } // hauteur moyenne à 1–2 m du sommet
  }
  // points : nombre par arbre et histogramme des hauteurs relatives (20 classes)
  let hist = null, nbPts = null, totPts = 0, totAire = 0;
  if (pts?.X?.length) {
    hist = new Uint32Array(nb0 * 20); nbPts = new Uint32Array(nb0);
    const { X, Y, Z } = pts;
    for (let k = 0; k < X.length; k++) {
      const i = Math.floor((X[k] - x0) / c), j = Math.floor((Y[k] - x0) / c);
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const t = lab[j * n + i];
      if (t < 0) continue;
      const r = (Z[k] - sol[j * n + i]) / hS[t];
      if (!(r > 0.05)) continue; // sol, herbe
      hist[20 * t + Math.min(19, Math.floor(r * 20))]++; nbPts[t]++;
    }
  }
  const garde = [];
  for (let t = 0; t < nb0; t++) {
    if (racine(t) !== t || hS[t] < HMIN || nbC[t] * c * c < 2) continue;
    garde.push(t);
    if (nbPts) { totPts += nbPts[t]; totAire += nbC[t] * c * c; }
  }
  const densMoy = totAire ? totPts / totAire : 0;
  const out = new Float32Array(garde.length * CHAMPS);
  garde.forEach((t, q) => {
    const o = q * CHAMPS, h = hS[t], p = jS[t] * n + iS[t], z0 = sol[p];
    // rayons : secteurs vides comblés par leurs voisins, adoucis, bornés
    const r = Array.from(ray.subarray(8 * t, 8 * t + 8));
    for (let k = 0; k < 8; k++) if (!r[k]) r[k] = (r[(k + 7) % 8] + r[(k + 1) % 8]) / 2 || c;
    const rl = r.map((v, k) => 0.5 * v + 0.25 * (r[(k + 7) % 8] + r[(k + 1) % 8]));
    const rMoy = Math.sqrt(nbC[t] * c * c / Math.PI);
    // B5. indices : élancement (hauteur / diamètre), pointe (pente moyenne à 1–2 m du sommet), densité et part des
    // points dans le tiers haut (relevé sans feuilles : un conifère est dense et « en surface », un feuillu clairsemé)
    let score = 0;
    const elance = h / (2 * Math.max(0.5, rMoy));
    if (elance > 1.6) score++; else if (elance < 1.0) score--;
    if (nbA[t]) { const pente = (h - anneau[t] / nbA[t]) / 1.5; if (pente > 1.1) score++; else if (pente < 0.45) score--; }
    let base = NaN;
    if (nbPts && nbPts[t] >= 15) {
      const dens = nbPts[t] / (nbC[t] * c * c) / Math.max(1e-6, densMoy);
      if (dens > 1.15) score++; else if (dens < 0.7) score--;
      let haut = 0;
      for (let b = 13; b < 20; b++) haut += hist[20 * t + b];
      const part = haut / nbPts[t];
      if (part > 0.6) score++; else if (part < 0.35) score--;
      // base de couronne : 10e centile des hauteurs relatives des points
      let cumul = 0;
      for (let b = 0; b < 20; b++) { cumul += hist[20 * t + b]; if (cumul >= 0.1 * nbPts[t]) { base = (b + 0.5) / 20; break; } }
    }
    const type = score >= 2 ? TYPE.conifere : score <= -1 ? TYPE.feuillu : TYPE.indetermine;
    const bMin = type === TYPE.conifere ? 0.15 : 0.25, bDef = type === TYPE.conifere ? 0.25 : 0.4;
    base = isNaN(base) ? bDef : Math.min(0.7, Math.max(bMin, base));
    out[o] = x0 + (iS[t] + 0.5) * c; out[o + 1] = x0 + (jS[t] + 0.5) * c;
    out[o + 2] = z0; out[o + 3] = z0 + h; out[o + 4] = z0 + base * h; out[o + 5] = type;
    for (let k = 0; k < 8; k++) out[o + 6 + k] = Math.min(Math.max(0.8, rl[k]), Math.max(2, 0.7 * h + 1));
  });
  etapes.total = performance.now() - t0;
  return { arbres: out, nb: garde.length, ms: etapes.total, etapes };
}

/** Rayon moyen de la couronne de l'arbre `q`. */
export function rayonMoyen(A, q) {
  let s = 0;
  for (let k = 0; k < 8; k++) s += A[q * CHAMPS + 6 + k];
  return s / 8;
}

/** Rayon de la couronne de l'arbre `q` dans la direction `a` (radians, 0 = est, sens trigonométrique, plan x/y). */
export function rayonDirection(A, q, a) {
  const o = q * CHAMPS + 6, f = ((a / (Math.PI / 4)) % 8 + 8) % 8, k = Math.floor(f), u = f - k;
  const r0 = A[o + k], r1 = A[o + (k + 1) % 8], s = u * u * (3 - 2 * u);
  return r0 + (r1 - r0) * s;
}
