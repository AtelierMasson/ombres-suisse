// Raccord exact du terrain aux arrivées des ponts faits main (pontsModeles.js), comme pour les piscines : autour de
// chaque bout, le maillage du terrain (grille de 1 m ou TIN) est retiré puis retriangulé du bord de la zone retirée
// (sommets du terrain, raccord exact avec les voisins) jusqu'à des sommets posés exactement sur le pont :
//   - le joint (bout du tablier) : les points du dessus de la dernière section, rive à rive, à l'altitude de la chaussée ;
//   - la route d'accès (rampe) : le tablier prolongé (même direction, pente et dévers) sur 10 à 20 m, qui glisse en douceur
//     vers le terrain, avec des accotements en talus, triangulée à part (et reportée dans G.sol : raccordsAuSol) ;
//   - les rives du tablier, du joint vers l'intérieur, tant que le tablier est plein (culée) : le terrain y rejoint le
//     bord du tablier juste en dessous de la chaussée, avec un talus vers l'extérieur (cône de remblai de la culée).
// Le dessus du tablier entre le joint et le fond du raccord (une ligne 30 cm sous le tablier, au niveau du terrain sans
// dépasser le dessous du tablier : face de culée) est un trou que le tablier couvre. La grille G.sol reste la référence
// des calculs (ombres, heures).
import { solEn } from "./grille.js";
import { normaliser, noeudEn } from "./pontsModeles.js";

/** Rampe d'accès (m) : prolongement du tablier, de RAMPE_MIN (bout au niveau du terrain) à RAMPE_MAX (écart de 5 m
 *  et plus entre le prolongement du tablier et le terrain), + 2 m par mètre d'écart. */
export const RAMPE_MIN = 10, RAMPE_MAX = 20;
/** Écart minimal entre le trou et le bord de la zone retirée (m) : bande retriangulée autour du raccord. */
export const MARGE_RACCORD = 1;
/** Accotements (m) : de part et d'autre de la route d'accès, talus jusqu'au terrain, de ACCOTEMENT à ACCOTEMENT_MAX m
 *  de large ; TALUS : largeur par mètre de hauteur (1,5 : talus de remblai courant). */
const ACCOTEMENT = 1.5, ACCOTEMENT_MAX = 8, TALUS = 1.5;
const DEDANS = 0.3, DANS_TABLIER = 10, LIBRE_PLEIN = 1.2, SOUS_RIVE = 0.05, HAUT_MAX = 8;
const lisse = u => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };

/**
 * Raccords des bouts de ponts : [{ X, Y, Z (sommets ajoutés, x est, y nord relatifs, z absolu), trou (indices du
 * contour du trou, boucle), tri (triangles de la route d'accès et des accotements, indices), zone ([[x, y], …] :
 * contour du trou), u (direction vers l'extérieur), joint ([x, y] : milieu du joint), zJoint (chaussée au joint) }].
 * `sol(x, y)` : altitude du terrain donnée au maillage des ponts (même fonction, pour un joint identique au tablier).
 */
