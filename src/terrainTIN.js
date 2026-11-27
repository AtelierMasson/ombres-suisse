// Terrain TIN : triangulation adaptative de la grille du sol (G.sol, 0,5 m, tirée des points « sol » du relevé).
// Les zones planes sont couvertes de grands triangles ; les arêtes de talus, murs de soutènement, bords de route et
// ruptures de pente gardent les sommets de la grille, jusqu'à ce que chaque cellule soit à moins de `tolerance` du
// maillage (écart vertical). Le calcul (tinNoyau.js) tourne dans un Web Worker.
// Même interface que le maillage en grille (maillages.js, terrain) : position (x est, y altitude − zRef, z sud), uv du
// fond de plan, normales, trous des piscines, découpe au cercle de la maquette ronde. La grille G.sol reste la
// référence des calculs (ombres, heures) ; le TIN sert à l'affichage et au profil de la coupe (G.tin.hauteur).
import * as THREE from "three";
import { solEn } from "./grille.js";
import { decouperCercle } from "./maillages.js";
import { calculerTIN, masqueTIN } from "./tinNoyau.js";

/** Écart vertical maximal toléré entre le TIN et la grille du sol (m). */
export const TOLERANCE_TIN = 0.1;
/** Budget de triangles, en multiple de la grille affichée (1 : jamais plus lourd que la grille ; 0 : sans limite). */
export const BUDGET_TIN = 1;
/** Angle au-delà duquel deux triangles voisins gardent une arête vive (mur, talus) au lieu d'un ombrage lissé. */
const ANGLE_VIF = 60 * Math.PI / 180;
const PUISS2 = Float64Array.from({ length: 51 }, (_, k) => 2 ** k);

let fil = null, numero = 0;
const attentes = new Map();
function viaFil(msg) {
  if (!fil) {
    fil = new Worker(new URL("./terrainTIN.worker.js", import.meta.url), { type: "module" });
    fil.onmessage = ({ data }) => { const a = attentes.get(data.id); attentes.delete(data.id); data.erreur ? a?.non(new Error(data.erreur)) : a?.oui(data); };
    fil.onerror = e => { for (const a of attentes.values()) a.non(new Error(e.message || "TIN : fil arrêté")); attentes.clear(); fil?.terminate(); fil = null; };
  }
  const id = ++numero;
  return new Promise((oui, non) => { attentes.set(id, { oui, non }); fil.postMessage({ id, ...msg }, [msg.h.buffer]); });
}

/** Triangles du maillage en grille affiché (sommets tous les 1 m), dans le cercle pour une maquette ronde. */
export function trianglesGrille(G) {
  const m = Math.floor(G.n / 2);
  return Math.round(2 * m * m * (G.rayonZone ? Math.PI / 4 : 1));
}

/**
 * TIN de la grille G (promesse, gardée sur G par réglage). Résultat : { coords (paires i, j de cellules), triangles,
 * erreurMax (écart atteint), ms, sommets, nbTriangles, tolerance }.
 * `tolerance` : écart vertical visé ; `budget` : au plus budget × les triangles de la grille affichée (le TIN ne
 * pèse jamais plus lourd que la grille ; en terrain très accidenté, c'est le budget qui arrête l'insertion et
 * erreurMax dépasse alors la tolérance). `sansFil` : calcul dans le fil courant (tests, Node).
 */
export function calculerTerrainTIN(G, { tolerance = TOLERANCE_TIN, budget = BUDGET_TIN, sansFil = false } = {}) {
  G.tinCache ||= {};
  const cle = `${tolerance}/${budget}`;
  if (G.tinCache[cle]) return G.tinCache[cle];
  const maxSommets = budget > 0 ? Math.round(trianglesGrille(G) * budget / 2) : Infinity;
  const msg = { h: grilleTIN(G), n: G.n, c: G.c, x0: G.x0, rayon: G.rayonZone || 0, tolerance, maxSommets };
  const p = (async () => {
    const t0 = performance.now();
    const r = sansFil || typeof Worker === "undefined" ? calculerTIN({ ...msg, masque: masqueTIN(msg.n, msg.c, msg.x0, msg.rayon) }) : await viaFil(msg);
    return { ...r, msTotal: performance.now() - t0, tolerance, budget, sommets: r.coords.length / 2, nbTriangles: r.triangles.length / 3 };
  })();
  G.tinCache[cle] = p;
  p.catch(() => { if (G.tinCache?.[cle] === p) delete G.tinCache[cle]; });
  return p;
}

