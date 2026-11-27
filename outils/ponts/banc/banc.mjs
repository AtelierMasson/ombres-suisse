// Banc de mesure hors navigateur des ponts reconstruits.
//   node --import ./env.mjs banc.mjs <étiquette> [--src <dossier src>] [--ref <étiquette de référence>] [site[@rayon]…]
// (depuis outils/ponts/banc ; voir docs/ponts-methode.md, section 5)
// Pour chaque site : grille (depuisPoints, garderCercle) puis ponts comme scene.construire, et mesures par pont.
// Les zones de mesure des raccords (axes, bouts) viennent de l'étiquette de référence (par défaut « avant ») : les
// deux versions sont mesurées aux mêmes endroits.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { nuageSite } from "./charger.mjs";
import { SITES, PROJET, MESURES, REFERENCE } from "./sites.mjs";

const args = process.argv.slice(2), etiq = args.shift();
let src = PROJET + "/src", ref = "avant";
const noms = [];
while (args.length) { const a = args.shift(); if (a === "--src") src = args.shift(); else if (a === "--ref") ref = args.shift(); else noms.push(a); }
const SORTIE = MESURES;
mkdirSync(SORTIE, { recursive: true });
const g = await import(src + "/grille.js"), m = await import(src + "/maillages.js"), pm = await import(src + "/pontsModeles.js");
const THREE = await import("three");

/** Nuage rogné comme le fait l'application pour un rayon fin R (boîte ±R, disque R + 3). */
export function rogner(N, R) {
  if (R >= N.meta.R) return N;
  const garde = [];
  for (let k = 0; k < N.n; k++) { const x = N.X[k], y = N.Y[k]; if (x >= -R && x < R && y >= -R && y < R && x * x + y * y <= (R + 3) ** 2) garde.push(k); }
  const n = garde.length, X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n), C = new Uint8Array(n);
  garde.forEach((k, i) => { X[i] = N.X[k]; Y[i] = N.Y[k]; Z[i] = N.Z[k]; C[i] = N.C[k]; });
  return { meta: N.meta, X, Y, Z, C, n };
}

/** Ponts modélisés à la main qui touchent le carré (comme pontsAutour, lu sur le disque). */
function modelesAutour(E0, N0, R) {
  const index = JSON.parse(readFileSync(PROJET + "/public/ponts/index.json", "utf8"));
  return index.filter(p => p.boite[2] > E0 - R && p.boite[0] < E0 + R && p.boite[3] > N0 - R && p.boite[1] < N0 + R).map(p => JSON.parse(readFileSync(PROJET + "/public/ponts/" + p.fichier, "utf8")));
}

