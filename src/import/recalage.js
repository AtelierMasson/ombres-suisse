// Recalage 2D d'un contour fermé sur un autre (limite de parcelle du fichier → limite cadastrale), sans dépendance.
// Similitude T(p) = [a·x − b·y + tx, b·x + a·y + ty] : rotation atan2(b, a), échelle hypot(a, b), sans miroir.
// Méthode : rééchantillonnage des deux contours, recherche du point de départ et du sens (Procrustes / Umeyama en
// nombres complexes, pour chaque décalage), puis affinage ICP point-ligne (moindres carrés pondérés de Huber).

/* ------------------------------------------------------------------ contours */
/** Retire les sommets répétés et le point de fermeture (dernier = premier). */
export function nettoyer(pts, tol = 1e-9) {
  const r = [];
  for (const p of pts) { const q = r[r.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > tol) r.push([p[0], p[1]]); }
  while (r.length > 1 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) <= tol) r.pop();
  return r;
}

/** Aire signée (positive dans le sens inverse des aiguilles d'une montre). */
export function aire(pts) {
  let s = 0;
  for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return s / 2;
}

export function perimetre(pts) {
  let s = 0;
  for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; s += Math.hypot(q[0] - p[0], q[1] - p[1]); }
  return s;
}

/** Compacité P² / (4π A) : 1 pour un disque, invariante par similitude. */
export const compacite = pts => perimetre(pts) ** 2 / (4 * Math.PI * Math.abs(aire(pts)) || 1e-12);

/** `n` points également espacés le long du contour fermé, en partant du premier sommet. */
export function reechantillonner(pts, n) {
  const P = perimetre(pts), pas = P / n, r = [];
  let k = 0, avant = 0; // `avant` : longueur cumulée au début de l'arête k
  for (let i = 0; i < n; i++) {
    const s = i * pas;
    for (;;) {
      const p = pts[k], q = pts[(k + 1) % pts.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (s <= avant + l || k === pts.length - 1) { const f = l ? (s - avant) / l : 0; r.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); break; }
      avant += l; k++;
    }
  }
  return r;
}

/** Applique la similitude. */
export const transformer = (T, [x, y]) => [T.a * x - T.b * y + T.tx, T.b * x + T.a * y + T.ty];

/** T2 ∘ T1. */
const composer = (T2, T1) => ({
  a: T2.a * T1.a - T2.b * T1.b, b: T2.a * T1.b + T2.b * T1.a,
  tx: T2.a * T1.tx - T2.b * T1.ty + T2.tx, ty: T2.b * T1.tx + T2.a * T1.ty + T2.ty,
});

/* ------------------------------------------------------------------ distance à un contour */
/** Point du contour fermé le plus proche de p, avec la normale de l'arête : { d, q, n }. */
function plusProche(p, poly) {
  let best = { d: Infinity };
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length], ux = b[0] - a[0], uy = b[1] - a[1], l2 = ux * ux + uy * uy || 1e-30;
    const f = Math.max(0, Math.min(1, ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / l2));
    const qx = a[0] + ux * f, qy = a[1] + uy * f, d = Math.hypot(p[0] - qx, p[1] - qy);
    if (d < best.d) { const l = Math.sqrt(l2); best = { d, q: [qx, qy], n: [-uy / l, ux / l], coin: f === 0 || f === 1 }; }
  }
  // sur un coin, la normale suit la direction du point (sinon le coin « glisse »)
  if (best.coin && best.d > 1e-9) best.n = [(p[0] - best.q[0]) / best.d, (p[1] - best.q[1]) / best.d];
  return best;
}

/** Écarts (m) entre deux contours, dans les deux sens : moyenne et maximum des distances des points échantillonnés. */
export function ecarts(A, B, n = 400) {
  const d = [];
  for (const [X, Y] of [[A, B], [B, A]]) for (const p of [...X, ...reechantillonner(X, n)]) d.push(plusProche(p, Y).d);
  return { moyen: d.reduce((s, v) => s + v, 0) / d.length, max: Math.max(...d) };
}

/* ------------------------------------------------------------------ appariement grossier */
/**
 * Meilleure similitude par Procrustes pour chaque décalage de départ et chaque sens. Les contours sont rééchantillonnés
 * (N points) ; pour P centré et Q centré, c = Σ conj(p)·q donne la rotation (et l'échelle c / Σ|p|²). Renvoie les
 * meilleures solutions de rotations nettement différentes (symétries de forme), triées.
 */
function grossier(src, dst, N = 128) {
  const P = reechantillonner(src, N), Q = reechantillonner(dst, N);
  const moy = X => [X.reduce((s, p) => s + p[0], 0) / N, X.reduce((s, p) => s + p[1], 0) / N];
  const cp = moy(P), cq = moy(Q), Pc = P.map(p => [p[0] - cp[0], p[1] - cp[1]]), Qc = Q.map(q => [q[0] - cq[0], q[1] - cq[1]]);
  const sp = Pc.reduce((s, p) => s + p[0] ** 2 + p[1] ** 2, 0), sq = Qc.reduce((s, q) => s + q[0] ** 2 + q[1] ** 2, 0);
  const sols = [];
  for (const sens of [1, -1]) for (let k = 0; k < N; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) {
      const p = Pc[((sens * i + k) % N + N) % N], q = Qc[i];
      re += p[0] * q[0] + p[1] * q[1]; im += p[0] * q[1] - p[1] * q[0];
    }
    const c2 = re * re + im * im, residu = 1 - c2 / (sp * sq); // résidu relatif, échelle libre, entre 0 et 1
    sols.push({ residu, a: re / sp, b: im / sp, cp, cq });
  }
  sols.sort((u, v) => u.residu - v.residu);
  const garde = [];
  for (const s of sols) {
    const th = Math.atan2(s.b, s.a);
    if (garde.every(g => Math.abs(Math.atan2(Math.sin(th - g.th), Math.cos(th - g.th))) > 0.17)) garde.push({ ...s, th });
    if (garde.length === 3) break;
  }
  return garde.map(s => ({ residu: s.residu, T: { a: s.a, b: s.b, tx: s.cq[0] - (s.a * s.cp[0] - s.b * s.cp[1]), ty: s.cq[1] - (s.b * s.cp[0] + s.a * s.cp[1]) } }));
}