/** À appeler si G.sol change (piscine creusée, terrain modifié) : le TIN sera recalculé. */
export function oublierTIN(G) { G.tinCache = null; if (G.tin) G.tin = null; }

/** Terrain du bord d'une maquette carrée, comme le socle (sommets de la grille tous les 1 m, linéaire entre deux). */
function solBord(G, x, y) {
  const { c, x0 } = G, R = G.n * c / 2, t = v => Math.floor((v - x0) / (2 * c)) * 2 * c + x0;
  if (Math.abs(Math.abs(x) - R) < 1e-6) { const y0 = t(Math.min(y, R - 2 * c)), u = (y - y0) / (2 * c); return solEn(G, x, y0) * (1 - u) + solEn(G, x, y0 + 2 * c) * u; }
  const xa = t(Math.min(x, R - 2 * c)), u = (x - xa) / (2 * c); return solEn(G, xa, y) * (1 - u) + solEn(G, xa + 2 * c, y) * u;
}

/**
 * Sommets en plan (x est, y nord, z absolu) : centre des cellules ; ceux du bord de la grille sont repoussés sur le bord
 * du carré (le TIN couvre alors tout le modèle, comme la grille) et prennent l'altitude du bord du socle.
 */
const coordTIN = (G, i) => i === 0 ? G.x0 : i === G.n - 1 ? G.x0 + G.n * G.c : G.x0 + (i + 0.5) * G.c;
function sommets(G, tin) {
  const n = G.n, C = tin.coords, nv = C.length / 2, X = new Float64Array(nv), Y = new Float64Array(nv), Z = new Float64Array(nv);
  for (let k = 0; k < nv; k++) {
    const i = C[2 * k], j = C[2 * k + 1], bord = i === 0 || j === 0 || i === n - 1 || j === n - 1;
    X[k] = coordTIN(G, i); Y[k] = coordTIN(G, j);
    Z[k] = tin.z ? tin.z[k] : !bord ? G.sol[j * n + i] : G.rayonZone ? solEn(G, X[k], Y[k]) : solBord(G, X[k], Y[k]);
  }
  return { X, Y, Z, nv };
}

/** Grille de hauteurs donnée au noyau : G.sol, le bord remplacé par l'altitude qu'y prendront les sommets. */
function grilleTIN(G) {
  const h = G.sol.slice(), n = G.n, alt = (x, y) => G.rayonZone ? solEn(G, x, y) : solBord(G, x, y);
  for (let k = 0; k < n; k++) for (const [i, j] of [[k, 0], [k, n - 1], [0, k], [n - 1, k]]) h[j * n + i] = alt(coordTIN(G, i), coordTIN(G, j));
  return h;
}

/**
 * Piscines (G.bassins) : les triangles du TIN autour de chaque bassin (rectangle du bassin + 1 m) sont retirés, puis
 * le trou est retriangulé de son bord (sommets du TIN, raccord exact) jusqu'au contour exact du bassin, qui reste un
 * trou (parois, fond et eau : maillageBassins). Un bassin dont le bord n'est pas une boucle simple garde le TIN.
 */
