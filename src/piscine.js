// Température de l'eau d'une piscine extérieure : bilan d'énergie horaire à un nœud (eau bien mélangée), d'après
// Woolley, Harrington et Modera (2011), Building and Environment, doi:10.1016/j.buildenv.2010.07.014, avec :
//  - solaire : direct horizontal × part de la zone au soleil (ombres réelles, masques d'horizon) + diffus × vue du ciel ;
//  - infrarouge : ciel de Berdahl–Martin (point de rosée), nébulosité estimée par le rapport global / ciel clair
//    (Crawford et Duchon, 1999), ou rayonnement descendant mesuré si la station le donne ;
//  - évaporation : McMillan (repris par Woolley) ; convection par le rapport de Bowen ;
//  - sol et parois (U = 0,5 W/m²K), eau d'appoint au réseau (12 °C) ;
//  - bâche à bulles (option, la nuit 20 h – 9 h) : évaporation × 0,3, convection et infrarouge × 0,7 ;
//  - chauffage (option) : puissance illimitée, juste assez pour tenir la consigne chaque heure ;
//  - apport solaire (option) : fonction horaire fournie par solairePiscine.js, coupée à un plafond de température.
// Sans three.js ni DOM : testable dans Node. Méthode et limites : docs/piscine-methode.md.

export const DEFAUTS = {
  profondeur: 1.5,    // m (moyenne)
  fond: "clair",      // absorption 0,85 (clair) ou 0,90 (foncé)
  bache: "nuit",      // "aucune" | "nuit"
  vent: "normal",     // facteur d'abri : abritée 0,3, normale 0,5, exposée 0,8 (vent ramené de 10 m à 3 m)
  seuil: 25,          // °C, indication gratuite au-dessus / en dessous
  consigne: 26,       // °C, chauffage
  reseau: 12,         // °C, eau d'appoint et mise en eau
  ouverture: [5, 1],  // 1er mai
  fermeture: [9, 30], // 30 septembre
};
const ABRI = { abritee: 0.3, normal: 0.5, exposee: 0.8 };
const SIGMA = 5.670e-8, RHOC = 4.18e6, LV = 2.45e6, CB = 61; // W/m²K⁴, J/m³K, J/kg, Pa/K (Bowen)
const es = T => 610.94 * Math.exp(17.625 * T / (T + 243.04)); // pression de vapeur saturante (Pa), Magnus

/**
 * Simule une saison : de 15 jours avant l'ouverture (mise en régime, eau du réseau) jusqu'à la fermeture.
 * @param A série horaire d'une année (climat.js seriesStation)
 * @param z { aire, perim, f (Float32 365×24, part au soleil), svf, hauteur (Float32 365×24, soleil au milieu de l'heure) }
 * @param o réglages (DEFAUTS), plus { chauffage: bool, sansOmbre: bool, correctionT (°C, altitude) }
 *   et, en option, { capteur: (heure) => W fournis à l'eau, plafond: °C } (solairePiscine.js)
 * @returns {{ debut (ms), Tw: Float32Array (température en fin d'heure), chauffe, solaire: Float32Array (W), ouverture (indice) }}
 */
