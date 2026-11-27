// Impression 3D (mode pro) : la maquette en solides fermés (étanches), prêts pour le trancheur. Unités : millimètres.
//  - Terrain : un solide (dessus en triangulation adaptative de la grille de 0,5 m, paroi le long du bord, fond plat) ;
//    arbres simplifiés (masses ou dômes) et eau à plat font partie de sa surface.
//  - Bâtiments : un solide fermé par volume de toit. Les toits (relevé, swisstopo ou « Advanced ») sont ramenés à
//    l'emprise (pas de débord), découpés au bord de la maquette, puis chaque nappe de toit descend à la verticale
//    jusqu'à ~1 mm sous le terrain : murs exactement verticaux, arêtes nettes, aucun surplomb.
// Les solides se recouvrent (bâtiments enfoncés dans le terrain) : les trancheurs les réunissent à l'ouverture.
// Sans DOM ni three.js : tourne dans un fil de calcul ou sous Node.
import { TerrainAdaptatif } from "./impression3dTerrain.js";

const ENFONCEMENT = 1;      // mm : profondeur des bâtiments sous le point le plus bas du terrain à leur pied
const EPS_MUR = 0.02;       // m : tolérance du rognage des toits par les murs
export const FINESSES = {   // tolérance du terrain (mm imprimés) et plafond de triangles du terrain (par fichier)
  fine: { tol: 0.04, max: 900000 }, normale: { tol: 0.08, max: 600000 }, rapide: { tol: 0.16, max: 300000 },
};

/** Suite de nombres dans un tableau typé qui grandit par doublement. */
class Tampon {
  constructor(Type, taille = 1 << 14) { this.a = new Type(taille); this.n = 0; }
  ajouter3(a, b, c) {
    if (this.n + 3 > this.a.length) { const B = new this.a.constructor(2 * this.a.length); B.set(this.a); this.a = B; }
    this.a[this.n++] = a; this.a[this.n++] = b; this.a[this.n++] = c;
  }
  fin() { return this.a.slice(0, this.n); }
}

/** Fichier en construction : sommets (mm), triangles, et la liste de ses solides (plages de sommets et de triangles). */
class Sortie {
  constructor() { this.pos = new Tampon(Float32Array, 1 << 16); this.idx = new Tampon(Uint32Array, 1 << 16); this.solides = []; }
  sommet(x, y, z) { this.pos.ajouter3(x, y, z); return this.pos.n / 3 - 1; }
  tri(a, b, c) { this.idx.ajouter3(a, b, c); }
  marque() { return { v0: this.pos.n / 3, t0: this.idx.n / 3 }; }
  annuler(m) { this.pos.n = 3 * m.v0; this.idx.n = 3 * m.t0; }
  clore(m, type) {
    const s = { type, v0: m.v0, v1: this.pos.n / 3, t0: m.t0, t1: this.idx.n / 3 };
    Object.assign(s, controler(this.idx.a, s.t0, s.t1, s.v0, s.v1 - s.v0));
    return s;
  }
}

/**
 * Contrôle d'étanchéité d'un solide (triangles t0..t1 de l'index `I`, sommets à partir de v0) : chaque arête doit être
 * partagée par exactement deux triangles, de sens opposés. Renvoie { ouvertes, malOrientees }.
 */
export function controler(I, t0, t1, v0, nv) {
  const K = new Float64Array(3 * (t1 - t0));
  let q = 0, ouvertes = 0, mal = 0;
  for (let t = t0; t < t1; t++) for (let k = 0; k < 3; k++) {
    const a = I[3 * t + k] - v0, b = I[3 * t + (k + 1) % 3] - v0;
    K[q++] = a === b ? -1 : a < b ? (a * nv + b) * 2 : (b * nv + a) * 2 + 1;
  }
  K.sort();
  for (let i = 0; i < K.length;) {
    if (K[i] < 0) { ouvertes++; i++; continue; }
    const e = Math.floor(K[i] / 2);
    let n0 = 0, n1 = 0;
    for (; i < K.length && Math.floor(K[i] / 2) === e; i++) if (K[i] % 2) n1++; else n0++;
    if (n0 + n1 !== 2) ouvertes++; else if (n0 !== 1) mal++;
  }
  return { ouvertes, malOrientees: mal };
}

/* ------------------------------------------------------------------ hauteurs du terrain (grille de G) */

/** Hauteur interpolée (bilinéaire entre les centres des cellules) d'une grille alignée sur G. */
function lire(H, G, x, y) {
  const n = G.n, fi = (x - G.x0) / G.c - 0.5, fj = (y - G.x0) / G.c - 0.5;
  const i = Math.max(0, Math.min(n - 2, Math.floor(fi))), j = Math.max(0, Math.min(n - 2, Math.floor(fj)));
  const u = Math.min(1, Math.max(0, fi - i)), v = Math.min(1, Math.max(0, fj - j)), p = j * n + i;
  return (H[p] * (1 - u) + H[p + 1] * u) * (1 - v) + (H[p + n] * (1 - u) + H[p + n + 1] * u) * v;
}

/**
 * Végétation lissée (moyenne sur une fenêtre de 2r+1 cellules, en deux passes séparées), pour des masses d'arbres
 * sans aiguilles ; une case garde une masse si au moins 35 % de sa fenêtre est boisée (> 2 m au-dessus du sol).
 */
function lisser(G, a, r) {
  const n = G.n, sol = G.sol, somme = new Float32Array(n * n), nb = new Float32Array(n * n);
  for (let p = 0; p < n * n; p++) if (!isNaN(a[p]) && a[p] > sol[p] + 2) { somme[p] = a[p]; nb[p] = 1; }
  const passe = (src, horiz) => {
    const out = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      let acc = 0;
      const at = k => horiz ? src[j * n + k] : src[k * n + j], put = (k, v) => { if (horiz) out[j * n + k] = v; else out[k * n + j] = v; };
      for (let k = -r; k <= r; k++) if (k >= 0 && k < n) acc += at(k);
      for (let k = 0; k < n; k++) {
        put(k, acc);
        if (k - r >= 0) acc -= at(k - r);
        if (k + r + 1 < n) acc += at(k + r + 1);
      }
    }
    return out;
  };
  const S = passe(passe(somme, true), false), K = passe(passe(nb, true), false), seuil = (2 * r + 1) ** 2 * 0.35;
  const out = new Float32Array(n * n).fill(NaN);
  for (let p = 0; p < n * n; p++) if (K[p] > seuil) out[p] = S[p] / K[p];
  return out;
}

/** Arbres isolés : sommets locaux de la végétation, hauteur au-dessus du sol > 3 m. */
function sommetsArbres(G, ecart, rayonMin) {
  // `ecart` (m) : distance minimale entre deux sommets ; `rayonMin` : rayon minimal d'un dôme (imprimable à l'échelle)
  const n = G.n, c = G.c, w = Math.max(2, Math.round(ecart / c)), veg = G.veg, sol = G.sol, arbres = [];
  for (let j = w; j < n - w; j++) for (let i = w; i < n - w; i++) {
    const p = j * n + i, v = veg[p];
    if (isNaN(v) || v - sol[p] < 3) continue;
    let max = true;
    for (let dj = -w; dj <= w && max; dj++) for (let di = -w; di <= w; di++) {
      const q = veg[(j + dj) * n + i + di];
      if (q > v || (q === v && (dj < 0 || (dj === 0 && di < 0)))) { max = false; break; }
    }
    if (!max) continue;
    const h = v - sol[p];
    arbres.push({ i, j, haut: v, rayon: Math.max(rayonMin, Math.min(6, 0.33 * h)), pied: sol[p] });
  }
  return arbres;
}