function trouerBassins(G, V, tri) {
  const nt = tri.length / 3, retire = new Uint8Array(nt), ajout = [], plus = [];
  let nv = V.nv;
  const bbT = new Float64Array(nt * 4);
  for (let t = 0; t < nt; t++) {
    const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
    bbT[4 * t] = Math.min(V.X[a], V.X[b], V.X[c]); bbT[4 * t + 1] = Math.max(V.X[a], V.X[b], V.X[c]);
    bbT[4 * t + 2] = Math.min(V.Y[a], V.Y[b], V.Y[c]); bbT[4 * t + 3] = Math.max(V.Y[a], V.Y[b], V.Y[c]);
  }
  for (const B of G.bassins || []) {
    const xs = B.anneau.map(p => p[0]), ys = B.anneau.map(p => p[1]);
    const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1;
    const Rz = G.rayonZone || Infinity, lim = G.n * G.c / 2 - 0.5;
    if ([[x0, y0], [x1, y0], [x0, y1], [x1, y1]].some(([x, y]) => Math.hypot(x, y) > Rz - 0.5 || Math.abs(x) > lim || Math.abs(y) > lim)) continue;
    const ici = [];
    let libre = true;
    for (let t = 0; t < nt && libre; t++) {
      if (bbT[4 * t] > x1 || bbT[4 * t + 1] < x0 || bbT[4 * t + 2] > y1 || bbT[4 * t + 3] < y0) continue;
      if (retire[t]) libre = false; else ici.push(t);
    }
    if (!libre || !ici.length) continue;
    // bord de la zone retirée : arêtes orientées dont l'inverse n'est pas dans la zone
    const aretes = new Set();
    for (const t of ici) for (let s = 0; s < 3; s++) aretes.add(tri[3 * t + s] * nv + tri[3 * t + (s + 1) % 3]);
    const suivant = new Map();
    let simple = true;
    for (const e of aretes) {
      const a = Math.floor(e / nv), b = e % nv;
      if (aretes.has(b * nv + a)) continue;
      if (suivant.has(a)) { simple = false; break; }
      suivant.set(a, b);
    }
    if (!simple || suivant.size < 3) continue;
    const bord = [], debut = suivant.keys().next().value;
    for (let v = debut; bord.length <= suivant.size; ) { bord.push(v); v = suivant.get(v); if (v === debut || v === undefined) break; }
    if (bord.length !== suivant.size) continue;
    for (const t of ici) retire[t] = 1;
    plus.push({ bord, trou: B.anneau, niveau: B.niveau });
  }
  // sommets du contour des bassins, après ceux du TIN
  const X = [], Y = [], Z = [];
  for (const P of plus) {
    const base = nv;
    for (const [x, y] of P.trou) { X.push(x); Y.push(y); Z.push(P.niveau); nv++; }
    const xy = k => k < V.nv ? new THREE.Vector2(V.X[k], V.Y[k]) : new THREE.Vector2(X[k - V.nv], Y[k - V.nv]);
    const ids = [...P.bord, ...P.trou.map((_, i) => base + i)];
    for (const [i, j, l] of THREE.ShapeUtils.triangulateShape(P.bord.map(xy), [P.trou.map((_, i) => xy(base + i))])) {
      const A = ids[i], Bv = ids[j], Cv = ids[l], pa = xy(A), pb = xy(Bv), pc = xy(Cv);
      const cr = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
      if (cr >= 0) ajout.push(A, Bv, Cv); else ajout.push(A, Cv, Bv);
    }
  }
  if (!plus.length) return { tri, X, Y, Z };
  let nRet = 0;
  for (let t = 0; t < nt; t++) nRet += retire[t];
  const sortie = new Uint32Array((nt - nRet) * 3 + ajout.length);
  let q = 0;
  for (let t = 0; t < nt; t++) if (!retire[t]) { sortie[q++] = tri[3 * t]; sortie[q++] = tri[3 * t + 1]; sortie[q++] = tri[3 * t + 2]; }
  sortie.set(ajout, q);
  return { tri: sortie, X, Y, Z };
}

/**
 * Géométrie indexée du TIN avec normales « à arêtes vives » : chaque coin moyenne (pondéré par l'aire) les normales
 * des triangles voisins qui font moins de `angleVif` avec le sien. Le pied et le haut d'un mur restent nets, une pente
 * douce reste lisse. Un sommet n'est dédoublé que là où ses coins n'ont pas la même normale (arête vive).
 */
