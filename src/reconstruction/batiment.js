// Reconstruction d'un bâtiment (LoD2) à partir de son emprise officielle et des points du nuage :
//  1. pans du toit (plans.js) ;
//  2. carte des pans sur une grille de 0,5 m dans l'emprise (vote des points, trous comblés, filtre de mode),
//     zones de sol vues à travers l'emprise (cours, passages) retirées ;
//  3. droites candidates : côtés de l'emprise, intersections de pans voisins (faîtages, noues, arêtiers),
//     ressauts entre pans de hauteurs différentes (droites dans l'axe des façades, ajustées sur la limite des pans) ;
//  4. partition de l'emprise par ces droites (cellules convexes, sommets partagés exactement) ;
//  5. chaque cellule prend le pan majoritaire de la carte ; cellules voisines du même pan réunies en un polygone ;
//  6. murs extérieurs (du sol au toit, le long de l'emprise) et murs de ressaut entre pans.
// Repli : LoD1.2 (emprise extrudée à la hauteur médiane du toit) si aucun pan n'est trouvé ou si le modèle s'écarte
// trop des points. Code écrit pour ce projet, sans reprise de code tiers.
import {
  dansAnneaux, distanceBord, boite, simplifierAnneau, directionsFacades, aireSignee, droiteParPoints, normaliserDroite,
  droitesProches, couperConvexe, centroide, dansConvexe,
} from "./geometrie.js";
import { detecterPlans } from "./plans.js";

export const OPTIONS_BATIMENT = {
  cellule: 0.5,        // m : grille de la carte des pans
  margeSol: 3,         // m : les points de sol à cette distance de l'emprise donnent le pied des murs
  tolerance: 0.2,      // m : simplification de l'emprise
  solMin: 4,           // m² : zone de sol vue dans l'emprise en dessous de laquelle elle est ignorée
  appuiMin: 4,         // cellules de limite entre deux pans pour chercher une droite
  maxDroites: 90,      // droites au plus (partition)
  qualiteMin: 0.35,    // part des points de toit à moins de 0,5 m du modèle en dessous de laquelle on se replie
};

const centile = (v, f) => v[Math.min(v.length - 1, Math.max(0, Math.floor(f * v.length)))];
const r3 = v => Math.round(v * 1000) / 1000;

/** Emprise extrudée (LoD1.2). */
export function extruder(anneaux, zSol, zToit) {
  const P = [{ t: "toit", r: anneaux.map(a => a.map(p => [r3(p[0]), r3(p[1]), r3(zToit)])) }];
  for (const a of anneaux) for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    P.push({ t: "mur", r: [[[r3(p[0]), r3(p[1]), r3(zToit)], [r3(p[0]), r3(p[1]), r3(zSol)], [r3(q[0]), r3(q[1]), r3(zSol)], [r3(q[0]), r3(q[1]), r3(zToit)]]] });
  }
  return P;
}

/**
 * @param bat { id, anneaux, x, y, z, c, zSol? } : emprise (coordonnées relatives à l'origine, extérieur trigonométrique)
 *   et points candidats (classes 2 et 6) de la boîte de l'emprise élargie de margeSol.
 * @returns {{ id, niveau: "LoD2"|"LoD1.2"|null, polygones, zSol, zToit, plans, qualite, ms, motif }}
 */
