// Géométries de la scène : terrain et socle, bâtiments (toits + murs droits), canopée, nuages de points, limite de parcelle.
// Repère three.js : x = est, y = altitude (relative à zRef), z = sud (−nord).
import * as THREE from "three";
import { solEn } from "./grille.js";
import { contoursBatiments } from "./contours.js";
import { pansToits } from "./pans.js";

/** Suite de nombres dans un tableau typé qui grandit par doublement, quand la taille n'est pas connue d'avance. */
class Tampon {
  constructor(Type = Float32Array, taille = 4096) { this.a = new Type(taille); this.n = 0; }
  ajouter(...v) {
    if (this.n + v.length > this.a.length) {
      const b = new this.a.constructor(Math.max(2 * this.a.length, this.n + v.length));
      b.set(this.a.subarray(0, this.n)); this.a = b;
    }
    for (let k = 0; k < v.length; k++) this.a[this.n++] = v[k];
  }
  /** Tableau ajusté à la taille utile. */
  fin() { return this.a.slice(0, this.n); }
}

/** Après l'envoi à la carte graphique, la copie en mémoire vive ne sert plus (couches jamais relues ni exportées). */
function jetable(g, garder = []) {
  g.computeBoundingSphere();
  for (const [nom, a] of [...Object.entries(g.attributes), ["index", g.index]]) if (!garder.includes(nom)) a?.onUpload(function () { this.array = null; });
  return g;
}

/** Terrain (un sommet tous les mètres) avec coordonnées de texture pour le fond de plan. */
export function terrain(G, zRef) {
  const pas = 2, m = Math.floor(G.n / pas) + 1, pos = new Float32Array(m * m * 3), uv = new Float32Array(m * m * 2);
  // maquette ronde : les sommets hors du cercle sont ramenés sur le cercle (le bord devient rond), les triangles
  // entièrement dehors sont retirés
  const Rz = G.rayonZone, dehors = new Uint8Array(m * m);
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
    let x = G.x0 + a * pas * G.c, y = G.x0 + b * pas * G.c;
    const k = b * m + a, d = Math.hypot(x, y);
    if (Rz && d > Rz) { x *= Rz / d; y *= Rz / d; dehors[k] = 1; }
    pos[3 * k] = x; pos[3 * k + 1] = solEn(G, x, y) - zRef; pos[3 * k + 2] = -y;
    uv[2 * k] = (x - G.x0) / (2 * G.R); uv[2 * k + 1] = (y - G.x0) / (2 * G.R);
  }
  const idx = new Uint32Array((m - 1) * (m - 1) * 6);
  let q = 0;
  for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
    const p = b * m + a;
    if (!(dehors[p] && dehors[p + 1] && dehors[p + m + 1])) { idx[q++] = p; idx[q++] = p + 1; idx[q++] = p + m + 1; }
    if (!(dehors[p] && dehors[p + m + 1] && dehors[p + m])) { idx[q++] = p; idx[q++] = p + m + 1; idx[q++] = p + m; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, q), 1));
  g.computeVertexNormals();
  return g;
}

/** Hauteur du terrain tel qu'affiché (triangles de 1 m) au coin (i, j) de la grille : sert à poser des calques dessus. */
export function hauteurTerrain(G, i, j) {
  const pas = 2, a = Math.min(Math.floor(i / pas), Math.floor(G.n / pas) - 1), b = Math.min(Math.floor(j / pas), Math.floor(G.n / pas) - 1);
  const u = (i - a * pas) / pas, v = (j - b * pas) / pas, z = (a, b) => solEn(G, G.x0 + a * pas * G.c, G.x0 + b * pas * G.c);
  const z00 = z(a, b), z11 = z(a + 1, b + 1);
  return u >= v ? z00 + u * (z(a + 1, b) - z00) + v * (z11 - z(a + 1, b)) : z00 + u * (z11 - z(a, b + 1)) + v * (z(a, b + 1) - z00);
}

/**
 * Socle : bords verticaux jusqu'à une base plane, comme une maquette posée. Là où un bâtiment touche le bord, la face
 * monte jusqu'à son toit : la tranche du bâtiment coupé fait partie du socle (une seule masse).
 */
/**
 * Socle d'une maquette ronde : la paroi du cercle de rayon `R`, du terrain (et du toit des bâtiments coupés par le
 * cercle, si `bat`) jusqu'au fond `zBas`. `solA(x, y)` : altitude absolue du terrain au bord.
 */
