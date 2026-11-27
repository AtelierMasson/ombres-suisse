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
import { normaliser, noeudEn, chausseeEn } from "./pontsModeles.js";
import { directionRoute } from "./routesTLM.js";

/** Rampe d'accès (m) : prolongement du tablier, de RAMPE_MIN (bout au niveau du terrain) à RAMPE_MAX (écart de 5 m
 *  et plus entre le prolongement du tablier et le terrain), + 2 m par mètre d'écart. */
export const RAMPE_MIN = 10, RAMPE_MAX = 20;
/** Écart minimal entre le trou et le bord de la zone retirée (m) : bande retriangulée autour du raccord. */
export const MARGE_RACCORD = 1;
/** Accotements (m) : de part et d'autre de la route d'accès, talus jusqu'au terrain, de ACCOTEMENT à ACCOTEMENT_MAX m
 *  de large ; TALUS : largeur par mètre de hauteur (1,5 : talus de remblai courant). */
const ACCOTEMENT = 1.5, ACCOTEMENT_MAX = 8, TALUS = 1.5;
/** Écart d'angle maximal entre l'axe du pont et la route d'accès (vers l'axe swissTLM3D de la route). */
const ROUTE_ANGLE_MAX = 30 * Math.PI / 180;
/** Maillage de la route d'accès : sections tous les PAS_LONG m, points tous les ~PAS_TRAVERS m en travers (bordures,
 *  murs et talus du relevé gardés). */
const PAS_LONG = 0.5, PAS_TRAVERS = 1;
const DEDANS = 0.3, DANS_TABLIER = 10, LIBRE_PLEIN = 1.2, SOUS_RIVE = 0.05, HAUT_MAX = 8;
const lisse = u => { const v = Math.min(1, Math.max(0, u)); return v * v * (3 - 2 * v); };

/**
 * Bouts de tablier de tous les ponts, faits main (`modeles`, JSON en MN95, recentrés sur E0, N0) et reconstruits du relevé
 * (`auto` : G.ponts, relatifs), décrits de la même façon : { source ("main" | "auto"), nom, N (nœuds du tablier), K, i0
 * (nœud du joint), sg (+1 vers l'intérieur depuis le début, −1 depuis la fin), largeur }. Un pont reconstruit recouvert
 * par un pont fait main (il ne sera pas maillé) est écarté. Un pont reconstruit dont le bout plonge sous le terrain (joint
 * avec la route au niveau du sol) a son joint au nœud où la chaussée rejoint le terrain, pas au bout plongé.
 */
export function boutsPonts(G, modeles, E0, N0, sol, auto, ignorer) {
  const bouts = [];
  for (const P of modeles || []) {
    let M;
    try { M = normaliser(P, E0, N0, sol); } catch { ignorer("modèle illisible"); continue; }
    const K = M.noeuds.s.length;
    if (K < 3) { ignorer("pont trop court"); continue; }
    for (const b of [0, 1]) bouts.push({ source: "main", nom: P.nom, N: M.noeuds, K, i0: b ? K - 1 : 0, sg: b ? -1 : 1, largeur: M.largeur });
  }
  for (const M of auto || []) {
    const N = M.noeuds, K = N?.s?.length || 0;
    if (K < 3) { ignorer("pont reconstruit trop court"); continue; }
    // recouvert par un pont fait main (même test que scene.construire : chaussée à moins de 4 m)
    let recouvert = false;
    for (let k = 0; k < M.cellules.length && !recouvert; k += 7) {
      const p = M.cellules[k], x = G.x0 + (p % G.n + 0.5) * G.c, y = G.x0 + (Math.floor(p / G.n) + 0.5) * G.c;
      recouvert = (modeles || []).some(P => Math.abs(chausseeEn(P, E0, N0, x, y, 6) - G.pont[p]) < 4);
    }
    if (recouvert) { ignorer("pont reconstruit sous un pont fait main", 2); continue; }
    for (const b of [0, 1]) {
      const sg = b ? -1 : 1, fin = b ? K - 1 : 0;
      let i0 = fin;
      if (!M.libre?.[b]) while (i0 + 3 * sg >= 0 && i0 + 3 * sg < K && N.w[i0 + sg] > 0.999 && Math.abs(N.s[i0 + sg] - N.s[fin]) < 4) i0 += sg;
      bouts.push({ source: "auto", nom: "pont reconstruit", N, K, i0, sg, largeur: M.largeur });
    }
  }
  return bouts;
}

