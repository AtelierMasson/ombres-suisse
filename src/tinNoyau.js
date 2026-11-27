// Noyau du terrain TIN (réseau de triangles irréguliers) : simplification par insertion gloutonne sur une grille de
// hauteurs (méthode de Garland et Heckbert, 1995, « Fast polygonal approximation of terrains and height fields »),
// triangulation de Delaunay incrémentale. Adapté de Delatin (Vladimir Agafonkin, Mapbox, licence ISC), lui-même
// port de « hmm » (Michael Fogleman). Ajouts : cellules ignorées (hors de la maquette ronde) et cellules imposées
// (bord du carré, cercle extérieur), erreur maximale réelle séparée de la priorité.
// Sans dépendance (ni three.js ni DOM) : tourne dans un Web Worker ou sous Node.

const IMPOSE = 1e4; // priorité d'une cellule imposée (bien au-dessus de toute erreur réelle)

function orient(ax, ay, bx, by, cx, cy) { return (bx - cx) * (ay - cy) - (by - cy) * (ax - cx); }
function dansCercle(ax, ay, bx, by, cx, cy, px, py) {
  const dx = ax - px, dy = ay - py, ex = bx - px, ey = by - py, fx = cx - px, fy = cy - py;
  const ap = dx * dx + dy * dy, bp = ex * ex + ey * ey, cp = fx * fx + fy * fy;
  return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0;
}

/**
 * Grille `h` (n × n, lignes vers le nord) ; `masque` (facultatif, n × n) : 0 = cellule ignorée, 1 = normale,
 * 2 = imposée (devient un sommet quoi qu'il arrive).
 */
export class TIN {
  constructor(h, n, masque = null) {
    this.h = h; this.n = n; this.m = masque;
    this.coords = []; this.triangles = [];
    this._demi = []; this._cand = []; this._iFile = []; this._file = []; this._prio = []; this._err = [];
    this._attente = []; this._nAttente = 0;
    const x1 = n - 1, p0 = this._point(0, 0), p1 = this._point(x1, 0), p2 = this._point(0, x1), p3 = this._point(x1, x1);
    const t0 = this._triangle(p3, p0, p2, -1, -1, -1);
    this._triangle(p0, p3, p1, t0, -1, -1);
    this._vider();
  }

  /** Insère des sommets jusqu'à ce que l'écart vertical maximal soit sous `tolerance` (et les cellules imposées prises). */
  calculer(tolerance, maxSommets = Infinity) {
    while (this._file.length && this._prio[0] > tolerance && this.coords.length / 2 < maxSommets) { this._etape(); this._vider(); }
    return this;
  }

  /** Écart vertical maximal restant (cellules non ignorées), en mètres. */
  erreurMax() { let e = 0; for (const t of this._file) e = Math.max(e, this._err[t]); return e; }

  _z(x, y) { return this.h[this.n * y + x]; }

  _vider() {
    const C = this.coords, T = this.triangles;
    for (let i = 0; i < this._nAttente; i++) {
      const t = this._attente[i], a = 2 * T[3 * t], b = 2 * T[3 * t + 1], c = 2 * T[3 * t + 2];
      this._candidat(C[a], C[a + 1], C[b], C[b + 1], C[c], C[c + 1], t);
    }
    this._nAttente = 0;
  }

