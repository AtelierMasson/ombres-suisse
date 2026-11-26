// Export du site (mode pro) : DXF, OBJ, glTF binaire (.glb) et STL, avec un fichier LISEZ-MOI, dans une archive zip.
// Repère des fichiers (convention des logiciels de CAO) : X = est, Y = nord, Z = altitude, en mètres. Le glTF fait
// exception : sa norme impose Y vers le haut, les logiciels le redressent d'eux-mêmes à l'import.
// « Origine locale » : coordonnées relatives à (E0, N0, Z0) en MN95 (EPSG:2056), écrites dans le nom du fichier,
// dans ses métadonnées et dans le LISEZ-MOI. « MN95 complètes » : coordonnées absolues (DXF et OBJ, en texte).
import * as THREE from "three";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { zipSync, strToU8 } from "three/addons/libs/fflate.module.js";
import { solEn } from "./grille.js";
import { couronnes } from "./maillages.js";
import { t, nombre as decimal, entier, locale } from "./i18n.js";

export const FORMATS = {
  dxf: { nom: "DXF", absolu: true, lignes: true, parTriangle: 140 },
  obj: { nom: "OBJ", absolu: true, lignes: true, parTriangle: 34 },
  glb: { nom: "glTF binaire (.glb)", absolu: false, lignes: true, parTriangle: 27 },
  stl: { nom: "STL", absolu: false, lignes: false, parTriangle: 50 },
};
// calques (noms sans accent : le DXF ancien ne les garantit pas), couleur AutoCAD et couleur du glTF
const CALQUES = {
  TERRAIN: [253, "#d9d2c5"], SOCLE: [252, "#bdb5a6"], BATIMENTS: [7, "#f1ede6"], ARBRES: [3, "#6f9a4d"],
  PARCELLE: [1, "#e0262b"], COURBES: [30, "#a8773a"], INFO: [2, "#f5b301"],
};

/* ------------------------------------------------------------------ géométrie */
// Dans ce fichier, un maillage est { pos: Float64Array (x est, y nord, z altitude absolue ; relatifs à E0, N0), idx: Uint32Array }.

/** Terrain à la maille `pas` (en cellules de 0,5 m), socle fermé (côtés et fond) accroché aux mêmes sommets du bord. */
function terrainEtSocle(G, pas, zBas) {
  const m = Math.floor(G.n / pas) + 1, pos = new Float64Array((m * m + 4 * (m - 1) + 1) * 3), idx = new Uint32Array((m - 1) * (m - 1) * 6);
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
    const x = G.x0 + a * pas * G.c, y = G.x0 + b * pas * G.c, k = 3 * (b * m + a);
    pos[k] = x; pos[k + 1] = y; pos[k + 2] = solEn(G, x, y);
  }
  let t = 0;
  for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
    const p = b * m + a;
    idx[t++] = p; idx[t++] = p + 1; idx[t++] = p + m + 1; idx[t++] = p; idx[t++] = p + m + 1; idx[t++] = p + m;
  }
  // tour du terrain dans le sens inverse des aiguilles d'une montre (vu de dessus) : les faces du socle regardent dehors
  const tour = [];
  for (let a = 0; a < m - 1; a++) tour.push(a);
  for (let b = 0; b < m - 1; b++) tour.push(b * m + m - 1);
  for (let a = m - 1; a > 0; a--) tour.push((m - 1) * m + a);
  for (let b = m - 1; b > 0; b--) tour.push(b * m);
  const q = tour.length, bas = m * m, cotes = [];
  tour.forEach((p, k) => { pos[3 * (bas + k)] = pos[3 * p]; pos[3 * (bas + k) + 1] = pos[3 * p + 1]; pos[3 * (bas + k) + 2] = zBas; });
  for (let k = 0; k < q; k++) {
    const k2 = (k + 1) % q;
    cotes.push(tour[k], bas + k, bas + k2, tour[k], bas + k2, tour[k2]);
  }
  // fond : éventail autour du centre, tourné vers le bas
  const centre = bas + q;
  pos[3 * centre] = (pos[0] + pos[3 * (m * m - 1)]) / 2; pos[3 * centre + 1] = (pos[1] + pos[3 * (m * m - 1) + 1]) / 2; pos[3 * centre + 2] = zBas;
  for (let k = 0; k < q; k++) cotes.push(centre, bas + (k + 1) % q, bas + k);
  return { terrain: { pos: pos.subarray(0, m * m * 3), idx }, socle: compacter({ pos, idx: Uint32Array.from(cotes) }) };
}

