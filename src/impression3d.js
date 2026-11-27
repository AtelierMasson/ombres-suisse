// Impression 3D (mode pro) : la maquette en un seul solide fermé (étanche, « manifold »), prêt pour le trancheur.
// Surface du dessus = carte des hauteurs (terrain, bâtiments, arbres simplifiés, eau à plat), puis paroi verticale le
// long du bord (cercle ou carré) et fond plat : chaque arête est partagée par exactement deux triangles.
// Unités du fichier : millimètres, à l'échelle choisie (diamètre ou côté imprimé).
import * as THREE from "three";
import { solEn } from "./grille.js";

/** Valeur d'une grille de G (cellule la plus proche), NaN hors de la grille. */
function cellule(G, a, x, y) {
  const i = Math.floor((x - G.x0) / G.c), j = Math.floor((y - G.x0) / G.c);
  return !a || i < 0 || j < 0 || i >= G.n || j >= G.n ? NaN : a[j * G.n + i];
}

/**
 * Grille de végétation lissée (moyenne sur une fenêtre de 2r+1 cellules, en deux passes séparées), pour des masses
 * d'arbres sans aiguilles ; une case garde une masse si au moins 35 % de sa fenêtre est boisée (> 2 m au-dessus du sol).
 */
function lisser(G, a, r) {
  const n = G.n, sol = G.sol, somme = new Float32Array(n * n), nb = new Float32Array(n * n);
  for (let p = 0; p < n * n; p++) if (!isNaN(a[p]) && a[p] > sol[p] + 2) { somme[p] = a[p]; nb[p] = 1; }
  const passe = (src, horiz) => {
    const out = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      let acc = 0;
      const at = k => horiz ? src[j * n + k] : src[k * n + j], put = (k, v) => { if (horiz) out[j * n + k] = v; else out[k * n + j] = v; };
      for (let k = -r; k <= r; k++) if (k >= 0 && k < n) acc += at(k);
      for (let k = 0; k < n; k++) {
        put(k, acc);
        if (k - r >= 0) acc -= at(k - r);
        if (k + r + 1 < n) acc += at(k + r + 1);
      }
    }
    return out;
  };
  const S = passe(passe(somme, true), false), K = passe(passe(nb, true), false), seuil = (2 * r + 1) ** 2 * 0.35;
  const out = new Float32Array(n * n).fill(NaN);
  for (let p = 0; p < n * n; p++) if (K[p] > seuil) out[p] = S[p] / K[p];
  return out;
}

/** Arbres isolés : sommets locaux de la végétation (fenêtre de 4 m), hauteur au-dessus du sol > 3 m. */
function sommetsArbres(G, ecart = 2, rayonMin = 1.5) {
  // `ecart` (m) : distance minimale entre deux sommets ; `rayonMin` : rayon minimal d'un dôme (lisible à l'échelle)
  const n = G.n, c = G.c, w = Math.max(2, Math.round(ecart / c)), veg = G.veg, sol = G.sol, arbres = [];
  for (let j = w; j < n - w; j++) for (let i = w; i < n - w; i++) {
    const p = j * n + i, v = veg[p];
    if (isNaN(v) || v - sol[p] < 3) continue;
    let max = true;
    for (let dj = -w; dj <= w && max; dj++) for (let di = -w; di <= w; di++) {
      const q = veg[(j + dj) * n + i + di];
      if (q > v || (q === v && (dj < 0 || (dj === 0 && di < 0)))) { max = false; break; }
    }
    if (!max) continue;
    const h = v - sol[p];
    arbres.push({ x: G.x0 + (i + 0.5) * c, y: G.x0 + (j + 0.5) * c, haut: v, rayon: Math.max(rayonMin, Math.min(6, 0.33 * h)), pied: sol[p] });
  }
  return arbres;
}