export function reconstruireBatiment(bat, options = {}) {
  const o = { ...OPTIONS_BATIMENT, ...options }, t0 = performance.now();
  const R = { id: bat.id, niveau: null, polygones: [], zSol: NaN, zToit: NaN, plans: 0, qualite: NaN, ms: 0, motif: "" };
  // emprise simplifiée ; petits trous retirés
  const anneaux = bat.anneaux.map(a => simplifierAnneau(a, o.tolerance)).filter((a, k) => a.length >= 3 && (k === 0 || Math.abs(aireSignee(a)) > 2));
  if (!anneaux.length || aireSignee(anneaux[0]) <= 0) { R.motif = "emprise invalide"; return fin(R, t0); }

  // tri des points
  const { x, y, z, c } = bat, nb = x.length;
  const tx = [], ty = [], tz = [], pied = [], solDedans = [];
  for (let k = 0; k < nb; k++) {
    const dedans = dansAnneaux(anneaux, x[k], y[k]);
    if (c[k] === 6) { if (dedans) { tx.push(x[k]); ty.push(y[k]); tz.push(z[k]); } }
    else if (c[k] === 2) {
      if (dedans) { pied.push(z[k]); solDedans.push(k); }
      else if (distanceBord(anneaux, x[k], y[k]) <= o.margeSol) pied.push(z[k]);
    }
  }
  const nT = tx.length, hauts = tz.slice().sort((u, v) => u - v);
  pied.sort((u, v) => u - v);
  R.zSol = pied.length >= 3 ? centile(pied, 0.05) : Number.isFinite(bat.zSol) ? bat.zSol : hauts.length ? hauts[0] - 3 : NaN;
  if (nT < 10 || !Number.isFinite(R.zSol)) { R.motif = "trop peu de points de toit"; return fin(R, t0); }
  R.zToit = centile(hauts, 0.5);
  const zMax = hauts[nT - 1];
  const repli = motif => { R.niveau = "LoD1.2"; R.motif = motif; R.polygones = extruder(anneaux, R.zSol, R.zToit); return fin(R, t0); };

  const directions = directionsFacades(anneaux);
  const pts = { x: Float64Array.from(tx), y: Float64Array.from(ty), z: Float64Array.from(tz), n: nT };
  const { plans, etiquette } = detecterPlans(pts, directions, o.plans);
  R.plans = plans.length;
  if (!plans.length) return repli("aucun pan");

  // 2. carte des pans
  const cs = o.cellule, [bx0, by0, bx1, by1] = boite(anneaux);
  const gx0 = bx0 - cs, gy0 = by0 - cs, nx = Math.ceil((bx1 - gx0) / cs) + 1, ny = Math.ceil((by1 - gy0) / cs) + 1, N = nx * ny;
  const EXT = -3, SOL = -2, INC = -1;
  const lab = new Int32Array(N).fill(EXT);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++)
    if (dansAnneaux(anneaux, gx0 + (i + 0.5) * cs, gy0 + (j + 0.5) * cs)) lab[j * nx + i] = INC;
  const cel = (px, py) => { const i = Math.floor((px - gx0) / cs), j = Math.floor((py - gy0) / cs); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
  const votes = new Map(), a6 = new Uint8Array(N), aSol = new Uint8Array(N);
  for (let k = 0; k < nT; k++) {
    const p = cel(tx[k], ty[k]);
    if (p < 0) continue;
    a6[p] = 1;
    if (etiquette[k] >= 0) { const cle = p * 4096 + etiquette[k]; votes.set(cle, (votes.get(cle) || 0) + 1); }
  }
  for (const k of solDedans) { const p = cel(x[k], y[k]); if (p >= 0) aSol[p] = 1; }
  const meilleur = new Float32Array(N);
  for (const [cle, v] of votes) { const p = Math.floor(cle / 4096); if (lab[p] !== EXT && v > meilleur[p]) { meilleur[p] = v; lab[p] = cle % 4096; } }
  // sol vu dans l'emprise : cellules avec du sol et sans point de toit autour
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const p = j * nx + i;
    if (lab[p] !== INC || !aSol[p]) continue;
    let toit = false;
    for (let dj = -1; dj <= 1 && !toit; dj++) for (let di = -1; di <= 1; di++) if (a6[p + dj * nx + di]) { toit = true; break; }
    if (!toit) lab[p] = SOL;
  }
  composantes(lab, nx, ny, SOL, (m) => { if (m.length * cs * cs < o.solMin) for (const p of m) lab[p] = INC; });
  // trous comblés de proche en proche (une case qui a des points « bâtiment » ne prend pas le sol)
  let reste = [];
  for (let p = 0; p < N; p++) if (lab[p] === INC) reste.push(p);
  while (reste.length) {
    const ajout = [], suite = [];
    for (const p of reste) {
      const i = p % nx, cpt = new Map();
      for (const q of [i > 0 ? p - 1 : -1, i < nx - 1 ? p + 1 : -1, p - nx, p + nx]) if (q >= 0 && q < N && lab[q] >= (a6[p] ? 0 : SOL)) cpt.set(lab[q], (cpt.get(lab[q]) || 0) + 1);
      if (cpt.size) ajout.push(p, [...cpt].sort((u, v) => v[1] - u[1])[0][0]); else suite.push(p);
    }
    if (!ajout.length) break;
    for (let t = 0; t < ajout.length; t += 2) lab[ajout[t]] = ajout[t + 1];
    reste = suite;
  }
  if (reste.length) for (const p of reste) lab[p] = SOL;
  // filtre de mode 3 × 3
  const lab2 = lab.slice();
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const p = j * nx + i;
    if (lab[p] < SOL) continue;
    const cpt = new Map();
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const v = lab[p + dj * nx + di]; if (v >= SOL) cpt.set(v, (cpt.get(v) || 0) + (di || dj ? 1 : 1.5)); }
    const [v, k] = [...cpt].sort((u, w) => w[1] - u[1])[0];
    if (v !== lab[p] && k >= 4.5) lab2[p] = v;
  }
  lab.set(lab2);

  // qualité : points de toit à moins de 0,5 m du pan de leur cellule
  let bons = 0;
  for (let k = 0; k < nT; k++) {
    const p = cel(tx[k], ty[k]), e = p >= 0 ? lab[p] : -1;
    if (e >= 0 && Math.abs(tz[k] - plans[e].a * tx[k] - plans[e].b * ty[k] - plans[e].c) < 0.5) bons++;
  }
  R.qualite = bons / nT;
  if (R.qualite < o.qualiteMin) return repli(`modèle trop éloigné des points (${Math.round(100 * R.qualite)} %)`);

  // 3. droites candidates
  const [cx, cy] = [(bx0 + bx1) / 2, (by0 + by1) / 2];
  const emprise = [];
  for (const a of anneaux) for (let i = 0; i < a.length; i++) {
    const L = droiteParPoints(a[i], a[(i + 1) % a.length]);
    if (!emprise.some(M => droitesProches(M, L, 1e-4, 1e-3, cx, cy))) emprise.push(L);
  }
  const limites = new Map(); // paire de pans -> points milieux de la limite
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = j * nx + i, u = lab[p];
    if (u < SOL) continue;
    for (const [q, mx, my] of [[i < nx - 1 ? p + 1 : -1, (i + 1) * cs, (j + 0.5) * cs], [j < ny - 1 ? p + nx : -1, (i + 0.5) * cs, (j + 1) * cs]]) {
      if (q < 0) continue;
      const v = lab[q];
      if (v < SOL || v === u) continue;
      const cle = Math.min(u, v) + "," + Math.max(u, v);
      if (!limites.has(cle)) limites.set(cle, []);
      limites.get(cle).push([gx0 + mx, gy0 + my]);
    }
  }
  const toit = [];
  for (const [cle, M] of limites) {
    if (M.length < o.appuiMin) continue;
    const [u, v] = cle.split(",").map(Number);
    if (u >= 0 && v >= 0) {
      const A = plans[u], B = plans[v], da = A.a - B.a, db = A.b - B.b, g = Math.hypot(da, db);
      if (g > 0.08) {
        const L = normaliserDroite({ nx: da / g, ny: db / g, d: -(A.c - B.c) / g });
        let s = 0;
        for (const m of M) s += Math.abs(L.nx * m[0] + L.ny * m[1] - L.d);
        if (s / M.length < 0.6) { toit.push({ L, appui: M.length }); continue; }
      }
    }
    for (const L of droitesRessaut(M, directions, o.appuiMin)) toit.push(L);
  }
  toit.sort((u, v) => v.appui - u.appui);
  const droites = emprise.slice();
  for (const { L } of toit) {
    if (droites.length >= o.maxDroites) break;
    if (!droites.some(M => droitesProches(M, L, 0.05, 0.3, cx, cy))) droites.push(L);
  }

  // 4. partition (cellules convexes) de la boîte de l'emprise
  let cellules = [[[bx0 - 1, by0 - 1], [bx1 + 1, by0 - 1], [bx1 + 1, by1 + 1], [bx0 - 1, by1 + 1]]];
  for (const L of droites) {
    const suite = [];
    for (const P of cellules) { const d = couperConvexe(P, L); if (d) suite.push(d[0], d[1]); else suite.push(P); }
    cellules = suite;
  }
  // 5. pan de chaque cellule (vote des cases de la carte dont le centre est dedans)
  const C = [];
  for (const P of cellules) {
    if (P.length < 3 || aireSignee(P) < 1e-4) continue;
    const [gx, gy] = centroide(P);
    if (!dansAnneaux(anneaux, gx, gy)) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const cpt = new Map();
    for (let j = Math.max(0, Math.floor((y0 - gy0) / cs)); j <= Math.min(ny - 1, Math.floor((y1 - gy0) / cs)); j++)
      for (let i = Math.max(0, Math.floor((x0 - gx0) / cs)); i <= Math.min(nx - 1, Math.floor((x1 - gx0) / cs)); i++) {
        const v = lab[j * nx + i];
        if (v >= SOL && dansConvexe(P, gx0 + (i + 0.5) * cs, gy0 + (j + 0.5) * cs)) cpt.set(v, (cpt.get(v) || 0) + 1);
      }
    let e;
    if (cpt.size) e = [...cpt].sort((u, v) => v[1] - u[1])[0][0];
    else e = etiquetteProche(lab, nx, ny, Math.floor((gx - gx0) / cs), Math.floor((gy - gy0) / cs), SOL);
    if (e >= 0) C.push({ P, e });
  }
  if (!C.length) return repli("partition vide");

  // 6. polygones des toits et murs
  const zPlan = (e, px, py) => Math.min(zMax + 0.5, Math.max(R.zSol + 0.5, plans[e].a * px + plans[e].b * py + plans[e].c));
  R.polygones = polygonesToitsMurs(C, zPlan, R.zSol);
  R.niveau = "LoD2";
  return fin(R, t0);
}

