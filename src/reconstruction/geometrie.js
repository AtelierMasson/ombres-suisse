// Outils de géométrie plane pour la reconstruction des bâtiments : anneaux, droites, découpe de polygones convexes.
// Une droite est { nx, ny, d } avec nx² + ny² = 1 : les points (x, y) tels que nx·x + ny·y = d.

export const aireSignee = a => { let s = 0; for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += a[j][0] * a[i][1] - a[i][0] * a[j][1]; return s / 2; };

/** Le point est-il dans le polygone à trous (règle pair-impair sur tous les anneaux) ? */
export function dansAnneaux(anneaux, x, y) {
  let dedans = false;
  for (const a of anneaux) for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const p = a[i], q = a[j];
    if ((p[1] > y) !== (q[1] > y) && x < (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]) + p[0]) dedans = !dedans;
  }
  return dedans;
}

/** Distance du point au bord le plus proche des anneaux. */
export function distanceBord(anneaux, x, y) {
  let d2 = Infinity;
  for (const a of anneaux) for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const p = a[j], q = a[i], ux = q[0] - p[0], uy = q[1] - p[1], l2 = ux * ux + uy * uy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - p[0]) * ux + (y - p[1]) * uy) / l2)) : 0;
    const dx = x - p[0] - t * ux, dy = y - p[1] - t * uy;
    d2 = Math.min(d2, dx * dx + dy * dy);
  }
  return Math.sqrt(d2);
}

/** Boîte [x0, y0, x1, y1] des anneaux. */
export function boite(anneaux) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of anneaux) for (const p of a) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  return [x0, y0, x1, y1];
}

/** Simplification d'un anneau fermé (Douglas-Peucker), puis retrait des sommets presque alignés. */
export function simplifierAnneau(a, tol = 0.2) {
  const n = a.length;
  if (n <= 4) return a.slice();
  // point de départ : le sommet le plus loin du premier (l'anneau est coupé en deux chaînes)
  let k = 0, dmax = -1;
  for (let i = 1; i < n; i++) { const d = Math.hypot(a[i][0] - a[0][0], a[i][1] - a[0][1]); if (d > dmax) { dmax = d; k = i; } }
  const garde = new Uint8Array(n); garde[0] = garde[k] = 1;
  const dp = (i, j) => { // chaîne de i à j (indices modulo n)
    const len = (j - i + n) % n;
    if (len < 2) return;
    const p = a[i], q = a[j], ux = q[0] - p[0], uy = q[1] - p[1], l = Math.hypot(ux, uy) || 1e-9;
    let m = -1, dm = 0;
    for (let s = 1; s < len; s++) {
      const r = a[(i + s) % n], d = Math.abs((r[0] - p[0]) * uy - (r[1] - p[1]) * ux) / l;
      if (d > dm) { dm = d; m = (i + s) % n; }
    }
    if (dm > tol) { garde[m] = 1; dp(i, m); dp(m, j); }
  };
  dp(0, k); dp(k, 0);
  let b = a.filter((_, i) => garde[i]);
  // sommets presque alignés (angle < 4°) ou arêtes minuscules
  for (let change = true; change && b.length > 3;) {
    change = false;
    for (let i = 0; i < b.length && b.length > 3; i++) {
      const p = b[(i + b.length - 1) % b.length], q = b[i], r = b[(i + 1) % b.length];
      const ux = q[0] - p[0], uy = q[1] - p[1], vx = r[0] - q[0], vy = r[1] - q[1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < 0.05 || Math.abs(ux * vy - uy * vx) / (lu * lv || 1) < 0.07) { b.splice(i, 1); change = true; i--; }
    }
  }
  return b;
}

/** Directions des façades : angles (mod π) des côtés de l'emprise pondérés par leur longueur, regroupés à 5° près. */
export function directionsFacades(anneaux, longueurMin = 1.5) {
  const D = [];
  for (const a of anneaux) for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l < longueurMin) continue;
    let t = Math.atan2(q[1] - p[1], q[0] - p[0]);
    t = ((t % Math.PI) + Math.PI) % Math.PI;
    const g = D.find(d => ecartAngle(d.t, t) < 0.09);
    if (g) { g.t = moyenneAngle(g.t, g.l, t, l); g.l += l; } else D.push({ t, l });
  }
  D.sort((u, v) => v.l - u.l);
  // la perpendiculaire de la direction principale est toujours candidate
  if (D.length && !D.some(d => ecartAngle(d.t, D[0].t + Math.PI / 2) < 0.09)) D.push({ t: (D[0].t + Math.PI / 2) % Math.PI, l: 0 });
  return D;
}
/** Écart entre deux directions (mod π), dans [0, π/2]. */
export function ecartAngle(a, b) { const d = Math.abs(((a - b) % Math.PI + Math.PI) % Math.PI); return Math.min(d, Math.PI - d); }
function moyenneAngle(a, la, b, lb) {
  // moyenne pondérée mod π (b ramené près de a)
  while (b - a > Math.PI / 2) b -= Math.PI;
  while (a - b > Math.PI / 2) b += Math.PI;
  const m = (a * la + b * lb) / (la + lb);
  return ((m % Math.PI) + Math.PI) % Math.PI;
}