/** Ne garde que les sommets utilisés. */
function compacter({ pos, idx }) {
  const rang = new Int32Array(pos.length / 3).fill(-1), p = [], i = new Uint32Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const v = idx[k];
    if (rang[v] < 0) { rang[v] = p.length / 3; p.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); }
    i[k] = rang[v];
  }
  return { pos: Float64Array.from(p), idx: i };
}

/**
 * Triangles des objets three.js donnés, ramenés dans le repère d'export et coupés au carré du modèle (les bâtiments
 * de comparaison débordent). `zRef` : altitude du zéro de la scène.
 */
function trianglesDe(objets, zRef, R) {
  const tri = [], P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  // demi-plans du carré : x ≤ R, x ≥ −R, y ≤ R, y ≥ −R
  const plans = [[0, 1], [0, -1], [1, 1], [1, -1]];
  const couper = poly => {
    for (const [axe, sens] of plans) {
      const d = p => R - sens * p[axe], sortie = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length], da = d(a), db = d(b);
        if (da >= 0) sortie.push(a);
        if ((da >= 0) !== (db >= 0)) { const f = da / (da - db); sortie.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]); }
      }
      poly = sortie;
      if (poly.length < 3) return [];
    }
    return poly;
  };
  for (const o of objets) o?.traverse(m => {
    if (!m.isMesh || !m.visible) return;
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position, idx = m.geometry.index, nt = (idx ? idx.count : pos.count) / 3;
    for (let t = 0; t < nt; t++) {
      for (let s = 0; s < 3; s++) P[s].fromBufferAttribute(pos, idx ? idx.getX(3 * t + s) : 3 * t + s).applyMatrix4(m.matrixWorld);
      let poly = P.map(p => [p.x, -p.z, p.y + zRef]);
      if (poly.some(p => Math.abs(p[0]) > R || Math.abs(p[1]) > R)) poly = couper(poly);
      for (let k = 1; k < poly.length - 1; k++) tri.push(...poly[0], ...poly[k], ...poly[k + 1]);
    }
  });
  return tri;
}

/**
 * Maillage propre à partir de triangles en vrac : sommets fusionnés au millimètre, triangles dégénérés (deux sommets
 * confondus ou surface nulle) et doublons retirés.
 */