export function socleRond(R, solA, zRef, zBas, batA = null) {
  const nb = Math.min(4096, Math.max(256, Math.ceil(2 * Math.PI * R))), pos = new Float32Array(nb * 18);
  const haut = a => {
    const x = Math.cos(a) * R, y = Math.sin(a) * R, z = solA(x, y), b = batA ? batA(x * 0.998, y * 0.998) : NaN;
    return [x, (b > z ? b : z) - zRef, y];
  };
  let q = 0, A = haut(0);
  for (let k = 1; k <= nb; k++) {
    const B = haut(k / nb * 2 * Math.PI);
    // A, A bas, B bas ; A, B bas, B (sens trigonométrique vu de dessus : face vers l'extérieur)
    for (const [x, z, y] of [[A[0], A[1], A[2]], [A[0], zBas, A[2]], [B[0], zBas, B[2]], [A[0], A[1], A[2]], [B[0], zBas, B[2]], [B[0], B[1], B[2]]]) { pos[q++] = x; pos[q++] = z; pos[q++] = -y; }
    A = B;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function socle(G, zRef, zBas, bords = null, avecReleve = true) {
  // le haut de la paroi monte jusqu'au niveau de l'eau là où le lac touche le bord (sinon l'eau flotte au-dessus)
  const eauEn = (x, y) => { const i = Math.floor((x - G.x0) / G.c), j = Math.floor((y - G.x0) / G.c); return !G.eau || i < 0 || j < 0 || i >= G.n || j >= G.n ? NaN : G.eau[j * G.n + i]; };
  if (G.rayonZone) {
    // haut de la paroi : le toit de nos bâtiments (relevé affiché) et/ou de ceux de comparaison (`bords` = grille de
    // hauteurs des bâtiments swisstopo ou roofer affichés), là où ils sont coupés par le cercle
    const cellule = (a, x, y) => { const i = Math.floor((x - G.x0) / G.c), j = Math.floor((y - G.x0) / G.c); return !a || i < 0 || j < 0 || i >= G.n || j >= G.n ? NaN : a[j * G.n + i]; };
    const grille = bords instanceof Float32Array ? bords : null;
    return socleRond(G.rayonZone, (x, y) => { const z = solEn(G, x, y), e = eauEn(x * 0.995, y * 0.995); return e > z ? e : z; }, zRef, zBas,
      (avecReleve || grille) ? (x, y) => Math.max(avecReleve ? cellule(G.bat, x, y) || -Infinity : -Infinity, cellule(grille, x, y) || -Infinity) : null);
  }
  // `bords` (facultatif) : hauteurs absolues des bâtiments de comparaison qui traversent chaque côté, par cellule
  const { n, c, x0, bat } = G, R = n * c / 2, pos = new Float32Array(4 * n * 18);
  // terrain du bord : comme le maillage du terrain (sommets tous les 1 m, interpolés entre deux)
  const sol = (x, y) => {
    const t = (v) => Math.floor((v - x0) / (2 * c)) * 2 * c + x0;
    if (Math.abs(Math.abs(x) - R) < 1e-6) { const y0 = t(Math.min(y, R - 2 * c)), u = (y - y0) / (2 * c); return solEn(G, x, y0) * (1 - u) + solEn(G, x, y0 + 2 * c) * u; }
    const xa = t(Math.min(x, R - 2 * c)), u = (x - xa) / (2 * c); return solEn(G, xa, y) * (1 - u) + solEn(G, xa + 2 * c, y) * u;
  };
  // les quatre côtés, cellule par cellule : cellule (i, j), extrémités (x, y) du segment de bord
  let q = 0;
  const face = (i, j, xa, ya, xb, yb, cote, k) => {
    const b = bords?.[cote][k];
    const h = Math.max(avecReleve && bat[j * n + i] || -Infinity, b > -Infinity ? b : -Infinity), za = Math.max(sol(xa, ya), eauEn(xa * 0.999, ya * 0.999) || -Infinity), zb = Math.max(sol(xb, yb), eauEn(xb * 0.999, yb * 0.999) || -Infinity);
    const ha = (h > -Infinity ? Math.max(za, h) : za) - zRef, hb = (h > -Infinity ? Math.max(zb, h) : zb) - zRef;
    // A, A bas, B bas ; A, B bas, B
    for (const [x, y, z] of [[xa, ha, -ya], [xa, zBas, -ya], [xb, zBas, -yb], [xa, ha, -ya], [xb, zBas, -yb], [xb, hb, -yb]]) { pos[q++] = x; pos[q++] = y; pos[q++] = z; }
  };
  for (let i = 0; i < n; i++) face(i, 0, x0 + i * c, -R, x0 + (i + 1) * c, -R, 0, i);
  for (let j = 0; j < n; j++) face(n - 1, j, R, x0 + j * c, R, x0 + (j + 1) * c, 1, j);
  for (let i = n - 1; i >= 0; i--) face(i, n - 1, x0 + (i + 1) * c, R, x0 + i * c, R, 2, i);
  for (let j = n - 1; j >= 0; j--) face(0, j, -R, x0 + (j + 1) * c, -R, x0 + j * c, 3, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Nappe d'une grille de hauteurs (NaN = vide), lissée aux coins. Avec `C` (contours des bâtiments), chaque volume
 * a sa propre nappe (pas de pente entre deux toits de hauteurs différentes) et les coins de bord sont redressés.
 * `sauf` (numéro de pan par cellule) écarte les cellules déjà couvertes par un pan de toit.
 */
export function nappe(G, val, zRef, C, sauf, normales = true) {
  const { n, c, x0 } = G, m = n + 1;
  const rang = new Int32Array(m * m).fill(-1), vol = new Int32Array(m * m).fill(-1);
  const coin = k => { // sans contours : moyenne des cellules renseignées autour du coin
    const i = k % m, j = (k - i) / m;
    let s = 0, q = 0;
    if (i > 0 && j > 0) { const v = val[(j - 1) * n + i - 1]; if (!isNaN(v)) { s += v; q++; } }
    if (i < n && j > 0) { const v = val[(j - 1) * n + i]; if (!isNaN(v)) { s += v; q++; } }
    if (i > 0 && j < n) { const v = val[j * n + i - 1]; if (!isNaN(v)) { s += v; q++; } }
    if (i < n && j < n) { const v = val[j * n + i]; if (!isNaN(v)) { s += v; q++; } }
    return s / q;
  };
  const volume = p => C ? ((sauf && sauf[p] >= 0) ? -1 : C.seg[p]) : isNaN(val[p]) ? -1 : 0;
  // deux passes, pour des tableaux typés à la bonne taille : compter cellules et sommets, puis remplir
  let pos = null, idx = null, vols = null, ns = 0, nc = 0;
  const sommet = (k, s) => {
    if (rang[k] < 0 || vol[k] !== s) {
      rang[k] = ns; vol[k] = s;
      if (pos) {
        if (C) { pos[3 * ns] = C.px[k]; pos[3 * ns + 1] = C.hauteurCoin(k, s) - zRef; pos[3 * ns + 2] = -C.py[k]; }
        else { pos[3 * ns] = x0 + (k % m) * c; pos[3 * ns + 1] = coin(k) - zRef; pos[3 * ns + 2] = -(x0 + Math.floor(k / m) * c); }
      }
      ns++;
    }
    return rang[k];
  };
  for (const remplir of [false, true]) {
    if (remplir) {
      pos = new Float32Array(3 * ns); idx = new Uint32Array(6 * nc); vols = new Int32Array(nc);
      rang.fill(-1); vol.fill(-1); ns = nc = 0;
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const s = volume(j * n + i);
      if (s < 0) continue;
      const A = sommet(j * m + i, s), B = sommet(j * m + i + 1, s), D = sommet((j + 1) * m + i + 1, s), E = sommet((j + 1) * m + i, s);
      if (remplir) {
        const q = 6 * nc;
        idx[q] = A; idx[q + 1] = B; idx[q + 2] = D; idx[q + 3] = A; idx[q + 4] = D; idx[q + 5] = E;
        vols[nc] = s;
      }
      nc++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (normales) g.computeVertexNormals();
  g.userData.volumes = vols; // volume de chaque paire de triangles (désignation au clic, mode pro)
  return g;
}

/**
 * Canopée qui porte l'ombre des arbres en points : jamais affichée, elle est construite à 1 m (4 fois moins de
 * triangles que la grille de 0,5 m ; l'ombre, adoucie, reste la même) et sans normales.
 */
export function canopee(G, zRef) {
  const { n, c, x0, veg } = G, m = Math.ceil(n / 2), val = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    let s = 0, q = 0;
    for (let b = 2 * j; b < Math.min(n, 2 * j + 2); b++) for (let a = 2 * i; a < Math.min(n, 2 * i + 2); a++) {
      const v = veg[b * n + a];
      if (!isNaN(v)) { s += v; q++; }
    }
    val[j * m + i] = q ? s / q : NaN;
  }
  return jetable(nappe({ n: m, c: 2 * c, x0 }, val, zRef, null, null, false));
}

/**
 * Bâtiments : toits et murs plans, du toit jusqu'au sol. `pans` = faux (par défaut) : toits du relevé (grille de
 * hauteurs) ; vrai : toits en pans plans dont les arêtes suivent les façades (pans.js), la grille ne restant que pour
 * les volumes qui ne s'y prêtent pas. `contours` permet de réutiliser les contours déjà calculés (changement de style).
 * Retourne aussi les contours du style choisi : hauteur des murs (`hauts`) et, en pans, `pans` (hauteurs du toit).
 */
export function batiments(G, zRef, pans = false, contours = contoursBatiments(G)) {
  const C0 = contours.base || contours, P = pans ? (C0.pansCalcules ||= pansToits(G, C0)) : null, { n } = G, m = n + 1, pos = new Tampon(), vols = new Tampon(Int32Array, 1024);
  const entre = (a, b, t) => t === 0 ? a : t === 1 ? b : a + (b - a) * t; // les bouts exacts : murs du relevé inchangés
  const boucles = C0.boucles.map(B => {
    const q = B.coins.length, hauts = P ? new Float32Array(q) : B.hauts, aretes = new Array(q);
    for (let k = 0; k < q; k++) {
      const a = B.coins[k], b = B.coins[(k + 1) % q];
      const xa = C0.px[a], ya = C0.py[a], xb = C0.px[b], yb = C0.py[b];
      let profil = [[0, B.hauts[k], 1, B.hauts[(k + 1) % q]]];
      if (P) {
        // cellule du volume à gauche de l'arête : le mur reprend le profil de son toit le long de ce côté (un faîtage
        // qui arrive au bord y ajoute un sommet) ; vers l'ouest ou le sud, le profil se lit à l'envers
        const d = b - a, i = a % m, j = (a - i) / m, p = (d === 1 || d === m ? j : j - 1) * n + (d === 1 || d === -m ? i : i - 1);
        if (P.pan[p] >= 0) {
          profil = P.profil(p, d === 1 ? 0 : d === m ? 1 : d === -1 ? 2 : 3);
          if (d < 0) profil = profil.map(([t1, z1, t2, z2]) => [1 - t2, z2, 1 - t1, z1]);
        }
        hauts[k] = profil.reduce((h, S) => S[0] === 0 ? Math.max(h, S[1]) : h, -Infinity);
        if (hauts[k] === -Infinity) hauts[k] = B.hauts[k];
      }
      aretes[k] = { xa, ya, xb, yb, profil };
    }
    // murs : un seul tenant par côté droit du contour (entre deux sommets du polygone simplifié), au lieu d'un morceau
    // par cellule ; le haut (bord du toit) et le pied sont simplifiés, avec peu de triangles (export plus propre)
    const S = B.sommets?.length >= 3 ? B.sommets : [...Array(q).keys()];
    for (let c = 0; c < S.length; c++) {
      const k0 = S[c], k1 = S[(c + 1) % S.length], ox = C0.px[B.coins[k0]], oy = C0.py[B.coins[k0]];
      const ex = C0.px[B.coins[k1]] - ox, ey = C0.py[B.coins[k1]] - oy, L = Math.hypot(ex, ey);
      if (L < 1e-4) continue;
      const ux = ex / L, uy = ey / L, haut = [], pied = [];
      for (let k = k0; k !== k1; k = (k + 1) % q) {
        const A = aretes[k];
        if (!A) continue;
        const sa = (A.xa - ox) * ux + (A.ya - oy) * uy, sb = (A.xb - ox) * ux + (A.yb - oy) * uy;
        for (const [t1, z1, t2, z2] of A.profil) haut.push([entre(sa, sb, t1), z1], [entre(sa, sb, t2), z2]);
        // murs prolongés de 2,5 m sous le sol : sur une pente, le terrain entre deux angles peut descendre plus bas
        pied.push([sa, solEn(G, A.xa, A.ya) - 2.5], [sb, solEn(G, A.xb, A.yb) - 2.5]);
      }
      if (haut.length < 2) continue;
      // haut : jamais sous le bord du toit (pas de jour entre mur et toit) ; pied : jamais au-dessus du sol
      const H = simplifierProfil(haut, 0.12, 1), Bas = simplifierProfil(pied, 0.6, -1);
      const lire = (Pf, x) => {
        for (let i = 0; i < Pf.length - 1; i++) if (x <= Pf[i + 1][0] + 1e-6) { const [s1, z1] = Pf[i], [s2, z2] = Pf[i + 1]; return s2 - s1 < 1e-6 ? z2 : z1 + (z2 - z1) * (x - s1) / (s2 - s1); }
        return Pf.at(-1)[1];
      };
      // tranches verticales entre les points du haut et du pied
      const bornes = [...new Set([...H, ...Bas].map(v => +v[0].toFixed(4)))].sort((a, b) => a - b);
      for (let i = 0; i < bornes.length - 1; i++) {
        const s1 = bornes[i], s2 = bornes[i + 1];
        if (s2 - s1 < 1e-4) continue;
        const x1 = ox + ux * s1, y1 = oy + uy * s1, x2 = ox + ux * s2, y2 = oy + uy * s2;
        // haut aux deux bords de la tranche (une marche verticale du toit tombe sur une borne : valeur de chaque côté)
        const h1 = lireCote(H, s1, 1), h2 = lireCote(H, s2, -1), b1 = lire(Bas, s1) - zRef, b2 = lire(Bas, s2) - zRef;
        pos.ajouter(x1, h1 - zRef, -y1, x1, b1, -y1, x2, b2, -y2, x1, h1 - zRef, -y1, x2, b2, -y2, x2, h2 - zRef, -y2);
        vols.ajouter(B.seg);
      }
      // marches verticales du haut (deux points à la même abscisse) : le petit pan entre les deux hauteurs est déjà
      // couvert par la tranche la plus haute ; rien à ajouter
    }
    return P ? { ...B, hauts } : B;
  });
  const murs = new THREE.BufferGeometry();
  murs.setAttribute("position", new THREE.BufferAttribute(pos.fin(), 3));
  murs.computeVertexNormals();
  murs.userData.volumes = vols.fin();
  const C = P ? { ...C0, boucles, pans: P, base: C0 } : C0;
  return { toits: P ? toitsPans(G, zRef, C0, P) : nappe(G, G.bat, zRef, C0), murs, contours: C };
}

/**
 * Profil [[s, z], …] (abscisse croissante) simplifié par Douglas-Peucker à `tol` près, puis décalé pour rester d'un
 * côté de l'original : `sens` = 1, jamais en dessous (haut des murs) ; −1, jamais au-dessus (pied des murs).
 */
function simplifierProfil(pts, tol, sens) {
  // points identiques consécutifs retirés
  const p = pts.filter((v, i) => i === 0 || Math.abs(v[0] - pts[i - 1][0]) > 1e-6 || Math.abs(v[1] - pts[i - 1][1]) > 1e-6);
  if (p.length <= 2) return p.length === 1 ? [p[0], p[0]] : p;
  const garde = new Uint8Array(p.length);
  garde[0] = garde[p.length - 1] = 1;
  const pile = [[0, p.length - 1]];
  while (pile.length) {
    const [a, b] = pile.pop(), [sa, za] = p[a], [sb, zb] = p[b];
    let pire = -1, dmax = tol;
    for (let i = a + 1; i < b; i++) {
      // écart vertical à la corde (les murs sont verticaux : seule la hauteur compte) ; marche verticale : écart plein
      const z = sb - sa < 1e-6 ? (za + zb) / 2 : za + (zb - za) * (p[i][0] - sa) / (sb - sa), d = Math.abs(p[i][1] - z);
      if (d > dmax) { dmax = d; pire = i; }
    }
    if (pire > 0) { garde[pire] = 1; pile.push([a, pire], [pire, b]); }
  }
  const r = p.filter((_, i) => garde[i]).map(v => [...v]);
  // chaque segment gardé est décalé du plus grand écart (du bon côté) des points qu'il remplace
  for (let i = 0, j = 0; i < r.length - 1; i++) {
    const [sa, za] = r[i], [sb, zb] = r[i + 1];
    let ecart = 0;
    for (; j < p.length && p[j][0] <= sb + 1e-6; j++) {
      if (p[j][0] < sa - 1e-6 || sb - sa < 1e-6) continue;
      const z = za + (zb - za) * (p[j][0] - sa) / (sb - sa), d = sens * (p[j][1] - z);
      if (d > ecart) ecart = d;
    }
    if (ecart > 0) { r[i][1] += sens * ecart; r[i + 1][1] += sens * ecart; }
    j = Math.max(0, j - 1);
  }
  return r;
}

/** Polyligne 2D simplifiée (Douglas-Peucker, écart `tol` m). */
function simplifierLigne(pts, tol) {
  if (pts.length <= 2) return pts;
  const garde = new Uint8Array(pts.length), pile = [[0, pts.length - 1]];
  garde[0] = garde[pts.length - 1] = 1;
  while (pile.length) {
    const [a, b] = pile.pop(), [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1;
    let pire = -1, dmax = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * (by - ay) - (pts[i][1] - ay) * (bx - ax)) / L; if (d > dmax) { dmax = d; pire = i; } }
    if (pire > 0) { garde[pire] = 1; pile.push([a, pire], [pire, b]); }
  }
  return pts.filter((_, i) => garde[i]);
}

/** Hauteur d'un profil simplifié en `x`, du côté `cote` (1 : juste après, −1 : juste avant) d'une marche verticale. */
function lireCote(Pf, x, cote) {
  for (let i = 0; i < Pf.length - 1; i++) {
    const [s1, z1] = Pf[i], [s2, z2] = Pf[i + 1];
    if (s2 - s1 < 1e-6) continue;
    if (cote > 0 ? x >= s1 - 1e-6 && x < s2 - 1e-6 : x > s1 + 1e-6 && x <= s2 + 1e-6) return z1 + (z2 - z1) * (x - s1) / (s2 - s1);
  }
  return cote > 0 ? Pf.at(-1)[1] : Pf[0][1];
}

/** Toits en pans : triangles plans par cellule (coupés le long des arêtes de toit), grille pour les volumes restants. */
function toitsPans(G, zRef, C, P) {
  const { n } = G, m = n + 1, pos = [];
  // hauteurs d'un profil aux deux bouts de l'intervalle [ta, tb]
  const lire = (profil, ta, tb) => {
    const tm = (ta + tb) / 2;
    for (const [t1, z1, t2, z2] of profil) if (t1 <= tm && tm <= t2) return [z1 + (z2 - z1) * (ta - t1) / (t2 - t1), z1 + (z2 - z1) * (tb - t1) / (t2 - t1)];
    return null;
  };
  for (let p = 0; p < n * n; p++) {
    if (P.pan[p] < 0) continue;
    if (!P.mixte[p]) { // cellule d'un seul pan : deux triangles dans son plan
      const [a, b, d] = P.plans[P.pan[p]], k = Math.floor(p / n) * m + p % n;
      for (const t of [k, k + 1, k + m + 1, k, k + m + 1, k + m]) pos.push(C.px[t], a * C.px[t] + b * C.py[t] + d - zRef, -C.py[t]);
      continue;
    }
    for (const v of P.triangles(p)) pos.push(v[0], v[2] - zRef, -v[1]);
    // raccord avec les cellules voisines du même volume : là où les deux toits ne se rejoignent pas (ressaut entre
    // deux pans sans arête commune, petite lucarne), un pan vertical ferme le décrochement
    const i = p % n, j = (p - i) / n, k = j * m + i;
    for (const [q, cote, a, b] of [[i < n - 1 ? p + 1 : -1, 1, k + 1, k + m + 1], [j < n - 1 ? p + n : -1, 2, k + m, k + m + 1], [i > 0 ? p - 1 : -1, 3, k, k + m], [j > 0 ? p - n : -1, 0, k, k + 1]]) {
      if (q < 0 || P.pan[q] < 0 || C.seg[q] !== C.seg[p] || (P.mixte[q] && cote % 3 === 0)) continue; // deux cellules mixtes : une seule fois
      const U = P.profil(p, cote), V = P.profil(q, (cote + 2) % 4), bornes = [...new Set([...U, ...V].flatMap(S => [S[0], S[2]]))].sort((u, v) => u - v);
      const xa = C.px[a], ya = C.py[a], xb = C.px[b], yb = C.py[b];
      for (let t = 0; t < bornes.length - 1; t++) {
        const ta = bornes[t], tb = bornes[t + 1], u = lire(U, ta, tb), v = lire(V, ta, tb);
        if (tb - ta < 1e-9 || !u || !v || (Math.abs(u[0] - v[0]) < 0.005 && Math.abs(u[1] - v[1]) < 0.005)) continue;
        const x1 = xa + (xb - xa) * ta, w1 = -(ya + (yb - ya) * ta), x2 = xa + (xb - xa) * tb, w2 = -(ya + (yb - ya) * tb);
        pos.push(x1, u[0] - zRef, w1, x1, v[0] - zRef, w1, x2, v[1] - zRef, w2, x1, u[0] - zRef, w1, x2, v[1] - zRef, w2, x2, u[1] - zRef, w2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals(); // sans index : une normale par triangle, donc des pans francs
  const reste = nappe(G, G.bat, zRef, C, P.pan);
  if (!reste.index.count) return g;
  const r = reste.toNonIndexed(), fusion = new THREE.BufferGeometry();
  for (const nom of ["position", "normal"]) {
    const a = g.getAttribute(nom).array, b = r.getAttribute(nom).array, t = new Float32Array(a.length + b.length);
    t.set(a); t.set(b, a.length);
    fusion.setAttribute(nom, new THREE.BufferAttribute(t, 3));
  }
  g.dispose(); r.dispose(); reste.dispose();
  return fusion;
}

/* ------------------------------------------------------------------ points */
/**
 * Dégradé de couleur selon la hauteur (terrain, bâtiments, arbres) : uniformes partagés par tous les matériaux,
 * réglés par la scène (bas et haut du lieu, en m relatifs à zRef).
 */
export const DEGRADE = {
  degrade: { value: 0 }, zBas: { value: 0 }, zHaut: { value: 50 },
  rampe: { value: ["#3b4cc0", "#4fa3c7", "#79c49a", "#e8d36b", "#f09a52", "#d6504f"].map(c => new THREE.Color(c)) },
};
export const RAMPE_GLSL = /* glsl */`
uniform float degrade, zBas, zHaut;
uniform vec3 rampe[6];
vec3 rampeHaut(float y) {
  float t = clamp((y - zBas) / max(1.0, zHaut - zBas), 0.0, 1.0) * 5.0;
  int i = int(min(floor(t), 4.0));
  return mix(rampe[i], rampe[i + 1], smoothstep(0.0, 1.0, t - float(i)));
}`;

const SOMMETS = /* glsl */`
uniform float taille, echelle;
uniform vec3 c1, c2, c3;
attribute float aRel, aVar;
#ifdef PAR_CLASSE
attribute vec3 aCouleur;
#endif
varying vec3 vCouleur;
varying float vHaut;
varying float vZone;
uniform sampler2D tZone;
uniform vec3 grilleZone; // x0, côté (m), zone active (0/1)
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
  #ifdef PAR_CLASSE
    vCouleur = aCouleur;
  #else
    vec3 c = mix(c1, c2, smoothstep(0.1, 0.95, aRel));
    c = mix(c, c3, smoothstep(0.55, 1.0, aVar) * 0.75);
    vCouleur = c * (0.84 + 0.32 * fract(aVar * 7.31));
  #endif
  vec3 transformed = position;
  vec4 monde = modelMatrix * vec4(transformed, 1.0);
  vHaut = monde.y;
  vZone = grilleZone.z > 0.5 ? texture2D(tZone, (vec2(monde.x, -monde.z) - grilleZone.x) / grilleZone.y).r : 0.0;
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  // taille en mètres, avec un minimum en pixels pour que les arbres lointains ne disparaissent pas
  gl_PointSize = clamp(taille * echelle / max(0.1, -mvPosition.z), 2.0, 44.0);
  #include <clipping_planes_vertex>
  #include <fog_vertex>
}`;
const FRAGMENTS = /* glsl */`
uniform float lum, relief, ombre, gris, neutre, versSol;
uniform vec3 teinteSol; // couleur du sol : par faible lumière, les arbres s'en rapprochent (moins verts, moins sombres)
uniform vec3 teinteSoleil, teinteOmbre; // teintes (luminosité 1) de la lumière du soleil et de celle du ciel
uniform vec3 teinteNeutre;
varying vec3 vCouleur;
varying float vHaut;
varying float vZone;
#include <common>
${RAMPE_GLSL}
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <fog_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard; // point rond
  // dans l'ombre portée (bâtiments, autres arbres, sa propre couronne) : même assombrissement que le sol
  float masque = getShadowMask(), soleil = mix(ombre, 1.0, masque);
  // teinte de la lumière, sans assombrir : celle du soleil sur la part éclairée, celle du ciel à l'ombre
  // crépuscule et nuit : couleurs désaturées (vision de nuit), en plus de l'assombrissement
  vec3 base = vCouleur;
  // dégradé selon la hauteur : la teinte de la rampe, nuancée par la clarté propre à chaque point
  if (degrade > 0.5) base = rampeHaut(vHaut) * (0.8 + 0.9 * (dot(vCouleur, vec3(0.2126, 0.7152, 0.0722)) - 0.25));
  // carte des heures de soleil affichée : arbres de la zone calculée en gris et un peu transparents (tramage régulier,
  // sans tri des points), pour lire la carte au travers ; le reste garde sa couleur
  if (neutre > 0.5 && vZone > 0.3) {
    vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
    float seuil = mod(q.x * 8.0 + q.y * 4.0 + mod(q.y, 2.0) * 2.0 + mod(q.x + q.y, 2.0) * 1.0, 16.0) / 16.0; // matrice 4 × 4
    if (seuil < 0.45) discard;
    base = teinteNeutre * (0.85 + 0.6 * (dot(vCouleur, vec3(0.2126, 0.7152, 0.0722)) - 0.25));
  }
  // éclairage : exactement les lumières du reste de la maquette (ciel en hémisphère, soleil, ombres portées), comme
  // pour un matériau mat ; chaque point est une petite boule tournée vers la caméra (normale tirée de sa place dans
  // le disque, un peu aplatie). Le matin, le soir et la nuit suivent donc d'eux-mêmes, sans réglage à part.
  vec3 N = normalize(vec3(p.x, -p.y, sqrt(max(0.0, 1.0 - r2)) + 0.4));
  vec3 eclairage = vec3(0.0);
  #if NUM_HEMI_LIGHTS > 0
    for (int i = 0; i < NUM_HEMI_LIGHTS; i++) eclairage += getHemisphereLightIrradiance(hemisphereLights[i], N);
  #endif
  #if NUM_DIR_LIGHTS > 0
    for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
      // feuillage : une part de la lumière traverse (le côté opposé au soleil n'est pas noir)
      float ndl = 0.3 + 0.7 * max(dot(N, directionalLights[i].direction), 0.0);
      eclairage += directionalLights[i].color * ndl * masque;
    }
  #endif
  gl_FragColor = vec4(base * eclairage * RECIPROCAL_PI, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** Matériau des points : ronds, taille en mètres, teinte variée (c1 bas, c2 haut, c3 accent) ou couleur par classe. */
export function materiauPoints(taille, parClasse = false) {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, THREE.UniformsLib.lights, {
      taille: { value: taille }, echelle: { value: 800 }, lum: { value: 1 }, relief: { value: 1 }, ombre: { value: 0.5 }, gris: { value: 0 },
      neutre: { value: 0 }, versSol: { value: 0 }, teinteSol: { value: new THREE.Color("#d8cfbf") }, teinteSoleil: { value: new THREE.Color(1, 1, 1) }, teinteOmbre: { value: new THREE.Color(1, 1, 1) }, teinteNeutre: { value: new THREE.Color("#b9b6b0") },
      tZone: { value: null }, grilleZone: { value: new THREE.Vector3(0, 1, 0) },
      c1: { value: new THREE.Color("#2f5d2a") }, c2: { value: new THREE.Color("#7fae4b") }, c3: { value: new THREE.Color("#b9c45a") },
    }]),
    defines: parClasse ? { PAR_CLASSE: 1 } : {},
    vertexShader: SOMMETS, fragmentShader: FRAGMENTS, fog: true, clipping: true, lights: true,
  });
  Object.assign(mat.uniforms, DEGRADE); // partagés (merge les aurait copiés)
  return mat;
}

// bruit de valeur lisse (0..1) : donne une teinte propre à chaque arbre
const alea = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function bruit(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  return (alea(i, j) * (1 - a) + alea(i + 1, j) * a) * (1 - b) + (alea(i, j + 1) * (1 - a) + alea(i + 1, j + 1) * a) * b;
}

const CLASSES = { 2: "#c9b999", 3: "#5a8c3a", 4: "#5a8c3a", 5: "#5a8c3a", 6: "#d9725a", 9: "#4d8cd9", 17: "#9a9a9a", 26: "#8d6fc2" };
const vegetation = cl => cl === 3 || cl === 4 || cl === 5;

/**
 * Nuage de points. `mode` : "arbres" (végétation, teinte variée) ou "tous" (nuage brut, couleur par classe).
 * `part` = fraction gardée. En mode "tous", la végétation est rangée à la fin (`userData.autres` = nombre de points
 * des autres classes) : on peut ne pas la dessiner (drawRange) quand les arbres sont déjà affichés.
 */
export function nuagePoints(nuage, G, zRef, mode, part, taille) {
  const { n, c, R } = G, { X, Y, Z, C } = nuage, pas = Math.max(1, Math.round(1 / part)), arbres = mode === "arbres";
  const r2 = G.rayonZone ? G.rayonZone * G.rayonZone : Infinity; // maquette ronde : points du cercle seulement
  const dedans = k => { const i = Math.floor((X[k] + R) / c), j = Math.floor((Y[k] + R) / c); return i < 0 || j < 0 || i >= n || j >= n || X[k] * X[k] + Y[k] * Y[k] > r2 ? -1 : j * n + i; };
  // première passe : compter (tableaux typés à la bonne taille)
  let nv = 0, na = 0;
  for (let k = 0; k < nuage.n; k += arbres ? 1 : pas) {
    if (arbres && (!vegetation(C[k]) || k % pas)) continue;
    if (dedans(k) < 0) continue;
    if (vegetation(C[k])) nv++; else na++;
  }
  const nb = nv + na;
  if (!nb) return null;
  const pos = new Float32Array(3 * nb), g = new THREE.BufferGeometry();
  if (arbres) {
    const rel = new Float32Array(nb), va = new Float32Array(nb);
    for (let k = 0, q = 0; k < nuage.n; k++) {
      if (!vegetation(C[k]) || k % pas) continue;
      const p = dedans(k);
      if (p < 0) continue;
      const x = X[k], y = Y[k], z = Z[k], h = G.veg[p] - G.sol[p];
      // hauteur dans la couronne : 0 au pied, 1 au sommet
      rel[q] = h > 1 ? Math.min(1, Math.max(0, (z - G.sol[p]) / h)) : 0.5;
      va[q] = Math.min(0.999, 0.75 * bruit(x / 7, y / 7) + 0.25 * alea(k, 3));
      pos[3 * q] = x; pos[3 * q + 1] = z - zRef; pos[3 * q + 2] = -y; q++;
    }
    g.setAttribute("aRel", new THREE.BufferAttribute(rel, 1));
    g.setAttribute("aVar", new THREE.BufferAttribute(va, 1));
  } else {
    // couleur par classe, sur un octet par composante
    const col = new Uint8Array(3 * nb), palette = new Uint8Array(3 * 256), teinte = new THREE.Color();
    for (let cl = 0; cl < 256; cl++) { teinte.set(CLASSES[cl] || "#8d8f99"); palette.set([teinte.r * 255, teinte.g * 255, teinte.b * 255].map(Math.round), 3 * cl); }
    for (let k = 0, qa = 0, qv = na; k < nuage.n; k += pas) {
      if (dedans(k) < 0) continue;
      const cl = C[k], q = vegetation(cl) ? qv++ : qa++;
      pos[3 * q] = X[k]; pos[3 * q + 1] = Z[k] - zRef; pos[3 * q + 2] = -Y[k];
      col[3 * q] = palette[3 * cl]; col[3 * q + 1] = palette[3 * cl + 1]; col[3 * q + 2] = palette[3 * cl + 2];
    }
    g.setAttribute("aCouleur", new THREE.BufferAttribute(col, 3, true));
    g.userData.autres = na;
  }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  // nuage brut : positions et couleurs gardées (couleurs réelles calculées après coup, voir Scene3D.couleursPoints)
  const pts = new THREE.Points(jetable(g, arbres ? [] : ["position", "aCouleur"]), materiauPoints(taille, !arbres));
  pts.receiveShadow = true;
  const v = new THREE.Vector2();
  pts.onBeforeRender = (r, s, cam) => { pts.material.uniforms.echelle.value = r.getDrawingBufferSize(v).y / (2 * Math.tan(cam.fov * Math.PI / 360)); };
  return pts;
}

/** Limite de la parcelle posée sur le terrain. */
export function contourParcelle(parcelle, G, zRef, materiau) {
  const grp = new THREE.Group();
  for (const anneau of parcelle.anneauxRel) {
    const pts = [];
    for (let k = 0; k < anneau.length - 1; k++) {
      const [x1, y1] = anneau[k], [x2, y2] = anneau[k + 1], L = Math.hypot(x2 - x1, y2 - y1), m = Math.max(1, Math.ceil(L));
      for (let t = 0; t < m; t++) {
        const x = x1 + (x2 - x1) * t / m, y = y1 + (y2 - y1) * t / m;
        pts.push(new THREE.Vector3(x, solEn(G, x, y) - zRef + 0.4, -y));
      }
    }
    if (pts.length < 2) continue;
    pts.push(pts[0].clone());
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0), pts.length * 2, 0.12, 6), materiau));
  }
  return grp;
}

/* ------------------------------------------------------------------ couronnes d'arbres */
/** Flou gaussien séparable (rayon en cellules) d'une grille n × n. */
function flou(a, n, r) {
  const k = [], s = r / 2;
  for (let d = -r; d <= r; d++) k.push(Math.exp(-d * d / (2 * s * s)));
  const t = new Float32Array(n * n), b = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let v = 0, w = 0;
    for (let d = -r; d <= r; d++) { const x = i + d; if (x >= 0 && x < n) { v += a[j * n + x] * k[d + r]; w += k[d + r]; } }
    t[j * n + i] = v / w;
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let v = 0, w = 0;
    for (let d = -r; d <= r; d++) { const y = j + d; if (y >= 0 && y < n) { v += t[y * n + i] * k[d + r]; w += k[d + r]; } }
    b[j * n + i] = v / w;
  }
  return b;
}

/**
 * Couronnes d'arbres lissées : un volume fermé et arrondi par massif (dessus bombé, dessous plus plat), au lieu de
 * milliers de points. Teinte variée par vertex (couleurs du thème : c1 ombre, c2 lumière, c3 accent).
 */
export function couronnes(G, zRef, couleurs) {
  const { n, c, x0, sol, veg } = G, pas = 2, m = Math.floor(n / pas);
  // grille réduite à 1 m : présence de végétation et hauteur de couronne
  const pres = new Float32Array(m * m), haut = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    let q = 0, h = 0;
    for (let b = 0; b < pas; b++) for (let a = 0; a < pas; a++) {
      const p = (j * pas + b) * n + i * pas + a;
      if (!isNaN(veg[p])) { q++; h = Math.max(h, veg[p] - sol[p]); }
    }
    pres[j * m + i] = q / (pas * pas); haut[j * m + i] = h;
  }
  // masque lissé (bouche les trous entre points), puis distance au bord en mètres (chanfrein 3-4)
  const P = flou(pres, m, 2), Hp = flou(haut.map((h, k) => h * pres[k]), m, 2), seuil = 0.3;
  const dist = new Float32Array(m * m);
  for (let k = 0; k < m * m; k++) dist[k] = P[k] >= seuil ? 1e9 : 0;
  const passe = (j0, j1, dj, i0, i1, di) => {
    for (let j = j0; j !== j1; j += dj) for (let i = i0; i !== i1; i += di) {
      const k = j * m + i;
      if (!dist[k]) continue;
      let d = dist[k];
      for (const [a, b, w] of [[-di, 0, 1], [0, -dj, 1], [-di, -dj, 1.4142], [di, -dj, 1.4142]]) {
        const x = i + a, y = j + b;
        d = x < 0 || y < 0 || x >= m || y >= m ? Math.min(d, w) : Math.min(d, dist[y * m + x] + w);
      }
      dist[k] = d;
    }
  };
  passe(0, m, 1, 0, m, 1); passe(m - 1, -1, -1, m - 1, -1, -1);
  // deux nappes (dessus bombé, dessous plus plat) : les sommets du dessous suivent ceux du dessus
  const idx = new Int32Array(m * m).fill(-1);
  let nv = 0;
  for (let k = 0; k < m * m; k++) if (dist[k]) idx[k] = nv++;
  if (!nv) return null;
  const pos = new Float32Array(6 * nv), col = new Float32Array(6 * nv), tri = new Tampon(Uint32Array);
  const C = couleurs.map(x => new THREE.Color(x)), coul = new THREE.Color();
  const solM = (i, j) => sol[Math.min(n - 1, j * pas + 1) * n + Math.min(n - 1, i * pas + 1)];
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = j * m + i, a = 3 * idx[k], b = a + 3 * nv;
    if (!dist[k]) continue;
    // dôme : profil en quart de cercle, dont le rayon suit la hauteur de la couronne
    const H = Hp[k] / Math.max(1e-3, P[k]), z0 = solM(i, j) - zRef;
    const rayon = Math.max(1.5, H * 0.45), d = Math.max(0, dist[k] * pas * c - 0.5);
    const e = Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, d / rayon)) ** 2));
    const base = z0 + H * 0.45, sommet = z0 + H;
    const x = x0 + (i + 0.5) * pas * c, y = x0 + (j + 0.5) * pas * c;
    pos[a] = pos[b] = x; pos[a + 2] = pos[b + 2] = -y;
    pos[a + 1] = base + (sommet - base) * e;
    pos[b + 1] = base - (sommet - base) * 0.12 * e;
    const v = 0.7 * bruit(x / 6, y / 6) + 0.3 * alea(i, j);
    coul.copy(C[0]).lerp(C[1], 0.3 + 0.55 * e).lerp(C[2], Math.max(0, v - 0.55) * 1.2).multiplyScalar(0.9 + 0.2 * v);
    col[a] = coul.r; col[a + 1] = coul.g; col[a + 2] = coul.b;
    col[b] = coul.r * 0.7; col[b + 1] = coul.g * 0.7; col[b + 2] = coul.b * 0.7;
  }
  for (const [o, inverse] of [[0, false], [nv, true]]) {
    const ajoute = (t0, t1, t2) => { if (t0 >= 0 && t1 >= 0 && t2 >= 0) tri.ajouter(t0 + o, (inverse ? t2 : t1) + o, (inverse ? t1 : t2) + o); };
    for (let j = 0; j < m - 1; j++) for (let i = 0; i < m - 1; i++) {
      const a = idx[j * m + i], b = idx[j * m + i + 1], d = idx[(j + 1) * m + i + 1], e = idx[(j + 1) * m + i];
      if (a >= 0 && d >= 0) { ajoute(a, b, d); ajoute(a, d, e); } else { ajoute(a, b, e); ajoute(b, d, e); }
    }
  }
  if (!tri.n) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(tri.fin(), 1));
  g.computeVertexNormals();
  return g;
}

/**
 * Points d'arbres simulés depuis la grille de végétation (repli sans relevé classé) : 3 points par cellule de 0,5 m,
 * répartis dans la moitié haute de la couronne, au format d'un nuage (classe 3).
 */
export function pointsVegetation(G) {
  const { n, c, x0, sol, veg } = G;
  let nb = 0;
  for (let p = 0; p < n * n; p++) if (veg[p] - sol[p] > 1) nb += 3;
  const X = new Float32Array(nb), Y = new Float32Array(nb), Z = new Float32Array(nb);
  let q = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = j * n + i, h = veg[p] - sol[p];
    if (!(h > 1)) continue;
    for (let k = 0; k < 3; k++) {
      const a = alea(p, k), b = alea(k, p), t = alea(p + 7, k + 3);
      X[q] = x0 + (i + a) * c; Y[q] = x0 + (j + b) * c;
      Z[q++] = veg[p] - h * 0.45 * t * t; // plus dense près du sommet
    }
  }
  return { X, Y, Z, C: new Uint8Array(nb).fill(3), n: nb };
}

/**
 * Hauteur (absolue) des maillages qui traversent les quatre bords du modèle, par cellule de bord : pour chaque
 * triangle qui coupe un plan de bord, on suit le segment d'intersection. Sert à faire monter la face du socle
 * jusqu'au toit des bâtiments de comparaison coupés au bord (swisstopo, roofer).
 */
export function hauteursBords(G, zRef, objets) {
  // plans de mesure 5 cm en retrait du bord : les maillages y sont coupés à 3 cm (decouperBord)
  const { n, c, x0 } = G, R = n * c / 2 - 0.05, bords = [0, 1, 2, 3].map(() => new Float32Array(n).fill(-Infinity));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), P = [a, b, d];
  // côtés : 0 sud (y = -R), 1 est (x = R), 2 nord (y = R), 3 ouest (x = -R) ; scène : x = est, z = -nord
  const plans = [[p => -p.z + R, p => p.x], [p => p.x - R, p => -p.z], [p => -p.z - R, p => p.x], [p => p.x + R, p => -p.z]];
  const noter = (cote, u, y) => {
    const k = Math.floor((u - x0) / c);
    if (k >= 0 && k < n && y + zRef > bords[cote][k]) bords[cote][k] = y + zRef;
  };
  for (const o of objets) o?.traverse(m => {
    if (!m.isMesh || !m.visible) return;
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position, idx = m.geometry.index, nt = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < nt; t++) {
      for (let s = 0; s < 3; s++) P[s].fromBufferAttribute(pos, idx ? idx.getX(3 * t + s) : 3 * t + s).applyMatrix4(m.matrixWorld);
      for (let cote = 0; cote < 4; cote++) {
        const [dist, long] = plans[cote], dd = P.map(dist);
        if ((dd[0] > 0 && dd[1] > 0 && dd[2] > 0) || (dd[0] < 0 && dd[1] < 0 && dd[2] < 0)) continue;
        // extrémités du segment d'intersection avec le plan du bord
        const pts = [];
        for (let s = 0; s < 3; s++) {
          const s2 = (s + 1) % 3;
          if ((dd[s] <= 0) !== (dd[s2] <= 0)) { const f = dd[s] / (dd[s] - dd[s2]); pts.push([long(P[s]) + (long(P[s2]) - long(P[s])) * f, P[s].y + (P[s2].y - P[s].y) * f]); }
        }
        if (pts.length < 2) continue;
        const [[u1, y1], [u2, y2]] = pts, nb = Math.max(1, Math.ceil(Math.abs(u2 - u1) / (c / 2)));
        for (let q = 0; q <= nb; q++) noter(cote, u1 + (u2 - u1) * q / nb, y1 + (y2 - y1) * q / nb);
      }
    }
  });
  return bords;
}

/**
 * Grille des hauteurs (absolues) de maillages vus de dessus, alignée sur G : pour chaque cellule de 0,5 m, le plus
 * haut des triangles qui couvrent son centre (NaN ailleurs). Sert à la coupe quand les bâtiments affichés sont ceux
 * de swisstopo ou de roofer.
 */
export function hauteursDessus(G, zRef, objets) {
  const { n, c, x0 } = G, h = new Float32Array(n * n).fill(NaN), P = new Float32Array(9), v = new THREE.Vector3();
  for (const o of objets) o?.traverse(m => {
    if (!m.isMesh || !m.visible) return;
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position, idx = m.geometry.index, nt = (idx ? idx.count : pos.count) / 3;
    for (let t = 0; t < nt; t++) {
      for (let s = 0; s < 3; s++) { v.fromBufferAttribute(pos, idx ? idx.getX(3 * t + s) : 3 * t + s).applyMatrix4(m.matrixWorld); P[3 * s] = (v.x - x0) / c; P[3 * s + 1] = (-v.z - x0) / c; P[3 * s + 2] = v.y + zRef; }
      // en cellules : (x1, y1), (x2, y2), (x3, y3) ; les faces verticales (aire nulle vue de dessus) sont ignorées
      const x1 = P[0], y1 = P[1], x2 = P[3], y2 = P[4], x3 = P[6], y3 = P[7], aire = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
      if (Math.abs(aire) < 1e-6) continue;
      const i0 = Math.max(0, Math.floor(Math.min(x1, x2, x3) - 0.5)), i1 = Math.min(n - 1, Math.ceil(Math.max(x1, x2, x3) - 0.5));
      const j0 = Math.max(0, Math.floor(Math.min(y1, y2, y3) - 0.5)), j1 = Math.min(n - 1, Math.ceil(Math.max(y1, y2, y3) - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i + 0.5, y = j + 0.5;
        const a = ((x2 - x) * (y3 - y) - (x3 - x) * (y2 - y)) / aire, b = ((x3 - x) * (y1 - y) - (x1 - x) * (y3 - y)) / aire, d = 1 - a - b;
        if (a < -1e-4 || b < -1e-4 || d < -1e-4) continue;
        const z = a * P[2] + b * P[5] + d * P[8], p = j * n + i;
        if (!(h[p] >= z)) h[p] = z;
      }
    }
  });
  return h;
}

/** Limites des parcelles voisines (traits fins posés sur le terrain) et leurs numéros (étiquettes au centre). */
export function limitesVoisines(voisines, G, zRef, couleur) {
  const grp = new THREE.Group(), pos = new Tampon(), R = G.R;
  const Rz = G.rayonZone ? G.rayonZone - 0.5 : Infinity; // maquette ronde : le cercle
  const dedans = (x, y) => Math.abs(x) < R - 0.5 && Math.abs(y) < R - 0.5 && x * x + y * y < Rz * Rz;
  for (const v of voisines) {
    for (const a of v.anneauxRel) for (let k = 0; k < a.length - 1; k++) {
      const [x1, y1] = a[k], [x2, y2] = a[k + 1], L = Math.hypot(x2 - x1, y2 - y1), m = Math.max(1, Math.ceil(L));
      for (let t = 0; t < m; t++) {
        const xa = x1 + (x2 - x1) * t / m, ya = y1 + (y2 - y1) * t / m, xb = x1 + (x2 - x1) * (t + 1) / m, yb = y1 + (y2 - y1) * (t + 1) / m;
        if (!dedans(xa, ya) || !dedans(xb, yb)) continue;
        pos.ajouter(xa, solEn(G, xa, ya) - zRef + 0.15, -ya, xb, solEn(G, xb, yb) - zRef + 0.15, -yb);
      }
    }
    // numéro au centre de la boîte de la parcelle, s'il est dans la maquette
    const pts = v.anneauxRel[0], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (dedans(cx, cy) && v.numero) grp.add(etiquetteNumero(v.numero, couleur, cx, solEn(G, cx, cy) - zRef + 1.2, -cy));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos.fin(), 3));
  grp.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: 0.75 })));
  return grp;
}

function etiquetteNumero(texte, couleur, x, y, z) {
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d");
  cv.width = 128; cv.height = 48;
  ctx.font = "600 30px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 6; ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.strokeText(texte, 64, 25);
  ctx.fillStyle = couleur; ctx.fillText(texte, 64, 25);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sp.position.set(x, y, z); sp.scale.set(6, 2.25, 1);
  return sp;
}

/**
 * Plans d'eau (lacs, étangs, rivières) : une surface parfaitement plane au niveau de chaque plan d'eau, faite de
 * bandes (cellules consécutives d'une même ligne au même niveau) pour rester légère.
 */
export function plansEau(G, zRef) {
  const { n, c, x0 } = G;
  if (!G.eau) return null;
  // le plan d'eau déborde de 3 m sous la rive : c'est le terrain, plus haut, qui le coupe ; la rive suit alors le
  // terrain (triangles de 1 m) au lieu des cellules de 0,5 m en escalier
  const eau = Float32Array.from(G.eau);
  {
    let front = [];
    for (let p = 0; p < n * n; p++) if (!isNaN(eau[p])) front.push(p);
    for (let tour = 0; tour < Math.round(3 / c) && front.length; tour++) {
      const suivant = [];
      for (const p of front) {
        const i = p % n;
        for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p >= n ? p - n : -1, p + n < n * n ? p + n : -1])
          if (q >= 0 && isNaN(eau[q]) && !(G.sol[q] < eau[p] - 0.5)) { eau[q] = eau[p] - (tour ? 0 : 0.12); suivant.push(q); } // débord 12 cm plus bas : pas de conflit avec une rive presque au niveau
      }
      front = suivant;
    }
  }
  // plan d'eau par cellule, chaque coin à la moyenne des cellules d'eau voisines : plat sur un lac, en pente douce
  // le long d'une rivière (sans marches)
  const coin = (i, j) => {
    let s = 0, k = 0;
    for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (a >= 0 && b >= 0 && a < n && b < n && !isNaN(eau[b * n + a])) { s += eau[b * n + a]; k++; }
    return s / k - zRef;
  };
  const pos = [], P = (a, b) => [x0 + a * c, coin(a, b), -(x0 + b * c)];
  for (let j = 0; j < n; j++) {
    let i = 0;
    while (i < n) {
      const h = eau[j * n + i];
      if (isNaN(h)) { i++; continue; }
      let k = i + 1;
      while (k < n && eau[j * n + k] === h) k++; // suite de cellules au même niveau (lac) : un seul quadrilatère
      const A = P(i, j), B = P(k, j), C = P(k, j + 1), D = P(i, j + 1);
      pos.push(...A, ...B, ...C, ...A, ...C, ...D);
      i = k;
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  // normales verticales : de longues bandes fines, à peine inclinées, prenaient sinon la lumière chacune à sa façon
  // (stries sur le lac, surtout vu de haut)
  const nor = new Float32Array(pos.length);
  for (let k = 1; k < nor.length; k += 3) nor[k] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return g;
}

/**
 * Ponts allégés : chaque pont (cellules de tablier connexes) devient un solide balayé le long de son axe principal.
 * On relève, tous les mètres le long de l'axe, les deux rives (écart à l'axe), le dessus du tablier et le dessous
 * relevé (intrados des arches, pied des piles) ; ces quatre profils sont simplifiés (Douglas-Peucker), puis reliés
 * par des faces planes : quelques centaines de triangles par pont au lieu de dizaines de milliers.
 * Pour les ponts droits ou peu courbes. Retourne { dessus (avec coordonnées de texture du terrain), cotes } ou null.
 */
export function pontsLegers(G, zRef, nuage = null) {
  const { n, c, x0, pont, pontBas } = G;
  if (!pont || !pont.some(v => !isNaN(v))) return null;
  const sous = pontBas || pont.map(z => z - 1.5), vu = new Uint8Array(n * n), haut = [], uv = [], bas = [];
  // points vus sous le tablier (nuage du relevé) : classe « pont » à moins de 15 m sous la chaussée = dessous du
  // tablier (intrados, arches) ; plus bas, ou classe 27 (ouvrages) = piles
  const intrados = new Map(), piles = new Map();
  if (nuage) {
    const { X, Y, Z, C } = nuage;
    for (let k = 0; k < nuage.n; k++) {
      const cl = C[k];
      if (cl !== 17 && cl !== 27) continue;
      const i = Math.floor((X[k] - x0) / c), j = Math.floor((Y[k] - x0) / c);
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const p = j * n + i, d = pont[p] - Z[k];
      if (!(d > 1)) continue;
      const M = cl === 17 && d < 15 ? intrados : piles;
      (M.get(p) || M.set(p, []).get(p)).push(Z[k]);
    }
  }
  const avecNuage = !!nuage;
  const UV = (x, y) => [(x - x0) / (2 * G.R), (y - x0) / (2 * G.R)];
  for (let p0 = 0; p0 < n * n; p0++) {
    if (vu[p0] || isNaN(pont[p0])) continue;
    // un pont : cellules connexes
    const cel = [], pile = [p0];
    vu[p0] = 1;
    while (pile.length) {
      const p = pile.pop(), i = p % n;
      cel.push(p);
      for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
        if (q >= 0 && q < n * n && !vu[q] && !isNaN(pont[q])) { vu[q] = 1; pile.push(q); }
    }
    if (cel.length * c * c < 20) continue;
    // axe du pont, droit ou courbe : on ordonne les cellules le long du pont (distance dans le tablier depuis un bout),
    // puis l'axe est la suite des centres par tranche, lissée et simplifiée ; chaque cellule est ensuite projetée
    // sur cet axe : abscisse curviligne s et écart t (positif à gauche)
    const X = cel.map(p => x0 + (p % n + 0.5) * c), Y = cel.map(p => x0 + (Math.floor(p / n) + 0.5) * c);
    const rang = new Map(cel.map((p, k) => [p, k]));
    const parcours = depart => {
      const d = new Int32Array(cel.length).fill(-1), file = [depart];
      d[depart] = 0;
      for (let f = 0; f < file.length; f++) {
        const k = file[f], p = cel[k], i = p % n;
        for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n, i > 0 ? p - n - 1 : -1, i < n - 1 ? p - n + 1 : -1, i > 0 ? p + n - 1 : -1, i < n - 1 ? p + n + 1 : -1]) {
          const r = rang.get(q);
          if (r !== undefined && d[r] < 0) { d[r] = d[k] + 1; file.push(r); }
        }
      }
      return d;
    };
    let d0 = parcours(0), bout = 0;
    for (let k = 0; k < cel.length; k++) if (d0[k] > d0[bout]) bout = k;
    const dA = parcours(bout);
    let dmax = 0;
    for (let k = 0; k < cel.length; k++) if (dA[k] > dmax) dmax = dA[k];
    // centres par tranche de 4 m de parcours
    const tr = Math.max(1, Math.round(4 / c)), nt = Math.floor(dmax / tr) + 1, cx = new Float64Array(nt), cy = new Float64Array(nt), cn = new Int32Array(nt);
    for (let k = 0; k < cel.length; k++) { if (dA[k] < 0) continue; const q = Math.floor(dA[k] / tr); cx[q] += X[k]; cy[q] += Y[k]; cn[q]++; }
    let axe = [];
    for (let q = 0; q < nt; q++) if (cn[q]) axe.push([cx[q] / cn[q], cy[q] / cn[q]]);
    if (axe.length < 2) continue;
    // lissage (moyenne glissante sur 3) puis prolongement aux deux bouts, et simplification (20 cm)
    axe = axe.map((v, i) => i === 0 || i === axe.length - 1 ? v : [(axe[i - 1][0] + v[0] + axe[i + 1][0]) / 3, (axe[i - 1][1] + v[1] + axe[i + 1][1]) / 3]);
    const prolonger = (A, B) => { const dx = A[0] - B[0], dy = A[1] - B[1], l = Math.hypot(dx, dy) || 1; return [A[0] + dx / l * 6, A[1] + dy / l * 6]; };
    axe = [prolonger(axe[0], axe[1]), ...axe, prolonger(axe.at(-1), axe.at(-2))];
    axe = simplifierLigne(axe, 0.2);
    const cum = [0];
    for (let i = 1; i < axe.length; i++) cum.push(cum[i - 1] + Math.hypot(axe[i][0] - axe[i - 1][0], axe[i][1] - axe[i - 1][1]));
    // projection d'un point sur l'axe : [s, t]
    const projeter = (x, y) => {
      let best = [0, 0], bd = Infinity;
      for (let i = 0; i < axe.length - 1; i++) {
        const [ax, ay] = axe[i], [bx, by] = axe[i + 1], ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1;
        const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / L2)), px = ax + ex * u, py = ay + ey * u, dd = (x - px) ** 2 + (y - py) ** 2;
        if (dd < bd) { bd = dd; const L = Math.sqrt(L2); best = [cum[i] + u * L, (-(x - ax) * ey + (y - ay) * ex) / L]; }
      }
      return best;
    };
    // point et normale (gauche) de l'axe à l'abscisse s
    const surAxe = s => {
      let i = 0;
      while (i < axe.length - 2 && cum[i + 1] < s) i++;
      const [ax, ay] = axe[i], [bx, by] = axe[i + 1], L = cum[i + 1] - cum[i] || 1, u = (s - cum[i]) / L;
      return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, nx: -(by - ay) / L, ny: (bx - ax) / L };
    };
    // stations d'un mètre le long de l'axe
    let s0 = Infinity, s1 = -Infinity;
    const ST = cel.map((p, k) => { const v = projeter(X[k], Y[k]); if (v[0] < s0) s0 = v[0]; if (v[0] > s1) s1 = v[0]; return v; });
    const pas = 1, nb = Math.max(2, Math.ceil((s1 - s0) / pas) + 1), st = Array.from({ length: nb }, () => ({ g: Infinity, d: -Infinity, h: [], b: [], pile: 0, pg: Infinity, pd: -Infinity }));
    for (let k = 0; k < cel.length; k++) {
      const [sk, t] = ST[k], q = Math.min(nb - 1, Math.round((sk - s0) / pas)), T = st[q], p = cel[k];
      if (t - c / 2 < T.g) T.g = t - c / 2;
      if (t + c / 2 > T.d) T.d = t + c / 2;
      T.h.push(pont[p]);
      if (avecNuage) {
        // dessous : les points du dessous du tablier ; piles : leur emprise en travers
        for (const z of intrados.get(p) || []) T.b.push(z);
        const P = piles.get(p);
        if (P) { T.pile += P.length; if (t - c / 2 < T.pg) T.pg = t - c / 2; if (t + c / 2 > T.pd) T.pd = t + c / 2; }
      } else if (!isNaN(sous[p])) T.b.push(sous[p]);
    }
    const med = a => { if (!a.length) return NaN; a.sort((u, v) => u - v); return a[a.length >> 1]; };
    const profils = { g: [], d: [], h: [], b: [] };
    for (let q = 0; q < nb; q++) {
      const T = st[q], x = s0 + q * pas;
      if (T.g === Infinity) continue;
      const h = med(T.h), b = med(T.b);
      profils.g.push([x, T.g]); profils.d.push([x, T.d]); profils.h.push([x, h]); profils.b.push([x, isNaN(b) ? NaN : Math.min(b, h - 0.4)]);
    }
    // dessous sans mesure : repris des stations voisines (sinon 1,5 m sous la chaussée)
    {
      const B = profils.b, H = profils.h;
      let der = NaN;
      for (let i = 0; i < B.length; i++) { if (isNaN(B[i][1])) B[i][1] = isNaN(der) ? NaN : H[i][1] - der; else der = H[i][1] - B[i][1]; }
      der = NaN;
      for (let i = B.length - 1; i >= 0; i--) { if (isNaN(B[i][1])) B[i][1] = H[i][1] - (isNaN(der) ? 1.5 : der); else der = H[i][1] - B[i][1]; }
    }
    // piles : stations voisines où des points descendent loin sous le tablier, regroupées
    const blocs = [];
    if (avecNuage) {
      let cur = null;
      for (let q = 0; q < nb; q++) {
        const T = st[q];
        if (T.pile >= 4) {
          const x = s0 + q * pas;
          if (cur && x - cur.s1 <= 2.5) { cur.s1 = x; cur.g = Math.min(cur.g, T.pg); cur.d = Math.max(cur.d, T.pd); cur.np += T.pile; }
          else { cur = { s0: x, s1: x, g: T.pg, d: T.pd, np: T.pile }; blocs.push(cur); }
        }
      }
    }
    if (profils.h.length < 2) continue;
    // simplification : rives à 25 cm (vers l'extérieur), dessus à 10 cm (jamais sous la chaussée), dessous à 30 cm
    const Pg = simplifierProfil(profils.g, 0.25, -1), Pd = simplifierProfil(profils.d, 0.25, 1);
    const Ph = simplifierProfil(profils.h, 0.1, 1), Pb = simplifierProfil(profils.b, 0.3, -1);
    const lire = (Pf, x) => {
      for (let i = 0; i < Pf.length - 1; i++) if (x <= Pf[i + 1][0] + 1e-6) { const [a1, z1] = Pf[i], [a2, z2] = Pf[i + 1]; return a2 - a1 < 1e-6 ? z2 : z1 + (z2 - z1) * (x - a1) / (a2 - a1); }
      return Pf.at(-1)[1];
    };
    // bornes : points des quatre profils, et coudes de l'axe
    const bornes = [...new Set([Pg, Pd, Ph, Pb].flatMap(P => P.map(v => +v[0].toFixed(3))).concat(cum.filter(v => v > s0 && v < s1).map(v => +v.toFixed(3))))].sort((u, v) => u - v);
    const sec = bornes.map(x => {
      const g = lire(Pg, x), d = lire(Pd, x), h = lire(Ph, x) - zRef, b = lire(Pb, x) - zRef, A = surAxe(x);
      return { G2: [A.x + A.nx * g, A.y + A.ny * g], D2: [A.x + A.nx * d, A.y + A.ny * d], h, b };
    });
    const P = ([x, y], z) => [x, z, -y];
    const quad = (o, A, B, C, D) => o.push(...A, ...B, ...C, ...A, ...C, ...D);
    for (let i = 0; i < sec.length - 1; i++) {
      const A = sec[i], B = sec[i + 1];
      // dessus (chaussée, texture du terrain), dessous, rives gauche et droite
      quad(haut, P(A.G2, A.h), P(A.D2, A.h), P(B.D2, B.h), P(B.G2, B.h));
      uv.push(...UV(...A.G2), ...UV(...A.D2), ...UV(...B.D2), ...UV(...A.G2), ...UV(...B.D2), ...UV(...B.G2));
      quad(bas, P(A.G2, A.b), P(B.G2, B.b), P(B.D2, B.b), P(A.D2, A.b));
      quad(bas, P(A.G2, A.b), P(A.G2, A.h), P(B.G2, B.h), P(B.G2, B.b));
      quad(bas, P(A.D2, A.b), P(B.D2, B.b), P(B.D2, B.h), P(A.D2, A.h));
    }
    // piles : blocs du dessous du tablier jusqu'au sol (un peu enterrés)
    for (const B of blocs) {
      if (B.np < 12) continue;
      const sa = B.s0 - 0.5, sb = B.s1 + 0.5, ga = B.g - 0.2, da = B.d + 0.2, haut = lire(Pb, (sa + sb) / 2) - zRef;
      const coin = (x, t) => { const A = surAxe(x); return [A.x + A.nx * t, A.y + A.ny * t]; };
      const C4 = [coin(sa, ga), coin(sb, ga), coin(sb, da), coin(sa, da)];
      const pied = Math.min(...C4.map(([x, y]) => solEn(G, x, y))) - 1 - zRef;
      for (let k = 0; k < 4; k++) {
        const A2 = C4[k], B2 = C4[(k + 1) % 4];
        quad(bas, P(A2, pied), P(B2, pied), P(B2, haut), P(A2, haut));
      }
    }
    // bouts (culées)
    const A = sec[0], B = sec.at(-1);
    quad(bas, P(A.G2, A.b), P(A.D2, A.b), P(A.D2, A.h), P(A.G2, A.h));
    quad(bas, P(B.G2, B.b), P(B.G2, B.h), P(B.D2, B.h), P(B.D2, B.b));
  }
  if (!haut.length) return null;
  const dessus = new THREE.BufferGeometry();
  dessus.setAttribute("position", new THREE.Float32BufferAttribute(haut, 3));
  dessus.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  dessus.computeVertexNormals();
  const cotes = new THREE.BufferGeometry();
  cotes.setAttribute("position", new THREE.Float32BufferAttribute(bas, 3));
  cotes.computeVertexNormals();
  return { dessus, cotes };
}

/**
 * Coupe réellement la géométrie d'un maillage au bord du modèle (|x|, |z| ≤ lim, en coordonnées de scène), au lieu
 * de la masquer par des plans de découpe : sinon le bout des murs coupés tombe dans le plan de la face du socle et
 * l'occlusion ambiante (qui voit la géométrie jusqu'au bord) y dessine des stries. La géométrie d'origine est gardée
 * pour redécouper si le maillage bouge (calage des tuiles swisstopo). Les maillages entièrement dedans sont laissés.
 */
export function decouperBord(m, lim) {
  m.updateWorldMatrix(true, false);
  const orig = m.userData.geomOrig || m.geometry, M = m.matrixWorld, e = M.elements;
  if (!orig.boundingBox) orig.computeBoundingBox();
  const bb = orig.boundingBox.clone().applyMatrix4(M);
  const dedans = bb.min.x >= -lim && bb.max.x <= lim && bb.min.z >= -lim && bb.max.z <= lim;
  if (dedans) {
    if (m.userData.geomOrig) { m.geometry.dispose(); m.geometry = orig; delete m.userData.geomOrig; delete m.userData.cleDecoupe; }
    return;
  }
  const cle = e.map(v => v.toFixed(4)).join(",");
  if (m.userData.cleDecoupe === cle) return;
  const pos = orig.attributes.position, nor = orig.attributes.normal, tuv = orig.attributes.uv, idx = orig.index;
  const nt = (idx ? idx.count : pos.count) / 3, outP = [], outN = [], outU = [], source = [];
  // sommet : [lx, ly, lz, nx, ny, nz, wx, wz, u, v]
  const sommet = i => {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    return [x, y, z, nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 0, nor ? nor.getZ(i) : 0,
      e[0] * x + e[4] * y + e[8] * z + e[12], e[2] * x + e[6] * y + e[10] * z + e[14], tuv ? tuv.getX(i) : 0, tuv ? tuv.getY(i) : 0];
  };
  const mel = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  // quatre demi-plans : distance positive = dedans
  const plans = [v => lim - v[6], v => v[6] + lim, v => lim - v[7], v => v[7] + lim];
  for (let t = 0; t < nt; t++) {
    let poly = [0, 1, 2].map(s2 => sommet(idx ? idx.getX(3 * t + s2) : 3 * t + s2));
    for (const d of plans) {
      if (poly.length < 3) break;
      const dist = poly.map(d);
      if (dist.every(v => v >= 0)) continue;
      const nv = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length], da = dist[k], db = dist[(k + 1) % poly.length];
        if (da >= 0) nv.push(a);
        if ((da >= 0) !== (db >= 0)) nv.push(mel(a, b, da / (da - db)));
      }
      poly = nv;
    }
    for (let k = 1; k + 1 < poly.length; k++) {
      source.push(t); // triangle d'origine (désignation des volumes au clic, mode pro)
      for (const v of [poly[0], poly[k], poly[k + 1]]) {
        outP.push(v[0], v[1], v[2]);
        if (nor) outN.push(v[3], v[4], v[5]);
        if (tuv) outU.push(v[8], v[9]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(outP, 3));
  if (nor) g.setAttribute("normal", new THREE.Float32BufferAttribute(outN, 3));
  else g.computeVertexNormals();
  if (tuv) g.setAttribute("uv", new THREE.Float32BufferAttribute(outU, 2));
  // volumes (bâtiments) : ceux des triangles d'origine, un par triangle découpé
  if (orig.userData.volumes) { const V = orig.userData.volumes; g.userData.volumesTri = Int32Array.from(source, t => V[t >> 1] ?? -1); }
  if (m.userData.geomOrig) m.geometry.dispose(); else m.userData.geomOrig = orig;
  m.geometry = g;
  m.userData.cleDecoupe = cle;
}

/**
 * Ponts (classe 17 du relevé) : le tablier, de sa surface jusqu'au dessous relevé (G.pontBas : intrados des arches,
 * pied des piles), avec ses rives ; le vide reste dessous ailleurs. Null s'il n'y a pas de pont.
 * Les bords sont redressés comme les façades (contoursBatiments : coins du bord ramenés sur des côtés droits) ;
 * `dessus` (la chaussée, avec les coordonnées de texture du terrain : le sol continue sur le pont) est séparé de
 * `cotes` (rives et dessous, en plâtre).
 */
export function tabliersPonts(G, zRef) {
  const { n, c, x0, pont, pontBas } = G;
  if (!pont || !pont.some(v => !isNaN(v))) return null;
  // un seul « volume » par pont (la chaussée monte en pente douce) : seuls les bords comptent ici
  const K = contoursBatiments(G, pont, 0.6, 4), m = n + 1;
  const haut = [], uv = [], bas = [];
  const P = (i, j, z) => { const k = j * m + i; return [K.px[k], z - zRef, -K.py[k]]; };
  const UV = (i, j) => { const k = j * m + i; return [(K.px[k] - x0) / (2 * G.R), (K.py[k] - x0) / (2 * G.R)]; };
  const quad = (o, a, b, d, e) => o.push(...a, ...b, ...d, ...a, ...d, ...e);
  const coin = (g, i, j) => { // valeur au coin : moyenne des cellules de tablier voisines
    let s = 0, k = 0;
    for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (a >= 0 && b >= 0 && a < n && b < n && !isNaN(pont[b * n + a])) { s += g[b * n + a]; k++; }
    return s / k;
  };
  const sous = pontBas || pont.map(z => z - 1.5);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (isNaN(pont[j * n + i])) continue;
    const C = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const h = C.map(([a, b]) => coin(pont, a, b)), d = C.map(([a, b]) => coin(sous, a, b)), t = C.map(([a, b]) => UV(a, b));
    quad(haut, P(i, j, h[0]), P(i + 1, j, h[1]), P(i + 1, j + 1, h[2]), P(i, j + 1, h[3])); // dessus
    uv.push(...t[0], ...t[1], ...t[2], ...t[0], ...t[2], ...t[3]);
    quad(bas, P(i, j + 1, d[3]), P(i + 1, j + 1, d[2]), P(i + 1, j, d[1]), P(i, j, d[0])); // dessous (intrados, pied des piles)
    // rives : là où la cellule voisine n'est pas du tablier
    const vide = (a, b) => a < 0 || b < 0 || a >= n || b >= n || isNaN(pont[b * n + a]);
    if (vide(i, j - 1)) quad(bas, P(i, j, d[0]), P(i + 1, j, d[1]), P(i + 1, j, h[1]), P(i, j, h[0]));
    if (vide(i + 1, j)) quad(bas, P(i + 1, j, d[1]), P(i + 1, j + 1, d[2]), P(i + 1, j + 1, h[2]), P(i + 1, j, h[1]));
    if (vide(i, j + 1)) quad(bas, P(i + 1, j + 1, d[2]), P(i, j + 1, d[3]), P(i, j + 1, h[3]), P(i + 1, j + 1, h[2]));
    if (vide(i - 1, j)) quad(bas, P(i, j + 1, d[3]), P(i, j, d[0]), P(i, j, h[0]), P(i, j + 1, h[3]));
  }
  const dessus = new THREE.BufferGeometry();
  dessus.setAttribute("position", new THREE.Float32BufferAttribute(haut, 3));
  dessus.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  dessus.computeVertexNormals();
  const cotes = new THREE.BufferGeometry();
  cotes.setAttribute("position", new THREE.Float32BufferAttribute(bas, 3));
  cotes.computeVertexNormals();
  return { dessus, cotes };
}
