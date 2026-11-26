// Placement d'un modèle importé sur le site, sans three.js ni DOM (utilisable dans node).
// Entrée : données lues (voir lecture.js), contexte { E0, N0, zRef, Z0?, parcelle, solEn }, options.
// Sortie : une fonction (x, y, z du fichier) → [x relatif est, y relatif nord, altitude absolue], le placement, les
// coupes et les avertissements ({ cle, p }, traduits par importer.js).
//
// Repères :
//   - « mn95 » : coordonnées MN95 complètes (ou MN03 à 6 chiffres, converties approximativement) ; on retranche (E0, N0).
//   - « origine » : origine locale du site, comme l'export « origine locale » et le DXF de référence : x = E − E0,
//     y = N − N0, z = altitude − Z0, avec Z0 = arrondi de zRef (export.js). Si le nom du fichier ou ses métadonnées
//     glTF portent une autre origine (E…_N…_Z…), on en tient compte.
//   - « parcelle » : la limite de parcelle dessinée dans le fichier est superposée au cadastre (recalage.js).
// Altitude (option `altitude`, "auto" par défaut) :
//   - mn95 : altitudes du fichier gardées (absolues) si elles sont plausibles par rapport au terrain ;
//   - origine, ou parcelle dont le recalage est l'identité (le fichier est dans le repère du DXF de référence) :
//     z + Z0, si plausible ;
//   - sinon (repère quelconque, ou altitude invraisemblable) : le bas du modèle est posé sur le point le plus bas
//     du terrain sous son emprise (on ne connaît pas l'altitude du ±0.00). Les poignées permettent d'ajuster.
//   "fichier" force la lecture des altitudes, "terrain" force la pose, un nombre donne l'altitude absolue du z = 0.
import { nettoyer, aire, compacite, apparier, transformer, ecarts } from "./recalage.js";

export const UNITES = { m: 1, dm: 0.1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 };
// noms de calques reconnus (comparés sans accents, en minuscules, par inclusion)
const MOTS_PARCELLE = ["parcel", "parzell", "particell", "limite", "grundstueck", "grundstuck"];
const MOTS_SECTIONS = ["section", "coupe", "schnitt", "sezion"];
// calques de référence du site (export, DXF de référence), jamais ajoutés comme bâtiment. Les faces des calques
// « parcelle » ou « sections » restent dans le modèle (seules leurs lignes servent de repère).
const CALQUES_REFERENCE = ["terrain", "socle", "courbes", "arbres", "info", "origine", "voisins"];

export const normaliser = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const estParcelle = calque => MOTS_PARCELLE.some(m => normaliser(calque).includes(m));
export const estSections = calque => MOTS_SECTIONS.some(m => normaliser(calque).includes(m));
const estReference = calque => CALQUES_REFERENCE.includes(normaliser(calque));

const dansMn95 = (x, y) => x > 2.48e6 && x < 2.84e6 && y > 1.07e6 && y < 1.3e6;
const dansMn03 = (x, y) => x > 4.8e5 && x < 8.4e5 && y > 7e4 && y < 3e5;

/* ------------------------------------------------------------------ étendue et unités */
/** Boîte englobante des maillages (à défaut, des lignes) : { min, max } en unités du fichier. */
function boite(D) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const voir = (x, y, z) => { if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z; if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z; };
  for (const m of D.maillages) for (let k = 0; k < m.tri.length; k += 3) voir(m.tri[k], m.tri[k + 1], m.tri[k + 2]);
  if (min[0] === Infinity) for (const l of D.lignes) for (const p of l.pts) voir(p[0], p[1], p[2]);
  return min[0] === Infinity ? null : { min, max };
}

/**
 * Unité du fichier : imposée, déclarée ($INSUNITS) ou devinée d'après l'étendue horizontale (un bâtiment de
 * 20 000 unités est en mm, de 2 000 en cm). `sure` indique si elle vient d'ailleurs que de l'heuristique.
 */
