// Ponts reconstruits automatiquement à partir du relevé laser : un modèle par pont (cellules « pont » connexes de la
// grille), calculé une fois avant la coupe au cercle (`modeliserPonts(G, nuage)` → `G.ponts`). Le modèle a le schéma
// des ponts faits main (pontsModeles.js : axe, largeur, épaisseur, appuis, arches), complété station par station
// (rives, dévers, raccords) ; un seul mailleur pour les deux (`maillagePont`).
// Repère : relatif au centre (x est, y nord), altitudes absolues. Voir docs/ponts-methode.md.
import { solEn } from "./grille.js";
import { coteDeck, projeterNoeuds } from "./pontsModeles.js";

/** Hauteur du terrain tel qu'il est affiché (triangles d'un mètre de `terrain`) au point (x, y). */
export function solAffiche(G, x, y) {
  const pas = 2 * G.c, a = Math.floor((x - G.x0) / pas), b = Math.floor((y - G.x0) / pas), u = (x - G.x0) / pas - a, v = (y - G.x0) / pas - b;
  const z = (i, j) => solEn(G, G.x0 + i * pas, G.x0 + j * pas), z00 = z(a, b), z11 = z(a + 1, b + 1);
  return u >= v ? z00 + u * (z(a + 1, b) - z00) + v * (z11 - z(a + 1, b)) : z00 + u * (z11 - z(a, b + 1)) + v * (z(a, b + 1) - z00);
}

/**
 * Axe droit d'un pont court : les bouts sont les cases du bord du tablier dont la voisine hors du pont est au sol, au
 * niveau de la chaussée (± 0,75 m), regroupées par contiguïté ; l'axe relie les centres des deux plus grands groupes,
 * prolongé de 6 m au-delà des cases extrêmes. Null si le pont n'a pas deux bouts nets, ou s'ils sont à plus de 60 m.
 */
function axeDroit(G, cel, rang, X, Y) {
  const { n, c, pont, sol } = G, bord = [];
  for (let k = 0; k < cel.length; k++) {
    const p = cel[k], i = p % n;
    for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
      if (q >= 0 && q < n * n && !rang.has(q) && Math.abs(sol[q] - pont[p]) < 0.75) { bord.push(k); break; }
  }
  // groupes de cases de bout voisines (à 1 m près)
  const dansBord = new Map(bord.map(k => [cel[k], k])), vu = new Set(), groupes = [], r = Math.round(1 / c);
  for (const k0 of bord) {
    if (vu.has(k0)) continue;
    const g = [k0], pile = [k0];
    vu.add(k0);
    while (pile.length) {
      const k = pile.pop(), p = cel[k], i = p % n, j = Math.floor(p / n);
      for (let b = j - r; b <= j + r; b++) for (let a = i - r; a <= i + r; a++) {
        const kk = a >= 0 && a < n ? dansBord.get(b * n + a) : undefined;
        if (kk !== undefined && !vu.has(kk)) { vu.add(kk); g.push(kk); pile.push(kk); }
      }
    }
    groupes.push(g);
  }
  groupes.sort((a, b) => b.length - a.length);
  if (groupes.length < 2 || groupes[1].length < 6) return null;
  const centre = g => [g.reduce((s, k) => s + X[k], 0) / g.length, g.reduce((s, k) => s + Y[k], 0) / g.length];
  const A = centre(groupes[0]), B = centre(groupes[1]), L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (L < 4 || L > 60) return null;
  const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (let k = 0; k < cel.length; k++) {
    const s = (X[k] - A[0]) * ux + (Y[k] - A[1]) * uy, t = (Y[k] - A[1]) * ux - (X[k] - A[0]) * uy;
    if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t;
  }
  // le tablier entier doit être petit, dans les deux sens : un long pont dont deux groupes proches touchent le sol
  // (rampe, trottoir au niveau de la rue) garde l'axe suivi dans le tablier
  if (s1 - s0 > 80 || t1 - t0 > 60) return null;
  return [[A[0] + ux * (s0 - 6), A[1] + uy * (s0 - 6)], [A[0] + ux * (s1 + 6), A[1] + uy * (s1 + 6)]];
}

/** Droite ajustée sur des points [x, y] par moindres carrés, en écartant à trois reprises les points trop éloignés. */
function droiteRobuste(P) {
  let pts = P, f = () => 0;
  for (let tour = 0; tour < 4; tour++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const m = pts.length, det = m * sxx - sx * sx, a = det > 1e-9 ? (m * sxy - sx * sy) / det : 0, b = (sy - a * sx) / m;
    f = x => a * x + b;
    if (tour === 3) break;
    const e = pts.map(([x, y]) => Math.abs(y - f(x))).sort((u, v) => u - v), lim = Math.max(0.3, 2.5 * e[e.length >> 1]);
    const garde = pts.filter(([x, y]) => Math.abs(y - f(x)) <= lim);
    if (garde.length < 3) break;
    pts = garde;
  }
  return f;
}

/**
 * Lissage de Whittaker d'une suite régulière : minimise Σ w (z − y)² + λ Σ (courbure de z)². Les valeurs NaN ou de
 * poids nul sont franchies en ligne droite ; λ fixe la raideur (longueur d'onde gardée ≈ 2π λ^¼ pas).
 */
