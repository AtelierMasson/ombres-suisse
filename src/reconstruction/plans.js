// Détection des pans de toit dans les points « bâtiment » d'une emprise : plan local de chaque point (voisins à moins
// de `rayon`), croissance de régions (normale et distance au plan), fusion des régions presque coplanaires, puis
// régularisation : pentes dans l'axe des façades, toits presque plats rendus horizontaux.
// Un plan est { a, b, c } : z = a·x + b·y + c.

export const OPTIONS_PLANS = {
  rayon: 0.7,          // m : voisinage pour le plan local et la croissance
  angle: 0.30,         // rad (~17°) : écart de normale admis pendant la croissance
  distance: 0.18,      // m : écart vertical admis au plan de la région
  minimum: 25,         // points d'une région pour faire un pan (≈ 1,5 m² à 18 pts/m²)
  fusionAngle: 0.10,   // rad (~6°) : deux régions voisines sont fusionnées en dessous…
  fusionEcart: 0.15,   // … et si l'écart moyen de l'une au plan de l'autre est sous cette valeur (m)
  plat: 0.04,          // pente (m/m) en dessous de laquelle un pan devient horizontal
  axe: 0.21,           // rad (~12°) : pente ramenée dans l'axe d'une façade quand elle en est proche
};

/** Moindres carrés z = a x + b y + c sur les indices I. Retourne { a, b, c, rms } ou null. */
function ajuster(x, y, z, I, x0 = 0, y0 = 0) {
  let n = 0, sx = 0, sy = 0, sz = 0;
  for (const k of I) { sx += x[k] - x0; sy += y[k] - y0; sz += z[k]; n++; }
  if (n < 3) return null;
  const mx = sx / n, my = sy / n, mz = sz / n;
  let xx = 0, xy = 0, yy = 0, xz = 0, yz = 0;
  for (const k of I) {
    const dx = x[k] - x0 - mx, dy = y[k] - y0 - my, dz = z[k] - mz;
    xx += dx * dx; xy += dx * dy; yy += dy * dy; xz += dx * dz; yz += dy * dz;
  }
  const det = xx * yy - xy * xy;
  if (Math.abs(det) < 1e-9) return null;
  const a = (xz * yy - yz * xy) / det, b = (yz * xx - xz * xy) / det, c = mz - a * (mx + x0) - b * (my + y0);
  let r = 0;
  for (const k of I) { const e = z[k] - a * x[k] - b * y[k] - c; r += e * e; }
  return { a, b, c, rms: Math.sqrt(r / n) };
}

/** Grille de recherche des voisins (cases de `pas` m), en tableaux typés. */
export function grilleVoisins(x, y, n, pas) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < n; k++) { x0 = Math.min(x0, x[k]); x1 = Math.max(x1, x[k]); y0 = Math.min(y0, y[k]); y1 = Math.max(y1, y[k]); }
  const nx = Math.max(1, Math.floor((x1 - x0) / pas) + 1), ny = Math.max(1, Math.floor((y1 - y0) / pas) + 1);
  const debut = new Uint32Array(nx * ny + 1), cel = new Uint32Array(n);
  for (let k = 0; k < n; k++) { cel[k] = Math.floor((y[k] - y0) / pas) * nx + Math.floor((x[k] - x0) / pas); debut[cel[k] + 1]++; }
  for (let p = 0; p < nx * ny; p++) debut[p + 1] += debut[p];
  const ordre = new Uint32Array(n), pose = debut.slice(0, nx * ny);
  for (let k = 0; k < n; k++) ordre[pose[cel[k]]++] = k;
  /** Appelle f(j) pour chaque point j à moins de r de (px, py). */
  const autour = (px, py, r, f) => {
    const i0 = Math.max(0, Math.floor((px - r - x0) / pas)), i1 = Math.min(nx - 1, Math.floor((px + r - x0) / pas));
    const j0 = Math.max(0, Math.floor((py - r - y0) / pas)), j1 = Math.min(ny - 1, Math.floor((py + r - y0) / pas)), r2 = r * r;
    for (let j = j0; j <= j1; j++) for (let t = debut[j * nx + i0], fin = debut[j * nx + i1 + 1]; t < fin; t++) {
      const q = ordre[t], dx = x[q] - px, dy = y[q] - py;
      if (dx * dx + dy * dy <= r2) f(q);
    }
  };
  return { autour };
}

/**
 * Pans d'un toit.
 * @param pts { x, y, z, n } points « bâtiment » de l'emprise (Float32Array ou Float64Array)
 * @param directions angles des façades (mod π), du plus important au moins important
 * @returns {{ plans: {a,b,c,n}[], etiquette: Int32Array }} étiquette = numéro de pan de chaque point, −1 = aucun.
 */