/* ------------------------------------------------------------------ affinage ICP point-ligne */
/** Résout le système linéaire A x = g (petite taille, pivot de Gauss). */
function resoudre(A, g) {
  const n = g.length, M = A.map((l, i) => [...l, g[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-300) return null;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((l, i) => l[n] / l[i]);
}

/**
 * Affine T en minimisant Σ w·(n·(T(p) − q))² (distance point-ligne au contour cible). Inconnues : petite rotation
 * δθ et petit déplacement autour du centre des points, plus δσ (échelle) si `echelleLibre`. Poids de Huber.
 */
function icp(T, src, dst, echelleLibre, iterations = 60) {
  const pts = [...src, ...reechantillonner(src, 240)];
  for (let it = 0; it < iterations; it++) {
    const P = pts.map(p => transformer(T, p)), proches = P.map(p => plusProche(p, dst));
    const ds = proches.map(r => r.d).sort((u, v) => u - v), seuil = Math.max(3 * ds[ds.length >> 1], 1e-4);
    const c = [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length], n = echelleLibre ? 4 : 3;
    const A = Array.from({ length: n }, () => new Array(n).fill(0)), g = new Array(n).fill(0);
    P.forEach((p, i) => {
      const { q, n: nn, d } = proches[i], w = d <= seuil ? 1 : seuil / d, rx = p[0] - c[0], ry = p[1] - c[1];
      const J = [nn[0] * -ry + nn[1] * rx, nn[0], nn[1], nn[0] * rx + nn[1] * ry].slice(0, n);
      const r = nn[0] * (p[0] - q[0]) + nn[1] * (p[1] - q[1]);
      for (let u = 0; u < n; u++) { g[u] -= w * J[u] * r; for (let v = 0; v < n; v++) A[u][v] += w * J[u] * J[v]; }
    });
    const tr = A.reduce((s, l, i) => s + l[i], 0);
    for (let u = 0; u < n; u++) A[u][u] += 1e-12 * tr; // amortissement minime (contours presque rectilignes)
    const x = resoudre(A, g);
    if (!x) break;
    const [dth, dtx, dty, ds_ = 0] = x, k = 1 + ds_, a = k * Math.cos(dth), b = k * Math.sin(dth);
    // U(p) = k·R(δθ)·(p − c) + c + δt
    const U = { a, b, tx: c[0] - (a * c[0] - b * c[1]) + dtx, ty: c[1] - (b * c[0] + a * c[1]) + dty };
    T = composer(U, T);
    if (Math.abs(dth) < 1e-10 && Math.hypot(dtx, dty) < 1e-7 && Math.abs(ds_) < 1e-10) break;
  }
  return T;
}

/* ------------------------------------------------------------------ appariement complet */
/**
 * Superpose le contour `src` (fichier, en mètres) au contour `dst` (cadastre, coordonnées relatives).
 * `echelle` : null = libre (estimée), sinon valeur imposée (1 = unités sûres).
 * @returns {{ T, rotation (degrés), echelle, ecartMoyen, ecartMax, ambigu, residu }}
 */
export function apparier(src, dst, echelle = null) {
  src = nettoyer(src); dst = nettoyer(dst);
  const essais = grossier(src, dst).map(({ T, residu }) => {
    if (echelle != null) { const k = echelle / Math.hypot(T.a, T.b); T = { ...T, a: T.a * k, b: T.b * k }; }
    // départ grossier, centré de nouveau, puis affinage
    T = icp(T, src, dst, echelle == null);
    const e = ecarts(src.map(p => transformer(T, p)), dst);
    return { T, residu, ecartMoyen: e.moyen, ecartMax: e.max };
  }).sort((u, v) => u.ecartMoyen - v.ecartMoyen);
  const m = essais[0], taille = Math.sqrt(Math.abs(aire(dst)));
  // ambiguïté : une autre orientation (à plus de 10° après affinage) colle presque aussi bien (forme presque symétrique)
  const angle = T => Math.atan2(T.b, T.a), autre = essais.find(e => Math.abs(Math.atan2(Math.sin(angle(e.T) - angle(m.T)), Math.cos(angle(e.T) - angle(m.T)))) > 0.17);
  const ambigu = !!autre && autre.ecartMoyen < Math.max(1.5 * m.ecartMoyen, 0.01 * taille);
  return { ...m, rotation: Math.atan2(m.T.b, m.T.a) * 180 / Math.PI, echelle: Math.hypot(m.T.a, m.T.b), ambigu };
}
