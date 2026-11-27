// Ponts modélisés : faits main (outils/ponts : un JSON par pont, tiré du relevé laser et de photos, au niveau de
// détail de swissBUILDINGS3D : tablier, culées, piles, arches) ou reconstruits automatiquement (pontsAuto.js, même
// schéma complété station par station). Un seul mailleur pour les deux (`maillagePont`). Un pont fait main remplace
// le pont reconstruit automatiquement à sa place.
import * as THREE from "three";

const BASE = `${import.meta.env?.BASE_URL ?? "/"}ponts/`;
let index = null;

/** Ponts modélisés qui touchent le carré de demi-côté `R` autour de (E0, N0). */
export async function pontsAutour(E0, N0, R) {
  index ||= fetch(BASE + "index.json").then(r => r.ok ? r.json() : []).catch(() => []);
  const liste = (await index).filter(p => p.boite[2] > E0 - R && p.boite[0] < E0 + R && p.boite[3] > N0 - R && p.boite[1] < N0 + R);
  return (await Promise.all(liste.map(p => fetch(BASE + p.fichier).then(r => r.ok ? r.json() : null).catch(() => null)))).filter(Boolean);
}

/** Le pont occupe-t-il (x, y) (relatif au centre E0, N0) ? Tablier et 2 m de marge : pour effacer le pont automatique. */
export function dansPont(P, E0, N0, x, y) {
  const a = P.axe;
  for (let i = 0; i < a.length - 1; i++) {
    const ax = a[i][0] - E0, ay = a[i][1] - N0, bx = a[i + 1][0] - E0, by = a[i + 1][1] - N0, L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(-0.05, Math.min(1.05, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2));
    if (Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) < Math.max(P.largeur / 2, ...(P.bords || []).map(b => Math.max(-b[1], b[2]))) + 2) return true;
  }
  return false;
}

/**
 * Projection d'un point sur la ligne des nœuds { x, y, s } (polyligne) : [s, t], t positif à gauche. Au-delà des bouts,
 * la projection prolonge le premier ou le dernier segment.
 */
export function projeterNoeuds(N, x, y) {
  let best = [0, 0], bd = Infinity;
  const K = N.x.length;
  for (let i = 0; i < K - 1; i++) {
    const ax = N.x[i], ay = N.y[i], ex = N.x[i + 1] - ax, ey = N.y[i + 1] - ay, L2 = ex * ex + ey * ey || 1;
    let u = ((x - ax) * ex + (y - ay) * ey) / L2;
    if (i > 0) u = Math.max(0, u);
    if (i < K - 2) u = Math.min(1, u);
    const px = ax + ex * u, py = ay + ey * u, dd = (x - px) ** 2 + (y - py) ** 2;
    if (dd < bd) { bd = dd; const L = Math.sqrt(L2); best = [N.s[i] + u * (N.s[i + 1] - N.s[i]), (-(x - ax) * ey + (y - ay) * ex) / L]; }
  }
  return best;
}

/** Nœud interpolé à l'abscisse s (bornée aux bouts) : position, normale (gauche) unitaire, rives, chaussée, dévers… */
function noeudEn(N, s) {
  const K = N.s.length;
  let i = 0, lo = 0, hi = K - 1;
  if (s <= N.s[0]) i = 0; else if (s >= N.s[K - 1]) i = K - 2;
  else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (N.s[m] <= s) lo = m; else hi = m; } i = lo; }
  i = Math.max(0, Math.min(K - 2, i));
  const u = Math.max(0, Math.min(1, (s - N.s[i]) / ((N.s[i + 1] - N.s[i]) || 1))), f = k => N[k][i] + (N[k][i + 1] - N[k][i]) * u;
  const nx = f("nx"), ny = f("ny"), l = Math.hypot(nx, ny) || 1;
  return { s, x: f("x"), y: f("y"), nx: nx / l, ny: ny / l, g: f("g"), d: f("d"), z: f("z"), devers: f("devers"), ep: f("ep"), w: f("w") };
}

/** Chaussée du modèle au point (s, t) : { z, g, d, w } (w : poids du raccord, 0 sur le tablier, 1 au joint). */
export function coteDeck(M, s, t) {
  const A = noeudEn(M.noeuds, s);
  return { z: A.z + A.devers * (t - (A.g + A.d) / 2), g: A.g, d: A.d, w: A.w };
}

/**
 * Pont fait main (JSON) → nœuds tous les mètres, comme un pont automatique : rives à ± largeur / 2, sans dévers,
 * épaisseur constante. Raccord : sur les 6 derniers mètres de chaque bout, la chaussée glisse vers le terrain mesuré
 * (s'il est à moins de 2,5 m ; sinon le terrain est le fond de la vallée), en travers selon une droite.
 */