/**
 * Grilles de hauteurs (une valeur par cellule de G) : `sol` = terrain et eau à plat (pied des bâtiments),
 * `dessus` = le même avec les arbres simplifiés (surface imprimée du terrain).
 */
function hauteursTerrain(G, o, mm) {
  const n = G.n, c = G.c, sol = new Float32Array(n * n);
  let dernier = 0;
  for (let p = 0; p < n * n; p++) {
    let h = G.sol[p];
    if (isNaN(h)) h = dernier; else dernier = h;
    if (o.eau !== false && G.eau && G.eau[p] > h) h = G.eau[p];
    sol[p] = h;
  }
  let dessus = sol, nbArbres = 0;
  if (o.arbres === "masses" && G.veg) {
    // fenêtre de lissage : au moins 2 m et au moins 0,8 mm imprimé
    const M = lisser(G, G.veg, Math.max(1, Math.round(Math.max(2, 0.8 / mm) / c)));
    dessus = Float32Array.from(sol);
    for (let p = 0; p < n * n; p++) if (M[p] > sol[p]) dessus[p] = M[p] * 0.97 + sol[p] * 0.03;
  } else if (o.arbres === "isoles" && G.veg) {
    // un dôme doit rester imprimable : rayon d'au moins 0,7 mm, sommets écartés d'au moins 1,2 mm
    const A = sommetsArbres(G, Math.max(2, 1.2 / mm), Math.max(1.5, 0.7 / mm));
    nbArbres = A.length;
    dessus = Float32Array.from(sol);
    for (const a of A) {
      // arbre « en boule posée » : dôme du sol au sommet, sans tronc (un tronc fin ne s'imprime pas)
      const r = Math.ceil(a.rayon / c);
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const i = a.i + di, j = a.j + dj, d = Math.hypot(di, dj) * c;
        if (i < 0 || j < 0 || i >= n || j >= n || d >= a.rayon) continue;
        const z = a.pied + (a.haut - a.pied) * Math.sqrt(1 - (d / a.rayon) ** 2), p = j * n + i;
        if (z > dessus[p]) dessus[p] = z;
      }
    }
  }
  return { sol, dessus, nbArbres };
}

/* ------------------------------------------------------------------ découpe d'un maillage par une limite */

/**
 * Garde la partie d'un maillage (sommets M = { X, Y, Z }, triangles T) située du bon côté d'une limite.
 * `dist(x, y)` : distance signée (m, positive dedans) ; `coupe(xa, ya, xb, yb)` : position (0..1) du passage de la
 * limite entre un point dedans et un point dehors. Les arêtes coupées le sont une seule fois (sommet commun aux deux
 * triangles voisins) : le maillage reste jointif. `arc` = { R, corde, z } : limite circulaire, les longues cordes du
 * bord reçoivent des sommets posés sur le cercle (hauteur lue par `arc.z`).
 */
function rogner(M, T, dist, coupe, arc = null) {
  const { X, Y, Z } = M, nv = X.length, D = new Float64Array(nv), eps = 1e-6;
  let dehors = false;
  for (let i = 0; i < T.length; i++) { const v = T[i]; D[v] = dist(X[v], Y[v]); if (D[v] < -eps) dehors = true; }
  if (!dehors) return T;
  const cache = new Map(), out = [], poly = [], bord = [];
  const etat = v => v >= nv ? 0 : D[v] > eps ? 1 : D[v] < -eps ? -1 : 0;
  const passage = (a, b) => { // a dedans, b dehors
    const k = a * nv + b;
    let v = cache.get(k);
    if (v === undefined) {
      const t = coupe(X[a], Y[a], X[b], Y[b]);
      v = X.length; X.push(X[a] + (X[b] - X[a]) * t); Y.push(Y[a] + (Y[b] - Y[a]) * t); Z.push(Z[a] + (Z[b] - Z[a]) * t);
      cache.set(k, v);
    }
    return v;
  };
  for (let t = 0; t < T.length; t += 3) {
    const s0 = etat(T[t]), s1 = etat(T[t + 1]), s2 = etat(T[t + 2]);
    if (s0 >= 0 && s1 >= 0 && s2 >= 0) { if (s0 + s1 + s2 > 0) out.push(T[t], T[t + 1], T[t + 2]); continue; }
    if (s0 <= 0 && s1 <= 0 && s2 <= 0) continue;
    poly.length = 0; bord.length = 0;
    for (let k = 0; k < 3; k++) {
      const a = T[t + k], b = T[t + (k + 1) % 3], sa = etat(a), sb = etat(b);
      if (sa >= 0) { poly.push(a); bord.push(sa === 0); }
      if (sa > 0 && sb < 0) { poly.push(passage(a, b)); bord.push(true); } else if (sa < 0 && sb > 0) { poly.push(passage(b, a)); bord.push(true); }
    }
    if (arc) {
      // corde du bord (deux sommets consécutifs sur la limite) : sommets intermédiaires sur le cercle
      for (let k = 0; k < poly.length; k++) {
        const k2 = (k + 1) % poly.length, a = poly[k], b = poly[k2];
        if (!bord[k] || !bord[k2]) continue;
        const nb = Math.ceil(Math.hypot(X[b] - X[a], Y[b] - Y[a]) / arc.corde);
        if (nb < 2) continue;
        const a0 = Math.atan2(Y[a], X[a]);
        let da = Math.atan2(Y[b], X[b]) - a0;
        if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
        const ajout = [];
        for (let q = 1; q < nb; q++) {
          const x = arc.R * Math.cos(a0 + da * q / nb), y = arc.R * Math.sin(a0 + da * q / nb);
          ajout.push(X.length); X.push(x); Y.push(y); Z.push(arc.z(x, y));
        }
        // l'éventail part du sommet qui suit la corde : les nouveaux triangles restent bien formés
        const tour = poly.slice(k2).concat(poly.slice(0, k2)); // de b à a
        poly.length = 0; poly.push(...tour.slice(1), ...ajout, tour[0]);
        break; // une seule corde par triangle
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) out.push(poly[0], poly[k], poly[k + 1]);
  }
  return out;
}

const demiPlan = (nx, ny, d0) => [(x, y) => nx * x + ny * y - d0, (xa, ya, xb, yb) => { const da = nx * xa + ny * ya - d0, db = nx * xb + ny * yb - d0; return da / (da - db); }];
const cercle = R => [(x, y) => R - Math.hypot(x, y), (xa, ya, xb, yb) => {
  const dx = xb - xa, dy = yb - ya, A = dx * dx + dy * dy, B = 2 * (xa * dx + ya * dy), C = xa * xa + ya * ya - R * R;
  return Math.min(1, Math.max(0, (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A)));
}];

/* ------------------------------------------------------------------ terrain */

/**
 * Solide du terrain d'une tuile [xa, xb] × [ya, yb] (m), coupée au cercle de rayon `Rd` en maquette ronde :
 * dessus adaptatif, paroi verticale le long du bord, fond plat à z = 0.
 */
function solideTerrain(S, H, G, tu, Rd, rond, versZ, mm, tolM, maxTri) {
  const { xa, xb, ya, yb } = tu;
  const nx = Math.max(2, Math.round((xb - xa) / G.c)) + 1, ny = Math.max(2, Math.round((yb - ya) / G.c)) + 1;
  const px = (xb - xa) / (nx - 1), py = (yb - ya) / (ny - 1), h = new Float32Array(nx * ny), masque = rond ? new Uint8Array(nx * ny) : null;
  let dedans = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = xa + i * px, y = ya + j * py, r = Math.hypot(x, y), k = rond && r > Rd ? Rd / r : 1;
    h[j * nx + i] = lire(H, G, x * k, y * k);
    if (masque && r <= Rd + 1.5 * Math.max(px, py)) masque[j * nx + i] = 1;
    if (!rond || r < Rd) dedans++;
  }
  if (dedans < 4) return null;
  const tin = new TerrainAdaptatif(h, nx, ny, masque), ecart = tin.affiner(tolM, maxTri);
  const M = { X: [], Y: [], Z: [] }, C = tin.coords;
  for (let k = 0; k < C.length; k += 2) { M.X.push(xa + C[k] * px); M.Y.push(ya + C[k + 1] * py); M.Z.push(h[C[k + 1] * nx + C[k]]); }
  // triangles dans le sens trigonométrique vus de dessus (x est, y nord)
  let T = tin.tri;
  {
    const a = T[0], b = T[1], c = T[2];
    if ((M.X[b] - M.X[a]) * (M.Y[c] - M.Y[a]) - (M.X[c] - M.X[a]) * (M.Y[b] - M.Y[a]) < 0) for (let t = 0; t < T.length; t += 3) { const v = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = v; }
  }
  if (rond) {
    // flèche des cordes du bord : au plus 0,03 mm imprimé
    const corde = Math.sqrt(8 * Rd * 0.03 / mm);
    T = rogner(M, T, ...cercle(Rd), { R: Rd, corde, z: (x, y) => lire(H, G, x, y) });
    if (T.length < 9) return null;
  }
  const m = S.marque(), nv = M.X.length, rang = new Int32Array(nv).fill(-1);
  const haut = v => rang[v] >= 0 ? rang[v] : (rang[v] = S.sommet(M.X[v] * mm, M.Y[v] * mm, versZ(M.Z[v])));
  // arêtes du bord : celles qu'un seul triangle porte
  const seules = new Map();
  for (let t = 0; t < T.length; t += 3) {
    S.tri(haut(T[t]), haut(T[t + 1]), haut(T[t + 2]));
    for (let k = 0; k < 3; k++) {
      const a = T[t + k], b = T[t + (k + 1) % 3], cle = a < b ? a * nv + b : b * nv + a;
      if (seules.has(cle)) seules.delete(cle); else seules.set(cle, t + k);
    }
  }
  // paroi : chaque sommet du bord a son double au fond ; fond : éventail depuis le centre (la tuile est convexe)
  const bas = new Map();
  let sx = 0, sy = 0;
  const fond = v => {
    let w = bas.get(v);
    if (w === undefined) { w = S.sommet(M.X[v] * mm, M.Y[v] * mm, 0); bas.set(v, w); sx += M.X[v]; sy += M.Y[v]; }
    return w;
  };
  for (const e of seules.values()) fond(T[e]);
  const centre = S.sommet(sx / bas.size * mm, sy / bas.size * mm, 0);
  for (const e of seules.values()) {
    const t = e - e % 3, a = T[e], b = T[t + (e + 1) % 3], A = rang[a], B = rang[b], a2 = fond(a), b2 = fond(b);
    S.tri(B, A, a2); S.tri(B, a2, b2); S.tri(centre, b2, a2);
  }
  const s = S.clore(m, "terrain");
  s.ecart = ecart * mm; // écart maximal restant (mm, avant exagération)
  S.solides.push(s);
  return s;
}