  // parcourt les cellules du triangle (différences finies sur les coordonnées barycentriques) : la plus éloignée du plan
  _candidat(p0x, p0y, p1x, p1y, p2x, p2y, t) {
    const minX = Math.min(p0x, p1x, p2x), minY = Math.min(p0y, p1y, p2y), maxX = Math.max(p0x, p1x, p2x), maxY = Math.max(p0y, p1y, p2y);
    let w00 = orient(p1x, p1y, p2x, p2y, minX, minY), w01 = orient(p2x, p2y, p0x, p0y, minX, minY), w02 = orient(p0x, p0y, p1x, p1y, minX, minY);
    const a01 = p1y - p0y, b01 = p0x - p1x, a12 = p2y - p1y, b12 = p1x - p2x, a20 = p0y - p2y, b20 = p2x - p0x;
    const a = orient(p0x, p0y, p1x, p1y, p2x, p2y), z0 = this._z(p0x, p0y) / a, z1 = this._z(p1x, p1y) / a, z2 = this._z(p2x, p2y) / a;
    const n = this.n, h = this.h, m = this.m;
    let prio = 0, err = 0, mx = 0, my = 0;
    for (let y = minY; y <= maxY; y++) {
      let dx = 0;
      if (w00 < 0 && a12 !== 0) dx = Math.max(dx, Math.floor(-w00 / a12));
      if (w01 < 0 && a20 !== 0) dx = Math.max(dx, Math.floor(-w01 / a20));
      if (w02 < 0 && a01 !== 0) dx = Math.max(dx, Math.floor(-w02 / a01));
      let w0 = w00 + a12 * dx, w1 = w01 + a20 * dx, w2 = w02 + a01 * dx, dedans = false;
      for (let x = minX + dx; x <= maxX; x++) {
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          dedans = true;
          const k = y * n + x, mk = m ? m[k] : 1;
          if (mk) {
            const dz = Math.abs(z0 * w0 + z1 * w1 + z2 * w2 - h[k]);
            if (dz > err) err = dz;
            let p = dz;
            // cellule imposée qui n'est pas déjà un sommet du triangle
            if (mk === 2 && !(x === p0x && y === p0y || x === p1x && y === p1y || x === p2x && y === p2y)) p += IMPOSE;
            if (p > prio) { prio = p; mx = x; my = y; }
          }
        } else if (dedans) break;
        w0 += a12; w1 += a20; w2 += a01;
      }
      w00 += b12; w01 += b20; w02 += b01;
    }
    if (mx === p0x && my === p0y || mx === p1x && my === p1y || mx === p2x && my === p2y) prio = 0;
    this._cand[2 * t] = mx; this._cand[2 * t + 1] = my; this._err[t] = err;
    this._pousser(t, prio);
  }

  _etape() {
    const t = this._sortir(), T = this.triangles, C = this.coords;
    const e0 = 3 * t, e1 = e0 + 1, e2 = e0 + 2, p0 = T[e0], p1 = T[e1], p2 = T[e2];
    const ax = C[2 * p0], ay = C[2 * p0 + 1], bx = C[2 * p1], by = C[2 * p1 + 1], cx = C[2 * p2], cy = C[2 * p2 + 1];
    const px = this._cand[2 * t], py = this._cand[2 * t + 1], pn = this._point(px, py);
    if (orient(ax, ay, bx, by, px, py) === 0) this._colineaire(pn, e0);
    else if (orient(bx, by, cx, cy, px, py) === 0) this._colineaire(pn, e1);
    else if (orient(cx, cy, ax, ay, px, py) === 0) this._colineaire(pn, e2);
    else {
      const h0 = this._demi[e0], h1 = this._demi[e1], h2 = this._demi[e2];
      const t0 = this._triangle(p0, p1, pn, h0, -1, -1, e0);
      const t1 = this._triangle(p1, p2, pn, h1, -1, t0 + 1);
      const t2 = this._triangle(p2, p0, pn, h2, t0 + 2, t1 + 1);
      this._legaliser(t0); this._legaliser(t1); this._legaliser(t2);
    }
  }

  _point(x, y) { const i = this.coords.length >> 1; this.coords.push(x, y); return i; }

  _triangle(a, b, c, ab, bc, ca, e = this.triangles.length) {
    const t = e / 3, T = this.triangles, D = this._demi;
    T[e] = a; T[e + 1] = b; T[e + 2] = c;
    D[e] = ab; D[e + 1] = bc; D[e + 2] = ca;
    if (ab >= 0) D[ab] = e; if (bc >= 0) D[bc] = e + 1; if (ca >= 0) D[ca] = e + 2;
    this._cand[2 * t] = 0; this._cand[2 * t + 1] = 0; this._iFile[t] = -1; this._err[t] = 0;
    this._attente[this._nAttente++] = t;
    return e;
  }

  // bascule d'arête tant que le critère de Delaunay n'est pas respecté
  _legaliser(a) {
    const D = this._demi, T = this.triangles, C = this.coords, b = D[a];
    if (b < 0) return;
    const a0 = a - a % 3, b0 = b - b % 3, al = a0 + (a + 1) % 3, ar = a0 + (a + 2) % 3, bl = b0 + (b + 2) % 3, br = b0 + (b + 1) % 3;
    const p0 = T[ar], pr = T[a], pl = T[al], p1 = T[bl];
    if (!dansCercle(C[2 * p0], C[2 * p0 + 1], C[2 * pr], C[2 * pr + 1], C[2 * pl], C[2 * pl + 1], C[2 * p1], C[2 * p1 + 1])) return;
    const hal = D[al], har = D[ar], hbl = D[bl], hbr = D[br];
    this._retirer(a0 / 3); this._retirer(b0 / 3);
    const t0 = this._triangle(p0, p1, pl, -1, hbl, hal, a0);
    const t1 = this._triangle(p1, p0, pr, t0, har, hbr, b0);
    this._legaliser(t0 + 1); this._legaliser(t1 + 2);
  }

  // nouveau sommet sur une arête existante
  _colineaire(pn, a) {
    const D = this._demi, T = this.triangles;
    const a0 = a - a % 3, al = a0 + (a + 1) % 3, ar = a0 + (a + 2) % 3;
    const p0 = T[ar], pr = T[a], pl = T[al], hal = D[al], har = D[ar], b = D[a];
    if (b < 0) {
      const t0 = this._triangle(pn, p0, pr, -1, har, -1, a0);
      const t1 = this._triangle(p0, pn, pl, t0, -1, hal);
      this._legaliser(t0 + 1); this._legaliser(t1 + 2);
      return;
    }
    const b0 = b - b % 3, bl = b0 + (b + 2) % 3, br = b0 + (b + 1) % 3, p1 = T[bl], hbl = D[bl], hbr = D[br];
    this._retirer(b0 / 3);
    const t0 = this._triangle(p0, pr, pn, har, -1, -1, a0);
    const t1 = this._triangle(pr, p1, pn, hbr, -1, t0 + 1, b0);
    const t2 = this._triangle(p1, pl, pn, hbl, -1, t1 + 1);
    const t3 = this._triangle(pl, p0, pn, hal, t0 + 2, t2 + 1);
    this._legaliser(t0); this._legaliser(t1); this._legaliser(t2); this._legaliser(t3);
  }

  /* file de priorité (tas binaire, la plus grande priorité en tête) */
  _pousser(t, p) { const i = this._file.length; this._iFile[t] = i; this._file.push(t); this._prio.push(p); this._monter(i); }
  _sortir() { const n = this._file.length - 1; this._echanger(0, n); this._descendre(0, n); return this._dernier(); }
  _dernier() { const t = this._file.pop(); this._prio.pop(); this._iFile[t] = -1; return t; }
  _retirer(t) {
    const i = this._iFile[t];
    if (i < 0) {
      const k = this._attente.indexOf(t);
      if (k === -1 || k >= this._nAttente) throw new Error("TIN : triangulation incohérente");
      this._attente[k] = this._attente[--this._nAttente];
      return;
    }
    const n = this._file.length - 1;
    if (n !== i) { this._echanger(i, n); if (!this._descendre(i, n)) this._monter(i); }
    this._dernier();
  }
  _echanger(i, j) {
    const F = this._file, P = this._prio, pi = F[i], pj = F[j];
    F[i] = pj; F[j] = pi; this._iFile[pi] = j; this._iFile[pj] = i;
    const e = P[i]; P[i] = P[j]; P[j] = e;
  }
  _monter(j) {
    for (;;) { const i = (j - 1) >> 1; if (i === j || i < 0 || !(this._prio[j] > this._prio[i])) break; this._echanger(i, j); j = i; }
  }
  _descendre(i0, n) {
    let i = i0;
    for (;;) {
      const j1 = 2 * i + 1;
      if (j1 >= n || j1 < 0) break;
      const j2 = j1 + 1;
      let j = j1;
      if (j2 < n && this._prio[j2] > this._prio[j1]) j = j2;
      if (!(this._prio[j] > this._prio[i])) break;
      this._echanger(i, j); i = j;
    }
    return i > i0;
  }
}

