// DXF « parcelle de référence » à télécharger : on modélise son projet par-dessus dans son logiciel, puis on le
// réimporte (importer.js) et il tombe à sa place.
// Repère : origine locale du site, la même que l'export « origine locale » (export.js) : X = E − E0, Y = N − N0,
// Z = altitude − Z0, avec Z0 = arrondi de zRef, en mètres. Le nom du fichier porte E0, N0 et Z0, que l'import relit.
// Calques : PARCELLE (limite posée sur le terrain), VOISINS (contours des bâtiments voisins, si fournis), ORIGINE
// (axes de 5 m et texte des coordonnées), SECTIONS (vide : chaque ligne qu'on y dessine deviendra une coupe).
// Version R12 (AC1009), la plus largement lue, comme l'export du site.
import { t } from "./i18n.js";

const CALQUES = { PARCELLE: 1, VOISINS: 8, ORIGINE: 2, SECTIONS: 6 };
const nombre = v => { const r = Math.round(v * 1000) / 1000; return Number.isInteger(r) ? r + ".0" : String(r); };
const p3 = (x, y, z, k = 0) => `${10 + k}\n${nombre(x)}\n${20 + k}\n${nombre(y)}\n${30 + k}\n${nombre(z)}\n`;
// le DXF R12 n'a pas d'encodage sûr : textes sans accents
const ascii = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "?");

/** Anneau sans point de fermeture répété. */
const ouvert = a => (a.length > 1 && a[0][0] === a.at(-1)[0] && a[0][1] === a.at(-1)[1] ? a.slice(0, -1) : a);

/** Polyligne 3D fermée (POLYLINE flag 9), sommets posés sur le terrain (z relatif à Z0) si solEn est connu. */
function polyligne(calque, anneau, z) {
  let s = `0\nPOLYLINE\n8\n${calque}\n66\n1\n${p3(0, 0, 0)}70\n9\n`;
  for (const [x, y] of ouvert(anneau)) s += `0\nVERTEX\n8\n${calque}\n${p3(x, y, z(x, y))}70\n32\n`;
  return s + `0\nSEQEND\n8\n${calque}\n`;
}

const ligne = (calque, a, b) => `0\nLINE\n8\n${calque}\n${p3(...a)}${p3(...b, 1)}`;
const texte = (calque, [x, y, z], h, s) => `0\nTEXT\n8\n${calque}\n${p3(x, y, z)}40\n${nombre(h)}\n1\n${ascii(s)}\n`;

/**
 * Produit le DXF de référence.
 * @param {{ E0, N0, zRef, Z0?, parcelle: number[][][], solEn?: (x, y) => number, batiments?: number[][][], lieu? }} contexte
 *   parcelle et batiments : anneaux / polygones en coordonnées relatives [[x, y], …].
 * @returns {{ nom: string, texte: string, Z0: number }}
 */
export function dxfReference(contexte) {
  const { E0, N0, solEn } = contexte, Z0 = contexte.Z0 ?? Math.round(contexte.zRef);
  const z = (x, y) => { const v = solEn?.(x, y); return Number.isFinite(v) ? v - Z0 : 0; };
  const anneaux = (contexte.parcelle || []).filter(a => a.length >= 3), voisins = (contexte.batiments || []).filter(a => a.length >= 3);
  const origine = t("import.refOrigine", { E: E0, N: N0, Z: Z0 });
  const tete = [t("import.refTitre"), origine, t("import.refAide")].map(l => `999\n${ascii(l)}\n`).join("");
  const calques = Object.entries(CALQUES).map(([n, c]) => `0\nLAYER\n2\n${n}\n70\n0\n62\n${c}\n6\nCONTINUOUS\n`).join("");
  const morceaux = [
    tete,
    // $INSUNITS (6 = mètres) n'existe pas en R12 mais il est ignoré des lecteurs anciens et lu des récents
    `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSBASE\n${p3(0, 0, 0)}9\n$INSUNITS\n70\n6\n0\nENDSEC\n`,
    `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nENDTAB\n`,
    `0\nTABLE\n2\nLAYER\n70\n${Object.keys(CALQUES).length}\n${calques}0\nENDTAB\n0\nENDSEC\n`,
    `0\nSECTION\n2\nENTITIES\n`,
    ...anneaux.map(a => polyligne("PARCELLE", a, z)),
    ...voisins.map(a => polyligne("VOISINS", a, z)),
    // repère : axes X (est), Y (nord), Z (haut) de 5 m depuis l'origine, point et texte des coordonnées
    ligne("ORIGINE", [0, 0, 0], [5, 0, 0]), ligne("ORIGINE", [0, 0, 0], [0, 5, 0]), ligne("ORIGINE", [0, 0, 0], [0, 0, 5]),
    texte("ORIGINE", [5.3, -0.2, 0], 0.6, "X = E"), texte("ORIGINE", [-0.2, 5.3, 0], 0.6, "Y = N"),
    `0\nPOINT\n8\nORIGINE\n${p3(0, 0, 0)}`,
    texte("ORIGINE", [0.4, -1.2, 0], 0.8, origine),
    `0\nENDSEC\n0\nEOF\n`,
  ];
  const nom = `parcelle-reference_E${E0}_N${N0}_Z${Z0}.dxf`;
  return { nom, texte: morceaux.join(""), Z0 };
}