function lisser(y, w, lambda) {
  const m = y.length;
  if (m < 3) { const ok = Array.from(y).filter((v, i) => w[i] > 0 && !isNaN(v)), moy = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0; return Float64Array.from(y, (v, i) => w[i] > 0 && !isNaN(v) ? v : moy); }
  // matrice à cinq bandes A = W + λ DᵀD (D : différences secondes) : diagonale d0, puis d1 et d2
  const d0 = new Float64Array(m), d1 = new Float64Array(m), d2 = new Float64Array(m), z = new Float64Array(m);
  for (let i = 0; i < m; i++) { const p = w[i] > 0 && !isNaN(y[i]) ? w[i] : 0; d0[i] = p + 1e-9; z[i] = p ? p * y[i] : 0; }
  for (let i = 0; i < m - 2; i++) { d0[i] += lambda; d0[i + 1] += 4 * lambda; d0[i + 2] += lambda; d1[i] -= 2 * lambda; d1[i + 1] -= 2 * lambda; d2[i] += lambda; }
  // factorisation L D Lᵀ en place (d0 : D ; d1, d2 : les deux sous-diagonales de L), puis les deux substitutions
  for (let i = 0; i < m; i++) {
    if (i >= 1) d0[i] -= d1[i - 1] * d1[i - 1] * d0[i - 1];
    if (i >= 2) d0[i] -= d2[i - 2] * d2[i - 2] * d0[i - 2];
    if (i >= 1) d1[i] -= d1[i - 1] * d2[i - 1] * d0[i - 1];
    d1[i] /= d0[i]; d2[i] /= d0[i];
  }
  for (let i = 0; i < m; i++) { if (i >= 1) z[i] -= d1[i - 1] * z[i - 1]; if (i >= 2) z[i] -= d2[i - 2] * z[i - 2]; }
  for (let i = m - 1; i >= 0; i--) { z[i] /= d0[i]; if (i + 1 < m) z[i] -= d1[i] * z[i + 1]; if (i + 2 < m) z[i] -= d2[i] * z[i + 2]; }
  return z;
}

/** Lissage robuste : les valeurs à plus de max(`seuil`, 2,5 écarts médians) de la courbe sont écartées, trois fois. */
function lisserRobuste(y, lambda, seuil, poids = null) {
  const p0 = Float64Array.from(y, (v, i) => isNaN(v) ? 0 : poids ? poids[i] : 1);
  let z = lisser(y, p0, lambda);
  for (let tour = 0; tour < 3; tour++) {
    const e = [];
    for (let i = 0; i < y.length; i++) if (p0[i] > 0) e.push(Math.abs(y[i] - z[i]));
    if (e.length < 4) break;
    e.sort((a, b) => a - b);
    const lim = Math.max(seuil, 2.5 * e[e.length >> 1]);
    z = lisser(y, p0.map((p, i) => p > 0 && Math.abs(y[i] - z[i]) <= lim ? p : 0), lambda);
  }
  return z;
}

const med = a => { if (!a.length) return NaN; a.sort((u, v) => u - v); return a[a.length >> 1]; };
const quantile = (a, f) => { if (!a.length) return NaN; const b = [...a].sort((u, v) => u - v); return b[Math.min(b.length - 1, Math.max(0, Math.floor(f * b.length)))]; };

/** Composantes connexes (4-voisinage) des cases où `garde(p)` est vrai. */
function composantes(n, garde) {
  const vu = new Uint8Array(n * n), out = [];
  for (let p0 = 0; p0 < n * n; p0++) {
    if (vu[p0] || !garde(p0)) continue;
    const cel = [], pile = [p0];
    vu[p0] = 1;
    while (pile.length) {
      const p = pile.pop(), i = p % n;
      cel.push(p);
      for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
        if (q >= 0 && q < n * n && !vu[q] && garde(q)) { vu[q] = 1; pile.push(q); }
    }
    out.push(cel);
  }
  return out;
}

/**
 * Tabliers jumeaux soudés : deux chaussées parallèles séparées d'une fente que la grille a bouchée (`fermer`) ou d'une
 * marche de hauteur. Le long du pont (tranches de 4 m selon l'axe principal des cases), on cherche en travers un vide
 * d'au moins 1 m dans les cases relevées avant fermeture (`brut`), ou un saut de niveau de plus de 0,8 m entre deux
 * bandes larges d'au moins 5 m ; présent sur au moins 60 % des tranches à la même place (à 2 m près), le pont est
 * scindé le long de cette ligne. Renvoie une ou deux listes de cases.
 */