function souder(tri) {
  const table = new Map(), pos = [], idx = [], vus = new Set(), id = [0, 0, 0];
  const sommet = k => {
    const x = Math.round(tri[k] * 1000), y = Math.round(tri[k + 1] * 1000), z = Math.round(tri[k + 2] * 1000), cle = (x + 2 ** 21) * 2 ** 23 + y + 2 ** 21;
    let liste = table.get(cle);
    if (!liste) table.set(cle, liste = []);
    for (let q = 0; q < liste.length; q += 2) if (liste[q] === z) return liste[q + 1];
    liste.push(z, pos.length / 3);
    pos.push(x / 1000, y / 1000, z / 1000);
    return pos.length / 3 - 1;
  };
  for (let t = 0; t < tri.length; t += 9) {
    for (let s = 0; s < 3; s++) id[s] = sommet(t + 3 * s);
    const [a, b, c] = id;
    if (a === b || b === c || a === c) continue;
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-7) continue;
    const tries = [a, b, c].sort((u, v) => u - v), cle = `${tries[0]},${tries[1]},${tries[2]}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    idx.push(a, b, c);
  }
  return compacter({ pos: Float64Array.from(pos), idx: Uint32Array.from(idx) });
}

/**
 * Oriente les faces de façon cohérente (bâtiments de comparaison, dont les triangles sont tournés au hasard) : de
 * proche en proche à travers les arêtes partagées par deux faces, puis chaque morceau est tourné vers l'extérieur
 * (volume positif autour de son centre).
 */
function orienter({ pos, idx }) {
  const nt = idx.length / 3, nv = pos.length / 3, aretes = new Map();
  const cle = (a, b) => a < b ? a * nv + b : b * nv + a;
  for (let t = 0; t < nt; t++) for (let s = 0; s < 3; s++) {
    const k = cle(idx[3 * t + s], idx[3 * t + (s + 1) % 3]), l = aretes.get(k);
    if (l) l.push(t); else aretes.set(k, [t]);
  }
  const vu = new Uint8Array(nt);
  for (let t0 = 0; t0 < nt; t0++) {
    if (vu[t0]) continue;
    const morceau = [t0], pile = [t0];
    vu[t0] = 1;
    while (pile.length) {
      const t = pile.pop();
      for (let s = 0; s < 3; s++) {
        const a = idx[3 * t + s], b = idx[3 * t + (s + 1) % 3], l = aretes.get(cle(a, b));
        if (l.length !== 2) continue;
        const u = l[0] === t ? l[1] : l[0];
        if (vu[u]) continue;
        // la face voisine doit parcourir l'arête commune dans l'autre sens
        for (let r = 0; r < 3; r++) if (idx[3 * u + r] === a && idx[3 * u + (r + 1) % 3] === b) { const x = idx[3 * u + 1]; idx[3 * u + 1] = idx[3 * u + 2]; idx[3 * u + 2] = x; break; }
        vu[u] = 1; morceau.push(u); pile.push(u);
      }
    }
    const c = [0, 0, 0];
    for (const t of morceau) for (let s = 0; s < 3; s++) for (let k = 0; k < 3; k++) c[k] += pos[3 * idx[3 * t + s] + k] / (3 * morceau.length);
    let vol = 0;
    for (const t of morceau) {
      const [ax, ay, az, bx, by, bz, dx, dy, dz] = [0, 1, 2].flatMap(s => [0, 1, 2].map(k => pos[3 * idx[3 * t + s] + k] - c[k]));
      vol += ax * (by * dz - bz * dy) - ay * (bx * dz - bz * dx) + az * (bx * dy - by * dx);
    }
    if (vol < 0) for (const t of morceau) { const x = idx[3 * t + 1]; idx[3 * t + 1] = idx[3 * t + 2]; idx[3 * t + 2] = x; }
  }
  return { pos, idx };
}

/** Limite de parcelle posée sur le terrain : sommets du cadastre, plus un point par mètre pour suivre la pente. */
function limites(G, anneaux) {
  const lignes = [];
  for (const anneau of anneaux) {
    const pts = [];
    for (let k = 0; k < anneau.length - 1; k++) {
      const [x1, y1] = anneau[k], [x2, y2] = anneau[k + 1], nb = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
      for (let t = 0; t < nb; t++) { const x = x1 + (x2 - x1) * t / nb, y = y1 + (y2 - y1) * t / nb; pts.push(x, y, solEn(G, x, y)); }
    }
    if (pts.length >= 6) lignes.push({ pts: Float64Array.from(pts), ferme: true });
  }
  return lignes;
}

/** Courbes de niveau du terrain (lecture tous les mètres), à l'équidistance donnée : polylignes en 3D. */
function courbesNiveau(G, equidistance = 1) {
  const pas = 2, m = Math.floor(G.n / pas) + 1, z = new Float32Array(m * m), d = pas * G.c;
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) z[b * m + a] = solEn(G, G.x0 + a * d, G.x0 + b * d);
  // segments par niveau, entre deux arêtes de la grille (arête horizontale 2k, verticale 2k + 1, partant du coin k)
  const niveaux = new Map();
  for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
    const k = b * m + a, v = [z[k], z[k + 1], z[k + m + 1], z[k + m]], ar = [2 * k, 2 * (k + 1) + 1, 2 * (k + m), 2 * k + 1];
    const mn = Math.min(...v), mx = Math.max(...v);
    for (let L = Math.ceil(mn / equidistance) * equidistance; L <= mx; L += equidistance) {
      const c = [];
      for (let s = 0; s < 4; s++) if ((v[s] >= L) !== (v[(s + 1) % 4] >= L)) c.push(ar[s]);
      if (c.length < 2) continue;
      let segs = niveaux.get(L);
      if (!segs) niveaux.set(L, segs = []);
      if (c.length === 2) segs.push(c[0], c[1]);
      else if ((v[0] >= L) === ((v[0] + v[1] + v[2] + v[3]) / 4 >= L)) segs.push(c[0], c[1], c[2], c[3]); // col : selon le centre
      else segs.push(c[3], c[0], c[1], c[2]);
    }
  }
  const lignes = [];
  for (const [L, segs] of niveaux) {
    const point = e => {
      const k = e >> 1, k2 = e & 1 ? k + m : k + 1, f = (L - z[k]) / (z[k2] - z[k]);
      const xa = G.x0 + (k % m) * d, ya = G.x0 + Math.floor(k / m) * d;
      return e & 1 ? [xa, ya + f * d, L] : [xa + f * d, ya, L];
    };
    const voisins = new Map(), libre = new Uint8Array(segs.length / 2).fill(1);
    const noter = (e, s) => { const l = voisins.get(e); if (l) l.push(s); else voisins.set(e, [s]); };
    for (let s = 0; s < segs.length; s += 2) { noter(segs[s], s / 2); noter(segs[s + 1], s / 2); }
    const suivre = (e, chaine) => { // prolonge la chaîne depuis l'arête e tant qu'un segment libre en part
      for (;;) {
        const s = (voisins.get(e) || []).find(s => libre[s]);
        if (s == null) return;
        libre[s] = 0;
        e = segs[2 * s] === e ? segs[2 * s + 1] : segs[2 * s];
        chaine.push(e);
      }
    };
    for (let s = 0; s < libre.length; s++) {
      if (!libre[s]) continue;
      libre[s] = 0;
      const avant = [segs[2 * s + 1]], arriere = [segs[2 * s]];
      suivre(avant[0], avant); suivre(arriere[0], arriere);
      const chaine = [...arriere.reverse(), ...avant], ferme = chaine.length > 3 && chaine[0] === chaine[chaine.length - 1];
      if (ferme) chaine.pop();
      if (chaine.length >= 2) lignes.push({ pts: Float64Array.from(chaine.flatMap(point)), ferme });
    }
  }
  return lignes;
}

/**
 * Prépare les catégories demandées. `quoi` = { terrain, maille (m), socle, parcelle, batiments, arbres, courbes } ;
 * `jeu` = bâtiments affichés ("releve", "swiss" ou "roofer").
 * @returns {{ nom, maillage?: { pos, idx }, lignes?: { pts, ferme }[] }[]}
 */
export function preparer(scene, parcelle, quoi, jeu = "releve") {
  const G = scene.G, zRef = scene.zRef, c = scene.couches, cats = [];
  if (quoi.terrain || quoi.socle) {
    const T = terrainEtSocle(G, Math.max(1, Math.round(quoi.maille / G.c)), scene.zBas + zRef);
    if (quoi.terrain) cats.push({ nom: "TERRAIN", maillage: T.terrain });
    if (quoi.socle) cats.push({ nom: "SOCLE", maillage: T.socle });
  }
  if (quoi.batiments) {
    const objets = jeu === "swiss" ? [scene.swiss?.socle] : jeu === "roofer" ? [c.roofer] : [c.bati];
    const M = souder(trianglesDe(objets, zRef, G.R));
    if (jeu !== "releve") orienter(M);
    if (M.idx.length) cats.push({ nom: "BATIMENTS", maillage: M });
  }
  if (quoi.arbres) {
    const g = couronnes(G, zRef, scene.T.arbres);
    if (g) { cats.push({ nom: "ARBRES", maillage: souder(trianglesDe([new THREE.Mesh(g)], zRef, G.R)) }); g.dispose(); }
  }
  if (quoi.parcelle) { const l = limites(G, parcelle?.anneauxRel || []); if (l.length) cats.push({ nom: "PARCELLE", lignes: l }); }
  if (quoi.courbes) { const l = courbesNiveau(G); if (l.length) cats.push({ nom: "COURBES", lignes: l }); }
  return cats;
}

/* ------------------------------------------------------------------ écriture */
const nombre = v => { const r = Math.round(v * 1000) / 1000; return Number.isInteger(r) ? r + ".0" : String(r); };

/** DXF en texte (version R12, la plus largement lue) : calques, 3DFACE pour les surfaces, POLYLINE 3D pour les lignes. */
export function ecrireDxf(cats, O, infos) {
  const [dx, dy, dz] = O.decalage, t = [];
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const cat of cats) for (const pts of [cat.maillage?.pos, ...(cat.lignes || []).map(l => l.pts)]) if (pts)
    for (let k = 0; k < pts.length; k++) { const v = pts[k] + O.decalage[k % 3]; if (v < mn[k % 3]) mn[k % 3] = v; if (v > mx[k % 3]) mx[k % 3] = v; }
  if (mn[0] === Infinity) mn = mx = [0, 0, 0];
  const p3 = (v, k = 0) => `${10 + k}\n${nombre(v[0])}\n${20 + k}\n${nombre(v[1])}\n${30 + k}\n${nombre(v[2])}\n`;
  const calques = [...cats.map(c => c.nom), "INFO"];
  t.push(infos.map(l => `999\n${l}\n`).join(""),
    `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSBASE\n${p3([0, 0, 0])}9\n$EXTMIN\n${p3(mn)}9\n$EXTMAX\n${p3(mx)}0\nENDSEC\n`,
    `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n`,
    `0\nTABLE\n2\nLAYER\n70\n${calques.length}\n`, calques.map(n => `0\nLAYER\n2\n${n}\n70\n0\n62\n${CALQUES[n][0]}\n6\nCONTINUOUS\n`).join(""),
    `0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`);
  // l'origine : un point et un texte sur le calque INFO
  const o = O.absolu ? [mn[0], mn[1], mn[2]] : [0, 0, 0];
  t.push(`0\nPOINT\n8\nINFO\n${p3(o)}0\nTEXT\n8\nINFO\n${p3(o)}40\n1.0\n1\n${infos[1]}\n`);
  for (const cat of cats) {
    if (cat.maillage) {
      const { pos, idx } = cat.maillage, nv = pos.length / 3, X = new Array(nv), Y = new Array(nv), Z = new Array(nv);
      for (let v = 0; v < nv; v++) { X[v] = nombre(pos[3 * v] + dx); Y[v] = nombre(pos[3 * v + 1] + dy); Z[v] = nombre(pos[3 * v + 2] + dz); }
      const tete = `0\n3DFACE\n8\n${cat.nom}\n`;
      let s = "";
      for (let k = 0; k < idx.length; k += 3) {
        const a = idx[k], b = idx[k + 1], c = idx[k + 2];
        // triangle : le quatrième coin répète le troisième
        s += `${tete}10\n${X[a]}\n20\n${Y[a]}\n30\n${Z[a]}\n11\n${X[b]}\n21\n${Y[b]}\n31\n${Z[b]}\n12\n${X[c]}\n22\n${Y[c]}\n32\n${Z[c]}\n13\n${X[c]}\n23\n${Y[c]}\n33\n${Z[c]}\n`;
        if (s.length > 1 << 20) { t.push(s); s = ""; }
      }
      t.push(s);
    }
    for (const l of cat.lignes || []) {
      let s = `0\nPOLYLINE\n8\n${cat.nom}\n66\n1\n${p3([0, 0, 0])}70\n${l.ferme ? 9 : 8}\n`;
      for (let k = 0; k < l.pts.length; k += 3) s += `0\nVERTEX\n8\n${cat.nom}\n${p3([l.pts[k] + dx, l.pts[k + 1] + dy, l.pts[k + 2] + dz])}70\n32\n`;
      t.push(s + `0\nSEQEND\n8\n${cat.nom}\n`);
    }
  }
  t.push("0\nENDSEC\n0\nEOF\n");
  return t;
}

/** Groupe three.js d'une liste de catégories. `versScene` : repère du glTF (Y vers le haut) au lieu de celui de la CAO. */
function groupe(cats, O, versScene) {
  const racine = new THREE.Group(), [dx, dy, dz] = O.decalage;
  racine.name = "TOPOGRAPH";
  const tableau = pts => {
    const a = new (versScene ? Float32Array : Float64Array)(pts.length);
    for (let k = 0; k < pts.length; k += 3) {
      const x = pts[k] + dx, y = pts[k + 1] + dy, z = pts[k + 2] + dz;
      if (versScene) { a[k] = x; a[k + 1] = z; a[k + 2] = -y; }
      else { a[k] = Math.round(x * 1000) / 1000; a[k + 1] = Math.round(y * 1000) / 1000; a[k + 2] = Math.round(z * 1000) / 1000; }
    }
    return new THREE.BufferAttribute(a, 3);
  };
  for (const cat of cats) {
    const couleur = CALQUES[cat.nom][1];
    if (cat.maillage) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", tableau(cat.maillage.pos));
      g.setIndex(new THREE.BufferAttribute(cat.maillage.idx, 1));
      if (versScene) g.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: couleur, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
      mat.name = cat.nom;
      const m = new THREE.Mesh(g, mat);
      m.name = cat.nom;
      racine.add(m);
    } else if (versScene || cat.lignes.length > 8) {
      // beaucoup de polylignes (courbes de niveau) : un seul objet, en segments
      const pts = [];
      for (const l of cat.lignes) {
        const nb = l.pts.length / 3;
        for (let k = 0; k < (l.ferme ? nb : nb - 1); k++) { const k2 = (k + 1) % nb; pts.push(l.pts[3 * k], l.pts[3 * k + 1], l.pts[3 * k + 2], l.pts[3 * k2], l.pts[3 * k2 + 1], l.pts[3 * k2 + 2]); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", tableau(pts));
      const s = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: couleur }));
      s.name = s.material.name = cat.nom;
      racine.add(s);
    } else cat.lignes.forEach((l, k) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", tableau(l.ferme ? [...l.pts, l.pts[0], l.pts[1], l.pts[2]] : l.pts));
      const s = new THREE.Line(g, new THREE.LineBasicMaterial({ color: couleur }));
      s.name = k ? `${cat.nom}_${k + 1}` : cat.nom;
      racine.add(s);
    });
  }
  return racine;
}

function liberer(racine) { racine.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }

/** OBJ : un objet (et un groupe) nommé par catégorie, origine en commentaire de tête. */
function ecrireObj(cats, O, infos) {
  const racine = groupe(cats, O, false), texte = new OBJExporter().parse(racine).replace(/^o (.+)$/gm, "o $1\ng $1");
  liberer(racine);
  return [infos.map(l => `# ${l}\n`).join(""), texte];
}

