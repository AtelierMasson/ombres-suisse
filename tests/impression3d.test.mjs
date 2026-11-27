// Contrôle de l'impression 3D sans navigateur : npm test (node --test tests/*.test.mjs)
// Sur des lieux d'essai (tests/impression3dLieux.mjs) et chaque jeu de bâtiments, vérifie que chaque solide est
// fermé et orientable (arêtes à deux faces de sens opposés, aucun sommet en papillon, volume positif : normales vers
// l'extérieur), sans triangle dégénéré, sans surplomb, murs verticaux, tout dans sa tuile, joints de tuiles plans et
// jointifs, STL binaire valide. IMPR_LIEU=ville node --test tests/impression3d.test.mjs : un seul lieu.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerImpression, stlBinaire, controler, contenuZip } from "../src/impression3d.js";
import { contoursBatiments } from "../src/contours.js";
import { toitsReleve, toitsObjets } from "../src/impression3dToits.js";
import { LIEUX, maillageBatiments } from "./impression3dLieux.mjs";

const ZREF = 400;

/** Lots de toits d'un jeu de bâtiments, comme les prépare pro.js. */
function lots(G, B, jeu) {
  if (jeu === "aucun") return [];
  if (jeu === "releve") return [toitsReleve(G, contoursBatiments(G))];
  const m = maillageBatiments(G, B, ZREF), demi = G.R + 30;
  if (jeu === "swiss") return [{ ...toitsObjets([m], ZREF, { murs: true, limite: demi }), rogner: true }];
  return [toitsObjets([m], ZREF, { limite: demi })]; // Advanced : toits sans débord, pas de rognage
}

/**
 * Défauts d'un solide (triangles t0..t1 de la tuile). Renvoie une liste de messages (vide si le solide est bon).
 * `boite` [x0, y0, x1, y1] (mm) : la tuile ; `rond` : rayon de la maquette ronde (mm, centre à l'origine) ou 0.
 */
function defauts(tu, s, boite, rond) {
  const P = tu.pos, I = tu.idx, d = [], e = 0.005;
  const { ouvertes, malOrientees } = controler(I, s.t0, s.t1, s.v0, s.v1 - s.v0);
  if (ouvertes) d.push(`${ouvertes} arêtes ouvertes ou non-variétés`);
  if (malOrientees) d.push(`${malOrientees} arêtes mal orientées`);
  let vol = 0, degeneres = 0, surplombs = 0, mursObliques = 0, zmin = Infinity, hors = 0;
  for (let v = s.v0; v < s.v1; v++) {
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
    zmin = Math.min(zmin, z);
    if (x < boite[0] - e || x > boite[2] + e || y < boite[1] - e || y > boite[3] + e || z < -e || (rond && Math.hypot(x, y) > rond + e)) hors++;
  }
  for (let t = s.t0; t < s.t1; t++) {
    const a = 3 * I[3 * t], b = 3 * I[3 * t + 1], c = 3 * I[3 * t + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, n2 = Math.hypot(nx, ny, nz);
    const lmax = Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(ux - wx, uy - wy, uz - wz));
    // dégénéré : aire nulle, ou hauteur sous 0,1 µm (le trancheur ne sait pas l'orienter)
    if (!(n2 > 0) || n2 / (lmax || 1) < 1e-4) degeneres++;
    vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
    // face tournée vers le bas au-dessus du fond : surplomb ; face presque verticale mais pas tout à fait : mur oblique
    const zMax = Math.max(P[a + 2], P[b + 2], P[c + 2]);
    if (n2 > 0 && nz < -0.02 * n2 && zMax > zmin + 0.4) surplombs++;
    if (s.type !== "terrain" && n2 > 0 && Math.abs(nz) > 1e-9 * n2 && Math.abs(nz) < 0.02 * n2 && n2 / lmax > 1e-3) mursObliques++;
  }
  // papillons : autour d'un sommet, ses triangles forment un seul éventail (reliés par des arêtes qui le touchent)
  const autour = new Map();
  for (let t = s.t0; t < s.t1; t++) for (let k = 0; k < 3; k++) { const v = I[3 * t + k]; let L = autour.get(v); if (!L) autour.set(v, L = []); L.push(t); }
  let papillons = 0;
  for (const [v, L] of autour) {
    const voisins = L.map(t => [0, 1, 2].map(k => I[3 * t + k]).filter(w => w !== v));
    const pere = L.map((_, i) => i), r = i => { while (pere[i] !== i) i = pere[i] = pere[pere[i]]; return i; }, premier = new Map();
    voisins.forEach((ws, i) => ws.forEach(w => { const j = premier.get(w); if (j === undefined) premier.set(w, i); else pere[r(i)] = r(j); }));
    if (new Set(L.map((_, i) => r(i))).size > 1) papillons++;
  }
  if (papillons) d.push(`${papillons} sommets en papillon`);
  if (!(vol > 0)) d.push(`volume ${vol.toFixed(3)} mm³ (normales vers l'intérieur ?)`);
  if (degeneres) d.push(`${degeneres} triangles dégénérés`);
  if (surplombs) d.push(`${surplombs} faces en surplomb`);
  if (mursObliques) d.push(`${mursObliques} murs presque verticaux`);
  if (hors) d.push(`${hors} sommets hors de la tuile`);
  return d;
}

