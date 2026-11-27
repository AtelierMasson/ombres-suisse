import "bootstrap/dist/css/bootstrap.min.css";
import "./style.css";
document.documentElement.classList.add("pret"); // styles chargés : la page peut s'afficher
import { textureHeures } from "./heures.js";
import { pontsAutour } from "./pontsModeles.js";
import { brancherLieux } from "./lieux.js";
import { brancherCalendrier } from "./calendrier.js";
import { brancherFiche } from "./fiche.js";
import { t, nombre, entier, date, traduirePage, brancherSelecteur } from "./i18n.js";
import { chercher, parcelleEn, parcellesAutour, tuilesNuage, tuilesGrille, tuilesAlti2m, tuilesAlti05, versWgs, lireCoordonnees } from "./geo.js";
import { chargerNuage } from "./nuage.js";
import { LodAnneau } from "./lodAnneau.js";
import { depuisPoints, depuisRasters, solEn, terrainAutour, garderCercle, majSurface, grilleTerrain, solDepuisTerrain, solAlti05, altitudeTerrain, prechargerAlti } from "./grille.js";
import { reliefLointain } from "./lointain.js";
import { Scene3D } from "./scene.js";
import { essaiRoofer, maillageRoofer, maillagePolygones } from "./roofer.js";
import { emprisesOfficielles } from "./reconstruction/emprises.js";
import * as THREE from "three";
import { positionSoleil, directionSoleil, dateA } from "./soleil.js";
import { profilHorizon, horizonA } from "./horizon.js";
import { dessinerDiagramme, soleilVisible, heureSousPointeur } from "./diagramme.js";
import { themeInitial, appliquerTheme } from "./themes.js";
import { urlFond, COUCHES, prechargerFonds } from "./fond.js";
import { zoneHeures, soleilsPeriode, carreauxFacades, maillagesHeures } from "./heures.js";
import { contoursBatiments } from "./contours.js";
import { profilCoupe, dessinerCoupe } from "./coupe.js";
import { lancerVol } from "./vol.js";
import { fondLacs, fondAutour } from "./bathy.js";
import { ICONE } from "./icones.js";
import { brancherSuggestion } from "./suggestion.js";
brancherSuggestion();
import { brancherPro } from "./pro.js";
import { brancherCompte } from "./compte.js";
import { brancherPub } from "./pub.js";
import { brancherRapport } from "./rapportBug.js";
import { bassinsAutour, creuserBassins } from "./piscines.js";
import { brancherInterface } from "./interface.js";
import { brancherVuePlan } from "./vuePlan.js";
import "./compte.css";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
// textes de la page dans la langue choisie, et sélecteur de langue au pied de page
traduirePage();
brancherSelecteur($("#langues"));
// compte (connexion par lien e-mail, achat de la version pro) : sans l'API (site statique actuel), le bouton reste caché
// et tout reste ouvert
const compte = brancherCompte({ api: "/api", t });
brancherPub(compte);
compte.addEventListener("compte", () => S.coupe && ongletsCoupe()); // bouton « Ajouter une coupe » : Pro ou non // publicité de la version gratuite (aucune pour les comptes Pro)
compte.monter($("#zoneCompte")); // « Mon compte », à droite de la barre du haut
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
// rapport de bug des administrateurs : capture, commentaire et état (lieu, rayon, onglet, coupes, réglages)
brancherRapport({ compte, scene, t, etatApp: () => ({
  lieu: { E: S.E0, N: S.N0, rayon: S.rayonZone, parcelle: S.parcelle?.numero ?? null, egrid: S.parcelle?.egrid ?? null },
  jour: S.jour, minutes: S.minutes, onglet: $("#colonne")?.dataset.onglet, theme: document.body.dataset.theme || null,
  coupes: (S.coupes || []).map(c => ({ A: c.A, B: c.B })),
  interrupteurs: Object.fromEntries($$("#colonne input[type=checkbox][id], #colonne select[id], #colonne input[type=range][id]").map(i => [i.id, i.type === "checkbox" ? i.checked : i.value])),
}) });
brancherVuePlan(scene, S); // vue plan dessinée (emprises officielles, sans la maquette 3D)