function fin(R, t0) { R.ms = performance.now() - t0; return R; }

/** Composantes 4-connexes de valeur v dans la grille : f(membres). */
function composantes(lab, nx, ny, v, f) {
  const vu = new Uint8Array(nx * ny);
  for (let p0 = 0; p0 < nx * ny; p0++) {
    if (vu[p0] || lab[p0] !== v) continue;
    const pile = [p0], m = [];
    vu[p0] = 1;
    while (pile.length) {
      const p = pile.pop(), i = p % nx;
      m.push(p);
      for (const q of [i > 0 ? p - 1 : -1, i < nx - 1 ? p + 1 : -1, p - nx, p + nx])
        if (q >= 0 && q < nx * ny && !vu[q] && lab[q] === v) { vu[q] = 1; pile.push(q); }
    }
    f(m);
  }
}

function etiquetteProche(lab, nx, ny, i, j, min) {
  for (let r = 0; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const ii = i + di, jj = j + dj;
    if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && lab[jj * nx + ii] >= min) return lab[jj * nx + ii];
  }
  return -3;
}

/**
 * Droites de ressaut le long d'une limite entre deux zones : pour chaque direction de façade, histogramme des
 * positions des points de la limite ; le pic le plus fourni donne une droite, ses points sont retirés, et ainsi de
 * suite (une limite en L donne deux droites).
 */
