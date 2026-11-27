// Estime depuis le nuage swissSURFACE3D (COPC) les faces d'un appui ou la section du tablier, au format du schéma
// (src/pontsModeles.js : `sections` des piles / pylônes / volumes, `sections_tablier`).
//   node outils/ponts/sections_nuage.mjs <modele.json> pile <s> [t=0] [pas=1] [sommets=10] [rayon=long/2+3]
//   node outils/ponts/sections_nuage.mjs <modele.json> tablier [pas=10] [prof=epaisseur]
//   CACHE=fichier.json : même cache que verifier_nuage.mjs (nuage du couloir lu une fois).
//   ZMIN=… ZMAX=… : ne garder que les points de cette tranche d'altitude (p. ex. la pile sous les naissances des voûtes,
//   qui sinon prennent les tympans pour des faces) ; FACES=1 : sections tirées des seuls plans des faces (pile en pierre
//   ou en béton à faces planes : 2 sections, en bas et en haut, le fruit vient des plans), au lieu des tranches.
// Pile : points d'ouvrage (classes 1, 6, 17, 26, 27… hors sol, végétation, eau) à moins de `rayon` (long + 6 m) de la
// pile, sous le tablier ; tranches horizontales de `pas` m ; dans chaque tranche, enveloppe convexe simplifiée à
// `sommets` sommets. Là où une tranche a trop peu de points (pile cachée sous un tablier large), ses faces viennent des
// plans ajustés (RANSAC) sur toute la pile, et la tranche est signalée « non vue ». Sortie (stdout) : le JSON des
// `sections` à coller dans l'appui, et sur stderr ce qui a été vu, le centre mesuré (s, o) et le fruit des faces.
// Tablier : coupes en travers tous les `pas` m (points à ±pas/4) : avancée des rives (corniches, consoles) par tranches
// de 0,25 m jusqu'à `prof` sous la chaussée, et sous-face là où elle est vue ; le reste (milieu de la sous-face, presque
// jamais vu d'avion) est mis à `prof` et signalé. Sortie : `sections_tablier` [{ s, points: [[o, dz], …] }].
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Copc } from "copc";
import { createLazPerf } from "laz-perf/lib/node/index.js";

const [fichier, mode = "pile", ...args] = process.argv.slice(2);
if (!fichier) { console.error("usage : node outils/ponts/sections_nuage.mjs <modele.json> pile <s> [t] [pas] [sommets] | tablier [pas]"); process.exit(1); }
const P = JSON.parse(readFileSync(fichier, "utf8"));
const axe = P.axe, sA = [0];
for (let i = 1; i < axe.length; i++) sA.push(sA[i - 1] + Math.hypot(axe[i][0] - axe[i - 1][0], axe[i][1] - axe[i - 1][1]));
const L = sA.at(-1);
const projeter = (x, y) => { // -> [s, o (+ à gauche)]
  let best = [0, Infinity];
  for (let i = 0; i < axe.length - 1; i++) {
    const ax = axe[i][0], ay = axe[i][1], dx = axe[i + 1][0] - ax, dy = axe[i + 1][1] - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    if (d < Math.abs(best[1])) best = [sA[i] + t * Math.sqrt(l2), -Math.sign((x - ax) * dy - (y - ay) * dx) * d];
  }
  return best;
};
const zChaussee = s => { let i = 0; while (i < axe.length - 2 && s > sA[i + 1]) i++; const u = Math.max(0, Math.min(1, (s - sA[i]) / ((sA[i + 1] - sA[i]) || 1))); return axe[i][2] + (axe[i + 1][2] - axe[i][2]) * u; };