function scinderJumeaux(G, cel, brut) {
  const { n, c, x0, pont } = G;
  if (cel.length * c * c < 600) return [cel];
  // axe principal (moindres carrés) : direction u, normale v
  let mx = 0, my = 0;
  const X = cel.map(p => x0 + (p % n + 0.5) * c), Y = cel.map(p => x0 + (Math.floor(p / n) + 0.5) * c);
  for (let k = 0; k < cel.length; k++) { mx += X[k]; my += Y[k]; }
  mx /= cel.length; my /= cel.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (let k = 0; k < cel.length; k++) { const dx = X[k] - mx, dy = Y[k] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(a), uy = Math.sin(a);
  const S = X.map((x, k) => (x - mx) * ux + (Y[k] - my) * uy), T = X.map((x, k) => -(x - mx) * uy + (Y[k] - my) * ux);
  const sMin = Math.min(...S), sMax = Math.max(...S);
  if (sMax - sMin < 40) return [cel];
  // un pont courbe : les tranches suivent l'axe principal ; la ligne de coupe est cherchée tranche par tranche
  const LT = 8, nbT = Math.ceil((sMax - sMin) / LT), tr = Array.from({ length: nbT }, () => []);
  for (let k = 0; k < cel.length; k++) tr[Math.min(nbT - 1, Math.floor((S[k] - sMin) / LT))].push(k);
  const coupes = [];
  for (const K of tr) {
    if (K.length < 20) { coupes.push(NaN); continue; }
    const tMin = Math.min(...K.map(k => T[k])), nb = Math.ceil((Math.max(...K.map(k => T[k])) - tMin) / 0.5) + 1;
    const occ = new Int32Array(nb), z = Array.from({ length: nb }, () => []);
    for (const k of K) { const b = Math.floor((T[k] - tMin) / 0.5); if (!isNaN(brut[cel[k]])) occ[b]++; z[b].push(pont[cel[k]]); }
    const zb = z.map(v => v.length ? med(v) : NaN);
    // candidats : centre d'un vide (≥ 1 m sans case brute) ou d'un saut de niveau, avec ≥ 5 m de tablier de chaque côté
    let mieux = NaN, score = 0;
    for (let b = 10; b < nb - 10; b++) {
      let vide = 0;
      while (b + vide < nb && occ[b + vide] === 0) vide++;
      const gauche = zb.slice(Math.max(0, b - 10), b).filter(v => !isNaN(v)), droite = zb.slice(b + vide, b + vide + 10).filter(v => !isNaN(v));
      if (gauche.length < 6 || droite.length < 6) continue;
      const saut = Math.abs(med([...gauche]) - med([...droite]));
      const sc = vide >= 2 ? 1 + vide : saut > 0.8 ? 1 + saut : 0;
      if (sc > score) { score = sc; mieux = tMin + (b + vide / 2) * 0.5; }
      if (vide) b += vide;
    }
    coupes.push(mieux);
  }
  const ok = coupes.filter(v => !isNaN(v));
  if (ok.length < 0.6 * nbT || ok.length < 3) return [cel];
  // ligne de coupe : médiane glissante des tranches ; tranches sans coupe : reprise des voisines
  const ligne = coupes.map((v, i) => { const w = coupes.slice(Math.max(0, i - 1), i + 2).filter(x => !isNaN(x)); return w.length ? med(w) : NaN; });
  const coh = ligne.filter((v, i) => !isNaN(v) && !isNaN(coupes[i]) && Math.abs(v - coupes[i]) < 2).length;
  if (coh < 0.6 * nbT) return [cel];
  for (let i = 0, der = NaN; i < nbT; i++) { if (isNaN(ligne[i])) ligne[i] = der; else der = ligne[i]; }
  for (let i = nbT - 1, der = NaN; i >= 0; i--) { if (isNaN(ligne[i])) ligne[i] = der; else der = ligne[i]; }
  const ligneEn = s => { const f = Math.max(0, Math.min(nbT - 1, (s - sMin) / LT - 0.5)), i = Math.min(nbT - 2, Math.floor(f)); return nbT < 2 ? ligne[0] : ligne[i] + (ligne[i + 1] - ligne[i]) * (f - i); };
  const A = [], B = [];
  for (let k = 0; k < cel.length; k++) (T[k] < ligneEn(S[k]) ? A : B).push(cel[k]);
  if (A.length * c * c < 200 || B.length * c * c < 200) return [cel];
  return [A, B];
}

/**
 * Modèle de chaque pont du relevé : `G.ponts` (liste de modèles), `G.pontsRepli` (cases des ponts que le modèle décrit
 * mal, rendues case par case). Avec `graver`, le profil de la chaussée est gravé dans `G.sol` à l'approche de chaque
 * joint (le terrain ne dépasse plus la chaussée). À appeler avant `garderCercle` et avant la surface.
 */
export function modeliserPonts(G, nuage = null, { graver = true } = {}) {
  const { n, c, x0, pont, pontBas } = G;
  G.ponts = []; G.pontsRepli = [];
  if (!pont || !pont.some(v => !isNaN(v))) return G.ponts;
  const sous = pontBas || pont.map(z => z - 1.5);
  // points vus sous le tablier (nuage du relevé) : classe « pont » à moins de 7 m sous la chaussée = dessous du
  // tablier ; plus bas, ou classe 27 (ouvrages) = piles ; [x, y, z] gardés pour les regrouper en travers et en long
  const intrados = new Map(), piles = new Map(), ouvrages = new Map();
  if (nuage) {
    const { X, Y, Z, C } = nuage;
    for (let k = 0; k < nuage.n; k++) {
      const cl = C[k];
      if (cl !== 17 && cl !== 27 && cl !== 1 && cl !== 26) continue;
      const i = Math.floor((X[k] - x0) / c), j = Math.floor((Y[k] - x0) / c);
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const p = j * n + i, d = pont[p] - Z[k];
      if (!(d > 1)) continue;
      // tous les points d'ouvrage sous le tablier : arches (le relevé les laisse souvent « non classés »)
      (ouvrages.get(p) || ouvrages.set(p, []).get(p)).push(Z[k]);
      if (cl !== 17 && cl !== 27) continue;
      const M = cl === 17 && d < 7 ? intrados : piles;
      (M.get(p) || M.set(p, []).get(p)).push(Z[k]);
    }
  }
  const avecNuage = !!nuage;
  // cases « pont » à moins d'un mètre du sol : sol sous le tablier classé « pont », ou bout de pont posé sur la route.
  // Elles ne font pas le tablier (le raccord aux bouts rejoint la route)
  const tabliers = [];
  for (const cel of composantes(n, p => !isNaN(pont[p]) && pont[p] - G.sol[p] > 1))
    if (cel.length * c * c >= 20) tabliers.push(...scinderJumeaux(G, cel, G.pontBrut || pont));
  const graveurs = [];

  // modèle d'un pont (ses cellules) ; null s'il doit être rendu tel que relevé
  const modeliser = cel => {
    // axe du pont, droit ou courbe : on ordonne les cellules le long du pont (distance dans le tablier depuis un bout),
    // puis l'axe est la suite des centres par tranche, lissée ; chaque cellule est ensuite projetée sur cet axe :
    // abscisse curviligne s et écart t (positif à gauche)
    const X = cel.map(p => x0 + (p % n + 0.5) * c), Y = cel.map(p => x0 + (Math.floor(p / n) + 0.5) * c);
    const rang = new Map(cel.map((p, k) => [p, k]));
    // pont court (bouts à moins de 60 m l'un de l'autre) : axe droit d'un bout à l'autre. Pour un pont aussi large que
    // long (rue qui franchit un canal), le parcours dans le tablier part d'un coin et donne un axe en biais
    const droit = axeDroit(G, cel, rang, X, Y);
    let axe = droit;
    if (!axe) {
      const parcours = depart => {
        const d = new Int32Array(cel.length).fill(-1), file = [depart];
        d[depart] = 0;
        for (let f = 0; f < file.length; f++) {
          const k = file[f], p = cel[k], i = p % n;
          for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n, i > 0 ? p - n - 1 : -1, i < n - 1 ? p - n + 1 : -1, i > 0 ? p + n - 1 : -1, i < n - 1 ? p + n + 1 : -1]) {
            const r = rang.get(q);
            if (r !== undefined && d[r] < 0) { d[r] = d[k] + 1; file.push(r); }
          }
        }
        return d;
      };
      let d0 = parcours(0), bout = 0;
      for (let k = 0; k < cel.length; k++) if (d0[k] > d0[bout]) bout = k;
      const dA = parcours(bout);
      let dmax = 0;
      for (let k = 0; k < cel.length; k++) if (dA[k] > dmax) dmax = dA[k];
      // centres par tranche de 4 m de parcours
      const tr = Math.max(1, Math.round(4 / c)), nt = Math.floor(dmax / tr) + 1, cx = new Float64Array(nt), cy = new Float64Array(nt), cn = new Int32Array(nt);
      for (let k = 0; k < cel.length; k++) { if (dA[k] < 0) continue; const q = Math.floor(dA[k] / tr); cx[q] += X[k]; cy[q] += Y[k]; cn[q]++; }
      // les tranches des bouts (coins du tablier, peu de cases) tirent l'axe de travers : écartées
      const plein = med(Array.from(cn).filter(v => v > 0));
      let q0 = 0, q1 = nt - 1;
      while (q1 - q0 > 2 && cn[q0] < 0.6 * plein) q0++;
      while (q1 - q0 > 2 && cn[q1] < 0.6 * plein) q1--;
      axe = [];
      for (let q = q0; q <= q1; q++) if (cn[q]) axe.push([cx[q] / cn[q], cy[q] / cn[q]]);
      if (axe.length < 2) return null;
      // lissage (trois passes), bouts fixes
      for (let passe = 0; passe < 3; passe++) axe = axe.map((v, i) => i === 0 || i === axe.length - 1 ? v : [(axe[i - 1][0] + 2 * v[0] + axe[i + 1][0]) / 4, (axe[i - 1][1] + 2 * v[1] + axe[i + 1][1]) / 4]);
      // presque droit (moins de 40 cm d'écart à la corde) : une droite
      {
        const [ax, ay] = axe[0], [bx, by] = axe.at(-1), L = Math.hypot(bx - ax, by - ay) || 1;
        if (axe.every(([x, y]) => Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) / L < 0.4)) axe = [axe[0], axe.at(-1)];
      }
    }
    // prolongement de 45 m à chaque bout, dans la direction des 12 derniers mètres (raccord à la route, projection)
    {
      const vers = (A, B) => { const dx = A[0] - B[0], dy = A[1] - B[1], l = Math.hypot(dx, dy) || 1; return [A[0] + dx / l * 45, A[1] + dy / l * 45]; };
      const k = Math.min(3, axe.length - 1);
      axe = [vers(axe[0], axe[k]), ...axe, vers(axe.at(-1), axe.at(-1 - k))];
    }
    const cum = [0];
    for (let i = 1; i < axe.length; i++) cum.push(cum[i - 1] + Math.hypot(axe[i][0] - axe[i - 1][0], axe[i][1] - axe[i - 1][1]));
    // normale (gauche) à chaque nœud : perpendiculaire à la corde de ses deux voisins, interpolée entre les nœuds
    const nrm = axe.map((_, i) => { const A = axe[Math.max(0, i - 1)], B = axe[Math.min(axe.length - 1, i + 1)], l = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1; return [-(B[1] - A[1]) / l, (B[0] - A[0]) / l]; });
    const noeudsAxe = { x: axe.map(v => v[0]), y: axe.map(v => v[1]), s: cum };
    const projeter = (x, y) => projeterNoeuds(noeudsAxe, x, y);
    // point et normale (gauche) de l'axe à l'abscisse s
    const surAxe = s => {
      let i = 0;
      while (i < axe.length - 2 && cum[i + 1] < s) i++;
      const [ax, ay] = axe[i], [bx, by] = axe[i + 1], L = cum[i + 1] - cum[i] || 1, u = Math.max(0, Math.min(1, (s - cum[i]) / L));
      const nx = nrm[i][0] + (nrm[i + 1][0] - nrm[i][0]) * u, ny = nrm[i][1] + (nrm[i + 1][1] - nrm[i][1]) * u, l = Math.hypot(nx, ny) || 1;
      return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, nx: nx / l, ny: ny / l };
    };
    const enPlan = (s, t) => { const A = surAxe(s); return [A.x + A.nx * t, A.y + A.ny * t]; };
    // stations d'un mètre le long de l'axe
    let s0 = Infinity, s1 = -Infinity;
    const ST = cel.map((p, k) => { const v = projeter(X[k], Y[k]); if (v[0] < s0) s0 = v[0]; if (v[0] > s1) s1 = v[0]; return v; });
    const nb = Math.max(2, Math.ceil(s1 - s0) + 1), st = Array.from({ length: nb }, () => ({ g: Infinity, d: -Infinity, c: [], b: [], pts: [], ouv: [], sol: Infinity }));
    for (let k = 0; k < cel.length; k++) {
      const [sk, t] = ST[k], q = Math.min(nb - 1, Math.round(sk - s0)), T = st[q], p = cel[k];
      if (t - c / 2 < T.g) T.g = t - c / 2;
      if (t + c / 2 > T.d) T.d = t + c / 2;
      T.c.push([t, pont[p]]);
      if (avecNuage) {
        for (const z of intrados.get(p) || []) T.b.push(z);
        // piles : points sous le tablier, avec leur écart en travers (regroupés plus bas en s et en t)
        for (const z of piles.get(p) || []) T.pts.push([t, z, sk]);
        for (const z of ouvrages.get(p) || []) T.ouv.push(z);
        if (!isNaN(G.sol[p]) && G.sol[p] < T.sol) T.sol = G.sol[p];
      } else if (!isNaN(sous[p])) T.b.push(sous[p]);
    }
    // rives : droites pour un pont court (largeur constante ou linéaire, moindres carrés robustes) ; sinon une courbe
    // raide qui écarte les cases isolées du bord (trottoirs, quais, bouts de rue classés « pont »)
    const brut = cle => st.map(T => T.g === Infinity ? NaN : T[cle]);
    let gA, dA;
    if (droit && nb >= 4) {
      [gA, dA] = ["g", "d"].map(cle => { const f = droiteRobuste(st.map((T, q) => [q, T[cle]]).filter(v => isFinite(v[1]))); return Float64Array.from(st, (_, q) => f(q)); });
    } else { gA = lisserRobuste(brut("g"), 1500, 0.4); dA = lisserRobuste(brut("d"), 1500, 0.4); }
    for (let q = 0; q < nb; q++) if (dA[q] - gA[q] < 1) { const m = (gA[q] + dA[q]) / 2; gA[q] = m - 0.5; dA[q] = m + 0.5; }
    // lecture d'une suite par station à l'abscisse s (interpolée, bornée aux bouts)
    const lire = (A, s, dec = 0) => { const f = Math.max(0, Math.min(A.length - 1, s - s0 + dec)), i = Math.min(A.length - 2, Math.floor(f)); return A[i] + (A[i + 1] - A[i]) * (f - i); };
    // l'emprise ajustée doit recouvrir celle du relevé, sinon le pont est rendu tel que relevé
    let dedans = 0, aire = 0;
    for (let k = 0; k < cel.length; k++) { const [sk, t] = ST[k]; if (t >= lire(gA, sk) - 0.3 && t <= lire(dA, sk) + 0.3) dedans++; }
    for (let q = 0; q < nb; q++) aire += dA[q] - gA[q];
    const iou = dedans * c * c / (aire * (s1 - s0) / (nb - 1) + (cel.length - dedans) * c * c);
    // chaussée par station : médiane des cases du milieu (les bords portent bordures, garde-corps et parois) ; dévers
    // par moindres carrés sur les mêmes cases
    const hS = new Float64Array(nb).fill(NaN), pS = new Float64Array(nb).fill(NaN), eS = new Float64Array(nb).fill(NaN);
    for (let q = 0; q < nb; q++) {
      const T = st[q], m = (gA[q] + dA[q]) / 2, l = dA[q] - gA[q];
      if (!T.c.length) continue;
      const mil = T.c.filter(v => Math.abs(v[0] - m) <= 0.35 * l), C = mil.length >= 3 ? mil : T.c;
      hS[q] = med(C.map(v => v[1]));
      const prox = C.filter(v => Math.abs(v[1] - hS[q]) < 0.5);
      if (prox.length >= 6) {
        let st1 = 0, sz = 0, stt = 0, stz = 0;
        for (const [t, z] of prox) { st1 += t - m; sz += z; stt += (t - m) ** 2; stz += (t - m) * z; }
        const det = prox.length * stt - st1 * st1;
        if (det > prox.length * prox.length * 0.5) pS[q] = (prox.length * stz - st1 * sz) / det;
      }
      // épaisseur : le haut des points vus sous le tablier (85 %), entre 0,4 et 7 m sous la chaussée
      const bb = T.b.filter(z => z < hS[q] - 0.4 && z > hS[q] - 7).sort((u, v) => u - v);
      if (bb.length) eS[q] = hS[q] - bb[Math.min(bb.length - 1, Math.floor(bb.length * 0.85))];
    }
    const hBouts = [med(Array.from(hS.slice(0, 4)).filter(v => !isNaN(v))), med(Array.from(hS.slice(-4)).filter(v => !isNaN(v)))];
    if (hBouts.some(isNaN)) return null;
    // au-delà des bouts, sur 15 m : la route (cases « pont » au ras du sol, sinon le terrain), au milieu du tablier
    const EXT = 15, mil = [(gA[0] + dA[0]) / 2, (gA[nb - 1] + dA[nb - 1]) / 2], lar = [dA[0] - gA[0], dA[nb - 1] - gA[nb - 1]];
    const hE = new Float64Array(nb + 2 * EXT).fill(NaN), wE = new Float64Array(nb + 2 * EXT);
    for (let q = 0; q < nb; q++) { hE[q + EXT] = hS[q]; wE[q + EXT] = 1; }
    const route = (s, b) => med([-0.3, 0, 0.3].map(f => {
      const [x, y] = enPlan(s, mil[b] + f * lar[b]), i = Math.floor((x - x0) / c), j = Math.floor((y - x0) / c), v = i >= 0 && j >= 0 && i < n && j < n ? pont[j * n + i] : NaN;
      return isNaN(v) ? solEn(G, x, y) : v;
    }).filter(v => !isNaN(v)));
    // bout libre : la route ne rejoint pas le niveau du tablier dans les 15 m (pont coupé par le bord du modèle, par
    // un pont modélisé à part, ou tablier qui continue hors du relevé) : pas de raccord, le tablier s'arrête là
    const libre = [true, true];
    for (const b of [0, 1]) for (let e = 1; e <= EXT; e++) {
      const s = b ? s1 + e : s0 - e, v = route(s, b), q = b ? nb - 1 + EXT + e : EXT - e;
      if (isNaN(v) || Math.abs(v - hBouts[b]) > 1 + 0.1 * e) continue;
      hE[q] = v; wE[q] = 1;
      if (Math.abs(v - hBouts[b]) <= 0.6 + 0.08 * e) libre[b] = false;
    }
    for (const b of [0, 1]) if (libre[b]) for (let e = 1; e <= EXT; e++) wE[b ? nb - 1 + EXT + e : EXT - e] = 0;
    // profil en long : une courbe lisse sur le tablier et la route ; dévers lissé de même
    const zA = lisserRobuste(hE, 60, 0.15, wE), pA = lisserRobuste(pS, 4000, 0.01).map(v => Math.max(-0.08, Math.min(0.08, v)));
    // épaisseur constante par pont (médiane des stations mesurées), sauf tablier à hauteur variable (caisson,
    // poutre-console : plus de 0,8 m entre les déciles), qui garde son épaisseur lissée station par station
    const eMes = Array.from(eS).filter(v => !isNaN(v));
    let eA, eVariable = false;
    if (eMes.length >= 3 && quantile(eMes, 0.9) - quantile(eMes, 0.1) > 0.8) {
      eVariable = true;
      let der = NaN;
      for (let q = 0; q < nb; q++) { if (isNaN(eS[q])) eS[q] = der; else der = eS[q]; }
      der = NaN;
      for (let q = nb - 1; q >= 0; q--) { if (isNaN(eS[q])) eS[q] = isNaN(der) ? 1.2 : der; else der = eS[q]; }
      eA = lisserRobuste(eS, 20, 0.3).map(v => Math.max(0.4, Math.min(7, v)));
    } else {
      const e = eMes.length ? Math.max(0.4, Math.min(7, med(eMes))) : 1.2;
      eA = new Float64Array(nb).fill(e);
    }
    const profil = s => lire(zA, s, EXT), milieu = s => (lire(gA, s) + lire(dA, s)) / 2;
    // écart entre la chaussée ajustée et le relevé (médiane) : trop grand, le pont est rendu tel que relevé
    const ecart = med(cel.map((p, k) => { const [sk, t] = ST[k]; return Math.abs(profil(sk) + lire(pA, sk) * (t - milieu(sk)) - pont[p]); }));
    const info = { x: +(X.reduce((a, b) => a + b, 0) / cel.length).toFixed(1), y: +(Y.reduce((a, b) => a + b, 0) / cel.length).toFixed(1), longueur: +(s1 - s0).toFixed(1), largeur: +(aire / nb).toFixed(1), droit: !!droit || axe.length === 4, iou: +iou.toFixed(2), ecart: +ecart.toFixed(2), libre, epaisseur: eVariable ? "variable" : +eA[0].toFixed(2) };
    if (iou < 0.7 || ecart > 0.4) { info.repli = true; return { repli: true, info }; }
    // joint de chaque bout : là où le terrain affiché rejoint le profil (à 25 cm près, sur 2 m) ; à défaut, au plus près
    const joint = [s0, s1];
    for (const b of [0, 1]) {
      if (libre[b]) continue;
      const dz = e => { const s = b ? s1 + e : s0 - e; return Math.abs(profil(s) - solAffiche(G, ...enPlan(s, mil[b]))); };
      let trouve = -1, mieux = 0;
      for (let e = 0; e < EXT; e++) {
        if (dz(e) <= 0.25 && dz(e + 1) <= 0.25) { trouve = e + 1; break; }
        if (dz(e) < dz(mieux)) mieux = e;
      }
      if (trouve < 0) { if (dz(mieux) > 1) { libre[b] = true; continue; } trouve = mieux; }
      joint[b] = b ? s1 + trouve : s0 - trouve;
    }
    info.joints = [+(s0 - joint[0]).toFixed(1), +(joint[1] - s1).toFixed(1)];
    // nœuds tous les mètres du premier joint au dernier (1,5 m de plus, sous le terrain). Au raccord, la chaussée glisse
    // vers le terrain : en travers, une droite ajustée sur le terrain sous les points qui en sont proches (moins de
    // 1,5 m) ; un point au-dessus d'un talus ou d'un mur suit la même droite (plus de pli de la chaussée)
    const FONDU = 3, PLONGE = 1.5, nT = 6;
    const debut = libre[0] ? s0 - c / 2 : joint[0] - PLONGE, fin = libre[1] ? s1 + c / 2 : joint[1] + PLONGE;
    const nbN = Math.max(1, Math.ceil(fin - debut)), N = { s: [], x: [], y: [], nx: [], ny: [], g: [], d: [], z: [], devers: [], ep: [], w: [] };
    for (let k = 0; k <= nbN; k++) {
      const s = debut + (fin - debut) * k / nbN, sc = Math.max(s0, Math.min(s1, s)), A = surAxe(s);
      const g = lire(gA, sc), d = lire(dA, sc), m = (g + d) / 2;
      let z = profil(s), pente = lire(pA, sc);
      const dj = Math.max(libre[0] ? -Infinity : joint[0] - s, libre[1] ? -Infinity : s - joint[1]);
      const w0 = Math.max(0, Math.min(1, 1 + dj / FONDU)), w = w0 * w0 * (3 - 2 * w0), plonge = 0.06 + Math.max(0, dj / PLONGE) * 0.3;
      if (w > 0) {
        const pts = [];
        for (let q = 0; q <= nT; q++) {
          const t = g + (d - g) * q / nT, zt = z + pente * (t - m), zs = solAffiche(G, A.x + A.nx * t, A.y + A.ny * t);
          if (Math.abs(zs - zt) < 1.5) pts.push([t - m, zs - plonge - zt]);
        }
        if (pts.length) {
          let a = pts.reduce((u, v) => u + v[1], 0) / pts.length, b = 0;
          if (pts.length >= 3) {
            const tm = pts.reduce((u, v) => u + v[0], 0) / pts.length, stt = pts.reduce((u, v) => u + (v[0] - tm) ** 2, 0);
            if (stt > 1) { b = pts.reduce((u, v) => u + (v[0] - tm) * (v[1] - a), 0) / stt; a -= b * tm; }
          }
          z += a * w; pente += b * w;
        }
      }
      N.s.push(s - debut); N.x.push(A.x); N.y.push(A.y); N.nx.push(A.nx); N.ny.push(A.ny);
      N.g.push(g); N.d.push(d); N.z.push(z); N.devers.push(pente); N.ep.push(lire(eA, sc)); N.w.push(w);
    }
    // piles : points montant du sol vers le tablier sur au moins la moitié de la hauteur libre (et pas seulement le sol
    // sous le pont, que le relevé classe parfois « pont »), regroupés en (s, t) : stations voisines (à 2,5 m près) puis,
    // en travers, groupes séparés d'au moins 1,5 m (deux colonnes côte à côte) ; espacement régularisé ensuite
    const appuis = [];
    if (avecNuage) {
      const blocs = [];
      let cur = null;
      for (let q = 0; q < nb; q++) {
        const T = st[q], libreQ = hS[q] - T.sol;
        if (T.pts.length < 4) continue;
        const zs = T.pts.map(v => v[1]), z0 = Math.min(...zs), z1 = Math.max(...zs);
        if (!(z1 - z0 > Math.max(2, 0.4 * libreQ))) continue;
        const x = s0 + q;
        if (cur && x - cur.s1 <= 2.5) { cur.s1 = x; cur.pts.push(...T.pts); }
        else { cur = { s0: x, s1: x, pts: [...T.pts] }; blocs.push(cur); }
      }
      const poses = [];
      for (const B of blocs) {
        // une pile fait au plus ~8 m le long du pont : un « bloc » plus long n'est pas une pile (sol classé « pont »)
        if (B.pts.length < 12 || B.s1 - B.s0 > 8) continue;
        const sm = (B.s0 + B.s1) / 2, g = lire(gA, sm), d = lire(dA, sm);
        // groupes en travers
        const ts = B.pts.map(v => v[0]).filter(t => t > g - 0.5 && t < d + 0.5).sort((u, v) => u - v), grp = [];
        for (const t of ts) { const G0 = grp.at(-1); if (G0 && t - G0.t1 < 1.5) { G0.t1 = t; G0.n++; } else grp.push({ t0: t, t1: t, n: 1 }); }
        const forts = grp.filter(v => v.n >= Math.max(4, 0.1 * ts.length));
        if (!forts.length) continue;
        poses.push({ s: sm, long: Math.max(1, B.s1 - B.s0 + 1), cols: forts.map(v => ({ t0: Math.max(g, v.t0 - 0.25), t1: Math.min(d, v.t1 + 0.25) })) });
      }
      // espacement régularisé : trois piles ou plus presque également espacées (à 25 % près) sont remises sur une suite
      // régulière (moindres carrés de s = a + k·b)
      if (poses.length >= 3) {
        const ec = poses.slice(1).map((P, i) => P.s - poses[i].s), em = med([...ec]);
        const k = poses.map(P => Math.round((P.s - poses[0].s) / em));
        if (em > 6 && ec.every(v => Math.abs(v / em - Math.round(v / em)) < 0.25)) {
          const m = poses.length, sk = k.reduce((a, b) => a + b, 0), ss = poses.reduce((a, P) => a + P.s, 0), skk = k.reduce((a, b) => a + b * b, 0), sks = poses.reduce((a, P, i) => a + k[i] * P.s, 0);
          const det = m * skk - sk * sk;
          if (det > 0) {
            const b = (m * sks - sk * ss) / det, a = (ss - b * sk) / m;
            poses.forEach((P, i) => { const v = a + b * k[i]; if (Math.abs(v - P.s) < 2) P.s = v; });
          }
        }
      }
      for (const P of poses) for (const C of P.cols) {
        const tm = (C.t0 + C.t1) / 2, larg = Math.max(0.6, C.t1 - C.t0);
        appuis.push({ type: "pile", s: P.s - debut, t: tm, long: P.long, larg });
      }
      info.piles = poses.length;
    }
    // arches surbaissées : dans une travée entre deux piles, des points d'ouvrage à faible profondeur (moins de 6 m sous
    // la chaussée, plus bas que le tablier) près des piles, et aucun au milieu (la clé est cachée sous le tablier) : arc
    // parabolique de la clé (juste sous le tablier) aux naissances, ajusté sur ces points (au moins 1,5 m de flèche)
    const arches = [];
    if (avecNuage) {
      const sPiles = [...new Set(appuis.map(a => +(a.s + debut).toFixed(1)))].sort((u, v) => u - v);
      for (let i = 0; i < sPiles.length - 1; i++) {
        const a = sPiles[i], b = sPiles[i + 1], demi = (b - a) / 2, sm = (a + b) / 2;
        if (b - a < 15 || b - a > 80) continue;
        const ep = lire(eA, sm), zc = profil(sm) - ep - 0.2, pts = [];
        let milieu = 0;
        for (let q = Math.ceil(a - s0 + 3); q <= Math.floor(b - s0 - 3); q++) {
          const T = st[q];
          if (!T || isNaN(hS[q])) continue;
          const v = T.ouv.filter(z => z < hS[q] - ep - 0.5 && z > hS[q] - 6 && z > T.sol + 1.5).sort((u, w) => w - u);
          if (v.length < 3) continue;
          if (Math.abs(s0 + q - sm) < 0.3 * demi) milieu++;
          else pts.push([s0 + q, v[1]]);
        }
        const cotes = [pts.filter(p => p[0] < sm).length, pts.filter(p => p[0] > sm).length];
        if (milieu > 1 || cotes[0] < 2 || cotes[1] < 2) continue;
        // z = zc + c2 (s − sm)² (clé fixée) : c2 par moindres carrés
        const c2 = pts.reduce((x, [s, z]) => x + (z - zc) * (s - sm) ** 2, 0) / pts.reduce((x, [s]) => x + (s - sm) ** 4, 0);
        const res = med(pts.map(([s, z]) => Math.abs(z - zc - c2 * (s - sm) ** 2))), fleche = -c2 * demi * demi;
        if (!(fleche > 1.5 && fleche < 15 && res < 0.6)) continue;
        arches.push({ s0: a - debut, s1: b - debut, z_naissance: zc - fleche, z_cle: zc, epaisseur: 0.6, larg: 0.85 * (lire(dA, sm) - lire(gA, sm)), plein: false });
      }
      info.arches = arches.length;
    }
    const zm = N.z.map((z, k) => z);
    const M = {
      auto: true, info,
      // axe de compatibilité (x, y, chaussée) : export, effacement par un modèle fait main, diagnostic
      axe: N.x.map((x, k) => [x + N.nx[k] * (N.g[k] + N.d[k]) / 2, N.y[k] + N.ny[k] * (N.g[k] + N.d[k]) / 2, zm[k]]),
      largeur: aire / nb, epaisseur: eA[0], noeuds: N,
      // tablier au-dessus des cases du relevé entre ces abscisses ; au-delà, vers un joint, plein jusqu'au sol
      tablier: [s0 - debut, s1 - debut], libre, appuis, arches,
      cellules: Int32Array.from(cel),
    };
    if (graver) graveurs.push(M);
    return M;
  };
  for (const cel of tabliers) {
    let M = null;
    try { M = modeliser(cel); } catch (e) { console.warn("Pont reconstruit :", e.message); }
    if (M && !M.repli) G.ponts.push(M);
    else G.pontsRepli.push(...cel);
  }
  for (const M of graveurs) graverRaccords(G, M);
  return G.ponts;
}