/** Construit grille et ponts d'un site comme l'application. */
export function construire(nuage, R, mods = { g, m, pm }) {
  const { g, m, pm } = mods, { E0, N0 } = nuage.meta, t0 = performance.now();
  const G = g.depuisPoints(nuage, R);
  if (G.eau) for (let p = 0; p < G.sol.length; p++) if (!isNaN(G.eau[p]) && !(G.sol[p] < G.eau[p] - 0.1)) G.sol[p] = G.eau[p] - 0.3;
  const modeles = modelesAutour(E0, N0, R);
  // nouvelle interface : modèles calculés avant la coupe au cercle (profil gravé dans le sol)
  if (m.modeliserPonts) m.modeliserPonts(G, nuage, modeles, { E: E0, N: N0 });
  g.garderCercle(G, R);
  const tG = performance.now() - t0, zRef = g.solEn(G, 0, 0);
  const t1 = performance.now();
  let dessus = [], cotes = [], infos = [], dessusModeles = [], cotesModeles = [];
  if (m.maillagesPonts) {
    const r = m.maillagesPonts(G, zRef, nuage, modeles, { E: E0, N: N0 });
    if (r) { dessus = r.dessus; cotes = r.cotes; infos = r.infos || []; dessusModeles = r.dessusModeles || []; cotesModeles = r.cotesModeles || []; }
  } else {
    let Gp = G;
    if (modeles.length && G.pont) {
      const pont = G.pont.slice();
      for (let j = 0; j < G.n; j++) for (let i = 0; i < G.n; i++) {
        const p = j * G.n + i;
        if (!isNaN(pont[p]) && modeles.some(P => pm.dansPont(P, E0, N0, G.x0 + (i + 0.5) * G.c, G.x0 + (j + 0.5) * G.c))) pont[p] = NaN;
      }
      Gp = { ...G, pont };
    }
    const gp = m.pontsLegers(Gp, zRef, nuage) || m.tabliersPonts(Gp, zRef);
    if (gp) { dessus.push(gp.dessus); cotes.push(gp.cotes); infos = gp.dessus.userData.ponts || []; }
    for (const P of modeles) {
      const r = pm.maillagePont(P, E0, N0, zRef, (x, y) => g.solEn(G, Math.max(-G.R, Math.min(G.R, x)), Math.max(-G.R, Math.min(G.R, y))), (x, y) => [(x - G.x0) / (2 * G.R), (y - G.x0) / (2 * G.R)]);
      dessusModeles.push(r.dessus); cotesModeles.push(r.reste);
    }
    G.pontAuto = Gp.pont;
  }
  const tP = performance.now() - t1;
  // chaussées coupées au cercle, comme dans la scène
  const brut = { dessus: [...dessus], dessusModeles: [...dessusModeles] };
  if (G.rayonZone) { dessus = dessus.map(x => m.decouperCercle(x.clone(), G.rayonZone - 0.03)); dessusModeles = dessusModeles.map(x => m.decouperCercle(x.clone(), G.rayonZone - 0.03)); }
  return { G, zRef, modeles, dessus, cotes, dessusModeles, cotesModeles, infos, brut, tG, tP };
}

