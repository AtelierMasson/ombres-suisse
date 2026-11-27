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
  // piscines (G.bassins) : un rectangle de cases autour de chaque bassin est retiré de la grille, puis retriangulé du
  // bord du rectangle (sommets de la grille, raccord exact avec les cases voisines) jusqu'au contour exact du bassin,
  // qui reste un trou (parois, fond et eau : maillageBassins). Le terrain rejoint ainsi le bord sans jonction.
  const pasM = pas * G.c, retire = new Uint8Array((m - 1) * (m - 1)), plus = [];
  for (const B of G.bassins || []) {
    const xs = B.anneau.map(p => p[0]), ys = B.anneau.map(p => p[1]);
    const a0 = Math.max(0, Math.floor((Math.min(...xs) - 1 - G.x0) / pasM)), a1 = Math.min(m - 1, Math.ceil((Math.max(...xs) + 1 - G.x0) / pasM));
    const b0 = Math.max(0, Math.floor((Math.min(...ys) - 1 - G.x0) / pasM)), b1 = Math.min(m - 1, Math.ceil((Math.max(...ys) + 1 - G.x0) / pasM));
    let libre = a1 > a0 && b1 > b0;
    for (let b = b0; b < b1 && libre; b++) for (let a = a0; a < a1; a++) if (retire[b * (m - 1) + a] || dehors[b * m + a]) { libre = false; break; }
    if (!libre) continue; // deux bassins collés, ou au bord du cercle : celui-ci garde la grille
    for (let b = b0; b < b1; b++) for (let a = a0; a < a1; a++) retire[b * (m - 1) + a] = 1;
    // bord du rectangle, sommet par sommet de la grille (sens trigonométrique)
    const bord = [];
    for (let a = a0; a < a1; a++) bord.push(b0 * m + a);
    for (let b = b0; b < b1; b++) bord.push(b * m + a1);
    for (let a = a1; a > a0; a--) bord.push(b1 * m + a);
    for (let b = b1; b > b0; b--) bord.push(b * m + a0);
    plus.push({ bord, trou: B.anneau, niveau: B.niveau });
  }
  // sommets ajoutés (contours des bassins) après ceux de la grille
  let nAjout = 0; for (const P of plus) nAjout += P.trou.length;
  const posT = new Float32Array(pos.length + nAjout * 3), uvT = new Float32Array(uv.length + nAjout * 2);
  posT.set(pos); uvT.set(uv);
  let k0 = m * m;
  const tris = [];
  for (const P of plus) {
    const base = k0;
    for (const [x, y] of P.trou) {
      posT[3 * k0] = x; posT[3 * k0 + 1] = P.niveau - zRef; posT[3 * k0 + 2] = -y;
      uvT[2 * k0] = (x - G.x0) / (2 * G.R); uvT[2 * k0 + 1] = (y - G.x0) / (2 * G.R); k0++;
    }
    const v2 = k => new THREE.Vector2(posT[3 * k], -posT[3 * k + 2]);
    const contour = P.bord.map(v2), trou = P.trou.map((_, i) => v2(base + i));
    const ids = [...P.bord, ...P.trou.map((_, i) => base + i)];
    for (const [i, j, l] of THREE.ShapeUtils.triangulateShape(contour, [trou])) {
      // même sens que la grille (normale vers le haut : sens trigonométrique vu de dessus)
      const A = ids[i], Bv = ids[j], C = ids[l];
      const cr = (posT[3 * Bv] - posT[3 * A]) * (-posT[3 * C + 2] + posT[3 * A + 2]) - (-posT[3 * Bv + 2] + posT[3 * A + 2]) * (posT[3 * C] - posT[3 * A]);
      if (cr >= 0) tris.push(A, Bv, C); else tris.push(A, C, Bv);
    }
  }
  const idx = new Uint32Array((m - 1) * (m - 1) * 6 + tris.length);
  let q = 0;
  for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
    if (retire[b * (m - 1) + a]) continue;
    const p = b * m + a;
    if (!(dehors[p] && dehors[p + 1] && dehors[p + m + 1])) { idx[q++] = p; idx[q++] = p + 1; idx[q++] = p + m + 1; }
    if (!(dehors[p] && dehors[p + m + 1] && dehors[p + m])) { idx[q++] = p; idx[q++] = p + m + 1; idx[q++] = p + m; }
  }
  for (const v of tris) idx[q++] = v;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(posT, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uvT, 2));
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
/** Ajoute à un socle son fond plat (polygone convexe à l'altitude zBas, face vers le bas) : vu d'en dessous, la
 * maquette est fermée au lieu de laisser voir le vide. `contour` : [[x, y nord], …] dans le sens trigonométrique. */
function avecFond(pos, contour, zBas) {
  const n = contour.length, out = new Float32Array(pos.length + (n - 2) * 9);
  out.set(pos);
  let q = pos.length;
  const [x0, y0] = contour[0];
  for (let k = 1; k < n - 1; k++) {
    // ordre inversé (0, k+1, k) : normale vers le bas
    for (const [x, y] of [[x0, y0], contour[k + 1], contour[k]]) { out[q++] = x; out[q++] = zBas; out[q++] = -y; }
  }
  return out;
}

/**
 * Deux groupes : la paroi (matériau 0, vue des deux côtés) et le fond (matériau 1, vu de dessous seulement). Le fond vu
 * de dessus, à double face, se battait avec le bas de la paroi au bord (même arête, précision de profondeur limitée de
 * loin) : points gris le long du bord inférieur.
 */
function groupesFond(g, nParoi) {
  g.addGroup(0, nParoi, 0);
  g.addGroup(nParoi, g.attributes.position.count - nParoi, 1);
}

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
  const fond = Array.from({ length: nb }, (_, k) => [Math.cos(k / nb * 2 * Math.PI) * R, Math.sin(k / nb * 2 * Math.PI) * R]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(avecFond(pos, fond, zBas), 3));
  g.computeVertexNormals();
  groupesFond(g, pos.length / 3);
  return g;
}