function normaliser(P, E0, N0, sol) {
  const a = P.axe.map(([e, n, z]) => [e - E0, n - N0, z]), cum = [0];
  for (let i = 1; i < a.length; i++) cum.push(cum[i - 1] + Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]));
  const L = cum.at(-1), nrm = a.map((_, i) => { const A = a[Math.max(0, i - 1)], B = a[Math.min(a.length - 1, i + 1)], l = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1; return [-(B[1] - A[1]) / l, (B[0] - A[0]) / l]; });
  const base = { s: cum, x: a.map(v => v[0]), y: a.map(v => v[1]), nx: nrm.map(v => v[0]), ny: nrm.map(v => v[1]), z: a.map(v => v[2]) };
  const N = { s: [], x: [], y: [], nx: [], ny: [], g: [], d: [], z: [], devers: [], ep: [], w: [] };
  const nb = Math.max(2, Math.ceil(L)), l2 = P.largeur / 2, RACCORD = 6;
  // épaisseur : constante, ou renforcée au droit des piles (goussets : `epaisseur_appuis` sur `gousset` m)
  const ep0 = P.epaisseur || 1, epA = P.epaisseur_appuis || ep0, gousset = P.gousset || 0;
  // rives : `bords` [[s, o_min, o_max], …] (o positif à gauche, interpolé) pour un tablier qui s'élargit ; sinon ± largeur / 2
  const bords = P.bords?.length ? P.bords : null, bordsEn = s => {
    if (!bords) return [-l2, l2];
    if (s <= bords[0][0]) return [bords[0][1], bords[0][2]];
    for (let i = 1; i < bords.length; i++) if (s <= bords[i][0]) { const u = (s - bords[i - 1][0]) / ((bords[i][0] - bords[i - 1][0]) || 1); return [0, 1].map(k => bords[i - 1][k + 1] + (bords[i][k + 1] - bords[i - 1][k + 1]) * u); }
    return [bords.at(-1)[1], bords.at(-1)[2]];
  };
  const piles = (P.appuis || []).filter(p => p.type !== "culee").map(p => p.s);
  const epEn = s => {
    if (!(epA > ep0 && gousset > 0)) return ep0;
    let f = 0;
    for (const s0 of piles) { const d = Math.abs(s - s0); if (d < gousset) f = Math.max(f, (1 - d / gousset) ** 2); }
    return ep0 + (epA - ep0) * f;
  };
  for (let k = 0; k <= nb; k++) {
    const s = L * k / nb;
    let i = 0;
    while (i < a.length - 2 && cum[i + 1] < s) i++;
    const u = Math.max(0, Math.min(1, (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1))), f = key => base[key][i] + (base[key][i + 1] - base[key][i]) * u;
    const x = f("x"), y = f("y"), nx0 = f("nx"), ny0 = f("ny"), ln = Math.hypot(nx0, ny0) || 1, nx = nx0 / ln, ny = ny0 / ln;
    let z = f("z"), devers = 0, w = 0;
    const dist = Math.min(s, L - s);
    if (dist < RACCORD) {
      const v = 1 - dist / RACCORD;
      w = v * v * (3 - 2 * v);
      const pts = [];
      for (const t of [-l2, -l2 / 2, 0, l2 / 2, l2]) { const zs = sol(x + nx * t, y + ny * t); if (Math.abs(zs - z) < 2.5) pts.push([t, zs - z]); }
      if (pts.length) {
        let c0 = pts.reduce((p, q) => p + q[1], 0) / pts.length, c1 = 0;
        if (pts.length >= 3) { const tm = pts.reduce((p, q) => p + q[0], 0) / pts.length, stt = pts.reduce((p, q) => p + (q[0] - tm) ** 2, 0); if (stt > 1) { c1 = pts.reduce((p, q) => p + (q[0] - tm) * (q[1] - c0), 0) / stt; c0 -= c1 * tm; } }
        z += c0 * w; devers = c1 * w;
      }
    }
    N.s.push(s); N.x.push(x); N.y.push(y); N.nx.push(nx); N.ny.push(ny); { const [g0, d0] = bordsEn(s); N.g.push(g0); N.d.push(d0); } N.z.push(z); N.devers.push(devers); N.ep.push(epEn(s)); N.w.push(w);
  }
  return { noeuds: N, largeur: P.largeur, section: P.section, dalle: P.dalle, poutre_larg: P.poutre_larg, traverses: P.traverses, epaisseur: P.epaisseur || 1, tablier: [0, L], libre: [true, true], appuis: P.appuis || [], arches: P.arches || [], fait: true };
}

/**
 * Maillage d'un pont modélisé, dans le repère de la scène (x est, y = altitude - zRef, z = -nord).
 * `P` : modèle fait main (JSON, axe en MN95, recentré sur E0, N0) ou automatique (`G.ponts`, relatif : E0 = N0 = 0).
 * `sol(x, y)` : altitude du terrain affiché (relative au centre) ; `uvPlan(x, y)` : coordonnées du plan au sol pour
 * la chaussée, qui prend la matière du terrain. `opts.rayon` : maquette ronde, le pont coupé par le cercle y est fermé
 * par une paroi ; `opts.normaleSol(x, y)` : normale du terrain (fondue dans celle de la chaussée au raccord).
 * Tablier : sections en travers (chaussée en nT bandes, dessous rectangulaire ou en T), plein jusque sous le terrain
 * près du sol (culée) ; allégé à 5 cm (Douglas-Peucker). Renvoie { dessus, reste } : la chaussée (avec uv et normales)
 * et tout le reste (rives, dessous, appuis, arches).
 */
