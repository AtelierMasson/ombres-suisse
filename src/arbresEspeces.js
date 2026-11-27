// Arbres du relevé : essence probable (conifère, feuillu, mélèze) et points cachés au cœur des forêts.
// Voir docs/arbres-classification.md.
//
// 1. Arbres un par un : modèle de canopée à 1 m (hauteur de la végétation au-dessus du sol), sommets locaux à fenêtre
//    variable, puis croissance de région depuis les sommets (du plus haut au plus bas), bornée par un rayon de
//    couronne qui dépend de la hauteur.
// 2. Indices de forme, par arbre : pente autour du sommet (cône pointu des conifères, dôme des feuillus) et part de
//    points loin sous la surface de la couronne (le relevé est fait sans feuilles : un feuillu est « transparent »,
//    ses retours sont répartis dans tout le volume ; un conifère arrête le laser près de sa surface).
// 3. A priori : l'altitude (feuillus en plaine, conifères au-dessus de ~1200–1400 m), puis, dès qu'il est lu, le degré
//    de mélange de l'Inventaire forestier national (LFI, raster 10 m, part de feuillus en %, forêt seulement).
// 4. Points cachés (« enfouis ») : couverts au-dessus, en dessous et dans les huit directions par une couronne dense.
//    Ils ne sont pas dessinés quand la caméra est à plus de MARGE_ENFOUIS mètres (jamais en coupe). Les ombres et
//    l'ensoleillement n'utilisent pas ces points (canopée en grille) : ils ne changent pas.
// 5. Points rangés par tuiles carrées (puis visibles avant enfouis dans chaque tuile) : chaque tuile est un objet
//    three.js avec sa propre sphère englobante, que three.js écarte quand elle sort du champ de la caméra. Au loin,
//    une tuile n'envoie que le début de sa liste (points mélangés, rang aRang) : c'est l'allègement du shader, sans
//    faire passer dans le shader les points qu'il écarterait.
import * as THREE from "three";
import { fromUrl } from "geotiff";

export const MARGE_ENFOUIS = 40; // m : en deçà, même les points enfouis sont dessinés (caméra dans la forêt)
const FEUILLU = 0, CONIFERE = 1, MELEZE = 2;

// a priori par l'altitude (probabilité d'un conifère) : ~0,26 en plaine, 0,58 à 1100 m, 0,84 à 1400 m, 0,91 au-delà
export const prioriAltitude = a => 0.25 + 0.67 / (1 + Math.exp(-(a - 1100) / 150));
const logit = p => Math.log(p / (1 - p));
const sigmo = x => 1 / (1 + Math.exp(-x));
const hache = t => { let h = Math.imul(t + 0x9e3779b9, 2654435761); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return (h >>> 0) / 4294967296; };

/**
 * Indice de forme (logit, > 0 : conifère), sans a priori. Indices : `pente` = descente moyenne (m par m) entre 1,5 et
 * 2,5 m du sommet (cône pointu ou dôme), `prof` = part des points à plus de 2,5 m sous la surface de leur case de
 * 0,5 m (pénétration du laser), `H` = hauteur de l'arbre (les deux indices en dépendent). Régression logistique
 * calée sur ~4 800 arbres de forêts pures (degré de mélange LFI ≤ 15 % ou ≥ 85 % de feuillus) à Lutry, au Jorat et au
 * Sihlwald : 75 à 90 % de bien classés selon le lieu (voir docs/arbres-classification.md).
 */
export function indiceForme(pente, prof, nbPts, H) {
  if (nbPts < 12) return 0;
  const p = pente < 0 ? 1 : Math.min(3, pente), lh = Math.log(Math.min(45, Math.max(3, H)));
  const L = 6.29 - 4.31 * p - 25.1 * prof - 0.786 * lh + 1.72 * p * lh + 4.57 * prof * lh;
  return Math.max(-4, Math.min(4, L));
}

