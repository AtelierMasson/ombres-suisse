// Production photovoltaïque d'un champ de modules (orientation, inclinaison, ombres réelles) et économie d'une
// installation en Suisse. Module commun : toits (solaireToits.js) et, au besoin, chauffage solaire de piscine (PV + PAC).
// Sans three.js ni DOM : testable dans Node. Méthode, chiffres et sources : docs/solaire-toits-methode.md.
//
// Rayonnement : séries horaires MétéoSuisse (climat.js : global G et diffus D horizontaux, température T) ou, à défaut,
// une année type reconstruite à partir des moyennes mensuelles 2020–2025 de 12 stations SwissMetNet (NORMALES).
// Transposition sur le plan des modules : Hay–Davies (direct + circumsolaire, diffus isotrope réduit par la vue du ciel
// réelle, réfléchi par le sol) ; le direct et le circumsolaire sont multipliés par la part du champ au soleil (ombres de
// la maquette : bâtiments, arbres, relief proche et lointain). Pertes : réflexion (ASHRAE, b0 = 0,05), température des
// cellules (Faiman simplifié, −0,35 %/K), puis 14 % de pertes système (valeur par défaut de PVGIS).
import { positionSoleil } from "./soleil.js";

const RAD = Math.PI / 180, JOUR = 86400000;

/** Module type (2025–2026) : monocristallin, 108 demi-cellules, ~1,72 × 1,13 m, 420 Wc (rendement ~21,5 %). */
export const MODULE = { L: 1.722, l: 1.134, Wc: 420 };

export const DEFAUTS_PV = {
  pertes: 0.14,     // pertes système (onduleur, câbles, salissure, disparités), PVGIS par défaut
  gamma: -0.0035,   // coefficient de puissance en température (/K)
  kT: 0.03,         // échauffement des cellules (K par W/m²) : modules posés sur toit, peu ventilés
  albedo: 0.2,
  b0: 0.05,         // modificateur d'angle d'incidence (ASHRAE)
};

/* ------------------------------------------------------------------ géométrie solaire */

/**
 * Position du soleil au milieu de chaque heure UTC d'une année type (365 × 24, indice jour × 24 + heure).
 * @returns {{ hauteur: Float32Array, azimut: Float32Array }} degrés ; azimut depuis le nord, sens horaire.
 */
export function positionsHoraires(lat, lon, an = 2025) {
  const hauteur = new Float32Array(365 * 24), azimut = new Float32Array(365 * 24);
  for (let k = 0; k < 365 * 24; k++) {
    const p = positionSoleil(new Date(Date.UTC(an, 0, 1) + k * 3600000 + 1800000), lat, lon);
    hauteur[k] = p.hauteur; azimut[k] = p.azimut;
  }
  return { hauteur, azimut };
}

/** Cosinus de l'angle d'incidence du soleil (hauteur h, azimut a, degrés) sur un plan (inclinaison b, azimut c). */
export function cosIncidence(h, a, b, c) {
  return Math.sin(h * RAD) * Math.cos(b * RAD) + Math.cos(h * RAD) * Math.sin(b * RAD) * Math.cos((a - c) * RAD);
}

/**
 * Facteur de vue du ciel d'un plan incliné, ombres comprises : part du rayonnement diffus isotrope reçue,
 * rapportée à celle d'un plan horizontal dégagé. Sans masque, vaut (1 + cos b) / 2.
 * @param m masques en degrés (N × nbAz, voir semaines.js masquesDegres) ; null = dégagé
 */
export function vueCielInclinee(m, N, b, c, nbAz = 720) {
  if (!m || !N) return (1 + Math.cos(b * RAD)) / 2;
  const pasAz = 8, pasH = 2; // 1/8 des azimuts (4°), hauteurs de 2°
  let s = 0, t = 0;
  const nb = Math.ceil(nbAz / pasAz);
  for (let q = 0; q < N; q++) for (let a = 0; a < nbAz; a += pasAz) {
    const az = a * 360 / nbAz, mq = m[q * nbAz + a];
    for (let h = pasH / 2; h < 90; h += pasH) {
      const ci = cosIncidence(h, az, b, c);
      if (ci <= 0) continue;
      const w = ci * Math.cos(h * RAD);
      if (h > mq) s += w;
    }
  }
  // normalisation : plan horizontal dégagé, Σ sin h cos h sur la même grille
  for (let h = pasH / 2; h < 90; h += pasH) t += Math.sin(h * RAD) * Math.cos(h * RAD);
  return s / (N * nb * t);
}

