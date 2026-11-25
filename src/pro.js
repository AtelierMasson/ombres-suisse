// Mode pro : sélection et masquage de bâtiments (retirés aussi des calculs), taille de la maquette, exports.
// Les outils n'apparaissent que lorsque l'interrupteur « Mode pro » est activé.
import { ficheVolumes, volumesParcelle } from "./volumes.js";
import { FORMATS, exporterSite, estimer, sansAccent } from "./export.js";
import { dessinCoupe, coupeDxf, coupeSvg } from "./exportCoupe.js";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const memoire = (cle, valeur) => {
  try { if (valeur === undefined) return localStorage.getItem(cle); localStorage.setItem(cle, valeur); } catch { /* stockage indisponible */ }
  return null;
};
const fr = (v, d = 1) => v.toFixed(d).replace(".", ",");
const mo = o => o < 1e6 ? `${Math.max(1, Math.round(o / 1e3))} Ko` : `${fr(o / 1e6)} Mo`;

function telecharger(blob, nom) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/**
 * Branche le mode pro. `o` = { scene, S, message, etat, recharger, calculerHeures, annulerCalcul, majCoupe, soleilActuel }
 * (état et fonctions de main.js). Retourne { rayon(), reinitialiser() }.
 */
export function brancherPro(o) {
  const { scene, S } = o;
  const P = { selection: new Set(), masques: new Set(), historique: [] };
  const actif = () => $("#vPro").checked;
  const jeu = () => $("input[name=batiments]:checked")?.value || "releve";
  const pret = () => !!S.G && S.lat != null && !!scene.contoursTous;

  /* ---------------------------------------------------------------- sélection et masquage */
  function maj() {
    const releve = jeu() === "releve", V = pret() ? scene.indexer() : null;
    if (!actif() || !releve) P.selection.clear();
    if (pret()) scene.surbrillance(actif() ? P.selection : null);
    $("#btnSelection").disabled = $("#btnSelParcelle").disabled = !releve;
    $("#btnMasquer").disabled = !P.selection.size;
    $("#btnReafficher").disabled = !P.masques.size;
    $("#btnAnnuler").disabled = !P.historique.length;
    const nbMasques = V ? new Set([...P.masques].map(s => V.bati[s])).size : 0;
    $("#etatPro").textContent = P.masques.size ? `${nbMasques} bâtiment${nbMasques > 1 ? "s" : ""} masqué${nbMasques > 1 ? "s" : ""} (${P.masques.size} volume${P.masques.size > 1 ? "s" : ""}), retiré${nbMasques > 1 ? "s" : ""} aussi des ombres et des heures de soleil.` : "";
    const F = V && P.selection.size ? ficheVolumes(S.G, scene.contoursTous, V, P.selection) : null;
    $("#fichePro").innerHTML = F
      ? `<b>${F.batiments > 1 ? `${F.batiments} bâtiments` : F.volumes > 1 ? `Bâtiment (${F.volumes} volumes)` : $("#vParVolume").checked ? "Volume" : "Bâtiment"}</b><br>`
        + `Hauteur au-dessus du sol : <b>${fr(F.haut)} m</b> au plus haut, ${fr(F.moyenne)} m en moyenne<br>`
        + `Emprise : <b>${Math.round(F.emprise).toLocaleString("fr-CH")} m²</b> · environ <b>${F.niveaux} niveau${F.niveaux > 1 ? "x" : ""}</b> <span class="text-secondary">(3 m par niveau)</span><br>`
        + `<span class="text-secondary">Sommet à ${fr(F.sommet)} m d'altitude</span>`
      : `<span class="text-secondary">${!releve ? "La sélection porte sur les bâtiments du relevé : choisir « Relevé » dans Affichage."
        : $("#btnSelection").classList.contains("active") ? "Cliquez un bâtiment. Majuscule + clic : en ajouter ou en retirer." : ""}</span>`;
    majExport();
  }

  scene.surClic = e => {
    if (!actif() || !pret() || jeu() !== "releve" || !$("#btnSelection").classList.contains("active")) return;
    const V = scene.indexer(), s = scene.designer(e);
    const ids = s < 0 ? [] : $("#vParVolume").checked ? [s] : V.parBati[V.bati[s]].filter(v => !P.masques.has(v));
    if (!e.shiftKey) P.selection = new Set(ids);
    else if (ids.length && ids.every(v => P.selection.has(v))) ids.forEach(v => P.selection.delete(v));
    else ids.forEach(v => P.selection.add(v));
    maj();
  };
  $("#btnSelection").onclick = () => { $("#btnSelection").classList.toggle("active"); maj(); };
  $("#btnSelParcelle").onclick = () => {
    if (!pret()) return;
    const ids = volumesParcelle(S.G, scene.indexer(), S.parcelle?.anneauxRel || []);
    P.selection = new Set([...ids].filter(s => !P.masques.has(s)));
    if (!P.selection.size) o.message(ids.size ? "Les bâtiments de la parcelle sont déjà masqués." : "Aucun bâtiment sur cette parcelle.");
    maj();
  };

  /** Applique l'ensemble des volumes masqués à la scène et à tout ce qui en dépend (ombres, heures, coupe). */
  function appliquer() {
    scene.masquer(P.masques);
    S.facades = null; // les carreaux de façade sont à refaire
    if (S.heuresDemandees) {
      scene.afficherHeures(null);
      S.resultat = null;
      if ($("#vHeures").checked) o.calculerHeures();
      else { o.annulerCalcul(); S.heuresDemandees = false; $("#heures").hidden = true; $("#btnHeures").textContent = "Calculer les heures de soleil"; }
    }
    if (S.coupe) o.majCoupe(S.coupe.A, S.coupe.B);
    maj();
  }
  const changer = masques => { P.historique.push(P.masques); P.masques = masques; P.selection.clear(); appliquer(); };
  $("#btnMasquer").onclick = () => { if (P.selection.size) changer(new Set([...P.masques, ...P.selection])); };
  $("#btnReafficher").onclick = () => { if (P.masques.size) changer(new Set()); };
  $("#btnAnnuler").onclick = () => { if (P.historique.length) { P.masques = P.historique.pop(); P.selection.clear(); appliquer(); } };
  $$("input[name=batiments]").forEach(b => b.addEventListener("change", maj));
  $("#vParVolume").addEventListener("change", () => { P.selection.clear(); maj(); });

  /* ---------------------------------------------------------------- taille de la maquette */
  const NOTES_RAYON = { 250: "Environ 3 fois plus de points : chargement plus long.", 400: "Environ 7 fois plus de points (jusqu'à une quinzaine de millions) : chargement d'une demi-minute à quelques minutes, environ 1,5 Go de mémoire, affichage et exports plus lourds. À éviter sur un petit ordinateur." };
  $("#rayonPro").value = [...$("#rayonPro").options].some(x => x.value === memoire("ombres.rayon")) ? memoire("ombres.rayon") : "";
  const noteRayon = () => $("#noteRayon").textContent = NOTES_RAYON[$("#rayonPro").value] || "";
  $("#rayonPro").addEventListener("change", () => {
    memoire("ombres.rayon", $("#rayonPro").value);
    noteRayon();
    if (S.lat != null) o.recharger();
  });
  noteRayon();

  /* ---------------------------------------------------------------- export du site */
  const format = () => $("input[name=formatExport]:checked").value;
  const choix = () => ({
    terrain: $("#xTerrain").checked, maille: +$("#xMaille").value, socle: $("#xSocle").checked, batiments: $("#xBati").checked,
    arbres: $("#xArbres").checked, parcelle: $("#xParcelle").checked && FORMATS[format()].lignes, courbes: $("#xCourbes").checked && FORMATS[format()].lignes,
  });
  const jeuExport = () => jeu() === "aucun" ? "releve" : jeu();
  function majExport() {
    const F = FORMATS[format()];
    $("#xJeu").textContent = { releve: "(relevé, sans les masqués)", swiss: "(swisstopo, tuiles chargées)", roofer: "(roofer)" }[jeuExport()];
    $("#xMn95").disabled = !F.absolu;
    if (!F.absolu) $("#xLocal").checked = true;
    $("#xParcelle").disabled = $("#xCourbes").disabled = !F.lignes;
    $("#exportCoupe").classList.toggle("d-none", !S.coupe);
    if (!pret() || $("#choixExport").hidden) return;
    const e = estimer(scene, choix(), format(), jeuExport());
    $("#noteExport").innerHTML = `Environ ${e.triangles.toLocaleString("fr-CH")} triangles, ${mo(e.octets)} avant compression.`
      + (e.octets > 50e6 ? ` <b>Fichier lourd${+$("#xMaille").value < 2 ? " : préférer une maille de terrain plus large" : ""}.</b>` : "")
      + (!F.absolu ? "<br>Ce format stocke les nombres en simple précision : seule l'origine locale est proposée (elle est écrite dans le fichier et le LISEZ-MOI)." : "")
      + (!F.lignes ? "<br>Le STL ne contient que des surfaces : ni limite de parcelle ni courbes." : "");
  }
  $("#btnExport").onclick = () => { $("#choixExport").hidden = !$("#choixExport").hidden; majExport(); };
  $$("#choixExport input, #choixExport select").forEach(x => x.addEventListener("change", majExport));

  let enCours = false;
  async function exporter(fmt, quoi, absolu) {
    if (enCours || !pret()) return;
    enCours = true;
    $("#resultatExport").textContent = "";
    try {
      const r = await exporterSite({
        scene, parcelle: S.parcelle, E0: S.E0, N0: S.N0, lieu: $("#lieu").textContent || "site", format: fmt, quoi, jeu: jeuExport(), absolu,
        source: $("#source").textContent, progres: o.etat,
      });
      telecharger(r.blob, r.nom);
      $("#resultatExport").innerHTML = `Téléchargé : <b>${r.nom}</b> (${mo(r.octetsZip)}) — ${r.fichier}, ${mo(r.octets)}, ${r.triangles.toLocaleString("fr-CH")} triangles, et LISEZ-MOI.txt. Préparé en ${fr(r.ms / 1000)} s.`;
      if (import.meta.env.DEV) S.dernierExport = r; // pour la relecture pendant le développement
    } catch (e) {
      console.error(e);
      o.message("Export impossible : " + e.message);
    }
    o.etat(1, "");
    enCours = false;
  }
  $("#btnTelecharger").onclick = () => exporter(format(), choix(), $("#xMn95").checked);
  // « maquette complète » : tout le contenu, origine locale ; terrain à 1 m (2 m en DXF, format bien plus lourd)
  $$("[data-tout]").forEach(b => b.onclick = () => exporter(b.dataset.tout, { terrain: true, maille: b.dataset.tout === "dxf" ? 2 : 1, socle: true, batiments: true, arbres: true, parcelle: true, courbes: false }, false));

  /* ---------------------------------------------------------------- export de la coupe */
  $$("[data-coupe]").forEach(b => b.onclick = () => {
    if (!S.coupe) return;
    const C = S.coupe, lieu = $("#lieu").textContent || "site", pt = ([x, y]) => `${Math.round(S.E0 + x)}-${Math.round(S.N0 + y)}`;
    const D = dessinCoupe(C.P, { E0: S.E0, N0: S.N0, lieu, soleil: o.soleilActuel(), jour: new Date(S.jour + "T12:00:00").toLocaleDateString("fr-CH") });
    const infos = [`Ombres - Suisse : coupe A-B, ${lieu}`, `A = E ${fr(S.E0 + C.A[0])} N ${fr(S.N0 + C.A[1])} ; B = E ${fr(S.E0 + C.B[0])} N ${fr(S.N0 + C.B[1])} (MN95, EPSG:2056)`,
      "X = distance depuis A le long de A-B (m), Y = altitude reelle (m)", "Source : swisstopo. Resultats indicatifs."];
    const nom = `coupe_${sansAccent(lieu)}_A${pt(C.A)}_B${pt(C.B)}.${b.dataset.coupe}`;
    const texte = b.dataset.coupe === "dxf" ? coupeDxf(D, infos) : coupeSvg(D, infos);
    telecharger(new Blob([texte], { type: b.dataset.coupe === "dxf" ? "application/dxf" : "image/svg+xml" }), nom);
    $("#resultatExport").innerHTML = `Téléchargé : <b>${nom}</b> (${mo(texte.length)}).`;
    if (import.meta.env.DEV) S.dernierExport = { nom, texte };
  });
  $("#vCoupe").addEventListener("change", majExport);

  /* ---------------------------------------------------------------- interrupteur */
  $("#vPro").checked = memoire("ombres.pro") === "1";
  const basculer = () => { $("#outilsPro").hidden = !actif(); memoire("ombres.pro", actif() ? "1" : "0"); maj(); };
  $("#vPro").addEventListener("change", basculer);
  $("#outilsPro").hidden = !actif();

  return {
    /** Rayon choisi en mode pro (m), ou null : rayon automatique. */
    rayon: () => actif() && +$("#rayonPro").value || null,
    /** Nouveau lieu : plus de sélection ni de masquage. */
    reinitialiser() { P.selection = new Set(); P.masques = new Set(); P.historique = []; $("#resultatExport").textContent = ""; maj(); },
  };
}
