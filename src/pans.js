// Pans de toit. La grille de 0,5 m donne des toits à facettes et des faîtages en escalier : pour chaque volume, on
// classe les cellules selon leur pente (plat, ou pente vers l'un des quatre côtés du bâtiment, d'après l'orientation
// dominante de ses façades), on ajuste un plan par groupe de cellules (moindres carrés, sans les cheminées et autres
// accidents, pente ramenée dans l'axe des façades quand elle en est proche), on réunit les pans presque coplanaires,
// puis on déplace la limite entre deux pans sur la droite où leurs plans se croisent : faîtages et rives de pan
// parallèles aux façades, arêtiers et noues à 45° quand les pentes sont égales.
// La hauteur du toit en un point est alors celle du plan du pan qui le contient. Un volume qui ne se laisse pas
// décrire ainsi (résidu trop grand, trop de pans) garde la grille de hauteurs. Seul l'affichage change.

const MINIMUM = 12;     // cellules : en dessous, un groupe de cellules n'est pas un pan (cheminée, bruit)
const PLAT = 0.07;      // pente (m/m) en dessous de laquelle une cellule est classée « plat »
const COPLANAIRE = 0.12; // écart quadratique moyen (m) entre deux plans voisins pour les réunir
const PORTEE = 3;       // distance (m) dont la limite entre deux pans peut glisser vers leur droite d'intersection
const RESIDU = 0.4;     // résidu moyen (m) au-delà duquel le volume garde la grille

/**
 * @param G grille ; @param C contours (contoursBatiments) : seg, val, px, py, boucles (avec `dominante`).
 * @returns {{ pan, mixte, plans, stats, triangles, profil, hauteurEn }}
 *   pan   : numéro de pan de chaque cellule (−1 = pas de bâtiment, ou volume resté en grille).
 *   mixte : 1 si la cellule a un autre pan dans son voisinage (elle peut être traversée par une arête de toit).
 *   plans : [a, b, d] par pan, hauteur = a·x + b·y + d (x, y en mètres, relatifs).
 */