export function raccordsPonts(G, modeles, E0, N0, sol = (x, y) => solEn(G, Math.max(-G.R, Math.min(G.R, x)), Math.max(-G.R, Math.min(G.R, y)))) {
  const out = [];
  const cellule = (x, y) => { const i = Math.floor((x - G.x0) / G.c), j = Math.floor((y - G.x0) / G.c); return i < 0 || j < 0 || i >= G.n || j >= G.n ? -1 : j * G.n + i; };
  const Rz = G.rayonZone || Infinity, lim = G.n * G.c / 2 - 2;
  const dedans = (x, y) => Math.hypot(x, y) < Rz - 2 && Math.abs(x) < lim && Math.abs(y) < lim;
  const libreEn = (x, y) => { const p = cellule(x, y); return dedans(x, y) && p >= 0 && !(G.bat && !isNaN(G.bat[p])) && !(G.eau && !isNaN(G.eau[p])); };
  for (const P of modeles || []) {
    let M;
    try { M = normaliser(P, E0, N0, sol); } catch { continue; }
    const N = M.noeuds, K = N.s.length, nT = Math.max(2, Math.min(6, Math.round(M.largeur / 3.5)));
    if (K < 3) continue;
    // points du dessus d'une section (comme maillagePont : nT + 1 points de la rive g à la rive d) et tablier plein ?
    const dessus = idx => {
      const A = noeudEn(N, N.s[idx]), m = (A.g + A.d) / 2, pts = [];
      let libre = Infinity;
      for (let k = 0; k <= nT; k++) {
        const t = A.g + (A.d - A.g) * k / nT, x = A.x + A.nx * t, y = A.y + A.ny * t, z = A.z + A.devers * (t - m);
        libre = Math.min(libre, z - sol(x, y));
        pts.push([x, y, z]);
      }
      return { pts, plein: libre < LIBRE_PLEIN, libre };
    };
    for (const bout of [0, 1]) {
      const i0 = bout ? K - 1 : 0, sg = bout ? -1 : 1;
      const J = dessus(i0);
      // bout libre très au-dessus du terrain (falaise, vallée) ou hors maquette : pas de raccord
      if (!(J.libre < HAUT_MAX) || !J.pts.every(([x, y]) => dedans(x, y))) continue;
      // direction vers l'extérieur (prolongement de l'axe) et pente de la chaussée au bout
      const A = noeudEn(N, N.s[i0]), B = noeudEn(N, N.s[i0 + sg * 2]);
      let ux = A.x - B.x, uy = A.y - B.y; const lu = Math.hypot(ux, uy) || 1; ux /= lu; uy /= lu;
      const pente = (A.z - B.z) / lu;
      // rives du tablier vers l'intérieur, tant qu'il est plein (au plus DANS_TABLIER m, jamais au-delà du milieu)
      const rives = [];
      let fond = i0;
      if (J.plein) for (let q = 1; q < K; q++) {
        const idx = i0 + sg * q;
        if (idx <= 0 || idx >= K - 1 || Math.abs(N.s[idx] - N.s[i0]) > Math.min(DANS_TABLIER, N.s[K - 1] / 2 - 1)) break;
        const S = dessus(idx);
        if (!S.plein || !S.pts.every(([x, y]) => dedans(x, y))) break;
        rives.push([S.pts[0], S.pts[nT]]); fond = idx;
      }
      // route d'accès : le tablier prolongé (même direction, même pente, même dévers), qui glisse en douceur vers le
      // terrain (pente continue : lissage en S) sur RAMPE_MIN à RAMPE_MAX m selon l'écart de hauteur ; accotements en
      // talus de ACCOTEMENT m jusqu'au terrain de part et d'autre
      const jc = [(J.pts[0][0] + J.pts[nT][0]) / 2, (J.pts[0][1] + J.pts[nT][1]) / 2], zc = (J.pts[0][2] + J.pts[nT][2]) / 2;
      const ecart = Math.abs(zc + pente * RAMPE_MAX - sol(jc[0] + ux * RAMPE_MAX, jc[1] + uy * RAMPE_MAX));
      const Lr = Math.min(RAMPE_MAX, Math.max(RAMPE_MIN, Math.ceil(RAMPE_MIN + 2 * ecart)));
      const vx = J.pts[nT][0] - J.pts[0][0], vy = J.pts[nT][1] - J.pts[0][1], lv = Math.hypot(vx, vy) || 1, ex = vx / lv, ey = vy / lv;
      // accotements (de la route et des rives) : du bord, en (sx, sy), talus jusqu'au terrain ; plus larges quand le bord
      // est haut au-dessus (ou bas au-dessous) du terrain : pente TALUS, de ACCOTEMENT à ACCOTEMENT_MAX m
      const bas = ([x, y, z], sx, sy) => {
        let w = ACCOTEMENT;
        for (let it = 0; it < 3; it++) w = Math.min(ACCOTEMENT_MAX, Math.max(ACCOTEMENT, TALUS * Math.abs(z - sol(x + sx * w, y + sy * w))));
        for (; w > 0.3 && !dedans(x + sx * w, y + sy * w); w /= 2);
        const xa = x + sx * w, ya = y + sy * w;
        return [xa, ya, sol(xa, ya)];
      };
      const route = [];
      for (let l = 0; l <= Lr; l++) {
        const w = 1 - lisse(l / Lr), sec = [];
        for (const [x0, y0, z0] of J.pts) {
          const x = x0 + ux * l, y = y0 + uy * l, zg = sol(x, y);
          sec.push(l ? [x, y, zg + (z0 + pente * l - zg) * w] : [x0, y0, z0]);
        }
        // la route s'arrête au bord de la maquette, ou quand son milieu rencontre l'eau ou un bâtiment (ses bords
        // peuvent frôler une façade : en ville, la rue est bordée de maisons)
        if (l && !sec.every(([x, y], k) => k === 0 || k === nT ? dedans(x, y) : libreEn(x, y))) break;
        route.push([bas(sec[0], -ex, -ey), ...sec, bas(sec[nT], ex, ey)]);
      }
      if (route.length < 2) continue;
      // sommets : route (section par section, accotements compris), puis rives ; z des rives sous la chaussée
      const X = [], Y = [], Z = [], pose = (x, y, z) => { X.push(x); Y.push(y); Z.push(z); return X.length - 1; };
      const idR = route.map(sec => sec.map(([x, y, z]) => pose(x, y, z)));
      // rives : toujours collées au bord du tablier (juste sous la chaussée), avec leur talus vers l'extérieur (cône de
      // remblai de la culée, comme les accotements de la route) : pas de fente sous le tablier, pas de mur raide
      const idV = rives.map(([g, d]) => {
        const G0 = [g[0], g[1], g[2] - SOUS_RIVE], D0 = [d[0], d[1], d[2] - SOUS_RIVE];
        const l = Math.hypot(D0[0] - G0[0], D0[1] - G0[1]) || 1, sx = (D0[0] - G0[0]) / l, sy = (D0[1] - G0[1]) / l;
        return [pose(...G0), pose(...D0), pose(...bas(G0, -sx, -sy)), pose(...bas(D0, sx, sy))];
      });
      // fond du raccord, sous le tablier (section du joint, ou de la dernière rive) : DEDANS m vers l'intérieur, au niveau du
      // terrain, mais jamais au-dessus de la chaussée ni plus bas que le dessous du tablier : le terrain sous le pont reste
      // en place et monte au plus jusqu'au dessous du tablier (face de culée), sans jour vu d'en dessous
      const F = dessus(fond), Af = noeudEn(N, N.s[fond]);
      const idF = F.pts.map(([x, y, z]) => {
        const xf = x - ux * DEDANS, yf = y - uy * DEDANS;
        return pose(xf, yf, Math.max(Math.min(z - SOUS_RIVE, sol(xf, yf)), z - Af.ep));
      });
      // triangles : bandes de la route et des accotements (colonnes 0 … nT + 2 ; joint : colonnes 1 … nT + 1), puis talus
      // des rives (du joint vers le fond)
      const tri = [], nC = nT + 2;
      for (let i = 0; i < idR.length - 1; i++) for (let k = 0; k < nC; k++) {
        const a = idR[i][k], b = idR[i][k + 1], c = idR[i + 1][k + 1], d = idR[i + 1][k];
        tri.push(a, b, c, a, c, d);
      }
      for (let q = 0; q < idV.length; q++) {
        const [rg, rd, tg, td] = idV[q], [pg, pd, ptg, ptd] = q ? idV[q - 1] : [idR[0][1], idR[0][nC - 1], idR[0][0], idR[0][nC]];
        tri.push(pg, ptg, tg, pg, tg, rg, pd, rd, td, pd, td, ptd);
      }
      // contour : rive g et son talus au fond, talus g (vers le joint), accotement g, bout de la route, accotement d,
      // talus d (vers le fond), rive d au fond (sans rives : coins du joint), puis le fond sous le tablier, de d à g ; le
      // dessus du tablier entre le joint et le fond reste un trou (le tablier le couvre)
      const n = idR.length - 1, trou = [], nV = idV.length;
      if (nV) { trou.push(idV[nV - 1][0]); for (let q = nV - 1; q >= 0; q--) trou.push(idV[q][2]); } else trou.push(idR[0][1]);
      for (let i = 0; i <= n; i++) trou.push(idR[i][0]);
      for (let k = 1; k < nC; k++) trou.push(idR[n][k]);
      for (let i = n; i >= 0; i--) trou.push(idR[i][nC]);
      if (nV) { for (let q = 0; q < nV; q++) trou.push(idV[q][3]); trou.push(idV[nV - 1][1]); } else trou.push(idR[0][nC - 1]);
      for (let k = nT; k >= 0; k--) trou.push(idF[k]);
      out.push({ X, Y, Z, trou, tri, zone: trou.map(v => [X[v], Y[v]]), u: [ux, uy], joint: jc, zJoint: zc });
    }
  }
  return out;
}