export function unite(D, B, imposee) {
  if (imposee && imposee !== "auto") return { nom: imposee, f: UNITES[imposee], sure: true, source: "imposee" };
  if (D.unites) return { nom: D.unites, f: UNITES[D.unites], sure: true, source: "fichier" };
  const L = B ? Math.max(B.max[0] - B.min[0], B.max[1] - B.min[1]) : 0;
  const nom = L > 3000 ? "mm" : L > 400 ? "cm" : "m";
  return { nom, f: UNITES[nom], sure: false, source: "etendue" };
}

/** Coordonnées MN95 (ou MN03) complètes ? Essaie l'unité retenue puis m, mm, cm. Renvoie { f, nom, mn03 } ou null. */
function detecterMn95(B, u) {
  if (!B) return null;
  const cx = (B.min[0] + B.max[0]) / 2, cy = (B.min[1] + B.max[1]) / 2, L = Math.max(B.max[0] - B.min[0], B.max[1] - B.min[1]);
  const candidats = u.source === "imposee" ? [u.nom] : [...new Set([u.nom, "m", "mm", "cm"])];
  for (const nom of candidats) {
    const f = UNITES[nom];
    if (L * f > 5000) continue; // un modèle de plus de 5 km n'est pas un projet de parcelle
    if (dansMn95(cx * f, cy * f)) return { f, nom, mn03: false };
    if (dansMn03(cx * f, cy * f)) return { f, nom, mn03: true };
  }
  return null;
}

/** Origine portée par le fichier : métadonnées glTF de l'export, ou nom « …E2581234_N1150000_Z412… ». */
function origineFichier(D, nomFichier) {
  if (D.origine && Number.isFinite(D.origine.E)) return D.origine;
  const m = /E(\d{7}(?:\.\d+)?)_N(\d{7}(?:\.\d+)?)_Z(-?\d+(?:\.\d+)?)/.exec(nomFichier || "");
  return m ? { E: +m[1], N: +m[2], Z: +m[3] } : null;
}

/* ------------------------------------------------------------------ contour de parcelle */
/** Anneau extérieur du cadastre (le plus grand). */
function anneauCadastre(parcelle) {
  const anneaux = (parcelle || []).map(a => nettoyer(a)).filter(a => a.length >= 3);
  return anneaux.sort((u, v) => Math.abs(aire(v)) - Math.abs(aire(u)))[0] || null;
}

/** Polylignes fermées du fichier, en 2D et en mètres (unité u), avec leur altitude médiane. */
function contoursFermes(D, f) {
  return D.lignes.filter(l => l.ferme || (l.pts.length > 3 && Math.hypot(l.pts[0][0] - l.pts.at(-1)[0], l.pts[0][1] - l.pts.at(-1)[1]) < 1e-6))
    .map(l => {
      const pts = nettoyer(l.pts.map(p => [p[0] * f, p[1] * f])), zs = l.pts.map(p => p[2] * f).sort((a, b) => a - b);
      return { calque: l.calque, pts, z: zs[zs.length >> 1] };
    })
    .filter(c => c.pts.length >= 3 && Math.abs(aire(c.pts)) > 1e-9);
}

/**
 * Cherche la limite de parcelle dans le fichier et la superpose au cadastre. D'abord les calques nommés « parcelle »
 * (et variantes), puis, à défaut d'un bon résultat, toutes les polylignes fermées dont la forme (compacité) ressemble
 * à celle du cadastre. L'échelle est d'abord libre, puis arrondie à un rapport d'unités ou fixée à 1.
 */
