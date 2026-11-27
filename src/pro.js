// Mode pro : sélection et masquage de bâtiments (retirés aussi des calculs), taille de la maquette, exports.
// Les outils n'apparaissent que lorsque l'interrupteur « Mode pro » est activé.
import * as THREE from "three";
import { ficheVolumes, volumesParcelle } from "./volumes.js";
import { FORMATS, exporterSite, estimer, sansAccent, nomFichier } from "./export.js";
import { dessinCoupe, coupeDxf, coupeSvg, coupePdf } from "./exportCoupe.js";
import { ouvrirImpression3D } from "./impression3dFenetre.js";
import { toitsReleve, toitsObjets, toitsSwiss } from "./impression3dToits.js";
import { t, nombre, entier, date, locale } from "./i18n.js";
import { rectangle, dimensions, reglerCorniche, listerProjets, enregistrerProjet, supprimerProjet, normaliserVolume, empriseValide, sensDirect, seRecoupe, orientationDominante, aire, pansPossibles, lireProjet, nouvelId, renommerProjet, dupliquerProjet, projetOuvert, aireEmprise, surfacePlancher, corniche, hauteurToit } from "./projet.js";
import { directions, accrocherPoint } from "./accrochage.js";
import { traceSol } from "./traceVolume.js";
import { ficheVolume, mesurer, cotesVolume } from "./ficheVolume.js";
import { importerModele } from "./importer.js";
import { dxfReference } from "./referenceParcelle.js";
import { solEn } from "./grille.js";
import { ICONE } from "./icones.js";
import { brancherEdition } from "./editionVolumes.js";
import { COULEURS, ouvrirApparence, fermerApparence } from "./couleurVolume.js";
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
  const couleurs = COULEURS.map(x => x.c);
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
    modifie();
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
    if (dessin && mode === "libre" && e.key === "Enter") { e.preventDefault(); return fermerEmprise(); }
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
  /** Ferme l'emprise libre : volume créé, ou refus si elle se recoupe ou est trop petite (`fermer`, plus bas, ferme le projet). */
  function fermerEmprise() {
    if (!dessin || mode !== "libre") return;
    if (dessin.length < 3) return aide("projet.libreTrop");
    if (!empriseValide(dessin)) return aide(seRecoupe(dessin, true) ? "projet.recoupe" : "projet.libreTrop");
    ajouterVolume(normaliserVolume({ ...volumeDe(sensDirect(dessin)), libre: true }, S.G));
  }
  function clicDessin(e) {
    if (mode === "libre") {
      const r = pointLibre(e);
      if (!r) return;
      if (r.ferme) return fermerEmprise();
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
    if (mode === "libre") fermerEmprise();
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
      bouge: v => { fiche.rafraichir(); majCarteVolume(v); modifie(); }, // souris : le tableau et la carte suivent
      choix: id => {
        const v = P.volumes.find(w => w.id === id);
        fiche.montrer(v || null, P.volumes.indexOf(v) + 1);
        listeVolumes();
        if (v) $(`#cartesVolumes [data-id="${v.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      },
      cotes: v => cotesVolume(v, mesures(v), scene),
    });
  });
  // tableau du volume sélectionné (ficheVolume.js), dans la carte du volume choisi
  // mesures : calculées une fois pour une même position (cotes, tableau et carte les demandent au même moment)
  let memo = { cle: null, t: 0, M: null };
  const mesures = v => {
    const cle = `${v.id}|${v.coins.flat().join()}|${v.base}|${v.etages?.join()}|${S.toutes?.length || 0}|${P.volumes.length}`, n = performance.now();
    if (memo.cle === cle && n - memo.t < 60) return memo.M;
    memo = { cle, t: n, M: mesurer(v, { scene, S, parcelleEn: o.parcelleEn, autres: P.volumes }) };
    return memo.M;
  };
  const boiteFiche = Object.assign(document.createElement("div"), { id: "ficheVolume", hidden: true });
  $("#aideVolume").after(boiteFiche);
  const fiche = ficheVolume(boiteFiche, {
    S, mesures,
    // pendant la saisie : maquette et poignées ; à la validation : aussi coupe, heures de soleil et liste
    changer: (v, final) => { if (final) volumesChanges(); else { scene.afficherVolumes(P.volumes); edition?.maj(); majCarteVolume(v); modifie(); } },
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
    fermerApparence();
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
    modifie();
  }
  /* ---------------------------------------------------------------- cartes des volumes */
  // Une carte par volume. En-tête : œil, nom, dimensions (rectangle : côtés ; emprise libre : nombre de côtés et aire),
  // pastille de couleur (ouvre la fenêtre de couleur, couleurVolume.js), retrait. Résumé du volume non choisi : étages,
  // hauteurs, toit, base, surfaces, distances (limites de la parcelle, une par voisin, et bâtiments les plus proches, au
  // centimètre, en plan). Le volume choisi montre à la place sa fenêtre de paramètres (ficheVolume.js), qui reprend tout
  // cela section par section ; le dépassement de la limite reste en évidence dans les deux cas. Un clic sur la carte
  // choisit le volume dans la scène, et inversement. Les cartes sont gardées d'un rendu à l'autre (la fenêtre du volume
  // choisi, placée dans sa carte, ne perd pas la saisie en cours).
  const cartesV = new Map();
  const m2 = a => `${fr(a, 1)} m²`;
  function majCarteVolume(v) {
    const d = v && cartesV.get(v.id);
    if (!d || !pret()) return;
    const k = P.volumes.indexOf(v), n = v.coins.length, hc = corniche(v), ht = hauteurToit(v), E = v.etages?.length || 1;
    // rectangle : ses deux côtés ; emprise libre (ou quadrilatère quelconque) : nombre de côtés et aire
    const rect = !v.libre && pansPossibles(v);
    let dim;
    if (rect) { const [l, p] = dimensions(v); dim = `${fr(l, 2)} × ${fr(p, 2)} m`; }
    else dim = t("carte.libre", { n, a: m2(aire(v.coins)) });
    // toit à pans : seulement sur un rectangle (sinon le volume est dessiné à toit plat)
    const toit = { plat: t("projet.plat"), deux: t("projet.deuxPans"), quatre: t("volume.quatrePans") }[pansPossibles(v) ? v.toit : "plat"];
    d.querySelector(".cv-nom").textContent = v.nom || t("carte.volume", { n: k + 1 });
    d.querySelector(".cv-dim").textContent = dim;
    d.querySelector(".cv-pastille").style.background = v.couleur || couleurs[0];
    d.querySelector(".cv-chiffres").innerHTML = [
      t(E === 1 ? "carte.unEtage" : "carte.etages", { n: E }), t("carte.corniche", { h: fr(hc, 2) }),
      ...(ht > 0 ? [t("carte.faite", { h: fr(hc + ht, 2) })] : []), `${t("volume.toit")} ${toit.toLowerCase()}`,
      t("carte.base", { z: fr(v.base, 2) }), ...(rect ? [t("carte.sol", { a: m2(aireEmprise(v.coins)) })] : []), t("carte.plancher", { a: m2(surfacePlancher(v)) }),
    ].map(x => `<span>${esc(x)}</span>`).join("");
    const M = mesures(v), lignes = [];
    // les quatre limites les plus proches (une parcelle de route en a des dizaines)
    for (const l of (M.limites?.length ? M.limites : M.limite ? [{ ...M.limite, numero: M.parcelle }] : []).slice(0, 4)) {
      lignes.push(`<tr class="cv-limite${l.d < 0.005 ? " cv-zero" : ""}"><th>${esc(l.numero != null ? t("carte.limite", { n: l.numero }) : t("carte.limiteSans"))}</th><td>${fr(l.d, 2)} m</td></tr>`);
    }
    for (const b of M.batiments || []) if (b.d < 80) lignes.push(`<tr><th>${t("carte.batiment")}</th><td>${fr(b.d, 2)} m</td></tr>`);
    const dep = M.depasse;
    d.classList.toggle("depasse", !!dep);
    const alerte = d.querySelector(".cv-alerte");
    alerte.hidden = !dep;
    alerte.textContent = dep ? (dep.d > 0.005 ? t("carte.depasse", { d: fr(dep.d, 2) }) : t("carte.touche")) : "";
    d.querySelector(".cv-distances").innerHTML = (lignes.length ? `<table><tbody>${lignes.join("")}</tbody></table>` : `<span class="text-secondary">${t("carte.sansMesure")}</span>`);
  }
  function carteVolume(v) {
    let d = cartesV.get(v.id);
    if (d) return d;
    d = document.createElement("article");
    d.className = "carte-volume"; d.dataset.id = v.id; d.tabIndex = 0;
    d.innerHTML = `<div class="cv-tete"><span class="cv-oeil"></span><span class="cv-nom"></span><span class="cv-dim"></span>`
      + `<button type="button" class="cv-pastille" title="${t("fv.apparenceTitre")}" aria-label="${t("fv.apparenceTitre")}" aria-haspopup="dialog" aria-expanded="false"></button>`
      + `<button type="button" class="cv-retirer" title="${t("projet.retirer")}" aria-label="${t("projet.retirer")}">${ICONE.fermer}</button></div>`
      + `<div class="cv-alerte" role="status" hidden></div><div class="cv-chiffres"></div><div class="cv-distances"></div>`;
    const i = document.createElement("input");
    Object.assign(i, { type: "checkbox", className: "form-check-input oeil", title: t("projet.voir") });
    i.setAttribute("aria-label", t("projet.voir"));
    d.querySelector(".cv-oeil").replaceWith(i);
    d.onclick = e => {
      const vol = P.volumes.find(w => w.id === v.id);
      if (!vol) return;
      if (e.target === i) { vol.visible = i.checked; volumesChanges(); return; }
      if (e.target.closest(".cv-pastille")) {
        // fenêtre de couleur : aperçu en direct sur la maquette, étape d'historique une fois le réglage posé
        const le = () => P.volumes.find(w => w.id === v.id);
        ouvrirApparence(e.target.closest(".cv-pastille"), {
          lire: () => { const w = le(); return w ? { couleur: w.couleur, opacite: w.opacite } : null; },
          changer: (a, final) => {
            const w = le();
            w.couleur = a.couleur; w.opacite = a.opacite;
            if (final) volumesChanges(); else { scene.afficherVolumes(P.volumes); edition?.maj(); majCarteVolume(w); modifie(); }
          },
        });
        return;
      }
      if (e.target.closest(".cv-retirer")) { fermerApparence(); P.volumes = P.volumes.filter(w => w !== vol); volumesChanges(); return; }
      if (e.target.closest("#ficheVolume")) return; // saisie dans le tableau
      edition?.choisir(edition.selection === vol.id ? null : vol.id);
    };
    d.onkeydown = e => { if ((e.key === "Enter" || e.key === " ") && e.target === d) { e.preventDefault(); edition?.choisir(edition.selection === v.id ? null : v.id); } };
    cartesV.set(v.id, d);
    return d;
  }
  function cartesVolumes() {
    const el = $("#cartesVolumes");
    for (const id of cartesV.keys()) if (!P.volumes.some(v => v.id === id)) { const d = cartesV.get(id); if (d.contains(boiteFiche)) $("#aideVolume").after(boiteFiche); cartesV.delete(id); }
    const cartes = P.volumes.map(carteVolume), avant = [...el.children];
    if (cartes.length !== avant.length || cartes.some((c, k) => c !== avant[k])) {
      if (cartes.some(c => c.contains(boiteFiche))) $("#aideVolume").after(boiteFiche); // hors des cartes le temps du rangement
      el.replaceChildren(...cartes);
    }
    $("#titreVolumes").hidden = !cartes.length;
    for (const v of P.volumes) {
      const d = cartesV.get(v.id), choisi = edition?.selection === v.id;
      d.classList.toggle("choisi", choisi);
      d.setAttribute("aria-pressed", String(choisi));
      d.querySelector("input.oeil").checked = v.visible !== false;
      majCarteVolume(v);
      if (choisi && boiteFiche.parentElement !== d) d.append(boiteFiche);
    }
    if (edition?.selection == null && boiteFiche.parentElement !== $("#aideVolume").parentElement) $("#aideVolume").after(boiteFiche);
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
    const caches = P.caches.map(c => {
      const d = document.createElement("div");
      d.className = "volume";
      d.innerHTML = `<span style="grid-column: 2 / 6">${esc(c.nom)} <span class="text-secondary">· ${t(c.visible ? "pro.montre" : "pro.masque")}</span></span>`
        + `<button type="button" title="${t("pro.retablir")}" aria-label="${t("pro.retablir")}">${ICONE.fermer}</button>`;
      d.prepend(oeil(c.visible, t("pro.voirMasque"), ok => { memoriser(); c.visible = ok; appliquer(); }));
      d.querySelector("button").onclick = () => { memoriser(); P.caches = P.caches.filter(x => x !== c); appliquer(); };
      return d;
    });
    cartesVolumes();
    const liste = [...modeles, ...caches];
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

  /* ---------------------------------------------------------------- projets : cartes, enregistrement automatique */
  // Les projets restent dans ce navigateur (phase 1 du plan). Le projet ouvert s'enregistre tout seul, peu après chaque
  // modification (volumes, démolitions, coupes, date et heure, taille de la maquette), et aussi quand l'onglet se ferme ;
  // le dernier projet ouvert est rouvert au rechargement de la page. Format inchangé, champs ajoutés seulement
  // (E0, N0, lieu, minutes, vignette, resume) : les anciens projets s'ouvrent comme avant.
  const DELAI = 700;
  let minuterie = 0, dernier = null, ouverture = false, suspendu = false, tousProjets = false;
  P.hashCharge = null; // lien qui a chargé la maquette affichée (un clic sur une parcelle change l'adresse sans recharger)
  const signature = c => JSON.stringify(c);
  /** Le projet est-il sur la maquette affichée (même centre) ? Anciens projets : même lien. */
  const memeLieu = p => !!p && S.E0 != null && (p.E0 != null ? Math.abs(p.E0 - S.E0) < 0.5 && Math.abs(p.N0 - S.N0) < 0.5 : p.hash === P.hashCharge);
  const r1 = x => Math.round(x * 10) / 10;
  /** Contour de la parcelle, allégé (≤ 80 points, au décimètre), pour la vignette de la carte. */
  function contourVignette() {
    const a = S.parcelle?.anneauxRel?.[0];
    if (!a?.length) return null;
    const pas = Math.max(1, Math.ceil(a.length / 80));
    return a.filter((_, i) => i % pas === 0).map(([x, y]) => [r1(x), r1(y)]);
  }
  function nbDemolis() {
    const ids = P.caches.filter(c => !c.visible).flatMap(c => c.ids);
    if (!ids.length) return 0;
    const V = pret() ? scene.indexer() : null;
    return V ? new Set(ids.map(s => V.bati[s])).size : P.caches.filter(c => !c.visible).length;
  }
  /** État du projet à enregistrer (sans id, nom ni date). */
  function contenu() {
    return {
      hash: P.projet?.hash ?? P.hashCharge ?? location.hash, E0: S.E0, N0: S.N0, lieu: P.projet?.lieu ?? ($("#lieu").textContent.trim() || null),
      jour: S.jour, minutes: S.minutes, rayon: +$("#rayonZone")?.value || o.rayonZone?.(),
      caches: P.caches, volumes: P.volumes, coupes: (S.coupes || []).filter(c => c.A && c.B).map(c => ({ A: c.A, B: c.B })),
      vignette: P.projet?.vignette ?? contourVignette(), resume: { volumes: P.volumes.length, demolis: nbDemolis() },
    };
  }
  function temoin(etat) {
    const el = $("#cartesProjets .ouvert .cp-temoin");
    if (!el) return;
    el.classList.toggle("erreur", etat === "erreur");
    el.textContent = etat === "attente" ? t("projet.enCours") : etat === "erreur" ? t("projet.stockage") : t("projet.enregistreA", { h: heureDe(P.projet?.modifie) });
  }
  const heureDe = iso => iso ? new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "";
  /** Enregistre le projet ouvert s'il a changé (ou en crée un au premier volume, à la première démolition). */
  function sauver() {
    clearTimeout(minuterie); minuterie = 0;
    if (suspendu || ouverture || P.aOuvrir || !pret()) return;
    if (!P.projet) {
      if (actif() && (P.volumes.length || P.caches.length)) creer();
      return;
    }
    if (!memeLieu(P.projet)) return;
    const c = contenu(), sig = signature(c);
    if (sig === dernier) return temoin("ok");
    if (!enregistrerProjet({ ...P.projet, ...c })) return temoin("erreur");
    P.projet = { ...lireProjet(P.projet.id), E0: S.E0, N0: S.N0 };
    dernier = sig;
    cartesProjets();
  }
  /** Une modification : enregistrement groupé un peu plus tard. */
  function modifie() {
    if (suspendu || ouverture || !pret()) return;
    clearTimeout(minuterie);
    minuterie = setTimeout(sauver, DELAI);
    if (P.projet) temoin("attente");
  }
  document.addEventListener("projet:modifie", modifie);
  $("#rayonZone")?.addEventListener("change", modifie);
  // rien n'est perdu à la fermeture de l'onglet (ni en passant à une autre application sur mobile)
  addEventListener("pagehide", sauver);
  addEventListener("beforeunload", sauver);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sauver(); });

  const nomLibre = base => { const noms = new Set(listerProjets().map(p => p.nom)); let n = base, k = 2; while (noms.has(n)) n = `${base} (${k++})`; return n; };
  function creer(nom = nomLibre(t("projet.nomDefaut", { lieu: $("#lieu").textContent.trim() }))) {
    const c = contenu(), p = { id: nouvelId(), nom, ...c, hash: P.hashCharge || location.hash, vignette: contourVignette() };
    if (!enregistrerProjet(p)) { o.message(t("projet.stockage")); return null; }
    P.projet = { ...lireProjet(p.id), E0: S.E0, N0: S.N0 };
    dernier = signature(contenu());
    projetOuvert(p.id);
    o.compter?.("projet");
    cartesProjets();
    return P.projet;
  }
  /** Maquette sans projet : plus de volumes ni de démolitions (sans rien enregistrer). */
  function vider() {
    ouverture = true;
    try {
      P.caches = []; P.historique = []; P.selection.clear(); numeroCache = 0;
      appliquer();
      P.volumes = []; numero = 0;
      edition?.deselectionner();
      volumesChanges();
    } finally { ouverture = false; }
  }
  function fermer() {
    sauver();
    P.projet = null; dernier = null; projetOuvert(null);
    vider();
    cartesProjets();
  }
  $("#btnNouveauProjet").onclick = () => {
    if (!pret()) return;
    if (P.projet) { sauver(); P.projet = null; vider(); }
    const p = creer();
    if (p) o.message(t("projet.cree", { nom: p.nom }), 4000);
  };

  function ouvrirProjet(p) {
    if (!p || P.projet?.id === p.id) return;
    sauver();
    const surPlace = memeLieu(p) || (p.E0 == null && (location.hash === p.hash || P.hashCharge === p.hash));
    if (surPlace && !(+p.rayon > 0 && +p.rayon !== +$("#rayonZone").value)) return ouvrir(p);
    // ailleurs (ou autre taille de maquette) : le lieu est rechargé, puis le projet appliqué (apresChargement)
    P.projet = null; projetOuvert(p.id);
    P.aOuvrir = p;
    if (+p.rayon > 0) o.reglerRayon?.(+p.rayon, false);
    if (location.hash !== p.hash) location.hash = p.hash.slice(1); else o.recharger?.();
  }
  function ouvrir(p) {
    ouverture = true;
    try {
      P.projet = { ...p, E0: S.E0, N0: S.N0 };
      projetOuvert(p.id);
      if (p.jour) o.changerJour?.(p.jour);
      if (p.minutes != null && $("#heure")) { $("#heure").value = p.minutes; $("#heure").dispatchEvent(new Event("input")); }
      // anciens projets : une seule liste de volumes masqués
      P.caches = p.caches ? p.caches.map(c => ({ ...c })) : p.masques?.length ? [{ id: 1, ids: p.masques, visible: false, nom: t("pro.ficheN", { n: p.masques.length }) }] : [];
      numeroCache = Math.max(0, ...P.caches.map(c => c.id));
      P.historique = []; P.selection.clear();
      appliquer();
      P.volumes = (p.volumes || []).map(v => normaliserVolume({ ...v, coins: v.coins.map(q => [...q]), etages: v.etages && [...v.etages] }, S.G));
      numero = Math.max(0, ...P.volumes.map(v => v.id));
      edition?.deselectionner();
      volumesChanges();
      if (p.coupes?.length) o.ouvrirCoupes?.(p.coupes);
      else if ($("#vCoupe").checked) { $("#vCoupe").checked = false; $("#vCoupe").dispatchEvent(new Event("change")); }
    } finally { ouverture = false; }
    dernier = signature(contenu());
    cartesProjets();
  }

  /** Vignette : contour de la parcelle et emprises des volumes, en plan (nord en haut). */
  function vignette(p) {
    const polys = (p.volumes || []).filter(v => v.coins?.length > 2).map(v => ({ c: v.coins, f: v.couleur || couleurs[2] }));
    const tous = [...(p.vignette || []), ...polys.flatMap(v => v.c)];
    if (!tous.length) return `<svg class="cp-vignette" viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="14" width="28" height="20" rx="2" class="cp-vide"/></svg>`;
    const xs = tous.map(q => q[0]), ys = tous.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = 40 / Math.max(4, x1 - x0, y1 - y0), ox = 24 - (x0 + x1) / 2 * k, oy = 24 + (y0 + y1) / 2 * k;
    const pts = c => c.map(([x, y]) => `${(ox + x * k).toFixed(1)},${(oy - y * k).toFixed(1)}`).join(" ");
    return `<svg class="cp-vignette" viewBox="0 0 48 48" aria-hidden="true">${p.vignette ? `<polygon points="${pts(p.vignette)}" class="cp-parcelle"/>` : ""}`
      + polys.map(v => `<polygon points="${pts(v.c)}" class="cp-volume" style="fill:${esc(v.f)}"/>`).join("") + "</svg>";
  }
  const lieuDe = p => p.lieu || new URLSearchParams((p.hash || "").slice(1)).get("l") || "";
  function resumeDe(p) {
    const nv = p.resume?.volumes ?? (p.volumes || []).length;
    const nd = p.resume?.demolis ?? (p.caches || []).filter(c => !c.visible).length ?? (p.masques?.length ? 1 : 0);
    const l = [nv ? t(nv === 1 ? "projet.unVolume" : "projet.nVolumes", { n: nv }) : "", nd ? t(nd === 1 ? "projet.unDemoli" : "projet.nDemolis", { n: nd }) : ""].filter(Boolean);
    return l.length ? l.join(" · ") : t("projet.vide");
  }
  /** Cartes des projets enregistrés : le projet ouvert d'abord, puis les plus récents. */
  function cartesProjets() {
    const el = $("#cartesProjets");
    if (!el) return;
    const liste = listerProjets(), ouvert = P.projet && liste.find(p => p.id === P.projet.id);
    const ordre = [...(ouvert ? [ouvert] : []), ...liste.filter(p => p !== ouvert)], MAX = 4;
    const montres = tousProjets ? ordre : ordre.slice(0, MAX);
    const cartes = montres.map(p => {
      const d = document.createElement("article"), oui = p === ouvert, m = p.modifie ? new Date(p.modifie) : null;
      d.className = "carte-projet" + (oui ? " ouvert" : "");
      d.tabIndex = 0;
      d.setAttribute("aria-label", oui ? `${p.nom} (${t("projet.ouvert")})` : t("projet.ouvrirNom", { nom: p.nom }));
      d.innerHTML = vignette(p)
        + `<div class="cp-texte"><div class="cp-nom">${esc(p.nom)}</div><div class="cp-lieu">${esc(lieuDe(p))}</div>`
        + `<div class="cp-meta">${m ? esc(t("projet.modifie", { date: date(m, { day: "numeric", month: "short", year: "numeric" }), h: heureDe(p.modifie) })) : ""}</div>`
        + `<div class="cp-meta">${esc(resumeDe(p))}</div>`
        + (oui ? `<div class="cp-temoin" aria-live="polite"></div>` : "") + `</div>`
        + `<div class="cp-actions">`
        + `<button type="button" data-a="renommer">${t("projet.renommer")}</button>`
        + `<button type="button" data-a="dupliquer">${t("projet.dupliquer")}</button>`
        + (oui ? `<button type="button" data-a="fermer">${t("projet.fermer")}</button>` : "")
        + `<button type="button" data-a="supprimer" class="cp-supprimer">${t("projet.supprimerCourt")}</button></div>`;
      d.onclick = e => {
        const a = e.target.closest("button[data-a]")?.dataset.a;
        if (!a) { if (!oui) ouvrirProjet(p); return; }
        e.stopPropagation();
        if (a === "renommer") {
          const nom = prompt(t("projet.nom"), p.nom)?.trim();
          if (!nom || nom === p.nom) return;
          if (oui) sauver();
          renommerProjet(p.id, nom);
          if (oui) P.projet = { ...lireProjet(p.id), E0: S.E0, N0: S.N0 };
          cartesProjets();
        } else if (a === "dupliquer") {
          if (oui) sauver();
          const q = dupliquerProjet(p.id, nomLibre(t("projet.copie", { nom: p.nom })));
          if (!q) return o.message(t("projet.stockage"));
          o.message(t("projet.duplique", { nom: q.nom }), 3000);
          cartesProjets();
        } else if (a === "fermer") fermer();
        else if (a === "supprimer") {
          if (!confirm(t("projet.confirmerSuppression", { nom: p.nom }))) return;
          if (oui) { clearTimeout(minuterie); P.projet = null; dernier = null; projetOuvert(null); vider(); }
          supprimerProjet(p.id);
          cartesProjets();
        }
      };
      d.onkeydown = e => { if ((e.key === "Enter" || e.key === " ") && e.target === d) { e.preventDefault(); if (!oui) ouvrirProjet(p); } };
      return d;
    });
    const extra = [];
    if (!liste.length) extra.push(Object.assign(document.createElement("div"), { className: "small text-secondary", textContent: t("projet.aucun") }));
    if (ordre.length > MAX) {
      const b = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-sm btn-link px-0", textContent: tousProjets ? t("projet.moins") : t("projet.tous", { n: ordre.length }) });
      b.onclick = () => { tousProjets = !tousProjets; cartesProjets(); };
      extra.push(b);
    }
    el.replaceChildren(...cartes, ...extra);
    temoin("ok");
  }
  // dernier projet ouvert : rouvert au rechargement de la page (sur son lieu, même si l'adresse a changé depuis)
  {
    const p = lireProjet(projetOuvert());
    if (p && /(^#|&)e=/.test(location.hash)) {
      P.aOuvrir = p;
      if (location.hash !== p.hash) try { history.replaceState(null, "", location.pathname + location.search + p.hash); } catch { /* sans historique */ }
    }
  }
  cartesProjets();

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
    for (const id of ["#outilsPro", "#outilsExport", "#outilsPiscinePro", "#outilsSolairePro"]) {
      $(id).hidden = false;
      $(id).classList.toggle("pro-verrouille", !ok);
      $(id).setAttribute("aria-disabled", String(!ok));
    }
    document.body.classList.toggle("pro", ok); // les réglages « pro » placés ailleurs dans le panneau (.pro-seul)
    if (ok !== avant) { $("#vPro").dispatchEvent(new Event("change")); if (ok) o.compter?.("pro_ouvert"); }
    maj();
  };
  for (const id of ["#outilsPro", "#outilsExport", "#outilsPiscinePro", "#outilsSolairePro"]) $(id).addEventListener("click", e => {
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
    /** Un lieu va se charger : le projet ouvert est enregistré tel quel, puis plus rien jusqu'à la fin du chargement. */
    avantChargement() { sauver(); suspendu = true; },
    /**
     * Lieu chargé : un projet en attente (ouvert depuis la liste, ou rouvert au rechargement de la page) est appliqué ;
     * le projet ouvert sur ce même lieu (taille de la maquette changée) est réappliqué ; ailleurs, il est fermé.
     */
    apresChargement() {
      suspendu = false;
      P.hashCharge = location.hash;
      if (P.aOuvrir) {
        const p = P.aOuvrir; P.aOuvrir = null;
        if (p.E0 == null || memeLieu(p)) return ouvrir(p);
        projetOuvert(null); // un autre lieu s'est chargé entre-temps : le projet n'y est pas appliqué
      }
      if (P.projet && memeLieu(P.projet)) ouvrir(lireProjet(P.projet.id) || P.projet);
      else if (P.projet) { P.projet = null; dernier = null; projetOuvert(null); cartesProjets(); }
    },
  };
}
