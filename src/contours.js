// Contours des bâtiments. La grille de 0,5 m donne des bords en escalier : on découpe chaque bâtiment en volumes de
// hauteur continue (corps principal, annexe basse, lucarne…), on suit le bord de chaque volume, on le simplifie en
// côtés droits (Douglas-Peucker), on redresse les côtés proches de l'orientation dominante, puis on ramène les coins
// de la grille situés au bord sur ces côtés. Les toits gardent la grille de hauteurs, mais leurs bords (et donc les
// murs, y compris entre deux volumes de hauteurs différentes) deviennent rectilignes. Seul l'affichage change :
// le calcul des heures de soleil continue d'utiliser la grille.

/**
 * @returns {{ px, py, seg, val, hauteurCoin, boucles }}
 *   px, py  : position (m, relative) de chaque coin de la grille, (n+1)² valeurs ; déplacée pour les coins de bord.
 *   seg     : numéro de volume de chaque cellule (−1 = vide) ; val : hauteurs affichées (petits accidents lissés).
 *   hauteurCoin(k, s) : hauteur du toit du volume s au coin k (moyenne de ses cellules voisines).
 *   boucles : { coins: Int32Array (indices de coins, dans l'ordre, volume à gauche), sommets: number[] (positions
 *             dans `coins` des sommets du polygone simplifié), hauts: Float32Array (hauteur du toit à chaque coin), seg }.
 */