/** Essence d'un arbre depuis la probabilité a priori (conifère) et l'indice de forme. */
function essence(prior, forme, alt, mixte) {
  const p = sigmo(logit(Math.min(0.97, Math.max(0.03, prior))) + forme);
  // mélèze : couronne claire et peu dense (et sans aiguilles si le vol est d'hiver : texture de feuillu). En montagne
  // (au-dessus de 1 400 m, ou de 1 250 m en forêt résineuse selon le LFI), les feuillus sont rares : un arbre à la
  // forme de feuillu, ou un conifère à couronne peu dense (indice < 1), est classé mélèze. Heuristique non vérifiée.
  if (forme < 1 && (alt > 1400 || (alt > 1250 && mixte < 30))) return [MELEZE, p];
  return [p >= 0.5 ? CONIFERE : FEUILLU, p];
}

/**
 * Classe les arbres, marque les points enfouis et range les points par tuiles. `g` : géométrie des points d'arbres
 * (position, aRel, aVar, aCache, tableaux encore présents) ; `cellule` : case 0,5 m de chaque point.
 * Ajoute l'attribut aEsp (octet signé : ±(1 + 40 · essence + teinte de l'arbre 0..39), négatif = enfoui) et renvoie
 * les tuiles.
 */
export function preparerArbres(g, G, cellule, zRef) {
  const t0 = performance.now(), etapes = {};
  let tE = t0; const etape = nom => { const t = performance.now(); etapes[nom] = Math.round(t - tE); tE = t; };
  // tableaux de la grille tirés une fois (G a beaucoup de propriétés : l'accès dans les boucles coûtait cher)
  const { n, R } = G, VEG = G.veg, SOL = G.sol, pos = g.attributes.position.array, nb = pos.length / 3;
  const m = Math.ceil(n / 2), mm = m * m, k1 = 2 * G.c; // grille de 2 × 2 cases (1 m), côté k1
  // ------------------------------------------------------------------ modèle de canopée (1 m)
  const chm = new Float32Array(mm), sol = new Float32Array(mm).fill(NaN);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const p = j * n + i, q = (j >> 1) * m + (i >> 1), z0 = SOL[p], h = VEG[p] - z0;
    if (h > chm[q]) chm[q] = h;
    if (!(sol[q] <= z0)) sol[q] = z0;
  }
  // lissage léger (le sommet garde la moitié de sa hauteur propre)
  const lis = new Float32Array(mm);
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
    const q = b * m + a;
    if (chm[q] <= 0) continue;
    let s = 0, k = 0;
    for (let y = Math.max(0, b - 1); y <= Math.min(m - 1, b + 1); y++) for (let x = Math.max(0, a - 1); x <= Math.min(m - 1, a + 1); x++) { s += chm[y * m + x]; k++; }
    lis[q] = 0.5 * chm[q] + 0.5 * s / k;
  }
  etape("canopee");
  // ------------------------------------------------------------------ sommets (maxima locaux à fenêtre variable)
  const sommets = [];
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
    const q = b * m + a, h = lis[q];
    if (h < 3) continue;
    const w = h < 8 ? 1 : h < 18 ? 2 : 3;
    let ok = true;
    for (let y = Math.max(0, b - w); ok && y <= Math.min(m - 1, b + w); y++) for (let x = Math.max(0, a - w); x <= Math.min(m - 1, a + w); x++) {
      const r = y * m + x;
      if (r !== q && (lis[r] > h || (lis[r] === h && r < q))) { ok = false; break; }
    }
    if (ok) sommets.push(q);
  }
  const nt = sommets.length;
  etape("sommets");
  // ------------------------------------------------------------------ couronnes (croissance de région, file par hauteur)
  const lab = new Int32Array(mm).fill(-1), sx = new Int32Array(nt), sy = new Int32Array(nt), H = new Float32Array(nt), r2max = new Float32Array(nt);
  const NB = 400, seaux = Array.from({ length: NB }, () => []), seau = h => Math.min(NB - 1, Math.max(0, Math.floor(h * 4)));
  sommets.forEach((q, t) => {
    lab[q] = t; sx[t] = q % m; sy[t] = (q / m) | 0; H[t] = chm[q];
    const rm = Math.min(9, Math.max(2.5, 0.25 * chm[q] + 1.5)) / k1; r2max[t] = rm * rm;
    seaux[seau(lis[q])].push(q);
  });
  for (let s = NB - 1; s >= 0; s--) {
    const L = seaux[s];
    while (L.length) {
      const q = L.pop(), t = lab[q], a = q % m, b = (q / m) | 0;
      for (let d = 0; d < 4; d++) {
        const x = a + (d === 0) - (d === 1), y = b + (d === 2) - (d === 3);
        if (x < 0 || y < 0 || x >= m || y >= m) continue;
        const r = y * m + x;
        if (lab[r] >= 0 || chm[r] < 1.5 || chm[r] < 0.3 * H[t] || lis[r] > lis[q] + 0.5) continue;
        if ((x - sx[t]) ** 2 + (y - sy[t]) ** 2 > r2max[t]) continue;
        lab[r] = t;
        seaux[Math.min(s, seau(lis[r]))].push(r);
      }
    }
  }
  // bords de couronnes encore libres (branches basses, débords) : rattachés à la couronne voisine, 2 m au plus
  for (let tour = 0; tour < 2; tour++) {
    const ajouts = [];
    for (let q = 0; q < mm; q++) {
      if (lab[q] >= 0 || chm[q] < 1) continue;
      const a = q % m, b = (q / m) | 0;
      for (const r of [a > 0 ? q - 1 : -1, a < m - 1 ? q + 1 : -1, b > 0 ? q - m : -1, b < m - 1 ? q + m : -1]) if (r >= 0 && lab[r] >= 0) { ajouts.push(q, lab[r]); break; }
    }
    for (let k = 0; k < ajouts.length; k += 2) lab[ajouts[k]] = ajouts[k + 1];
  }
  etape("couronnes");
  // surface de chaque couronne (cases de k1 × k1 m) : rayon des symboles de la vue plan (vuePlan.js)
  const surf = new Uint32Array(nt);
  for (let q = 0; q < mm; q++) if (lab[q] >= 0) surf[lab[q]]++;
  // ------------------------------------------------------------------ indices par arbre
  const anneauS = new Float32Array(nt), anneauN = new Uint16Array(nt);
  for (let q = 0; q < mm; q++) {
    const t = lab[q];
    if (t < 0) continue;
    const d2 = ((q % m - sx[t]) ** 2 + (((q / m) | 0) - sy[t]) ** 2) * k1 * k1;
    if (d2 >= 2.25 && d2 <= 6.25) { anneauS[t] += chm[q]; anneauN[t]++; }
  }
  // par point : arbre, profondeur sous la surface de sa case
  const arbre = new Int32Array(nb), nbPts = new Uint32Array(nt), profonds = new Uint32Array(nt);
  for (let k = 0; k < nb; k++) {
    const p = cellule[k], i = p % n, j = (p / n) | 0, t = lab[(j >> 1) * m + (i >> 1)];
    arbre[k] = t;
    if (t >= 0) { nbPts[t]++; if (VEG[p] - (pos[3 * k + 1] + zRef) > 2.5) profonds[t]++; }
  }
  etape("points");
  const essences = new Uint8Array(nt), teinte = new Float32Array(nt), pente = new Float32Array(nt), alt = new Float32Array(nt), forme = new Float32Array(nt), pConif = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    pente[t] = anneauN[t] ? (H[t] - anneauS[t] / anneauN[t]) / 2 : -1;
    alt[t] = sol[sommets[t]]; // altitude du pied
    forme[t] = indiceForme(pente[t], nbPts[t] ? profonds[t] / nbPts[t] : 0, nbPts[t], H[t]);
    const [e, p] = essence(prioriAltitude(alt[t]), forme[t], alt[t], 100);
    essences[t] = e; pConif[t] = p; teinte[t] = hache(t * 7919 + sommets[t]);
  }
  // hors couronne (buissons, haies basses) : essence la plus probable à cette altitude
  const altLieu = zRef, essLibre = prioriAltitude(altLieu) >= 0.5 ? CONIFERE : FEUILLU;
  // conifère : les points se resserrent un peu vers l'axe en montant (silhouette plus effilée) ; fait avant le calcul
  // des points enfouis, qui voit ainsi les couronnes telles qu'elles sont dessinées
  const rel = g.attributes.aRel.array;
  for (let k = 0; k < nb; k++) {
    const t = arbre[k];
    if (t < 0 || essences[t] !== CONIFERE) continue;
    const f = 1 - 0.12 * Math.min(1, Math.max(0, rel[k])), cx = -R + (sx[t] + 0.5) * k1, cy = -R + (sy[t] + 0.5) * k1;
    pos[3 * k] = cx + (pos[3 * k] - cx) * f;
    pos[3 * k + 2] = -(cy + (-pos[3 * k + 2] - cy) * f);
  }
  // colonnes de 1 m : dessus, dessous et nombre de points
  const haut = new Float32Array(mm).fill(-Infinity), bas = new Float32Array(mm).fill(Infinity), cnt = new Uint16Array(mm), col = new Int32Array(nb);
  for (let k = 0; k < nb; k++) {
    const a = Math.min(m - 1, Math.max(0, Math.floor((pos[3 * k] + R) / k1))), b = Math.min(m - 1, Math.max(0, Math.floor((R - pos[3 * k + 2]) / k1)));
    const q = b * m + a, z = pos[3 * k + 1];
    col[k] = q;
    if (z > haut[q]) haut[q] = z;
    if (z < bas[q]) bas[q] = z;
    if (cnt[q] < 65535) cnt[q]++;
  }
  etape("indices");
  // ------------------------------------------------------------------ points enfouis
  // couverts au-dessus (≥ 2 m sous le plus bas des dessus voisins), en dessous (≥ 1 m de couronne sous eux) et, dans
  // chacune des 8 directions, au moins 2 colonnes denses sur 4 m qui les enjambent. Grosse marge : en cas de doute,
  // le point reste.
  // Par colonne de 1 m, intervalle d'altitude [lo, hi] où un point est enfoui ; pour chaque direction, on retient la
  // meilleure paire de colonnes (sur 4) qui l'enjambent : sous-ensemble de la règle « 2 sur 4 », donc plus prudent.
  const DIRS = Int32Array.from([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]], ([x, y]) => y * m + x), DENSE = 5;
  const enfoui = new Uint8Array(nb), lo = new Float32Array(mm).fill(Infinity), hi = new Float32Array(mm).fill(-Infinity);
  const dlo = new Float32Array(4), dhi = new Float32Array(4);
  for (let b = 5; b < m - 5; b++) for (let a = 5; a < m - 5; a++) {
    const q = b * m + a;
    if (cnt[q] < DENSE) continue;
    let L = bas[q] + 1, U = haut[q] - 2;
    for (let y = -1; y <= 1 && L <= U; y++) for (let x = -1; x <= 1; x++) { const r = q + y * m + x; if (cnt[r] < DENSE) { U = -Infinity; break; } if (haut[r] - 2 < U) U = haut[r] - 2; }
    for (let d = 0; d < 8 && L <= U; d++) {
      for (let s = 1; s <= 4; s++) {
        const r = q + DIRS[d] * s;
        if (cnt[r] >= DENSE) { dlo[s - 1] = bas[r] + 0.5; dhi[s - 1] = haut[r] - 1 - 0.3 * s; } else { dlo[s - 1] = Infinity; dhi[s - 1] = -Infinity; }
      }
      let bl = Infinity, bh = -Infinity;
      for (let s1 = 0; s1 < 3; s1++) for (let s2 = s1 + 1; s2 < 4; s2++) {
        const l = Math.max(dlo[s1], dlo[s2]), h = Math.min(dhi[s1], dhi[s2]);
        if (h - l > bh - bl) { bl = l; bh = h; }
      }
      if (bl > L) L = bl;
      if (bh < U) U = bh;
    }
    if (L <= U) { lo[q] = L; hi[q] = U; }
  }
  // Puis vérification fine, par voxel de 1 m (colonne × niveau, occupation tirée des points) : le long de rayons
  // partant du voxel (8 azimuts, horizontaux, montant à ~30° et à ~55°), au moins un voxel occupé sur 5 m, des voxels
  // occupés au-dessus (2) et au-dessous (1) dans sa colonne. Les couronnes sans feuilles (relevé d'hiver) sont creuses : une
  // colonne qui enjambe le point ne suffit pas, il faut de la matière sur le trajet du regard.
  const base = new Int32Array(mm), bA = new Uint32Array(mm), bB = new Uint32Array(mm);
  for (let q = 0; q < mm; q++) if (cnt[q]) base[q] = Math.floor(bas[q]);
  for (let k = 0; k < nb; k++) {
    const q = col[k], l = Math.floor(pos[3 * k + 1]) - base[q];
    if (l < 32) bA[q] |= 1 << l; else if (l < 64) bB[q] |= 1 << (l - 32);
  }
  const occ = (r, L) => { const l = L - base[r]; return cnt[r] > 0 && l >= 0 && l < 64 && ((l < 32 ? bA[r] >>> l : bB[r] >>> (l - 32)) & 1) === 1; };
  const AZ = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]], PENTES = [0, 0.58, 1.43];
  const vu = new Uint32Array(2 * mm), cache = new Uint32Array(2 * mm); // voxels déjà évalués, et leur résultat
  // réglages retenus après comparaison d'images avec et sans (Sihlwald, hêtraie sans feuilles : 0,05 à 0,08 % des
  // pixels changent, par points isolés ; avec 2 voxels par rayon, aucun pixel mais 10 fois moins de points enfouis)
  const RG = { touches: 1, haut: 2, bas: 1, pas: 5 };
  const voxelEnfoui = (q, L) => {
    let n1 = 0, n2 = 0;
    for (let d = 1; d <= 6; d++) { if (occ(q, L + d)) n1++; if (occ(q, L - d)) n2++; }
    if (n1 < RG.haut || n2 < RG.bas) return false;
    for (const [dx, dy] of AZ) {
      const pas = dx && dy ? Math.SQRT2 : 1, o = dy * m + dx;
      for (const t of PENTES) {
        let touche = 0;
        for (let s = 1; s <= RG.pas && touche < RG.touches; s++) {
          const dz = t * s * pas;
          if (dz > 7) break;
          if (occ(q + o * s, L + Math.round(dz))) touche++;
        }
        if (touche < RG.touches) return false;
      }
    }
    return true;
  };
  for (let k = 0; k < nb; k++) {
    const q = col[k], z = pos[3 * k + 1];
    if (!(z >= lo[q] && z <= hi[q])) continue;
    const L = Math.floor(z), l = L - base[q], w = 2 * q + (l >> 5), bit = 1 << (l & 31);
    if (l < 0 || l >= 64) continue;
    if (!(vu[w] & bit)) { vu[w] |= bit; if (voxelEnfoui(q, L)) cache[w] |= bit; }
    if (cache[w] & bit) enfoui[k] = 1;
  }
  etape("enfouis");
  // ------------------------------------------------------------------ essence par point, tuiles
  // aEsp sur un octet signé : ±(1 + 40 · essence + teinte 0..39), négatif = enfoui
  const esp = new Int8Array(nb);
  // tuiles : au plus 8 × 8, au moins 40 m de côté, ~80 000 points chacune au moins (chaque tuile coûte un appel de
  // dessin : sur un petit nuage, trop de tuiles coûtaient plus au processeur que ce qu'elles épargnaient)
  const nTu = Math.max(1, Math.min(8, Math.ceil(2 * R / 40), Math.round(Math.sqrt(nb / 80000)))), cote = 2 * R / nTu, nCles = nTu * nTu * 2;
  const cle = new Uint16Array(nb), compte = new Uint32Array(nCles + 1), boites = new Float32Array(nTu * nTu * 6);
  for (let u = 0; u < nTu * nTu; u++) boites.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], 6 * u);
  for (let k = 0; k < nb; k++) {
    const t = arbre[k];
    const e = t >= 0 ? essences[t] : essLibre, r = t >= 0 ? teinte[t] : hache(col[k]);
    esp[k] = (enfoui[k] ? -1 : 1) * (1 + 40 * e + Math.floor(39.99 * r));
    // tuile (boîte englobante au passage)
    const x = pos[3 * k], y = pos[3 * k + 1], z = pos[3 * k + 2];
    const tx = Math.min(nTu - 1, Math.max(0, Math.floor((x + R) / cote))), ty = Math.min(nTu - 1, Math.max(0, Math.floor((-z + R) / cote))), u = ty * nTu + tx, o = 6 * u;
    cle[k] = 2 * u + enfoui[k];
    compte[cle[k] + 1]++;
    if (x < boites[o]) boites[o] = x; if (y < boites[o + 1]) boites[o + 1] = y; if (z < boites[o + 2]) boites[o + 2] = z;
    if (x > boites[o + 3]) boites[o + 3] = x; if (y > boites[o + 4]) boites[o + 4] = y; if (z > boites[o + 5]) boites[o + 5] = z;
  }
  etape("essences");
  // ------------------------------------------------------------------ rangement par tuiles (visibles puis enfouis)
  for (let c = 0; c < nCles; c++) compte[c + 1] += compte[c];
  const debut = compte.slice(0, nCles), ordre = new Uint32Array(nb);
  for (let k = 0; k < nb; k++) ordre[debut[cle[k]]++] = k;
  // dans chaque tuile, les points visibles sont mélangés (ordre fixe, tiré au hasard) et numérotés : aRang. Le shader
  // allège au loin en gardant les points de rang < part gardée ; vu de loin, on n'envoie donc que le début de la
  // tuile (le reste aurait été écarté point par point dans le shader). 0 = pas de rang (enfouis : ancien tirage).
  const rang = new Uint8Array(nb);
  for (let u = 0; u < nTu * nTu; u++) {
    const s0 = compte[2 * u], nv = compte[2 * u + 1] - s0;
    for (let i = nv - 1; i > 0; i--) { const j = Math.floor(hache(s0 + i) * (i + 1)), x = ordre[s0 + i]; ordre[s0 + i] = ordre[s0 + j]; ordre[s0 + j] = x; }
    for (let i = 0; i < nv; i++) rang[s0 + i] = 1 + Math.floor(254 * i / nv);
  }
  // (une boucle par type de tableau : rester monomorphe, c'est 3 à 4 fois plus rapide sur 4 millions de points)
  const P0 = pos.slice();
  for (let k = 0; k < nb; k++) { const o = 3 * ordre[k]; pos[3 * k] = P0[o]; pos[3 * k + 1] = P0[o + 1]; pos[3 * k + 2] = P0[o + 2]; }
  const f32 = nom => { const A = g.attributes[nom].array, B = A.slice(); for (let k = 0; k < nb; k++) A[k] = B[ordre[k]]; };
  f32("aRel"); f32("aVar");
  const C0 = g.attributes.aCache.array, C1 = C0.slice(); for (let k = 0; k < nb; k++) C0[k] = C1[ordre[k]];
  const espTrie = new Int8Array(nb), arbreTrie = new Int32Array(nb);
  for (let k = 0; k < nb; k++) { const o = ordre[k]; espTrie[k] = esp[o]; arbreTrie[k] = arbre[o]; }
  g.setAttribute("aEsp", new THREE.BufferAttribute(espTrie, 1));
  g.setAttribute("aRang", new THREE.BufferAttribute(rang, 1, true));
  etape("tri");
  const tuiles = [];
  for (let u = 0; u < nTu * nTu; u++) {
    const s = compte[2 * u], nVis = compte[2 * u + 1] - s, nBur = compte[2 * u + 2] - compte[2 * u + 1];
    if (!nVis && !nBur) continue;
    const o = 6 * u, box = new THREE.Box3(new THREE.Vector3(boites[o], boites[o + 1], boites[o + 2]), new THREE.Vector3(boites[o + 3], boites[o + 4], boites[o + 5]));
    tuiles.push({ debut: s, nVis, nBur, sphere: box.getBoundingSphere(new THREE.Sphere()) });
  }
  // bilan (proportions par essence, en arbres et en points)
  const bilan = { arbres: nt, conifere: 0, feuillu: 0, meleze: 0, points: nb, enfouis: 0, ms: 0 };
  for (let t = 0; t < nt; t++) bilan[["feuillu", "conifere", "meleze"][essences[t]]]++;
  for (let k = 0; k < nb; k++) bilan.enfouis += enfoui[k];
  bilan.ms = Math.round(performance.now() - t0); bilan.etapes = etapes;
  return {
    tuiles, bilan,
    // pour l'affinage par le degré de mélange LFI (et le débogage)
    arbres: { n: nt, sx, sy, H, alt, surf, pente, forme, essences, teinte, pConif, nbPts, profonds, m, k1, R }, arbreDe: arbreTrie,
  };
}

