// Heures d'ensoleillement par cellule : pour chaque position du soleil, on suit le rayon dans la grille de surface
// (terrain + bâtiments + arbres) ; le soleil doit aussi être au-dessus de l'horizon lointain.
self.onmessage = ({ data }) => {
  const { surface, base, n, c, rect: [i0, j0, i1, j1], soleils, horizon } = data;
  const w = i1 - i0, h = j1 - j0, heures = new Float32Array(w * h);
  let zmax = -Infinity;
  for (let p = 0; p < surface.length; p++) if (surface[p] > zmax) zmax = surface[p];
  const pasH = horizon.pas, prof = horizon.profil;
  const horizonA = az => { const f = az / pasH, i = Math.floor(f) % prof.length, u = f - Math.floor(f); return prof[i] * (1 - u) + prof[(i + 1) % prof.length] * u; };
  const visibles = soleils.filter(s => s.hauteur > 0.5 && s.hauteur > horizonA(s.azimut));
  visibles.forEach((s, k) => {
    const a = s.azimut * Math.PI / 180, dx = Math.sin(a), dy = Math.cos(a), monte = c * Math.tan(s.hauteur * Math.PI / 180);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      // départ au sol ou sur le toit : sous un arbre, le rayon est arrêté par la canopée
      let z = base[j * n + i] + 0.2, x = i + 0.5, y = j + 0.5, libre = true;
      while (z < zmax) {
        x += dx; y += dy; z += monte;
        const xi = x | 0, yi = y | 0;
        if (xi < 0 || yi < 0 || xi >= n || yi >= n) break;
        if (surface[yi * n + xi] > z) { libre = false; break; }
      }
      if (libre) heures[(j - j0) * w + (i - i0)] += s.duree;
    }
    if (k % 4 === 0) self.postMessage({ progres: (k + 1) / visibles.length });
  });
  self.postMessage({ heures, w, h }, [heures.buffer]);
};