/* ------------------------------------------------------------------ outils de mesure */
/** Triangles (repère plan : x est, y nord, z altitude relative) rangés par cases de 4 m. */
export function indexer(geoms) {
  const T = [], cases = new Map();
  for (const geo of geoms) {
    const pos = geo.attributes.position, idx = geo.index, nt = (idx ? idx.count : pos.count) / 3;
    for (let t = 0; t < nt; t++) {
      const v = [0, 1, 2].map(k => { const i = idx ? idx.getX(3 * t + k) : 3 * t + k; return [pos.getX(i), -pos.getZ(i), pos.getY(i)]; });
      const [a, b, c] = v, aire2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const tri = { v, haut: aire2 > 0, aire2 };
      T.push(tri);
      if (Math.abs(aire2) < 1e-9) continue;
      const i0 = Math.floor(Math.min(a[0], b[0], c[0]) / 4), i1 = Math.floor(Math.max(a[0], b[0], c[0]) / 4), j0 = Math.floor(Math.min(a[1], b[1], c[1]) / 4), j1 = Math.floor(Math.max(a[1], b[1], c[1]) / 4);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = i + "," + j; (cases.get(k) || cases.set(k, []).get(k)).push(tri); }
    }
  }
  return { T, cases };
}
/** Hauteur de la plus haute face tournée vers le haut (haut) et de la plus haute face (tout) à la verticale de (x, y). */
export function lire(I, x, y) {
  let haut = NaN, tout = NaN;
  for (const t of I.cases.get(Math.floor(x / 4) + "," + Math.floor(y / 4)) || []) {
    const [a, b, c] = t.v, w1 = ((b[0] - x) * (c[1] - y) - (b[1] - y) * (c[0] - x)) / t.aire2, w2 = ((c[0] - x) * (a[1] - y) - (c[1] - y) * (a[0] - x)) / t.aire2, w3 = 1 - w1 - w2;
    if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
    const z = w1 * a[2] + w2 * b[2] + w3 * c[2];
    if (!(tout >= z)) tout = z;
    if (t.haut && !(haut >= z)) haut = z;
  }
  return { haut, tout };
}
/** Terrain affiché (triangles d'un mètre), altitude absolue. */
export function solAffiche(G, x, y) {
  const pas = 2 * G.c, a = Math.floor((x - G.x0) / pas), b = Math.floor((y - G.x0) / pas), u = (x - G.x0) / pas - a, v = (y - G.x0) / pas - b;
  const z = (i, j) => g.solEn(G, G.x0 + i * pas, G.x0 + j * pas), z00 = z(a, b), z11 = z(a + 1, b + 1);
  return u >= v ? z00 + u * (z(a + 1, b) - z00) + v * (z11 - z(a + 1, b)) : z00 + u * (z11 - z(a, b + 1)) + v * (z(a, b + 1) - z00);
}
/** Composantes connexes des cases de tablier à plus d'un mètre du sol (≥ 20 m²), comme pontsLegers. */
export function composantes(G, pont = G.pontAuto || G.pont) {
  const { n, c, x0, sol } = G, vu = new Uint8Array(n * n), out = [];
  if (!pont) return out;
  for (let p = 0; p < n * n; p++) if (!isNaN(pont[p]) && !(pont[p] - sol[p] > 1)) vu[p] = 1;
  for (let p0 = 0; p0 < n * n; p0++) {
    if (vu[p0] || isNaN(pont[p0])) continue;
    const cel = [], pile = [p0]; vu[p0] = 1;
    while (pile.length) { const p = pile.pop(), i = p % n; cel.push(p); for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n]) if (q >= 0 && q < n * n && !vu[q] && !isNaN(pont[q])) { vu[q] = 1; pile.push(q); } }
    if (cel.length * c * c < 20) continue;
    let sx = 0, sy = 0; const h = [], zs = [];
    for (const p of cel) { sx += x0 + (p % n + 0.5) * c; sy += x0 + (Math.floor(p / n) + 0.5) * c; h.push(pont[p] - sol[p]); zs.push(pont[p]); }
    h.sort((a, b) => a - b); zs.sort((a, b) => a - b);
    const mx = sx / cel.length, my = sy / cel.length;
    let sxx = 0, syy = 0, sxy = 0, ext = 0;
    for (const p of cel) { const x = x0 + (p % n + 0.5) * c - mx, y = x0 + (Math.floor(p / n) + 0.5) * c - my; sxx += x * x; syy += y * y; sxy += x * y; ext = Math.max(ext, Math.hypot(x, y)); }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    out.push({ x: +mx.toFixed(1), y: +my.toFixed(1), aire: Math.round(cel.length * c * c), hMed: +h[h.length >> 1].toFixed(2), zMed: +zs[zs.length >> 1].toFixed(2), az: +(90 - ang * 180 / Math.PI).toFixed(1), ext: +(2 * ext).toFixed(0), cel });
  }
  return out.sort((a, b) => b.aire - a.aire);
}
const quant = (a, f) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : NaN;
const cm = v => v == null || isNaN(v) ? null : Math.round(v * 100);

/** Plis de la chaussée : angle entre les faces du dessus qui partagent une arête (°). */
function plis(geoms) {
  const aretes = new Map(), cle = v => `${Math.round(v[0] * 500)},${Math.round(v[1] * 500)},${Math.round(v[2] * 500)}`;
  for (const geo of geoms) {
    const pos = geo.attributes.position, nt = pos.count / 3;
    for (let t = 0; t < nt; t++) {
      const v = [0, 1, 2].map(k => [pos.getX(3 * t + k), pos.getY(3 * t + k), pos.getZ(3 * t + k)]);
      const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      let N = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...N);
      if (l < 1e-6) continue;
      N = N.map(x => x / l);
      if (N[1] <= 0.2) continue; // faces du dessus seulement
      const k = v.map(cle);
      for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3], id = a < b ? a + "|" + b : b + "|" + a; (aretes.get(id) || aretes.set(id, []).get(id)).push({ N, m: [(v[e][0] + v[(e + 1) % 3][0]) / 2, (v[e][2] + v[(e + 1) % 3][2]) / 2] }); }
    }
  }
  const out = [];
  for (const L of aretes.values()) if (L.length === 2) { const d = Math.max(-1, Math.min(1, L[0].N[0] * L[1].N[0] + L[0].N[1] * L[1].N[1] + L[0].N[2] * L[1].N[2])); out.push({ a: Math.acos(d) * 180 / Math.PI, x: L[0].m[0], y: -L[0].m[1] }); }
  return out;
}