/**
 * Part du rayonnement direct (ciel clair, pondéré par l'incidence) que reçoit chaque point d'un plan, ombres comprises :
 * 1 = jamais à l'ombre quand le soleil compte. Sert aux cartes de chaleur (le climat agit comme un facteur commun).
 * @param m masques en degrés (N × nbAz) ; @param pos positionsHoraires
 */
export function partDirecte(m, N, pos, b, c, nbAz = 720) {
  const r = new Float32Array(N);
  let total = 0;
  for (let k = 0; k < pos.hauteur.length; k++) {
    const h = pos.hauteur[k];
    if (h <= 0.5) continue;
    const ci = cosIncidence(h, pos.azimut[k], b, c);
    if (ci <= 0) continue;
    const w = ci * 1353 * Math.pow(0.7, Math.pow(1 / Math.sin(h * RAD), 0.678)), a = Math.round(pos.azimut[k] * nbAz / 360) % nbAz; // Meinel
    total += w;
    for (let q = 0; q < N; q++) if (h > m[q * nbAz + a]) r[q] += w;
  }
  for (let q = 0; q < N; q++) r[q] = total ? r[q] / total : 0;
  return r;
}

/* ------------------------------------------------------------------ climat de repli */

/**
 * Moyennes mensuelles 2020–2025 calculées à partir des données horaires SwissMetNet (Source : MétéoSuisse, CC BY) :
 * G = global horizontal (kWh/m² par mois), fd = part diffuse (null : station sans mesure du diffus), T = air (°C).
 * Script : outils/solaire/normales.mjs.
 */
