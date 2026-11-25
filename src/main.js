import "bootstrap/dist/css/bootstrap.min.css";
import "./style.css";
import { chercher, parcelleEn, tuilesNuage, tuilesGrille, versWgs } from "./geo.js";
import { chargerNuage } from "./nuage.js";
import { depuisPoints, depuisRasters } from "./grille.js";
import { Scene3D } from "./scene.js";
import { essaiRoofer, maillageRoofer } from "./roofer.js";
import * as THREE from "three";
import { positionSoleil, directionSoleil, dateA } from "./soleil.js";
import { profilHorizon, horizonA } from "./horizon.js";
import { dessinerDiagramme, soleilVisible, heureSousPointeur } from "./diagramme.js";
import { themeInitial, appliquerTheme } from "./themes.js";
import { urlFond, COUCHES } from "./fond.js";
import { zoneHeures, soleilsPeriode, carreauxFacades, maillagesHeures } from "./heures.js";
import { profilCoupe, dessinerCoupe } from "./coupe.js";
import { hameau } from "./demo.js";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const S = { jour: aujourdhui(), minutes: arrondi(new Date().getHours() * 60 + new Date().getMinutes()) };
let T = appliquerTheme(themeInitial());
const scene = new Scene3D($("#vue"), T);

function aujourdhui() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function arrondi(m) { return Math.round(m / 5) * 5; }
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const duree = v => { const m = Math.round(v * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
const echap = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let finMessage;
function message(texte, tenir = 6000) {
  clearTimeout(finMessage);
  $("#message").hidden = !texte; $("#message").textContent = texte || "";
  if (texte && tenir) finMessage = setTimeout(() => $("#message").hidden = true, tenir);
}

/* ------------------------------------------------------------------ thèmes */
// mode jour (maquette claire) / nuit (bleu sombre) : un seul bouton
function marquerTheme() {
  const nuit = document.body.dataset.theme === "nuit";
  $("#themes").innerHTML = `<button type="button" class="actif" title="${nuit ? "Passer en mode jour" : "Passer en mode nuit"}">${nuit ? "☀︎ Mode jour" : "☾ Mode nuit"}</button>`;
}
$("#themes").addEventListener("click", () => {
  T = appliquerTheme(document.body.dataset.theme === "nuit" ? "maquette" : "nuit");
  marquerTheme();
  scene.appliquerTheme(T);
  if (S.resultat) afficherResultat();
  if (S.coupe) majCoupe(S.coupe.A, S.coupe.B);
});
marquerTheme();

/* ------------------------------------------------------------------ recherche */
function brancherRecherche(champ) {
  const liste = champ.parentElement.querySelector(".suggestions");
  let ctrl, choix = [];
  champ.addEventListener("input", () => {
    clearTimeout(ctrl?.t);
    const q = champ.value.trim();
    if (q.length < 2) { liste.hidden = true; return; }
    ctrl?.abort?.();
    const c = ctrl = new AbortController();
    c.t = setTimeout(async () => {
      try {
        choix = await chercher(q, c.signal);
        liste.innerHTML = choix.map((r, k) =>
          `<button type="button" class="list-group-item list-group-item-action" data-k="${k}"><span class="badge text-bg-light me-2">${r.type}</span>${echap(r.label)}</button>`).join("")
          || `<div class="list-group-item text-secondary">Aucun résultat</div>`;
        liste.hidden = false;
      } catch (e) { if (e.name !== "AbortError") console.error(e); }
    }, 250);
  });
  champ.addEventListener("keydown", e => { if (e.key === "Enter" && choix[0]) aller(choix[0]); if (e.key === "Escape") liste.hidden = true; });
  liste.addEventListener("mousedown", e => { const b = e.target.closest("[data-k]"); if (b) aller(choix[+b.dataset.k]); });
  champ.addEventListener("blur", () => setTimeout(() => liste.hidden = true, 150));
}
brancherRecherche($("#q")); brancherRecherche($("#q2"));

function aller(r) {
  $$(".suggestions").forEach(l => l.hidden = true);
  $("#q").value = r.label; $("#q2").value = "";
  location.hash = `e=${Math.round(r.E)}&n=${Math.round(r.N)}&l=${encodeURIComponent(r.label)}&t=${r.type}`;
}
window.addEventListener("hashchange", depuisAdresse);

/* ------------------------------------------------------------------ accueil */
// décor animé : un hameau inventé, le soleil qui passe, la vue qui tourne lentement
function accueil() {
  tache++;
  annulerCalcul();
  document.body.classList.add("accueil");
  $("#panneau").hidden = $("#diagramme").hidden = $("#coupe").hidden = true;
  message("");
  Object.assign(S, { lat: null, lon: null, G: null, horizon: null, zone: null, facades: null, resultat: null, coupe: null, heuresDemandees: false });
  const D = hameau();
  scene.construire(D.G, D.nuage, D.parcelle, null);
  scene.voirFacades(false);
  scene.camera.position.set(-78, 52, 96);
  scene.controls.autoRotate = true; scene.controls.autoRotateSpeed = 0.5;
  scene.decalage = 0.17; scene.taille();
  let avant = 0, u = 0.3, sens = 1;
  scene.animation = t => {
    if (t - avant < 70) return;
    avant = t;
    u += sens * 0.0035;
    if (u > 0.94 || u < 0.06) sens = -sens;
    const az = (105 + 150 * u) * Math.PI / 180, h = (10 + 40 * Math.sin(Math.PI * u)) * Math.PI / 180;
    scene.placerSoleil([Math.sin(az) * Math.cos(h), Math.sin(h), -Math.cos(az) * Math.cos(h)], true);
  };
}
function quitterAccueil() {
  document.body.classList.remove("accueil");
  scene.animation = null;
  scene.decalage = 0; scene.taille();
}

/* ------------------------------------------------------------------ chargement d'un lieu */
let tache = 0;
function etat(f, texte) {
  $("#etat").hidden = f >= 1;
  $("#etatTexte").textContent = texte;
  $("#etatBarre").style.width = `${Math.round(f * 100)}%`;
}

async function depuisAdresse() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get("e")) return accueil();
  const E = +h.get("e"), N = +h.get("n"), id = ++tache;
  annulerCalcul();
  quitterAccueil();
  $("#panneau").hidden = false; $("#commandes").hidden = true; $("#heures").hidden = true; $("#diagramme").hidden = $("#coupe").hidden = true;
  $("#lieu").textContent = h.get("l") || `${E}, ${N}`;
  $("#lieuType").textContent = h.get("t") || "";
  $("#source").textContent = "";
  message("");
  try {
    etat(0.02, "Parcelle…");
    const parcelle = await parcelleEn(E, N);
    if (id !== tache) return;
    // centre et rayon : la parcelle et ~120 m autour (bâtiments voisins, arbres)
    let E0 = E, N0 = N, demi = 20;
    if (parcelle) {
      const xs = parcelle.anneaux.flat().map(p => p[0]), ys = parcelle.anneaux.flat().map(p => p[1]);
      E0 = (Math.min(...xs) + Math.max(...xs)) / 2; N0 = (Math.min(...ys) + Math.max(...ys)) / 2;
      demi = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
      $("#lieuType").textContent = `Parcelle ${parcelle.numero} · ${parcelle.canton}${h.get("t") === "Adresse" ? " · " + h.get("l") : ""}`;
      $("#lieu").textContent = (h.get("l") || "").replace(/\s*\(CH.*\)$/, "");
    } else message("Pas de parcelle trouvée à cet endroit : analyse autour du point.", 0);
    E0 = Math.round(E0); N0 = Math.round(N0);
    const R = Math.min(300, Math.max(150, Math.ceil(demi + 120)));
    const boite = [E0 - R, N0 - R, E0 + R, N0 + R];
    const rel = parcelle ? { ...parcelle, anneauxRel: parcelle.anneaux.map(a => a.map(([e, n]) => [e - E0, n - N0])) } : { anneauxRel: [] };

    etat(0.05, "Recherche du relevé laser…");
    let G, nuage = null, source;
    const copc = await tuilesNuage(boite);
    if (id !== tache) return;
    if (copc) {
      nuage = await chargerNuage(copc, boite, [E0, N0], 0.5, (f, t) => id === tache && etat(0.05 + 0.7 * f, t));
      if (id !== tache) return;
      etat(0.78, "Reconstruction du terrain, des bâtiments et des arbres…");
      await pause();
      G = depuisPoints(nuage, R);
      source = `Nuage de points swissSURFACE3D ${[...new Set(copc.map(t => t.annee))].join(", ")} · ${nuage.n.toLocaleString("fr-CH")} points`;
    } else {
      const g = await tuilesGrille(boite);
      G = await depuisRasters(g, [E0, N0], R, 0.5, (f, t) => id === tache && etat(0.05 + 0.7 * f, t));
      if (id !== tache) return;
      source = `Relevé laser récent pas encore publié ici : modèles en grille 0,5 m (terrain ${[...new Set(g.terrain.map(t => t.annee))].join(", ")}, surface ${[...new Set(g.surface.map(t => t.annee))].join(", ")}). Bâtiments et arbres séparés par la forme (toit lisse, arbre rugueux) : moins fiable.`;
    }
    $("#source").textContent = source;
    [S.lon, S.lat] = versWgs(E0, N0);
    Object.assign(S, { E0, N0, parcelle: rel, G, horizon: null, zone: null, facades: null, resultat: null, coupe: null, heuresDemandees: false });
    $("#vCoupe").checked = false; $("#outilsCoupe").hidden = true;
    $("#btnHeures").textContent = "Calculer les heures de soleil";
    etat(0.85, "Construction de la scène 3D…");
    await pause();
    scene.controls.autoRotate = false;
    scene.typeFond = $("input[name=fond]:checked").value;
    scene.construire(G, nuage, rel, { cadastre: urlFond(COUCHES.cadastre, boite), ortho: urlFond(COUCHES.ortho, boite) });
    // sélection : la parcelle, et le bâtiment de l'adresse (ou ceux de la parcelle)
    scene.surligner(rel, h.get("t") === "Adresse" ? [E - E0, N - N0] : null);
    scene.comparerSwiss($("#vSwiss").checked, { E: S.E0, N: S.N0 });
    S.roofer = essaiRoofer(E0, N0);
    $("#ligneRoofer").hidden = !S.roofer;
    if (S.roofer) $("#nomRoofer").textContent = S.roofer.nom;
    comparerRoofer();
    appliquerAffichage();
    $("#vArbres").disabled = !nuage && !G.veg.some(v => !isNaN(v)); $("#vPoints").disabled = !nuage;
    const nf = scene.couches.facades?.geometry.attributes.position.count || 0;
    $("#vFacades").disabled = !nf; if (!nf) $("#vFacades").checked = false;
    $("#nbFacades").textContent = nf ? `(${nf.toLocaleString("fr-CH")})` : nuage ? "(aucun ici)" : "(relevé non disponible)";

    etat(0.9, "Relief lointain (montagnes)…");
    S.horizon = await profilHorizon(E0, N0, scene.zRef + 1.7, { rayonProche: R, onProgres: (f, t) => id === tache && etat(0.9 + 0.1 * f, t) });
    if (id !== tache) return;
    etat(1, "");
    $("#commandes").hidden = false; $("#diagramme").hidden = false;
    majSoleil();
  } catch (e) {
    console.error(e);
    etat(0, "Erreur : " + e.message);
    $("#etat").hidden = false;
  }
}
const pause = () => new Promise(r => setTimeout(r, 30));