export function detecterPlans(pts, directions = [], options = {}) {
  const o = { ...OPTIONS_PLANS, ...options }, { x, y, z, n } = pts;
  const etiquette = new Int32Array(n).fill(-1);
  if (n < o.minimum) return { plans: [], etiquette };
  const V = grilleVoisins(x, y, n, o.rayon);

  // 1. plan local de chaque point
  const ga = new Float32Array(n), gb = new Float32Array(n), res = new Float32Array(n).fill(Infinity);
  const tampon = [];
  for (let k = 0; k < n; k++) {
    tampon.length = 0;
    V.autour(x[k], y[k], o.rayon, q => tampon.push(q));
    if (tampon.length < 6) continue;
    const p = ajuster(x, y, z, tampon, x[k], y[k]);
    if (!p) continue;
    ga[k] = p.a; gb[k] = p.b; res[k] = p.rms;
  }

  // 2. croissance de régions, des points les plus « plans » vers les autres
  const ordre = Array.from({ length: n }, (_, k) => k).filter(k => res[k] < 0.08).sort((u, v) => res[u] - res[v]);
  const cosMax = Math.cos(o.angle), regions = [];
  const normale = (a, b) => { const l = Math.hypot(a, b, 1); return [-a / l, -b / l, 1 / l]; };
  for (const s of ordre) {
    if (etiquette[s] >= 0) continue;
    const id = regions.length, membres = [s];
    etiquette[s] = id;
    let P = { a: ga[s], b: gb[s], c: z[s] - ga[s] * x[s] - gb[s] * y[s] }, Np = normale(P.a, P.b), dernier = 1;
    for (let t = 0; t < membres.length; t++) {
      const k = membres[t];
      V.autour(x[k], y[k], o.rayon * 0.8, q => {
        if (etiquette[q] >= 0 || res[q] === Infinity) return;
        const Nq = normale(ga[q], gb[q]);
        if (Nq[0] * Np[0] + Nq[1] * Np[1] + Nq[2] * Np[2] < cosMax) return;
        if (Math.abs(z[q] - P.a * x[q] - P.b * y[q] - P.c) > o.distance) return;
        etiquette[q] = id; membres.push(q);
      });
      if (membres.length >= 2 * dernier && membres.length >= 10) {
        const F = ajuster(x, y, z, membres);
        if (F) { P = F; Np = normale(P.a, P.b); }
        dernier = membres.length;
      }
    }
    regions.push({ membres, P });
  }
  // régions trop petites : points rendus
  for (const R of regions) if (R.membres.length < o.minimum) { for (const k of R.membres) etiquette[k] = -2; R.mort = true; }

  // 3. fusion des régions voisines presque coplanaires
  let plans = regions.map((R, i) => R.mort ? null : { ...ajuster(x, y, z, R.membres), membres: R.membres, id: i });
  const voisinage = () => {
    const paires = new Map();
    for (let k = 0; k < n; k += 2) { // un point sur deux suffit
      const e = etiquette[k];
      if (e < 0) continue;
      V.autour(x[k], y[k], o.rayon * 0.6, q => {
        const f = etiquette[q];
        if (f >= 0 && f !== e) { const cle = e < f ? e * 100000 + f : f * 100000 + e; paires.set(cle, (paires.get(cle) || 0) + 1); }
      });
    }
    return paires;
  };
  for (let tour = 0; tour < 4; tour++) {
    let fusion = false;
    const paires = [...voisinage()].sort((u, v) => v[1] - u[1]);
    for (const [cle] of paires) {
      const i = Math.floor(cle / 100000), j = cle % 100000, A = plans[i], B = plans[j];
      if (!A || !B) continue;
      const Na = normale(A.a, A.b), Nb = normale(B.a, B.b);
      if (Na[0] * Nb[0] + Na[1] * Nb[1] + Na[2] * Nb[2] < Math.cos(o.fusionAngle)) continue;
      const ecart = (P, M) => { let s = 0; for (const k of M) s += Math.abs(z[k] - P.a * x[k] - P.b * y[k] - P.c); return s / M.length; };
      if (Math.min(ecart(A, B.membres), ecart(B, A.membres)) > o.fusionEcart) continue;
      const M = A.membres.concat(B.membres), F = ajuster(x, y, z, M);
      if (!F) continue;
      plans[i] = { ...F, membres: M, id: i }; plans[j] = null;
      for (const k of B.membres) etiquette[k] = i;
      fusion = true;
    }
    if (!fusion) break;
  }

  // 4. régularisation et renumérotation
  const finals = [], nouveau = new Int32Array(plans.length).fill(-1);
  for (const P of plans) {
    if (!P) continue;
    let { a, b } = P;
    const pente = Math.hypot(a, b);
    if (pente < o.plat) { a = 0; b = 0; }
    else {
      // azimut de la pente (direction de montée) ; direction de façade la plus proche (ou sa perpendiculaire)
      const az = Math.atan2(b, a);
      let meilleur = null, em = o.axe;
      for (const d of directions) for (const t of [d.t, d.t + Math.PI / 2]) {
        const e = Math.abs(Math.atan2(Math.sin(az - t), Math.cos(az - t))), e2 = Math.min(e, Math.PI - e);
        if (e2 < em) { em = e2; meilleur = e < Math.PI / 2 ? t : t + Math.PI; }
      }
      if (meilleur != null) { a = pente * Math.cos(meilleur); b = pente * Math.sin(meilleur); }
    }
    // hauteur : médiane des écarts (robuste aux cheminées et aux points de façade)
    const r = P.membres.map(k => z[k] - a * x[k] - b * y[k]).sort((u, v) => u - v);
    const c = r[Math.floor(r.length / 2)];
    nouveau[P.id] = finals.length;
    finals.push({ a, b, c, n: P.membres.length });
  }
  for (let k = 0; k < n; k++) etiquette[k] = etiquette[k] >= 0 ? nouveau[etiquette[k]] : -1;

  // 5. points restés sans pan : au pan le plus proche en hauteur parmi ceux des voisins (s'il est à moins de 0,3 m)
  const ajout = [];
  for (let k = 0; k < n; k++) {
    if (etiquette[k] >= 0) continue;
    let best = -1, eb = 0.3;
    V.autour(x[k], y[k], o.rayon, q => {
      const e = etiquette[q];
      if (e < 0) return;
      const P = finals[e], d = Math.abs(z[k] - P.a * x[k] - P.b * y[k] - P.c);
      if (d < eb) { eb = d; best = e; }
    });
    if (best >= 0) ajout.push(k, best);
  }
  for (let t = 0; t < ajout.length; t += 2) etiquette[ajout[t]] = ajout[t + 1];
  return { plans: finals, etiquette };
}
