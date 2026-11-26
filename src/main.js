import "bootstrap/dist/css/bootstrap.min.css";
import "./style.css";
document.documentElement.classList.add("pret"); // styles chargés : la page peut s'afficher
import { t, nombre, entier, date, traduirePage, brancherSelecteur } from "./i18n.js";
import { chercher, parcelleEn, parcellesAutour, tuilesNuage, tuilesGrille, tuilesAlti2m, versWgs } from "./geo.js";
import { chargerNuage } from "./nuage.js";
import { depuisPoints, depuisRasters, solEn, terrainAutour, garderCercle } from "./grille.js";
import { reliefLointain } from "./lointain.js";
import { Scene3D } from "./scene.js";
import { essaiRoofer, maillageRoofer } from "./roofer.js";
import * as THREE from "three";
import { positionSoleil, directionSoleil, dateA } from "./soleil.js";
import { profilHorizon, horizonA } from "./horizon.js";
import { dessinerDiagramme, soleilVisible, heureSousPointeur } from "./diagramme.js";
import { themeInitial, appliquerTheme } from "./themes.js";
import { urlFond, COUCHES } from "./fond.js";
import { zoneHeures, soleilsPeriode, carreauxFacades, maillagesHeures } from "./heures.js";
import { contoursBatiments } from "./contours.js";
import { profilCoupe, dessinerCoupe } from "./coupe.js";
import { hameau } from "./demo.js";
import { lancerVol } from "./vol.js";
import { brancherPro } from "./pro.js";
import { brancherCompte } from "./compte.js";
import "./compte.css";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
// textes de la page dans la langue choisie, et sélecteur de langue au pied de page
traduirePage();
brancherSelecteur($("#langues"));
// compte (connexion par lien e-mail, achat de la version pro) : sans l'API (site statique actuel), le bouton reste caché
// et tout reste ouvert
const compte = brancherCompte({ api: "/api", t });
compte.monter($("#langues"));
// compteurs d'usage anonymes (tableau d'administration) : un simple total par jour et par action, envoyé seulement
// quand l'API du site est en service ; aucune adresse, aucun lieu, aucun compte
function compter(type) {
  if (!compte.disponible()) return;
  try { navigator.sendBeacon("/api/evenement.php", new Blob([JSON.stringify({ type })], { type: "application/json" })); } catch { /* sans importance */ }
}
// ouverture : aujourd'hui à 14 h, pour qu'il y ait du soleil
const S = { jour: aujourdhui(), minutes: 14 * 60 };
let T = appliquerTheme(themeInitial());
const scene = new Scene3D($("#vue"), T);
if (import.meta.env.DEV) window.__scene = scene; // inspection en développement