/**
 * Découpe l'objet de points en tuiles : une enfant par tuile, mêmes attributs (un seul tampon sur la carte graphique),
 * même matériau, sa propre sphère englobante (écartée hors du champ par three.js). L'objet lui-même ne dessine rien.
 * Points enfouis d'une tuile : dessinés seulement si la caméra en est à moins de MARGE_ENFOUIS m, ou en coupe.
 */
export function tuilerPoints(pts, info, regler, vue = {}) {
  const g = pts.geometry, centre = new THREE.Vector3();
  g.setDrawRange(0, 0);
  for (const T of info.tuiles) {
    const gt = new THREE.BufferGeometry();
    for (const [nom, at] of Object.entries(g.attributes)) gt.setAttribute(nom, at);
    gt.boundingSphere = T.sphere;
    gt.setDrawRange(T.debut, T.nVis + T.nBur);
    const o = new THREE.Points(gt, pts.material);
    o.receiveShadow = pts.receiveShadow;
    o.raycast = () => {};
    o.onBeforeRender = (r, s, cam) => {
      regler(r, s, cam);
      const mat = pts.material, coupe = mat.clippingPlanes?.length > 0, u = mat.uniforms;
      centre.copy(T.sphere.center).applyMatrix4(o.matrixWorld);
      const d = Math.max(1, cam.position.distanceTo(centre) - T.sphere.radius); // point de la tuile le plus proche
      if (coupe || d <= MARGE_ENFOUIS + 2 || !(u.cacherEnfouis?.value > 0.5)) { gt.drawRange.count = T.nVis + T.nBur; return; }
      // allègement au loin (même règle que le shader, au plus proche de la tuile) : seuls les premiers rangs servent
      let garde = 1;
      if (u.allege.value > 0 && cam.isPerspectiveCamera && !(vue.vueDessus?.value > 0.5)) garde = Math.min(1, Math.max(0.12, (u.allege.value / d) ** 0.9));
      gt.drawRange.count = garde >= 1 ? T.nVis : Math.min(T.nVis, Math.ceil((Math.floor(254 * garde) + 1) / 254 * T.nVis) + 1);
    };
    pts.add(o);
  }
  pts.userData.especes = info;
}