/**
 * Raccords des bouts de ponts, faits main et reconstruits, par une seule règle : [{ X, Y, Z (sommets ajoutés, x est, y nord
 * relatifs, z absolu), trou (indices du contour du trou, boucle), tri (triangles de la route d'accès et des talus),
 * zone ([[x, y], …] : contour du trou), u (axe du pont vers l'extérieur), d (direction de la route), joint ([x, y] : milieu
 * du joint), zJoint, jointPts (polyligne du joint, rive g → rive d, [x, y, z]), source }].
 * Joint : la polyligne du dessus de la section du bout, de la rive gauche à la rive droite (ses deux coins, plus des
 * points intermédiaires sur la même droite, dévers compris). Route d'accès : part du joint dans l'axe du pont, tourne
 * vers l'axe de la route swissTLM3D (`routes`, routesTLM.js ; au plus ROUTE_ANGLE_MAX), prolonge pente et dévers du
 * tablier et rejoint le terrain sur RAMPE_MIN à RAMPE_MAX m. Bouts ignorés (`stats.ignores`, par raison) : très au-dessus
 * du terrain (falaise, vallée), sous le terrain (tunnel), hors de la maquette, route aussitôt bloquée (eau, bâtiment).
 * `sol(x, y)` : altitude du terrain donnée au maillage des ponts.
 */