function aujourdhui() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const duree = v => { const m = Math.round(v * 60); return t("duree", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") }); };
// type de lieu (« Adresse », « Parcelle » : codes internes, aussi dans l'adresse de la page) dans la langue choisie
const nomType = c => c === "Adresse" || c === "Parcelle" ? t(`type.${c}`) : c;
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
  const titre = t(nuit ? "themes.versJour" : "themes.versNuit");
  // symbole seul (☀︎ pour passer en jour, ☾ pour passer en nuit) ; le texte reste dans title et aria-label
  $("#themes").innerHTML = `<button type="button" class="actif symbole" title="${titre}" aria-label="${titre}">${nuit ? "☀︎" : "☾"}</button>`;
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
          `<button type="button" class="list-group-item list-group-item-action" data-k="${k}"><span class="badge text-bg-light me-2">${nomType(r.type)}</span>${echap(r.label)}</button>`).join("")
          || `<div class="list-group-item text-secondary">${t("recherche.aucun")}</div>`;
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
  arreterVol?.(); arreterVol = null;
  chargement?.abort();
  annulerCalcul();
  document.body.classList.add("accueil");
  $("#panneau").hidden = $("#panneauPro").hidden = $("#panneauAffichage").hidden = $("#diagramme").hidden = $("#coupe").hidden = true;
  message("");
  Object.assign(S, { lat: null, lon: null, G: null, horizon: null, zone: null, facades: null, resultat: null, coupe: null, coupes: [], heuresDemandees: false });
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
// vol de démonstration (#vol=gruyeres) : plan drone lent, rendu en direct (vol.js) ; à terme, le décor de l'accueil
let arreterVol = null;
async function vol(cle) {
  const id = ++tache;
  chargement?.abort();
  annulerCalcul();
  arreterVol?.(); arreterVol = null;
  scene.animation = null;
  document.body.classList.add("accueil");
  $("#panneau").hidden = $("#panneauPro").hidden = $("#panneauAffichage").hidden = $("#diagramme").hidden = $("#coupe").hidden = true;
  message("");
  Object.assign(S, { lat: null, lon: null, G: null, horizon: null, zone: null, facades: null, resultat: null, coupe: null, coupes: [], heuresDemandees: false });
  pro.reinitialiser();
  scene.decalage = 0.17; scene.taille();
  try {
    const arret = await lancerVol(scene, cle, { etat, actif: () => id === tache });
    if (id === tache) arreterVol = arret; else arret();
  } catch (e) { console.warn("Vol :", e); etat(1, ""); }
}
function quitterAccueil() {
  arreterVol?.(); arreterVol = null;
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
  $("#telechargementPct").textContent = k == null ? "" : t("pct", { n: Math.round(dernier.f * 100) });
  if (k != null) boite.setAttribute("aria-valuenow", Math.round(dernier.f * 100)); else boite.removeAttribute("aria-valuenow");
  if (k == null) {
    // durée inconnue : des carrés scintillent au hasard
    if (!scintille) scintille = setInterval(() => carres.forEach(c => c.className = Math.random() < 0.18 ? "vif" : ""), 140);
    return;
  }
  clearInterval(scintille); scintille = null;
  for (; allumes < k; allumes++) carres[ordre[allumes]].className = "plein";
}

/* ------------------------------------------------------------------ rayon de la maquette (curseur) */
const RAYON_FIN_MAX = 300; // relevé laser complet jusque-là ; au-delà : terrain 2 m et tuiles swisstopo
function ronde() { try { return localStorage.getItem("ombres.ronde") !== "0"; } catch { return true; } }
$("#vRonde").checked = ronde();
$("#vRonde").addEventListener("change", e => {
  try { localStorage.setItem("ombres.ronde", e.target.checked ? "1" : "0"); } catch { /* stockage indisponible */ }
  $("#rayonZone").max = e.target.checked ? 1000 : RAYON_FIN_MAX;
  if (S.G) depuisAdresse();
});
function rayonChoisi() { try { return +localStorage.getItem("ombres.rayonZone") || 0; } catch { return 0; } }
function afficherRayon(Rz) {
  $("#rayonZone").value = Rz;
  $("#rayonZoneVal").textContent = `${Rz} m`;
  $("#noteZone").textContent = Rz > RAYON_FIN_MAX ? t("zone.note", { r: RAYON_FIN_MAX }) : "";
}
/** Nouveau rayon : seul l'anneau change si le relevé fin reste le même, sinon le lieu est rechargé. */
function reglerRayon(Rz, recharger = true) {
  try { localStorage.setItem("ombres.rayonZone", String(Rz)); } catch { /* stockage indisponible */ }
  afficherRayon(Rz);
  if (!recharger || !S.G) return;
  const finAvant = S.G.rayonZone, finApres = Math.min(Rz, RAYON_FIN_MAX);
  if (finAvant === finApres && S.fin && Rz + 100 < S.fin.n * S.fin.c / 2) { S.rayonZone = Rz; paysageEtAnneau(tache, scene.idScene); }
  else depuisAdresse();
}
$("#rayonZone").addEventListener("input", e => { $("#rayonZoneVal").textContent = `${e.target.value} m`; });
$("#rayonZone").addEventListener("change", e => reglerRayon(+e.target.value));
$("#rayonZone").max = ronde() ? 1000 : RAYON_FIN_MAX;
afficherRayon(rayonChoisi() || 200);
/** Anneau (au-delà du relevé fin) et paysage lointain, qui commence au bord du cercle. */
async function paysageEtAnneau(id, idScene) {
  const G = S.G, Rz = S.rayonZone, fin = S.fin, E0 = S.E0, N0 = S.N0, rond = !!G?.rayonZone;
  if (!G || id !== tache) return;
  if (rond) scene.construireAnneau(fin, G.rayonZone, Rz, { E: E0, N: N0 });
  const bord = rond && Rz > G.rayonZone && scene.altAnneau ? scene.altAnneau : (x, y) => solEn(G, x, y);
  const g = await reliefLointain(E0, N0, rond ? Math.max(Rz, G.rayonZone) : G.R, scene.zRef, bord, fin, 50000, rond);
  if (id !== tache) { g.dispose(); return; }
  if (scene.loin.maille) { scene.scene.remove(scene.loin.maille); scene.loin.maille.geometry.dispose(); scene.loin.maille = null; }
  scene.afficherLointain(g, idScene, { E0, N0 });
}

async function depuisAdresse() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("vol")) return vol(h.get("vol"));
  if (!h.get("e")) return accueil();
  const E = +h.get("e"), N = +h.get("n"), id = ++tache;
  chargement?.abort();
  annulerCalcul();
  quitterAccueil();
  $("#panneau").hidden = false; $("#commandes").hidden = $("#panneauPro").hidden = $("#panneauAffichage").hidden = true; $("#heures").hidden = true; $("#diagramme").hidden = $("#coupe").hidden = true;
  $("#lieu").textContent = h.get("l") || `${E}, ${N}`;
  $("#lieuType").textContent = nomType(h.get("t") || "");
  $("#source").textContent = "";
  message("");
  try {
    etat(0.02, t("etat.parcelle"));
    const parcelle = await parcelleEn(E, N);
    if (id !== tache) return;
    // centre et rayon : la parcelle et ~120 m autour (bâtiments voisins, arbres)
    let E0 = E, N0 = N, demi = 20;
    if (parcelle) {
      const xs = parcelle.anneaux.flat().map(p => p[0]), ys = parcelle.anneaux.flat().map(p => p[1]);
      E0 = (Math.min(...xs) + Math.max(...xs)) / 2; N0 = (Math.min(...ys) + Math.max(...ys)) / 2;
      demi = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
      $("#lieuType").textContent = `${t("lieu.parcelle", { n: parcelle.numero })} · ${parcelle.canton}${h.get("t") === "Adresse" ? " · " + h.get("l") : ""}`;
      $("#lieu").textContent = (h.get("l") || "").replace(/\s*\(CH.*\)$/, "");
    } else message(t("msg.pasDeParcelle"), 0);
    E0 = Math.round(E0); N0 = Math.round(N0);
    // maquette ronde : rayon choisi (curseur), sinon automatique ; relevé laser jusqu'à 300 m, au-delà un anneau
    // carrée : pas d'anneau, le rayon s'arrête au relevé fin
    const Rz = Math.min(ronde() ? 1e9 : RAYON_FIN_MAX, rayonChoisi() || Math.min(300, Math.max(150, Math.ceil(demi + 120)))), R = Math.min(Rz, RAYON_FIN_MAX);
    afficherRayon(Rz);
    const boite = [E0 - R, N0 - R, E0 + R, N0 + R];
    const rel = parcelle ? { ...parcelle, anneauxRel: parcelle.anneaux.map(a => a.map(([e, n]) => [e - E0, n - N0])) } : { anneauxRel: [] };

    // relief lointain : ses tuiles se téléchargent pendant le chargement du relevé ; l'altitude de l'observateur
    // (connue une fois le terrain reconstruit) lui est donnée plus bas
    let donnerAltitude, horizonFini = 0;
    const horizon = profilHorizon(E0, N0, new Promise(r => donnerAltitude = r), { rayonProche: R, onProgres: f => horizonFini = f });
    horizon.catch(() => {}); // l'erreur éventuelle est traitée à l'attente, plus bas

    etat(0.05, t("etat.releve"));
    let G, nuage = null, source;
    const copc = await tuilesNuage(boite);
    if (id !== tache) return;
    if (copc) {
      nuage = await chargerNuage(copc, boite, [E0, N0], 0.5, (f, t) => id === tache && etat(0.05 + 0.7 * f, t), (chargement = new AbortController()).signal);
      if (id !== tache) return;
      etat(0.78, t("etat.reconstruction"));
      await pause();
      G = depuisPoints(nuage, R);
      source = t("source.nuage", { annees: [...new Set(copc.map(u => u.annee))].join(", "), n: entier(nuage.n) });
    } else {
      const g = await tuilesGrille(boite);
      G = await depuisRasters(g, [E0, N0], R, 0.5, (f, t) => id === tache && etat(0.05 + 0.7 * f, t));
      if (id !== tache) return;
      source = t("source.grille", { terrain: [...new Set(g.terrain.map(u => u.annee))].join(", "), surface: [...new Set(g.surface.map(u => u.annee))].join(", ") });
    }
    if (ronde()) garderCercle(G, R); // ne montrer que le cercle (sinon : maquette carrée, comme avant)
    S.rayonZone = Rz;
    $("#source").textContent = source;
    [S.lon, S.lat] = versWgs(E0, N0);
    Object.assign(S, { E0, N0, parcelle: rel, G, horizon: null, zone: null, facades: null, resultat: null, coupe: null, coupes: [], heuresDemandees: false });
    $("#vCoupe").checked = false; $("#outilsCoupe").hidden = true;
    $("#btnHeures").textContent = t("heures.calculer");
    etat(0.85, t("etat.scene"));
    await pause();
    scene.controls.autoRotate = false;
    scene.typeFond = typeFond();
    scene.construire(G, nuage, rel, { cadastre: urlFond(COUCHES.cadastre, boite), ortho: urlFond(COUCHES.ortho, boite) });
    scene.tuilesPlan.placer(E0, N0, G.R); // plan autour : tuiles en mémoire aussitôt, les autres au fil de l'eau
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
    if (horizonFini < 1) etat(0.9 + 0.1 * horizonFini, t("etat.relief"));
    S.horizon = await horizon;
    if (id !== tache) return;
    // paysage jusqu'à 50 km, des mêmes tuiles (déjà en cache), sans bloquer
    const idScene = scene.idScene;
    // anneau intermédiaire : terrain swissALTI3D à 2 m jusqu'à 2 km, puis relief libre jusqu'à 50 km
    const RAYON_FIN = Math.max(2000, Rz + 600);
    tuilesAlti2m([E0 - RAYON_FIN, N0 - RAYON_FIN, E0 + RAYON_FIN, N0 + RAYON_FIN])
      .then(l => terrainAutour(l, E0, N0, RAYON_FIN)).catch(e => { console.warn("swissALTI3D 2 m :", e.message); return null; })
      .then(fin => { if (id === tache) { S.fin = fin; return paysageEtAnneau(id, idScene); } })
      .catch(e => console.warn("Relief lointain :", e.message));
    etat(1, "");
    $("#commandes").hidden = $("#panneauPro").hidden = $("#panneauAffichage").hidden = false; $("#diagramme").hidden = false;
    majSoleil();
    pro.apresChargement(); // projet rouvert depuis la liste : démolitions, volumes, coupes
    compter("lieu");
  } catch (e) {
    if (id !== tache) return; // lieu changé entre-temps : le chargement abandonné n'affiche rien
    console.error(e);
    telechargement("lieu", null);
    message(t("msg.erreur", { m: e.message }));
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
  $("#jourTexte").textContent = date(new Date(S.jour + "T12:00"), { day: "numeric", month: "short", year: "numeric" });
  $("#heure").value = S.minutes;
  $("#heureTexte").textContent = hhmm(S.minutes);
  if (S.lat == null) return;
  const p = soleilActuel();
  scene.placerSoleil(directionSoleil(p), p.visible);
  const etatSoleil = p.hauteur <= 0 ? t("soleil.couche") : p.visible ? t("soleil.visible") : t("soleil.cacheRelief", { h: nombre(p.horizon, 1) });
  $("#soleilTexte").innerHTML = t("soleil.texte", { az: nombre(p.azimut, 0), h: nombre(p.hauteur, 1), etat: etatSoleil });
  if (S.horizon) {
    dessinerDiagramme($("#svgSoleil"), { horizon: S.horizon, jour: S.jour, minutes: S.minutes, lat: S.lat, lon: S.lon });
    const v = soleilVisible(S.jour, S.lat, S.lon, S.horizon);
    $("#horizonTexte").textContent = v.debut == null ? t("soleil.cacheJournee")
      : t("soleil.auDessus", { debut: hhmm(v.debut), fin: hhmm(v.fin), duree: duree(v.minutes / 60) });
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
    { nom: t("dir.E"), v: [1, 0, 0], couleur: "#c8553d", vue: "E" }, { nom: t("dir.O"), v: [-1, 0, 0], couleur: "#c8553d", neg: true, vue: "O" },
    { nom: t("dir.N"), v: [0, 0, -1], couleur: "#5b8c3a", vue: "N" }, { nom: t("dir.S"), v: [0, 0, 1], couleur: "#5b8c3a", neg: true, vue: "S" },
    { nom: "Z", v: [0, 1, 0], couleur: "#3d6fb6", vue: "plan", titre: t("boussole.plan") }, { nom: "", v: [0, -1, 0], couleur: "#3d6fb6", neg: true },
  ];
  const TITRES = { E: t("boussole.E"), O: t("boussole.O"), N: t("boussole.N"), S: t("boussole.S") };
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
      const g = el("g", { class: "bout centre", "data-vue": "3d", role: "button", "aria-label": t("boussole.3d") });
      el("title", {}, g).textContent = t("boussole.3d");
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
  telechargement("roofer", t("etat.roofer"), 0);
  try {
    const m = await maillageRoofer(S.roofer, [S.E0, S.N0], scene.zRef, matRoofer,
      (f, mo) => telechargement("roofer", t("etat.rooferMo", { mo }), f));
    if (lieu === S.E0 && choixBatiments() === "roofer") scene.afficherRoofer(m);
  } finally { telechargement("roofer", null); }
}
scene.surTuilesSwiss = n => telechargement("swiss", n > 0 && !scene.vol ? t("etat.swiss", { n }) : null); // le vol charge sans bandeau
// bâtiments affichés : un seul jeu à la fois (relevé, swisstopo, roofer là où il a été calculé, ou aucun)
function choixBatiments() { return $("input[name=batiments]:checked")?.value || "releve"; }
const NOTES = {
  releve: "", aucun: "",
  swiss: t("aff.noteSwiss"),
  roofer: t("aff.noteRoofer"),
};
function choixRoofer() {
  $("#bRoofer").disabled = !S.roofer;
  $("#etiquetteRoofer").hidden = $("#bRoofer").hidden = !S.roofer;
  if (S.roofer) $("#etiquetteRoofer").title = t("aff.rooferEssai", { nom: S.roofer.nom });
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
// case « Swiss3D » de la ligne Bâtiments : coche le bouton radio (caché) du jeu voulu, la suite passe par son événement.
// « aucun » et « roofer » (anciens choix restaurés par le navigateur) retombent sur le relevé.
function synchroSwiss() {
  if (!["releve", "swiss"].includes(choixBatiments())) $("#bReleve").checked = true;
  $("#vSwiss").checked = choixBatiments() === "swiss";
}
$("#vSwiss").addEventListener("change", e => {
  const r = $(e.target.checked ? "#bSwiss" : "#bReleve");
  r.checked = true;
  r.dispatchEvent(new Event("change"));
});
synchroSwiss();
window.addEventListener("pageshow", synchroSwiss);
// sol : photo aérienne (prioritaire), plan cadastral, ou uni
function typeFond() { return $("#vReel").checked ? "ortho" : $("#vCadastre").checked ? "cadastre" : "uni"; }
$("#vCadastre").addEventListener("change", () => scene.fond(typeFond()));
scene.surFondAbsent = () => message(t("msg.cadastreAbsent"));
$("#vEffets").addEventListener("change", e => scene.reglerEffets(e.target.checked));
$("#vCouleursReelles").addEventListener("change", e => {
  scene.couleursPoints(e.target.checked);
  if (e.target.checked && !$("#vPoints").checked && !$("#vPoints").disabled) { $("#vPoints").checked = true; appliquerAffichage(); }
});
$("#vReel").addEventListener("change", () => scene.fond(typeFond()));
$("#vLointain").addEventListener("change", e => scene.reglerLointain({ voir: e.target.checked }));
$("#vBrume").addEventListener("change", e => scene.reglerLointain({ brume: e.target.checked }));
$("#vDegrade").addEventListener("change", e => scene.degradeHauteur(e.target.checked));
scene.surQualite = q => {
  if (q < 2) return;
  $("#vEffets").checked = false;
  if (S.G && S.lat != null) message(t("msg.effetsCoupes"));
};
$("#btnPartager").onclick = async () => { await navigator.clipboard.writeText(location.href); $("#btnPartager").textContent = t("panneau.copie"); setTimeout(() => $("#btnPartager").textContent = t("panneau.lien"), 1500); };

/* ------------------------------------------------------------------ coupe */
function majCoupe(A, B) {
  // la coupe suit le jeu de bâtiments affiché (relevé, swisstopo, roofer ou aucun) ; en mode pro, points du nuage proches
  const jeu = choixBatiments(), hv = scene.hauteursVolumes();
  let grille = jeu === "swiss" || jeu === "roofer" ? scene.grilleComparaison(jeu) : null;
  // volumes du projet : ajoutés aux bâtiments coupés (au relevé comme aux autres jeux)
  if (hv) {
    const b = grille || (jeu === "releve" ? S.G.bat : null), g = new Float32Array(hv.length);
    for (let p = 0; p < g.length; p++) g[p] = Math.max(b && !isNaN(b[p]) ? b[p] : -Infinity, isNaN(hv[p]) ? -Infinity : hv[p]);
    for (let p = 0; p < g.length; p++) if (g[p] === -Infinity) g[p] = NaN;
    grille = g;
  }
  const distance = scene.nuage ? +$("#distPoints").value : 0;
  const P = profilCoupe(S.G, scene.contours, A, B, S.parcelle, 0.25, S.voisines || [],
    { batiments: grille || (jeu === "releve" ? null : "aucun"), nuage: scene.nuage, distance });
  // plusieurs coupes : celle-ci est l'active (en 3D et dessinée) ; une nouvelle reçoit la paire de lettres libre suivante
  if (!S.coupe) { S.coupe = { lettres: lettresLibres() }; S.coupes.push(S.coupe); }
  Object.assign(S.coupe, { A, B, P });
  P.lettres = S.coupe.lettres;
  ongletsCoupe();
  $("#legendePoints").hidden = !S.coupe.P.points;
  scene.definirCoupe(S.coupe.P);
  dessinCoupe();
}
function lettresLibres() {
  for (let k = 0; ; k++) {
    const l = [String.fromCharCode(65 + k), String.fromCharCode(65 + k) + "'"]; // A et A', puis B et B'…
    if (!S.coupes.some(c => c.lettres[0] === l[0])) return l;
  }
}
// onglets des coupes au-dessus du dessin : choisir, retirer (×), ajouter
function ongletsCoupe() {
  const el = $("#ongletsCoupe");
  el.replaceChildren(...S.coupes.map(c => {
    const b = document.createElement("span");
    b.className = "onglet-coupe" + (c === S.coupe ? " actif" : "");
    const nom = document.createElement("button");
    nom.type = "button"; nom.textContent = t("coupe.nom", { a: c.lettres[0], b: c.lettres[1] });
    nom.onclick = () => { if (c !== S.coupe) { S.coupe = c; majCoupe(c.A, c.B); } };
    const x = document.createElement("button");
    x.type = "button"; x.className = "retirer"; x.textContent = "×"; x.title = x.ariaLabel = t("coupe.retirer");
    x.onclick = () => {
      S.coupes = S.coupes.filter(d => d !== c);
      if (!S.coupes.length) { $("#vCoupe").checked = false; $("#vCoupe").dispatchEvent(new Event("change")); return; }
      if (c === S.coupe) { S.coupe = S.coupes.at(-1); majCoupe(S.coupe.A, S.coupe.B); } else ongletsCoupe();
    };
    b.append(nom, x);
    return b;
  }), (() => {
    const plus = document.createElement("button");
    plus.type = "button"; plus.className = "ajouter"; plus.textContent = t("coupe.ajouter");
    plus.onclick = () => { S.coupe = null; majCoupe(...coupeParDefaut(S.coupes.length % 2 === 1)); };
    return plus;
  })());
}
/** Coupe par défaut à travers la parcelle : sud–nord (soleil de midi dans le plan), ou ouest–est en travers. */
function coupeParDefaut(travers = false) {
  const pts = S.parcelle.anneauxRel.flat(), demi = pts.length ? Math.max(...pts.map(p => Math.abs(p[travers ? 0 : 1]))) : 15;
  const L = Math.min(S.G.R - 5, Math.max(35, demi + 25));
  return travers ? [[-L, 0], [L, 0]] : [[0, -L], [0, L]];
}
function dessinCoupe() {
  const r = dessinerCoupe($("#svgCoupe"), S.coupe.P, soleilActuel(), { audela: $("#vueAudela").value });
  $("#coupeTexte").textContent = r ? `· ${nombre(r.long, 0)} m${r.note ? " · " + r.note : ""}` : "";
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
  if (!e.target.checked) { S.coupe = null; S.coupes = []; scene.definirCoupe(null); return; }
  S.coupe = null; S.coupes = [];
  majCoupe(...coupeParDefaut());
  compter("coupe");
});
$("#btnTracer").onclick = () => {
  const actif = !$("#btnTracer").classList.contains("active");
  $("#btnTracer").classList.toggle("active", actif);
  $("#aideCoupe").textContent = t(actif ? "coupe.aideA" : "coupe.aide");
  scene.tracer(actif ? (A, B) => {
    $("#btnTracer").classList.remove("active");
    $("#aideCoupe").textContent = t("coupe.aide");
    majCoupe(A, B);
  } : null);
};
scene.surDepart = () => $("#aideCoupe").textContent = t("coupe.aideB");
scene.surCoupe = (A, B) => majCoupe(A, B);
const refaireCoupe = () => { if (S.coupe) majCoupe(S.coupe.A, S.coupe.B); };
// bâtiments de comparaison arrivés ou changés (tuiles swisstopo, roofer) : la coupe, et la carte des heures si elle est
// affichée, sont recalculées avec les bâtiments montrés
scene.surBatiments = () => { refaireCoupe(); relancerHeures(); };
$("#distPoints").addEventListener("change", refaireCoupe);
$("#vueAudela").addEventListener("change", () => { try { localStorage.setItem("vueAudela", $("#vueAudela").value); } catch { /* stockage indisponible */ } if (S.coupe) dessinCoupe(); });
try { const v = localStorage.getItem("vueAudela"); if (v && $(`#vueAudela option[value="${v}"]`)) $("#vueAudela").value = v; } catch { /* idem */ }
$("#vPro").addEventListener("change", refaireCoupe);

