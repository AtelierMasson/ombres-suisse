// Lieux d'essai synthétiques pour l'impression 3D (tests/impression3d.test.mjs) : grilles de 0,5 m comme celles de
// grille.js (sol, bâtiments, végétation, eau, ponts) et toits en maillages comme ceux de swisstopo ou d'Advanced.
// Chaque lieu reprend une difficulté rencontrée sur le terrain : ville dense (cours, volumes accolés, cheminées,
// bâtiments à cheval sur les joints et le bord), forte pente (mur de soutènement), bord de lac, pont, forêt.
import * as THREE from "three";

/** Grille vide de demi-côté R (m), comme grilleVide (grille.js), avec eau et ponts. */
function grille(R, c = 0.5) {
  const n = Math.round(2 * R / c), g = () => new Float32Array(n * n).fill(NaN);
  return { n, c, R, x0: -R, sol: g(), bat: g(), veg: g(), eau: g(), pont: g(), classifie: true };
}
const parCellule = (G, f) => { for (let j = 0; j < G.n; j++) for (let i = 0; i < G.n; i++) f(j * G.n + i, G.x0 + (i + 0.5) * G.c, G.x0 + (j + 0.5) * G.c); };

/**
 * Bâtiments décrits par des rectangles { x0, y0, x1, y1, h (hauteur au-dessus du sol au faîte), gouttiere (hauteur
 * aux gouttières, toit à deux pans selon x ; facultatif), trou: [x0, y0, x1, y1] (cour) }.
 */
function batir(G, B) {
  parCellule(G, (p, x, y) => {
    for (const b of B) {
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      if (b.trou && x > b.trou[0] && x < b.trou[2] && y > b.trou[1] && y < b.trou[3]) continue;
      let h = b.h;
      if (b.gouttiere !== undefined) { const ym = (b.y0 + b.y1) / 2, d = Math.abs(y - ym) / ((b.y1 - b.y0) / 2); h = b.h - (b.h - b.gouttiere) * d; }
      const z = (b.base ?? G.sol[p]) + h;
      if (!(G.bat[p] >= z)) G.bat[p] = z;
    }
  });
}

/** Ville dense : faible pente, îlot à cour, volumes accolés, toits à deux pans, cheminée, cabanon, bâtiments au bord. */
function ville() {
  const G = grille(80);
  parCellule(G, (p, x, y) => { G.sol[p] = 450 + 0.03 * x + 0.01 * y + 0.2 * Math.sin(x / 7) * Math.cos(y / 9); });
  const B = [
    { x0: -60, y0: -60, x1: -30, y1: -30, h: 15, trou: [-50, -50, -40, -40] },       // îlot à cour
    { x0: -20, y0: -60, x1: -10, y1: -50, h: 9 }, { x0: -10, y0: -60, x1: 0, y1: -50, h: 14 }, // volumes accolés
    { x0: 10, y0: -40, x1: 26, y1: -30, h: 12, gouttiere: 8 },                       // deux pans
    { x0: 30, y0: 10, x1: 50, y1: 22, h: 11 }, { x0: 39, y0: 15, x1: 39.6, y1: 15.6, h: 13 }, // cheminée
    { x0: -5, y0: 5, x1: 5, y1: 25, h: 18, gouttiere: 13 },                           // à cheval sur le joint x = 0
    { x0: 55, y0: -10, x1: 95, y1: 10, h: 10 },                                       // coupé par le bord
    { x0: -45, y0: 30, x1: -44, y1: 31.5, h: 2.5 },                                   // cabanon
    { x0: -40, y0: 40, x1: -20, y1: 60, h: 21 }, { x0: -32, y0: 46, x1: -28, y1: 52, h: 24 }, // attique
  ];
  batir(G, B);
  return { G, B };
}

/** Forte pente (60 %) avec un mur de soutènement de 3 m et des maisons posées sur la pente. */
function pente() {
  const G = grille(60);
  parCellule(G, (p, x, y) => { G.sol[p] = 800 + 0.6 * y + (x > 15 ? 3 : 0) + 0.05 * x; });
  const B = [{ x0: -30, y0: -20, x1: -15, y1: -8, h: 9, gouttiere: 6 }, { x0: 20, y0: 0, x1: 32, y1: 10, h: 7 }, { x0: -10, y0: 20, x1: 4, y1: 32, h: 12 }];
  batir(G, B);
  return { G, B };
}

/** Bord de lac : la moitié ouest sous l'eau (niveau 372), rive en pente, quai bâti. */
function lac() {
  const G = grille(70);
  parCellule(G, (p, x, y) => {
    const s = 372.5 + 0.08 * x + 0.3 * Math.sin(y / 11);
    G.sol[p] = x < -5 ? Math.min(s, 372 - 0.12 * (-5 - x)) : s;
    if (G.sol[p] < 372) G.eau[p] = 372;
  });
  const B = [{ x0: 5, y0: -20, x1: 25, y1: 0, h: 12 }, { x0: -3, y0: 20, x1: 10, y1: 30, h: 6 }];
  batir(G, B);
  return { G, B };
}