/** Longueur (m) des arêtes libres d'un solide (dessus + côtés) : 0 si fermé. Sommets soudés à 2 mm. */
function bordsOuverts(geoms) {
  const aretes = new Map(), cle = v => `${Math.round(v[0] * 500)},${Math.round(v[1] * 500)},${Math.round(v[2] * 500)}`;
  for (const geo of geoms) {
    const pos = geo.attributes.position, nt = pos.count / 3;
    for (let t = 0; t < nt; t++) {
      const v = [0, 1, 2].map(k => [pos.getX(3 * t + k), pos.getY(3 * t + k), pos.getZ(3 * t + k)]), k = v.map(cle);
      if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
      for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3], id = a < b ? a + "|" + b : b + "|" + a, A = aretes.get(id); if (A) A.n++; else aretes.set(id, { n: 1, l: Math.hypot(v[e][0] - v[(e + 1) % 3][0], v[e][1] - v[(e + 1) % 3][1], v[e][2] - v[(e + 1) % 3][2]), p: [(v[e][0] + v[(e + 1) % 3][0]) / 2, -(v[e][2] + v[(e + 1) % 3][2]) / 2, (v[e][1] + v[(e + 1) % 3][1]) / 2] }); }
    }
  }
  let l = 0; const ou = [];
  for (const A of aretes.values()) if (A.n === 1) { l += A.l; ou.push(A); }
  return { l, ou };
}