export function simulerSaison(A, z, o) {
  const an = new Date(A.debut).getUTCFullYear();
  const h0 = (Date.UTC(an, o.ouverture[0] - 1, o.ouverture[1]) - A.debut) / 3600000, h1 = (Date.UTC(an, o.fermeture[0] - 1, o.fermeture[1] + 1) - A.debut) / 3600000;
  const hDeb = h0 - 15 * 24, n = h1 - hDeb;
  const V = z.aire * o.profondeur, C = RHOC * V, contact = z.aire + z.perim * o.profondeur;
  const alpha = o.fond === "fonce" ? 0.9 : 0.85, abri = ABRI[o.vent] ?? 0.5, svf = o.sansOmbre ? 1 : z.svf;
  const Tw = new Float32Array(n), chauffe = new Float32Array(n), solaire = new Float32Array(n);
  let T = o.reseau, clf = 0.5;
  // sol autour du bassin : moyenne de l'air sur les 60 jours précédents (inertie de la terre)
  let somme = 0, nb = 0;
  const fen = [];
  for (let h = Math.max(0, hDeb - 60 * 24); h < hDeb; h++) if (!isNaN(A.T[h])) { const v = A.T[h] + (o.correctionT || 0); fen.push(v); somme += v; nb++; }
  for (let k = 0; k < n; k++) {
    const h = hDeb + k, i = indiceType(A.debut + h * 3600000);
    const Ta = A.T[h] + (o.correctionT || 0), Td = A.Td[h], P = A.p[h] || 95000;
    const ea = isNaN(A.ea[h]) ? es(Td) : A.ea[h];
    if (fen.length >= 60 * 24) { somme -= fen.shift(); nb--; }
    fen.push(Ta); somme += Ta; nb++;
    const Tsol = somme / nb;
    // rayonnement : diffus mesuré, sinon séparation d'Erbs ; direct = global − diffus
    const sinh = Math.sin(Math.max(0, z.hauteur[i]) * Math.PI / 180), G = A.G[h] || 0;
    let D = A.D[h];
    if (isNaN(D)) {
      const I0 = 1367 * sinh, kt = I0 > 10 ? Math.min(1, G / I0) : 1;
      D = G * (kt <= 0.22 ? 1 - 0.09 * kt : kt <= 0.8 ? 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4 : 0.165);
    }
    D = Math.min(D, G);
    const Gb = G - D, fs = o.sansOmbre ? 1 : z.f[i];
    // nébulosité (0–1) : 1 − global / ciel clair (Haurwitz) le jour ; la nuit, la dernière valeur du jour
    if (sinh > 0.15) clf = Math.min(1, Math.max(0, 1 - G / (1098 * sinh * Math.exp(-0.057 / sinh))));
    const epsClair = 0.787 + 0.764 * Math.log((Td + 273.15) / 273.15);
    const L = !isNaN(A.L[h]) ? A.L[h] : (clf + (1 - clf) * Math.min(1, epsClair)) * SIGMA * (Ta + 273.15) ** 4;
    // bâche la nuit (heure locale d'été = UTC + 2)
    const hl = (new Date(A.debut + h * 3600000).getUTCHours() + 2) % 24, couverte = o.bache === "nuit" && (hl >= 20 || hl < 9);
    const V3 = (A.V[h] || 0) * Math.pow(0.3, 0.2) * abri;
    const fEvap = couverte ? 0.3 : 1, fPert = couverte ? 0.7 : 1, fSol = couverte ? 0.9 : 1;
    const Qsol = alpha * z.aire * (Gb * fs + D * svf) * fSol;
    const Qir = 0.95 * z.aire * (svf * L + (1 - svf) * SIGMA * (Ta + 273.15) ** 4 - SIGMA * (T + 273.15) ** 4) * fPert;
    const kv = 0.036 + 0.025 * V3;
    const Qevap = -kv * (es(T) - ea) * z.aire * fEvap;
    const Qconv = -kv * CB * (P / 101325) * (T - Ta) * z.aire * fPert;
    const Qsolp = -0.5 * contact * (T - Tsol);
    const Qapp = Qevap < 0 ? (-Qevap / LV) * 4186 * (o.reseau - T) : 0;
    let Tn = T + (Qsol + Qir + Qevap + Qconv + Qsolp + Qapp) * 3600 / C;
    // apport solaire (capteurs thermiques ou photovoltaïque + pompe à chaleur, solairePiscine.js) : W fournis à l'eau,
    // coupé quand l'eau atteint `plafond` (régulation)
    if (o.capteur) {
      let q = o.capteur({ k, h, i, T, Ta, V: A.V[h] || 0, G, Gb, D, L, sinh });
      if (q > 0 && o.plafond != null) q = Math.min(q, Math.max(0, (o.plafond - Tn) * C / 3600));
      if (q > 0) { Tn += q * 3600 / C; solaire[k] = q; }
    }
    if (o.chauffage && h >= h0 && Tn < o.consigne) { chauffe[k] = (o.consigne - Tn) * C / 3600; Tn = o.consigne; }
    T = Tn;
    Tw[k] = T;
  }
  return { debut: A.debut + hDeb * 3600000, Tw, chauffe, solaire, ouverture: h0 - hDeb, an };
}

/** Indice (jour de l'année type × 24 + heure UTC) ; 29 février ramené au 28. */
function indiceType(ms) {
  const d = new Date(ms), an = d.getUTCFullYear(), bis = (Date.UTC(an + 1, 0, 1) - Date.UTC(an, 0, 1)) / 86400000 === 366;
  let jour = Math.floor((ms - Date.UTC(an, 0, 1)) / 86400000);
  if (bis && jour >= 59) jour = Math.max(58, jour - 1);
  return Math.min(364, jour) * 24 + d.getUTCHours();
}

/** Quantile (0–1) d'une liste de nombres. */
export function quantile(l, q) {
  const s = l.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const x = (s.length - 1) * q, i = Math.floor(x);
  return s[i] + (s[Math.min(s.length - 1, i + 1)] - s[i]) * (x - i);
}

const JOUR = 86400000;
/** Semaine (0–51) : blocs de 7 jours depuis le 1er janvier (comme semaines.js). */
const semaine = ms => { const d = new Date(ms), an = d.getUTCFullYear(); return Math.min(51, Math.floor((ms - Date.UTC(an, 0, 1)) / JOUR / 7)); };

/**
 * Toutes les années : température moyenne de l'eau par semaine (médiane, P10, P90), jours au-dessus du seuil
 * (moyenne journalière), chauffage par mois (kWh, puissance du jour le plus exigeant), sur la saison.
 * @returns {{ annees: number[], semaines: { w, med, p10, p90, sansOmbre }[], jours: {med, p10, p90}, joursSansOmbre,
 *   chauffage: { mois: { m, kWh: {med,p10,p90}, W: {med} }[], kWh, miseEnTemp } | null }}
 */