function chercherParcelle(D, cadastre, u, echelleImposee) {
  const contours = contoursFermes(D, u.f), kc = compacite(cadastre), taille = Math.sqrt(Math.abs(aire(cadastre)));
  const essayer = liste => {
    let meilleur = null;
    for (const c of liste) {
      const r = apparier(c.pts, cadastre, null);
      if (!meilleur || r.ecartMoyen < meilleur.r.ecartMoyen) meilleur = { c, r };
    }
    return meilleur;
  };
  const acceptable = m => m && m.r.ecartMoyen < Math.max(0.5, 0.05 * taille);
  let m = essayer(contours.filter(c => estParcelle(c.calque)));
  if (!acceptable(m)) {
    const proches = contours.filter(c => !estParcelle(c.calque) && Math.abs(Math.log(compacite(c.pts) / kc)) < 0.25)
      .sort((p, q) => Math.abs(Math.log(compacite(p.pts) / kc)) - Math.abs(Math.log(compacite(q.pts) / kc))).slice(0, 15);
    const m2 = essayer(proches);
    if (m2 && (!m || m2.r.ecartMoyen < m.r.ecartMoyen)) m = m2;
  }
  if (!acceptable(m)) return null;
  return { contour: m.c, ...echelleFinale(m, cadastre, u, echelleImposee) };
}

// rapports d'unités plausibles entre ce qu'on a supposé et ce qu'est le fichier
const RAPPORTS = [10, 100, 1000, 0.1, 0.01, 0.001, 0.0254, 1 / 0.0254, 0.254, 2.54, 1 / 2.54, 0.3048, 1 / 0.3048, 0.03048, 30.48, 304.8, 1 / 304.8, 12, 1 / 12];

/** Fixe l'échelle : 1 si l'ajustement libre la confirme, un rapport d'unités si elle en est proche, sinon libre (unités incertaines). */
function echelleFinale(m, cadastre, u, echelleImposee) {
  const s = m.r.echelle, av = [];
  let echelle = 1, nomUnite = u.nom;
  if (Math.abs(s - 1) < 0.003) echelle = 1;
  else if (u.source === "imposee" || echelleImposee) av.push({ cle: "import.echelleContour", p: { pct: ((s - 1) * 100).toFixed(1) } });
  else {
    const r = RAPPORTS.find(r => Math.abs(s / r - 1) < 0.01);
    if (r) {
      echelle = r;
      const f = u.f * r, nom = Object.keys(UNITES).find(k => Math.abs(UNITES[k] / f - 1) < 0.01);
      nomUnite = nom || nomUnite;
      av.push({ cle: "import.uniteCorrigee", p: { unite: nomUnite } });
    } else if (!u.sure) { echelle = null; av.push({ cle: "import.echelleLibre", p: { s: s.toFixed(4) } }); }
    else av.push({ cle: "import.echelleContour", p: { pct: ((s - 1) * 100).toFixed(1) } });
  }
  const r = echelle == null ? m.r : apparier(m.c.pts, cadastre, echelle);
  return { r, uniteNom: nomUnite, avertissements: av };
}

/* ------------------------------------------------------------------ altitude */
/** Échantillon (au plus `n`) des sommets du modèle, en mètres du fichier. */
function sommetsEchantillon(D, f, n = 6000) {
  let total = 0;
  for (const m of D.maillages) total += m.tri.length / 3;
  const pas = Math.max(1, Math.floor(total / n)), r = [];
  let i = 0;
  for (const m of D.maillages) for (let k = 0; k < m.tri.length; k += 3, i++) if (i % pas === 0) r.push([m.tri[k] * f, m.tri[k + 1] * f, m.tri[k + 2] * f]);
  return r;
}

/** Terrain (absolu) sous l'emprise : minimum et maximum de solEn aux sommets placés. */
function terrainEmprise(pts, plan, solEn) {
  let min = Infinity, max = -Infinity;
  for (const p of pts) { const [x, y] = plan(p); const z = solEn(x, y); if (Number.isFinite(z)) { if (z < min) min = z; if (z > max) max = z; } }
  return min === Infinity ? null : { min, max };
}

/**
 * Décale les altitudes : renvoie { dz, mode } avec altitude = s·z + dz. `zFichier` : dz si l'on garde les altitudes du
 * fichier (null si inconnu). Garde le fichier si le bas du modèle tombe entre 25 m sous le terrain et 10 m au-dessus.
 */
