// Banc de mesure des ponts reconstruits : jeu de ponts d'essai et dossiers.
// [e, n] : point du lien (le centre réel de la maquette est celui de la parcelle trouvée, comme dans l'application).
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SITES = {
  lutry: { e: 2542768, n: 1152290, rayons: [300], nom: "Lutry (pont courbe, pont coupé par le cercle ; rayon 725 pour l'anneau)" },
  lutrive: { e: 2542930, n: 1151793, rayons: [300], nom: "A9, viaducs de la Lutrive (tabliers jumeaux)" },
  schanzen: { e: 2683010, n: 1246960, rayons: [200], nom: "Zurich Schanzengraben (Dreikönigstrasse, Bleicherweg)" },
  quai: { e: 2683480, n: 1247300, rayons: [200], nom: "Zurich Münsterbrücke / Quaibrücke" },
  chauderon: { e: 2537560, n: 1152600, rayons: [200], nom: "Lausanne, pont Chauderon (arches)" },
  grandpont: { e: 2537960, n: 1152420, rayons: [200], nom: "Lausanne, Grand-Pont (modèle fait main)" },
  bessieres: { e: 2538450, n: 1152517, rayons: [200], nom: "Lausanne, pont Bessières (modèle fait main, au bord du cercle)" },
  chillon: { e: 2560997, n: 1140242, rayons: [300], nom: "Viaducs de Chillon (modèles faits main, coupés par le cercle)" },
  poya: { e: 2579061, n: 1184810, rayons: [300], nom: "Fribourg, pont de la Poya (haubané)" },
  perolles: { e: 2578347, n: 1181933, rayons: [300], nom: "Fribourg, pont de Pérolles (arches)" },
  courbe: { e: 2581250, n: 1201980, rayons: [300], nom: "Bretelle courbe et échangeur (A1, FR)" },
  passage: { e: 2511294, n: 1143864, rayons: [300], nom: "Passage supérieur d'autoroute (A1, VD)" },
  peney: { e: 2492408, n: 1116924, rayons: [300], nom: "Genève, pont de Peney (Rhône)" },
  montblanc: { e: 2500488, n: 1117902, rayons: [300], nom: "Genève, pont du Mont-Blanc (Rhône large, passerelles)" },
  butin: { e: 2497508, n: 1117572, rayons: [300], nom: "Genève, pont Butin (arches sur le Rhône)" },
};
const ICI = dirname(fileURLToPath(import.meta.url));
export const PROJET = join(ICI, "..", "..", "..");
/** Dossier de travail (nuages en cache, mesures, captures) : variable BANC_PONTS, sinon le dossier temporaire. */
export const SORTIE = process.env.BANC_PONTS || join(tmpdir(), "ombres-ponts-banc");
export const CACHE = process.env.BANC_CACHE || join(SORTIE, "cache");
export const MESURES = join(SORTIE, "mesures");
export const CAPTURES = join(SORTIE, "captures") + "/";
/** Mesures et zones de référence gardées avec le projet (version « avant » : commit ff2efd5). */
export const REFERENCE = join(ICI, "reference");