/** Droite passant par p et q. */
export function droiteParPoints(p, q) {
  const ux = q[0] - p[0], uy = q[1] - p[1], l = Math.hypot(ux, uy);
  const nx = -uy / l, ny = ux / l;
  return normaliserDroite({ nx, ny, d: nx * p[0] + ny * p[1] });
}
/** Signe canonique (nx > 0, ou nx = 0 et ny > 0) : deux droites égales ont la même écriture. */
export function normaliserDroite(L) {
  if (L.nx < -1e-12 || (Math.abs(L.nx) <= 1e-12 && L.ny < 0)) return { nx: -L.nx, ny: -L.ny, d: -L.d };
  return L;
}
/** Deux droites presque confondues sur la zone de rayon `portee` autour de (cx, cy) ? */
export function droitesProches(A, B, angle = 0.05, ecart = 0.3, cx = 0, cy = 0) {
  const dot = A.nx * B.nx + A.ny * B.ny;
  if (Math.abs(dot) < Math.cos(angle)) return false;
  const s = dot < 0 ? -1 : 1;
  return Math.abs((A.d - A.nx * cx - A.ny * cy) - s * (B.d - B.nx * cx - B.ny * cy)) < ecart;
}

/**
 * Découpe un polygone convexe [[x, y], …] par une droite. Les points d'intersection sont calculés à partir des
 * extrémités de l'arête dans un ordre fixe : deux cellules voisines obtiennent exactement le même sommet.
 * @returns {[gauche, droite] | null} null si la droite ne traverse pas le polygone.
 */
export function couperConvexe(P, L, eps = 1e-7) {
  const n = P.length, s = new Float64Array(n);
  let pos = false, neg = false;
  for (let i = 0; i < n; i++) {
    let v = L.nx * P[i][0] + L.ny * P[i][1] - L.d;
    if (Math.abs(v) < eps) v = 0;
    s[i] = v;
    if (v > 0) pos = true; else if (v < 0) neg = true;
  }
  if (!pos || !neg) return null;
  const A = [], B = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, p = P[i], q = P[j];
    if (s[i] >= 0) A.push(p);
    if (s[i] <= 0) B.push(p);
    if ((s[i] > 0 && s[j] < 0) || (s[i] < 0 && s[j] > 0)) {
      // ordre canonique des extrémités
      const inv = p[0] > q[0] || (p[0] === q[0] && p[1] > q[1]);
      const a = inv ? q : p, b = inv ? p : q, sa = inv ? s[j] : s[i], sb = inv ? s[i] : s[j];
      const t = sa / (sa - sb), x = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      A.push(x); B.push(x);
    }
  }
  return [A, B];
}

/**
 * Partition locale d'une boîte par des droites { nx, ny, d, appuis: [[t0, t1], …] } : une droite ne coupe que les
 * cellules qu'elle traverse le long d'un de ses appuis (intervalles du paramètre t = −ny·x + nx·y), au lieu de
 * traverser tout le bâtiment. Chaque arête d'une cellule garde le numéro de sa droite porteuse : un sommet de coupe
 * est l'intersection de deux porteuses (calculée dans un ordre fixe), donc identique dans toutes les cellules.
 * @returns {{ cellules: { P: [x, y][], A: number[] }[], porteuses }} A[i] = porteuse de l'arête P[i] → P[i + 1].
 */
export function partitionLocale(droites, [x0, y0, x1, y1]) {
  const porteuses = [{ nx: 0, ny: 1, d: y0 }, { nx: 1, ny: 0, d: x1 }, { nx: 0, ny: 1, d: y1 }, { nx: 1, ny: 0, d: x0 }];
  let cellules = [{ P: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], A: [0, 1, 2, 3] }];
  for (const L of droites) {
    const id = porteuses.push(L) - 1, suite = [];
    for (const c of cellules) { const d = couperCellule(c, L, id, porteuses); if (d) suite.push(d[0], d[1]); else suite.push(c); }
    cellules = suite;
  }
  return { cellules, porteuses };
}

/**
 * Coupe la cellule { P, A } par la droite L (porteuse n° id) si sa corde recouvre un appui de L (ou toujours si
 * `partout`). @returns {[{ P, A }, { P, A }] | null} côté positif puis côté négatif de la droite.
 */