export const NORMALES = [
  { abr: "BAS", nom: "Basel / Binningen", E: 2610909, N: 1265612, alt: 316, G: [33.5, 53.6, 102.4, 140.4, 165.7, 185.1, 190.5, 161.2, 116.4, 69.6, 36.7, 25.6], fd: [0.64, 0.56, 0.47, 0.44, 0.43, 0.42, 0.41, 0.4, 0.41, 0.54, 0.63, 0.69], T: [3.1, 6, 8, 10.9, 14.8, 19.9, 20.8, 20.9, 16.7, 12.3, 6.5, 3.9] },
  { abr: "BER", nom: "Bern / Zollikofen", E: 2601934, N: 1204410, alt: 553, G: [38.9, 59.8, 108.1, 150.3, 171.5, 193.5, 196.8, 170.7, 121.1, 75, 38.4, 25.8], fd: null, T: [1.4, 4.1, 6.2, 9.2, 13.4, 18.6, 19.7, 19.5, 15.3, 10.7, 4.9, 2] },
  { abr: "CHU", nom: "Chur", E: 2759485, N: 1193176, alt: 556, G: [46.7, 70.1, 115.6, 154.6, 172.2, 183.8, 181.7, 160.5, 119.7, 81.4, 51.2, 37.3], fd: [0.5, 0.46, 0.43, 0.42, 0.47, 0.41, 0.4, 0.38, 0.39, 0.46, 0.47, 0.53], T: [1.9, 5, 7.5, 10.8, 14.5, 19.4, 20, 20.1, 16.1, 12.2, 6, 2.8] },
  { abr: "DAV", nom: "Davos", E: 2783519, N: 1187459, alt: 1594, G: [51.7, 77.1, 127, 162.3, 167.4, 177.6, 177.5, 159.7, 121.8, 85.1, 55.5, 40.8], fd: null, T: [-4, -1.5, 0.3, 3.6, 7.6, 12.7, 13.6, 13.6, 9.9, 6.1, 0.3, -2.5] },
  { abr: "GVE", nom: "Genève / Cointrin", E: 2498904, N: 1122632, alt: 411, G: [35.3, 63.8, 111.8, 151.1, 181.2, 195.3, 207.4, 176.3, 123.7, 73.8, 38.7, 24.4], fd: [0.52, 0.43, 0.41, 0.37, 0.37, 0.34, 0.29, 0.3, 0.34, 0.46, 0.58, 0.67], T: [3.2, 5.4, 7.7, 10.8, 15, 20.1, 21.7, 21.4, 16.7, 12.2, 6.8, 3.9] },
  { abr: "LUG", nom: "Lugano", E: 2717874, N: 1095883, alt: 273, G: [50, 69.7, 111.6, 149, 173.4, 191, 203.8, 181, 122.3, 79, 54.8, 37.7], fd: null, T: [4.9, 7.2, 9.4, 12.6, 16.7, 21.5, 23.5, 23.3, 18.7, 14.1, 8.9, 5.8] },
  { abr: "LUZ", nom: "Luzern", E: 2665545, N: 1209850, alt: 454, G: [33.4, 54.4, 97.9, 137.4, 149.8, 175.9, 174.9, 152.9, 108.6, 66.8, 35.3, 23.1], fd: null, T: [2, 4.7, 7, 10.3, 14.1, 19.3, 20, 19.9, 15.9, 11.3, 5.7, 2.6] },
  { abr: "NEU", nom: "Neuchâtel", E: 2563087, N: 1205560, alt: 485, G: [34.1, 57.1, 107.1, 145.3, 170.8, 185.8, 192, 164.3, 117.2, 69.4, 33.3, 21.1], fd: null, T: [2.9, 5.2, 7.5, 10.6, 14.5, 19.7, 20.9, 20.9, 16.5, 11.8, 6.4, 3.6] },
  { abr: "PUY", nom: "Pully", E: 2540819, N: 1151511, alt: 456, G: [39.4, 64.1, 111.7, 148.9, 177.5, 189.3, 198.9, 171.6, 120.1, 74.4, 42.9, 26.9], fd: [0.53, 0.45, 0.42, 0.38, 0.38, 0.36, 0.32, 0.32, 0.36, 0.48, 0.54, 0.66], T: [3.6, 5.9, 8, 10.9, 15, 20, 21.5, 21.4, 17.1, 12.8, 7.5, 4.4] },
  { abr: "SIO", nom: "Sion", E: 2591633, N: 1118584, alt: 482, G: [42.4, 71.3, 124.9, 164.7, 192.1, 199.2, 213, 184.2, 131.9, 87, 47.5, 32.3], fd: null, T: [1, 5, 8, 11.5, 15.5, 20.4, 21.5, 21, 16.6, 11.6, 5.1, 1.7] },
  { abr: "SMA", nom: "Zürich / Fluntern", E: 2685223, N: 1248410, alt: 604, G: [34.1, 54.4, 100.7, 142.8, 160.4, 182.6, 180.8, 158.2, 113.2, 67.4, 34.7, 22.2], fd: null, T: [2, 4.6, 6.9, 9.9, 13.6, 18.8, 19.7, 19.7, 15.7, 11.1, 5.5, 2.5] },
  { abr: "STG", nom: "St. Gallen", E: 2747866, N: 1254588, alt: 776, G: [34.7, 52.4, 98, 143.3, 155.8, 182, 172.8, 151.6, 110, 65.7, 35.2, 24.7], fd: null, T: [1.4, 3.9, 5.7, 8.4, 12.1, 17.4, 18.1, 18.1, 14.3, 10.5, 4.7, 2.1] },
];
// part diffuse moyenne des quatre stations qui la mesurent, pour les autres
const FD_MOY = Array.from({ length: 12 }, (_, m) => {
  const l = NORMALES.filter(s => s.fd).map(s => s.fd[m]);
  return l.reduce((a, b) => a + b, 0) / l.length;
});

/** Station de référence la plus proche (distance + 100 m de dénivelé comptés comme 10 km), comme climat.js. */
export function normaleProche(E, N, alt) {
  return NORMALES.map(s => ({ ...s, km: Math.hypot(s.E - E, s.N - N) / 1000, denivele: s.alt - alt }))
    .map(s => ({ ...s, score: s.km + Math.abs(s.denivele) / 10 })).sort((a, b) => a.score - b.score)[0];
}

/**
 * Année type horaire (même forme que climat.js seriesStation) reconstruite à partir des moyennes mensuelles :
 * global = profil de ciel clair (Haurwitz) mis à l'échelle du total du mois, part diffuse du mois, température
 * moyenne du mois ± 4 °C sur la journée (minimum à 5 h, maximum à 15 h, heure solaire).
 * @returns Map(2025 → { debut, n, G, D, T })
 */