/* ------------------------------------------------------------------ degré de mélange LFI (a priori en forêt) */
const URL_MELANGE = "https://data.geo.admin.ch/ch.bafu.landesforstinventar-waldmischungsgrad/landesforstinventar-waldmischungsgrad/landesforstinventar-waldmischungsgrad_2056.tif";
let tiffMelange = null;

/**
 * Lit le degré de mélange (part de feuillus en %, raster 10 m, COG de data.geo.admin.ch, quelques dizaines de Ko pour
 * un lieu) autour de (E, N) et reclasse les arbres en forêt : il remplace l'a priori par l'altitude. Hors forêt
 * (pas de donnée), l'altitude reste. Met à jour l'attribut aEsp ; `fini()` est appelé après.
 */
export async function affinerParMelange(pts, { E, N }, R, fini = () => {}) {
  const info = pts?.userData.especes, A = info?.arbres;
  if (!A || !A.n) return null;
  try {
    tiffMelange ||= fromUrl(URL_MELANGE, { maxRanges: 1 }).then(t => t.getImage()).catch(e => { tiffMelange = null; throw e; });
    const img = await tiffMelange, [x0, , , y1] = img.getBoundingBox(), [rx, ry] = img.getResolution();
    const c0 = Math.floor((E - R - x0) / rx), l0 = Math.floor((N + R - y1) / ry), w = Math.ceil(2 * R / rx) + 1, h = Math.ceil(2 * R / -ry) + 1;
    const [v] = await img.readRasters({ window: [c0, l0, c0 + w, l0 + h] });
    if (pts.userData.especes !== info) return null; // lieu changé entre-temps
    const melange = new Float32Array(A.n).fill(NaN);
    for (let t = 0; t < A.n; t++) {
      const e = E - R + (A.sx[t] + 0.5) * A.k1, nn = N - R + (A.sy[t] + 0.5) * A.k1;
      const c = Math.floor((e - x0) / rx) - c0, l = Math.floor((nn - y1) / ry) - l0;
      const val = c >= 0 && l >= 0 && c < w && l < h ? v[l * w + c] : -128;
      if (val >= 0 && val <= 100) melange[t] = val;
    }
    for (let t = 0; t < A.n; t++) {
      if (isNaN(melange[t])) continue;
      const prior = 1 - melange[t] / 100;
      const [e, p] = essence(prior, A.forme[t], A.alt[t], melange[t]);
      A.essences[t] = e; A.pConif[t] = p;
    }
    A.melange = melange;
    const at = pts.geometry.attributes.aEsp, esp = at.array, de = info.arbreDe;
    if (!esp) return null;
    for (let k = 0; k < esp.length; k++) {
      const t = de[k];
      if (t < 0) continue;
      const s = esp[k] < 0 ? -1 : 1;
      esp[k] = s * (1 + 40 * A.essences[t] + Math.floor(39.99 * A.teinte[t]));
    }
    at.needsUpdate = true;
    const b = info.bilan; b.conifere = b.feuillu = b.meleze = 0;
    for (let t = 0; t < A.n; t++) b[["feuillu", "conifere", "meleze"][A.essences[t]]]++;
    b.melange = true;
    fini();
    return b;
  } catch (e) {
    console.warn("degré de mélange LFI :", e.message);
    return null;
  } finally {
    // plus besoin des tableaux côté processeur (aEsp : libéré après son envoi à la carte graphique)
    if (pts?.userData.especes === info) {
      info.arbreDe = null;
      const at = pts.geometry.attributes.aEsp;
      if (at?.array) { at.onUpload(function () { this.array = null; }); at.needsUpdate = true; }
    }
  }
}