export function contoursBatiments(G, source = G.bat, tolerance = 0.6, saut = 1.2) {
  const { n, c, x0 } = G, m = n + 1, tol = tolerance / c, val = Float32Array.from(source);
  // modèle en grille sans classes : au bord des bâtiments, la surface descend en pente vers le sol sur une ou deux
  // cellules ; on remonte ces cellules à la hauteur du toit voisin pour retrouver un bord franc
  if (!G.classifie) for (let tour = 0; tour < 2; tour++) {
    const avant = Float32Array.from(val);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const p = j * n + i;
      if (isNaN(avant[p]) || !(isNaN(avant[p - 1]) || isNaN(avant[p + 1]) || isNaN(avant[p - n]) || isNaN(avant[p + n]))) continue;
      let haut = -Infinity;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const v = avant[p + dj * n + di]; if (v > haut) haut = v; }
      if (haut - avant[p] > saut) val[p] = haut;
    }
  }
  // volumes : cellules voisines dont la hauteur diffère de moins de `saut`
  const seg = new Int32Array(n * n).fill(-1), tailles = [], sommes = [];
  for (let p0 = 0; p0 < n * n; p0++) {
    if (isNaN(val[p0]) || seg[p0] >= 0) continue;
    const s = tailles.length, pile = [p0];
    let q = 0, somme = 0;
    seg[p0] = s;
    while (pile.length) {
      const p = pile.pop(), i = p % n;
      q++; somme += val[p];
      for (const r of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
        if (r >= 0 && r < n * n && seg[r] < 0 && Math.abs(val[r] - val[p]) < saut) { seg[r] = s; pile.push(r); }
    }
    tailles.push(q); sommes.push(somme);
  }
  // les tout petits volumes (cheminée, cellule de bord trop basse…) rejoignent leur voisin et prennent sa hauteur
  for (let tour = 0; tour < 3; tour++) for (let p = 0; p < n * n; p++) {
    const s = seg[p];
    if (s < 0 || tailles[s] >= 8) continue;
    const i = p % n;
    let h = 0, q = 0, cible = -1;
    for (const r of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
      if (r >= 0 && r < n * n && seg[r] >= 0 && tailles[seg[r]] >= 8) { h += val[r]; q++; cible = seg[r]; }
    if (q) { seg[p] = cible; val[p] = h / q; tailles[cible]++; sommes[cible] += val[p]; }
  }
  const dedans = (i, j, s) => i >= 0 && j >= 0 && i < n && j < n && seg[j * n + i] === s;
  const hauteurCoin = (k, s) => {
    const i = k % m, j = (k - i) / m;
    let h = 0, q = 0;
    if (dedans(i - 1, j - 1, s)) { h += val[(j - 1) * n + i - 1]; q++; }
    if (dedans(i, j - 1, s)) { h += val[(j - 1) * n + i]; q++; }
    if (dedans(i - 1, j, s)) { h += val[j * n + i - 1]; q++; }
    if (dedans(i, j, s)) { h += val[j * n + i]; q++; }
    return q ? h / q : NaN;
  };
  const px = new Float32Array(m * m), py = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) { px[j * m + i] = x0 + i * c; py[j * m + i] = x0 + j * c; }
  // arêtes de bord orientées (volume à gauche) : un bit par direction de départ, 0 = +x, 1 = +y, 2 = −x, 3 = −y
  const depart = new Uint8Array(m * m);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const s = seg[j * n + i];
    if (s < 0) continue;
    if (!dedans(i, j - 1, s)) depart[j * m + i] |= 1;
    if (!dedans(i + 1, j, s)) depart[j * m + i + 1] |= 2;
    if (!dedans(i, j + 1, s)) depart[(j + 1) * m + i + 1] |= 4;
    if (!dedans(i - 1, j, s)) depart[(j + 1) * m + i] |= 8;
  }
  // volume auquel appartient l'arête qui part du coin k dans la direction d
  const proprio = (k, d) => { const i = k % m, j = (k - i) / m; return seg[(d === 0 || d === 1 ? j : j - 1) * n + (d === 0 || d === 3 ? i : i - 1)]; };
  const pas = [1, m, -1, -m], brutes = [];
  for (let k0 = 0; k0 < m * m; k0++) {
    while (depart[k0]) {
      const d0 = Math.log2(depart[k0] & -depart[k0]) | 0, s = proprio(k0, d0), coins = [];
      let k = k0, d = d0;
      for (;;) {
        coins.push(k);
        depart[k] &= ~(1 << d);
        k += pas[d];
        // au coin suivant : d'abord à gauche (deux cellules qui ne se touchent que par un coin restent séparées)
        let suite = -1;
        for (const t of [(d + 1) % 4, d, (d + 3) % 4]) {
          if (k === k0 && t === d0) { suite = -2; break; }
          if ((depart[k] & (1 << t)) && proprio(k, t) === s) { suite = t; break; }
        }
        if (suite < 0) break;
        d = suite;
      }
      brutes.push({ coins, seg: s });
    }
  }
  // les volumes les plus hauts d'abord : leurs murs fixent la position des coins partagés avec les volumes plus bas
  brutes.sort((a, b) => sommes[b.seg] / tailles[b.seg] - sommes[a.seg] / tailles[a.seg]);
  const fixe = new Uint8Array(m * m), boucles = [];
  for (const B of brutes) {
    const r = simplifier(B.coins, m, tol, px, py, c, x0, fixe);
    r.seg = B.seg;
    r.hauts = Float32Array.from(r.coins, k => hauteurCoin(k, B.seg));
    boucles.push(r);
  }
  return { px, py, seg, val, hauteurCoin, boucles };
}

