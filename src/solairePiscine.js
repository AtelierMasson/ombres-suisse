// Chauffage solaire de la piscine (onglet Soleil, partie Pro) : capteurs thermiques sur un toit, ou photovoltaïque qui
// alimente la pompe à chaleur. Heure par heure, avec la météo mesurée (climat.js) et le bilan de l'eau (piscine.js) :
//  - rayonnement sur le plan incliné : direct (global − diffus) ramené au plan par l'angle d'incidence, × part du plan
//    au soleil (horizon lointain, ou ombres réelles d'un pan de toit de la maquette) ; diffus isotrope × vue du ciel du
//    plan ; réfléchi par le sol (albédo 0,2) ; perte d'incidence ASHRAE (b0) sur le direct ;
//  - capteurs thermiques (EN ISO 9806) : vitrés plans et tubes sous vide η = η0 − a1·ΔT/G − a2·ΔT²/G ; non vitrés
//    (absorbeurs en polypropylène) q = η0(1 − bu·u)·G'' − (b1 + b2·u)·ΔT, G'' comprenant l'échange infrarouge avec le
//    ciel ; le capteur ne tourne que si son gain dépasse 15 W/m², et s'arrête quand l'eau atteint la consigne ;
//  - photovoltaïque : puissance crête × G/1000 × (1 + γ(Tc − 25 °C)), Tc de Faiman (U0 = 25, U1 = 6,84), pertes du
//    système 14 % (valeur par défaut de PVGIS) ; la pompe à chaleur a un COP qui suit l'air et l'eau.
// Sans three.js ni DOM : testable dans Node. Méthode, valeurs et sources : docs/piscine-methode.md.
import { positionSoleil } from "./soleil.js";
import { simulerSaison, quantile } from "./piscine.js";

/** Capteurs thermiques : valeurs typiques de certificats Solar Keymark (surface brute). */
export const CAPTEURS = {
  nonvitre: { eta0: 0.85, bu: 0.04, b1: 11, b2: 2.5, b0: 0.05, dT: 1 },   // absorbeur PP, eau de la piscine directe
  plan: { eta0: 0.75, a1: 3.6, a2: 0.014, b0: 0.12, dT: 5 },               // vitré plan sélectif, échangeur
  tubes: { eta0: 0.55, a1: 1.1, a2: 0.006, b0: 0, dT: 5 },                 // tubes sous vide, échangeur
};
export const PV = { gamma: -0.004, U0: 25, U1: 6.84, pertes: 0.14, b0: 0.05 };
const SIGMA = 5.670e-8, ALBEDO = 0.2, VENT_TOIT = 0.65, PERTES_CONDUITES = 0.05, SEUIL_CAPTEUR = 15;
const rad = Math.PI / 180, JOUR = 86400000;

/** COP d'une pompe à chaleur de piscine : `cop` mesuré à air 15 °C / eau 26 °C, +3,5 % par degré d'air, −2 % par degré d'eau. */
export const copPac = (cop, Ta, Tw) => Math.max(1.5, Math.min(cop * 1.8, cop * (1 + 0.035 * (Ta - 15) - 0.02 * (Tw - 26))));

const geometries = new Map();
/** Soleil au milieu de chaque heure UTC d'une année type (365 × 24) : azimut (depuis le nord, horaire) et hauteur. */
export function geometrieSoleil(lat, lon) {
  const cle = `${lat.toFixed(3)}|${lon.toFixed(3)}`;
  if (geometries.has(cle)) return geometries.get(cle);
  const az = new Float32Array(365 * 24), haut = new Float32Array(365 * 24);
  for (let k = 0; k < 365 * 24; k++) { const p = positionSoleil(new Date(Date.UTC(2025, 0, 1) + k * 3600000 + 1800000), lat, lon); az[k] = p.azimut; haut[k] = p.hauteur; }
  const g = { az, haut };
  geometries.set(cle, g);
  return g;
}