/* ------------------------------------------------------------------ toits des bâtiments */

/**
 * Prépare un lot de toits : sommets soudés (au millimètre, par groupe), faces presque verticales ou nulles écartées,
 * triangles tournés dans le sens trigonométrique vus de dessus. `lot` = { pos (x est, y nord, z altitude ; m),
 * idx (facultatif : sinon trois sommets consécutifs par triangle), groupe (par triangle : bâtiment ou volume),
 * murs + mursGroupe (segments [x1, y1, x2, y2] des façades, pour rogner les débords), rogner }.
 * Renvoie { M: { X, Y, Z }, T: number[], rognes (bâtiments dont un débord a été enlevé) }.
 */
function preparerLot(lot, limite) {
  const M = { X: [], Y: [], Z: [] }, { X, Y, Z } = M, P = lot.pos, I = lot.idx, nt = (I ? I.length : P.length / 3) / 3;
  const carte = new Map(), parGroupe = new Map(), doubles = new Set();
  const sommet = (v, g) => {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2], zi = Math.round(z * 1000);
    const k = (Math.round(x * 1000) + 2097152) * 4194304 + Math.round(y * 1000) + 2097152;
    let L = carte.get(k);
    if (!L) carte.set(k, L = []);
    for (let q = 0; q < L.length; q += 3) if (L[q] === zi && L[q + 1] === g) return L[q + 2];
    X.push(x); Y.push(y); Z.push(z); L.push(zi, g, X.length - 1);
    return X.length - 1;
  };
  for (let t = 0; t < nt; t++) {
    const va = I ? I[3 * t] : 3 * t, vb = I ? I[3 * t + 1] : 3 * t + 1, vc = I ? I[3 * t + 2] : 3 * t + 2, g = lot.groupe ? lot.groupe[t] : 0;
    // hors de la maquette (avec une marge) : écarté d'emblée
    if (Math.min(P[3 * va], P[3 * vb], P[3 * vc]) > limite || Math.max(P[3 * va], P[3 * vb], P[3 * vc]) < -limite
      || Math.min(P[3 * va + 1], P[3 * vb + 1], P[3 * vc + 1]) > limite || Math.max(P[3 * va + 1], P[3 * vb + 1], P[3 * vc + 1]) < -limite) continue;
    const ux = P[3 * vb] - P[3 * va], uy = P[3 * vb + 1] - P[3 * va + 1], uz = P[3 * vb + 2] - P[3 * va + 2];
    const wx = P[3 * vc] - P[3 * va], wy = P[3 * vc + 1] - P[3 * va + 1], wz = P[3 * vc + 2] - P[3 * va + 2];
    const nz = ux * wy - uy * wx, nn = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, nz);
    if (!(Math.abs(nz) > 1e-6) || Math.abs(nz) < 0.05 * nn) continue; // face verticale (mur) ou triangle nul
    const a = sommet(va, g), b = sommet(vb, g), c = sommet(vc, g);
    if (a === b || b === c || a === c) continue;
    // même triangle écrit deux fois (toits à deux faces de swisstopo, tuiles qui se recouvrent) : gardé une fois
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), cle = `${lo},${a + b + c - lo - hi},${hi}`;
    if (doubles.has(cle)) continue;
    doubles.add(cle);
    let L = parGroupe.get(g);
    if (!L) parGroupe.set(g, L = []);
    L.push(nz > 0 ? [a, b, c] : [a, c, b]);
  }
  // débords : chaque bâtiment est rogné par ses propres façades
  let rognes = 0;
  const T = [];
  if (lot.rogner && lot.murs) {
    const murs = new Map();
    for (let s = 0; s < lot.murs.length / 4; s++) {
      const g = lot.mursGroupe[s];
      if (!parGroupe.has(g)) continue;
      let L = murs.get(g);
      if (!L) murs.set(g, L = []);
      L.push([lot.murs[4 * s], lot.murs[4 * s + 1], lot.murs[4 * s + 2], lot.murs[4 * s + 3]]);
    }
    for (const [g, L] of parGroupe) {
      const segs = murs.get(g);
      if (segs?.length >= 3 && mursFermes(segs)) {
        // garde-fou : si plus de la moitié du toit partait, les murs ne décrivent pas l'emprise ; toit laissé entier
        const entier = L.slice(), aire = K => K.reduce((q, [a, b, c]) => q + (X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a]), 0), avant = aire(L);
        if (rognerParMurs(M, L, segs)) { if (aire(L) < 0.5 * avant) { L.length = 0; L.push(...entier); } else rognes++; }
      }
      for (const tr of L) T.push(tr[0], tr[1], tr[2]);
    }
  } else for (const L of parGroupe.values()) for (const tr of L) T.push(tr[0], tr[1], tr[2]);
  return { M, T, rognes };
}

