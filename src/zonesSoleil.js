// Onglet Soleil, section « Piscine » : une zone choisie parmi les piscines de la mensuration officielle (G.bassins),
// dessinée (polygone, rectangle aux cotes) ou importée (DXF). Pour la zone :
//  - heures de soleil par semaine (masques d'horizon par point, départ au plan d'eau ; gratuit) ;
//  - ensoleillement réel par mois (heures de soleil mesurées par MétéoSuisse ; gratuit) ;
//  - température de l'eau sans chauffage : au-dessus / en dessous de 25 °C par semaine (gratuit), graphique exact
//    (médiane et P10–P90, Pro) ; coût du chauffage (Pro) ; export PDF (Pro).
// Les géométries sont gardées en MN95 absolues (localStorage « ombres.piscines »), indépendantes du centre de la maquette.
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { solEn } from "./grille.js";
import { EAU } from "./piscines.js";
import { traceSol } from "./traceVolume.js";
import { lireDxf } from "./import/lecture.js";
import { UNITES } from "./import/placement.js";
import { t, nombre, entier, date } from "./i18n.js";
import { pointsZone, masquesDegres, facteurCiel, heuresParSemaine, partHoraire, aireEtPerimetre, dansPoly, NB_AZ } from "./semaines.js";
import { stationsProches, seriesStation } from "./climat.js";
import { DEFAUTS, analyser, soleilReelParMois } from "./piscine.js";
import { svgSemaines, svgMois, svgTemperature, imageZone, DEGRADE } from "./graphiquesPiscine.js";