/* ------------------------------------------------------------------ soleil */
function soleilActuel() {
  const p = positionSoleil(dateA(S.jour, S.minutes), S.lat, S.lon), hz = S.horizon ? horizonA(S.horizon, p.azimut) : 0;
  return { ...p, horizon: hz, visible: p.hauteur > 0 && p.hauteur > hz, heure: hhmm(S.minutes) };
}
function majSoleil() {
  $("#jour").value = S.jour;
  $("#heure").value = S.minutes;
  $("#heureTexte").textContent = hhmm(S.minutes);
  if (S.lat == null) return;
  const p = soleilActuel();
  scene.placerSoleil(directionSoleil(p), p.visible);
  const etatSoleil = p.hauteur <= 0 ? "couché" : p.visible ? "visible" : `caché par le relief lointain (horizon à ${p.horizon.toFixed(1)}°)`;
  $("#soleilTexte").innerHTML = `Azimut ${p.azimut.toFixed(0)}° · hauteur ${p.hauteur.toFixed(1)}° · <b>${etatSoleil}</b>`;
  if (S.horizon) {
    dessinerDiagramme($("#svgSoleil"), { horizon: S.horizon, jour: S.jour, minutes: S.minutes, lat: S.lat, lon: S.lon });
    const v = soleilVisible(S.jour, S.lat, S.lon, S.horizon);
    $("#horizonTexte").textContent = v.debut == null ? "· soleil caché toute la journée"
      : `· au-dessus des montagnes de ${hhmm(v.debut)} à ${hhmm(v.fin)} (${Math.floor(v.minutes / 60)} h ${String(v.minutes % 60).padStart(2, "0")})`;
  }
  if (S.coupe) dessinCoupe();
}
function changerJour(jour) {
  S.jour = jour;
  majSoleil();
  relancerHeures();
}
$("#jour").addEventListener("change", e => { if (e.target.value) changerJour(e.target.value); });
$("#heure").addEventListener("input", e => { S.minutes = +e.target.value; majSoleil(); });
$$("[data-jour]").forEach(b => b.onclick = () => changerJour(b.dataset.jour === "auj" ? aujourdhui() : `${S.jour.slice(0, 4)}-${b.dataset.jour}`));
// clic ou glissé sur le diagramme : le soleil va au point le plus proche de sa course du jour
{
  const svg = $("#svgSoleil");
  let appui = false;
  const placer = e => {
    if (S.lat == null) return;
    const t = heureSousPointeur(svg, e, S);
    if (t != null && t !== S.minutes) { S.minutes = t; majSoleil(); }
  };
  svg.addEventListener("pointerdown", e => { appui = true; svg.setPointerCapture(e.pointerId); placer(e); });
  svg.addEventListener("pointermove", e => { if (appui) placer(e); });
  svg.addEventListener("pointerup", () => { appui = false; });
}
let lecture = null;
$("#btnLecture").onclick = () => {
  if (lecture) { clearInterval(lecture); lecture = null; $("#btnLecture").textContent = "▶"; return; }
  $("#btnLecture").textContent = "❚❚";
  lecture = setInterval(() => { S.minutes = (S.minutes + 5) % 1440; majSoleil(); }, 60);
};