/**
 * Rayonnement horaire sur le plan (W/m²), séparé en direct (après perte d'incidence) et total.
 * @param plan { pente (°), orientation (° ; 0 = sud, −90 = est, +90 = ouest), f (Float32 365×24, part au soleil),
 *   svf (vue du ciel du plan) }
 */
export function rayonnementPlan(plan, geo, i, G, Gb, D, b0) {
  const beta = plan.pente * rad, azP = (180 + plan.orientation) * rad, h = geo.haut[i] * rad, a = geo.az[i] * rad;
  const sinh = Math.sin(h);
  let direct = 0;
  if (sinh > 0.01 && Gb > 0) {
    const cosT = Math.cos(beta) * sinh + Math.sin(beta) * Math.cos(h) * Math.cos(a - azP);
    if (cosT > 0) {
      const Bn = Math.min(1100, Gb / Math.max(0.05, sinh)), iam = Math.max(0, 1 - b0 * (1 / Math.max(cosT, 0.05) - 1));
      direct = Bn * cosT * iam * (plan.f[i] ?? 1);
    }
  }
  const diffus = D * plan.svf, sol = G * ALBEDO * (1 - Math.cos(beta)) / 2;
  return { direct, total: direct + diffus + sol };
}

/** Chaleur utile d'un capteur thermique (W/m² de surface brute), eau de la piscine à Tw. */
export function chaleurCapteur(type, Gp, Ta, Tw, u, Lnet) {
  const c = CAPTEURS[type], dT = Tw + c.dT - Ta;
  let q;
  if (type === "nonvitre") q = c.eta0 * (1 - c.bu * u) * (Gp + 0.95 * Lnet) - (c.b1 + c.b2 * u) * dT;
  else q = Gp > 0 ? c.eta0 * Gp - c.a1 * dT - c.a2 * dT * Math.abs(dT) : 0;
  return q > SEUIL_CAPTEUR ? q * (1 - PERTES_CONDUITES) : 0;
}

/** Production photovoltaïque (W AC) d'une installation de `kwc` kWc. */
export function puissancePV(kwc, Gp, Ta, u) {
  if (Gp <= 0) return 0;
  const Tc = Ta + Gp / (PV.U0 + PV.U1 * u);
  return Math.max(0, kwc * Gp * (1 + PV.gamma * (Tc - 25)) * (1 - PV.pertes));
}

const semaine = ms => { const d = new Date(ms), an = d.getUTCFullYear(); return Math.min(51, Math.floor((ms - Date.UTC(an, 0, 1)) / JOUR / 7)); };

/**
 * Bilan de la saison, toutes les années.
 * @param series climat.js ; @param z zone (piscine.js) ; @param o réglages de la piscine (consigne, bâche…, correctionT)
 * @param sys { type: "thermique" | "pv", capteur, surface (m²), kwc, cop (pompe à chaleur, 15/26), pac (kW chaleur max,
 *   PV), surplus (K au-dessus de la consigne que le solaire peut atteindre, 2), plan: { pente, orientation, f, svf }, lat, lon, appointCop (COP de l'appoint des capteurs, 1 = direct) }
 * @returns {{ mois: { m, besoin, solaire, appoint, part, prod, plan }[], saison: {...}, semaines: { w, med, p10, p90 }[],
 *   jours: {med,p10,p90}, annees: number[], pvAnnuel?: {med} }}
 */
