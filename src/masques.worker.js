// Masques d'horizon proches d'une zone (onglet Soleil, zones piscine) : pour chaque point de mesure, la hauteur
// d'obstruction (degrés) dans 720 directions (pas de 0,5°), lue en marchant dans la grille `surface` (terrain,
// bâtiments, arbres). La marche s'arrête dès que plus rien ne peut dépasser l'angle trouvé (comparaison avec zmax).
// Entrée : { surface, n, c, pts: Float32Array [i, j (cellules), z0, rayonIgnore (m), seuilIgnore (m)] × N }.
// Option (toits, solaireToits.js) : { plans: Float32Array [a, b, d] × N, x0 } : plan propre à chaque point (hauteur
// a·x + b·y + d, x et y en mètres relatifs, x = x0 + i·c). Ce qui ne dépasse pas ce plan de plus de `tolPlan` + 5 % de la
// distance (bruit du relevé, tuiles, chéneaux ; 0,8 m à 10 m ne cache que 4,5°) est
// ignoré : un obstacle sous le plan des modules ne peut leur cacher que le soleil de derrière, déjà sans effet.
// Sortie : { masques: Uint8Array (N × 720), en demi-degrés arrondis vers le haut ; 0 = horizon dégagé ou plus bas }.
const NB_AZ = 720;

self.onmessage = ({ data }) => {
  const { surface, n, c, pts, debut = 0, plans = null, x0: X0 = 0, tolPlan = 0.3 } = data, N = pts.length / 5, masques = new Uint8Array(N * NB_AZ);
  let zmax = -Infinity;
  for (let p = 0; p < surface.length; p++) if (surface[p] > zmax) zmax = surface[p];
  const dirs = new Float64Array(2 * NB_AZ);
  for (let a = 0; a < NB_AZ; a++) { const r = a * 0.5 * Math.PI / 180; dirs[2 * a] = Math.sin(r); dirs[2 * a + 1] = Math.cos(r); }
  for (let q = 0; q < N; q++) {
    const x0 = pts[5 * q], y0 = pts[5 * q + 1], z0 = pts[5 * q + 2], rIgn = pts[5 * q + 3], sIgn = pts[5 * q + 4];
    const pa = plans ? plans[3 * q] : 0, pb = plans ? plans[3 * q + 1] : 0, pd = plans ? plans[3 * q + 2] + tolPlan : 0;
    for (let a = 0; a < NB_AZ; a++) {
      const dx = dirs[2 * a], dy = dirs[2 * a + 1];
      let tanMax = 0, s = 0.5; // s : distance parcourue en cellules
      for (;;) {
        const d = s * c; // mètres
        if ((zmax - z0) / d <= tanMax) break;
        const x = x0 + dx * s, y = y0 + dy * s, xi = x | 0, yi = y | 0;
        if (x < 0 || y < 0 || xi >= n || yi >= n) break;
        const z = surface[yi * n + xi];
        // bord du bassin (margelle, abords à 0,2 m au-dessus de l'eau) : ignoré sur les premiers mètres
        if (plans && z <= pa * (X0 + x * c) + pb * (X0 + y * c) + pd + 0.05 * d) { s += s < 80 ? 0.5 : 1; continue; }
        if (!(d < rIgn && z < z0 + sIgn)) { const tg = (z - z0) / d; if (tg > tanMax) tanMax = tg; }
        s += s < 80 ? 0.5 : 1; // pas de 0,25 m jusqu'à 40 m, puis 0,5 m
      }
      masques[q * NB_AZ + a] = Math.min(180, Math.ceil(Math.atan(tanMax) * 360 / Math.PI));
    }
  }
  self.postMessage({ masques, debut }, [masques.buffer]);
};