/** Mesures d'un site construit. `refs` : ponts de référence (axes et bouts) pour les zones de raccord. */
export function mesurer(S, refs = null) {
  const { G, zRef, dessus, cotes, dessusModeles, cotesModeles, infos, brut } = S, { n, c, x0 } = G, pont = G.pontAuto || G.pont;
  const I = indexer(dessus), IM = indexer(dessusModeles), Rz = (G.rayonZone || 1e9) - 1;
  let bas = 0, tot = 0;
  for (const t of I.T) { if (Math.abs(t.aire2) < 1e-6) continue; tot++; if (!t.haut) bas++; }
  const comps = composantes(G, pont), res = [];
  // intérieur d'une composante : cases dont les 8 voisines à 1 m sont dans la composante
  for (const C of comps) {
    const dans = new Set(C.cel), r = Math.round(1 / c);
    let nb = 0, couvert = 0, nbInt = 0, couvertInt = 0, terrainDessus = 0, creux = 0; const dz = [];
    for (const p of C.cel) {
      const i = p % n, j = Math.floor(p / n), x = x0 + (i + 0.5) * c, y = x0 + (j + 0.5) * c;
      if (Math.hypot(x, y) > Rz) continue;
      nb++;
      let int = true;
      for (const [a, b] of [[-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, r], [-r, r], [r, -r]]) if (!dans.has((j + b) * n + i + a)) { int = false; break; }
      const h = lire(I, x, y).haut;
      if (int) nbInt++;
      if (isNaN(h)) continue;
      couvert++; if (int) couvertInt++;
      const d = h - (pont[p] - zRef);
      dz.push(d);
      if (int && d < -0.15) creux++;
      if (g.solEn(G, x, y) - zRef > h + 0.05) terrainDessus++;
    }
    dz.sort((a, b) => a - b);
    const abs = dz.map(Math.abs).sort((a, b) => a - b);
    // modèle correspondant (le plus proche du centre de la composante)
    let inf = null, dm = 30;
    for (const i of infos) { const d = Math.hypot(i.x - C.x, i.y - C.y); if (d < dm) { dm = d; inf = i; } }
    res.push({ x: C.x, y: C.y, aire: C.aire, hMed: C.hMed, z: +(C.zMed - zRef).toFixed(2), az: C.az, ext: C.ext, cases: nb, couvert: nb ? +(100 * couvert / nb).toFixed(1) : null, couvertInt: nbInt ? +(100 * couvertInt / nbInt).toFixed(1) : null, trous: nbInt - couvertInt, creux,
      ecartMed: cm(quant(abs, 0.5)), ecart95: cm(quant(abs, 0.95)), dz05: cm(quant(dz, 0.05)), dz95: cm(quant(dz, 0.95)), terrainDessus,
      iou: inf?.iou ?? null, ecartModele: inf?.ecart ?? null, repli: !!inf?.repli, joints: inf?.joints ?? null, libre: inf?.libre ?? null, sections: inf?.sections ?? null, longueur: inf?.longueur ?? null, largeur: inf?.largeur ?? null, piles: inf?.piles ?? null, type: inf?.type ?? null });
  }
  // raccords : surface visible (terrain ou chaussée) le long de lignes parallèles à l'axe, de part et d'autre de chaque bout
  const raccords = [];
  const visible = (x, y) => { const t = solAffiche(G, x, y) - zRef, h = Math.max(lire(I, x, y).haut || -Infinity, lire(IM, x, y).haut || -Infinity); return { t, h: h === -Infinity ? NaN : h, v: Math.max(t, h === -Infinity ? -Infinity : h) }; };
  for (const R of refs || []) {
    if (!R.dbg) continue;
    const { axe, cum, s0, s1, mil, lar } = R.dbg;
    const surAxe = s => { let i = 0; while (i < axe.length - 2 && cum[i + 1] < s) i++; const [ax, ay] = axe[i], [bx, by] = axe[i + 1], L = cum[i + 1] - cum[i] || 1, u = (s - cum[i]) / L, dx = (bx - ax) / L, dy = (by - ay) / L; return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, nx: -dy, ny: dx }; };
    for (const b of [0, 1]) {
      if (R.libre?.[b]) continue;
      const sb = b ? s1 : s0, sens = b ? 1 : -1;
      let marche = 0, bosse = 0, depasse = 0, nDep = 0, nTot = 0, ou = null;
      for (const f of [-0.3, 0, 0.3]) {
        const t = mil[b] + f * lar[b], V = [], H = [], Tn = [], SS = [];
        const jr = Math.abs((R.dbg.joint?.[b] ?? sb) - sb);
        for (let e = -8; e <= Math.min(22, jr + 8); e += 0.25) {
          const A = surAxe(sb + sens * e), x = A.x + A.nx * t, y = A.y + A.ny * t;
          if (Math.hypot(x, y) > Rz - 1) { V.push(NaN); H.push(NaN); Tn.push(NaN); SS.push(e); continue; }
          const r = visible(x, y); V.push(r.v); H.push(r.h); Tn.push(r.t); SS.push(e);
        }
        for (let k = 1; k < V.length - 1; k++) {
          if (isNaN(V[k - 1]) || isNaN(V[k]) || isNaN(V[k + 1])) continue;
          const j = Math.abs(V[k + 1] - 2 * V[k] + V[k - 1]);
          if (j > marche) { marche = j; ou = [SS[k], f]; }
        }
        // bosse : écart à la moyenne glissante sur ±1,5 m
        for (let k = 6; k < V.length - 6; k++) {
          let s = 0, q = 0;
          for (let d = -6; d <= 6; d++) if (!isNaN(V[k + d])) { s += V[k + d]; q++; }
          if (q === 13 && !isNaN(V[k])) bosse = Math.max(bosse, Math.abs(V[k] - s / q));
        }
        for (let k = 0; k < V.length; k++) if (!isNaN(H[k])) { nTot++; if (Tn[k] > H[k] + 0.005) { nDep++; depasse = Math.max(depasse, Tn[k] - H[k]); } }
      }
      raccords.push({ pont: [R.x, R.y], bout: b, marche: cm(marche), bosse: cm(bosse), depasse: cm(depasse), partTerrain: nTot ? Math.round(100 * nDep / nTot) : null, ou });
    }
  }
  const P = plis(brut.dessus).sort((a, b) => b.a - a.a), PM = plis(brut.dessusModeles).sort((a, b) => b.a - a.a);
  const ouverts = bordsOuverts([...brut.dessus, ...cotes]), ouvertsM = bordsOuverts([...brut.dessusModeles, ...cotesModeles]);
  return { triDessus: tot, triVersLeBas: bas, triCotes: cotes.reduce((s, o) => s + o.attributes.position.count / 3, 0), triModeles: [...dessusModeles, ...cotesModeles].reduce((s, o) => s + o.attributes.position.count / 3, 0),
    pliMax: P.length ? +P[0].a.toFixed(1) : 0, plis3: P.filter(p => p.a > 3).length, pliOu: P.slice(0, 3).map(p => [+p.x.toFixed(1), +p.y.toFixed(1), +p.a.toFixed(1)]),
    pliMaxModeles: PM.length ? +PM[0].a.toFixed(1) : 0,
    ouverts: +ouverts.l.toFixed(1), ouvertsModeles: +ouvertsM.l.toFixed(1), ponts: res, raccords, infos: infos.map(i => ({ ...i, dbg: undefined })) };
}