/* ------------------------------------------------------------------ heures d'ensoleillement */
let calcul = null, attente = null;
const periode = () => $("input[name=periode]:checked").value;
const clePeriode = () => `${periode()}:${S.jour.slice(0, periode() === "jour" ? 10 : periode() === "mois" ? 7 : 4)}:${nomJeuHeures()}:${S.versionProjet || 0}`;
const nomJeuHeures = () => {
  if (choixBatiments() !== "swiss" || !S.G) return "releve";
  const h = scene.grilleComparaison("swiss");
  return h && h.some(v => !isNaN(v)) ? "swiss" : "releve";
};
/**
 * Bâtiments du calcul des heures : ceux qui sont affichés. Relevé : grilles de la maquette ; Swiss3D : leurs toits vus de
 * dessus remplacent les bâtiments du relevé (sol et arbres inchangés). Tant que ses tuiles manquent, le relevé.
 */
function contoursHeures() {
  if (nomJeuHeures() !== "swiss") return scene.contours;
  const h = scene.grilleComparaison("swiss");
  if (S.contoursSwiss?.h !== h) S.contoursSwiss = { h, C: contoursBatiments(S.G, h) };
  return S.contoursSwiss.C;
}
function jeuHeures() {
  const G = S.G, nom = nomJeuHeures(), hv = scene.hauteursVolumes(); // volumes du projet (mode pro), ajoutés aux bâtiments
  if (nom === "releve" && !hv) return { nom, surface: G?.surface, base: G?.base };
  const h = nom === "swiss" ? scene.grilleComparaison("swiss") : null;
  const base = new Float32Array(G.n * G.n), surface = new Float32Array(G.n * G.n);
  for (let p = 0; p < base.length; p++) {
    base[p] = h ? (isNaN(h[p]) ? G.sol[p] : Math.max(G.sol[p], h[p])) : G.base[p];
    if (hv && !isNaN(hv[p])) base[p] = Math.max(base[p], hv[p]);
    surface[p] = Math.max(base[p], G.veg[p] || -1e9);
  }
  return { nom, surface, base };
}
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
  const zone = S.zone ||= zoneHeures(G, S.parcelle.anneauxRel);
  // bâtiments de la carte : ceux du relevé, ou les Swiss3D (contours tirés de leurs toits vus de dessus) : toits et
  // façades colorés épousent alors les bâtiments affichés
  const C = contoursHeures();
  if (S.facades?.contours !== C) S.facades = { ...carreauxFacades(G, C, zone), contours: C };
  const facades = S.facades;
  const P = soleilsPeriode(periode(), S.jour, S.lat, S.lon, S.horizon), cle = clePeriode(), debut = performance.now(), jeu = jeuHeures();
  const heures = new Float32Array(zone.w * zone.h), heuresF = new Float32Array(facades.carreaux.length);
  const fin = () => {
    calcul = null;
    etat(1, "");
    S.resultat = { heures, heuresF, P, cle, ms: performance.now() - debut };
    compter("heures");
    $("#btnHeures").textContent = t("heures.recalculer");
    afficherResultat();
  };
  // les positions du soleil sont réparties entre quelques fils de calcul
  const nb = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, Math.ceil(P.soleils.length / 3)));
  if (!P.soleils.length) return fin();
  const lots = Array.from({ length: nb }, () => []), avance = new Float32Array(nb);
  P.soleils.forEach((s, k) => lots[k % nb].push(s));
  let restants = nb;
  etat(0.01, t("etat.heures"));
  const moi = calcul = { cle, ouvriers: lots.map((lot, k) => {
    const w = new Worker(new URL("./ensoleillement.worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      if (calcul !== moi) return;
      if (data.progres != null) { avance[k] = data.progres; etat(0.99 * avance.reduce((a, b) => a + b) / nb, t("etat.heuresPeriode", { titre: P.titre })); return; }
      w.terminate();
      for (let p = 0; p < heures.length; p++) heures[p] += data.heures[p];
      for (let p = 0; p < heuresF.length; p++) heuresF[p] += data.heuresF[p];
      if (--restants === 0) fin();
    };
    w.postMessage({ surface: jeu.surface, base: jeu.base, n: G.n, c: G.c, zone: [zone.i0, zone.j0, zone.i1, zone.j1], alpha: zone.alpha, soleils: lot, facades: facades.pts });
    return w;
  }) };
}