/** glTF binaire : un nœud par catégorie, origine dans asset.extras. Repère de la norme glTF (Y vers le haut, −Z = nord). */
async function ecrireGlb(cats, O, extras) {
  const racine = groupe(cats, O, true), exp = new GLTFExporter();
  exp.register(w => ({ afterParse() { w.json.asset.extras = extras; } }));
  const tampon = await exp.parseAsync(racine, { binary: true });
  liberer(racine);
  return [tampon];
}

/** STL binaire : un seul maillage (le format n'a ni objets ni lignes) ; l'origine tient dans les 80 octets d'en-tête. */
function ecrireStl(cats, O, entete) {
  const racine = groupe(cats.filter(c => c.maillage), O, false), vue = new STLExporter().parse(racine, { binary: true });
  liberer(racine);
  const octets = new Uint8Array(vue.buffer);
  octets.set(strToU8(entete.replace(/[^\x20-\x7e]/g, "?")).subarray(0, 80));
  return [octets];
}

/* ------------------------------------------------------------------ export */
/** Nom de fichier sans accent ni espace. */
export const sansAccent = s => (s || "site").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";

/** Estimation grossière (triangles, octets avant compression) pour prévenir avant un gros export. */
export function estimer(scene, quoi, format, jeu = "releve") {
  const G = scene.G, m = G.n / Math.max(1, Math.round(quoi.maille / G.c));
  let tri = 0;
  if (quoi.terrain) tri += 2 * m * m;
  if (quoi.socle) tri += 12 * m;
  if (quoi.batiments) (jeu === "swiss" ? scene.swiss?.socle : jeu === "roofer" ? scene.couches.roofer : scene.couches.bati)
    ?.traverse(o => { if (o.isMesh) tri += (o.geometry.index || o.geometry.attributes.position).count / 3; });
  if (quoi.arbres) { let v = 0; for (let p = 0; p < G.veg.length; p += 7) if (!isNaN(G.veg[p])) v++; tri += v * 7; }
  return { triangles: Math.round(tri), octets: tri * FORMATS[format].parTriangle };
}