export function pansToits(G, C) {
  const { n, c, x0 } = G, m = n + 1, N = n * n, { seg, val, px, py } = C, debut = performance.now();
  const X = p => x0 + (p % n + 0.5) * c, Y = p => x0 + (Math.floor(p / n) + 0.5) * c;
  let nbVol = 0;
  const bati = []; // cellules de bâtiment, dans l'ordre : les parcours ne visitent qu'elles
  for (let p = 0; p < N; p++) if (seg[p] >= 0) { bati.push(p); if (seg[p] >= nbVol) nbVol = seg[p] + 1; }

  // orientation de chaque volume : celle de son plus long contour ; à défaut (volume minuscule), celle d'un voisin
  const ori = new Float64Array(nbVol).fill(NaN), poids = new Int32Array(nbVol);
  for (const B of C.boucles) if (B.dominante != null && B.coins.length > poids[B.seg]) { poids[B.seg] = B.coins.length; ori[B.seg] = B.dominante; }
  const pret = new Float64Array(nbVol).fill(NaN), poidsPret = new Int32Array(nbVol);
  for (const p of bati) {
    const s = seg[p];
    if (s < 0 || poids[s]) continue;
    const i = p % n;
    for (const r of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n]) {
      const t = r >= 0 && r < N ? seg[r] : -1;
      if (t >= 0 && poids[t] > poidsPret[s]) { poidsPret[s] = poids[t]; pret[s] = ori[t]; }
    }
  }
  const co = new Float64Array(nbVol), si = new Float64Array(nbVol);
  for (let s = 0; s < nbVol; s++) { const a = poids[s] ? ori[s] : poidsPret[s] ? pret[s] : 0; co[s] = Math.cos(a); si[s] = Math.sin(a); }

  // pente de chaque cellule : plan ajusté sur une fenêtre de 3 × 3 cellules du même volume ; parmi les fenêtres qui
  // contiennent la cellule, on garde la mieux ajustée (près d'un faîtage : celle qui reste d'un seul côté)
  const fx = new Float32Array(N), fy = new Float32Array(N), fr = new Float32Array(N).fill(Infinity);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const q = j * n + i, s = seg[q];
    if (s < 0 || seg[q - n - 1] !== s || seg[q - n] !== s || seg[q - n + 1] !== s || seg[q - 1] !== s || seg[q + 1] !== s
      || seg[q + n - 1] !== s || seg[q + n] !== s || seg[q + n + 1] !== s) continue;
    const a = val[q - n - 1], b = val[q - n], d = val[q - n + 1], e = val[q - 1], f = val[q], g = val[q + 1], h = val[q + n - 1], k = val[q + n], l = val[q + n + 1];
    const gx = (d + g + l - a - e - h) / 6, gy = (h + k + l - a - b - d) / 6, z = (a + b + d + e + f + g + h + k + l) / 9;
    fx[q] = gx / c; fy[q] = gy / c;
    fr[q] = (a - z + gx + gy) ** 2 + (b - z + gy) ** 2 + (d - z - gx + gy) ** 2 + (e - z + gx) ** 2 + (f - z) ** 2 + (g - z - gx) ** 2
      + (h - z + gx - gy) ** 2 + (k - z - gy) ** 2 + (l - z - gx - gy) ** 2;
  }
  // classes : −1 sans pente connue, 0 plat, 1 à 4 = pente montante vers +u, −u, +v, −v (axes du bâtiment)
  const classe = new Int8Array(N).fill(-1);
  for (const p of bati) {
    const s = seg[p];
    if (s < 0) continue;
    const i = p % n, j = (p - i) / n;
    let q = -1, r = fr[p];
    if (r < Infinity) q = p;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const t = b * n + a;
      if (seg[t] === s && fr[t] < r) { r = fr[t]; q = t; }
    }
    if (q < 0) continue;
    const gu = fx[q] * co[s] + fy[q] * si[s], gv = -fx[q] * si[s] + fy[q] * co[s];
    classe[p] = Math.hypot(gu, gv) < PLAT ? 0 : Math.abs(gu) >= Math.abs(gv) ? (gu > 0 ? 1 : 2) : gv > 0 ? 3 : 4;
  }

  // plans : hauteur = a·x + b·y + d
  const pa = [], pb = [], pd = [], volume = [];
  const zPlan = (k, x, y) => pa[k] * x + pb[k] * y + pd[k];
  /** Plan des cellules (moindres carrés, deux tours de rejet des accidents), pente ramenée dans l'axe si elle en est proche. */
  const ajuster = (k, cellules) => {
    const s = volume[k];
    let a = 0, b = 0, d = 0, seuil = Infinity;
    for (let tour = 0; tour < 3; tour++) {
      let q = 0, sx = 0, sy = 0, sz = 0;
      for (const p of cellules) {
        const x = X(p), y = Y(p), z = val[p];
        if (Math.abs(z - a * x - b * y - d) > seuil) continue;
        q++; sx += x; sy += y; sz += z;
      }
      if (q < 3) { if (!tour) { d = q ? sz / q : val[cellules[0]]; } break; }
      const cx = sx / q, cy = sy / q, cz = sz / q;
      let xx = 0, xy = 0, yy = 0, xz = 0, yz = 0;
      for (const p of cellules) {
        const x = X(p), y = Y(p), z = val[p];
        if (Math.abs(z - a * x - b * y - d) > seuil) continue;
        xx += (x - cx) ** 2; xy += (x - cx) * (y - cy); yy += (y - cy) ** 2; xz += (x - cx) * (z - cz); yz += (y - cy) * (z - cz);
      }
      const det = xx * yy - xy * xy;
      let na = 0, nb = 0;
      if (det > 1e-6 * (xx + yy) ** 2 && det > 1e-9) { na = (xz * yy - yz * xy) / det; nb = (yz * xx - xz * xy) / det; }
      else if (xx + yy > 1e-9) { const t = (xz * xx + yz * yy) / (xx * xx + yy * yy); na = t * xx; nb = t * yy; } // cellules alignées
      // contrainte : plat, ou pente dans l'axe des façades (u ou v) si elle s'en écarte de moins de ~11°
      const gu = na * co[s] + nb * si[s], gv = -na * si[s] + nb * co[s];
      if (Math.hypot(gu, gv) < 0.04) na = nb = 0;
      else if (Math.abs(gv) <= 0.2 * Math.abs(gu) || Math.abs(gu) <= 0.2 * Math.abs(gv)) {
        const selonU = Math.abs(gu) > Math.abs(gv), ex = selonU ? co[s] : -si[s], ey = selonU ? si[s] : co[s];
        const t = (ex * xz + ey * yz) / (ex * ex * xx + 2 * ex * ey * xy + ey * ey * yy || 1);
        na = t * ex; nb = t * ey;
      }
      a = na; b = nb; d = cz - a * cx - b * cy;
      let r2 = 0;
      for (const p of cellules) { const r = val[p] - a * X(p) - b * Y(p) - d; if (Math.abs(r) <= seuil) r2 += r * r; }
      seuil = Math.max(0.15, 2 * Math.sqrt(r2 / q));
    }
    pa[k] = a; pb[k] = b; pd[k] = d;
  };

  // groupes de cellules voisines du même volume et de la même classe ; les trop petits sont défaits
  const pan = new Int32Array(N).fill(-1);
  for (let p0 = 0; p0 < N; p0++) {
    if (classe[p0] < 0 || pan[p0] !== -1) continue;
    const k = volume.length, s = seg[p0], cl = classe[p0], cellules = [p0];
    pan[p0] = k;
    for (let t = 0; t < cellules.length; t++) {
      const p = cellules[t], i = p % n;
      for (const r of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
        if (r >= 0 && r < N && pan[r] === -1 && seg[r] === s && classe[r] === cl) { pan[r] = k; cellules.push(r); }
    }
    // un vrai pan a de l'épaisseur : on compte ses cellules entourées de huit cellules du même groupe (une bande
    // d'une ou deux cellules le long d'un faîtage, classée « plat » par le bruit, n'en a aucune)
    let coeur = 0;
    if (cellules.length >= MINIMUM) for (const p of cellules) {
      const i = p % n;
      if (i > 0 && i < n - 1 && pan[p - n - 1] === k && pan[p - n] === k && pan[p - n + 1] === k && pan[p - 1] === k && pan[p + 1] === k
        && pan[p + n - 1] === k && pan[p + n] === k && pan[p + n + 1] === k && ++coeur >= 4) break;
    }
    if (coeur < 4) { for (const p of cellules) pan[p] = -2; continue; }
    volume.push(s);
    ajuster(k, cellules);
  }
  // les cellules sans pan rejoignent, de proche en proche, le pan voisin dont le plan passe le plus près
  const libres = [];
  for (const p of bati) if (seg[p] >= 0 && pan[p] < 0) libres.push(p);
  for (let reste = libres, tour = 0; reste.length && tour < 200; tour++) {
    const pris = [], suivant = [];
    for (const p of reste) {
      const i = p % n, x = X(p), y = Y(p);
      let mieux = -1, e = Infinity;
      for (const r of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n]) {
        if (r < 0 || r >= N || pan[r] < 0 || seg[r] !== seg[p]) continue;
        const d = Math.abs(zPlan(pan[r], x, y) - val[p]);
        if (d < e) { e = d; mieux = pan[r]; }
      }
      if (mieux >= 0) pris.push(p, mieux); else suivant.push(p);
    }
    if (!pris.length) break;
    for (let t = 0; t < pris.length; t += 2) pan[pris[t]] = pris[t + 1];
    reste = suivant;
  }
  // volumes sans aucun pan (petits, ou sans pente lisible) : un seul plan
  const seul = new Int32Array(nbVol).fill(-1);
  for (const p of libres) {
    if (pan[p] >= 0) continue;
    const s = seg[p];
    if (seul[s] < 0) { seul[s] = volume.length; volume.push(s); pa.push(0); pb.push(0); pd.push(val[p]); }
    pan[p] = seul[s];
  }
  const membres = () => {
    const L = volume.map(() => []);
    for (const p of bati) if (pan[p] >= 0) L[pan[p]].push(p);
    return L;
  };
  // (`touches` : seuls les pans dont les cellules ont changé sont réajustés)
  const refaire = touches => { const L = membres(); for (let k = 0; k < L.length; k++) if (L[k].length && (!touches || touches.has(k))) ajuster(k, L[k]); return L; };
  let L = refaire();

  // paires de pans qui se touchent : clé = petit numéro × K + grand numéro
  const K = () => volume.length;
  const voisinages = () => {
    const P = new Map(), k = K();
    for (const p of bati) {
      const A = pan[p];
      if (A < 0) continue;
      for (const q of [p % n < n - 1 ? p + 1 : -1, p + n < N ? p + n : -1]) {
        const B = q < 0 ? -1 : pan[q];
        if (B < 0 || B === A || seg[q] !== seg[p]) continue;
        const cle = A < B ? A * k + B : B * k + A;
        let e = P.get(cle);
        if (!e) P.set(cle, e = { A: Math.min(A, B), B: Math.max(A, B), bords: [] });
        e.bords.push(p, q);
      }
    }
    return P;
  };

  // réunion des pans voisins presque coplanaires (un même pan classé en deux morceaux, une bosse sans importance)
  for (let tour = 0; tour < 3; tour++) {
    const parent = volume.map((_, k) => k), racine = k => { while (parent[k] !== k) k = parent[k] = parent[parent[k]]; return k; };
    // écart quadratique moyen entre les plans A et B sur les cellules du pan g, d'après les moments de ce pan
    const M = L.map(cellules => {
      let sx = 0, sy = 0, xx = 0, xy = 0, yy = 0;
      for (const p of cellules) { const x = X(p), y = Y(p); sx += x; sy += y; xx += x * x; xy += x * y; yy += y * y; }
      return [cellules.length, sx, sy, xx, xy, yy];
    });
    const ecart = (A, B, g) => {
      const a = pa[A] - pa[B], b = pb[A] - pb[B], d = pd[A] - pd[B], [q, sx, sy, xx, xy, yy] = M[g];
      return Math.sqrt(Math.max(0, a * a * xx + b * b * yy + 2 * a * b * xy + 2 * a * d * sx + 2 * b * d * sy + q * d * d) / q);
    };
    let reunis = 0;
    for (const { A, B } of voisinages().values()) {
      if (racine(A) === racine(B) || ecart(A, B, A) > COPLANAIRE || ecart(A, B, B) > COPLANAIRE) continue;
      const g = L[A].length >= L[B].length ? A : B; // le plus grand garde son numéro
      parent[racine(g === A ? B : A)] = racine(g); reunis++;
    }
    if (!reunis) break;
    for (const p of bati) if (pan[p] >= 0) pan[p] = racine(pan[p]);
    L = refaire();
  }

  // paires jointives : les deux plans se croisent le long de la limite commune. `sens` = −1 si chaque pan est sous
  // l'autre de son côté (faîtage, arêtier : le toit suit le plus bas des deux plans), +1 sinon (noue : le plus haut).
  let jointives = new Map();
  const sens = (A, B) => jointives.get(A < B ? A * volume.length + B : B * volume.length + A) || 0;
  const jointures = () => {
    jointives = new Map();
    for (const [cle, { A, B, bords }] of voisinages()) {
      const da = pa[A] - pa[B], db = pb[A] - pb[B], dd = pd[A] - pd[B], pente = Math.hypot(da, db);
      if (pente < 0.1) continue; // plans parallèles : un décrochement, pas une arête
      let dist = 0, vote = 0;
      for (let t = 0; t < bords.length; t += 2) {
        const p = bords[t], q = bords[t + 1], pas = q - p;
        dist += Math.abs(da * (X(p) + X(q)) / 2 + db * (Y(p) + Y(q)) / 2 + dd);
        // deux cellules en retrait de la limite, de chaque côté : le signe de l'écart entre les plans doit s'y inverser
        let r = p, u = q;
        for (let e = 0; e < 2; e++) {
          if (pan[r - pas] === pan[p] && (pas !== 1 || r % n > 0)) r -= pas;
          if (pan[u + pas] === pan[q] && (pas !== 1 || u % n < n - 1)) u += pas;
        }
        const D = t => Math.sign(da * X(t) + db * Y(t) + dd);
        vote += pan[p] === A ? D(r) - D(u) : D(u) - D(r);
      }
      const nb = bords.length / 2;
      // (au moins trois cellules de limite commune : deux pans qui ne se touchent que par un coin n'ont pas d'arête)
      if (nb >= 3 && dist / nb / pente < PORTEE && Math.abs(vote) >= nb) jointives.set(cle, Math.sign(vote));
    }
  };
  // bilan par volume : résidu moyen et nombre de pans ; les volumes mal décrits sont écartés (ils gardent la grille)
  const tailleVol = new Int32Array(nbVol), ecarte = new Uint8Array(nbVol), replis = [];
  for (const p of bati) if (seg[p] >= 0) tailleVol[seg[p]]++;
  const trier = marge => {
    const residu = new Float64Array(nbVol), nbPans = new Int32Array(nbVol);
    L = membres();
    for (let k = 0; k < L.length; k++) {
      if (!L[k].length) continue;
      nbPans[volume[k]]++;
      for (const p of L[k]) residu[volume[k]] += Math.abs(val[p] - zPlan(k, X(p), Y(p)));
    }
    let nb = 0;
    for (let s = 0; s < nbVol; s++) {
      if (!tailleVol[s] || ecarte[s] || (residu[s] / tailleVol[s] <= RESIDU * marge && nbPans[s] <= (6 + tailleVol[s] / 80) * marge)) continue;
      ecarte[s] = 1; nb++;
      replis.push([tailleVol[s], +(residu[s] / tailleVol[s]).toFixed(2), nbPans[s]]);
    }
    if (nb) for (const p of bati) if (pan[p] >= 0 && ecarte[seg[p]]) pan[p] = -1;
    return { residu, nbPans };
  };
  trier(1.5); // les cas sans espoir (arbre pris pour un bâtiment, toit très découpé) sortent avant l'étape suivante

  // la limite entre deux pans jointifs glisse jusqu'à la droite d'intersection de leurs plans
  const glisser = () => {
    let file = [];
    for (const p of bati) if (pan[p] >= 0) file.push(p);
    const vu = new Int32Array(N).fill(-1);
    for (let tour = 0; tour < 16 && file.length; tour++) {
      const change = [];
      for (const p of file) {
        const A = pan[p], i = p % n, x = X(p), y = Y(p);
        let mieux = -1, e = 1e-3;
        for (let v = 0; v < 4; v++) {
          const r = v === 0 ? (i > 0 ? p - 1 : -1) : v === 1 ? (i < n - 1 ? p + 1 : -1) : v === 2 ? p - n : p + n, B = r >= 0 && r < N ? pan[r] : -1;
          if (B < 0 || B === A || seg[r] !== seg[p]) continue;
          const s = sens(A, B);
          if (!s) continue;
          const d = -s * (zPlan(A, x, y) - zPlan(B, x, y)); // > 0 : la cellule est du côté de B
          // (pas au-delà de la portée : sinon un pan en grignoterait un autre de proche en proche)
          if (d > e && d < PORTEE * Math.hypot(pa[A] - pa[B], pb[A] - pb[B])) { e = d; mieux = B; }
        }
        if (mieux >= 0) change.push(p, mieux);
      }
      for (let t = 0; t < change.length; t += 2) { touches.add(pan[change[t]]).add(change[t + 1]); pan[change[t]] = change[t + 1]; }
      // au tour suivant : seulement les cellules qui viennent de changer et leurs voisines
      file = [];
      for (let t = 0; t < change.length; t += 2) {
        const p = change[t], i = p % n;
        for (const r of [p, i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
          if (r >= 0 && r < N && pan[r] >= 0 && vu[r] !== tour) { vu[r] = tour; file.push(r); }
      }
    }
  };
  // limites en dents de scie (pans sans arête commune nette) : une cellule entourée d'un autre pan le rejoint
  const lisser = () => {
    const change = [], autour = new Int32Array(8);
    for (const p of bati) {
      const A = pan[p];
      if (A < 0) continue;
      const i = p % n, j = (p - i) / n;
      if (i < 1 || j < 1 || i > n - 2 || j > n - 2) continue;
      let memes = 0, q = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const r = p + dj * n + di, B = pan[r];
        if (r === p || seg[r] !== seg[p]) continue;
        if (B === A) memes++; else if (B >= 0) autour[q++] = B;
      }
      if (memes > 2 || q < 5) continue;
      for (let t = 0; t < q - 4; t++) {
        let nb = 1;
        for (let u = t + 1; u < q; u++) if (autour[u] === autour[t]) nb++;
        if (nb >= 5) { change.push(p, autour[t]); break; }
      }
    }
    for (let t = 0; t < change.length; t += 2) { touches.add(pan[change[t]]).add(change[t + 1]); pan[change[t]] = change[t + 1]; }
  };
  const touches = new Set();
  for (let tour = 0; tour < 2; tour++) { touches.clear(); jointures(); glisser(); lisser(); L = refaire(touches); }
  jointures(); glisser(); lisser();

  const { residu, nbPans } = trier(1), stats = { volumes: 0, enPans: 0, cellules: 0, cellulesEnPans: 0, pans: 0, residu: 0, ms: 0, replis };
  for (let s = 0; s < nbVol; s++) {
    if (!tailleVol[s]) continue;
    stats.volumes++; stats.cellules += tailleVol[s];
    if (ecarte[s]) continue;
    stats.enPans++; stats.cellulesEnPans += tailleVol[s]; stats.pans += nbPans[s]; stats.residu += residu[s];
  }
  stats.residu /= stats.cellulesEnPans || 1;
  const mixte = new Uint8Array(N);
  /** Autres pans du même volume autour de la cellule p (3 × 3). */
  const autres = p => {
    const A = pan[p], s = seg[p], i = p % n, j = (p - i) / n, r = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const B = pan[b * n + a];
      if (B >= 0 && B !== A && seg[b * n + a] === s && !r.includes(B)) r.push(B);
    }
    return r;
  };
  for (const p of bati) if (pan[p] >= 0 && autres(p).length) mixte[p] = 1;

  /** Pan du point (x, y), vu depuis une cellule de pan A entourée des pans `cand` : de part et d'autre de chaque arête. */
  const gagnant = (A, cand, x, y) => {
    const tous = [A, ...cand];
    let w = A;
    for (let tour = 0; tour < 2; tour++) for (const B of tous) {
      if (B === w) continue;
      const s = sens(w, B);
      if (s && s * (zPlan(w, x, y) - zPlan(B, x, y)) < -1e-9) w = B;
    }
    return w;
  };
  /** Droites d'intersection (a·x + b·y + d = 0) qui peuvent traverser la cellule p. */
  const droites = (A, cand) => {
    const D = [];
    for (let u = 0; u < cand.length; u++) {
      if (sens(A, cand[u])) D.push([pa[A] - pa[cand[u]], pb[A] - pb[cand[u]], pd[A] - pd[cand[u]]]);
      for (let v = u + 1; v < cand.length; v++)
        if (sens(cand[u], cand[v])) D.push([pa[cand[u]] - pa[cand[v]], pb[cand[u]] - pb[cand[v]], pd[cand[u]] - pd[cand[v]]]);
    }
    return D;
  };
  /** Coupe un polygone convexe (sommets [x, y, p0, p1, p2, p3]) par une droite : [côté positif, côté négatif]. */
  const couper = (poly, [a, b, d]) => {
    const e = poly.map(v => { const t = a * v[0] + b * v[1] + d; return Math.abs(t) < 1e-7 ? 0 : t; });
    if (!e.some(t => t > 0) || !e.some(t => t < 0)) return [poly];
    const plus = [], moins = [];
    for (let k = 0; k < poly.length; k++) {
      const v = poly[k], w = poly[(k + 1) % poly.length], ev = e[k], ew = e[(k + 1) % poly.length];
      if (ev >= 0) plus.push(v);
      if (ev <= 0) moins.push(v);
      if (ev * ew < 0) { const t = ev / (ev - ew), I = v.map((q, r) => q + (w[r] - q) * t); plus.push(I); moins.push(I); }
    }
    return [plus, moins].filter(q => q.length >= 3);
  };
  /**
   * Triangles du toit dans la cellule p (pan ≥ 0) : tableau de sommets [x, y, z, p0, p1, p2, p3], trois par triangle ;
   * p0..p3 = poids des quatre coins de la cellule (sud-ouest, sud-est, nord-est, nord-ouest), pour y interpoler une couleur.
   */
  const memo = new Map();
  const triangles = p => {
    if (!mixte[p]) return decouper(p);
    let T = memo.get(p);
    if (!T) memo.set(p, T = decouper(p));
    return T;
  };
  const decouper = p => {
    const i = p % n, j = (p - i) / n, k = j * m + i, A = pan[p];
    const S = [[px[k], py[k], 1, 0, 0, 0], [px[k + 1], py[k + 1], 0, 1, 0, 0], [px[k + m + 1], py[k + m + 1], 0, 0, 1, 0], [px[k + m], py[k + m], 0, 0, 0, 1]];
    const T = [], pose = (v, w) => T.push([v[0], v[1], zPlan(w, v[0], v[1]), v[2], v[3], v[4], v[5]]);
    let polys = [[S[0], S[1], S[2]], [S[0], S[2], S[3]]];
    if (!mixte[p]) { for (const q of polys) for (const v of q) pose(v, A); return T; }
    const cand = autres(p);
    for (const D of droites(A, cand)) polys = polys.flatMap(q => couper(q, D));
    const pans = polys.map(q => {
      let x = 0, y = 0;
      for (const v of q) { x += v[0]; y += v[1]; }
      const w = gagnant(A, cand, x / q.length, y / q.length);
      for (let t = 1; t < q.length - 1; t++) { pose(q[0], w); pose(q[t], w); pose(q[t + 1], w); }
      return w;
    });
    if (pans.every(w => w === pans[0])) return T;
    // deux morceaux voisins dont les plans ne se rejoignent pas le long de leur côté commun (rencontre de plusieurs
    // pans, ressaut) : un petit pan vertical ferme l'écart
    const cotes = new Map(), nom = v => Math.round(v[0] * 1e4) + "," + Math.round(v[1] * 1e4);
    polys.forEach((q, r) => {
      for (let t = 0; t < q.length; t++) {
        const a = q[t], b = q[(t + 1) % q.length], na = nom(a), nb = nom(b);
        if (na === nb) continue;
        const cle = na < nb ? na + "|" + nb : nb + "|" + na, autre = cotes.get(cle);
        if (!autre) { cotes.set(cle, pans[r]); continue; }
        const w = pans[r], za = zPlan(w, a[0], a[1]), zb = zPlan(w, b[0], b[1]), ya = zPlan(autre, a[0], a[1]), yb = zPlan(autre, b[0], b[1]);
        if (Math.abs(za - ya) < 0.005 && Math.abs(zb - yb) < 0.005) continue;
        const P = (v, z) => T.push([v[0], v[1], z, v[2], v[3], v[4], v[5]]);
        P(a, za); P(a, ya); P(b, yb); P(a, za); P(b, yb); P(b, zb);
      }
    });
    return T;
  };
  /**
   * Profil du toit le long d'un côté de la cellule p (0 sud, 1 est, 2 nord, 3 ouest) : segments [t1, z1, t2, z2], où t va
   * de 0 à 1 d'ouest en est ou du sud au nord. Murs et raccords entre cellules s'y accrochent : pas de fente possible.
   */
  const profil = (p, cote) => {
    const i = p % n, j = (p - i) / n, k = j * m + i;
    if (!mixte[p]) {
      const ka = cote === 1 ? k + 1 : cote === 2 ? k + m : k, kb = cote === 0 ? k + 1 : cote === 3 ? k + m : k + m + 1;
      return [[0, zPlan(pan[p], px[ka], py[ka]), 1, zPlan(pan[p], px[kb], py[kb])]];
    }
    // sommets sur ce côté : poids nuls pour les deux coins d'en face ; t = poids du coin d'arrivée
    const T = triangles(p), r = [], [n1, n2, it] = [[5, 6, 4], [3, 6, 5], [3, 4, 5], [4, 5, 6]][cote];
    for (let t = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = T[t + e], b = T[t + (e + 1) % 3];
      if (!a[n1] && !a[n2] && !b[n1] && !b[n2] && a[it] !== b[it]) r.push(a[it] < b[it] ? [a[it], a[2], b[it], b[2]] : [b[it], b[2], a[it], a[2]]);
    }
    return r;
  };
  /** Hauteur du toit au point (x, y) vu de la cellule p. */
  const zEn = (p, x, y) => zPlan(mixte[p] ? gagnant(pan[p], autres(p), x, y) : pan[p], x, y);
  /** Hauteur du toit en pans au point (x, y) ; NaN hors des volumes modélisés. */
  const hauteurEn = (x, y) => {
    const i = Math.min(n - 1, Math.max(0, Math.floor((x - x0) / c))), j = Math.min(n - 1, Math.max(0, Math.floor((y - x0) / c)));
    if (pan[j * n + i] >= 0) return zEn(j * n + i, x, y);
    if (seg[j * n + i] >= 0) return NaN; // volume resté en grille
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { // bord redressé : la cellule est vide, on prend la voisine
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < n && b < n && pan[b * n + a] >= 0) return zEn(b * n + a, x, y);
    }
    return NaN;
  };
  stats.ms = performance.now() - debut;
  return { pan, mixte, plans: volume.map((_, k) => [pa[k], pb[k], pd[k]]), volume, stats, triangles, profil, hauteurEn };
}