function afficherResultat() {
  const { heures, heuresF, P, ms } = S.resultat, zone = S.zone, max = Math.max(0.5, P.max), parJour = P.nbJours > 1 ? t("heures.parJour") : "";
  scene.zoneArbres(zone);
  scene.afficherHeures(maillagesHeures(S.G, S.facades.contours, zone, S.facades, { heures, heuresF }, max, T.heures, scene.zRef));
  // statistiques sur les cellules de la parcelle (à défaut : le cœur de la zone)
  const sans = !S.parcelle.anneauxRel.length;
  let s = 0, k = 0, mn = Infinity, mx = 0;
  for (let p = 0; p < heures.length; p++) {
    if (sans ? zone.alpha[p] < 1 : !zone.parcelle[p]) continue;
    s += heures[p]; k++; mn = Math.min(mn, heures[p]); mx = Math.max(mx, heures[p]);
  }
  $("#heures").hidden = false;
  $("#heuresMax").textContent = duree(max) + parJour;
  $("#heuresStats").innerHTML = (k ? t("heures.stats", { lieu: t(sans ? "heures.autourPoint" : "heures.parcelle"), titre: P.titre, moyenne: duree(s / k) + parJour, min: duree(mn), max: duree(mx) }) : "")
    + `<span class="text-secondary">${t("heures.resume", { titre: P.titre, max: duree(P.max) + parJour, carreaux: entier(S.facades.carreaux.length), s: nombre(ms / 1000, 1) })}</span>`;
  $("#vHeures").checked = true;
  appliquerAffichage();
}