/** Simplifie une boucle de coins et déplace ses coins sur les côtés droits obtenus. */
function simplifier(coins, m, tol, px, py, c, x0, fixe) {
  const N = coins.length, X = new Float32Array(N + 1), Y = new Float32Array(N + 1);
  // départ au point le plus éloigné du premier (un vrai sommet du contour)
  let A = 0, dA = -1;
  for (let k = 0; k < N; k++) {
    const d = Math.hypot(coins[k] % m - coins[0] % m, Math.floor(coins[k] / m) - Math.floor(coins[0] / m));
    if (d > dA) { dA = d; A = k; }
  }
  const ordre = new Int32Array(N);
  for (let k = 0; k < N; k++) { ordre[k] = coins[(A + k) % N]; X[k] = ordre[k] % m; Y[k] = Math.floor(ordre[k] / m); }
  X[N] = X[0]; Y[N] = Y[0];
  let B = 0, dB = -1;
  for (let k = 1; k < N; k++) { const d = Math.hypot(X[k] - X[0], Y[k] - Y[0]); if (d > dB) { dB = d; B = k; } }
  // Douglas-Peucker sur les deux moitiés
  const garde = new Uint8Array(N + 1), pile = [[0, B], [B, N]];
  garde[0] = garde[B] = garde[N] = 1;
  while (pile.length) {
    const [a, b] = pile.pop();
    if (b - a < 2) continue;
    const dx = X[b] - X[a], dy = Y[b] - Y[a], L = Math.hypot(dx, dy) || 1;
    let pire = 0, kp = -1;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((X[k] - X[a]) * dy - (Y[k] - Y[a]) * dx) / L;
      if (d > pire) { pire = d; kp = k; }
    }
    if (pire > tol) { garde[kp] = 1; pile.push([a, kp], [kp, b]); }
  }
  // les deux points de départ ne sont pas forcément des sommets : on les retire s'ils sont sur un côté droit
  for (const k of [0, B]) {
    let a = k - 1, b = k + 1;
    while (!garde[(a + N) % N]) a--;
    while (!garde[b % N]) b++;
    const xa = X[(a + N) % N], ya = Y[(a + N) % N], dx = X[b % N] - xa, dy = Y[b % N] - ya, L = Math.hypot(dx, dy);
    if (L < 1e-6 || b - a >= N) continue;
    let pire = 0;
    for (let q = a + 1; q < b; q++) pire = Math.max(pire, Math.abs((X[(q + N) % N] - xa) * dy - (Y[(q + N) % N] - ya) * dx) / L);
    if (pire <= tol) garde[k] = 0;
  }
  const K = [];
  for (let k = 0; k < N; k++) if (garde[k]) K.push(k);
  const sortie = { coins: ordre, sommets: K };
  if (K.length < 3 || N < 8) { for (const k of ordre) fixe[k] = 1; return sortie; } // trop petit : on garde l'escalier
  // droite ajustée à chaque côté (moindres carrés sur les coins du côté)
  const ajuster = (a, b) => {
    let sx = 0, sy = 0;
    for (let k = a; k <= b; k++) { sx += X[k % N]; sy += Y[k % N]; }
    const q = b - a + 1, cx = sx / q, cy = sy / q;
    let xx = 0, yy = 0, xy = 0;
    for (let k = a; k <= b; k++) { xx += (X[k % N] - cx) ** 2; yy += (Y[k % N] - cy) ** 2; xy += (X[k % N] - cx) * (Y[k % N] - cy); }
    let ang = 0.5 * Math.atan2(2 * xy, xx - yy);
    if (Math.cos(ang) * (X[b % N] - X[a % N]) + Math.sin(ang) * (Y[b % N] - Y[a % N]) < 0) ang += Math.PI;
    return { a, b, cx, cy, ang, L: Math.hypot(X[b % N] - X[a % N], Y[b % N] - Y[a % N]) };
  };
  const ecart = (D, a, b) => { // plus grand écart des coins a..b à la droite D
    const ux = Math.cos(D.ang), uy = Math.sin(D.ang);
    let pire = 0;
    for (let k = a; k <= b; k++) pire = Math.max(pire, Math.abs((X[k % N] - D.cx) * uy - (Y[k % N] - D.cy) * ux));
    return pire;
  };
  const S = K.length;
  let droites = [];
  for (let i = 0; i < S; i++) droites.push(ajuster(K[i], i + 1 < S ? K[i + 1] : N + K[0]));
  // coin tronqué : un côté très court entre deux côtés qui se croisent tout près est remplacé par leur intersection
  const croisement = (P, Q) => {
    const ux = Math.cos(P.ang), uy = Math.sin(P.ang), vx = Math.cos(Q.ang), vy = Math.sin(Q.ang), det = ux * vy - uy * vx;
    if (Math.abs(det) < 0.17) return null;
    const t = ((Q.cx - P.cx) * vy - (Q.cy - P.cy) * vx) / det;
    return [P.cx + t * ux, P.cy + t * uy];
  };
  let reste = S;
  for (let i = 0; i < S && reste > 4; i++) {
    const D = droites[i], P = droites[(i + S - 1) % S], Q = droites[(i + 1) % S];
    if (D.L > 4 || P.retire || Q.retire) continue;
    const I = croisement(P, Q);
    if (I && Math.hypot(I[0] - X[D.a], I[1] - Y[D.a]) <= 2.5 && Math.hypot(I[0] - X[D.b % N], I[1] - Y[D.b % N]) <= 2.5) { D.retire = true; reste--; }
  }
  // deux côtés voisins presque alignés n'en font qu'un
  let cotes = droites.filter(D => !D.retire);
  for (let i = 0; cotes.length > 3 && i < cotes.length;) {
    const P = cotes[i], Q = cotes[(i + 1) % cotes.length];
    let da = Math.abs(P.ang - Q.ang) % (2 * Math.PI);
    if (da > Math.PI) da = 2 * Math.PI - da;
    const U = da < 0.2 && P.b % N === Q.a % N ? ajuster(P.a, Q.b >= P.b ? Q.b : Q.b + N) : null;
    if (U && ecart(U, U.a, U.b) <= 1) {
      cotes[i] = U;
      cotes.splice((i + 1) % cotes.length, 1);
      if (i >= cotes.length) i = cotes.length - 1;
    } else i++;
  }
  const T = cotes.length;
  // redressement : un côté proche de l'orientation dominante (à 90° près) la prend, s'il reste collé à ses coins
  let c4 = 0, s4 = 0;
  for (const D of cotes) { c4 += D.L * Math.cos(4 * D.ang); s4 += D.L * Math.sin(4 * D.ang); }
  const dominante = Math.atan2(s4, c4) / 4;
  for (const D of cotes) {
    const q = Math.round((D.ang - dominante) / (Math.PI / 2)), cible = dominante + q * Math.PI / 2;
    if (Math.abs(D.ang - cible) <= 0.35 && ecart({ ...D, ang: cible }, D.a, D.b) <= 0.9) D.ang = cible;
  }
  // sommets : intersection de deux côtés consécutifs (sinon le coin d'origine)
  const VX = new Float32Array(T + 1), VY = new Float32Array(T + 1);
  for (let i = 0; i < T; i++) {
    const Q = cotes[i], I = croisement(cotes[(i + T - 1) % T], Q);
    VX[i] = X[Q.a]; VY[i] = Y[Q.a];
    if (I && Math.hypot(I[0] - X[Q.a], I[1] - Y[Q.a]) <= 2.5) { VX[i] = I[0]; VY[i] = I[1]; }
  }
  VX[T] = VX[0]; VY[T] = VY[0];
  // coins de bord ramenés sur leur côté (ceux d'un côté retiré vont au sommet)
  for (let i = 0; i < T; i++) {
    const a = cotes[i].a, b = i + 1 < T ? cotes[i + 1].a : N + cotes[0].a;
    const dx = VX[i + 1] - VX[i], dy = VY[i + 1] - VY[i], L2 = dx * dx + dy * dy;
    let tPrec = 0;
    for (let q = a; q < b; q++) {
      const k = q % N;
      let t = q === a || L2 < 1e-9 ? 0 : ((X[k] - VX[i]) * dx + (Y[k] - VY[i]) * dy) / L2;
      t = tPrec = Math.min(1, Math.max(tPrec, t));
      if (fixe[ordre[k]]) continue; // déjà placé par un volume plus haut
      px[ordre[k]] = x0 + (VX[i] + t * dx) * c; py[ordre[k]] = x0 + (VY[i] + t * dy) * c;
    }
  }
  sortie.sommets = cotes.map(D => D.a);
  for (const k of ordre) fixe[k] = 1;
  return sortie;
}

/** Vrai si le point (x, y) est dans un bâtiment tel qu'affiché (règle pair-impair sur toutes les boucles). */
export function dansBatiment(contours, x, y) {
  let dedans = false;
  for (const B of contours.boucles) {
    if (!B.boite) {
      let a = Infinity, b = Infinity, d = -Infinity, e = -Infinity;
      for (const k of B.coins) { a = Math.min(a, contours.px[k]); b = Math.min(b, contours.py[k]); d = Math.max(d, contours.px[k]); e = Math.max(e, contours.py[k]); }
      B.boite = [a, b, d, e];
    }
    if (x < B.boite[0] || y < B.boite[1] || x > B.boite[2] || y > B.boite[3]) continue;
    const s = B.sommets, q = s.length;
    for (let i = 0, j = q - 1; i < q; j = i++) {
      const xi = contours.px[B.coins[s[i]]], yi = contours.py[B.coins[s[i]]], xj = contours.px[B.coins[s[j]]], yj = contours.py[B.coins[s[j]]];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dedans = !dedans;
    }
  }
  return dedans;
}