/**
 * Masque d'une grille n × n de pas `c` (centres des cellules à x0 + (i + 0.5)·c), pour une maquette ronde de rayon
 * `rayon` : cellules au-delà de rayon + 2 m ignorées, et un anneau clairsemé de sommets imposés (tous les ~8 m, à
 * rayon + 0,75 m) : aucun grand triangle ne traverse le cercle (sur un lac plat, par exemple). Sans rayon : null.
 * (Imposer beaucoup de sommets coûte cher : chacun redécoupe de grands triangles au début du calcul.)
 */
export function masqueTIN(n, c, x0, rayon = 0) {
  if (!rayon) return null;
  const m = new Uint8Array(n * n).fill(1);
  const r2 = (rayon + 2) ** 2, cx = i => x0 + (i + 0.5) * c;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (cx(i) ** 2 + cx(j) ** 2 > r2) m[j * n + i] = 0;
  const r = rayon + 0.75, nb = Math.ceil(2 * Math.PI * r / 8);
  for (let k = 0; k < nb; k++) {
    const a = k / nb * 2 * Math.PI, i = Math.floor((Math.cos(a) * r - x0) / c), j = Math.floor((Math.sin(a) * r - x0) / c);
    if (i >= 0 && j >= 0 && i < n && j < n && m[j * n + i]) m[j * n + i] = 2;
  }
  // les quatre coins (sommets de départ) restent : un masque nul ne gêne pas leur usage
  return m;
}