/** Vrai si les façades forment des contours fermés : presque chaque bout de segment en touche un autre (à 15 cm). */
function mursFermes(segs) {
  let libres = 0;
  for (let i = 0; i < segs.length; i++) for (const k of [0, 2]) {
    const px = segs[i][k], py = segs[i][k + 1];
    let touche = false;
    for (let j = 0; j < segs.length && !touche; j++) {
      if (j === i) continue;
      const [x1, y1, x2, y2] = segs[j], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
      const t = Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / l2));
      touche = Math.hypot(px - x1 - t * dx, py - y1 - t * dy) <= 0.15;
    }
    if (!touche) libres++;
  }
  return libres <= 0.1 * 2 * segs.length;
}

const RAYONS = 48, DIRS = Array.from({ length: RAYONS }, (_, k) => [Math.cos(2 * Math.PI * (k + 0.5) / RAYONS), Math.sin(2 * Math.PI * (k + 0.5) / RAYONS)]);

/**
 * Découpe un maillage (triangles `L` = [a, b, c] dans le sens trigonométrique, modifié sur place) le long de segments
 * vus de dessus : après coup, aucun triangle n'est à cheval sur un segment. Chaque bout de segment devient un sommet
 * (dans le triangle ou sur l'arête qui le porte), puis chaque arête traversée est coupée, pour tous les triangles qui
 * la partagent : le maillage reste jointif.
 */
function decouperLeLong(M, L, segs) {
  const { X, Y, Z } = M;
  const diviser = (u, v, t) => {
    const w = X.length;
    X.push(X[u] + (X[v] - X[u]) * t); Y.push(Y[u] + (Y[v] - Y[u]) * t); Z.push(Z[u] + (Z[v] - Z[u]) * t);
    for (let i = 0, n = L.length; i < n; i++) {
      const tr = L[i];
      for (let e = 0; e < 3; e++) {
        const p = tr[e], q = tr[(e + 1) % 3], o = tr[(e + 2) % 3];
        if (p === u && q === v) { L[i] = [u, w, o]; L.push([w, v, o]); break; }
        if (p === v && q === u) { L[i] = [v, w, o]; L.push([w, u, o]); break; }
      }
    }
  };
  const inserer = (px, py) => {
    for (let garde = 0; garde < 60; garde++) {
      let fait = false;
      for (let i = 0; i < L.length && !fait; i++) {
        const tr = L[i], [a, b, c] = tr;
        // boîte du triangle : un point dans le prolongement d'un triangle très effilé n'est pas dedans
        if (px < Math.min(X[a], X[b], X[c]) - EPS_MUR || px > Math.max(X[a], X[b], X[c]) + EPS_MUR || py < Math.min(Y[a], Y[b], Y[c]) - EPS_MUR || py > Math.max(Y[a], Y[b], Y[c]) + EPS_MUR) continue;
        const aire = (X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a]);
        if (aire < 1e-6) continue;
        let proche = false, bord = -1, hors = false;
        for (let e = 0; e < 3 && !proche && !hors; e++) {
          const u = tr[e], v = tr[(e + 1) % 3], dx = X[v] - X[u], dy = Y[v] - Y[u], l = Math.hypot(dx, dy) || 1;
          if (Math.hypot(X[u] - px, Y[u] - py) < EPS_MUR) proche = true;
          const d = (dx * (py - Y[u]) - dy * (px - X[u])) / l; // positif à gauche de l'arête : dans le triangle
          if (d < -EPS_MUR) hors = true; else if (d <= EPS_MUR && bord < 0) bord = e;
        }
        if (proche || hors) continue;
        if (bord >= 0) {
          const u = tr[bord], v = tr[(bord + 1) % 3], dx = X[v] - X[u], dy = Y[v] - Y[u], t = ((px - X[u]) * dx + (py - Y[u]) * dy) / (dx * dx + dy * dy);
          if (!(t > 0 && t < 1)) continue;
          diviser(u, v, t);
        } else {
          const wa = ((X[b] - px) * (Y[c] - py) - (X[c] - px) * (Y[b] - py)) / aire, wb = ((X[c] - px) * (Y[a] - py) - (X[a] - px) * (Y[c] - py)) / aire;
          const w = X.length;
          X.push(px); Y.push(py); Z.push(wa * Z[a] + wb * Z[b] + (1 - wa - wb) * Z[c]);
          L[i] = [a, b, w]; L.push([b, c, w], [c, a, w]);
        }
        fait = true;
      }
      if (!fait) break;
    }
  };
  // boîte du maillage : un segment qui n'y passe pas ne le découpe pas
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const tr of L) for (const v of tr) { x0 = Math.min(x0, X[v]); x1 = Math.max(x1, X[v]); y0 = Math.min(y0, Y[v]); y1 = Math.max(y1, Y[v]); }
  for (const [ax, ay, bx, by] of segs) {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < 2 * EPS_MUR || Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
    if (ax >= x0 - EPS_MUR && ax <= x1 + EPS_MUR && ay >= y0 - EPS_MUR && ay <= y1 + EPS_MUR) inserer(ax, ay);
    if (bx >= x0 - EPS_MUR && bx <= x1 + EPS_MUR && by >= y0 - EPS_MUR && by <= y1 + EPS_MUR) inserer(bx, by);
    const cote = v => ((X[v] - ax) * dy - (Y[v] - ay) * dx) / len, vues = new Set(), coupes = [];
    const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx), sy0 = Math.min(ay, by), sy1 = Math.max(ay, by);
    for (const tr of L) {
      const p = tr[0], q = tr[1], r = tr[2];
      // triangle à l'écart du segment : rien à couper
      if ((X[p] < sx0 && X[q] < sx0 && X[r] < sx0) || (X[p] > sx1 && X[q] > sx1 && X[r] > sx1) || (Y[p] < sy0 && Y[q] < sy0 && Y[r] < sy0) || (Y[p] > sy1 && Y[q] > sy1 && Y[r] > sy1)) continue;
      const sp = cote(p), sq = cote(q), sr = cote(r);
      if ((sp >= -EPS_MUR && sq >= -EPS_MUR && sr >= -EPS_MUR) || (sp <= EPS_MUR && sq <= EPS_MUR && sr <= EPS_MUR)) continue;
      for (let e = 0; e < 3; e++) {
        const u = tr[e], v = tr[(e + 1) % 3], su = e === 0 ? sp : e === 1 ? sq : sr, sv = e === 0 ? sq : e === 1 ? sr : sp;
        if (!((su > EPS_MUR && sv < -EPS_MUR) || (su < -EPS_MUR && sv > EPS_MUR))) continue;
        const cle = u < v ? u * 1e7 + v : v * 1e7 + u;
        if (vues.has(cle)) continue;
        vues.add(cle);
        const t = su / (su - sv), s = ((X[u] + (X[v] - X[u]) * t - ax) * dx + (Y[u] + (Y[v] - Y[u]) * t - ay) * dy) / len;
        if (s > EPS_MUR && s < len - EPS_MUR) coupes.push([u, v, t]);
      }
    }
    for (const [u, v, t] of coupes) diviser(u, v, t);
  }
}