export function couperCellule(c, L, id, porteuses, partout = false, eps = 1e-7) {
  const P = c.P, n = P.length, s = new Float64Array(n);
  let pos = false, neg = false;
  for (let i = 0; i < n; i++) {
    let v = L.nx * P[i][0] + L.ny * P[i][1] - L.d;
    if (Math.abs(v) < eps) v = 0;
    s[i] = v;
    if (v > 0) pos = true; else if (v < 0) neg = true;
  }
  if (!pos || !neg) return null;
  // corde de la droite dans la cellule : doit recouvrir un appui
  const X = new Array(n);
  let ta = Infinity, tb = -Infinity;
  const voir = p => { const t = -L.ny * p[0] + L.nx * p[1]; if (t < ta) ta = t; if (t > tb) tb = t; };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (s[i] === 0) voir(P[i]);
    else if ((s[i] > 0 && s[j] < 0) || (s[i] < 0 && s[j] > 0)) {
      const a = c.A[i], U = porteuses[Math.min(a, id)], V = porteuses[Math.max(a, id)], det = U.nx * V.ny - U.ny * V.nx;
      if (Math.abs(det) > 1e-3) X[i] = [(U.d * V.ny - V.d * U.ny) / det, (U.nx * V.d - V.nx * U.d) / det];
      else { // porteuses presque parallèles : interpolation sur l'arête, extrémités dans un ordre fixe
        const p = P[i], q = P[j], inv = p[0] > q[0] || (p[0] === q[0] && p[1] > q[1]);
        const u = inv ? q : p, w = inv ? p : q, su = inv ? s[j] : s[i], sw = inv ? s[i] : s[j], t = su / (su - sw);
        X[i] = [u[0] + t * (w[0] - u[0]), u[1] + t * (w[1] - u[1])];
      }
      voir(X[i]);
    }
  }
  let touche = partout;
  if (!touche) for (const a of L.appuis) if (Math.min(tb, a[1]) - Math.max(ta, a[0]) > 1e-4) { touche = true; break; }
  if (!touche) return null;
  const PA = [], AA = [], PB = [], AB = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (s[i] >= 0) { PA.push(P[i]); AA.push(s[i] === 0 && s[j] < 0 ? id : c.A[i]); }
    if (s[i] <= 0) { PB.push(P[i]); AB.push(s[i] === 0 && s[j] > 0 ? id : c.A[i]); }
    if (X[i]) {
      PA.push(X[i]); PB.push(X[i]);
      if (s[i] > 0) { AA.push(id); AB.push(c.A[i]); } else { AA.push(c.A[i]); AB.push(id); }
    }
  }
  if (PA.length < 3 || PB.length < 3) return null;
  return [{ P: PA, A: AA }, { P: PB, A: AB }];
}

/**
 * Raccorde les cellules d'une partition locale : un sommet posé sur l'arête d'une cellule voisine (la coupe s'est
 * arrêtée là) est inséré dans cette arête. Après cela deux cellules voisines partagent des arêtes identiques.
 */
export function raccorderCellules(cellules, porteuses) {
  const cle = p => Math.round(p[0] * 1e5) + ":" + Math.round(p[1] * 1e5), sur = new Map();
  for (const c of cellules) for (let i = 0; i < c.P.length; i++) {
    const a = c.A[i], L = porteuses[a];
    let m = sur.get(a);
    if (!m) sur.set(a, m = new Map());
    for (const p of [c.P[i], c.P[(i + 1) % c.P.length]]) { const k = cle(p); if (!m.has(k)) m.set(k, [-L.ny * p[0] + L.nx * p[1], p]); }
  }
  const tri = new Map();
  for (const [a, m] of sur) tri.set(a, [...m.values()].sort((u, v) => u[0] - v[0]));
  for (const c of cellules) {
    const P = [], A = [];
    for (let i = 0; i < c.P.length; i++) {
      const p = c.P[i], q = c.P[(i + 1) % c.P.length], a = c.A[i], L = porteuses[a], T = tri.get(a);
      const tp = -L.ny * p[0] + L.nx * p[1], tq = -L.ny * q[0] + L.nx * q[1], bas = Math.min(tp, tq) + 2e-5, haut = Math.max(tp, tq) - 2e-5;
      P.push(p); A.push(a);
      if (T.length <= 2 || haut <= bas) continue;
      let g = 0, d = T.length;
      while (g < d) { const m = (g + d) >> 1; if (T[m][0] < bas) g = m + 1; else d = m; }
      const entre = [];
      for (let k = g; k < T.length && T[k][0] <= haut; k++) entre.push(T[k][1]);
      if (tp > tq) entre.reverse();
      for (const r of entre) { P.push(r); A.push(a); }
    }
    c.P = P; c.A = A;
  }
}

/** Centre de gravité d'un polygone. */
export function centroide(P) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const f = P[j][0] * P[i][1] - P[i][0] * P[j][1];
    a += f; cx += (P[j][0] + P[i][0]) * f; cy += (P[j][1] + P[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) { let x = 0, y = 0; for (const p of P) { x += p[0]; y += p[1]; } return [x / P.length, y / P.length]; }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Point dans un polygone convexe orienté trigonométrique. */
export function dansConvexe(P, x, y) {
  for (let i = 0, j = P.length - 1; i < P.length; j = i++)
    if ((P[i][0] - P[j][0]) * (y - P[j][1]) - (P[i][1] - P[j][1]) * (x - P[j][0]) < -1e-9) return false;
  return true;
}
