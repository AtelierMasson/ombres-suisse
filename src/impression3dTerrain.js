// Terrain adaptatif pour l'impression 3D : triangulation d'une grille de hauteurs par insertion gloutonne
// (Garland et Heckbert, « Fast Polygonal Approximation of Terrains and Height Fields », 1995). On part de deux
// triangles ; à chaque pas, le point de la grille le plus mal approché devient un sommet (triangulation de Delaunay
// tenue à jour par basculements), jusqu'à ce que l'écart maximal passe sous la tolérance. Le maillage est donc fin là
// où le terrain bouge (talus, murs de soutènement, bords de route) et grossier en plat, sans jamais s'écarter de la
// grille de plus que la tolérance. Structure (demi-arêtes, file de priorité) reprise de mapbox/delatin (licence ISC).
// Sans DOM ni three.js : tourne dans un fil de calcul.

const orient = (ax, ay, bx, by, cx, cy) => (bx - cx) * (ay - cy) - (by - cy) * (ax - cx);

function dansCercle(ax, ay, bx, by, cx, cy, px, py) {
  const dx = ax - px, dy = ay - py, ex = bx - px, ey = by - py, fx = cx - px, fy = cy - py;
  const ap = dx * dx + dy * dy, bp = ex * ex + ey * ey, cp = fx * fx + fy * fy;
  return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0;
}

export class TerrainAdaptatif {
  /**
   * `h` : hauteurs (Float32Array, largeur × hauteur, ligne par ligne) ; `masque` (facultatif, Uint8Array) : 1 là où
   * l'écart compte (les points hors de la zone imprimée n'attirent pas de sommets).
   */
  constructor(h, largeur, hauteur, masque = null) {
    this.h = h; this.l = largeur; this.masque = masque;
    this.coords = [];      // sommets (x, y) en indices de grille
    this.tri = [];         // triangles (3 sommets)
    this.demi = [];        // demi-arête opposée de chaque côté (−1 au bord)
    this.cand = [];        // point le plus mal approché de chaque triangle
    this.rang = [];        // place de chaque triangle dans la file (−1 : absent)
    this.file = [];        // tas : triangles par écart décroissant
    this.ecarts = [];
    this.attente = []; this.nbAttente = 0;
    const x1 = largeur - 1, y1 = hauteur - 1;
    const p0 = this.point(0, 0), p1 = this.point(x1, 0), p2 = this.point(0, y1), p3 = this.point(x1, y1);
    const t0 = this.triangle(p3, p0, p2, -1, -1, -1);
    this.triangle(p0, p3, p1, t0, -1, -1);
    this.vider();
  }

  /** Affine jusqu'à un écart maximal `tol` (unité des hauteurs) ou `maxTriangles`. */
  affiner(tol, maxTriangles = Infinity) {
    while (this.file.length && this.ecarts[0] > tol && this.tri.length / 3 < maxTriangles) { this.pas(); this.vider(); }
    return this.file.length ? this.ecarts[0] : 0;
  }

  point(x, y) { const i = this.coords.length >> 1; this.coords.push(x, y); return i; }

  triangle(a, b, c, ab, bc, ca, e = this.tri.length) {
    const t = e / 3;
    this.tri[e] = a; this.tri[e + 1] = b; this.tri[e + 2] = c;
    this.demi[e] = ab; this.demi[e + 1] = bc; this.demi[e + 2] = ca;
    if (ab >= 0) this.demi[ab] = e;
    if (bc >= 0) this.demi[bc] = e + 1;
    if (ca >= 0) this.demi[ca] = e + 2;
    this.cand[2 * t] = 0; this.cand[2 * t + 1] = 0;
    this.rang[t] = -1;
    this.attente[this.nbAttente++] = t;
    return e;
  }

  /** Mesure les triangles nouveaux (parcours de leurs points de grille) et les range dans la file. */
  vider() {
    const C = this.coords, T = this.tri;
    for (let i = 0; i < this.nbAttente; i++) {
      const t = this.attente[i], a = 2 * T[3 * t], b = 2 * T[3 * t + 1], c = 2 * T[3 * t + 2];
      this.mesurer(C[a], C[a + 1], C[b], C[b + 1], C[c], C[c + 1], t);
    }
    this.nbAttente = 0;
  }

