import "bootstrap/dist/css/bootstrap.min.css";
import "./style.css";
import { chercher, parcelleEn, parcellesAutour, tuilesNuage, tuilesGrille, versWgs } from "./geo.js";
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
import { brancherPro } from "./pro.js";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
// ouverture : aujourd'hui à 14 h, pour qu'il y ait du soleil
const S = { jour: aujourdhui(), minutes: 14 * 60 };
let T = appliquerTheme(themeInitial());
const scene = new Scene3D($("#vue"), T);

function aujourdhui() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
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
  if (S.voisines?.length) scene.afficherParcelles(S.voisines, $("#vParcelles").checked);
  matRoofer.color.set(T.sol);
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
  chargement?.abort();
  annulerCalcul();
  document.body.classList.add("accueil");
  $("#panneau").hidden = $("#diagramme").hidden = $("#coupe").hidden = true;
  message("");
  Object.assign(S, { lat: null, lon: null, G: null, horizon: null, zone: null, facades: null, resultat: null, coupe: null, heuresDemandees: false });
  const D = hameau();
  scene.construire(D.G, D.nuage, D.parcelle, null);
  pro.reinitialiser();
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
let tache = 0, chargement = null; // `chargement` : arrêt des fils qui décodent le nuage quand on change de lieu
function etat(f, texte) {
  telechargement("lieu", f < 1 ? texte : null, f);
}

/**
 * Bandeau des téléchargements en cours, au-dessus de la vue (lieu, roofer, tuiles swisstopo) : plusieurs sources
 * peuvent être actives ; on affiche la dernière arrivée. `texte` null = terminé pour cette source.
 */
const enCours = new Map();
// une seule barre, en haut au milieu : une grille de petits carrés qui s'allument dans un ordre aléatoire
const CARRES = 48 * 4, carres = [];
let ordre = [], allumes = 0, sourceBarre = null, scintille = null;
{
  const g = $("#telechargementGrille");
  for (let k = 0; k < CARRES; k++) carres.push(g.appendChild(document.createElement("i")));
}
function melanger() {
  ordre = [...carres.keys()];
  for (let k = ordre.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [ordre[k], ordre[r]] = [ordre[r], ordre[k]]; }
  carres.forEach(c => c.className = ""); allumes = 0;
}
function telechargement(source, texte, f = null) {
  if (texte) enCours.set(source, { source, texte, f }); else enCours.delete(source);
  const dernier = [...enCours.values()].pop(), boite = $("#telechargement");
  boite.hidden = !dernier;
  if (!dernier) { clearInterval(scintille); scintille = null; sourceBarre = null; return; }
  $("#telechargementTexte").textContent = dernier.texte;
  const k = dernier.f == null ? null : Math.round(Math.max(0, Math.min(1, dernier.f)) * CARRES);
  if (dernier.source !== sourceBarre || (k != null && k < allumes)) { melanger(); sourceBarre = dernier.source; }
  $("#telechargementPct").textContent = k == null ? "" : `${Math.round(dernier.f * 100)} %`;
  if (k != null) boite.setAttribute("aria-valuenow", Math.round(dernier.f * 100)); else boite.removeAttribute("aria-valuenow");
  if (k == null) {
    // durée inconnue : des carrés scintillent au hasard
    if (!scintille) scintille = setInterval(() => carres.forEach(c => c.className = Math.random() < 0.18 ? "vif" : ""), 140);
    return;
  }
  clearInterval(scintille); scintille = null;
  for (; allumes < k; allumes++) carres[ordre[allumes]].className = "plein";
}