export function raccordsPonts(G, modeles, E0, N0, sol = (x, y) => solEn(G, Math.max(-G.R, Math.min(G.R, x)), Math.max(-G.R, Math.min(G.R, y))), { auto = G.ponts, routes = null, nuage = null, stats = null } = {}) {
  const out = [], st = stats || {};
  st.raccordes = 0; st.ignores = {}; st.tlm = 0; st.nuage = 0; st.ecartsBout = [];
  const ignorer = (raison, n = 1) => { st.ignores[raison] = (st.ignores[raison] || 0) + n; };
  const cellule = (x, y) => { const i = Math.floor((x - G.x0) / G.c), j = Math.floor((y - G.x0) / G.c); return i < 0 || j < 0 || i >= G.n || j >= G.n ? -1 : j * G.n + i; };
  const Rz = G.rayonZone || Infinity, lim = G.n * G.c / 2 - 2;
  const dedans = (x, y) => Math.hypot(x, y) < Rz - 2 && Math.abs(x) < lim && Math.abs(y) < lim;
  const libreEn = (x, y) => { const p = cellule(x, y); return dedans(x, y) && p >= 0 && !(G.bat && !isNaN(G.bat[p])) && !(G.eau && !isNaN(G.eau[p])); };
  const bouts = boutsPonts(G, modeles, E0, N0, sol, auto, ignorer);
  // points du relevé autour des bouts (sol et tablier) : la route d'accès et ses talus prennent leurs hauteurs
  const PN = nuage ? indexNuage(nuage, bouts.map(B => { const A = noeudEn(B.N, B.N.s[B.i0]); return [A.x, A.y]; }), RAMPE_MAX + ACCOTEMENT_MAX + DANS_TABLIER + 4) : null;
  for (const Bt of bouts) {
    const { N, K, i0, sg } = Bt, nT = Math.max(2, Math.min(40, Math.round(Bt.largeur / PAS_TRAVERS)));
    // points du dessus d'une section (nT + 1 points de la rive g à la rive d) ; hauteur libre au-dessus du terrain
    const dessus = idx => {
      const A = noeudEn(N, N.s[idx]), m = (A.g + A.d) / 2, pts = [];
      let libre = Infinity, enfoui = -Infinity;
      for (let k = 0; k <= nT; k++) {
        const t = A.g + (A.d - A.g) * k / nT, x = A.x + A.nx * t, y = A.y + A.ny * t, z = A.z + A.devers * (t - m), zs = sol(x, y);
        libre = Math.min(libre, z - zs); enfoui = Math.max(enfoui, zs - z);
        pts.push([x, y, z]);
      }
      return { pts, plein: libre < LIBRE_PLEIN, libre, enfoui };
    };
    const J = dessus(i0);
    // exceptions, par règles simples
    if (!J.pts.every(([x, y]) => dedans(x, y))) { ignorer("hors de la maquette"); continue; }
    if (!(J.libre < HAUT_MAX)) { ignorer("bout très au-dessus du terrain (falaise, vallée)"); continue; }
    if (J.enfoui > HAUT_MAX / 2) { ignorer("bout sous le terrain (tunnel, tranchée couverte)"); continue; }
    // axe du pont vers l'extérieur et pente de la chaussée au bout
    const A = noeudEn(N, N.s[i0]), B = noeudEn(N, N.s[Math.max(0, Math.min(K - 1, i0 + sg * 2))]);
    let ux = A.x - B.x, uy = A.y - B.y; const lu = Math.hypot(ux, uy) || 1; ux /= lu; uy /= lu;
    const pente = (A.z - B.z) / lu;
    // terrain relevé au point (x, y) : sol le plus bas du relevé à moins de 40 cm, sinon la chaussée relevée (points
    // « pont » à moins de 1,5 m de la cote attendue `zAtt`, au-delà du joint du modèle), sinon la grille
    // (un sol relevé à plus de 50 cm de la grille n'est pas pris : terrain swisstopo choisi, ou point isolé)
    const terrainEn = (x, y, zAtt = NaN) => {
      const zs = sol(x, y), o = PN ? observer(PN, x, y, zAtt) : null;
      return !o ? zs : o.pont || Math.abs(o.z - zs) < 0.5 ? o.z : zs;
    };
    // rives du tablier vers l'intérieur, tant qu'il est plein (au plus DANS_TABLIER m, jamais au-delà du milieu)
    const rives = [];
    let fond = i0;
    if (J.plein) for (let q = 1; q < K; q++) {
      const idx = i0 + sg * q;
      if (idx <= 0 || idx >= K - 1 || Math.abs(N.s[idx] - N.s[i0]) > Math.min(DANS_TABLIER, Math.abs(N.s[K - 1] - N.s[0]) / 2 - 1)) break;
      const S = dessus(idx);
      if (!S.plein || !S.pts.every(([x, y]) => dedans(x, y))) break;
      rives.push([S.pts[0], S.pts[nT]]); fond = idx;
    }
    // joint : milieu, largeur (vecteur rive g → rive d) ; chaque point du joint repéré en travers (t) et en long (a)
    const jc = [(J.pts[0][0] + J.pts[nT][0]) / 2, (J.pts[0][1] + J.pts[nT][1]) / 2], zc = (J.pts[0][2] + J.pts[nT][2]) / 2;
    const vx = J.pts[nT][0] - J.pts[0][0], vy = J.pts[nT][1] - J.pts[0][1], lv = Math.hypot(vx, vy) || 1, ex = vx / lv, ey = vy / lv;
    const loc = J.pts.map(([x, y]) => [(x - jc[0]) * ex + (y - jc[1]) * ey, (x - jc[0]) * ux + (y - jc[1]) * uy]);
    // fin réelle du tablier dans le relevé (points « pont » à la cote de la chaussée, le long de l'axe) : écart au joint
    const finReleve = PN ? finTablier(PN, jc, [ux, uy], [ex, ey], lv, zc, pente) : null;
    if (finReleve !== null) { st.nuage++; st.ecartsBout.push(finReleve); }
    // direction de la route : axe swissTLM3D au bout du pont (sinon l'axe du pont), écart d'angle borné
    const T = directionRoute(routes, jc, [ux, uy]);
    let dA = 0;
    if (T) {
      st.tlm++;
      dA = Math.atan2(ux * T.d[1] - uy * T.d[0], ux * T.d[0] + uy * T.d[1]);
      dA = Math.max(-ROUTE_ANGLE_MAX, Math.min(ROUTE_ANGLE_MAX, dA));
    }
    const ecart = Math.abs(zc + pente * RAMPE_MAX - sol(jc[0] + ux * RAMPE_MAX, jc[1] + uy * RAMPE_MAX));
    const Lr = Math.min(RAMPE_MAX, Math.max(RAMPE_MIN, Math.ceil(RAMPE_MIN + 2 * ecart)));
    // accotements (de la route et des rives) : du bord, en (sx, sy), talus jusqu'au terrain ; plus larges quand le bord
    // est haut au-dessus (ou bas au-dessous) du terrain : pente TALUS, de ACCOTEMENT à ACCOTEMENT_MAX m
    const bas = ([x, y, z], sx, sy) => {
      let w = ACCOTEMENT;
      for (let it = 0; it < 3; it++) w = Math.min(ACCOTEMENT_MAX, Math.max(ACCOTEMENT, TALUS * Math.abs(z - terrainEn(x + sx * w, y + sy * w))));
      for (; w > 0.3 && !dedans(x + sx * w, y + sy * w); w /= 2);
      const xa = x + sx * w, ya = y + sy * w;
      return [xa, ya, terrainEn(xa, ya)];
    };
    // route d'accès, mètre par mètre : axe qui part dans le prolongement du pont et tourne en douceur vers la route TLM
    // (sur la première moitié), sections perpendiculaires à l'axe ; chaussée = tablier prolongé (pente, dévers) qui glisse
    // vers le terrain (lissage en S : pente continue au joint)
    const route = [];
    let cx = jc[0], cy = jc[1];
    for (let q = 0, l = 0; l <= Lr + 1e-9; q++, l = q * PAS_LONG) {
      const ang = dA * lisse(l / (Lr / 2)), dx = ux * Math.cos(ang) - uy * Math.sin(ang), dy = ux * Math.sin(ang) + uy * Math.cos(ang);
      if (l) { const am = dA * lisse((l - PAS_LONG / 2) / (Lr / 2)); cx += (ux * Math.cos(am) - uy * Math.sin(am)) * PAS_LONG; cy += (ux * Math.sin(am) + uy * Math.cos(am)) * PAS_LONG; }
      const sx = dy, sy = -dx; // en travers (rive g → rive d), dans le sens de (ex, ey) au joint
      const w = 1 - lisse(l / Lr), sec = [];
      for (let k = 0; k <= nT; k++) {
        if (!l) { sec.push(J.pts[k]); continue; }
        const [t, a] = loc[k], x = cx + sx * t * Math.sign(sx * ex + sy * ey || 1) + dx * a, y = cy + sy * t * Math.sign(sx * ex + sy * ey || 1) + dy * a;
        const zg = terrainEn(x, y, J.pts[k][2] + pente * l);
        sec.push([x, y, zg + (J.pts[k][2] + pente * l - zg) * w]);
      }
      // la route s'arrête au bord de la maquette, ou quand son milieu rencontre l'eau ou un bâtiment (ses bords
      // peuvent frôler une façade : en ville, la rue est bordée de maisons)
      if (l && !sec.every(([x, y], k) => k === 0 || k === nT ? dedans(x, y) : libreEn(x, y))) break;
      const gx = sec[0][0] - sec[nT][0], gy = sec[0][1] - sec[nT][1], gl = Math.hypot(gx, gy) || 1;
      route.push([bas(sec[0], gx / gl, gy / gl), ...sec, bas(sec[nT], -gx / gl, -gy / gl)]);
    }
    if (route.length < 2) { ignorer("route d'accès bloquée (eau, bâtiment)"); continue; }
    // sommets : route (section par section, accotements compris), puis rives, puis fond
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
    const cd = Math.cos(dA), sd = Math.sin(dA);
    out.push({ X, Y, Z, trou, tri, zone: trou.map(v => [X[v], Y[v]]), u: [ux, uy], d: [ux * cd - uy * sd, ux * sd + uy * cd], joint: jc, zJoint: zc, jointPts: J.pts, source: Bt.source, nom: Bt.nom, longueur: n * PAS_LONG, finReleve, tlm: T ? { ecart: +T.ecart.toFixed(1), boutTLM: T.boutTLM, angle: Math.round(dA * 180 / Math.PI) } : null });
    st.raccordes++;
  }
  return out;
}