if (process.argv[1].endsWith("banc.mjs")) {
  const liste = (noms.length ? noms : Object.keys(SITES)).flatMap(a => { const [nom, r] = a.split("@"); return (r ? [+r] : SITES[nom].rayons).map(R => [nom, R]); });
  for (const [nom, rayon] of liste) {
    const R = Math.min(rayon, 300), N = rogner(await nuageSite(nom), R);
    let S;
    try { S = construire(N, R); } catch (e) { console.log(`== ${nom}@${rayon} ERREUR ${e.stack}`); continue; }
    const fRef = [SORTIE, REFERENCE].map(d => `${d}/${ref}-${nom}-${R}.ref.json`).find(f => existsSync(f)) || `${SORTIE}/${ref}-${nom}-${R}.ref.json`;
    // référence : les axes et bouts de cette version si elle les expose (dbg), sinon ceux de l'étiquette de référence
    if (etiq === ref || !existsSync(fRef)) { if (S.infos.some(i => i.dbg)) writeFileSync(`${SORTIE}/${etiq}-${nom}-${R}.ref.json`, JSON.stringify(S.infos.filter(i => i.dbg))); }
    const refs = existsSync(fRef) ? JSON.parse(readFileSync(fRef, "utf8")) : S.infos.filter(i => i.dbg);
    const M = mesurer(S, refs);
    writeFileSync(`${SORTIE}/${etiq}-${nom}-${R}.json`, JSON.stringify({ site: nom, R, centre: [N.meta.E0, N.meta.N0], ms: [Math.round(S.tG), Math.round(S.tP)], ...M }, null, 1));
    console.log(`== ${nom}@${R} grille ${Math.round(S.tG)} ms, ponts ${Math.round(S.tP)} ms | dessus ${M.triDessus} tri (vers le bas ${M.triVersLeBas}), côtés ${M.triCotes}, modèles ${M.triModeles} | pli max ${M.pliMax}° (${M.plis3} > 3°) ${JSON.stringify(M.pliOu)} | bords ouverts ${M.ouverts} m (modèles ${M.ouvertsModeles} m)`);
    for (const p of M.ponts) console.log("  pont", JSON.stringify(p));
    for (const r of M.raccords) console.log("  raccord", JSON.stringify(r));
  }
}
