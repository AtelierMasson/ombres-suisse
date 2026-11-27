// Masques d'horizon proches d'une zone (onglet Soleil, zones piscine) : pour chaque point de mesure, la hauteur
// d'obstruction (degrés) dans 720 directions (pas de 0,5°), lue en marchant dans la grille `surface` (terrain,
// bâtiments, arbres). La marche s'arrête dès que plus rien ne peut dépasser l'angle trouvé (comparaison avec zmax).
// Entrée : { surface, n, c, pts: Float32Array [i, j (cellules), z0, rayonIgnore (m), seuilIgnore (m)] × N }.
// Sortie : { masques: Uint8Array (N × 720), en demi-degrés arrondis vers le haut ; 0 = horizon dégagé ou plus bas }.
const NB_AZ = 720;

self.onmessage = ({ data }) => {
  const { surface, n, c, pts, debut = 0 } = data, N = pts.length / 5, masques = new Uint8Array(N * NB_AZ);
  let zmax = -Infinity;
  for (let p = 0; p < surface.length; p++) if (surface[p] > zmax) zmax = surface[p];
  const dirs = new Float64Array(2 * NB_AZ);
  for (let a = 0; a < NB_AZ; a++) { const r = a * 0.5 * Math.PI / 180; dirs[2 * a] = Math.sin(r); dirs[2 * a + 1] = Math.cos(r); }
  for (let q = 0; q < N; q++) {
    const x0 = pts[5 * q], y0 = pts[5 * q + 1], z0 = pts[5 * q + 2], rIgn = pts[5 * q + 3], sIgn = pts[5 * q + 4];
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
        if (!(d < rIgn && z < z0 + sIgn)) { const tg = (z - z0) / d; if (tg > tanMax) tanMax = tg; }
        s += s < 80 ? 0.5 : 1; // pas de 0,25 m jusqu'à 40 m, puis 0,5 m
      }
      masques[q * NB_AZ + a] = Math.min(180, Math.ceil(Math.atan(tanMax) * 360 / Math.PI));
    }
  }
  self.postMessage({ masques, debut }, [masques.buffer]);
};