export function anneeType(st, pos, correctionT = 0) {
  const n = 8760, G = new Float32Array(n), D = new Float32Array(n), T = new Float32Array(n), debut = Date.UTC(2025, 0, 1);
  const cs = new Float64Array(n), somme = new Float64Array(12);
  const mois = k => new Date(debut + k * 3600000).getUTCMonth();
  for (let k = 0; k < n; k++) {
    const s = Math.sin(Math.max(0, pos.hauteur[k]) * RAD);
    cs[k] = s > 0.01 ? 1098 * s * Math.exp(-0.057 / s) : 0;
    somme[mois(k)] += cs[k];
  }
  const fd = st.fd || FD_MOY;
  for (let k = 0; k < n; k++) {
    const m = mois(k), h = (k % 24 + 0.5 + 0.5) % 24; // ~ heure solaire en Suisse (UTC + 0,5 h)
    G[k] = somme[m] ? cs[k] * st.G[m] * 1000 / somme[m] : 0;
    D[k] = G[k] * fd[m];
    T[k] = st.T[m] + correctionT + 4 * Math.sin((h - 9) / 24 * 2 * Math.PI);
  }
  return new Map([[2025, { debut, n, G, D, T }]]);
}

/* ------------------------------------------------------------------ production */

/**
 * Production horaire d'un kWc sur une année météo `A` (kWh par kWc et par heure), pour un champ :
 * { inclinaison, azimut (degrés, azimut vers lequel les modules regardent), f (Float32 365×24 : part du champ au soleil,
 * ou null = dégagé), vue (vue du ciel inclinée, vueCielInclinee ; défaut (1 + cos b)/2) }.
 * @param pos positionsHoraires ; @param o DEFAUTS_PV (+ correctionT, °C)
 * @returns {{ e: Float32Array (kWh/kWc par heure), poa: Float64 (kWh/m², plan des modules, ombres comprises),
 *   poaLibre: Float64 (sans ombre), directLibre, diffus }}
 */
export function productionAnnee(A, champ, pos, o = {}) {
  o = { ...DEFAUTS_PV, ...o };
  const b = champ.inclinaison, c = champ.azimut, cb = Math.cos(b * RAD), vue = champ.vue ?? (1 + cb) / 2, f = champ.f;
  const e = new Float32Array(A.n);
  let poa = 0, poaLibre = 0, directLibre = 0, diffus = 0;
  for (let h = 0; h < A.n; h++) {
    const G = A.G[h] || 0;
    if (G <= 0) continue;
    const k = indiceType(A.debut + h * 3600000), hs = pos.hauteur[k], sinh = Math.sin(Math.max(0, hs) * RAD);
    let D = A.D?.[h];
    if (!(D >= 0)) { // séparation d'Erbs
      const I0 = 1367 * sinh, kt = I0 > 10 ? Math.min(1, G / I0) : 1;
      D = G * (kt <= 0.22 ? 1 - 0.09 * kt : kt <= 0.8 ? 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4 : 0.165);
    }
    D = Math.min(D, G);
    let B = G - D, dni = 0;
    if (hs > 2) dni = Math.min(1100, B / Math.max(0.087, sinh)); else { D = G; B = 0; }
    const ci = hs > 0 ? cosIncidence(hs, pos.azimut[k], b, c) : 0, fs = f ? f[k] : 1;
    const Ai = Math.min(1, dni / 1367), iam = ci > 0 ? Math.max(0, 1 - o.b0 * (1 / Math.max(ci, 0.05) - 1)) : 0;
    const direct = ci > 0 ? dni * ci : 0;
    const circum = ci > 0 && sinh > 0.087 ? D * Ai * ci / sinh : 0;
    const iso = D * (1 - Ai) * vue; // diffus isotrope (vue du ciel du plan incliné, ombres comprises)
    const sol = G * o.albedo * (1 - cb) / 2;
    const libre = direct + circum + iso + sol, recu = (direct + circum) * fs + iso + sol;
    poa += recu; poaLibre += libre; directLibre += direct + circum; diffus += iso + sol;
    const eff = ((direct + circum) * fs * iam + iso * 0.95 + sol * 0.95); // diffus : IAM moyen ~0,95
    const Tc = (A.T?.[h] ?? 15) + (o.correctionT || 0) + o.kT * recu;
    e[h] = Math.max(0, eff / 1000 * (1 + o.gamma * (Tc - 25)) * (1 - o.pertes));
  }
  return { e, poa: poa / 1000, poaLibre: poaLibre / 1000, directLibre: directLibre / 1000, diffus: diffus / 1000 };
}