async function depuisAdresse() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get("e")) return accueil();
  const E = +h.get("e"), N = +h.get("n"), id = ++tache;
  chargement?.abort();
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
    // rayon automatique, ou celui choisi en mode pro (taille de la maquette)
    const R = pro.rayon() || Math.min(300, Math.max(150, Math.ceil(demi + 120)));
    const boite = [E0 - R, N0 - R, E0 + R, N0 + R];
    const rel = parcelle ? { ...parcelle, anneauxRel: parcelle.anneaux.map(a => a.map(([e, n]) => [e - E0, n - N0])) } : { anneauxRel: [] };

    // relief lointain : ses tuiles se téléchargent pendant le chargement du relevé ; l'altitude de l'observateur
    // (connue une fois le terrain reconstruit) lui est donnée plus bas
    let donnerAltitude, horizonFini = 0;
    const horizon = profilHorizon(E0, N0, new Promise(r => donnerAltitude = r), { rayonProche: R, onProgres: f => horizonFini = f });
    horizon.catch(() => {}); // l'erreur éventuelle est traitée à l'attente, plus bas

    etat(0.05, "Recherche du relevé laser…");
    let G, nuage = null, source;
    const copc = await tuilesNuage(boite);
    if (id !== tache) return;
    if (copc) {
      nuage = await chargerNuage(copc, boite, [E0, N0], 0.5, (f, t) => id === tache && etat(0.05 + 0.7 * f, t), (chargement = new AbortController()).signal);
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
    scene.typeFond = $("#vCadastre").checked ? "cadastre" : "uni";
    scene.construire(G, nuage, rel, { cadastre: urlFond(COUCHES.cadastre, boite) });
    pro.reinitialiser();
    // sélection : la parcelle, et le bâtiment de l'adresse (ou ceux de la parcelle)
    scene.surligner(rel, h.get("t") === "Adresse" ? [E - E0, N - N0] : null);
    // parcelles voisines (limites et numéros), chargées sans bloquer
    S.voisines = [];
    parcellesAutour(boite).then(v => {
      if (id !== tache) return;
      S.toutes = v.map(p => ({ numero: p.numero, anneauxRel: p.anneaux.map(a => a.map(([e, n]) => [e - E0, n - N0])) }));
      S.voisines = S.toutes.filter(p => p.numero !== parcelle?.numero);
      scene.afficherParcelles(S.voisines, $("#vParcelles").checked);
      if (S.coupe) majCoupe(S.coupe.A, S.coupe.B);
    }).catch(e => console.warn("Parcelles voisines :", e.message));
    S.roofer = essaiRoofer(E0, N0);
    choixRoofer();
    scene.comparerSwiss(choixBatiments() === "swiss", { E: S.E0, N: S.N0 });
    comparerRoofer();
    appliquerAffichage();
    $("#vArbres").disabled = !nuage && !G.veg.some(v => !isNaN(v)); $("#vPoints").disabled = $("#distPoints").disabled = !nuage;

    donnerAltitude(scene.zRef + 1.7);
    if (horizonFini < 1) etat(0.9 + 0.1 * horizonFini, "Relief lointain (montagnes)…");
    S.horizon = await horizon;
    if (id !== tache) return;
    etat(1, "");
    $("#commandes").hidden = false; $("#diagramme").hidden = false;
    majSoleil();
  } catch (e) {
    if (id !== tache) return; // lieu changé entre-temps : le chargement abandonné n'affiche rien
    console.error(e);
    telechargement("lieu", null);
    message("Erreur : " + e.message);
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
  const jeu = choixBatiments();
  $("#vBatVoir").disabled = $("#vBatOmbre").disabled = jeu === "aucun";
  scene.reglerCalques({ jeu, batVoir: $("#vBatVoir").checked, batOmbre: $("#vBatOmbre").checked, arbOmbre: $("#vArbresOmbre").checked });
  scene.styleArbres($("#vArbres").checked);
  scene.voirPoints($("#vPoints").checked && !$("#vPoints").disabled);
  if (c.heures) c.heures.visible = $("#vHeures").checked;
  scene.arbresSurHeures();
  scene.ombres();
}
["#vArbres", "#vArbresOmbre", "#vBatVoir", "#vBatOmbre", "#vPoints", "#vHeures"].forEach(s => $(s).addEventListener("change", appliquerAffichage));
// boussole d'orientation : trois axes (est, nord, haut) qui suivent la caméra, comme un trièdre de logiciel 3D ;
// un clic sur un bout d'axe donne le plan (haut) ou l'élévation de ce côté, glisser fait tourner la vue
{
  const svg = $("#boussole"), NS = "http://www.w3.org/2000/svg";
  // axes en coordonnées de scène (x = est, y = haut, z = sud) ; dir = [est, haut, sud] pour scene.vueDirection
  const AXES = [
    { nom: "E", v: [1, 0, 0], couleur: "#c8553d", vue: "E" }, { nom: "O", v: [-1, 0, 0], couleur: "#c8553d", neg: true, vue: "O" },
    { nom: "N", v: [0, 0, -1], couleur: "#5b8c3a", vue: "N" }, { nom: "S", v: [0, 0, 1], couleur: "#5b8c3a", neg: true, vue: "S" },
    { nom: "Z", v: [0, 1, 0], couleur: "#3d6fb6", vue: "plan", titre: "Plan (vue de dessus)" }, { nom: "", v: [0, -1, 0], couleur: "#3d6fb6", neg: true },
  ];
  const TITRES = { E: "Élévation depuis l'est", O: "Élévation depuis l'ouest", N: "Élévation depuis le nord", S: "Élévation depuis le sud" };
  const el = (nom, attrs, parent = svg) => { const e = document.createElementNS(NS, nom); for (const k in attrs) e.setAttribute(k, attrs[k]); return parent.appendChild(e); };
  const q = new scene.camera.quaternion.constructor(), v = new scene.camera.position.constructor();
  const L = 34;
  let actif = null;
  const dessiner = () => {
    q.copy(scene.camera.quaternion).invert();
    const proj = p => { v.set(...p).applyQuaternion(q); return [v.x * L, -v.y * L, v.z]; };
    svg.replaceChildren();
    el("circle", { class: "fond", r: 46 });
    // centre : retour à la vue 3D (affiché en plan et en élévation)
    if (actif) {
      const g = el("g", { class: "bout centre", "data-vue": "3d", role: "button", "aria-label": "Revenir à la vue 3D" });
      el("title", {}, g).textContent = "Revenir à la vue 3D";
      el("circle", { r: 9, fill: "var(--accent)", stroke: "var(--accent)" }, g);
      el("text", { fill: "#fff" }, g).textContent = "3D";
    }
    // anneau de l'horizon (plan horizontal), comme le cadran d'une boussole
    const pts = [];
    for (let k = 0; k <= 48; k++) { const t = k / 48 * 2 * Math.PI, [x, y] = proj([Math.cos(t) * 0.82, 0, Math.sin(t) * 0.82]); pts.push(`${x.toFixed(1)},${y.toFixed(1)}`); }
    el("polyline", { class: "anneau", points: pts.join(" ") });
    // du plus lointain au plus proche, pour que les bouts devant recouvrent ceux de derrière
    const liste = AXES.map(a => ({ ...a, p: proj(a.v) })).sort((a, b) => a.p[2] - b.p[2]);
    const centre = svg.querySelector(".centre");
    for (const a of liste) el("line", { class: "axe" + (a.neg ? " neg" : ""), x1: 0, y1: 0, x2: a.p[0], y2: a.p[1], stroke: a.couleur });
    for (const a of liste) {
      if (!a.vue) continue;
      const g = el("g", { class: "bout" + (a.vue === actif ? " actif" : ""), transform: `translate(${a.p[0].toFixed(1)} ${a.p[1].toFixed(1)})`, "data-vue": a.vue, role: "button", "aria-label": a.titre || TITRES[a.vue] });
      el("title", {}, g).textContent = a.titre || TITRES[a.vue];
      const r = a.neg ? 6.5 : 8;
      el("circle", { r, fill: a.neg ? "var(--carte)" : a.couleur, stroke: a.couleur, opacity: 0.75 + 0.25 * Math.max(0, a.p[2]) }, g);
      el("text", { fill: a.neg ? a.couleur : "#fff" }, g).textContent = a.nom;
    }
    if (centre) svg.appendChild(centre); // par-dessus les axes
  };
  scene.controls.addEventListener("change", dessiner);
  dessiner();
  // glisser = tourner ; un clic sans glisser = choisir le bout d'axe visé
  let prise = null;
  svg.addEventListener("pointerdown", e => { prise = { x: e.clientX, y: e.clientY, bouge: false }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", e => {
    if (!prise) return;
    const dx = e.clientX - prise.x, dy = e.clientY - prise.y;
    if (!prise.bouge && Math.hypot(dx, dy) < 4) return;
    prise.bouge = true; svg.classList.add("tire");
    scene.tourner(dx * 0.012, dy * 0.012);
    prise.x = e.clientX; prise.y = e.clientY;
  });
  svg.addEventListener("pointerup", e => {
    const p = prise;
    prise = null; svg.classList.remove("tire");
    if (!p || p.bouge) return;
    const b = document.elementFromPoint(e.clientX, e.clientY)?.closest("#boussole .bout"); // pointeur capturé : e.target = svg
    if (!b) return;
    if (b.dataset.vue === "3d") return scene.vueOrtho(null);
    const DIRS = { plan: [0, 1, 0], N: [0, 0, -1], S: [0, 0, 1], E: [1, 0, 0], O: [-1, 0, 0] };
    scene.vueDirection(DIRS[b.dataset.vue]);
  });
  scene.surVue = mode => { actif = mode || null; dessiner(); };
  scene.surVue(null);
}
$("#vParcelles").addEventListener("change", e => { if (scene.couches.voisines) { scene.couches.voisines.visible = e.target.checked; scene.demander(); } });
// comparaison roofer : seulement là où un essai a été calculé hors ligne (Lutry)
// même matière que le terrain (comme nos bâtiments et swisstopo) : la tranche au bord du socle fait une seule masse
const matRoofer = new THREE.MeshStandardMaterial({ color: T.sol, roughness: 0.92, side: THREE.DoubleSide, flatShading: true });
async function comparerRoofer() {
  if (!S.roofer || choixBatiments() !== "roofer") { scene.afficherRoofer(null); return; }
  const lieu = S.E0;
  telechargement("roofer", "Téléchargement des bâtiments roofer…", 0);
  try {
    const m = await maillageRoofer(S.roofer, [S.E0, S.N0], scene.zRef, matRoofer,
      (f, mo) => telechargement("roofer", `Téléchargement des bâtiments roofer… ${mo}`, f));
    if (lieu === S.E0 && choixBatiments() === "roofer") scene.afficherRoofer(m);
  } finally { telechargement("roofer", null); }
}
scene.surTuilesSwiss = n => telechargement("swiss", n > 0 ? `Téléchargement des bâtiments swisstopo… ${n} tuile${n > 1 ? "s" : ""} en cours` : null);
// bâtiments affichés : un seul jeu à la fois (relevé, swisstopo, roofer là où il a été calculé, ou aucun)
// onglets du panneau : un seul groupe de réglages visible à la fois ; le dernier choisi est retenu par ce navigateur
{
  const montrer = nom => {
    $$("#onglets [data-onglet]").forEach(b => { const ok = b.dataset.onglet === nom; b.classList.toggle("active", ok); b.setAttribute("aria-selected", String(ok)); });
    $$("#commandes section[data-onglet]").forEach(sec => sec.hidden = sec.dataset.onglet !== nom);
    try { localStorage.setItem("onglet", nom); } catch { /* stockage indisponible */ }
  };
  $$("#onglets [data-onglet]").forEach(b => b.addEventListener("click", () => montrer(b.dataset.onglet)));
  let memo = null;
  try { memo = localStorage.getItem("onglet"); } catch { /* idem */ }
  montrer($(`#onglets [data-onglet="${memo}"]`) ? memo : "affichage");
}
function choixBatiments() { return $("input[name=batiments]:checked")?.value || "releve"; }
const NOTES = {
  releve: "", aucun: "",
  swiss: "Swiss3D (swissBUILDINGS3D) : ils portent les ombres affichées ; les heures de soleil restent calculées avec le relevé.",
  roofer: "Advanced (roofer, TU Delft) : ils portent les ombres affichées ; les heures de soleil restent calculées avec le relevé.",
};
function choixRoofer() {
  $("#bRoofer").disabled = !S.roofer;
  $("#etiquetteRoofer").hidden = $("#bRoofer").hidden = !S.roofer;
  if (S.roofer) $("#etiquetteRoofer").title = `roofer (TU Delft), LoD2.2, calculé hors ligne — essai ${S.roofer.nom}`;
  if (!S.roofer && choixBatiments() === "roofer") $("#bReleve").checked = true;
}
$$("input[name=batiments]").forEach(b => b.addEventListener("change", () => {
  const choix = choixBatiments();
  $("#noteBatiments").textContent = NOTES[choix];
  scene.comparerSwiss(choix === "swiss", S.E0 != null ? { E: S.E0, N: S.N0 } : null);
  comparerRoofer();
  appliquerAffichage();
  refaireCoupe();
}));
$("#vCadastre").addEventListener("change", e => scene.fond(e.target.checked ? "cadastre" : "uni"));
scene.surFondAbsent = () => message("Plan cadastral indisponible ici : terrain uni.");
$("#vEffets").addEventListener("change", e => scene.reglerEffets(e.target.checked));
$("#vDegrade").addEventListener("change", e => scene.degradeHauteur(e.target.checked));
scene.surQualite = q => {
  if (q < 2) return;
  $("#vEffets").checked = false;
  if (S.G && S.lat != null) message("Effets de lumière coupés pour garder un affichage fluide (à réactiver dans « Affichage »).");
};
$("#btnPartager").onclick = async () => { await navigator.clipboard.writeText(location.href); $("#btnPartager").textContent = "Copié"; setTimeout(() => $("#btnPartager").textContent = "Lien", 1500); };