/** Points du relevé (classes 2 sol, 17 pont) à moins de `R` m des points `centres`, rangés par cases de 1 m. */
function indexNuage(nuage, centres, R) {
  const { X, Y, Z, C } = nuage, cases = new Map();
  if (!centres.length) return null;
  for (let k = 0; k < nuage.n; k++) {
    const cl = C[k];
    if (cl !== 2 && cl !== 17) continue;
    const x = X[k], y = Y[k];
    let pres = false;
    for (const [cx, cy] of centres) if (Math.abs(x - cx) < R && Math.abs(y - cy) < R) { pres = true; break; }
    if (!pres) continue;
    const key = Math.floor(x) * 100003 + Math.floor(y);
    let L = cases.get(key);
    if (!L) cases.set(key, L = []);
    L.push(x, y, Z[k], cl);
  }
  return cases;
}
/** Points de l'index autour de (x, y), dans un rayon `r` : appelle f(x, y, z, classe). */
function autour(PN, x, y, r, f) {
  for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) for (let j = Math.floor(y - r); j <= Math.floor(y + r); j++) {
    const L = PN.get(i * 100003 + j);
    if (L) for (let q = 0; q < L.length; q += 4) if ((L[q] - x) ** 2 + (L[q + 1] - y) ** 2 <= r * r) f(L[q], L[q + 1], L[q + 2], L[q + 3]);
  }
}
/** Terrain relevé en (x, y) : le sol le plus bas à moins de 40 cm ; sinon la chaussée relevée (points « pont » à moins de
 *  1,5 m de `zAtt`, médiane) : { z, pont } ; null sans point. */