function altitude(opt, zFichier, pts, plan, s, solEn, av) {
  const zmin = Math.min(...pts.map(p => p[2] * s)), T = solEn ? terrainEmprise(pts, plan, solEn) : null;
  if (typeof opt === "number") return { dz: opt, mode: "donnee" };
  if (opt === "fichier" && zFichier != null) return { dz: zFichier, mode: "fichier" };
  if (opt !== "terrain" && zFichier != null) {
    const bas = zmin + zFichier;
    if (!T || (bas > T.min - 25 && bas < T.max + 10)) return { dz: zFichier, mode: "fichier" };
    av.push({ cle: "import.altitudeInvraisemblable", p: { bas: bas.toFixed(1), terrain: T.min.toFixed(1) } });
  }
  if (!T) { av.push({ cle: "import.sansTerrain" }); return { dz: zFichier ?? 0, mode: "fichier" }; }
  return { dz: T.min - zmin, mode: "terrain" };
}

/* ------------------------------------------------------------------ coupes */
/** Lettres par défaut : A–B, C–D…, puis A1–B1… */
const lettres = k => { const i = k % 13, tour = Math.floor(k / 13), n = tour ? String(tour) : ""; return `${String.fromCharCode(65 + 2 * i)}${n}–${String.fromCharCode(66 + 2 * i)}${n}`; };

/**
 * Coupes du calque « sections » : chaque ligne à deux points devient { A, B, nom } en coordonnées relatives. Le nom
 * vient du texte le plus proche du début de la ligne (rayon max(2 m, ¼ de la longueur)), sinon des lettres.
 */
function coupes(D, f, plan2d, av) {
  const textes = D.textes.map(t => ({ ...t, x: t.p[0] * f, y: t.p[1] * f, sec: estSections(t.calque) })), r = [];
  let ignorees = 0;
  for (const l of D.lignes) {
    if (!estSections(l.calque)) continue;
    if (l.pts.length !== 2 || l.ferme) { ignorees++; continue; }
    const a = [l.pts[0][0] * f, l.pts[0][1] * f], b = [l.pts[1][0] * f, l.pts[1][1] * f], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const rayon = Math.max(2, L / 4);
    // textes du calque des coupes d'abord, puis tous les autres
    const proche = [...textes].map(t => ({ t, d: Math.hypot(t.x - a[0], t.y - a[1]) })).filter(o => o.d <= rayon)
      .sort((u, v) => (v.t.sec - u.t.sec) || (u.d - v.d))[0];
    r.push({ A: plan2d(a), B: plan2d(b), nom: proche?.t.texte || lettres(r.length) });
  }
  if (ignorees) av.push({ cle: "import.coupesIgnorees", p: { n: ignorees } });
  return r;
}

/* ------------------------------------------------------------------ placement complet */
/**
 * Calcule le placement. `options` = { unite: "auto"|"m"|"cm"|"mm", altitude: "auto"|"fichier"|"terrain"|nombre,
 * placement: "auto"|"mn95"|"origine"|"parcelle", nomFichier }.
 * @returns {{ versSite: (x, y, z) => [x, y, alt], placement, coupes, avertissements, calquesModele: string[] }}
 */
