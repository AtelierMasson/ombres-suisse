// Onglet Soleil, section « Panneaux solaires » : un toit choisi d'un clic (bâtiment du relevé, ou volume dessiné du
// projet Pro). Pour ce toit :
//  - pans détectés (orientation, inclinaison, surface), modules implantés (marge au bord, rangées) ;
//  - ombres réelles de la maquette (masques d'horizon de chaque point du toit, relief lointain compris) ;
//  - gratuit : production annuelle approximative (année type des moyennes MétéoSuisse), carte de chaleur des pans ;
//  - Pro : production par mois (mesures horaires MétéoSuisse, fourchette P10–P90), coût, rétribution unique,
//    autoconsommation, temps de retour, export PDF.
// Calculs : pansSolaires.js (pans, implantation), solairePV.js (production, économie), masques.worker.js (ombres).
// Méthode et sources : docs/solaire-toits-methode.md.
import * as THREE from "three";
import { t, nombre, entier, date } from "./i18n.js";
import { pansToits } from "./pans.js";
import { indexVolumes } from "./volumes.js";
import { masquesDegres, partHoraire, NB_AZ } from "./semaines.js";
import { stationsProches, seriesStation } from "./climat.js";
import { pansReleve, pansMaillage, implanter, pointsPan, sousModule, zPan } from "./pansSolaires.js";
import { MODULE, DEFAUTS_ECO, positionsHoraires, vueCielInclinee, partDirecte, productionPV, anneeType, normaleProche, autoconsommation, rentabilite } from "./solairePV.js";
import { svgProductionMois, imageToit, couleurIrr, couleurIrrRvb, ECHELLE } from "./graphiquesSolaire.js";
import { DEGRADE } from "./graphiquesPiscine.js";

const $ = s => document.querySelector(s);
const echap = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const CLE = "ombres.solaireReglages";
const MAX_POINTS = 1600;    // points de calcul des ombres, tous pans confondus
const SEUIL_ACTIF = 750;    // kWh/kWc : en dessous, un pan n'est pas équipé d'office (l'utilisateur peut le cocher)
const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const direction = az => t(`sol.dir.${DIRECTIONS[Math.round(((az % 360) + 360) % 360 / 45) % 8]}`);

/**
 * `o` = { scene, S, message, etat, compte, compter, surface: () => Float32Array (obstacles affichés), cleJeu: () => string }
 */