/* ------------------------------------------------------------------ coupe */
function majCoupe(A, B) {
  // la coupe suit le jeu de bâtiments affiché (relevé, swisstopo, roofer ou aucun) ; en mode pro, points du nuage proches
  const jeu = choixBatiments(), grille = jeu === "swiss" || jeu === "roofer" ? scene.grilleComparaison(jeu) : null;
  const distance = $("#vPro").checked && scene.nuage ? +$("#distPoints").value : 0;
  S.coupe = { A, B, P: profilCoupe(S.G, scene.contours, A, B, S.parcelle, 0.25, S.voisines || [],
    { batiments: jeu === "releve" ? null : grille || "aucun", nuage: scene.nuage, distance }) };
  $("#legendePoints").hidden = !S.coupe.P.points;
  scene.definirCoupe(S.coupe.P);
  dessinCoupe();
}
function dessinCoupe() {
  const r = dessinerCoupe($("#svgCoupe"), S.coupe.P, soleilActuel());
  $("#coupeTexte").textContent = r ? `· ${r.long.toFixed(0)} m${r.note ? " · " + r.note : ""}` : "";
}
$("#vCouperModele").addEventListener("change", e => { scene.couperModele = e.target.checked; if (S.coupe) scene.definirCoupe(S.coupe.P); });
// la carte de la coupe prend toute la largeur en bas : le panneau s'arrête au-dessus, le profil suit la largeur
new ResizeObserver(() => {
  const h = $("#coupe").hidden ? 0 : $("#coupe").offsetHeight + 12;
  document.body.style.setProperty("--coupe-h", `${h}px`);
}).observe($("#coupe"));
{
  let largeur = 0;
  new ResizeObserver(([e]) => {
    const l = Math.round(e.contentRect.width);
    if (l && Math.abs(l - largeur) > 4 && S.coupe) { largeur = l; dessinCoupe(); }
  }).observe($("#bas"));
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
const refaireCoupe = () => { if (S.coupe) majCoupe(S.coupe.A, S.coupe.B); };
scene.surBatiments = refaireCoupe; // bâtiments de comparaison arrivés ou changés (tuiles swisstopo, roofer)
$("#distPoints").addEventListener("change", refaireCoupe);
$("#vPro").addEventListener("change", refaireCoupe);

/* ------------------------------------------------------------------ heures d'ensoleillement */
let calcul = null, attente = null;
const periode = () => $("input[name=periode]:checked").value;
const clePeriode = () => `${periode()}:${S.jour.slice(0, periode() === "jour" ? 10 : periode() === "mois" ? 7 : 4)}`;
function annulerCalcul() {
  clearTimeout(attente);
  if (!calcul) return;
  calcul.ouvriers.forEach(w => w.terminate());
  calcul = null;
  telechargement("lieu", null);
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
/* ------------------------------------------------------------------ choisir une autre parcelle d'un clic */
// Un clic (sans glisser) sur le terrain ou un toit choisit la parcelle à cet endroit, sans recharger la maquette.
// Le clic reste au mode pro quand son outil « Sélectionner » est actif, et au tracé de la coupe.
{
  const el = scene.renderer.domElement;
  let appui = null;
  el.addEventListener("pointerdown", e => { appui = [e.clientX, e.clientY]; });
  el.addEventListener("pointerup", e => {
    if (!appui || Math.hypot(e.clientX - appui[0], e.clientY - appui[1]) > 5 || e.button !== 0) return;
    appui = null;
    if (!S.G || !S.toutes?.length || scene.trace || scene.modeVue === "N" || scene.modeVue === "S" || scene.modeVue === "E" || scene.modeVue === "O") return;
    if ($("#vPro")?.checked && $("#btnSelection")?.classList.contains("active")) return;
    const p = scene.pointSol(e);
    if (!p) return;
    const choisie = S.toutes.find(q => dansParcelle(p[0], p[1], q.anneauxRel));
    if (choisie && choisie.numero !== S.parcelle?.numero) choisirParcelle(choisie);
  });
}
function dansParcelle(x, y, anneaux) {
  let ok = false;
  for (const a of anneaux) for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i], [xj, yj] = a[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}
function choisirParcelle(p) {
  S.parcelle = { ...S.parcelle, numero: p.numero, anneauxRel: p.anneauxRel };
  S.voisines = S.toutes.filter(q => q.numero !== p.numero);
  scene.changerParcelle(S.parcelle);
  scene.afficherParcelles(S.voisines, $("#vParcelles").checked);
  // en-tête et lien partageable (sans recharger : la maquette couvre déjà cette parcelle)
  const xs = p.anneauxRel.flat().map(q => q[0]), ys = p.anneauxRel.flat().map(q => q[1]);
  const E = Math.round(S.E0 + (Math.min(...xs) + Math.max(...xs)) / 2), N = Math.round(S.N0 + (Math.min(...ys) + Math.max(...ys)) / 2);
  $("#lieuType").textContent = `Parcelle ${p.numero}${S.parcelle.canton ? " · " + S.parcelle.canton : ""}`;
  $("#lieu").textContent = `Parcelle ${p.numero}`;
  history.replaceState(null, "", `${location.pathname}${location.search}#e=${E}&n=${N}&l=${encodeURIComponent("Parcelle " + p.numero)}&t=Parcelle`);
  if (S.coupe) majCoupe(S.coupe.A, S.coupe.B);
  if (S.heuresDemandees) calculerHeures(); else scene.afficherHeures?.(null);
}

// mode pro : sélection et masquage de bâtiments, taille de la maquette, exports (pro.js)
const pro = brancherPro({ scene, S, message, etat, recharger: depuisAdresse, calculerHeures, annulerCalcul, majCoupe, soleilActuel });

majSoleil();
depuisAdresse();
if (import.meta.env.DEV) window.ombres = { scene, S }; // pour l'inspection pendant le développement