export function bilanSolaire(series, z, o, sys) {
  const geo = geometrieSoleil(sys.lat, sys.lon), annees = [...series.keys()].sort();
  const b0 = sys.type === "pv" ? PV.b0 : CAPTEURS[sys.capteur].b0;
  const parMois = new Map(), saison = { besoin: [], solaire: [], appoint: [], prod: [], plan: [], elec: [], elecPV: [] };
  const parSemaine = new Map(), jours = [], pvAn = [];
  const svfIR = (1 + Math.cos(sys.plan.pente * rad)) / 2;
  // une heure : rayonnement sur le plan, chaleur des capteurs, ou production PV × COP (limitée par la pompe à chaleur)
  const apport = x => {
    const r = rayonnementPlan(sys.plan, geo, x.i, x.G, x.Gb, x.D, b0), u = x.V * VENT_TOIT, cop = copPac(sys.cop || 4, x.Ta, x.T);
    if (sys.type === "thermique") {
      const Lnet = svfIR * (x.L - SIGMA * (x.Ta + 273.15) ** 4);
      return { Gp: r.total, cop, q: chaleurCapteur(sys.capteur, r.total, x.Ta, x.T, u, Lnet) * sys.surface };
    }
    const pv = puissancePV(sys.kwc, r.total, x.Ta, u);
    return { Gp: r.total, pv, cop, q: Math.min(pv * cop, sys.pac * 1000) };
  };
  const plafond = o.consigne + (sys.surplus ?? 2);
  for (const an of annees) {
    const A = series.get(an), n0 = 24 * 200;
    // 1. besoin : chauffage seul ; rayonnement sur le plan et, pour la pompe à chaleur, COP de chaque heure
    const Gp = new Float32Array(n0), cop1 = new Float32Array(n0), cop2 = new Float32Array(n0), pv = new Float32Array(n0), pot = new Float32Array(n0);
    const base = simulerSaison(A, z, { ...o, chauffage: true, capteur: x => { const r = apport(x); Gp[x.k] = r.Gp; cop1[x.k] = r.cop || 1; return 0; } });
    // 2. avec le solaire (jusqu'à la consigne + surplus, l'eau stocke la chaleur du jour) et l'appoint pour tenir la consigne
    const avec = simulerSaison(A, z, { ...o, chauffage: true, plafond, capteur: x => { const r = apport(x); cop2[x.k] = r.cop || 1; pv[x.k] = r.pv || 0; return r.q; } });
    // 3. sans appoint : le solaire seul ; potentiel = ce que les capteurs donneraient s'ils tournaient sans limite
    const seul = simulerSaison(A, z, { ...o, chauffage: false, plafond, capteur: x => { const r = apport(x); pot[x.k] = sys.type === "pv" ? r.pv : r.q; return r.q; } });
    const m = new Map(), tot = { besoin: 0, solaire: 0, appoint: 0, prod: 0, plan: 0, elec: 0, elecPV: 0 };
    for (let k = base.ouverture; k < base.Tw.length; k++) {
      const mo = new Date(base.debut + k * 3600000).getUTCMonth(), e = m.get(mo) || { besoin: 0, solaire: 0, appoint: 0, prod: 0, plan: 0, elec: 0, elecPV: 0 };
      const besoin = base.chauffe[k] / 1000, appoint = avec.chauffe[k] / 1000;
      // électricité : pompe à chaleur sans solaire, et réseau avec le solaire (appoint) ; PV utilisé par la pompe
      const d = {
        besoin, solaire: besoin - appoint, appoint, plan: Gp[k] / 1000, prod: pot[k] / 1000,
        elec: sys.type === "pv" ? besoin / cop1[k] - appoint / cop2[k] : 0, elecPV: sys.type === "pv" ? avec.solaire[k] / 1000 / cop2[k] : 0,
      };
      for (const c in d) { e[c] += d[c]; tot[c] += d[c]; }
      m.set(mo, e);
    }
    for (const [mo, e] of m) { const l = parMois.get(mo) || parMois.set(mo, []).get(mo); l.push(e); }
    for (const c in saison) saison[c].push(tot[c]);
    const sem = new Map(), jr = new Map();
    for (let k = seul.ouverture; k < seul.Tw.length; k++) {
      const ms = seul.debut + k * 3600000, w = semaine(ms), j = Math.floor(ms / JOUR);
      const s = sem.get(w) || [0, 0]; s[0] += seul.Tw[k]; s[1]++; sem.set(w, s);
      const dd = jr.get(j) || [0, 0]; dd[0] += seul.Tw[k]; dd[1]++; jr.set(j, dd);
    }
    for (const [w, [s, c]] of sem) { if (c < 24 * 3) continue; (parSemaine.get(w) || parSemaine.set(w, []).get(w)).push(s / c); }
    jours.push([...jr.values()].filter(([s, c]) => s / c >= o.seuil).length);
    // 4. photovoltaïque : production de l'année entière (contrôle avec les références, kWh/kWc)
    if (sys.type === "pv") pvAn.push(productionAnnuelle(A, sys, geo, o.correctionT || 0) / sys.kwc);
  }
  const q = l => ({ med: quantile(l, 0.5), p10: quantile(l, 0.1), p90: quantile(l, 0.9) });
  const med = (l, c) => quantile(l.map(e => e[c]), 0.5);
  const mois = [...parMois.keys()].sort((a, b) => a - b).map(mo => {
    const l = parMois.get(mo), besoin = med(l, "besoin"), appoint = med(l, "appoint");
    return { m: mo, besoin, appoint, solaire: besoin - appoint, part: besoin > 0.5 ? Math.min(1, Math.max(0, 1 - appoint / besoin)) : 1, prod: med(l, "prod"), plan: med(l, "plan"), elec: med(l, "elec"), elecPV: med(l, "elecPV") };
  });
  const S = Object.fromEntries(Object.entries(saison).map(([c, l]) => [c, q(l)]));
  const parts = saison.besoin.map((b, k) => b > 0.5 ? 1 - saison.appoint[k] / b : 1);
  return {
    annees, mois, saison: { ...S, part: q(parts) },
    semaines: [...parSemaine.keys()].sort((a, b) => a - b).map(w => ({ w, ...q(parSemaine.get(w)) })),
    jours: q(jours), pvAnnuel: pvAn.length ? q(pvAn) : null,
  };
}