/**
 * Enlève les débords d'un toit : le maillage est découpé le long de chaque façade (segments `segs` vus de dessus),
 * puis les morceaux situés hors des murs sont retirés. Un morceau est « dehors » si, de son centre, on voit le large
 * sur au moins 165° d'affilée sans croiser de façade (le long d'un mur droit : 180° ; à un angle saillant : 270°).
 * Dans un angle rentrant ou une cour étroite, le débord est gardé : mieux vaut un toit un peu large qu'un trou.
 * Renvoie vrai si des morceaux ont été retirés.
 */
function rognerParMurs(M, L, segs) {
  const { X, Y } = M;
  decouperLeLong(M, L, segs);
  const libres = new Uint8Array(RAYONS), seuil = Math.ceil(RAYONS * 165 / 360), S = new Float64Array(4 * segs.length);
  segs.forEach((g, k) => { S[4 * k] = g[0]; S[4 * k + 1] = g[1]; S[4 * k + 2] = g[2] - g[0]; S[4 * k + 3] = g[3] - g[1]; });
  const libre = (px, py, k) => {
    const dx = DIRS[k][0], dy = DIRS[k][1];
    for (let q = 0; q < S.length; q += 4) {
      const ex = S[q + 2], ey = S[q + 3], det = dx * ey - dy * ex;
      if (det > -1e-12 && det < 1e-12) continue;
      const rx = S[q] - px, ry = S[q + 1] - py, t = (rx * ey - ry * ex) / det;
      if (t <= 1e-9) continue;
      const u = (rx * dy - ry * dx) / det;
      if (u >= -0.02 && u <= 1.02) return 0;
    }
    return 1;
  };
  const dehors = (px, py) => {
    // huit rayons d'abord (tous les 45°) : 165° de vue libre en contiennent au moins trois voisins
    let suite8 = 0, assez = false;
    for (let k = 0; k < 11 && !assez; k++) { if (libre(px, py, (k % 8) * (RAYONS / 8))) { if (++suite8 >= 3) assez = true; } else { suite8 = 0; if (k >= 8) break; } }
    if (!assez) return false;
    let nb = 0;
    for (let k = 0; k < RAYONS; k++) { libres[k] = libre(px, py, k); nb += libres[k]; }
    if (nb === RAYONS) return true;
    if (nb < seuil) return false;
    let suite = 0;
    for (let k = 0; k < 2 * RAYONS; k++) { if (libres[k % RAYONS]) { if (++suite >= seuil) return true; } else suite = 0; }
    return false;
  };
  let q = 0;
  const avant = L.length;
  for (const tr of L) {
    const [a, b, c] = tr;
    if (!dehors((X[a] + X[b] + X[c]) / 3, (Y[a] + Y[b] + Y[c]) / 3)) L[q++] = tr;
  }
  L.length = q;
  return q < avant;
}

/**
 * Toits du relevé, allégés : par volume (corps principal, annexe, lucarne…), la grille de hauteurs de 0,5 m est
 * remplacée par une triangulation adaptative (écart ≤ `tol`, en m : le bruit du relevé disparaît, les pans deviennent
 * de grands triangles, les faîtes restent), puis découpée exactement le long du contour à côtés droits du volume
 * (contours.js) : les murs tombent là où ils sont affichés. `R` = { n, c, x0, px, py (coins de la grille, ramenés sur
 * les côtés au bord), seg (volume de chaque cellule), val (hauteurs), coins + debuts + segs (boucles des contours) }.
 * Les très petits volumes, ou ceux dont la découpe ne redonne pas l'aire du contour, gardent leurs cellules.
 * Renvoie un lot { pos, idx, groupe }.
 */
