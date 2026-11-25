// Heures d'ensoleillement : pour chaque position du soleil (déjà au-dessus du relief lointain, avec son poids en heures),
// on suit le rayon dans la grille de surface (terrain + bâtiments + arbres), depuis chaque cellule de la zone
// et depuis chaque point de façade.
self.onmessage = ({ data }) => {
  const { surface, base, n, c, zone: [i0, j0, i1, j1], alpha, soleils, facades } = data;
  const w = i1 - i0, h = j1 - j0, heures = new Float32Array(w * h), nf = facades.length / 5, heuresF = new Float32Array(nf);
  let zmax = -Infinity;
  for (let p = 0; p < surface.length; p++) if (surface[p] > zmax) zmax = surface[p];
  // vrai si rien n'arrête le rayon parti de (x, y, z) ; x, y en cellules
  const libre = (x, y, z, dx, dy, monte) => {
    while (z < zmax) {
      x += dx; y += dy; z += monte;
      const xi = x | 0, yi = y | 0;
      if (x < 0 || y < 0 || xi >= n || yi >= n) break;
      if (surface[yi * n + xi] > z) return false;
    }
    return true;
  };
  soleils.forEach((s, k) => {
    const a = s.azimut * Math.PI / 180, dx = Math.sin(a), dy = Math.cos(a), monte = c * Math.tan(s.hauteur * Math.PI / 180);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const q = (j - j0) * w + (i - i0);
      // départ au sol ou sur le toit : sous un arbre, le rayon est arrêté par la canopée
      if (alpha[q] > 0 && libre(i + 0.5, j + 0.5, base[j * n + i] + 0.2, dx, dy, monte)) heures[q] += s.duree;
    }
    // façades : le soleil doit être devant le mur
    for (let f = 0; f < nf; f++) {
      const o = 5 * f;
      if (facades[o + 3] * dx + facades[o + 4] * dy > 0.03 && libre(facades[o], facades[o + 1], facades[o + 2], dx, dy, monte)) heuresF[f] += s.duree;
    }
    if (k % 3 === 0) self.postMessage({ progres: (k + 1) / soleils.length });
  });
  self.postMessage({ heures, heuresF }, [heures.buffer, heuresF.buffer]);
};