// ------------------------------------------------------------------ nuage (même lecture et même cache que verifier_nuage.mjs)
const marge = (P.largeur || 10) / 2 + 25;
const xs = axe.map(p => p[0]), ys = axe.map(p => p[1]);
const boite = [Math.min(...xs) - marge, Math.min(...ys) - marge, Math.max(...xs) + marge, Math.max(...ys) + marge];
const versWgs = (e, n) => {
  const y = (e - 2600000) / 1e6, x = (n - 1200000) / 1e6;
  return [(2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3) * 100 / 36,
    (16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x ** 3) * 100 / 36];
};
const CACHE = process.env.CACHE, pts = [], tuiles = new Map();
if (CACHE && existsSync(CACHE)) { const c = JSON.parse(readFileSync(CACHE, "utf8")); for (const q of c.pts) pts.push(q); for (const [k, v] of c.tuiles) tuiles.set(k, v); }
else {
  const [lo0, la0] = versWgs(boite[0], boite[1]), [lo1, la1] = versWgs(boite[2], boite[3]);
  const stac = await (await fetch(`https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swisssurface3d/items?limit=100&bbox=${lo0},${la0},${lo1},${la1}`)).json();
  for (const f of stac.features || []) {
    const a = Object.values(f.assets).find(a => /copc/.test(a.href)); if (!a) continue;
    const k = f.id.split("_").pop(), an = +f.id.split("_")[1];
    if (!tuiles.has(k) || an > tuiles.get(k).an) tuiles.set(k, { url: a.href, an });
  }
  if (!tuiles.size) { console.error("pas de nuage COPC ici"); process.exit(2); }
  const lazPerf = await createLazPerf(), coupe = (b, a) => b[0] < a[2] && b[2] > a[0] && b[1] < a[3] && b[3] > a[1];
  for (const { url } of tuiles.values()) {
    const copc = await Copc.create(url), cube = copc.info.cube, cote = cube[3] - cube[0];
    const profMax = Math.max(0, Math.ceil(Math.log2(copc.info.spacing / 0.5)));
    const bn = k => { const [d, x, y] = k.split("-").map(Number), s = cote / 2 ** d; return [cube[0] + x * s, cube[1] + y * s, cube[0] + (x + 1) * s, cube[1] + (y + 1) * s]; };
    const pages = [copc.info.rootHierarchyPage], noeuds = [];
    while (pages.length) {
      const { nodes, pages: sous } = await Copc.loadHierarchyPage(url, pages.pop());
      for (const [k, n] of Object.entries(nodes)) if (n?.pointCount && +k.split("-")[0] <= profMax && coupe(bn(k), boite)) noeuds.push(n);
      for (const [k, p] of Object.entries(sous)) if (+k.split("-")[0] <= profMax && coupe(bn(k), boite)) pages.push(p);
    }
    for (const n of noeuds) {
      const v = await Copc.loadPointDataView(url, copc, n, { lazPerf, include: ["X", "Y", "Z", "Classification"] });
      const gx = v.getter("X"), gy = v.getter("Y"), gz = v.getter("Z"), gc = v.getter("Classification");
      for (let i = 0; i < v.pointCount; i++) {
        const x = gx(i), y = gy(i);
        if (x < boite[0] || x > boite[2] || y < boite[1] || y > boite[3]) continue;
        const [s, o] = projeter(x, y);
        if (s < -15 || s > L + 15 || Math.abs(o) > marge) continue;
        pts.push([x, y, gz(i), gc(i), s, o]);
      }
    }
  }
  if (CACHE) writeFileSync(CACHE, JSON.stringify({ pts, tuiles: [...tuiles] }));
}
const ouvrage = p => ![2, 3, 4, 5, 7, 9].includes(p[3]);
const r2 = v => Math.round(v * 100) / 100;
const dire = l => console.error(l);