/**
 * Production de plusieurs champs sur toutes les années d'une série : par mois et par an (médiane, P10, P90),
 * production horaire de l'année médiane (pour l'autoconsommation), irradiation du plan par champ.
 * @param champs [{ kWc, inclinaison, azimut, f, vue }]
 * @returns {{ annees, kWh: {med,p10,p90}, mois: [{ m, med, p10, p90 }], horaire: Float32Array (8760, année médiane),
 *   champs: [{ kWh, specifique (kWh/kWc), poa, poaLibre, directLibre, diffus }] }}
 */
export function productionPV(series, champs, pos, o = {}) {
  const annees = [...series.keys()].sort(), parAn = [], parMois = Array.from({ length: 12 }, () => []), horaires = [];
  const parChamp = champs.map(() => ({ kWh: 0, poa: 0, poaLibre: 0, directLibre: 0, diffus: 0 }));
  for (const an of annees) {
    const A = series.get(an), tot = new Float32Array(8760), mois = new Float64Array(12);
    champs.forEach((ch, i) => {
      const r = productionAnnee(A, ch, pos, o), P = parChamp[i];
      P.poa += r.poa; P.poaLibre += r.poaLibre; P.directLibre += r.directLibre; P.diffus += r.diffus;
      for (let h = 0; h < A.n; h++) {
        const v = r.e[h] * ch.kWc;
        if (!v) continue;
        P.kWh += v;
        mois[new Date(A.debut + h * 3600000).getUTCMonth()] += v;
        tot[indiceType(A.debut + h * 3600000)] += v;
      }
    });
    parAn.push(mois.reduce((a, b) => a + b, 0));
    mois.forEach((v, m) => parMois[m].push(v));
    horaires.push(tot);
  }
  const na = annees.length, q = l => ({ med: quantile(l, 0.5), p10: quantile(l, 0.1), p90: quantile(l, 0.9) });
  const kWh = q(parAn);
  // année la plus proche de la médiane : son profil horaire sert à l'autoconsommation
  let im = 0;
  parAn.forEach((v, i) => { if (Math.abs(v - kWh.med) < Math.abs(parAn[im] - kWh.med)) im = i; });
  return {
    annees, kWh, mois: parMois.map((l, m) => ({ m, ...q(l) })), horaire: horaires[im],
    champs: parChamp.map((P, i) => ({ kWh: P.kWh / na, specifique: champs[i].kWc ? P.kWh / na / champs[i].kWc : 0, poa: P.poa / na, poaLibre: P.poaLibre / na, directLibre: P.directLibre / na, diffus: P.diffus / na })),
  };
}

/* ------------------------------------------------------------------ consommation et économie */

// profil de consommation d'un ménage (heure locale) : creux de nuit, pointes du matin et du soir ; hiver plus chargé
const PROFIL_JOUR = [0.45, 0.38, 0.35, 0.34, 0.35, 0.42, 0.7, 1.0, 0.95, 0.8, 0.75, 0.85, 1.0, 0.9, 0.75, 0.7, 0.8, 1.05, 1.35, 1.45, 1.3, 1.1, 0.85, 0.6];
const PROFIL_MOIS = [1.25, 1.18, 1.08, 0.97, 0.88, 0.82, 0.8, 0.82, 0.88, 0.98, 1.12, 1.24];

/** Consommation horaire (kWh, 8760 h UTC) d'un ménage consommant `annuel` kWh par an. */
export function profilConsommation(annuel) {
  const c = new Float32Array(8760), debut = Date.UTC(2025, 0, 1);
  let s = 0;
  for (let k = 0; k < 8760; k++) {
    const d = new Date(debut + k * 3600000), m = d.getUTCMonth(), ete = m >= 3 && m <= 9, hl = (d.getUTCHours() + (ete ? 2 : 1)) % 24;
    s += c[k] = PROFIL_JOUR[hl] * PROFIL_MOIS[m];
  }
  for (let k = 0; k < 8760; k++) c[k] *= annuel / s;
  return c;
}

/** Autoconsommation heure par heure : { auto, injecte, achete } en kWh/an. */
export function autoconsommation(horaire, annuel) {
  const c = profilConsommation(annuel);
  let auto = 0, injecte = 0, prod = 0;
  for (let k = 0; k < 8760; k++) { const p = horaire[k] || 0, a = Math.min(p, c[k]); auto += a; injecte += p - a; prod += p; }
  return { auto, injecte, achete: annuel - auto, prod };
}

