// Lecture des fichiers importés, sans three.js ni DOM (utilisable dans node) : DXF (texte) et OBJ.
// Sortie commune, dans le repère du fichier (X, Y au sol, Z en haut, unités du fichier), en nombres double précision
// (indispensable pour les coordonnées MN95 complètes, que Float32 arrondirait au quart de mètre) :
//   { maillages: [{ calque, tri: number[] (x, y, z × 3 par triangle) }],
//     lignes: [{ calque, pts: [[x, y, z], …], ferme }],
//     textes: [{ calque, p: [x, y, z], texte }],
//     unites: "m" | "cm" | "mm" | "dm" | "in" | "ft" | null (déclarées par le fichier),
//     ignores: { TYPE: nombre } (entités non lues), avertissements: [{ cle, p }] }

/* ------------------------------------------------------------------ outils communs */
/** Données vides. */
export const donneesVides = () => ({ maillages: [], lignes: [], textes: [], unites: null, ignores: {}, avertissements: [] });

/** Ajoute des triangles au maillage du calque (un maillage par calque). */
function ajouterTriangles(D, calque, tri) {
  if (!tri.length) return;
  let m = D.maillages.find(m => m.calque === calque);
  if (!m) D.maillages.push(m = { calque, tri: [] });
  for (let k = 0; k < tri.length; k++) m.tri.push(tri[k]);
}

const compter = (D, type) => { D.ignores[type] = (D.ignores[type] || 0) + 1; };

/* ------------------------------------------------------------------ DXF : paires code / valeur */
// $INSUNITS : 1 pouce, 2 pied, 4 mm, 5 cm, 6 m, 14 dm (0 = sans unité)
const INSUNITS = { 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m", 14: "dm" };

/** Découpe le texte en enregistrements { type, g: [[code, valeur], …] } (un par code 0). */
function enregistrements(texte) {
  const L = texte.split(/\r?\n/), R = [];
  let cur = null;
  for (let i = 0; i + 1 < L.length; i += 2) {
    const code = parseInt(L[i], 10), v = L[i + 1].trim();
    if (Number.isNaN(code)) continue;
    if (code === 0) { cur = { type: v, g: [] }; R.push(cur); } else if (cur) cur.g.push([code, v]);
  }
  return R;
}

/** Première valeur d'un code (nombre ou texte). */
const val = (e, code, defaut = 0) => { const p = e.g.find(p => p[0] === code); return p ? p[1] : defaut; };
const num = (e, code, defaut = 0) => { const p = e.g.find(p => p[0] === code); return p ? parseFloat(p[1]) : defaut; };
const point = (e, k = 0) => [num(e, 10 + k), num(e, 20 + k), num(e, 30 + k)];

/* ------------------------------------------------------------------ DXF : repères */
// Matrice affine 3 × 4 en ligne : [m00 m01 m02 tx, m10 m11 m12 ty, m20 m21 m22 tz]
const IDENTITE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const appliquer = (M, [x, y, z]) => [M[0] * x + M[1] * y + M[2] * z + M[3], M[4] * x + M[5] * y + M[6] * z + M[7], M[8] * x + M[9] * y + M[10] * z + M[11]];
function composer(A, B) { // A ∘ B
  const C = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) C[4 * r + c] = A[4 * r] * B[c] + A[4 * r + 1] * B[4 + c] + A[4 * r + 2] * B[8 + c];
    C[4 * r + 3] = A[4 * r] * B[3] + A[4 * r + 1] * B[7] + A[4 * r + 2] * B[11] + A[4 * r + 3];
  }
  return C;
}

/**
 * Repère objet (OCS) d'une entité plane d'après son extrusion (codes 210/220/230), par l'« algorithme de l'axe
 * arbitraire » de la norme DXF. Renvoie la matrice OCS → repère général (WCS).
 */
function matriceOcs(e) {
  let nx = num(e, 210), ny = num(e, 220), nz = num(e, 230, 1);
  const n = Math.hypot(nx, ny, nz) || 1;
  nx /= n; ny /= n; nz /= n;
  if (Math.abs(nx) < 1e-12 && Math.abs(ny) < 1e-12 && nz > 0) return IDENTITE;
  // Ax = (Wy ou Wz) × N
  let ax, ay, az;
  if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) { ax = nz; ay = 0; az = -nx; } else { ax = -ny; ay = nx; az = 0; }
  const a = Math.hypot(ax, ay, az);
  ax /= a; ay /= a; az /= a;
  const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax; // Ay = N × Ax
  return [ax, bx, nx, 0, ay, by, ny, 0, az, bz, nz, 0];
}