  mesurer(p0x, p0y, p1x, p1y, p2x, p2y, t) {
    const h = this.h, l = this.l, masque = this.masque;
    const minX = Math.min(p0x, p1x, p2x), minY = Math.min(p0y, p1y, p2y), maxX = Math.max(p0x, p1x, p2x), maxY = Math.max(p0y, p1y, p2y);
    let w00 = orient(p1x, p1y, p2x, p2y, minX, minY), w01 = orient(p2x, p2y, p0x, p0y, minX, minY), w02 = orient(p0x, p0y, p1x, p1y, minX, minY);
    const a01 = p1y - p0y, b01 = p0x - p1x, a12 = p2y - p1y, b12 = p1x - p2x, a20 = p0y - p2y, b20 = p2x - p0x;
    const a = orient(p0x, p0y, p1x, p1y, p2x, p2y);
    const z0 = h[p0y * l + p0x] / a, z1 = h[p1y * l + p1x] / a, z2 = h[p2y * l + p2x] / a;
    let pire = 0, mx = 0, my = 0;
    for (let y = minY; y <= maxY; y++) {
      let dx = 0;
      if (w00 < 0 && a12 !== 0) dx = Math.max(dx, Math.floor(-w00 / a12));
      if (w01 < 0 && a20 !== 0) dx = Math.max(dx, Math.floor(-w01 / a20));
      if (w02 < 0 && a01 !== 0) dx = Math.max(dx, Math.floor(-w02 / a01));
      let w0 = w00 + a12 * dx, w1 = w01 + a20 * dx, w2 = w02 + a01 * dx, dedans = false;
      for (let x = minX + dx; x <= maxX; x++) {
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          dedans = true;
          const p = y * l + x;
          if (!masque || masque[p]) {
            const dz = Math.abs(z0 * w0 + z1 * w1 + z2 * w2 - h[p]);
            if (dz > pire) { pire = dz; mx = x; my = y; }
          }
        } else if (dedans) break;
        w0 += a12; w1 += a20; w2 += a01;
      }
      w00 += b12; w01 += b20; w02 += b01;
    }
    if ((mx === p0x && my === p0y) || (mx === p1x && my === p1y) || (mx === p2x && my === p2y)) pire = 0;
    this.cand[2 * t] = mx; this.cand[2 * t + 1] = my;
    this.pousser(t, pire);
  }

  /** Insère le point le plus mal approché du triangle en tête de file. */
  pas() {
    const t = this.tirer(), e0 = 3 * t, e1 = e0 + 1, e2 = e0 + 2, T = this.tri, C = this.coords;
    const p0 = T[e0], p1 = T[e1], p2 = T[e2];
    const ax = C[2 * p0], ay = C[2 * p0 + 1], bx = C[2 * p1], by = C[2 * p1 + 1], cx = C[2 * p2], cy = C[2 * p2 + 1];
    const px = this.cand[2 * t], py = this.cand[2 * t + 1], pn = this.point(px, py);
    if (orient(ax, ay, bx, by, px, py) === 0) this.aligne(pn, e0);
    else if (orient(bx, by, cx, cy, px, py) === 0) this.aligne(pn, e1);
    else if (orient(cx, cy, ax, ay, px, py) === 0) this.aligne(pn, e2);
    else {
      const h0 = this.demi[e0], h1 = this.demi[e1], h2 = this.demi[e2];
      const t0 = this.triangle(p0, p1, pn, h0, -1, -1, e0), t1 = this.triangle(p1, p2, pn, h1, -1, t0 + 1), t2 = this.triangle(p2, p0, pn, h2, t0 + 2, t1 + 1);
      this.legaliser(t0); this.legaliser(t1); this.legaliser(t2);
    }
  }

  /** Bascule l'arête `a` si elle ne respecte pas la condition de Delaunay, puis vérifie les deux arêtes touchées. */
  legaliser(a) {
    const b = this.demi[a];
    if (b < 0) return;
    const a0 = a - a % 3, b0 = b - b % 3, al = a0 + (a + 1) % 3, ar = a0 + (a + 2) % 3, bl = b0 + (b + 2) % 3, br = b0 + (b + 1) % 3;
    const T = this.tri, C = this.coords, p0 = T[ar], pr = T[a], pl = T[al], p1 = T[bl];
    if (!dansCercle(C[2 * p0], C[2 * p0 + 1], C[2 * pr], C[2 * pr + 1], C[2 * pl], C[2 * pl + 1], C[2 * p1], C[2 * p1 + 1])) return;
    const hal = this.demi[al], har = this.demi[ar], hbl = this.demi[bl], hbr = this.demi[br];
    this.retirer(a0 / 3); this.retirer(b0 / 3);
    const t0 = this.triangle(p0, p1, pl, -1, hbl, hal, a0), t1 = this.triangle(p1, p0, pr, t0, har, hbr, b0);
    this.legaliser(t0 + 1); this.legaliser(t1 + 2);
  }

  /** Point posé exactement sur l'arête `a` : les deux triangles voisins sont coupés en deux. */
  aligne(pn, a) {
    const a0 = a - a % 3, al = a0 + (a + 1) % 3, ar = a0 + (a + 2) % 3, T = this.tri;
    const p0 = T[ar], pr = T[a], pl = T[al], hal = this.demi[al], har = this.demi[ar], b = this.demi[a];
    if (b < 0) {
      const t0 = this.triangle(pn, p0, pr, -1, har, -1, a0), t1 = this.triangle(p0, pn, pl, t0, -1, hal);
      this.legaliser(t0 + 1); this.legaliser(t1 + 2);
      return;
    }
    const b0 = b - b % 3, bl = b0 + (b + 2) % 3, br = b0 + (b + 1) % 3, p1 = T[bl], hbl = this.demi[bl], hbr = this.demi[br];
    this.retirer(b0 / 3);
    const t0 = this.triangle(p0, pr, pn, har, -1, -1, a0), t1 = this.triangle(pr, p1, pn, hbr, -1, t0 + 1, b0);
    const t2 = this.triangle(p1, pl, pn, hbl, -1, t1 + 1), t3 = this.triangle(pl, p0, pn, hal, t0 + 2, t2 + 1);
    this.legaliser(t0); this.legaliser(t1); this.legaliser(t2); this.legaliser(t3);
  }

  /* file de priorité (tas binaire, le plus grand écart en tête) */
  pousser(t, ecart) { const i = this.file.length; this.rang[t] = i; this.file.push(t); this.ecarts.push(ecart); this.monter(i); }
  tirer() { const n = this.file.length - 1; this.echanger(0, n); this.descendre(0, n); return this.dernier(); }
  dernier() { const t = this.file.pop(); this.ecarts.pop(); this.rang[t] = -1; return t; }
  retirer(t) {
    const i = this.rang[t];
    if (i < 0) {
      // pas encore mesuré : il sort de la liste d'attente
      for (let k = 0; k < this.nbAttente; k++) if (this.attente[k] === t) { this.attente[k] = this.attente[--this.nbAttente]; return; }
      throw new Error("triangulation du terrain incohérente");
    }
    const n = this.file.length - 1;
    if (n !== i) { this.echanger(i, n); if (!this.descendre(i, n)) this.monter(i); }
    this.dernier();
  }
  echanger(i, j) {
    const F = this.file, E = this.ecarts, a = F[i], b = F[j];
    F[i] = b; F[j] = a; this.rang[a] = j; this.rang[b] = i;
    const e = E[i]; E[i] = E[j]; E[j] = e;
  }
  monter(j0) {
    const E = this.ecarts;
    for (let j = j0; ;) {
      const i = (j - 1) >> 1;
      if (i === j || i < 0 || !(E[j] > E[i])) break;
      this.echanger(i, j); j = i;
    }
  }
  descendre(i0, n) {
    const E = this.ecarts;
    let i = i0;
    for (;;) {
      const j1 = 2 * i + 1;
      if (j1 >= n || j1 < 0) break;
      const j2 = j1 + 1, j = j2 < n && E[j2] > E[j1] ? j2 : j1;
      if (!(E[j] > E[i])) break;
      this.echanger(i, j); i = j;
    }
    return i > i0;
  }
}