function droitesRessaut(M, directions, appuiMin) {
  const R = [];
  let reste = M.slice();
  for (let tour = 0; tour < 4 && reste.length >= appuiMin; tour++) {
    let best = null;
    for (const d of directions) {
      const nx_ = -Math.sin(d.t), ny_ = Math.cos(d.t), pas = 0.3, H = new Map();
      for (const m of reste) { const b = Math.round((nx_ * m[0] + ny_ * m[1]) / pas); H.set(b, (H.get(b) || 0) + 1); }
      for (const [b, v] of H) {
        const s = v + (H.get(b - 1) || 0) + (H.get(b + 1) || 0);
        if (!best || s > best.s) best = { s, nx: nx_, ny: ny_, o: b * pas };
      }
    }
    if (!best || best.s < appuiMin) break;
    const pres = reste.filter(m => Math.abs(best.nx * m[0] + best.ny * m[1] - best.o) <= 0.45);
    const o = pres.map(m => best.nx * m[0] + best.ny * m[1]).sort((u, v) => u - v)[Math.floor(pres.length / 2)];
    R.push({ L: normaliserDroite({ nx: best.nx, ny: best.ny, d: o }), appui: pres.length });
    reste = reste.filter(m => Math.abs(best.nx * m[0] + best.ny * m[1] - best.o) > 0.45);
  }
  return R;
}

/**
 * Cellules étiquetées -> polygones de toit (cellules voisines du même pan réunies) et murs.
 * Les sommets des cellules sont partagés exactement : on reconnaît une arête commune à ses deux extrémités.
 */
