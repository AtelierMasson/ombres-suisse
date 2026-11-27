// Aides de diagnostic des ponts (évaluées dans la page). Repère : x est, y nord (m, relatifs au centre) ; scène = [x, z − zRef, −y].
const S = window.__scene;
const D = window.__d = {};
D.sol = (x, y) => {
  const G = S.G, fi = (x - G.x0) / G.c - 0.5, fj = (y - G.x0) / G.c - 0.5;
  const i = Math.max(0, Math.min(G.n - 2, Math.floor(fi))), j = Math.max(0, Math.min(G.n - 2, Math.floor(fj)));
  const u = Math.min(1, Math.max(0, fi - i)), v = Math.min(1, Math.max(0, fj - j)), n = G.n, s = G.sol;
  return (s[j * n + i] * (1 - u) + s[j * n + i + 1] * u) * (1 - v) + (s[(j + 1) * n + i] * (1 - u) + s[(j + 1) * n + i + 1] * u) * v;
};
/** Ponts de la grille : composantes connexes des cases de tablier à plus d'un mètre du sol (comme pontsLegers). */
D.composantes = () => {
  const G = S.G, { n, c, x0, pont, sol } = G, vu = new Uint8Array(n * n), out = [];
  if (!pont) return out;
  for (let p = 0; p < n * n; p++) if (!isNaN(pont[p]) && !(pont[p] - sol[p] > 1)) vu[p] = 1;
  for (let p0 = 0; p0 < n * n; p0++) {
    if (vu[p0] || isNaN(pont[p0])) continue;
    const cel = [], pile = [p0]; vu[p0] = 1;
    while (pile.length) { const p = pile.pop(), i = p % n; cel.push(p); for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n]) if (q >= 0 && q < n * n && !vu[q] && !isNaN(pont[q])) { vu[q] = 1; pile.push(q); } }
    if (cel.length * c * c < 20) continue;
    let sx = 0, sy = 0, x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity; const h = [], z = [];
    for (const p of cel) { const x = x0 + (p % n + 0.5) * c, y = x0 + (Math.floor(p / n) + 0.5) * c; sx += x; sy += y; x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); h.push(pont[p] - sol[p]); z.push(pont[p]); }
    h.sort((a, b) => a - b); z.sort((a, b) => a - b);
    out.push({ x: +(sx / cel.length).toFixed(1), y: +(sy / cel.length).toFixed(1), aire: Math.round(cel.length * c * c), dx: +(x2 - x1).toFixed(0), dy: +(y2 - y1).toFixed(0), hMed: +h[h.length >> 1].toFixed(2), hMax: +h.at(-1).toFixed(2), z: +(z[z.length >> 1] - S.zRef).toFixed(2), r: Math.round(Math.hypot(sx / cel.length, sy / cel.length)), cel });
  }
  return out.sort((a, b) => b.aire - a.aire);
};
/** Triangles d'un maillage en plan, rangés par cases de 4 m. */
D.index = m => {
  const g = m.geometry, pos = g.attributes.position, idx = g.index, nt = (idx ? idx.count : pos.count) / 3, T = [], cases = new Map();
  for (let t = 0; t < nt; t++) {
    const v = [0, 1, 2].map(k => { const i = idx ? idx.getX(3 * t + k) : 3 * t + k; return [pos.getX(i), -pos.getZ(i), pos.getY(i)]; });
    const [a, b, cc] = v, aire2 = (b[0] - a[0]) * (cc[1] - a[1]) - (b[1] - a[1]) * (cc[0] - a[0]);
    // normale vers le haut (en scène) : aire signée en plan (x, y) positive
    const tri = { v, haut: aire2 > 0, aire2 };
    T.push(tri);
    if (Math.abs(aire2) < 1e-9) continue;
    const i0 = Math.floor(Math.min(a[0], b[0], cc[0]) / 4), i1 = Math.floor(Math.max(a[0], b[0], cc[0]) / 4), j0 = Math.floor(Math.min(a[1], b[1], cc[1]) / 4), j1 = Math.floor(Math.max(a[1], b[1], cc[1]) / 4);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = i + "," + j; (cases.get(k) || cases.set(k, []).get(k)).push(tri); }
  }
  return { T, cases };
};
/** Hauteurs (scène) des triangles à la verticale de (x, y) : { haut: plus haute face tournée vers le haut, tout: plus haute face }. */
D.lire = (I, x, y) => {
  let haut = NaN, tout = NaN;
  for (const t of I.cases.get(Math.floor(x / 4) + "," + Math.floor(y / 4)) || []) {
    const [a, b, c] = t.v, w1 = ((b[0] - x) * (c[1] - y) - (b[1] - y) * (c[0] - x)) / t.aire2, w2 = ((c[0] - x) * (a[1] - y) - (c[1] - y) * (a[0] - x)) / t.aire2, w3 = 1 - w1 - w2;
    if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
    const z = w1 * a[2] + w2 * b[2] + w3 * c[2];
    if (!(tout >= z)) tout = z;
    if (t.haut && !(haut >= z)) haut = z;
  }
  return { haut, tout };
};
/** Mesures par pont : couverture du tablier vu de dessus, écart en hauteur, terrain qui dépasse, faces retournées. */
D.mesures = () => {
  const G = S.G, { n, c, x0, pont } = G, P = S.couches.ponts;
  if (!P) return { ponts: [] };
  const dessus = P.children.filter(o => o.material === S.mat.terrain), cotes = P.children.filter(o => o.material !== S.mat.terrain);
  const I = dessus.map(D.index), Rz = (G.rayonZone || 1e9) - 1;
  const lire = (x, y) => { let h = NaN, t = NaN; for (const i of I) { const r = D.lire(i, x, y); if (!(h >= r.haut)) h = isNaN(r.haut) ? h : r.haut; if (!(t >= r.tout)) t = isNaN(r.tout) ? t : r.tout; } return { haut: h, tout: t }; };
  let bas = 0, tot = 0; for (const i of I) for (const t of i.T) { tot++; if (!t.haut) bas++; }
  const res = [];
  for (const C of D.composantes()) {
    let dans = 0, couvert = 0, couvertTout = 0, terrainDessus = 0; const dz = [];
    for (const p of C.cel) {
      const x = x0 + (p % n + 0.5) * c, y = x0 + (Math.floor(p / n) + 0.5) * c;
      if (Math.hypot(x, y) > Rz) continue;
      dans++;
      const r = lire(x, y);
      if (!isNaN(r.tout)) couvertTout++;
      if (isNaN(r.haut)) continue;
      couvert++;
      dz.push(r.haut - (pont[p] - S.zRef));
      if (D.sol(x, y) - S.zRef > r.haut + 0.05) terrainDessus++;
    }
    dz.sort((a, b) => a - b);
    const q = f => dz.length ? +dz[Math.min(dz.length - 1, Math.floor(dz.length * f))].toFixed(2) : null;
    res.push({ x: C.x, y: C.y, r: C.r, aire: C.aire, dim: `${C.dx}x${C.dy}`, hMed: C.hMed, z: C.z, cases: dans, couvertHaut: dans ? +(couvert / dans).toFixed(3) : null, couvertTout: dans ? +(couvertTout / dans).toFixed(3) : null,
      dzMed: q(0.5), dz05: q(0.05), dz95: q(0.95), terrainDessus });
  }
  const info = dessus.map(o => (o.userData.geomOrig || o.geometry).userData.ponts).filter(Boolean).flat();
  return { triDessus: tot, triDessusVersLeBas: bas, triCotes: cotes.reduce((s, o) => s + o.geometry.attributes.position.count / 3, 0), ponts: res, info };
};
/** Caméra : cible (x, y, zScène), azimut (° depuis le nord, sens horaire : d'où l'on regarde), élévation (°, négative = de dessous), distance. */
D.vue = (x, y, z, az, el, dist) => {
  const a = az * Math.PI / 180, e = el * Math.PI / 180, cam = S.camera, ct = S.controls;
  ct.minDistance = 0; ct.maxPolarAngle = Math.PI; ct.minPolarAngle = 0;
  ct.target.set(x, z, -y);
  cam.position.set(x + dist * Math.cos(e) * Math.sin(a), z + dist * Math.sin(e), -y - dist * Math.cos(e) * Math.cos(a) * -1 * -1);
  cam.near = 0.3; cam.updateProjectionMatrix();
  cam.lookAt(ct.target);
  S.rendre();
};
return true;