marquerTheme();
/* ------------------------------------------------------------------ choisir une autre parcelle d'un clic */
// Un clic (sans glisser) sur le terrain ou un toit choisit la parcelle à cet endroit, sans recharger la maquette.
// En mode pro, le clic revient à la sélection (pro.js), comme pendant le tracé de la coupe.
{
  const el = scene.renderer.domElement;
  let appui = null;
  el.addEventListener("pointerdown", e => { appui = [e.clientX, e.clientY]; });
  el.addEventListener("pointerup", e => {
    if (!appui || Math.hypot(e.clientX - appui[0], e.clientY - appui[1]) > 5 || e.button !== 0) return;
    appui = null;
    if (!S.G || !S.toutes?.length || scene.trace || scene.modeVue === "N" || scene.modeVue === "S" || scene.modeVue === "E" || scene.modeVue === "O") return;
    if (pro.dessine()) return; // dessin d'un volume : les clics lui reviennent
    let p = scene.pointSol(e);
    // hors de la maquette : la parcelle visée sur le plan autour, à construire en 3D d'un clic
    if (!p || Math.max(Math.abs(p[0]), Math.abs(p[1])) > S.G.R) {
      const q = scene.pointLointain(e);
      if (q) proposerAilleurs(S.E0 + q[0], S.N0 + q[1], e.clientX, e.clientY);
      return;
    }
    $("#ailleurs").hidden = true;
    if ($("#vPro")?.checked) return; // mode pro : le clic sélectionne un bâtiment, ou ceux de la parcelle (pro.js)
    const choisie = S.toutes.find(q => dansParcelle(p[0], p[1], q.anneauxRel));
    if (choisie && choisie.numero !== S.parcelle?.numero) choisirParcelle(choisie);
  });
}
// petite bulle « Parcelle n · Construire la 3D ici » à l'endroit du clic
let demandeAilleurs = 0;
async function proposerAilleurs(E, N, x, y) {
  const b = $("#ailleurs"), id = ++demandeAilleurs;
  b.style.left = `${x}px`; b.style.top = `${y}px`;
  $("#ailleursNom").textContent = t("ailleurs.recherche");
  $("#btnAilleurs").disabled = true;
  b.hidden = false;
  let p = null;
  try { p = await parcelleEn(E, N); } catch { /* service indisponible : on construit au point cliqué */ }
  if (id !== demandeAilleurs) return;
  const nom = p ? t("lieu.parcelle", { n: p.numero }) : `${Math.round(E)}, ${Math.round(N)}`;
  $("#ailleursNom").textContent = nom;
  $("#btnAilleurs").disabled = false;
  $("#btnAilleurs").onclick = () => {
    b.hidden = true;
    location.hash = `e=${Math.round(E)}&n=${Math.round(N)}&l=${encodeURIComponent(nom)}&t=${p ? "Parcelle" : "Adresse"}`;
  };
}
document.addEventListener("pointerdown", e => { if (!e.target.closest("#ailleurs") && e.target !== scene.renderer.domElement) $("#ailleurs").hidden = true; });
scene.controls.addEventListener("start", () => { $("#ailleurs").hidden = true; });