/** Bande d'eau verticale au bord du cercle (maquette ronde), du fond du lac jusqu'à la surface : l'épaisseur du lac. */
export function bordEauRond(G, zRef) {
  if (!G.rayonZone || !G.eau) return null;
  const R = G.rayonZone - 0.05, nb = Math.min(4096, Math.max(256, Math.ceil(2 * Math.PI * R))), pos = [];
  const eauEn = (x, y) => { const i = Math.floor((x - G.x0) / G.c), j = Math.floor((y - G.x0) / G.c); return i < 0 || j < 0 || i >= G.n || j >= G.n ? NaN : G.eau[j * G.n + i]; };
  const point = a => { const x = Math.cos(a) * R, y = Math.sin(a) * R; return [x, y, solEn(G, x, y), eauEn(x * 0.995, y * 0.995)]; };
  let A = point(0);
  for (let k = 1; k <= nb; k++) {
    const B = point(k / nb * 2 * Math.PI);
    if (A[3] > A[2] || B[3] > B[2]) {
      const e = Math.max(isNaN(A[3]) ? -Infinity : A[3], isNaN(B[3]) ? -Infinity : B[3]) - zRef;
      const a0 = Math.min(A[2] - zRef, e), b0 = Math.min(B[2] - zRef, e);
      pos.push(A[0], a0, -A[1], B[0], b0, -B[1], B[0], e, -B[1], A[0], a0, -A[1], B[0], e, -B[1], A[0], e, -A[1]);
    }
    A = B;
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  normalesVersLeHaut(g);
  return g;
}

/**
 * Bande d'eau du bord : normales vers le haut, comme la surface du lac. Avec ses vraies normales (horizontales), la
 * bande était éclairée selon son orientation au soleil : plus claire d'un côté du cercle, sombre de l'autre.
 */
export function normalesVersLeHaut(g) {
  const nor = new Float32Array(g.attributes.position.count * 3);
  for (let k = 1; k < nor.length; k += 3) nor[k] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
}

export function socle(G, zRef, zBas, bords = null, avecReleve = true) {
  // le haut de la paroi monte jusqu'au niveau de l'eau là où le lac touche le bord (sinon l'eau flotte au-dessus)
  const eauEn = (x, y) => { const i = Math.floor((x - G.x0) / G.c), j = Math.floor((y - G.x0) / G.c); return !G.eau || i < 0 || j < 0 || i >= G.n || j >= G.n ? NaN : G.eau[j * G.n + i]; };
  if (G.rayonZone) {
    // haut de la paroi : le toit de nos bâtiments (relevé affiché) et/ou de ceux de comparaison (`bords` = grille de
    // hauteurs des bâtiments swisstopo ou roofer affichés), là où ils sont coupés par le cercle
    const cellule = (a, x, y) => { const i = Math.floor((x - G.x0) / G.c), j = Math.floor((y - G.x0) / G.c); return !a || i < 0 || j < 0 || i >= G.n || j >= G.n ? NaN : a[j * G.n + i]; };
    const grille = bords instanceof Float32Array ? bords : null;
    // la paroi s'arrête au fond du lac : au-dessus, la bordure est une bande d'eau (bordEauRond), on voit l'épaisseur du lac
    return socleRond(G.rayonZone, (x, y) => solEn(G, x, y), zRef, zBas,
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
  g.setAttribute("position", new THREE.BufferAttribute(avecFond(pos, [[-R, -R], [R, -R], [R, R], [-R, R]], zBas), 3));
  g.computeVertexNormals();
  groupesFond(g, pos.length / 3);
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
    const q = B.coins.length, hauts = P ? new Float32Array(q) : B.hauts;
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
      if (Math.abs(xa - xb) + Math.abs(ya - yb) < 1e-4) continue;
      // murs prolongés de 2,5 m sous le sol mesuré aux angles : sur une pente, le terrain entre deux angles peut
      // descendre plus bas, ce qui laissait un jour sous le mur (bâtiment qui semble flotter)
      const sa = solEn(G, xa, ya) - 2.5, sb = solEn(G, xb, yb) - 2.5;
      for (const [t1, z1, t2, z2] of profil) {
        const x1 = entre(xa, xb, t1), y1 = entre(ya, yb, t1), x2 = entre(xa, xb, t2), y2 = entre(ya, yb, t2);
        const b1 = entre(sa, sb, t1) - zRef, b2 = entre(sa, sb, t2) - zRef;
        pos.ajouter(x1, z1 - zRef, -y1, x1, b1, -y1, x2, b2, -y2, x1, z1 - zRef, -y1, x2, b2, -y2, x2, z2 - zRef, -y2);
        vols.ajouter(B.seg);
      }
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
export function simplifierProfil(pts, tol, sens) {
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
export function lireCote(Pf, x, cote) {
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
uniform float taille, echelle, allege;
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
  float px = taille * echelle / max(0.1, -mvPosition.z);
  // loin de la caméra : moins de points, plus gros (même couverture) ; chaque point a un rang fixe, tiré de son numéro
  if (allege > 0.0 && projectionMatrix[2][3] != 0.0) {
    float d = length(mvPosition.xyz), garde = clamp(pow(allege / max(d, 1.0), 0.9), 0.12, 1.0);
    uint h = uint(gl_VertexID) * 2654435761u; h ^= h >> 15; h *= 2246822519u; h ^= h >> 13;
    if (float(h & 0xFFFFFFu) / 16777216.0 > garde) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    px *= inversesqrt(garde);
  }
  gl_PointSize = clamp(px, 2.0, 44.0);
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
  // pour un matériau mat ; chaque point est un disque plat, d'une seule teinte (pas de relief de boule) : sa normale
  // regarde vers le ciel et un peu vers la caméra. Le matin, le soir et la nuit suivent d'eux-mêmes, sans réglage à part.
  vec3 N = normalize(normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz) + vec3(0.0, 0.0, 0.7));
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
      taille: { value: taille }, echelle: { value: 800 }, allege: { value: parClasse ? 0 : 140 }, lum: { value: 1 }, relief: { value: 1 }, ombre: { value: 0.5 }, gris: { value: 0 },
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
      // maquette ronde : l'eau s'arrête au cercle (au-delà, celle de l'anneau prend le relais, sans recouvrement)
      if (G.rayonZone && Math.hypot(x0 + (i + 0.5) * c, x0 + (j + 0.5) * c) > G.rayonZone + 0.5) { i++; continue; }
      if (isNaN(h)) { i++; continue; }
      let k = i + 1;
      while (k < n && eau[j * n + k] === h && !(G.rayonZone && Math.hypot(x0 + (k + 0.5) * c, x0 + (j + 0.5) * c) > G.rayonZone + 0.5)) k++; // suite de cellules au même niveau (lac) : un seul quadrilatère
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
 * Axe droit d'un pont court : les bouts sont les cases du bord du tablier dont la voisine hors du pont est au sol, au
 * niveau de la chaussée (± 0,75 m), regroupées par contiguïté ; l'axe relie les centres des deux plus grands groupes,
 * prolongé de 6 m au-delà des cases extrêmes. Null si le pont n'a pas deux bouts nets, ou s'ils sont à plus de 60 m.
 */
function axeDroit(G, cel, rang, X, Y) {
  const { n, c, pont, sol } = G, bord = [];
  for (let k = 0; k < cel.length; k++) {
    const p = cel[k], i = p % n;
    for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
      if (q >= 0 && q < n * n && !rang.has(q) && Math.abs(sol[q] - pont[p]) < 0.75) { bord.push(k); break; }
  }
  // groupes de cases de bout voisines (à 1 m près)
  const dansBord = new Map(bord.map(k => [cel[k], k])), vu = new Set(), groupes = [], r = Math.round(1 / c);
  for (const k0 of bord) {
    if (vu.has(k0)) continue;
    const g = [k0], pile = [k0];
    vu.add(k0);
    while (pile.length) {
      const k = pile.pop(), p = cel[k], i = p % n, j = Math.floor(p / n);
      for (let b = j - r; b <= j + r; b++) for (let a = i - r; a <= i + r; a++) {
        const kk = a >= 0 && a < n ? dansBord.get(b * n + a) : undefined;
        if (kk !== undefined && !vu.has(kk)) { vu.add(kk); g.push(kk); pile.push(kk); }
      }
    }
    groupes.push(g);
  }
  groupes.sort((a, b) => b.length - a.length);
  if (groupes.length < 2 || groupes[1].length < 6) return null;
  const centre = g => [g.reduce((s, k) => s + X[k], 0) / g.length, g.reduce((s, k) => s + Y[k], 0) / g.length];
  const A = centre(groupes[0]), B = centre(groupes[1]), L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (L < 4 || L > 60) return null;
  const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (let k = 0; k < cel.length; k++) {
    const s = (X[k] - A[0]) * ux + (Y[k] - A[1]) * uy, t = (Y[k] - A[1]) * ux - (X[k] - A[0]) * uy;
    if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t;
  }
  // le tablier entier doit être petit, dans les deux sens : un long pont dont deux groupes proches touchent le sol
  // (rampe, trottoir au niveau de la rue) garde l'axe suivi dans le tablier
  if (s1 - s0 > 80 || t1 - t0 > 60) return null;
  return [[A[0] + ux * (s0 - 6), A[1] + uy * (s0 - 6)], [A[0] + ux * (s1 + 6), A[1] + uy * (s1 + 6)]];
}

/** Droite ajustée sur des points [x, y] par moindres carrés, en écartant à trois reprises les points trop éloignés. */
function droiteRobuste(P) {
  let pts = P, f = () => 0;
  for (let tour = 0; tour < 4; tour++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const m = pts.length, det = m * sxx - sx * sx, a = det > 1e-9 ? (m * sxy - sx * sy) / det : 0, b = (sy - a * sx) / m;
    f = x => a * x + b;
    if (tour === 3) break;
    const e = pts.map(([x, y]) => Math.abs(y - f(x))).sort((u, v) => u - v), lim = Math.max(0.3, 2.5 * e[e.length >> 1]);
    const garde = pts.filter(([x, y]) => Math.abs(y - f(x)) <= lim);
    if (garde.length < 3) break;
    pts = garde;
  }
  return f;
}

/**
 * Lissage de Whittaker d'une suite régulière : minimise Σ w (z − y)² + λ Σ (courbure de z)². Les valeurs NaN ou de
 * poids nul sont franchies en ligne droite ; λ fixe la raideur (longueur d'onde gardée ≈ 2π λ^¼ pas).
 */
function lisser(y, w, lambda) {
  const m = y.length;
  if (m < 3) { const ok = Array.from(y).filter((v, i) => w[i] > 0 && !isNaN(v)), moy = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0; return Float64Array.from(y, (v, i) => w[i] > 0 && !isNaN(v) ? v : moy); }
  // matrice à cinq bandes A = W + λ DᵀD (D : différences secondes) : diagonale d0, puis d1 et d2
  const d0 = new Float64Array(m), d1 = new Float64Array(m), d2 = new Float64Array(m), z = new Float64Array(m);
  for (let i = 0; i < m; i++) { const p = w[i] > 0 && !isNaN(y[i]) ? w[i] : 0; d0[i] = p + 1e-9; z[i] = p ? p * y[i] : 0; }
  for (let i = 0; i < m - 2; i++) { d0[i] += lambda; d0[i + 1] += 4 * lambda; d0[i + 2] += lambda; d1[i] -= 2 * lambda; d1[i + 1] -= 2 * lambda; d2[i] += lambda; }
  // factorisation L D Lᵀ en place (d0 : D ; d1, d2 : les deux sous-diagonales de L), puis les deux substitutions
  for (let i = 0; i < m; i++) {
    if (i >= 1) d0[i] -= d1[i - 1] * d1[i - 1] * d0[i - 1];
    if (i >= 2) d0[i] -= d2[i - 2] * d2[i - 2] * d0[i - 2];
    if (i >= 1) d1[i] -= d1[i - 1] * d2[i - 1] * d0[i - 1];
    d1[i] /= d0[i]; d2[i] /= d0[i];
  }
  for (let i = 0; i < m; i++) { if (i >= 1) z[i] -= d1[i - 1] * z[i - 1]; if (i >= 2) z[i] -= d2[i - 2] * z[i - 2]; }
  for (let i = m - 1; i >= 0; i--) { z[i] /= d0[i]; if (i + 1 < m) z[i] -= d1[i] * z[i + 1]; if (i + 2 < m) z[i] -= d2[i] * z[i + 2]; }
  return z;
}

/** Lissage robuste : les valeurs à plus de max(`seuil`, 2,5 écarts médians) de la courbe sont écartées, trois fois. */
function lisserRobuste(y, lambda, seuil, poids = null) {
  const p0 = Float64Array.from(y, (v, i) => isNaN(v) ? 0 : poids ? poids[i] : 1);
  let z = lisser(y, p0, lambda);
  for (let tour = 0; tour < 3; tour++) {
    const e = [];
    for (let i = 0; i < y.length; i++) if (p0[i] > 0) e.push(Math.abs(y[i] - z[i]));
    if (e.length < 4) break;
    e.sort((a, b) => a - b);
    const lim = Math.max(seuil, 2.5 * e[e.length >> 1]);
    z = lisser(y, p0.map((p, i) => p > 0 && Math.abs(y[i] - z[i]) <= lim ? p : 0), lambda);
  }
  return z;
}

/** Hauteur du terrain tel qu'il est affiché (triangles d'un mètre de `terrain`) au point (x, y). */
function solAffiche(G, x, y) {
  const pas = 2 * G.c, a = Math.floor((x - G.x0) / pas), b = Math.floor((y - G.x0) / pas), u = (x - G.x0) / pas - a, v = (y - G.x0) / pas - b;
  const z = (i, j) => solEn(G, G.x0 + i * pas, G.x0 + j * pas), z00 = z(a, b), z11 = z(a + 1, b + 1);
  return u >= v ? z00 + u * (z(a + 1, b) - z00) + v * (z11 - z(a + 1, b)) : z00 + u * (z11 - z(a, b + 1)) + v * (z(a, b + 1) - z00);
}

/**
 * Ponts allégés : chaque pont (cellules de tablier connexes) devient un solide balayé le long de son axe.
 * - axe : droit entre les deux raccords (pont court), sinon la suite lissée des centres du tablier, redressée si elle
 *   est presque droite ; normales continues d'un nœud à l'autre (pas de coin aux coudes) ;
 * - rives : écarts à l'axe relevés tous les mètres, puis ajustés (droite robuste pour un pont court, courbe raide
 *   sinon) : des bords nets, sans dents de scie ;
 * - profil en long : une courbe lisse ajustée sur la chaussée et sur 15 m de route de chaque côté, avec le dévers ;
 * - raccord : à chaque bout posé sur le terrain, le tablier est prolongé jusqu'au joint (là où le terrain rejoint le
 *   profil), s'y fond sur 3 m puis plonge sous le terrain ; plein jusqu'au sol tant que la hauteur libre est faible ;
 * - dessus : faces tournées vers le haut, normales de la surface ajustée (fondues dans celles du terrain au raccord).
 * Un pont que ce modèle décrit mal (emprise ou hauteur trop différentes du relevé) reste rendu case par case.
 * Retourne { dessus (avec coordonnées de texture du terrain), cotes } ou null.
 */
export function pontsLegers(G, zRef, nuage = null) {
  const { n, c, x0, pont, pontBas } = G;
  if (!pont || !pont.some(v => !isNaN(v))) return null;
  const sous = pontBas || pont.map(z => z - 1.5), vu = new Uint8Array(n * n), haut = [], uv = [], nor = [], bas = [];
  // points vus sous le tablier (nuage du relevé) : classe « pont » à moins de 7 m sous la chaussée = dessous du
  // tablier ; plus bas, ou classe 27 (ouvrages) = piles
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
      // dessous du tablier : jusqu'à 7 m sous la chaussée (caissons, poutres) ; plus bas, ce sont des piles
      const M = cl === 17 && d < 7 ? intrados : piles;
      (M.get(p) || M.set(p, []).get(p)).push(Z[k]);
    }
  }
  const avecNuage = !!nuage;
  const UV = (x, y) => [(x - x0) / (2 * G.R), (y - x0) / (2 * G.R)];
  const med = a => { if (!a.length) return NaN; a.sort((u, v) => u - v); return a[a.length >> 1]; };
  const P = ([x, y], z) => [x, z, -y];
  const quad = (o, A, B, C, D) => o.push(...A, ...B, ...C, ...A, ...C, ...D);
  // normale du terrain affiché (repère de la scène), pour fondre l'éclairage de la chaussée dans celui de la route
  const normaleSol = (x, y) => { const a = -(solEn(G, x + 1, y) - solEn(G, x - 1, y)) / 2, b = (solEn(G, x, y + 1) - solEn(G, x, y - 1)) / 2, l = Math.hypot(a, 1, b); return [a / l, 1 / l, b / l]; };
  const infos = [], repli = pont.map(() => NaN);
  let nRepli = 0;
  // cases « pont » à moins d'un mètre du sol : sol sous le tablier classé « pont », ou bout de pont posé sur la route.
  // Elles ne font pas le tablier (le raccord aux bouts rejoint la route) ; marquées vues, elles sont ignorées
  for (let p = 0; p < n * n; p++) if (!isNaN(pont[p]) && !(pont[p] - G.sol[p] > 1)) vu[p] = 1;
  const tabliers = [];
  for (let p0 = 0; p0 < n * n; p0++) {
    if (vu[p0] || isNaN(pont[p0])) continue;
    // un pont : cellules connexes
    const cel = [], pile = [p0];
    vu[p0] = 1;
    while (pile.length) {
      const p = pile.pop(), i = p % n;
      cel.push(p);
      for (const q of [i > 0 ? p - 1 : -1, i < n - 1 ? p + 1 : -1, p - n, p + n])
        if (q >= 0 && q < n * n && !vu[q] && !isNaN(pont[q])) { vu[q] = 1; pile.push(q); } // (cases au sol déjà « vues »)
    }
    if (cel.length * c * c >= 20) tabliers.push(cel);
  }
  // modèle d'un pont (ses cellules) : ajoute ses faces ; false s'il doit être rendu tel que relevé
  const modeliser = cel => {
    // axe du pont, droit ou courbe : on ordonne les cellules le long du pont (distance dans le tablier depuis un bout),
    // puis l'axe est la suite des centres par tranche, lissée ; chaque cellule est ensuite projetée sur cet axe :
    // abscisse curviligne s et écart t (positif à gauche)
    const X = cel.map(p => x0 + (p % n + 0.5) * c), Y = cel.map(p => x0 + (Math.floor(p / n) + 0.5) * c);
    const rang = new Map(cel.map((p, k) => [p, k]));
    // pont court (bouts à moins de 60 m l'un de l'autre) : axe droit d'un bout à l'autre. Pour un pont aussi large que
    // long (rue qui franchit un canal), le parcours dans le tablier part d'un coin et donne un axe en biais : tablier
    // en losange, rives en dents de scie
    const droit = axeDroit(G, cel, rang, X, Y);
    let axe = droit;
    if (!axe) {
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
      // les tranches des bouts (coins du tablier, peu de cases) tirent l'axe de travers : écartées
      const plein = med(Array.from(cn).filter(v => v > 0));
      let q0 = 0, q1 = nt - 1;
      while (q1 - q0 > 2 && cn[q0] < 0.6 * plein) q0++;
      while (q1 - q0 > 2 && cn[q1] < 0.6 * plein) q1--;
      axe = [];
      for (let q = q0; q <= q1; q++) if (cn[q]) axe.push([cx[q] / cn[q], cy[q] / cn[q]]);
      if (axe.length < 2) return false;
      // lissage (trois passes), bouts fixes
      for (let passe = 0; passe < 3; passe++) axe = axe.map((v, i) => i === 0 || i === axe.length - 1 ? v : [(axe[i - 1][0] + 2 * v[0] + axe[i + 1][0]) / 4, (axe[i - 1][1] + 2 * v[1] + axe[i + 1][1]) / 4]);
      // presque droit (moins de 40 cm d'écart à la corde) : une droite
      {
        const [ax, ay] = axe[0], [bx, by] = axe.at(-1), L = Math.hypot(bx - ax, by - ay) || 1;
        if (axe.every(([x, y]) => Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) / L < 0.4)) axe = [axe[0], axe.at(-1)];
      }
    }
    // prolongement de 45 m à chaque bout, dans la direction des 12 derniers mètres (raccord à la route, projection)
    {
      const vers = (A, B) => { const dx = A[0] - B[0], dy = A[1] - B[1], l = Math.hypot(dx, dy) || 1; return [A[0] + dx / l * 45, A[1] + dy / l * 45]; };
      const k = Math.min(3, axe.length - 1);
      axe = [vers(axe[0], axe[k]), ...axe, vers(axe.at(-1), axe.at(-1 - k))];
    }
    const cum = [0];
    for (let i = 1; i < axe.length; i++) cum.push(cum[i - 1] + Math.hypot(axe[i][0] - axe[i - 1][0], axe[i][1] - axe[i - 1][1]));
    // normale (gauche) à chaque nœud : perpendiculaire à la corde de ses deux voisins, interpolée entre les nœuds
    const nrm = axe.map((_, i) => { const A = axe[Math.max(0, i - 1)], B = axe[Math.min(axe.length - 1, i + 1)], l = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1; return [-(B[1] - A[1]) / l, (B[0] - A[0]) / l]; });
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
      const [ax, ay] = axe[i], [bx, by] = axe[i + 1], L = cum[i + 1] - cum[i] || 1, u = Math.max(0, Math.min(1, (s - cum[i]) / L));
      const nx = nrm[i][0] + (nrm[i + 1][0] - nrm[i][0]) * u, ny = nrm[i][1] + (nrm[i + 1][1] - nrm[i][1]) * u, l = Math.hypot(nx, ny) || 1;
      return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, nx: nx / l, ny: ny / l };
    };
    const enPlan = (s, t) => { const A = surAxe(s); return [A.x + A.nx * t, A.y + A.ny * t]; };
    // stations d'un mètre le long de l'axe
    let s0 = Infinity, s1 = -Infinity;
    const ST = cel.map((p, k) => { const v = projeter(X[k], Y[k]); if (v[0] < s0) s0 = v[0]; if (v[0] > s1) s1 = v[0]; return v; });
    const nb = Math.max(2, Math.ceil(s1 - s0) + 1), st = Array.from({ length: nb }, () => ({ g: Infinity, d: -Infinity, c: [], b: [], pile: 0, pg: Infinity, pd: -Infinity, pz0: Infinity, pz1: -Infinity, sol: Infinity }));
    for (let k = 0; k < cel.length; k++) {
      const [sk, t] = ST[k], q = Math.min(nb - 1, Math.round(sk - s0)), T = st[q], p = cel[k];
      if (t - c / 2 < T.g) T.g = t - c / 2;
      if (t + c / 2 > T.d) T.d = t + c / 2;
      T.c.push([t, pont[p]]);
      if (avecNuage) {
        // dessous : les points du dessous du tablier ; piles : leur emprise en travers
        for (const z of intrados.get(p) || []) T.b.push(z);
        const Q = piles.get(p);
        if (Q) {
          T.pile += Q.length; if (t - c / 2 < T.pg) T.pg = t - c / 2; if (t + c / 2 > T.pd) T.pd = t + c / 2;
          for (const z of Q) { if (z < T.pz0) T.pz0 = z; if (z > T.pz1) T.pz1 = z; }
        }
        if (!isNaN(G.sol[p]) && G.sol[p] < T.sol) T.sol = G.sol[p];
      } else if (!isNaN(sous[p])) T.b.push(sous[p]);
    }
    // rives : droites pour un pont court (largeur constante ou linéaire, moindres carrés robustes) ; sinon une courbe
    // raide qui écarte les cases isolées du bord (trottoirs, quais, bouts de rue classés « pont »)
    const brut = cle => st.map(T => T.g === Infinity ? NaN : T[cle]);
    let gA, dA;
    if (droit && nb >= 4) {
      [gA, dA] = ["g", "d"].map(cle => { const f = droiteRobuste(st.map((T, q) => [q, T[cle]]).filter(v => isFinite(v[1]))); return Float64Array.from(st, (_, q) => f(q)); });
    } else { gA = lisserRobuste(brut("g"), 1500, 0.4); dA = lisserRobuste(brut("d"), 1500, 0.4); }
    for (let q = 0; q < nb; q++) if (dA[q] - gA[q] < 1) { const m = (gA[q] + dA[q]) / 2; gA[q] = m - 0.5; dA[q] = m + 0.5; }
    // lecture d'une suite par station à l'abscisse s (interpolée, bornée aux bouts)
    const lire = (A, s, dec = 0) => { const f = Math.max(0, Math.min(A.length - 1, s - s0 + dec)), i = Math.min(A.length - 2, Math.floor(f)); return A[i] + (A[i + 1] - A[i]) * (f - i); };
    // l'emprise ajustée doit recouvrir celle du relevé, sinon le pont est rendu tel que relevé (carrefour sur dalle,
    // tabliers accolés, bretelle qui se détache…)
    let dedans = 0, aire = 0;
    for (let k = 0; k < cel.length; k++) { const [sk, t] = ST[k]; if (t >= lire(gA, sk) - 0.3 && t <= lire(dA, sk) + 0.3) dedans++; }
    for (let q = 0; q < nb; q++) aire += dA[q] - gA[q];
    const iou = dedans * c * c / (aire * (s1 - s0) / (nb - 1) + (cel.length - dedans) * c * c);
    // chaussée par station : médiane des cases du milieu (les bords portent bordures, garde-corps et parois) ; dévers
    // par moindres carrés sur les mêmes cases
    const hS = new Float64Array(nb).fill(NaN), pS = new Float64Array(nb).fill(NaN), eS = new Float64Array(nb).fill(NaN);
    for (let q = 0; q < nb; q++) {
      const T = st[q], m = (gA[q] + dA[q]) / 2, l = dA[q] - gA[q];
      if (!T.c.length) continue;
      const mil = T.c.filter(v => Math.abs(v[0] - m) <= 0.35 * l), C = mil.length >= 3 ? mil : T.c;
      hS[q] = med(C.map(v => v[1]));
      const prox = C.filter(v => Math.abs(v[1] - hS[q]) < 0.5);
      if (prox.length >= 6) {
        let st1 = 0, sz = 0, stt = 0, stz = 0;
        for (const [t, z] of prox) { st1 += t - m; sz += z; stt += (t - m) ** 2; stz += (t - m) * z; }
        const det = prox.length * stt - st1 * st1;
        if (det > prox.length * prox.length * 0.5) pS[q] = (prox.length * stz - st1 * sz) / det;
      }
      // épaisseur : le haut des points vus sous le tablier (85 %), entre 0,4 et 7 m sous la chaussée. Le relevé classe
      // parfois « pont » le sol sous le tablier : ces points ne font pas le dessous, sinon le pont devient un mur plein
      const bb = T.b.filter(z => z < hS[q] - 0.4 && z > hS[q] - 7).sort((u, v) => u - v);
      if (bb.length) eS[q] = hS[q] - bb[Math.min(bb.length - 1, Math.floor(bb.length * 0.85))];
    }
    const hBouts = [med(Array.from(hS.slice(0, 4)).filter(v => !isNaN(v))), med(Array.from(hS.slice(-4)).filter(v => !isNaN(v)))];
    if (hBouts.some(isNaN)) return false;
    // au-delà des bouts, sur 15 m : la route (cases « pont » au ras du sol, sinon le terrain), au milieu du tablier
    const EXT = 15, mil = [(gA[0] + dA[0]) / 2, (gA[nb - 1] + dA[nb - 1]) / 2], lar = [dA[0] - gA[0], dA[nb - 1] - gA[nb - 1]];
    const hE = new Float64Array(nb + 2 * EXT).fill(NaN), wE = new Float64Array(nb + 2 * EXT);
    for (let q = 0; q < nb; q++) { hE[q + EXT] = hS[q]; wE[q + EXT] = 1; }
    const route = (s, b) => med([-0.3, 0, 0.3].map(f => {
      const [x, y] = enPlan(s, mil[b] + f * lar[b]), i = Math.floor((x - x0) / c), j = Math.floor((y - x0) / c), v = i >= 0 && j >= 0 && i < n && j < n ? pont[j * n + i] : NaN;
      return isNaN(v) ? solEn(G, x, y) : v;
    }).filter(v => !isNaN(v)));
    // bout libre : la route ne rejoint pas le niveau du tablier dans les 15 m (pont coupé par le bord du modèle, par
    // un pont modélisé à part, ou tablier qui continue hors du relevé) : pas de raccord, le tablier s'arrête là
    const libre = [true, true];
    for (const b of [0, 1]) for (let e = 1; e <= EXT; e++) {
      const s = b ? s1 + e : s0 - e, v = route(s, b), q = b ? nb - 1 + EXT + e : EXT - e;
      if (isNaN(v) || Math.abs(v - hBouts[b]) > 1 + 0.1 * e) continue;
      hE[q] = v; wE[q] = 1;
      if (Math.abs(v - hBouts[b]) <= 0.6 + 0.08 * e) libre[b] = false;
    }
    for (const b of [0, 1]) if (libre[b]) for (let e = 1; e <= EXT; e++) wE[b ? nb - 1 + EXT + e : EXT - e] = 0;
    // profil en long : une courbe lisse sur le tablier et la route ; dévers et épaisseur lissés de même
    const zA = lisserRobuste(hE, 60, 0.15, wE), pA = lisserRobuste(pS, 4000, 0.01).map(v => Math.max(-0.08, Math.min(0.08, v)));
    {
      // épaisseur sans mesure : reprise des stations voisines (sinon 1,2 m)
      let der = NaN;
      for (let q = 0; q < nb; q++) { if (isNaN(eS[q])) eS[q] = der; else der = eS[q]; }
      der = NaN;
      for (let q = nb - 1; q >= 0; q--) { if (isNaN(eS[q])) eS[q] = isNaN(der) ? 1.2 : der; else der = eS[q]; }
    }
    const eA = lisserRobuste(eS, 20, 0.3).map(v => Math.max(0.4, Math.min(7, v)));
    const profil = s => lire(zA, s, EXT), milieu = s => (lire(gA, s) + lire(dA, s)) / 2;
    // écart entre la chaussée ajustée et le relevé (médiane) : trop grand, le pont est rendu tel que relevé
    const ecart = med(cel.map((p, k) => { const [sk, t] = ST[k]; return Math.abs(profil(sk) + lire(pA, sk) * (t - milieu(sk)) - pont[p]); }));
    const info = { x: +(X.reduce((a, b) => a + b, 0) / cel.length).toFixed(1), y: +(Y.reduce((a, b) => a + b, 0) / cel.length).toFixed(1), longueur: +(s1 - s0).toFixed(1), largeur: +(aire / nb).toFixed(1), droit: !!droit || axe.length === 4, iou: +iou.toFixed(2), ecart: +ecart.toFixed(2), libre };
    infos.push(info);
    if (iou < 0.7 || ecart > 0.4) { info.repli = true; return false; }
    // joint de chaque bout : là où le terrain affiché rejoint le profil (à 25 cm près, sur 2 m) ; à défaut, au plus près
    const joint = [s0, s1];
    for (const b of [0, 1]) {
      if (libre[b]) continue;
      const dz = e => { const s = b ? s1 + e : s0 - e; return Math.abs(profil(s) - solAffiche(G, ...enPlan(s, mil[b]))); };
      let trouve = -1, mieux = 0;
      for (let e = 0; e < EXT; e++) {
        if (dz(e) <= 0.25 && dz(e + 1) <= 0.25) { trouve = e + 1; break; }
        if (dz(e) < dz(mieux)) mieux = e;
      }
      if (trouve < 0) { if (dz(mieux) > 1) { libre[b] = true; continue; } trouve = mieux; }
      joint[b] = b ? s1 + trouve : s0 - trouve;
    }
    info.joints = [+(s0 - joint[0]).toFixed(1), +(joint[1] - s1).toFixed(1)];
    info.bouts = [0, 1].map(b => enPlan(joint[b], mil[b]).map(v => +v.toFixed(1)));
    // sections : tous les mètres du premier joint au dernier (1,5 m de plus, sous le terrain), puis allégées
    const FONDU = 3, PLONGE = 1.5, nT = Math.max(2, Math.min(6, Math.round(aire / nb / 3.5)));
    const debut = libre[0] ? s0 - c / 2 : joint[0] - PLONGE, fin = libre[1] ? s1 + c / 2 : joint[1] + PLONGE;
    const section = s => {
      const sc = Math.max(s0, Math.min(s1, s)), g = lire(gA, sc), d = lire(dA, sc), m = (g + d) / 2, z = profil(s), pente = lire(pA, sc), A = surAxe(s);
      // raccord : poids du terrain (0 sur le tablier, 1 au joint) et enfoncement sous le terrain
      const dj = Math.max(libre[0] ? -Infinity : joint[0] - s, libre[1] ? -Infinity : s - joint[1]);
      const w0 = Math.max(0, Math.min(1, 1 + dj / FONDU)), w = w0 * w0 * (3 - 2 * w0), plonge = 0.06 + Math.max(0, dj / PLONGE) * 0.3;
      const S = { s, w, xy: [], z: [], sol: [] };
      let libreMin = Infinity, solMin = Infinity, zMin = Infinity;
      for (let k = 0; k <= nT; k++) {
        const t = g + (d - g) * k / nT, xy = [A.x + A.nx * t, A.y + A.ny * t], zs = solAffiche(G, ...xy);
        let zt = z + pente * (t - m);
        libreMin = Math.min(libreMin, zt - zs); solMin = Math.min(solMin, zs);
        // chaque point de la chaussée glisse vers le terrain sous lui (sauf mur ou talus : plus de 1,5 m d'écart)
        if (w > 0 && Math.abs(zs - zt) < 1.5) zt += (zs - plonge - zt) * w;
        zMin = Math.min(zMin, zt);
        S.xy.push(xy); S.z.push(zt - zRef); S.sol.push(zs);
      }
      // dessous : épaisseur du tablier ; plein jusque sous le terrain près du sol (culée) et au-delà des cases du tablier
      S.plein = libreMin < 1.2 || (!libre[0] && s < s0) || (!libre[1] && s > s1);
      S.bo = Math.min(zMin - 0.3, profil(s) - lire(eA, sc)) - zRef;
      S.bp = Math.min(S.bo, solMin - 0.6 - zRef);
      return S;
    };
    const nbS = Math.max(1, Math.ceil(fin - debut)), toutes = Array.from({ length: nbS + 1 }, (_, i) => section(debut + (fin - debut) * i / nbS));
    // un court jour (moins de 6 m) entre deux parties pleines est bouché : pas de fenêtre sous un tablier au ras du sol
    for (let i = 1, a = -1; i < toutes.length; i++) {
      if (toutes[i].plein) { if (a >= 0 && i - a > 1 && toutes[i].s - toutes[a].s < 6) for (let k = a + 1; k < i; k++) toutes[k].plein = true; a = i; }
    }
    // allègement : une section n'est gardée que si, sans elle, un point du tablier s'écarterait de plus de 5 cm
    // (Douglas-Peucker sur les points du dessus et le dessous) ; les changements plein / ajouré sont gardés
    const garde = new Uint8Array(toutes.length), aFaire = [];
    garde[0] = garde[toutes.length - 1] = 1;
    for (let i = 0; i < toutes.length - 1; i++) if (toutes[i].plein !== toutes[i + 1].plein) garde[i] = garde[i + 1] = 1;
    for (let i = 0, a = 0; i < toutes.length; i++) if (garde[i]) { if (i > a + 1) aFaire.push([a, i]); a = i; }
    while (aFaire.length) {
      const [a, b] = aFaire.pop(), A = toutes[a], B = toutes[b];
      let pire = -1, dmax = 0.05;
      for (let i = a + 1; i < b; i++) {
        const S = toutes[i], u = (S.s - A.s) / (B.s - A.s);
        let e = Math.abs(S.bo - (A.bo + (B.bo - A.bo) * u));
        if (S.plein) e = Math.max(e, Math.abs(S.bp - (A.bp + (B.bp - A.bp) * u)) / 4); // (pied enterré : moins exigeant)
        for (let k = 0; k <= nT; k++) e = Math.max(e, Math.hypot(S.xy[k][0] - (A.xy[k][0] + (B.xy[k][0] - A.xy[k][0]) * u), S.xy[k][1] - (A.xy[k][1] + (B.xy[k][1] - A.xy[k][1]) * u), S.z[k] - (A.z[k] + (B.z[k] - A.z[k]) * u)));
        if (e > dmax) { dmax = e; pire = i; }
      }
      if (pire > 0) { garde[pire] = 1; aFaire.push([a, pire], [pire, b]); }
    }
    const sec = toutes.filter((_, i) => garde[i]);
    info.sections = sec.length;
    // normales du dessus : celles de la surface ajustée (lisses d'une section à l'autre), fondues dans celles du
    // terrain au raccord : plus de couture d'éclairage entre la route et le tablier
    const pt = (i, k) => { const S = sec[Math.max(0, Math.min(sec.length - 1, i))], kk = Math.max(0, Math.min(nT, k)); return [S.xy[kk][0], S.z[kk], -S.xy[kk][1]]; };
    for (let i = 0; i < sec.length; i++) {
      const S = sec[i];
      S.n = [];
      for (let k = 0; k <= nT; k++) {
        const a = pt(i - 1, k), b = pt(i + 1, k), e = pt(i, k - 1), f = pt(i, k + 1), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [f[0] - e[0], f[1] - e[1], f[2] - e[2]];
        let N = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        if (N[1] < 0) N = N.map(x => -x);
        const l = Math.hypot(...N) || 1, T = S.w > 0 ? normaleSol(...S.xy[k]) : null;
        N = N.map((x, q) => x / l * (1 - S.w) + (T ? T[q] * S.w : 0));
        const l2 = Math.hypot(...N) || 1;
        S.n.push(N.map(x => x / l2));
      }
    }
    // sens des faces du dessus : tournées vers le haut (la matière du terrain ne montre que cette face)
    const tri = (A, a, B, b, C, cc) => {
      const pa = P(A.xy[a], A.z[a]), pb = P(B.xy[b], B.z[b]), pc = P(C.xy[cc], C.z[cc]);
      const versHaut = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]) > 0;
      const L = versHaut ? [[A, a, pa], [B, b, pb], [C, cc, pc]] : [[A, a, pa], [C, cc, pc], [B, b, pb]];
      for (const [S, k, p] of L) { haut.push(...p); uv.push(...UV(...S.xy[k])); nor.push(...S.n[k]); }
    };
    const bord = (S, k, z) => P(S.xy[k], z);
    for (let i = 0; i < sec.length - 1; i++) {
      const A = sec[i], B = sec[i + 1], plein = A.plein && B.plein, ba = plein ? A.bp : A.bo, bb = plein ? B.bp : B.bo;
      for (let k = 0; k < nT; k++) { tri(A, k, A, k + 1, B, k + 1); tri(A, k, B, k + 1, B, k); }
      // dessous, rives gauche et droite
      quad(bas, bord(A, 0, ba), bord(B, 0, bb), bord(B, nT, bb), bord(A, nT, ba));
      quad(bas, bord(A, 0, ba), bord(A, 0, A.z[0]), bord(B, 0, B.z[0]), bord(B, 0, bb));
      quad(bas, bord(A, nT, ba), bord(B, nT, bb), bord(B, nT, B.z[nT]), bord(A, nT, A.z[nT]));
      // face de culée : là où le tablier plein devient ajouré
      const suivant = i + 2 < sec.length ? B.plein && sec[i + 2].plein : plein;
      if (suivant !== plein && B.bp < B.bo - 0.01) quad(bas, bord(B, 0, B.bp), bord(B, nT, B.bp), bord(B, nT, B.bo), bord(B, 0, B.bo));
    }
    // bouts : fermés (enterrés dans la route, ou coupe franche d'un bout libre)
    for (const [S, T] of [[sec[0], sec[1]], [sec.at(-1), sec.at(-2)]]) {
      const b = S.plein && T.plein ? S.bp : S.bo;
      for (let k = 0; k < nT; k++) quad(bas, bord(S, k, b), bord(S, k + 1, b), bord(S, k + 1, S.z[k + 1]), bord(S, k, S.z[k]));
    }
    // maquette ronde : le pont coupé par le cercle y est fermé par une paroi (du dessous à la chaussée), sinon la
    // coupe montre l'intérieur du tablier
    if (G.rayonZone) {
      const Rc = G.rayonZone - 0.05, pasA = 0.5 / Rc;
      let coupe = false;
      for (let k = 0; k < cel.length; k++) if (X[k] * X[k] + Y[k] * Y[k] > (Rc - 2) ** 2) { coupe = true; break; }
      let avant = null;
      for (let a = 0; coupe && a < 2 * Math.PI + pasA; a += pasA) {
        const x = Rc * Math.cos(a), y = Rc * Math.sin(a), [sk, t] = projeter(x, y), sc = Math.max(s0, Math.min(s1, sk)), g = lire(gA, sc), d = lire(dA, sc);
        if (sk < debut || sk > fin || t < g || t > d) { avant = null; continue; }
        const S = section(sk), f = (t - g) / (d - g) * nT, k = Math.min(nT - 1, Math.floor(f));
        const ici = { xy: [x, y], z: S.z[k] + (S.z[k + 1] - S.z[k]) * (f - k), b: S.plein ? S.bp : S.bo };
        if (avant) quad(bas, P(avant.xy, avant.b), P(ici.xy, ici.b), P(ici.xy, ici.z), P(avant.xy, avant.z));
        avant = ici;
      }
    }
    // piles : stations voisines où des points montent du sol vers le tablier sur au moins 40 % de la hauteur libre (et
    // pas seulement le sol sous le pont, que le relevé classe parfois « pont »), regroupées en blocs
    if (avecNuage) {
      const blocs = [];
      let cur = null;
      for (let q = 0; q < nb; q++) {
        const T = st[q], libreQ = hS[q] - T.sol;
        if (T.pile >= 4 && T.pz1 - T.pz0 > Math.max(2, 0.4 * libreQ)) {
          const x = s0 + q;
          if (cur && x - cur.s1 <= 2.5) { cur.s1 = x; cur.g = Math.min(cur.g, T.pg); cur.d = Math.max(cur.d, T.pd); cur.np += T.pile; }
          else { cur = { s0: x, s1: x, g: T.pg, d: T.pd, np: T.pile }; blocs.push(cur); }
        }
      }
      for (const B of blocs) {
        // une pile fait au plus ~8 m le long du pont : un « bloc » plus long n'est pas une pile (sol classé « pont »)
        if (B.np < 12 || B.s1 - B.s0 > 8) continue;
        const sa = B.s0 - 0.5, sb = B.s1 + 0.5, sm = (sa + sb) / 2, ga = Math.max(B.g - 0.2, lire(gA, sm)), da = Math.min(B.d + 0.2, lire(dA, sm));
        if (!(da - ga > 0.5)) continue;
        const tete = profil(sm) - lire(eA, sm) - zRef + 0.05, C4 = [enPlan(sa, ga), enPlan(sb, ga), enPlan(sb, da), enPlan(sa, da)];
        const pied = Math.min(...C4.map(([x, y]) => solEn(G, x, y))) - 1 - zRef;
        for (let k = 0; k < 4; k++) quad(bas, P(C4[k], pied), P(C4[(k + 1) % 4], pied), P(C4[(k + 1) % 4], tete), P(C4[k], tete));
      }
    }
    return true;
  };
  for (const cel of tabliers) {
    const marque = [haut.length, uv.length, nor.length, bas.length];
    let ok = false;
    try { ok = modeliser(cel); } catch (e) { console.warn("Pont reconstruit :", e.message); }
    if (ok) continue;
    // modèle écarté : ses faces sont retirées, le pont est rendu tel que relevé
    [haut, uv, nor, bas].forEach((t, k) => { t.length = marque[k]; });
    for (const p of cel) repli[p] = pont[p];
    nRepli++;
  }
  // ponts que le modèle décrit mal : rendus tels que relevés, case par case
  const brutG = nRepli ? tabliersPonts({ ...G, pont: repli }, zRef) : null;
  if (!haut.length && !brutG) return null;
  const joindre = (a, g, nom) => g ? [...a, ...g.attributes[nom].array] : a;
  const dessus = new THREE.BufferGeometry();
  dessus.setAttribute("position", new THREE.Float32BufferAttribute(joindre(haut, brutG?.dessus, "position"), 3));
  dessus.setAttribute("uv", new THREE.Float32BufferAttribute(joindre(uv, brutG?.dessus, "uv"), 2));
  dessus.setAttribute("normal", new THREE.Float32BufferAttribute(joindre(nor, brutG?.dessus, "normal"), 3));
  dessus.userData.ponts = infos; // (diagnostic : axe, emprise, écart, joints de chaque pont)
  const cotes = new THREE.BufferGeometry();
  cotes.setAttribute("position", new THREE.Float32BufferAttribute(joindre(bas, brutG?.cotes, "position"), 3));
  cotes.computeVertexNormals();
  return { dessus, cotes };
}