/**
 * Exporte le site. `o` = { scene, parcelle, E0, N0, lieu, format, quoi, jeu, absolu, source, progres(f, texte) }.
 * @returns {Promise<{ nom, blob, fichier, octets, triangles, ms }>} l'archive zip (modèle + LISEZ-MOI) et ses mesures.
 */
export async function exporterSite(o) {
  const { scene, format, quoi } = o, F = FORMATS[format], debut = performance.now(), souffle = () => new Promise(r => setTimeout(r, 20));
  const absolu = !!o.absolu && F.absolu, Z0 = Math.round(scene.zRef);
  const O = { absolu, E0: o.E0, N0: o.N0, Z0, decalage: absolu ? [o.E0, o.N0, 0] : [0, 0, -Z0] };
  o.progres?.(0.1, t("export.preparation")); await souffle();
  const cats = preparer(scene, o.parcelle, quoi, o.jeu).filter(c => c.maillage || F.lignes);
  if (!cats.length) throw new Error(t("export.rien"));
  const triangles = cats.reduce((s, c) => s + (c.maillage ? c.maillage.idx.length / 3 : 0), 0);
  const origine = t("export.origine", { E: o.E0, N: o.N0, Z: Z0 });
  const repere = absolu ? t("export.infoMn95") : t("export.infoLocal", { origine });
  const base = `ombres_${sansAccent(o.lieu)}_${absolu ? "MN95" : `E${o.E0}_N${o.N0}_Z${Z0}`}`, fichier = `${base}.${format}`;
  o.progres?.(0.45, t("export.ecriture", { format: F.nom })); await souffle();
  const infos = [t("export.infoLieu", { lieu: sansAccent(o.lieu) }), repere, t("export.infoSource")];
  const extras = { generateur: "Topograph (Atelier Masson)", lieu: o.lieu, epsg: 2056, origine: { E: o.E0, N: o.N0, Z: Z0 }, unite: t("export.unite"),
    repere: t("export.gltfRepere"),
    source: "© swisstopo (swissSURFACE3D, swissALTI3D), cadastre geo.admin.ch" };
  const morceaux = format === "dxf" ? ecrireDxf(cats, O, infos) : format === "obj" ? ecrireObj(cats, O, infos)
    : format === "glb" ? await ecrireGlb(cats, O, extras) : ecrireStl(cats, O, `Topograph E0=${o.E0} N0=${o.N0} Z0=${Z0} EPSG:2056 m`);
  const modele = new Uint8Array(await new Blob(morceaux).arrayBuffer());
  o.progres?.(0.8, t("export.archive")); await souffle();
  const lisezMoi = texteLisezMoi({ ...o, O, F, fichier, cats, triangles, origine, octets: modele.length });
  // texte : compression rapide (÷ 5 à 10) ; binaire : léger gain
  const zip = zipSync({ [fichier]: [modele, { level: 1 }], "LISEZ-MOI.txt": strToU8(lisezMoi) });
  return { nom: `${base}_${format}.zip`, blob: new Blob([zip], { type: "application/zip" }), fichier, lisezMoi, modele, octets: modele.length, octetsZip: zip.length, triangles, ms: performance.now() - debut };
}