/* ------------------------------------------------------------------ affichage */
function appliquerAffichage() {
  const c = scene.couches || {};
  if (c.bati) c.bati.visible = $("#vBati").checked;
  scene.styleArbres($("#vArbres").checked);
  scene.voirFacades($("#vFacades").checked);
  if (c.tous) c.tous.visible = $("#vPoints").checked;
  if (c.heures) c.heures.visible = $("#vHeures").checked;
  scene.ombres();
}
["#vBati", "#vArbres", "#vFacades", "#vPoints", "#vHeures"].forEach(s => $(s).addEventListener("change", appliquerAffichage));
// comparaison roofer : seulement là où un essai a été calculé hors ligne (Lutry)
const matRoofer = new THREE.MeshStandardMaterial({ color: "#d8b4e2", roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
async function comparerRoofer() {
  if (!S.roofer || !$("#vRoofer").checked) { scene.afficherRoofer(null); return; }
  const lieu = S.E0, m = await maillageRoofer(S.roofer, [S.E0, S.N0], scene.zRef, matRoofer);
  if (lieu === S.E0 && $("#vRoofer").checked) scene.afficherRoofer(m);
}
$("#vRoofer").addEventListener("change", comparerRoofer);
$("#vSwiss").addEventListener("change", e => scene.comparerSwiss(e.target.checked, S.E0 != null ? { E: S.E0, N: S.N0 } : null));
$$("input[name=fond]").forEach(b => b.addEventListener("change", () => scene.fond(b.value)));
scene.surFondAbsent = type => message(type === "ortho" ? "Photo aérienne indisponible pour le moment." : "Plan cadastral indisponible ici : terrain uni.");
$("#vEffets").addEventListener("change", e => scene.reglerEffets(e.target.checked));
scene.surQualite = q => {
  if (q < 2) return;
  $("#vEffets").checked = false;
  if (S.G && S.lat != null) message("Effets de lumière coupés pour garder un affichage fluide (à réactiver dans « Affichage »).");
};
$("#btnPartager").onclick = async () => { await navigator.clipboard.writeText(location.href); $("#btnPartager").textContent = "Copié"; setTimeout(() => $("#btnPartager").textContent = "Lien", 1500); };

/* ------------------------------------------------------------------ coupe */
function majCoupe(A, B) {
  S.coupe = { A, B, P: profilCoupe(S.G, scene.contours, A, B, S.parcelle) };
  scene.definirCoupe(S.coupe.P);
  dessinCoupe();
}
function dessinCoupe() {
  const r = dessinerCoupe($("#svgCoupe"), S.coupe.P, soleilActuel());
  $("#coupeTexte").textContent = r ? `· ${r.long.toFixed(0)} m${r.note ? " · " + r.note : ""}` : "";
}
$("#vCoupe").addEventListener("change", e => {
  $("#outilsCoupe").hidden = $("#coupe").hidden = !e.target.checked;
  scene.tracer(null); $("#btnTracer").classList.remove("active");
  if (!e.target.checked) { S.coupe = null; scene.definirCoupe(null); return; }
  // par défaut : coupe sud–nord à travers la parcelle (le soleil de midi est alors dans le plan)
  const pts = S.parcelle.anneauxRel.flat(), demi = pts.length ? Math.max(...pts.map(p => Math.abs(p[1]))) : 15;
  const L = Math.min(S.G.R - 5, Math.max(35, demi + 25));
  majCoupe([0, -L], [0, L]);
});
$("#btnTracer").onclick = () => {
  const actif = !$("#btnTracer").classList.contains("active");
  $("#btnTracer").classList.toggle("active", actif);
  $("#aideCoupe").textContent = actif ? "Cliquez le point A sur le modèle…" : "Déplacez les poignées A et B sur le modèle, ou tracez une nouvelle ligne.";
  scene.tracer(actif ? (A, B) => {
    $("#btnTracer").classList.remove("active");
    $("#aideCoupe").textContent = "Déplacez les poignées A et B sur le modèle, ou tracez une nouvelle ligne.";
    majCoupe(A, B);
  } : null);
};
scene.surDepart = () => $("#aideCoupe").textContent = "…puis le point B.";
scene.surCoupe = (A, B) => majCoupe(A, B);

/* ------------------------------------------------------------------ heures d'ensoleillement */
let calcul = null, attente = null;
const periode = () => $("input[name=periode]:checked").value;
const clePeriode = () => `${periode()}:${S.jour.slice(0, periode() === "jour" ? 10 : periode() === "mois" ? 7 : 4)}`;
function annulerCalcul() {
  clearTimeout(attente);
  if (!calcul) return;
  calcul.ouvriers.forEach(w => w.terminate());
  calcul = null;
  $("#etat").hidden = true;
}
// la date ou la période a changé : on relance (après une courte attente) si la carte a déjà été demandée
function relancerHeures() {
  if (!S.heuresDemandees || (S.resultat?.cle === clePeriode() && !calcul) || calcul?.cle === clePeriode()) return;
  annulerCalcul();
  attente = setTimeout(calculerHeures, 300);
}
$$("input[name=periode]").forEach(b => b.addEventListener("change", relancerHeures));
$("#btnHeures").onclick = () => { S.heuresDemandees = true; calculerHeures(); };

function calculerHeures() {
  annulerCalcul();
  const G = S.G;
  if (!G || !S.horizon) return;
  const zone = S.zone ||= zoneHeures(G, S.parcelle.anneauxRel), facades = S.facades ||= carreauxFacades(G, scene.contours, zone);
  const P = soleilsPeriode(periode(), S.jour, S.lat, S.lon, S.horizon), cle = clePeriode(), debut = performance.now();
  const heures = new Float32Array(zone.w * zone.h), heuresF = new Float32Array(facades.carreaux.length);
  const fin = () => {
    calcul = null;
    etat(1, "");
    S.resultat = { heures, heuresF, P, cle, ms: performance.now() - debut };
    $("#btnHeures").textContent = "Recalculer";
    afficherResultat();
  };
  // les positions du soleil sont réparties entre quelques fils de calcul
  const nb = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, Math.ceil(P.soleils.length / 3)));
  if (!P.soleils.length) return fin();
  const lots = Array.from({ length: nb }, () => []), avance = new Float32Array(nb);
  P.soleils.forEach((s, k) => lots[k % nb].push(s));
  let restants = nb;
  etat(0.01, "Heures de soleil…");
  const moi = calcul = { cle, ouvriers: lots.map((lot, k) => {
    const w = new Worker(new URL("./ensoleillement.worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      if (calcul !== moi) return;
      if (data.progres != null) { avance[k] = data.progres; etat(0.99 * avance.reduce((a, b) => a + b) / nb, `Heures de soleil (${P.titre})…`); return; }
      w.terminate();
      for (let p = 0; p < heures.length; p++) heures[p] += data.heures[p];
      for (let p = 0; p < heuresF.length; p++) heuresF[p] += data.heuresF[p];
      if (--restants === 0) fin();
    };
    w.postMessage({ surface: G.surface, base: G.base, n: G.n, c: G.c, zone: [zone.i0, zone.j0, zone.i1, zone.j1], alpha: zone.alpha, soleils: lot, facades: facades.pts });
    return w;
  }) };
}

function afficherResultat() {
  const { heures, heuresF, P, ms } = S.resultat, zone = S.zone, max = Math.max(0.5, P.max), parJour = P.nbJours > 1 ? " / jour" : "";
  scene.afficherHeures(maillagesHeures(S.G, scene.contours, zone, S.facades, { heures, heuresF }, max, T.heures, scene.zRef));
  // statistiques sur les cellules de la parcelle (à défaut : le cœur de la zone)
  const sans = !S.parcelle.anneauxRel.length;
  let s = 0, k = 0, mn = Infinity, mx = 0;
  for (let p = 0; p < heures.length; p++) {
    if (sans ? zone.alpha[p] < 1 : !zone.parcelle[p]) continue;
    s += heures[p]; k++; mn = Math.min(mn, heures[p]); mx = Math.max(mx, heures[p]);
  }
  $("#heures").hidden = false;
  $("#heuresMax").textContent = duree(max) + parJour;
  $("#heuresStats").innerHTML = (k ? `${sans ? "Autour du point" : "Parcelle"}, ${P.titre} : <b>${duree(s / k)}${parJour}</b> · min ${duree(mn)} · max ${duree(mx)}<br>` : "")
    + `<span class="text-secondary">Soleil au-dessus du relief, ${P.titre} : ${duree(P.max)}${parJour}. Façades comprises (${S.facades.carreaux.length.toLocaleString("fr-CH")} carreaux). Calculé en ${(ms / 1000).toFixed(1).replace(".", ",")} s.</span>`;
  $("#vHeures").checked = true;
  appliquerAffichage();
}

marquerTheme();
majSoleil();
depuisAdresse();
if (import.meta.env.DEV) window.ombres = { scene, S }; // pour l'inspection pendant le développement