/** Pont : rivière encaissée (eau à 430) franchie par un tablier ; le pont n'est pas imprimé (pas de surplomb). */
function pont() {
  const G = grille(60);
  parCellule(G, (p, x, y) => {
    const d = Math.abs(x);
    G.sol[p] = d < 8 ? 428 : d < 14 ? 428 + (d - 8) * 1.5 : 437 + 0.02 * y;
    if (G.sol[p] < 430) G.eau[p] = 430;
    if (Math.abs(y) < 4 && d < 16) G.pont[p] = 438;
  });
  const B = [{ x0: 20, y0: 10, x1: 35, y1: 25, h: 10 }];
  batir(G, B);
  return { G, B };
}

/** Lieu boisé : forêt dense au nord, arbres isolés au sud, haie, quelques maisons. */
function foret() {
  const G = grille(70);
  let graine = 7;
  const hasard = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  parCellule(G, (p, x, y) => { G.sol[p] = 650 + 0.1 * x + 0.05 * y; });
  parCellule(G, (p, x, y) => { if (y > 15) G.veg[p] = G.sol[p] + 18 + 4 * Math.sin(x / 3) * Math.cos(y / 4); });
  const arbres = Array.from({ length: 30 }, () => [-60 + 120 * hasard(), -60 + 70 * hasard(), 8 + 10 * hasard(), 2 + 3 * hasard()]);
  parCellule(G, (p, x, y) => {
    for (const [ax, ay, h, r] of arbres) { const d = Math.hypot(x - ax, y - ay); if (d < r) { const z = G.sol[p] + h * Math.sqrt(1 - (d / r) ** 2); if (!(G.veg[p] >= z) && z > G.sol[p] + 2) G.veg[p] = z; } }
    if (Math.abs(y + 30) < 0.8 && x > -40 && x < 20) G.veg[p] = Math.max(G.veg[p] || 0, G.sol[p] + 2.5); // haie
  });
  const B = [{ x0: -20, y0: -10, x1: -8, y1: 0, h: 8, gouttiere: 5 }, { x0: 10, y0: -15, x1: 22, y1: -3, h: 7 }];
  batir(G, B);
  parCellule(G, (p) => { if (!isNaN(G.bat[p])) G.veg[p] = NaN; });
  return { G, B };
}

export const LIEUX = { ville, pente, lac, pont, foret };

/**
 * Bâtiments en maillages three.js (comme les tuiles swisstopo ou le maillage Advanced) : murs verticaux, toit à deux
 * pans (ou plat) qui déborde de `debord` m, un `_batchid` par bâtiment. Repère de la scène : x est, y haut, z sud.
 */
export function maillageBatiments(G, B, zRef, debord = 0.6) {
  const pos = [], ids = [], sol = (x, y) => {
    const i = Math.min(G.n - 1, Math.max(0, Math.floor((x - G.x0) / G.c))), j = Math.min(G.n - 1, Math.max(0, Math.floor((y - G.x0) / G.c)));
    return G.sol[j * G.n + i];
  };
  const tri = (a, b, c, id) => { for (const [x, y, z] of [a, b, c]) pos.push(x, z - zRef, -y); ids.push(id, id, id); };
  B.forEach((b, id) => {
    if (b.trou) return; // cours : relevé seulement
    const z0 = Math.min(sol(b.x0, b.y0), sol(b.x1, b.y0), sol(b.x0, b.y1), sol(b.x1, b.y1)) - 1, base = Math.max(sol(b.x0, b.y0), sol(b.x1, b.y1));
    const zf = base + b.h, zg = base + (b.gouttiere ?? b.h), ym = (b.y0 + b.y1) / 2;
    const C = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
    for (let k = 0; k < 4; k++) { // murs
      const [ax, ay] = C[k], [bx, by] = C[(k + 1) % 4];
      tri([ax, ay, z0], [bx, by, z0], [bx, by, zg], id); tri([ax, ay, z0], [bx, by, zg], [ax, ay, zg], id);
    }
    // toit (débordant), pente selon y : la gouttière descend au-delà du mur
    const x0 = b.x0 - debord, x1 = b.x1 + debord, y0 = b.y0 - debord, y1 = b.y1 + debord, pente = (zf - zg) / ((b.y1 - b.y0) / 2);
    const zy = y => zf - pente * Math.abs(y - ym);
    tri([x0, y0, zy(y0)], [x1, y0, zy(y0)], [x1, ym, zf], id); tri([x0, y0, zy(y0)], [x1, ym, zf], [x0, ym, zf], id);
    tri([x0, ym, zf], [x1, ym, zf], [x1, y1, zy(y1)], id); tri([x0, ym, zf], [x1, y1, zy(y1)], [x0, y1, zy(y1)], id);
    // dessous du débord (comme certaines tuiles) : même triangles, sens inverse
    tri([x0, y0, zy(y0)], [x1, ym, zf], [x1, y0, zy(y0)], id);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("_batchid", new THREE.Float32BufferAttribute(ids, 1));
  return new THREE.Mesh(g);
}