/**
 * La route d'accès, ses accotements et les talus des rives reportés dans G.sol (cellules dont le centre est dans un de
 * leurs triangles, hors bâtiments et eau) : les calculs (ombres, heures) voient le même sol que l'affichage. Renvoie le nombre de
 * cellules changées ; à suivre d'un nouveau raccordsPonts (G.sol a changé).
 */
export function raccordsAuSol(G, raccords) {
  let n = 0;
  for (const R of raccords || []) {
    for (let t = 0; t < R.tri.length; t += 3) {
      const a = R.tri[t], b = R.tri[t + 1], c = R.tri[t + 2];
      const ax = R.X[a], ay = R.Y[a], bx = R.X[b] - ax, by = R.Y[b] - ay, cx = R.X[c] - ax, cy = R.Y[c] - ay, d = bx * cy - by * cx;
      if (!d) continue;
      const i0 = Math.max(0, Math.floor((Math.min(R.X[a], R.X[b], R.X[c]) - G.x0) / G.c)), i1 = Math.min(G.n - 1, Math.floor((Math.max(R.X[a], R.X[b], R.X[c]) - G.x0) / G.c));
      const j0 = Math.max(0, Math.floor((Math.min(R.Y[a], R.Y[b], R.Y[c]) - G.x0) / G.c)), j1 = Math.min(G.n - 1, Math.floor((Math.max(R.Y[a], R.Y[b], R.Y[c]) - G.x0) / G.c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = G.x0 + (i + 0.5) * G.c, y = G.x0 + (j + 0.5) * G.c, px = x - ax, py = y - ay;
        const u = (px * cy - py * cx) / d, v = (bx * py - by * px) / d;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const p = j * G.n + i;
        if ((G.bat && !isNaN(G.bat[p])) || (G.eau && !isNaN(G.eau[p]))) continue;
        G.sol[p] = R.Z[a] + u * (R.Z[b] - R.Z[a]) + v * (R.Z[c] - R.Z[a]); n++;
      }
    }
  }
  return n;
}

// ——— géométrie plane : distance entre polygones (sélection des cellules et des triangles à retirer) ———

function distSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, u = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - u * dx, py - ay - u * dy);
}
function croise(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function dansPolygone(x, y, P) {
  let d = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) d = !d;
  }
  return d;
}