function toitsReleve(R, tol) {
  const { n, c, x0, px, py, seg, val } = R, m = n + 1, pos = [], idx = [], groupe = [];
  let nbSeg = 0;
  for (let p = 0; p < n * n; p++) if (seg[p] >= nbSeg) nbSeg = seg[p] + 1;
  const boite = new Int32Array(4 * nbSeg), nbCel = new Int32Array(nbSeg), boucles = Array.from({ length: nbSeg }, () => []);
  for (let s = 0; s < nbSeg; s++) { boite[4 * s] = boite[4 * s + 1] = n; boite[4 * s + 2] = boite[4 * s + 3] = -1; }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const s = seg[j * n + i];
    if (s < 0) continue;
    nbCel[s]++;
    if (i < boite[4 * s]) boite[4 * s] = i; if (j < boite[4 * s + 1]) boite[4 * s + 1] = j; if (i > boite[4 * s + 2]) boite[4 * s + 2] = i; if (j > boite[4 * s + 3]) boite[4 * s + 3] = j;
  }
  for (let b = 0; b < R.segs.length; b++) if (R.segs[b] >= 0 && R.segs[b] < nbSeg) boucles[R.segs[b]].push(b);
  const de = (i, j, s) => i >= 0 && j >= 0 && i < n && j < n && seg[j * n + i] === s;
  /** Hauteur du toit du volume s au coin (i, j) : moyenne de ses cellules voisines (NaN si aucune). */
  const hCoin = (i, j, s) => {
    let h = 0, q = 0;
    if (de(i - 1, j - 1, s)) { h += val[(j - 1) * n + i - 1]; q++; }
    if (de(i, j - 1, s)) { h += val[(j - 1) * n + i]; q++; }
    if (de(i - 1, j, s)) { h += val[j * n + i - 1]; q++; }
    if (de(i, j, s)) { h += val[j * n + i]; q++; }
    return q ? h / q : NaN;
  };
  /** Repli : les cellules du volume, coins de bord redressés (la nappe affichée). */
  const rang = new Map();
  const grille = s => {
    rang.clear();
    const sommet = k => { let v = rang.get(k); if (v === undefined) { v = pos.length / 3; pos.push(px[k], py[k], hCoin(k % m, (k / m) | 0, s)); rang.set(k, v); } return v; };
    for (let j = boite[4 * s + 1]; j <= boite[4 * s + 3]; j++) for (let i = boite[4 * s]; i <= boite[4 * s + 2]; i++) {
      if (seg[j * n + i] !== s) continue;
      const A = sommet(j * m + i), B = sommet(j * m + i + 1), D = sommet((j + 1) * m + i + 1), E = sommet((j + 1) * m + i);
      idx.push(A, B, D, A, D, E); groupe.push(s, s);
    }
  };
  const marge = 4;
  for (let s = 0; s < nbSeg; s++) {
    if (!nbCel[s]) continue;
    // contour : boucles de coins (volume à gauche, trous compris), sans doublons ni points alignés
    const anneaux = [];
    let aireContour = 0;
    for (const b of boucles[s]) {
      let P = [];
      for (let q = R.debuts[b]; q < R.debuts[b + 1]; q++) { const k = R.coins[q], x = px[k], y = py[k]; if (!P.length || Math.hypot(x - P[P.length - 1][0], y - P[P.length - 1][1]) > 1e-4) P.push([x, y]); }
      while (P.length > 1 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) <= 1e-4) P.pop();
      for (let change = true; change && P.length > 3;) {
        change = false;
        for (let q = 0; q < P.length && P.length > 3; q++) {
          const a = P[(q + P.length - 1) % P.length], p = P[q], d = P[(q + 1) % P.length];
          const cr = (p[0] - a[0]) * (d[1] - p[1]) - (p[1] - a[1]) * (d[0] - p[0]), l = Math.hypot(d[0] - a[0], d[1] - a[1]);
          if (Math.abs(cr) <= 1e-4 * l && (p[0] - a[0]) * (d[0] - p[0]) + (p[1] - a[1]) * (d[1] - p[1]) >= 0) { P.splice(q, 1); q--; change = true; }
        }
      }
      if (P.length < 3) continue;
      for (let q = 0, r = P.length - 1; q < P.length; r = q++) aireContour += (P[r][0] * P[q][1] - P[q][0] * P[r][1]) / 2;
      anneaux.push(P);
    }
    const nbCotes = anneaux.reduce((q, P) => q + P.length, 0);
    if (nbCel[s] <= 16 || !anneaux.length || !(aireContour > 1)) { grille(s); continue; }
    // grille de hauteurs du volume (coins), prolongée de proche en proche autour de lui
    const I0 = Math.max(0, boite[4 * s] - marge), J0 = Math.max(0, boite[4 * s + 1] - marge), I1 = Math.min(n, boite[4 * s + 2] + 1 + marge), J1 = Math.min(n, boite[4 * s + 3] + 1 + marge);
    const w = I1 - I0 + 1, h = J1 - J0 + 1, H = new Float32Array(w * h), masque = new Uint8Array(w * h);
    let front = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = hCoin(I0 + i, J0 + j, s), p = j * w + i; H[p] = v; if (!isNaN(v)) { masque[p] = 1; front.push(p); } }
    while (front.length) {
      const suite = [];
      for (const p of front) { const i = p % w; for (const q of [i > 0 ? p - 1 : -1, i < w - 1 ? p + 1 : -1, p - w, p + w]) if (q >= 0 && q < w * h && isNaN(H[q])) { H[q] = H[p]; suite.push(q); } }
      front = suite;
    }
    const tin = new TerrainAdaptatif(H, w, h, masque);
    tin.affiner(tol, 8000);
    if (nbCotes * tin.tri.length / 3 > 4e6) { grille(s); continue; } // contour très découpé sur un grand volume : trop long à découper
    const M = { X: [], Y: [], Z: [] }, L = [], C = tin.coords, T = tin.tri;
    for (let k = 0; k < C.length; k += 2) { M.X.push(x0 + (I0 + C[k]) * c); M.Y.push(x0 + (J0 + C[k + 1]) * c); M.Z.push(H[C[k + 1] * w + C[k]]); }
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t], b = T[t + 1], d = T[t + 2];
      L.push((M.X[b] - M.X[a]) * (M.Y[d] - M.Y[a]) - (M.X[d] - M.X[a]) * (M.Y[b] - M.Y[a]) > 0 ? [a, b, d] : [a, d, b]);
    }
    const cotes = [];
    for (const P of anneaux) for (let q = 0, r = P.length - 1; q < P.length; r = q++) cotes.push([P[r][0], P[r][1], P[q][0], P[q][1]]);
    decouperLeLong(M, L, cotes);
    // triangles gardés : centre dans le contour (règle pair-impair sur toutes les boucles)
    const garde = [];
    let aire = 0;
    for (const tr of L) {
      const [a, b, d] = tr, x = (M.X[a] + M.X[b] + M.X[d]) / 3, y = (M.Y[a] + M.Y[b] + M.Y[d]) / 3;
      let dedans = false;
      for (const [x1, y1, x2, y2] of cotes) if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) dedans = !dedans;
      if (dedans) { garde.push(tr); aire += ((M.X[b] - M.X[a]) * (M.Y[d] - M.Y[a]) - (M.X[d] - M.X[a]) * (M.Y[b] - M.Y[a])) / 2; }
    }
    if (!(Math.abs(aire - aireContour) <= 0.03 * aireContour + 0.5)) { grille(s); continue; }
    rang.clear();
    const sommet = v => { let k = rang.get(v); if (k === undefined) { k = pos.length / 3; pos.push(M.X[v], M.Y[v], M.Z[v]); rang.set(v, k); } return k; };
    for (const [a, b, d] of garde) { idx.push(sommet(a), sommet(b), sommet(d)); groupe.push(s); }
  }
  return { pos, idx, groupe };
}

/**
 * Solides des bâtiments d'une tuile. Les triangles de toit `T` (maillage M) sont regroupés en nappes continues ;
 * chaque nappe devient un solide fermé : le toit, des murs verticaux sous son bord, un fond plat enfoncé dans le
 * terrain. Les éléments trop fins pour l'impression (largeur < `minM`, en m) sont écartés. Renvoie le décompte.
 */