function geometrieArretesVives(pos, uv, tri, angleVif) {
  const nt = tri.length / 3, nv = pos.length / 3, fn = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = 3 * tri[3 * t], b = 3 * tri[3 * t + 1], c = 3 * tri[3 * t + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    fn[3 * t] = uy * vz - uz * vy; fn[3 * t + 1] = uz * vx - ux * vz; fn[3 * t + 2] = ux * vy - uy * vx; // longueur = 2 × aire
  }
  // triangles autour de chaque sommet (CSR)
  const deb = new Uint32Array(nv + 1);
  for (let k = 0; k < tri.length; k++) deb[tri[k] + 1]++;
  for (let v = 0; v < nv; v++) deb[v + 1] += deb[v];
  const autour = new Uint32Array(tri.length), rem = deb.slice(0, nv);
  for (let k = 0; k < tri.length; k++) autour[rem[tri[k]]++] = (k / 3) | 0;
  const fu = new Float32Array(nt * 3); // normales unitaires
  for (let t = 0; t < nt; t++) { const l = Math.sqrt(fn[3 * t] ** 2 + fn[3 * t + 1] ** 2 + fn[3 * t + 2] ** 2) || 1; fu[3 * t] = fn[3 * t] / l; fu[3 * t + 1] = fn[3 * t + 1] / l; fu[3 * t + 2] = fn[3 * t + 2] / l; }
  const cosVif = Math.cos(angleVif), max = tri.length, P = new Float32Array(max * 3), N = new Float32Array(max * 3), U = new Float32Array(max * 2), idx = new Uint32Array(tri.length);
  // sommets émis, par sommet d'origine (liste chaînée) : clé de l'ensemble des triangles voisins retenus
  const tete = new Int32Array(nv).fill(-1), suiv = new Int32Array(max), cleE = new Float64Array(max);
  let ne = 0;
  for (let t = 0; t < nt; t++) {
    const nx = fu[3 * t], ny = fu[3 * t + 1], nz = fu[3 * t + 2];
    for (let s = 0; s < 3; s++) {
      const v = tri[3 * t + s];
      let sx = 0, sy = 0, sz = 0, cle = 0;
      // sommet d'éventail très chargé (coins du carré, hors du cercle) : normale du triangle seule (sinon coût quadratique)
      if (deb[v + 1] - deb[v] > 48) { sx = nx; sy = ny; sz = nz; cle = -1 - t; }
      else for (let q = deb[v]; q < deb[v + 1]; q++) {
        const f = autour[q];
        if (fu[3 * f] * nx + fu[3 * f + 1] * ny + fu[3 * f + 2] * nz >= cosVif) { sx += fn[3 * f]; sy += fn[3 * f + 1]; sz += fn[3 * f + 2]; cle += PUISS2[Math.min(q - deb[v], 50)]; } // (au-delà de 50 voisins : rare, clé approchée)
      }
      // même ensemble de triangles voisins retenus → même normale → même sommet
      let k = tete[v];
      while (k >= 0 && cleE[k] !== cle) k = suiv[k];
      if (k < 0) {
        k = ne++;
        const ls = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        P[3 * k] = pos[3 * v]; P[3 * k + 1] = pos[3 * v + 1]; P[3 * k + 2] = pos[3 * v + 2];
        N[3 * k] = sx / ls; N[3 * k + 1] = sy / ls; N[3 * k + 2] = sz / ls;
        U[2 * k] = uv[2 * v]; U[2 * k + 1] = uv[2 * v + 1];
        cleE[k] = cle; suiv[k] = tete[v]; tete[v] = k;
      }
      idx[3 * t + s] = k;
    }
  }
  return { P: P.slice(0, 3 * ne), N: N.slice(0, 3 * ne), U: U.slice(0, 2 * ne), idx };
}

/**
 * Maillage three.js du TIN (repère de la scène), à la place de terrain(G, zRef) : géométrie indexée (position,
 * normal, uv). Maquette ronde : seuls les triangles qui touchent le cercle sont coupés (decouperCercle), puis leurs
 * sommets du bord prennent l'altitude de la grille (raccord exact avec la paroi du socle).
 */