/** Production PV d'une année entière (kWh AC), même modèle, diffus séparé comme dans piscine.js si non mesuré. */
function productionAnnuelle(A, sys, geo, corr) {
  let e = 0;
  for (let h = 0; h < A.n; h++) {
    const d = new Date(A.debut + h * 3600000), an = d.getUTCFullYear(), bis = A.n > 8760;
    let jour = Math.floor((d - Date.UTC(an, 0, 1)) / JOUR);
    if (bis && jour >= 59) jour = Math.max(58, jour - 1);
    const i = Math.min(364, jour) * 24 + d.getUTCHours(), G = A.G[h] || 0;
    if (G <= 0) continue;
    const sinh = Math.sin(Math.max(0, geo.haut[i]) * rad);
    let D = A.D[h];
    if (isNaN(D)) { const I0 = 1367 * sinh, kt = I0 > 10 ? Math.min(1, G / I0) : 1; D = G * (kt <= 0.22 ? 1 - 0.09 * kt : kt <= 0.8 ? 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4 : 0.165); }
    D = Math.min(D, G);
    const r = rayonnementPlan(sys.plan, geo, i, G, G - D, D, PV.b0);
    e += puissancePV(sys.kwc, r.total, A.T[h] + corr, (A.V[h] || 0) * VENT_TOIT) / 1000;
  }
  return e;
}

/**
 * Pan de toit autour d'une cellule de bâtiment : croissance de région sur la grille des hauteurs de bâtiment (cellules
 * voisines de pente semblable), puis plan ajusté par moindres carrés.
 * @returns {{ cellules: number[], pente, orientation (° ; 0 = sud), aire (m², en pente), plan: [a, b, d] } | null}
 */
export function panDeToit(G, x, y) {
  // le clic tombe souvent sur une rive ou une façade : on essaie les cellules voisines (jusqu'à 1,5 m), les plus proches d'abord
  const { n, c, x0 } = G, i0 = Math.floor((x - x0) / c), j0 = Math.floor((y - x0) / c), essais = [];
  for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) essais.push([di * di + dj * dj, (j0 + dj) * n + i0 + di]);
  essais.sort((a, b) => a[0] - b[0]);
  for (const [, p] of essais) { const r = panDepuis(G, p); if (r) return r; }
  return null;
}