/** Le polygone A ([[x, y], …], petit : triangle, cellule) est-il à moins de `D` du polygone B (contour du trou) ? */
export function procheDe(A, B, D) {
  if (dansPolygone(A[0][0], A[0][1], B) || dansPolygone(B[0][0], B[0][1], A)) return true;
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const c = B[j], d = B[(j + 1) % B.length];
      if (croise(a, b, c, d)) return true;
      if (distSegment(a[0], a[1], c[0], c[1], d[0], d[1]) < D || distSegment(c[0], c[1], a[0], a[1], b[0], b[1]) < D) return true;
    }
  }
  return false;
}

/** Boîte englobante d'un contour [[x, y], …], élargie de `m`. */
export function boite(Z, m = 0) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of Z) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [x0 - m, x1 + m, y0 - m, y1 + m];
}

/**
 * Bord d'une zone de triangles (indices, sens trigonométrique) : boucle de sommets, ou null si la zone n'est pas d'un
 * seul tenant sans trou ni point de contact (le raccord est alors abandonné, le terrain reste tel quel).
 */
export function bordZone(tris, nv) {
  const aretes = new Set();
  for (let t = 0; t < tris.length; t += 3) for (let s = 0; s < 3; s++) aretes.add(tris[t + s] * nv + tris[t + (s + 1) % 3]);
  const suivant = new Map();
  for (const e of aretes) {
    const a = Math.floor(e / nv), b = e % nv;
    if (aretes.has(b * nv + a)) continue;
    if (suivant.has(a)) return null;
    suivant.set(a, b);
  }
  if (suivant.size < 3) return null;
  const bord = [], debut = suivant.keys().next().value;
  for (let v = debut; bord.length <= suivant.size; ) { bord.push(v); v = suivant.get(v); if (v === debut || v === undefined) break; }
  return bord.length === suivant.size ? bord : null;
}

/**
 * Cellules du pont reconstruit automatiquement (G.pont) sur la route d'accès d'un raccord, à hauteur de la chaussée
 * (± 6 m) : effacées dans `pont` (copie), sinon des bouts de tablier relevé flottaient au-dessus du raccord. Renvoie le
 * nombre de cellules effacées.
 */
export function effacerPontsAuRaccord(G, pont, raccords) {
  let n = 0;
  for (const R of raccords || []) {
    const [x0, x1, y0, y1] = boite(R.zone, 1);
    const i0 = Math.max(0, Math.floor((x0 - G.x0) / G.c)), i1 = Math.min(G.n - 1, Math.floor((x1 - G.x0) / G.c));
    const j0 = Math.max(0, Math.floor((y0 - G.x0) / G.c)), j1 = Math.min(G.n - 1, Math.floor((y1 - G.x0) / G.c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const p = j * G.n + i;
      if (isNaN(pont[p]) || Math.abs(pont[p] - R.zJoint) > 6) continue;
      if (procheDe([[G.x0 + (i + 0.5) * G.c, G.x0 + (j + 0.5) * G.c]], R.zone, 1)) { pont[p] = NaN; n++; }
    }
  }
  return n;
}