/**
 * Pointes et creux isolés (une cellule plus haute, ou plus basse, que ses huit voisines de plus de `seuil` m) ramenés
 * à la médiane des neuf : reflets, poteaux ou points mal classés. Un mur ou un talus (marche continue) n'est pas
 * touché : ses cellules ne sont jamais un extrême strict de leur voisinage. Retourne le nombre de cellules corrigées.
 */
export function epointer(h, n, seuil = 0.25) {
  const src = h.slice(), w = new Float64Array(9);
  let nb = 0;
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const p = j * n + i, z = src[p];
    let haut = true, bas = true, k = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const v = src[p + b * n + a];
      w[k++] = v;
      if (a || b) { if (v >= z) haut = false; if (v <= z) bas = false; }
    }
    if (!haut && !bas) continue;
    w.sort();
    if (Math.abs(z - w[4]) > seuil) { h[p] = w[4]; nb++; }
  }
  return nb;
}

/**
 * Calcul complet : { coords (Uint16Array/Uint32Array, paires i, j), z (altitude de chaque sommet, après épointage),
 * triangles (Uint32Array), erreurMax, ms, epointees }.
 */
export function calculerTIN({ h, n, tolerance = 0.07, masque = null, maxSommets = Infinity, epointage = 0.25 }) {
  const t0 = performance.now(), epointees = epointage > 0 ? epointer(h, n, epointage) : 0;
  const T = new TIN(h, n, masque).calculer(tolerance, maxSommets);
  const coords = n < 65536 ? Uint16Array.from(T.coords) : Uint32Array.from(T.coords), nv = coords.length / 2, z = new Float32Array(nv);
  for (let k = 0; k < nv; k++) z[k] = h[coords[2 * k + 1] * n + coords[2 * k]];
  // triangles dégénérés (aire nulle) écartés
  const tri = [], C = T.coords, S = T.triangles;
  for (let k = 0; k < S.length; k += 3) {
    const a = S[k], b = S[k + 1], c = S[k + 2];
    if (orient(C[2 * a], C[2 * a + 1], C[2 * b], C[2 * b + 1], C[2 * c], C[2 * c + 1]) !== 0) tri.push(a, b, c);
  }
  return { coords, z, triangles: Uint32Array.from(tri), erreurMax: T.erreurMax(), ms: performance.now() - t0, epointees };
}