function solidesBatiments(S, M, T, sol, versZ, mm, minM) {
  const { X, Y, Z } = M, nv = X.length, nt = T.length / 3, bilan = { solides: 0, fins: 0, repares: 0, ouverts: 0 };
  if (!nt) return bilan;
  // arêtes : deux triangles de sens opposés sont voisins ; toute autre arête (seule, ou portée par trois faces) est un bord
  const paire = new Int32Array(3 * nt).fill(-1), etat = new Uint8Array(3 * nt), vues = new Map();
  for (let e = 0; e < 3 * nt; e++) {
    const a = T[e], b = T[e - e % 3 + (e + 1) % 3], cle = a < b ? a * nv + b : b * nv + a, p = vues.get(cle);
    if (p === undefined) { vues.set(cle, e); continue; }
    if (etat[p] === 0) {
      if (T[p] === b) { paire[p] = e; paire[e] = p; etat[p] = 1; } else etat[p] = 2;
    } else if (etat[p] === 1) { paire[paire[p]] = -1; paire[p] = -1; etat[p] = 2; }
  }
  // nappes : composantes reliées par les arêtes voisines
  const pere = new Int32Array(nt);
  for (let t = 0; t < nt; t++) pere[t] = t;
  const racine = t => { while (pere[t] !== t) { pere[t] = pere[pere[t]]; t = pere[t]; } return t; };
  for (let e = 0; e < 3 * nt; e++) if (paire[e] > e) { const a = racine((e / 3) | 0), b = racine((paire[e] / 3) | 0); if (a !== b) pere[a] = b; }
  const nappes = new Map();
  for (let t = 0; t < nt; t++) { const r = racine(t); let L = nappes.get(r); if (!L) nappes.set(r, L = []); L.push(t); }
  // coins : autour d'un sommet, les triangles qui se suivent partagent le même coin ; deux éventails qui ne se
  // touchent que par ce sommet ont chacun le leur (pas d'arête verticale portée par quatre murs)
  const coin = new Int32Array(3 * nt);
  for (let e = 0; e < 3 * nt; e++) coin[e] = e;
  const rc = e => { while (coin[e] !== e) { coin[e] = coin[coin[e]]; e = coin[e]; } return e; };
  const suiv = e => e - e % 3 + (e + 1) % 3;
  for (let e = 0; e < 3 * nt; e++) if (paire[e] > e) {
    const f = paire[e]; // e : a→b ; f : b→a
    coin[rc(e)] = rc(suiv(f)); coin[rc(suiv(e))] = rc(f);
  }
  // éléments trop fins : aire et largeur (4 × aire / périmètre) de chaque nappe
  const mesures = new Map();
  let fines = false;
  for (const [r, L] of nappes) {
    let aire = 0, perim = 0, gros = L[0], aGros = 0;
    for (const t of L) {
      const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2], s = ((X[b] - X[a]) * (Y[c] - Y[a]) - (X[c] - X[a]) * (Y[b] - Y[a])) / 2;
      aire += s; if (s > aGros) { aGros = s; gros = t; }
      for (let k = 0; k < 3; k++) if (paire[3 * t + k] < 0) { const u = T[3 * t + k], v = T[3 * t + (k + 1) % 3]; perim += Math.hypot(X[v] - X[u], Y[v] - Y[u]); }
    }
    const fine = aire < minM * minM || 4 * aire / (perim || 1) < minM;
    mesures.set(r, { aire, fine, gros });
    if (fine) fines = true;
  }
  if (fines) {
    // une nappe fine est retirée si elle est isolée (cabanon, mât) ou posée au-dessus d'une autre (cheminée, lucarne
    // minuscule) ; accolée à d'autres sans rien dessous, elle reste : la retirer ouvrirait un puits dans le bâtiment
    const cleXY = v => (Math.round(X[v] * 100) + 1048576) * 2097152 + Math.round(Y[v] * 100) + 1048576, lieu = new Map();
    for (const [r, L] of nappes) for (const t of L) for (let k = 0; k < 3; k++) {
      const c = cleXY(T[3 * t + k]), d = lieu.get(c);
      if (d === undefined) lieu.set(c, r); else if (d !== r) { mesures.get(d).accolee = true; mesures.get(r).accolee = true; }
    }
    const pas = 4, cases = new Map(), cc = (i, j) => (i + 4096) * 8192 + j + 4096;
    for (let t = 0; t < nt; t++) {
      const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
      for (let i = Math.floor(Math.min(X[a], X[b], X[c]) / pas); i <= Math.floor(Math.max(X[a], X[b], X[c]) / pas); i++)
        for (let j = Math.floor(Math.min(Y[a], Y[b], Y[c]) / pas); j <= Math.floor(Math.max(Y[a], Y[b], Y[c]) / pas); j++) {
          const k = cc(i, j); let Lc = cases.get(k); if (!Lc) cases.set(k, Lc = []); Lc.push(t);
        }
    }
    for (const [r, m] of mesures) {
      if (!m.fine) continue;
      if (m.aire < 1e-4 || !m.accolee) { m.retirer = true; continue; }
      const g = m.gros, a = T[3 * g], b = T[3 * g + 1], c = T[3 * g + 2], px = (X[a] + X[b] + X[c]) / 3, py = (Y[a] + Y[b] + Y[c]) / 3;
      for (const t of cases.get(cc(Math.floor(px / pas), Math.floor(py / pas))) || []) {
        if (racine(t) === r || mesures.get(racine(t)).fine) continue;
        const u = T[3 * t], v = T[3 * t + 1], w = T[3 * t + 2];
        const d0 = (X[v] - X[u]) * (py - Y[u]) - (Y[v] - Y[u]) * (px - X[u]), d1 = (X[w] - X[v]) * (py - Y[v]) - (Y[w] - Y[v]) * (px - X[v]), d2 = (X[u] - X[w]) * (py - Y[w]) - (Y[u] - Y[w]) * (px - X[w]);
        if (d0 >= 0 && d1 >= 0 && d2 >= 0) { m.retirer = true; break; }
      }
    }
  }
  const rang = new Map(), pied = new Map();
  for (const [r, L] of nappes) {
    if (mesures.get(r).retirer) { bilan.fins++; continue; }
    // pied : ~1 mm sous le point le plus bas du terrain sous la nappe, sans traverser le socle
    let zSol = Infinity;
    for (const t of L) for (let k = 0; k < 3; k++) { const v = T[3 * t + k], z = sol(X[v], Y[v]); if (z < zSol) zSol = z; }
    const zb = Math.max(0.5, versZ(zSol) - ENFONCEMENT);
    const m = S.marque();
    rang.clear(); pied.clear();
    const haut = e => {
      const c = rc(e);
      let i = rang.get(c);
      if (i === undefined) { const v = T[e]; i = S.sommet(X[v] * mm, Y[v] * mm, Math.max(zb + 0.3, versZ(Z[v]))); rang.set(c, i); }
      return i;
    };
    // murs : sous chaque arête du bord, jusqu'au pied ; le sommet du pied est créé à la demande
    let sx = 0, sy = 0;
    const bas = (e, i) => {
      const c = rc(e);
      let j = pied.get(c);
      if (j === undefined) { const v = T[e]; j = S.sommet(X[v] * mm, Y[v] * mm, zb); pied.set(c, j); sx += X[v]; sy += Y[v]; }
      return j;
    };
    const bords = [];
    for (const t of L) {
      const a = haut(3 * t), b = haut(3 * t + 1), c = haut(3 * t + 2);
      S.tri(a, b, c);
      for (let k = 0; k < 3; k++) if (paire[3 * t + k] < 0) {
        const p = k === 0 ? a : k === 1 ? b : c, q = k === 0 ? b : k === 1 ? c : a, p2 = bas(3 * t + k), q2 = bas(3 * t + (k + 1) % 3);
        S.tri(q, p, p2); S.tri(q, p2, q2); bords.push(p2, q2);
      }
    }
    // fond : cône très plat sous le contour du pied (pointe 0,35 mm plus bas). Ses coupes horizontales sont des
    // copies réduites du contour : la surface ne se recoupe pas, même sous un contour rentrant ou percé de cours
    const pointe = S.sommet(sx / pied.size * mm, sy / pied.size * mm, zb - 0.35);
    for (let k = 0; k < bords.length; k += 2) S.tri(pointe, bords[k + 1], bords[k]);
    let s = S.clore(m, "batiment");
    if (s.ouvertes || s.malOrientees) {
      // repli : un prisme fermé par triangle de toit (toujours étanche), les prismes se touchent par leurs faces
      S.annuler(m);
      for (const t of L) {
        const i = [0, 1, 2].map(k => { const v = T[3 * t + k], w = S.sommet(X[v] * mm, Y[v] * mm, Math.max(zb + 0.3, versZ(Z[v]))); S.sommet(X[v] * mm, Y[v] * mm, zb); return w; });
        S.tri(i[0], i[1], i[2]); S.tri(i[0] + 1, i[2] + 1, i[1] + 1);
        for (let k = 0; k < 3; k++) { const p = i[k], q = i[(k + 1) % 3]; S.tri(q, p, p + 1); S.tri(q, p + 1, q + 1); }
      }
      s = S.clore(m, "batiment");
      s.repare = true; bilan.repares++;
      if (s.ouvertes || s.malOrientees) bilan.ouverts++;
    }
    S.solides.push(s);
    bilan.solides++;
  }
  return bilan;
}

/* ------------------------------------------------------------------ calcul complet */