// ------------------------------------------------------------------ géométrie plane
const enveloppe = Q => { // enveloppe convexe (chaîne monotone), sens trigonométrique
  const p = Q.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const x = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), bas = [], haut = [];
  for (const q of p) { while (bas.length >= 2 && x(bas.at(-2), bas.at(-1), q) <= 0) bas.pop(); bas.push(q); }
  for (const q of p.slice().reverse()) { while (haut.length >= 2 && x(haut.at(-2), haut.at(-1), q) <= 0) haut.pop(); haut.push(q); }
  return bas.slice(0, -1).concat(haut.slice(0, -1));
};
const simplifier = (H, n) => { // Visvalingam : retire le sommet du plus petit triangle jusqu'à n sommets
  const h = H.slice();
  const aire = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  while (h.length > n) {
    let k = 0, m = Infinity;
    for (let i = 0; i < h.length; i++) { const a = aire(h[(i - 1 + h.length) % h.length], h[i], h[(i + 1) % h.length]); if (a < m) { m = a; k = i; } }
    h.splice(k, 1);
  }
  return h;
};
const aireP = H => Math.abs(H.reduce((a, p, i) => { const q = H[(i + 1) % H.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
// polygone convexe intersection des demi-plans n·(u, v) <= d
const demiPlans = (plans, R = 60, R2 = R) => {
  let poly = [[-R, -R2], [R, -R2], [R, R2], [-R, R2]];
  for (const [nu, nv, d] of plans) {
    const r = [], f = p => nu * p[0] + nv * p[1] - d;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
      if (fa <= 0) r.push(a);
      if (fa * fb < 0) { const t = fa / (fa - fb); r.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    poly = r;
  }
  return poly;
};

if (mode === "pile") {
  const s0 = +args[0], t0 = +(args[1] ?? 0), pas = +(args[2] ?? 1), nS = +(args[3] ?? 10);
  const ap = (P.appuis || []).find(a => Math.abs(a.s - s0) < 3) || {};
  const rayon = +(args[4] ?? (ap.long || 6) / 2 + 3), lmax = Math.max(ap.larg || 0, P.largeur || 8) / 2 + 8;
  const zDeck = zChaussee(s0) - (P.epaisseur || 1);
  // sol mesuré sous la pile (classe 2) et eau (9) : la pile commence au-dessus
  const autour = pts.filter(p => Math.abs(p[4] - s0) < rayon && Math.abs(p[5] - t0) < lmax);
  const eau = autour.filter(p => p[3] === 9).map(p => p[2]).sort((a, b) => a - b), zEau = eau.length ? eau[eau.length >> 1] : -Infinity;
  const zA = +(process.env.ZMIN ?? -Infinity), zB = +(process.env.ZMAX ?? Infinity);
  const Q = autour.filter(p => ouvrage(p) && p[2] < zDeck - 0.2 && p[2] > zEau + 0.1 && p[2] >= zA && p[2] <= zB).map(p => [p[4] - s0, p[5] - t0, p[2]]);
  if (Q.length < 20) { dire(`Pile s ${s0} : ${Q.length} points sous le tablier, trop peu : faces à prendre sur les photos.`); console.log("[]"); process.exit(0); }
  const zs = Q.map(q => q[2]).sort((a, b) => a - b), zmin = zs[Math.floor(zs.length * 0.01)], zmax = zs[Math.floor(zs.length * 0.995)];
  dire(`Pile s ${s0} : ${Q.length} points d'ouvrage, z ${zmin.toFixed(1)}..${zmax.toFixed(1)} (dessous du tablier ${zDeck.toFixed(1)}, eau ${isFinite(zEau) ? zEau.toFixed(1) : "—"})`);
  // RANSAC : plans des faces presque verticales, n·(u, v) + a z = d (n horizontal unitaire), sur tous les points
  let reste = Q.slice(); const plans = [];
  let graine = 12345; const alea = () => (graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let f = 0; f < 8 && reste.length > 30; f++) {
    let mieux = null;
    for (let it = 0; it < 400; it++) {
      const a = reste[Math.floor(alea() * reste.length)], b = reste[Math.floor(alea() * reste.length)], c = reste[Math.floor(alea() * reste.length)];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
      if (l < 1e-6) continue; n = n.map(x => x / l);
      if (Math.abs(n[2]) > 0.15) continue; // faces : fruit de 15 % au plus
      const d = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
      let k = 0; for (const p of reste) if (Math.abs(n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d) < 0.12) k++;
      if (!mieux || k > mieux.k) mieux = { n, d, k };
    }
    if (!mieux || mieux.k < Math.max(25, Q.length * 0.03)) break;
    const dans = reste.filter(p => Math.abs(mieux.n[0] * p[0] + mieux.n[1] * p[1] + mieux.n[2] * p[2] - mieux.d) < 0.12);
    // face tournée vers l'extérieur (la pile est du côté négatif) : orientée par le centre des points
    const cu = Q.reduce((a, p) => a + p[0], 0) / Q.length, cv = Q.reduce((a, p) => a + p[1], 0) / Q.length, cz = (zmin + zmax) / 2;
    let { n, d } = mieux; if (n[0] * cu + n[1] * cv + n[2] * cz - d > 0) { n = n.map(x => -x); d = -d; }
    const zf = dans.map(p => p[2]).sort((a, b) => a - b);
    // une face presque parallèle à une face déjà trouvée (moins de 20°, même sens) : doublon (joints, ressauts), écartée ;
    // une face qui laisse plus de 20 % des points dehors (au-delà de 0,3 m) n'est pas une face d'appui (plan en biais)
    const dehors = Q.filter(p => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d > 0.3).length;
    dire(`    (plan ${n.map(x => x.toFixed(2))} : ${(100 * dehors / Q.length).toFixed(1)} % dehors)`);
    if (dehors < 0.2 * Q.length && !plans.some(F => F.n[0] * n[0] + F.n[1] * n[1] > 0.94 * Math.hypot(F.n[0], F.n[1]) * Math.hypot(n[0], n[1])))
      plans.push({ n, d, k: dans.length, z0: zf[0], z1: zf.at(-1) });
    const ens = new Set(dans); reste = reste.filter(p => !ens.has(p));
  }
  for (const F of plans) {
    const lh = Math.hypot(F.n[0], F.n[1]);
    dire(`  face : normale (${(F.n[0] / lh).toFixed(2)}, ${(F.n[1] / lh).toFixed(2)}) [s, o], fruit ${(F.n[2] / lh * 100).toFixed(1)} %, ${F.k} points, z ${F.z0.toFixed(1)}..${F.z1.toFixed(1)}`);
  }
  // faces qui entourent la pile (aucun trou de plus de 120° entre leurs directions) : sinon pas de polygone des faces
  const dirs = plans.map(F => Math.atan2(F.n[1], F.n[0])).sort((a, b) => a - b);
  const ferme = dirs.length >= 3 && dirs.every((a, i) => ((i + 1 < dirs.length ? dirs[i + 1] : dirs[0] + 2 * Math.PI) - a) < 2.1);
  const polyPlans = z => ferme ? demiPlans(plans.map(F => [F.n[0], F.n[1], F.d - F.n[2] * z]), rayon, lmax) : null;
  // tranches
  const secs = [], nonVues = [];
  for (let z = Math.floor(zmin / pas) * pas; z < zmax; z += pas) {
    const T = Q.filter(q => q[2] >= z && q[2] < z + pas).map(q => [q[0], q[1]]);
    const zc = r2(Math.min(zmax, z + pas / 2));
    let H = T.length >= 8 ? enveloppe(T) : null, src = "nuage";
    const pp = polyPlans(zc);
    // tranche mal vue (peu de points, ou enveloppe bien plus petite que celle des faces) : faces RANSAC
    if (!H || H.length < 3 || (pp && pp.length >= 3 && aireP(H) < 0.6 * aireP(pp))) { if (pp && pp.length >= 3) { H = pp; src = "faces"; } else { nonVues.push(zc); continue; } }
    if (src === "faces") nonVues.push(zc);
    H = simplifier(H, nS);
    secs.push({ z: zc, forme: "poly", points: H.map(([u, v]) => [r2(u), r2(v)]), _src: src, _n: T.length });
  }
  if (process.env.FACES) {
    if (!ferme) { dire("  faces : elles n'entourent pas la pile (côté non vu) : FACES impossible, tranches ci-dessous"); }
    else {
      const out = [zmin, zmax].map(z => ({ z: r2(z), forme: "poly", points: simplifier(polyPlans(z), nS).map(([u, v]) => [r2(u), r2(v)]) }));
      for (const S of out) { const u = S.points.map(p => p[0]), v = S.points.map(p => p[1]); dire(`  faces z ${S.z} : s ${Math.min(...u).toFixed(2)}..${Math.max(...u).toFixed(2)}, o ${Math.min(...v).toFixed(2)}..${Math.max(...v).toFixed(2)}`); }
      console.log(JSON.stringify(out));
      process.exit(0);
    }
  }
  // lissage : une tranche n'est gardée que si elle s'écarte de plus de 0,15 m de l'interpolation de ses voisines
  // (comparées par leurs demi-largeurs le long de s et en travers)
  const ext = S => { const u = S.points.map(p => p[0]), v = S.points.map(p => p[1]); return [Math.min(...u), Math.max(...u), Math.min(...v), Math.max(...v)]; };
  const garde = secs.map((_, i) => i === 0 || i === secs.length - 1);
  const dp = (a, b) => {
    let pire = -1, m = 0.15;
    for (let i = a + 1; i < b; i++) {
      const u = (secs[i].z - secs[a].z) / ((secs[b].z - secs[a].z) || 1), A = ext(secs[a]), B = ext(secs[b]), C = ext(secs[i]);
      const e = Math.max(...C.map((c, k) => Math.abs(c - (A[k] + (B[k] - A[k]) * u))));
      if (e > m) { m = e; pire = i; }
    }
    if (pire > 0) { garde[pire] = true; dp(a, pire); dp(pire, b); }
  };
  if (secs.length > 2) dp(0, secs.length - 1);
  const sortie = secs.filter((_, i) => garde[i]);
  // centre mesuré et emprise
  const tout = sortie.flatMap(S => S.points), cu = tout.reduce((a, p) => a + p[0], 0) / (tout.length || 1), cv = tout.reduce((a, p) => a + p[1], 0) / (tout.length || 1);
  dire(`  centre mesuré : s ${(s0 + cu).toFixed(2)}, o ${(t0 + cv).toFixed(2)} ; ${sortie.length} sections gardées sur ${secs.length}`);
  for (const S of sortie) { const e = ext(S); dire(`  z ${S.z} (${S._src}, ${S._n} pts) : s ${e[0].toFixed(1)}..${e[1].toFixed(1)}, o ${e[2].toFixed(1)}..${e[3].toFixed(1)}`); }
  if (nonVues.length) dire(`  non vu par le laser (faces RANSAC ou rien) : z ${nonVues[0]}..${nonVues.at(-1)} (${nonVues.length} tranches) : vérifier ou compléter sur les photos`);
  if (zmax < zDeck - 1) dire(`  entre z ${zmax.toFixed(1)} et le dessous du tablier ${zDeck.toFixed(1)} : rien de vu (sous le tablier) : tête à prendre sur les photos`);
  console.log(JSON.stringify(sortie.map(({ _src, _n, ...S }) => S)));
} else if (mode === "tablier") {
  // coupes en travers : de chaque côté, l'avancée de la rive (98 % des |o|) par tranches de 0,25 m sous la chaussée,
  // jusqu'à `prof` (épaisseur du modèle par défaut) ; en bas, la sous-face (enveloppe basse) là où elle est vue, sinon
  // à `prof`. Points à ±pas/4 de la station, à moins de largeur/2 + 1,5 m de l'axe.
  const pas = +(args[0] ?? 10), prof = +(args[1] ?? (P.epaisseur || 1)), lmax = (P.largeur || 8) / 2 + 1.5, res = [];
  const q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
  for (let s = Math.min(pas / 2, L / 2); s < L - 2; s += pas) {
    const zc = zChaussee(s);
    const T = pts.filter(p => ouvrage(p) && Math.abs(p[4] - s) < pas / 4 && Math.abs(p[5]) < lmax && p[2] < zc + 0.3 && p[2] > zc - prof - 0.1);
    if (T.length < 20) { dire(`s ${s.toFixed(1)} : ${T.length} points, coupe sautée`); continue; }
    const cote = sg => {
      const r = []; let vu = 0, avant = null;
      for (let dz = 0; dz > -prof - 1e-6; dz -= 0.25) {
        const o = T.filter(p => sg * p[5] > 0 && p[2] - zc <= dz + 0.125 && p[2] - zc > dz - 0.125).map(p => sg * p[5]).sort((a, b) => a - b);
        if (o.length >= 3) { avant = q(o, 0.98); vu++; }
        if (avant != null) r.push([sg * avant, Math.max(-prof, dz)]);
      }
      return { r, vu };
    };
    const G = cote(-1), D = cote(1);
    if (!G.r.length || !D.r.length) { dire(`s ${s.toFixed(1)} : une rive non vue, coupe sautée`); continue; }
    // sous-face vue : cases de 0,5 m entre les rives, point le plus bas sous -0,3 m
    const o0 = G.r.at(-1)[0], o1 = D.r.at(-1)[0], dessous = [];
    let vues = 0, nb = 0;
    for (let o = Math.ceil(o0 / 0.5) * 0.5 + 0.25; o < o1 - 0.25; o += 0.5) {
      nb++;
      const z = T.filter(p => Math.abs(p[5] - o) < 0.25 && p[2] - zc < -0.3).map(p => p[2] - zc);
      if (z.length) { vues++; dessous.push([o, Math.max(-prof, Math.min(...z))]); } else dessous.push([o, -prof]);
    }
    const ligne = [[G.r[0][0], 0], ...G.r, ...dessous, ...D.r.slice().reverse(), [D.r[0][0], 0]];
    const dpl = (a, b, keep) => { let m = 0.08, k = -1; const [x0, y0] = ligne[a], [x1, y1] = ligne[b], l = Math.hypot(x1 - x0, y1 - y0) || 1; for (let i = a + 1; i < b; i++) { const d = Math.abs((x1 - x0) * (y0 - ligne[i][1]) - (x0 - ligne[i][0]) * (y1 - y0)) / l; if (d > m) { m = d; k = i; } } if (k > 0) { keep[k] = 1; dpl(a, k, keep); dpl(k, b, keep); } };
    const keep = ligne.map((_, i) => +(i === 0 || i === ligne.length - 1)); dpl(0, ligne.length - 1, keep);
    const sec = ligne.filter((_, i) => keep[i]).map(([a, b]) => [r2(a), r2(b)]);
    res.push({ s: r2(s), points: sec });
    dire(`s ${s.toFixed(1)} : ${T.length} points, rives o ${G.r[0][0].toFixed(2)} / ${D.r[0][0].toFixed(2)} (tranches vues ${G.vu} et ${D.vu}), sous-face vue ${vues}/${nb}${vues < nb / 2 ? " : non vue, mise à -" + prof + " m (photos)" : ""}, ${sec.length} sommets`);
  }
  console.log(JSON.stringify(res));
} else { console.error(`mode inconnu : ${mode}`); process.exit(1); }