function aujourdhui() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const duree = v => { const m = Math.round(v * 60); return t("duree", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") }); };
// type de lieu (« Adresse », « Parcelle » : codes internes, aussi dans l'adresse de la page) dans la langue choisie
const nomType = c => c === "Adresse" || c === "Parcelle" || c === "Lieu" ? t(`type.${c}`) : c;
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
  // symbole seul (soleil pour passer en jour, lune pour passer en nuit) ; le texte reste dans title et aria-label
  $("#themes").innerHTML = `<button type="button" class="actif symbole" title="${titre}" aria-label="${titre}">${nuit ? ICONE.soleil : ICONE.lune}</button>`;
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
// accueil : le décor réel de Gruyères, la caméra qui avance lentement vers le château
function accueil() {
  tache++;
  arreterVol?.(); arreterVol = null;
  chargement?.abort();
  annulerCalcul();
  telechargement("affinage", null);
  document.body.classList.add("accueil");
  $("#panneau").hidden = $("#panneauPro").hidden = $("#panneauExport").hidden = $("#panneauAffichage").hidden = $("#diagramme").hidden = $("#coupe").hidden = true;
  message("");
  Object.assign(S, { lat: null, lon: null, G: null, horizon: null, zone: null, facades: null, resultat: null, coupe: null, coupes: [], heuresDemandees: false });
  pro.reinitialiser();
  scene.controls.autoRotate = false;
  scene.animation = null;
  scene.decalage = 0.17; scene.taille();
  // Gruyères tout de suite, en un seul chargement : un seul cercle (ACCUEIL.R) et une seule caméra, qui suit son trajet
  // dès la première image ; les points du relevé apparaissent, puis le terrain, les bâtiments et les arbres montent
  debutAccueil = null; decalageAccueil = 0;
  volAccueil(ACCUEIL.E, ACCUEIL.N);
  setTimeout(() => {
    if (!document.body.classList.contains("accueil") || location.hash.includes("e=")) return;
    depuisAdresse({ accueil: ACCUEIL });
  }, 0);
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
  $("#panneau").hidden = $("#panneauPro").hidden = $("#panneauExport").hidden = $("#panneauAffichage").hidden = $("#diagramme").hidden = $("#coupe").hidden = true;
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
  scene.loin.facteurBrume = $("#brume").value / 100; scene.loin.brume = +$("#brume").value > 0;
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
  // lac dans la maquette : il continue dans l'anneau (même niveau, fond mesuré s'il y en a)
  let lac = null;
  if (rond && Rz > G.rayonZone) {
    const niv = G.eau ? [...G.eau].filter(v => !isNaN(v)).sort((a, b) => a - b) : [];
    const fond = await fondAutour(E0, N0, Rz).catch(() => null);
    if (id !== tache) return;
    // un lac dans l'anneau seulement s'il y a un vrai lac : fond mesuré (swissBATHY3D) sur au moins ~4500 m² de
    // l'anneau. L'eau de la maquette fine seule (bassin, étang, points d'eau mal classés) ne fait plus de lac : son niveau
    // noyait tout l'anneau plus bas qu'elle (maisons et routes sous l'eau en haut de Lutry).
    if (fond && fin) {
      // là où le fond est mesuré, le terrain à 2 m donne la surface de l'eau ; niveau = la médiane de ces altitudes (le
      // niveau mesuré par le laser est ~0,5 m plus bas)
      const alt = (E, N) => { const i = Math.floor((E - fin.e0) / fin.c), j = Math.floor((fin.n1 - N) / fin.c); return i < 0 || j < 0 || i >= fin.n || j >= fin.n ? NaN : fin.h[j * fin.n + i]; };
      const z = [];
      for (let y = -Rz; y <= Rz; y += 15) for (let x = -Rz; x <= Rz; x += 15) {
        const d = Math.hypot(x, y);
        if (d < G.rayonZone || d > Rz || isNaN(fond(E0 + x, N0 + y))) continue;
        const h = alt(E0 + x, N0 + y);
        if (!isNaN(h)) z.push(h);
      }
      if (z.length > 20) {
        z.sort((a, b) => a - b);
        const n2 = z[z.length >> 1] - 0.5, n1 = niv.length ? niv[niv.length >> 1] : NaN;
        // niveau mesuré par le laser dans la maquette, s'il s'agit du même lac (à 3 m près)
        lac = { niveau: Math.abs(n1 - n2) < 3 ? n1 : n2, fond };
      }
    }
  }
  if (rond) scene.construireAnneau(fin, G.rayonZone, Rz, { E: E0, N: N0 }, lac);
  if (rond && Rz > G.rayonZone + 5) arbresAnneau(id, G.rayonZone, Rz, E0, N0);
  // raccord du paysage au bord : la surface de l'eau sur le lac (et non le fond), le terrain ailleurs
  const bordSol = rond && Rz > G.rayonZone && scene.altAnneau ? scene.altAnneau : (x, y) => solEn(G, x, y);
  const bord = lac ? (x, y) => Math.max(bordSol(x, y), lac.niveau) : bordSol;
  const g = await reliefLointain(E0, N0, rond ? Math.max(Rz, G.rayonZone) : G.R, scene.zRef, bord, fin, 50000, rond, lac?.niveau ?? NaN);
  if (id !== tache) { g.dispose(); return; }
  if (scene.loin.maille) { scene.scene.remove(scene.loin.maille); scene.loin.maille.geometry.dispose(); scene.loin.maille = null; }
  scene.afficherLointain(g, idScene, { E0, N0 });
}

/**
 * Vrais arbres de l'anneau : points de végétation du relevé laser, chargés selon la caméra (lodAnneau.js : plus fins
 * près de la caméra et dans le champ, plus grossiers au loin, dans un budget de points).
 */
let chargementAnneau = null, lodAnneau = null;
async function arbresAnneau(id, Rint, Rext, E0, N0) {
  chargementAnneau?.abort(); lodAnneau?.detruire(); lodAnneau = null;
  const ctrl = chargementAnneau = new AbortController();
  try {
    const boite = [E0 - Rext, N0 - Rext, E0 + Rext, N0 + Rext];
    const copc = await tuilesNuage(boite);
    if (!copc || id !== tache || ctrl.signal.aborted) return;
    const lod = lodAnneau = new LodAnneau(scene, copc, { E0, N0, Rint, Rext });
    ctrl.signal.addEventListener("abort", () => lod.detruire(), { once: true });
    if (import.meta.env.DEV) window.__lodAnneau = lod;
    await lod.demarrer();
  } catch (e) { if (e?.name !== "AbortError") console.warn("arbres de l'anneau", e); }
}

async function depuisAdresse(o = null) {
  // mode accueil (`o.accueil` = { E, N, R }) : le décor de la page d'entrée, chargé comme un lieu, sans panneau ni parcelle
  const ACC = o?.accueil || null;
  const h = ACC ? new URLSearchParams(`e=${ACC.E}&n=${ACC.N}`) : new URLSearchParams(location.hash.slice(1));
  if (!ACC && h.get("vol")) return vol(h.get("vol"));
  if (!ACC && !h.get("e")) return accueil();
  const et = ACC ? () => {} : etat;
  const E = +h.get("e"), N = +h.get("n"), id = ++tache;
  let finReleve = null; // libère les téléchargements gardés pour après le relevé (anneau, terrain 0,5 m)
  // voyage au clavier : le lieu se recentre sur la caméra sans chercher de parcelle, et la vue est gardée telle quelle
  const voyage = !ACC && h.get("t") === "Voyage", E0avant = S.E0, N0avant = S.N0;
  chargement?.abort();
  annulerCalcul();
  if (!ACC) {
    quitterAccueil();
    $("#panneau").hidden = false; $("#commandes").hidden = $("#panneauPro").hidden = $("#panneauExport").hidden = $("#panneauAffichage").hidden = true; $("#heures").hidden = true; $("#diagramme").hidden = $("#coupe").hidden = true;
  }
  $("#lieu").textContent = h.get("l") || `${E}, ${N}`;
  $("#lieuType").textContent = nomType(h.get("t") || "");
  $("#source").textContent = "";
  message("");
  try {
    et(0.02, t("etat.parcelle"));
    // terrain 2 m : sa liste (STAC) et les tuiles du point demandé sont lues pendant la recherche de la parcelle
    // (le centre se déplace ensuite au plus de quelques centaines de mètres ; la boîte de 2,5 km couvre l'anneau)
    const MARGE_ALTI = 2500, altiTot = ACC ? null : tuilesAlti2m([E - MARGE_ALTI, N - MARGE_ALTI, E + MARGE_ALTI, N + MARGE_ALTI]);
    altiTot?.then(l => prechargerAlti(l, [E - 500, N - 500, E + 500, N + 500])).catch(() => {});
    const parcelle = ACC || voyage ? null : await parcelleEn(E, N);
    if (id !== tache) return;
    // centre et rayon : la parcelle et ~120 m autour (bâtiments voisins, arbres)
    let E0 = E, N0 = N, demi = 20;
    if (parcelle) {
      const xs = parcelle.anneaux.flat().map(p => p[0]), ys = parcelle.anneaux.flat().map(p => p[1]);
      // centre exact demandé (coordonnées tapées, viseur) : la parcelle est trouvée, mais le centre reste au point
      if (h.get("x") !== "1") { E0 = (Math.min(...xs) + Math.max(...xs)) / 2; N0 = (Math.min(...ys) + Math.max(...ys)) / 2; }
      demi = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
      $("#lieuType").textContent = `${t("lieu.parcelle", { n: parcelle.numero })} · ${parcelle.canton}${h.get("t") === "Adresse" ? " · " + h.get("l") : ""}`;
      $("#lieu").textContent = (h.get("l") || "").replace(/\s*\(CH.*\)$/, "");
    } else if (!ACC && !voyage) message(t("msg.pasDeParcelle"), 0);
    E0 = Math.round(E0); N0 = Math.round(N0);
    if (!ACC) afficherCoordonnees(E0, N0);
    // maquette ronde : rayon choisi (curseur), sinon automatique ; relevé laser jusqu'à 300 m, au-delà un anneau
    // carrée : pas d'anneau, le rayon s'arrête au relevé fin
    const Rz = ACC ? ACC.R : Math.min(ronde() ? 1e9 : RAYON_FIN_MAX, rayonChoisi() || Math.min(300, Math.max(150, Math.ceil(demi + 120)))), R = Math.min(Rz, RAYON_FIN_MAX);
    if (!ACC) afficherRayon(Rz);
    const boite = [E0 - R, N0 - R, E0 + R, N0 + R];
    const rel = parcelle ? { ...parcelle, anneauxRel: parcelle.anneaux.map(a => a.map(([e, n]) => [e - E0, n - N0])) } : { anneauxRel: [] };

    // relief lointain : ses tuiles se téléchargent pendant le chargement du relevé ; l'altitude de l'observateur
    // (connue une fois le terrain reconstruit) lui est donnée plus bas
    let donnerAltitude, horizonFini = 0;
    const horizon = profilHorizon(E0, N0, new Promise(r => donnerAltitude = r), { rayonProche: R, onProgres: f => horizonFini = f });
    horizon.catch(() => {}); // l'erreur éventuelle est traitée à l'attente, plus bas

    // fonds de plan (cadastre, photo aérienne) demandés dès maintenant : ils arrivent pendant le relevé
    prechargerFonds([urlFond(COUCHES.cadastre, boite), urlFond(COUCHES.ortho, boite)]);
    // piscines et bassins de la mensuration officielle : demandés tout de suite, creusés une fois la grille faite
    const bassins = ACC ? Promise.resolve([]) : bassinsAutour(boite);

    // terrain swissALTI3D 2 m, demandé tout de suite : d'abord les tuiles du lieu (vue de base), puis celles de l'anneau
    // jusqu'à 2 km ; chaque tuile est lue en une seule requête (grille.js, lireAlti)
    const RAYON_FIN = Math.max(2000, Rz + 600);
    const alti = altiTot && Math.max(Math.abs(E0 - E), Math.abs(N0 - N)) + RAYON_FIN <= MARGE_ALTI ? altiTot
      : tuilesAlti2m([E0 - RAYON_FIN, N0 - RAYON_FIN, E0 + RAYON_FIN, N0 + RAYON_FIN]);
    const terrainBase = alti.then(l => terrainAutour(l, E0, N0, R + 10));
    // le reste (anneau, 25 Mo environ ; terrain 0,5 m) attend le relevé : sinon il lui prend la bande passante
    const apresReleve = new Promise(r => { finReleve = r; }); // tenue à la fin du chargement (finally, plus bas)
    const terrainLarge = Promise.all([terrainBase.catch(() => null), apresReleve]).then(() => alti).then(l => terrainAutour(l, E0, N0, RAYON_FIN));
    terrainBase.catch(() => {}); terrainLarge.catch(() => {});
    // terrain swisstopo 0,5 m de la maquette (choix « Terrain swisstopo ») : lu après la vue de base, sans rien bloquer
    let sol05 = null;
    const n05 = Math.round(2 * R / 0.5);
    const attente05 = ACC ? Promise.resolve(null) : apresReleve.then(() => tuilesAlti05(boite))
      .then(l => solAlti05(l, { n: n05, c: 0.5, x0: -R, R }, E0, N0)).catch(e => { console.warn("swissALTI3D 0,5 m :", e.message); return null; });
    attente05.then(s => { sol05 = s; });

    et(0.05, t("etat.releve"));
    // vue de base (terrain swisstopo, bâtiments Swiss3D) affichée en attendant le relevé ; null tant qu'elle ne l'est pas
    let base = null;
    const progres = (f, texte) => {
      if (id !== tache) return;
      if (base) telechargement("affinage", t("etat.affinage"), f); else et(0.05 + 0.7 * f, texte);
    };
    // relevé laser (nuage COPC) : téléchargé en arrière-plan, niveaux grossiers d'abord (nuage.js)
    const releve = (async () => {
      const copc = await tuilesNuage(boite);
      if (id !== tache) return null;
      if (copc) {
        // densité : 0 légère, 1 équilibrée, 2 complète ; la parcelle et 40 m autour gardent toujours toute la finesse
        const niv = 1, coeur = parcelle ? [Math.min(...parcelle.anneaux.flat().map(p => p[0])) - 40, Math.min(...parcelle.anneaux.flat().map(p => p[1])) - 40,
          Math.max(...parcelle.anneaux.flat().map(p => p[0])) + 40, Math.max(...parcelle.anneaux.flat().map(p => p[1])) + 40] : [E0 - 60, N0 - 60, E0 + 60, N0 + 60];
        // chargement visible (points qui apparaissent au fil de l'arrivée) : seulement pour le décor de l'accueil ; ailleurs,
        // la vue de base est montrée pendant ce temps
        const apercu = ACC ? { debut: total => id === tache && scene.debutChargement(total, R, { garderVue: true, z0: ACC.z }), bloc: (...a) => id === tache && scene.ajouterBloc(...a) } : null;
        const nuage = await chargerNuage(copc, boite, [E0, N0], 0.5, progres, (chargement = new AbortController()).signal,
          { interieur: coeur, niveau: niv === 2 ? 0 : niv === 1 ? 1 : 2 }, apercu, ACC || ronde() ? { E: E0, N: N0, R: R + 3 } : null);
        if (id !== tache) return null;
        if (!base) et(0.78, t("etat.reconstruction"));
        await pause();
        return { G: depuisPoints(nuage, R), nuage, source: t("source.nuage", { annees: [...new Set(copc.map(u => u.annee))].join(", "), n: entier(nuage.n) }) };
      }
      const g = await tuilesGrille(boite);
      const G = await depuisRasters(g, [E0, N0], R, 0.5, progres);
      return { G, nuage: null, source: t("source.grille", { terrain: [...new Set(g.terrain.map(u => u.annee))].join(", "), surface: [...new Set(g.surface.map(u => u.annee))].join(", ") }) };
    })();
    releve.catch(() => {}); // l'erreur éventuelle est traitée à l'attente, plus bas

    /** Anneau et paysage : lancés une fois, après la première maquette affichée (vue de base ou relevé). */
    let paysageLance = false;
    const lancerPaysage = async () => {
      if (paysageLance) return;
      paysageLance = true;
      donnerAltitude(scene.zRef + 1.7);
      if (horizonFini < 1 && !base) et(0.9 + 0.1 * horizonFini, t("etat.relief"));
      S.horizon = await horizon;
      if (id !== tache) return;
      // anneau intermédiaire : terrain swissALTI3D à 2 m jusqu'à 2 km (déjà en route), puis relief libre jusqu'à 50 km
      const idScene = scene.idScene;
      terrainLarge.catch(e => { console.warn("swissALTI3D 2 m :", e.message); return null; })
        .then(fin => { if (id === tache) { S.fin = fin; return paysageEtAnneau(id, idScene); } })
        .catch(e => console.warn("Relief lointain :", e.message));
    };

    /** Première maquette du lieu (vue de base `provisoire`, ou directement celle du relevé) : scène, caméra, panneaux. */
    const monter = async (G, nuage, source, provisoire) => {
      S.rayonZone = Rz;
      $("#source").textContent = source; $("#infos").title = source;
      [S.lon, S.lat] = versWgs(E0, N0);
      Object.assign(S, { E0, N0, parcelle: rel, G, horizon: null, zone: null, facades: null, resultat: null, coupe: null, coupes: [], heuresDemandees: false, contoursSwiss: null });
      $("#vCoupe").checked = false; $("#outilsCoupe").hidden = true;
      $("#btnHeures").textContent = t("heures.calculer");
      if (!provisoire) et(0.85, t("etat.scene"));
      await pause();
      if (id !== tache) return;
      scene.controls.autoRotate = false;
      scene.typeFond = ACC ? "uni" : typeFond();
      // accueil : brume douce (le réglage de l'utilisateur revient en quittant l'accueil)
      if (ACC) { scene.loin.facteurBrume = 0.6; scene.loin.brume = true; }
      scene.pontsModeles = await pontsAutour(E0, N0, R).catch(() => []); scene.lieuPonts = { E: E0, N: N0 };
      if (id !== tache) return;
      const vueAvant = voyage ? { p: scene.camera.position.clone(), c: scene.controls.target.clone(), z: scene.zRef } : null;
      // vue gardée pendant le chargement visible (la caméra s'est placée sur les points du nouveau lieu)
      const vuePoints = scene.chargementPts ? { p: scene.camera.position.clone(), c: scene.controls.target.clone(), z0: scene.chargementPts.z0 } : null;
      scene.construire(G, nuage, rel, { cadastre: urlFond(COUCHES.cadastre, boite), ortho: urlFond(COUCHES.ortho, boite), bruit: urlFond(COUCHES.bruit, boite) });
      if (import.meta.env.DEV) performance.mark(provisoire ? "ombres:base" : "ombres:fine"); // mesures (essais)
      // accueil : les points étaient posés à l'altitude du centre (ACCUEIL.z) ; la maquette prend la sienne (à quelques
      // décimètres près) : la caméra, qui suit son trajet, est décalée d'autant pour que le décor ne saute pas
      if (vuePoints && ACC) decalageAccueil = vuePoints.z0 - scene.zRef;
      if (vuePoints && !ACC) {
        // même cadrage que pendant le chargement (les points étaient posés sur le sol bas du premier bloc)
        const dz = scene.zRef - vuePoints.z0;
        vuePoints.p.y -= dz; vuePoints.c.y -= dz;
        scene.camera.position.copy(vuePoints.p); scene.controls.target.copy(vuePoints.c); scene.controls.update();
      }
      scene.finChargement(true);
      if (vueAvant && E0avant != null) {
        // même vue qu'avant le rechargement : la caméra est décalée du déplacement du centre (et de l'altitude de référence)
        const dx = E0 - E0avant, dn = N0 - N0avant, dz = scene.zRef - vueAvant.z;
        for (const v of [vueAvant.p, vueAvant.c]) { v.x -= dx; v.z += dn; v.y -= dz; }
        scene.camera.position.copy(vueAvant.p); scene.controls.target.copy(vueAvant.c); scene.controls.update();
      }
      S.voyage = false;
      // les bâtiments montent du sol, puis les arbres apparaissent ; en voyage, la vague part du lieu d'où l'on vient
      scene.animerConstruction(undefined, { origine: voyage && E0avant != null ? [E0avant - E0, N0avant - N0] : null });
      // vue enregistrée (lieu du compte) : la caméra reprend sa place
      const cam = (h.get("cam") || "").split(",").map(Number);
      if (cam.length === 6 && cam.every(Number.isFinite)) { scene.camera.position.set(cam[0], cam[1], cam[2]); scene.controls.target.set(cam[3], cam[4], cam[5]); scene.controls.update(); scene.demander?.(3); }
      lieux.majBouton();
      scene.tuilesPlan.placer(E0, N0, G.R); // plan autour : tuiles en mémoire aussitôt, les autres au fil de l'eau
      pro.reinitialiser();
      // sélection : la parcelle, et le bâtiment de l'adresse (ou ceux de la parcelle)
      if (!ACC) scene.surligner(rel, h.get("t") === "Adresse" ? [E - E0, N - N0] : null);
      // parcelles voisines (limites et numéros), chargées sans bloquer
      S.voisines = [];
      if (!ACC) parcellesAutour(boite).then(v => {
        if (id !== tache) return;
        S.toutes = v.map(p => ({ numero: p.numero, anneauxRel: p.anneaux.map(a => a.map(([e, n]) => [e - E0, n - N0])) }));
        S.voisines = S.toutes.filter(p => p.numero !== parcelle?.numero);
        scene.afficherParcelles(S.voisines, $("#vParcelles").checked);
        if (S.coupe) majCoupe(S.coupe.A, S.coupe.B);
      }).catch(e => console.warn("Parcelles voisines :", e.message));
      S.roofer = essaiRoofer(E0, N0);
      choixRoofer();
      scene.comparerSwiss(!!ACC || jeuAffiche() === "swiss", { E: S.E0, N: S.N0 });
      comparerRoofer();
      if (ACC) scene.reglerCalques({ jeu: "swiss", batVoir: true, batOmbre: true, arbOmbre: true });
      else appliquerAffichage();
      $("#vArbres").disabled = !nuage && !G.veg.some(v => !isNaN(v)); $("#vPoints").disabled = $("#distPoints").disabled = !nuage;
      $("#noteTerrain").hidden = !provisoire;
      await lancerPaysage();
      if (id !== tache) return;
      et(1, "");
      if (ACC) { volAccueil(E0, N0); return; }
      $("#commandes").hidden = $("#panneauAffichage").hidden = false; $("#diagramme").hidden = false;
      // Pro et exports : seulement sur la maquette du relevé (volumes, masquage et fichiers en dépendent)
      if (!provisoire) { $("#panneauPro").hidden = $("#panneauExport").hidden = false; pro.apresChargement(); compter("lieu"); }
      majSoleil();
    };

    // vue de base : dès que le terrain du lieu est lu (en général 1 à 3 s), si le relevé n'est pas déjà là
    if (!ACC) {
      const T = await Promise.race([terrainBase.catch(() => null), releve.then(() => null, () => null)]);
      if (id !== tache) return;
      if (T && couvreLieu(T, E0, N0, R)) {
        const G0 = grilleTerrain(T, E0, N0, R);
        if (ronde()) garderCercle(G0, R);
        base = G0;
        await monter(G0, null, t("source.base"), true);
        if (id !== tache) return;
        telechargement("affinage", t("etat.affinage"), null);
      }
    }

    const r = await releve;
    if (!r || id !== tache) return;
    const { G, nuage, source } = r;
    // lacs : fond mesuré (swissBATHY3D) sous l'eau, là où il est préparé ; sinon la pente estimée reste
    try { await fondLacs(G, E0, N0); } catch (e) { console.warn("Fond des lacs :", e.message); }
    // sous l'eau, le sol reste sous la surface : des mâts de bateaux (ports) levaient sinon des aiguilles de terrain
    if (G.eau) for (let p = 0; p < G.sol.length; p++) if (!isNaN(G.eau[p]) && !(G.sol[p] < G.eau[p] - 0.1)) G.sol[p] = G.eau[p] - 0.3;
    // terrains au choix (onglet Affichage, Sol) : celui du relevé, et celui de swisstopo (0,5 m s'il est arrivé, sinon 2 m)
    G.solReleve = G.sol.slice();
    const T2 = await terrainBase.catch(() => null);
    if (id !== tache) return;
    const sw = sol05 || (T2 && couvreLieu(T2, E0, N0, R) ? solDepuisTerrain(T2, G, E0, N0) : null);
    if (sw) G.solSwisstopo = solComposeSwisstopo(G, sw);
    if (choixTerrain() === "swisstopo" && G.solSwisstopo) G.sol = G.solSwisstopo.slice();
    // piscines : abords aplanis, fond à −1,60 m, eau à −0,20 m (au plus 4 s d'attente du service cantonal)
    try {
      const B = await Promise.race([bassins, new Promise(r => setTimeout(() => r([]), 4000))]);
      S.bassinsLieu = B;
      if (B.length) creuserBassins(G, B, E0, N0);
    } catch (e) { console.warn("Piscines :", e.message); }
    majSurface(G);
    if (id !== tache) return;
    if (ACC || ronde()) garderCercle(G, R); // ne montrer que le cercle (sinon : maquette carrée, comme avant)
    // terrain swisstopo 0,5 m arrivé après coup : il remplace le 2 m (et la maquette, si ce terrain est choisi)
    if (!sol05) attente05.then(s => {
      if (!s || id !== tache || S.G !== G) return;
      G.solSwisstopo = solComposeSwisstopo(G, s);
      if (choixTerrain() === "swisstopo") appliquerTerrain();
    });
    if (!base) { await monter(G, nuage, source, false); return; }

    // bascule : la maquette du relevé remplace la vue de base, sans recharger ni bouger la caméra
    et(0.99, t("etat.reconstruction"));
    await pause();
    if (id !== tache) return;
    $("#source").textContent = source; $("#infos").title = source;
    remplacerMaquette(G, nuage, S.parcelle === rel && h.get("t") === "Adresse" ? [E - E0, N - N0] : null);
    if (import.meta.env.DEV) performance.mark("ombres:fine"); // mesures (essais)
    scene.animerConstruction(1600);
    $("#vArbres").disabled = !nuage && !G.veg.some(v => !isNaN(v)); $("#vPoints").disabled = $("#distPoints").disabled = !nuage;
    $("#noteTerrain").hidden = true;
    comparerRoofer();
    telechargement("affinage", null);
    et(1, "");
    if (ACC) return;
    $("#panneauPro").hidden = $("#panneauExport").hidden = false;
    pro.apresChargement(); // projet rouvert depuis la liste : démolitions, volumes, coupes
    compter("lieu");
  } catch (e) {
    if (id === tache) scene.finChargement();
    if (id !== tache) return; // lieu changé entre-temps : le chargement abandonné n'affiche rien
    console.error(e);
    telechargement("lieu", null); telechargement("affinage", null);
    message(t("msg.erreur", { m: e.message }));
  } finally { if (id === tache) finReleve?.(); } // lieu abandonné : rien de plus n'est téléchargé
}
const pause = () => new Promise(r => setTimeout(r, 30));

// voyage au clavier dans toute la Suisse : arrivé près du bord, le lieu se recharge centré sous la caméra
scene.surVoyage = cible => {
  if (S.voyage || !S.G || document.body.classList.contains("accueil") || S.E0 == null) return;
  const E = Math.round(S.E0 + cible.x), N = Math.round(S.N0 - cible.z);
  if (E < 2480000 || E > 2840000 || N < 1070000 || N > 1300000) return; // hors de Suisse
  S.voyage = true;
  history.replaceState(null, "", `#e=${E}&n=${N}&l=${encodeURIComponent(`${E}, ${N}`)}&t=Voyage`);
  depuisAdresse().finally(() => { S.voyage = false; });
};

/**
 * Accueil sur Gruyères : la caméra avance lentement depuis le bas du bourg vers le château, puis revient, en boucle.
 * Un geste sur la vue l'arrête (on reprend la main).
 */
const ACCUEIL = { E: 2572640, N: 1159220, z: 809.1, R: 300, chateau: [2572790, 1159320] }; // z : sol au centre (geo.admin)
let debutAccueil = null; // début du mouvement de la caméra
let decalageAccueil = 0; // écart d'altitude entre les points du chargement et la maquette (m), appliqué à la caméra
function volAccueil(E0, N0) {
  // départ bas, au-dessus des prés à l'ouest du bourg, assez loin du château ; la caméra passe à droite du bourg
  // (par le sud), le regard tourné vers le château, puis revient
  const C = [ACCUEIL.chateau[0] - E0 - 60, 5, -(ACCUEIL.chateau[1] - N0) + 40], A = [-390, 55, 270], B = [-40, 40, 250];
  const t0 = debutAccueil ??= performance.now(), duree = 70000;
  scene.controls.autoRotate = false;
  // lumière de fin d'après-midi, de l'ouest-sud-ouest : les façades vues de la caméra sont au soleil
  const az = 250 * Math.PI / 180, h = 30 * Math.PI / 180;
  scene.placerSoleil([Math.sin(az) * Math.cos(h), Math.sin(h), -Math.cos(az) * Math.cos(h)], true);
  scene.animation = t => {
    if (!document.body.classList.contains("accueil")) return;
    const u = ((t - t0) / duree) % 2, f = u < 1 ? u : 2 - u, e = f * f * (3 - 2 * f);
    scene.camera.position.set(...A.map((v, k) => v + (B[k] - v) * e));
    scene.controls.target.set(...C);
    scene.camera.position.y += decalageAccueil; scene.controls.target.y += decalageAccueil;
    scene.controls.update();
  };
  const arret = () => { if (scene.animation) scene.animation = null; scene.controls.removeEventListener("start", arret); };
  scene.controls.addEventListener("start", arret);
}

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
// calendrier du jour : le nôtre (se ferme au choix d'une date, au clic à côté, avec Échap)
brancherCalendrier($("#btnJour"), $("#jour"));
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
  if (lecture) { clearInterval(lecture); lecture = null; $("#btnLecture").innerHTML = ICONE.lecture; return; }
  $("#btnLecture").innerHTML = ICONE.pause;
  lecture = setInterval(() => { S.minutes = (S.minutes + 5) % 1440; majSoleil(); }, 60);
};

/* ------------------------------------------------------------------ affichage */
function appliquerAffichage() {
  const c = scene.couches || {};
  const jeu = jeuAffiche();
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
// « Advanced » ailleurs que dans les essais roofer : toits reconstruits dans le navigateur (src/reconstruction/), à
// partir du nuage déjà chargé et des emprises officielles ; calcul dans un fil, gardé pour le lieu (pas refait)
let advanced = null; // { lieu, maillage } ou { lieu, promesse }
async function reconstruireAdvanced() {
  const lieu = `${S.E0},${S.N0},${S.G?.R}`;
  if (advanced?.lieu === lieu) return advanced.maillage || advanced.promesse;
  const nuage = scene.nuage, R = S.G?.rayonZone || S.G?.R || 150;
  if (!nuage?.n) throw new Error(t("msg.advancedSansNuage"));
  const promesse = (async () => {
    telechargement("roofer", t("etat.advancedEmprises"), null);
    const E = await emprisesOfficielles([S.E0 - R, S.N0 - R, S.E0 + R, S.N0 + R]);
    if (!E?.emprises.length) throw new Error(t("msg.advancedSansEmprises"));
    telechargement("roofer", t("etat.advancedCalcul", { n: E.emprises.length }), null);
    const w = new Worker(new URL("./reconstruction/fil.js", import.meta.url), { type: "module" });
    const r = await new Promise((ok, ko) => {
      w.onmessage = e => e.data.ok ? ok(e.data) : ko(new Error(e.data.erreur));
      w.onerror = e => ko(new Error(e.message));
      w.postMessage({ points: { X: nuage.X, Y: nuage.Y, Z: nuage.Z, C: nuage.C, n: nuage.n }, origine: [S.E0, S.N0], emprises: E.emprises,
        source: E.source, boite: [S.E0 - R, S.N0 - R, S.E0 + R, S.N0 + R] });
    }).finally(() => w.terminate());
    const m = maillagePolygones(r.d, [S.E0, S.N0], scene.zRef, matRoofer);
    m.userData.resume = t("msg.advancedFait", { n: r.lod2 + r.lod1, lod2: r.lod2, s: nombre(r.ms / 1000, 1) });
    if (advanced?.lieu === lieu) advanced = { lieu, maillage: m };
    return m;
  })();
  advanced = { lieu, promesse };
  promesse.catch(() => { if (advanced?.lieu === lieu) advanced = null; });
  return promesse;
}
async function comparerRoofer() {
  if (choixBatiments() !== "roofer") { scene.afficherRoofer(null); return; }
  if (S.G?.provisoire) return; // vue de base : Advanced attend le relevé (appelé de nouveau à la bascule)
  if (!S.roofer) {
    const lieu = S.E0;
    try {
      const m = await reconstruireAdvanced();
      if (lieu === S.E0 && choixBatiments() === "roofer") { scene.afficherRoofer(m); if (m.userData.resume) message(m.userData.resume); }
    } catch (e) {
      console.error(e); message(e.message);
      if (choixBatiments() === "roofer") { $("#bReleve").checked = true; $("#bReleve").dispatchEvent(new Event("change")); }
    } finally { telechargement("roofer", null); }
    return;
  }
  const lieu = S.E0;
  telechargement("roofer", t("etat.roofer"), 0);
  try {
    const m = await maillageRoofer(S.roofer, [S.E0, S.N0], scene.zRef, matRoofer,
      (f, mo) => telechargement("roofer", t("etat.rooferMo", { mo }), f));
    if (lieu === S.E0 && choixBatiments() === "roofer") scene.afficherRoofer(m);
  } finally { telechargement("roofer", null); }
}
/** Maillage « Advanced » du lieu sans l'afficher (impression 3D) : essai roofer hors ligne, sinon reconstruction ici. */
async function maillageAdvanced() {
  if (scene.couches.roofer) return scene.couches.roofer;
  try { return await (S.roofer ? maillageRoofer(S.roofer, [S.E0, S.N0], scene.zRef, matRoofer) : reconstruireAdvanced()); }
  finally { telechargement("roofer", null); }
}
scene.surTuilesSwiss = n => telechargement("swiss", n > 0 && !scene.vol && !document.body.classList.contains("accueil") ? t("etat.swiss", { n }) : null); // le vol et l'accueil chargent sans bandeau
// bâtiments affichés : un seul jeu à la fois (relevé, swisstopo, roofer là où il a été calculé, ou aucun)
function choixBatiments() { return $("input[name=batiments]:checked")?.value || "releve"; }
/** Jeu de bâtiments montré : pendant la vue de base (pas encore de relevé), les Swiss3D, quel que soit le choix. */
function jeuAffiche() { const c = choixBatiments(); return S.G?.provisoire && c !== "aucun" ? "swiss" : c; }
const NOTES = {
  releve: "", aucun: "",
  swiss: t("aff.noteSwiss"),
  roofer: t("aff.noteRoofer"),
};
function choixRoofer() {
  // Advanced : l'essai roofer hors ligne là où il existe, sinon la reconstruction dans le navigateur (partout)
  $("#etiquetteRoofer").title = S.roofer ? t("aff.rooferEssai", { nom: S.roofer.nom }) : t("aff.advancedCase");
}
$$("input[name=batiments]").forEach(b => b.addEventListener("change", () => {
  const choix = choixBatiments();
  $("#noteBatiments").textContent = NOTES[choix];
  scene.comparerSwiss(jeuAffiche() === "swiss", S.E0 != null ? { E: S.E0, N: S.N0 } : null);
  comparerRoofer();
  appliquerAffichage();
  refaireCoupe();
}));
// case « Swiss3D » de la ligne Bâtiments : coche le bouton radio (caché) du jeu voulu, la suite passe par son événement.
// « aucun » et « roofer » (anciens choix restaurés par le navigateur) retombent sur le relevé.
function synchroSwiss() {
  if (!["releve", "swiss", "roofer"].includes(choixBatiments())) $("#bReleve").checked = true;
  $("#vSwiss").checked = choixBatiments() === "swiss";
  $("#vAdvanced").checked = choixBatiments() === "roofer";
}
// Swiss3D et Advanced s'excluent : cocher l'un décoche l'autre ; tout décoché = bâtiments du relevé
for (const [id, radio] of [["#vSwiss", "#bSwiss"], ["#vAdvanced", "#bRoofer"]]) $(id).addEventListener("change", e => {
  const r = $(e.target.checked ? radio : "#bReleve");
  r.checked = true;
  synchroSwiss();
  r.dispatchEvent(new Event("change"));
});
synchroSwiss();
window.addEventListener("pageshow", synchroSwiss);
/* ------------------------------------------------------------------ terrain de la maquette */
// « swisstopo » (swissALTI3D, celui de la vue de base), « releve » (grille 0,5 m tirée du nuage, par défaut),
// « adaptatif » (maillage irrégulier du relevé : pas encore disponible, bouton désactivé). Retenu par ce navigateur.
function choixTerrain() {
  let v = null;
  try { v = localStorage.getItem("ombres.terrain"); } catch { /* stockage indisponible */ }
  return v === "swisstopo" ? "swisstopo" : "releve";
}
$(choixTerrain() === "swisstopo" ? "#tSwiss" : "#tReleve").checked = true;
$$("input[name=terrain]").forEach(b => b.addEventListener("change", e => {
  if (!e.target.checked) return;
  try { localStorage.setItem("ombres.terrain", e.target.value); } catch { /* stockage indisponible */ }
  appliquerTerrain();
}));

/** Le terrain 2 m couvre-t-il le lieu (moins de 10 % de trous) ? Hors de Suisse : non, la vue de base est sautée. */
function couvreLieu(T, E0, N0, R) {
  let vides = 0, tous = 0;
  for (let y = -R; y <= R; y += R / 10) for (let x = -R; x <= R; x += R / 10) { tous++; if (isNaN(altitudeTerrain(T, E0 + x, N0 + y))) vides++; }
  return vides < tous * 0.1;
}

/** Sol « swisstopo » de la maquette : le terrain swisstopo, sauf sous l'eau et sous les ponts, où le relevé reste. */
function solComposeSwisstopo(G, sw) {
  const s = Float32Array.from(sw);
  for (let p = 0; p < s.length; p++) if ((G.eau && !isNaN(G.eau[p])) || (G.pont && !isNaN(G.pont[p])) || isNaN(s[p])) s[p] = G.solReleve[p];
  return s;
}

/**
 * Nouvelle grille pour la maquette (bascule de la vue de base vers le relevé, ou autre terrain) : seules les couches de
 * la maquette sont refaites ; caméra, anneau, paysage et tuiles restent. Sélection, coupes et heures suivent.
 */
function remplacerMaquette(G, nuage, point = null) {
  Object.assign(S, { G, zone: null, facades: null, resultat: null, contoursSwiss: null });
  scene.construire(G, nuage, S.parcelle, null, { remplacer: true });
  scene.surligner(S.parcelle, point);
  if (S.voisines?.length) scene.afficherParcelles(S.voisines, $("#vParcelles").checked);
  scene.comparerSwiss(jeuAffiche() === "swiss", { E: S.E0, N: S.N0 });
  appliquerAffichage();
  // coupes : toutes refaites sur la nouvelle grille, l'active en dernier
  const active = S.coupe;
  for (const c of S.coupes || []) if (c !== active && c.A) { S.coupe = c; majCoupe(c.A, c.B); }
  S.coupe = active;
  if (active) majCoupe(active.A, active.B);
  if (S.heuresDemandees) calculerHeures();
}

/** Applique le terrain choisi à la maquette du relevé, sans recharger le lieu. */
function appliquerTerrain() {
  const G = S.G;
  if (!G || G.provisoire || !G.solReleve) return;
  const src = choixTerrain() === "swisstopo" && G.solSwisstopo ? G.solSwisstopo : G.solReleve;
  if (scene.batOrigine) G.bat.set(scene.batOrigine); // bâtiments masqués (Pro) : réappliqués après (pro.apresTerrain)
  G.sol = src.slice(); G.bassins = [];
  if (S.bassinsLieu?.length) creuserBassins(G, S.bassinsLieu, S.E0, S.N0);
  majSurface(G);
  remplacerMaquette(G, scene.nuage);
  pro.apresTerrain();
}

// sol : photo aérienne (prioritaire), plan cadastral, ou uni
function typeFond() { return $("#vReel").checked ? "ortho" : $("#vCadastre").checked ? "cadastre" : "uni"; } // couche bruit retirée du site (27.11)
$("#vCadastre").addEventListener("change", () => scene.fond(typeFond()));
scene.surFondAbsent = () => message(t("msg.cadastreAbsent"));
// curseurs d'Affichage, retenus par ce navigateur : qualité du rendu, brume, densité des points
const memo = (cle, defaut) => { try { const v = localStorage.getItem(cle); return v === null ? defaut : +v; } catch { return defaut; } };
const garder = (cle, v) => { try { localStorage.setItem(cle, String(v)); } catch { /* stockage indisponible */ } };
const NOMS_QUALITE = () => [t("aff.qualite0"), t("aff.qualite1"), t("aff.qualite2"), t("aff.qualite3")];
function curseurs() {
  $("#qualiteVal").textContent = NOMS_QUALITE()[+$("#qualite").value];
  $("#brumeVal").textContent = `${$("#brume").value} %`;
}
$("#qualite").value = memo("ombres.qualite", 2); $("#brume").value = memo("ombres.brume", 0);
scene.reglerQualite(+$("#qualite").value);
scene.loin.facteurBrume = $("#brume").value / 100; scene.loin.brume = +$("#brume").value > 0;
curseurs();
$("#qualite").addEventListener("input", e => { scene.reglerQualite(+e.target.value); garder("ombres.qualite", e.target.value); curseurs(); });
$("#brume").addEventListener("input", e => { scene.loin.facteurBrume = e.target.value / 100; scene.reglerLointain({ brume: +e.target.value > 0 }); garder("ombres.brume", e.target.value); curseurs(); });
$("#vCouleursReelles").addEventListener("change", e => {
  scene.couleursPoints(e.target.checked);
  if (e.target.checked && !$("#vPoints").checked && !$("#vPoints").disabled) { $("#vPoints").checked = true; appliquerAffichage(); }
});
$("#vReel").addEventListener("change", () => scene.fond(typeFond()));
$("#vLointain").addEventListener("change", e => scene.reglerLointain({ voir: e.target.checked }));
$("#vDegrade").addEventListener("change", e => scene.degradeHauteur(e.target.checked));
scene.surQualite = q => {
  if (q < 2) return;
  $("#qualite").value = 0; curseurs();
  if (S.G && S.lat != null) message(t("msg.effetsCoupes"));
};
// lieux enregistrés au compte : le lien garde la vue de la caméra (cam=position,cible)
const vueCamera = () => { const p = scene.camera.position, c = scene.controls.target; return [p.x, p.y, p.z, c.x, c.y, c.z].map(v => v.toFixed(1)).join(","); };
const lieux = brancherLieux({ compte, bouton: $("#btnLieu"), t,
  nomActuel: () => $("#lieu").textContent.trim() || location.hash,
  lienActuel: () => { const h = new URLSearchParams(location.hash.slice(1)); h.set("cam", vueCamera()); return "#" + h.toString(); } });
$("#btnPartager").onclick = async () => { await navigator.clipboard.writeText(location.href); $("#btnPartager").textContent = t("panneau.copie"); setTimeout(() => $("#btnPartager").textContent = t("panneau.lien"), 1500); };

/* ------------------------------------------------------------------ coupe */
// coupe qui suit une poignée : profil allégé à chaque image (trait principal, pas adapté à la longueur), puis le
// profil complet (vue au-delà, points, pas de 25 cm) quand la poignée s'arrête ; « calcul… » pendant ce temps
let coupeLegere = null, coupeComplete = 0;
function suivreCoupe(A, B) {
  const premier = !coupeLegere;
  coupeLegere = [A, B];
  if (premier) requestAnimationFrame(() => { const [a, b] = coupeLegere; coupeLegere = null; majCoupe(a, b, { rapide: true }); });
  clearTimeout(coupeComplete);
  coupeComplete = setTimeout(() => {
    $("#coupeTexte").textContent = `· ${t("coupe.calcul")}`;
    setTimeout(() => S.coupe && majCoupe(S.coupe.A, S.coupe.B), 30); // laisse s'afficher « calcul… »
  }, 220);
}
function majCoupe(A, B, { rapide = false } = {}) {
  // la coupe suit le jeu de bâtiments affiché (relevé, swisstopo, roofer ou aucun) ; en mode pro, points du nuage proches
  const jeu = jeuAffiche(), hv = scene.hauteursVolumes();
  let grille = jeu === "swiss" || jeu === "roofer" ? scene.grilleComparaison(jeu) : null;
  // volumes du projet : ajoutés aux bâtiments coupés (au relevé comme aux autres jeux)
  if (hv) {
    const b = grille || (jeu === "releve" ? S.G.bat : null), g = new Float32Array(hv.length);
    for (let p = 0; p < g.length; p++) g[p] = Math.max(b && !isNaN(b[p]) ? b[p] : -Infinity, isNaN(hv[p]) ? -Infinity : hv[p]);
    for (let p = 0; p < g.length; p++) if (g[p] === -Infinity) g[p] = NaN;
    grille = g;
  }
  const distance = scene.nuage ? +$("#distPoints").value : 0;
  const longueur = Math.hypot(B[0] - A[0], B[1] - A[1]) + 2 * Math.max(S.G.R, scene.rayonExt || 0);
  const P = profilCoupe(S.G, scene.contours, A, B, S.parcelle, rapide ? Math.max(0.25, longueur / 700) : 0.25, S.voisines || [],
    { batiments: grille || (jeu === "releve" ? null : "aucun"), nuage: scene.nuage, distance, rayonExt: scene.rayonExt, solHors: scene.altAnneau, rapide });
  // plusieurs coupes : celle-ci est l'active (en 3D et dessinée) ; une nouvelle reçoit la paire de lettres libre suivante
  if (!S.coupe) { S.coupe = { lettres: lettresLibres() }; S.coupes.push(S.coupe); }
  Object.assign(S.coupe, { A, B, P });
  P.lettres = S.coupe.lettres;
  ongletsCoupe();
  $("#legendePoints").hidden = !S.coupe.P.points;
  scene.definirCoupe(S.coupe.P, autresCoupes());
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
    x.type = "button"; x.className = "retirer"; x.innerHTML = ICONE.fermer; x.title = x.ariaLabel = t("coupe.retirer");
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
    // plusieurs coupes : réservé au Pro (bouton grisé pour un compte gratuit ; un clic ouvre l'offre)
    const libre = !compte.disponible() || compte.etat().pro;
    plus.classList.toggle("pro-grise", !libre);
    if (!libre) plus.title = t("coupe.ajouterPro");
    plus.onclick = () => {
      if (!(!compte.disponible() || compte.etat().pro) && !compte.exigerPro(t("coupe.ajouterPro"))) return;
      S.coupe = null; majCoupe(...coupeParDefaut(S.coupes.length % 2 === 1));
    };
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
  const r = dessinerCoupe($("#svgCoupe"), S.coupe.P, null, { audela: "plans" }); // sans soleil : plus de place pour le profil
  $("#coupeTexte").textContent = r ? `· ${nombre(r.long, 0)} m${r.note ? " · " + r.note : ""}` : "";
}
// inverser la coupe : A et A' échangés, on regarde de l'autre côté (jamais automatique)
$("#btnInverserCoupe").addEventListener("click", () => { if (S.coupe) majCoupe(S.coupe.B, S.coupe.A); });
// autres coupes ouvertes : montrées en 3D, plus pâles (scene.definirCoupe)
function autresCoupes() { return (S.coupes || []).filter(c => c !== S.coupe && c.P).map(c => c.P); }
// clic sur une autre coupe en 3D : elle devient la coupe choisie (même ordre que autresCoupes)
scene.surChoixCoupe = k => {
  const c = (S.coupes || []).filter(d => d !== S.coupe && d.P)[k];
  if (c) { S.coupe = c; majCoupe(c.A, c.B); }
};
// par défaut, la maquette n'est pas coupée : seule la ligne de coupe est dessinée
scene.couperModele = $("#vCouperModele").checked;
$("#vCouperModele").addEventListener("change", e => { scene.couperModele = e.target.checked; if (S.coupe) scene.definirCoupe(S.coupe.P, autresCoupes()); });
// la carte de la coupe prend toute la largeur en bas : le panneau s'arrête au-dessus, le profil suit la largeur
new ResizeObserver(() => {
  const h = $("#coupe").hidden ? 0 : $("#coupe").offsetHeight;
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
// « Nouvelle coupe » : la première coupe s'ouvre ; ensuite, une coupe de plus (réservé au Pro, comme « Ajouter une coupe »)
$("#btnNouvelleCoupe").onclick = () => {
  if (!$("#vCoupe").checked) { $("#vCoupe").checked = true; $("#vCoupe").dispatchEvent(new Event("change")); return; }
  if (!(!compte.disponible() || compte.etat().pro) && !compte.exigerPro(t("coupe.ajouterPro"))) return;
  S.coupe = null; majCoupe(...coupeParDefaut(S.coupes.length % 2 === 1));
};
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
scene.surCoupe = (A, B) => suivreCoupe(A, B);
const refaireCoupe = () => { if (S.coupe) majCoupe(S.coupe.A, S.coupe.B); };
// bâtiments de comparaison arrivés ou changés (tuiles swisstopo, roofer) : la coupe, et la carte des heures si elle est
// affichée, sont recalculées avec les bâtiments montrés
scene.surBatiments = () => { refaireCoupe(); relancerHeures(); };
$("#distPoints").addEventListener("change", refaireCoupe);
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
  // vue de base : les heures se calculent sur la grille du relevé, dès la bascule (remplacerMaquette)
  if (G?.provisoire) { S.heuresDemandees = true; message(t("msg.heuresAffinage")); return; }
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
  scene.afficherHeures(maillagesHeures(S.G, S.facades.contours, zone, S.facades, { heures, heuresF }, max, T.heures, scene.zRef), textureHeures(S.G, zone, heures, max, T.heures));
  // statistiques sur les cellules de la parcelle (à défaut : le cœur de la zone)
  const sans = !S.parcelle.anneauxRel.length;
  let s = 0, k = 0, mn = Infinity, mx = 0;
  for (let p = 0; p < heures.length; p++) {
    if (sans ? zone.alpha[p] < 1 : !zone.parcelle[p]) continue;
    s += heures[p]; k++; mn = Math.min(mn, heures[p]); mx = Math.max(mx, heures[p]);
  }
  $("#heures").hidden = false;
  $("#heuresMax").textContent = duree(max) + parJour;
  // moyenne, minimum et maximum en trois mesures côte à côte, puis le résumé du calcul
  $("#heuresStats").innerHTML = (k ? `<div class="mesures-lieu">${t("heures.statsLieu", { lieu: t(sans ? "heures.autourPoint" : "heures.parcelle"), titre: P.titre })}</div>`
      + `<dl class="mesures"><div><dt>${t("heures.moyenne")}</dt><dd class="principale">${duree(s / k) + parJour}</dd></div>`
      + `<div><dt>${t("heures.min")}</dt><dd>${duree(mn)}</dd></div><div><dt>${t("heures.max")}</dt><dd>${duree(mx)}</dd></div></dl>` : "")
    + `<span class="text-secondary resume">${t("heures.resume", { titre: P.titre, max: duree(P.max) + parJour, carreaux: entier(S.facades.carreaux.length), s: nombre(ms / 1000, 1) })}</span>`;
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
    if (choixCentre) {
      // viseur : le point cliqué (sol, toit, ou plan autour) devient le centre exact
      const p = scene.pointSol(e) || scene.pointLointain(e);
      basculerChoixCentre(false);
      if (p && S.E0 != null) allerCentre(S.E0 + p[0], S.N0 + p[1]);
      return;
    }
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
    // onglet Projet (compte Pro) : le clic sélectionne un bâtiment, ou ceux de la parcelle (pro.js) ; ailleurs, la parcelle
    if ($("#vPro")?.checked && $("#colonne")?.dataset.onglet === "projet") return;
    const choisie = S.toutes.find(q => dansParcelle(p[0], p[1], q.anneauxRel));
    if (choisie && choisie.numero !== S.parcelle?.numero) choisirParcelle(choisie);
    // fiche (registre des bâtiments, parcelle) : le bâtiment cliqué, sinon la parcelle
    {
      const c = scene.couches, surBati = !!(c.bati?.visible && scene.viser(e).intersectObjects([c.bati], true)[0]);
      const aire = choisie ? choisie.anneauxRel.reduce((t, a) => t + Math.abs(a.reduce((u, q, k) => { const r = a[(k + 1) % a.length]; return u + q[0] * r[1] - r[0] * q[1]; }, 0) / 2), 0) : null;
      fiche.montrer(S.E0 + p[0], S.N0 + p[1], { batiment: surBati, surface: aire, numero: choisie?.numero });
    }
    // loin du centre : on propose aussi d'y recentrer la maquette (comme un clic sur le plan au-delà)
    if (Math.hypot(p[0], p[1]) > 40) proposerAilleurs(S.E0 + p[0], S.N0 + p[1], e.clientX, e.clientY, true);
  });
}
// petite bulle « Parcelle n · Construire la 3D ici » à l'endroit du clic
let demandeAilleurs = 0;
async function proposerAilleurs(E, N, x, y, interieur = false) {
  const b = $("#ailleurs"), id = ++demandeAilleurs;
  // bouton : un petit viseur à côté du nom (le texte reste en info-bulle et pour les lecteurs d'écran)
  const libelle = t(interieur ? "ailleurs.centrer" : "ailleurs.construire");
  $("#btnAilleurs").innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
  $("#btnAilleurs").title = libelle; $("#btnAilleurs").setAttribute("aria-label", libelle);
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
const fiche = brancherFiche(document.body, t);
const pro = brancherPro({ scene, S, message, etat, fiche, recharger: depuisAdresse, maillageAdvanced, calculerHeures, annulerCalcul, majCoupe, soleilActuel, compte, compter,
  relancerHeures, ouvrirCoupes, rayonZone: () => S.rayonZone, reglerRayon, parcelleEn: (x, y) => S.toutes?.find(q => dansParcelle(x, y, q.anneauxRel)), changerJour: j => { $("#jour").value = j; $("#jour").dispatchEvent(new Event("change")); } });
// coupes d'un projet rouvert : toutes recréées, la dernière active
function ouvrirCoupes(liste) {
  if (!$("#vCoupe").checked) { $("#vCoupe").checked = true; $("#outilsCoupe").hidden = $("#coupe").hidden = false; }
  S.coupes = [];
  for (const c of liste) { S.coupe = null; majCoupe(c.A, c.B); }
}

// onglets de la colonne, puces de la vue, zoom et plein écran, feuille du bas sur mobile (interface.js)
brancherInterface({ scene, compte });
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
  // adresse directe d'une page (lien depuis l'extérieur, par exemple la fenêtre de consentement de Google) :
  // topograph.ch/?legal=confidentialite (ou mentions, conditions, contact)
  const demandee = new URLSearchParams(location.search).get("legal");
  if (demandee && dlg.querySelector(`section[data-page="${CSS.escape(demandee)}"]`)) ouvrir(demandee);
  document.addEventListener("click", e => {
    const a = e.target.closest("[data-legal]");
    if (a) { e.preventDefault(); ouvrir(a.dataset.legal); return; }
    if (e.target.closest("[data-fermer]") || e.target === dlg) dlg.close();
  });
}


// ---------------------------------------------------------------- coordonnées GPS du centre (colonne, sous le titre)
// affichées en degrés décimaux (WGS84) ; un clic les rend modifiables (degrés décimaux, degrés-minutes-secondes, MN95
// ou MN03 acceptés) ; le viseur fait choisir le centre d'un clic sur la carte. Le centre reste alors au point exact.
let choixCentre = false;
function afficherCoordonnees(E, N) {
  const [lon, lat] = versWgs(E, N);
  $("#coordLieu").textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  $("#coordLieu").dataset.mn95 = `${E}, ${N}`;
  $(".coord-lieu").hidden = false;
}
function allerCentre(E, N) {
  const [lon, lat] = versWgs(E, N), l = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  location.hash = `e=${Math.round(E)}&n=${Math.round(N)}&l=${encodeURIComponent(l)}&t=${encodeURIComponent(t("type.Coordonnees"))}&x=1`;
}
function basculerChoixCentre(oui = !choixCentre) {
  choixCentre = oui;
  document.body.classList.toggle("choix-centre", oui);
  $("#btnViseurCentre").setAttribute("aria-pressed", String(oui));
  message(oui ? t("lieu.viseurAide") : "", oui ? 0 : 1);
}
$("#btnViseurCentre").addEventListener("click", () => basculerChoixCentre());
addEventListener("keydown", e => { if (e.key === "Escape" && choixCentre) basculerChoixCentre(false); });
$("#coordLieu").addEventListener("click", () => {
  const champ = $("#coordSaisie");
  champ.value = $("#coordLieu").textContent;
  $("#coordLieu").hidden = true; champ.hidden = false; champ.focus(); champ.select();
});
function fermerSaisie() { $("#coordSaisie").hidden = true; $("#coordLieu").hidden = false; }
$("#coordSaisie").addEventListener("keydown", e => {
  if (e.key === "Escape") { fermerSaisie(); return; }
  if (e.key !== "Enter") return;
  const c = lireCoordonnees(e.target.value);
  if (!c) { e.target.classList.add("is-invalid"); message(t("lieu.coordInvalides")); return; }
  e.target.classList.remove("is-invalid");
  fermerSaisie();
  allerCentre(c.E, c.N);
});
$("#coordSaisie").addEventListener("blur", fermerSaisie);