// bouton « Retour à l'adresse » : dès que la vue s'éloigne de la maquette
function majRetour() {
  const c = scene.controls.target, R = S.G?.R || 0;
  $("#retour").hidden = !S.G || Math.hypot(c.x, c.z) < R * 1.2 + 30;
}
scene.controls.addEventListener("change", majRetour);
$("#retour").addEventListener("click", () => { scene.revenir(); majRetour(); });

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
  $("#lieuType").textContent = `${t("lieu.parcelle", { n: p.numero })}${S.parcelle.canton ? " · " + S.parcelle.canton : ""}`;
  $("#lieu").textContent = t("lieu.parcelle", { n: p.numero });
  history.replaceState(null, "", `${location.pathname}${location.search}#e=${E}&n=${N}&l=${encodeURIComponent(t("lieu.parcelle", { n: p.numero }))}&t=Parcelle`);
  if (S.coupe) majCoupe(S.coupe.A, S.coupe.B);
  if (S.heuresDemandees) calculerHeures(); else scene.afficherHeures?.(null);
}

// mode pro : sélection et masquage de bâtiments, taille de la maquette, exports (pro.js)
const pro = brancherPro({ scene, S, message, etat, recharger: depuisAdresse, calculerHeures, annulerCalcul, majCoupe, soleilActuel, compte, compter,
  relancerHeures, ouvrirCoupes, rayonZone: () => S.rayonZone, reglerRayon, parcelleEn: (x, y) => S.toutes?.find(q => dansParcelle(x, y, q.anneauxRel)), changerJour: j => { $("#jour").value = j; $("#jour").dispatchEvent(new Event("change")); } });
// coupes d'un projet rouvert : toutes recréées, la dernière active
function ouvrirCoupes(liste) {
  if (!$("#vCoupe").checked) { $("#vCoupe").checked = true; $("#outilsCoupe").hidden = $("#coupe").hidden = false; }
  S.coupes = [];
  for (const c of liste) { S.coupe = null; majCoupe(c.A, c.B); }
}

majSoleil();
depuisAdresse();
if (import.meta.env.DEV) window.ombres = { scene, S }; // pour l'inspection pendant le développement

// pages légales (mentions, confidentialité, conditions, contact) dans une boîte de dialogue
{
  const dlg = document.getElementById("legal");
  const ouvrir = page => {
    dlg.querySelectorAll("section[data-page]").forEach(s => { s.hidden = s.dataset.page !== page; });
    dlg.querySelectorAll(".legal-onglets a").forEach(a => a.classList.toggle("actif", a.dataset.legal === page));
    if (!dlg.open) dlg.showModal();
  };
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-legal]");
    if (a) { e.preventDefault(); ouvrir(a.dataset.legal); return; }
    if (e.target.closest("[data-fermer]") || e.target === dlg) dlg.close();
  });
}