/** Faces de joint du terrain : triangles verticaux d'une tuile posés sur la droite x = X (ou y = Y). Aire (mm²). */
function aireJoint(tu, s, axe, val) {
  const P = tu.pos, I = tu.idx;
  let aire = 0, horsPlan = 0;
  for (let t = s.t0; t < s.t1; t++) {
    const v = [0, 1, 2].map(k => 3 * I[3 * t + k] + axe);
    const sur = v.filter(q => Math.abs(P[q] - val) < 1e-3).length;
    if (sur === 3) {
      const [a, b, c] = v.map(q => q - axe), o = 1 - axe;
      aire += Math.abs((P[b + o] - P[a + o]) * (P[c + 2] - P[a + 2]) - (P[c + o] - P[a + o]) * (P[b + 2] - P[a + 2])) / 2;
    }
  }
  return { aire, horsPlan };
}

/** Relit un STL binaire : nombre de triangles, taille, normales unitaires cohérentes avec l'ordre des sommets. */
function lireStl(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = dv.getUint32(80, true);
  assert.equal(u8.byteLength, 84 + 50 * n, "taille du STL");
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, faux = 0;
  for (let t = 0, o = 84; t < n; t++, o += 50) {
    const f = k => dv.getFloat32(o + 4 * k, true), N = [f(0), f(1), f(2)], V = [3, 6, 9].map(k => [f(k), f(k + 1), f(k + 2)]);
    for (const [x, y, z] of V) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const u = V[1].map((q, k) => q - V[0][k]), w = V[2].map((q, k) => q - V[0][k]), c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...c);
    if (Math.abs(Math.hypot(...N) - 1) > 1e-3 || (l > 1e-9 && N[0] * c[0] + N[1] * c[1] + N[2] * c[2] < 0)) faux++;
    if (dv.getUint16(o + 48, true) !== 0) faux++;
  }
  return { n, boite: [x0, y0, z0, x1, y1, z1], faux };
}

const lieux = process.env.IMPR_LIEU ? process.env.IMPR_LIEU.split(",") : Object.keys(LIEUX);
const donnees = Object.fromEntries(lieux.map(k => [k, LIEUX[k]()]));