/**
 * Solide imprimable. `o` : { taille (mm, diamètre ou côté), exag (exagération verticale), socle (mm sous le point le
 * plus bas), arbres ("aucun" | "masses" | "isoles"), eau (true : surface des lacs à plat), resolution (mm, pas de la
 * grille imprimée), bat (grille des bâtiments alignée sur G, NaN hors bâtiment ; G.bat par défaut) }.
 * Renvoie { geometrie (indexée, en mm, z vers le haut), infos : { echelle, cellule (m), triangles, dims mm } }.
 */
export function solideImpression(G, o = {}) {
  const taille = o.taille || 150, exag = o.exag || 1, socle = o.socle ?? 3, rond = !!G.rayonZone;
  const R = (rond ? G.rayonZone : G.R) - 0.5, mm = taille / (2 * R); // millimètres par mètre
  const cel = Math.max(G.c, (o.resolution || 0.5) / mm), N = Math.max(8, Math.ceil(2 * R / cel)), pas = 2 * R / N;
  const bat = o.bat || G.bat, masses = o.arbres === "masses" ? lisser(G, G.veg, Math.max(1, Math.round(Math.max(2, 1.5 * cel) / G.c))) : null;
  // à l'échelle imprimée, un arbre doit couvrir au moins ~3 pas de la grille, sinon il devient une aiguille
  const arbres = o.arbres === "isoles" ? sommetsArbres(G, Math.max(2, 1.6 * cel), Math.max(1.5, 1.6 * cel)) : [];
  // index spatial des arbres isolés (cases de 8 m)
  const casesArbres = new Map(), cle = (a, b) => a * 100003 + b;
  for (const a of arbres) {
    for (let bx = Math.floor((a.x - a.rayon) / 8); bx <= Math.floor((a.x + a.rayon) / 8); bx++)
      for (let by = Math.floor((a.y - a.rayon) / 8); by <= Math.floor((a.y + a.rayon) / 8); by++) {
        const k = cle(bx, by); if (!casesArbres.has(k)) casesArbres.set(k, []); casesArbres.get(k).push(a);
      }
  }
  const hauteur = (x, y) => {
    let h = solEn(G, x, y);
    if (o.eau !== false) { const e = cellule(G, G.eau, x, y); if (e > h) h = e; }
    const b = cellule(G, bat, x, y); if (b > h) h = b;
    if (masses) { const v = cellule(G, masses, x, y); if (v > h) h = v * 0.97 + h * 0.03; }
    for (const a of casesArbres.get(cle(Math.floor(x / 8), Math.floor(y / 8))) || []) {
      const d = Math.hypot(x - a.x, y - a.y);
      if (d >= a.rayon) continue;
      // arbre « en boule posée » : dôme du sol au sommet, sans tronc (un tronc fin ne s'imprime pas)
      const z = a.pied + (a.haut - a.pied) * Math.sqrt(1 - (d / a.rayon) ** 2);
      if (z > h) h = z;
    }
    return h;
  };
  // sommets du dessus : grille (N+1)², gardés dans la zone (cercle ou carré)
  const M = N + 1, idx = new Int32Array(M * M).fill(-1), pos = [];
  let zmin = Infinity;
  const H = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = -R + i * pas, y = -R + j * pas;
    if (rond && Math.hypot(x, y) > R + pas * 0.75) continue;
    const h = hauteur(Math.max(-R, Math.min(R, x)), Math.max(-R, Math.min(R, y)));
    if (isNaN(h)) continue;
    H[j * M + i] = h; if (h < zmin) zmin = h;
    idx[j * M + i] = 1;
  }
  // cellules gardées : les quatre coins présents et le centre dans la zone
  const garde = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * M + i;
    if (idx[a] < 0 || idx[a + 1] < 0 || idx[a + M] < 0 || idx[a + M + 1] < 0) continue;
    if (rond && Math.hypot(-R + (i + 0.5) * pas, -R + (j + 0.5) * pas) > R) continue;
    garde[j * N + i] = 1;
  }
  // une seule région (la plus grande) : un solide d'un seul tenant, sans îlots ni cellules accrochées par un coin
  {
    const vu = new Int32Array(N * N).fill(-1); let meilleure = -1, tailleMax = 0;
    for (let s = 0, r = 0; s < N * N; s++) {
      if (!garde[s] || vu[s] >= 0) continue;
      const pile = [s]; vu[s] = r; let t = 0;
      while (pile.length) {
        const p = pile.pop(); t++;
        const i = p % N, j = (p / N) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = i + di, y = j + dj, q = y * N + x;
          if (x >= 0 && y >= 0 && x < N && y < N && garde[q] && vu[q] < 0) { vu[q] = r; pile.push(q); }
        }
      }
      if (t > tailleMax) { tailleMax = t; meilleure = r; }
      r++;
    }
    for (let s = 0; s < N * N; s++) if (garde[s] && vu[s] !== meilleure) garde[s] = 0;
    // coins pincés (deux cellules qui ne se touchent que par un sommet) : on comble la diagonale
    for (let passe = 0; passe < 3; passe++) for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = garde[j * N + i], b = garde[j * N + i + 1], c = garde[(j + 1) * N + i], d = garde[(j + 1) * N + i + 1];
      const coins = (x, y) => idx[y * M + x] >= 0 && idx[y * M + x + 1] >= 0 && idx[(y + 1) * M + x] >= 0 && idx[(y + 1) * M + x + 1] >= 0;
      if (a && d && !b && !c) { if (coins(i + 1, j)) garde[j * N + i + 1] = 1; else if (coins(i, j + 1)) garde[(j + 1) * N + i] = 1; else garde[(j + 1) * N + i + 1] = 0; }
      if (b && c && !a && !d) { if (coins(i, j)) garde[j * N + i] = 1; else if (coins(i + 1, j + 1)) garde[(j + 1) * N + i + 1] = 1; else garde[(j + 1) * N + i] = 0; }
    }
  }
  // sommets utilisés, numérotés
  const zBas = zmin - socle / (mm * exag);
  const vers = (x, y, h) => [x * mm, y * mm, (h - zmin) * mm * exag + socle];
  idx.fill(-1);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (garde[j * N + i])
    for (const p of [j * M + i, j * M + i + 1, (j + 1) * M + i, (j + 1) * M + i + 1]) if (idx[p] < 0) {
      idx[p] = pos.length / 3; pos.push(...vers(-R + (p % M) * pas, -R + ((p / M) | 0) * pas, H[p]));
    }
  const tri = [];
  // dessus (normales vers le haut : sens trigonométrique vu de dessus, x est, y nord)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (garde[j * N + i]) {
    const a = idx[j * M + i], b = idx[j * M + i + 1], c = idx[(j + 1) * M + i], d = idx[(j + 1) * M + i + 1];
    tri.push(a, b, d, a, d, c);
  }
  // bord : arêtes du dessus portées par une seule cellule, orientées comme le dessus (la région est à gauche)
  const aretes = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (garde[j * N + i]) {
    const s = (x, y) => x >= 0 && y >= 0 && x < N && y < N && garde[y * N + x];
    const A = idx[j * M + i], B = idx[j * M + i + 1], C = idx[(j + 1) * M + i], D = idx[(j + 1) * M + i + 1];
    if (!s(i, j - 1)) aretes.push([A, B]);
    if (!s(i + 1, j)) aretes.push([B, D]);
    if (!s(i, j + 1)) aretes.push([D, C]);
    if (!s(i - 1, j)) aretes.push([C, A]);
  }
  // bord arrondi : en maquette ronde, les sommets du bord sont ramenés sur le cercle (la paroi devient lisse)
  if (rond) {
    const surBord = new Set(aretes.flat());
    for (const v of surBord) {
      const x = pos[3 * v], y = pos[3 * v + 1], r = Math.hypot(x, y) || 1, k = R * mm / r;
      pos[3 * v] = x * k; pos[3 * v + 1] = y * k;
    }
  }
  // paroi : chaque sommet du bord a son double au fond
  const fond = new Map();
  const bas = v => { if (!fond.has(v)) { fond.set(v, pos.length / 3); pos.push(pos[3 * v], pos[3 * v + 1], 0); } return fond.get(v); };
  for (const [a, b] of aretes) { const a2 = bas(a), b2 = bas(b); tri.push(b, a, a2, b, a2, b2); }
  // fond : la boucle du bord (une seule, la région est d'un seul tenant et sans trou), triangulée, normale vers le bas
  const suivant = new Map(aretes.map(([a, b]) => [a, b]));
  const boucle = [];
  let v0 = aretes[0][0], v = v0;
  do { boucle.push(v); v = suivant.get(v); } while (v !== undefined && v !== v0 && boucle.length <= aretes.length);
  if (boucle.length === aretes.length) {
    const forme = boucle.map(w => new THREE.Vector2(pos[3 * w], pos[3 * w + 1]));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(forme, [])) {
      // triangulateShape rend le sens de la forme (trigonométrique) : on l'inverse pour une normale vers le bas
      const p = fond.get(boucle[a]), q = fond.get(boucle[b]), r = fond.get(boucle[c]);
      const ccw = THREE.ShapeUtils.isClockWise([forme[a], forme[b], forme[c]]) === false;
      if (ccw) tri.push(p, r, q); else tri.push(p, q, r);
    }
  } else {
    // repli (ne devrait pas arriver) : éventail depuis le centre du fond
    const centre = pos.length / 3; pos.push(0, 0, 0);
    for (const [a, b] of aretes) tri.push(centre, bas(b), bas(a));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(tri);
  g.computeVertexNormals();
  g.computeBoundingBox();
  const bb = g.boundingBox;
  return {
    geometrie: g,
    infos: { echelle: Math.round(1000 / mm), cellule: cel, triangles: tri.length / 3, arbres: arbres.length, zBas,
      dims: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z] },
  };
}