/**
 * Calcule les fichiers d'impression. `d` = { G: { n, c, x0, R, rayonZone, sol, eau, veg }, lots: toits des bâtiments
 * (voir preparerLot ; ou { releve } : contours et hauteurs du relevé, voir toitsReleve) } ; `o` = { taille (mm, diamètre ou côté de la maquette entière), exag (exagération verticale),
 * socle (mm sous le point le plus bas), arbres ("aucun" | "masses" | "isoles"), eau (surface des lacs à plat),
 * finesse ("fine" | "normale" | "rapide"), decoupe (N : N × N tuiles), min (mm : plus petit élément imprimable) }.
 * Renvoie { tuiles: [{ ligne, colonne, pos (Float32Array, mm), idx (Uint32Array), solides, origine [x, y] mm, dims }],
 * infos }. Les coordonnées sont celles de la maquette entière (centre à l'origine) ; `origine` est le coin de la tuile.
 */
export function calculerImpression(d, o = {}, progres = () => {}) {
  const t0 = performance.now(), G = d.G, rond = !!G.rayonZone;
  const taille = o.taille || 150, exag = o.exag || 1, socle = o.socle ?? 3, N = Math.max(1, Math.min(6, o.decoupe || 1));
  const Rd = rond ? G.rayonZone - 0.5 : G.R - G.c / 2, mm = taille / (2 * Rd), F = FINESSES[o.finesse] || FINESSES.normale;
  progres("terrain", 0);
  const H = hauteursTerrain(G, o, mm);
  let zmin = Infinity;
  for (let j = 0; j < G.n; j++) for (let i = 0; i < G.n; i++) {
    const x = G.x0 + (i + 0.5) * G.c, y = G.x0 + (j + 0.5) * G.c;
    if (rond ? x * x + y * y <= Rd * Rd : Math.abs(x) <= Rd && Math.abs(y) <= Rd) { const h = H.sol[j * G.n + i]; if (h < zmin) zmin = h; }
  }
  const versZ = z => (z - zmin) * mm * exag + socle, sol = (x, y) => lire(H.sol, G, x, y);
  // toits : soudés et rognés une fois pour toutes les tuiles
  progres("toits", 0);
  const tolToit = Math.max(0.05, (o.toit ?? 0.8) * F.tol / (mm * exag)); // m : les toits du relevé, un peu plus fins que le terrain
  const lots = (d.lots || []).map(lot => preparerLot(lot.releve ? toitsReleve(lot.releve, tolToit) : lot, Rd + 30));
  const rognes = lots.reduce((s, l) => s + l.rognes, 0);
  const tuiles = [], bilan = { solides: 0, fins: 0, repares: 0, ouverts: 0 }, marge = 0.02, cote = 2 * Rd / N;
  let triangles = 0, ouvertes = 0, ecart = 0, zmax = 0;
  for (let lj = 0; lj < N; lj++) for (let ci = 0; ci < N; ci++) {
    progres("terrain", (lj * N + ci) / (N * N));
    const tu = { xa: -Rd + ci * cote, xb: -Rd + (ci + 1) * cote, ya: -Rd + lj * cote, yb: -Rd + (lj + 1) * cote };
    const S = new Sortie(), terrain = solideTerrain(S, H.dessus, G, tu, Rd, rond, versZ, mm, F.tol / (mm * exag), F.max);
    if (!terrain) continue;
    ecart = Math.max(ecart, terrain.ecart * exag);
    progres("batiments", (lj * N + ci) / (N * N));
    for (const { M, T } of lots) {
      // triangles qui touchent la tuile, puis découpe au bord (2 cm en retrait : la coupe reste dans la paroi du terrain)
      let Tt = [];
      for (let t = 0; t < T.length; t += 3) {
        const a = T[t], b = T[t + 1], c = T[t + 2];
        if (Math.max(M.X[a], M.X[b], M.X[c]) < tu.xa || Math.min(M.X[a], M.X[b], M.X[c]) > tu.xb || Math.max(M.Y[a], M.Y[b], M.Y[c]) < tu.ya || Math.min(M.Y[a], M.Y[b], M.Y[c]) > tu.yb) continue;
        Tt.push(a, b, c);
      }
      if (!Tt.length) continue;
      for (const [nx, ny, d0] of [[1, 0, tu.xa + marge], [-1, 0, -(tu.xb - marge)], [0, 1, tu.ya + marge], [0, -1, -(tu.yb - marge)]]) Tt = rogner(M, Tt, ...demiPlan(nx, ny, d0));
      if (rond) Tt = rogner(M, Tt, ...cercle(Rd - marge));
      const b = solidesBatiments(S, M, Tt, sol, versZ, mm, (o.min ?? 0.8) / mm);
      for (const k in bilan) bilan[k] += b[k];
    }
    const pos = S.pos.fin(), idx = S.idx.fin();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = 0;
    for (let p = 0; p < pos.length; p += 3) { if (pos[p] < x0) x0 = pos[p]; if (pos[p] > x1) x1 = pos[p]; if (pos[p + 1] < y0) y0 = pos[p + 1]; if (pos[p + 1] > y1) y1 = pos[p + 1]; if (pos[p + 2] > z1) z1 = pos[p + 2]; }
    for (const s of S.solides) ouvertes += s.ouvertes + s.malOrientees;
    triangles += idx.length / 3; zmax = Math.max(zmax, z1);
    tuiles.push({ ligne: N - lj, colonne: ci + 1, pos, idx, solides: S.solides, origine: [x0, y0], dims: [x1 - x0, y1 - y0, z1] });
  }
  progres("fin", 1);
  return {
    tuiles,
    infos: {
      echelle: 1000 / mm, mm, taille, decoupe: N, zmin, exag, socle, dims: [taille, taille, zmax], triangles, octets: tuiles.reduce((s, t) => s + 84 + 50 * t.idx.length / 3, 0),
      terrains: tuiles.length, batiments: bilan.solides, fins: bilan.fins, repares: bilan.repares, debords: rognes, arbres: H.nbArbres,
      ouvertes, etanche: ouvertes === 0, ecartTerrain: ecart, ms: performance.now() - t0,
    },
  };
}

/** STL binaire (mm) d'un maillage indexé ; `origine` [x, y] est ramenée en (0, 0). Renvoie un Uint8Array. */
export function stlBinaire(pos, idx, entete = "Topograph", origine = [0, 0]) {
  const n = idx.length / 3, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), te = new TextEncoder().encode(entete.slice(0, 79));
  new Uint8Array(buf, 0, te.length).set(te);
  dv.setUint32(80, n, true);
  const [ox, oy] = origine;
  for (let t = 0, o = 84; t < n; t++, o += 50) {
    const a = 3 * idx[3 * t], b = 3 * idx[3 * t + 1], c = 3 * idx[3 * t + 2];
    const ax = pos[a] - ox, ay = pos[a + 1] - oy, az = pos[a + 2], bx = pos[b] - ox, by = pos[b + 1] - oy, bz = pos[b + 2], cx = pos[c] - ox, cy = pos[c + 1] - oy, cz = pos[c + 2];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    dv.setFloat32(o + 12, ax, true); dv.setFloat32(o + 16, ay, true); dv.setFloat32(o + 20, az, true);
    dv.setFloat32(o + 24, bx, true); dv.setFloat32(o + 28, by, true); dv.setFloat32(o + 32, bz, true);
    dv.setFloat32(o + 36, cx, true); dv.setFloat32(o + 40, cy, true); dv.setFloat32(o + 44, cz, true);
  }
  return new Uint8Array(buf);
}