for (const lieu of lieux) for (const jeu of ["releve", "swiss", "roofer", "aucun"]) {
  test(`${lieu} · ${jeu} : solides fermés, sans défaut`, () => {
    const { G, B } = donnees[lieu], d = { G, lots: lots(G, B, jeu) };
    const arbres = lieu === "foret" ? "isoles" : "masses";
    for (const o of [
      { taille: 200, decoupe: 1, arbres },
      { taille: 400, decoupe: 2, arbres: lieu === "foret" ? "masses" : "aucun", exag: 1.5, finesse: "rapide" },
      { taille: 100, decoupe: 3, arbres: "masses", exag: 3, socle: 2, finesse: "fine", eau: false },
    ]) {
      const r = calculerImpression(d, { socle: 3, finesse: "normale", min: 0.8, ...o }), N = o.decoupe, cote = o.taille / N;
      assert.equal(r.tuiles.length, N * N);
      assert.ok(r.infos.etanche, `${r.infos.ouvertes} arêtes à corriger`);
      if (jeu !== "aucun") assert.ok(r.infos.batiments > 0, "aucun bâtiment");
      for (const tu of r.tuiles) {
        const ci = tu.colonne - 1, lj = N - tu.ligne, boite = [-o.taille / 2 + ci * cote, -o.taille / 2 + lj * cote, -o.taille / 2 + (ci + 1) * cote, -o.taille / 2 + (lj + 1) * cote];
        for (const s of tu.solides) assert.deepEqual(defauts(tu, s, boite, 0), [], `${s.type} (L${tu.ligne}C${tu.colonne}, triangles ${s.t0}–${s.t1})`);
        const terrain = tu.solides.find(s => s.type === "terrain");
        assert.ok(terrain && terrain.t0 === 0, "le terrain vient d'abord");
        // la tuile remplit exactement sa case
        assert.ok(Math.abs(tu.origine[0] - boite[0]) < 1e-3 && Math.abs(tu.origine[1] - boite[1]) < 1e-3, "coin de la tuile");
        // STL : relu, ramené à l'origine, en mm
        const stl = lireStl(stlBinaire(tu.pos, tu.idx, "essai", tu.origine));
        assert.equal(stl.n, tu.idx.length / 3);
        assert.equal(stl.faux, 0, "normales du STL");
        assert.ok(Math.abs(stl.boite[0]) < 1e-3 && Math.abs(stl.boite[1]) < 1e-3 && Math.abs(stl.boite[2]) < 1e-3, "STL posé à l'origine");
        assert.ok(Math.abs(stl.boite[3] - cote) < 1e-2 && Math.abs(stl.boite[4] - cote) < 1e-2, "STL à la taille");
      }
      // joints : les deux faces d'un joint ont la même aire (même profil, au maillage près), la tuile voisine commence où l'autre finit
      if (N > 1) for (const tu of r.tuiles) {
        const est = r.tuiles.find(q => q.ligne === tu.ligne && q.colonne === tu.colonne + 1);
        if (!est) continue;
        const X = tu.origine[0] + cote, a = aireJoint(tu, tu.solides[0], 0, X).aire, b = aireJoint(est, est.solides[0], 0, X).aire;
        assert.ok(a > 0 && Math.abs(a - b) <= 0.01 * a + 0.5, `joint L${tu.ligne}C${tu.colonne}|C${tu.colonne + 1} : ${a.toFixed(1)} / ${b.toFixed(1)} mm²`);
      }
    }
  });
}

test("maquette ronde : terrain et bâtiments dans le cercle, découpe en tuiles", () => {
  const { G, B } = LIEUX.ville();
  G.rayonZone = 70;
  for (const jeu of ["releve", "swiss"]) for (const N of [1, 3]) {
    const r = calculerImpression({ G, lots: lots(G, B, jeu) }, { taille: 300, decoupe: N, arbres: "masses" }), cote = 300 / N;
    assert.ok(r.infos.etanche);
    for (const tu of r.tuiles) {
      const ci = tu.colonne - 1, lj = N - tu.ligne, boite = [-150 + ci * cote, -150 + lj * cote, -150 + (ci + 1) * cote, -150 + (lj + 1) * cote];
      for (const s of tu.solides) assert.deepEqual(defauts(tu, s, boite, 150), [], `${jeu} ${N}×${N} ${s.type} L${tu.ligne}C${tu.colonne}`);
    }
  }
});