export function analyser(series, z, o) {
  const annees = [...series.keys()].sort();
  const parSemaine = new Map(), parSemaineSO = new Map(), jours = [], joursSO = [], mois = new Map(), saisonKWh = [], miseEnTemp = [];
  for (const an of annees) {
    const A = series.get(an);
    for (const [sansOmbre, cible, liste] of [[false, parSemaine, jours], [true, parSemaineSO, joursSO]]) {
      const r = simulerSaison(A, z, { ...o, sansOmbre, chauffage: false });
      const sem = new Map(), jr = new Map();
      for (let k = r.ouverture; k < r.Tw.length; k++) {
        const ms = r.debut + k * 3600000, w = semaine(ms), j = Math.floor(ms / JOUR);
        const s = sem.get(w) || [0, 0]; s[0] += r.Tw[k]; s[1]++; sem.set(w, s);
        const d = jr.get(j) || [0, 0]; d[0] += r.Tw[k]; d[1]++; jr.set(j, d);
      }
      for (const [w, [s, c]] of sem) { if (c < 24 * 3) continue; (cible.get(w) || cible.set(w, []).get(w)).push(s / c); }
      liste.push([...jr.values()].filter(([s, c]) => s / c >= o.seuil).length);
    }
    if (o.avecChauffage) {
      const r = simulerSaison(A, z, { ...o, chauffage: true });
      const parMois = new Map(), jourW = new Map();
      let total = 0;
      for (let k = r.ouverture; k < r.Tw.length; k++) {
        const ms = r.debut + k * 3600000, m = new Date(ms).getUTCMonth(), j = Math.floor(ms / JOUR);
        const e = r.chauffe[k] / 1000; // kWh pendant l'heure
        parMois.set(m, (parMois.get(m) || 0) + e); total += e;
        jourW.set(j, (jourW.get(j) || 0) + r.chauffe[k] / 24);
      }
      // mise en température : le premier jour (de l'eau du jour d'ouverture à la consigne)
      miseEnTemp.push(r.chauffe.slice(r.ouverture, r.ouverture + 24).reduce((a, b) => a + b, 0) / 1000);
      const pointe = new Map();
      for (const [j, w] of jourW) { const m = new Date(j * JOUR).getUTCMonth(); if (j * JOUR >= r.debut + (r.ouverture + 24) * 3600000) pointe.set(m, Math.max(pointe.get(m) || 0, w)); }
      for (const [m, e] of parMois) { const x = mois.get(m) || { kWh: [], W: [] }; x.kWh.push(e); x.W.push(pointe.get(m) || 0); mois.set(m, x); }
      saisonKWh.push(total);
    }
  }
  const q = l => ({ med: quantile(l, 0.5), p10: quantile(l, 0.1), p90: quantile(l, 0.9) });
  return {
    annees,
    semaines: [...parSemaine.keys()].sort((a, b) => a - b).map(w => ({ w, ...q(parSemaine.get(w)), sansOmbre: quantile(parSemaineSO.get(w) || [], 0.5) })),
    jours: q(jours), joursSansOmbre: q(joursSO),
    chauffage: o.avecChauffage ? {
      mois: [...mois.keys()].sort((a, b) => a - b).map(m => ({ m, kWh: q(mois.get(m).kWh), W: q(mois.get(m).W) })),
      kWh: q(saisonKWh), miseEnTemp: q(miseEnTemp),
    } : null,
  };
}

/**
 * Ensoleillement réel de la zone par mois : pour chaque heure, part de la zone hors de l'ombre × part de l'heure où la
 * station a mesuré du soleil (sre000h0). Ciel clair = même calcul sans nuages. En heures par jour, médiane et
 * fourchette P10–P90 sur les années.
 * @returns {{ m, clair, med, p10, p90 }[]} (12 mois)
 */
export function soleilReelParMois(series, f) {
  const parMois = Array.from({ length: 12 }, () => []), clair = new Float64Array(12), jc = new Float64Array(12);
  for (let k = 0; k < 365 * 24; k++) { const m = new Date(Date.UTC(2025, 0, 1) + k * 3600000).getUTCMonth(); clair[m] += f[k]; }
  for (let m = 0; m < 12; m++) jc[m] = new Date(Date.UTC(2025, m + 1, 0)).getUTCDate();
  for (const A of series.values()) {
    const s = new Float64Array(12), j = new Float64Array(12);
    for (let h = 0; h < A.n; h++) {
      const ms = A.debut + h * 3600000, d = new Date(ms), m = d.getUTCMonth();
      if (d.getUTCHours() === 0) j[m]++;
      s[m] += f[indiceType(ms)] * (A.soleil[h] || 0);
    }
    for (let m = 0; m < 12; m++) parMois[m].push(s[m] / j[m]);
  }
  return parMois.map((l, m) => ({ m, clair: clair[m] / jc[m], med: quantile(l, 0.5), p10: quantile(l, 0.1), p90: quantile(l, 0.9) }));
}