export function maillageTIN(G, tin, zRef, { angleVif = ANGLE_VIF } = {}) {
  const temps = [performance.now()], top = () => temps.push(performance.now());
  const V = sommets(G, tin), T = tin.triangles, nt = T.length / 3, tri = new Uint32Array(T.length);
  // le noyau tourne dans le sens horaire vu de dessus : sens trigonométrique ici (normale vers le haut)
  for (let t = 0; t < nt; t++) { tri[3 * t] = T[3 * t]; tri[3 * t + 1] = T[3 * t + 2]; tri[3 * t + 2] = T[3 * t + 1]; }
  top();
  const B = trouerBassins(G, V, tri), nv = V.nv + B.X.length, pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  top();
  for (let k = 0; k < nv; k++) {
    const x = k < V.nv ? V.X[k] : B.X[k - V.nv], y = k < V.nv ? V.Y[k] : B.Y[k - V.nv], z = k < V.nv ? V.Z[k] : B.Z[k - V.nv];
    pos[3 * k] = x; pos[3 * k + 1] = z - zRef; pos[3 * k + 2] = -y;
    uv[2 * k] = (x - G.x0) / (2 * G.R); uv[2 * k + 1] = (y - G.x0) / (2 * G.R);
  }
  let { P, N, U, idx } = geometrieArretesVives(pos, uv, B.tri, angleVif);
  top();
  const Rz = G.rayonZone;
  if (Rz) {
    const r2 = Rz * Rz, d2 = k => P[3 * k] ** 2 + P[3 * k + 2] ** 2, nt2 = idx.length / 3, dedans = new Uint8Array(nt2);
    let nBord = 0;
    for (let t = 0; t < nt2; t++) if (d2(idx[3 * t]) <= r2 && d2(idx[3 * t + 1]) <= r2 && d2(idx[3 * t + 2]) <= r2) dedans[t] = 1; else nBord++;
    // triangles à cheval ou dehors : non indexés, coupés au cercle
    const gb = new THREE.BufferGeometry(), at = (src, w) => {
      const a = new Float32Array(nBord * 3 * w);
      for (let t = 0, q = 0; t < nt2; t++) if (!dedans[t]) { for (let s = 0; s < 3; s++) for (let c = 0; c < w; c++) a[(3 * q + s) * w + c] = src[idx[3 * t + s] * w + c]; q++; }
      return a;
    };
    gb.setAttribute("position", new THREE.BufferAttribute(at(P, 3), 3));
    gb.setAttribute("normal", new THREE.BufferAttribute(at(N, 3), 3));
    gb.setAttribute("uv", new THREE.BufferAttribute(at(U, 2), 2));
    const gc = decouperCercle(gb, Rz), pc = gc.attributes.position.array, nc = pc.length / 3;
    for (let k = 0; k < pc.length; k += 3) if (Math.hypot(pc[k], pc[k + 2]) > Rz - 0.02) pc[k + 1] = solEn(G, pc[k], -pc[k + 2]) - zRef;
    // sommets indexés gardés (renumérotés), puis ceux des triangles coupés
    const nouv = new Int32Array(P.length / 3).fill(-1), nv0 = P.length / 3;
    const P2 = new Float32Array((nv0 + nc) * 3), N2 = new Float32Array((nv0 + nc) * 3), U2 = new Float32Array((nv0 + nc) * 2), I2 = new Uint32Array((nt2 - nBord) * 3 + nc);
    let nv2 = 0, ni = 0;
    for (let t = 0; t < nt2; t++) if (dedans[t]) for (let s = 0; s < 3; s++) {
      const v = idx[3 * t + s];
      if (nouv[v] < 0) {
        nouv[v] = nv2;
        P2[3 * nv2] = P[3 * v]; P2[3 * nv2 + 1] = P[3 * v + 1]; P2[3 * nv2 + 2] = P[3 * v + 2];
        N2[3 * nv2] = N[3 * v]; N2[3 * nv2 + 1] = N[3 * v + 1]; N2[3 * nv2 + 2] = N[3 * v + 2];
        U2[2 * nv2] = U[2 * v]; U2[2 * nv2 + 1] = U[2 * v + 1]; nv2++;
      }
      I2[ni++] = nouv[v];
    }
    P2.set(pc, 3 * nv2); N2.set(gc.attributes.normal.array, 3 * nv2); U2.set(gc.attributes.uv.array, 2 * nv2);
    for (let k = 0; k < nc; k++) I2[ni++] = nv2 + k;
    gc.dispose();
    P = P2.slice(0, 3 * (nv2 + nc)); N = N2.slice(0, 3 * (nv2 + nc)); U = U2.slice(0, 2 * (nv2 + nc)); idx = I2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  top();
  // durées (ms) : sommets, piscines, normales, cercle
  const ms = temps.slice(1).map((t, k) => Math.round(t - temps[k]));
  g.userData.tin = { sommets: tin.sommets, triangles: idx.length / 3, tolerance: tin.tolerance, erreurMax: tin.erreurMax, ms };
  return g;
}

/**
 * Altitude absolue du TIN en (x, y) (repère relatif, y nord) : triangles rangés dans des cases de 4 m. Hors du TIN
 * (ne devrait pas arriver dans le carré) : la grille.
 */
export function hauteurTIN(G, tin) {
  const V = sommets(G, tin), T = tin.triangles, pas = 4, x0 = G.x0, nb = Math.ceil(G.n * G.c / pas), cases = Array.from({ length: nb * nb }, () => []);
  const ix = v => Math.max(0, Math.min(nb - 1, Math.floor((v - x0) / pas)));
  for (let t = 0; t < T.length / 3; t++) {
    const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
    const i0 = ix(Math.min(V.X[a], V.X[b], V.X[c])), i1 = ix(Math.max(V.X[a], V.X[b], V.X[c]));
    const j0 = ix(Math.min(V.Y[a], V.Y[b], V.Y[c])), j1 = ix(Math.max(V.Y[a], V.Y[b], V.Y[c]));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cases[j * nb + i].push(t);
  }
  return (x, y) => {
    for (const t of cases[ix(y) * nb + ix(x)]) {
      const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
      const ax = V.X[a], ay = V.Y[a], bx = V.X[b] - ax, by = V.Y[b] - ay, cx = V.X[c] - ax, cy = V.Y[c] - ay, px = x - ax, py = y - ay;
      const d = bx * cy - by * cx;
      if (!d) continue;
      const u = (px * cy - py * cx) / d, v = (bx * py - by * px) / d;
      if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) return V.Z[a] + u * (V.Z[b] - V.Z[a]) + v * (V.Z[c] - V.Z[a]);
    }
    return solEn(G, x, y);
  };
}