test("zip des tuiles : noms, contenu et LISEZ-MOI", () => {
  const { G, B } = LIEUX.pente();
  const o = { taille: 300, decoupe: 2 }, r = calculerImpression({ G, lots: lots(G, B, "releve") }, o);
  const z = contenuZip(r, o, { nom: (c, ext) => `essai_${c}.${ext}`, lisezMoi: q => `LISEZ-MOI ${q.n} ${q.cote} ${q.echelle}` });
  const noms = Object.keys(z).sort();
  assert.deepEqual(noms, ["LISEZ-MOI.txt", ...["L1C1", "L1C2", "L2C1", "L2C2"].map(k => `essai_impression3d-300mm-1-${Math.round(r.infos.echelle)}_${k}.stl`)].sort());
  for (const k of noms) if (k.endsWith(".stl")) assert.equal(lireStl(z[k][0]).faux, 0);
  assert.match(new TextDecoder().decode(z["LISEZ-MOI.txt"]), /^LISEZ-MOI 2 150 /);
});

test("STL binaire : en-tête, normales et origine", () => {
  const pos = new Float32Array([10, 10, 0, 11, 10, 0, 10, 11, 0, 10, 10, 1]), idx = new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]);
  const u8 = stlBinaire(pos, idx, "Topograph STL mm", [10, 10]), s = lireStl(u8);
  assert.equal(s.n, 4); assert.equal(s.faux, 0);
  assert.deepEqual(s.boite, [0, 0, 0, 1, 1, 1]);
  assert.equal(new TextDecoder().decode(u8.subarray(0, 16)), "Topograph STL mm");
  assert.notEqual(new TextDecoder().decode(u8.subarray(0, 5)), "solid", "un STL binaire ne commence pas par « solid »");
});

test("pied des bâtiments sous le point le plus bas du terrain de toute l'emprise (creux sous un grand toit)", () => {
  const n = 160, c = 0.5, G = { n, c, R: 40, x0: -40, sol: new Float32Array(n * n), bat: new Float32Array(n * n).fill(NaN), veg: new Float32Array(n * n).fill(NaN), classifie: true };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -40 + (i + 0.5) * c, y = -40 + (j + 0.5) * c, p = j * n + i;
    G.sol[p] = Math.hypot(x, y) < 4 ? 498 : 500; // creux de 2 m au centre
    if (Math.abs(x) < 15 && Math.abs(y) < 15) G.bat[p] = 512;
  }
  for (const jeu of ["releve", "swiss"]) {
    const r = calculerImpression({ G, lots: lots(G, [{ x0: -15, y0: -15, x1: 15, y1: 15, h: 12 }], jeu) }, { taille: 200, socle: 3 }), tu = r.tuiles[0];
    const b = tu.solides.find(s => s.type === "batiment");
    let z = Infinity;
    for (let v = b.v0; v < b.v1; v++) z = Math.min(z, tu.pos[3 * v + 2]);
    assert.ok(z <= 3 - 0.99, `${jeu} : pied à ${z.toFixed(2)} mm, creux à 3 mm`);
  }
});

test("éléments trop fins à l'échelle : cabanon retiré en petit, gardés en grand", () => {
  const { G, B } = LIEUX.ville(), d = { G, lots: lots(G, B, "releve") };
  const petit = calculerImpression(d, { taille: 100 }), grand = calculerImpression(d, { taille: 400 });
  assert.ok(petit.infos.fins >= 1, `${petit.infos.fins} retirés à 1:${Math.round(petit.infos.echelle)}`);
  assert.equal(grand.infos.fins, 0);
  assert.ok(grand.infos.batiments > petit.infos.batiments);
});
