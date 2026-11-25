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