export function brancherSolaire(o) {
  const { scene, S } = o;
  const R = { ...DEFAUTS_ECO, marge: 0.5, plat: "sud", Wc: MODULE.Wc, panneaux: true, chaleur: true, ...lirePrefs() };
  let outil = false, toit = null, r = null, forcerGratuit = false, jeton = 0, posCache = null;
  const groupe = new THREE.Group();
  scene.scene.add(groupe);
  (scene.horsAO ||= []).push(groupe);
  const autorise = () => !forcerGratuit && (o.compte ? o.compte.proActif() : !!import.meta.env?.DEV);

  /* ---------------------------------------------------------------- choix du toit */
  function activer(oui = !outil) {
    outil = oui;
    $("#btnSolaireChoisir").setAttribute("aria-pressed", String(outil));
    document.body.classList.toggle("choix-centre", outil);
    o.message(outil ? t("sol.aideChoisir") : "", outil ? 0 : 1);
  }
  $("#btnSolaireChoisir").addEventListener("click", () => { if (S.G) activer(); });
  $("#btnSolaireEffacer").addEventListener("click", () => { toit = null; r = null; jeton++; vider3D(); majAffichage(); });
  addEventListener("keydown", e => { if (outil && e.key === "Escape") activer(false); });

  /** Clic sur la maquette : pris si l'outil est actif. */
  function clic(e) {
    if (!outil || !S.G) return false;
    const id = scene.volumeVise?.(e);
    if (id != null) {
      activer(false);
      toit = { type: "volume", id };
      calculer();
      return true;
    }
    const p = scene.pointSol(e);
    if (!p) return true;
    const C0 = contours(), { n, c, x0 } = S.G, i = Math.floor((p[0] - x0) / c), j = Math.floor((p[1] - x0) / c);
    let seg = -1;
    for (let rr = 0; rr <= 3 && seg < 0; rr++) for (let dj = -rr; dj <= rr && seg < 0; dj++) for (let di = -rr; di <= rr; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < n && b < n && C0.seg[b * n + a] >= 0) { seg = C0.seg[b * n + a]; break; }
    }
    if (seg < 0) { o.message(t("sol.aucunToit")); return true; }
    activer(false);
    toit = { type: "releve", E: S.E0 + p[0], N: S.N0 + p[1] };
    calculer();
    return true;
  }
  const contours = () => { const C = scene.contours; return C?.base || C; };

  /** Pans du toit choisi (pansSolaires.js), ou [] (bâtiment disparu, volume supprimé). */
  function detecterPans() {
    const G = S.G;
    if (toit.type === "volume") {
      const m = scene.couches?.volumes?.children.find(x => x.userData.volume === toit.id);
      if (!m) return [];
      m.updateMatrixWorld(true);
      const g = m.geometry, P = g.attributes.position, F = g.userData.faces || [], v = new THREE.Vector3(), tri = [];
      for (let k = 0; k < P.count / 3; k++) {
        if ((F[k] ?? -1) !== -1) continue;
        for (let s = 0; s < 3; s++) { v.fromBufferAttribute(P, 3 * k + s).applyMatrix4(m.matrixWorld); tri.push(v.x, -v.z, v.y + scene.zRef); }
      }
      return pansMaillage(G, tri, { id: `v${toit.id}` });
    }
    const C0 = contours(), { n, c, x0 } = G, x = toit.E - S.E0, y = toit.N - S.N0;
    const i = Math.floor((x - x0) / c), j = Math.floor((y - x0) / c);
    let seg = -1;
    for (let rr = 0; rr <= 3 && seg < 0; rr++) for (let dj = -rr; dj <= rr && seg < 0; dj++) for (let di = -rr; di <= rr; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < n && b < n && C0.seg[b * n + a] >= 0) { seg = C0.seg[b * n + a]; break; }
    }
    if (seg < 0) return [];
    const V = C0.volumesSolaire ||= indexVolumes(G, C0), P = C0.pansCalcules ||= pansToits(G, C0);
    return pansReleve(G, P, new Set(V.parBati[V.bati[seg]]));
  }

  /* ---------------------------------------------------------------- ombres : masques d'horizon des points du toit */
  function calculer() {
    if (!toit || !S.G || !S.horizon) return;
    const G = S.G, mon = ++jeton, debut = performance.now();
    const pans = detecterPans();
    if (!pans.length) { r = { vide: true }; vider3D(); majAffichage(); o.message(t("sol.aucunPan")); return; }
    const cellules = pans.reduce((s, p) => s + p.cellules.length, 0), pas = Math.max(1, Math.ceil(Math.sqrt(cellules / MAX_POINTS)));
    const xy = [], z = [], panDe = [], plans = [], surface = o.surface();
    pans.forEach((pan, k) => {
      pan.i0 = xy.length;
      const P = pointsPan(G, pan, pas, pan.inclinaison < 5 ? 0.4 : 0.15);
      // un pan n'est pas toujours plan (ressaut, deux niveaux réunis) : le point part du relevé s'il est au-dessus du plan
      // (au plus 1 m : une branche au-dessus du toit ne compte pas), sinon il serait « dans » le toit et se verrait masqué
      P.xy.forEach((q, s) => { xy.push(q); z.push(P.z[s] + Math.max(0, Math.min(1, (surface[P.cellules[s]] ?? -Infinity) - (P.z[s] - (pan.inclinaison < 5 ? 0.4 : 0.15))))); panDe.push(k); plans.push(...pan.plan); });
      pan.i1 = xy.length;
    });
    const N = xy.length, pts = new Float32Array(5 * N);
    for (let q = 0; q < N; q++) pts.set([(xy[q][0] - G.x0) / G.c, (xy[q][1] - G.x0) / G.c, z[q], 0, 0], 5 * q);
    const plansF = Float32Array.from(plans);
    r = { calcul: true, pans, xy, z, panDe, pas, N };
    majAffichage();
    o.etat(0.05, t("sol.etatOmbres"));
    const nb = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1, Math.ceil(N / 40))), parLot = Math.ceil(N / nb), masques = new Uint8Array(N * NB_AZ);
    let restants = nb;
    for (let k = 0; k < nb; k++) {
      const w = new Worker(new URL("./masques.worker.js", import.meta.url), { type: "module" });
      const a = k * parLot, b = Math.min(N, (k + 1) * parLot);
      w.onmessage = ({ data }) => {
        w.terminate();
        if (mon !== jeton) return;
        masques.set(data.masques, data.debut * NB_AZ);
        o.etat(0.05 + 0.75 * (nb - restants + 1) / nb, t("sol.etatOmbres"));
        if (--restants) return;
        r.m = masquesDegres(masques, N, S.horizon);
        r.msOmbres = performance.now() - debut;
        r.calcul = false;
        try { evaluer(); } catch (e) { console.error(e); o.message(t("sol.erreur", { m: e.message })); }
        o.etat(1, "");
      };
      w.postMessage({ surface, n: G.n, c: G.c, pts: pts.slice(5 * a, 5 * b), debut: a, plans: plansF.slice(3 * a, 3 * b), x0: G.x0, tolPlan: 0.3 });
    }
  }

  const positions = () => {
    if (posCache?.cle !== `${S.lat}|${S.lon}`) posCache = { cle: `${S.lat}|${S.lon}`, pos: positionsHoraires(S.lat, S.lon) };
    return posCache.pos;
  };
  /** Masques des points `idx` (indices globaux), recopiés d'un seul tenant. */
  const sousMasques = idx => { const s = new Float32Array(idx.length * NB_AZ); idx.forEach((q, k) => s.set(r.m.subarray(q * NB_AZ, (q + 1) * NB_AZ), k * NB_AZ)); return s; };

  /* ---------------------------------------------------------------- implantation, champs et production */
  function evaluer() {
    if (!r?.m) return;
    const G = S.G, pos = positions(), orientationPlat = orientationSud();
    const champs = []; // { kWc, inclinaison, azimut, f, vue } ; kWc = 1 ici (rendement spécifique)
    r.pans.forEach(pan => {
      const idx = Array.from({ length: pan.i1 - pan.i0 }, (_, k) => pan.i0 + k), mP = sousMasques(idx);
      pan.part = partDirecte(mP, idx.length, pos, pan.inclinaison, pan.azimut);
      pan.champPlan = champs.push({ kWc: 1, inclinaison: pan.inclinaison, azimut: pan.azimut, f: partHoraire(mP, idx.length, S.lat, S.lon, S.horizon).f, vue: vueCielInclinee(mP, idx.length, pan.inclinaison, pan.azimut) }) - 1;
      const { modules, disposition } = implanter(G, pan, { marge: R.marge, plat: R.plat, orientationPlat });
      pan.modules = modules; pan.disposition = disposition;
      // groupes de modules de même orientation (deux sur un toit plat est-ouest) ; points sous leurs modules
      const groupes = new Map();
      for (const m of modules) {
        const cle = `${Math.round(m.inclinaison)}|${Math.round(m.azimut)}`;
        let g = groupes.get(cle);
        if (!g) groupes.set(cle, g = { inclinaison: m.inclinaison, azimut: m.azimut, modules: [], idx: new Set() });
        g.modules.push(m);
        let pris = false;
        for (const q of idx) if (sousModule(m, r.xy[q][0], r.xy[q][1])) { g.idx.add(q); pris = true; }
        if (!pris) { // module plus petit que le pas des points : le point le plus proche de son centre
          let best = idx[0], dmin = Infinity;
          for (const q of idx) { const d = Math.hypot(r.xy[q][0] - m.centre[0], r.xy[q][1] - m.centre[1]); if (d < dmin) { dmin = d; best = q; } }
          g.idx.add(best);
        }
      }
      pan.groupes = [...groupes.values()].map(g => {
        const l = [...g.idx], mG = sousMasques(l);
        g.champ = champs.push({ kWc: 1, inclinaison: g.inclinaison, azimut: g.azimut, f: partHoraire(mG, l.length, S.lat, S.lon, S.horizon).f, vue: vueCielInclinee(mG, l.length, g.inclinaison, g.azimut) }) - 1;
        delete g.idx;
        return g;
      });
    });
    r.champs = champs;
    produire();
  }

  /** Façade du bâtiment la plus proche du sud (azimut, °) : alignement des rangées sur un toit plat. */
  function orientationSud() {
    if (toit.type !== "releve") return 180;
    const C0 = contours(), segs = new Set(r.pans.map(p => p.volume));
    let best = null, poids = 0;
    for (const B of C0.boucles || []) if (segs.has(B.seg) && B.dominante != null && B.coins.length > poids) { poids = B.coins.length; best = B.dominante; }
    if (best == null) return 180;
    // `dominante` : direction d'une façade (radians, depuis l'est, sens trigonométrique) ; normales à ±90°, tous les 90°
    const az0 = (90 - best * 180 / Math.PI + 360) % 360;
    let mieux = 180, e = Infinity;
    for (let k = 0; k < 4; k++) { const a = (az0 + 90 * k) % 360, d = Math.abs(((a - 180 + 540) % 360) - 180); if (d < e) { e = d; mieux = a; } }
    return mieux;
  }

  /** Climat (MétéoSuisse horaire si chargé, sinon année type), production par pan, totaux, économie. */
  function produire() {
    const pos = positions(), [E, N] = [S.E0 + r.xy[0][0], S.N0 + r.xy[0][1]], alt = r.z[0];
    let series = r.meteo?.series;
    if (!series) {
      const st = normaleProche(E, N, alt);
      r.normale = st;
      series = anneeType(st, pos, -0.0065 * (alt - st.alt));
    }
    const corrT = r.meteo ? r.meteo.correctionT : 0;
    const spec = productionPV(series, r.champs, pos, { correctionT: corrT });
    const kWcModule = R.Wc / 1000;
    for (const pan of r.pans) {
      const c = spec.champs[pan.champPlan];
      pan.irr = { directLibre: c.directLibre, diffus: c.diffus, poa: c.poa };
      let kWh = 0, n = 0;
      for (const g of pan.groupes) { g.specifique = spec.champs[g.champ].specifique; kWh += g.specifique * g.modules.length * kWcModule; n += g.modules.length; }
      pan.nModules = n; pan.kWc = n * kWcModule; pan.kWh = kWh; pan.specifique = n ? kWh / pan.kWc : c.specifique;
      if (pan.actif == null) pan.actif = n > 0 && pan.specifique >= SEUIL_ACTIF;
    }
    // irradiation de chaque point sur le plan du toit (carte de chaleur)
    r.valeurs = new Float32Array(r.N);
    for (const pan of r.pans) {
      const moy = pan.part.reduce((a, b) => a + b, 0) / pan.part.length || 1, ombre = (pan.irr.poa - pan.irr.diffus) / (pan.irr.directLibre || 1);
      for (let q = pan.i0; q < pan.i1; q++) r.valeurs[q] = pan.irr.directLibre * Math.min(1, pan.part[q - pan.i0] / moy * ombre) + pan.irr.diffus;
    }
    totaux(series, pos, corrT);
  }
  function totaux(series = null, pos = positions(), corrT = r.meteo?.correctionT || 0) {
    const kWcModule = R.Wc / 1000, actifs = r.pans.filter(p => p.actif && p.nModules);
    const champs = actifs.flatMap(p => p.groupes.map(g => ({ ...r.champs[g.champ], kWc: g.modules.length * kWcModule })));
    r.kWc = champs.reduce((s, c) => s + c.kWc, 0);
    r.nModules = actifs.reduce((s, p) => s + p.nModules, 0);
    r.aire = actifs.reduce((s, p) => s + p.aire, 0);
    if (!series) series = r.meteo?.series || anneeType(r.normale, pos, -0.0065 * (r.z[0] - r.normale.alt));
    r.prod = champs.length ? productionPV(series, champs, pos, { correctionT: corrT }) : null;
    economie();
    dessiner3D(); majAffichage();
  }
  function economie() {
    if (!r.prod) { r.eco = null; return; }
    const kWh = r.prod.kWh.med, a = autoconsommation(r.prod.horaire, R.consommation);
    r.eco = { ...rentabilite(r.kWc, kWh, a.auto, R), auto: a.auto, injecte: a.injecte, partAuto: a.auto / (a.prod || 1), couverture: a.auto / R.consommation };
  }

  /* ---------------------------------------------------------------- MétéoSuisse (Pro) */
  async function chargerMeteo() {
    if (!r?.prod) return;
    const mon = jeton;
    try {
      o.etat(0.1, t("piscine.etatMeteo"));
      const [E, N] = [S.E0 + r.xy[0][0], S.N0 + r.xy[0][1]], alt = r.z[0];
      const liste = (await stationsProches(E, N, alt)).slice(0, 3);
      let series = null, station = null, derniere = null;
      for (const st of liste) {
        try { series = await seriesStation(st.abr, f => o.etat(0.1 + 0.8 * f, t("piscine.etatMeteoStation", { nom: st.nom }))); station = st; break; }
        catch (e) { derniere = e; console.warn("MétéoSuisse", st.abr, e.message); }
      }
      if (!series) throw derniere || new Error("MétéoSuisse");
      if (mon !== jeton) return;
      r.meteo = { series, station, correctionT: -0.0065 * (alt - station.alt) };
      r.erreurMeteo = null;
      produire();
    } catch (e) {
      console.error(e);
      if (mon === jeton) { r.erreurMeteo = t("sol.meteoIndisponible", { m: e.message }); majAffichage(); }
    } finally { o.etat(1, ""); }
  }

  /* ---------------------------------------------------------------- 3D : carte de chaleur et modules */
  const mats = {};
  function vider3D() {
    for (const x of [...groupe.children]) { groupe.remove(x); x.geometry.dispose(); }
    scene.demander();
  }
  /** Écart (m) entre le relevé et le plan du pan au point q (≥ 0) : la carte et les modules restent au-dessus du toit. */
  const leve = q => { const pan = r.pans[r.panDe[q]], [x, y] = r.xy[q]; return Math.max(0, r.z[q] - zPan(pan, x, y) - (pan.inclinaison < 5 ? 0.4 : 0.15)); };
  /** Le plus grand écart des points sous un module (ou du point le plus proche de son centre). */
  function leveSous(pan, md) {
    let m = -1, best = 0, dmin = Infinity;
    for (let q = pan.i0; q < pan.i1; q++) {
      const [x, y] = r.xy[q];
      if (sousModule(md, x, y)) m = Math.max(m, leve(q));
      const d = Math.hypot(x - md.centre[0], y - md.centre[1]);
      if (d < dmin) { dmin = d; best = q; }
    }
    return m >= 0 ? m : leve(best);
  }
  function dessiner3D() {
    vider3D();
    if (!r?.valeurs || !S.G) return;
    const zR = scene.zRef, h = r.pas * S.G.c / 2, V = (x, y, zz) => [x, zz - zR, -y];
    if (R.chaleur) {
      const pos = [], col = [];
      for (let q = 0; q < r.N; q++) {
        const pan = r.pans[r.panDe[q]], [x, y] = r.xy[q], rgb = couleurIrrRvb(r.valeurs[q]), att = pan.actif ? 1 : 0.55;
        const c = [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h]].map(([a, b]) => V(a, b, zPan(pan, a, b) + leve(q) + 0.18));
        for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...c[k]); col.push(rgb[0] * att, rgb[1] * att, rgb[2] * att); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      mats.chaleur ||= new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
      const m = new THREE.Mesh(g, mats.chaleur); m.renderOrder = 36; m.raycast = () => {};
      groupe.add(m);
    }
    if (R.panneaux) {
      const pos = [], traits = [];
      for (const pan of r.pans) {
        if (!pan.actif) continue;
        for (const md of pan.modules) {
          const dz = leveSous(pan, md), c = md.coins.map(([x, y, zz]) => V(x, y, zz + dz + 0.1));
          for (const k of [0, 1, 2, 0, 2, 3]) pos.push(...c[k]);
          for (let k = 0; k < 4; k++) traits.push(...c[k], ...c[(k + 1) % 4]);
        }
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        mats.module ||= new THREE.MeshBasicMaterial({ color: 0x1b2d4f, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false });
        const m = new THREE.Mesh(g, mats.module); m.renderOrder = 37; m.raycast = () => {};
        const gl = new THREE.BufferGeometry(); gl.setAttribute("position", new THREE.Float32BufferAttribute(traits, 3));
        mats.trait ||= new THREE.LineBasicMaterial({ color: 0xc9d3de, fog: false });
        const l = new THREE.LineSegments(gl, mats.trait); l.renderOrder = 38; l.raycast = () => {};
        groupe.add(m, l);
      }
    }
    scene.demander();
  }

  /* ---------------------------------------------------------------- affichage */
  const sel = (id, opts, val) => `<select class="form-select form-select-sm" id="${id}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(val) ? " selected" : ""}>${echap(l)}</option>`).join("")}</select>`;
  const champ = (id, val, min, max, pas, titre) => `<label>${titre}<input type="number" class="form-control form-control-sm" id="${id}" min="${min}" max="${max}" step="${pas}" value="${val}"></label>`;
  function majAffichage() {
    const el = $("#resultatSolaire"), pro = $("#solairePro"), exp = $("#exportSolaire");
    $("#btnSolaireEffacer").hidden = !toit;
    if (!toit || !r) { el.hidden = true; pro.hidden = true; exp.hidden = true; return; }
    el.hidden = false;
    if (r.vide) { el.innerHTML = `<p class="text-secondary mb-0">${t("sol.aucunPan")}</p>`; pro.hidden = exp.hidden = true; return; }
    if (r.calcul || !r.valeurs) { el.innerHTML = `<p class="text-secondary mb-0">${t("sol.calcul", { n: entier(r.N) })}</p>`; pro.hidden = exp.hidden = true; return; }
    const kWh = r.prod?.kWh.med || 0;
    let h = `<div class="mesures-lieu">${t(toit.type === "volume" ? "sol.enteteVolume" : "sol.entete", { n: r.pans.length, aire: nombre(r.pans.reduce((s, p) => s + p.aire, 0), 0) })}</div>`
      + `<dl class="mesures"><div><dt>${t("sol.production")}</dt><dd class="principale">≈ ${entier(Math.round(kWh / 10) * 10)} kWh</dd></div>`
      + `<div><dt>${t("sol.puissance")}</dt><dd>${nombre(r.kWc, 1)} kWc</dd></div><div><dt>${t("sol.specifique")}</dt><dd>${r.kWc ? entier(kWh / r.kWc) : "–"}</dd></div></dl>`
      + `<div class="text-secondary">${t("sol.modules", { n: r.nModules, wc: R.Wc, aire: nombre(r.nModules * MODULE.L * MODULE.l, 0) })}</div>`;
    // pans
    h += `<table class="table table-sm small mb-1 mt-2 tableau-pans"><thead><tr><th></th><th>${t("sol.colPan")}</th><th>m²</th><th>${t("sol.colModules")}</th><th>${t("sol.colSpec")}</th></tr></thead><tbody>`
      + r.pans.map((p, k) => `<tr class="${p.actif ? "" : "text-secondary"}"><td><input class="form-check-input" type="checkbox" data-pan="${k}"${p.actif ? " checked" : ""}${p.nModules ? "" : " disabled"} aria-label="${echap(t("sol.equiper"))}"></td>`
        + `<td><i class="pastille" style="background:${couleurIrr(p.irr.poa)}"></i>${direction(p.azimut)} <span class="text-secondary">${p.inclinaison < 5 ? t("sol.plat") : `${entier(p.azimut)}° · ${t("sol.colPente").toLowerCase()} ${entier(p.inclinaison)}°`}</span></td>`
        + `<td>${nombre(p.aire, 0)}</td><td>${p.nModules}</td><td>${entier(p.specifique)}</td></tr>`).join("")
      + `</tbody></table>`;
    h += `<div class="text-secondary">${t("sol.carteTitre")}</div><div id="imageSolaire" class="image-piscine"></div>`
      + `<div class="degrade" style="background:${DEGRADE}"></div><div class="d-flex justify-content-between text-secondary"><span>${entier(ECHELLE[0])}</span><span>${t("sol.unitesCarte")}</span><span>${entier(ECHELLE[1])}</span></div>`;
    // réglages
    h += `<div class="sous-titre">${t("sol.implantation")}</div><div class="reglages-piscine">`
      + champ("solMarge", R.marge, 0, 3, 0.1, t("sol.marge"))
      + champ("solWc", R.Wc, 200, 700, 5, t("sol.wc"))
      + `<label>${t("sol.toitPlat")}${sel("solPlat", [["sud", t("sol.platSud")], ["eo", t("sol.platEO")]], R.plat)}</label></div>`;
    const source = r.meteo
      ? t("sol.sourceMeteo", { nom: echap(r.meteo.station.nom), km: nombre(r.meteo.station.km, 1), n: r.prod?.annees.length || 0 })
      : t("sol.sourceNormale", { nom: echap(r.normale.nom) });
    h += `<p class="text-secondary note-piscine mt-2 mb-0">${t("sol.note", { n: entier(r.N), pas: nombre(r.pas * S.G.c, 1), s: nombre(r.msOmbres / 1000, 1), source })}</p>`;
    el.innerHTML = h;
    $("#imageSolaire").append(imageToit(S.G, r.pans, r.xy.map(([x, y], q) => ({ x, y, v: r.valeurs[q], pan: r.panDe[q] })), r.pans.filter(p => p.actif).flatMap(p => p.modules), { px: 8, pas: r.pas }));
    el.querySelectorAll("input[data-pan]").forEach(c => c.addEventListener("change", () => { r.pans[+c.dataset.pan].actif = c.checked; totaux(); }));
    for (const [id, k, min, max] of [["#solMarge", "marge", 0, 3], ["#solWc", "Wc", 200, 700]])
      $(id).addEventListener("change", e => { R[k] = Math.max(min, Math.min(max, +e.target.value || DEFAUTS[k])); garderPrefs(); k === "Wc" ? produire() : evaluer(); });
    $("#solPlat").addEventListener("change", e => { R.plat = e.target.value; garderPrefs(); evaluer(); });
    afficherPro();
  }
  const DEFAUTS = { marge: 0.5, Wc: MODULE.Wc };

  /** Partie Pro : mois, coûts, retour, PDF. Pour un compte gratuit, un rappel (grisé par pro.js). */
  function afficherPro() {
    const el = $("#solairePro"), exp = $("#exportSolaire");
    el.hidden = false; exp.hidden = false; exp.disabled = !r.prod;
    if (!autorise()) { el.innerHTML = `<div class="sous-titre">${t("sol.proTitre")} <span class="badge-pro">Pro</span></div><p class="text-secondary mb-0">${t("sol.proTexte")}</p>`; return; }
    if (!r.prod) { el.innerHTML = `<p class="text-secondary mb-0">${t("sol.aucunModule")}</p>`; return; }
    const P = r.prod, E = r.eco;
    let h = `<div class="sous-titre">${t("sol.moisTitre")}</div><div class="graphique-piscine">${svgProductionMois(P.mois)}</div>`;
    if (!r.meteo) h += `<button type="button" class="btn btn-sm btn-outline-secondary w-100 mt-1" id="btnSolaireMeteo">${t("sol.affiner")}</button>`;
    else h += `<div class="text-secondary">${t("sol.fourchette", { p10: entier(P.kWh.p10), p90: entier(P.kWh.p90), annees: `${P.annees[0]}–${P.annees[P.annees.length - 1]}` })}</div>`;
    if (r.erreurMeteo) h += `<p class="text-danger mb-0">${echap(r.erreurMeteo)}</p>`;
    h += `<details class="mt-1"><summary class="text-secondary">${t("sol.tableau")}</summary><table class="table table-sm small mb-1"><tbody>`
      + P.mois.map(m => `<tr><td>${date(new Date(Date.UTC(2025, m.m, 15)), { month: "long" })}</td><td class="text-end">${entier(m.med)} kWh</td></tr>`).join("")
      + `<tr class="total"><td>${t("sol.total")}</td><td class="text-end">${entier(P.kWh.med)} kWh</td></tr></tbody></table></details>`;
    h += `<div class="sous-titre">${t("sol.ecoTitre")}</div><div class="reglages-piscine">`
      + champ("solConso", R.consommation, 0, 1e6, 100, t("sol.conso"))
      + champ("solAchat", R.achat, 0, 2, 0.01, t("sol.achat"))
      + champ("solReprise", R.reprise, 0, 1, 0.01, t("sol.reprise"))
      + champ("solPrix", R.prixKWc || "", 0, 10000, 50, t("sol.prixKWc"))
      + champ("solFiscal", Math.round(R.fiscal * 100), 0, 50, 1, t("sol.fiscal"))
      + `<label>${t("sol.pose")}${sel("solIntegree", [["0", t("sol.ajoutee")], ["1", t("sol.integree")]], R.integree ? "1" : "0")}</label></div>`;
    if (E) {
      const ligne = (k, v, cls = "") => `<tr class="${cls}"><td>${k}</td><td class="text-end">${v}</td></tr>`;
      h += `<table class="table table-sm small mb-1 mt-2 tableau-chauffage"><tbody>`
        + ligne(t("sol.coutBrut", { kwc: nombre(r.kWc, 1) }), `CHF ${entier(E.brut)}<br><span class="text-secondary">${entier(E.parKWc)} CHF/kWc</span>`)
        + ligne(t("sol.ru"), `− CHF ${entier(E.ru)}`)
        + (E.impot ? ligne(t("sol.impot"), `− CHF ${entier(E.impot)}`) : "")
        + ligne(t("sol.net"), `CHF ${entier(E.net)}`, "total")
        + ligne(t("sol.autoconso"), `${entier(E.auto)} kWh (${nombre(E.partAuto * 100, 0)} %)<br><span class="text-secondary">${t("sol.couverture", { p: nombre(E.couverture * 100, 0) })}</span>`)
        + ligne(t("sol.injecte"), `${entier(E.injecte)} kWh`)
        + ligne(t("sol.gainAn"), `CHF ${entier(E.gain1)}`)
        + ligne(t("sol.retour"), E.retour != null ? t("sol.ans", { n: nombre(E.retour, 1) }) : t("sol.jamais", { n: R.duree }), "total")
        + ligne(t("sol.bilan", { n: R.duree }), `CHF ${entier(E.bilan)}`)
        + ligne(t("sol.lcoe"), `${nombre(E.lcoe * 100, 1)} ct/kWh`)
        + `</tbody></table><p class="text-secondary note-piscine mb-0">${t("sol.noteEco")}</p>`;
    }
    el.innerHTML = h;
    $("#btnSolaireMeteo")?.addEventListener("click", chargerMeteo);
    for (const [id, k, f] of [["#solConso", "consommation", v => Math.max(0, v)], ["#solAchat", "achat", v => Math.max(0, v)], ["#solReprise", "reprise", v => Math.max(0, v)],
      ["#solPrix", "prixKWc", v => (v > 0 ? v : null)], ["#solFiscal", "fiscal", v => Math.max(0, Math.min(50, v)) / 100]])
      $(id).addEventListener("change", e => { R[k] = f(+e.target.value || 0); garderPrefs(); economie(); afficherPro(); });
    $("#solIntegree").addEventListener("change", e => { R.integree = e.target.value === "1"; garderPrefs(); economie(); afficherPro(); });
  }

  for (const [id, k] of [["#vSolPanneaux", "panneaux"], ["#vSolChaleur", "chaleur"]]) {
    $(id).checked = R[k];
    $(id).addEventListener("change", e => { R[k] = e.target.checked; garderPrefs(); dessiner3D(); });
  }

  $("#exportSolaire").addEventListener("click", async () => {
    if (!r?.prod || !autorise()) return;
    try {
      o.etat(0.3, t("piscine.etatPdf"));
      const { pdfSolaire } = await import("./exportSolaire.js");
      const blob = await pdfSolaire({ r, R, S, G: S.G, lieu: $("#lieu").textContent || "", volume: toit.type === "volume" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Topograph_solaire_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      o.compter?.("export");
    } catch (e) { console.error(e); o.message(t("pro.exportImpossible", { m: e.message })); }
    finally { o.etat(1, ""); }
  });

  function lirePrefs() { try { return JSON.parse(localStorage.getItem(CLE) || "{}"); } catch { return {}; } }
  function garderPrefs() {
    const { marge, plat, Wc, panneaux, chaleur, consommation, achat, reprise, prixKWc, fiscal, integree } = R;
    try { localStorage.setItem(CLE, JSON.stringify({ marge, plat, Wc, panneaux, chaleur, consommation, achat, reprise, prixKWc, fiscal, integree })); } catch { /* stockage indisponible */ }
  }
  o.compte?.addEventListener?.("compte", () => { if (r?.prod) afficherPro(); });

  const api = {
    clic,
    actif: () => outil,
    /** Nouveau lieu : le toit choisi ne vaut plus. */
    nouveauLieu() { if (outil) activer(false); toit = null; r = null; jeton++; vider3D(); majAffichage(); },
    /** Bâtiments affichés ou projet changés : on recalcule les ombres du toit choisi. */
    relancer() { if (toit && r && !r.calcul) { const meteo = r.meteo; calculer(); if (r) r.meteo = meteo; } },
    vider() { if (outil) activer(false); toit = null; r = null; jeton++; vider3D(); majAffichage(); },
  };
  if (import.meta.env.DEV) { api.gratuit = v => { forcerGratuit = v; if (r?.prod) afficherPro(); }; api.resultat = () => r; api.choisir = (E, N, id = null) => { toit = id != null ? { type: "volume", id } : { type: "releve", E, N }; calculer(); }; }
  return api;
}
