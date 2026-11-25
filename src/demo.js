// Scène d'accueil : un petit hameau inventé (terrain en pente, maisons à deux pans, arbres), construit avec les
// mêmes grilles que les vrais lieux. Il sert de décor animé avant la première recherche.
import { grilleVide } from "./grille.js";

export function hameau(R = 80) {
  const G = grilleVide(R), { n, c } = G;
  let graine = 7;
  const alea = () => { graine = (graine * 16807) % 2147483647; return graine / 2147483647; };
  // terrain : pente douce vers le sud et quelques ondulations
  const solA = (x, y) => 500 + y * 0.07 + 2.2 * Math.sin(x / 38) * Math.cos(y / 47) + 1.2 * Math.sin((x + y) / 21);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) G.sol[j * n + i] = solA(-R + (i + 0.5) * c, -R + (j + 0.5) * c);
  // maisons : [x, y, longueur, largeur, angle, hauteur à la corniche, hauteur du faîte]
  const maisons = [
    [0, 2, 15, 9.5, 0.35, 6.2, 3.4], [-27, 14, 12, 8, -0.2, 5.5, 3], [24, 24, 18, 10, 1.25, 8.5, 3.2], [-22, -22, 11, 8, 0.9, 5.5, 2.8],
    [27, -14, 13, 9, -0.5, 6, 3], [-48, -6, 10, 7.5, 0.1, 5, 2.6], [50, 4, 12, 8, 0.75, 5.8, 2.8], [2, 42, 14, 9, -0.15, 6.5, 3],
    [-38, 44, 11, 8, 0.55, 5.4, 2.7], [6, -44, 16, 9, 0.05, 6.4, 3.2], [48, -46, 12, 8, 1.0, 5.6, 2.8], [-55, -48, 12, 8.5, -0.4, 5.8, 2.9],
    [8, 9.5, 5, 4.5, 0.35, 2.8, 0], // annexe à toit plat
  ];
  for (const [mx, my, L, l, a, hc, hf] of maisons) {
    const ca = Math.cos(a), sa = Math.sin(a), z0 = solA(mx, my), r = Math.hypot(L, l) / 2 + 1;
    for (let y = my - r; y <= my + r; y += c) for (let x = mx - r; x <= mx + r; x += c) {
      const i = Math.floor((x + R) / c), j = Math.floor((y + R) / c);
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const dx = -R + (i + 0.5) * c - mx, dy = -R + (j + 0.5) * c - my, u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      if (Math.abs(u) > L / 2 || Math.abs(v) > l / 2) continue;
      G.bat[j * n + i] = Math.max(G.bat[j * n + i] || 0, z0 + hc + hf * (1 - Math.abs(v) / (l / 2)));
    }
  }
  // arbres : couronnes arrondies, avec des points comme dans un vrai relevé
  const X = [], Y = [], Z = [], C = [];
  for (let k = 0; k < 85; k++) {
    const tx = (alea() * 2 - 1) * (R - 8), ty = (alea() * 2 - 1) * (R - 8), rayon = 2.2 + alea() * 3, haut = 6 + alea() * 9;
    if (maisons.some(([mx, my, L]) => Math.hypot(tx - mx, ty - my) < L / 2 + rayon + 2)) continue;
    const z0 = solA(tx, ty);
    for (let y = ty - rayon; y <= ty + rayon; y += c) for (let x = tx - rayon; x <= tx + rayon; x += c) {
      const i = Math.floor((x + R) / c), j = Math.floor((y + R) / c), d = Math.hypot(x - tx, y - ty) / rayon;
      if (d >= 1 || i < 0 || j < 0 || i >= n || j >= n) continue;
      const z = z0 + haut - (haut * 0.45) * d * d;
      if (!(G.veg[j * n + i] >= z)) G.veg[j * n + i] = z;
    }
    for (let q = 0; q < 260 * rayon; q++) {
      const a = alea() * 6.283, d = Math.sqrt(alea()), h = alea();
      const zHaut = z0 + haut - (haut * 0.45) * d * d, zBas = z0 + haut * 0.3;
      X.push(tx + Math.cos(a) * d * rayon); Y.push(ty + Math.sin(a) * d * rayon); Z.push(zBas + (zHaut - zBas) * Math.sqrt(h)); C.push(3);
    }
  }
  G.base = new Float32Array(n * n); G.surface = new Float32Array(n * n);
  for (let p = 0; p < n * n; p++) {
    G.base[p] = Math.max(G.sol[p], G.bat[p] || -1e9);
    G.surface[p] = Math.max(G.base[p], G.veg[p] || -1e9);
  }
  const nuage = { X: Float32Array.from(X), Y: Float32Array.from(Y), Z: Float32Array.from(Z), C: Uint8Array.from(C), n: X.length };
  const parcelle = { anneauxRel: [[[-16, -11], [15, -9], [17, 15], [-13, 17], [-16, -11]]] };
  return { G, nuage, parcelle, lat: 46.51, lon: 6.69 };
}