function polygonesToitsMurs(C, zPlan, zSol) {
  const cle = p => Math.round(p[0] * 1e5) + ":" + Math.round(p[1] * 1e5);
  const proprio = new Map();
  C.forEach((c, i) => {
    c.k = c.P.map(cle);
    for (let s = 0; s < c.P.length; s++) proprio.set(c.k[s] + "|" + c.k[(s + 1) % c.P.length], i);
  });
  // union des cellules voisines du même pan
  const parent = C.map((_, i) => i), racine = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  C.forEach((c, i) => {
    for (let s = 0; s < c.P.length; s++) {
      const j = proprio.get(c.k[(s + 1) % c.P.length] + "|" + c.k[s]);
      if (j != null && C[j].e === c.e) { const a = racine(i), b = racine(j); if (a !== b) parent[a] = b; }
    }
  });
  // arêtes de bord de chaque groupe, avec la cellule voisine (−1 : extérieur)
  const groupes = new Map();
  C.forEach((c, i) => {
    const g = racine(i);
    if (!groupes.has(g)) groupes.set(g, { e: c.e, aretes: [] });
    for (let s = 0; s < c.P.length; s++) {
      const s2 = (s + 1) % c.P.length, j = proprio.get(c.k[s2] + "|" + c.k[s]);
      if (j != null && racine(j) === g) continue;
      groupes.get(g).aretes.push({ a: c.k[s], b: c.k[s2], pa: c.P[s], pb: c.P[s2], voisin: j == null ? -1 : j });
    }
  });
  const polygones = [], murs = [];
  for (const { e, aretes } of groupes.values()) {
    // chaînage en anneaux
    const depart = new Map();
    for (const A of aretes) { if (!depart.has(A.a)) depart.set(A.a, []); depart.get(A.a).push(A); }
    const anneaux = [], utilise = new Set();
    for (const A0 of aretes) {
      if (utilise.has(A0)) continue;
      const anneau = [];
      for (let A = A0; A && !utilise.has(A);) {
        utilise.add(A); anneau.push(A);
        A = (depart.get(A.b) || []).find(B => !utilise.has(B));
      }
      if (anneau.length >= 3) anneaux.push(anneau);
    }
    // toit : anneaux extérieurs (sens trigonométrique) et leurs trous
    const ext = [], trous = [];
    for (const an of anneaux) {
      const pts = sansAlignes(an.map(A => A.pa));
      if (pts.length < 3) continue;
      (aireSignee(pts) > 0 ? ext : trous).push(pts);
    }
    for (const E of ext) {
      const mesTrous = ext.length === 1 ? trous : trous.filter(T => dansAnneaux([E], T[0][0] * 0.999 + T[1][0] * 0.001, T[0][1] * 0.999 + T[1][1] * 0.001));
      polygones.push({ t: "toit", r: [E, ...mesTrous].map(a => a.map(p => [r3(p[0]), r3(p[1]), r3(zPlan(e, p[0], p[1]))])) });
    }
    // murs : suites d'arêtes alignées qui ont le même voisin (extérieur, ou même pan voisin)
    for (const an of anneaux) {
      const voisinDe = A => A.voisin < 0 ? -1 : C[A.voisin].e;
      const dir = A => Math.atan2(A.pb[1] - A.pa[1], A.pb[0] - A.pa[0]);
      const meme = (A, B) => voisinDe(A) === voisinDe(B) && Math.abs(Math.sin(dir(A) - dir(B))) < 1e-3 && Math.cos(dir(A) - dir(B)) > 0;
      let debut = an.findIndex((A, i) => !meme(an[(i + an.length - 1) % an.length], A));
      if (debut < 0) debut = 0;
      const tour = an.slice(debut).concat(an.slice(0, debut));
      for (let i = 0; i < tour.length;) {
        let j = i + 1;
        while (j < tour.length && meme(tour[j - 1], tour[j])) j++;
        const suite = tour.slice(i, j), v = voisinDe(suite[0]), P = [suite[0].pa, ...suite.map(A => A.pb)];
        const haut = P.map(p => zPlan(e, p[0], p[1]));
        const bas = P.map((p, k) => v < 0 ? zSol : Math.min(haut[k], zPlan(v, p[0], p[1])));
        if (haut.some((h, k) => h - bas[k] > 0.05)) {
          const r = [];
          P.forEach((p, k) => r.push([r3(p[0]), r3(p[1]), r3(haut[k])]));
          for (let k = P.length - 1; k >= 0; k--) r.push([r3(P[k][0]), r3(P[k][1]), r3(bas[k])]);
          murs.push({ t: "mur", r: [r.filter((q, k) => { const s = r[(k + r.length - 1) % r.length]; return q[0] !== s[0] || q[1] !== s[1] || q[2] !== s[2]; })] });
        }
        i = j;
      }
    }
  }
  return polygones.concat(murs);
}

/** Retire les sommets alignés (sur une droite à 1 mm près) d'un anneau 2D. */
function sansAlignes(P) {
  const R = P.slice();
  for (let i = 0; i < R.length && R.length > 3;) {
    const p = R[(i + R.length - 1) % R.length], q = R[i], r = R[(i + 1) % R.length];
    const ux = r[0] - p[0], uy = r[1] - p[1], l = Math.hypot(ux, uy);
    if (l < 1e-9 || Math.abs((q[0] - p[0]) * uy - (q[1] - p[1]) * ux) / l < 1e-3) R.splice(i, 1); else i++;
  }
  return R;
}
