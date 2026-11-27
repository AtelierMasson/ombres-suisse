// Mode pro : sélection et masquage de bâtiments (retirés aussi des calculs), taille de la maquette, exports.
// Les outils n'apparaissent que lorsque l'interrupteur « Mode pro » est activé.
import * as THREE from "three";
import { ficheVolumes, volumesParcelle } from "./volumes.js";
import { FORMATS, exporterSite, estimer, sansAccent, nomFichier } from "./export.js";
import { dessinCoupe, coupeDxf, coupeSvg, coupePdf } from "./exportCoupe.js";
import { ouvrirImpression3D } from "./impression3dFenetre.js";
import { toitsReleve, toitsObjets, toitsSwiss } from "./impression3dToits.js";
import { t, nombre, entier, date } from "./i18n.js";
import { rectangle, dimensions, reglerCorniche, listerProjets, enregistrerProjet, supprimerProjet, normaliserVolume, empriseValide, sensDirect, seRecoupe, orientationDominante, aire, pansPossibles } from "./projet.js";
import { directions, accrocherPoint } from "./accrochage.js";
import { traceSol } from "./traceVolume.js";
import { ficheVolume, mesurer, cotesVolume } from "./ficheVolume.js";
import { importerModele } from "./importer.js";
import { dxfReference } from "./referenceParcelle.js";
import { solEn } from "./grille.js";
import { ICONE } from "./icones.js";
import { brancherEdition } from "./editionVolumes.js";
// données externes (cadastre, noms de fichiers) insérées dans du HTML : échappées (audit du 27.11.2026)
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const memoire = (cle, valeur) => {
  try { if (valeur === undefined) return localStorage.getItem(cle); localStorage.setItem(cle, valeur); } catch { /* stockage indisponible */ }
  return null;
};
const fr = (v, d = 1) => nombre(v, d); // nombre décimal dans la langue choisie (virgule en français)
const mo = o => o < 1e6 ? t("unite.ko", { n: Math.max(1, Math.round(o / 1e3)) }) : t("unite.mo", { n: fr(o / 1e6) });

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
  const P = { selection: new Set(), masques: new Set(), historique: [], volumes: [], imports: [], projet: null };
  const actif = () => $("#vPro").checked;
  const jeu = () => $("input[name=batiments]:checked")?.value || "releve";
  const pret = () => !!S.G && S.lat != null && !!scene.contoursTous;

  /* ---------------------------------------------------------------- sélection et masquage */
  // Le clic choisit tout seul : un bâtiment s'il touche un toit ou une façade, sinon les bâtiments de la parcelle
  // cliquée. Masquer la sélection l'ajoute à la liste « ajoutés et masqués », où un œil la remontre ou la recache.
  const couleurs = ["#fbf7ee", "#eadfca", "#d9c09b", "#c99a78", "#b07a62", "#a9b49c", "#7f9083", "#93a2ad", "#b6a9bb", "#8e8379"];
  P.caches = [];
  /** Volumes masqués : ceux des entrées de la liste dont l'œil est fermé. */
  const recalculer = () => { P.masques = new Set(P.caches.filter(c => !c.visible).flatMap(c => c.ids)); };
  function maj() {
    const releve = jeu() === "releve", V = pret() ? scene.indexer() : null;
    if (!actif() || !releve) P.selection.clear();
    if (pret()) scene.surbrillance(actif() ? P.selection : null);
    $("#btnMasquer").disabled = !P.selection.size;
    $("#btnAnnuler").disabled = !P.historique.length;
    const nbMasques = V ? new Set([...P.masques].map(s => V.bati[s])).size : 0;
    $("#etatPro").textContent = P.masques.size ? t("pro.etat", { n: nbMasques, v: P.masques.size }) : "";
    const F = V && P.selection.size ? ficheVolumes(S.G, scene.contoursTous, V, P.selection) : null;
    $("#fichePro").innerHTML = F
      ? `<b>${esc(P.selNom) || (F.batiments > 1 ? t("pro.ficheN", { n: F.batiments }) : t("pro.ficheBatiment"))}</b><br>`
        + t("pro.ficheHauteur", { haut: fr(F.haut), moyenne: fr(F.moyenne) })
        + t("pro.ficheEmprise", { emprise: entier(F.emprise), n: F.niveaux })
        + `<span class="text-secondary">${t("pro.ficheSommet", { z: fr(F.sommet) })}</span>`
      : `<span class="text-secondary">${!releve ? t("pro.aideReleve") : t("pro.aideClic")}</span>`;
    majExport();
  }

  scene.surClic = e => {
    if (dessin) return clicDessin(e);
    if (edition?.consomme()) return; // clic pris par l'édition d'un volume
    // sélection de bâtiments : seulement dans l'onglet Projet (ailleurs, le clic choisit la parcelle, main.js)
    if (!actif() || !pret() || jeu() !== "releve" || $("#colonne")?.dataset.onglet !== "projet") return;
    const V = scene.indexer(), s = scene.designer(e);
    let ids = [], nom = null;
    if (s >= 0) ids = V.parBati[V.bati[s]].filter(v => !P.masques.has(v));
    else {
      const p = scene.pointSol(e), q = p && o.parcelleEn?.(p[0], p[1]);
      if (q) {
        const tous = volumesParcelle(S.G, V, q.anneauxRel);
        ids = [...tous].filter(v => !P.masques.has(v));
        nom = t("pro.batParcelle", { n: q.numero });
        if (!ids.length) o.message(t(tous.size ? "pro.dejaMasques" : "pro.aucunBatiment"));
      }
    }
    // fiche du lieu (bas à droite) : bâtiment cliqué, ou parcelle ; point exact du clic (toit, façade ou sol)
    const pc = scene.pointSol(e);
    // la parcelle choisie et ses bâtiments s'éclairent, comme la parcelle de l'adresse au chargement
    const qSel = pc && o.parcelleEn?.(pc[0], pc[1]);
    if (qSel && !e.shiftKey) scene.surligner(qSel, s >= 0 ? pc : null);
    if (pc && o.fiche) {
      const q2 = o.parcelleEn?.(pc[0], pc[1]), aire = q2 ? Math.abs(q2.anneauxRel[0].reduce((a, [x, y], i, A) => { const [x2, y2] = A[(i + 1) % A.length]; return a + x * y2 - x2 * y; }, 0) / 2) : null;
      o.fiche.montrer(S.E0 + pc[0], S.N0 + pc[1], { batiment: s >= 0, surface: aire, numero: q2?.numero });
    }
    if (!e.shiftKey) { P.selection = new Set(ids); P.selNom = nom; }
    else {
      if (ids.length && ids.every(v => P.selection.has(v))) ids.forEach(v => P.selection.delete(v));
      else ids.forEach(v => P.selection.add(v));
      P.selNom = null;
    }
    maj();
  };

  /** Applique l'ensemble des volumes masqués à la scène et à tout ce qui en dépend (ombres, heures, coupe). */
  function appliquer() {
    recalculer();
    scene.masquer(P.masques);
    S.facades = null; // les carreaux de façade sont à refaire
    if (S.heuresDemandees) {
      scene.afficherHeures(null);
      S.resultat = null;
      if ($("#vHeures").checked) o.calculerHeures();
      else { o.annulerCalcul(); S.heuresDemandees = false; $("#heures").hidden = true; $("#btnHeures").textContent = t("heures.calculer"); }
    }
    if (S.coupe) o.majCoupe(S.coupe.A, S.coupe.B);
    listeVolumes();
    maj();
  }
  const memoriser = () => P.historique.push(JSON.stringify(P.caches));
  let numeroCache = 0;
  $("#btnMasquer").onclick = () => {
    if (!P.selection.size) return;
    memoriser();
    const V = scene.indexer(), n = new Set([...P.selection].map(s => V.bati[s])).size;
    P.caches.push({ id: ++numeroCache, ids: [...P.selection], visible: false, nom: P.selNom || (n > 1 ? t("pro.ficheN", { n }) : t("pro.ficheBatiment")) });
    P.selection.clear(); P.selNom = null;
    appliquer();
  };
  $("#btnAnnuler").onclick = () => { if (P.historique.length) { P.caches = JSON.parse(P.historique.pop()); P.selection.clear(); appliquer(); } };
  $$("input[name=batiments]").forEach(b => b.addEventListener("change", maj));

  /* ---------------------------------------------------------------- volumes du projet */
  // Deux façons de dessiner sur la maquette, avec aperçu qui suit la souris :
  // - « Dessiner un volume » : rectangle en trois clics (A, B pour un côté, puis la profondeur) ;
  // - « Emprise libre » : un clic par coin ; fermeture par un clic sur le premier point, un double-clic ou Entrée ;
  //   Retour arrière retire le dernier point, Échap annule. Les côtés s'accrochent aux angles droits et à l'orientation
  //   de la parcelle et des bâtiments voisins (accrochage.js), leurs longueurs sont cotées, un tracé qui se recoupe est
  //   refusé.
  let dessin = null, mode = "rect", numero = 0, finAt = 0, dirs = [], visee = null;
  const aide = (cle = null) => $("#aideVolume").textContent = !dessin ? "" : t(cle || (mode === "libre"
    ? (dessin.length < 3 ? ["projet.libreA", "projet.libreB", "projet.libreB"][dessin.length] : "projet.libreC")
    : ["projet.aideA", "projet.aideB", "projet.aideC"][dessin.length]));
  const bouton = () => $(mode === "libre" ? "#btnEmprise" : "#btnVolume");
  function finDessin() {
    dessin = null; visee = null; finAt = performance.now(); // le clic qui termine ne doit pas aussi choisir une parcelle
    $("#btnVolume").classList.remove("active"); $("#btnEmprise")?.classList.remove("active");
    scene.renderer.domElement.style.cursor = "";
    scene.afficherVolumes(P.volumes);
    trace.montrer(null); trace.cotes(null);
    aide();
  }
  function commencer(m) {
    if (dessin) finDessin();
    if (!pret()) return;
    mode = m; dessin = []; dirs = [];
    edition?.deselectionner();
    bouton().classList.add("active");
    scene.renderer.domElement.style.cursor = "crosshair";
    aide(); maj();
  }
  $("#btnVolume").onclick = () => { if (dessin && mode === "rect") return finDessin(); commencer("rect"); };
  $("#btnEmprise").onclick = () => { if (dessin && mode === "libre") return finDessin(); commencer("libre"); };
  // Échap : fin du dessin en cours ; sinon, la sélection est vidée et la fiche fermée
  addEventListener("keydown", e => {
    if (e.target.closest?.("input, textarea, select, dialog")) return;
    if (dessin && (e.key === "Backspace" || e.key === "Delete")) {
      // Retour arrière : le dernier point posé est retiré
      e.preventDefault(); e.stopImmediatePropagation();
      dessin.pop(); if (!dessin.length) dirs = [];
      majDessin(); aide();
      return;
    }
    if (dessin && mode === "libre" && e.key === "Enter") { e.preventDefault(); return fermer(); }
    if (e.key !== "Escape") return;
    if (dessin) return finDessin();
    if (P.selection.size) { P.selection = new Set(); P.selNom = null; maj(); }
    o.fiche?.fermer();
  }, true);
  const pointDessin = e => { const p = scene.pointSol(e); return p && Math.max(Math.abs(p[0]), Math.abs(p[1])) < S.G.R - 1 ? p : null; };
  // un volume neuf est posé sur le terrain (base = sol le plus bas sous l'emprise) ; il garde ensuite cette altitude
  const volumeDe = (coins, base = {}) => ({ id: base.id ?? ++numero, coins, hauteur: base.hauteur ?? 9, toit: base.toit ?? "plat" });
  // tracé drapé sur le terrain pendant le dessin (traceVolume.js)
  let trace = null;
  queueMicrotask(() => { trace = traceSol(scene); });
  function ajouterVolume(v) {
    P.volumes.push(v); volumesChanges(); o.compter?.("volume");
    finDessin();
    edition?.choisir(v.id); // le nouveau volume est sélectionné : poignées et tableau
  }

  /** Orientations de référence autour de (x, y) : parcelle, puis bâtiments voisins (les plus proches d'abord). */
  function orientationsAutour(x, y) {
    const out = [], q = o.parcelleEn?.(x, y) || S.parcelle;
    for (const a of q?.anneauxRel || []) out.push(orientationDominante(a.map((p, k) => [p, a[(k + 1) % a.length]])));
    const C = scene.contours, proches = [];
    if (C) for (const B of C.boucles) {
      const poly = B.sommets.map(s => [C.px[B.coins[s]], C.py[B.coins[s]]]);
      if (poly.length < 3) continue;
      const d = Math.min(...poly.map(([u, w]) => Math.hypot(u - x, w - y)));
      if (d < 40) proches.push({ d, o: B.dominante ?? orientationDominante(poly.map((p, k) => [p, poly[(k + 1) % poly.length]])) });
    }
    proches.sort((a, b) => a.d - b.d);
    out.push(...proches.slice(0, 4).map(p => p.o));
    for (const v of P.volumes) out.push(orientationDominante(v.coins.map((p, k) => [p, v.coins[(k + 1) % v.coins.length]])));
    return out;
  }
  /** Point de l'emprise libre sous la souris, accroché ; `ferme` : la souris est sur le premier point. */
  function pointLibre(e) {
    const brut = pointDessin(e);
    if (!brut) return null;
    const n = dessin.length;
    if (n >= 3 && pixelsJusque(e, dessin[0]) < 12) return { p: dessin[0], ferme: true };
    if (!n) return { p: brut };
    // directions : angle droit sur le premier côté (s'il existe), orientations de la parcelle et des voisins
    const D = directions(n >= 2 ? [Math.atan2(dessin[1][1] - dessin[0][1], dessin[1][0] - dessin[0][0]), ...dirs] : dirs);
    const r = accrocherPoint(brut, [{ p: dessin[n - 1], dirs: D }, n >= 2 ? { p: dessin[0], dirs: D } : null], { pas: e.shiftKey ? 1 : 0.1 });
    return { p: r.p, guides: r.guides };
  }
  function pixelsJusque(e, p) {
    const r = scene.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(p[0], solEn(S.G, p[0], p[1]) - scene.zRef, -p[1]).project(scene.camera);
    return Math.hypot((v.x + 1) / 2 * r.width + r.left - e.clientX, (1 - v.y) / 2 * r.height + r.top - e.clientY);
  }
  const cote = (a, b, plus = "") => ({ a, b, texte: `${fr(Math.hypot(b[0] - a[0], b[1] - a[1]), 2)} m${plus}` });
  /** Tracé au sol, aperçu du volume et cotes de l'emprise libre (avec le point visé). */
  function majDessin() {
    if (!dessin || !trace) return;
    if (mode !== "libre") { trace.montrer(dessin.length ? dessin : null); scene.afficherVolumes(P.volumes); return; }
    const pts = visee && !visee.ferme ? [...dessin, visee.p] : [...dessin], n = pts.length;
    trace.montrer(n ? pts : null, n >= 3);
    const liste = [];
    for (let k = 0; k + 1 < n; k++) liste.push(cote(pts[k], pts[k + 1], visee?.guides?.length && k === n - 2 && !visee.ferme ? " ⊥" : ""));
    if (n >= 3) liste.push(cote(pts[n - 1], pts[0]));
    trace.cotes(liste);
    const ok = n >= 3 && empriseValide(pts);
    scene.afficherVolumes(P.volumes, ok ? volumeDe(sensDirect(pts), { id: 0 }) : null);
  }
  /** Ferme l'emprise libre : volume créé, ou refus si elle se recoupe ou est trop petite. */
  function fermer() {
    if (!dessin || mode !== "libre") return;
    if (dessin.length < 3) return aide("projet.libreTrop");
    if (!empriseValide(dessin)) return aide(seRecoupe(dessin, true) ? "projet.recoupe" : "projet.libreTrop");
    ajouterVolume(normaliserVolume({ ...volumeDe(sensDirect(dessin)), libre: true }, S.G));
  }
  function clicDessin(e) {
    if (mode === "libre") {
      const r = pointLibre(e);
      if (!r) return;
      if (r.ferme) return fermer();
      const n = dessin.length, p = r.p;
      if (n && Math.hypot(p[0] - dessin[n - 1][0], p[1] - dessin[n - 1][1]) < 0.2) return; // même point (double-clic)
      if (n >= 2 && seRecoupe([...dessin, p], false)) return aide("projet.recoupe");
      dessin.push(p);
      if (n === 0) dirs = orientationsAutour(...p); // orientations prises autour du premier point
      visee = null; majDessin(); aide();
      return;
    }
    const p = pointDessin(e);
    if (!p) return;
    dessin.push(p);
    if (dessin.length === 3) {
      const coins = rectangle(...dessin);
      if (coins) return ajouterVolume(normaliserVolume(volumeDe(coins), S.G));
      return finDessin();
    }
    trace.montrer(dessin);
    aide();
  }
  // double-clic : ferme l'emprise libre (et ne fait pas voler la caméra vers le point)
  scene.renderer.domElement.addEventListener("dblclick", e => {
    if (!dessin) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (mode === "libre") fermer();
  }, true);
  scene.renderer.domElement.addEventListener("pointermove", e => {
    if (!dessin) return;
    if (mode === "libre") { const r = pointLibre(e); if (r) { visee = r; majDessin(); } return; }
    const p = pointDessin(e);
    if (!p) return;
    // tracé au sol : le point visé (avant le premier clic), le côté en cours, puis le rectangle
    if (!dessin.length) return trace.montrer([p]);
    // aperçu : après le premier coin, une paroi mince (30 cm) de la hauteur par défaut le long du côté ; après le
    // deuxième, le volume entier ; faces planes translucides, posées sur le terrain comme le volume final
    const L = Math.hypot(p[0] - dessin[0][0], p[1] - dessin[0][1]) || 1, n = [-(p[1] - dessin[0][1]) / L, (p[0] - dessin[0][0]) / L];
    const A = dessin[0], mince = L >= 1 ? [A, p, [p[0] + n[0] * 0.3, p[1] + n[1] * 0.3], [A[0] + n[0] * 0.3, A[1] + n[1] * 0.3]] : null;
    const coins = dessin.length === 1 ? mince : rectangle(dessin[0], dessin[1], p);
    scene.afficherVolumes(P.volumes, coins ? volumeDe(coins, { id: 0 }) : null);
    trace.montrer(dessin.length === 1 ? [dessin[0], p] : coins || [dessin[0], dessin[1], p], dessin.length === 2 && !!coins);
    // cotes du rectangle : côté en cours, puis profondeur
    trace.cotes(dessin.length === 1 ? [cote(dessin[0], p)] : coins ? [cote(coins[0], coins[1]), cote(coins[1], coins[2])] : null);
  });
  /** Volumes changés : maquette, ombres, coupe, heures de soleil (si affichées), liste du panneau. */
  // édition des volumes à la souris (sélection, faces, déplacer, tourner) : editionVolumes.js
  let edition = null;
  queueMicrotask(() => {
    edition = brancherEdition({
      scene, volumes: () => P.volumes, actif, dessine: () => !!dessin, changes: volumesChanges,
      retirer: id => { P.volumes = P.volumes.filter(v => v.id !== id); volumesChanges(); },
      bouge: () => fiche.rafraichir(), // souris : le tableau suit
      choix: id => { const v = P.volumes.find(w => w.id === id); fiche.montrer(v || null, P.volumes.indexOf(v) + 1); listeVolumes(); },
      cotes: v => cotesVolume(v, mesures(v), scene),
    });
  });
  // tableau du volume sélectionné (ficheVolume.js), sous l'aide du dessin
  const mesures = v => mesurer(v, { scene, S, parcelleEn: o.parcelleEn, autres: P.volumes });
  const boiteFiche = Object.assign(document.createElement("div"), { id: "ficheVolume", hidden: true });
  $("#aideVolume").after(boiteFiche);
  const fiche = ficheVolume(boiteFiche, {
    S, mesures,
    // pendant la saisie : maquette et poignées ; à la validation : aussi coupe, heures de soleil et liste
    changer: (v, final) => { if (final) volumesChanges(); else { scene.afficherVolumes(P.volumes); edition?.maj(); } },
  });
  // Annuler / rétablir (Ctrl+Z, Ctrl+Maj+Z ou Ctrl+Y ; boutons ↶ ↷) : chaque changement validé des volumes (dessin,
  // geste de souris relâché, champ du tableau validé, liste) devient une étape ; l'état précédent est gardé en JSON.
  const H = { avant: [], apres: [], etat: "[]" };
  const instantane = () => JSON.stringify(P.volumes);
  function oublierHistorique() { H.avant = []; H.apres = []; H.etat = instantane(); majBoutonsHistorique(); }
  function majBoutonsHistorique() {
    const a = $("#btnAnnulerVolume"), r = $("#btnRetablirVolume");
    if (a) a.disabled = !H.avant.length;
    if (r) r.disabled = !H.apres.length;
  }
  function revenir(depuis, vers) {
    if (!depuis.length) return;
    if (dessin) finDessin();
    vers.push(H.etat);
    H.etat = depuis.pop();
    const sel = edition?.selection;
    P.volumes = JSON.parse(H.etat);
    volumesChanges(true);
    if (sel != null && P.volumes.some(v => v.id === sel)) edition?.choisir(sel);
  }
  const annulerVolumes = () => revenir(H.avant, H.apres), retablirVolumes = () => revenir(H.apres, H.avant);
  $("#btnAnnulerVolume") && ($("#btnAnnulerVolume").onclick = annulerVolumes);
  $("#btnRetablirVolume") && ($("#btnRetablirVolume").onclick = retablirVolumes);
  addEventListener("keydown", e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !actif() || e.target.closest?.("input, textarea, select, dialog, [contenteditable]")) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); annulerVolumes(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); retablirVolumes(); }
  });
  function volumesChanges(depuisHistorique = false) {
    if (depuisHistorique !== true) {
      const x = instantane();
      if (x !== H.etat) { H.avant.push(H.etat); if (H.avant.length > 200) H.avant.shift(); H.apres = []; H.etat = x; }
    }
    majBoutonsHistorique();
    scene.afficherVolumes(P.volumes);
    edition?.maj();
    fiche.rafraichir();
    S.versionProjet = (S.versionProjet || 0) + 1;
    S.volumesProjet = P.volumes;
    if (S.coupe) o.majCoupe(S.coupe.A, S.coupe.B);
    if (S.heuresDemandees) o.relancerHeures?.();
    listeVolumes();
  }
  /** Liste « ajoutés et masqués » : modèles importés, volumes dessinés (œil, couleur, hauteur, toit) et bâtiments masqués (œil). */
  function listeVolumes() {
    const oeil = (visible, titre, changer) => {
      const i = document.createElement("input");
      Object.assign(i, { type: "checkbox", className: "form-check-input oeil", checked: visible, title: titre });
      i.setAttribute("aria-label", titre);
      i.onchange = () => changer(i.checked);
      return i;
    };
    const modeles = P.imports.map(m => {
      const d = document.createElement("div");
      d.className = "volume";
      d.innerHTML = `<span></span><span style="grid-column: 2 / 6">${t("import.modele", { nom: esc(m.nom) })}<br><span class="text-secondary">${esc(m.note)}</span></span>`
        + `<button type="button" title="${t("import.retirer")}" aria-label="${t("import.retirer")}">${ICONE.fermer}</button>`;
      d.querySelector("button").onclick = () => { P.imports = P.imports.filter(x => x !== m); importsChanges(); };
      return d;
    });
    const volumes = P.volumes.map((v, k) => {
      const [l, p] = dimensions(v), d = document.createElement("div"), pans = pansPossibles(v);
      d.className = "volume";
      // emprise libre : son aire ; rectangle : ses deux côtés
      d.innerHTML = `<span>${v.libre ? t("projet.volumeLibre", { n: k + 1, a: fr(aire(v.coins), 0) }) : t("projet.volume", { n: k + 1, l: fr(l), p: fr(p) })}</span>`
        + `<button type="button" class="pastille" title="${t("projet.couleur")}" aria-label="${t("projet.couleur")}" style="background:${v.couleur || couleurs[0]}"></button>`
        + `<input type="number" class="form-control form-control-sm" min="1" max="200" step="0.5" value="${v.hauteur}" title="${t("projet.hauteur")}" aria-label="${t("projet.hauteur")}">`
        + `<select class="form-select form-select-sm"><option value="plat">${t("projet.plat")}</option><option value="deux"${pans ? "" : " disabled"}>${t("projet.deuxPans")}</option><option value="quatre"${pans ? "" : " disabled"}>${t("volume.quatrePans")}</option></select>`
        + `<button type="button" title="${t("projet.retirer")}" aria-label="${t("projet.retirer")}">${ICONE.fermer}</button>`
        + `<div class="palette" hidden>${couleurs.map(c => `<button type="button" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div>`;
      d.prepend(oeil(v.visible !== false, t("projet.voir"), ok => { v.visible = ok; volumesChanges(); }));
      const [pastille, h, toit, x] = d.querySelectorAll(":scope > input[type=number], :scope > select, :scope > button");
      const palette = d.querySelector(".palette");
      toit.value = pans ? v.toit : "plat";
      if (!pans) toit.title = t("volume.pansRectangle");
      pastille.onclick = () => { palette.hidden = !palette.hidden; };
      palette.onclick = e => { const c = e.target.dataset?.c; if (c) { v.couleur = c; volumesChanges(); } };
      h.onchange = () => { reglerCorniche(v, Math.max(1, +h.value || v.hauteur)); volumesChanges(); };
      // un clic sur le nom choisit le volume (poignées et tableau)
      const nom = d.querySelector("span");
      nom.classList.add("nom-volume"); nom.title = t("volume.choisir");
      nom.onclick = () => edition?.choisir(edition.selection === v.id ? null : v.id);
      d.classList.toggle("choisi", edition?.selection === v.id);
      toit.onchange = () => { v.toit = toit.value; volumesChanges(); };
      x.onclick = () => { P.volumes = P.volumes.filter(w => w !== v); volumesChanges(); };
      return d;
    });
    const caches = P.caches.map(c => {
      const d = document.createElement("div");
      d.className = "volume";
      d.innerHTML = `<span style="grid-column: 2 / 6">${esc(c.nom)} <span class="text-secondary">· ${t(c.visible ? "pro.montre" : "pro.masque")}</span></span>`
        + `<button type="button" title="${t("pro.retablir")}" aria-label="${t("pro.retablir")}">${ICONE.fermer}</button>`;
      d.prepend(oeil(c.visible, t("pro.voirMasque"), ok => { memoriser(); c.visible = ok; appliquer(); }));
      d.querySelector("button").onclick = () => { memoriser(); P.caches = P.caches.filter(x => x !== c); appliquer(); };
      return d;
    });
    const liste = [...modeles, ...volumes, ...caches];
    $("#listeVolumes").replaceChildren(...(liste.length ? liste : [Object.assign(document.createElement("div"), { className: "small text-secondary", textContent: t("pro.listeVide") })]));
  }

  /* ---------------------------------------------------------------- modèles importés */
  // glTF/GLB, OBJ, STL ou DXF : placé par ses coordonnées MN95, l'origine locale du site, ou sa limite de parcelle
  // (importer.js) ; son calque « sections » donne des coupes. Les modèles ne sont pas gardés dans les projets enregistrés.
  const contexteImport = () => ({ E0: S.E0, N0: S.N0, zRef: scene.zRef, parcelle: S.parcelle?.anneauxRel || [], solEn: (x, y) => solEn(S.G, x, y) });
  function importsChanges() {
    scene.afficherImports(P.imports.map(m => m.objet));
    volumesChanges();
  }
  $("#btnImporter").onclick = () => { if (pret()) $("#fichierModele").click(); };
  $("#fichierModele").onchange = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || !pret()) return;
    o.etat(0.3, t("import.enCours", { nom: f.name }));
    try {
      const r = await importerModele(f, contexteImport());
      const pl = r.placement, note = [t(`import.methode.${pl.methode}`), pl.ecartMax != null ? t("import.ajuste", { cm: Math.max(1, Math.round(pl.ecartMax * 100)) }) : ""].filter(Boolean).join(" · ");
      P.imports.push({ nom: f.name, objet: r.objet, note });
      o.compter?.("import");
      importsChanges();
      if (r.coupes?.length) o.ouvrirCoupes?.([...(S.coupes || []).map(c => ({ A: c.A, B: c.B })), ...r.coupes]);
      o.message([note, ...r.avertissements, t("import.nonEnregistre")].filter(Boolean).join(" · "), 9000);
    } catch (err) {
      console.error(err);
      o.message(err.message);
    }
    o.etat(1, "");
  };
  $("#btnRefParcelle").onclick = () => {
    if (!pret()) return;
    const { nom, texte } = dxfReference({ ...contexteImport(), lieu: $("#lieu").textContent || "" });
    telecharger(new Blob([texte], { type: "application/dxf" }), nom);
  };

  /* ---------------------------------------------------------------- projets enregistrés (dans ce navigateur) */
  function listeProjets() {
    const sel = $("#listeProjets"), liste = listerProjets();
    sel.replaceChildren(new Option(t("projet.nouveau"), ""), ...liste.map(p => new Option(p.nom, p.id)));
    sel.value = P.projet?.id || "";
    $("#btnSupprimerProjet").disabled = !P.projet;
  }
  $("#btnEnregistrer").onclick = () => {
    if (!pret()) return;
    const nom = prompt(t("projet.nom"), P.projet?.nom || t("projet.nomDefaut", { lieu: $("#lieu").textContent || "" }));
    if (!nom) return;
    const p = {
      id: P.projet?.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, nom,
      hash: location.hash, jour: S.jour, rayon: o.rayonZone?.(), caches: P.caches, volumes: P.volumes,
      coupes: (S.coupes || []).map(c => ({ A: c.A, B: c.B })),
    };
    if (!enregistrerProjet(p)) return o.message(t("projet.stockage"));
    P.projet = p;
    listeProjets();
    o.compter?.("projet");
    o.message(t("projet.enregistre", { nom }), 3000);
  };
  $("#listeProjets").onchange = () => {
    const p = listerProjets().find(q => q.id === $("#listeProjets").value);
    if (!p) { P.projet = null; P.volumes = []; volumesChanges(); oublierHistorique(); listeProjets(); return; }
    P.projet = p;
    // le projet est rouvert sur son lieu : chargement si besoin, puis bâtiments démolis, volumes et coupes
    if (+p.rayon > 0) o.reglerRayon?.(+p.rayon, false);
    if (location.hash !== p.hash) { P.aOuvrir = p; location.hash = p.hash.slice(1); } else ouvrir(p);
  };
  $("#btnSupprimerProjet").onclick = () => {
    if (!P.projet) return;
    supprimerProjet(P.projet.id);
    P.projet = null;
    listeProjets();
  };
  function ouvrir(p) {
    if (p.jour) o.changerJour?.(p.jour);
    // anciens projets : une seule liste de volumes masqués
    P.caches = p.caches ? p.caches.map(c => ({ ...c })) : p.masques?.length ? [{ id: 1, ids: p.masques, visible: false, nom: t("pro.ficheN", { n: p.masques.length }) }] : [];
    numeroCache = Math.max(0, ...P.caches.map(c => c.id));
    P.historique = []; P.selection.clear();
    appliquer();
    P.volumes = (p.volumes || []).map(v => normaliserVolume({ ...v, coins: v.coins.map(q => [...q]), etages: v.etages && [...v.etages] }, S.G));
    numero = Math.max(0, ...P.volumes.map(v => v.id));
    volumesChanges(); oublierHistorique();
    if (p.coupes?.length) o.ouvrirCoupes?.(p.coupes);
    listeProjets();
  }
  listeProjets();

  /* ---------------------------------------------------------------- export du site */
  const format = () => $("input[name=formatExport]:checked").value;
  const choix = () => ({
    terrain: $("#xTerrain").checked, maille: +$("#xMaille").value, socle: $("#xSocle").checked, batiments: $("#xBati").checked,
    arbres: $("#xArbres").checked, parcelle: $("#xParcelle").checked && FORMATS[format()].lignes, courbes: $("#xCourbes").checked && FORMATS[format()].lignes,
  });
  const jeuExport = () => jeu() === "aucun" ? "releve" : jeu();
  function majExport() {
    const F = FORMATS[format()];
    $("#xJeu").textContent = { releve: t("pro.jeuReleve"), swiss: t("pro.jeuSwiss"), roofer: t("pro.jeuRoofer") }[jeuExport()];
    $("#xMn95").disabled = !F.absolu;
    if (!F.absolu) $("#xLocal").checked = true;
    $("#xParcelle").disabled = $("#xCourbes").disabled = !F.lignes;
    $("#exportCoupe").classList.toggle("d-none", !S.coupe);
    if (!pret() || $("#choixExport").hidden) return;
    const e = estimer(scene, choix(), format(), jeuExport());
    $("#noteExport").innerHTML = t("pro.estimation", { triangles: entier(e.triangles), taille: mo(e.octets) })
      + (e.octets > 50e6 ? ` <b>${t("pro.lourd")}${+$("#xMaille").value < 2 ? t("pro.lourdMaille") : ""}.</b>` : "")
      + (!F.absolu ? "<br>" + t("pro.simplePrecision") : "")
      + (!F.lignes ? "<br>" + t("pro.stlSurfaces") : "");
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
      o.compter?.("export");
      $("#resultatExport").innerHTML = t("pro.telecharge", { nom: r.nom, zip: mo(r.octetsZip), fichier: r.fichier, taille: mo(r.octets), triangles: entier(r.triangles), s: fr(r.ms / 1000) });
      if (import.meta.env.DEV) S.dernierExport = r; // pour la relecture pendant le développement
    } catch (e) {
      console.error(e);
      o.message(t("pro.exportImpossible", { m: e.message }));
    }
    o.etat(1, "");
    enCours = false;
  }
  $("#btnTelecharger").onclick = () => exporter(format(), choix(), $("#xMn95").checked);
  // « maquette complète » : tout le contenu, origine locale ; terrain à 1 m (2 m en DXF, format bien plus lourd)
  $$("[data-tout]").forEach(b => b.onclick = () => exporter(b.dataset.tout, { terrain: true, maille: b.dataset.tout === "dxf" ? 2 : 1, socle: true, batiments: true, arbres: true, parcelle: true, courbes: false }, false));

  /* ---------------------------------------------------------------- impression 3D (STL fermé, aperçu) */
  // bouton ajouté sous les exports de la maquette complète
  {
    const ancre = document.querySelector("[data-tout]")?.parentElement;
    if (ancre && !document.getElementById("btnImpression3d")) {
      const b = document.createElement("button");
      b.type = "button"; b.id = "btnImpression3d"; b.className = "btn btn-sm btn-outline-primary w-100 mt-2";
      b.textContent = t("impr.bouton"); b.title = t("impr.boutonTitre");
      ancre.after(b);
      b.onclick = () => {
        if (!pret()) return;
        if (o.compte?.disponible() && !o.compte.etat().pro && !o.compte.exigerPro(t("impr.raison"))) return;
        const lieu = $("#lieu").textContent || "site";
        const demi = (S.G.rayonZone || S.G.R) + 30;
        ouvrirImpression3D({
          G: S.G,
          jeu: jeu(),
          // toits à imprimer : ceux du type choisi (relevé tel qu'affiché, démolitions comprises ; swisstopo ; Advanced),
          // et les volumes et modèles importés du projet. null : bâtiments swisstopo impossibles à charger
          toits: async type => {
            const lots = [];
            if (type === "releve") lots.push(toitsReleve(S.G, scene.contours));
            else if (type === "swiss") { const l = await toitsSwiss(scene, demi); if (!l) return null; lots.push(l); }
            else if (type === "roofer") lots.push(toitsObjets([await o.maillageAdvanced()], scene.zRef, { limite: demi }));
            const projet = [scene.couches.volumes, scene.couches.imports].filter(Boolean);
            if (type !== "aucun" && projet.length) lots.push(toitsObjets(projet, scene.zRef, { limite: demi, visibles: true }));
            return lots;
          },
          nom: (contenu, ext) => nomFichier({ lieu, parcelle: S.parcelle, contenu, ext }),
          telecharger: (blob, nom) => { telecharger(blob, nom); o.compter?.("export"); },
        });
      };
    }
  }

  /* ---------------------------------------------------------------- export de la coupe */
  $$("[data-coupe]").forEach(b => b.onclick = async () => {
    if (!S.coupe) return;
    // export des coupes : réservé au Pro (sans API des comptes, en développement, il reste ouvert)
    if (o.compte?.disponible() && !o.compte.etat().pro && !o.compte.exigerPro(t("compte.raisonCoupe"))) return;
    const C = S.coupe, lieu = $("#lieu").textContent || "site";
    const D = dessinCoupe(C.P, { E0: S.E0, N0: S.N0, lieu, soleil: o.soleilActuel(), jour: date(new Date(S.jour + "T12:00:00")) });
    const infos = [t("export.infoCoupe", { lieu }), `A = E ${fr(S.E0 + C.A[0])} N ${fr(S.N0 + C.A[1])} ; B = E ${fr(S.E0 + C.B[0])} N ${fr(S.N0 + C.B[1])} (MN95, EPSG:2056)`,
      t("export.infoAxesCoupe"), t("export.infoSourceCoupe")];
    const nom = nomFichier({ lieu, parcelle: S.parcelle, contenu: `coupe-${(C.lettres?.[0] || "A")}`, ext: b.dataset.coupe });
    if (b.dataset.coupe === "pdf") {
      try {
        const blob = await coupePdf(coupeSvg(D, infos), infos.slice(1), t("export.infoCoupe", { lieu }) + " — 1:200");
        telecharger(blob, nom);
        $("#resultatExport").innerHTML = t("pro.telechargeCoupe", { nom, taille: mo(blob.size) });
      } catch (e) { console.error(e); o.message(t("pro.exportImpossible", { m: e.message })); }
      return;
    }
    const texte = b.dataset.coupe === "dxf" ? coupeDxf(D, infos) : coupeSvg(D, infos);
    telecharger(new Blob([texte], { type: b.dataset.coupe === "dxf" ? "application/dxf" : "image/svg+xml" }), nom);
    $("#resultatExport").innerHTML = t("pro.telechargeCoupe", { nom, taille: mo(texte.length) });
    if (import.meta.env.DEV) S.dernierExport = { nom, texte };
  });
  $("#vCoupe").addEventListener("change", majExport);

  /* ---------------------------------------------------------------- statut Pro (plus d'interrupteur) */
  // Le mode pro suit le compte : Pro (ou sans service de comptes, en développement) → outils actifs ; sinon les outils
  // restent visibles mais grisés, et un clic dessus ouvre l'offre Pro.
  const autorise = () => !o.compte?.disponible() || o.compte.etat().pro;
  const basculer = () => {
    const ok = autorise(), avant = $("#vPro").checked;
    $("#vPro").checked = ok;
    for (const id of ["#outilsPro", "#outilsExport"]) {
      $(id).hidden = false;
      $(id).classList.toggle("pro-verrouille", !ok);
      $(id).setAttribute("aria-disabled", String(!ok));
    }
    document.body.classList.toggle("pro", ok); // les réglages « pro » placés ailleurs dans le panneau (.pro-seul)
    if (ok !== avant) { $("#vPro").dispatchEvent(new Event("change")); if (ok) o.compter?.("pro_ouvert"); }
    maj();
  };
  for (const id of ["#outilsPro", "#outilsExport"]) $(id).addEventListener("click", e => {
    if (!$(id).classList.contains("pro-verrouille")) return;
    e.preventDefault(); e.stopPropagation();
    o.compte?.exigerPro?.(t("compte.raisonPro"));
  }, true);
  o.compte?.addEventListener("compte", basculer);
  basculer();

  return {
    /** Nouveau lieu : plus de sélection ni de masquage. */
    reinitialiser() {
      P.selection = new Set(); P.masques = new Set(); P.caches = []; P.historique = []; P.volumes = []; P.imports = []; S.volumesProjet = []; oublierHistorique();
      if (dessin) finDessin();
      edition?.deselectionner();
      $("#resultatExport").textContent = ""; listeVolumes(); maj();
    },
    /** Dessin d'un volume en cours (les clics sur la maquette lui reviennent). */
    dessine: () => !!dessin || performance.now() - finAt < 400,
    /** Lieu chargé : un projet en attente (ouvert depuis la liste) est appliqué. */
    apresChargement() { if (P.aOuvrir) { const p = P.aOuvrir; P.aOuvrir = null; ouvrir(p); } else if (P.projet && location.hash !== P.projet.hash) { P.projet = null; listeProjets(); } },
  };
}