const CLE = "ombres.piscines";
const $ = s => document.querySelector(s);
const echap = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const lireStock = () => { try { return JSON.parse(localStorage.getItem(CLE) || "[]"); } catch { return []; } };
const garderStock = l => { try { localStorage.setItem(CLE, JSON.stringify(l)); } catch { /* stockage indisponible */ } };
const duree = v => { const m = Math.round(v * 60); return t("duree", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") }); };

/**
 * `o` = { scene, S, message, etat, compte, surface: () => Float32Array (grille des obstacles affichés), cleJeu: () => string }
 */
export function brancherZones(o) {
  const { scene, S } = o;
  let zones = lireStock(), choisie = null, outil = null, polygone = [], souris = null, forcerGratuit = false;
  const calculs = new Map(); // id → { cle, promesse, r }
  const trace = traceSol(scene);
  const groupe = new THREE.Group();
  scene.scene.add(groupe);
  (scene.horsAO ||= []).push(groupe);
  const reglages = { ...DEFAUTS, energie: "pac", cop: 4, prix: 0.3, ...lirePrefs() };

  const autorise = () => !forcerGratuit && (!o.compte?.disponible() || o.compte.etat().pro);
  const rel = a => a.map(([e, n]) => [e - S.E0, n - S.N0]);
  const visibles = () => S.G ? zones.filter(z => z.anneaux[0].every(([e, n]) => Math.max(Math.abs(e - S.E0), Math.abs(n - S.N0)) < S.G.R - 2)) : [];
  const zoneChoisie = () => visibles().find(z => z.id === choisie) || null;

  /* ---------------------------------------------------------------- outils */
  const BOUTONS = { choisir: "#btnPiscineChoisir", polygone: "#btnPiscineDessiner", rectangle: "#btnPiscineRectangle" };
  function activer(nom) {
    outil = outil === nom ? null : nom;
    polygone = []; souris = null; trace.montrer(null);
    for (const [k, s] of Object.entries(BOUTONS)) $(s).setAttribute("aria-pressed", String(outil === k));
    document.body.classList.toggle("choix-centre", !!outil);
    o.message(outil ? t(`piscine.aide.${outil}`) : "", outil ? 0 : 1);
  }
  for (const [k, s] of Object.entries(BOUTONS)) $(s).addEventListener("click", () => { if (S.G) activer(k); });
  addEventListener("keydown", e => {
    if (!outil) return;
    if (e.key === "Escape") activer(outil);
    else if (e.key === "Enter" && outil === "polygone") finirPolygone();
  });
  scene.renderer.domElement.addEventListener("pointermove", e => {
    if (outil !== "polygone" || !polygone.length) return;
    souris = scene.pointSol(e);
    trace.montrer(souris ? [...polygone, souris] : polygone, polygone.length >= 2);
  });

  function nouvelleZone(z) {
    const n = zones.reduce((m, x) => Math.max(m, +(x.nom.match(/(\d+)$/)?.[1] || 0)), 0) + 1;
    z = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, nom: `${t("piscine.nom")} ${n}`, ...z };
    zones.push(z); garderStock(zones);
    choisie = z.id;
    majListe(); dessiner3D(); calculer();
    return z;
  }

  /** Clic sur la maquette : pris par l'outil actif (renvoie vrai), sinon laissé à la sélection de parcelle. */
  function clic(e) {
    if (!outil || !S.G) return false;
    const p = scene.pointSol(e);
    if (!p) return true;
    if (outil === "choisir") {
      const B = (S.G.bassins || []).find(b => dansPoly(p[0], p[1], [b.anneau, ...(b.trous || [])]));
      if (!B) { o.message(t("piscine.aucuneIci")); return true; }
      activer(null);
      const abs = a => a.map(([x, y]) => [Math.round((x + S.E0) * 100) / 100, Math.round((y + S.N0) * 100) / 100]);
      const deja = zones.find(z => z.source === "mensuration" && Math.hypot(z.anneaux[0][0][0] - (B.anneau[0][0] + S.E0), z.anneaux[0][0][1] - (B.anneau[0][1] + S.N0)) < 0.05);
      if (deja) { choisie = deja.id; majListe(); dessiner3D(); calculer(); return true; }
      nouvelleZone({ source: "mensuration", anneaux: [abs(B.anneau), ...(B.trous || []).map(abs)], niveau: B.niveau });
    } else if (outil === "polygone") {
      if (polygone.length >= 3 && Math.hypot(p[0] - polygone[0][0], p[1] - polygone[0][1]) < 0.6) return finirPolygone(), true;
      polygone.push(p);
      trace.montrer(polygone, polygone.length >= 3);
    } else if (outil === "rectangle") {
      activer(null);
      const r = { centre: [S.E0 + p[0], S.N0 + p[1]], L: +$("#cotLongueur").value || 8, l: +$("#cotLargeur").value || 4, angle: +$("#cotAngle").value || 0 };
      nouvelleZone({ source: "dessin", rect: r, anneaux: [rectangle(r)] });
    }
    return true;
  }
  function finirPolygone() {
    if (polygone.length < 3) { o.message(t("piscine.troisPoints")); return; }
    const pts = polygone.map(([x, y]) => [Math.round((x + S.E0) * 100) / 100, Math.round((y + S.N0) * 100) / 100]);
    activer(null);
    nouvelleZone({ source: "dessin", anneaux: [pts] });
  }
  /** Rectangle aux cotes : centre, longueur (axe tourné de `angle` degrés depuis l'est, sens trigonométrique), largeur. */
  function rectangle({ centre: [E, N], L, l, angle }) {
    const a = angle * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, u]) => [E + s * L / 2 * ux - u * l / 2 * uy, N + s * L / 2 * uy + u * l / 2 * ux].map(v => Math.round(v * 100) / 100));
  }
  let attenteCotes = null;
  for (const id of ["#cotLongueur", "#cotLargeur", "#cotAngle"]) $(id).addEventListener("input", () => {
    const z = zoneChoisie();
    if (!z?.rect) return;
    z.rect = { ...z.rect, L: Math.max(1, +$("#cotLongueur").value || z.rect.L), l: Math.max(1, +$("#cotLargeur").value || z.rect.l), angle: +$("#cotAngle").value || 0 };
    z.anneaux = [rectangle(z.rect)];
    garderStock(zones); dessiner3D(); majListe();
    clearTimeout(attenteCotes); attenteCotes = setTimeout(calculer, 500);
  });

  // import DXF : polylignes fermées (calque « piscine », « bassin », « pool »… de préférence)
  $("#btnPiscineImporter").addEventListener("click", () => { if (S.G) $("#fichierPiscine").click(); });
  $("#fichierPiscine").addEventListener("change", async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const D = lireDxf(await f.text());
      let fermees = D.lignes.filter(l => l.ferme && l.pts.length >= 3);
      const nommees = fermees.filter(l => /piscin|bassin|pool|schwimm|becken/i.test(l.calque || ""));
      if (nommees.length) fermees = nommees;
      if (!fermees.length) { o.message(t("piscine.dxfVide")); return; }
      fermees = fermees.slice(0, 10);
      const ech = UNITES[D.unites] || 1, mn95 = fermees[0].pts[0][0] * ech > 2e6;
      let dx = 0, dy = 0;
      if (!mn95) { // origine locale : la première polyligne est centrée sur la maquette
        const p = fermees[0].pts;
        dx = S.E0 - p.reduce((s, q) => s + q[0], 0) / p.length * ech; dy = S.N0 - p.reduce((s, q) => s + q[1], 0) / p.length * ech;
      }
      for (const l of fermees) nouvelleZone({ source: "import", anneaux: [l.pts.map(q => [Math.round((q[0] * ech + dx) * 100) / 100, Math.round((q[1] * ech + dy) * 100) / 100])] });
      o.message(t(mn95 ? "piscine.dxfMn95" : "piscine.dxfLocal", { n: fermees.length }));
    } catch (err) { console.error(err); o.message(t("piscine.dxfErreur", { m: err.message })); }
  });

  /* ---------------------------------------------------------------- liste et 3D */
  function majListe() {
    const l = visibles();
    $("#listePiscines").innerHTML = l.map(z => {
      const { aire } = aireEtPerimetre(z.anneaux);
      return `<li class="${z.id === choisie ? "choisie" : ""}" data-id="${z.id}"><button type="button" class="nom-zone" data-choisir>${echap(z.nom)}</button>`
        + `<span class="text-secondary">${nombre(aire, 0)} m²</span><button type="button" class="btn-zone" data-renommer title="${echap(t("piscine.renommer"))}" aria-label="${echap(t("piscine.renommer"))}">✎</button>`
        + `<button type="button" class="btn-zone" data-supprimer title="${echap(t("piscine.supprimer"))}" aria-label="${echap(t("piscine.supprimer"))}">✕</button></li>`;
    }).join("");
    const z = zoneChoisie();
    $("#piscineCotes").hidden = !z?.rect;
    if (z?.rect) { $("#cotLongueur").value = z.rect.L; $("#cotLargeur").value = z.rect.l; $("#cotAngle").value = z.rect.angle; }
    if (!z) { $("#resultatPiscine").hidden = true; $("#piscinePro").hidden = true; $("#exportPiscine").hidden = true; }
  }
  $("#listePiscines").addEventListener("click", e => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const z = zones.find(x => x.id === li.dataset.id);
    if (e.target.closest("[data-supprimer]")) {
      zones = zones.filter(x => x !== z); garderStock(zones); calculs.delete(z.id);
      if (choisie === z.id) choisie = visibles()[0]?.id || null;
      majListe(); dessiner3D(); if (choisie) calculer();
    } else if (e.target.closest("[data-renommer]")) {
      const n = prompt(t("piscine.renommer"), z.nom);
      if (n?.trim()) { z.nom = n.trim().slice(0, 60); garderStock(zones); majListe(); afficher(); }
    } else { choisie = z.id; majListe(); dessiner3D(); calculer(); }
  });

  const mats = [];
  function dessiner3D() {
    for (const x of [...groupe.children]) { groupe.remove(x); x.geometry.dispose(); }
    if (!S.G) return scene.demander();
    for (const z of visibles()) {
      const sel = z.id === choisie, niv = niveauEau(z);
      let m = mats[sel ? 1 : 0];
      if (!m) {
        m = mats[sel ? 1 : 0] = new LineMaterial({ linewidth: sel ? 4 : 2, transparent: true, depthWrite: false, fog: false, color: sel ? 0x1d6fd1 : 0x4b8fe0 });
        m.uniforms.resolution = scene.mat.trait.uniforms.resolution;
      }
      for (const a of z.anneaux) {
        const pos = [], P = [...a, a[0]].map(([e, n]) => [e - S.E0, n - S.N0]);
        for (let k = 0; k + 1 < P.length; k++) {
          const [p, q] = [P[k], P[k + 1]], nb = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.5));
          for (let i = k ? 1 : 0; i <= nb; i++) {
            const x = p[0] + (q[0] - p[0]) * i / nb, y = p[1] + (q[1] - p[1]) * i / nb;
            pos.push(x, (z.niveau != null ? niv + 0.04 : solEn(S.G, x, y) + 0.12) - scene.zRef, -y);
          }
        }
        const g = new LineGeometry(); g.setPositions(pos);
        const l = new Line2(g, m); l.renderOrder = 37; l.frustumCulled = false;
        groupe.add(l);
      }
    }
    scene.demander();
  }

  /** Altitude du plan d'eau (m) : bassin officiel = niveau − 0,20 m ; dessinée = terrain médian du contour − 0,20 m. */
  function niveauEau(z) {
    if (z.niveau != null) return z.niveau - EAU;
    const v = [];
    for (const [e, n] of z.anneaux[0]) v.push(solEn(S.G, e - S.E0, n - S.N0));
    v.sort((a, b) => a - b);
    return v[v.length >> 1] - EAU;
  }

  /* ---------------------------------------------------------------- calcul de l'ensoleillement */
  function calculer() {
    const z = zoneChoisie();
    if (!z || !S.G || !S.horizon) return;
    const cle = `${o.cleJeu()}|${S.E0}|${S.N0}|${S.jour.slice(0, 4)}|${JSON.stringify(z.anneaux)}`;
    const c = calculs.get(z.id);
    if (c?.cle === cle) { if (c.r) afficher(); return; }
    const anneaux = z.anneaux.map(rel), { ij, xy } = pointsZone(S.G, anneaux), N = xy.length, z0 = niveauEau(z);
    const pts = new Float32Array(5 * N);
    for (let q = 0; q < N; q++) pts.set([ij[2 * q], ij[2 * q + 1], z0, 2.0, 0.3], 5 * q);
    const surface = o.surface(), debut = performance.now();
    const nb = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1, Math.ceil(N / 40)));
    const parLot = Math.ceil(N / nb), masques = new Uint8Array(N * NB_AZ);
    const entree = { cle, r: null };
    calculs.set(z.id, entree);
    o.etat(0.05, t("piscine.etatMasques"));
    let restants = nb;
    entree.promesse = new Promise(fini => {
      for (let k = 0; k < nb; k++) {
        const w = new Worker(new URL("./masques.worker.js", import.meta.url), { type: "module" });
        w.onmessage = ({ data }) => {
          w.terminate();
          masques.set(data.masques, data.debut * NB_AZ);
          o.etat(0.05 + 0.8 * (nb - restants + 1) / nb, t("piscine.etatMasques"));
          if (--restants) return;
          if (calculs.get(z.id) !== entree) return fini(null);
          const m = masquesDegres(masques, N, S.horizon), an = +S.jour.slice(0, 4);
          const sem = heuresParSemaine(m, N, an, S.lat, S.lon, S.horizon);
          const horaire = partHoraire(m, N, S.lat, S.lon, S.horizon);
          const { aire, perim } = aireEtPerimetre(z.anneaux);
          entree.r = { N, xy, anneaux, z0, svf: facteurCiel(m, N), sem, horaire, aire, perim, an, ms: performance.now() - debut, temp: null };
          o.etat(1, "");
          fini(entree.r);
          if (zoneChoisie() === z) afficher();
        };
        w.postMessage({ surface, n: S.G.n, c: S.G.c, pts: pts.slice(5 * k * parLot, 5 * Math.min(N, (k + 1) * parLot)), debut: k * parLot });
      }
    });
  }

  /* ---------------------------------------------------------------- affichage */
  const sel = (id, opts, val) => `<select class="form-select form-select-sm" id="${id}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(val) ? " selected" : ""}>${echap(l)}</option>`).join("")}</select>`;
  function afficher() {
    const z = zoneChoisie(), r = z && calculs.get(z.id)?.r;
    if (!r) return;
    const { sem } = r, part = sem.saison.possibles ? sem.saison.recues / sem.saison.possibles : 0;
    const moyAn = sem.recues.reduce((a, b) => a + b, 0) / 52;
    const maxPt = Math.max(...sem.parPointSaison), minPt = Math.min(...sem.parPointSaison);
    let h = `<div class="mesures-lieu">${t("piscine.entete", { nom: echap(z.nom), aire: nombre(r.aire, 0), eau: nombre(r.z0, 1) })}</div>`
      + `<dl class="mesures"><div><dt>${t("piscine.saison")}</dt><dd class="principale">${duree(sem.saison.recues)}</dd></div>`
      + `<div><dt>${t("piscine.annee")}</dt><dd>${duree(moyAn)}</dd></div><div><dt>${t("piscine.partSoleil")}</dt><dd>${nombre(part * 100, 0)} %</dd></div></dl>`
      + `<div class="text-secondary">${t("piscine.semainesTitre")}</div><div class="graphique-piscine">${svgSemaines(sem.recues, sem.possibles)}</div>`
      + `<div class="legende-piscine small text-secondary"><span><i style="background:#e8a317"></i>${t("piscine.legRecu")}</span><span><i style="background:#9aa3ad;opacity:.5"></i>${t("piscine.legPossible")}</span></div>`
      + `<details class="mt-1"><summary class="text-secondary">${t("piscine.tableau")}</summary><table class="table table-sm small mb-1 tableau-semaines"><thead><tr><th>${t("piscine.colSemaine")}</th><th>${t("piscine.colDebut")}</th><th>${t("piscine.colHJour")}</th><th>${t("piscine.colHSemaine")}</th><th>${t("piscine.colPart")}</th></tr></thead><tbody>`
      + [...sem.recues].map((v, w) => `<tr><td>${w + 1}</td><td>${date(new Date(Date.UTC(r.an, 0, 1 + 7 * w)), { day: "numeric", month: "short" })}</td><td>${nombre(v, 1)}</td><td>${nombre(v * 7, 0)}</td><td>${sem.possibles[w] ? nombre(v / sem.possibles[w] * 100, 0) + " %" : "–"}</td></tr>`).join("")
      + `</tbody></table></details>`
      + `<div class="text-secondary mt-2">${t("piscine.carteTitre", { min: duree(minPt), max: duree(maxPt) })}</div><div id="imagePiscine" class="image-piscine"></div>`
      + `<div class="degrade" style="background:${DEGRADE}"></div><div class="d-flex justify-content-between text-secondary"><span>${duree(0)}</span><span>${duree(sem.saison.possibles)}</span></div>`
      + `<p class="text-secondary note-piscine mt-1">${t("piscine.noteSoleil", { n: entier(r.N), svf: nombre(r.svf * 100, 0), s: nombre(r.ms / 1000, 1) })}</p>`;
    // température de l'eau
    h += `<div class="sous-titre">${t("piscine.tempTitre")}</div>`
      + `<div class="reglages-piscine">`
      + `<label>${t("piscine.profondeur")}<input type="number" class="form-control form-control-sm" id="pscProf" min="0.5" max="4" step="0.1" value="${reglages.profondeur}"></label>`
      + `<label>${t("piscine.fond")}${sel("pscFond", [["clair", t("piscine.fondClair")], ["fonce", t("piscine.fondFonce")]], reglages.fond)}</label>`
      + `<label>${t("piscine.bache")}${sel("pscBache", [["aucune", t("piscine.bacheAucune")], ["nuit", t("piscine.bacheNuit")]], reglages.bache)}</label>`
      + `<label>${t("piscine.vent")}${sel("pscVent", [["abritee", t("piscine.ventAbritee")], ["normal", t("piscine.ventNormal")], ["exposee", t("piscine.ventExposee")]], reglages.vent)}</label></div>`;
    if (!r.temp) h += `<button type="button" class="btn btn-sm btn-primary w-100 mt-2" id="btnTempPiscine">${t("piscine.estimer")}</button><p class="text-secondary note-piscine mt-1">${t("piscine.noteDonnees")}</p>`;
    else if (r.temp.erreur) h += `<p class="text-danger mt-2">${echap(r.temp.erreur)}</p><button type="button" class="btn btn-sm btn-outline-secondary w-100" id="btnTempPiscine">${t("piscine.reessayer")}</button>`;
    else h += blocTemperatureLibre(r);
    $("#resultatPiscine").innerHTML = h;
    $("#resultatPiscine").hidden = false;
    $("#imagePiscine").append(imageZone(S.G, r.anneaux, r.xy, r.sem.parPointSaison, r.sem.saison.possibles, { px: 8 }));
    $("#btnTempPiscine")?.addEventListener("click", () => estimerTemperature(z, r));
    for (const [id, k, num] of [["#pscProf", "profondeur", true], ["#pscFond", "fond"], ["#pscBache", "bache"], ["#pscVent", "vent"]])
      $(id).addEventListener("change", e => { reglages[k] = num ? Math.max(0.5, Math.min(4, +e.target.value || 1.5)) : e.target.value; garderPrefs(); if (r.temp && !r.temp.erreur) { r.temp.analyse = null; r.temp.chauffage = null; estimerTemperature(z, r); } });
    afficherPro(z, r);
  }

  /** Partie gratuite : ensoleillement réel par mois, et semaines au-dessus / en dessous de 25 °C. */
  function blocTemperatureLibre(r) {
    const T = r.temp, a = T.analyse, st = T.station;
    let h = `<div class="text-secondary mt-1">${t("piscine.station", { nom: echap(st.nom), km: nombre(st.km, 1), alt: entier(st.alt), annees: `${a.annees[0]}–${a.annees[a.annees.length - 1]}`, n: a.annees.length })}</div>`;
    if (st.km > 15 || Math.abs(st.denivele) > 300) h += `<div class="text-warning-emphasis">${t("piscine.stationLoin")}</div>`;
    h += `<div class="text-secondary mt-2">${t("piscine.moisTitre")}</div><div class="graphique-piscine">${svgMois(T.mois)}</div>`;
    const sais = T.mois.filter(m => m.m >= 4 && m.m <= 8), clair = sais.reduce((s, m) => s + m.clair, 0) / 5, reel = sais.reduce((s, m) => s + m.med, 0) / 5;
    h += `<div class="text-secondary">${t("piscine.moisResume", { clair: duree(clair), reel: duree(reel), p: nombre(reel / clair * 100, 0) })}</div>`;
    const au = a.semaines.filter(s => s.med >= reglages.seuil).length;
    h += `<div class="mt-2">${t("piscine.seuilTitre", { seuil: reglages.seuil })}</div><div class="semaines-seuil" role="list">`
      + a.semaines.map(s => { const d = date(new Date(Date.UTC(2025, 0, 1 + 7 * s.w)), { day: "numeric", month: "short" }), ok = s.med >= reglages.seuil;
        return `<span role="listitem" class="${ok ? "chaud" : "froid"}" title="${echap(t(ok ? "piscine.semaineAu" : "piscine.semaineSous", { d, seuil: reglages.seuil }))}"></span>`; }).join("")
      + `</div><div class="d-flex justify-content-between text-secondary"><span>${t("piscine.mai")}</span><span>${t("piscine.septembre")}</span></div>`
      + `<div>${t("piscine.seuilResume", { n: au, total: a.semaines.length, seuil: reglages.seuil })}</div>`
      + `<p class="text-secondary note-piscine mt-1">${t("piscine.noteTemp")}</p>`;
    return h;
  }

  /** Partie Pro : graphique exact, chauffage. Pour un compte gratuit, un simple rappel (grisé par pro.js). */
  function afficherPro(z, r) {
    const el = $("#piscinePro");
    el.hidden = false;
    $("#exportPiscine").hidden = false;
    $("#exportPiscine").disabled = !r.temp?.analyse;
    if (!autorise()) { el.innerHTML = `<div class="sous-titre">${t("piscine.proTitre")} <span class="badge-pro">Pro</span></div><p class="text-secondary mb-0">${t("piscine.proTexte")}</p>`; return; }
    if (!r.temp?.analyse) { el.innerHTML = `<div class="sous-titre">${t("piscine.proTitre")}</div><p class="text-secondary mb-0">${t("piscine.proAttente")}</p>`; return; }
    const a = r.temp.analyse;
    let h = `<div class="sous-titre">${t("piscine.courbeTitre")}</div><div class="graphique-piscine">${svgTemperature(a.semaines, reglages.seuil)}</div>`
      + `<dl class="mesures mt-1"><div><dt>${t("piscine.joursAu", { seuil: reglages.seuil })}</dt><dd class="principale">${nombre(a.jours.med, 0)}</dd></div>`
      + `<div><dt>${t("piscine.fourchette")}</dt><dd>${nombre(a.jours.p10, 0)}–${nombre(a.jours.p90, 0)}</dd></div><div><dt>${t("piscine.sansOmbre")}</dt><dd>${nombre(a.joursSansOmbre.med, 0)}</dd></div></dl>`;
    h += `<div class="sous-titre">${t("piscine.chauffTitre")}</div><div class="reglages-piscine">`
      + `<label>${t("piscine.consigne")}<input type="number" class="form-control form-control-sm" id="pscConsigne" min="20" max="34" step="0.5" value="${reglages.consigne}"></label>`
      + `<label>${t("piscine.energie")}${sel("pscEnergie", [["pac", t("piscine.pac")], ["direct", t("piscine.direct")]], reglages.energie)}</label>`
      + `<label>${t("piscine.cop")}<input type="number" class="form-control form-control-sm" id="pscCop" min="1" max="8" step="0.1" value="${reglages.cop}"${reglages.energie === "direct" ? " disabled" : ""}></label>`
      + `<label>${t("piscine.prix")}<input type="number" class="form-control form-control-sm" id="pscPrix" min="0" max="2" step="0.01" value="${reglages.prix}"></label></div>`;
    const C = r.temp.chauffage ||= chauffage(r);
    h += tableauChauffage(C);
    el.innerHTML = h;
    for (const [id, k] of [["#pscConsigne", "consigne"], ["#pscEnergie", "energie"], ["#pscCop", "cop"], ["#pscPrix", "prix"]])
      $(id).addEventListener("change", e => {
        reglages[k] = k === "energie" ? e.target.value : Math.max(0, +e.target.value || DEFAUTS[k] || 0);
        garderPrefs();
        if (k === "consigne") r.temp.chauffage = null;
        afficherPro(z, r);
      });
  }
  function chauffage(r) {
    const zr = zonePourModele(r), base = { ...reglages, correctionT: r.temp.correctionT, avecChauffage: true };
    return { sans: analyser(r.temp.series, zr, { ...base, bache: "aucune" }).chauffage, avec: analyser(r.temp.series, zr, { ...base, bache: "nuit" }).chauffage, consigne: reglages.consigne };
  }
  /** Tableau par mois (kWh thermiques, puissance du jour le plus exigeant), total de la saison et coût en francs. */
  function tableauChauffage(C) {
    const cop = reglages.energie === "direct" ? 1 : Math.max(1, reglages.cop), chf = kwh => kwh / cop * reglages.prix;
    const nomMois = m => date(new Date(Date.UTC(2025, m, 15)), { month: "short" });
    let h = `<table class="table table-sm small mb-1 tableau-chauffage"><thead><tr><th></th><th>${t("piscine.sansBache")}</th><th>${t("piscine.avecBache")}</th></tr></thead><tbody>`;
    C.sans.mois.forEach((m, k) => {
      const b = C.avec.mois[k];
      h += `<tr><td>${nomMois(m.m)}</td><td>${entier(m.kWh.med)} kWh<br><span class="text-secondary">${nombre(m.W.med / 1000, 1)} kW</span></td><td>${entier(b.kWh.med)} kWh<br><span class="text-secondary">${nombre(b.W.med / 1000, 1)} kW</span></td></tr>`;
    });
    h += `<tr class="total"><td>${t("piscine.saisonTotal")}</td><td>${entier(C.sans.kWh.med)} kWh<br><span class="text-secondary">${entier(C.sans.kWh.p10)}–${entier(C.sans.kWh.p90)}</span></td><td>${entier(C.avec.kWh.med)} kWh<br><span class="text-secondary">${entier(C.avec.kWh.p10)}–${entier(C.avec.kWh.p90)}</span></td></tr>`;
    h += `<tr class="total"><td>${t("piscine.cout")}</td><td>CHF ${entier(chf(C.sans.kWh.med))}</td><td>CHF ${entier(chf(C.avec.kWh.med))}</td></tr></tbody></table>`;
    h += `<p class="text-secondary note-piscine mb-0">${t("piscine.noteChauffage", { consigne: C.consigne, mise: entier(C.sans.miseEnTemp.med), cop: nombre(cop, 1), prix: nombre(reglages.prix, 2) })}</p>`;
    return h;
  }
  $("#exportPiscine").addEventListener("click", async () => {
    const z = zoneChoisie(), r = z && calculs.get(z.id)?.r;
    if (!r?.temp?.analyse || !autorise()) return;
    try {
      o.etat(0.3, t("piscine.etatPdf"));
      const { pdfPiscine } = await import("./exportZones.js");
      const blob = await pdfPiscine({ z, r, reglages, S, lieu: $("#lieu").textContent || "", G: S.G, chauffage: r.temp.chauffage || (r.temp.chauffage = chauffage(r)) });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Topograph_${(z.nom || "piscine").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-")}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      o.compter?.("export");
    } catch (e) { console.error(e); o.message(t("pro.exportImpossible", { m: e.message })); }
    finally { o.etat(1, ""); }
  });

  /* ---------------------------------------------------------------- température */
  const zonePourModele = r => ({ aire: r.aire, perim: r.perim, f: r.horaire.f, svf: r.svf, hauteur: r.horaire.hauteur });
  async function estimerTemperature(z, r) {
    try {
      if (!r.temp?.series) {
        o.etat(0.1, t("piscine.etatMeteo"));
        const [E, N] = [S.E0 + r.xy[0][0], S.N0 + r.xy[0][1]];
        const liste = (await stationsProches(E, N, r.z0)).slice(0, 3);
        let series = null, station = null, derniere = null;
        for (const st of liste) {
          try { series = await seriesStation(st.abr, f => o.etat(0.1 + 0.7 * f, t("piscine.etatMeteoStation", { nom: st.nom }))); station = st; break; }
          catch (e) { derniere = e; console.warn("MétéoSuisse", st.abr, e.message); }
        }
        if (!series) throw derniere || new Error("MétéoSuisse");
        r.temp = { series, station, correctionT: -0.0065 * (r.z0 - station.alt), mois: soleilReelParMois(series, r.horaire.f) };
      }
      o.etat(0.9, t("piscine.etatSimulation"));
      await new Promise(f => setTimeout(f, 20));
      r.temp.analyse = analyser(r.temp.series, zonePourModele(r), { ...reglages, correctionT: r.temp.correctionT, avecChauffage: false });
      r.temp.chauffage = null;
    } catch (e) {
      console.error(e);
      r.temp = { erreur: t("piscine.meteoIndisponible", { m: e.message }) };
    } finally { o.etat(1, ""); }
    if (zoneChoisie() === z) afficher();
  }

  function lirePrefs() { try { return JSON.parse(localStorage.getItem("ombres.piscineReglages") || "{}"); } catch { return {}; } }
  function garderPrefs() {
    const { profondeur, fond, bache, vent, consigne, energie, cop, prix } = reglages;
    try { localStorage.setItem("ombres.piscineReglages", JSON.stringify({ profondeur, fond, bache, vent, consigne, energie, cop, prix })); } catch { /* stockage indisponible */ }
  }

  o.compte?.addEventListener?.("compte", () => { const z = zoneChoisie(), r = z && calculs.get(z.id)?.r; if (r) afficherPro(z, r); });

  const api = {
    clic,
    actif: () => !!outil,
    /** Nouveau lieu chargé (horizon compris) : zones du lieu, contours 3D, calcul de la zone choisie. */
    nouveauLieu() {
      calculs.clear();
      if (outil) activer(outil);
      if (!zoneChoisie()) choisie = visibles()[0]?.id || null;
      majListe(); dessiner3D(); calculer();
    },
    /** Bâtiments affichés ou année changés : la zone choisie est recalculée si sa clé a changé. */
    relancer() { calculer(); },
    vider() { if (outil) activer(outil); for (const x of [...groupe.children]) { groupe.remove(x); x.geometry.dispose(); } $("#resultatPiscine").hidden = true; },
  };
  if (import.meta.env.DEV) { api.gratuit = v => { forcerGratuit = v; afficher(); }; api.resultat = () => calculs.get(choisie)?.r; }
  return api;
}