/** Contrôle d'étanchéité : chaque arête partagée par exactement deux triangles, de sens opposés. */
export function verifierEtanche(g) {
  const I = g.index.array, aretes = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = I[t + k], b = I[t + (k + 1) % 3], cle = a < b ? `${a},${b}` : `${b},${a}`, s = a < b ? 1 : -1;
    const e = aretes.get(cle) || [0, 0]; e[0]++; e[1] += s; aretes.set(cle, e);
  }
  let ouvertes = 0, mal = 0;
  for (const [n, s] of aretes.values()) { if (n !== 2) ouvertes++; else if (s !== 0) mal++; }
  return { etanche: ouvertes === 0 && mal === 0, ouvertes, malOrientees: mal };
}

/** STL binaire (mm) d'une géométrie indexée. */
export function stlBinaire(g, entete = "Topograph") {
  const P = g.attributes.position.array, I = g.index.array, n = I.length / 3;
  const buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf), te = new TextEncoder().encode(entete.slice(0, 79));
  new Uint8Array(buf, 0, te.length).set(te);
  dv.setUint32(80, n, true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nr = new THREE.Vector3();
  for (let t = 0, o = 84; t < n; t++, o += 50) {
    a.fromArray(P, 3 * I[3 * t]); b.fromArray(P, 3 * I[3 * t + 1]); c.fromArray(P, 3 * I[3 * t + 2]);
    nr.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const v = [nr, a, b, c];
    for (let k = 0; k < 4; k++) { dv.setFloat32(o + 12 * k, v[k].x, true); dv.setFloat32(o + 12 * k + 4, v[k].y, true); dv.setFloat32(o + 12 * k + 8, v[k].z, true); }
    dv.setUint16(o + 48, 0, true);
  }
  return new Blob([buf], { type: "model/stl" });
}