export function placer(D, contexte, options = {}) {
  const av = [...D.avertissements], B = boite(D);
  if (!B) throw Object.assign(new Error("vide"), { cle: "import.vide" });
  const { E0, N0 } = contexte, Z0 = contexte.Z0 ?? Math.round(contexte.zRef), solEn = contexte.solEn || null;
  let u = unite(D, B, options.unite);
  const voulu = options.placement || "auto", cadastre = anneauCadastre(contexte.parcelle);
  // 1. MN95 complètes ?
  const mn = voulu === "auto" || voulu === "mn95" ? detecterMn95(B, u) : null;
  if (mn && mn.nom !== u.nom) u = { nom: mn.nom, f: mn.f, sure: true, source: "mn95" };
  // 2. limite de parcelle dans le fichier (aussi pour corriger une position MN03 approchée)
  const P = cadastre && (voulu === "parcelle" || (voulu === "auto" && (!mn || mn.mn03))) ? chercherParcelle(D, cadastre, u, false) : null;
  let T, methode, echelle = 1, ecart = null, zFichier = null;
  if (P) {
    methode = "parcelle"; T = P.r.T; echelle = Math.hypot(T.a, T.b); u = { ...u, nom: P.uniteNom };
    ecart = { moyen: P.r.ecartMoyen, max: P.r.ecartMax };
    av.push(...P.avertissements);
    if (P.r.ambigu) av.push({ cle: "import.ambigu" });
    // recalage ≈ identité : le fichier est dans le repère du DXF de référence, ses altitudes sont relatives à Z0
    const identite = Math.abs(P.r.rotation) < 0.2 && Math.hypot(T.tx, T.ty) < 0.5 && Math.abs(echelle - 1) < 0.005;
    if (identite) zFichier = Z0;
  } else if (mn) {
    methode = "mn95";
    const dE = mn.mn03 ? 2e6 : 0, dN = mn.mn03 ? 1e6 : 0;
    T = { a: 1, b: 0, tx: dE - E0, ty: dN - N0 };
    if (mn.mn03) av.push({ cle: "import.mn03" });
    zFichier = 0;
  } else {
    methode = "origine";
    const O = origineFichier(D, options.nomFichier);
    T = { a: 1, b: 0, tx: O ? O.E - E0 : 0, ty: O ? O.N - N0 : 0 };
    zFichier = O ? O.Z : Z0;
    if (voulu === "parcelle") av.push({ cle: "import.parcelleIntrouvable" });
    else if (!O) av.push({ cle: "import.origineSupposee", p: { E: E0, N: N0, Z: Z0 } });
  }
  if (!P && cadastre) { // écart de contrôle si le fichier contient quand même un contour de parcelle
    const c = contoursFermes(D, u.f).find(c => estParcelle(c.calque));
    if (c) { const e = ecarts(c.pts.map(p => transformer(T, p)), cadastre); ecart = { moyen: e.moyen, max: e.max }; }
  }
  if (ecart && ecart.max > 0.5) av.push({ cle: "import.ecartGrand", p: { cm: Math.round(ecart.max * 100) } });
  if (!u.sure && methode !== "parcelle") av.push({ cle: "import.uniteDevinee", p: { unite: u.nom } });
  const f = u.f, s = echelle; // T contient déjà l'échelle de recalage (en plus de l'unité f)
  const calquesModele = D.maillages.map(m => m.calque).filter(c => !estReference(c));
  if (!calquesModele.length) throw Object.assign(new Error("aucune face"), { cle: "import.aucuneFace" });
  const plan2d = p => transformer(T, p), pts = sommetsEchantillon({ maillages: D.maillages.filter(m => calquesModele.includes(m.calque)) }, f);
  const alt = altitude(options.altitude ?? "auto", zFichier, pts, plan2d, s, solEn, av);
  if (alt.mode === "terrain") av.push({ cle: "import.poseTerrain" });
  const versSite = (x, y, z) => { const [X, Y] = transformer(T, [x * f, y * f]); return [X, Y, z * f * s + alt.dz]; };
  // centre du modèle placé : loin du site ?
  const c = versSite((B.min[0] + B.max[0]) / 2, (B.min[1] + B.max[1]) / 2, 0);
  if (Math.hypot(c[0], c[1]) > 1000) av.push({ cle: "import.loin", p: { km: (Math.hypot(c[0], c[1]) / 1000).toFixed(1) } });
  const ignores = D.maillages.map(m => m.calque).filter(c => !calquesModele.includes(c));
  if (ignores.length) av.push({ cle: "import.calquesIgnores", p: { calques: ignores.join(", ") } });
  return {
    versSite, calquesModele,
    coupes: coupes(D, f, plan2d, av),
    placement: { methode, ecartMoyen: ecart?.moyen ?? null, ecartMax: ecart?.max ?? null, echelle: s, unite: u.nom,
      rotation: Math.atan2(T.b, T.a) * 180 / Math.PI, translation: [T.tx, T.ty], altitude: alt.mode, Z0 },
    avertissements: av,
  };
}