/**
 * Gravure du profil dans le terrain à l'approche de chaque joint : de la fin des cases du tablier jusqu'au joint, le
 * sol sous la chaussée est ramené 5 cm sous elle, avec un fondu latéral de 2 m ; près du joint (où la chaussée plonge
 * sous le terrain), la cible remonte vers le terrain : il affleure, lisse, au lieu de montrer ses facettes. Le sol
 * n'est jamais relevé, ni entaillé de plus de 1,5 m (mur ou talus le long de la route).
 */
function graverRaccords(G, M) {
  const { n, c, x0, sol } = G, N = M.noeuds, L = N.s.at(-1);
  const zones = [];
  if (!M.libre[0]) zones.push([0, Math.min(L, M.tablier[0] + 8)]);
  if (!M.libre[1]) zones.push([Math.max(0, M.tablier[1] - 8), L]);
  if (!zones.length) return;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let k = 0; k < N.s.length; k++) for (const t of [N.g[k] - 2.5, N.d[k] + 2.5]) {
    const x = N.x[k] + N.nx[k] * t, y = N.y[k] + N.ny[k] * t;
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  const i0 = Math.max(0, Math.floor((xmin - x0) / c)), i1 = Math.min(n - 1, Math.ceil((xmax - x0) / c));
  const j0 = Math.max(0, Math.floor((ymin - x0) / c)), j1 = Math.min(n - 1, Math.ceil((ymax - x0) / c));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = x0 + (i + 0.5) * c, y = x0 + (j + 0.5) * c, [s, t] = projeterNoeuds(N, x, y);
    if (!zones.some(([a, b]) => s >= a - 0.5 && s <= b + 0.5)) continue;
    const C = coteDeck(M, Math.max(0, Math.min(L, s)), t);
    if (!C) continue;
    const ext = Math.max(0, C.g - t, t - C.d);
    if (ext > 2) continue;
    const p = j * n + i, cible = C.z - 0.05 + 0.11 * C.w;
    if (!(sol[p] > cible) || sol[p] - cible > 1.5) continue;
    const f = ext / 2, f2 = 1 - f * f * (3 - 2 * f);
    sol[p] -= (sol[p] - cible) * f2;
  }
}