/**
 * Mesures (console, docs/terrain-tin.md) : triangles du TIN et de la grille affichée, écarts verticaux du TIN, de la
 * grille affichée (1 m) et de la grille 0,5 m aux points « sol » (classe 2) du relevé, dans le cercle.
 * `grilleAffichee(x, y)` : altitude du maillage en grille (solAffiche de pontsAuto.js).
 */
export function mesuresTIN(G, tin, nuage, grilleAffichee) {
  const h = hauteurTIN(G, tin), Rz = (G.rayonZone || G.R) - 1, { n, c, x0 } = G;
  const modeles = { tin: h, grille1m: grilleAffichee, grille05: (x, y) => solEn(G, x, y) };
  // cellules où le sol est reconstruit, pas mesuré (fond des lacs, dessous des ponts) : écartées
  const reconstruit = p => !isNaN(G.eau?.[p]) || !isNaN(G.pont?.[p]);
  const stats = ech => {
    const r = {};
    for (const [cle, d] of Object.entries(ech)) {
      const a = Float32Array.from(d, Math.abs).sort(), s = d.reduce((t, v) => t + v * v, 0), m = d.reduce((t, v) => t + v, 0);
      r[cle] = { max: +a.at(-1)?.toFixed(3), p99: +a[Math.floor(a.length * 0.99)]?.toFixed(3), rms: +Math.sqrt(s / d.length).toFixed(3), biais: +(m / d.length).toFixed(3) };
    }
    return r;
  };
  // 1. points « sol » (classe 2) du relevé, un sur quatre
  const P = { tin: [], grille1m: [], grille05: [] };
  if (nuage) for (let k = 0; k < nuage.n; k += 4) {
    if (nuage.C[k] !== 2) continue;
    const x = nuage.X[k], y = nuage.Y[k], z = nuage.Z[k];
    if (x * x + y * y > Rz * Rz || Math.abs(x) > G.R - 1 || Math.abs(y) > G.R - 1) continue;
    if (reconstruit(Math.floor((y - x0) / c) * n + Math.floor((x - x0) / c))) continue;
    for (const cle in P) P[cle].push(modeles[cle](x, y) - z);
  }
  // 2. centres des cellules de la grille 0,5 m (G.sol)
  const S = { tin: [], grille1m: [] };
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const x = x0 + (i + 0.5) * c, y = x0 + (j + 0.5) * c, p = j * n + i;
    if (x * x + y * y > Rz * Rz || reconstruit(p)) continue;
    for (const cle in S) S[cle].push(modeles[cle](x, y) - G.sol[p]);
  }
  return {
    tolerance: tin.tolerance, sommets: tin.sommets, trianglesTIN: tin.nbTriangles,
    msNoyau: Math.round(tin.ms), msTotal: Math.round(tin.msTotal), pointsSol: P.tin.length,
    auxPointsSol: stats(P), aLaGrille05: stats(S),
  };
}