function observer(PN, x, y, zAtt) {
  let sol = Infinity; const pont = [];
  autour(PN, x, y, 0.4, (px, py, z, cl) => { if (cl === 2) sol = Math.min(sol, z); else if (Math.abs(z - zAtt) < 1.5) pont.push(z); });
  if (sol < Infinity) return { z: sol, pont: false };
  if (!pont.length) return null;
  pont.sort((a, b) => a - b);
  return { z: pont[pont.length >> 1], pont: true };
}
/**
 * Fin du tablier dans le relevé : le long de l'axe (u, vers l'extérieur), dans la moitié centrale de la chaussée, par
 * tranches de 50 cm, les points « pont » à la cote de la chaussée prolongée ; distance (m) du joint du modèle à la
 * dernière tranche qui en a, en partant de l'intérieur (positive : le tablier relevé continue au-delà du joint). Null
 * si le relevé n'a pas de tablier au bout.
 */
function finTablier(PN, jc, u, e, largeur, zc, pente) {
  const n = new Map(), b = largeur * 0.25;
  for (let le = -8; le <= 15; le += 1) for (let tt = -b; tt <= b + 1e-9; tt += 1)
    autour(PN, jc[0] + u[0] * le + e[0] * tt, jc[1] + u[1] * le + e[1] * tt, 0.71, (x, y, z, cl) => {
      if (cl !== 17) return;
      const s = (x - jc[0]) * u[0] + (y - jc[1]) * u[1], t = (x - jc[0]) * e[0] + (y - jc[1]) * e[1];
      if (Math.abs(t) > b || Math.abs(z - (zc + pente * s)) > 1.2) return;
      const k = Math.floor(s * 2);
      n.set(k, (n.get(k) || 0) + 1);
    });
  let k = -2;
  if (!((n.get(k) || 0) + (n.get(k - 1) || 0) >= 2)) return null;
  while ((n.get(k + 1) || 0) + (n.get(k + 2) || 0) >= 1 && k < 30) k++;
  return +((k + 1) / 2).toFixed(1);
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