/**
 * Coût d'une installation ajoutée sur toit (CHF HT) : régression de SuisseEnergie, « Observation des prix de marché
 * photovoltaïque 2025 » (Planair, 3 août 2026), tableau 3 : min(1628·P + 5278 ; 681·P + 76265), P en kWc.
 */
export const coutHT = P => P > 0 ? Math.min(1628 * P + 5278, 681 * P + 76265) : 0;
export const TVA = 0.081;

/**
 * Rétribution unique (Pronovo) pour une installation ajoutée ou intégrée, dès le 1er avril 2025 (OEneR, annexe 2.1) :
 * contribution de base 0 ; contribution liée à la puissance par tranche : < 30 kW 360 CHF/kW (intégrée 400),
 * 30–100 kW 300 (330), ≥ 100 kW 250 (250). Installations de 2 kW au moins.
 */
export function retributionUnique(P, integree = false) {
  if (!(P >= 2)) return 0;
  const [a, b, c] = integree ? [400, 330, 250] : [360, 300, 250];
  return Math.min(P, 30) * a + Math.max(0, Math.min(P, 100) - 30) * b + Math.max(0, P - 100) * c;
}

export const DEFAUTS_ECO = {
  consommation: 4500,  // kWh/an (ménage type H4 de l'ElCom)
  achat: 0.28,         // CHF/kWh, tarif médian H4 2026 de l'ElCom : 27,7 ct
  reprise: 0.08,       // CHF/kWh, rétribution de l'injection (minimum légal dès 2026 : 6 ct pour < 30 kW)
  exploitation: 0.03,  // CHF/kWh produit : entretien, assurance, remplacement de l'onduleur
  degradation: 0.005,  // par an
  duree: 30,           // ans
  fiscal: 0,           // taux marginal d'imposition (déduction de l'investissement, bâtiment existant)
  integree: false,
  prixKWc: null,       // CHF/kWc TTC imposé (null : régression SuisseEnergie)
};

/**
 * Investissement, subvention et temps de retour (sans actualisation) d'une installation de P kWc produisant `kWh`
 * par an, dont `auto` autoconsommés.
 */
export function rentabilite(P, kWh, auto, o = {}) {
  o = { ...DEFAUTS_ECO, ...o };
  const brut = o.prixKWc > 0 ? o.prixKWc * P : coutHT(P) * (1 + TVA);
  const ru = retributionUnique(P, o.integree), impot = Math.max(0, brut - ru) * (o.fiscal || 0), net = brut - ru - impot;
  const partAuto = kWh > 0 ? auto / kWh : 0;
  let cumul = -net, retour = null;
  const flux = [];
  for (let an = 1; an <= o.duree; an++) {
    const p = kWh * Math.pow(1 - o.degradation, an - 1);
    const gain = p * partAuto * o.achat + p * (1 - partAuto) * o.reprise - p * o.exploitation;
    if (retour == null && cumul + gain >= 0) retour = an - 1 + (-cumul) / gain;
    cumul += gain;
    flux.push({ an, gain, cumul });
  }
  const gain1 = flux[0]?.gain || 0;
  return { brut, ru, impot, net, gain1, retour, bilan: cumul, flux, parKWc: P ? brut / P : 0, lcoe: kWh ? (net + kWh * o.exploitation * o.duree) / (kWh * o.duree * (1 - o.degradation * o.duree / 2)) : 0 };
}

/* ------------------------------------------------------------------ outils */

/** Indice (jour de l'année type × 24 + heure UTC) ; 29 février ramené au 28. */
export function indiceType(ms) {
  const d = new Date(ms), an = d.getUTCFullYear(), bis = (Date.UTC(an + 1, 0, 1) - Date.UTC(an, 0, 1)) / JOUR === 366;
  let jour = Math.floor((ms - Date.UTC(an, 0, 1)) / JOUR);
  if (bis && jour >= 59) jour = Math.max(58, jour - 1);
  return Math.min(364, jour) * 24 + d.getUTCHours();
}

function quantile(l, q) {
  const s = l.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const x = (s.length - 1) * q, i = Math.floor(x);
  return s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * (x - i);
}