function texteLisezMoi({ lieu, format, quoi, jeu, source, O, F, fichier, cats, triangles, origine, octets }) {
  const jeux = { releve: t("lisez.jeuReleve"), swiss: t("lisez.jeuSwiss"), roofer: t("lisez.jeuRoofer") };
  const contenu = { TERRAIN: t("lisez.TERRAIN", { maille: decimal(quoi.maille, Number.isInteger(quoi.maille) ? 0 : 1) }), SOCLE: t("lisez.SOCLE"),
    BATIMENTS: t("lisez.BATIMENTS", { jeu: jeux[jeu] || jeux.releve }) + (jeu === "releve" || !jeu ? t("lisez.sansMasques") : ""),
    ARBRES: t("lisez.ARBRES"), PARCELLE: t("lisez.PARCELLE"), COURBES: t("lisez.COURBES") };
  return [
    t("lisez.titre"),
    ``,
    t("lisez.lieu", { lieu }),
    t("lisez.fichier", { fichier, format: F.nom, taille: t("unite.mo", { n: decimal(octets / 1e6, 1) }), triangles: entier(triangles) }),
    t("lisez.date", { date: new Date().toLocaleString(locale) }),
    ``,
    t("lisez.repere"),
    O.absolu ? t("lisez.mn95") : t("lisez.local", { origine, E0: O.E0, N0: O.N0, Z0: O.Z0 }),
    format === "glb" ? t("lisez.axesGlb", { Z0: O.Z0 }) : t("lisez.axes"),
    format === "obj" ? t("lisez.obj") : null,
    format === "stl" ? t("lisez.stl") : null,
    format === "dxf" ? t("lisez.dxf") : null,
    ``,
    t(format === "dxf" ? "lisez.contenuCalques" : format === "stl" ? "lisez.contenuStl" : "lisez.contenuObjets"),
    ...cats.map(c => `  ${c.nom.padEnd(10)} ${contenu[c.nom]}`),
    ``,
    t("lisez.limites"),
    t("lisez.limite1"),
    t("lisez.limite2"),
    t("lisez.limite3"),
    ``,
    t("lisez.sources"),
    source || "", t("lisez.source"),
    ``,
  ].filter(l => l != null).join("\r\n");
}