/* ------------------------------------------------------------------ DXF : entités */
/** Nettoie le texte d'un MTEXT (codes de mise en forme \P, \f…;, accolades). */
const texteBrut = s => s.replace(/\\P/g, " ").replace(/\\[A-Za-z][^;\\]*;/g, "").replace(/\\[~]/g, " ").replace(/[{}]/g, "").trim();

/** Triangles d'un 3DFACE (un quadrilatère dont le 4e coin répète le 3e est un triangle). */
function faces3d(e) {
  const p = [0, 1, 2, 3].map(k => point(e, k)), meme = (u, v) => u[0] === v[0] && u[1] === v[1] && u[2] === v[2];
  return meme(p[2], p[3]) ? [...p[0], ...p[1], ...p[2]] : [...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]];
}

/** POLYLINE suivie de ses VERTEX : polyligne 2D/3D, maillage polyface (flag 64) ou maillage M × N (flag 16). */
function polyligne(tete, sommets) {
  const flag = num(tete, 70) | 0;
  if (flag & 64) { // polyface : sommets (flag 64|128), puis faces (flag 128 seul, indices 71–74 à partir de 1)
    const pts = [], tri = [];
    for (const v of sommets) {
      const f = num(v, 70) | 0;
      if (f & 128 && !(f & 64)) {
        const ids = [71, 72, 73, 74].map(c => Math.abs(num(v, c) | 0)).filter(i => i > 0);
        for (let k = 1; k < ids.length - 1; k++) if (pts[ids[0] - 1] && pts[ids[k] - 1] && pts[ids[k + 1] - 1])
          tri.push(...pts[ids[0] - 1], ...pts[ids[k] - 1], ...pts[ids[k + 1] - 1]);
      } else pts.push(point(v));
    }
    return { tri };
  }
  if (flag & 16) { // maillage M × N, fermé en M (flag 1) et en N (flag 32)
    const M = num(tete, 71) | 0, N = num(tete, 72) | 0, pts = sommets.map(v => point(v)), tri = [];
    const P = (i, j) => pts[(i % M) * N + (j % N)];
    for (let i = 0; i < (flag & 1 ? M : M - 1); i++) for (let j = 0; j < (flag & 32 ? N : N - 1); j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (a && b && c && d) tri.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    return { tri };
  }
  const ferme = !!(flag & 1);
  if (flag & 8) return { ligne: { pts: sommets.map(v => point(v)), ferme } }; // 3D, repère général
  const O = matriceOcs(tete), z = num(tete, 30); // 2D : élévation dans le repère objet
  return { ligne: { pts: sommets.map(v => appliquer(O, [num(v, 10), num(v, 20), z])), ferme } };
}

/** LWPOLYLINE : sommets 10/20 répétés, élévation 38, flag 70 (1 = fermée). Les arcs (bulge 42) sont pris en cordes. */
function lwpolyligne(e) {
  const O = matriceOcs(e), z = num(e, 38), pts = [];
  let x = null;
  for (const [c, v] of e.g) {
    if (c === 10) x = parseFloat(v);
    else if (c === 20 && x != null) { pts.push(appliquer(O, [x, parseFloat(v), z])); x = null; }
  }
  return { pts, ferme: !!((num(e, 70) | 0) & 1) };
}

/** MESH (AutoCAD 2010+) : 92 nombre de sommets puis 10/20/30, 93 taille de la liste des faces puis 90 : n, i1…in. */
function maillageMesh(e) {
  const pts = [], liste = [];
  let etat = "", reste = 0, x = 0, y = 0;
  for (const [c, v] of e.g) {
    if (c === 92) { etat = "sommets"; reste = parseInt(v, 10); continue; }
    if (c === 93) { etat = "faces"; reste = parseInt(v, 10); continue; }
    if (etat === "sommets" && reste > 0) {
      if (c === 10) x = parseFloat(v); else if (c === 20) y = parseFloat(v);
      else if (c === 30) { pts.push([x, y, parseFloat(v)]); if (--reste === 0) etat = ""; }
    } else if (etat === "faces" && c === 90 && reste > 0) { liste.push(parseInt(v, 10)); if (--reste === 0) etat = ""; }
  }
  const tri = [];
  for (let k = 0; k < liste.length;) {
    const n = liste[k], ids = liste.slice(k + 1, k + 1 + n);
    for (let s = 1; s < n - 1; s++) if (pts[ids[0]] && pts[ids[s]] && pts[ids[s + 1]]) tri.push(...pts[ids[0]], ...pts[ids[s]], ...pts[ids[s + 1]]);
    k += n + 1;
  }
  return tri;
}

/**
 * Lit une liste d'enregistrements (section ENTITIES ou contenu d'un bloc) en entités élémentaires, dans le repère
 * du fichier : { type: "faces" | "ligne" | "texte" | "insert", calque, … }.
 */
function lireEntites(R, D) {
  const E = [];
  for (let i = 0; i < R.length; i++) {
    const e = R[i], calque = String(val(e, 8, "0"));
    switch (e.type) {
      case "3DFACE": E.push({ type: "faces", calque, tri: faces3d(e) }); break;
      case "MESH": E.push({ type: "faces", calque, tri: maillageMesh(e) }); break;
      case "LINE": E.push({ type: "ligne", calque, pts: [point(e), point(e, 1)], ferme: false }); break;
      case "LWPOLYLINE": E.push({ type: "ligne", calque, ...lwpolyligne(e) }); break;
      case "POLYLINE": {
        const sommets = [];
        while (i + 1 < R.length && R[i + 1].type === "VERTEX") sommets.push(R[++i]);
        if (R[i + 1]?.type === "SEQEND") i++;
        const r = polyligne(e, sommets);
        E.push(r.tri ? { type: "faces", calque, tri: r.tri } : { type: "ligne", calque, ...r.ligne });
        break;
      }
      case "TEXT": case "MTEXT": {
        const brut = e.type === "MTEXT" ? texteBrut(e.g.filter(p => p[0] === 3 || p[0] === 1).map(p => p[1]).join("")) : String(val(e, 1, "")).trim();
        // TEXT : point d'insertion dans le repère objet ; MTEXT : repère général
        const p = e.type === "TEXT" ? appliquer(matriceOcs(e), point(e)) : point(e);
        if (brut) E.push({ type: "texte", calque, p, texte: brut });
        break;
      }
      case "INSERT":
        E.push({ type: "insert", calque, bloc: String(val(e, 2, "")), p: point(e), echelle: [num(e, 41, 1), num(e, 42, 1), num(e, 43, 1)],
          rotation: num(e, 50), ocs: matriceOcs(e) });
        while (R[i + 1]?.type === "ATTRIB") i++;
        if (R[i + 1]?.type === "SEQEND") i++;
        break;
      case "VERTEX": case "SEQEND": case "ATTRIB": case "ENDBLK": break;
      default: compter(D, e.type);
    }
  }
  return E;
}

/** Matrice d'un INSERT : OCS ∘ translation ∘ rotation Z ∘ échelle ∘ (− point de base du bloc). */
function matriceInsert(ins, base) {
  const c = Math.cos(ins.rotation * Math.PI / 180), s = Math.sin(ins.rotation * Math.PI / 180), [sx, sy, sz] = ins.echelle;
  const local = [c * sx, -s * sy, 0, 0, s * sx, c * sy, 0, 0, 0, 0, sz, 0];
  local[3] = ins.p[0] - (local[0] * base[0] + local[1] * base[1]);
  local[7] = ins.p[1] - (local[4] * base[0] + local[5] * base[1]);
  local[11] = ins.p[2] - sz * base[2];
  return composer(ins.ocs, local);
}

/** Verse les entités dans les données, en développant les blocs (profondeur limitée). Calque « 0 » d'un bloc → calque de l'INSERT. */
function verser(E, D, blocs, M = IDENTITE, calqueParent = null, profondeur = 0) {
  for (const e of E) {
    const calque = e.calque === "0" && calqueParent ? calqueParent : e.calque;
    if (e.type === "faces") {
      if (M === IDENTITE) ajouterTriangles(D, calque, e.tri);
      else { const t = []; for (let k = 0; k < e.tri.length; k += 3) t.push(...appliquer(M, [e.tri[k], e.tri[k + 1], e.tri[k + 2]])); ajouterTriangles(D, calque, t); }
    } else if (e.type === "ligne") {
      if (e.pts.length >= 2) D.lignes.push({ calque, pts: e.pts.map(p => appliquer(M, p)), ferme: e.ferme });
    } else if (e.type === "texte") D.textes.push({ calque, p: appliquer(M, e.p), texte: e.texte });
    else if (e.type === "insert") {
      const b = blocs.get(e.bloc);
      if (!b || profondeur > 8) { compter(D, "INSERT?"); continue; }
      verser(b.entites, D, blocs, composer(M, matriceInsert(e, b.base)), calque, profondeur + 1);
    }
  }
}

/** Lit un DXF texte. Les DXF binaires ne sont pas pris en charge (erreur « import.dxfBinaire »). */
export function lireDxf(texte) {
  if (texte.startsWith("AutoCAD Binary DXF")) throw Object.assign(new Error("DXF binaire"), { cle: "import.dxfBinaire" });
  const R = enregistrements(texte), D = donneesVides(), blocs = new Map();
  let section = null, entites = [], blocCourant = null;
  for (let i = 0; i < R.length; i++) {
    const e = R[i];
    if (e.type === "SECTION") {
      section = String(val(e, 2, ""));
      // l'en-tête n'a pas de code 0 : ses variables (codes 9) sont dans l'enregistrement SECTION lui-même
      const k = e.g.findIndex(p => p[0] === 9 && p[1] === "$INSUNITS");
      if (section === "HEADER" && k >= 0) D.unites = INSUNITS[parseInt(e.g[k + 1]?.[1], 10)] || null;
      continue;
    }
    if (e.type === "ENDSEC") { section = null; continue; }
    if (section === "BLOCKS") {
      if (e.type === "BLOCK") blocCourant = { nom: String(val(e, 2, "")), base: point(e), brut: [] };
      else if (e.type === "ENDBLK") { if (blocCourant) blocs.set(blocCourant.nom, blocCourant); blocCourant = null; }
      else blocCourant?.brut.push(e);
    } else if (section === "ENTITIES") entites.push(e);
  }
  for (const b of blocs.values()) b.entites = lireEntites(b.brut, D);
  verser(lireEntites(entites, D), D, blocs);
  return D;
}

/* ------------------------------------------------------------------ OBJ */
/**
 * Lit un OBJ (v, f, l, o, g). Lecture maison plutôt que OBJLoader : les coordonnées restent en double précision
 * (MN95 complètes). Le calque est le nom de groupe (g) ou d'objet (o) courant. `axeHaut` : "z" (CAO, export du
 * site) ou "y" (convention Wavefront de la plupart des logiciels 3D) ; en "y", on passe à X, −Z, Y.
 */
export function lireObj(texte, axeHaut = "z") {
  const D = donneesVides(), v = [], yHaut = axeHaut === "y";
  let calque = "OBJ", tri = [];
  const vider = () => { ajouterTriangles(D, calque, tri); tri = []; };
  const sommet = s => { const i = parseInt(s, 10); return v[i < 0 ? v.length + i : i - 1]; };
  for (const brut of texte.split(/\r?\n/)) {
    const l = brut.trim();
    if (!l || l[0] === "#") continue;
    const m = l.split(/\s+/), cmd = m[0];
    if (cmd === "v") {
      const x = +m[1], y = +m[2], z = +m[3];
      v.push(yHaut ? [x, -z, y] : [x, y, z]);
    } else if (cmd === "f") {
      const ids = m.slice(1).map(sommet);
      if (ids.some(p => !p)) continue;
      for (let k = 1; k < ids.length - 1; k++) tri.push(...ids[0], ...ids[k], ...ids[k + 1]);
    } else if (cmd === "l") {
      const ids = m.slice(1).map(s => parseInt(s, 10));
      const ferme = ids.length > 3 && ids[0] === ids[ids.length - 1], pts = (ferme ? ids.slice(0, -1) : ids).map(i => v[i < 0 ? v.length + i : i - 1]).filter(Boolean);
      if (pts.length >= 2) D.lignes.push({ calque, pts, ferme });
    } else if (cmd === "o" || cmd === "g") { vider(); calque = m.slice(1).join(" ") || calque; }
  }
  vider();
  return D;
}

/** Indique si un OBJ vient de l'export du site (en-tête « Topograph » ou « Ombres »), donc en Z vers le haut. */
export const objDuSite = texte => /^#[^\n]*(Topograph|Ombres|E\d{7}|EPSG:2056)/m.test(texte.slice(0, 2000));

/* ------------------------------------------------------------------ assemblage de lignes */
/**
 * Assemble des segments en polylignes (lignes OBJ ou glTF découpées en segments) : bouts confondus à `tol` près.
 * `segments` : [[p, q], …] ; renvoie [{ pts, ferme }].
 */
export function chainer(segments, tol = 1e-6) {
  const cle = p => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)},${Math.round(p[2] / tol)}`, bouts = new Map(), libre = segments.map(() => true);
  segments.forEach(([p, q], s) => { for (const c of [cle(p), cle(q)]) { const l = bouts.get(c); if (l) l.push(s); else bouts.set(c, [s]); } });
  const suite = (p, chaine) => {
    for (;;) {
      const s = (bouts.get(cle(p)) || []).find(s => libre[s]);
      if (s == null) return;
      libre[s] = false;
      const [a, b] = segments[s];
      p = cle(a) === cle(p) ? b : a;
      chaine.push(p);
    }
  };
  const lignes = [];
  segments.forEach(([a, b], s) => {
    if (!libre[s]) return;
    libre[s] = false;
    const avant = [b], arriere = [a];
    suite(b, avant); suite(a, arriere);
    const pts = [...arriere.reverse(), ...avant], ferme = pts.length > 3 && cle(pts[0]) === cle(pts[pts.length - 1]);
    if (ferme) pts.pop();
    lignes.push({ pts, ferme });
  });
  return lignes;
}