function panDepuis(G, p0) {
  const { n, c, x0 } = G, B = G.bat, i0 = p0 % n, j0 = Math.floor(p0 / n);
  if (i0 < 2 || j0 < 2 || i0 >= n - 2 || j0 >= n - 2 || !B || isNaN(B[p0])) return null;
  const ok = p => p >= 0 && p < n * n && !isNaN(B[p]);
  const pente = p => { // gradient par différences centrées (m/m), si les 4 voisins sont du bâtiment
    if (!(ok(p - 1) && ok(p + 1) && ok(p - n) && ok(p + n))) return null;
    return [(B[p + 1] - B[p - 1]) / (2 * c), (B[p + n] - B[p - n]) / (2 * c)];
  };
  // pente de départ : moyenne sur 5 × 5 cellules
  let gx = 0, gy = 0, k = 0;
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const g = pente(p0 + dj * n + di); if (g) { gx += g[0]; gy += g[1]; k++; } }
  if (!k) return null;
  gx /= k; gy /= k;
  const croitre = (accepte) => {
    const vu = new Uint8Array(n * n), file = [p0], cell = [];
    vu[p0] = 1;
    while (file.length && cell.length < 6000) {
      const p = file.pop();
      cell.push(p);
      for (const r of [p - 1, p + 1, p - n, p + n]) if (ok(r) && !vu[r] && Math.abs(B[r] - B[p]) < 0.6 && accepte(r)) { vu[r] = 1; file.push(r); }
    }
    return cell;
  };
  const ajuster = cell => { // z = a x + b y + d
    let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
    for (const p of cell) { const X = (p % n) * c, Y = Math.floor(p / n) * c, Z = B[p]; sx += X; sy += Y; sz += Z; sxx += X * X; syy += Y * Y; sxy += X * Y; sxz += X * Z; syz += Y * Z; }
    const N = cell.length, mx = sx / N, my = sy / N, mz = sz / N;
    const Sxx = sxx - N * mx * mx, Syy = syy - N * my * my, Sxy = sxy - N * mx * my, Sxz = sxz - N * mx * mz, Syz = syz - N * my * mz;
    const det = Sxx * Syy - Sxy * Sxy;
    if (Math.abs(det) < 1e-9) return [0, 0, mz];
    const a = (Sxz * Syy - Syz * Sxy) / det, b = (Syz * Sxx - Sxz * Sxy) / det;
    return [a, b, mz - a * mx - b * my];
  };
  const proche = (p, a, b, tol) => { const g = pente(p); return !g || Math.hypot(g[0] - a, g[1] - b) < tol; };
  let cell = croitre(p => { const g = pente(p); return g && Math.hypot(g[0] - gx, g[1] - gy) < 0.25; });
  let [a, b, d] = ajuster(cell);
  const z = (p, A, Bb, D) => A * (p % n) * c + Bb * Math.floor(p / n) * c + D;
  cell = croitre(p => proche(p, a, b, 0.3) && Math.abs(B[p] - z(p, a, b, d)) < 0.35);
  [a, b, d] = ajuster(cell);
  if (cell.length < 8) return null;
  const s = Math.hypot(a, b), penteDeg = Math.atan(s) / rad;
  // orientation : direction vers laquelle le pan descend (−gradient), azimut depuis le nord, puis 0 = sud
  const az = (Math.atan2(-a, -b) / rad + 360) % 360;
  let orientation = s < 0.03 ? 0 : az - 180;
  if (orientation > 180) orientation -= 360;
  return {
    cellules: cell, pente: penteDeg, orientation, aire: cell.length * c * c * Math.sqrt(1 + s * s),
    // hauteur du plan en coordonnées relatives au centre de la maquette
    hauteur: (X, Y) => a * (X - x0 - c / 2) + b * (Y - x0 - c / 2) + d,
  };
}