/**
 * Coupe une géométrie (sans index : position, normale, uv) au cercle de rayon `R` autour du centre : la chaussée des
 * ponts porte la matière du terrain, que le rendu ne découpe pas au cercle. Chaque triangle à cheval est rogné par
 * les tangentes au cercle (une par degré de l'arc qu'il couvre).
 */
export function decouperCercle(g, R) {
  const pos = g.attributes.position.array, nor = g.attributes.normal?.array, tuv = g.attributes.uv?.array, oP = [], oN = [], oU = [];
  const sommet = i => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], nor ? nor[3 * i] : 0, nor ? nor[3 * i + 1] : 1, nor ? nor[3 * i + 2] : 0, tuv ? tuv[2 * i] : 0, tuv ? tuv[2 * i + 1] : 0];
  let coupe = false;
  for (let t = 0; t < pos.length / 9; t++) {
    let poly = [sommet(3 * t), sommet(3 * t + 1), sommet(3 * t + 2)];
    const r = poly.map(v => Math.hypot(v[0], v[2]));
    if (r.some(v => v > R)) {
      coupe = true;
      if (r.every(v => v > R + 60)) continue;
      // tangentes : de l'angle du premier sommet à ceux des deux autres (écarts ramenés entre −π et π)
      const a0 = Math.atan2(poly[0][2], poly[0][0]), ec = poly.map(v => { const d = Math.atan2(v[2], v[0]) - a0; return d - 2 * Math.PI * Math.round(d / (2 * Math.PI)); });
      const e0 = Math.min(...ec), e1 = Math.max(...ec), nb = Math.max(1, Math.ceil((e1 - e0) / (Math.PI / 180)));
      for (let q = 0; q <= nb && poly.length >= 3; q++) {
        const a = a0 + e0 + (e1 - e0) * q / nb, cx = Math.cos(a), cz = Math.sin(a), dist = poly.map(v => R - (v[0] * cx + v[2] * cz));
        if (dist.every(v => v >= 0)) continue;
        const nv = [];
        for (let k = 0; k < poly.length; k++) {
          const A = poly[k], B = poly[(k + 1) % poly.length], da = dist[k], db = dist[(k + 1) % poly.length];
          if (da >= 0) nv.push(A);
          if ((da >= 0) !== (db >= 0)) nv.push(A.map((v, i) => v + (B[i] - v) * da / (da - db)));
        }
        poly = nv;
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) for (const v of [poly[0], poly[k], poly[k + 1]]) { oP.push(v[0], v[1], v[2]); oN.push(v[3], v[4], v[5]); oU.push(v[6], v[7]); }
  }
  if (!coupe) return g;
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(oP, 3));
  if (nor) out.setAttribute("normal", new THREE.Float32BufferAttribute(oN, 3)); else out.computeVertexNormals();
  if (tuv) out.setAttribute("uv", new THREE.Float32BufferAttribute(oU, 2));
  Object.assign(out.userData, g.userData);
  g.dispose();
  return out;
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