export function maillagePont(P, E0, N0, zRef, sol, uvPlan = () => [0, 0], opts = {}) {
  const M = P.noeuds ? P : normaliser(P, E0, N0, sol), N = M.noeuds, K = N.s.length, L = N.s[K - 1];
  const normaleSol = opts.normaleSol || ((x, y) => { const a = -(sol(x + 1, y) - sol(x - 1, y)) / 2, b = (sol(x, y + 1) - sol(x, y - 1)) / 2, l = Math.hypot(a, 1, b); return [a / l, 1 / l, b / l]; });
  const nT = Math.max(2, Math.min(6, Math.round(M.largeur / 3.5)));
  const epM = N.ep.slice().sort((a, b) => a - b)[K >> 1];
  // section en T (poutre sous une dalle en encorbellement) : tablier épais et large ; sinon rectangulaire
  const enT = epM >= 1.2 && M.largeur >= 7, poutres = M.section === "poutres";
  const haut = [], uv = [], nor = [], bas = [];
  const V = (x, y, z) => [x, z - zRef, -y];
  const quad = (A, B, C, D) => bas.push(...A, ...B, ...C, ...A, ...C, ...D);
  // section au nœud A : points du dessus (nT + 1, de la rive gauche à la droite), dessous ajouré et plein (6 points)
  const section = A => {
    const { s, x, y, nx, ny, g, d, z, devers, ep, w } = A, m = (g + d) / 2, S = { s, w, xy: [], z: [] };
    let libreMin = Infinity, solMin = Infinity, zMin = Infinity;
    const zt = t => z + devers * (t - m);
    for (let k = 0; k <= nT; k++) {
      const t = g + (d - g) * k / nT, xy = [x + nx * t, y + ny * t], zs = sol(...xy), h = zt(t);
      libreMin = Math.min(libreMin, h - zs); solMin = Math.min(solMin, zs); zMin = Math.min(zMin, h);
      S.xy.push(xy); S.z.push(h);
    }
    S.plein = libreMin < 1.2 || (!M.libre[0] && s < M.tablier[0]) || (!M.libre[1] && s > M.tablier[1]);
    const bo = Math.min(zMin - 0.3, z - ep), bp = Math.min(bo, solMin - 0.6);
    const l = d - g, a = poutres ? (M.poutre_larg || 1.6) : enT ? Math.max(1.2, Math.min(3.5, 0.22 * l)) : l / 4, eb = Math.max(0.35, Math.min(0.5, 0.3 * ep));
    const ts = [g, g + a, g + a, d - a, d - a, d];
    S.bt = ts.map(t => [x + nx * t, y + ny * t]);
    S.ba = poutres ? [bo, bo, Math.max(bo, z - (M.dalle || 0.8)), Math.max(bo, z - (M.dalle || 0.8)), bo, bo] : enT ? [Math.max(bo, zt(g) - eb), Math.max(bo, zt(g + a) - eb), bo, bo, Math.max(bo, zt(d - a) - eb), Math.max(bo, zt(d) - eb)] : ts.map(() => bo);
    S.bp = ts.map(() => bp);
    S.ts = ts; S.g = g; S.d = d; S.m = m; S.devers = devers; S.zc = z;
    return S;
  };
  const toutes = N.s.map((_, k) => section(noeudEn(N, N.s[k])));
  // un court jour (moins de 6 m) entre deux parties pleines est bouché : pas de fenêtre sous un tablier au ras du sol
  for (let i = 1, a = -1; i < toutes.length; i++) {
    if (toutes[i].plein) { if (a >= 0 && i - a > 1 && toutes[i].s - toutes[a].s < 6) for (let k = a + 1; k < i; k++) toutes[k].plein = true; a = i; }
  }
  // allègement : une section n'est gardée que si, sans elle, un point du tablier s'écarterait de plus de 5 cm
  // (Douglas-Peucker sur les points du dessus et le dessous) ; les changements plein / ajouré et les appuis sont gardés
  const garde = new Uint8Array(toutes.length), aFaire = [];
  garde[0] = garde[toutes.length - 1] = 1;
  for (let i = 0; i < toutes.length - 1; i++) if (toutes[i].plein !== toutes[i + 1].plein) garde[i] = garde[i + 1] = 1;
  for (let i = 0, a = 0; i < toutes.length; i++) if (garde[i]) { if (i > a + 1) aFaire.push([a, i]); a = i; }
  while (aFaire.length) {
    const [a, b] = aFaire.pop(), A = toutes[a], B = toutes[b];
    let pire = -1, dmax = 0.05;
    for (let i = a + 1; i < b; i++) {
      const S = toutes[i], u = (S.s - A.s) / (B.s - A.s);
      let e = 0;
      for (let k = 0; k < 6; k++) {
        e = Math.max(e, Math.abs(S.ba[k] - (A.ba[k] + (B.ba[k] - A.ba[k]) * u)));
        if (S.plein) e = Math.max(e, Math.abs(S.bp[k] - (A.bp[k] + (B.bp[k] - A.bp[k]) * u)) / 4); // (pied enterré : moins exigeant)
      }
      for (let k = 0; k <= nT; k++) e = Math.max(e, Math.hypot(S.xy[k][0] - (A.xy[k][0] + (B.xy[k][0] - A.xy[k][0]) * u), S.xy[k][1] - (A.xy[k][1] + (B.xy[k][1] - A.xy[k][1]) * u), S.z[k] - (A.z[k] + (B.z[k] - A.z[k]) * u)));
      if (e > dmax) { dmax = e; pire = i; }
    }
    if (pire > 0) { garde[pire] = 1; aFaire.push([a, pire], [pire, b]); }
  }
  const sec = toutes.filter((_, i) => garde[i]);
  // normales du dessus : celles de la surface ajustée (lisses d'une section à l'autre), fondues dans celles du
  // terrain au raccord : plus de couture d'éclairage entre la route et le tablier
  const pt = (i, k) => { const S = sec[Math.max(0, Math.min(sec.length - 1, i))], kk = Math.max(0, Math.min(nT, k)); return [S.xy[kk][0], S.z[kk], -S.xy[kk][1]]; };
  for (let i = 0; i < sec.length; i++) {
    const S = sec[i];
    S.n = [];
    for (let k = 0; k <= nT; k++) {
      const a = pt(i - 1, k), b = pt(i + 1, k), e = pt(i, k - 1), f = pt(i, k + 1), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [f[0] - e[0], f[1] - e[1], f[2] - e[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      if (n[1] < 0) n = n.map(x => -x);
      const l = Math.hypot(...n) || 1, T = S.w > 0 ? normaleSol(...S.xy[k]) : null;
      n = n.map((x, q) => x / l * (1 - S.w) + (T ? T[q] * S.w : 0));
      const l2 = Math.hypot(...n) || 1;
      S.n.push(n.map(x => x / l2));
    }
  }
  // dessus : faces tournées vers le haut (la matière du terrain ne montre que cette face)
  const tri = (A, a, B, b, C, cc) => {
    const pa = V(...A.xy[a], A.z[a]), pb = V(...B.xy[b], B.z[b]), pc = V(...C.xy[cc], C.z[cc]);
    const versHaut = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]) > 0;
    const Ls = versHaut ? [[A, a, pa], [B, b, pb], [C, cc, pc]] : [[A, a, pa], [C, cc, pc], [B, b, pb]];
    for (const [S, k, p] of Ls) { haut.push(...p); uv.push(...uvPlan(...S.xy[k])); nor.push(...S.n[k]); }
  };
  const top = (S, k) => V(...S.xy[k], S.z[k]), dess = (S, k, cle) => V(...S.bt[k], S[cle][k]);
  // tour d'une section (sens : rive gauche du haut vers le bas, dessous, rive droite vers le haut)
  const contour = (S, cle) => [top(S, 0), ...[0, 1, 2, 3, 4, 5].map(k => dess(S, k, cle)), top(S, nT)];
  const longueur = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const bande = (CA, CB) => {
    for (let k = 0; k < CA.length - 1; k++) {
      if (longueur(CA[k], CA[k + 1]) < 1e-3 && longueur(CB[k], CB[k + 1]) < 1e-3) continue;
      quad(CA[k], CB[k], CB[k + 1], CA[k + 1]);
    }
  };
  const cle = (A, B) => A.plein && B.plein ? "bp" : "ba";
  for (let i = 0; i < sec.length - 1; i++) {
    const A = sec[i], B = sec[i + 1], c = cle(A, B);
    for (let k = 0; k < nT; k++) { tri(A, k, A, k + 1, B, k + 1); tri(A, k, B, k + 1, B, k); }
    bande(contour(A, c), contour(B, c));
    // face de culée : là où le tablier plein devient ajouré
    if (i + 2 < sec.length && cle(B, sec[i + 2]) !== c) {
      const P0 = [0, 1, 2, 3, 4, 5].map(k => dess(B, k, "ba")), P1 = [0, 1, 2, 3, 4, 5].map(k => dess(B, k, "bp"));
      for (let k = 0; k < 5; k++) if (longueur(P0[k], P0[k + 1]) > 1e-3) quad(P0[k], P0[k + 1], P1[k + 1], P1[k]);
    }
  }
  // bouts : fermés (enterrés dans la route, ou coupe franche d'un bout libre) ; polygone dessus + dessous triangulé
  const fermer = (S, c) => {
    const pts2 = [], pts3 = [];
    for (let k = 0; k <= nT; k++) { pts2.push(new THREE.Vector2(S.g + (S.d - S.g) * k / nT, S.z[k])); pts3.push(top(S, k)); }
    for (let k = 5; k >= 0; k--) { pts2.push(new THREE.Vector2(S.ts[k] + (k === 0 ? 1e-4 : k === 5 ? -1e-4 : 0), S[c][k])); pts3.push(dess(S, k, c)); }
    for (const [a, b, d] of THREE.ShapeUtils.triangulateShape(pts2, [])) bas.push(...pts3[a], ...pts3[b], ...pts3[d]);
  };
  if (sec.length >= 2) { fermer(sec[0], cle(sec[0], sec[1])); fermer(sec.at(-1), cle(sec.at(-2), sec.at(-1))); }
  // maquette ronde : le pont coupé par le cercle y est fermé par une paroi (du dessous à la chaussée), sinon la coupe
  // montre l'intérieur du tablier
  if (opts.rayon) {
    const Rc = opts.rayon - 0.05, pasA = 0.5 / Rc;
    let coupe = false;
    for (let k = 0; k < K; k++) if (N.x[k] ** 2 + N.y[k] ** 2 > (Rc - 2) ** 2 - 2 * Rc * Math.max(Math.abs(N.g[k]), Math.abs(N.d[k]))) { coupe = true; break; }
    let avant = null;
    for (let a = 0; coupe && a < 2 * Math.PI + pasA; a += pasA) {
      const x = Rc * Math.cos(a), y = Rc * Math.sin(a), [sk, t] = projeterNoeuds(N, x, y);
      const A = sk >= 0 && sk <= L ? noeudEn(N, sk) : null;
      if (!A || t < A.g || t > A.d) { avant = null; continue; }
      const S = section(A), c = S.plein ? "bp" : "ba";
      // dessous en t : interpolé le long des six points du dessous
      let zb = S[c][0];
      for (let k = 0; k < 5; k++) if (t >= S.ts[k] && t <= S.ts[k + 1]) { const u = (t - S.ts[k]) / ((S.ts[k + 1] - S.ts[k]) || 1); zb = S[c][k] + (S[c][k + 1] - S[c][k]) * u; }
      const ici = { xy: [x, y], z: S.zc + S.devers * (t - S.m), b: zb };
      if (avant) quad(V(...avant.xy, avant.b), V(...ici.xy, ici.b), V(...ici.xy, ici.z), V(...avant.xy, avant.z));
      avant = ici;
    }
  }
  // volume balayé le long de l'axe entre s0 et s1, centré sur l'écart t0 : en travers de largeur `l`, du bas `b(s)`
  // au haut `h(s)` (appuis, arches)
  const balaye = (s0, s1, l, b, h, pas = 2, t0 = 0) => {
    const nb = Math.max(1, Math.ceil((s1 - s0) / pas)), coupe = s => {
      const A = noeudEn(N, s), cx = A.x + A.nx * t0, cy = A.y + A.ny * t0, lx = A.nx * l / 2, ly = A.ny * l / 2, zb = b(s), zh = h(s);
      return [V(cx + lx, cy + ly, zb), V(cx - lx, cy - ly, zb), V(cx - lx, cy - ly, zh), V(cx + lx, cy + ly, zh)];
    };
    let avant = coupe(s0);
    quad(...avant);
    for (let k = 1; k <= nb; k++) {
      const c = coupe(s0 + (s1 - s0) * k / nb);
      for (let f = 0; f < 4; f++) quad(avant[f], c[f], c[(f + 1) % 4], avant[(f + 1) % 4]);
      avant = c;
    }
    quad(...avant);
  };
  const dessous = s => { const A = noeudEn(N, s); return A.z - A.ep; };
  const dessus = s => noeudEn(N, s).z;
  // point de l'axe : position, chaussée, direction (ux, uy) ; la gauche est (−uy, ux) = (nx, ny)
  const surAxe = s => { const A = noeudEn(N, Math.max(0, Math.min(L, s))); return { x: A.x, y: A.y, z: A.z, ux: A.ny, uy: -A.nx }; };
  // quadrilatère en coordonnées [x, y, z] (nord), les deux faces
  const quadM = (p, q, r, w) => { const a = V(...p), b = V(...q), c = V(...r), d = V(...w); quad(a, b, c, d); quad(a, d, c, b); };
  // barre de a à b (points [x, y, z]) : section w × h au départ, wb × hb à l'arrivée (effilée)
  const segment = (a, b, w, h = w, wb = w, hb = h) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1, u = d.map(x => x / l);
    const r = Math.abs(u[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
    const p1 = [u[1] * r[2] - u[2] * r[1], u[2] * r[0] - u[0] * r[2], u[0] * r[1] - u[1] * r[0]], n1 = Math.hypot(...p1) || 1;
    const e1 = p1.map(x => x / n1), e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
    const c = (q, i, j, W, H) => [0, 1, 2].map(k => q[k] + i * e1[k] * W / 2 + j * e2[k] * H / 2);
    const S4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const A4 = S4.map(([i, j]) => c(a, i, j, w, h)), B4 = S4.map(([i, j]) => c(b, i, j, wb, hb));
    for (let f = 0; f < 4; f++) quadM(A4[f], A4[(f + 1) % 4], B4[(f + 1) % 4], B4[f]);
    quadM(...A4); quadM(...B4);
  };
  // point dans le repère du pont : [s, o (en travers, + à gauche), z] ; z en m, ou "tablier" / "chaussee" / "sol"
  const local = ([t, o, z], dz = 0) => {
    const A = surAxe(t), x = A.x - A.uy * o, y = A.y + A.ux * o;
    const zz = z === "tablier" ? dessous(t) : z === "chaussee" ? dessus(t) : z === "sol" ? sol(x, y) : z;
    return [x, y, zz + dz];
  };
  // garde-corps des deux bords : mur plein (parapet) ou main courante et poteaux (ajouré)
  const GC = P.garde_corps;
  if (GC) {
    const h = GC.hauteur || 1.1, e = GC.epaisseur || (GC.plein ? 0.4 : 0.12), t0 = Math.min(6, L / 4), t1 = L - t0;
    if (!P.bords?.length) for (const cote of [-1, 1]) {   // largeur constante : un seul balayage
      const o = cote * (M.largeur / 2 - e / 2);
      if (GC.plein) balaye(t0, t1, e, dessus, s2 => dessus(s2) + h, 3, o);
      else {
        balaye(t0, t1, e * 1.4, s2 => dessus(s2) + h - 0.12, s2 => dessus(s2) + h, 3, o);
        const pasP = GC.pas || 2.5, nbp = Math.max(1, Math.round((t1 - t0) / pasP));
        for (let k = 0; k <= nbp; k++) { const t = t0 + (t1 - t0) * k / nbp; balaye(t - e / 2, t + e / 2, e, dessus, u => dessus(u) + h, 1, o); }
      }
    }
    // tablier qui s'élargit (`bords`) : par tronçons de 10 m, la rive suit le bord du tablier
    else {
      const oRive = (cote, t) => { const A = noeudEn(N, t); return cote > 0 ? A.d - e / 2 : A.g + e / 2; };
      for (const cote of [-1, 1]) {
        for (let a = t0; a < t1 - 1e-6; a += 10) {
          const b = Math.min(t1, a + 10), o = oRive(cote, (a + b) / 2);
          if (GC.plein) balaye(a, b, e, dessus, s2 => dessus(s2) + h, 3, o);
          else balaye(a, b, e * 1.4, s2 => dessus(s2) + h - 0.12, s2 => dessus(s2) + h, 3, o);
        }
        if (!GC.plein) {
          const pasP = GC.pas || 2.5, nbp = Math.max(1, Math.round((t1 - t0) / pasP));
          for (let k = 0; k <= nbp; k++) { const t = t0 + (t1 - t0) * k / nbp; balaye(t - e / 2, t + e / 2, e, dessus, u => dessus(u) + h, 1, oRive(cote, t)); }
        }
      }
    }
  }
  // parois : cloisons ou séparateurs le long de l'axe, de (s0, o0) à (s1, o1) : { s0, s1, o0, o1, h, ep }
  for (const W of P.parois || []) {
    const a0 = Math.max(0, W.s0), a1 = Math.min(L, W.s1);
    for (let a = a0; a < a1 - 1e-6; a += 10) {
      const b = Math.min(a1, a + 10), o = W.o0 + (W.o1 - W.o0) * (((a + b) / 2 - W.s0) / ((W.s1 - W.s0) || 1));
      balaye(a, b, W.ep || 0.3, dessus, s2 => dessus(s2) + (W.h || 1.2), 3, o);
    }
  }
  // lampadaires : mâts de section `ep`, hauteur `h`, tous les `pas` m entre s0 et s1, à l'écart o
  for (const Lp of P.lampadaires || []) for (let t = Lp.s0; t <= Math.min(L, Lp.s1); t += Lp.pas || 24) balaye(t - (Lp.ep || 0.25) / 2, t + (Lp.ep || 0.25) / 2, Lp.ep || 0.25, dessus, u => dessus(u) + (Lp.h || 8), 1, Lp.o);
  // traverses : poutres transversales sous la dalle (section « poutres »), tous les `pas` m
  const TR = M.section === "poutres" && M.traverses;
  if (TR) {
    const pas = TR.pas || 4, ept = TR.ep || 0.4, prof = TR.prof || 1.7, a = M.poutre_larg || 1.6;
    for (let t = TR.s0 ?? 8; t < (TR.s1 ?? L - 8); t += pas) {
      const A = noeudEn(N, t), bas = A.z - prof;
      if (sol(A.x, A.y) > bas - 2) continue;   // pas de traverse contre le terrain
      balaye(t - ept / 2, t + ept / 2, A.d - A.g - 2 * a + 0.1, () => bas, u => noeudEn(N, u).z - (M.dalle || 0.8) + 0.05, 1, (A.g + A.d) / 2);
    }
  }
  // galeries couvertes (antibruit) : toit à `h` m au-dessus de la chaussée ([[s, h], …] interpolé, ou un nombre),
  // bandeaux de rive et poteaux tous les `pas` m ; le toit fait `ep` m d'épaisseur
  for (const G of P.galeries || []) {
    const pts = Array.isArray(G.h) ? G.h : [[G.s0, G.h || 6.5], [G.s1, G.h || 6.5]];
    const hh = t => { if (t <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (t - pts[i - 1][0]) / ((pts[i][0] - pts[i - 1][0]) || 1); return pts.at(-1)[1]; };
    const ep = G.ep || 0.6, bd = G.bandeau || 0.9, pe = G.poteau || 0.5, s0 = Math.max(0, G.s0), s1 = Math.min(L, G.s1);
    balaye(s0, s1, M.largeur, t => dessus(t) + hh(t) - ep, t => dessus(t) + hh(t), 2);
    for (const cote of [-1, 1]) {
      const o = cote * (M.largeur / 2 - pe / 2);
      balaye(s0, s1, pe, t => dessus(t) + hh(t) - ep - bd, t => dessus(t) + hh(t) - ep, 2, o);
      const nbp = Math.max(1, Math.round((s1 - s0) / (G.pas || 6)));
      for (let k = 0; k <= nbp; k++) { const t = s0 + (s1 - s0) * k / nbp; balaye(Math.max(s0, t - pe / 2), Math.min(s1, t + pe / 2), pe, dessus, u => dessus(u) + hh(u) - ep - bd, 1, o); }
    }
  }
  // arches : parabole (par défaut), arc de cercle (`forme: "cintre"`, plein cintre surhaussé si la flèche dépasse la
  // demi-ouverture, sinon surbaissé) ou arc asymétrique (`s_cle`, `z_naissance_fin`) ; pleines (maçonnerie jusqu'au
  // tablier) ou arc porteur en une ou plusieurs nervures, avec montants
  const arcs = M.arches || [];
  for (const A of arcs) {
    const c = A.s1 - A.s0 || 1, f = Math.max(0.1, A.z_cle - A.z_naissance), Rc = (c * c / 4 + f * f) / (2 * f);
    const zA = A.forme === "cintre" && f >= c / 2
      ? t => { const x = t - (A.s0 + A.s1) / 2, r = c / 2; return A.z_naissance + (f - r) + Math.sqrt(Math.max(0, r * r - x * x)); }
      : A.forme === "cintre"
      ? t => { const x = t - (A.s0 + A.s1) / 2; return A.z_naissance + Math.sqrt(Math.max(0, Rc * Rc - x * x)) - (Rc - f); }
      : A.s_cle != null
      ? t => {
        const avant = t <= A.s_cle, s0 = avant ? A.s0 : A.s1, zn = avant ? A.z_naissance : (A.z_naissance_fin ?? A.z_naissance);
        const u = (t - A.s_cle) / ((A.s_cle - s0) || 1);
        return A.z_cle - (A.z_cle - zn) * u * u;
      }
      : t => { const u = (2 * (t - A.s0) / c) - 1; return A.z_naissance + f * (1 - u * u); };
    const e = A.epaisseur || 1, l = A.larg || M.largeur * 0.85;
    if (A.plein) balaye(A.s0, A.s1, l, zA, dessous, 0.75);
    else {
      const nN = Math.max(1, A.nervures || 1), lN = nN > 1 ? (A.larg_nervure || l / nN * 0.5) : l;
      const decal = k => nN > 1 ? -l / 2 + lN / 2 + k * (l - lN) / (nN - 1) : 0;
      const pasM = A.montants_pas || 7, nbm = Math.max(1, Math.round((A.s1 - A.s0) / pasM)), eM = A.montant_ep || 0.6;
      for (let k = 0; k < nN; k++) {
        const o = decal(k);
        balaye(A.s0, A.s1, lN, zA, t => zA(t) + e, 1.5, o);
        for (let j = 1; j < nbm; j++) {
          const t = A.s0 + (A.s1 - A.s0) * j / nbm;
          if (dessous(t) - (zA(t) + e) > 0.6) balaye(t - eM / 2, t + eM / 2, lN, t2 => zA(t2) + e, dessous, 1, o);
        }
      }
    }
  }
  // culées et piles
  for (const p of M.appuis || []) {
    const s = Math.max(0, Math.min(L, p.s)), A = noeudEn(N, s), ux = A.ny, uy = -A.nx;
    if (p.type === "culee") {
      // bloc de 4 m vers l'extérieur, du tablier au terrain (ou aux naissances des arches voisines)
      const dehors = s < L / 2 ? -1 : 1, s0 = s < L / 2 ? s : s - 4, s1 = s0 + 4;
      const zs = sol(A.x + ux * 2 * dehors, A.y + uy * 2 * dehors), naiss = Math.min(...arcs.map(x => x.z_naissance), Infinity);
      const b = Math.min(isNaN(zs) ? naiss : zs, naiss) - 1;
      if (b < dessous(s) - 0.5) balaye(Math.max(0, s0), Math.min(L, s1), A.d - A.g, () => b, dessous, 4, (A.g + A.d) / 2);
      continue;
    }
    const lo = p.long || 3, la = p.larg || M.largeur * 0.8, t0 = p.t || 0, fr = p.fruit || 0;
    const cx = A.x + A.nx * t0, cy = A.y + A.ny * t0;
    // pied : 1 m sous le terrain le plus bas de l'emprise (sauf altitude donnée)
    const zb = p.z_bas ?? Math.min(...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => sol(cx + ux * lo / 2 * a + A.nx * la / 2 * b, cy + uy * lo / 2 * a + A.ny * la / 2 * b))) - 1;
    const tete = M.fait ? dessous(s) : dessous(s) + 0.05;
    if (p.forme === "rond") {
      const r = Math.min(lo, la) / 2, h = tete - zb, n = 16;
      for (let k = 0; k < n; k++) {
        const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, rb = r + fr * h;
        quad(V(cx + Math.cos(a0) * rb, cy + Math.sin(a0) * rb, zb), V(cx + Math.cos(a1) * rb, cy + Math.sin(a1) * rb, zb),
          V(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, tete), V(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, tete));
      }
    } else {
      const S4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      // profil : la pile est UN seul volume, lissé d'une section à l'autre ([[profondeur sous le tablier, long, larg], …])
      if (p.profil?.length) {
        const zt = p.z_haut ?? tete;
        const secs = p.profil.map(([dz, l1, w1]) => [zt - dz, l1, w1]);
        const [, lD, wD] = secs.at(-1), hD = Math.max(0, secs.at(-1)[0] - zb);
        if (zb < secs.at(-1)[0] - 0.01) secs.push([zb, lD + 2 * fr * hD, wD + 2 * fr * hD]);
        const anneau = ([z, l1, w1]) => S4.map(([a, b]) => [cx + ux * l1 / 2 * a + A.nx * w1 / 2 * b, cy + uy * l1 / 2 * a + A.ny * w1 / 2 * b, z]);
        const R = secs.map(anneau);
        for (let k = 0; k + 1 < R.length; k++) for (let f = 0; f < 4; f++) quadM(R[k + 1][f], R[k + 1][(f + 1) % 4], R[k][(f + 1) % 4], R[k][f]);
        quadM(...R.at(-1));
        continue;
      }
      // rectangulaire (fruit : plus large en bas), ou deux colonnes (`forme: "double"`) ; chapiteau ; arrêt `z_haut`
      const colonnes = p.forme === "double" ? (() => { const lc = p.larg_colonne || la * 0.3; return [[-(la - lc) / 2, lc], [(la - lc) / 2, lc]]; })() : [[0, la]];
      const CH = p.chapiteau, zh = (p.z_haut ?? tete) - (CH ? CH.hauteur || 2 : 0);
      for (const [o, lc] of colonnes) {
        const h = Math.max(0, zh - zb), dl = fr * h;
        const loH = p.long_haut ?? lo, lcH = colonnes.length > 1 ? lc : (p.larg_haut ?? lc);
        const coin = (a, b, z, L1, W1) => [cx + ux * L1 / 2 * a + A.nx * (o + W1 / 2 * b), cy + uy * L1 / 2 * a + A.ny * (o + W1 / 2 * b), z];
        const bas4 = S4.map(([a, b]) => coin(a, b, zb, lo + 2 * dl, lc + 2 * dl)), haut4 = S4.map(([a, b]) => coin(a, b, zh, loH, lcH));
        for (let f = 0; f < 4; f++) quadM(bas4[f], bas4[(f + 1) % 4], haut4[(f + 1) % 4], haut4[f]);
        quadM(...bas4);
      }
      if (CH) {
        const lC = CH.larg || P.largeur_dessous || M.largeur, oC = CH.long || (p.long_haut ?? lo), hC = CH.hauteur || 2;
        segment(local([s, t0, zh]), local([s, t0, zh + hC]), CH.larg_bas || lC, oC, lC, oC);
      }
    }
  }
  // pylônes : mât dans l'axe, en H ou en A, ou "aucun" (dessiné par des éléments libres, sert d'ancrage aux haubans)
  const sommets = [];
  for (const Y of P.pylones || []) {
    const t = Math.max(0, Math.min(L, Y.s)), A = surAxe(t), px = -A.uy, py = A.ux, zb = Y.z_bas ?? sol(A.x, A.y) - 1;
    const zh = Y.z_haut, e = Y.epaisseur || 3, ecart = Y.ecart ?? M.largeur + 2;
    const pt = (o, z) => [A.x + px * o, A.y + py * o, z];
    const zA0 = zh - 2, zA1 = Y.z_ancrage_bas ?? zA0, za = (k, n) => zA0 - (zA0 - zA1) * (n > 1 ? k / (n - 1) : 0);
    if (Y.forme === "aucun") { sommets.push({ t, haut: (c, k = 0, n = 1) => pt(0, za(k, n)) }); continue; }
    if (Y.profil?.length) {
      // pylône sculpté : UN seul volume lofté, de la semelle au sommet. `profil` : sections horizontales
      // [[z, oe, oi, l], …] (de bas en haut) : le volume est fait de deux lobes symétriques (gauche et droite), en
      // travers de oi (bord intérieur) à oe (bord extérieur), de longueur l le long de l'axe. oi = 0 : les deux lobes
      // n'en font qu'un (fût, mât) ; oi > 0 : fourche (V sous le tablier, A au-dessus). Les angles verticaux sont
      // abattus de `chanfrein` (m) ; les faces des lobes qui se touchent ne sont pas dessinées.
      const ch = Y.chanfrein || 0, st = Y.profil, ux = A.ux, uy = A.uy;
      const anneau = (z, oe, oi, l, sg) => {
        const h = l / 2, co = Math.min(ch, (oe - oi) / 2, h), ci = Math.min(ch, oi, (oe - oi) / 2, h);
        return [[oi + ci, -h], [oe - co, -h], [oe, -h + co], [oe, h - co], [oe - co, h], [oi + ci, h], [oi, h - ci], [oi, -h + ci]]
          .map(([u, w]) => [A.x + px * sg * u + ux * w, A.y + py * sg * u + uy * w, z]);
      };
      for (const sg of [-1, 1]) {
        const R = st.map(([z, oe, oi, l]) => anneau(z, oe, oi, l, sg));
        for (let k = 0; k + 1 < R.length; k++) for (let f = 0; f < 8; f++) {
          if (f === 6 && st[k][2] < 0.02 && st[k + 1][2] < 0.02) continue;
          quadM(R[k + 1][f], R[k + 1][(f + 1) % 8], R[k][(f + 1) % 8], R[k][f]);
        }
        for (const r of [R[0], R.at(-1)]) for (let f = 1; f < 7; f++) quadM(r[0], r[f], r[f + 1], r[f + 1]);
      }
      sommets.push({ t, haut: (c, k = 0, n = 1) => pt(0, za(k, n)) });
      continue;
    }
    if (Y.forme === "H" || Y.forme === "A") {
      const oh = Y.forme === "A" ? 0 : ecart / 2;
      for (const c of [-1, 1]) segment(pt(c * ecart / 2, zb), pt(c * oh, zh), e);
      if (Y.forme === "H") segment(pt(-ecart / 2, dessous(t) - 1), pt(ecart / 2, dessous(t) - 1), e);
      sommets.push({ t, haut: (c, k = 0, n = 1) => pt(c * oh, za(k, n)) });
    } else {
      segment(pt(0, zb), pt(0, zh), e);
      sommets.push({ t, haut: (c, k = 0, n = 1) => pt(0, za(k, n)) });
    }
  }
  // haubans : éventail ou semi-harpe, nappe axiale ou latérale
  const H = P.haubans;
  if (H && sommets.length) {
    const pas = H.pas || 10, nbh = H.nombre || 8, lat = H.nappe === "laterale", eh = H.epaisseur || 0.25;
    for (const S of sommets) for (const sens of [-1, 1]) for (let k = 1; k <= nbh; k++) {
      const t = S.t + sens * (H.depart || 10) + sens * (k - 1) * pas;
      if (t < 0 || t > L) continue;
      const A = surAxe(t), px = -A.uy, py = A.ux;
      for (const c of lat ? [-1, 1] : [0]) {
        const o = c * (H.o_ancrage ?? (M.largeur / 2 - 0.5));
        segment(S.haut(c, nbh - k, nbh), [A.x + px * o, A.y + py * o, dessus(t) + 0.5], eh);
      }
    }
  }
  // éléments libres : barres effilées dans le repère du pont (béquilles, fourches, losanges…)
  for (const E of P.elements || []) {
    const w = E.larg || 1, h = E.ep || w;
    segment(local(E.de, E.dz_de || 0), local(E.a, E.dz_a || 0), w, h, E.larg_fin ?? w, E.ep_fin ?? h);
  }
  // triangles d'aire nulle (points confondus du dessous, bouts) retirés : leur normale nulle donnait des carrés noirs
  // dans l'occlusion ambiante
  const net = [];
  for (let i = 0; i < bas.length; i += 9) {
    const ux = bas[i + 3] - bas[i], uy = bas[i + 4] - bas[i + 1], uz = bas[i + 5] - bas[i + 2], vx = bas[i + 6] - bas[i], vy = bas[i + 7] - bas[i + 1], vz = bas[i + 8] - bas[i + 2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-6) for (let k = 0; k < 9; k++) net.push(bas[i + k]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(net, 3));
  g.computeVertexNormals();
  const d = new THREE.BufferGeometry();
  d.setAttribute("position", new THREE.Float32BufferAttribute(haut, 3));
  d.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  d.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  d.userData.sections = sec.length;
  return { dessus: d, reste: g };
}

/**
 * Sol sous les ponts faits main. Le laser ne voit pas sous un tablier : la grille y interpole le sol depuis les bords de
 * l'emprise, souvent des rues au niveau de la chaussée (viaduc urbain), et le terrain bouchait l'ouvrage jusqu'au
 * tablier (Grand-Pont à Lausanne). Là où le sol monte à moins d'un mètre du dessous du tablier, il est abaissé sur la
 * ligne qui joint les pieds connus de l'ouvrage (piles : `z_bas`, arches : naissances), jamais relevé. Sans pied connu
 * (pont d'une seule portée), rien ne change. Tronçons `remblai: [[s0, s1], …]` du modèle (arches remplies, vallée
 * remblayée, p. ex. le Flon sous le Grand-Pont) : le sol y reste tel quel. Renvoie le nombre de cellules abaissées.
 */
export function creuserSousPonts(G, modeles, E0, N0) {
  let n = 0;
  for (const P of modeles || []) {
    const a = P.axe.map(([e, nn, z]) => [e - E0, nn - N0, z]), cum = [0];
    for (let i = 1; i < a.length; i++) cum.push(cum[i - 1] + Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]));
    const L = cum.at(-1), ep = P.epaisseur || 1, l2 = P.largeur / 2 + 1;
    const pieds = [];
    for (const p of P.appuis || []) if (p.type === "pile" && Number.isFinite(p.z_bas)) pieds.push([p.s, p.z_bas]);
    for (const A of P.arches || []) {
      if (Number.isFinite(A.z_naissance)) pieds.push([A.s0, A.z_naissance]);
      const zf = A.z_naissance_fin ?? A.z_naissance;
      if (Number.isFinite(zf)) pieds.push([A.s1, zf]);
    }
    if (!pieds.length) continue;
    pieds.sort((p, q) => p[0] - q[0]);
    const profil = s => {
      if (s <= pieds[0][0]) return pieds[0][1];
      if (s >= pieds.at(-1)[0]) return pieds.at(-1)[1];
      let i = 0; while (pieds[i + 1][0] < s) i++;
      const [s0, z0] = pieds[i], [s1, z1] = pieds[i + 1];
      return z0 + (z1 - z0) * (s - s0) / ((s1 - s0) || 1);
    };
    const chaussee = s => { let i = 0; while (i < a.length - 2 && cum[i + 1] < s) i++; const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1); return a[i][2] + (a[i + 1][2] - a[i][2]) * t; };
    const xs = a.map(p => p[0]), ys = a.map(p => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - l2 - G.x0) / G.c)), i1 = Math.min(G.n - 1, Math.ceil((Math.max(...xs) + l2 - G.x0) / G.c));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - l2 - G.x0) / G.c)), j1 = Math.min(G.n - 1, Math.ceil((Math.max(...ys) + l2 - G.x0) / G.c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = G.x0 + (i + 0.5) * G.c, y = G.x0 + (j + 0.5) * G.c;
      // projection sur l'axe : abscisse s, distance au centre du tablier
      let best = Infinity, sb = 0;
      for (let k = 0; k < a.length - 1; k++) {
        const ax = a[k][0], ay = a[k][1], dx = a[k + 1][0] - ax, dy = a[k + 1][1] - ay, l = dx * dx + dy * dy || 1;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)), d = Math.hypot(x - ax - u * dx, y - ay - u * dy);
        if (d < best) { best = d; sb = cum[k] + u * Math.sqrt(l); }
      }
      if (best > l2 || sb < 3 || sb > L - 3) continue;
      if ((P.remblai || []).some(([r0, r1]) => sb >= r0 && sb <= r1)) continue;
      const p = j * G.n + i, z = G.sol[p], zp = profil(sb);
      if (!(z > chaussee(sb) - ep - 1) || !(z > zp + 0.3)) continue;
      G.sol[p] = zp; n++;
    }
  }
  return n;
}
